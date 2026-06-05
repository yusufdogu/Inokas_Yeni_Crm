// stok/backorder.js — Bekleyen Siparişler

// ─── STATE ────────────────────────────────────────────────────────────────────
let _allOrders      = [];   // grouped by po_number
let _filteredOrders = [];
let _boStatus       = 'pending';  // 'pending' | 'done'
let _boSearch       = '';
let _boDateStart    = null;
let _boDateEnd      = null;
let _brandList      = [];
let _categoryList   = [];

// Date picker state
let _dpYear  = new Date().getFullYear();
let _dpMonth = new Date().getMonth();
let _dpStart = null;
let _dpEnd   = null;

const MONTHS_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const DAYS_TR   = ['Pt','Sa','Ça','Pe','Cu','Ct','Pz'];

const PO_CACHE_KEY = 'inokas_pending_po_v1';

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initBackorder() {
  await loadBrandsCategories();
  addPoLine();
  document.getElementById('poCompanyVkn')?.addEventListener('blur', autoFillCompanyByVkn);
  document.getElementById('boSearch')?.addEventListener('input', e => {
    _boSearch = e.target.value.trim().toLocaleLowerCase('tr-TR');
    applyBoFilters();
  });

  // Date picker close on outside click
  document.addEventListener('click', e => {
    const wrap = document.getElementById('boDateWrap');
    if (wrap && !wrap.contains(e.target)) {
      document.getElementById('boDatePicker')?.classList.remove('open');
    }
  });

  boRenderCalendar();
  await loadPendingOrders();
}

async function loadBrandsCategories() {
  try {
    const res = await fetch('/api/products/category-map');
    if (!res.ok) return;
    const data = await res.json();
    _brandList    = data.brands    || [];
    _categoryList = data.categories || [];
  } catch { }
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadPendingOrders() {
  const cached = readCache(PO_CACHE_KEY);
  if (cached) {
    _allOrders = groupByPo(cached);
    renderBoKpis();
    applyBoFilters();
  }

  try {
    const res = await fetch('/api/purchase-orders/all-pending');
    if (!res.ok) throw new Error();
    const items    = await res.json();
    _allOrders     = groupByPo(items);
    writeCache(PO_CACHE_KEY, items);
    renderBoKpis();
    applyBoFilters();
  } catch {
    if (!cached) {
      document.getElementById('poEmpty')?.classList.add('visible');
    }
  }
}

// Group flat purchase_order_items into orders
function groupByPo(items) {
  const map = new Map();

  (items || []).forEach(item => {
    const poNo = item.purchase_orders?.po_number || '—';
    if (!map.has(poNo)) {
      map.set(poNo, {
        po_number:  poNo,
        order_date: item.purchase_orders?.order_date || '',
        company:    item.purchase_orders?.companies?.name || '—',
        lines:      [],
      });
    }
    map.get(poNo).lines.push(item);
  });

  return [...map.values()].map(order => ({
    ...order,
    status:        deriveStatus(order),
    totalByCurrency: calcTotalByCurrency(order.lines),
  })).sort((a, b) => b.order_date.localeCompare(a.order_date));
}

function deriveStatus(order) {
  const totalRem = order.lines.reduce((s, l) =>
    s + (Number(l.ordered_qty || 0) - Number(l.received_qty || 0)), 0);
  const totalOrd = order.lines.reduce((s, l) => s + Number(l.ordered_qty || 0), 0);
  if (totalRem <= 0)       return 'done';
  if (totalRem < totalOrd) return 'partial';
  return 'pending';
}

function calcTotalByCurrency(lines) {
  const map = {};
  lines.forEach(l => {
    let cur = (l.currency || '').toUpperCase().trim();
    if (cur === 'TL') cur = 'TRY';
    if (!cur) return;
    const val = Number(l.line_total_cur || 0) ||
                (Number(l.unit_price_cur || 0) * Number(l.ordered_qty || 0));
    if (val) map[cur] = (map[cur] || 0) + val;
  });
  return map;
}

function fmtCurrencyMap(map) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '—';
  return entries.map(([cur, val]) => {
    const sym = cur === 'TRY' ? '₺' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur + ' ';
    return sym + val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }).join(' · ');
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
function renderBoKpis() {
  const pending = _allOrders.filter(o => o.status !== 'done');

  const pendingLines = pending.reduce((s, o) =>
    s + o.lines.filter(l => (Number(l.ordered_qty || 0) - Number(l.received_qty || 0)) > 0).length, 0);

  const pendingQty = pending.reduce((s, o) =>
    s + o.lines.reduce((ls, l) => ls + Math.max(0, Number(l.ordered_qty || 0) - Number(l.received_qty || 0)), 0), 0);

  const receivedQty = _allOrders.reduce((s, o) =>
    s + o.lines.reduce((ls, l) => ls + Number(l.received_qty || 0), 0), 0);

  // Total pending value by currency
  const valMap = {};
  pending.forEach(o => {
    Object.entries(o.totalByCurrency).forEach(([cur, val]) => {
      valMap[cur] = (valMap[cur] || 0) + val;
    });
  });

  const valEntries  = Object.entries(valMap).sort((a, b) => b[1] - a[1]);
  const heroVal     = valEntries[0];
  const subVals     = valEntries.slice(1);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  if (heroVal) {
    const sym = heroVal[0] === 'TRY' ? '₺' : heroVal[0] === 'USD' ? '$' : heroVal[0] === 'EUR' ? '€' : heroVal[0] + ' ';
    setEl('kpi-bo-val', sym + heroVal[1].toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setEl('kpi-bo-val-sub', subVals.map(([c, v]) => {
      const s = c === 'TRY' ? '₺' : c === 'USD' ? '$' : c === 'EUR' ? '€' : c + ' ';
      return s + v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }).join(' · '));
  } else {
    setEl('kpi-bo-val', '—');
    setEl('kpi-bo-val-sub', '');
  }

  setEl('kpi-pending',       String(pending.length));
  setEl('kpi-pending-lines', String(pendingLines));
  setEl('kpi-qty',           fmtQty(pendingQty));
  setEl('kpi-received',      fmtQty(receivedQty));
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────
function boSetStatus(status) {
  _boStatus = status;
  document.getElementById('boChipPending')?.classList.toggle('stk-chip--active', status === 'pending');
  document.getElementById('boChipDone')?.classList.toggle('stk-chip--active',   status === 'done');
  applyBoFilters();
}

function applyBoFilters() {
  _filteredOrders = _allOrders.filter(o => {
    // Status
    if (_boStatus === 'pending' && o.status === 'done') return false;
    if (_boStatus === 'done'    && o.status !== 'done') return false;

    // Date
    if (_boDateStart && o.order_date < _boDateStart) return false;
    if (_boDateEnd   && o.order_date > _boDateEnd)   return false;

    // Search
    if (_boSearch) {
      const searchIn = [
        o.po_number,
        o.company,
        ...o.lines.map(l => l.products?.product_name || ''),
        ...o.lines.map(l => l.products?.product_code || ''),
      ].join(' ').toLocaleLowerCase('tr-TR');
      if (!searchIn.includes(_boSearch)) return false;
    }

    return true;
  });

  renderBoTable();
}

function _clearBoFilters() {
  _boSearch    = '';
  _boStatus    = 'pending';
  _boDateStart = null;
  _boDateEnd   = null;
  _dpStart     = null;
  _dpEnd       = null;

  const searchEl = document.getElementById('boSearch');
  if (searchEl) searchEl.value = '';

  document.getElementById('boDateBtnLabel').textContent = 'Tarih aralığı seç';
  document.getElementById('boDateBtn')?.classList.remove('has-val');

  document.getElementById('boChipPending')?.classList.add('stk-chip--active');
  document.getElementById('boChipDone')?.classList.remove('stk-chip--active');

  boRenderCalendar();
  applyBoFilters();
}

// ─── TABLE ────────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  pending: { label: 'Bekliyor',     cls: 'stk-bo-badge--pending' },
  partial: { label: 'Kısmi Geldi',  cls: 'stk-bo-badge--partial' },
  done:    { label: 'Tamamlandı',   cls: 'stk-bo-badge--done'    },
};

function renderBoTable() {
  const list    = document.getElementById('poList');
  const emptyEl = document.getElementById('poEmpty');
  if (!list) return;

  list.innerHTML = '';

  if (!_filteredOrders.length) {
    emptyEl?.classList.add('visible');
    return;
  }
  emptyEl?.classList.remove('visible');

  _filteredOrders.forEach(order => {
    const st       = STATUS_MAP[order.status] || STATUS_MAP.pending;
    const valStr   = fmtCurrencyMap(order.totalByCurrency);
    const initials = order.company.trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
    const dateStr  = order.order_date ? order.order_date.slice(0, 10) : '—';

    const row = document.createElement('div');
    row.className = 'stk-bo-row';
    row.innerHTML = `
      <span class="stk-bo-po-no">${esc(order.po_number)}</span>
      <span class="stk-bo-date">${esc(dateStr)}</span>
      <span class="stk-bo-company">${esc(order.company)}</span>
      <span class="stk-bo-count">${order.lines.length} kalem</span>
      <span class="stk-bo-val">${esc(valStr)}</span>
      <span class="stk-bo-status"><span class="stk-bo-badge ${st.cls}">${st.label}</span></span>`;
    row.onclick = () => openBoDetailModal(order, initials);
    list.appendChild(row);
  });
}

// ─── DETAIL MODAL ─────────────────────────────────────────────────────────────
function openBoDetailModal(order, initials) {
  const st = STATUS_MAP[order.status] || STATUS_MAP.pending;

  document.getElementById('boModalAvatar').textContent = initials || '—';
  document.getElementById('boModalTitle').textContent  = order.po_number + ' — ' + order.company;
  document.getElementById('boModalSub').textContent    = (order.order_date || '').slice(0, 10) + ' · ' + st.label;

  const totalRem = order.lines.reduce((s, l) =>
    s + Math.max(0, Number(l.ordered_qty || 0) - Number(l.received_qty || 0)), 0);
  const totalRcv = order.lines.reduce((s, l) => s + Number(l.received_qty || 0), 0);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('boStatLines', order.lines.length + ' kalem');
  setEl('boStatVal',   fmtCurrencyMap(order.totalByCurrency));
  setEl('boStatRem',   fmtQty(totalRem) + ' adet');
  setEl('boStatRcv',   fmtQty(totalRcv) + ' adet');

  const tbody   = document.getElementById('boDetailLines');
  const emptyEl = document.getElementById('boDetailEmpty');
  tbody.innerHTML = '';

  if (!order.lines.length) {
    emptyEl?.classList.add('visible');
  } else {
    emptyEl?.classList.remove('visible');
    order.lines.forEach(l => {
      const ordered   = Number(l.ordered_qty  || 0);
      const received  = Number(l.received_qty || 0);
      const remaining = Math.max(0, ordered - received);
      const pct       = ordered > 0 ? Math.round((received / ordered) * 100) : 0;
      const unitPrice = l.unit_price_cur != null
        ? Number(l.unit_price_cur).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ' + (l.currency || '')
        : '—';
      const lineTotal = l.line_total_cur != null
        ? Number(l.line_total_cur).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ' + (l.currency || '')
        : '—';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:500;">${esc(l.products?.product_name || l.product_name || '—')}</td>
        <td><span class="badge-sku">${esc(l.products?.product_code || '—')}</span></td>
        <td style="text-align:right; font-family:'DM Mono',monospace;">${fmtQty(ordered)}</td>
        <td style="text-align:right; font-family:'DM Mono',monospace; color:var(--stk-green);">${fmtQty(received)}</td>
        <td style="text-align:right; font-family:'DM Mono',monospace; font-weight:600; color:${remaining > 0 ? 'var(--stk-amber)' : 'var(--stk-green)'};">${fmtQty(remaining)}</td>
       
        <td style="text-align:right; font-family:'DM Mono',monospace; font-size:12px;">${esc(unitPrice)}</td>
        <td style="text-align:right; font-family:'DM Mono',monospace; font-size:12px;">${esc(lineTotal)}</td>
        <td>
          <div style="display:flex; gap:4px;">
            <button class="stk-bo-action-btn" onclick="deletePoItem('${l.id}', this)" title="Sil">
              <i class="ti ti-trash" style="font-size:12px;" aria-hidden="true"></i>
            </button>
          </div>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('boDetailModal').style.display = 'flex';
}

function closeBoDetailModal() {
  document.getElementById('boDetailModal').style.display = 'none';
}

// ─── FORM MODAL ───────────────────────────────────────────────────────────────
function openBoFormModal() {
  document.getElementById('poCompanyVkn').value  = '';
  document.getElementById('poCompanyName').value = '';
  document.getElementById('poLinesBody').innerHTML = '';
  document.getElementById('poFormMsg').textContent = '';
  addPoLine();
  document.getElementById('boFormModal').style.display = 'flex';
}

function closeBoFormModal() {
  document.getElementById('boFormModal').style.display = 'none';
}

// ─── DATE PICKER ──────────────────────────────────────────────────────────────
function boTogglePicker() {
  document.getElementById('boDatePicker')?.classList.toggle('open');
  boRenderCalendar();
}

function boChangeMonth(dir) {
  _dpMonth += dir;
  if (_dpMonth > 11) { _dpMonth = 0;  _dpYear++; }
  if (_dpMonth < 0)  { _dpMonth = 11; _dpYear--; }
  boRenderCalendar();
}

function boRenderCalendar() {
  const monthEl = document.getElementById('boДpMonth');
  const grid    = document.getElementById('boДpGrid');
  if (!monthEl || !grid) return;

  monthEl.textContent = MONTHS_TR[_dpMonth] + ' ' + _dpYear;
  grid.innerHTML = DAYS_TR.map(d => `<div class="stk-bo-dp-day-hdr">${d}</div>`).join('');

  const firstDay = new Date(_dpYear, _dpMonth, 1).getDay();
  const offset   = firstDay === 0 ? 6 : firstDay - 1;
  const daysIn   = new Date(_dpYear, _dpMonth + 1, 0).getDate();
  const prevDays = new Date(_dpYear, _dpMonth, 0).getDate();

  for (let i = 0; i < offset; i++) {
    const btn = document.createElement('button');
    btn.className   = 'stk-bo-dp-day stk-bo-dp-day--other';
    btn.textContent = prevDays - offset + i + 1;
    btn.disabled    = true;
    grid.appendChild(btn);
  }

  for (let d = 1; d <= daysIn; d++) {
    const date = new Date(_dpYear, _dpMonth, d);
    const iso  = date.toISOString().slice(0, 10);
    const btn  = document.createElement('button');
    btn.className   = 'stk-bo-dp-day';
    btn.textContent = d;

    if (_dpStart && iso === _dpStart) btn.classList.add('stk-bo-dp-day--start');
    if (_dpEnd   && iso === _dpEnd)   btn.classList.add('stk-bo-dp-day--end');
    if (_dpStart && _dpEnd && iso > _dpStart && iso < _dpEnd) btn.classList.add('stk-bo-dp-day--range');

    btn.onclick = () => boSelectDay(iso);
    grid.appendChild(btn);
  }
}

function boSelectDay(iso) {
  if (!_dpStart || (_dpStart && _dpEnd)) {
    _dpStart = iso;
    _dpEnd   = null;
  } else if (iso < _dpStart) {
    _dpEnd   = _dpStart;
    _dpStart = iso;
  } else {
    _dpEnd = iso;
  }
  boRenderCalendar();
}

function boApplyDates() {
  if (!_dpStart) {
    document.getElementById('boDatePicker')?.classList.remove('open');
    return;
  }

  _boDateStart = _dpStart;
  _boDateEnd   = _dpEnd || _dpStart;

  const fmt = iso => iso.split('-').reverse().join('.');
  const label = _dpEnd && _dpEnd !== _dpStart
    ? fmt(_dpStart) + ' – ' + fmt(_dpEnd)
    : fmt(_dpStart);

  document.getElementById('boDateBtnLabel').textContent = label;
  document.getElementById('boDateBtn')?.classList.add('has-val');
  document.getElementById('boDatePicker')?.classList.remove('open');

  applyBoFilters();
}

function boClearDates() {
  _dpStart     = null;
  _dpEnd       = null;
  _boDateStart = null;
  _boDateEnd   = null;
  document.getElementById('boDateBtnLabel').textContent = 'Tarih aralığı seç';
  document.getElementById('boDateBtn')?.classList.remove('has-val');
  boRenderCalendar();
  applyBoFilters();
}

// ─── FORM: ADD LINE ───────────────────────────────────────────────────────────
let _dlCounter = 0;

function buildDatalistCell(sourceList, placeholder, cssClass) {
  const td   = document.createElement('td');
  const dlId = `dl-dynamic-${_dlCounter++}`;
  const dl   = document.createElement('datalist');
  dl.id      = dlId;
  const input = document.createElement('input');
  input.type      = 'text';
  input.className = cssClass;
  input.placeholder = placeholder;
  input.setAttribute('list', dlId);
  input.autocomplete = 'off';
  input.addEventListener('input', () => {
    const q = input.value.trim().toLocaleLowerCase('tr-TR');
    dl.innerHTML = '';
    if (!q) return;
    sourceList.filter(v => v.toLocaleLowerCase('tr-TR').includes(q)).forEach(v => {
      const opt = document.createElement('option'); opt.value = v; dl.appendChild(opt);
    });
  });
  td.appendChild(dl);
  td.appendChild(input);
  return td;
}

function addPoLine() {
  const body = document.getElementById('poLinesBody');
  if (!body) return;
  const tr = document.createElement('tr');

  const tdCode = document.createElement('td');
  const codeInput = document.createElement('input');
  codeInput.type = 'text'; codeInput.className = 'po-line-code'; codeInput.placeholder = 'SKU'; codeInput.required = true;
  tdCode.appendChild(codeInput);

  const tdName = document.createElement('td');
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.className = 'po-line-name'; nameInput.placeholder = '(otomatik)';
  tdName.appendChild(nameInput);

  const tdBrand    = buildDatalistCell(_brandList,    'Marka',    'po-line-brand');
  const tdCategory = buildDatalistCell(_categoryList, 'Kategori', 'po-line-category');

  const tdQty = document.createElement('td');
  const qtyInput = document.createElement('input');
  qtyInput.type = 'number'; qtyInput.className = 'po-line-qty'; qtyInput.min = '1'; qtyInput.step = '1'; qtyInput.placeholder = 'Miktar'; qtyInput.required = true;
  tdQty.appendChild(qtyInput);

  const tdUnit = document.createElement('td');
  const unitInput = document.createElement('input');
  unitInput.type = 'number'; unitInput.className = 'po-line-unit'; unitInput.min = '0'; unitInput.step = '0.01'; unitInput.placeholder = '0,00';
  tdUnit.appendChild(unitInput);

  const tdCur = document.createElement('td');
  tdCur.innerHTML = `<select class="po-line-currency">
    <option value="">—</option>
    <option value="TRY">TRY</option>
    <option value="USD">USD</option>
    <option value="EUR">EUR</option>
  </select>`;

  const tdTotal = document.createElement('td');
  const totalInput = document.createElement('input');
  totalInput.type = 'number'; totalInput.className = 'po-line-total'; totalInput.min = '0'; totalInput.step = '0.01'; totalInput.placeholder = '0,00';
  tdTotal.appendChild(totalInput);

  const tdDel = document.createElement('td');
  const delBtn = document.createElement('button');
  delBtn.type = 'button'; delBtn.className = 'stk-bo-action-btn'; delBtn.innerHTML = '<i class="ti ti-trash" style="font-size:12px;" aria-hidden="true"></i>';
  delBtn.onclick = () => removePoLine(delBtn);
  tdDel.appendChild(delBtn);

  tr.append(tdCode, tdName, tdBrand, tdCategory, tdQty, tdUnit, tdCur, tdTotal, tdDel);

  codeInput.addEventListener('blur', () => autoFillProductByCode(codeInput, nameInput, tdBrand, tdCategory));
  const recalc = () => { totalInput.value = (Number(qtyInput.value || 0) * Number(unitInput.value || 0)).toFixed(2); };
  qtyInput.addEventListener('input', recalc);
  unitInput.addEventListener('input', recalc);

  body.appendChild(tr);
}

function removePoLine(btn) {
  const body = document.getElementById('poLinesBody');
  if (!body || body.children.length <= 1) return;
  btn.closest('tr')?.remove();
}

// ─── FORM: SUBMIT ─────────────────────────────────────────────────────────────
async function submitPoForm(forceCreate = false) {
  const msgEl = document.getElementById('poFormMsg');

  const payload = {
    company_vkn:  String(document.getElementById('poCompanyVkn')?.value  || '').trim(),
    company_name: String(document.getElementById('poCompanyName')?.value || '').trim(),
    force_create: forceCreate,
    items: Array.from(document.querySelectorAll('#poLinesBody tr')).map(row => {
      const qty      = Number(row.querySelector('.po-line-qty')?.value   || 0);
      const unitRaw  = String(row.querySelector('.po-line-unit')?.value  || '').trim();
      const totalRaw = String(row.querySelector('.po-line-total')?.value || '').trim();
      const unitVal  = Number(row.querySelector('.po-line-unit')?.value  || 0);
      return {
        product_code:   String(row.querySelector('.po-line-code')?.value     || '').trim(),
        product_name:   String(row.querySelector('.po-line-name')?.value     || '').trim(),
        brand:          String(row.querySelector('.po-line-brand')?.value    || '').trim(),
        category:       String(row.querySelector('.po-line-category')?.value || '').trim(),
        ordered_qty:    qty,
        unit_price_cur: unitRaw  === '' ? null : Number(unitRaw),
        currency:       String(row.querySelector('.po-line-currency')?.value || '').trim() || null,
        line_total_cur: totalRaw === '' ? (unitVal > 0 ? Number((qty * unitVal).toFixed(2)) : null) : Number(totalRaw),
      };
    }).filter(x => x.product_code && x.ordered_qty > 0)
  };

  if (!payload.company_vkn || !payload.items.length) {
    if (msgEl) { msgEl.textContent = 'VKN ve en az bir ürün satırı zorunlu.'; msgEl.className = 'stk-msg'; }
    return;
  }

  if (msgEl) { msgEl.textContent = 'Kaydediliyor...'; msgEl.className = 'stk-msg'; }

  try {
    const res = await fetch('/api/purchase-orders', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Sunucudan beklenmeyen cevap alındı.');
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 400 && data?.missing_codes?.length) {
        const codes     = data.missing_codes.join(', ');
        const confirmed = confirm(`"${codes}" kodu sistemde bulunamadı.\nYeni ürün olarak eklenecek. Onaylıyor musunuz?`);
        if (confirmed) {
          if (msgEl) { msgEl.textContent = ''; msgEl.className = 'stk-msg'; }
          return submitPoForm(true);
        }
        if (msgEl) { msgEl.textContent = 'İptal edildi.'; msgEl.className = 'stk-msg'; }
        return;
      }
      throw new Error(data?.error || 'Kayıt hatası');
    }

    if (msgEl) { msgEl.textContent = `✓ ${data?.po_number || 'Sipariş oluşturuldu'}`; msgEl.className = 'stk-msg'; }
    clearCache(PO_CACHE_KEY);
    await loadPendingOrders();
    setTimeout(() => closeBoFormModal(), 800);
  } catch (err) {
    if (msgEl) { msgEl.textContent = `Hata: ${err.message}`; msgEl.className = 'stk-msg'; }
  }
}

// ─── INLINE DELETE ────────────────────────────────────────────────────────────
async function deletePoItem(poItemId, btnEl) {
  if (!confirm('Bu sipariş kalemini silmek istiyor musunuz?')) return;
  btnEl.disabled = true;
  try {
    const res  = await fetch(`/api/purchase-order-items/${encodeURIComponent(poItemId)}`, { method: 'DELETE' });
    const ct   = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Sunucudan beklenmeyen cevap.');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Silme başarısız');
    clearCache(PO_CACHE_KEY);
    closeBoDetailModal();
    await loadPendingOrders();
  } catch (err) {
    alert(`Silme hatası: ${err.message}`);
  } finally {
    btnEl.disabled = false;
  }
}

// ─── AUTOFILL HELPERS ─────────────────────────────────────────────────────────
async function autoFillCompanyByVkn() {
  const vkn   = String(document.getElementById('poCompanyVkn')?.value || '').trim();
  const nameEl = document.getElementById('poCompanyName');
  if (!nameEl || !vkn) { if (nameEl) nameEl.value = ''; return; }
  try {
    const res = await fetch(`/api/companies/by-vkn?vkn=${encodeURIComponent(vkn)}`);
    if (!res.ok) return;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return;
    const data = await res.json();
    nameEl.value = data?.name || '';
  } catch { }
}

async function autoFillProductByCode(codeEl, nameEl, brandTd, categoryTd) {
  const code = String(codeEl?.value || '').trim();
  if (!nameEl || !code) { if (nameEl) nameEl.value = ''; return; }
  try {
    const res = await fetch(`/api/products/by-code?code=${encodeURIComponent(code)}`);
    if (!res.ok) return;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return;
    const data = await res.json();
    if (data?.product_name) nameEl.value = data.product_name;
    if (data?.brand    && brandTd)    { const inp = brandTd.querySelector('input');    if (inp) inp.value = data.brand; }
    if (data?.category && categoryTd) { const inp = categoryTd.querySelector('input'); if (inp) inp.value = data.category; }
  } catch { }
}