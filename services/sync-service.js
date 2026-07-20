// services/sync-service.js
'use strict';

require('dotenv').config();

const logoApi = require('../logo-api');
const { parseUblFromBase64, setProductCodeLookup } = require('./ubl-parser');
const AdmZip  = require('adm-zip');
const { createClient } = require('@supabase/supabase-js');

const db                  = require('./helpers');
const { enrichProducts } = require('./product-enricher');
const {classifyInvoice} = require("./invoice-classifier");
const {generateAndUploadPdf} =require("./pdf-service")



const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const sleep    = ms => new Promise(r => setTimeout(r, ms));

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('❌ Critical Error: Supabase URL or Key is missing from .env');
  process.exit(1);
}


async function isInitialSync(tenantId) {
  const { count } = await supabase
    .from('invoices').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  return count === 0;
}

// ─── Load tenant credentials from Vault ──────────────────────────────────────
async function loadTenantCredentials(tenantId) {
  const keys = ['logo_base_url', 'logo_api_key', 'logo_username', 'logo_password'];
  const creds = {};

  for (const key of keys) {
    const { data, error } = await supabase.rpc('get_tenant_secret', {
      p_name: `tenant_${tenantId}_${key}`,
    });
    console.log(`[vault] tenant_${tenantId}_${key}:`, data ? '✓ found' : '✗ missing', error?.message || '');
    if (error || !data) return null;
    creds[key.replace('logo_', '')] = data;
  }

  return creds;
}

// ─── Load all active tenants with Logo integration ───────────────────────────
async function loadActiveTenantsWithLogo() {
  const { data, error } = await supabase
    .from('tenant_integrations')
    .select('tenant_id, tenants(name)')
    .eq('provider', 'logo')
    .eq('is_active', true);

  if (error) throw new Error('Tenant listesi alınamadı: ' + error.message);
  return data || [];
}

// ─── Storage ──────────────────────────────────────────────────────────────────
async function uploadXmlToStorage(base64Content, uuid) {
  try {
    const zip      = new AdmZip(Buffer.from(base64Content, 'base64'));
    const xmlEntry = zip.getEntries().find(e => e.entryName.endsWith('.xml'));
    if (!xmlEntry) { console.warn(`⚠️ No XML entry in zip for ${uuid}`); return null; }

    const { error: uploadError } = await supabase.storage
      .from('invoice-xml')
      .upload(`${uuid}.xml`, xmlEntry.getData(), { contentType: 'application/xml', upsert: true });

    if (uploadError) { console.warn(`⚠️ XML upload failed for ${uuid}:`, uploadError.message); return null; }

    const { data: urlData } = await supabase.storage
      .from('invoice-xml')
      .createSignedUrl(`${uuid}.xml`, 60 * 60 * 24 * 365 * 10);

    return urlData?.signedUrl || null;
  } catch (err) {
    console.warn(`⚠️ uploadXmlToStorage error for ${uuid}:`, err.message);
    return null;
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function loadProductCodes(tenantId) {
  const { data } = await supabase.from('products').select('product_code').eq('tenant_id', tenantId);
  if (data) setProductCodeLookup(data.map(p => p.product_code));
  console.log(`📦 Loaded ${data?.length || 0} product codes for tenant ${tenantId}`);
}

async function upsertCompany(companyData, tenantId) {
  const { data, error } = await supabase
    .from('companies')
    .upsert({ ...companyData, tenant_id: tenantId }, { onConflict: 'tenant_id,vkn_tckn' })
    .select().single();
  if (error) throw new Error(`Company sync failed: ${error.message}`);
  return data;
}


// ─── Signature — raw fields only, so re-syncs of unchanged invoices match ─────
function buildInvoiceSignature(invoiceFields, items) {
    const inv = [
        invoiceFields.invoice_no,
        invoiceFields.invoice_date,
        Number(invoiceFields.payable_amount_cur || 0).toFixed(2),
        Number(invoiceFields.payable_amount_tl  || 0).toFixed(2),
    ].join('|');

    const itemSig = (items || [])
        .map(it => `${(it.product_name || '').trim()}~${Number(it.total_price_cur || 0).toFixed(2)}`)
        .sort()
        .join('||');

    return `${inv}##${itemSig}`;
}

async function upsertInvoice(invoiceData, tenantId) {
  const { data, error } = await supabase
    .from('invoices')
    .upsert({ ...invoiceData, tenant_id: tenantId }, { onConflict: 'tenant_id,efatura_uuid' })
    .select().single();
  if (error) throw new Error(`Invoice sync failed: ${error.message}`);
  return data;
}

// first (reprocess safety). No .select(), nothing mutated afterward.
async function insertItems(rows, invoiceId) {
    await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId);
    if (!rows.length) return;

    const { error } = await supabase.from('invoice_items').insert(
        rows.map(r => ({ ...r, invoice_id: invoiceId }))
    );
    if (error) throw new Error(`Items insert failed (${invoiceId}): ${error.message}`);
}

async function reverseInvoiceStock(invoiceId, viewKey, tenantId) {
    const { data: oldItems } = await supabase
        .from('invoice_items')
        .select('product_id, quantity')
        .eq('invoice_id', invoiceId);

    for (const it of (oldItems || [])) {
        if (!it.product_id || !it.quantity) continue;
        await db.bumpStock(it.product_id, -Number(it.quantity), viewKey, tenantId);
    }
}

async function processInvoicePipeline(dbInvoice, parsedItems, viewKey, tenantId, opts = {}) {

    // ── 1) classify (whole invoice, one call) ────────────────────────────────
    // general-family vocab, split by type, fed back for wording consistency
    const knownInternal    = await db.getKnownCategories('internal', tenantId);
    const knownNonInternal = await db.getKnownCategories('non_internal', tenantId);
    const classification   = await classifyInvoice(parsedItems, knownInternal, knownNonInternal);

    // classification.items is index-aligned with parsedItems.
    // Collect each item's GENERAL family into vocab and stash its parent id
    // (needed later when we store the SPECIFIC subcategory under it).
    for (const it of classification.items) {
        const isInternal = it.item_is_internal;
        it._is_internal  = isInternal;
        it._category_id  = it.item_category
            ? await db.addCategory(isInternal ? 'internal' : 'non_internal', it.item_category, tenantId)
            : null;
    }

    // ── 2) enrich INTERNAL items (in memory — writes nothing) ────────────────
    const enriched = await enrichProducts(
        classification.items,
        {
            findProductByCode:  (code)        => db.findProductByCode(code, tenantId),
            upsertProduct:      (item)        => db.upsertProduct(item, tenantId),
            getKnownCategories: ()            => db.getKnownSubcategories(tenantId), // specific vocab for enricher
            isTrustedDomain:    (url, brand)  => db.isTrustedDomain(url, brand, tenantId),
            recordBrandDomain:  (brand, urls) => db.recordBrandDomain(brand, urls, tenantId),
        },
        viewKey
    );

    // ── 3) per internal line: upsert product, resolve product_id, collect subcat
    //     (enriched is index-aligned with classification.items / parsedItems)
    const productIdByIndex = new Array(parsedItems.length).fill(null);
    let anyReview = false;

    for (let i = 0; i < enriched.length; i++) {
        const e   = enriched[i];
        const src = classification.items[i];

        // NON_INTERNAL lines never get a product — product_id stays null
        if (!src._is_internal || e.skip_reason === 'NON_INTERNAL') continue;

        if (e.needs_review) anyReview = true;

        const code = e.product_code;
        if (!code) { anyReview = true; continue; }   // couldn't resolve an MPN

        // freeze-on-first-write; returns the product row (existing or new)
        const product = await db.upsertProduct(e, tenantId);
        if (product?.id) {
            productIdByIndex[i] = product.id;

            // store the SPECIFIC subcategory under its parent GENERAL family
            if (e.item_subcategory && src._category_id) {
                await db.addSubcategory(e.item_subcategory, src._category_id, tenantId);
            }
        } else {
            anyReview = true;   // product write didn't yield an id
        }
    }

    // ── 4) build final item rows — RAW fields + product_id + classification ──
    //     Descriptive fields come straight from the parsed XML, never enriched.
    const rows = parsedItems.map((raw, i) => {
        const cls = classification.items[i] || {};
        return {
            // official record (as parsed)
            product_name:      raw.product_name,
            product_code:      raw.product_code || null,      // raw code, archival
            brand_name:        raw.brand_name || null,
            manufacturer_code: raw.manufacturer_code || null,
            line_id:           raw.line_id ?? null,
            line_note:         raw.line_note ?? null,
            unit_code:         raw.unit_code,
            quantity:          raw.quantity,
            unit_price_cur:    raw.unit_price_cur,
            total_price_cur:   raw.total_price_cur,
            tax_rate:          raw.tax_rate,
            currency:          raw.currency,
            // link + classification
            product_id:        productIdByIndex[i],
            item_category:     cls.item_category    ?? null,   // general family
            item_subcategory:  cls.item_subcategory ?? null,   // specific (enriched, if any)
            is_internal:       cls._is_internal === true,
        };
    });

    // ── 5) single insert (delete-first for reprocess safety) ─────────────────
    await insertItems(rows, dbInvoice.id);

    // ── 6) stock — keyed on product_code, only for linked (internal) lines ───
    if (!opts.skipStock) {
        for (let i = 0; i < rows.length; i++) {
            const pid = productIdByIndex[i];
            const code = rows[i].product_code;
            const qty = Number(rows[i].quantity) || 0;
            if (pid && code && qty) await db.bumpStock(code, qty, viewKey, tenantId);
        }
    }

    // ── 7) invoice category + approval (trusted → approved, else pending) ────
    await supabase.from('invoices')
        .update({
            invoice_category: classification.invoice_category,
            approval_status:  anyReview ? 'pending' : 'approved',
        })
        .eq('id', dbInvoice.id);

    console.log(`   → ${classification.invoice_category} | onay: ${anyReview ? 'pending' : 'approved'}`);
}


// ─── Gelen sync ───────────────────────────────────────────────────────────────
// ─── Gelen sync — signature skip + inline pipeline ────────────────────────────
async function syncGelenInvoices(startDate, tenantId, creds) {
    console.log(`\n🚀 [${tenantId}] Starting Gelen Invoice Sync...`);

    const viewKey = 'gelen';
    let page = 1, hasMore = true;
    let nNew = 0, nReprocessed = 0, nSkipped = 0;

    while (hasMore) {
        console.log(`\n--- 📂 Fetching Gelen Page ${page} ---`);
        const invoices = await logoApi.getGelenInvoiceList(page, 100, startDate, creds, tenantId);
        console.log(`--- 📂 Got ${invoices.length} invoices ---`);
        if (!invoices?.length) { hasMore = false; break; }

        for (const inv of invoices) {
            try {
                const uuid = inv.uuId;
                if (!uuid) { console.warn(`⚠️ Skipping ${inv.invoiceId || 'Unknown'}: No UUID.`); continue; }

                // Existing? Pull the fields the signature needs.
                const { data: existing } = await supabase
                    .from('invoices')
                    .select('id, xml_url, invoice_no, invoice_date, payable_amount_cur, payable_amount_tl')
                    .eq('tenant_id', tenantId)
                    .eq('efatura_uuid', uuid)
                    .maybeSingle();

                // Must fetch + parse to know the new state.
                const base64Content = await logoApi.getInvoiceUBL(uuid, creds, tenantId);
                if (!base64Content) { console.warn(`⚠️ Skipping ${inv.invoiceId}: No UBL content.`); continue; }

                const parsed = parseUblFromBase64(base64Content, viewKey);
                if (!parsed) { console.warn(`⚠️ Skipping ${inv.invoiceId}: Parse failed.`); continue; }

                const { company: companyData, invoice: invoiceData, items } = parsed;
                const parsedSig = buildInvoiceSignature(invoiceData, items);

                // ── Path 1 & 2: exists ──────────────────────────────────────
                if (existing) {
                    const { data: existingItems } = await supabase
                        .from('invoice_items')
                        .select('product_name, total_price_cur')
                        .eq('invoice_id', existing.id);

                    const existingSig = buildInvoiceSignature(existing, existingItems || []);

                    // Path 1 — unchanged: skip (backfill xml_url only if missing)
                    if (existingSig === parsedSig) {
                        if (!existing.xml_url) {
                            const xmlUrl = await uploadXmlToStorage(base64Content, uuid);
                            if (xmlUrl) await supabase.from('invoices').update({ xml_url: xmlUrl }).eq('id', existing.id);

                            if(!existing.pdf_url){
                                // Arka planda PDF üret (response'u bekletmez)
                                const savedId = existing.id;
                                if (savedId && xmlUrl) {
                                  generateAndUploadPdf(supabase, savedId, xmlUrl)
                                    .catch(e => console.error('[pdf-service] arka plan hatası:', e.message));
                                }
                            }
                        }

                        nSkipped++;
                        console.log(`⏩ ${inv.invoiceId}: unchanged, skipped.`);
                        continue;
                    }

                    // Path 2 — changed: reverse old stock, re-upsert, reprocess
                    console.log(`♻️  ${inv.invoiceId}: changed, reprocessing.`);
                    await reverseInvoiceStock(existing.id, viewKey, tenantId);

                    const xmlUrl  = await uploadXmlToStorage(base64Content, uuid);

                    // Arka planda PDF üret (response'u bekletmez)
                    let pdfUrl='';
                    const savedId = existing.id;
                    if (savedId && xmlUrl) {
                      pdfUrl=generateAndUploadPdf(supabase, savedId, xmlUrl)
                        .catch(e => console.error('[pdf-service] arka plan hatası:', e.message));
                    }

                    const company = await upsertCompany(companyData, tenantId);
                    const dbInvoice = await upsertInvoice({
                        ...invoiceData,
                        company_id: company.id,
                        source: 'api',
                        xml_url: xmlUrl,
                        pdf_url: pdfUrl,
                        gib_status_code: inv.statusCode ?? null,
                        gib_status_description: inv.status || null,
                    }, tenantId);

                    await processInvoicePipeline(dbInvoice, items, viewKey, tenantId,{ skipStock: false });

                    nReprocessed++;
                    await sleep(400);
                    continue;
                }

                // ── Path 3: new ─────────────────────────────────────────────
                const xmlUrl  = await uploadXmlToStorage(base64Content, uuid);
                // Arka planda PDF üret (response'u bekletmez)

                const company = await upsertCompany(companyData, tenantId);
                const dbInvoice = await upsertInvoice({
                    ...invoiceData,
                    company_id: company.id,
                    source: 'api',
                    xml_url: xmlUrl,
                    gib_status_code: inv.statusCode ?? null,
                    gib_status_description: inv.status || null,
                }, tenantId);

                const savedId = dbInvoice.id;
                if (savedId && xmlUrl) {
                  generateAndUploadPdf(supabase, savedId, xmlUrl)
                    .catch(e => console.error('[pdf-service] arka plan hatası:', e.message));
                }

                await processInvoicePipeline(dbInvoice, items, viewKey, tenantId,{ skipStock: false });
                nNew++;
                console.log(`✅ ${inv.invoiceId} synced.`);
                await sleep(400);

            } catch (err) {
                console.error(`❌ Error processing ${inv.invoiceId}:`, err.message);
            }
        }

        if (invoices.length < 100) { hasMore = false; break; }
        page++;
        await sleep(400);
    }

    console.log(`\n✨ Gelen sync finished. New: ${nNew}, reprocessed: ${nReprocessed}, skipped: ${nSkipped}`);
}

// ─── Giden sync ───────────────────────────────────────────────────────────────
async function syncGidenInvoices(startDate, tenantId, creds) {
  console.log(`\n🚀 [${tenantId}] Starting Giden Invoice Sync...`);

  let page = 1, hasMore = true, totalSynced = 0;

  while (hasMore) {
    console.log(`\n--- 📂 Fetching Giden Page ${page} ---`);
    const invoices = await logoApi.getGidenInvoiceList(page, 100, startDate, creds, tenantId);
    console.log(`--- 📂 Got ${invoices.length} invoices ---`);
    if (!invoices?.length) { hasMore = false; break; }

    for (const inv of invoices) {
      try {
        // tenant-scoped exists check (invoice_no is per-tenant unique now)
        const { data: exists } = await supabase
          .from('invoices')
          .select('id, xml_url')
          .eq('invoice_no', inv.invoiceNumber)
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (exists) {
          if (!exists.xml_url) {
            const base64Content = await logoApi.getGidenInvoiceUBL(inv.id, creds, tenantId);
            if (base64Content) {
              const parsed = parseUblFromBase64(base64Content, 'giden');
              const xmlUrl = await uploadXmlToStorage(base64Content, parsed?.invoice?.efatura_uuid || inv.id);
              if (xmlUrl) await supabase.from('invoices').update({ xml_url: xmlUrl }).eq('id', exists.id);
            }
          } else {
            console.log(`⏩ Skipping ${inv.invoiceNumber}: Already in DB.`);
          }
          continue;
        }

        const base64Content = await logoApi.getGidenInvoiceUBL(inv.id, creds, tenantId);
        if (!base64Content) { console.warn(`⚠️ Skipping ${inv.id}: No UBL content.`); continue; }

        const parsed = parseUblFromBase64(base64Content, 'giden');
        if (!parsed) { console.warn(`⚠️ Skipping ${inv.id}: Parse failed.`); continue; }

        const { company: companyData, invoice: invoiceData, items } = parsed;
        const xmlUrl    = await uploadXmlToStorage(base64Content, invoiceData.efatura_uuid || inv.id);
        const company   = await upsertCompany(companyData, tenantId);
        const dbInvoice = await upsertInvoice({
          ...invoiceData,
          company_id: company.id, approval_status: 'pending', source: 'api',
          xml_url: xmlUrl, gib_status_code: inv.eStatus ?? null,
          gib_status_description: inv.eStatusDescription || null, e_reply_status: inv.eReplyDescription || null,
        }, tenantId);

        // same pipeline as gelen — classify → enrich → products → stock,
        // but viewKey 'giden' makes stock SUBTRACT (may go negative — allowed).
        await processInvoicePipeline(dbInvoice, items, 'giden', tenantId,{ skipStock: false });

        totalSynced++;
        console.log(`✅ [Giden] ${inv.invoiceNumber} synced.`);
        await sleep(400);
      } catch (err) {
        console.error(`❌ Error processing ${inv.invoiceNumber || inv.id}:`, err.message);
      }
    }

    if (invoices.length < 100) { hasMore = false; break; }
    page++;
    await sleep(1000);
  }

  console.log(`\n✨ Giden sync finished. Total synced: ${totalSynced}`);
}








// ─── Daily re-check ───────────────────────────────────────────────────────────
/*async function recheckPendingGelenInvoices(tenantId, creds) {
  console.log(`\n🔄 [${tenantId}] Re-checking pending Gelen invoices...`);
  const { data: pendingInvoices, error } = await supabase
    .from('invoices').select('id, invoice_no, efatura_uuid, gib_status_code')
    .eq('tenant_id', tenantId).eq('direction', 'INCOMING').eq('source', 'api').eq('approval_status', 'pending');
  if (error) { console.error('❌ Failed to fetch pending invoices:', error.message); return; }
  if (!pendingInvoices?.length) { console.log('✅ No pending Gelen invoices to re-check.'); return; }

  for (const inv of pendingInvoices) {
    try {
      const status = await logoApi.getGelenInvoiceStatus(inv.efatura_uuid, creds, tenantId);
      if (!status) continue;
      const updates = { gib_status_code: status.statusCode, gib_status_description: status.status };
      if (status.statusCode === 1)  { updates.approval_status = 'approved'; console.log(`✅ ${inv.invoice_no}: Approved.`); }
      else if (status.rejectNot)    { updates.approval_status = 'rejected'; console.log(`❌ ${inv.invoice_no}: Rejected.`); }
      else                          { console.log(`⏳ ${inv.invoice_no}: Still pending.`); }
      await supabase.from('invoices').update(updates).eq('id', inv.id);
      await sleep(300);
    } catch (err) { console.error(`❌ Re-check error for ${inv.invoice_no}:`, err.message); }
  }
  console.log('✨ Gelen re-check finished.');
}*/

/*async function recheckGidenReplyStatus(tenantId, creds) {
  console.log(`\n🔄 [${tenantId}] Re-checking Giden reply statuses...`);
  const { data: waitingInvoices, error } = await supabase
    .from('invoices').select('id, invoice_no')
    .eq('tenant_id', tenantId).eq('direction', 'OUTGOING').eq('source', 'api').eq('e_reply_status', 'WAITING FOR RESPONSE');
  if (error) { console.error('❌ Failed to fetch Giden invoices:', error.message); return; }
  if (!waitingInvoices?.length) { console.log('✅ No Giden invoices waiting for reply.'); return; }

  for (const inv of waitingInvoices) {
    try {
      const status = await logoApi.getGidenInvoiceStatus(inv.invoice_no, creds, tenantId);
      if (!status) continue;
      const updates = { gib_status_code: status.eStatus, gib_status_description: status.eStatusDescription, e_reply_status: status.eReplyDescription || null };
      if (status.isCancelled) { updates.approval_status = 'rejected'; console.log(`❌ ${inv.invoice_no}: Cancelled.`); }
      else { console.log(`📬 ${inv.invoice_no}: ${status.eReplyDescription}`); }
      await supabase.from('invoices').update(updates).eq('id', inv.id);
      await sleep(300);
    } catch (err) { console.error(`❌ Re-check error for ${inv.invoice_no}:`, err.message); }
  }
  console.log('✨ Giden reply re-check finished.');
}*/

// ─── Main entry points — loop through ALL tenants ─────────────────────────────
async function runSync() {
  const tenants = await loadActiveTenantsWithLogo();
  if (!tenants.length) { console.log('ℹ️ No active tenants with Logo integration.'); return; }

  for (const row of tenants) {
    const tenantId   = row.tenant_id;
    const tenantName = row.tenants?.name || tenantId;

    console.log(`\n🏢 Syncing tenant: ${tenantName}`);

    const creds = await loadTenantCredentials(tenantId);
    if (!creds) { console.warn(`⚠️ Tenant "${tenantName}" has no Logo credentials in Vault — skipping sync.`); continue; }

    try {
      const initial = await isInitialSync(tenantId);
      const startDate = initial ? logoApi.FULL_SYNC_START : logoApi.getLast48Hours();
      if (initial) console.log(`🌱 Initial sync for ${tenantName} — fetching from ${startDate}`);
      else         console.log(`⚡ Incremental sync for ${tenantName} — last 48 hours`);

      await syncGelenInvoices(startDate, tenantId, creds);
      await syncGidenInvoices(startDate, tenantId, creds);
    } catch (err) {
      console.error(`❌ Sync failed for tenant "${tenantName}":`, err.message);
    }
  }
}

async function runDailyRecheck() {
  const tenants = await loadActiveTenantsWithLogo();
  if (!tenants.length) { console.log('ℹ️ No active tenants with Logo integration.'); return; }

  for (const row of tenants) {
    const tenantId   = row.tenant_id;
    const tenantName = row.tenants?.name || tenantId;

    const creds = await loadTenantCredentials(tenantId);
    if (!creds) { console.warn(`⚠️ Tenant "${tenantName}" has no Logo credentials — skipping recheck.`); continue; }

    try {
      //await recheckPendingGelenInvoices(tenantId, creds);
      //await recheckGidenReplyStatus(tenantId, creds);
    } catch (err) {
      console.error(`❌ Recheck failed for tenant "${tenantName}":`, err.message);
    }
  }
}

module.exports = {
  runSync,
  runDailyRecheck,
  upsertInvoice,
  insertItems,
  upsertCompany,
  processInvoicePipeline,
};