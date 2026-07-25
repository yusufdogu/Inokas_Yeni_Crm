// migrate-xml-storage.js
// Some invoices' xml_url points at the OLD Supabase project (qvowjtswizirfxwiwxnw),
// whose files were never migrated. The old signed URLs still work (project alive),
// so: download via the old URL → upload to the NEW public bucket → update xml_url
// to the new public URL.
//
// Scope: EVERY invoice whose xml_url references the old project (any tenant,
// any category). Idempotent-ish: once xml_url is rewritten to the new host,
// the invoice no longer matches the filter and is skipped on re-run.
//
// Usage:  node migrate-xml-storage.js [limit]     (default: all stale)
//   node migrate-xml-storage.js 5    → first 5 (test)
//   node migrate-xml-storage.js      → all

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const OLD_HOST = 'qvowjtswizirfxwiwxnw.supabase.co';       // dead project — files not migrated
const BUCKET   = 'invoice-xml';                            // public bucket in new project

// Pull the storage object path (e.g. "26ee...xml") out of an old signed URL.
//   .../object/sign/invoice-xml/26ee....xml?token=...
function filenameFromUrl(url) {
    try {
        const u = new URL(url);
        // path: /storage/v1/object/sign/invoice-xml/<file>
        const parts = u.pathname.split('/');
        const idx = parts.indexOf(BUCKET);
        if (idx === -1 || idx + 1 >= parts.length) return null;
        return decodeURIComponent(parts.slice(idx + 1).join('/')); // handles any subpath
    } catch {
        return null;
    }
}

async function fetchWithRetry(url, tries = 4) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) return res;
            if (i === tries - 1) throw new Error(`HTTP ${res.status}`);
        } catch (e) {
            if (i === tries - 1) throw e;
            await new Promise(r => setTimeout(r, 600 * (i + 1)));
        }
    }
}

async function migrateOne(inv) {
    const filename = filenameFromUrl(inv.xml_url);
    if (!filename) throw new Error('Dosya adı URL\'den çıkarılamadı');

    // 1) download from the OLD (working) signed URL
    const res = await fetchWithRetry(inv.xml_url);
    const buf = Buffer.from(await res.arrayBuffer());

    // 2) upload to the NEW public bucket (same filename; upsert = safe re-run)
    const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(filename, buf, { contentType: 'application/xml', upsert: true });
    if (upErr) throw new Error(`Yükleme hatası: ${upErr.message}`);

    // 3) public URL (bucket is public → never expires)
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(filename);

    // 4) update the invoice row
    const { error: updErr } = await supabase
        .from('invoices')
        .update({ xml_url: publicUrl })
        .eq('id', inv.id);
    if (updErr) throw new Error(`xml_url güncellenemedi: ${updErr.message}`);

    console.log(`   ✅ ${inv.invoice_no}  →  ${filename}`);
    return { ok: true };
}

async function main() {
    const limit = parseInt(process.argv[2], 10) || null;

    console.log(`📦 XML taşıma başlıyor (eski proje: ${OLD_HOST})\n`);

    // every invoice still pointing at the old project
    let query = supabase
        .from('invoices')
        .select('id, invoice_no, xml_url')
        .like('xml_url', `%${OLD_HOST}%`)
        .order('invoice_date', { ascending: true });

    if (limit) query = query.limit(limit);

    const { data: invoices, error } = await query;
    if (error) { console.error('Faturalar okunamadı:', error.message); process.exit(1); }

    console.log(`   ${invoices.length} fatura taşınacak.\n`);

    let ok = 0, fail = 0;
    for (const inv of invoices) {
        try {
            await migrateOne(inv);
            ok++;
        } catch (err) {
            fail++;
            console.error(`   ❌ ${inv.invoice_no}: ${err.message} | ${err.cause?.code || ''}`);
        }
        await new Promise(r => setTimeout(r, 250));   // throttle
    }

    console.log(`\n${'═'.repeat(56)}`);
    console.log(`✅ Bitti — ${ok} taşındı, ${fail} hata`);
    console.log('═'.repeat(56));
}

main().catch(err => {
    console.error('\n💥 Çöktü:', err.message);
    process.exit(1);
});