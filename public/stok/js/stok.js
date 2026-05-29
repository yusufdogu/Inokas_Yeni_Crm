// ── stok.js ───────────────────────────────────────────────────────────────────
// Tab switching + lazy init for the unified Stok shell.

let _activeTab       = 'genel';
let _hareketlerReady = false;
let _urunlerReady    = false;
let _backorderReady  = false;
let _kategoriReady   = false;

// ── TAB SWITCHER ──────────────────────────────────────────────────────────────
function switchTab(tab) {
  _activeTab = tab;
  history.replaceState(null, '', `?tab=${tab}`);

  // Update nav pills
  document.querySelectorAll('.stk-nav-tab').forEach(btn => btn.classList.remove('stk-nav-tab--active'));
  const ids = {
    genel:      'navTabGenel',
    hareketler: 'navTabHareketler',
    urunler:    'navTabUrunler',
    backorder:  'navTabBackorder',
    kategori:   'navTabKategori',
  };
  document.getElementById(ids[tab])?.classList.add('stk-nav-tab--active');

  // Show/hide panels
  const panels = {
    genel:      'panelGenel',
    hareketler: 'panelHareketler',
    urunler:    'panelUrunler',
    backorder:  'panelBackorder',
    kategori:   'panelKategori',
  };
  Object.entries(panels).forEach(([t, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = t === tab ? '' : 'none';
  });

  // Lazy init each tab on first visit
  if (tab === 'genel') {
    const iframe = document.getElementById('genelBakisFrame');
    if (iframe && !iframe.getAttribute('src')) {
      iframe.src = '/stok/pages/genel-bakis.html';
    }
  } else if (tab === 'hareketler' && !_hareketlerReady) {
    _hareketlerReady = true;
    if (typeof initHareketler === 'function') {
      initHareketler().then(() => {
        if (typeof applyFilters === 'function') applyFilters();
      });
    }
  } else if (tab === 'urunler' && !_urunlerReady) {
    _urunlerReady = true;
    if (typeof initUrunler === 'function') initUrunler();
  } else if (tab === 'backorder' && !_backorderReady) {
    _backorderReady = true;
    if (typeof initBackorder === 'function') initBackorder();
  } else if (tab === 'kategori' && !_kategoriReady) {
    _kategoriReady = true;
    if (typeof initKategori === 'function') initKategori();
  }
}

// ── ANALIZ ────────────────────────────────────────────────────────────────────
function toggleAnaliz() {
  _analizOpen = !_analizOpen;
  document.getElementById('analizPanel')?.classList.toggle('open', _analizOpen);
  const chevron = document.getElementById('analizChevron');
  if (chevron) chevron.classList.toggle('open', _analizOpen);
  if (_analizOpen && typeof renderCharts === 'function') {
    renderCharts(window._stokFilteredMovements || []);
  }
}

// ── ÜRÜN HAREKETLERİ SUB-VIEW ─────────────────────────────────────────────────
function openUrunHareketleri(sku) {
  document.getElementById('hareketlerList').style.display        = 'none';
  document.getElementById('urunHareketleriView').style.display   = 'flex';
  document.getElementById('analizPanel')?.classList.remove('open');
  _analizOpen = false;
  if (typeof initUrunHareketleri === 'function') initUrunHareketleri(sku);
}

function closeUrunHareketleri() {
  document.getElementById('urunHareketleriView').style.display  = 'none';
  document.getElementById('hareketlerList').style.display       = '';
}

// ── FILTER HELPERS ────────────────────────────────────────────────────────────
function clearHareketlerFilters() {
  if (typeof _clearHareketlerFilters === 'function') _clearHareketlerFilters();
}

function clearUrunlerFilters() {
  if (typeof _clearUrunlerFilters === 'function') _clearUrunlerFilters();
}

function clearBoFilters() {
  if (typeof _clearBoFilters === 'function') _clearBoFilters();
}

function clearUhFilters() {
  if (typeof _clearUhFilters === 'function') _clearUhFilters();
}

function toggleHareketlerAdvanced() {
  const panel = document.getElementById('hareketlerAdvPanel');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  const chevron = document.getElementById('hareketlerAdvChevron');
  if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : '';
}

function toggleUrunlerAdvanced() {
  const panel = document.getElementById('urAdvancedFiltersPanel');
  if (!panel) return;
  panel.classList.toggle('open');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const tab = new URLSearchParams(location.search).get('tab') || 'genel';
  switchTab(tab);
});