// logo-api.js
// All functions now accept a `creds` object instead of reading from .env
// creds: { base_url, api_key, username, password }
'use strict';

const axios = require('axios');

// ─── Auth cache — keyed by tenant_id ─────────────────────────────────────────
const authCacheMap = new Map();
const AUTH_TTL_MS  = 23 * 60 * 60 * 1000; // 23 hours

async function login(creds, tenantId) {
  const now    = Date.now();
  const cached = authCacheMap.get(tenantId);

  if (cached && cached.expiresAt > now) return cached;

  const url = `${creds.base_url}/api/v1.0/user/integrationLogin`;

  const response = await axios.post(url, {
    username: creds.username,
    password: creds.password,
  }, {
    headers: { 'ApiKey': creds.api_key, 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  const data = response.data.data;

  const entry = {
    accessToken: data.accessToken,
    logoTenantId: data.tenantId,
    userId:      data.userId,
    baseUrl:     data.baseUrl || creds.base_url,
    expiresAt:   now + AUTH_TTL_MS,
  };

  authCacheMap.set(tenantId, entry);
  console.log(`🔐 Logo auth token refreshed for tenant ${tenantId}`);
  return entry;
}

// Clear cached token for a tenant (e.g. after credential update)
function clearAuthCache(tenantId) {
  authCacheMap.delete(tenantId);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
const FULL_SYNC_START = '2026-01-01T00:00:00';

function getLast48Hours() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().substring(0, 19);
}
function getLast2Months() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().substring(0, 19);
}

function getNow() {
  return new Date().toISOString().substring(0, 19);
}

// ─── Headers helper ───────────────────────────────────────────────────────────
function makeHeaders(auth, creds) {
  return {
    'Authorization': `Bearer ${auth.accessToken}`,
    'tenantId':      auth.logoTenantId,
    'ApiKey':        creds.api_key,
    'UserId':        auth.userId,
    'UserEmail':     creds.username,
    'UserName':      creds.username,
    'Content-Type':  'application/json;charset=utf-8',
  };
}

// ─── Gelen ────────────────────────────────────────────────────────────────────

async function getGelenInvoiceList(page = 1, limit = 100, startDate = FULL_SYNC_START, creds, tenantId) {
  const auth    = await login(creds, tenantId);
  const endDate = getNow();
  try {
    const response = await axios.post(
      `${creds.base_url}/api/v1.0/einvoices/myInvoicesList`,
      {
        filters: [
          { columnName: 'issueDate', operator: 5, value: startDate },
          { columnName: 'issueDate', operator: 2, value: endDate   },
        ],
        sorting: { issueDate: -1 },
        paging:  { currentPage: page, pageSize: limit },
        count:   true,
      },
      { headers: makeHeaders(auth, creds), timeout: 30000 }
    );
    return response.data?.data?.data || [];
  } catch (err) {
    console.error(`❌ Gelen list error (page ${page}):`, err.response?.data || err.message);
    return [];
  }
}

async function getInvoiceUBL(uuId, creds, tenantId) {
  const auth = await login(creds, tenantId);
  const url  = `${creds.base_url}/api/v1.0/einvoices/DocumentUblDatawithuuid?uuid=${uuId}&type=1`;
  try {
    const response = await axios.get(url, { headers: makeHeaders(auth, creds), timeout: 30000 });
    if (!response.data?.data?.content) { console.warn(`⚠️ No content for UUID: ${uuId}`); return null; }
    return response.data.data.content;
  } catch (err) {
    console.error(`❌ Gelen UBL fetch error [${uuId}]:`, err.response?.data || err.message);
    return null;
  }
}

async function getGelenInvoiceStatus(uuid, creds, tenantId) {
  const auth = await login(creds, tenantId);
  try {
    const response = await axios.post(
      `${creds.base_url}/api/v1.0/einvoices/myInvoicesList`,
      {
        filters: [{ columnName: 'uuId', operator: 0, value: uuid }],
        paging:  { currentPage: 1, pageSize: 1 },
        count:   false,
      },
      { headers: makeHeaders(auth, creds), timeout: 15000 }
    );
    const inv = response.data?.data?.data?.[0];
    if (!inv) return null;
    return { statusCode: inv.statusCode, status: inv.status, rejectNot: inv.rejectNot || null };
  } catch (err) {
    console.error(`❌ Gelen status check error [${uuid}]:`, err.response?.data || err.message);
    return null;
  }
}

// ─── Giden ────────────────────────────────────────────────────────────────────

async function getGidenInvoiceList(page = 1, limit = 100, startDate = FULL_SYNC_START, creds, tenantId) {
  const auth    = await login(creds, tenantId);
  const endDate = getNow();
  try {
    const response = await axios.post(
      `${creds.base_url}/api/v1.0/invoices/invoices`,
      {
        filters: [
          { columnName: 'type', operator: 17, value: 'Tümü' },
          { columnName: 'date', operator: 5,  value: startDate },
          { columnName: 'date', operator: 2,  value: endDate   },
        ],
        sorting:     { date: -1 },
        paging:      { currentPage: page, pageSize: limit },
        count:       true,
        columnNames: null,
      },
      { headers: { ...makeHeaders(auth, creds), 'Content-Type': 'application/json; charset=utf-8' }, timeout: 30000 }
    );
    return response.data?.data?.data || [];
  } catch (err) {
    console.error(`❌ Giden list error:`, err.response?.data || err.message);
    return [];
  }
}

async function getGidenInvoiceUBL(invoiceId, creds, tenantId) {
  const auth = await login(creds, tenantId);
  const url  = `${creds.base_url}/api/v1.0/einvoices/DocumentUblData?invoiceId=${invoiceId}&type=1`;
  try {
    const response = await axios.get(url, { headers: makeHeaders(auth, creds), timeout: 30000 });
    return response.data?.data?.content || null;
  } catch (err) {
    console.error(`❌ Giden UBL fetch error [${invoiceId}]:`, err.response?.data?.message || err.message);
    return null;
  }
}

async function getGidenInvoiceStatus(invoiceNumber, creds, tenantId) {
  const auth = await login(creds, tenantId);
  try {
    const response = await axios.post(
      `${creds.base_url}/api/v1.0/invoices/invoices`,
      {
        filters:     [{ columnName: 'invoiceNumber', operator: 0, value: invoiceNumber }],
        paging:      { currentPage: 1, pageSize: 1 },
        count:       false,
        columnNames: null,
      },
      { headers: { ...makeHeaders(auth, creds), 'Content-Type': 'application/json; charset=utf-8' }, timeout: 15000 }
    );
    const inv = response.data?.data?.data?.[0];
    if (!inv) return null;
    return {
      eStatus:            inv.eStatus,
      eStatusDescription: inv.eStatusDescription,
      eReplyDescription:  inv.eReplyDescription,
      eReplayText:        inv.eReplayText,
      isCancelled:        inv.isCancelled,
    };
  } catch (err) {
    console.error(`❌ Giden status check error [${invoiceNumber}]:`, err.response?.data || err.message);
    return null;
  }
}

module.exports = {
  login,
  clearAuthCache,
  getGelenInvoiceList,
  getInvoiceUBL,
  getGelenInvoiceStatus,
  getGidenInvoiceList,
  getGidenInvoiceUBL,
  getGidenInvoiceStatus,
  FULL_SYNC_START,
  getLast48Hours,
  getLast2Months,
};