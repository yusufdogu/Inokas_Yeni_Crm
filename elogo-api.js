// elogo-api.js
// eLogo PostBox SOAP API client — raw XML over axios
// Supports both eLogo and İşbaşı (same WSDL, same auth)
'use strict';

const axios   = require('axios');
const { XMLParser } = require('fast-xml-parser');

// ─── XML parser ───────────────────────────────────────────────────────────────
const parser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  removeNSPrefix:      true,   // strips namespace prefixes like s:, a:
  isArray: (name) => ['string', 'Document', 'DocInfo'].includes(name),
});

// ─── Session cache — keyed by tenantId ───────────────────────────────────────
const sessionCache = new Map();
// { tenantId: { sessionID, expiresAt } }
const SESSION_TTL_MS = 20 * 60 * 1000; // 20 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

function soapEnvelope(action, body) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:tem="http://tempuri.org/"
  xmlns:efat="http://schemas.datacontract.org/2004/07/eFaturaWebService"
  xmlns:arr="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
  <soapenv:Header/>
  <soapenv:Body>
    ${body}
  </soapenv:Body>
</soapenv:Envelope>`;
}

async function soapCall(serviceUrl, soapAction, xmlBody) {
  const envelope = soapEnvelope(soapAction, xmlBody);
  console.log('[SOAP XML]', envelope);
  try {
    const response = await axios.post(serviceUrl, envelope, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction':   `http://tempuri.org/IPostBoxService/${soapAction}`,
      },
      timeout: 30000,
    });
    return parser.parse(response.data);
  } catch (err) {
    throw err;
  }
}

function getBody(parsed) {
  // Navigate through Envelope > Body regardless of namespace prefix stripping
  return parsed?.Envelope?.Body || parsed?.['s:Envelope']?.['s:Body'] || {};
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function login(creds, tenantId) {
  const now    = Date.now();
  const cached = sessionCache.get(tenantId);
  if (cached && cached.expiresAt > now) return cached.sessionID;

  const xml = `<tem:Login>
    <tem:login>
      <efat:appStr>InokasKumanda</efat:appStr>
      <efat:passWord>${escapeXml(creds.password)}</efat:passWord>
      <efat:source>ES</efat:source>
      <efat:userName>${escapeXml(creds.username)}</efat:userName>
      <efat:version>1.0</efat:version>
    </tem:login>
  </tem:Login>`;

  const parsed = await soapCall(creds.service_url, 'Login', xml);
  const body   = getBody(parsed);
  const resp   = body?.LoginResponse;

  const loginResult = resp?.LoginResult;
  const sessionID   = resp?.sessionID;

  if (!loginResult || !sessionID) {
    throw new Error('eLogo Login başarısız — geçersiz kullanıcı adı/şifre');
  }

  sessionCache.set(tenantId, { sessionID, expiresAt: now + SESSION_TTL_MS });
  console.log(`🔐 eLogo session başlatıldı: tenant ${tenantId}`);
  return sessionID;
}

// ─── Logout ───────────────────────────────────────────────────────────────────

async function logout(creds, tenantId) {
  const cached = sessionCache.get(tenantId);
  if (!cached) return;

  try {
    const xml = `<tem:Logout>
      <tem:sessionID>${cached.sessionID}</tem:sessionID>
    </tem:Logout>`;
    await soapCall(creds.service_url, 'Logout', xml);
  } catch (err) {
    console.warn(`⚠️ eLogo logout hatası: ${err.message}`);
  } finally {
    sessionCache.delete(tenantId);
    console.log(`🔓 eLogo session sonlandırıldı: tenant ${tenantId}`);
  }
}

// ─── GetDocumentList ──────────────────────────────────────────────────────────
// Returns array of { documentUuid, documentId, docInfo[] }

async function getDocumentList(creds, tenantId, { beginDate, endDate, opType, docType = 'EINVOICE' }) {
  const sessionID = await login(creds, tenantId);

  const xml = `<tem:GetDocumentList>
    <tem:sessionID>${sessionID}</tem:sessionID>
    <tem:paramList>
      <arr:string>DOCUMENTTYPE=${docType}</arr:string>
      <arr:string>BEGINDATE=${beginDate}</arr:string>
      <arr:string>ENDDATE=${endDate}</arr:string>
      <arr:string>OPTYPE=${opType}</arr:string>
      <arr:string>DATEBY=0</arr:string>
    </tem:paramList>
  </tem:GetDocumentList>`;

  try {
    const parsed = await soapCall(creds.service_url, 'GetDocumentList', xml);
    const body   = getBody(parsed);
    const resp   = body?.GetDocumentListResponse;
    const result = resp?.GetDocumentListResult;

    // resultCode: 1 = success, -1 = error, -2 = session expired
    if (result?.resultCode === -2) {
      sessionCache.delete(tenantId);
      throw new Error('SESSION_EXPIRED');
    }

    if (result?.resultCode === -1) {
      throw new Error(`eLogo GetDocumentList hatası: ${result?.resultMsg}`);
    }

    const docList = resp?.docList?.Document || [];
    return Array.isArray(docList) ? docList : [docList].filter(Boolean);

  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') {
      // Re-login and retry once
      sessionCache.delete(tenantId);
      return getDocumentList(creds, tenantId, { beginDate, endDate, opType, docType });
    }
    throw err;
  }
}

// ─── GetDocumentData ──────────────────────────────────────────────────────────
// Returns base64 zip content (same format as Logo REST UBL)

async function getDocumentData(creds, tenantId, uuid, docType = 'EINVOICE') {
  const sessionID = await login(creds, tenantId);

  // docType enum: EINVOICE=1, EARCHIVE=2, APPLICATIONRESPONSE=3
  const docTypeEnum = { EINVOICE: 'EINVOICE', EARCHIVE: 'EARCHIVE' };

  const xml = `<tem:GetDocumentData>
    <tem:sessionID>${sessionID}</tem:sessionID>
    <tem:uuid>${uuid}</tem:uuid>
    <tem:paramList>
      <arr:string>DOCUMENTTYPE=${docTypeEnum[docType] || docType}</arr:string>
      <arr:string>DATAFORMAT=UBL</arr:string>
    </tem:paramList>
  </tem:GetDocumentData>`;

  try {
    const parsed = await soapCall(creds.service_url, 'GetDocumentData', xml);
    const body   = getBody(parsed);
    const resp   = body?.GetDocumentDataResponse;
    const result = resp?.GetDocumentDataResult;

    if (result?.resultCode === -2) {
      sessionCache.delete(tenantId);
      throw new Error('SESSION_EXPIRED');
    }

    if (result?.resultCode === -1) {
      throw new Error(`eLogo GetDocumentData hatası: ${result?.resultMsg}`);
    }

    // binaryData.Value contains base64 zip
    const content = resp?.document?.binaryData?.Value;
    if (!content) { console.warn(`⚠️ eLogo: UUID ${uuid} için içerik boş`); return null; }
    return content;

  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') {
      sessionCache.delete(tenantId);
      return getDocumentData(creds, tenantId, uuid, docType);
    }
    throw err;
  }
}

// ─── GetDocumentStatus ────────────────────────────────────────────────────────

async function getDocumentStatus(creds, tenantId, uuid, docType = 'EINVOICE') {
  const sessionID = await login(creds, tenantId);

  const xml = `<tem:GetDocumentStatus>
    <tem:sessionID>${sessionID}</tem:sessionID>
    <tem:uuid>${uuid}</tem:uuid>
    <tem:paramList>
      <arr:string>DOCUMENTTYPE=${docType}</arr:string>
    </tem:paramList>
  </tem:GetDocumentStatus>`;

  try {
    const parsed = await soapCall(creds.service_url, 'GetDocumentStatus', xml);
    const body   = getBody(parsed);
    const resp   = body?.GetDocumentStatusResponse;
    const result = resp?.GetDocumentStatusResult;

    if (result?.resultCode === -2) {
      sessionCache.delete(tenantId);
      throw new Error('SESSION_EXPIRED');
    }

    const statusInfo = resp?.statusInfo;
    if (!statusInfo) return null;

    return {
      status:      statusInfo.status,
      code:        statusInfo.code,
      description: statusInfo.description,
      isCancel:    statusInfo.isCancel,
      envelopeId:  statusInfo.envelopeId,
    };

  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') {
      sessionCache.delete(tenantId);
      return getDocumentStatus(creds, tenantId, uuid, docType);
    }
    console.error(`❌ eLogo GetDocumentStatus hatası [${uuid}]:`, err.message);
    return null;
  }
}

// ─── Test connection ──────────────────────────────────────────────────────────

async function testConnection(creds) {
  // Try login and immediately logout
  const tempTenantId = `test_${Date.now()}`;
  try {
    const sessionID = await login(creds, tempTenantId);
    if (sessionID) {
      await logout(creds, tempTenantId);
      return { success: true };
    }
    return { success: false, error: 'Geçersiz yanıt' };
  } catch (err) {
    sessionCache.delete(tempTenantId);
    return { success: false, error: err.message };
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

const FULL_SYNC_START = '2026-01-01';

function getLast48Hours() {
  const d = new Date(Date.now() - 48 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clearSessionCache(tenantId) {
  sessionCache.delete(tenantId);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  login,
  logout,
  getDocumentList,
  getDocumentData,
  getDocumentStatus,
  testConnection,
  clearSessionCache,
  FULL_SYNC_START,
  getLast48Hours,
  getToday,
};