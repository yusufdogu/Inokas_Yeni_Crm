// stok/stok-hareketleri.js — Stok Hareketleri page

const MOVEMENT_CACHE_KEY = 'inokas_movements_v1';

let allMovements      = [];
let filteredMovements = [];
let _analizOpen       = false;
let _priceMin         = 0;
let _priceMax         = 100000;

let _companyFilter;
let _productFilter;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initFilters();
  await loadMovements();
});

function initFilters() {
  _companyFilter = createTagFilter({
    wrapId:     'companyTagsWrap',
    inputId:    'companyTagInput',
    dropdownId: 'companyDropdown',
    getOptions: () => [...new Set(allMovements.map(m => String(m.company_name || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr')),
    onChange:   () => {},
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
    onChange: () => {},
  });

  document.getElementById('filterDateStart')?.addEventListener('change', applyFilters);
  document.getElementById('filterDateEnd')?.addEventListener('change', applyFilters);
  document.getElementById('filterDirection')?.addEventListener('change', applyFilters);
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
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
function applyFilters() {
  const companies = _companyFilter?.getSelected() || [];
  const products  = _productFilter?.getSelected() || [];
  const dateStart = document.getElementById('filterDateStart')?.value || '';
  const dateEnd   = document.getElementById('filterDateEnd')?.value   || '';
  const direction = document.getElementById('filterDirection')?.value || '';

  filteredMovements = allMovements.filter(m => {
    if (companies.length && !companies.includes(String(m.company_name || '').trim())) return false;
    if (products.length) {
      const nameMatch = products.includes(String(m.product_name || '').trim());
      const skuMatch  = products.includes(String(m.sku || '').trim());
      if (!nameMatch && !skuMatch) return false;
    }
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
  ['filterDateStart','filterDateEnd','filterDirection'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('priceMin').value = 0;
  document.getElementById('priceMax').value = 100000;
  _priceMin = 0; _priceMax = 100000;
  updatePriceRange();
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
    tr.onclick = () => openMovementsModal(product);
    tr.innerHTML = `
      <td style="font-weight:600;">${esc(product.product_name)}</td>
      <td><span class="badge-sku">${esc(product.sku)}</span></td>
      <td class="text-right text-success"><strong>+${fmtQty(product.total_in)}</strong></td>
      <td class="text-right text-danger"><strong>-${fmtQty(product.total_out)}</strong></td>
      <td style="white-space:nowrap; color:#64748b; font-size:12px;">${product.last_date || '—'}</td>
      <td style="color:#64748b; font-size:12px;">${product.companies.size} firma</td>
    `;
    body.appendChild(tr);
  });
}

// ─── MOVEMENTS MODAL ──────────────────────────────────────────────────────────
function openMovementsModal(product) {
  const net = product.total_in - product.total_out;

  // Header
  document.getElementById('mvModalProductName').textContent = product.product_name;
  document.getElementById('mvModalSku').textContent = product.sku;

  // Mini stats
  document.getElementById('mvStatIn').textContent      = `+${fmtQty(product.total_in)}`;
  document.getElementById('mvStatOut').textContent     = `-${fmtQty(product.total_out)}`;
  document.getElementById('mvStatNet').textContent     = fmtQty(net);
  document.getElementById('mvStatNet').className       = 'mv-stat-value ' + (net >= 0 ? 'text-success' : 'text-danger');
  document.getElementById('mvStatCompanies').textContent = String(product.companies.size);

  // Table
  const body = document.getElementById('mvModalTableBody');
  body.innerHTML = '';

  product.movements.forEach(m => {
    const isIn = m.direction === 'INCOMING';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="white-space:nowrap;">${esc(m.invoice_date || '—')}</td>
      <td><span class="badge-dir ${isIn ? 'badge-in' : 'badge-out'}">${isIn ? '▲ Giriş' : '▼ Çıkış'}</span></td>
      <td><span class="badge-sku">${esc(m.invoice_no || '—')}</span></td>
      <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(m.company_name||'')}">${esc(m.company_name || '—')}</td>
      <td class="text-right"><strong class="${isIn ? 'text-success' : 'text-danger'}">${isIn?'+':'-'}${fmtQty(m.quantity)}</strong></td>
      <td class="text-right">${m.unit_price_cur != null ? Number(m.unit_price_cur).toLocaleString('tr-TR',{minimumFractionDigits:2}) : '—'}</td>
      <td>${esc(m.currency || '—')}</td>
    `;
    body.appendChild(tr);
  });

  document.getElementById('mvModal').style.display = 'flex';
}

function closeMovementsModal() {
  document.getElementById('mvModal').style.display = 'none';
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