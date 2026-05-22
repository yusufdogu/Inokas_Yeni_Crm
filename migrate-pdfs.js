// migrate-pdfs.js
// Bir kez çalıştır: xml_url dolu, pdf_url boş olan faturalara PDF üret.
// Kullanım: node migrate-pdfs.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { generateAndUploadPdf } = require('./services/pdf-service');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
    const { data: invoices, error } = await supabase
        .from('invoices')
        .select('id, xml_url')
        .not('xml_url', 'is', null)
        .is('pdf_url', null);

    if (error) throw error;
    console.log(`${invoices.length} fatura işlenecek.\n`);

    for (const inv of invoices) {
        process.stdout.write(`[${inv.id}] işleniyor... `);
        const url = await generateAndUploadPdf(supabase, inv.id, inv.xml_url);
        console.log(url ? `✓ ${url}` : '✗ atlandı');
    }

    console.log('\nMigration tamamlandı.');
}

run().catch(console.error);
