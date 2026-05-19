// ─── FATURALAR — LİSTE GÖRÜNÜMÜ ───────────────────────────────────────────────
// Fatura listesi, tab bar, KPI bar, filtreler, session cache yönetimi

// ─── Tag filter instances ──────────────────────────────────────────────────────
let _fatCompanyFilter;
let _fatProductFilter;
let _fatCategoryFilter;
let _fatBrandFilter;
let _fatModelFilter;

let _fatPriceMin = 0;
let _fatPriceMax = 10000000;
let _fatAdvancedOpen = false;

// ─── Shared tag-filter onChange ───────────────────────────────────────────────
function _onTagFilterChange(advanced = false) {
    setInteracted(true);
    if (isShowAll()) {
        setShowAll(false);
        const btn = document.getElementById('btnToggleShowAll');
        if (btn) btn.innerText = 'Tümünü Göster';
    }
    if (advanced) updateAdvancedBadge();
    saveFilterState();
    applyFiltersAndFetch();
}

function updateKpiTotals({ count, total_tl, total_usd, unpaid_tl }) {
  const fmt = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });

  // Update whichever KPI elements exist on the page
  const el = id => document.getElementById(id);

  if (el('kpiTotalCount'))  el('kpiTotalCount').textContent  = count;
  if (el('kpiTotalTl'))     el('kpiTotalTl').textContent     = '₺' + fmt(total_tl);
  if (el('kpiTotalUsd'))    el('kpiTotalUsd').textContent    = '$' + fmt(total_usd);
  if (el('kpiUnpaidTl'))    el('kpiUnpaidTl').textContent    = '₺' + fmt(unpaid_tl);
}

// ─── Init tag filters (called from main.js after DOMContentLoaded) ────────────
function initFatFilters() {
    _fatCompanyFilter = createTagFilter({
        wrapId:     'companyTagsWrap',
        inputId:    'companyTagInput',
        dropdownId: 'companyDropdown',
        getOptions: () => window._fatFilterOptions?.companies || [],
        onChange:   () => _onTagFilterChange(false),
    });

    _fatProductFilter = createTagFilter({
        wrapId:     'productTagsWrap',
        inputId:    'productTagInput',
        dropdownId: 'productDropdown',
        getOptions: () => window._fatFilterOptions?.products || [],
        onChange:   () => _onTagFilterChange(true),
    });

    _fatCategoryFilter = createTagFilter({
        wrapId:     'categoryTagsWrap',
        inputId:    'categoryTagInput',
        dropdownId: 'categoryDropdown',
        getOptions: () => window._fatFilterOptions?.categories || [],
        onChange:   () => _onTagFilterChange(true),
    });

    _fatBrandFilter = createTagFilter({
        wrapId:     'brandTagsWrap',
        inputId:    'brandTagInput',
        dropdownId: 'brandDropdown',
        getOptions: () => window._fatFilterOptions?.brands || [],
        onChange:   () => _onTagFilterChange(true),
    });

    _fatModelFilter = createTagFilter({
        wrapId:     'modelTagsWrap',
        inputId:    'modelTagInput',
        dropdownId: 'modelDropdown',
        getOptions: () => window._fatFilterOptions?.models || [],
        onChange:   () => _onTagFilterChange(true),
    });
}
// ─── Advanced panel ───────────────────────────────────────────────────────────
function toggleAdvancedFilters() {
    _fatAdvancedOpen = !_fatAdvancedOpen;
    const panel   = document.getElementById('advancedFiltersPanel');
    const btnText = document.getElementById('advancedFiltersBtnText');
    if (panel) panel.style.display = _fatAdvancedOpen ? 'block' : 'none';
    if (btnText) {
        btnText.innerHTML = _fatAdvancedOpen
            ? `<i class="ti ti-chevron-up" style="font-size:12px;"></i> Gelişmiş Filtreler`
            : `<i class="ti ti-chevron-down" style="font-size:12px;"></i> Gelişmiş Filtreler`;
    }
}

function updateAdvancedBadge() {
    const badge = document.getElementById('advancedFiltersBadge');
    if (!badge) return;
    const sliderMax = Number(document.getElementById('priceMax')?.max || 10000000);
    const hasActive =
        (_fatProductFilter?.getSelected().length  || 0) > 0 ||
        (_fatCategoryFilter?.getSelected().length || 0) > 0 ||
        (_fatBrandFilter?.getSelected().length    || 0) > 0 ||
        (_fatModelFilter?.getSelected().length    || 0) > 0 ||
        _fatPriceMin > 0 ||
        _fatPriceMax < sliderMax;
    badge.style.display = hasActive ? 'inline-block' : 'none';
}

function updatePriceRange() {
    _fatPriceMin = Number(document.getElementById('priceMin')?.value || 0);
    _fatPriceMax = Number(document.getElementById('priceMax')?.value || 10000000);
    if (_fatPriceMin > _fatPriceMax) [_fatPriceMin, _fatPriceMax] = [_fatPriceMax, _fatPriceMin];
    const label = document.getElementById('priceRangeLabel');
    if (label) {
        const sliderMax = Number(document.getElementById('priceMax')?.max || 10000000);
        const maxLabel  = _fatPriceMax >= sliderMax
            ? '∞'
            : `₺${_fatPriceMax.toLocaleString('tr-TR')}`;
        label.textContent = `₺${_fatPriceMin.toLocaleString('tr-TR')} — ${maxLabel}`;
    }
    updateAdvancedBadge();
    setInteracted(true);
    applyFiltersAndFetch();
}

function clearAllFilters() {
    _fatCompanyFilter?.clear();
    _fatProductFilter?.clear();
    _fatCategoryFilter?.clear();
    _fatBrandFilter?.clear();
    _fatModelFilter?.clear();

    const ids = ['filterDateStart','filterDateEnd','filterStatus','filterCurrency','mainSearch'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

    const minEl = document.getElementById('priceMin');
    const maxEl = document.getElementById('priceMax');
    if (minEl) { _fatPriceMin = 0; minEl.value = 0; }
    if (maxEl) { _fatPriceMax = Number(maxEl.max || 10000000); maxEl.value = maxEl.max; }

    const label = document.getElementById('priceRangeLabel');
    if (label) label.textContent = '0 — ∞';

    updateAdvancedBadge();
    saveFilterState();
    applyFiltersAndFetch();
}

// ─── Session cache ────────────────────────────────────────────────────────────

function saveFilterState() {
    try {
        const state = {
            dateStart:        document.getElementById('filterDateStart')?.value  || '',
            dateEnd:          document.getElementById('filterDateEnd')?.value    || '',
            status:           document.getElementById('filterStatus')?.value     || '',
            currency:         document.getElementById('filterCurrency')?.value   || '',
            search:           document.getElementById('mainSearch')?.value       || '',
            companies:        _fatCompanyFilter?.getSelected()  || [],
            products:         _fatProductFilter?.getSelected()  || [],
            categories:       _fatCategoryFilter?.getSelected() || [],
            brands:           _fatBrandFilter?.getSelected()    || [],
            models:           _fatModelFilter?.getSelected()    || [],
            priceMin:         _fatPriceMin,
            priceMax:         _fatPriceMax,
            showAllGelen:     showAllState.gelen,
            showAllGiden:     showAllState.giden,
            interactedGelen:  interactedState.gelen,
            interactedGiden:  interactedState.giden,
            currentView,
        };
        sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify(state));
    } catch (e) {}
}

function restoreFilterState() {
    try {
        const raw = sessionStorage.getItem(FILTER_STATE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);

        if (s.dateStart) { const el = document.getElementById('filterDateStart'); if (el) el.value = s.dateStart; }
        if (s.dateEnd)   { const el = document.getElementById('filterDateEnd');   if (el) el.value = s.dateEnd; }
        if (s.status)    { const el = document.getElementById('filterStatus');    if (el) el.value = s.status; }
        if (s.currency)  { const el = document.getElementById('filterCurrency');  if (el) el.value = s.currency; }
        if (s.search)    { const el = document.getElementById('mainSearch');      if (el) el.value = s.search; }

        showAllState.gelen    = !!s.showAllGelen;
        showAllState.giden    = !!s.showAllGiden;
        interactedState.gelen = !!s.interactedGelen;
        interactedState.giden = !!s.interactedGiden;

        const btn = document.getElementById('btnToggleShowAll');
        if (btn) btn.innerText = isShowAll() ? 'Tümünü Gizle' : 'Tümünü Göster';
    } catch (e) {}
}

function readInvoiceFinancialsFromForm() {
    const fCur = document.getElementById('f_currency')?.value?.trim() || 'TL';
    const baseIso = fCur === 'TL' ? 'TRY' : fCur;
    const rateRaw = parseFloat(document.getElementById('f_kur')?.value);
    const calculationRate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 1;

    const netCur     = parseFloat(document.getElementById('f_net')?.value)   || 0;
    const taxCur     = parseFloat(document.getElementById('f_tax')?.value)   || 0;
    const payableCur = parseFloat(document.getElementById('f_total')?.value) || 0;

    return {
        currency:                fCur,
        base_currency:           baseIso,
        target_currency:         'TRY',
        calculation_rate:        calculationRate,
        total_tax_exclusive_cur: netCur,
        total_tax_inclusive_cur: netCur + taxCur,
        payable_amount_cur:      payableCur,
        total_tax_exclusive_tl:  netCur     * calculationRate,
        tax_amount_tl:           taxCur     * calculationRate,
        payable_amount_tl:       payableCur * calculationRate
    };
}

function readInvoicesFromSession() {
    try {
        const raw = sessionStorage.getItem(INVOICE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const ts   = Number(parsed?.timestamp) || 0;
        const data = parsed?.data;
        if (!Array.isArray(data) || ts <= 0) return null;
        if ((Date.now() - ts) > INVOICE_CACHE_TTL_MS) {
            sessionStorage.removeItem(INVOICE_CACHE_KEY);
            return null;
        }
        return data;
    } catch (e) {
        console.warn('Session cache okunamadı:', e);
        return null;
    }
}

function writeInvoicesToSession(invoices) {
    try {
        const payload = { timestamp: Date.now(), data: Array.isArray(invoices) ? invoices : [] };
        sessionStorage.setItem(INVOICE_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('Session cache yazılamadı:', e);
    }
}

// ─── Ana filtre + render döngüsü ──────────────────────────────────────────────
function applyFiltersAndFetch() {
  _currentPage = 1;

  // Pass tag filters to api.js via globals so refreshData can read them
  window._fatActiveFilters = {
    companies:  _fatCompanyFilter?.getSelected()  || [],
    products:   _fatProductFilter?.getSelected()  || [],
    categories: _fatCategoryFilter?.getSelected() || [],
    brands:     _fatBrandFilter?.getSelected()    || [],
    models:     _fatModelFilter?.getSelected()    || [],
    dateStart:  document.getElementById('filterDateStart')?.value || '',
    dateEnd:    document.getElementById('filterDateEnd')?.value   || '',
    status:     document.getElementById('filterStatus')?.value    || '',
    currency:   document.getElementById('filterCurrency')?.value  || '',
    search:     document.getElementById('mainSearch')?.value      || '',
    priceMin:   _fatPriceMin,
    priceMax:   _fatPriceMax,
  };

  refreshData(false);
  refreshTotals();
}

function renderCurrentView() {
    updateCompanyColumnHeader();
    if (!allInvoicesCache) return;

    const filterMatchedInvoices = allInvoicesCache;


    if (!hasInteracted()) {
        renderInvoiceTable([]);
        return;
    }


    renderInvoiceTable(filterMatchedInvoices);
    saveFilterState();
}

function renderPagination() {
  // Remove existing pagination if any
  document.getElementById('fatPagination')?.remove();

  if (_totalCount === 0) return;

  const container = document.querySelector('.fat-area');
  if (!container) return;

  const wrap = document.createElement('div');
  wrap.id = 'fatPagination';
  wrap.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: #0f172a;
    border-top: 1px solid #1e293b;
    flex-shrink: 0;
    gap: 12px;
    flex-wrap: wrap;
  `;

  // Left: count info
  const from  = ((_currentPage - 1) * _pageLimit) + 1;
  const to    = Math.min(_currentPage * _pageLimit, _totalCount);
  const info  = document.createElement('span');
  info.style.cssText = 'font-size:12px; color:#64748b;';
  info.textContent   = `${from}–${to} / ${_totalCount} fatura`;

  // Center: page buttons
  const pages = document.createElement('div');
  pages.style.cssText = 'display:flex; align-items:center; gap:4px;';

  // Prev button
  const prev = document.createElement('button');
  prev.innerHTML  = '<i class="ti ti-chevron-left"></i>';
  prev.disabled   = _currentPage <= 1;
  prev.style.cssText = btnStyle(_currentPage <= 1);
  prev.onclick    = () => goToPage(_currentPage - 1);
  pages.appendChild(prev);

  // Page number buttons — show max 5 around current
  const pageNums = getPageRange(_currentPage, _totalPages);
  pageNums.forEach(p => {
    if (p === '...') {
      const dots = document.createElement('span');
      dots.textContent   = '…';
      dots.style.cssText = 'font-size:12px; color:#475569; padding:0 4px;';
      pages.appendChild(dots);
      return;
    }
    const btn = document.createElement('button');
    btn.textContent    = p;
    btn.style.cssText  = btnStyle(false, p === _currentPage);
    btn.onclick        = () => goToPage(p);
    pages.appendChild(btn);
  });

  // Next button
  const next = document.createElement('button');
  next.innerHTML  = '<i class="ti ti-chevron-right"></i>';
  next.disabled   = _currentPage >= _totalPages;
  next.style.cssText = btnStyle(_currentPage >= _totalPages);
  next.onclick    = () => goToPage(_currentPage + 1);
  pages.appendChild(next);

  // Right: page size selector
  const limitWrap = document.createElement('div');
  limitWrap.style.cssText = 'display:flex; align-items:center; gap:6px;';

  const limitLabel = document.createElement('span');
  limitLabel.style.cssText = 'font-size:12px; color:#64748b;';
  limitLabel.textContent   = 'Sayfa başına:';

  const limitSel = document.createElement('select');
  limitSel.style.cssText = `
    height: 28px; padding: 0 8px;
    border: 1px solid #334155; border-radius: 6px;
    background: #1e293b; color: #f1f5f9;
    font-size: 12px; font-family: inherit; cursor: pointer;
    outline: none;
  `;
  [10, 25, 50, 100].forEach(n => {
    const opt      = document.createElement('option');
    opt.value      = n;
    opt.textContent = n;
    opt.selected   = n === _pageLimit;
    limitSel.appendChild(opt);
  });
  limitSel.onchange = () => changeLimit(limitSel.value);

  limitWrap.appendChild(limitLabel);
  limitWrap.appendChild(limitSel);

  wrap.appendChild(info);
  wrap.appendChild(pages);
  wrap.appendChild(limitWrap);
  container.appendChild(wrap);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function btnStyle(disabled = false, active = false) {
  const base = `
    height: 28px; min-width: 28px; padding: 0 8px;
    border-radius: 6px; font-size: 12px; font-family: inherit;
    cursor: pointer; border: 1px solid #334155;
    display: inline-flex; align-items: center; justify-content: center;
    transition: background 0.15s, color 0.15s;
  `;
  if (disabled) return base + 'background:#1e293b; color:#334155; cursor:not-allowed;';
  if (active)   return base + 'background:#2563eb; color:#fff; border-color:#2563eb; font-weight:700;';
  return base + 'background:#1e293b; color:#94a3b8;';
}

function getPageRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total-4, total-3, total-2, total-1, total];
  return [1, '...', current-1, current, current+1, '...', total];
}

function updateCompanyColumnHeader() {
    // no-op — kart listesi kullanılıyor
}

function toggleShowAll() {
    setShowAll(!isShowAll());
    setInteracted(true);

    const btn = document.getElementById('btnToggleShowAll');

    if (isShowAll()) {
        clearAllFilters();
        if (btn) btn.innerText = 'Tümünü Gizle';
    } else {
        setInteracted(false);
        if (btn) btn.innerText = 'Tümünü Göster';
    }

    saveFilterState();
    applyFiltersAndFetch();
}

// ─── KPI bar ──────────────────────────────────────────────────────────────────

function renderKpiBar(invoices, totals = null) {
  const el = document.getElementById('fatKpiBar');
  if (!el) return;

  const titleEl = document.getElementById('fatPageTitle');
  if (titleEl) titleEl.textContent = currentView === 'giden' ? 'Giden Faturalar' : 'Gelen Faturalar';

  const fmtN    = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isGelen = currentView === 'gelen';
  const usdLabel = isGelen ? 'HARCAMA (USD)' : 'CİRO (USD)';
  const tryLabel = isGelen ? 'HARCAMA (TL)'  : 'CİRO (TL)';

  // Use server totals if available, otherwise calculate from current page
  let usdTotal = 0, tryTotal = 0, count = invoices?.length || 0;

  if (totals) {
    usdTotal = totals.total_usd || 0;
    tryTotal = totals.total_tl  || 0;
    count    = totals.count     || 0;
  } else {
    (invoices || []).forEach(inv => {
      const src   = invNonInternalPayableAmountSrc(inv);
      const rate  = invCalculationRate(inv);
      const isUSD = invBaseCurrencyIso(inv) !== 'TRY';
      if (isUSD) { usdTotal += src; tryTotal += src * rate; }
      else       { tryTotal += src; }
    });
  }

  el.innerHTML = `
    <div class="fat-kpi">
      <p class="fat-kpi-label">${usdLabel}</p>
      <p class="fat-kpi-value" style="color:#2563eb;">$${fmtN(usdTotal)}</p>
    </div>
    <div class="fat-kpi">
      <p class="fat-kpi-label">${tryLabel}</p>
      <p class="fat-kpi-value">₺${fmtN(tryTotal)}</p>
    </div>
    <div class="fat-kpi">
      <p class="fat-kpi-label">TOPLAM FATURA</p>
      <p class="fat-kpi-value">${count}</p>
    </div>
  `;
}

let _lastKpiTotals = null;

// Called by api.js after refreshTotals() returns
function updateKpiTotals(totals) {
  _lastKpiTotals = totals;
  renderKpiBar(allInvoicesCache, totals);
}
// ─── Tab bar ──────────────────────────────────────────────────────────────────

function renderTabBar() {
    const bar = document.getElementById('fatTabBar');
    if (!bar) return;

    let html = `<button class="fat-tab${activeTabKey === 'list' ? ' fat-tab--active' : ''}" onclick="switchFatTab('list')">FATURALAR</button>`;
    openInvoiceTabs.forEach(t => {
        const isActive = activeTabKey === t.id;
        html += `<button class="fat-tab${isActive ? ' fat-tab--active' : ''}" onclick="switchFatTab('${t.id}')">
            ${t.invoiceNo}
            <span class="fat-tab-close" onclick="event.stopPropagation(); closeInvoiceTab('${t.id}')">✕</span>
        </button>`;
    });
    bar.innerHTML = html;
}

function switchFatTab(view) {
  currentView  = view;
  _currentPage = 1;    // ← reset to page 1 when switching tabs
  window._fatActiveFilters = {};  // ← clear filters on tab switch
  refreshData(false);
}

function openInvoiceTab(id) {
    const sid = String(id);
    let inv = (allInvoicesCache || []).find(i => String(i.id) === sid);
    let sourceList = _fatDetailList;
    if (!inv && typeof bekleyenCache !== 'undefined') {
        inv = bekleyenCache.find(i => String(i.id) === sid);
        sourceList = bekleyenCache;
    }
    if (!inv) return;
    if (!openInvoiceTabs.find(t => t.id === id)) {
        openInvoiceTabs.push({ id, invoiceNo: inv.invoice_no || id });
    }
    if (!activeDetailTab[id]) activeDetailTab[id] = 'bilgiler';
    switchFatTab(id);
}

function closeInvoiceTab(id) {
    openInvoiceTabs = openInvoiceTabs.filter(t => t.id !== id);
    delete activeDetailTab[id];
    delete _detailPdfLoaded[id];
    delete _detailXmlCache[id];
    if (activeTabKey === id) activeTabKey = 'list';
    renderTabBar();
    renderFatContent();
}

// ─── İçerik render ────────────────────────────────────────────────────────────

function renderFatContent() {
    const content = document.getElementById('fatContent');
    if (!content) return;
    if (activeTabKey === 'list') renderListView(_lastListInvoices);
    else                         renderDetailView(activeTabKey);
}

function renderInvoiceTable(invoices) {
    _lastListInvoices = invoices || [];
    renderKpiBar(invoices, _lastKpiTotals);
    if (activeTabKey !== 'list') return;
    renderListView(invoices);
}

function setFatListSort(col) {
    fatListSort = {
        col,
        dir: fatListSort.col === col ? (fatListSort.dir === 'asc' ? 'desc' : 'asc') : (col === 'company' ? 'asc' : 'desc')
    };
    renderListView(_lastListInvoices);
}

function renderListView(invoices) {
    const content = document.getElementById('fatContent');
    if (!content) return;

    if (!invoices || invoices.length === 0) {
        content.innerHTML = `<div style="flex:1; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:14px; font-weight:500;">
            Fatura bulunamadı. Filtreleri değiştirin.
        </div>`;
        return;
    }

    const sorted = [...invoices].sort((a, b) => {
        let fa, fb;
        if (fatListSort.col === 'company') {
            fa = (a.companies?.name || '').toLocaleLowerCase('tr-TR');
            fb = (b.companies?.name || '').toLocaleLowerCase('tr-TR');
            const cmp = fa.localeCompare(fb, 'tr');
            return fatListSort.dir === 'asc' ? cmp : -cmp;
        } else if (fatListSort.col === 'total') {
            fa = invPayableAmountSrc(a) * (invBaseCurrencyIso(a) !== 'TRY' ? invCalculationRate(a) : 1);
            fb = invPayableAmountSrc(b) * (invBaseCurrencyIso(b) !== 'TRY' ? invCalculationRate(b) : 1);
        } else {
            fa = a.invoice_date || '';
            fb = b.invoice_date || '';
        }
        return fatListSort.dir === 'asc' ? (fa < fb ? -1 : fa > fb ? 1 : 0) : (fa > fb ? -1 : fa < fb ? 1 : 0);
    });

    const thHtml = (col, label, extraStyle = '') => {
        const isActive = fatListSort.col === col;
        const arrow    = isActive ? `<span class="fat-th-arrow">${fatListSort.dir === 'asc' ? '↑' : '↓'}</span>` : '';
        return `<th class="${isActive ? 'fat-th--active' : ''}" style="${extraStyle}" onclick="setFatListSort('${col}')">${label}${arrow}</th>`;
    };

    _fatDetailList = sorted;

    const rows = sorted.map(inv => {
        const total = formatMoneyDisplay(inv, invNonInternalPayableAmountSrc(inv));
        const comp  = (inv.companies?.name || 'Bilinmeyen').replace(/</g, '&lt;');
        const no    = (inv.invoice_no || '-').replace(/</g, '&lt;');
        return `<tr onclick="openFatDetailPage('${inv.id}')">
            <td><span class="fat-tbl-no">${no}</span></td>
            <td>${comp}</td>
            <td class="fat-tbl-date">${inv.invoice_date || '-'}</td>
            <td class="fat-tbl-amount">${total}</td>
        </tr>`;
    }).join('');

    content.innerHTML = `<div class="fat-list-view">
        <div class="fat-tbl-wrap">
            <table class="fat-tbl">
                <thead><tr>
                    <th>FATURA NO</th>
                    ${thHtml('company', 'FİRMA')}
                    ${thHtml('date', 'TARİH')}
                    ${thHtml('total', 'TOPLAM', 'text-align:right;')}
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

// ─── Tam ekran detay sayfası ──────────────────────────────────────────────────

function openFatDetailPage(id) {
    window.location.href = `/faturalar/pages/fatura-detay.html?id=${encodeURIComponent(id)}`;
}



function switchFatDetailPageTab(id, tab) {
    switchFatDetailTab(id, tab);
}

// ─── Sekme geçiş ve tema ──────────────────────────────────────────────────────

function switchView(view) {
    if (currentView === view) return;

    openInvoiceTabs  = [];
    activeTabKey     = 'list';
    _detailXmlCache  = {};
    _detailPdfLoaded = {};

    currentView = view;
    updateCompanyColumnHeader();
    updateActionButtonsTheme();

    const _togBtn = document.getElementById('btnToggleShowAll');
    if (_togBtn) _togBtn.innerText = isShowAll() ? 'Tümünü Gizle' : 'Tümünü Göster';

    applyFiltersAndFetch();
}

function updateActionButtonsTheme() {
    document.body.setAttribute('data-view', currentView);
}