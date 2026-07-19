require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// confirmed flag flips once a brand domain has been seen this many times
const CONFIRM_THRESHOLD = 2;

// ─── helpers ──────────────────────────────────────────────────────────────────

function normalizeBrand(s) {
    if (!s) return '';
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+/g, '').trim();
}

function extractDomain(url) {
    if (!url) return '';
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
    catch { return ''; }
}

function domainMatchesBrand(brandKey, domain) {
    if (!brandKey || !domain) return false;
    return domain.split('.').includes(brandKey);
}

// ═══ PRODUCTS ═════════════════════════════════════════════════════════════════

async function findProductByCode(code, tenantId) {
    if (!code) return null;
    const { data, error } = await supabase
        .from('products')
        .select('id, product_code, stock_on_hand')
        .eq('tenant_id', tenantId)
        .eq('product_code', code)
        .maybeSingle();

    if (error) throw new Error(`Ürün aranamadı (${code}): ${error.message}`);
    return data || null;
}

// Create the product master. FREEZE: on conflict (tenant, code) do nothing.
// Does NOT touch stock. Returns the product row (existing or new).
//   products.category    = GENERAL family  (from classifier's item_category)
//   products.subcategory = SPECIFIC        (from enricher's item_subcategory)
async function upsertProduct(item, tenantId) {
    const code = item.product_code;
    if (!code) return null;

    const record = {
        tenant_id:     tenantId,
        product_code:  code,
        product_name:  item.product_name || null,
        brand:         item.brand || item.brand_name || null,
        category:      item.item_category    || null,   // general family
        subcategory:   item.item_subcategory || null,   // specific category
        specs:         item.specs || {},
        needs_review:  item.needs_review === true,
        is_internal:   true,             // only internal items reach here
        source:        'api',
        stock_on_hand: 0,                // stock handled by bumpStock
    };

    const { error } = await supabase
        .from('products')
        .upsert(record, { onConflict: 'tenant_id,product_code', ignoreDuplicates: true });

    if (error) throw new Error(`Ürün yazılamadı (${code}): ${error.message}`);

    return await findProductByCode(code, tenantId);
}

// Move stock. ALWAYS applies (every invoice line).
//   incoming (gelen)  → stock_on_hand += qty
//   outgoing (giden)  → stock_on_hand -= qty
async function bumpStock(code, qty, direction, tenantId) {
    if (!code || !qty) return null;

    const current = await findProductByCode(code, tenantId);
    if (!current) return null;

    const delta    = direction === 'gelen' ? Number(qty) : -Number(qty);
    const newStock = Number(current.stock_on_hand || 0) + delta;

    const { error } = await supabase
        .from('products')
        .update({ stock_on_hand: newStock, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('product_code', code);

    if (error) throw new Error(`Stok güncellenemedi (${code}): ${error.message}`);
    return newStock;
}

// ═══ CATEGORY VOCAB — connected hierarchy ═════════════════════════════════════
// NEW table roles after the swap:
//   product_categories    = GENERAL family (parent), has category_type
//   product_subcategories = SPECIFIC       (child),  FK category_id → categories

// General families for a type ('internal' | 'non_internal').
async function getKnownCategories(type, tenantId) {
    const { data, error } = await supabase
        .from('product_categories')
        .select('name')
        .eq('tenant_id', tenantId)
        .eq('category_type', type);

    if (error) throw new Error(`Kategoriler okunamadı: ${error.message}`);
    return (data || []).map(r => r.name);
}

// Add a general family (idempotent) and return its id — needed as the parent
// for any specific subcategory created under it.
async function addCategory(type, name, tenantId) {
    if (!name) return null;

    const { error } = await supabase
        .from('product_categories')
        .upsert(
            { tenant_id: tenantId, category_type: type, name },
            { onConflict: 'tenant_id,category_type,name', ignoreDuplicates: true }
        );
    if (error) throw new Error(`Kategori yazılamadı (${name}): ${error.message}`);

    const { data, error: selErr } = await supabase
        .from('product_categories')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('category_type', type)
        .eq('name', name)
        .maybeSingle();
    if (selErr) throw new Error(`Kategori id alınamadı (${name}): ${selErr.message}`);
    return data ? data.id : null;
}

// Specific subcategories — returned as names (for the enricher vocab feedback).
async function getKnownSubcategories(tenantId) {
    const { data, error } = await supabase
        .from('product_subcategories')
        .select('name')
        .eq('tenant_id', tenantId);

    if (error) throw new Error(`Alt kategoriler okunamadı: ${error.message}`);
    return (data || []).map(r => r.name);
}

// Add a specific subcategory under a parent general family (idempotent).
// categoryId is REQUIRED — subcategories cannot exist without a parent.
async function addSubcategory(name, categoryId, tenantId) {
    if (!name || !categoryId) return null;

    const { error } = await supabase
        .from('product_subcategories')
        .upsert(
            { tenant_id: tenantId, name, category_id: categoryId },
            { onConflict: 'tenant_id,category_id,name', ignoreDuplicates: true }
        );
    if (error) throw new Error(`Alt kategori yazılamadı (${name}): ${error.message}`);
    return true;
}

// ═══ TRUSTED DOMAINS ══════════════════════════════════════════════════════════

// Learn a brand's official domain(s) from cited URLs.
//   gate (a): only domains whose host contains the brand name are stored
//   gate (b): confirmed flips true once seen_count reaches N
async function recordBrandDomain(brand, urls, tenantId) {
    const key = normalizeBrand(brand);
    if (!key || !Array.isArray(urls) || urls.length === 0) return;

    const domains = [...new Set(
        urls.map(extractDomain).filter(d => d && domainMatchesBrand(key, d))
    )];
    if (domains.length === 0) return;

    for (const domain of domains) {
        const { data: existing, error: selErr } = await supabase
            .from('trusted_domains')
            .select('id, seen_count')
            .eq('tenant_id', tenantId)
            .eq('scope', 'brand')
            .eq('brand', key)
            .eq('domain', domain)
            .maybeSingle();
        if (selErr) throw new Error(`Marka alan adı okunamadı: ${selErr.message}`);

        if (existing) {
            const newCount = (existing.seen_count || 0) + 1;
            const { error } = await supabase
                .from('trusted_domains')
                .update({ seen_count: newCount, confirmed: newCount >= CONFIRM_THRESHOLD })
                .eq('id', existing.id);
            if (error) throw new Error(`Marka alan adı güncellenemedi: ${error.message}`);
        } else {
            const { error } = await supabase
                .from('trusted_domains')
                .insert({
                    tenant_id: tenantId, scope: 'brand', brand: key, domain,
                    seen_count: 1, confirmed: 1 >= CONFIRM_THRESHOLD,
                });
            if (error) throw new Error(`Marka alan adı eklenemedi: ${error.message}`);
        }
    }
}

// Trust check: is this URL trusted for this product?
//   global domain → trusted for any brand
//   brand domain  → trusted only for the matching brand
async function isTrustedDomain(url, brand, tenantId) {
    const domain = extractDomain(url);
    if (!domain) return false;

    const { data: g, error: gErr } = await supabase
        .from('trusted_domains')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('scope', 'global')
        .eq('domain', domain)
        .maybeSingle();
    if (gErr) throw new Error(`Global alan adı kontrolü başarısız: ${gErr.message}`);
    if (g) return true;

    const key = normalizeBrand(brand);
    if (!key) return false;
    const { data: b, error: bErr } = await supabase
        .from('trusted_domains')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('scope', 'brand')
        .eq('brand', key)
        .eq('domain', domain)
        .maybeSingle();
    if (bErr) throw new Error(`Marka alan adı kontrolü başarısız: ${bErr.message}`);
    return Boolean(b);
}

// ═══ INVOICE ITEM WRITE-BACK ══════════════════════════════════════════════════

async function updateInvoiceItem(itemId, fields, tenantId) {
    // fields: { item_category, item_subcategory, is_internal, product_code, product_id }
    // tenantId is accepted for signature consistency; row is keyed by id.
    const { error } = await supabase
        .from('invoice_items')
        .update(fields)
        .eq('id', itemId);
    if (error) throw new Error(`Kalem güncellenemedi (${itemId}): ${error.message}`);
}

module.exports = {
    findProductByCode,
    upsertProduct,
    bumpStock,
    getKnownCategories,
    addCategory,
    getKnownSubcategories,
    addSubcategory,
    recordBrandDomain,
    isTrustedDomain,
    updateInvoiceItem,
};