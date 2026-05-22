// services/elogo-sync-service.js
// Syncs invoices from eLogo SOAP API for all active eLogo tenants
'use strict';

require('dotenv').config();

const elogoApi = require('../elogo-api');
const { parseUblFromBase64, setProductCodeLookup } = require('./ubl-parser');
const AdmZip   = require('adm-zip');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// ─── Load tenant credentials from Vault ──────────────────────────────────────

async function loadTenantCredentials(tenantId, provider) {
  const keys   = ['service_url', 'username', 'password'];
  const prefix = `tenant_${tenantId}_${provider}`;
  const creds  = {};

  for (const key of keys) {
    const { data, error } = await supabase.rpc('get_tenant_secret', {
      p_name: `${prefix}_${key}`,
    });
    if (error || !data) {
      console.warn(`⚠️ Vault: ${prefix}_${key} bulunamadı`);
      return null;
    }
    creds[key] = data;
  }

  return creds; // { service_url, username, password }
}

// ─── Load all active tenants with eLogo or İşbaşı integration ────────────────

async function loadActiveElogoTenants() {
  const { data, error } = await supabase
    .from('tenant_integrations')
    .select('tenant_id, provider, tenants(name, slug)')
    .in('provider', ['elogo', 'isbasi'])
    .eq('is_active', true);

  if (error) throw new Error('eLogo tenant listesi alınamadı: ' + error.message);
  return data || [];
}

// ─── Storage ──────────────────────────────────────────────────────────────────

async function uploadXmlToStorage(base64Content, uuid) {
  try {
    const zip      = new AdmZip(Buffer.from(base64Content, 'base64'));
    const xmlEntry = zip.getEntries().find(e => e.entryName.endsWith('.xml'));
    if (!xmlEntry) { console.warn(`⚠️ ZIP içinde XML bulunamadı: ${uuid}`); return null; }

    const { error } = await supabase.storage
      .from('invoice-xml')
      .upload(`${uuid}.xml`, xmlEntry.getData(), { contentType: 'application/xml', upsert: true });

    if (error) { console.warn(`⚠️ XML upload hatası ${uuid}:`, error.message); return null; }

    const { data } = await supabase.storage
      .from('invoice-xml')
      .createSignedUrl(`${uuid}.xml`, 60 * 60 * 24 * 365 * 10);

    return data?.signedUrl || null;
  } catch (err) {
    console.warn(`⚠️ uploadXmlToStorage hatası ${uuid}:`, err.message);
    return null;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function loadProductCodes(tenantId) {
  const { data } = await supabase.from('products').select('product_code').eq('tenant_id', tenantId);
  if (data) setProductCodeLookup(data.map(p => p.product_code));
}

async function upsertCompany(companyData, tenantId) {
  const { data, error } = await supabase
    .from('companies')
    .upsert({ ...companyData, tenant_id: tenantId }, { onConflict: 'vkn_tckn' })
    .select().single();
  if (error) throw new Error(`Company sync hatası: ${error.message}`);
  return data;
}

async function upsertInvoice(invoiceData, tenantId) {
  const { data, error } = await supabase
    .from('invoices')
    .upsert({ ...invoiceData, tenant_id: tenantId }, { onConflict: 'efatura_uuid' })
    .select().single();
  if (error) throw new Error(`Invoice sync hatası: ${error.message}`);
  return data;
}

async function insertItems(items, invoiceId) {
  if (!items?.length) return;
  await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId);
  const rows = items.map(item => ({ ...item, invoice_id: invoiceId, is_internal: false }));
  const { error } = await supabase.from('invoice_items').insert(rows);
  if (error) console.error(`❌ Items insert hatası ${invoiceId}:`, error.message);
}

async function resolveProductId(item, tenantId) {
  if (!item.product_code) return null;

  const { data: existing } = await supabase
    .from('products').select('id')
    .eq('product_code', item.product_code)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('products')
    .insert({ product_code: item.product_code, product_name: item.product_name, brand: item.brand_name || null, needs_review: true, source: 'elogo', tenant_id: tenantId })
    .select('id').single();

  if (error) { console.warn(`⚠️ Ürün oluşturulamadı ${item.product_code}:`, error.message); return null; }
  return created.id;
}

async function isInitialSync(tenantId) {
  const { count } = await supabase
    .from('invoices').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  return count === 0;
}

// ─── Sync invoices for a direction ───────────────────────────────────────────

async function syncInvoices(creds, tenantId, { beginDate, endDate, opType }) {
  const direction   = opType === 2 ? 'INCOMING' : 'OUTGOING';
  const dirLabel    = direction === 'INCOMING' ? 'Gelen' : 'Giden';
  let   totalSynced = 0;

  console.log(`\n📥 [${dirLabel}] ${beginDate} → ${endDate}`);

  // Get list of invoice UUIDs
  const docList = await elogoApi.getDocumentList(creds, tenantId, {
    beginDate, endDate, opType, docType: 'EINVOICE',
  });

  console.log(`📋 ${docList.length} fatura bulundu`);

  for (const doc of docList) {
    const uuid = doc.documentUuid;
    if (!uuid) { console.warn('⚠️ UUID boş, atlanıyor'); continue; }

    try {
      // Check if already in DB
      const { data: exists } = await supabase
        .from('invoices').select('id, xml_url').eq('efatura_uuid', uuid).maybeSingle();

      if (exists) {
        if (!exists.xml_url) {
          // In DB but missing XML — upload it
          const base64 = await elogoApi.getDocumentData(creds, tenantId, uuid);
          if (base64) {
            const xmlUrl = await uploadXmlToStorage(base64, uuid);
            if (xmlUrl) await supabase.from('invoices').update({ xml_url: xmlUrl }).eq('id', exists.id);
          }
        } else {
          console.log(`⏩ Atlanıyor (zaten var): ${uuid}`);
        }
        continue;
      }

      // Fetch UBL content
      const base64 = await elogoApi.getDocumentData(creds, tenantId, uuid);
      if (!base64) { console.warn(`⚠️ İçerik alınamadı: ${uuid}`); continue; }

      // Upload XML to storage
      const xmlUrl = await uploadXmlToStorage(base64, uuid);

      // Parse UBL
      const ublDirection = direction === 'INCOMING' ? 'gelen' : 'giden';
      const parsed = parseUblFromBase64(base64, ublDirection);
      if (!parsed) { console.warn(`⚠️ Parse başarısız: ${uuid}`); continue; }

      const { company: companyData, invoice: invoiceData, items } = parsed;

      // Save to DB
      const company   = await upsertCompany(companyData, tenantId);
      const dbInvoice = await upsertInvoice({
        ...invoiceData,
        company_id:      company.id,
        approval_status: 'pending',
        source:          'elogo',
        xml_url:         xmlUrl,
      }, tenantId);

      const resolvedItems = await Promise.all(
        items.map(async item => ({ ...item, product_id: await resolveProductId(item, tenantId) }))
      );
      await insertItems(resolvedItems, dbInvoice.id);

      totalSynced++;
      console.log(`✅ ${dirLabel}: ${uuid}`);
      await sleep(300);

    } catch (err) {
      console.error(`❌ Hata [${uuid}]:`, err.message);
    }
  }

  return totalSynced;
}

// ─── Re-check pending invoices ────────────────────────────────────────────────

async function recheckPendingInvoices(creds, tenantId) {
  console.log(`\n🔄 Bekleyen faturalar yeniden kontrol ediliyor...`);

  const { data: pending, error } = await supabase
    .from('invoices').select('id, invoice_no, efatura_uuid, direction')
    .eq('tenant_id', tenantId)
    .eq('source', 'elogo')
    .eq('approval_status', 'pending');

  if (error || !pending?.length) { console.log('✅ Bekleyen fatura yok'); return; }

  for (const inv of pending) {
    try {
      const status = await elogoApi.getDocumentStatus(creds, tenantId, inv.efatura_uuid);
      if (!status) continue;

      const updates = { gib_status_code: status.code, gib_status_description: status.description };

      // status=2 → success, status=-1 → failed
      if (status.status === 2 && status.code === 1300) {
        updates.approval_status = 'approved';
        console.log(`✅ ${inv.invoice_no}: Onaylandı`);
      } else if (status.status === -1) {
        updates.approval_status = 'rejected';
        console.log(`❌ ${inv.invoice_no}: Reddedildi`);
      } else {
        console.log(`⏳ ${inv.invoice_no}: Bekliyor (status: ${status.status}, code: ${status.code})`);
      }

      await supabase.from('invoices').update(updates).eq('id', inv.id);
      await sleep(200);
    } catch (err) {
      console.error(`❌ Recheck hatası [${inv.invoice_no}]:`, err.message);
    }
  }

  console.log('✨ Recheck tamamlandı');
}

// ─── Main entry points ────────────────────────────────────────────────────────

async function runElogoSync() {
  const tenants = await loadActiveElogoTenants();
  if (!tenants.length) { console.log('ℹ️ Aktif eLogo/İşbaşı tenant bulunamadı'); return; }

  for (const row of tenants) {
    const tenantId   = row.tenant_id;
    const tenantName = row.tenants?.name || tenantId;
    const provider   = row.provider; // 'elogo' or 'isbasi'

    console.log(`\n🏢 eLogo Sync: ${tenantName} [${provider}]`);

    const creds = await loadTenantCredentials(tenantId, provider);
    if (!creds) {
      console.warn(`⚠️ "${tenantName}" için ${provider} credentials bulunamadı — atlanıyor`);
      continue;
    }

    try {
      await loadProductCodes(tenantId);

      const initial   = await isInitialSync(tenantId);
      const beginDate = initial ? elogoApi.FULL_SYNC_START : elogoApi.getLast48Hours();
      const endDate   = elogoApi.getToday();

      if (initial) console.log(`🌱 İlk sync: ${beginDate} → ${endDate}`);
      else         console.log(`⚡ Artımlı sync: ${beginDate} → ${endDate}`);

      // Sync gelen (OPTYPE=2)
      const gelenCount = await syncInvoices(creds, tenantId, { beginDate, endDate, opType: 2 });
      // Sync giden (OPTYPE=1)
      const gidenCount = await syncInvoices(creds, tenantId, { beginDate, endDate, opType: 1 });

      console.log(`✨ ${tenantName}: ${gelenCount} gelen + ${gidenCount} giden fatura eklendi`);

      // Always logout after sync to free server session
      await elogoApi.logout(creds, tenantId);

    } catch (err) {
      console.error(`❌ eLogo sync hatası "${tenantName}":`, err.message);
      elogoApi.clearSessionCache(tenantId);
    }
  }
}

async function runElogoDailyRecheck() {
  const tenants = await loadActiveElogoTenants();
  if (!tenants.length) return;

  for (const row of tenants) {
    const tenantId   = row.tenant_id;
    const tenantName = row.tenants?.name || tenantId;
    const provider   = row.provider;

    const creds = await loadTenantCredentials(tenantId, provider);
    if (!creds) { console.warn(`⚠️ "${tenantName}" credentials bulunamadı`); continue; }

    try {
      await recheckPendingInvoices(creds, tenantId);
      await elogoApi.logout(creds, tenantId);
    } catch (err) {
      console.error(`❌ eLogo recheck hatası "${tenantName}":`, err.message);
      elogoApi.clearSessionCache(tenantId);
    }
  }
}

module.exports = { runElogoSync, runElogoDailyRecheck };