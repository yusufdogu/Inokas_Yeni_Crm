// ── stok.js ───────────────────────────────────────────────────────────────────
// Tab switching + lazy init for the unified Stok shell.
let _activeTab       = 'genel';
let _urunlerReady    = false;
let _backorderReady  = false;
let _kategoriReady   = false;
let _genelReady      = false;

// ── TAB SWITCHER ──────────────────────────────────────────────────────────────
function switchTab(tab) {
  _activeTab = tab;
  history.replaceState(null, '', `?tab=${tab}`);

  document.querySelectorAll('.stk-nav-tab').forEach(btn => btn.classList.remove('stk-nav-tab--active'));
  const ids = {
    genel:     'navTabGenel',
    urunler:   'navTabUrunler',
    backorder: 'navTabBackorder',
    kategori:  'navTabKategori',
  };
  document.getElementById(ids[tab])?.classList.add('stk-nav-tab--active');

  const panels = {
    genel:     'panelGenel',
    urunler:   'panelUrunler',
    backorder: 'panelBackorder',
    kategori:  'panelKategori',
  };
  Object.entries(panels).forEach(([t, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = t === tab ? '' : 'none';
  });

  if (tab === 'genel' && !_genelReady) {
    _genelReady = true;
    if (typeof initGenelBakis === 'function') initGenelBakis();
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


function switchUrunTab(tab) {
  document.getElementById('urunTabHar').classList.toggle('stk-urun-tab--active', tab === 'har');
  document.getElementById('urunTabDet').classList.toggle('stk-urun-tab--active', tab === 'det');
  document.getElementById('urunPanelHar').classList.toggle('stk-urun-panel--active', tab === 'har');
  document.getElementById('urunPanelDet').classList.toggle('stk-urun-panel--active', tab === 'det');
}



function clearBoFilters() {
  if (typeof _clearBoFilters === 'function') _clearBoFilters();
}


// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const tab = new URLSearchParams(location.search).get('tab') || 'genel';
  const validTabs = ['genel', 'urunler', 'backorder', 'kategori'];
  switchTab(validTabs.includes(tab) ? tab : 'genel');
});