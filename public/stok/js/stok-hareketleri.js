// stok/stok-hareketleri.js — Stok Hareketleri page

const MOVEMENT_CACHE_KEY = 'inokas_movements_v1';

let allMovements      = [];
let filteredMovements = [];
let allProducts       = [];
let _analizOpen       = false;
let _priceMin         = 0;
let _priceMax         = 100000;
let _advancedOpen     = false;

// Tag filters
let _companyFilter;
let _productFilter;
let _brandFilter;
let _categoryFilter;
let _modelFilter;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadMovements(), loadProducts()]);
  initFilters();

  document.getElementById('filterDateStart')?.addEventListener('change', applyFilters);
  document.getElementById('filterDateEnd')?.addEventListener('change', applyFilters);
  document.getElementById('filterDirection')?.addEventListener('change', applyFilters);
});

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) return;
    allProducts = await res.json();
  } catch { }
}

async function loadMovements() {
  const cached = readCache(MOVEMENT_CACHE_KEY);
  if (cached) {
    allMovements = cached;
    applyFilters();
  }

  try {
    const res = await fetch('/api/stocks/movements', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    allMovements = await res.json();
    writeCache(MOVEMENT_CACHE_KEY, allMovements);
    applyFilters();
  } catch {
    if (!cached) {
      document.getElementById('hareketler-count').textContent = 'Veri alınamadı.';
    }
  }
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────
function initFilters() {
  _companyFilter = createTagFilter({
    wrapId:     'companyTagsWrap',
    inputId:    'companyTagInput',
    dropdownId: 'companyDropdown',
    getOptions: () => [...new Set(allMovements.map(m => String(m.company_name || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr')),
    onChange:   () => applyFilters(),
  });

  _productFilter = createTagFilter({
    wrapId:     'productTagsWrap',
    inputId:    'productTagInput',
    dropdownId: 'productDropdown',
    getOptions: () => {
      const names = allMovements.map(m => String(m.product_name || '').trim()).filter(Boolean);
      const skus  = allMovements.map(m => String(m.sku || '').trim()).filter(Boolean);
      return [...new Set([...names, ...skus])].sort((a,b) => a.localeCompare(b,'tr'));
    },
    onChange: () => applyFilters(),
  });

  _brandFilter = createTagFilter({
    wrapId:     'brandTagsWrap',
    inputId:    'brandTagInput',
    dropdownId: 'brandDropdown',
    getOptions: () => [...new Set(allProducts.map(p => String(p.brand || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr')),
    onChange:   () => { updateAdvancedBadge(); applyFilters(); },
  });

  _categoryFilter = createTagFilter({
    wrapId:     'categoryTagsWrap',
    inputId:    'categoryTagInput',
    dropdownId: 'categoryDropdown',
    getOptions: () => [...new Set(allMovements.map(m => String(m.category || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr')),
    onChange:   () => { updateAdvancedBadge(); applyFilters(); },
  });

  _modelFilter = createTagFilter({
    wrapId:     'modelTagsWrap',
    inputId:    'modelTagInput',
    dropdownId: 'modelDropdown',
    getOptions: () => [...new Set(allMovements.map(m => String(m.model || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr')),
    onChange:   () => { updateAdvancedBadge(); applyFilters(); },
  });
}

function applyFilters() {
  const companies  = _companyFilter?.getSelected()  || [];
  const products   = _productFilter?.getSelected()  || [];
  const brands     = _brandFilter?.getSelected()    || [];
  const categories = _categoryFilter?.getSelected() || [];
  const models     = _modelFilter?.getSelected()    || [];
  const dateStart  = document.getElementById('filterDateStart')?.value || '';
  const dateEnd    = document.getElementById('filterDateEnd')?.value   || '';
  const direction  = document.getElementById('filterDirection')?.value || '';

  filteredMovements = allMovements.filter(m => {
    if (companies.length && !companies.includes(String(m.company_name || '').trim())) return false;
    if (products.length) {
      const nameMatch = products.includes(String(m.product_name || '').trim());
      const skuMatch  = products.includes(String(m.sku || '').trim());
      if (!nameMatch && !skuMatch) return false;
    }
    if (brands.length     && !brands.includes(String(m.brand || '').trim()))       return false;
    if (categories.length && !categories.includes(String(m.category || '').trim())) return false;
    if (models.length     && !models.includes(String(m.model || '').trim()))        return false;
    const d = String(m.invoice_date || '').slice(0, 10);
    if (dateStart && d < dateStart) return false;
    if (dateEnd   && d > dateEnd)   return false;
    if (direction && m.direction !== direction) return false;
    const price = Number(m.unit_price_cur || 0);
    if (price < _priceMin) return false;
    if (_priceMax < 100000 && price > _priceMax) return false;
    return true;
  });

  renderKpis();
  renderTable();
  updateAnaliz();
}

function clearAllFilters() {
  _companyFilter?.clear();
  _productFilter?.clear();
  _brandFilter?.clear();
  _categoryFilter?.clear();
  _modelFilter?.clear();
  ['filterDateStart','filterDateEnd','filterDirection'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('priceMin').value = 0;
  document.getElementById('priceMax').value = 100000;
  _priceMin = 0;
  _priceMax = 100000;
  updatePriceRange();
  updateAdvancedBadge();
  applyFilters();
}

function updatePriceRange() {
  _priceMin = Number(document.getElementById('priceMin')?.value || 0);
  _priceMax = Number(document.getElementById('priceMax')?.value || 100000);
  if (_priceMin > _priceMax) [_priceMin, _priceMax] = [_priceMax, _priceMin];
  const label = document.getElementById('priceRangeLabel');
  if (label) {
    const maxLabel = _priceMax >= 100000 ? '∞' : _priceMax.toLocaleString('tr-TR');
    label.textContent = `${_priceMin.toLocaleString('tr-TR')} — ${maxLabel}`;
  }
  applyFilters();
}

// ─── ADVANCED FILTERS ─────────────────────────────────────────────────────────
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
  const hasAdvanced =
    (_brandFilter?.getSelected().length    || 0) > 0 ||
    (_categoryFilter?.getSelected().length || 0) > 0 ||
    (_modelFilter?.getSelected().length    || 0) > 0;
  badge.style.display = hasAdvanced ? 'inline-block' : 'none';
}

// ─── GROUP BY PRODUCT ─────────────────────────────────────────────────────────
function groupByProduct(movements) {
  const map = new Map();

  movements.forEach(m => {
    const key = String(m.sku || m.product_name || '—').trim();
    if (!map.has(key)) {
      map.set(key, {
        sku:          String(m.sku || '—').trim(),
        product_name: String(m.product_name || '—').trim(),
        brand:        String(m.brand || '').trim(),
        category:     String(m.category || '').trim(),
        model:        String(m.model || '').trim(),
        total_in:     0,
        total_out:    0,
        last_date:    '',
        companies:    new Set(),
        movements:    [],
      });
    }
    const row = map.get(key);
    const qty = Number(m.quantity || 0);
    if (m.direction === 'INCOMING') row.total_in  += qty;
    else                            row.total_out += qty;
    const d = String(m.invoice_date || '').slice(0, 10);
    if (d && d > row.last_date) row.last_date = d;
    if (m.company_name) row.companies.add(String(m.company_name).trim());
    row.movements.push(m);
  });

  map.forEach(row => {
    row.movements.sort((a, b) =>
      String(b.invoice_date || '').localeCompare(String(a.invoice_date || ''))
    );
  });

  return [...map.values()].sort((a, b) => b.last_date.localeCompare(a.last_date));
}

// ─── RENDER KPIs ──────────────────────────────────────────────────────────────
function renderKpis() {
  const grouped = groupByProduct(filteredMovements);
  const inQty   = filteredMovements.filter(m => m.direction === 'INCOMING').reduce((s,m) => s + Number(m.quantity||0), 0);
  const outQty  = filteredMovements.filter(m => m.direction === 'OUTGOING').reduce((s,m) => s + Number(m.quantity||0), 0);

  document.getElementById('kpi-total').textContent  = fmtQty(grouped.length);
  document.getElementById('kpi-in').textContent     = `+${fmtQty(inQty)}`;
  document.getElementById('kpi-out').textContent    = `-${fmtQty(outQty)}`;
  document.getElementById('kpi-amount').textContent = fmtQty(filteredMovements.length) + ' kayıt';
  document.getElementById('hareketler-count').textContent = `${fmtQty(grouped.length)} ürün`;
}

// ─── RENDER TABLE ─────────────────────────────────────────────────────────────
function renderTable() {
  const body    = document.getElementById('movementsTableBody');
  const emptyEl = document.getElementById('movementsEmpty');
  if (!body) return;

  body.innerHTML = '';
  const grouped = groupByProduct(filteredMovements);

  if (!grouped.length) {
    emptyEl.classList.add('visible');
    return;
  }
  emptyEl.classList.remove('visible');

  grouped.forEach(product => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick = () => {
      window.location.href = `/stok/pages/urun-hareketleri.html?sku=${encodeURIComponent(product.sku)}`;
    };
    tr.innerHTML = `
      <td style="font-weight:600;">${esc(product.product_name)}</td>
      <td><span class="badge-sku">${esc(product.sku)}</span></td>
      <td>${product.brand    ? `<span class="pill-brand">${esc(product.brand)}</span>`       : '—'}</td>
      <td>${product.category ? `<span class="pill-category">${esc(product.category)}</span>` : '—'}</td>
      <td class="text-right text-success"><strong>+${fmtQty(product.total_in)}</strong></td>
      <td class="text-right text-danger"><strong>-${fmtQty(product.total_out)}</strong></td>
      <td style="white-space:nowrap; color:#64748b; font-size:12px;">${product.last_date || '—'}</td>
      <td style="color:#64748b; font-size:12px;">${product.companies.size} firma</td>
    `;
    body.appendChild(tr);
  });
}

// ─── ANALIZ ───────────────────────────────────────────────────────────────────
function toggleAnaliz() {
  _analizOpen = !_analizOpen;
  document.getElementById('analizPanel').classList.toggle('open', _analizOpen);
  document.getElementById('analizChevron').classList.toggle('open', _analizOpen);
  if (_analizOpen) renderCharts(filteredMovements);
}

function updateAnaliz() {
  if (_analizOpen) renderCharts(filteredMovements);
}