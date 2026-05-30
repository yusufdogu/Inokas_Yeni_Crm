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
let _fatDetailIdx  = -1;   // açık faturanın indeksi

// in state.js
let _restoringFilters = false;

// ─── Active filters object ────────────────────────────────────────────────────
window._fatActiveFilters = {};

// ─── Rapor state'i ───────────────────────────────────────────────────────────
let raporMode = 'gelen';
let raporSort = { col: 'usd', dir: 'desc' };
let _raporOpenDetailTr = null;
let raporFilters = { company: '', dateStart: '', dateEnd: '', product: '' };

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
const INVOICE_CACHE_TTL_MS = 10 * 60 * 1000;

// ─── Ürün dropdown listesi ────────────────────────────────────────────────────
let _productList = [];

// ─── Rapor panel detay satırı ─────────────────────────────────────────────────
let _reportOpenDetailTr = null;

// ─── Bekleyen faturalar state'i ───────────────────────────────────────────────
let bekleyenCache    = [];
let activeBekId      = null;
let activeBekInfoTab = 'bilgiler';
let bekDir = 'gelen';
let _bekPdfCache     = {};
let _bekPageTab      = 'list';

// ─── Rapor filtre dropdown listeleri ─────────────────────────────────────────
let _raporCompList = [];
let _raporProdList = [];

// ─── Firma dropdown listesi ───────────────────────────────────────────────────
let _companyList = [];

// ─── Eski detay tab state'i (artık aktif değil, geriye uyumluluk) ─────────────
let lastActiveDetailTab = 1;

// ─── Bekleyen siparişler (backorder) ─────────────────────────────────────────
let currentPendingOrders = [];

// ─── Toplu yükleme state'i ────────────────────────────────────────────────────
let bulkTenantVkn = null;
let bulkIncoming     = [];
let bulkOutgoing     = [];
let bulkFailed       = [];
let bulkUploadRunning = false;


function saveFilterState() {
  const state = {
    view:       currentView,
    tab:        _activeMainTab,
    filters:    window._fatActiveFilters || {},
    // tag filter selected values
    companies:  _fatCompanyFilter?.getSelected()  || [],
    brands:     _fatBrandFilter?.getSelected()    || [],
    categories: _fatCategoryFilter?.getSelected() || [],
    products:   _fatProductFilter?.getSelected()  || [],
    // date + currency inputs
    dateStart:  document.getElementById('filterDateStart')?.value || '',
    dateEnd:    document.getElementById('filterDateEnd')?.value   || '',
    currency:   document.getElementById('filterCurrency')?.value  || '',
    page:       _currentPage,
  };
  try {
    sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify(state));
  } catch(e) {}
}

function restoreFilterState() {
  try {
    const raw = sessionStorage.getItem(FILTER_STATE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);

    // Restore active filters object
    window._fatActiveFilters = state.filters || {};

    // Restore date + currency inputs
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

    // Restore page
    if (state.page) _currentPage = state.page;

    // Tag filters are restored after initFatFilters() runs — see restoreTagFilters()
    window._pendingTagRestore = {
      companies:  state.companies  || [],
      brands:     state.brands     || [],
      categories: state.categories || [],
      products:   state.products   || [],
    };
  } catch(e) {}
}

// Called from main.js after initFatFilters()
function restoreTagFilters() {
  const pending = window._pendingTagRestore;
  if (!pending) return;

  function restoreOne(filter, values) {
    if (!filter || !values.length) return;
    // Inject selected values directly — clear first
    filter.clear();
    values.forEach(v => {
      // Simulate selection by pushing into selected and re-rendering
      filter._forceSelect(v);
    });
  }

  // _forceSelect needs to be exposed from createTagFilter — see step 3
  if (_fatCompanyFilter)  pending.companies.forEach(v  => _fatCompanyFilter._forceSelect(v));
  if (_fatBrandFilter)    pending.brands.forEach(v     => _fatBrandFilter._forceSelect(v));
  if (_fatCategoryFilter) pending.categories.forEach(v => _fatCategoryFilter._forceSelect(v));
  if (_fatProductFilter)  pending.products.forEach(v   => _fatProductFilter._forceSelect(v));

  window._pendingTagRestore = null;
}