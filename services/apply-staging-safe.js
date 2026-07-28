// apply-staging-safe.js
// PASS 2a: auto-apply the SAFE enrichment fields (specs, brand, category)
// from product_enrichment_staging. Does NOT change product_code, does NOT merge.
// Only confident rows (needs_review = false). Marks them applied.
//
// Usage:  node apply-staging-safe.js [limit]   (default: all)

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { supabase } = require('../tests/supabase-client');

const TENANT_ID = 'a58a2117-59be-4294-9fa7-6ef0ab8f0ba1';

async function main() {
    const limit = parseInt(process.argv[2], 10) || null;
    console.log('🟢 Güvenli alanları uygula (specs, brand, kategori) — kod DEĞİŞTİRİLMEZ\n');

    // confident, still-pending staging rows
    let query = supabase
        .from('product_enrichment_staging')
        .select('id, product_id, resolved_brand, resolved_category, resolved_specs, needs_review')
        .eq('tenant_id', TENANT_ID)
        .eq('status', 'pending')
        .eq('needs_review', false);
    if (limit) query = query.limit(limit);

    const { data: rows, error } = await query;
    if (error) { console.error('Staging okunamadı:', error.message); process.exit(1); }

    console.log(`   ${rows.length} güvenli satır uygulanacak.\n`);

    let ok = 0, fail = 0;
    for (const r of rows) {
        try {
            // build the product update — only safe fields, only non-empty ones
            const update = { updated_at: new Date().toISOString() };
            if (r.resolved_brand)    update.brand       = r.resolved_brand;
            if (r.resolved_category) update.subcategory = r.resolved_category;  // specific level
            if (r.resolved_specs && Object.keys(r.resolved_specs).length) {
                update.specs = r.resolved_specs;
            }

            // nothing to apply? skip
            if (Object.keys(update).length === 1) {   // only updated_at
                await supabase.from('product_enrichment_staging')
                    .update({ status: 'skipped', error: 'boş zenginleştirme' })
                    .eq('id', r.id);
                continue;
            }

            // update the product (by id — never touches product_code)
            const { error: upErr } = await supabase
                .from('products')
                .update(update)
                .eq('id', r.product_id)
                .eq('tenant_id', TENANT_ID);
            if (upErr) throw new Error(upErr.message);

            // mark staging row applied
            await supabase.from('product_enrichment_staging')
                .update({ status: 'applied' })
                .eq('id', r.id);

            ok++;
            console.log(`   ✓ ${r.product_id}  (${Object.keys(update).filter(k => k !== 'updated_at').join(', ')})`);
        } catch (err) {
            fail++;
            console.error(`   ❌ ${r.product_id}: ${err.message}`);
            await supabase.from('product_enrichment_staging')
                .update({ error: err.message })
                .eq('id', r.id);
        }
    }

    console.log(`\n${'═'.repeat(56)}`);
    console.log(`✅ Bitti — ${ok} uygulandı, ${fail} hata`);
    console.log(`   Kod değişiklikleri ve merge'ler ayrı incelemede kalıyor.`);
    console.log('═'.repeat(56));
}

main().catch(err => { console.error('💥', err.message); process.exit(1); });