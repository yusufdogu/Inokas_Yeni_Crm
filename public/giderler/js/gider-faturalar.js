/* ═══════════════════════════════════════════════════════════════════════════
   FATURALAR (list)  — adapted from ofis-ici.js
   ═══════════════════════════════════════════════════════════════════════════ */
let fatCache          = [];
let _fatPage          = 1;
let _fatLimit         = 10;
let _fatTotal         = 0;
let _fatTotalPages    = 1;
let _fatCompanyFilter = null;
let _fatCompanyOptions = [];

function fatInit() {
  _fatInitCompanyFilter();
  _gdBindPopClose();
  loadFatInvoices();
  loadFatFilterOptions();   // was loadFatCompanyOptions
  refreshFatTotals();
}

async function loadFatFilterOptions() {
  try {
    const res = await fetch(`${GD_API}/invoices`);
    if (!res.ok) return;
    const all = await res.json();
    _fatCompanyOptions = [...new Set((all || []).map(i => i.companies?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));

    const cats = new Set();
    (all || []).forEach(inv => (inv.invoice_items || []).forEach(it => {
      if (!it.is_internal && it.item_category) cats.add(it.item_category);
    }));
    const sel = document.getElementById('filterCategory');
    if (sel) [...cats].sort((a, b) => a.localeCompare(b, 'tr')).forEach(c => {
      if (![...sel.options].some(o => o.value === c)) {
        const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
      }
    });
  } catch {}
}

function _fatInitCompanyFilter() {
  _fatCompanyFilter = createTagFilter({
    wrapId:     'gdCompanyTagsWrap',
    inputId:    'gdCompanyTagInput',
    dropdownId: 'gdCompanyDropdown',
    getOptions: () => _fatCompanyOptions,
    onChange:   () => applyFatFilters(),
  });
}

const _parseAmount = v => { const n = String(v || '').replace(/[^\d]/g, ''); return n ? parseInt(n, 10) : null; };
let _fatDebounce;
function applyFatFiltersDebounced() { clearTimeout(_fatDebounce); _fatDebounce = setTimeout(applyFatFilters, 300); }

function _fatParams(withPagination = true) {
  const params    = new URLSearchParams();
  const search    = document.getElementById('mainSearch')?.value     || '';
  const dateStart = document.getElementById('filterDateStart')?.value || '';
  const dateEnd   = document.getElementById('filterDateEnd')?.value   || '';
  const currency  = document.getElementById('filterCurrency')?.value  || '';
  const category  = document.getElementById('filterCategory')?.value  || '';
  const minP      = _parseAmount(document.getElementById('filterMinPrice')?.value);
  const maxP      = _parseAmount(document.getElementById('filterMaxPrice')?.value);
  const companies = _fatCompanyFilter?.getSelected() || [];

  if (search)           params.set('search',     search);
  if (dateStart)        params.set('date_start', dateStart);
  if (dateEnd)          params.set('date_end',   dateEnd);
  if (currency)         params.set('currency',   currency);
  if (category)         params.set('category',   category);
  if (minP != null)     params.set('min_price',  minP);
  if (maxP != null)     params.set('max_price',  maxP);
  if (companies.length) params.set('companies',  companies.join(','));
  if (withPagination)   { params.set('page', _fatPage); params.set('limit', _fatLimit); }
  return params;
}

function applyFatFilters() { _fatPage = 1; gdUpdateAdvBadge(); loadFatInvoices(); refreshFatTotals(); }
async function loadFatInvoices() {
  const content = document.getElementById('gdListContent');
  if (content) content.innerHTML = '<div class="gd-state">Yükleniyor…</div>';

  try {
    const res = await fetch(`${GD_API}/invoices?` + _fatParams(true).toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();

    if (Array.isArray(json)) {
      fatCache = json; _fatTotal = json.length; _fatTotalPages = 1;
    } else {
      fatCache       = json.data        || [];
      _fatTotal      = json.total       || 0;
      _fatTotalPages = json.total_pages || 1;
      _fatPage       = json.page        || 1;
    }
  } catch (e) {
    if (content) content.innerHTML = `<div class="gd-state gd-state--error">Yüklenemedi: ${e.message}</div>`;
    return;
  }

  populateFatCategory();
  renderFatList();
  renderFatPagination();
}

async function refreshFatTotals() {
  try {
    const params = _fatParams(false);
    params.set('totals', 'true');
    const res = await fetch(`${GD_API}/invoices?` + params.toString());
    if (!res.ok) return;
    renderFatKpi(await res.json());
  } catch {}
}

function goToFatPage(page) {
  if (page < 1 || page > _fatTotalPages) return;
  _fatPage = page;
  loadFatInvoices();
  document.querySelector('.gd-main')?.scrollTo({ top: 0, behavior: 'smooth' });
}
function changeFatLimit(newLimit) { _fatLimit = parseInt(newLimit) || 10; _fatPage = 1; loadFatInvoices(); }

function populateFatCategory() {
  const sel = document.getElementById('filterCategory');
  if (!sel) return;
  const existing = new Set([...sel.options].map(o => o.value).filter(Boolean));
  const cats = new Set();
  fatCache.forEach(inv =>
    (inv.invoice_items || []).forEach(it => {
      if (!it.is_internal && it.item_category) cats.add(it.item_category);
    })
  );
  [...cats].sort((a, b) => a.localeCompare(b, 'tr')).forEach(cat => {
    if (!existing.has(cat)) {
      const opt = document.createElement('option');
      opt.value = cat; opt.textContent = cat;
      sel.appendChild(opt);
    }
  });
}

function renderFatList() {
  const content = document.getElementById('gdListContent');
  if (!content) return;
  if (!fatCache.length) { content.innerHTML = '<div class="gd-state">Sonuç bulunamadı.</div>'; return; }

  const fmtMoney = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s || '').replace(/</g, '&lt;');

  const rows = fatCache.map(inv => {
    const no    = esc(inv.invoice_no || '—');
    const firm  = esc(inv.companies?.name || '—');
    const date  = (inv.invoice_date || '').slice(0, 10);
    const isUSD = (inv.base_currency || '').toUpperCase() === 'USD';
    const cur   = isUSD ? 'USD' : 'TRY';

    // gider lines = items where is_internal === false
    const giderItems = (inv.invoice_items || []).filter(it => !it.is_internal);
    const giderTotal = giderItems.reduce((s, it) => s + (parseFloat(it.total_price_cur) || 0), 0);

    const cats = [...new Set(giderItems.map(it => it.item_category).filter(Boolean))];
    const catBadges = cats.length
      ? `<div class="gd-tbl-cats">${cats.map((c, i) =>
          `<span class="gd-cat-badge${i % 2 === 1 ? ' gd-cat-badge--alt' : ''}">${esc(c)}</span>`).join('')}</div>`
      : '<span class="gd-tbl-empty-cell">—</span>';

    const href = `/faturalar/pages/fatura-detay.html?id=${inv.id}&from=giderler`;

    return `
      <tr onclick="window.location.href='${href}'">
        <td><span class="gd-tbl-no">${no}</span></td>
        <td><span class="gd-tbl-firm">${firm}</span></td>
        <td class="gd-tbl-date">${date}</td>
        <td class="gd-tbl-amount">${fmtMoney(giderTotal)}<span class="gd-tbl-cur">${cur}</span></td>
        <td>${catBadges}</td>
      </tr>`;
  }).join('');

  content.innerHTML = `
    <div class="gd-tbl-wrap">
      <table class="gd-tbl">
        <thead><tr>
          <th>Fatura No</th><th>Firma</th><th>Tarih</th>
          <th class="gd-th-right">Toplam</th><th>Kategoriler</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderFatKpi(totals) {
  const bar = document.getElementById('gdKpiBar');
  if (!bar || !totals) return;
  const fmtMoney = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const tryTotal = totals.total_tl  || 0;
  const usdTotal = totals.total_usd || 0;
  const count    = totals.count     || 0;

  const usdCard = usdTotal > 0
    ? `<div class="gd-kpi gd-kpi--usd">
         <div class="gd-kpi-label"><i class="ti ti-currency-dollar"></i>Harcama (USD)</div>
         <div class="gd-kpi-value gd-kpi-value--usd"><span class="gd-kpi-cur">$</span>${fmtMoney(usdTotal)}</div>
       </div>`
    : '';

  bar.innerHTML = `
    <div class="gd-kpi gd-kpi--inv">
      <div class="gd-kpi-label"><i class="ti ti-file-invoice"></i>Toplam Fatura</div>
      <div class="gd-kpi-value">${count.toLocaleString('tr-TR')}</div>
    </div>
    <div class="gd-kpi gd-kpi--tl">
      <div class="gd-kpi-label"><i class="ti ti-cash"></i>Harcama (TL)</div>
      <div class="gd-kpi-value gd-kpi-value--spend"><span class="gd-kpi-cur">₺</span>${fmtMoney(tryTotal)}</div>
    </div>
    ${usdCard}`;
}

function renderFatPagination() {
  document.getElementById('gdListPagination')?.remove();
  if (_fatTotal === 0) return;

  const container = document.querySelector('.gd-list-card');
  if (!container) return;

  const wrap = document.createElement('div');
  wrap.id = 'gdListPagination';
  wrap.className = 'gd-list-pagination';

  const from = ((_fatPage - 1) * _fatLimit) + 1;
  const to   = Math.min(_fatPage * _fatLimit, _fatTotal);
  const info = document.createElement('span');
  info.className   = 'gd-lpag-info';
  info.textContent = `${from}–${to} / ${_fatTotal} fatura`;

  const pages = document.createElement('div');
  pages.className = 'gd-lpag-pages';

  const prev = document.createElement('button');
  prev.className = 'gd-lpag-btn';
  prev.innerHTML = '<i class="ti ti-chevron-left"></i>';
  prev.disabled  = _fatPage <= 1;
  prev.onclick   = () => goToFatPage(_fatPage - 1);
  pages.appendChild(prev);

  for (let p = 1; p <= _fatTotalPages; p++) {
    if (_fatTotalPages > 7 && p > 2 && p < _fatTotalPages - 1 && Math.abs(p - _fatPage) > 1) {
      if (p === 3 || p === _fatTotalPages - 2) {
        const dots = document.createElement('span');
        dots.className = 'gd-lpag-dots';
        dots.textContent = '…';
        pages.appendChild(dots);
      }
      continue;
    }
    const btn = document.createElement('button');
    btn.className   = 'gd-lpag-btn' + (p === _fatPage ? ' gd-lpag-btn--active' : '');
    btn.textContent = p;
    btn.onclick     = () => goToFatPage(p);
    pages.appendChild(btn);
  }

  const next = document.createElement('button');
  next.className = 'gd-lpag-btn';
  next.innerHTML = '<i class="ti ti-chevron-right"></i>';
  next.disabled  = _fatPage >= _fatTotalPages;
  next.onclick   = () => goToFatPage(_fatPage + 1);
  pages.appendChild(next);

  const limitWrap = document.createElement('div');
  limitWrap.className = 'gd-lpag-limit';
  const limitLabel = document.createElement('span');
  limitLabel.className   = 'gd-lpag-limit-label';
  limitLabel.textContent = 'Sayfa başına:';
  const limitSel = document.createElement('select');
  limitSel.className = 'gd-lpag-limit-select';
  [10, 25, 50, 100].forEach(n => {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n; opt.selected = n === _fatLimit;
    limitSel.appendChild(opt);
  });
  limitSel.onchange = () => changeFatLimit(limitSel.value);
  limitWrap.appendChild(limitLabel);
  limitWrap.appendChild(limitSel);

  wrap.appendChild(info);
  wrap.appendChild(pages);
  wrap.appendChild(limitWrap);
  container.appendChild(wrap);
}

function clearFatFilters() {
  _fatCompanyFilter?.clear();
  ['mainSearch','filterDateStart','filterDateEnd','filterCurrency','filterCategory','filterMinPrice','filterMaxPrice']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  if (_gdDateCtx) { _gdDateCtx.selStart = null; _gdDateCtx.selEnd = null; }
  const dd = document.getElementById('dateDisplay');  if (dd) dd.textContent = 'Tüm zamanlar';
  const pd = document.getElementById('priceDisplay'); if (pd) pd.textContent = 'Tüm tutarlar';
  document.getElementById('gdDatePill')?.classList.remove('gd-pill--set');
  document.getElementById('gdPricePill')?.classList.remove('gd-pill--set');
  document.querySelectorAll('.gd-preset--active').forEach(b => b.classList.remove('gd-preset--active'));
  applyFatFilters();
}

let _gdDateCtx = null, _gdPopBound = false;

function _gdBindPopClose() {
  if (_gdPopBound) return;
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.gd-pop--open').forEach(pop => {
      const wrap = pop.closest('.gd-pill-wrap');
      if (wrap && !wrap.contains(e.target)) {
        pop.classList.remove('gd-pop--open');
        wrap.querySelector('.gd-pill')?.classList.remove('gd-pill--active');
      }
    });
  });
  _gdPopBound = true;
}

function gdToggleFilterPop(ev, popId, pillEl) {
  ev?.stopPropagation();
  const pop = document.getElementById(popId);
  if (!pop) return;
  const isOpen = pop.classList.contains('gd-pop--open');
  document.querySelectorAll('.gd-pop--open').forEach(p => {
    p.classList.remove('gd-pop--open');
    p.closest('.gd-pill-wrap')?.querySelector('.gd-pill')?.classList.remove('gd-pill--active');
  });
  if (!isOpen) {
    pop.classList.add('gd-pop--open');
    pillEl?.classList.add('gd-pill--active');
    if (popId === 'gdDatePop') { _gdEnsureDateCtx(); buildCals(_gdDateCtx); }
  }
}

function _gdEnsureDateCtx() {
  if (_gdDateCtx) return;
  const now = new Date();
  const m1 = { year: now.getFullYear(), month: now.getMonth() };
  const m2 = m1.month === 11 ? { year: m1.year + 1, month: 0 } : { year: m1.year, month: m1.month + 1 };
  _gdDateCtx = { selStart: null, selEnd: null, viewMonth: m1, viewMonth2: m2,
    cal1Id: 'gdCal1', cal2Id: 'gdCal2', pickHandler: 'gdPickDate', calChangeHandler: 'gdCalChange',
    firstYear: 2020, onRangeComplete: gdOnDateRange };
}
function gdPickDate(y, m, d)         { pickCalDay(_gdDateCtx, y, m, d); }
function gdCalChange(idx, type, val) { onCalChange(_gdDateCtx, idx, type, val); }

const _fmtISO  = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
const _fmtDisp = dt => `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;

function gdOnDateRange(start, end) {
  document.getElementById('filterDateStart').value = _fmtISO(start);
  document.getElementById('filterDateEnd').value   = _fmtISO(end);
  document.getElementById('dateDisplay').textContent = `${_fmtDisp(start)} – ${_fmtDisp(end)}`;
  document.getElementById('gdDatePill')?.classList.add('gd-pill--set');
  applyFatFilters();
}

function gdSetDatePreset(btn, kind) {
  _gdEnsureDateCtx();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let start = new Date(today); const end = new Date(today);
  if (kind === 'week')       { const dow = (today.getDay() + 6) % 7; start.setDate(today.getDate() - dow); }
  else if (kind === 'month') { start = new Date(today.getFullYear(), today.getMonth(), 1); }
  else if (kind === 'q')     { start = new Date(today); start.setMonth(start.getMonth() - 3); }
  else if (kind === 'year')  { start = new Date(today.getFullYear(), 0, 1); }
  _gdDateCtx.selStart = start; _gdDateCtx.selEnd = end;
  _gdDateCtx.viewMonth  = { year: start.getFullYear(), month: start.getMonth() };
  _gdDateCtx.viewMonth2 = start.getMonth() === 11 ? { year: start.getFullYear()+1, month: 0 } : { year: start.getFullYear(), month: start.getMonth()+1 };
  buildCals(_gdDateCtx);
  btn.parentElement.querySelectorAll('.gd-preset').forEach(b => b.classList.remove('gd-preset--active'));
  btn.classList.add('gd-preset--active');
  gdOnDateRange(start, end);
}

function gdSetPriceBucket(btn, min, max) {
  document.getElementById('filterMinPrice').value = min != null ? min : '';
  document.getElementById('filterMaxPrice').value = max != null ? max : '';
  btn.parentElement.querySelectorAll('.gd-preset').forEach(b => b.classList.remove('gd-preset--active'));
  btn.classList.add('gd-preset--active');
  gdUpdatePriceDisplay();
  applyFatFilters();
}
function gdOnPriceInput() { gdUpdatePriceDisplay(); applyFatFiltersDebounced(); }
function gdUpdatePriceDisplay() {
  const min = _parseAmount(document.getElementById('filterMinPrice')?.value);
  const max = _parseAmount(document.getElementById('filterMaxPrice')?.value);
  const disp = document.getElementById('priceDisplay'); const pill = document.getElementById('gdPricePill');
  const fmt = n => n.toLocaleString('tr-TR');
  if (min == null && max == null)      { disp.textContent = 'Tüm tutarlar'; pill?.classList.remove('gd-pill--set'); return; }
  else if (min != null && max != null) disp.textContent = `${fmt(min)} – ${fmt(max)} ₺`;
  else if (min != null)                disp.textContent = `${fmt(min)} ₺+`;
  else                                 disp.textContent = `≤ ${fmt(max)} ₺`;
  pill?.classList.add('gd-pill--set');
}

function gdToggleAdvanced() {
  const adv = document.getElementById('gdAdvanced');
  adv.classList.toggle('gd-adv--open');
}
function gdUpdateAdvBadge() {
  const n = (document.getElementById('filterCurrency')?.value ? 1 : 0) + (document.getElementById('filterCategory')?.value ? 1 : 0);
  const badge = document.getElementById('gdAdvBadge');
  if (badge) { badge.textContent = n; badge.style.display = n ? 'inline-flex' : 'none'; }
}