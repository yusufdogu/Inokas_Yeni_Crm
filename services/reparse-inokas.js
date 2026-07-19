// reparse-inokas.js
// One-off batch: reparse İnokas pending invoices from their stored XML,
// rewrite header + items, run the pipeline (WITHOUT bumpStock — the trigger
// owns İnokas stock), then generate + upload the PDF.
//
// Usage:  node reparse-inokas.js [limit]      (default 5)
//   node reparse-inokas.js 1     → one invoice (first live test)
//   node reparse-inokas.js 20    → twenty
//
// Per invoice:
//   1. read row → xml_url
//   2. download raw XML from storage → parseUblFromXml
//   3. upsert company → company_id
//   4. update header with parsed fields, PRESERVING approval_status/xml_url/
//      pdf_url/tenant_id/source/gib_* (not present in the UBL)
//   5. delete existing items, insert freshly parsed raw items
//   6. run pipeline (classify→enrich→products→link→category) — NO bumpStock
//   7. set approval_status (trusted→approved fires trigger; else pending)
//   8. generate + upload PDF → pdf_url

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const db                  = require('./helpers');
const { enrichProducts } = require('./product-enricher');
const {classifyInvoice} = require("./invoice-classifier");
const {generateAndUploadPdf} =require("./pdf-service")
const {buildInvoicePayload,parseUblFromXml}=require("./ubl-parser")

// existing functions — reused, not rewritten.
// ADJUST these require paths to match your project layout.
const {
    upsertCompany,
    upsertInvoice,
    insertItems,
    processInvoicePipeline,
} = require('./sync-service');


const TENANT_ID = 'a58a2117-59be-4294-9fa7-6ef0ab8f0ba1'; // İnokas

// header fields that do NOT come from the UBL — must survive the reparse.
// We simply don't include them in the parsed-header update.
function toViewKey(direction) {
    return direction === 'OUTGOING' ? 'giden' : 'gelen';
}


async function reprocessInvoice(inv) {
    const viewKey = toViewKey(inv.direction);
    console.log(`\n${'━'.repeat(68)}`);
    console.log(`📄 ${inv.invoice_no}  |  ${inv.direction}  |  ${viewKey}`);
    console.log('━'.repeat(68));

    // 1) need an xml_url to reparse
    if (!inv.xml_url) {
        console.warn('   ⚠️ xml_url yok, atlanıyor.');
        return { skipped: true };
    }

    // 2) download raw XML from storage + parse
    const res = await fetch(inv.xml_url);
    if (!res.ok) throw new Error(`XML indirilemedi (${res.status})`);
    const xmlText = await res.text();

    const parsed = parseUblFromXml(xmlText, viewKey);
    if (!parsed) throw new Error('Parse başarısız.');

    const { company: companyData, invoice: invoiceData, items } = parsed;

    // 3) upsert company → id
    const company = await upsertCompany(companyData, TENANT_ID);

    // 4) update header with parsed fields, PRESERVING non-XML fields.
    //    We update the existing row in place (do NOT use upsertInvoice with
    //    approval/source/xml_url, which would overwrite them). Only parsed
    //    business fields + company link are written.
    const headerUpdate = {
        company_id:               company.id,
        invoice_date:             invoiceData.invoice_date ?? null,
        due_date:                 invoiceData.due_date ?? null,
        currency:                 invoiceData.currency ?? null,
        base_currency:            invoiceData.base_currency ?? null,
        target_currency:          invoiceData.target_currency ?? null,
        calculation_rate:         invoiceData.calculation_rate ?? null,
        total_tax_exclusive_tl:   invoiceData.total_tax_exclusive_tl ?? null,
        tax_amount_tl:            invoiceData.tax_amount_tl ?? null,
        payable_amount_tl:        invoiceData.payable_amount_tl ?? null,
        total_tax_exclusive_cur:  invoiceData.total_tax_exclusive_cur ?? null,
        total_tax_inclusive_cur:  invoiceData.total_tax_inclusive_cur ?? null,
        payable_amount_cur:       invoiceData.payable_amount_cur ?? null,
        invoice_type:             invoiceData.invoice_type ?? null,
        // NOT touched: approval_status, xml_url, pdf_url, tenant_id, source, gib_*
    };
    const { error: hdrErr } = await supabase
        .from('invoices')
        .update(headerUpdate)
        .eq('id', inv.id)
        .eq('tenant_id', TENANT_ID);
    if (hdrErr) throw new Error(`Başlık güncellenemedi: ${hdrErr.message}`);

    // 5) replace items — insertItems deletes existing by invoice_id then inserts.
    //    (These raw parsed items; the pipeline then classifies + links them.)
    //    Pipeline handles item insertion itself, so we pass parsed items to it.

    // 6) pipeline — NO bumpStock (skipStock flag). dbInvoice must carry id.
    const dbInvoice = { ...invoiceData, id: inv.id, direction: inv.direction, tenant_id: TENANT_ID };
    await processInvoicePipeline(dbInvoice, items, viewKey, TENANT_ID, { skipStock: true });

    // 7) approval_status is set inside the pipeline (trusted→approved / pending).
    //    Nothing extra here.

    // 8) generate + upload PDF (best-effort; returns null on failure)
    const pdfUrl = await generateAndUploadPdf(supabase, inv.id, inv.xml_url);
    console.log(`   ${pdfUrl ? '🧾 PDF yüklendi' : '⚠️ PDF üretilemedi'}`);

    return { ok: true };
}

async function main() {
    const limit = parseInt(process.argv[2], 10) || 5;
    console.log(`🚀 İnokas reparse başlıyor — en fazla ${limit} fatura\n`);

    // pending İnokas invoices with a stored XML
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, invoice_no, direction, xml_url, tenant_id')
        .eq('tenant_id', TENANT_ID)
        .eq('approval_status', 'pending')
        .not('xml_url', 'is', null)
        .order('invoice_date', { ascending: true })
        .limit(limit);

    if (error) { console.error('Faturalar okunamadı:', error.message); process.exit(1); }

    console.log(`   ${invoices.length} bekleyen fatura işlenecek.\n`);

    let ok = 0, fail = 0, skip = 0;
    for (const inv of invoices) {
        try {
            const r = await reprocessInvoice(inv);
            if (r.skipped) skip++; else ok++;
        } catch (err) {
            fail++;
            console.error(`   ❌ HATA (${inv.invoice_no}): ${err.message}`);
        }
    }

    console.log(`\n${'═'.repeat(68)}`);
    console.log(`✅ Bitti — ${ok} başarılı, ${fail} hatalı, ${skip} atlandı`);
    console.log('═'.repeat(68));
}

main().catch(err => {
    console.error('\n💥 Çöktü:', err.message);
    process.exit(1);
});