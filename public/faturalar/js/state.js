// ─── FATURALAR — GLOBAL STATE ─────────────────────────────────────────────────
// Bu dosya tüm modül-seviyesi değişkenleri tutar.
// Diğer dosyalar (list.js, detail.js, main.js) bu değişkenlere global olarak erişir.

const FATURALAR_BUILD = '20260423-po-integration';
console.info('[faturalar] bundle', FATURALAR_BUILD);

// Her sekmenin (gelen/giden) filtre hafızası
const filterMemory = {
    gelen: { search: '', company: '', currency: '', year: '', month: '', status: '', category: '', product: '' },
    giden: { search: '', company: '', currency: '', year: '', month: '', status: '', category: '', product: '' }
};

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
let currentView = 'gelen';
let isInvoiceSaveInFlight = false;

// ─── Fatura sekme sistemi ─────────────────────────────────────────────────────
let openInvoiceTabs = [];       // [{id, invoiceNo}]
let activeTabKey = 'list';      // 'list' | invoice_id
let activeDetailTab = {};       // {[invId]: 'bilgiler'|'urunler'|'odemeler'}
let _detailPdfLoaded = {};
let _detailXmlCache = {};       // {[invId]: xmlText}
let _lastListInvoices = [];

// ─── Liste sıralama ───────────────────────────────────────────────────────────
let fatListSort = { col: 'date', dir: 'desc' };

// ─── Tam ekran detay sayfası navigasyon state'i ───────────────────────────────
let _fatDetailList = [];   // mevcut filtreli+sıralı liste

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
const INVOICE_CACHE_KEY    = 'inokas_invoices_cache_v2';
const FILTER_STATE_KEY     = 'inokas_filter_state_v1';


// ─── Bekleyen faturalar state'i ───────────────────────────────────────────────
let bekleyenCache    = [];
let activeBekId      = null;
let _bekPdfCache     = {};

// ─── Eski detay tab state'i (artık aktif değil, geriye uyumluluk) ─────────────
let lastActiveDetailTab = 1;

// ─── Bekleyen siparişler (backorder) ─────────────────────────────────────────
let currentPendingOrders = [];

// ─── Toplu yükleme state'i ────────────────────────────────────────────────────
let bulkTenantVkn = null;
let bulkIncoming     = [];
let bulkOutgoing     = [];
let bulkFailed       = [];


function _filterKey(tab) {
  const tid = sessionStorage.getItem('inokas_tenant_id') || 'default';
  return `fat_filters_${tid}_${tab}`;
}


function saveFilterState() {
  const state = {
    filters:    window._fatActiveFilters || {},
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

function restoreFilterState(tab) {
  try {
    const raw = sessionStorage.getItem(_filterKey(tab));
    if (!raw) return;
    const state = JSON.parse(raw);

    window._fatActiveFilters = state.filters || {};

    if (state.dateStart) {
      const el = document.getElementById('filterDateStart');
      if (el) el.value = state.dateStart;
    }
    if (state.dateEnd) {
      const el = document.getElementById('filterDateEnd');
      if (el) el.value = state.dateEnd;
    }
    if (state.currency) {
      const el = document.getElementById('filterCurrency');
      if (el) el.value = state.currency;
    }
    if (state.page) _currentPage = state.page;

    window._pendingTagRestore = {
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

  if (_fatCompanyFilter)  pending.companies.forEach(v  => _fatCompanyFilter._forceSelect(v));
  if (_fatBrandFilter)    pending.brands.forEach(v     => _fatBrandFilter._forceSelect(v));
  if (_fatCategoryFilter) pending.categories.forEach(v => _fatCategoryFilter._forceSelect(v));
  if (_fatProductFilter)  pending.products.forEach(v   => _fatProductFilter._forceSelect(v));

  window._restoringFilters = false;
  window._pendingTagRestore = null;

  // Sync _fatActiveFilters from restored tag state
  window._fatActiveFilters = {
    ...( window._fatActiveFilters || {}),
    companies:  _fatCompanyFilter?.getSelected()  || [],
    brands:     _fatBrandFilter?.getSelected()    || [],
    categories: _fatCategoryFilter?.getSelected() || [],
    products:   _fatProductFilter?.getSelected()  || [],
  };
}




function clearFilterUI() {
  // Clear tag filters visually
  _fatCompanyFilter?.clear();
  _fatBrandFilter?.clear();
  _fatCategoryFilter?.clear();
  _fatProductFilter?.clear();

  // Clear date/currency inputs
  const dateStart = document.getElementById('filterDateStart');
  const dateEnd   = document.getElementById('filterDateEnd');
  const currency  = document.getElementById('filterCurrency');
  const search    = document.getElementById('mainSearch');
  if (dateStart) dateStart.value = '';
  if (dateEnd)   dateEnd.value   = '';
  if (currency)  currency.value  = '';
  if (search)    search.value    = '';

  // Reset active filters object
  window._fatActiveFilters = {};
}



async function refreshKpiSummary() {
  try {
    const params = new URLSearchParams();
    const f = window._fatActiveFilters || {};

    if (currentView === 'gelen') params.set('direction', 'INCOMING');
    if (currentView === 'giden') params.set('direction', 'OUTGOING');
    if (window._FAT_PENDING)     params.set('pending', 'true');

    if (f.dateStart)          params.set('date_start',  f.dateStart);
    if (f.dateEnd)            params.set('date_end',    f.dateEnd);
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

    const bar = document.getElementById('fatKpiBar');
    if (!bar || _activeMainTab === 'genel') return;
    bar.style.display = 'flex';

    const totals = data?.totals || {};
    const fmt = (n, cur) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0);
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setVal('kpiTryTotal', fmt(totals.try_total, 'TRY'));
    setVal('kpiUsdTotal', fmt(totals.usd_total, 'USD'));
    setVal('kpiEurTotal', fmt(totals.eur_total, 'EUR'));


    const hasItemFilter = !!(f.brands?.length || f.categories?.length || f.products?.length);
    setVal('kpiCount', (totals.total_count || 0).toLocaleString('tr-TR'));

    const countLabel = document.querySelector('#kpiCount')?.closest('.fat-kpi-card')?.querySelector('.fat-kpi-label');
    if (countLabel) countLabel.textContent = hasItemFilter ? 'Ürün Adedi' : 'Fatura Adedi';

  } catch (err) {
    console.error('refreshKpiSummary hatası:', err.message);
  }
}