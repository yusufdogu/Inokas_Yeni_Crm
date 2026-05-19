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

// ─── Pagination state ─────────────────────────────────────────────────────
let _currentPage  = 1;
let _totalPages   = 1;
let _totalCount   = 0;
let _pageLimit    = 10;

async function refreshData(useCache = false) {
    // Refresh filter options when view changes or on first load
    if (!window._filterOptionsLoaded || window._lastFilterView !== currentView) {
      window._lastFilterView      = currentView;
      window._filterOptionsLoaded = true;
      refreshFilterOptions(); // non-blocking
    }
    if (useCache && allInvoicesCache.length > 0) {
    renderCurrentView();
    return;
  }

  try {
    const params = new URLSearchParams();

    // Direction from current view
    if (currentView === 'gelen') params.set('direction', 'INCOMING');
    if (currentView === 'giden') params.set('direction', 'OUTGOING');

    // Pending filter
    const apiUrl = window._FAT_PENDING ? '/api/invoices/pending' : '/api/invoices';

    // Pagination
    params.set('page',  _currentPage);
    params.set('limit', _pageLimit);

    const f = window._fatActiveFilters || {};

    if (f.dateStart)              params.set('date_start',  f.dateStart);
    if (f.dateEnd)                params.set('date_end',    f.dateEnd);
    if (f.currency)               params.set('currency',    f.currency);
    if (f.status)                 params.set('status',      f.status);
    if (f.search)                 params.set('search',      f.search);
    if (f.companies?.length)      params.set('companies',   f.companies.join(','));
    if (f.brands?.length)         params.set('brands',      f.brands.join(','));
    if (f.categories?.length)     params.set('categories',  f.categories.join(','));

    const res  = await fetch(`${apiUrl}?${params.toString()}`);
    const json = await res.json();

    if (window._FAT_PENDING) {
      // Pending still returns array
      allInvoicesCache = Array.isArray(json) ? json : [];
      _totalCount  = allInvoicesCache.length;
      _totalPages  = 1;
    } else {
      allInvoicesCache = json.data        || [];
      _totalCount      = json.total       || 0;
      _totalPages      = json.total_pages || 1;
      _currentPage     = json.page        || 1;
    }

    renderCurrentView();
    renderPagination();
    if (!window._FAT_PENDING) refreshTotals();

  } catch (err) {
    console.error('refreshData hatası:', err.message);
  }
}

window._fatFilterOptions = {
  companies:  [],
  brands:     [],
  products:   [],
  categories: [],
  models:     [],
};

async function refreshFilterOptions() {
  try {
    const params = new URLSearchParams();
    if (currentView === 'gelen') params.set('direction', 'INCOMING');
    if (currentView === 'giden') params.set('direction', 'OUTGOING');

    const res  = await fetch(`/api/invoices/filter-options?${params.toString()}`);
    const data = await res.json();

    window._fatFilterOptions = {
      companies:  data.companies  || [],
      brands:     data.brands     || [],
      products:   data.products   || [],
      categories: data.categories || [],
      models:     data.models     || [],
    };
  } catch (err) {
    console.error('refreshFilterOptions hatası:', err.message);
  }
}

async function refreshTotals() {
  try {
    const params = new URLSearchParams();
    const f = window._fatActiveFilters || {};

    if (currentView === 'gelen') params.set('direction', 'INCOMING');
    if (currentView === 'giden') params.set('direction', 'OUTGOING');
    if (f.dateStart)         params.set('date_start', f.dateStart);
    if (f.dateEnd)           params.set('date_end',   f.dateEnd);
    if (f.currency)          params.set('currency',   f.currency);
    if (f.status)            params.set('status',     f.status);
    if (f.search)            params.set('search',     f.search);
    if (f.companies?.length) params.set('companies',  f.companies.join(','));
    if (f.brands?.length)    params.set('brands',     f.brands.join(','));

    const res  = await fetch(`/api/invoices/totals?${params.toString()}`);
    const data = await res.json();
    if (typeof updateKpiTotals === 'function') updateKpiTotals(data);
  } catch (err) {
    console.error('refreshTotals hatası:', err.message);
  }
}
function goToPage(page) {
  if (page < 1 || page > _totalPages) return;
  _currentPage = page;
  refreshData(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function changeLimit(newLimit) {
  _pageLimit   = parseInt(newLimit) || 10;
  _currentPage = 1;
  refreshData(false);
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
