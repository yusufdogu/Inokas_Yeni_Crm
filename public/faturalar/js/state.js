// ─── FATURALAR — GLOBAL STATE ─────────────────────────────────────────────────
// Bu dosya tüm modül-seviyesi değişkenleri tutar.
// Diğer dosyalar (list.js, detail.js, main.js) bu değişkenlere global olarak erişir.

let _invoiceTabList = [];  // [{ id, invoiceNo, direction }]

// ─── Ürün kodu lookup cache ────────────────────────────────────────────────────
const PRODUCT_CODE_CACHE_TTL_MS = 5 * 60 * 1000;
let productCodeLookupSet = null;
let productCodeLookupFetchedAt = 0;
let productCodeLookupPromise = null;
let productCategoryByCodeMap = new Map();
let productCategoryOptionList = [];
let _internalCategoryOptions = [];
let productCategoryFetchedAt = 0;
let productCategoryPromise = null;

// ─── Temel uygulama state'i ───────────────────────────────────────────────────
let currentParsedData = null;
let currentView = 'giden';
let isInvoiceSaveInFlight = false;

// ─── Fatura sekme sistemi ─────────────────────────────────────────────────────
let activeTabKey = 'list';      // 'list' | invoice_id
let activeDetailTab = {};       // {[invId]: 'bilgiler'|'urunler'|'odemeler'}
let _detailXmlCache = {};       // {[invId]: xmlText}
let _lastListInvoices = [];

// ─── Liste sıralama ───────────────────────────────────────────────────────────
let fatListSort = { col: 'date', dir: 'desc' };

// ─── Tam ekran detay sayfası navigasyon state'i ───────────────────────────────
let _fatDetailList = [];   // mevcut filtreli+sıralı liste


// ─── Tag filter instances ──────────────────────────────────────────────────────

let _FAT_PRICE_MAX_RANGE = 10000000;
let _FAT_PRICE_MIN_RANGE = 0;


let _fatAdvancedOpen = false;

let _fatDatePreset = '';   // 'month' | 'q' | 'year' | 'custom' | ''


// ─── Active filters object ────────────────────────────────────────────────────
window._fatActiveFilters = {};

// ─── Sekme göster/gizle state'i ──────────────────────────────────────────────
const showAllState    = { gelen: false, giden: false };
const interactedState = { gelen: false, giden: false };

function isShowAll()    { return showAllState[currentView]; }
function hasInteracted(){ return interactedState[currentView]; }
function setShowAll(v)  { showAllState[currentView] = v; }
function setInteracted(v){ interactedState[currentView] = v; }

// ─── Fatura cache ─────────────────────────────────────────────────────────────
let allInvoicesCache = null;
let currentDetailInvId = null;

// ─── Bekleyen faturalar state'i ───────────────────────────────────────────────
let bekleyenCache    = [];
let activeBekId      = null;
let _bekPdfCache     = {};


// ─── Bekleyen siparişler (backorder) ─────────────────────────────────────────
let currentPendingOrders = [];

// ─── Toplu yükleme state'i ────────────────────────────────────────────────────
let bulkTenantVkn = null;
let bulkIncoming     = [];
let bulkOutgoing     = [];
let bulkFailed       = [];


async function applyFiltersAndFetch() {
    if (window._suppressFilterFetch) return;
    window._fatActiveFilters = {
        priceMin:  _fatPriceMin,
        priceMax:  _fatPriceMax ,
        dateStart: document.getElementById('filterDateStart')?.value || '',
        dateEnd:   document.getElementById('filterDateEnd')?.value   || '',
        currency:  document.getElementById('filterCurrency')?.value  || '',
        invoiceNumbers: _fatInvoiceNoFilter?.getSelected() || [],
        companies: window._fatCompanyFilter?.getSelected()  || [],
        brands:    _fatBrandFilter?.getSelected()    || [],
        categories:_fatCategoryFilter?.getSelected() || [],
        products:  _fatProductFilter?.getSelected()  || [],
        sortBy:    fatListSort.col === 'company' ? 'company_name'
                 : fatListSort.col === 'total'   ? 'total'
                 : 'invoice_date',
        sortDir:   fatListSort.dir,
    };

    console.log('[applyAndFetch] built _fatActiveFilters:', window._fatActiveFilters);
    saveFilterState();
    _currentPage = 1;

    // Run both in parallel, don't block one on the other
    await Promise.all([
      initInvoiceView(false),
    ]);

    updateAdvancedBadge()
}

function _filterKey(tab) {
  const tid = sessionStorage.getItem('login_tenant_id') || 'default';
  return `fat_filters_${tid}_${tab}`;
}

function restoreFilterState(tab) {
  try {
    const raw = sessionStorage.getItem(_filterKey(tab));
    const state = raw ? JSON.parse(raw) : {};

    window._fatActiveFilters = state.filters || {};

    // Always reset these — don't skip when empty
    const dsEl = document.getElementById('filterDateStart');
    const deEl = document.getElementById('filterDateEnd');
    const curEl = document.getElementById('filterCurrency');
    if (dsEl)  dsEl.value  = state.dateStart || '';
    if (deEl)  deEl.value  = state.dateEnd   || '';
    if (curEl) curEl.value = state.currency  || '';

    _currentPage = state.page || 1;

    // Update date pill display
    const dateDisp = document.getElementById('dateDisplay');
    const datePill = document.getElementById('datePill');
    if (state.dateStart && state.dateEnd) {
      _fatCalCtx.selStart = new Date(state.dateStart);
      _fatCalCtx.selEnd   = new Date(state.dateEnd);
      const fmt = dt => dt.toLocaleDateString('tr-TR', { day:'numeric', month:'short' });
      if (dateDisp) dateDisp.textContent = `${fmt(_fatCalCtx.selStart)} – ${fmt(_fatCalCtx.selEnd)}`;
      datePill?.classList.add('active');
    } else {
      _fatCalCtx.selStart = null;
      _fatCalCtx.selEnd   = null;
      if (dateDisp) dateDisp.textContent = 'Tüm zamanlar';
      datePill?.classList.remove('active');
    }
    if (typeof buildFilterCals === 'function') buildFilterCals();

    // Update price pill from saved filters
    const f = window._fatActiveFilters;
    _fatPriceMin = (f.priceMin != null) ? f.priceMin : null;
    _fatPriceMax = (f.priceMax != null) ? f.priceMax : null;

    updateFilterPriceSlider();


    window._pendingTagRestore = {
      invoiceNumbers: state.invoiceNumbers || [],
      companies:  state.companies  || [],
      brands:     state.brands     || [],
      categories: state.categories || [],
      products:   state.products   || [],
    };
  } catch(e) {}
}

function restoreTagFilters() {
  const pending = window._pendingTagRestore;
  if (!pending) return;

  window._restoringFilters = true;

  if (_fatInvoiceNoFilter) pending.invoiceNumbers.forEach(v => _fatInvoiceNoFilter._forceSelect(v));
  if (_fatCompanyFilter)  pending.companies.forEach(v  => _fatCompanyFilter._forceSelect(v));
  if (_fatBrandFilter)    pending.brands.forEach(v     => _fatBrandFilter._forceSelect(v));
  if (_fatCategoryFilter) pending.categories.forEach(v => _fatCategoryFilter._forceSelect(v));
  if (_fatProductFilter)  pending.products.forEach(v   => _fatProductFilter._forceSelect(v));

  window._restoringFilters = false;
  window._pendingTagRestore = null;

  // Sync _fatActiveFilters from restored tag state
  window._fatActiveFilters = {
    ...( window._fatActiveFilters || {}),
    invoiceNumbers: _fatInvoiceNoFilter?.getSelected() || [],
    companies:  _fatCompanyFilter?.getSelected()  || [],
    brands:     _fatBrandFilter?.getSelected()    || [],
    categories: _fatCategoryFilter?.getSelected() || [],
    products:   _fatProductFilter?.getSelected()  || [],
  };

  updateAdvancedBadge()
}


function _hasActiveFilters() {
    const f = window._fatActiveFilters || {};

    // Any tag list with content
    if (f.companies?.length)      return true;
    if (f.brands?.length)         return true;
    if (f.categories?.length)     return true;
    if (f.products?.length)       return true;
    if (f.invoiceNumbers?.length) return true;

    // Date range
    if (f.dateStart || f.dateEnd) return true;

    // Price range
    if (f.priceMin != null || f.priceMax != null) return true;

    // Currency
    if (f.currency) return true;

    return false;
}

// ── KPI DELTAS (last 30d vs previous 30d) ────────────────────────────────────
async function refreshKpiSummary() {
  try {
    //renderKpiSkeleton('kpiCard');
    const params = new URLSearchParams();
    const f = window._fatActiveFilters || {};

    if (currentView === 'gelen') params.set('direction', 'INCOMING');
    if (currentView === 'giden') params.set('direction', 'OUTGOING');
    if (window._FAT_PENDING)     params.set('pending', 'true');

    if (f.invoiceNumbers?.length) params.set('invoice_numbers', f.invoiceNumbers.join(','));
    if (f.dateStart)          params.set('date_start',  f.dateStart);
    if (f.dateEnd)            params.set('date_end',    f.dateEnd);
    if (f.priceMin != null) params.set('price_min', f.priceMin);
    if (f.priceMax != null) params.set('price_max', f.priceMax);
    if (f.search)             params.set('search',      f.search);
    if (f.currency) params.set('currency', f.currency);
    if (f.companies?.length)  params.set('companies',   f.companies.join(','));
    if (f.brands?.length)     params.set('brands',      f.brands.join(','));
    if (f.categories?.length) params.set('categories',  f.categories.join(','));
    if (f.products?.length)   params.set('products',    f.products.join(','));
    if (f.models?.length)     params.set('models',      f.models.join(','));

    const res  = await fetch(`/api/invoices/kpi-summary?${params.toString()}`);
    const data = await res.json();

    console.log('kpi data:', data); // ← temporary, remove after confirming

    const totals = data?.totals || {};
    const fmt = (n, cur) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0);
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setVal('kpiTryTotal', fmt(totals.try_total, 'TRY'));
    setVal('kpiUsdTotal', fmt(totals.usd_total, 'USD'));
    setVal('kpiEurTotal', fmt(totals.eur_total, 'EUR'));
    setVal('kpiCount', (totals.total_count || 0).toLocaleString('tr-TR'));
    setVal('kpiCompanyCount', (totals.company_count || 0).toLocaleString('tr-TR'));

    if (_hasActiveFilters()) {
        _clearKpiDeltas();
    } else {
        _refreshKpiDeltas();
    }

  } catch (err) {
    console.error('refreshKpiSummary hatası:', err.message);
  }
}

async function _refreshKpiDeltas() {
    try {
        const params = new URLSearchParams();
        if (currentView === 'gelen') params.set('direction', 'INCOMING');
        if (currentView === 'giden') params.set('direction', 'OUTGOING');

        const res  = await fetch(`/api/invoices/kpi-deltas?${params.toString()}`);
        const data = await res.json();

        const cur = data.current  || {};
        const prv = data.previous || {};

        _setKpiDeltaBadge('kpiCountDelta',        cur.count,         prv.count);
        _setKpiDeltaBadge('kpiCompanyCountDelta', cur.company_count, prv.company_count);
        _setKpiDeltaBadge('kpiTryTotalDelta',     cur.try_total,     prv.try_total);
        _setKpiDeltaBadge('kpiUsdTotalDelta',     cur.usd_total,     prv.usd_total);
        _setKpiDeltaBadge('kpiEurTotalDelta',     cur.eur_total,     prv.eur_total);

    } catch (err) {
        console.error('_refreshKpiDeltas hatası:', err.message);
        _clearKpiDeltas();
    }
}

function _setKpiDeltaBadge(id, current, previous) {
    const el = document.getElementById(id);
    if (!el) return;

    current  = parseFloat(current)  || 0;
    previous = parseFloat(previous) || 0;

    // Case 1: previous 0 and current 0 → hide
    if (previous === 0 && current === 0) {
        el.style.display = 'none';
        return;
    }

    // Case 2: previous 0 and current > 0 → "yeni" badge
    if (previous === 0 && current > 0) {
        el.className = 'kpi-delta kpi-delta--new';
        el.textContent = 'yeni';
        el.style.display = 'inline-flex';
        return;
    }

    // Case 3: real delta
    const pct = ((current - previous) / previous) * 100;

    // Hide tiny changes (visual noise)
    if (Math.abs(pct) < 0.5) {
        el.className = 'kpi-delta kpi-delta--neutral';
        el.innerHTML = `<i class="ti ti-minus"></i>0%`;
        el.style.display = 'inline-flex';
        return;
    }

    const sign  = pct > 0 ? '+' : '';
    const cls   = pct > 0 ? 'kpi-delta--up' : 'kpi-delta--down';
    const icon  = pct > 0 ? 'ti-trending-up' : 'ti-trending-down';
    const value = Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(1);

    // Preserve size modifier
    const isSm = el.classList.contains('kpi-delta--sm');
    el.className = `kpi-delta ${cls}${isSm ? ' kpi-delta--sm' : ''}`;
    el.innerHTML = `<i class="ti ${icon}"></i>${sign}${value}%`;
    el.style.display = 'inline-flex';
}

function _clearKpiDeltas() {
    ['kpiCountDelta', 'kpiCompanyCountDelta', 'kpiTryTotalDelta', 'kpiUsdTotalDelta', 'kpiEurTotalDelta']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
}

// ─── Shared tag-filter onChange ───────────────────────────────────────────────
function _onTagFilterChange(advanced = false) {
    if (window._suppressFilterFetch) return;
    setInteracted(true);
    if (isShowAll()) {
        setShowAll(false);
        const btn = document.getElementById('btnToggleShowAll');
        if (btn) btn.innerText = 'Tümünü Göster';
    }
    applyFiltersAndFetch();
}

// ─── Init tag filters (called from main.js after DOMContentLoaded) ────────────
function initFatFilters() {
  // Variable declaration
  window._fatInvoiceNoFilter = createTagFilter({
     wrapId: 'invoiceNoTagsWrap',
     inputId: 'invoiceNoTagInput',
     dropdownId: 'invoiceNoDropdown',
     getOptions: () => _getDependentOptions('invoiceNo'),
     onChange: () => _onTagFilterChange(false),
  });

  window._fatCompanyFilter = createTagFilter({
    wrapId: 'companyTagsWrap', inputId: 'companyTagInput', dropdownId: 'companyDropdown',
    getOptions: () => _getDependentOptions('company'),
    onChange: () => _onTagFilterChange(false),
  });

  window._fatBrandFilter = createTagFilter({
    wrapId: 'brandTagsWrap', inputId: 'brandTagInput', dropdownId: 'brandDropdown',
    getOptions: () => _getDependentOptions('brand'),
    onChange: () => _onTagFilterChange(true),
  });

  window._fatCategoryFilter = createTagFilter({
    wrapId: 'categoryTagsWrap', inputId: 'categoryTagInput', dropdownId: 'categoryDropdown',
    getOptions: () => _getDependentOptions('category'),
    onChange: () => _onTagFilterChange(true),
  });

  window._fatProductFilter = createTagFilter({
    wrapId: 'productTagsWrap', inputId: 'productTagInput', dropdownId: 'productDropdown',
    getOptions: () => _getDependentOptions('product'),
    onChange: () => _onTagFilterChange(true),
  });

  initFilterPopovers();
  buildFilterCals();
}

function _getDependentOptions(field) {
    const rels = window._fatFilterOptions?.relationships || [];

    const selectedInvoiceNos = _fatInvoiceNoFilter?.getSelected() || [];
    const selectedCompanies  = _fatCompanyFilter?.getSelected()   || [];
    const selectedBrands     = _fatBrandFilter?.getSelected()     || [];
    const selectedCategories = _fatCategoryFilter?.getSelected()  || [];
    const selectedProducts   = _fatProductFilter?.getSelected()   || [];

    const hasConstraints =
        (field !== 'invoiceNo' && selectedInvoiceNos.length)  ||
        (field !== 'company'   && selectedCompanies.length)   ||
        (field !== 'brand'     && selectedBrands.length)      ||
        (field !== 'category'  && selectedCategories.length)  ||
        (field !== 'product'   && selectedProducts.length);

    const allKey = {
        invoiceNo: 'invoiceNumbers',
        company:   'companies',
        brand:     'brands',
        category:  'categories',
        product:   'products'
    }[field];

    const all = window._fatFilterOptions?.[allKey] || [];

    if (!hasConstraints) return all;

    const matched = new Set(
        rels
            .filter(r =>
                (field === 'invoiceNo' || !selectedInvoiceNos.length || selectedInvoiceNos.includes(r.invoiceNo)) &&
                (field === 'company'   || !selectedCompanies.length  || selectedCompanies.includes(r.company))    &&
                (field === 'brand'     || !selectedBrands.length     || selectedBrands.includes(r.brand))         &&
                (field === 'category'  || !selectedCategories.length || selectedCategories.includes(r.category))  &&
                (field === 'product'   || !selectedProducts.length   || selectedProducts.includes(r.product))
            )
            .map(r => r[field])
            .filter(Boolean)
    );

    return all.filter(o => matched.has(o));
}




function saveFilterState() {
  const state = {
    filters:    window._fatActiveFilters || {},
    invoiceNumbers:  _fatInvoiceNoFilter?.getSelected()  || [],
    companies:  _fatCompanyFilter?.getSelected()  || [],
    brands:     _fatBrandFilter?.getSelected()    || [],
    categories: _fatCategoryFilter?.getSelected() || [],
    products:   _fatProductFilter?.getSelected()  || [],
    dateStart:  document.getElementById('filterDateStart')?.value || '',
    dateEnd:    document.getElementById('filterDateEnd')?.value   || '',
    currency:   document.getElementById('filterCurrency')?.value  || '',
    page:       _currentPage,
  };
  try {
    sessionStorage.setItem(_filterKey(_activeMainTab), JSON.stringify(state));
  } catch(e) {}
}

function clearAllFilters() {
    _fatInvoiceNoFilter?.clear();
    _fatCompanyFilter?.clear();
    _fatProductFilter?.clear();
    _fatCategoryFilter?.clear();
    _fatBrandFilter?.clear();

    // Date
    _fatDatePreset   = '';
    _fatCalCtx.selStart = null;
    _fatCalCtx.selEnd   = null;
    const dsEl = document.getElementById('filterDateStart');
    const deEl = document.getElementById('filterDateEnd');
    if (dsEl) dsEl.value = '';
    if (deEl) deEl.value = '';
    const dateDisp = document.getElementById('dateDisplay');
    if (dateDisp) dateDisp.textContent = 'Tüm zamanlar';
    document.querySelectorAll('#datePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
    const datePill = document.getElementById('datePill');
    if (datePill) datePill.classList.remove('active');
    buildFilterCals();

    // Price
    _fatPriceMin = null;
    _fatPriceMax = null;

    const priceDisp = document.getElementById('priceDisplay');
    if (priceDisp) priceDisp.textContent = 'Tüm tutarlar';
    document.querySelectorAll('#pricePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
    const pricePill = document.getElementById('pricePill');
    if (pricePill) pricePill.classList.remove('active');
    const minEl = document.getElementById('filterMinPrice');
    const maxEl = document.getElementById('filterMaxPrice');
    if (minEl) minEl.value = '';
    if (maxEl) maxEl.value = '';

    const ids = ['filterStatus', 'filterCurrency', 'mainSearch'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    applyFiltersAndFetch();
    updateAdvancedBadge();
}


// ─── Price picker ─────────────────────────────────────────────────────────────

async function toggleFilterPop(popId, pillId) {
    const pop  = document.getElementById(popId);
    const pill = document.getElementById(pillId);
    if (!pop || !pill) return;

    const wasOpen = pop.classList.contains('open');

    // Close all
    document.querySelectorAll('.filter-popover').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('open'));

    if (!wasOpen) {
        pop.classList.add('open');
        pill.classList.add('open');

        // Now that it's open, load data for specific popovers
        if (popId === 'pricePop') {
            await loadPriceRange();
            updateFilterPriceSlider();
        }
    }
}
async function loadPriceRange() {
    const params = new URLSearchParams();
    if (currentView === 'gelen') params.set('direction', 'INCOMING');
    if (currentView === 'giden') params.set('direction', 'OUTGOING');

    const res = await fetch(`/api/invoices/price-histogram?${params.toString()}`);
    const data = await res.json();

    // Set the slider's track bounds from real data
    _FAT_PRICE_MIN_RANGE = data.min ;
    _FAT_PRICE_MAX_RANGE = data.max ;

    //_priceHistogramBins = data.bins;
    //renderFilterHistogram(_priceHistogramBins);

    document.getElementById('filterMinPrice').placeholder = _FAT_PRICE_MIN_RANGE.toString();
    document.getElementById('filterMaxPrice').placeholder = _FAT_PRICE_MAX_RANGE.toString();
}

function updateFilterPriceSlider() {
    const disp      = document.getElementById('priceDisplay');
    const pricePill = document.getElementById('pricePill');
    const minEl     = document.getElementById('filterMinPrice');
    const maxEl     = document.getElementById('filterMaxPrice');

    const hasFilter = (_fatPriceMin != null || _fatPriceMax != null);

    // ── Sync chip active state ────────────────────────────────────────────
    document.querySelectorAll('#pricePop .filter-preset-chip').forEach(c => {
        c.classList.remove('active');
    });

    if (hasFilter) {
        // Match the chip whose min/max matches current values
        const matchChip = document.querySelector(
            `#pricePop .filter-preset-chip[onclick*="setFilterPriceBucket(this,${_fatPriceMin},${_fatPriceMax})"]`
        );
        matchChip?.classList.add('active');
    }
    // ──────────────────────────────────────────────────────────────────────

    if (!hasFilter) {
        if (disp)      disp.textContent = 'Tüm tutarlar';
        if (pricePill) pricePill.classList.remove('active');
        if (minEl)     minEl.value = '';
        if (maxEl)     maxEl.value = '';
    } else {
        const fmt = v => (v == null) ? '∞' : (v >= 1000 ? Math.round(v / 1000) + 'K' : v);
        if (disp)      disp.textContent = `${fmt(_fatPriceMin)} – ${fmt(_fatPriceMax)}`;
        if (pricePill) pricePill.classList.add('active');
        if (minEl && _fatPriceMin != null) minEl.value = _fatPriceMin;
        if (maxEl && _fatPriceMax != null) maxEl.value = _fatPriceMax;
    }
}

function setFilterPriceBucket(el, min, max) {
    // If this preset is already active, deactivate it
    if (el.classList.contains('active')) {
        el.classList.remove('active');
        _fatPriceMin = null;
        _fatPriceMax = null;
        updateFilterPriceSlider();
        applyFiltersAndFetch();
        return;
    }

    // Apply the new preset
    document.querySelectorAll('#pricePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    _fatPriceMin = min;
    if (max==null){
        _fatPriceMax=_FAT_PRICE_MAX_RANGE
    }
    else{
        _fatPriceMax=max
    }
    updateFilterPriceSlider();
    applyFiltersAndFetch();
}


function onPriceInputChange() {
    const minEl = document.getElementById('filterMinPrice');
    const maxEl = document.getElementById('filterMaxPrice');

    const minRaw = (minEl?.value || '').trim();
    const maxRaw = (maxEl?.value || '').trim();

    _fatPriceMin = minRaw ? parseInt(minRaw.replace(/\D/g, '')) : null;
    _fatPriceMax = maxRaw ? parseInt(maxRaw.replace(/\D/g, '')) : null;

    updateFilterPriceSlider();
    applyFiltersAndFetch();
}

function renderFilterHistogram(bins) {
    const el = document.getElementById('filterHistogram');
    if (!el || !bins) return;
    const max = Math.max(...bins.map(b => b.count));
    el.innerHTML = bins.map(b => {
        const inRange = b.rangeStart >= _fatPriceMin && b.rangeEnd <= _fatPriceMax;
        const h = max > 0 ? (b.count / max) * 100 : 0;
        return `<div class="filter-hbar${inRange ? ' in' : ''}" style="height:${h}%"></div>`;
    }).join('');
}






