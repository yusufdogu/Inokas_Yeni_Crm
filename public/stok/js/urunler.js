// stok/urunler.js — Ürünler page

const _BRAND_OPTIONS = ['ASUS', 'EPSON', 'EPSON-YP', 'EVERTON', 'HP', 'KYOCERA', 'LG', 'OKI', 'SAMSUNG'];
let _extraBrandOptions = [];
let productCategoryOptions = [];
let _categoryTemplates = [];
let _attrValues = {};      // productId → { attributeId → value }
let _attrTemplate = null;
let _attrFilters = {};     // attributeId → string | string[]
let _attrTagFilters = {};  // attributeId → tagFilter instance

let allProducts = [];
let _internalOnlySkus = new Set();
let _internalCatOptions = [];
let _editingId = null;
let _isAddMode = false;
let _isInternalMode = false;
let _advancedOpen = false;

// Tag filters
let _brandFilter;
let _categoryFilter;
let _modelFilter;
let _currencyFilter;

// Price range
let _maliyetMin = 0;
let _maliyetMax = 0;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('urunSearch')?.addEventListener('input', applyFilters);
  await Promise.all([loadProducts(), loadCategoryOptions(), loadCategoryTemplates()]);
  initFilters();
});

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadProducts() {
  try {
    const [productsRes, summaryRes, movementsRes] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/stocks/summary'),
      fetch('/api/stocks/movements')
    ]);
    if (!productsRes.ok) throw new Error();
    allProducts = await productsRes.json();

    if (summaryRes.ok) {
      const summary = await summaryRes.json();
      _internalOnlySkus = new Set((summary.internal_only_skus || []).map(s => String(s).trim()));
      allProducts = allProducts.filter(p => !_internalOnlySkus.has(String(p.product_code || '').trim()));
    }

    if (movementsRes.ok) {
      const movements = await movementsRes.json();
      const stockMap = new Map();
      movements.forEach(m => {
        const sku = String(m.sku || '').trim();
        if (!sku) return;
        const qty = Number(m.quantity || 0);
        const current = stockMap.get(sku) || 0;
        stockMap.set(sku, current + (m.direction === 'INCOMING' ? qty : -qty));
      });
      allProducts.forEach(p => {
        p.current_stock = stockMap.get(String(p.product_code || '').trim()) ?? 0;
      });
    }

    initPriceRange();
    renderKpis();
    applyFilters();
  } catch {
    document.getElementById('urunler-count').textContent = 'Veri alınamadı.';
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
  } catch { }
}

// ─── PRICE RANGE INIT ─────────────────────────────────────────────────────────
function initPriceRange() {
  const max = Math.ceil(
    Math.max(...allProducts.map(p => Number(p.maliyet_usd || 0)), 0) / 100
  ) * 100;

  _maliyetMin = 0;
  _maliyetMax = max || 1000;

  const minEl = document.getElementById('maliyetMin');
  const maxEl = document.getElementById('maliyetMax');
  if (minEl) { minEl.min = 0; minEl.max = _maliyetMax; minEl.value = 0; }
  if (maxEl) { maxEl.min = 0; maxEl.max = _maliyetMax; maxEl.value = _maliyetMax; }
  updateMaliyetLabel();
}

function updateMaliyetRange() {
  const minEl = document.getElementById('maliyetMin');
  const maxEl = document.getElementById('maliyetMax');
  _maliyetMin = Number(minEl?.value || 0);
  _maliyetMax = Number(maxEl?.value || 0);
  if (_maliyetMin > _maliyetMax) [_maliyetMin, _maliyetMax] = [_maliyetMax, _maliyetMin];
  updateMaliyetLabel();
  applyFilters();
}

function updateMaliyetLabel() {
  const label = document.getElementById('maliyetRangeLabel');
  if (!label) return;
  label.textContent = `${fmtUsd(_maliyetMin)} — ${fmtUsd(_maliyetMax)}`;
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────
function initFilters() {
  _brandFilter = createTagFilter({
    wrapId: 'brandTagsWrap',
    inputId: 'brandTagInput',
    dropdownId: 'brandDropdown',
    getOptions: () => [...new Set(allProducts.map(p => String(p.brand || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
    onChange: () => applyFilters(),
  });

  _categoryFilter = createTagFilter({
    wrapId: 'categoryTagsWrap',
    inputId: 'categoryTagInput',
    dropdownId: 'categoryDropdown',
    getOptions: () => [...new Set(allProducts.map(p => String(p.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
    onChange: () => { applyFilters(); onCategoryFilterChange(); },
  });

  _modelFilter = createTagFilter({
    wrapId: 'modelTagsWrap',
    inputId: 'modelTagInput',
    dropdownId: 'modelDropdown',
    getOptions: () => [...new Set(allProducts.map(p => String(p.model || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
    onChange: () => applyFilters(),
  });

  _currencyFilter = createTagFilter({
    wrapId: 'currencyTagsWrap',
    inputId: 'currencyTagInput',
    dropdownId: 'currencyDropdown',
    getOptions: () => [...new Set(allProducts.map(p => String(p.last_purchase_currency || '').trim()).filter(Boolean))].sort(),
    onChange: () => { updateAdvancedBadge(); applyFilters(); },
  });
}

function applyFilters() {
  const search = (document.getElementById('urunSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const brands = _brandFilter?.getSelected() || [];
  const categories = _categoryFilter?.getSelected() || [];
  const models = _modelFilter?.getSelected() || [];
  const currencies = _currencyFilter?.getSelected() || [];
  const dmoOnly = !!document.getElementById('filterDmoOnly')?.checked;
  const inStockOnly = !!document.getElementById('filterInStockOnly')?.checked;

  const sliderMax = Number(document.getElementById('maliyetMax')?.max || 0);

  const filtered = allProducts.filter(p => {
    if (brands.length && !brands.includes(String(p.brand || '').trim())) return false;
    if (categories.length && !categories.includes(String(p.category || '').trim())) return false;
    if (models.length && !models.includes(String(p.model || '').trim())) return false;
    if (currencies.length && !currencies.includes(String(p.last_purchase_currency || '').trim())) return false;
    if (dmoOnly && !String(p.dmo_code || '').trim()) return false;
    if (inStockOnly && !(Number(p.current_stock || 0) > 0)) return false;

    // Maliyet range — only apply if slider has been moved from defaults
    const maliyet = Number(p.maliyet_usd || 0);
    if (_maliyetMin > 0 && maliyet < _maliyetMin) return false;
    if (_maliyetMax < sliderMax && maliyet > _maliyetMax) return false;

    if (search) {
      const nameMatch = String(p.product_name || '').toLocaleLowerCase('tr-TR').includes(search);
      const codeMatch = String(p.product_code || '').toLocaleLowerCase('tr-TR').includes(search);
      const brandMatch = String(p.brand || '').toLocaleLowerCase('tr-TR').includes(search);
      if (!nameMatch && !codeMatch && !brandMatch) return false;
    }
    return true;
  });

  // Kategori özellik filtreleri
  const hasAttrFilters = Object.keys(_attrFilters).length > 0;
  if (_attrTemplate && hasAttrFilters) {
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

  renderTable(filtered);
  renderKpis(filtered);
  updateAdvancedBadge();
}

function clearFilters() {
  document.getElementById('urunSearch').value = '';
  _brandFilter?.clear();
  _categoryFilter?.clear();
  _modelFilter?.clear();
  _currencyFilter?.clear();
  const dmoEl = document.getElementById('filterDmoOnly');
  if (dmoEl) dmoEl.checked = false;
  const inStockEl = document.getElementById('filterInStockOnly');
  if (inStockEl) inStockEl.checked = false;
  initPriceRange();
  updateAdvancedBadge();
  applyFilters();
}

// ─── ADVANCED PANEL ───────────────────────────────────────────────────────────
function toggleAdvancedFilters() {
  _advancedOpen = !_advancedOpen;
  document.getElementById('advancedFiltersPanel')?.classList.toggle('open', _advancedOpen);
  const btnText = document.getElementById('advancedFiltersBtnText');
  if (btnText) {
    btnText.innerHTML = _advancedOpen
      ? `<i class="ti ti-chevron-up" style="font-size:12px;"></i> Gelişmiş Filtreler`
      : `<i class="ti ti-chevron-down" style="font-size:12px;"></i> Gelişmiş Filtreler`;
  }
}

function updateAdvancedBadge() {
  const badge = document.getElementById('advancedFiltersBadge');
  if (!badge) return;
  const sliderMax = Number(document.getElementById('maliyetMax')?.max || 0);
  const dmoOnly = !!document.getElementById('filterDmoOnly')?.checked;
  const inStockOnly = !!document.getElementById('filterInStockOnly')?.checked;
  const hasActive =
    (_currencyFilter?.getSelected().length || 0) > 0 ||
    dmoOnly ||
    inStockOnly ||
    _maliyetMin > 0 ||
    _maliyetMax < sliderMax ||
    Object.keys(_attrFilters).length > 0 ||
    !!document.getElementById('filterMissingAttrs')?.checked;
  badge.style.display = hasActive ? 'inline-block' : 'none';
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
function renderKpis(subset) {
  const src = subset || allProducts;
  const categories = new Set(src.map(p => String(p.category || '').trim()).filter(Boolean));
  const brands = new Set(src.map(p => String(p.brand || '').trim()).filter(Boolean));
  const models = new Set(src.map(p => String(p.model || '').trim()).filter(Boolean));
  document.getElementById('kpi-total').textContent = fmtQty(src.length);
  document.getElementById('kpi-categories').textContent = String(categories.size);
  document.getElementById('kpi-brands').textContent = String(brands.size);
  document.getElementById('kpi-models').textContent = String(models.size);
  document.getElementById('urunler-count').textContent = `${fmtQty(src.length)} ürün`;
}

// ─── TABLE ────────────────────────────────────────────────────────────────────
function renderTable(filtered) {
  const body = document.getElementById('urunlerTableBody');
  const emptyEl = document.getElementById('urunlerEmpty');
  if (!body) return;

  body.innerHTML = '';

  if (!filtered.length) {
    emptyEl.classList.add('visible');
    return;
  }
  emptyEl.classList.remove('visible');

  filtered.forEach(p => {
    const hasDmo = !!String(p.dmo_code || '').trim();
    let missingBadge = '';
    if (_attrTemplate) {
      const attrIds = (_attrTemplate.attributes || []).map(a => a.id);
      const pAttrs = _attrValues[p.id] || {};
      const missingCount = attrIds.filter(id => !pAttrs[id]).length;
      if (missingCount > 0) missingBadge = ` <span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:1px 6px;border-radius:20px;border:1px solid #fde68a;">⚠ ${missingCount}</span>`;
    }
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick = () => openEditModal(p.id);
    tr.innerHTML = `
    <td style="font-weight:600;">${esc(p.product_name || '—')}${missingBadge}</td>
    <td><span class="badge-sku">${esc(p.product_code || '—')}</span></td>
    <td>${p.brand ? `<span class="pill-brand">${esc(p.brand)}</span>` : '—'}</td>
    <td>${p.category ? `<span class="pill-category">${esc(p.category)}</span>` : '—'}</td>
    <td style="color:#64748b; font-size:12px;">${esc(p.model || '—')}</td>
    <td style="text-align:right; font-family:'Geist Mono',monospace; font-size:12px;">${Number(p.current_stock || 0) > 0 ? `<span style="color:#166534; font-weight:700;">${Number(p.current_stock).toLocaleString('tr-TR')}</span>` : `<span style="color:#94a3b8;">0</span>`}</td>
    <td class="text-right price-cell">${p.last_purchase_price_cur != null ?
        `${Number(p.last_purchase_price_cur).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${p.last_purchase_currency || ''}` :
        '—'}</td>
  `;
    body.appendChild(tr);
  });
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
const _NUMERIC_FIELDS = new Set([
  'maliyet_usd', 'sozlesme_fiyat_eur', 'last_purchase_price_cur', 'last_purchase_rate',
  'last_purchase_price_tl', 'avg_purchase_price_tl', 'dmo_fiyat_try', 'gift_quantity',
]);
const _READONLY_FIELDS = new Set(['created_at', 'updated_at', 'dmo_fiyat_updated']);
const _ALL_FIELDS = [
  'product_name', 'product_code', 'brand', 'category', 'model',
  'maliyet_usd', 'sozlesme_fiyat_eur',
  'last_purchase_price_cur', 'last_purchase_currency', 'last_purchase_rate',
  'last_purchase_price_tl', 'avg_purchase_price_tl',
  'dmo_code', 'dmo_fiyat_try', 'dmo_url', 'gift_quantity',
  'created_at', 'updated_at', 'dmo_fiyat_updated',
];

function _buildBrandSelect(selected = '') {
  const sel = document.getElementById('pf-brand');
  if (!sel) return;
  const opts = [..._BRAND_OPTIONS, ..._extraBrandOptions];
  sel.innerHTML = [
    '<option value="">Seçin...</option>',
    ...opts.map(b => `<option value="${esc(b)}"${b === selected ? ' selected' : ''}>${esc(b)}</option>`),
  ].join('');
}

function _buildCategorySelect(selected = '') {
  const input = document.getElementById('pf-category');
  if (!input) return;
  input.value = selected;
}

// ─── NORMAL KATEGORİ (autocomplete) ──────────────────────────────────────────
function onCatInput(query) {
  const dropdown = document.getElementById('pf-cat-dropdown');
  if (!dropdown) return;
  const q = (query || '').toLocaleLowerCase('tr-TR');
  const opts = productCategoryOptions;
  const matches = opts.filter(o => !q || o.toLocaleLowerCase('tr-TR').startsWith(q));
  const rows = matches.map(o =>
    `<div onclick="selectCat('${esc(o)}')"
      style="padding:8px 12px; font-size:12px; color:#374151; cursor:pointer;"
      onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background=''">${esc(o)}</div>`
  );
  if (!rows.length && !q) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = rows.join('');
  dropdown.style.display = rows.length ? 'block' : 'none';
}

function selectCat(value) {
  const input    = document.getElementById('pf-category');
  const dropdown = document.getElementById('pf-cat-dropdown');
  if (input)    { input.value = value; renderDynamicAttrs(value, {}); }
  if (dropdown) dropdown.style.display = 'none';
}

// ─── OFİS İÇİ KATEGORİ ───────────────────────────────────────────────────────
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
    if (!_internalCatOptions.length) _loadInternalCatOptions();
  } else {
    catWrap.style.display      = '';
    internalWrap.style.display = 'none';
    document.getElementById('pf-internal-cat-dropdown').style.display = 'none';
  }
}

function onInternalCatInput(query) {
  const dropdown = document.getElementById('pf-internal-cat-dropdown');
  if (!dropdown) return;
  const q = (query || '').toLocaleLowerCase('tr-TR');
  const matches = _internalCatOptions.filter(o => !q || o.toLocaleLowerCase('tr-TR').includes(q));
  if (!matches.length) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = matches.map(o =>
    `<div onclick="selectInternalCat('${esc(o)}')"
      style="padding:8px 12px; font-size:12px; color:#374151; cursor:pointer;"
      onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background=''">${esc(o)}</div>`
  ).join('');
  dropdown.style.display = 'block';
}

function selectInternalCat(value) {
  const input    = document.getElementById('pf-internal-cat-input');
  const dropdown = document.getElementById('pf-internal-cat-dropdown');
  if (input)    input.value = value;
  if (dropdown) dropdown.style.display = 'none';
}

document.addEventListener('click', (e) => {
  const internalWrap = document.getElementById('pf-internal-cat-wrap');
  const internalDd   = document.getElementById('pf-internal-cat-dropdown');
  if (internalWrap && internalDd && !internalWrap.contains(e.target)) internalDd.style.display = 'none';

  const catWrap = document.getElementById('pf-cat-wrap');
  const catDd   = document.getElementById('pf-cat-dropdown');
  if (catWrap && catDd && !catWrap.contains(e.target)) catDd.style.display = 'none';
});

function openAddModal() {
  _editingId = null;
  _isAddMode = true;
  _isInternalMode = false;
  _ALL_FIELDS.forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (el) el.value = '';
  });
  const toggle = document.getElementById('pf-is-internal');
  if (toggle) toggle.checked = false;
  onInternalToggle(false);
  _buildBrandSelect();
  _buildCategorySelect();
  document.getElementById('modalTitle').textContent = 'Yeni Ürün Ekle';
  document.getElementById('modalSubTitle').textContent = '';
  document.getElementById('modalMsg').textContent = '';
  document.getElementById('modalMsg').className = 'modal-msg';
  document.getElementById('modalSaveBtn').disabled = false;
  document.getElementById('productModal').style.display = 'flex';
}

async function openEditModal(productId) {
  if (!productId) return;
  _editingId = productId;
  _isAddMode = false;

  const msgEl = document.getElementById('modalMsg');
  const saveBtn = document.getElementById('modalSaveBtn');
  msgEl.textContent = 'Yükleniyor...';
  msgEl.className = 'modal-msg';
  saveBtn.disabled = true;
  document.getElementById('productModal').style.display = 'flex';

  try {
    if (!productCategoryOptions.length) await loadCategoryOptions();
    const res = await fetch(`/api/products/${productId}`);
    if (!res.ok) throw new Error('Ürün verisi alınamadı.');
    const product = await res.json();

    document.getElementById('modalTitle').textContent = product.product_name || 'Ürün Detayı';
    document.getElementById('modalSubTitle').textContent = `Kod: ${product.product_code || '—'}`;

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
    _isInternalMode = isInternal;
    const toggle = document.getElementById('pf-is-internal');
    if (toggle) toggle.checked = isInternal;
    onInternalToggle(isInternal);
    if (isInternal) {
      if (!_internalCatOptions.length) await _loadInternalCatOptions();
      const input = document.getElementById('pf-internal-cat-input');
      if (input) input.value = product.category || '';
    }
    _buildBrandSelect(product.brand || '');
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

    msgEl.textContent = '';
    saveBtn.disabled = false;
  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className = 'modal-msg error';
  }
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
    _attrValues = {};
    _attrFilters = {};
    const wrap = document.getElementById('dynamic-attr-filters');
    if (wrap) wrap.style.display = 'none';
    const missingWrap = document.getElementById('filterMissingAttrsWrap');
    if (missingWrap) missingWrap.style.display = 'none';
    return;
  }
  await loadAttrValues(selected[0]);
  renderDynamicAttrFilters();
}

async function loadAttrValues(category) {
  try {
    const res = await fetch(`/api/product-attribute-values?category=${encodeURIComponent(category)}`);
    if (!res.ok) return;
    const data = await res.json();
    _attrTemplate = data.template;
    _attrValues = {};
    (data.values || []).forEach(v => {
      if (!_attrValues[v.product_id]) _attrValues[v.product_id] = {};
      _attrValues[v.product_id][v.attribute_id] = v.value;
    });
    _attrFilters = {};
  } catch { }
}

function renderDynamicAttrFilters() {
  const wrap = document.getElementById('dynamic-attr-filters');
  const missingWrap = document.getElementById('filterMissingAttrsWrap');
  if (!wrap) return;

  _attrTagFilters = {};

  const attrs = (_attrTemplate?.attributes || []).sort((a, b) => a.sort_order - b.sort_order);
  if (!attrs.length) {
    wrap.style.display = 'none';
    if (missingWrap) missingWrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'flex';
  wrap.style.flexWrap = 'wrap';
  wrap.style.gap = '8px';
  wrap.style.alignItems = 'center';
  wrap.style.marginTop = '10px';

  wrap.innerHTML = attrs.map(a => {
    if (a.attr_type === 'select' && a.attr_values?.length) {
      return `<div class="filter-tags-wrap" id="dattr-wrap-${a.id}" style="min-width:120px; flex:unset;" onclick="document.getElementById('dattr-input-${a.id}').focus()">
        <input type="text" id="dattr-input-${a.id}" class="filter-tags-input" placeholder="${esc(a.attr_name)}...">
        <div id="dattr-dropdown-${a.id}" class="filter-dropdown"></div>
      </div>`;
    }
    if (a.attr_type === 'text' || a.attr_type === 'number') {
      return `<div class="filter-tags-wrap" style="min-width:120px; flex:unset;">
        <input type="${a.attr_type === 'number' ? 'number' : 'text'}" class="filter-tags-input" data-attr-id="${a.id}" placeholder="${esc(a.attr_name)}..." oninput="onAttrFilterChange()">
      </div>`;
    }
    return '';
  }).join('');

  // select tiplerini tag filter olarak başlat
  attrs.filter(a => a.attr_type === 'select' && a.attr_values?.length).forEach(a => {
    _attrTagFilters[a.id] = createTagFilter({
      wrapId: `dattr-wrap-${a.id}`,
      inputId: `dattr-input-${a.id}`,
      dropdownId: `dattr-dropdown-${a.id}`,
      getOptions: () => a.attr_values,
      onChange: () => onAttrFilterChange(),
    });
  });

  if (missingWrap) missingWrap.style.display = '';

  if (!_advancedOpen) {
    _advancedOpen = true;
    document.getElementById('advancedFiltersPanel')?.classList.add('open');
    const btnText = document.getElementById('advancedFiltersBtnText');
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
  applyFilters();
  updateAdvancedBadge();
}

// ─── DİNAMİK KATEGORİ ÖZELLİKLERİ ───────────────────────────────────────────
function renderDynamicAttrs(categoryName, existingValues) {
  const section = document.getElementById('dynamic-attrs-section');
  const grid    = document.getElementById('dynamic-attrs-grid');
  if (!section || !grid) return;

  const template = _categoryTemplates.find(t => t.name === categoryName);
  const attrs = template?.attributes || [];

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
  const msgEl = document.getElementById('modalMsg');
  const saveBtn = document.getElementById('modalSaveBtn');
  msgEl.textContent = 'Kaydediliyor...';
  msgEl.className = 'modal-msg';
  saveBtn.disabled = true;

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
  if (_isInternalMode) {
    const internalCat = (document.getElementById('pf-internal-cat-input')?.value || '').trim();
    payload.category = internalCat || null;
  }

  const name = String(document.getElementById('pf-product_name')?.value || '').trim();
  const code = String(document.getElementById('pf-product_code')?.value || '').trim();
  if (!name) { msgEl.textContent = 'Ürün adı zorunludur.'; msgEl.className = 'modal-msg error'; saveBtn.disabled = false; return; }
  if (!code) { msgEl.textContent = 'Ürün kodu zorunludur.'; msgEl.className = 'modal-msg error'; saveBtn.disabled = false; return; }

  try {
    const res = await fetch(
      _isAddMode ? '/api/products' : `/api/products/${_editingId}`,
      {
        method: _isAddMode ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Kayıt hatası');

    // merge durumunda hedef ürünün id'si kullanılmalı
    const savedId = _isAddMode ? (data.data?.id || data.id) : (data.merged ? data.data?.id : _editingId);
    const attrPayload = collectAttrValues();
    if (savedId && attrPayload.length) {
      await fetch(`/api/products/${savedId}/attributes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: attrPayload })
      });
    }

    msgEl.textContent = data.merged ? 'Ürünler birleştirildi ✓' : (_isAddMode ? `✓ "${name}" eklendi.` : 'Kaydedildi ✓');
    msgEl.className = 'modal-msg success';
    document.getElementById('modalSubTitle').textContent = `Kod: ${code}`;

    await loadProducts();
    setTimeout(() => closeModal(), 800);
  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className = 'modal-msg error';
  } finally {
    saveBtn.disabled = false;
  }
}