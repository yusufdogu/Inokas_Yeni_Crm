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
const INVOICE_CACHE_KEY         = 'inokas_invoices_cache_v2';
const PAYMENT_CLOSURE_CACHE_KEY = 'inokas_payment_closure_cache_v1';
const FILTER_STATE_KEY          = 'inokas_filter_state_v1';
const INVOICE_CACHE_TTL_MS      = 10 * 60 * 1000;
let paymentClosureMap = {};

// ─── Grafik instance'ları (yeniden render öncesi destroy için) ────────────────
let _dashCharts = {};

// ─── Ürün dropdown listesi ────────────────────────────────────────────────────
let _productList = [];

// ─── Rapor panel detay satırı ─────────────────────────────────────────────────
let _reportOpenDetailTr = null;

// ─── Bekleyen faturalar state'i ───────────────────────────────────────────────
let bekleyenCache    = [];
let activeBekId      = null;
let activeBekInfoTab = 'bilgiler';
let bekDir           = 'all';
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
let bulkInokasVkn    = null;
let bulkIncoming     = [];
let bulkOutgoing     = [];
let bulkFailed       = [];
let bulkUploadRunning = false;
