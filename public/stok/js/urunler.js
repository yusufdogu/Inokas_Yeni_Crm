// stok/urunler.js — Ürünler page

const _BRAND_OPTIONS = ['ASUS','EPSON','EPSON-YP','EVERTON','HP','KYOCERA','LG','OKI','SAMSUNG'];
let _extraBrandOptions     = [];
let productCategoryOptions = [];

let allProducts = [];
let _editingId  = null;
let _isAddMode  = false;
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
  await Promise.all([loadProducts(), loadCategoryOptions()]);
  initFilters();
});

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error();
    allProducts = await res.json();
    initPriceRange();
    renderKpis();
    applyFilters();
  } catch {
    document.getElementById('urunler-count').textContent = 'Veri alınamadı.';
  }
}

async function loadCategoryOptions() {
  try {
    const res = await fetch('/api/products/category-map');
    if (!res.ok) return;
    const data = await res.json();
    productCategoryOptions = Array.isArray(data?.categories)
      ? data.categories.map(x => String(x || '').trim()).filter(Boolean)
      : [];
  } catch {}
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
  const sliderMax = Number(document.getElementById('maliyetMax')?.max || 0);
  const maxLabel  = _maliyetMax >= sliderMax ? '∞' : fmtUsd(_maliyetMax);
  label.textContent = `${fmtUsd(_maliyetMin)} — ${maxLabel}`;
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────
function initFilters() {
  _brandFilter = createTagFilter({
    wrapId:     'brandTagsWrap',
    inputId:    'brandTagInput',
    dropdownId: 'brandDropdown',
    getOptions: () => [...new Set(allProducts.map(p => String(p.brand || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr')),
    onChange:   () => applyFilters(),
  });

  _categoryFilter = createTagFilter({
    wrapId:     'categoryTagsWrap',
    inputId:    'categoryTagInput',
    dropdownId: 'categoryDropdown',
    getOptions: () => [...new Set(allProducts.map(p => String(p.category || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr')),
    onChange:   () => applyFilters(),
  });

  _modelFilter = createTagFilter({
    wrapId:     'modelTagsWrap',
    inputId:    'modelTagInput',
    dropdownId: 'modelDropdown',
    getOptions: () => [...new Set(allProducts.map(p => String(p.model || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr')),
    onChange:   () => applyFilters(),
  });

  _currencyFilter = createTagFilter({
    wrapId:     'currencyTagsWrap',
    inputId:    'currencyTagInput',
    dropdownId: 'currencyDropdown',
    getOptions: () => [...new Set(allProducts.map(p => String(p.last_purchase_currency || '').trim()).filter(Boolean))].sort(),
    onChange:   () => { updateAdvancedBadge(); applyFilters(); },
  });
}

function applyFilters() {
  const search     = (document.getElementById('urunSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const brands     = _brandFilter?.getSelected()    || [];
  const categories = _categoryFilter?.getSelected() || [];
  const models     = _modelFilter?.getSelected()    || [];
  const currencies = _currencyFilter?.getSelected() || [];
  const dmoOnly    = !!document.getElementById('filterDmoOnly')?.checked;

  const sliderMax  = Number(document.getElementById('maliyetMax')?.max || 0);

  const filtered = allProducts.filter(p => {
    if (brands.length     && !brands.includes(String(p.brand || '').trim()))       return false;
    if (categories.length && !categories.includes(String(p.category || '').trim())) return false;
    if (models.length     && !models.includes(String(p.model || '').trim()))        return false;
    if (currencies.length && !currencies.includes(String(p.last_purchase_currency || '').trim())) return false;
    if (dmoOnly && !String(p.dmo_code || '').trim()) return false;

    // Maliyet range — only apply if slider has been moved from defaults
    const maliyet = Number(p.maliyet_usd || 0);
    if (_maliyetMin > 0 && maliyet < _maliyetMin) return false;
    if (_maliyetMax < sliderMax && maliyet > _maliyetMax) return false;

    if (search) {
      const nameMatch  = String(p.product_name || '').toLocaleLowerCase('tr-TR').includes(search);
      const codeMatch  = String(p.product_code || '').toLocaleLowerCase('tr-TR').includes(search);
      const brandMatch = String(p.brand        || '').toLocaleLowerCase('tr-TR').includes(search);
      if (!nameMatch && !codeMatch && !brandMatch) return false;
    }
    return true;
  });

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
  const dmoOnly   = !!document.getElementById('filterDmoOnly')?.checked;
  const hasActive =
    (_currencyFilter?.getSelected().length || 0) > 0 ||
    dmoOnly ||
    _maliyetMin > 0 ||
    _maliyetMax < sliderMax;
  badge.style.display = hasActive ? 'inline-block' : 'none';
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
function renderKpis(subset) {
  const src        = subset || allProducts;
  const categories = new Set(src.map(p => String(p.category || '').trim()).filter(Boolean));
  const brands     = new Set(src.map(p => String(p.brand || '').trim()).filter(Boolean));
  document.getElementById('kpi-total').textContent      = fmtQty(src.length);
  document.getElementById('kpi-categories').textContent = String(categories.size);
  document.getElementById('kpi-brands').textContent     = String(brands.size);
  document.getElementById('urunler-count').textContent  = `${fmtQty(src.length)} ürün`;
}

// ─── TABLE ────────────────────────────────────────────────────────────────────
function renderTable(filtered) {
  const body    = document.getElementById('urunlerTableBody');
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
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick = () => openEditModal(p.id);
    tr.innerHTML = `
      <td style="font-weight:600;">${esc(p.product_name || '—')}</td>
      <td><span class="badge-sku">${esc(p.product_code || '—')}</span></td>
      <td>${p.brand    ? `<span class="pill-brand">${esc(p.brand)}</span>`       : '—'}</td>
      <td>${p.category ? `<span class="pill-category">${esc(p.category)}</span>` : '—'}</td>
      <td style="color:#64748b; font-size:12px;">${esc(p.model || '—')}</td>
      <td class="text-right price-cell">${p.maliyet_usd != null ? fmtUsd(p.maliyet_usd) : '—'}</td>
      <td class="text-right price-cell">${p.sozlesme_fiyat_eur != null ? `€${Number(p.sozlesme_fiyat_eur).toLocaleString('tr-TR',{minimumFractionDigits:2})}` : '—'}</td>
      <td class="text-right price-cell">${p.last_purchase_price_cur != null ? Number(p.last_purchase_price_cur).toLocaleString('tr-TR',{minimumFractionDigits:2}) : '—'}</td>
      <td>${esc(p.last_purchase_currency || '—')}</td>
      <td>${hasDmo ? `<span class="badge-dmo">DMO</span>` : '—'}</td>
    `;
    body.appendChild(tr);
  });
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
const _NUMERIC_FIELDS = new Set([
  'maliyet_usd','sozlesme_fiyat_eur','last_purchase_price_cur','last_purchase_rate',
  'last_purchase_price_tl','avg_purchase_price_tl','dmo_fiyat_try','gift_quantity',
]);
const _READONLY_FIELDS = new Set(['created_at','updated_at','dmo_fiyat_updated']);
const _ALL_FIELDS = [
  'product_name','product_code','brand','category','model',
  'maliyet_usd','sozlesme_fiyat_eur',
  'last_purchase_price_cur','last_purchase_currency','last_purchase_rate',
  'last_purchase_price_tl','avg_purchase_price_tl',
  'dmo_code','dmo_fiyat_try','dmo_url','gift_quantity',
  'created_at','updated_at','dmo_fiyat_updated',
];

function _buildBrandSelect(selected = '') {
  const sel = document.getElementById('pf-brand');
  if (!sel) return;
  const opts = [..._BRAND_OPTIONS, ..._extraBrandOptions];
  sel.innerHTML = [
    '<option value="">Seçin...</option>',
    ...opts.map(b => `<option value="${esc(b)}"${b===selected?' selected':''}>${esc(b)}</option>`),
  ].join('');
}

function _buildCategorySelect(selected = '') {
  const sel = document.getElementById('pf-category');
  if (!sel) return;
  const opts = productCategoryOptions;
  sel.innerHTML = [
    '<option value="">Seçin...</option>',
    ...opts.map(c => `<option value="${esc(c)}"${c===selected?' selected':''}>${esc(c)}</option>`),
    ...(selected && !opts.includes(selected)
      ? [`<option value="${esc(selected)}" selected>${esc(selected)}</option>`]
      : [])
  ].join('');
}

function openAddModal() {
  _editingId = null;
  _isAddMode = true;
  _ALL_FIELDS.forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (el) el.value = '';
  });
  _buildBrandSelect();
  _buildCategorySelect();
  document.getElementById('modalTitle').textContent    = 'Yeni Ürün Ekle';
  document.getElementById('modalSubTitle').textContent = '';
  document.getElementById('modalMsg').textContent      = '';
  document.getElementById('modalMsg').className        = 'modal-msg';
  document.getElementById('modalSaveBtn').disabled     = false;
  document.getElementById('productModal').style.display = 'flex';
}

async function openEditModal(productId) {
  if (!productId) return;
  _editingId = productId;
  _isAddMode = false;

  const msgEl   = document.getElementById('modalMsg');
  const saveBtn = document.getElementById('modalSaveBtn');
  msgEl.textContent = 'Yükleniyor...';
  msgEl.className   = 'modal-msg';
  saveBtn.disabled  = true;
  document.getElementById('productModal').style.display = 'flex';

  try {
    if (!productCategoryOptions.length) await loadCategoryOptions();
    const res = await fetch(`/api/products/${productId}`);
    if (!res.ok) throw new Error('Ürün verisi alınamadı.');
    const product = await res.json();

    document.getElementById('modalTitle').textContent    = product.product_name || 'Ürün Detayı';
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
    _buildBrandSelect(product.brand || '');
    _buildCategorySelect(product.category || '');

    msgEl.textContent = '';
    saveBtn.disabled  = false;
  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className   = 'modal-msg error';
  }
}

function closeModal() {
  document.getElementById('productModal').style.display = 'none';
  _editingId = null;
  _isAddMode = false;
  document.getElementById('modalMsg').textContent = '';
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

  const name = String(document.getElementById('pf-product_name')?.value || '').trim();
  const code = String(document.getElementById('pf-product_code')?.value || '').trim();
  if (!name) { msgEl.textContent = 'Ürün adı zorunludur.'; msgEl.className = 'modal-msg error'; saveBtn.disabled = false; return; }
  if (!code) { msgEl.textContent = 'Ürün kodu zorunludur.'; msgEl.className = 'modal-msg error'; saveBtn.disabled = false; return; }

  try {
    const res = await fetch(
      _isAddMode ? '/api/products' : `/api/products/${_editingId}`,
      {
        method:  _isAddMode ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Kayıt hatası');

    msgEl.textContent = _isAddMode ? `✓ "${name}" eklendi.` : 'Kaydedildi ✓';
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