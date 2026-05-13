// Backend API iletişim katmanı
// Sadece fetch çağrıları ve veri cache'leme — DOM'a dokunmaz.

// ─── Ürün kodu / kategori cache ───────────────────────────────────────────────

async function ensureProductCodeLookupSetLoaded(force = false) {
    const now = Date.now();
    const fresh = productCodeLookupSet && (now - productCodeLookupFetchedAt) < PRODUCT_CODE_CACHE_TTL_MS;
    if (!force && fresh) return;
    if (productCodeLookupPromise) {
        await productCodeLookupPromise;
        return;
    }

    productCodeLookupPromise = (async () => {
        const res = await fetch('/api/products/codes');
        if (!res.ok) throw new Error('Ürün kod listesi alınamadı');
        const json = await res.json();
        const codes = Array.isArray(json?.codes) ? json.codes : [];
        productCodeLookupSet = new Set(
            codes.map((x) => normalizeProductCodeForMatch(x)).filter(Boolean)
        );
        productCodeLookupFetchedAt = Date.now();
    })();

    try {
        await productCodeLookupPromise;
    } finally {
        productCodeLookupPromise = null;
    }
}

async function ensureProductCategoryLookupLoaded(force = false) {
    const now = Date.now();
    const fresh = productCategoryOptionList.length > 0 && (now - productCategoryFetchedAt) < PRODUCT_CODE_CACHE_TTL_MS;
    if (!force && fresh) return;
    if (productCategoryPromise) {
        await productCategoryPromise;
        return;
    }
    productCategoryPromise = (async () => {
        const res = await fetch('/api/products/category-map');
        if (!res.ok) throw new Error('Ürün kategori listesi alınamadı');
        const json = await res.json();
        const rows = Array.isArray(json?.rows) ? json.rows : [];
        const categories = Array.isArray(json?.categories) ? json.categories : [];
        productCategoryByCodeMap = new Map(
            rows
                .map((r) => [normalizeProductCodeForMatch(r?.product_code), String(r?.category || '').trim()])
                .filter(([k]) => !!k)
        );
        productCategoryOptionList = categories
            .map((x) => String(x || '').trim())
            .filter(Boolean);
        productCategoryFetchedAt = Date.now();
    })();
    try {
        await productCategoryPromise;
    } finally {
        productCategoryPromise = null;
    }
}

// ─── Stok / FIFO cache ────────────────────────────────────────────────────────

let _stocksSummaryCache = null;
let _stocksSummaryFetchedAt = 0;
const STOCKS_CACHE_TTL_MS = 5 * 60 * 1000;

async function ensureStocksSummaryLoaded() {
    const now = Date.now();
    if (_stocksSummaryCache && (now - _stocksSummaryFetchedAt) < STOCKS_CACHE_TTL_MS) return;
    const res = await fetch('/api/stocks/summary');
    if (!res.ok) throw new Error('Stok özeti alınamadı');
    _stocksSummaryCache = await res.json();
    _stocksSummaryFetchedAt = Date.now();
}

// ─── Toplu yükleme VKN ────────────────────────────────────────────────────────

async function ensureBulkInokasVkn() {
    if (bulkInokasVkn) return bulkInokasVkn;
    // Tekli kayıtla aynı kaynak: sunucu .env → ana sayfaya enjekte (GET /); ayrı API şart değil
    const fromPage = typeof window !== 'undefined' ? window.__INOKAS_VKN__ : '';
    const direct = String(fromPage || '').trim();
    if (direct) {
        bulkInokasVkn = direct;
        return bulkInokasVkn;
    }
    let r;
    try {
        r = await fetch('/api/inokas-vkn');
    } catch (e) {
        throw new Error('İnokas VKN yok. Sayfayı `node index.js` ile sunulan adresten açın (ör. http://localhost:3000) ve .env içinde INOKAS_VKN olduğundan emin olun; sunucuyu yeniden başlatın.');
    }
    if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(
            j.error ||
                'İnokas VKN alınamadı. Sunucuda INOKAS_VKN tanımlı mı kontrol edin (.env proje kökünde, sunucuyu yeniden başlatın).'
        );
    }
    const j = await r.json();
    bulkInokasVkn = String(j.vkn || '').trim();
    if (!bulkInokasVkn) throw new Error('İnokas VKN boş.');
    return bulkInokasVkn;
}

// ─── Ana veri yükleme ─────────────────────────────────────────────────────────

async function refreshData(forceFetch = false) {
    if (!forceFetch) {
        const cachedInvoices = readInvoicesFromSession();
        if (cachedInvoices !== null) {
            allInvoicesCache = cachedInvoices;
            renderCurrentView();
            return;
        }
    }

    const cardList = document.getElementById('invoiceCardList');
    if (cardList) cardList.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:13px;">Yükleniyor...</div>';

    try {
        const invRes = await fetch(`/api/invoices`);
        if (!invRes.ok) throw new Error("Veriler çekilemedi");

        allInvoicesCache = await invRes.json();
        writeInvoicesToSession(allInvoicesCache);
        renderCurrentView();

    } catch (error) {
        console.error("Tablo Yenileme Hatası:", error);
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Veriler yüklenirken hata oluştu!</td></tr>';
    }
}

// ─── ADD THESE TO api.js ─────────────────────────────────────────────────────

// ─── Brand / Model cache ──────────────────────────────────────────────────────
let _brandOptions   = [];          // ['ASUS', 'EPSON', 'HP', ...]
let _modelsByBrand  = new Map();   // Map { 'HP' => ['HP LaserJet Pro', ...] }
let _brandModelFetchedAt = 0;
let _brandModelPromise   = null;
const BRAND_MODEL_TTL_MS = 5 * 60 * 1000;

async function ensureBrandModelLoaded(force = false) {
    const now   = Date.now();
    const fresh = _brandOptions.length > 0 && (now - _brandModelFetchedAt) < BRAND_MODEL_TTL_MS;
    if (!force && fresh) return;
    if (_brandModelPromise) { await _brandModelPromise; return; }

    _brandModelPromise = (async () => {
        const res = await fetch('/api/products');
        if (!res.ok) throw new Error('Ürün listesi alınamadı');
        const products = await res.json();

        const brands   = new Set();
        const byBrand  = new Map();

        (products || []).forEach(p => {
            const brand = String(p.brand || '').trim();
            const model = String(p.model || '').trim();
            if (brand) {
                brands.add(brand);
                if (model) {
                    if (!byBrand.has(brand)) byBrand.set(brand, new Set());
                    byBrand.get(brand).add(model);
                }
            }
        });

        _brandOptions  = [...brands].sort((a,b) => a.localeCompare(b,'tr'));
        _modelsByBrand = new Map([...byBrand.entries()].map(([b, ms]) => [b, [...ms].sort((a,b) => a.localeCompare(b,'tr'))]));
        _brandModelFetchedAt = Date.now();
    })();

    try { await _brandModelPromise; }
    finally { _brandModelPromise = null; }
}

// ─── Save new category to a product by SKU ───────────────────────────────────
async function saveNewCategoryToProduct(sku, category) {
    if (!sku || !category) return;
    try {
        const res = await fetch(`/api/products/by-code?code=${encodeURIComponent(sku)}`);
        if (!res.ok) return; // product not found, skip silently
        const product = await res.json();
        if (!product?.id) return;

        await fetch(`/api/products/${product.id}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ category })
        });

        // Update local cache
        if (!productCategoryOptionList.includes(category)) {
            productCategoryOptionList.push(category);
            productCategoryOptionList.sort((a,b) => a.localeCompare(b,'tr'));
        }
        const normalSku = normalizeProductCodeForMatch(sku);
        if (normalSku) productCategoryByCodeMap.set(normalSku, category);
    } catch (e) {
        console.warn('Kategori kaydedilemedi:', e.message);
    }
}
