// backfill-dmo-main.js
// Detect DMO invoices for İnokas and set dmo_invoice + dmo_order_no.
// Lightweight: fetches each invoice's XML, reads ONLY cac:OrderReference/cbc:ID,
// matches the DMO order-number pattern. No parsing of items, no pipeline.
//
// DMO order number formats (per DMO e-fatura guide, rule 3.5):
//   Y_K9999_11_1111   or   M9999111111
// and must appear in Invoice/cac:OrderReference/cbc:ID.
//
// Usage:  node backfill-dmo-main.js [limit]      (default: all internal invoices)
//   node backfill-dmo-main.js 5    → first 5
//   node backfill-dmo-main.js      → all

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const { parser }   = require('./ubl-parser');   // exported fast-xml-parser instance

const TENANT_ID = 'e3b966c1-7380-4de3-8d4a-de40099cfd30'; // eymir

// Y_K + one-or-more (_digits) groups,  OR  M + 10+ digits
const DMO_RE = /(Y_K\d+(?:_\d+)+|M\d{10,})/;

// Pull all OrderReference IDs from a parsed invoice (there may be several).
function orderRefIds(invoiceNode) {
    const refs = [].concat(invoiceNode?.OrderReference || []);
    return refs
        .map(r => String(r?.ID ?? '').trim())
        .filter(Boolean);
}

// Given raw XML text, return { isDmo, orderNo } by inspecting OrderReference ids.
function detectDmo(xmlText) {
    const xml = parser.parse(xmlText);
    const inv = xml?.Invoice;
    if (!inv) return { isDmo: false, orderNo: null };

    for (const id of orderRefIds(inv)) {
        const m = id.match(DMO_RE);
        if (m) return { isDmo: true, orderNo: m[1] };
    }
    return { isDmo: false, orderNo: null };
}

async function processOne(inv) {
    if (!inv.xml_url) {
        return { skipped: true };
    }

    const res = await fetch(inv.xml_url);
    if (!res.ok) throw new Error(`XML indirilemedi (${res.status})`);
    const xmlText = await res.text();

    const { isDmo, orderNo } = detectDmo(xmlText);

    // only write when it's a DMO invoice; non-DMO stay at default (false/null)
    if (isDmo) {
        const { error } = await supabase
            .from('invoices')
            .update({ dmo_invoice: true, dmo_order_no: orderNo })
            .eq('id', inv.id)
            .eq('tenant_id', TENANT_ID);
        if (error) throw new Error(`Güncellenemedi: ${error.message}`);
        console.log(`   ✅ ${inv.invoice_no}  →  DMO  (${orderNo})`);
        return { dmo: true };
    }

    console.log(`   ·  ${inv.invoice_no}  →  DMO değil`);
    return { dmo: false };
}

async function main() {
    const limit = parseInt(process.argv[2], 10) || null;

    console.log('🏛️  DMO backfill başlıyor (yalnız internal faturalar)...\n');

    // internal-category İnokas invoices with a stored XML
    let query = supabase
        .from('invoices')
        .select('id, invoice_no, xml_url')
        .eq('tenant_id', TENANT_ID)
        .eq('invoice_category', 'INTERNAL')
        .not('xml_url', 'is', null)
        .order('invoice_date', { ascending: true });

    if (limit) query = query.limit(limit);

    const { data: invoices, error } = await query;
    if (error) { console.error('Faturalar okunamadı:', error.message); process.exit(1); }

    console.log(`   ${invoices.length} internal fatura kontrol edilecek.\n`);

    let dmo = 0, nondmo = 0, skip = 0, fail = 0;
    for (const inv of invoices) {
        try {
            const r = await processOne(inv);
            if (r.skipped) skip++;
            else if (r.dmo) dmo++;
            else nondmo++;
        } catch (err) {
            fail++;
            console.error(`   ❌ ${inv.invoice_no}: ${err.message} | ${err.cause?.code || err.cause?.message || ''}`);
        }
        await new Promise(res => setTimeout(res, 200));   // ← throttle: 200ms between fetches
    }

    console.log(`\n${'═'.repeat(56)}`);
    console.log(`✅ Bitti — ${dmo} DMO, ${nondmo} normal, ${skip} atlandı, ${fail} hata`);
    console.log('═'.repeat(56));
}

main().catch(err => {
    console.error('\n💥 Çöktü:', err.message);
    process.exit(1);
});