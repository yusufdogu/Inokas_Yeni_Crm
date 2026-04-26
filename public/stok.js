// ─── STATE ───────────────────────────────────────────────────────────────────
let allStocks       = [];  // Depo durumu (Tab 1)
let allMovements    = [];  // Stok hareketleri (Tab 2)
let allPendingOrders = []; // Bekleyen siparişler (Tab 3)
let stockStats      = null;
let currentStockTab = 'depo';
let currentInsightTab = 'profit';
let movementCompanyList = [];

const STOCK_CACHE_KEY     = 'inokas_stock_v2';
const MOVEMENT_CACHE_KEY  = 'inokas_movements_v1';
const PO_CACHE_KEY        = 'inokas_pending_po_v1';

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupStockUi();
  await loadAllData();
});

function setupStockUi() {
  document.getElementById('stockSearch')?.addEventListener('input', renderDepoTable);
  document.getElementById('pendingPoForm')?.addEventListener('submit', submitPendingPoForm);
  document.getElementById('poCompanyVkn')?.addEventListener('blur', autoFillCompanyByVkn);
  document.querySelectorAll('.insight-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentInsightTab = btn.dataset.insightTab || 'profit';
      document.querySelectorAll('.insight-tab-btn').forEach((x) => x.classList.toggle('active', x === btn));
      renderStockInsights();
    });
  });
  addPendingPoLine();
}

async function loadAllData() {
  await Promise.all([
    loadStockSummary(),
    loadMovements(),
    loadPendingOrders()
  ]);
}

// ─── TAB SWITCH ───────────────────────────────────────────────────────────────
function switchStockTab(tab) {
  currentStockTab = tab;
  ['depo', 'hareketler', 'bekleyen'].forEach(t => {
    document.getElementById(`tabContent-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`)?.classList.toggle('active', t === tab);
  });
}

// ─── TAB 1: DEPO DURUMU ───────────────────────────────────────────────────────
async function loadStockSummary() {
  const cached = readCache(STOCK_CACHE_KEY);
  if (cached) {
    allStocks  = cached.data  || [];
    stockStats = cached.stats || null;
    renderStockStats();
    renderStockInsights();
    renderDepoTable();
  }

  try {
    const res = await fetch('/api/stocks/summary');
    if (!res.ok) throw new Error('Stok verileri alınamadı');
    const payload = await res.json();
    allStocks  = payload.data  || [];
    stockStats = payload.stats || null;
    writeCache(STOCK_CACHE_KEY, { data: allStocks, stats: stockStats });
    renderStockStats();
    renderStockInsights();
    renderDepoTable();
  } catch (err) {
    console.error('Stok hatası:', err);
    if (!cached) showEmpty('stocksEmptyState', 'Stok verileri alınamadı.');
  }
}

function renderDepoTable() {
  const body       = document.getElementById('stocksTableBody');
  const emptyEl    = document.getElementById('stocksEmptyState');
  const search     = (document.getElementById('stockSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  if (!body) return;

  const filtered = allStocks.filter(r =>
    !search ||
    String(r.product_name || '').toLocaleLowerCase('tr-TR').includes(search) ||
    String(r.sku || '').toLocaleLowerCase('tr-TR').includes(search)
  );

  body.innerHTML = '';
  if (!filtered.length) {
    showEmpty('stocksEmptyState', search ? 'Arama sonucu bulunamadı.' : 'Henüz stok kaydı yok.');
    return;
  }
  emptyEl.style.display = 'none';

  // Her ürün için bekleyen backorder miktarını bul
  const backorderBySkuMap = {};
  allPendingOrders.forEach(po => {
    const sku = po.products?.product_code || '';
    if (!sku) return;
    const remaining = Number(po.ordered_qty) - Number(po.received_qty);
    if (!backorderBySkuMap[sku]) backorderBySkuMap[sku] = 0;
    backorderBySkuMap[sku] += remaining;
  });

  filtered.forEach(row => {
    const backorder = backorderBySkuMap[row.sku] || 0;
    const stockClass = Number(row.current_stock) <= 0 ? 'text-danger' : Number(row.current_stock) < 5 ? 'text-warning' : 'text-success';
    const tr = document.createElement('tr');
    tr.dataset.productId = row.product_id || '';
    tr.title = 'Düzenlemek için tıklayın';
    tr.onclick = () => { if (row.product_id) openProductModal(row.product_id); };
    tr.innerHTML = `
      <td style="font-weight:600;">${esc(row.product_name)}</td>
      <td><span class="badge-sku">${esc(row.sku || '-')}</span></td>
      <td class="text-right text-success">${fmtQty(row.total_in)}</td>
      <td class="text-right text-danger">${fmtQty(row.total_out)}</td>
      <td class="text-right"><strong class="${stockClass}">${fmtQty(row.current_stock)}</strong></td>
      <td class="text-right">${backorder > 0 ? `<span class="badge-backorder">+${fmtQty(backorder)}</span>` : '<span style="color:#94a3b8;">—</span>'}</td>
      <td class="text-right">${fmtQty(row.reserved_quantity || 0)}</td>
      <td class="text-right">${fmtQty(row.gift_quantity || 0)}</td>
      <td class="text-right">${fmtUsdOrDash(row.stock_usd)}</td>
    `;
    body.appendChild(tr);
  });
}

function renderStockStats() {
  document.getElementById('stat-product-count').innerText = String(allStocks.length);
  document.getElementById('stat-current').innerText   = fmtQty(stockStats?.current_qty   ?? allStocks.reduce((a, r) => a + Number(r.current_stock || 0), 0));
  document.getElementById('stat-total-in').innerText  = fmtQty(stockStats?.total_in_qty  ?? allStocks.reduce((a, r) => a + Number(r.total_in     || 0), 0));
  document.getElementById('stat-total-out').innerText = fmtQty(stockStats?.total_out_qty ?? allStocks.reduce((a, r) => a + Number(r.total_out    || 0), 0));
}

function renderStockInsights() {
  const barsEl = document.getElementById('stockInsightBars');
  const subEl = document.getElementById('stockInsightSubLabel');
  if (!barsEl || !subEl) return;

  const model = buildInsightModel();
  const active = model[currentInsightTab] || model.profit;
  const rows = Array.isArray(active.rows) ? active.rows : [];
  const maxVal = rows.reduce((acc, row) => Math.max(acc, Number(row.value) || 0), 0);

  subEl.textContent = active.subtitle || 'Top 10';
  barsEl.innerHTML = '';

  if (!rows.length) {
    barsEl.innerHTML = '<div class="insight-empty">Bu görünüm için yeterli veri yok.</div>';
    return;
  }

  rows.forEach((row) => {
    const widthPct = maxVal > 0 ? Math.max(3, Math.round((Number(row.value || 0) / maxVal) * 100)) : 0;
    const el = document.createElement('div');
    el.className = 'insight-row';
    el.innerHTML = `
      <div class="insight-name" title="${esc(row.name)}">${esc(row.name)}</div>
      <div class="insight-track">
        <div class="insight-fill insight-fill--${active.variant}" style="width:${widthPct}%;"></div>
      </div>
      <div class="insight-value">${esc(row.label)}</div>
    `;
    barsEl.appendChild(el);
  });
}

function buildInsightModel() {
  const slowMoving = allStocks
    .map((row) => {
      const sku = String(row.sku || '');
      const current = Number(row.current_stock || 0);
      const sold30 = getSoldQtyLastDaysBySku(sku, 30);
      const coverDays = sold30 > 0 ? Math.round((current / sold30) * 30) : (current > 0 ? 9999 : 0);
      return {
        name: row.product_name || sku || 'Ürün',
        value: coverDays,
        label: coverDays >= 9999 ? 'Satış yok' : `${coverDays} gün`,
        hasStock: current > 0
      };
    })
    .filter((x) => x.hasStock && x.value > 0)
    .sort((a, b) => (b.value - a.value))
    .slice(0, 10);

  const topSold = allStocks
    .map((row) => ({
      name: row.product_name || row.sku || 'Ürün',
      value: Number(row.total_out || 0)
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => (b.value - a.value))
    .slice(0, 10)
    .map((x) => ({ ...x, label: `${fmtQty(x.value)} adet` }));

  const topProfit = allStocks
    .map((row) => {
      return {
        name: row.product_name || row.sku || 'Ürün',
        value: Number(row.fifo_gross_profit_usd || 0)
      };
    })
    .filter((x) => x.value > 0)
    .sort((a, b) => (b.value - a.value))
    .slice(0, 10)
    .map((x) => ({ ...x, label: fmtUsd(x.value) }));

  return {
    slow: {
      subtitle: 'Top 10 - Depoda en uzun süre yetecek ürünler',
      variant: 'slow',
      rows: slowMoving
    },
    sold: {
      subtitle: 'Top 10 - Satılan adet',
      variant: 'sold',
      rows: topSold
    },
    profit: {
      subtitle: 'Top 10 - FIFO brüt kar (USD)',
      variant: 'profit',
      rows: topProfit
    }
  };
}

function getSoldQtyLastDaysBySku(sku, days) {
  if (!sku) return 0;
  const nowTs = Date.now();
  const maxAge = Number(days || 30) * 24 * 60 * 60 * 1000;
  return allMovements.reduce((sum, mv) => {
    if (String(mv.sku || '') !== sku) return sum;
    if (String(mv.direction || '') !== 'OUTGOING') return sum;
    const ts = mv.invoice_date ? new Date(mv.invoice_date).getTime() : NaN;
    if (!Number.isFinite(ts)) return sum;
    if ((nowTs - ts) > maxAge) return sum;
    return sum + (Number(mv.quantity || 0) || 0);
  }, 0);
}

// ─── TAB 2: STOK HAREKETLERİ ──────────────────────────────────────────────────
async function loadMovements() {
  const cached = readCache(MOVEMENT_CACHE_KEY);
  if (cached) {
    allMovements = cached;
    renderMovementCompanyOptions();
    renderStockInsights();
    renderMovementsTable();
  }

  try {
    const res = await fetch('/api/stocks/movements');
    if (!res.ok) throw new Error();
    allMovements = await res.json();
    writeCache(MOVEMENT_CACHE_KEY, allMovements);
    renderMovementCompanyOptions();
    renderStockInsights();
    renderMovementsTable();
  } catch {
    if (!cached) showEmpty('movementsEmptyState', 'Hareket verileri alınamadı.');
  }
}

function renderMovementsTable() {
  const body    = document.getElementById('movementsTableBody');
  const emptyEl = document.getElementById('movementsEmptyState');
  const search  = (document.getElementById('movementSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const selectedCompany = (document.getElementById('movementCompany')?.value || '').trim();
  const dir     = document.getElementById('movementDirection')?.value || '';
  if (!body) return;

  const filtered = allMovements.filter(m => {
    const matchSearch = !search ||
      String(m.product_name || '').toLocaleLowerCase('tr-TR').includes(search) ||
      String(m.sku          || '').toLocaleLowerCase('tr-TR').includes(search);
    const matchCompany = !selectedCompany || String(m.company_name || '') === selectedCompany;
    const matchDir = !dir || m.direction === dir;
    return matchSearch && matchCompany && matchDir;
  });

  body.innerHTML = '';
  if (!filtered.length) {
    showEmpty('movementsEmptyState', 'Hareket kaydı bulunamadı.');
    return;
  }
  emptyEl.style.display = 'none';

  filtered.forEach(m => {
    const isIn  = m.direction === 'INCOMING';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="movement-date-cell">${m.invoice_date || '—'}</td>
      <td>
        <span class="badge-dir ${isIn ? 'badge-in' : 'badge-out'}">
          ${isIn ? '▲ Giriş' : '▼ Çıkış'}
        </span>
      </td>
      <td><span class="badge-sku">${esc(m.invoice_no || '—')}</span></td>
      <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(m.company_name || '')}">${esc(m.company_name || '—')}</td>
      <td style="font-weight:500;">${esc(m.product_name || '—')}</td>
      <td><span class="badge-sku">${esc(m.sku || '—')}</span></td>
      <td class="text-right"><strong class="${isIn ? 'text-success' : 'text-danger'}">${isIn ? '+' : '-'}${fmtQty(m.quantity)}</strong></td>
      <td class="text-right">${m.unit_price_cur != null ? Number(m.unit_price_cur).toLocaleString('tr-TR', {minimumFractionDigits:2}) : '—'}</td>
      <td>${esc(m.currency || '—')}</td>
    `;
    body.appendChild(tr);
  });
}

function renderMovementCompanyOptions() {
  const hidden = document.getElementById('movementCompany');
  const currentVal = String(hidden?.value || '').trim();
  movementCompanyList = [...new Set(
    allMovements
      .map((m) => String(m.company_name || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'tr'));

  if (hidden && currentVal && !movementCompanyList.includes(currentVal)) {
    hidden.value = '';
  }
  _renderMovementCompanyList('');
  _refreshMovementCompanyButton();
}

function filterMovementCompanyDropdown() {
  const q = (document.getElementById('movementCompanyDropdownSearch')?.value || '').toLocaleLowerCase('tr-TR').trim();
  _renderMovementCompanyList(q);
}

function _renderMovementCompanyList(query) {
  const list = document.getElementById('movementCompanyDropdownList');
  const selected = String(document.getElementById('movementCompany')?.value || '');
  if (!list) return;

  const filtered = query
    ? movementCompanyList.filter((name) =>
        name
          .toLocaleLowerCase('tr-TR')
          .split(/\s+/)
          .some((word) => word.startsWith(query))
      )
    : movementCompanyList;

  list.innerHTML = '';
  const allLi = document.createElement('li');
  allLi.textContent = 'Tüm Firmalar';
  allLi.className = 'all-option' + (selected === '' ? ' selected' : '');
  allLi.onclick = () => _setMovementCompanyValue('');
  list.appendChild(allLi);

  filtered.forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    li.title = name;
    if (name === selected) li.classList.add('selected');
    li.onclick = () => _setMovementCompanyValue(name);
    list.appendChild(li);
  });

  if (filtered.length === 0 && query) {
    const empty = document.createElement('li');
    empty.textContent = 'Sonuç bulunamadı';
    empty.style.cssText = 'color:#94a3b8; cursor:default; pointer-events:none;';
    list.appendChild(empty);
  }
}

function _setMovementCompanyValue(val) {
  const hidden = document.getElementById('movementCompany');
  if (hidden) hidden.value = val;
  _refreshMovementCompanyButton();
  closeMovementCompanyDropdown();
  renderMovementsTable();
}

function _refreshMovementCompanyButton() {
  const value = String(document.getElementById('movementCompany')?.value || '');
  const label = document.getElementById('movementCompanyDropdownLabel');
  const btn = document.getElementById('movementCompanyDropdownBtn');
  if (label) label.textContent = value || 'Tüm Firmalar';
  if (btn) btn.style.color = value ? '#0f172a' : '#374151';
}

function toggleMovementCompanyDropdown() {
  const panel = document.getElementById('movementCompanyDropdownPanel');
  const search = document.getElementById('movementCompanyDropdownSearch');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    closeMovementCompanyDropdown();
  } else {
    panel.style.display = 'block';
    if (search) {
      search.value = '';
      search.focus();
    }
    _renderMovementCompanyList('');
    setTimeout(() => document.addEventListener('click', outsideMovementCompanyClick), 0);
  }
}

function closeMovementCompanyDropdown() {
  const panel = document.getElementById('movementCompanyDropdownPanel');
  if (panel) panel.style.display = 'none';
  document.removeEventListener('click', outsideMovementCompanyClick);
}

function outsideMovementCompanyClick(e) {
  const wrap = document.getElementById('movementCompanyDropdownWrap');
  if (wrap && !wrap.contains(e.target)) closeMovementCompanyDropdown();
}

// ─── TAB 3: BEKLEYEN SİPARİŞLER ──────────────────────────────────────────────
async function loadPendingOrders() {
  const cached = readCache(PO_CACHE_KEY);
  if (cached) {
    allPendingOrders = cached;
    renderPendingOrdersTable();
    updatePendingPoStat();
    renderStockInsights();
  }

  try {
    const res = await fetch('/api/purchase-orders/all-pending');
    if (!res.ok) throw new Error();
    allPendingOrders = await res.json();
    writeCache(PO_CACHE_KEY, allPendingOrders);
    renderPendingOrdersTable();
    updatePendingPoStat();
    renderStockInsights();
  } catch {
    if (!cached) showEmpty('poEmptyState', 'Sipariş verileri alınamadı.');
  }
}

function updatePendingPoStat() {
  const count = allPendingOrders.filter(po => Number(po.ordered_qty) > Number(po.received_qty)).length;
  document.getElementById('stat-pending-po').innerText = String(count);
}

function renderPendingOrdersTable() {
  const body    = document.getElementById('poTableBody');
  const emptyEl = document.getElementById('poEmptyState');
  const search  = (document.getElementById('poSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const showCompleted = !!document.getElementById('poShowCompleted')?.checked;
  if (!body) return;

  const filtered = allPendingOrders.filter(po => {
    const remaining = Number(po.ordered_qty) - Number(po.received_qty);
    if (!showCompleted && remaining <= 0) return false; // sadece bekleyenler
    const companyName = (po.purchase_orders?.companies?.name || '').toLocaleLowerCase('tr-TR');
    const productName = (po.products?.product_name || '').toLocaleLowerCase('tr-TR');
    const productSku  = (po.products?.product_code || '').toLocaleLowerCase('tr-TR');
    return !search || companyName.includes(search) || productName.includes(search) || productSku.includes(search);
  });

  body.innerHTML = '';
  if (!filtered.length) {
    showEmpty('poEmptyState', search ? 'Arama sonucu bulunamadı.' : (showCompleted ? 'Sipariş kaydı yok.' : 'Bekleyen sipariş kaydı yok.'));
    return;
  }
  emptyEl.style.display = 'none';

  filtered.forEach(po => {
    const ordered   = Number(po.ordered_qty)  || 0;
    const received  = Number(po.received_qty) || 0;
    const remaining = ordered - received;
    const isCompleted = remaining <= 0;
    const pct       = ordered > 0 ? Math.round((received / ordered) * 100) : 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge-sku">${esc(po.purchase_orders?.po_number || '—')}</span></td>
      <td>${po.purchase_orders?.order_date || '—'}</td>
      <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(po.purchase_orders?.companies?.name || '')}">${esc(po.purchase_orders?.companies?.name || '—')}</td>
      <td style="font-weight:500;">${esc(po.products?.product_name || '—')}</td>
      <td><span class="badge-sku">${esc(po.products?.product_code || '—')}</span></td>
      <td class="text-right">
        <input
          type="number"
          min="${Math.max(1, Math.ceil(received))}"
          step="1"
          class="po-ordered-input"
          value="${ordered}"
          data-po-id="${po.id}"
          data-original="${ordered}"
          style="width:90px; text-align:right; border:1px solid #cbd5e1; border-radius:6px; padding:4px 6px;"
        >
      </td>
      <td class="text-right text-success">${fmtQty(received)}</td>
      <td class="text-right"><strong class="${isCompleted ? 'text-success' : 'text-warning'}">${fmtQty(remaining)}</strong></td>
      <td>
        <div style="display:flex; align-items:center; gap:6px;">
          <div style="flex:1; background:#e2e8f0; border-radius:4px; height:8px; overflow:hidden;">
            <div style="width:${pct}%; background:#22c55e; height:100%; border-radius:4px;"></div>
          </div>
          <span style="font-size:11px; color:#64748b; white-space:nowrap;">${pct}% ${isCompleted ? '• Tamamlandı' : ''}</span>
        </div>
      </td>
      <td>
        <div class="po-actions">
          <button type="button" class="po-btn po-btn--save" onclick="savePendingOrderItem('${po.id}', this)">Kaydet</button>
          <button type="button" class="po-btn po-btn--delete" onclick="deletePendingOrderItem('${po.id}', this)">Sil</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

// ─── YARDIMCI FONKSİYONLAR ────────────────────────────────────────────────────
function fmtQty(v)       { return Number(v || 0).toLocaleString('tr-TR'); }
function fmtUsd(v)       { return `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtUsdOrDash(v) { if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'; return fmtUsd(v); }
function esc(str)        { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function showEmpty(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'block'; el.innerText = msg; }
}

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ─── MINI FORM: BACKORDER EKLE ────────────────────────────────────────────────
async function autoFillCompanyByVkn() {
  const vknInput = document.getElementById('poCompanyVkn');
  const nameInput = document.getElementById('poCompanyName');
  const vkn = String(vknInput?.value || '').trim();
  if (!nameInput) return;
  if (!vkn) {
    nameInput.value = '';
    return;
  }
  try {
    const res = await fetch(`/api/companies/by-vkn?vkn=${encodeURIComponent(vkn)}`);
    if (!res.ok) return;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return;
    const data = await res.json();
    nameInput.value = data?.name || '';
  } catch {}
}

async function autoFillProductByCode(codeInput, nameInput) {
  const code = String(codeInput?.value || '').trim();
  if (!nameInput) return;
  if (!code) {
    nameInput.value = '';
    return;
  }
  try {
    const res = await fetch(`/api/products/by-code?code=${encodeURIComponent(code)}`);
    if (!res.ok) return;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return;
    const data = await res.json();
    nameInput.value = data?.product_name || '';
  } catch {}
}

function addPendingPoLine() {
  const body = document.getElementById('poLinesBody');
  if (!body) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="po-line-code" placeholder="SKU" required></td>
    <td><input type="text" class="po-line-name" placeholder="Ürün adı (otomatik)" readonly></td>
    <td><input type="number" class="po-line-qty" min="1" step="1" placeholder="Miktar" required></td>
    <td><button type="button" class="po-btn po-btn--delete" onclick="removePendingPoLine(this)">Sil</button></td>
  `;
  const codeInput = tr.querySelector('.po-line-code');
  const nameInput = tr.querySelector('.po-line-name');
  codeInput?.addEventListener('blur', () => autoFillProductByCode(codeInput, nameInput));
  body.appendChild(tr);
}

function removePendingPoLine(btn) {
  const body = document.getElementById('poLinesBody');
  if (!body) return;
  if (body.children.length <= 1) return;
  btn.closest('tr')?.remove();
}

async function submitPendingPoForm(e) {
  e.preventDefault();
  const msgEl = document.getElementById('pendingPoFormMsg');
  const form = document.getElementById('pendingPoForm');
  const payload = {
    company_vkn: String(document.getElementById('poCompanyVkn')?.value || '').trim(),
    company_name: String(document.getElementById('poCompanyName')?.value || '').trim(),
    items: Array.from(document.querySelectorAll('#poLinesBody tr')).map((row) => ({
      product_code: String(row.querySelector('.po-line-code')?.value || '').trim(),
      ordered_qty: Number(row.querySelector('.po-line-qty')?.value || 0)
    })).filter(x => x.product_code && x.ordered_qty > 0)
  };

  if (!payload.company_vkn || payload.items.length === 0) {
    if (msgEl) msgEl.textContent = 'VKN ve en az bir ürün satırı zorunlu.';
    return;
  }

  if (msgEl) msgEl.textContent = 'Kaydediliyor...';
  try {
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const raw = await res.text();
      const isHtml = raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html');
      throw new Error(isHtml
        ? 'API yerine HTML döndü. Sunucuyu yeniden başlatın ve /api/purchase-orders route’unun yüklendiğini kontrol edin.'
        : 'Sunucudan beklenmeyen cevap alındı.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Kayıt hatası');

    if (msgEl) msgEl.textContent = `Kaydedildi: ${data?.po_number || 'PO oluşturuldu'}`;
    form?.reset();
    const linesBody = document.getElementById('poLinesBody');
    if (linesBody) linesBody.innerHTML = '';
    addPendingPoLine();
    sessionStorage.removeItem(PO_CACHE_KEY);
    sessionStorage.removeItem(STOCK_CACHE_KEY);
    await Promise.all([loadPendingOrders(), loadStockSummary()]);
  } catch (err) {
    if (msgEl) msgEl.textContent = `Hata: ${err.message}`;
  }
}

async function savePendingOrderItem(poItemId, btnEl) {
  const input = document.querySelector(`.po-ordered-input[data-po-id="${poItemId}"]`);
  if (!input) return;
  const orderedQty = Number(input.value || 0);
  const original = Number(input.dataset.original || 0);
  if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
    alert('Sipariş miktarı pozitif sayı olmalı.');
    return;
  }
  if (orderedQty === original) return;

  btnEl.disabled = true;
  try {
    const res = await fetch(`/api/purchase-order-items/${encodeURIComponent(poItemId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_qty: orderedQty })
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const raw = await res.text();
      const isHtml = raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html');
      throw new Error(isHtml
        ? 'API yerine HTML döndü. Sunucuyu yeniden başlatın ve /api/purchase-order-items/:id route’unun yüklendiğini kontrol edin.'
        : 'Sunucudan beklenmeyen cevap alındı.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Güncelleme başarısız');
    input.dataset.original = String(orderedQty);
    sessionStorage.removeItem(PO_CACHE_KEY);
    sessionStorage.removeItem(STOCK_CACHE_KEY);
    await Promise.all([loadPendingOrders(), loadStockSummary()]);
  } catch (err) {
    alert(`Güncelleme hatası: ${err.message}`);
  } finally {
    btnEl.disabled = false;
  }
}

async function deletePendingOrderItem(poItemId, btnEl) {
  if (!confirm('Bu bekleyen sipariş kalemini silmek istiyor musunuz?')) return;
  btnEl.disabled = true;
  try {
    const res = await fetch(`/api/purchase-order-items/${encodeURIComponent(poItemId)}`, {
      method: 'DELETE'
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const raw = await res.text();
      const isHtml = raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html');
      throw new Error(isHtml
        ? 'API yerine HTML döndü. Sunucuyu yeniden başlatın ve /api/purchase-order-items/:id route’unun yüklendiğini kontrol edin.'
        : 'Sunucudan beklenmeyen cevap alındı.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Silme başarısız');
    sessionStorage.removeItem(PO_CACHE_KEY);
    sessionStorage.removeItem(STOCK_CACHE_KEY);
    await Promise.all([loadPendingOrders(), loadStockSummary()]);
  } catch (err) {
    alert(`Silme hatası: ${err.message}`);
  } finally {
    btnEl.disabled = false;
  }
}


// ─── ÜRÜN DETAY MODALİ ───────────────────────────────────────────────────────
let _editingProductId = null;

async function openProductModal(productId) {
  if (!productId) return;
  _editingProductId = productId;

  const msgEl = document.getElementById('productModalMsg');
  const saveBtn = document.getElementById('productModalSaveBtn');
  msgEl.textContent = 'Yükleniyor...';
  msgEl.className = 'modal-msg';
  saveBtn.disabled = true;

  document.getElementById('productEditModal').style.display = 'flex';

  try {
    const res = await fetch(`/api/products/${productId}`);
    if (!res.ok) throw new Error('Ürün verisi alınamadı.');
    const product = await res.json();

    document.getElementById('productModalTitle').textContent = product.product_name || 'Ürün Detayı';
    fillProductModal(product);
    msgEl.textContent = '';
    saveBtn.disabled = false;
  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className = 'modal-msg error';
  }
}

function fillProductModal(p) {
  const fields = [
    'product_name', 'product_code', 'brand', 'category', 'model',
    'maliyet_usd', 'sozlesme_fiyat_eur',
    'last_purchase_price_cur', 'last_purchase_currency',
    'last_purchase_rate', 'last_purchase_price_tl', 'avg_purchase_price_tl',
    'dmo_code', 'dmo_fiyat_try', 'dmo_url', 'gift_quantity',
    'stock_on_hand', 'reserved_quantity', 'ordered_quantity', 'shipped_total',
  ];
  fields.forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (el) el.value = p[key] ?? '';
  });

  // Timestamps — format nicely
  ['created_at', 'updated_at', 'dmo_fiyat_updated'].forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (!el) return;
    el.value = p[key] ? new Date(p[key]).toLocaleString('tr-TR') : '—';
  });
}

function closeProductModal() {
  document.getElementById('productEditModal').style.display = 'none';
  _editingProductId = null;
  const msgEl = document.getElementById('productModalMsg');
  msgEl.textContent = '';
  msgEl.className = 'modal-msg';
}

async function saveProductModal() {
  if (!_editingProductId) return;

  const msgEl  = document.getElementById('productModalMsg');
  const saveBtn = document.getElementById('productModalSaveBtn');
  msgEl.textContent  = 'Kaydediliyor...';
  msgEl.className    = 'modal-msg';
  saveBtn.disabled   = true;

  const fields = [
    'product_name', 'product_code', 'brand', 'category', 'model',
    'maliyet_usd', 'sozlesme_fiyat_eur',
    'last_purchase_price_cur', 'last_purchase_currency',
    'last_purchase_rate', 'last_purchase_price_tl', 'avg_purchase_price_tl',
    'dmo_code', 'dmo_fiyat_try', 'dmo_url', 'gift_quantity',
    'stock_on_hand', 'reserved_quantity', 'ordered_quantity', 'shipped_total',
  ];

  const numericFields = new Set([
    'maliyet_usd', 'sozlesme_fiyat_eur',
    'last_purchase_price_cur', 'last_purchase_rate',
    'last_purchase_price_tl', 'avg_purchase_price_tl',
    'dmo_fiyat_try', 'gift_quantity',
    'stock_on_hand', 'reserved_quantity', 'ordered_quantity', 'shipped_total',
  ]);

  const payload = {};
  fields.forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (!el) return;
    const raw = el.value.trim();
    if (numericFields.has(key)) {
      payload[key] = raw === '' ? null : Number(raw);
    } else {
      payload[key] = raw === '' ? null : raw;
    }
  });

  try {
    const res = await fetch(`/api/products/${_editingProductId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Kayıt hatası');

    msgEl.textContent = 'Kaydedildi ✓';
    msgEl.className   = 'modal-msg success';

    // Update the matching row in allStocks in memory — no full reload
    updateStockRowInMemory(_editingProductId, payload);

    setTimeout(() => {
      closeProductModal();
    }, 800);

  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className   = 'modal-msg error';
  } finally {
    saveBtn.disabled = false;
  }
}

function updateStockRowInMemory(productId, payload) {
  const idx = allStocks.findIndex(r => r.product_id === productId);
  if (idx === -1) return;

  // Update only the fields that exist in allStocks
  if (payload.product_name     !== undefined) allStocks[idx].product_name     = payload.product_name;
  if (payload.reserved_quantity !== undefined) allStocks[idx].reserved_quantity = Number(payload.reserved_quantity || 0);
  if (payload.gift_quantity    !== undefined) allStocks[idx].gift_quantity     = Number(payload.gift_quantity    || 0);

  // Re-render only the affected row
  const body = document.getElementById('stocksTableBody');
  if (!body) return;
  const rows = body.querySelectorAll('tr');
  rows.forEach(tr => {
    if (tr.dataset.productId === productId) {
      const row = allStocks[idx];
      const stockClass = Number(row.current_stock) <= 0 ? 'text-danger'
                       : Number(row.current_stock) < 5  ? 'text-warning'
                       : 'text-success';
      tr.querySelector('td:first-child').textContent = esc(row.product_name);
      tr.querySelector('td:nth-child(7)').textContent = fmtQty(row.reserved_quantity || 0);
      tr.querySelector('td:nth-child(8)').textContent = fmtQty(row.gift_quantity || 0);
    }
  });
}