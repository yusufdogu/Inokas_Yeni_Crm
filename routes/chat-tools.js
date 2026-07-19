// ─── chat-tools.js ────────────────────────────────────────────────────────────
// Tool schemas + implementations for the AI chat.
// Used by /api/chat/ask route in fatura-chat.js.
//
// 7 tools total:
//   1. applyFilters        — UI action (no fetcher, uses _resolveApplyFiltersArgs)
//   2. getInvoiceStats     — aggregate totals or company ranking
//   3. getInvoices         — individual invoice list
//   4. getInvoiceItems     — line items of specific invoices
//   5. getProductBreakdown — product/brand/category activity from invoices
//   6. getProducts         — catalog / stock / pricing list
//   7. getProductDetail    — deep-dive on ONE product

// ═════════════════════════════════════════════════════════════════════════════
// SHARED UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

const _fmt = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 });

const _safeDate = d => {
    if (!d) return null;
    try { return new Date(d).toISOString().slice(0, 10); } catch { return null; }
};

const _toNum = v => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? null : n; }
    return null;
};

const _pf = v => parseFloat(v) || 0;   // shorthand parseFloat


// ── Turkish-aware normalization ───────────────────────────────────────────────
function _norm(s) {
    return String(s || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[ıİI]/g, 'i').replace(/[şŞ]/g, 's').replace(/[çÇ]/g, 'c')
        .replace(/[ğĞ]/g, 'g').replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o')
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}


// ── Levenshtein distance ──────────────────────────────────────────────────────
function _levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let prev = new Array(b.length + 1);
    let curr = new Array(b.length + 1);

    for (let j = 0; j <= b.length; j++) prev[j] = j;

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = (a[i - 1] === b[j - 1]) ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[b.length];
}


// ── Fuzzy match a list of requested names against available names ─────────────
function _bestMatchList(requested, available) {
    if (!Array.isArray(requested) || !requested.length) return { matched: [], unmatched: [] };

    const matched = [];
    const unmatched = [];
    const availNorm = (available || []).map(a => ({ original: a, normalized: _norm(a) }));

    for (const q of requested) {
        const qn = _norm(q);

        // 1. Exact match
        let hit = availNorm.find(a => a.normalized === qn);

        // 2. Contains match (either direction)
        if (!hit) hit = availNorm.find(a => a.normalized.includes(qn) || qn.includes(a.normalized));

        // 3. Fuzzy — Levenshtein
        if (!hit) {
            const maxDistance = Math.max(2, Math.floor(qn.length * 0.25));
            let bestFuzzy = null;
            let bestDist  = Infinity;

            for (const a of availNorm) {
                if (Math.abs(a.normalized.length - qn.length) > maxDistance) {
                    const tokens = a.normalized.split(' ');
                    for (const tok of tokens) {
                        if (Math.abs(tok.length - qn.length) > maxDistance) continue;
                        const d = _levenshtein(qn, tok);
                        if (d <= maxDistance && d < bestDist) {
                            bestFuzzy = a;
                            bestDist = d;
                        }
                    }
                    continue;
                }
                const d = _levenshtein(qn, a.normalized);
                if (d <= maxDistance && d < bestDist) {
                    bestFuzzy = a;
                    bestDist = d;
                }
            }
            if (bestFuzzy) hit = bestFuzzy;
        }

        if (hit) matched.push(hit.original);
        else unmatched.push(q);
    }
    return { matched, unmatched };
}

// Returns ALL products whose normalized name contains the query token(s).
// Falls back to _bestMatchList (single best fuzzy hit) if nothing contains it.
function _matchAllProducts(requested, available) {
    if (!Array.isArray(requested) || !requested.length) return { matched: [], unmatched: [] };

    const matched   = [];
    const unmatched = [];
    const availNorm = (available || []).map(a => ({ original: a, normalized: _norm(a) }));

    for (const q of requested) {
        const qn = _norm(q);
        if (!qn) { unmatched.push(q); continue; }

        // 1. Exact
        const exact = availNorm.filter(a => a.normalized === qn);
        if (exact.length) {
            exact.forEach(a => matched.push(a.original));
            continue;
        }

        // 2. Contains — collect ALL, not just the first
        const contains = availNorm.filter(a => a.normalized.includes(qn));
        if (contains.length) {
            contains.forEach(a => matched.push(a.original));
            continue;
        }

        // 3. Token-level contains — every query token must appear somewhere in the name
        const tokens = qn.split(' ').filter(Boolean);
        if (tokens.length > 1) {
            const allTokens = availNorm.filter(a => tokens.every(t => a.normalized.includes(t)));
            if (allTokens.length) {
                allTokens.forEach(a => matched.push(a.original));
                continue;
            }
        }

        // 4. Fuzzy fallback — single best hit (typo case)
        const { matched: fuzzy } = _bestMatchList([q], available);
        if (fuzzy.length) matched.push(...fuzzy);
        else unmatched.push(q);
    }

    return { matched: [...new Set(matched)], unmatched };
}

// ── Fetch full filter-option lists per direction (feeds the resolver) ─────────
async function _fetchFilterOptions(supabase, tenantId, direction) {
    // Exclude fully-internal invoices

    let invQuery = supabase
        .from('invoices')
        .select('id, invoice_no, companies(name)')
        .eq('invoice_category','INTERNAL')
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .or('approval_status.neq.pending,approval_status.is.null');

    if (direction)         invQuery = invQuery.eq('direction', direction);

    const { data: invRows } = await invQuery;
    const companies      = [...new Set((invRows || []).map(r => r.companies?.name).filter(Boolean))];
    const invoiceNumbers = [...new Set((invRows || []).map(r => r.invoice_no).filter(Boolean))];
    const directionFilteredIds = (invRows || []).map(r => r.id).filter(Boolean);

    // Fetch items — chunk if too many for URL length
    let itemRows;
    if (directionFilteredIds.length <= 500) {
        const { data } = await supabase
            .from('invoice_items')
            .select('product_name, product_code')
            .eq('is_internal', true)
            .in('invoice_id', directionFilteredIds);
        itemRows = data || [];
    } else {
        const { data } = await supabase
            .from('invoice_items')
            .select('invoice_id, product_name, product_code')
            .eq('is_internal', true);
        const idSet = new Set(directionFilteredIds);
        itemRows = (data || []).filter(r => idSet.has(r.invoice_id));
    }

    const products     = [...new Set(itemRows.map(r => r.product_name).filter(Boolean))];
    const productCodes = [...new Set(itemRows.map(r => r.product_code).filter(Boolean))];

    let brands = [], categories = [];
    if (productCodes.length) {
        let productRows;
        if (productCodes.length <= 500) {
            const { data } = await supabase
                .from('products')
                .select('brand, category')
                .eq('tenant_id', tenantId)
                .eq('is_internal', true)
                .in('product_code', productCodes);
            productRows = data || [];
        } else {
            const { data } = await supabase
                .from('products')
                .select('product_code, brand, category')
                .eq('tenant_id', tenantId)
                .eq('is_internal', true);
            const codeSet = new Set(productCodes);
            productRows = (data || []).filter(r => codeSet.has(r.product_code));
        }
        brands     = [...new Set(productRows.map(r => r.brand).filter(Boolean))];
        categories = [...new Set(productRows.map(r => r.category).filter(Boolean))];
    }

    return { companies, brands, categories, products, invoiceNumbers };
}


// ── applyFilters resolver — used by 4 tools ───────────────────────────────────
async function _resolveApplyFiltersArgs(args, supabase, tenantId, direction) {
    const options = await _fetchFilterOptions(supabase, tenantId, direction);
    const applied = {};
    const warnings = [];

    for (const key of ['companies', 'brands', 'categories', 'products', 'invoiceNumbers']) {
        if (Array.isArray(args[key]) && args[key].length) {
            const matcher = (key === 'products') ? _matchAllProducts : _bestMatchList;
            const { matched, unmatched } = matcher(args[key], options[key] || []);
            applied[key] = matched;
            if (unmatched.length) warnings.push(`${key}: ${unmatched.join(', ')} bulunamadı`);
        } else {
            applied[key] = [];
        }
    }

    applied.dateStart = args.dateStart ? _safeDate(args.dateStart) : null;
    applied.dateEnd   = args.dateEnd   ? _safeDate(args.dateEnd)   : null;
    applied.priceMin  = _toNum(args.priceMin);
    applied.priceMax  = _toNum(args.priceMax);
    applied.currency  = args.currency ? String(args.currency).toUpperCase() : null;

    // Sort params — validated against allowed values
    const ALLOWED_SORT_COLS = ['date', 'amount', 'company', 'invoice_no'];
    const ALLOWED_SORT_DIRS = ['asc', 'desc'];
    applied.sortBy  = ALLOWED_SORT_COLS.includes(args.sortBy) ? args.sortBy  : null;
    applied.sortDir = ALLOWED_SORT_DIRS.includes(args.sortDir) ? args.sortDir : null;
    if (applied.sortBy && !applied.sortDir) applied.sortDir = 'desc';

    return { applied, warnings };
}


// ─── Helper: resolve item-filter IDs shared by 3 fetchers ───────────────────
// Returns { combinedIds } or null if the item filter is empty (no restriction).
// Returns { empty: true } if any filter matched nothing (⇒ query returns 0 rows).
async function _resolveItemFilterIds(supabase, tenantId, { brands, categories, products }) {
    // Build a single products query with whatever filters are present
    const anyFilter = brands?.length || categories?.length || products?.length;
    if (!anyFilter) return { combinedIds: null };

    // Each filter narrows the product set independently, then we intersect invoice_ids
    const idSets = [];

    const productIdsFor = async (col, values) => {
        const { data } = await supabase
            .from('products')
            .select('id')
            .in(col, values)
            .eq('tenant_id', tenantId);
        return (data || []).map(r => r.id).filter(Boolean);
    };

    const invoiceIdsFor = async (productIds) => {
        if (!productIds.length) return [];
        const { data } = await supabase
            .from('invoice_items')
            .select('invoice_id')
            .in('product_id', productIds);
        return [...new Set((data || []).map(r => r.invoice_id).filter(Boolean))];
    };

    if (brands?.length) {
        const ids = await invoiceIdsFor(await productIdsFor('brand', brands));
        if (!ids.length) return { empty: true };
        idSets.push(ids);
    }
    if (categories?.length) {
        const ids = await invoiceIdsFor(await productIdsFor('category', categories));
        if (!ids.length) return { empty: true };
        idSets.push(ids);
    }
    if (products?.length) {
        const ids = await invoiceIdsFor(await productIdsFor('product_name', products));
        if (!ids.length) return { empty: true };
        idSets.push(ids);
    }

    // Intersect
    const combinedIds = idSets.reduce((acc, set) =>
        acc === null ? set : acc.filter(id => set.includes(id)), null);

    return { combinedIds };
}

// ─── Resolve applyStockFilters args against real products (fuzzy brand/cat) ──
// Returns { applied, warnings }. `applied` is the shape the ürünler frontend
// consumes: { skus, productNames, brands, categories, currency, inStock,
// qtyMin, qtyMax, valueMin, valueMax, clear }.
async function _resolveStockFilterArgs(args, supabase, tenantId) {
    const applied = {
        skus: [], productNames: [], brands: [], categories: [],
        currency: null, inStock: null,
        qtyMin: null, qtyMax: null, valueMin: null, valueMax: null,
        clear: args.clear === true,
    };
    const warnings = [];

    // Clear short-circuits everything else.
    if (applied.clear) return { applied, warnings };

    // Pull distinct brands / categories / codes for fuzzy matching.
    const { data: rows, error } = await supabase
        .from('products')
        .select('product_code, product_name, brand, category')
        .eq('tenant_id', tenantId)
        .eq('is_internal', true)
        .eq('is_hidden', false);
    if (error) throw error;

    const distinct = (key) =>
        [...new Set((rows || []).map(r => String(r[key] || '').trim()).filter(Boolean))];

    const brandOpts = distinct('brand');
    const catOpts   = distinct('category');
    const codeOpts  = distinct('product_code');
    const nameOpts  = distinct('product_name');

    if (Array.isArray(args.brands) && args.brands.length) {
        const { matched, unmatched } = _bestMatchList(args.brands, brandOpts);
        applied.brands = matched;
        if (unmatched.length) warnings.push(`marka: ${unmatched.join(', ')} bulunamadı`);
    }
    if (Array.isArray(args.categories) && args.categories.length) {
        const { matched, unmatched } = _bestMatchList(args.categories, catOpts);
        applied.categories = matched;
        if (unmatched.length) warnings.push(`kategori: ${unmatched.join(', ')} bulunamadı`);
    }
    if (Array.isArray(args.skus) && args.skus.length) {
        const { matched, unmatched } = _bestMatchList(args.skus, codeOpts);
        applied.skus = matched;
        if (unmatched.length) warnings.push(`SKU: ${unmatched.join(', ')} bulunamadı`);
    }
    if (Array.isArray(args.productNames) && args.productNames.length) {
        const { matched, unmatched } = _bestMatchList(args.productNames, nameOpts);
        applied.productNames = matched;
        if (unmatched.length) warnings.push(`ürün: ${unmatched.join(', ')} bulunamadı`);
    }

    // Currency — normalize + validate.
    if (args.currency) {
        const c = String(args.currency).toUpperCase().trim();
        applied.currency = ['TRY', 'TL', 'USD', 'EUR'].includes(c) ? (c === 'TL' ? 'TRY' : c) : null;
        if (!applied.currency) warnings.push(`para birimi: ${args.currency} geçersiz`);
    }

    if (args.inStock === true) applied.inStock = true;

    applied.qtyMin   = _toNum(args.qtyMin);
    applied.qtyMax   = _toNum(args.qtyMax);
    applied.valueMin = _toNum(args.valueMin);
    applied.valueMax = _toNum(args.valueMax);

    return { applied, warnings };
}

// ═════════════════════════════════════════════════════════════════════════════
// TOOL SCHEMAS
// ═════════════════════════════════════════════════════════════════════════════

const APPLY_FILTERS_TOOL = {
    name: 'applyFilters',
    description: 'Kullanıcı fatura listesini FİLTRELEMEK istediğinde çağır — arayüzdeki filtreleri günceller ve tabloyu yeniden çeker. Mevcut filtreleri TAMAMEN değiştirir.\n\nÖrnekler:\n- "İndeks\'i göster" → applyFilters({companies:["İndeks"]})\n- "Bu ayki faturalar" → applyFilters({dateStart:"2026-07-01", dateEnd:"2026-07-05"})\n- "10K TL üstü" → applyFilters({priceMin:10000, currency:"TRY"})\n- "Filtreleri temizle" → applyFilters({})\n\nSıralama örnekleri:\n- "En pahalı 10 fatura" → applyFilters({sortBy:"amount", sortDir:"desc"})\n\nBackend fuzzy matching yapar — "İndeks", "Acme" gibi kısmi isimlerle çalışır.',
    input_schema: {
        type: 'object',
        properties: {
            companies:      { type: 'array', items: { type: 'string' }, description: 'Firma/şirket/tedarikçi/müşteri isimleri' },
            brands:         { type: 'array', items: { type: 'string' }, description: 'Marka isimleri (Asus, Samsung vb.)' },
            categories:     { type: 'array', items: { type: 'string' }, description: 'Ürün kategorileri (Monitör, Klavye vb.)' },
            products:       { type: 'array', items: { type: 'string' }, description: 'Spesifik ürün adları (SKU seviyesi)' },
            invoiceNumbers: { type: 'array', items: { type: 'string' }, description: 'Fatura numaraları' },
            dateStart:      { type: 'string', description: 'YYYY-MM-DD' },
            dateEnd:        { type: 'string', description: 'YYYY-MM-DD' },
            priceMin:       { type: 'number', description: 'Minimum tutar (currency ile birlikte)' },
            priceMax:       { type: 'number', description: 'Maksimum tutar' },
            currency:       { type: 'string', description: 'TRY, USD veya EUR — kullanıcı para birimi belirtirse mutlaka doldur' },
            sortBy:         { type: 'string', enum: ['date', 'amount', 'company', 'invoice_no'] },
            sortDir:        { type: 'string', enum: ['asc', 'desc'] },
        },
    },
};


const GET_INVOICE_STATS_TOOL = {
    name: 'getInvoiceStats',
    description: 'Fatura bazında toplam/sayı istatistikleri VEYA firma sıralaması döndürür. UI\'yi değiştirmez.\n\ngroupBy ile şekil belirlenir:\n- groupBy:"none" → genel toplam (fatura sayısı, firma sayısı, ₺/$/€ toplamlar)\n- groupBy:"company" → firma bazında sıralama (hangi firma en çok/en büyük)\n\nÖrnekler:\n- "Toplam ne kadar?" → getInvoiceStats({groupBy:"none"})\n- "Kaç fatura var?" → getInvoiceStats({groupBy:"none"})\n- "En çok fatura aldığımız firma?" → getInvoiceStats({groupBy:"company", sortBy:"count"})\n- "En çok ödediğimiz 5 firma?" → getInvoiceStats({groupBy:"company", sortBy:"amount", limit:5})\n- "İndeks\'in bu ayki toplamı?" → getInvoiceStats({groupBy:"none", companies:["İndeks"], dateStart:"2026-07-01", dateEnd:"2026-07-05"})',
    input_schema: {
        type: 'object',
        properties: {
            groupBy:        { type: 'string', enum: ['none', 'company'], description: 'Varsayılan: none' },
            sortBy:         { type: 'string', enum: ['count', 'amount'], description: 'groupBy:company için. Varsayılan: amount' },
            companies:      { type: 'array', items: { type: 'string' } },
            brands:         { type: 'array', items: { type: 'string' } },
            categories:     { type: 'array', items: { type: 'string' } },
            products:       { type: 'array', items: { type: 'string' } },
            invoiceNumbers: { type: 'array', items: { type: 'string' } },
            dateStart:      { type: 'string', description: 'YYYY-MM-DD' },
            dateEnd:        { type: 'string', description: 'YYYY-MM-DD' },
            priceMin:       { type: 'number' },
            priceMax:       { type: 'number' },
            currency:       { type: 'string' },
            limit:          { type: 'integer', description: 'groupBy:company için (varsayılan 10, maks 20)' },
        },
    },
};


const GET_INVOICES_TOOL = {
    name: 'getInvoices',
    description: 'Bireysel fatura listesini döndürür (en büyük, en son, top N). PDF linkleri içerebilir. UI\'yi değiştirmez.\n\nÖrnekler:\n- "En büyük 5 fatura" → getInvoices({sortBy:"amount", sortDir:"desc", limit:5})\n- "Son 10 fatura" → getInvoices({sortBy:"date", sortDir:"desc", limit:10})\n- "İndeks\'in en büyük faturası" → getInvoices({companies:["İndeks"], sortBy:"amount", sortDir:"desc", limit:1})\n- "Faturaların PDF\'lerini ver" → getInvoices({...}); yanıtta pdf_url\'leri Markdown link olarak ver.\n\nDönen her faturada invoice_no ve invoice_id vardır — getInvoiceItems için kullanılabilir.',
    input_schema: {
        type: 'object',
        properties: {
            companies:      { type: 'array', items: { type: 'string' } },
            brands:         { type: 'array', items: { type: 'string' } },
            categories:     { type: 'array', items: { type: 'string' } },
            products:       { type: 'array', items: { type: 'string' } },
            invoiceNumbers: { type: 'array', items: { type: 'string' } },
            dateStart:      { type: 'string', description: 'YYYY-MM-DD' },
            dateEnd:        { type: 'string', description: 'YYYY-MM-DD' },
            priceMin:       { type: 'number' },
            priceMax:       { type: 'number' },
            currency:       { type: 'string' },
            sortBy:         { type: 'string', enum: ['date', 'amount', 'company', 'invoice_no'], description: 'Varsayılan: date' },
            sortDir:        { type: 'string', enum: ['asc', 'desc'], description: 'Varsayılan: desc' },
            limit:          { type: 'integer', description: 'Varsayılan 10, maks 20' },
        },
    },
};


const GET_INVOICE_ITEMS_TOOL = {
    name: 'getInvoiceItems',
    description: 'Belirli bir faturanın (veya birkaç faturanın) İÇİNDEKİ ürün kalemlerini döndürür. UI\'yi değiştirmez.\n\nÖrnekler:\n- "Bu faturada hangi ürünler var?" → getInvoiceItems({invoiceNumbers:["INV-2026-042"]})\n- "INV-2026-001\'de ne var?" → getInvoiceItems({invoiceNumbers:["INV-2026-001"]})\n\nDönen her kalemde product_id, product_name, product_code, brand_name, quantity ve fiyat vardır — getProductDetail için product_id kullan.\n\nÖnceki getInvoices sonucundaki fatura_no\'yu buraya geçirebilirsin — kullanıcıya TEKRAR SORMA.',
    input_schema: {
        type: 'object',
        properties: {
            invoiceNumbers: {
                type: 'array',
                items: { type: 'string' },
                description: 'Kalemleri istenen fatura numaraları',
            },
        },
        required: ['invoiceNumbers'],
    },
};


const GET_PRODUCT_BREAKDOWN_TOOL = {
    name: 'getProductBreakdown',
    description: 'Ürün / marka / kategori bazında satış (giden) veya alım (gelen) dağılımını fatura hareketinden derler. Neyin çok satıldığını/alındığını bulmak için kullan. UI\'yi değiştirmez.\n\nÖrnekler:\n- "En çok sattığımız ürün?" → getProductBreakdown({groupBy:"product", sortBy:"count"})\n- "İndeks\'e en çok ne sattık?" → getProductBreakdown({companies:["İndeks"], groupBy:"product", sortBy:"count"})\n- "En kazançlı 5 marka?" → getProductBreakdown({groupBy:"brand", sortBy:"total", limit:5})\n- "Bu ay hangi kategori öne çıktı?" → getProductBreakdown({dateStart:"2026-07-01", dateEnd:"2026-07-05", groupBy:"category"})\n\nYanıtta try_total / usd_total / eur_total ayrı ayrı gelir — dominant olanı göster.\ncount = toplam adet (quantity kullanılır).',
    input_schema: {
        type: 'object',
        properties: {
            companies:  { type: 'array', items: { type: 'string' } },
            dateStart:  { type: 'string', description: 'YYYY-MM-DD' },
            dateEnd:    { type: 'string', description: 'YYYY-MM-DD' },
            currency:   { type: 'string' },
            groupBy:    { type: 'string', enum: ['product', 'brand', 'category'], description: 'Varsayılan: product' },
            sortBy:     { type: 'string', enum: ['count', 'total', 'quantity'], description: 'Varsayılan: total' },
            limit:      { type: 'integer', description: 'Varsayılan 10, maks 20' },
        },
    },
};


const GET_PRODUCTS_TOOL = {
    name: 'getProducts',
    description: 'Ürün kataloğunu sorgular — stok, güncel fiyat, sipariş durumu (liste). Fatura hareketinden BAĞIMSIZ, kataloğun güncel durumu. UI\'yi değiştirmez.\n\nÖrnekler:\n- "Stokta en çok olan ürünler?" → getProducts({sortBy:"stock", sortDir:"desc"})\n- "Tükenmek üzere olanlar?" → getProducts({lowStock:true})\n- "En pahalı ürünler (alış)?" → getProducts({sortBy:"price", sortDir:"desc"})\n- "Asus ürünlerinin stok durumu?" → getProducts({brand:"Asus"})\n- "Yolda olan ürünler?" → getProducts({onOrder:true})\n\nDönen her üründe product_id, stock_on_hand, ordered_quantity, last_purchase_price, maliyet_usd vardır.',
    input_schema: {
        type: 'object',
        properties: {
            search:   { type: 'string', description: 'Ürün adında veya kodunda aranacak metin' },
            brand:    { type: 'string', description: 'Marka filtresi' },
            category: { type: 'string', description: 'Kategori filtresi' },
            lowStock: { type: 'boolean', description: 'true → sadece stoğu 10\'un altında olanlar' },
            onOrder:  { type: 'boolean', description: 'true → sadece siparişte olanlar (ordered_quantity > 0)' },
            inStock:  { type: 'boolean', description: 'true → sadece stokta olanlar (stock_on_hand > 0)' },
            sortBy:   { type: 'string', enum: ['stock', 'price', 'cost', 'ordered', 'name'], description: 'stock=stok, price=son alış(TL), cost=maliyet(USD), ordered=sipariş, name=ad. Varsayılan: stock' },
            sortDir:  { type: 'string', enum: ['asc', 'desc'], description: 'Varsayılan: desc' },
            limit:    { type: 'integer', description: 'Varsayılan 10, maks 20' },
        },
    },
};


const GET_PRODUCT_DETAIL_TOOL = {
    name: 'getProductDetail',
    description: 'TEK bir ürünün tüm detayını döndürür — stok, sipariş, tüm fiyatlar ve son 5 fatura hareketi. Bir ürün hakkında derinlemesine bilgi için kullan. UI\'yi değiştirmez.\n\nÖrnekler:\n- "X ürünü hakkında bilgi?" → getProductDetail({productName:"X"})\n- "Bu monitörün stok ve fiyatı?" → getProductDetail({productId:"<önceki adımdan>"})\n- "ASUS VZ249HG detayı?" → getProductDetail({productName:"ASUS VZ249HG"})\n\nproductId önceki bir getInvoiceItems veya getProducts sonucundan geliyorsa onu kullan (en kesin). Yoksa productCode veya productName ile fuzzy eşleşme yapılır.',
    input_schema: {
        type: 'object',
        properties: {
            productId:   { type: 'string', description: 'Ürün ID (en kesin — önceki tool sonucundan)' },
            productName: { type: 'string', description: 'Ürün adı (fuzzy eşleşir)' },
            productCode: { type: 'string', description: 'Ürün kodu (exact eşleşir)' },
        },
    },
};

const APPLY_STOCK_FILTERS_TOOL = {
    name: 'applyStockFilters',
    description: 'Kullanıcı ÜRÜNLER sayfasındaki listeyi FİLTRELEMEK istediğinde çağır — arayüzdeki filtreleri günceller. Mevcut filtreleri TAMAMEN değiştirir.\n\nÖrnekler:\n- "Asus ürünlerini göster" → applyStockFilters({brands:["Asus"]})\n- "Elektronik kategorisi" → applyStockFilters({categories:["Elektronik"]})\n- "Stoğu 5\'in altındakiler" → applyStockFilters({inStock:true, qtyMax:5})\n- "100 adetten fazla olanlar" → applyStockFilters({qtyMin:100})\n- "Değeri 50 binin üstündekiler" → applyStockFilters({valueMin:50000})\n- "USD ile alınanlar" → applyStockFilters({currency:"USD"})\n- "Filtreleri temizle" → applyStockFilters({clear:true})\n\nBackend fuzzy matching yapar — kısmi/yanlış yazılmış marka ve kategori isimleriyle çalışır. Kullanıcının yazdığı ismi OLDUĞU GİBİ geçir.',
    input_schema: {
        type: 'object',
        properties: {
            skus:          { type: 'array', items: { type: 'string' }, description: 'Ürün kodları (SKU)' },
            productNames:  { type: 'array', items: { type: 'string' }, description: 'Ürün adları (fuzzy eşleşir)' },
            brands:        { type: 'array', items: { type: 'string' }, description: 'Marka isimleri (fuzzy eşleşir)' },
            categories:    { type: 'array', items: { type: 'string' }, description: 'Kategori isimleri (fuzzy eşleşir)' },
            currency:      { type: 'string', description: 'Para birimi filtresi: TRY, USD veya EUR' },
            inStock:       { type: 'boolean', description: 'true → sadece stokta olanlar (stok > 0)' },
            qtyMin:        { type: 'number', description: 'Minimum adet' },
            qtyMax:        { type: 'number', description: 'Maksimum adet' },
            valueMin:      { type: 'number', description: 'Minimum toplam stok değeri (TL)' },
            valueMax:      { type: 'number', description: 'Maksimum toplam stok değeri (TL)' },
            clear:         { type: 'boolean', description: 'true → tüm filtreleri sıfırla' },
        },
    },
};
// ═════════════════════════════════════════════════════════════════════════════
// FETCHERS
// ═════════════════════════════════════════════════════════════════════════════

// ── 1. fetchInvoiceStats ─────────────────────────────────────────────────────
async function fetchInvoiceStats(supabase, tenantId, opts = {}) {
    const {
        direction,
        groupBy        = 'none',
        sortBy         = 'amount',
        limit          = 10,
        dateStart      = null,
        dateEnd        = null,
        currency       = null,
        priceMin       = null,
        priceMax       = null,
        companies      = null,
        brands         = null,
        categories     = null,
        products       = null,
        invoiceNumbers = null,
    } = opts;

    const emptyTotals = { totals: {
        total_count: 0, company_count: 0,
        try_total: 0, try_count: 0,
        usd_total: 0, usd_count: 0,
        eur_total: 0, eur_count: 0,
    }};

    // Resolve item-filter IDs (brand/category/product)
    const itemFilter = await _resolveItemFilterIds(supabase, tenantId, { brands, categories, products });
    if (itemFilter.empty) return groupBy === 'company' ? { companies: [] } : emptyTotals;

    // Resolve company IDs
    let companyIds = null;
    if (companies?.length) {
        const { data: matched } = await supabase
            .from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
        companyIds = (matched || []).map(c => c.id);
        if (!companyIds.length) return groupBy === 'company' ? { companies: [] } : emptyTotals;
    }


    // Build query
    let q = supabase
        .from('invoices')
        .select('id, company_id, base_currency, payable_amount_tl, payable_amount_cur, calculation_rate, companies(name)')
        .eq('tenant_id', tenantId)
        .eq('invoice_category','INTERNAL')
        .or('approval_status.neq.pending,approval_status.is.null');

    if (direction)                q = q.eq('direction', direction);
    if (currency)                 q = q.eq('base_currency', currency);
    if (dateStart)                q = q.gte('invoice_date', dateStart);
    if (dateEnd)                  q = q.lte('invoice_date', dateEnd);
    if (priceMin != null)         q = q.gte('payable_amount_tl', priceMin);
    if (priceMax != null)         q = q.lte('payable_amount_tl', priceMax);
    if (companyIds?.length)       q = q.in('company_id', companyIds);
    if (invoiceNumbers?.length)   q = q.in('invoice_no', invoiceNumbers);
    if (itemFilter.combinedIds)   q = q.in('id', itemFilter.combinedIds);

    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows?.length) return groupBy === 'company' ? { companies: [] } : emptyTotals;

    // ── groupBy: 'none' — overall totals ─────────────────────────────────
    if (groupBy === 'none') {
        let try_total = 0, try_count = 0, usd_total = 0, usd_count = 0, eur_total = 0, eur_count = 0;
        rows.forEach(r => {
            const cur = (r.base_currency || 'TRY').toUpperCase();
            if (cur === 'USD')                      { usd_total += _pf(r.payable_amount_cur); usd_count++; }
            else if (cur === 'EUR')                 { eur_total += _pf(r.payable_amount_cur); eur_count++; }
            else                                     { try_total += _pf(r.payable_amount_tl);  try_count++; }
        });

        return {
            totals: {
                total_count:   rows.length,
                company_count: new Set(rows.map(r => r.company_id).filter(Boolean)).size,
                try_total, try_count,
                usd_total, usd_count,
                eur_total, eur_count,
            },
        };
    }

    // ── groupBy: 'company' — per-company aggregation ────────────────────
    const cappedLimit = Math.min(Math.max(limit, 1), 20);
    const byCompany = new Map();

    rows.forEach(r => {
        const name = r.companies?.name;
        if (!name) return;

        if (!byCompany.has(name)) {
            byCompany.set(name, { name, count: 0, total_tl: 0 });
        }
        const entry = byCompany.get(name);
        entry.count++;

        const cur  = (r.base_currency || 'TRY').toUpperCase();
        const rate = _pf(r.calculation_rate) || 1;
        const amtTL = (cur === 'USD' || cur === 'EUR')
            ? _pf(r.payable_amount_cur) * rate
            : _pf(r.payable_amount_tl);
        entry.total_tl += amtTL;
    });

    const sortKey = sortBy === 'count' ? 'count' : 'total_tl';
    const companiesRanked = [...byCompany.values()]
        .sort((a, b) => b[sortKey] - a[sortKey])
        .slice(0, cappedLimit);

    return { companies: companiesRanked };
}


// ── 2. fetchInvoiceList ──────────────────────────────────────────────────────
async function fetchInvoiceList(supabase, tenantId, opts = {}) {
    const {
        direction,
        dateStart      = null,
        dateEnd        = null,
        currency       = null,
        priceMin       = null,
        priceMax       = null,
        companies      = null,
        brands         = null,
        categories     = null,
        products       = null,
        invoiceNumbers = null,
        sortBy         = 'date',
        sortDir        = 'desc',
        limit          = 10,
    } = opts;

    const cappedLimit = Math.min(Math.max(limit, 1), 20);

    const itemFilter = await _resolveItemFilterIds(supabase, tenantId, { brands, categories, products });
    if (itemFilter.empty) return [];

    let companyIds = null;
    if (companies?.length) {
        const { data: matched } = await supabase
            .from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
        companyIds = (matched || []).map(c => c.id);
        if (!companyIds.length) return [];
    }


    const sortColMap = {
        date:       'invoice_date',
        amount:     'payable_amount_tl',
        company:    'company_name',
        invoice_no: 'invoice_no',
    };
    const sortCol     = sortColMap[sortBy] || 'invoice_date';
    const sourceTable = sortCol === 'company_name' ? 'invoices_with_company' : 'invoices';

    let q = supabase
        .from(sourceTable)
        .select('id, invoice_no, invoice_date, payable_amount_tl, payable_amount_cur, base_currency, pdf_url, companies(name)')
        .eq('invoice_category','INTERNAL')
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .or('approval_status.neq.pending,approval_status.is.null');

    if (direction)              q = q.eq('direction', direction);
    if (currency)               q = q.eq('base_currency', currency);
    if (dateStart)              q = q.gte('invoice_date', dateStart);
    if (dateEnd)                q = q.lte('invoice_date', dateEnd);
    if (priceMin != null)       q = q.gte('payable_amount_tl', priceMin);
    if (priceMax != null)       q = q.lte('payable_amount_tl', priceMax);
    if (invoiceNumbers?.length) q = q.in('invoice_no', invoiceNumbers);
    if (companyIds?.length)     q = q.in('company_id', companyIds);
    if (itemFilter.combinedIds) q = q.in('id', itemFilter.combinedIds);

    q = q.order(sortCol, { ascending: sortDir === 'asc' }).limit(cappedLimit);

    const { data, error } = await q;
    if (error) throw error;

    return (data || []).map(row => ({
        invoice_id: row.id,
        invoice_no: row.invoice_no,
        company:    row.companies?.name || row.company_name || 'Bilinmeyen',
        date:       row.invoice_date,
        amount_tl:  _pf(row.payable_amount_tl),
        amount_cur: _pf(row.payable_amount_cur),
        currency:   row.base_currency || 'TRY',
        pdf_url:    row.pdf_url || null,
    }));
}


// ── 3. fetchInvoiceItems (NEW) ───────────────────────────────────────────────
async function fetchInvoiceItems(supabase, tenantId, opts = {}) {
    const { invoiceNumbers, direction } = opts;

    if (!Array.isArray(invoiceNumbers) || !invoiceNumbers.length) return [];

    // Resolve invoice IDs from invoice_no, scoped by tenant and (optionally) direction
    let invQ = supabase
        .from('invoices')
        .select('id, invoice_no, invoice_date')
        .eq('tenant_id', tenantId)
        .eq('invoice_category','INTERNAL')
        .in('invoice_no', invoiceNumbers);

    if (direction) invQ = invQ.eq('direction', direction);

    const { data: invRows, error: invErr } = await invQ;
    if (invErr) throw invErr;
    if (!invRows?.length) return [];

    // Build no→date map for annotating items
    const noByInvId = new Map();
    invRows.forEach(r => noByInvId.set(r.id, { invoice_no: r.invoice_no, invoice_date: r.invoice_date }));

    const invoiceIds = invRows.map(r => r.id);

    // Fetch items
    const { data: itemRows, error: itemErr } = await supabase
        .from('invoice_items')
        .select('invoice_id, product_id, product_name, product_code, brand_name, quantity, unit_price_cur, total_price_cur, currency')
        .eq('is_internal', true)
        .in('invoice_id', invoiceIds);
    if (itemErr) throw itemErr;

    return (itemRows || []).map(r => {
        const inv = noByInvId.get(r.invoice_id) || {};
        return {
            invoice_no:     inv.invoice_no,
            invoice_date:   inv.invoice_date,
            product_id:     r.product_id,
            product_name:   r.product_name,
            product_code:   r.product_code,
            brand_name:     r.brand_name,
            quantity:       _pf(r.quantity),
            unit_price:     _pf(r.unit_price_cur),
            total_price:    _pf(r.total_price_cur),
            currency:       r.currency || 'TRY',
        };
    });
}


// ── 4. fetchProductBreakdown ─────────────────────────────────────────────────
async function fetchProductBreakdown(supabase, tenantId, opts = {}) {
    const {
        direction,
        companies  = null,
        dateStart  = null,
        dateEnd    = null,
        currency   = null,
        groupBy    = 'product',
        sortBy     = 'total',
        limit      = 10,
    } = opts;

    const cappedLimit = Math.min(Math.max(limit, 1), 20);

    // Resolve company IDs
    let companyIds = null;
    if (companies?.length) {
        const { data: matched } = await supabase
            .from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
        companyIds = (matched || []).map(c => c.id);
        if (!companyIds.length) return [];
    }


    // Fetch invoices + calculation_rate
    let invQ = supabase
        .from('invoices')
        .select('id, calculation_rate, base_currency')
        .eq('tenant_id', tenantId)
        .or('approval_status.neq.pending,approval_status.is.null');

    if (direction)          invQ = invQ.eq('direction', direction);
    if (currency)           invQ = invQ.eq('base_currency', currency);
    if (dateStart)          invQ = invQ.gte('invoice_date', dateStart);
    if (dateEnd)            invQ = invQ.lte('invoice_date', dateEnd);
    if (companyIds?.length) invQ = invQ.in('company_id', companyIds);

    const { data: invRows, error: invErr } = await invQ;
    if (invErr) throw invErr;

    const invoiceIds = (invRows || []).map(r => r.id);
    if (!invoiceIds.length) return [];

    const rateMap = new Map();
    (invRows || []).forEach(r => rateMap.set(r.id, _pf(r.calculation_rate) || 1));

    // Fetch items
    let itemRows;
    if (invoiceIds.length <= 500) {
        const { data } = await supabase
            .from('invoice_items')
            .select('invoice_id, product_name, product_code, brand_name, quantity, total_price_cur, currency')
            .eq('is_internal', true)
            .in('invoice_id', invoiceIds);
        itemRows = data || [];
    } else {
        const { data } = await supabase
            .from('invoice_items')
            .select('invoice_id, product_name, product_code, brand_name, quantity, total_price_cur, currency')
            .eq('is_internal', true);
        const idSet = new Set(invoiceIds);
        itemRows = (data || []).filter(r => idSet.has(r.invoice_id));
    }

    // Category enrichment
    let categoryMap = {};
    if (groupBy === 'category') {
        const productCodes = [...new Set(itemRows.map(r => r.product_code).filter(Boolean))];
        if (productCodes.length) {
            const { data: productRows } = await supabase
                .from('products')
                .select('product_code, category')
                .eq('tenant_id', tenantId)
                .in('product_code', productCodes);
            (productRows || []).forEach(p => {
                if (p.product_code && p.category) categoryMap[p.product_code] = p.category;
            });
        }
    }

    // Aggregate with per-currency + TL equivalent
    const bucketMap = new Map();

    itemRows.forEach(r => {
        let key;
        if (groupBy === 'brand')         key = r.brand_name;
        else if (groupBy === 'category') key = categoryMap[r.product_code];
        else                             key = r.product_name;

        if (!key) return;

        if (!bucketMap.has(key)) {
            bucketMap.set(key, {
                name: key, count: 0, quantity: 0,
                try_total: 0, usd_total: 0, eur_total: 0,
                tl_equivalent: 0,
            });
        }

        const b        = bucketMap.get(key);
        const rate     = rateMap.get(r.invoice_id) || 1;
        const cur      = (r.currency || 'TRY').toUpperCase();
        const priceCur = _pf(r.total_price_cur);
        const qty      = _pf(r.quantity);

        b.count    += qty;   // "count" = total units, matches user mental model
        b.quantity += qty;

        if (cur === 'USD') {
            b.usd_total     += priceCur;
            b.tl_equivalent += priceCur * rate;
        } else if (cur === 'EUR') {
            b.eur_total     += priceCur;
            b.tl_equivalent += priceCur * rate;
        } else {
            b.try_total     += priceCur;
            b.tl_equivalent += priceCur;
        }
    });

    const sortKey = sortBy === 'count'    ? 'count'
                  : sortBy === 'quantity' ? 'quantity'
                                          : 'tl_equivalent';

    const sorted = [...bucketMap.values()]
        .sort((a, b) => b[sortKey] - a[sortKey])
        .slice(0, cappedLimit);

    // Strip internal tl_equivalent
    return sorted.map(({ tl_equivalent, ...rest }) => rest);
}


// ── 5. fetchProducts (NEW) ───────────────────────────────────────────────────
async function fetchProducts(supabase, tenantId, opts = {}) {
    const {
        search   = null,
        brand    = null,
        category = null,
        lowStock = false,
        onOrder  = false,
        inStock  = false,
        sortBy   = 'stock',
        sortDir  = 'desc',
        limit    = 10,
    } = opts;

    const cappedLimit = Math.min(Math.max(limit, 1), 20);

    const sortColMap = {
        stock:   'stock_on_hand',
        price:   'last_purchase_price_tl',
        cost:    'maliyet_usd',
        ordered: 'ordered_quantity',
        name:    'product_name',
    };
    const sortCol = sortColMap[sortBy] || 'stock_on_hand';

    let q = supabase
        .from('products')
        .select('id, product_code, product_name, brand, category, stock_on_hand, ordered_quantity, last_purchase_price_cur, last_purchase_price_tl, last_purchase_currency, maliyet_usd')
        .eq('tenant_id', tenantId)
        .eq('is_internal', true)
        .eq('is_hidden', false);

    if (brand)    q = q.eq('brand', brand);
    if (category) q = q.eq('category', category);
    if (search)   q = q.or(`product_name.ilike.%${search}%,product_code.ilike.%${search}%`);
    if (lowStock) q = q.lt('stock_on_hand', 10);
    if (onOrder)  q = q.gt('ordered_quantity', 0);
    if (inStock)  q = q.gt('stock_on_hand', 0);

    q = q.order(sortCol, { ascending: sortDir === 'asc' }).limit(cappedLimit);

    const { data, error } = await q;
    if (error) throw error;

    return (data || []).map(r => ({
        product_id:                 r.id,
        product_code:               r.product_code,
        product_name:               r.product_name,
        brand:                      r.brand,
        category:                   r.category,
        stock_on_hand:              _pf(r.stock_on_hand),
        ordered_quantity:           _pf(r.ordered_quantity),
        last_purchase_price_cur:    _pf(r.last_purchase_price_cur),
        last_purchase_price_tl:     _pf(r.last_purchase_price_tl),
        last_purchase_currency:     r.last_purchase_currency || 'TRY',
        maliyet_usd:                _pf(r.maliyet_usd),
    }));
}


// ── 6. fetchProductDetail (NEW) ──────────────────────────────────────────────
async function fetchProductDetail(supabase, tenantId, identifier = {}) {
    const { productId, productName, productCode } = identifier;

    let product = null;

    // 1. productId — exact
    if (productId) {
        const { data } = await supabase
            .from('products')
            .select('id, product_code, product_name, brand, category, stock_on_hand, ordered_quantity, last_purchase_price_cur, last_purchase_price_tl, last_purchase_currency, maliyet_usd')
            .eq('tenant_id', tenantId)
            .eq('id', productId)
            .maybeSingle();
        product = data || null;
    }

    // 2. productCode — exact
    if (!product && productCode) {
        const { data } = await supabase
            .from('products')
            .select('id, product_code, product_name, brand, category, stock_on_hand, ordered_quantity, last_purchase_price_cur, last_purchase_price_tl, last_purchase_currency, maliyet_usd')
            .eq('tenant_id', tenantId)
            .eq('product_code', productCode)
            .eq('is_hidden', false)
            .maybeSingle();
        product = data || null;
    }

    // 3. productName — fuzzy
    if (!product && productName) {
        // Fetch candidates by ilike, then apply Levenshtein
        const { data: candidates } = await supabase
            .from('products')
            .select('id, product_code, product_name, brand, category, stock_on_hand, ordered_quantity, last_purchase_price_cur, last_purchase_price_tl, last_purchase_currency, maliyet_usd')
            .eq('tenant_id', tenantId)
            .eq('is_internal', true)
            .eq('is_hidden', false)
            .limit(200);

        if (candidates?.length) {
            const availNames = candidates.map(p => p.product_name);
            const { matched } = _bestMatchList([productName], availNames);
            if (matched.length) {
                product = candidates.find(p => p.product_name === matched[0]) || null;
            }
        }
    }

    if (!product) return null;

    // Fetch last 5 invoice appearances of this product (by product_id)
    let recentAppearances = [];
    if (product.id) {
        const { data: itemRows } = await supabase
            .from('invoice_items')
            .select('invoice_id, quantity, unit_price_cur, total_price_cur, currency, invoices(invoice_no, invoice_date, direction, companies(name))')
            .eq('product_id', product.id)
            .eq('is_internal', true)
            .order('created_at', { ascending: false })
            .limit(5);

        recentAppearances = (itemRows || []).map(r => ({
            invoice_no:   r.invoices?.invoice_no,
            invoice_date: r.invoices?.invoice_date,
            direction:    r.invoices?.direction,
            company:      r.invoices?.companies?.name || 'Bilinmeyen',
            quantity:     _pf(r.quantity),
            unit_price:   _pf(r.unit_price_cur),
            total_price:  _pf(r.total_price_cur),
            currency:     r.currency || 'TRY',
        })).filter(r => r.invoice_no);
    }

    return {
        product_id:              product.id,
        product_code:            product.product_code,
        name:                    product.product_name,
        brand:                   product.brand,
        category:                product.category,
        stock_on_hand:           _pf(product.stock_on_hand),
        ordered_quantity:        _pf(product.ordered_quantity),
        last_purchase_price_cur: _pf(product.last_purchase_price_cur),
        last_purchase_price_tl:  _pf(product.last_purchase_price_tl),
        last_purchase_currency:  product.last_purchase_currency || 'TRY',
        maliyet_usd:             _pf(product.maliyet_usd),
        recent_appearances:      recentAppearances,
    };
}


// ═════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Schemas
    APPLY_FILTERS_TOOL,
    GET_INVOICE_STATS_TOOL,
    GET_INVOICES_TOOL,
    GET_INVOICE_ITEMS_TOOL,
    GET_PRODUCT_BREAKDOWN_TOOL,
    GET_PRODUCTS_TOOL,
    GET_PRODUCT_DETAIL_TOOL,
    APPLY_STOCK_FILTERS_TOOL,

    // Fetchers
    fetchInvoiceStats,
    fetchInvoiceList,
    fetchInvoiceItems,
    fetchProductBreakdown,
    fetchProducts,
    fetchProductDetail,

    // Shared utilities (used by fatura-chat.js)
    _resolveApplyFiltersArgs,
    _resolveStockFilterArgs,
    _fetchFilterOptions,
    _bestMatchList,
    _safeDate,
    _norm,
};