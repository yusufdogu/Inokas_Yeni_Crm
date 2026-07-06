// ── TAB STATE ────────────────────────────────────────────────────────────────
let _activeMainTab  = 'genel';
let _activeBekTab   = 'genel';

// ── LOADING OVERLAY ──────────────────────────────────────────────────────────
function showLoadingOverlay() {
  const overlay = document.getElementById('fatLoadingOverlay');
  const spinner = document.getElementById('fatLoadingSpinner');
  if (!overlay) return;
  overlay.style.background = 'rgba(248,250,252,0.65)';
  overlay.style.backdropFilter = 'blur(3px)';
  overlay.style.pointerEvents = 'all';
  spinner.style.opacity = '1';
  spinner.style.animation = 'fat-spin 0.7s linear infinite';
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('fatLoadingOverlay');
  const spinner = document.getElementById('fatLoadingSpinner');
  if (!overlay) return;
  overlay.style.background = 'rgba(248,250,252,0)';
  overlay.style.backdropFilter = 'blur(0px)';
  overlay.style.pointerEvents = 'none';
  spinner.style.opacity = '0';
  spinner.style.animation = '';
}

// ── MAIN TAB SWITCHER ────────────────────────────────────────────────────────
function switchMainTab(tab) {
  _activeMainTab = tab;
  history.replaceState(null, '', `?tab=${tab}`);

  if (tab !== 'genel' && typeof _stopInsightAutoCycle === 'function') {
        _stopInsightAutoCycle();
    }

  document.querySelectorAll('.fat-nav-tab').forEach(btn => btn.classList.remove('fat-nav-tab--active'));
  const tabId = { genel: 'navTabGenel', gelen: 'navTabGelen', giden: 'navTabGiden', bekleyen: 'navTabBekleyen' }[tab];
  document.getElementById(tabId)?.classList.add('fat-nav-tab--active');

  const isGenel    = tab === 'genel';
  const isBekleyen = tab === 'bekleyen';
  const isListTab  = tab === 'gelen' || tab === 'giden' || isBekleyen;

  document.getElementById('fatFilterBar').style.display = (isGenel || isBekleyen) ? 'none' : '';
  document.getElementById('fatSubTabBar').style.display = isBekleyen ? '' : 'none';
  document.getElementById('panelGenel').style.display   = isGenel   ? '' : 'none';
  document.getElementById('panelList').style.display    = isListTab ? '' : 'none';

  // ← show/hide instead of remove
  const kpiBar = document.getElementById('fatKpiBar');
  const pagination=document.getElementById('fatPagination');

  const aiPanel = document.getElementById('aiSidePanel');
  if (aiPanel) {
      if (tab === 'genel' || tab === 'giden' || tab === 'gelen') {
          aiPanel.style.display = 'flex';
          aiPanel.classList.toggle('fat-ai-side--wide', tab === 'genel');
          setAiActiveSession(tab);
      } else {
          aiPanel.style.display = 'none';
      }
  }

  if (isGenel) {
    kpiBar.style.display = 'none';
    pagination.style.display = 'none';
    if (!_gbLoaded) {
        _gbLoaded = true;
        loadGenelData();
    }
    renderInvoiceTabBar();
    return;
  }

  if (isBekleyen) {
    kpiBar.style.display = 'none' ;
    window._FAT_PENDING = true;
    loadBekleyenCounts();
    switchBekleyenTab('giden'); // ← delegates everything cleanly
    renderInvoiceTabBar();
    return; // switchBekleyenTab calls initInvoiceView itself
  }

  // gelen / giden

  kpiBar.style.display = 'flex';
  window._FAT_PENDING = false;
  currentView = tab;
  window._fatActiveFilters = {};
  window._fatFilterOptions = {
    companies: [],
    brands: [],
    products: [],
    categories: [],
    models: [],
    currencies: [],
    invoiceNumbers: [],
    relationships: []
  };
  window._filterOptionsLoaded = false;
  restoreFilterState(tab);
  restoreTagFilters()
  _currentPage = window._fatActiveFilters?.page || 1;
  showLoadingOverlay();
  initInvoiceView(false);
  renderInvoiceTabBar();
}


async function loadBekleyenCounts() {
  try {
    const res  = await fetch('/api/invoices/pending');
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || []);
    const gelenCount = list.filter(i => i.direction === 'INCOMING').length;
    const gidenCount = list.filter(i => i.direction === 'OUTGOING').length;
    const gelenBadge = document.getElementById('subTabBekGelenCount');
    const gidenBadge = document.getElementById('subTabBekGidenCount');
    if (gelenBadge) gelenBadge.textContent = gelenCount || '';
    if (gidenBadge) gidenBadge.textContent = gidenCount || '';
  } catch(e) {}
}

function switchBekleyenTab(sub) {
  _activeBekTab = sub;
  document.getElementById('subTabBekGelen')?.classList.remove('fat-sub-tab--active');
  document.getElementById('subTabBekGiden')?.classList.remove('fat-sub-tab--active');
  document.getElementById(sub === 'gelen' ? 'subTabBekGelen' : 'subTabBekGiden')?.classList.add('fat-sub-tab--active');

  currentView = sub;
  window._FAT_PENDING = true;
  window._filterOptionsLoaded = false;
  _currentPage = 1;
  showLoadingOverlay();
  initInvoiceView(false);
  renderInvoiceTabBar();
}

document.addEventListener('DOMContentLoaded', () => {
  const tab = new URLSearchParams(location.search).get('tab') || 'genel';
  switchMainTab(tab);
});


