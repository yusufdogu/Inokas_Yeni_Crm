// stok/urunler.js — Ürünler page
let brandOptions            = [];//to store brands we define here
let productCategoryOptions  = [];//to store category options in filters
let internalCategoryOptions = [];//
let _categoryTemplates      = [];
let _attrValues             = {};
let _attrTemplate           = null;
let _attrFilters            = {};
let _attrTagFilters         = {};

let _internalCatOptions = [];
let _editingId         = null;
let _isAddMode         = false;
let _isInternalMode    = false;
let _urunSort          = { col: null, dir: 'desc' };
let _advancedOpen      = false;

let _brandFilter;
let _categoryFilter;
let _productNameFilter;
let _currencyFilter;

// quick-filter chip state
let _filterInStock  = true;   // default ON — depoda
let _filterRisk     = false;
let _filterDead     = false;
let _filterDmo      = false;

let _uhSort = { col: null, dir: 'desc' };
let _uhCompanyFilter;

let _urPage     = 0;
let _urPageSize = 100;
let _urFiltered = [];

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initUrunler() {
  await Promise.all([loadProducts(), loadCategoryOptions(), loadCategoryTemplates()]);
  initFilters();
  renderUrunlerKpis();
  applyUrunlerFilters();
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadProducts() {
  try {
    const [productsRes] = await Promise.all([
      fetch('/api/products')
    ]);
    if (!productsRes.ok) throw new Error();
    allProducts = await productsRes.json();
  } catch(e) {
    console.error('Ürünler yüklenemedi', e.message);
  }
}

async function loadCategoryTemplates() {
  try {
    const res = await fetch('/api/category-templates');
    if (!res.ok) return;
    _categoryTemplates = await res.json();
  } catch { }
}

async function loadCategoryOptions() {
  try {
    const res = await fetch('/api/products/category-map');
    if (!res.ok) return;
    const data = await res.json();
    productCategoryOptions = Array.isArray(data?.categories)
      ? data.categories.map(x => String(x || '').trim()).filter(Boolean)
      : [];
    internalCategoryOptions = Array.isArray(data?.internal_categories)
      ? data.internal_categories.map(x => String(x || '').trim()).filter(Boolean)
      : [];
    brandOptions = Array.isArray(data?.brands)
      ? data.brands.map(x => String(x || '').trim()).filter(Boolean)
      : [];
  } catch { }
}


// ─── FILTERS ──────────────────────────────────────────────────────────────────
function initFilters() {
  _productNameFilter = createTagFilter({
    wrapId:     'urProductNameTagsWrap',
    inputId:    'urProductNameTagInput',
    dropdownId: 'urProductNameDropdown',
    getOptions: () => {
      const brands     = _brandFilter?.getSelected()    || [];
      const categories = _categoryFilter?.getSelected() || [];
      return [...new Set(
        allProducts
          .filter(p => {
            if (brands.length     && !brands.includes(String(p.brand || '').trim()))     return false;
            if (categories.length && !categories.includes(String(p.category || '').trim())) return false;
            return true;
          })
          .map(p => String(p.product_name || '').trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, 'tr'));
    },
    onChange: () => applyUrunlerFilters(),
  });

  _brandFilter = createTagFilter({
    wrapId:     'urBrandTagsWrap',
    inputId:    'urBrandTagInput',
    dropdownId: 'urBrandDropdown',
    getOptions: () => {
      const names      = _productNameFilter?.getSelected() || [];
      const categories = _categoryFilter?.getSelected()    || [];
      return [...new Set(
        allProducts
          .filter(p => {
            if (names.length      && !names.includes(String(p.product_name || '').trim()))      return false;
            if (categories.length && !categories.includes(String(p.category || '').trim())) return false;
            return true;
          })
          .map(p => String(p.brand || '').trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, 'tr'));
    },
    onChange: () => applyUrunlerFilters(),
  });

  _categoryFilter = createTagFilter({
    wrapId:     'urCategoryTagsWrap',
    inputId:    'urCategoryTagInput',
    dropdownId: 'urCategoryDropdown',
    getOptions: () => {
      const names  = _productNameFilter?.getSelected() || [];
      const brands = _brandFilter?.getSelected()       || [];
      return [...new Set(
        allProducts
          .filter(p => {
            if (names.length  && !names.includes(String(p.product_name || '').trim()))  return false;
            if (brands.length && !brands.includes(String(p.brand || '').trim())) return false;
            return true;
          })
          .map(p => String(p.category || '').trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, 'tr'));
    },
    onChange: () => { applyUrunlerFilters(); onCategoryFilterChange(); },
  });

  _currencyFilter = createTagFilter({
    wrapId:     'urCurrencyTagsWrap',
    inputId:    'urCurrencyTagInput',
    dropdownId: 'urCurrencyDropdown',
    getOptions: () => [...new Set(
      allProducts.map(p => String(p.last_purchase_currency || '').trim()).filter(Boolean)
    )].sort(),
    onChange: () => { applyUrunlerFilters(); },
  });

  _syncChipUI();
}
// ─── CHIP TOGGLES ─────────────────────────────────────────────────────────────
function toggleChip(chip) {
  if (chip === 'inStock')  _filterInStock = !_filterInStock;
  if (chip === 'dmo')      _filterDmo     = !_filterDmo;
  if (chip === 'risk') {
    _filterRisk = !_filterRisk;
    if (_filterRisk) _filterDead = false;
  }
  if (chip === 'dead') {
    _filterDead = !_filterDead;
    if (_filterDead) _filterRisk = false;
  }
  _syncChipUI();
  applyUrunlerFilters();
}

function _syncChipUI() {
  const chips = {
    'chipInStock': _filterInStock,
    'chipDmo':     _filterDmo,
    'chipRisk':    _filterRisk,
    'chipDead':    _filterDead,
  };
  Object.entries(chips).forEach(([id, on]) => {
    document.getElementById(id)?.classList.toggle('stk-chip--active', on);
  });
}

// ─── APPLY FILTERS ────────────────────────────────────────────────────────────
function applyUrunlerFilters() {
  const productNames = _productNameFilter?.getSelected() || [];
  const brands       = _brandFilter?.getSelected()       || [];
  const categories   = _categoryFilter?.getSelected()    || [];
  const currencies   = _currencyFilter?.getSelected()    || [];

  const LOW_STOCK = 10;

  let filtered = allProducts.filter(p => {
    const stock = Number(p.stock_on_hand || 0);

    if (productNames.length && !productNames.includes(String(p.product_name || '').trim())) return false;
    if (brands.length     && !brands.includes(String(p.brand || '').trim()))     return false;
    if (categories.length && !categories.includes(String(p.category || '').trim())) return false;
    if (currencies.length && !currencies.includes(String(p.last_purchase_currency || '').trim())) return false;
    if (_filterDmo    && !String(p.dmo_code || '').trim()) return false;
    if (_filterInStock && !(stock > 0))                    return false;
    if (_filterRisk   && !(stock > 0 && stock < LOW_STOCK)) return false;
    if (_filterDead   && !(stock > 0 && Number(p.shipped_total || 0) === 0)) return false;

    return true;
  });

  // Kategori özellik filtreleri
  if (_attrTemplate && Object.keys(_attrFilters).length > 0) {
    filtered = filtered.filter(p => {
      const pAttrs = _attrValues[p.id] || {};
      return Object.entries(_attrFilters).every(([attrId, filterVal]) => {
        const val = String(pAttrs[attrId] || '');
        if (Array.isArray(filterVal)) return filterVal.includes(val);
        return val.toLowerCase().includes(filterVal.toLowerCase());
      });
    });
  }

  // Eksik özellik filtresi
  if (document.getElementById('filterMissingAttrs')?.checked && _attrTemplate) {
    const attrIds = (_attrTemplate.attributes || []).map(a => a.id);
    filtered = filtered.filter(p => {
      const pAttrs = _attrValues[p.id] || {};
      return attrIds.some(id => !pAttrs[id]);
    });
  }

  // Sort
  if (_urunSort.col) {
    filtered.sort((a, b) => {
      let aVal, bVal;
      if (_urunSort.col === 'stock_on_hand') {
        aVal = Number(a.stock_on_hand || 0);
        bVal = Number(b.stock_on_hand || 0);
      } else if (_urunSort.col === 'last_purchase_price_cur') {
        aVal = Number(a.last_purchase_price_cur || 0);
        bVal = Number(b.last_purchase_price_cur || 0);
      } else if (_urunSort.col === 'total_stock_price') {
        aVal = Number(a.avg_purchase_price_tl || 0) * Number(a.stock_on_hand || 0);
        bVal = Number(b.avg_purchase_price_tl || 0) * Number(b.stock_on_hand || 0);
      }
      return _urunSort.dir === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }

  _urFiltered = filtered;
  _urPage     = 0;
  renderUrunlerTable(_urFiltered);
  renderUrunlerKpis(_urFiltered);
}

function _clearUrunlerFilters() {
  _productNameFilter?.clear();
  _brandFilter?.clear();
  _categoryFilter?.clear();
  _currencyFilter?.clear();
  _filterInStock = true;
  _filterDmo     = false;
  _filterRisk    = false;
  _filterDead    = false;
  _syncChipUI();
  applyUrunlerFilters();
}


// ─── KPIs ─────────────────────────────────────────────────────────────────────
function renderUrunlerKpis(subset) {
  const src      = subset || allProducts;
  const LOW_STOCK = 10;

  const inStock  = src.filter(p => Number(p.stock_on_hand || 0) > 0);

  let totalTL  = 0;
  let totalUSD = 0;

  inStock.forEach(r => {
    const stock       = Number(r.stock_on_hand || 0);
    const avgTL       = Number(r.avg_purchase_price_tl || 0);
    const lastCur     = (r.last_purchase_currency || '').toUpperCase().trim();

    if (Math.floor(stock) > 0) {
      if ((lastCur === 'TRY' || lastCur === 'TL') && avgTL > 0) {
        totalTL+=stock * r.avg_purchase_price_tl
      } else if (lastCur === 'USD' && r.last_purchase_price_cur >0) {
        totalUSD += stock * r.last_purchase_price_cur;
      }
    }
  });

  const categories = new Set(src.map(p => String(p.category || '').trim()).filter(Boolean));
  const riskCount  = src.filter(p => {
    const s = Number(p.stock_on_hand || 0);
    return s > 0 && s < LOW_STOCK;
  }).length;
  const deadCount  = src.filter(p =>
    Number(p.stock_on_hand || 0) > 0).length;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setEl('kpi-stock-tl',  '₺' + Math.round(totalTL).toLocaleString('tr-TR'));
  setEl('kpi-stock-usd', '$' + Math.round(totalUSD).toLocaleString('tr-TR'));
  setEl('kpi-total-ur',  inStock.length.toLocaleString('tr-TR'));
  setEl('kpi-categories', String(categories.size));
  setEl('kpi-risk',  riskCount > 0 ? String(riskCount) : '—');
  setEl('kpi-dead',  deadCount > 0 ? String(deadCount) : '—');
}

// ─── SORT ─────────────────────────────────────────────────────────────────────
function sortUrunler(col) {
  if (_urunSort.col === col) {
    _urunSort.dir = _urunSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    _urunSort.col = col;
    _urunSort.dir = 'desc';
  }
  updateUrunSortHeaders();
  applyUrunlerFilters();
}

function updateUrunSortHeaders() {
  ['stock_on_hand', 'last_purchase_price_cur', 'total_stock_price'].forEach(col => {
    const el = document.getElementById(`urunSortHdr-${col}`);
    if (!el) return;
    const isActive = _urunSort.col === col;
    el.innerHTML   = isActive ? (_urunSort.dir === 'desc' ? ' ↓' : ' ↑') : ' ↕';
    el.style.opacity = isActive ? '1' : '0.35';
  });
}

// ─── TABLE ────────────────────────────────────────────────────────────────────
function renderUrunlerTable(filtered) {
  const body    = document.getElementById('urunlerTableBody');
  const emptyEl = document.getElementById('urunlerEmpty');
  if (!body) return;

  body.innerHTML = '';

  if (!filtered.length) {
    emptyEl.classList.add('visible');
    return;
  }
  emptyEl.classList.remove('visible');

  const start    = _urPage * _urPageSize;
  const pageItems = filtered.slice(start, start + _urPageSize);

  pageItems.forEach(p => {
    let missingBadge = '';
    if (_attrTemplate) {
      const attrIds     = (_attrTemplate.attributes || []).map(a => a.id);
      const pAttrs      = _attrValues[p.id] || {};
      const missingCount = attrIds.filter(id => !pAttrs[id]).length;
      if (missingCount > 0) missingBadge = ` <span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 6px;border-radius:20px;border:1px solid #fde68a;">⚠ ${missingCount}</span>`;
    }

    const stock       = Number(p.stock_on_hand || 0);
    const avgTL       = Number(p.avg_purchase_price_tl || 0);
    const lastCur     = (p.last_purchase_currency || '').toUpperCase().trim();
    const lastPrice   = p.last_purchase_price_cur != null
      ? `${Number(p.last_purchase_price_cur).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${lastCur}`
      : '—';

    let totalStock = '—';
    if (Math.floor(stock) > 0) {
      if (lastCur === 'TRY' && avgTL > 0) {
        totalStock = '₺' + Math.round(stock * avgTL).toLocaleString('tr-TR');
      } else if (lastCur && p.last_purchase_price_cur != null) {
        const totalCur = stock * Number(p.last_purchase_price_cur);
        totalStock = totalCur.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ' + lastCur;
      } else if (avgTL > 0) {
        totalStock = '₺' + Math.round(stock * avgTL).toLocaleString('tr-TR');
      }
    }

    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick   = () => openUrunModal(p.id, p.product_code);
    tr.innerHTML = `
      <td style="font-weight:600;">${esc(p.product_name || '—')}${missingBadge}</td>
      <td><span class="badge-sku">${esc(p.product_code || '—')}</span></td>
      <td>${p.brand    ? `<span class="pill-brand">${esc(p.brand)}</span>`       : '—'}</td>
      <td>${p.category ? `<span class="pill-category">${esc(p.category)}</span>` : '—'}</td>
      <td style="text-align:right; font-family:'DM Mono',monospace; font-size:12px;">
        ${stock > 0
          ? `<span style="color:#166534; font-weight:700;">${Math.floor(stock).toLocaleString('tr-TR')}</span>`
          : `<span style="color:#94a3b8;">0</span>`}
      </td>
      <td class="text-right price-cell">${lastPrice}</td>
      <td class="text-right total-stock-price-cell">${totalStock}</td>`;
    body.appendChild(tr);
  });
  renderPagination(filtered.length)
}

function renderPagination(total) {
  let el = document.getElementById('urunlerPagination');
  if (!el) return;

  const totalPages = Math.ceil(total / _urPageSize) || 1;
  const start      = total === 0 ? 0 : _urPage * _urPageSize + 1;
  const end        = Math.min((_urPage + 1) * _urPageSize, total);

  const pageSizes  = [10, 25, 50, 100];

  // Build page number buttons — show max 5 around current
  let pageButtons = '';
  const delta = 2;
  const left  = Math.max(0, _urPage - delta);
  const right = Math.min(totalPages - 1, _urPage + delta);

  if (left > 0) {
    pageButtons += `<button class="stk-pg-btn" onclick="goToPage(0)">1</button>`;
    if (left > 1) pageButtons += `<span class="stk-pg-ellipsis">…</span>`;
  }
  for (let i = left; i <= right; i++) {
    pageButtons += `<button class="stk-pg-btn${i === _urPage ? ' stk-pg-btn--active' : ''}" onclick="goToPage(${i})">${i + 1}</button>`;
  }
  if (right < totalPages - 1) {
    if (right < totalPages - 2) pageButtons += `<span class="stk-pg-ellipsis">…</span>`;
    pageButtons += `<button class="stk-pg-btn" onclick="goToPage(${totalPages - 1})">${totalPages}</button>`;
  }

  el.innerHTML = `
    <span class="stk-pg-info">${total.toLocaleString('tr-TR')} ürün · ${start}–${end} gösteriliyor</span>
    <div class="stk-pg-controls">
      <button class="stk-pg-btn" onclick="goToPage(${_urPage - 1})" ${_urPage === 0 ? 'disabled' : ''}>
        <i class="ti ti-chevron-left" style="font-size:12px;" aria-hidden="true"></i>
      </button>
      ${pageButtons}
      <button class="stk-pg-btn" onclick="goToPage(${_urPage + 1})" ${_urPage >= totalPages - 1 ? 'disabled' : ''}>
        <i class="ti ti-chevron-right" style="font-size:12px;" aria-hidden="true"></i>
      </button>
    </div>
    <div class="stk-pg-size">
      ${pageSizes.map(s => `<button class="stk-pg-btn${s === _urPageSize ? ' stk-pg-btn--active' : ''}" onclick="setPageSize(${s})">${s}</button>`).join('')}
    </div>`;
}

function goToPage(n) {
  const totalPages = Math.ceil(_urFiltered.length / _urPageSize) || 1;
  _urPage = Math.max(0, Math.min(totalPages - 1, n));
  renderUrunlerTable(_urFiltered);
}

function setPageSize(n) {
  _urPageSize = n;
  _urPage     = 0;
  renderUrunlerTable(_urFiltered);
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
const _NUMERIC_FIELDS = new Set([
  'maliyet_usd', 'sozlesme_fiyat_eur', 'last_purchase_price_cur', 'last_purchase_rate',
  'last_purchase_price_tl', 'avg_purchase_price_tl', 'dmo_fiyat_try', 'gift_quantity',
]);
const _READONLY_FIELDS = new Set(['created_at', 'updated_at', 'dmo_fiyat_updated']);
const _ALL_FIELDS = [
  'product_name', 'product_code', 'brand', 'category',
  'maliyet_usd', 'sozlesme_fiyat_eur',
  'last_purchase_price_cur', 'last_purchase_currency', 'last_purchase_rate',
  'last_purchase_price_tl', 'avg_purchase_price_tl',
  'dmo_code', 'dmo_fiyat_try', 'dmo_url', 'gift_quantity',
  'created_at', 'updated_at', 'dmo_fiyat_updated',
];

function _buildCategorySelect(selected = '') {
  const input = document.getElementById('pf-category');
  if (!input) return;
  input.value = selected;
}

function onBrandInput(query) {
  const dropdown = document.getElementById('pf-brand-dropdown');
  if (!dropdown) return;
  const q = (query || '').toLocaleLowerCase('tr-TR');
  const matches = brandOptions.filter(o => !q || o.toLocaleLowerCase('tr-TR').startsWith(q));
  if (!matches.length && !q) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = matches.map(o =>
    `<div onclick="selectBrand('${esc(o)}')"
      style="padding:8px 12px; font-size:12px; color:#374151; cursor:pointer;"
      onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background=''">${esc(o)}</div>`
  ).join('');
  dropdown.style.display = matches.length ? 'block' : 'none';
}

function selectBrand(value) {
  const input    = document.getElementById('pf-brand');
  const dropdown = document.getElementById('pf-brand-dropdown');
  if (input)    input.value = value;
  if (dropdown) dropdown.style.display = 'none';
}

function onCatInput(query) {
  const dropdown = document.getElementById('pf-cat-dropdown');
  if (!dropdown) return;
  const q       = (query || '').toLocaleLowerCase('tr-TR');
  const opts    = productCategoryOptions;
  const matches = opts.filter(o => !q || o.toLocaleLowerCase('tr-TR').startsWith(q));
  const rows    = matches.map(o =>
    `<div onclick="selectCat('${esc(o)}')"
      style="padding:8px 12px; font-size:12px; color:#374151; cursor:pointer;"
      onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background=''">${esc(o)}</div>`
  );
  if (!rows.length && !q) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML   = rows.join('');
  dropdown.style.display = rows.length ? 'block' : 'none';
}

function selectCat(value) {
  const input    = document.getElementById('pf-category');
  const dropdown = document.getElementById('pf-cat-dropdown');
  if (input)    { input.value = value; renderDynamicAttrs(value, {}); }
  if (dropdown) dropdown.style.display = 'none';
}

async function _loadInternalCatOptions() {
  try {
    const res = await fetch('/api/invoices/internal-categories');
    if (!res.ok) return;
    const data = await res.json();
    _internalCatOptions = (data || []).map(r => String(r.name || '').trim()).filter(Boolean);
  } catch { }
}

function onInternalToggle(isInternal) {
  _isInternalMode = isInternal;
  const catWrap      = document.getElementById('pf-cat-wrap');
  const internalWrap = document.getElementById('pf-internal-cat-wrap');
  const attrSection  = document.getElementById('dynamic-attrs-section');
  if (isInternal) {
    catWrap.style.display      = 'none';
    internalWrap.style.display = 'block';
    if (attrSection) attrSection.style.display = 'none';
  } else {
    catWrap.style.display      = '';
    internalWrap.style.display = 'none';
    document.getElementById('pf-internal-cat-dropdown').style.display = 'none';
  }
}

function onInternalCatInput(query) {
  const dropdown = document.getElementById('pf-internal-cat-dropdown');
  if (!dropdown) return;
  const q       = (query || '').toLocaleLowerCase('tr-TR');
  const matches = internalCategoryOptions.filter(o => !q || o.toLocaleLowerCase('tr-TR').startsWith(q));
  if (!matches.length && !q) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = matches.map(o =>
    `<div onclick="selectInternalCat('${esc(o)}')"
      style="padding:8px 12px; font-size:12px; color:#374151; cursor:pointer;"
      onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background=''">${esc(o)}</div>`
  ).join('');
  dropdown.style.display = matches.length ? 'block' : 'none';
}

function selectInternalCat(value) {
  const input    = document.getElementById('pf-internal-cat-input');
  const dropdown = document.getElementById('pf-internal-cat-dropdown');
  if (input)    input.value = value;
  if (dropdown) dropdown.style.display = 'none';
}

document.addEventListener('click', e => {
  const pairs = [
    ['pf-internal-cat-wrap', 'pf-internal-cat-dropdown'],
    ['pf-cat-wrap',          'pf-cat-dropdown'],
    ['pf-brand-wrap',        'pf-brand-dropdown'],
  ];
  pairs.forEach(([wrapId, ddId]) => {
    const wrap = document.getElementById(wrapId);
    const dd   = document.getElementById(ddId);
    if (wrap && dd && !wrap.contains(e.target)) dd.style.display = 'none';
  });
});

function openAddModal() {
  switchUrunTab('det');
  document.getElementById('urunTabHar').style.display = 'none';
  _editingId      = null;
  _isAddMode      = true;
  _isInternalMode = false;
  _ALL_FIELDS.forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (el) el.value = '';
  });
  const toggle = document.getElementById('pf-is-internal');
  if (toggle) toggle.checked = false;
  onInternalToggle(false);
  document.getElementById('pf-brand').value = '';
  _buildCategorySelect();
  document.getElementById('modalTitle').textContent    = 'Yeni Ürün Ekle';
  document.getElementById('modalSubTitle').textContent = '';
  document.getElementById('modalMsg').textContent      = '';
  document.getElementById('modalMsg').className        = 'modal-msg';
  document.getElementById('modalSaveBtn').disabled     = false;
  document.getElementById('productModal').style.display = 'flex';
}

async function openUrunModal(productId, sku) {
  if (!productId) return;
  _editingId = productId;
  _isAddMode = false;

  switchUrunTab('har');
  document.getElementById('urunTabHar').style.display = '';

  const avatarEl = document.getElementById('urunModalAvatar');
  const titleEl  = document.getElementById('modalTitle');
  const subEl    = document.getElementById('modalSubTitle');
  const msgEl    = document.getElementById('modalMsg');
  const saveBtn  = document.getElementById('modalSaveBtn');

  if (avatarEl) avatarEl.textContent = '…';
  if (titleEl)  titleEl.textContent  = 'Yükleniyor...';
  if (subEl)    subEl.textContent    = '';
  if (msgEl)    msgEl.textContent    = '';
  if (saveBtn)  saveBtn.disabled     = true;

  document.getElementById('productModal').style.display = 'flex';

  try {
    if (!productCategoryOptions.length) await loadCategoryOptions();

    const [productRes, movementsRes] = await Promise.all([
      fetch(`/api/products/${productId}`),
      fetch(`/api/stocks/movements?sku=${encodeURIComponent(sku || '')}`),
    ]);

    if (!productRes.ok) throw new Error('Ürün verisi alınamadı.');
    const product   = await productRes.json();
    const movements = movementsRes.ok ? await movementsRes.json() : [];

    const initials = name => {
      const w = String(name || '').trim().split(/\s+/);
      return ((w[0]?.[0] || '') + (w[1]?.[0] || w[0]?.[1] || '')).toUpperCase();
    };
    if (avatarEl) avatarEl.textContent = initials(product.product_name);
    if (titleEl)  titleEl.textContent  = product.product_name || 'Ürün Detayı';
    if (subEl)    subEl.textContent    =
      [product.product_code, product.brand, product.category].filter(Boolean).join(' · ');

    renderUrunHareketleriInModal(movements);

    _ALL_FIELDS.forEach(key => {
      const el = document.getElementById(`pf-${key}`);
      if (!el) return;
      if (_READONLY_FIELDS.has(key)) {
        el.value = product[key] ? new Date(product[key]).toLocaleString('tr-TR') : '—';
      } else {
        el.value = product[key] ?? '';
      }
    });

    const isInternal = !!product.is_internal;
    _isInternalMode  = isInternal;
    const toggle     = document.getElementById('pf-is-internal');
    if (toggle) toggle.checked = isInternal;
    onInternalToggle(isInternal);

    const hiddenToggle = document.getElementById('pf-is-hidden');
    if (hiddenToggle) hiddenToggle.checked = !!product.is_hidden;

    if (isInternal) {
      const inp = document.getElementById('pf-internal-cat-input');
      if (inp) inp.value = product.category || '';
    }
    document.getElementById('pf-brand').value = product.brand || '';
    _buildCategorySelect(isInternal ? '' : (product.category || ''));

    const attrValues = {};
    try {
      const attrRes = await fetch(`/api/products/${productId}/attributes`);
      if (attrRes.ok) {
        const attrData = await attrRes.json();
        (attrData.attributes || []).forEach(a => { attrValues[a.id] = a.value; });
      }
    } catch { }
    renderDynamicAttrs(product.category || '', attrValues);

    if (msgEl)   msgEl.textContent = '';
    if (saveBtn) saveBtn.disabled  = false;

  } catch (err) {
    if (msgEl) { msgEl.textContent = `Hata: ${err.message}`; msgEl.className = 'modal-msg error'; }
  }
}

function renderUrunHareketleriInModal(movements) {
  window._uhAllMovements = movements;
  _uhSort = { col: 'date', dir: 'desc' };

  // KPIs
  const totalIn  = movements.filter(m => m.direction === 'INCOMING').reduce((s, m) => s + Number(m.quantity || 0), 0);
  const totalOut = movements.filter(m => m.direction === 'OUTGOING').reduce((s, m) => s + Number(m.quantity || 0), 0);
  const companies = new Set(movements.map(m => m.company_name).filter(Boolean)).size;

  // Monetary values — grouped by currency
  const inByCurrency  = {};
  const outByCurrency = {};

  movements.forEach(m => {
    const price = Number(m.unit_price_cur || 0);
    const qty   = Number(m.quantity || 0);
    let cur     = (m.currency || '').toUpperCase().trim();
    if (cur === 'TL') cur = 'TRY';
    if (!cur || price === 0) return;
    const val = price * qty;
    if (m.direction === 'INCOMING') {
      inByCurrency[cur]  = (inByCurrency[cur]  || 0) + val;
    } else {
      outByCurrency[cur] = (outByCurrency[cur] || 0) + val;
    }
  });

  const fmtCurrency = (map) => {
    const entries = Object.entries(map);
    if (!entries.length) return '—';
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([cur, val]) => {
        const symbol = cur === 'TRY' ? '₺' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur + ' ';
        return symbol + val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      })
      .join(' · ');
  };



  const el = id => document.getElementById(id);
  if (el('statIn'))        el('statIn').textContent        = '+' + totalIn.toLocaleString('tr-TR');
  if (el('statOut'))       el('statOut').textContent       = '-' + totalOut.toLocaleString('tr-TR');
  if (el('statNet'))       el('statNet').textContent       = (totalIn - totalOut).toLocaleString('tr-TR');
  if (el('statCompanies')) el('statCompanies').textContent = companies.toString();
  if (el('statTotal'))     el('statTotal').textContent     = movements.length.toString();

  if (el('statInVal'))  el('statInVal').textContent  = fmtCurrency(inByCurrency);
  if (el('statOutVal')) el('statOutVal').textContent = fmtCurrency(outByCurrency);

  // Reset inputs
  const dirSel = el('uhFilterDirection');
  const ds     = el('uhFilterDateStart');
  const de     = el('uhFilterDateEnd');
  if (dirSel) dirSel.value = '';
  if (ds)     ds.value     = '';
  if (de)     de.value     = '';

  // Wire listeners once — guard with a flag on the element
  [
    { id: 'uhFilterDirection', fn: applyUhFilters },
    { id: 'uhFilterDateStart', fn: applyUhFilters },
    { id: 'uhFilterDateEnd',   fn: applyUhFilters },
  ].forEach(({ id, fn }) => {
    const node = el(id);
    if (!node || node._uhListenerAttached) return;
    node.addEventListener('change', fn);
    node._uhListenerAttached = true;
  });

  // Company tag filter — recreated each time so options match this product
  _uhCompanyFilter = createTagFilter({
    wrapId:     'uhCompanyTagsWrap',
    inputId:    'uhCompanyTagInput',
    dropdownId: 'uhCompanyDropdown',
    getOptions: () => [...new Set(movements.map(m => m.company_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
    onChange:   () => applyUhFilters(),
  });

  applyUhFilters();
}

function applyUhFilters() {
  const movements = window._uhAllMovements || [];
  const tbody     = document.getElementById('uhTableBody');
  const emptyEl   = document.getElementById('uhEmpty');
  if (!tbody) return;

  const dir       = document.getElementById('uhFilterDirection')?.value || '';
  const dateStart = document.getElementById('uhFilterDateStart')?.value || '';
  const dateEnd   = document.getElementById('uhFilterDateEnd')?.value   || '';
  const companies = _uhCompanyFilter?.getSelected() || [];

  let filtered = movements.filter(m => {
    if (dir       && m.direction    !== dir)      return false;
    if (dateStart && m.invoice_date <  dateStart) return false;
    if (dateEnd   && m.invoice_date >  dateEnd)   return false;
    if (companies.length && !companies.includes(m.company_name || '')) return false;
    return true;
  });

  if (_uhSort.col) {
    filtered.sort((a, b) => {
      let aVal, bVal;
      if (_uhSort.col === 'qty') {
        aVal = Number(a.quantity || 0);
        bVal = Number(b.quantity || 0);
      } else if (_uhSort.col === 'date') {
        aVal = a.invoice_date || '';
        bVal = b.invoice_date || '';
      }
      if (aVal < bVal) return _uhSort.dir === 'desc' ? 1  : -1;
      if (aVal > bVal) return _uhSort.dir === 'desc' ? -1 : 1;
      return 0;
    });
  }

  tbody.innerHTML = '';
  if (!filtered.length) { emptyEl?.classList.add('visible'); return; }
  emptyEl?.classList.remove('visible');

  filtered.forEach(m => {
    const isIn = m.direction === 'INCOMING';
    const qty  = Number(m.quantity || 0);
    const tr   = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:'DM Mono',monospace; font-size:11px; color:var(--stk-ink4);">${(m.invoice_date || '').slice(0,10)}</td>
      <td><span class="badge-direction ${isIn ? 'badge-in' : 'badge-out'}">${isIn ? '▲ Giriş' : '▼ Çıkış'}</span></td>
      <td style="font-family:'DM Mono',monospace; font-size:11px; color:var(--stk-ink3);">${esc(m.invoice_no || '—')}</td>
      <td style="font-weight:500;">${esc(m.company_name || '—')}</td>
      <td style="text-align:right; font-weight:700; font-family:'DM Mono',monospace; color:${isIn ? 'var(--stk-green)' : 'var(--stk-red)'};">${isIn ? '+' : '-'}${qty.toLocaleString('tr-TR')}</td>
      <td style="text-align:center;">${m.pdf_url
        ? `<a href="${esc(m.pdf_url)}" target="_blank" rel="noopener" class="stk-pdf-btn"><i class="ti ti-file-type-pdf" style="font-size:13px;" aria-hidden="true"></i> PDF</a>`
        : '<span style="color:var(--stk-ink4); font-size:11px;">—</span>'
      }</td>`;
    tbody.appendChild(tr);
  });

  updateUhSortHeaders();
}

function sortUh(col) {
  if (_uhSort.col === col) {
    _uhSort.dir = _uhSort.dir === 'desc' ? 'asc' : 'desc';
  } else {
    _uhSort.col = col;
    _uhSort.dir = col === 'date' ? 'desc' : 'desc';
  }
  applyUhFilters();
}

function updateUhSortHeaders() {
  ['date', 'qty'].forEach(col => {
    const el = document.getElementById(`uhSortHdr-${col}`);
    if (!el) return;
    const isActive   = _uhSort.col === col;
    el.innerHTML     = isActive ? (_uhSort.dir === 'desc' ? ' ↓' : ' ↑') : ' ↕';
    el.style.opacity = isActive ? '1' : '0.35';
  });
}
function clearUhFilters() {
  const dirSel = document.getElementById('uhFilterDirection');
  if (dirSel) dirSel.value = '';
  const ds = document.getElementById('uhFilterDateStart');
  const de = document.getElementById('uhFilterDateEnd');
  if (ds) ds.value = '';
  if (de) de.value = '';
  _uhCompanyFilter?.clear();
  _uhSort = { col: 'date', dir: 'desc' };
  applyUhFilters();
}

function closeModal() {
  document.getElementById('productModal').style.display = 'none';
  _editingId = null;
  _isAddMode = false;
  document.getElementById('modalMsg').textContent = '';
}

// ─── KATEGORİ BAZLI DİNAMİK FİLTRELER ───────────────────────────────────────
async function onCategoryFilterChange() {
  const selected = _categoryFilter?.getSelected() || [];
  if (selected.length !== 1) {
    _attrTemplate = null;
    _attrValues   = {};
    _attrFilters  = {};
    const wrap       = document.getElementById('dynamic-attr-filters');
    const missingWrap = document.getElementById('urFilterMissingAttrsWrap');
    if (wrap)        wrap.style.display = 'none';
    if (missingWrap) missingWrap.style.display = 'none';
    return;
  }
  await loadAttrValues(selected[0]);
  renderDynamicAttrFilters();
}

async function loadAttrValues(category) {
  try {
    const res = await fetch(`/api/products/attribute-values?category=${encodeURIComponent(category)}`);
    if (!res.ok) return;
    const data = await res.json();
    _attrTemplate = data.template;
    _attrValues   = {};
    (data.values || []).forEach(v => {
      if (!_attrValues[v.product_id]) _attrValues[v.product_id] = {};
      _attrValues[v.product_id][v.attribute_id] = v.value;
    });
    _attrFilters = {};
  } catch { }
}

function renderDynamicAttrFilters() {
  const wrap        = document.getElementById('dynamic-attr-filters');
  const missingWrap = document.getElementById('urFilterMissingAttrsWrap');
  if (!wrap) return;

  _attrTagFilters = {};
  const attrs = (_attrTemplate?.attributes || []).sort((a, b) => a.sort_order - b.sort_order);
  if (!attrs.length) {
    wrap.style.display = 'none';
    if (missingWrap) missingWrap.style.display = 'none';
    return;
  }

  wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px;';
  wrap.innerHTML = attrs.map(a => {
    if (a.attr_type === 'select' && a.attr_values?.length) {
      return `<div class="filter-tags-wrap" id="dattr-wrap-${a.id}" style="min-width:120px; flex:unset;" onclick="document.getElementById('dattr-input-${a.id}').focus()">
        <input type="text" id="dattr-input-${a.id}" class="filter-tags-input" placeholder="${esc(a.attr_name)}...">
        <div id="dattr-dropdown-${a.id}" class="filter-dropdown"></div>
      </div>`;
    }
    return `<div class="filter-tags-wrap" id="dattr-wrap-${a.id}" style="min-width:120px; flex:unset;" onclick="document.getElementById('dattr-input-${a.id}').focus()">
      <input type="text" id="dattr-input-${a.id}" class="filter-tags-input" placeholder="${esc(a.attr_name)}...">
      <div id="dattr-dropdown-${a.id}" class="filter-dropdown"></div>
    </div>`;
  }).join('');

  attrs.filter(a => a.attr_type === 'select' && a.attr_values?.length).forEach(a => {
    _attrTagFilters[a.id] = createTagFilter({
      wrapId: `dattr-wrap-${a.id}`, inputId: `dattr-input-${a.id}`, dropdownId: `dattr-dropdown-${a.id}`,
      getOptions: () => a.attr_values,
      onChange:   () => onAttrFilterChange(),
    });
  });

  attrs.filter(a => a.attr_type === 'text' || a.attr_type === 'number').forEach(a => {
    _attrTagFilters[a.id] = createTagFilter({
      wrapId: `dattr-wrap-${a.id}`, inputId: `dattr-input-${a.id}`, dropdownId: `dattr-dropdown-${a.id}`,
      getOptions: () => [...new Set(Object.values(_attrValues).map(pAttrs => pAttrs[a.id]).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'tr')),
      onChange:   () => onAttrFilterChange(),
    });
  });

  if (missingWrap) missingWrap.style.display = '';
  if (!_advancedOpen) {
    _advancedOpen = true;
    document.getElementById('urAdvancedFiltersPanel')?.classList.add('open');
    const btnText = document.getElementById('urAdvancedFiltersBtnText');
    if (btnText) btnText.innerHTML = `<i class="ti ti-chevron-up" style="font-size:12px;"></i> Gelişmiş Filtreler`;
  }
}

function onAttrFilterChange() {
  _attrFilters = {};
  Object.entries(_attrTagFilters).forEach(([attrId, tf]) => {
    const selected = tf.getSelected();
    if (selected.length) _attrFilters[attrId] = selected;
  });
  document.querySelectorAll('#dynamic-attr-filters input[data-attr-id]').forEach(inp => {
    if (inp.value.trim()) _attrFilters[inp.dataset.attrId] = inp.value.trim();
  });
  applyUrunlerFilters();
}

// ─── DİNAMİK KATEGORİ ÖZELLİKLERİ ───────────────────────────────────────────
function renderDynamicAttrs(categoryName, existingValues) {
  const section = document.getElementById('dynamic-attrs-section');
  const grid    = document.getElementById('dynamic-attrs-grid');
  if (!section || !grid) return;

  const template = _categoryTemplates.find(t => t.name === categoryName);
  const attrs    = template?.attributes || [];

  if (!attrs.length) { section.style.display = 'none'; grid.innerHTML = ''; return; }

  section.style.display = '';
  grid.innerHTML = attrs
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(a => {
      const val = existingValues[a.id] ?? '';
      const inputHtml = a.attr_type === 'select' && a.attr_values?.length
        ? `<select id="dattr-${a.id}">
             <option value="">Seçin...</option>
             ${a.attr_values.map(v => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(v)}</option>`).join('')}
           </select>`
        : a.attr_type === 'number'
          ? `<input type="number" id="dattr-${a.id}" value="${esc(val)}">`
          : `<input type="text" id="dattr-${a.id}" value="${esc(val)}">`;
      return `<div class="modal-field"><label>${esc(a.attr_name)}</label>${inputHtml}</div>`;
    }).join('');
}

function collectAttrValues() {
  const template = _categoryTemplates.find(
    t => t.name === (document.getElementById('pf-category')?.value || '')
  );
  if (!template?.attributes?.length) return [];
  return template.attributes.map(a => ({
    attribute_id: a.id,
    value: document.getElementById(`dattr-${a.id}`)?.value?.trim() || null
  }));
}

// ─── SAVE ─────────────────────────────────────────────────────────────────────
async function saveProduct() {
  const msgEl   = document.getElementById('modalMsg');
  const saveBtn = document.getElementById('modalSaveBtn');
  msgEl.textContent = 'Kaydediliyor...';
  msgEl.className   = 'modal-msg';
  saveBtn.disabled  = true;

  const payload = {};
  _ALL_FIELDS.filter(k => !_READONLY_FIELDS.has(k)).forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (!el) return;
    const raw = el.value.trim();
    payload[key] = _NUMERIC_FIELDS.has(key)
      ? (raw === '' ? null : Number(raw))
      : (raw === '' ? null : raw);
  });
  payload.is_internal = _isInternalMode;
  payload.is_hidden   = !!(document.getElementById('pf-is-hidden')?.checked);
  if (_isInternalMode) {
    const internalCat = (document.getElementById('pf-internal-cat-input')?.value || '').trim();
    payload.category  = internalCat || null;
  }

  const name = String(document.getElementById('pf-product_name')?.value || '').trim();
  const code = String(document.getElementById('pf-product_code')?.value || '').trim();
  if (!name) { msgEl.textContent = 'Ürün adı zorunludur.'; msgEl.className = 'modal-msg error'; saveBtn.disabled = false; return; }
  if (!code) { msgEl.textContent = 'Ürün kodu zorunludur.'; msgEl.className = 'modal-msg error'; saveBtn.disabled = false; return; }

  try {
    const res = await fetch(
      _isAddMode ? '/api/products' : `/api/products/${_editingId}`,
      { method: _isAddMode ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Kayıt hatası');

    const savedId     = _isAddMode ? (data.data?.id || data.id) : (data.merged ? data.data?.id : _editingId);
    const attrPayload = collectAttrValues();
    if (savedId && attrPayload.length) {
      await fetch(`/api/products/${savedId}/attributes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: attrPayload })
      });
    }

    msgEl.textContent = data.merged ? 'Ürünler birleştirildi ✓' : (_isAddMode ? `✓ "${name}" eklendi.` : 'Kaydedildi ✓');
    msgEl.className   = 'modal-msg success';
    document.getElementById('modalSubTitle').textContent = `Kod: ${code}`;

    await loadProducts();
    setTimeout(() => closeModal(), 800);
  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className   = 'modal-msg error';
  } finally {
    saveBtn.disabled = false;
  }
}