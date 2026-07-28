// enrich-products-pass1.js
// PASS 1 of the product-enrichment backfill.
// Enriches İnokas products (is_hidden=false) and writes results to
// product_enrichment_staging. Detects merge candidates (resolved MPN collides
// with a DIFFERENT existing product). Writes NOTHING to the products table.
//
// After this runs you REVIEW the staging table, then run Pass 2 to apply.
//
// Usage:  node enrich-products-pass1.js [limit]     (default 20)
//   node enrich-products-pass1.js 1     → one (test)
//   node enrich-products-pass1.js 20    → twenty
//   node enrich-products-pass1.js 300   → all 276

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const { enrichProduct } = require('./product-enricher');
const db = require('./helpers');

const TENANT_ID = 'a58a2117-59be-4294-9fa7-6ef0ab8f0ba1'; // İnokas

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function stageOne(product, knownSubcats) {
    // map product → the item-shape enrichProduct expects
    const item = {
        product_name: product.product_name,
        product_desc: null,                    // products don't store this
        line_note:    null,
        product_code: product.product_code,
        brand_name:   product.brand,
    };

    // enrich (returns data; writes nothing to products). recordBrandDomain
    // inside will learn brand domains — harmless/beneficial, no product writes.
    const enriched = await enrichProduct(item, knownSubcats, {
        isTrustedDomain:   (url, brand)  => db.isTrustedDomain(url, brand, TENANT_ID),
        recordBrandDomain: (brand, urls) => db.recordBrandDomain(brand, urls, TENANT_ID),
    });

    const resolvedMpn = enriched.product_code || null;

    // merge detection: does the resolved MPN match a DIFFERENT existing product?
    let mergeTargetId = null;
    if (resolvedMpn && resolvedMpn !== product.product_code) {
        const { data: collide } = await supabase
            .from('products')
            .select('id')
            .eq('tenant_id', TENANT_ID)
            .eq('product_code', resolvedMpn)
            .neq('id', product.id)
            .maybeSingle();
        if (collide) mergeTargetId = collide.id;
    }

    // upsert staging row (unique on product_id → re-runnable)
    const row = {
        product_id:        product.id,
        tenant_id:         TENANT_ID,
        current_code:      product.product_code,
        current_name:      product.product_name,
        resolved_mpn:      resolvedMpn,
        resolved_brand:    enriched.brand || null,
        resolved_category: enriched.item_subcategory || null,
        resolved_specs:    enriched.specs || {},
        needs_review:      enriched.needs_review === true,
        official_source:   enriched.official_source_used === true,
        merge_target_id:   mergeTargetId,
        status:            'pending',
    };

    const { error } = await supabase
        .from('product_enrichment_staging')
        .upsert(row, { onConflict: 'product_id', ignoreDuplicates: false });
    if (error) throw new Error(`Staging yazılamadı: ${error.message}`);

    const flag = mergeTargetId ? '🔗 MERGE adayı' : (row.needs_review ? '⚠️ inceleme' : '✓');
    console.log(`   ${flag}  ${product.product_name?.slice(0, 40)}  →  MPN: ${resolvedMpn || '—'}`);
    return { merge: !!mergeTargetId, review: row.needs_review };
}

async function main() {
    const limit = parseInt(process.argv[2], 10) || 20;
    console.log(`🧪 Ürün zenginleştirme PASS 1 — en fazla ${limit} ürün\n`);

    // İnokas products, is_hidden=false, that aren't already staged (re-runnable)
    const { data: staged } = await supabase
        .from('product_enrichment_staging')
        .select('product_id')
        .eq('tenant_id', TENANT_ID);
    const stagedIds = new Set((staged || []).map(s => s.product_id));

    const { data: products, error } = await supabase
        .from('products')
        .select('id, product_code, product_name, brand')
        .eq('tenant_id', TENANT_ID)
        .eq('is_hidden', false)
        .order('created_at', { ascending: true });
    if (error) { console.error('Ürünler okunamadı:', error.message); process.exit(1); }

    // skip already-staged, take up to limit
    const todo = products.filter(p => !stagedIds.has(p.id)).slice(0, limit);
    console.log(`   ${products.length} toplam, ${stagedIds.size} zaten staged, ${todo.length} işlenecek.\n`);

    // specific-category vocab for the enricher
    const knownSubcats = await db.getKnownSubcategories(TENANT_ID);

    let merges = 0, reviews = 0, ok = 0, fail = 0;
    for (const product of todo) {
        try {
            const r = await stageOne(product, knownSubcats);
            ok++;
            if (r.merge) merges++;
            if (r.review) reviews++;
        } catch (err) {
            fail++;
            console.error(`   ❌ ${product.product_name?.slice(0, 40)}: ${err.message}`);
        }
        await sleep(1200); // rate limit for Perplexity
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`✅ PASS 1 bitti — ${ok} staged (${merges} merge adayı, ${reviews} inceleme), ${fail} hata`);
    console.log(`   Şimdi staging tablosunu incele, sonra Pass 2 çalıştır.`);
    console.log('═'.repeat(60));
}

main().catch(err => {
    console.error('\n💥 Çöktü:', err.message);
    process.exit(1);
});