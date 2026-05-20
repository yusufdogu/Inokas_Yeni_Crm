require('dotenv').config();

const logoApi = require('./logo-api');
const { parseUblFromBase64, setProductCodeLookup } = require('./ubl-parser');
const AdmZip  = require('adm-zip');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const sleep    = (ms) => new Promise(r => setTimeout(r, ms));

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('❌ Critical Error: Supabase URL or Key is missing from .env');
    process.exit(1);
}

// ─── Tenant ID — loaded once at startup ──────────────────────────────────────
let INOKAS_TENANT_ID = null;

async function loadTenantId() {
    if (INOKAS_TENANT_ID) return INOKAS_TENANT_ID;
    const { data, error } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', 'inokas')
        .single();
    if (error || !data) throw new Error('❌ İnokas tenant bulunamadı: ' + (error?.message || 'unknown'));
    INOKAS_TENANT_ID = data.id;
    console.log(`🏢 Tenant ID yüklendi: ${INOKAS_TENANT_ID}`);
    return INOKAS_TENANT_ID;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function uploadXmlToStorage(base64Content, uuid) {
    try {
        const zip      = new AdmZip(Buffer.from(base64Content, 'base64'));
        const xmlEntry = zip.getEntries().find(e => e.entryName.endsWith('.xml'));
        if (!xmlEntry) { console.warn(`⚠️ No XML entry in zip for ${uuid}`); return null; }

        const xmlBuffer = xmlEntry.getData();
        const fileName  = `${uuid}.xml`;

        const { error: uploadError } = await supabase.storage
            .from('invoice-xml')
            .upload(fileName, xmlBuffer, { contentType: 'application/xml', upsert: true });

        if (uploadError) { console.warn(`⚠️ XML upload failed for ${uuid}:`, uploadError.message); return null; }

        const { data: urlData } = await supabase.storage
            .from('invoice-xml')
            .createSignedUrl(fileName, 60 * 60 * 24 * 365 * 10); // 10 years

        return urlData?.signedUrl || null;
    } catch (err) {
        console.warn(`⚠️ uploadXmlToStorage error for ${uuid}:`, err.message);
        return null;
    }
}

async function loadProductCodes(tenantId) {
    const { data } = await supabase.from('products').select('product_code').eq('tenant_id', tenantId);
    if (data) setProductCodeLookup(data.map(p => p.product_code));
    console.log(`📦 Loaded ${data?.length || 0} product codes for SKU matching`);
}

async function upsertCompany(companyData, tenantId) {
    const { data, error } = await supabase
        .from('companies')
        .upsert({ ...companyData, tenant_id: tenantId }, { onConflict: 'vkn_tckn' })
        .select().single();
    if (error) throw new Error(`Company sync failed: ${error.message}`);
    return data;
}

async function upsertInvoice(invoiceData, tenantId) {
    const { data, error } = await supabase
        .from('invoices')
        .upsert({ ...invoiceData, tenant_id: tenantId }, { onConflict: 'efatura_uuid' })
        .select().single();
    if (error) throw new Error(`Invoice sync failed: ${error.message}`);
    return data;
}

async function insertItems(items, invoiceId) {
    if (!items.length) return;
    await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId);
    const rows = items.map(item => ({ ...item, invoice_id: invoiceId, is_internal: false }));
    const { error } = await supabase.from('invoice_items').insert(rows);
    if (error) console.error(`❌ Items insert failed for invoice ${invoiceId}:`, error.message);
}

async function resolveProductId(item, tenantId) {
    if (!item.product_code) return null;

    const { data: existing } = await supabase
        .from('products')
        .select('id')
        .eq('product_code', item.product_code)
        .eq('tenant_id', tenantId)
        .maybeSingle();

    if (existing) return existing.id;

    const { data: created, error } = await supabase
        .from('products')
        .insert({
            product_code: item.product_code,
            product_name: item.product_name,
            brand:        item.brand_name || null,
            needs_review: true,
            source:       'api',
            tenant_id:    tenantId,
        })
        .select('id').single();

    if (error) {
        console.warn(`⚠️ Could not auto-create product ${item.product_code}:`, error.message);
        return null;
    }

    console.log(`🆕 Auto-created product: ${item.product_code} — ${item.product_name}`);
    return created.id;
}

async function isInitialSync(tenantId) {
    const { count } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);
    return (count === 0);
}

// ─── Gelen sync ───────────────────────────────────────────────────────────────

async function syncGelenInvoices(startDate) {
    const tenantId = await loadTenantId();
    console.log('\n🚀 Starting Gelen Invoice Sync...');
    console.log(`📅 Date range: ${startDate} → now`);
    await loadProductCodes(tenantId);

    let currentPage = 1, hasMore = true, totalSynced = 0;

    while (hasMore) {
        console.log(`\n--- 📂 Fetching Gelen Page ${currentPage} ---`);
        const invoices = await logoApi.getGelenInvoiceList(currentPage, 100, startDate);
        console.log(`--- 📂 Got ${invoices.length} invoices ---`);
        if (!invoices || invoices.length === 0) { hasMore = false; break; }

        for (const inv of invoices) {
            try {
                const uuid = inv.uuId;
                if (!uuid) { console.warn(`⚠️ Skipping ${inv.invoiceId || 'Unknown'}: No UUID.`); continue; }

                const { data: exists } = await supabase
                    .from('invoices').select('id, xml_url')
                    .eq('efatura_uuid', uuid).maybeSingle();

                if (exists) {
                    if (!exists.xml_url) {
                        console.log(`📎 ${inv.invoiceId}: In DB but missing XML, uploading...`);
                        const base64Content = await logoApi.getInvoiceUBL(uuid);
                        if (base64Content) {
                            const xmlUrl = await uploadXmlToStorage(base64Content, uuid);
                            if (xmlUrl) await supabase.from('invoices').update({ xml_url: xmlUrl }).eq('id', exists.id);
                        }
                    } else {
                        console.log(`⏩ Skipping ${inv.invoiceId}: Already in DB.`);
                    }
                    continue;
                }

                const base64Content = await logoApi.getInvoiceUBL(uuid);
                if (!base64Content) { console.warn(`⚠️ Skipping ${inv.invoiceId}: No UBL content.`); continue; }

                const xmlUrl = await uploadXmlToStorage(base64Content, uuid);
                const parsed = parseUblFromBase64(base64Content, 'gelen');
                if (!parsed) { console.warn(`⚠️ Skipping ${inv.invoiceId}: Parse failed.`); continue; }

                const { company: companyData, invoice: invoiceData, items } = parsed;

                const company   = await upsertCompany(companyData, tenantId);
                const dbInvoice = await upsertInvoice({
                    ...invoiceData,
                    company_id:              company.id,
                    approval_status:         'pending',
                    source:                  'api',
                    xml_url:                 xmlUrl,
                    gib_status_code:         inv.statusCode ?? null,
                    gib_status_description:  inv.status || null,
                }, tenantId);

                const resolvedItems = await Promise.all(
                    items.map(async item => ({
                        ...item,
                        product_id: await resolveProductId(item, tenantId),
                    }))
                );
                await insertItems(resolvedItems, dbInvoice.id);

                totalSynced++;
                console.log(`✅ ${inv.invoiceId} synced (status: ${inv.status || 'unknown'}).`);
                await sleep(400);

            } catch (err) {
                console.error(`❌ Error processing ${inv.invoiceId}:`, err.message);
            }
        }

        if (invoices.length < 100) { hasMore = false; break; }
        currentPage++;
        await sleep(400);
    }

    console.log(`\n✨ Gelen sync finished. Total synced: ${totalSynced}`);
}

// ─── Giden sync ───────────────────────────────────────────────────────────────

async function syncGidenInvoices(startDate) {
    const tenantId = await loadTenantId();
    console.log('\n🚀 Starting Giden Invoice Sync...');
    console.log(`📅 Date range: ${startDate} → now`);
    await loadProductCodes(tenantId);

    let currentPage = 1, hasMore = true, totalSynced = 0;

    while (hasMore) {
        console.log(`\n--- 📂 Fetching Giden Page ${currentPage} ---`);
        const invoices = await logoApi.getGidenInvoiceList(currentPage, 100, startDate);
        console.log(`--- 📂 Got ${invoices.length} invoices ---`);
        if (!invoices || invoices.length === 0) { hasMore = false; break; }

        for (const inv of invoices) {
            try {
                const { data: exists } = await supabase
                    .from('invoices').select('id, xml_url')
                    .eq('invoice_no', inv.invoiceNumber).maybeSingle();

                if (exists) {
                    if (!exists.xml_url) {
                        console.log(`📎 ${inv.invoiceNumber}: In DB but missing XML, uploading...`);
                        const base64Content = await logoApi.getGidenInvoiceUBL(inv.id);
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

                const base64Content = await logoApi.getGidenInvoiceUBL(inv.id);
                if (!base64Content) { console.warn(`⚠️ Skipping ${inv.id}: No UBL content.`); continue; }

                const parsed = parseUblFromBase64(base64Content, 'giden');
                if (!parsed) { console.warn(`⚠️ Skipping ${inv.id}: Parse failed.`); continue; }

                const { company: companyData, invoice: invoiceData, items } = parsed;
                const xmlUrl = await uploadXmlToStorage(base64Content, invoiceData.efatura_uuid || inv.id);

                const company   = await upsertCompany(companyData, tenantId);
                const dbInvoice = await upsertInvoice({
                    ...invoiceData,
                    company_id:              company.id,
                    approval_status:         'pending',
                    source:                  'api',
                    xml_url:                 xmlUrl,
                    gib_status_code:         inv.eStatus ?? null,
                    gib_status_description:  inv.eStatusDescription || null,
                    e_reply_status:          inv.eReplyDescription || null,
                }, tenantId);

                const resolvedItems = await Promise.all(
                    items.map(async item => ({
                        ...item,
                        product_id: await resolveProductId(item, tenantId),
                    }))
                );
                await insertItems(resolvedItems, dbInvoice.id);

                totalSynced++;
                console.log(`✅ [Giden] ${inv.invoiceNumber} synced (eStatus: ${inv.eStatus} — ${inv.eStatusDescription}).`);
                await sleep(400);

            } catch (err) {
                console.error(`❌ Error processing ${inv.invoiceNumber || inv.id}:`, err.message);
            }
        }

        if (invoices.length < 100) { hasMore = false; break; }
        currentPage++;
        await sleep(1000);
    }

    console.log(`\n✨ Giden sync finished. Total synced: ${totalSynced}`);
}

// ─── Daily re-check: gelen pending ───────────────────────────────────────────

async function recheckPendingGelenInvoices() {
    const tenantId = await loadTenantId();
    console.log('\n🔄 Re-checking pending Gelen invoices...');

    const { data: pendingInvoices, error } = await supabase
        .from('invoices')
        .select('id, invoice_no, efatura_uuid, gib_status_code')
        .eq('tenant_id', tenantId)
        .eq('direction', 'INCOMING')
        .eq('source', 'api')
        .eq('approval_status', 'pending');

    if (error) { console.error('❌ Failed to fetch pending invoices:', error.message); return; }
    if (!pendingInvoices?.length) { console.log('✅ No pending Gelen invoices to re-check.'); return; }

    console.log(`📋 Found ${pendingInvoices.length} pending Gelen invoices to re-check.`);

    for (const inv of pendingInvoices) {
        try {
            const status = await logoApi.getGelenInvoiceStatus(inv.efatura_uuid);
            if (!status) { console.warn(`⚠️ Could not fetch status for ${inv.invoice_no}`); continue; }

            const updates = {
                gib_status_code:        status.statusCode,
                gib_status_description: status.status,
            };

            if (status.statusCode === 1) {
                updates.approval_status = 'approved';
                console.log(`✅ ${inv.invoice_no}: Now accepted — marking approved.`);
            } else if (status.rejectNot) {
                updates.approval_status = 'rejected';
                console.log(`❌ ${inv.invoice_no}: Rejected — ${status.rejectNot}`);
            } else {
                console.log(`⏳ ${inv.invoice_no}: Still pending (statusCode: ${status.statusCode}).`);
            }

            await supabase.from('invoices').update(updates).eq('id', inv.id);
            await sleep(300);

        } catch (err) {
            console.error(`❌ Re-check error for ${inv.invoice_no}:`, err.message);
        }
    }

    console.log('✨ Gelen re-check finished.');
}

// ─── Daily re-check: giden reply status ──────────────────────────────────────

async function recheckGidenReplyStatus() {
    const tenantId = await loadTenantId();
    console.log('\n🔄 Re-checking Giden invoice reply statuses...');

    const { data: waitingInvoices, error } = await supabase
        .from('invoices')
        .select('id, invoice_no')
        .eq('tenant_id', tenantId)
        .eq('direction', 'OUTGOING')
        .eq('source', 'api')
        .eq('e_reply_status', 'WAITING FOR RESPONSE');

    if (error) { console.error('❌ Failed to fetch Giden invoices:', error.message); return; }
    if (!waitingInvoices?.length) { console.log('✅ No Giden invoices waiting for reply.'); return; }

    console.log(`📋 Found ${waitingInvoices.length} Giden invoices waiting for buyer reply.`);

    for (const inv of waitingInvoices) {
        try {
            const status = await logoApi.getGidenInvoiceStatus(inv.invoice_no);
            if (!status) { console.warn(`⚠️ Could not fetch status for ${inv.invoice_no}`); continue; }

            const updates = {
                gib_status_code:        status.eStatus,
                gib_status_description: status.eStatusDescription,
                e_reply_status:         status.eReplyDescription || null,
            };

            if (status.isCancelled) {
                updates.approval_status = 'rejected';
                console.log(`❌ ${inv.invoice_no}: Cancelled.`);
            } else if (status.eReplyDescription !== 'WAITING FOR RESPONSE') {
                console.log(`📬 ${inv.invoice_no}: Reply received — ${status.eReplyDescription}`);
            } else {
                console.log(`⏳ ${inv.invoice_no}: Still waiting for buyer reply.`);
            }

            await supabase.from('invoices').update(updates).eq('id', inv.id);
            await sleep(300);

        } catch (err) {
            console.error(`❌ Re-check error for ${inv.invoice_no}:`, err.message);
        }
    }

    console.log('✨ Giden reply re-check finished.');
}

// ─── Main entry points ────────────────────────────────────────────────────────

async function runSync() {
    const tenantId = await loadTenantId();
    const initial  = await isInitialSync(tenantId);

    if (initial) {
        console.log('🌱 Initial sync detected — fetching all invoices from 2020...');
        await syncGelenInvoices(logoApi.FULL_SYNC_START);
        await syncGidenInvoices(logoApi.FULL_SYNC_START);
    } else {
        console.log('⚡ Incremental sync — fetching last 48 hours...');
        await syncGelenInvoices(logoApi.getLast48Hours());
        await syncGidenInvoices(logoApi.getLast48Hours());
    }
}

async function runDailyRecheck() {
    await recheckPendingGelenInvoices();
    await recheckGidenReplyStatus();
}

module.exports = {
    runSync,
    runDailyRecheck,
    syncGelenInvoices,
    syncGidenInvoices,
    recheckPendingGelenInvoices,
    recheckGidenReplyStatus,
};