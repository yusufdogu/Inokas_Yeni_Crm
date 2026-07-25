// backfill-pdfs.js
// Generate + upload PDFs for İnokas invoices missing pdf_url (but having xml_url).
//
// Usage:  node backfill-pdfs.js [limit]     (default: all)
//   node backfill-pdfs.js 1     → one (test the Puppeteer setup first)
//   node backfill-pdfs.js       → all missing

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const { generateAndUploadPdf } = require('../services/pdf-service');

const TENANT_ID = 'a58a2117-59be-4294-9fa7-6ef0ab8f0ba1'; // İnokas

async function main() {
    const limit = parseInt(process.argv[2], 10) || null;

    console.log('🧾 PDF backfill başlıyor...\n');

    // invoices missing pdf_url but having xml_url
    let query = supabase
        .from('invoices')
        .select('id, invoice_no, xml_url')
        .eq('tenant_id', TENANT_ID)
        .is('pdf_url', null)
        .not('xml_url', 'is', null)
        .order('invoice_date', { ascending: true });

    if (limit) query = query.limit(limit);

    const { data: invoices, error } = await query;
    if (error) { console.error('Faturalar okunamadı:', error.message); process.exit(1); }

    console.log(`   ${invoices.length} fatura işlenecek.\n`);

    let ok = 0, fail = 0;
    for (const inv of invoices) {
        try {
            const pdfUrl = await generateAndUploadPdf(supabase, inv.id, inv.xml_url);
            if (pdfUrl) {
                ok++;
                console.log(`   ✅ ${inv.invoice_no}`);
            } else {
                fail++;
                console.log(`   ⚠️ ${inv.invoice_no} — PDF üretilemedi`);
            }
        } catch (err) {
            fail++;
            console.error(`   ❌ ${inv.invoice_no}: ${err.message}`);
        }
    }

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`✅ Bitti — ${ok} başarılı, ${fail} başarısız`);
    console.log('═'.repeat(50));
}

main().catch(err => {
    console.error('\n💥 Çöktü:', err.message);
    process.exit(1);
});