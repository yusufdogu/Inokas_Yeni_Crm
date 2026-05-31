// ─── FATURALAR — LİSTE GÖRÜNÜMÜ ───────────────────────────────────────────────
// Fatura listesi, tab bar, KPI bar, filtreler, session cache yönetimi

// ─── Tag filter instances ──────────────────────────────────────────────────────
let _fatCompanyFilter;
let _fatProductFilter;
let _fatCategoryFilter;
let _fatBrandFilter;

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
    refreshKpiSummary()
}


// ─── Init tag filters (called from main.js after DOMContentLoaded) ────────────
function initFatFilters() {
  _fatCompanyFilter = createTagFilter({
    wrapId: 'companyTagsWrap', inputId: 'companyTagInput', dropdownId: 'companyDropdown',
    getOptions: () => _getDependentOptions('company'),
    onChange: () => _onTagFilterChange(false),
  });

  _fatBrandFilter = createTagFilter({
    wrapId: 'brandTagsWrap', inputId: 'brandTagInput', dropdownId: 'brandDropdown',
    getOptions: () => _getDependentOptions('brand'),
    onChange: () => _onTagFilterChange(true),
  });

  _fatCategoryFilter = createTagFilter({
    wrapId: 'categoryTagsWrap', inputId: 'categoryTagInput', dropdownId: 'categoryDropdown',
    getOptions: () => _getDependentOptions('category'),
    onChange: () => _onTagFilterChange(true),
  });

  _fatProductFilter = createTagFilter({
    wrapId: 'productTagsWrap', inputId: 'productTagInput', dropdownId: 'productDropdown',
    getOptions: () => _getDependentOptions('product'),
    onChange: () => _onTagFilterChange(true),
  });
}

function _getDependentOptions(field) {
  const rels = window._fatFilterOptions?.relationships || [];

  const selectedCompanies  = _fatCompanyFilter?.getSelected()  || [];
  const selectedBrands     = _fatBrandFilter?.getSelected()    || [];
  const selectedCategories = _fatCategoryFilter?.getSelected() || [];
  const selectedProducts   = _fatProductFilter?.getSelected()  || [];

  // Build sibling selections — everything except the field being queried
  const hasConstraints =
    (field !== 'company'  && selectedCompanies.length)  ||
    (field !== 'brand'    && selectedBrands.length)     ||
    (field !== 'category' && selectedCategories.length) ||
    (field !== 'product'  && selectedProducts.length);

  const allKey = { company: 'companies', brand: 'brands', category: 'categories', product: 'products' }[field];
  const all = window._fatFilterOptions?.[allKey] || [];

  if (!hasConstraints) return all;

  const matched = new Set(
    rels
      .filter(r =>
        (field === 'company'  || !selectedCompanies.length  || selectedCompanies.includes(r.company))   &&
        (field === 'brand'    || !selectedBrands.length     || selectedBrands.includes(r.brand))         &&
        (field === 'category' || !selectedCategories.length || selectedCategories.includes(r.category))  &&
        (field === 'product'  || !selectedProducts.length   || selectedProducts.includes(r.product))
      )
      .map(r => r[field])
      .filter(Boolean)
  );

  return all.filter(o => matched.has(o));
}

// ─── Advanced panel ───────────────────────────────────────────────────────────
function toggleAdvancedFilters() {
    _fatAdvancedOpen = !_fatAdvancedOpen;
    const panel = document.getElementById('advancedFiltersPanel');
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
        (_fatProductFilter?.getSelected().length || 0) > 0 ||
        (_fatCategoryFilter?.getSelected().length || 0) > 0 ||
        (_fatBrandFilter?.getSelected().length || 0) > 0 ||
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
        const maxLabel = _fatPriceMax >= sliderMax
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

    const ids = ['filterDateStart', 'filterDateEnd', 'filterStatus', 'filterCurrency', 'mainSearch'];
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
            dateStart: document.getElementById('filterDateStart')?.value || '',
            dateEnd: document.getElementById('filterDateEnd')?.value || '',
            status: document.getElementById('filterStatus')?.value || '',
            currency: document.getElementById('filterCurrency')?.value || '',
            search: document.getElementById('mainSearch')?.value || '',
            companies: _fatCompanyFilter?.getSelected() || [],
            products: _fatProductFilter?.getSelected() || [],
            categories: _fatCategoryFilter?.getSelected() || [],
            brands: _fatBrandFilter?.getSelected() || [],
            priceMin: _fatPriceMin,
            priceMax: _fatPriceMax,
            showAllGelen: showAllState.gelen,
            showAllGiden: showAllState.giden,
            interactedGelen: interactedState.gelen,
            interactedGiden: interactedState.giden,
            currentView,
        };
        sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify(state));
    } catch (e) { }
}

function restoreFilterState() {
    try {
        const raw = sessionStorage.getItem(FILTER_STATE_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);

        if (s.dateStart) { const el = document.getElementById('filterDateStart'); if (el) el.value = s.dateStart; }
        if (s.dateEnd) { const el = document.getElementById('filterDateEnd'); if (el) el.value = s.dateEnd; }
        if (s.status) { const el = document.getElementById('filterStatus'); if (el) el.value = s.status; }
        if (s.currency) { const el = document.getElementById('filterCurrency'); if (el) el.value = s.currency; }
        if (s.search) { const el = document.getElementById('mainSearch'); if (el) el.value = s.search; }

        showAllState.gelen = !!s.showAllGelen;
        showAllState.giden = !!s.showAllGiden;
        interactedState.gelen = !!s.interactedGelen;
        interactedState.giden = !!s.interactedGiden;

        const btn = document.getElementById('btnToggleShowAll');
        if (btn) btn.innerText = isShowAll() ? 'Tümünü Gizle' : 'Tümünü Göster';
    } catch (e) { }
}

function readInvoiceFinancialsFromForm() {
    const fCur = document.getElementById('f_currency')?.value?.trim() || 'TL';
    const baseIso = fCur === 'TL' ? 'TRY' : fCur;
    const rateRaw = parseFloat(document.getElementById('f_kur')?.value);
    const calculationRate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 1;

    const netCur = parseFloat(document.getElementById('f_net')?.value) || 0;
    const taxCur = parseFloat(document.getElementById('f_tax')?.value) || 0;
    const payableCur = parseFloat(document.getElementById('f_total')?.value) || 0;

    return {
        currency: fCur,
        base_currency: baseIso,
        target_currency: 'TRY',
        calculation_rate: calculationRate,
        total_tax_exclusive_cur: netCur,
        total_tax_inclusive_cur: netCur + taxCur,
        payable_amount_cur: payableCur,
        total_tax_exclusive_tl: netCur * calculationRate,
        tax_amount_tl: taxCur * calculationRate,
        payable_amount_tl: payableCur * calculationRate
    };
}

function readInvoicesFromSession() {
    try {
        const raw = sessionStorage.getItem(INVOICE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const ts = Number(parsed?.timestamp) || 0;
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
        companies: _fatCompanyFilter?.getSelected() || [],
        products: _fatProductFilter?.getSelected() || [],
        categories: _fatCategoryFilter?.getSelected() || [],
        brands: _fatBrandFilter?.getSelected() || [],
        dateStart: document.getElementById('filterDateStart')?.value || '',
        dateEnd: document.getElementById('filterDateEnd')?.value || '',
        status: document.getElementById('filterStatus')?.value || '',
        currency: document.getElementById('filterCurrency')?.value || '',
        search: document.getElementById('mainSearch')?.value || '',
        priceMin: _fatPriceMin,
        priceMax: _fatPriceMax,
    };
    saveFilterState();
    refreshData(false);
    refreshKpiSummary();
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
    const panel = document.getElementById('panelList');
    if (!panel || panel.style.display === 'none') return;

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
    const from = ((_currentPage - 1) * _pageLimit) + 1;
    const to = Math.min(_currentPage * _pageLimit, _totalCount);
    const info = document.createElement('span');
    info.style.cssText = 'font-size:12px; color:#64748b;';
    info.textContent = `${from}–${to} / ${_totalCount} fatura`;

    // Center: page buttons
    const pages = document.createElement('div');
    pages.style.cssText = 'display:flex; align-items:center; gap:4px;';

    // Prev button
    const prev = document.createElement('button');
    prev.innerHTML = '<i class="ti ti-chevron-left"></i>';
    prev.disabled = _currentPage <= 1;
    prev.style.cssText = btnStyle(_currentPage <= 1);
    prev.onclick = () => goToPage(_currentPage - 1);
    pages.appendChild(prev);

    // Page number buttons — show max 5 around current
    const pageNums = getPageRange(_currentPage, _totalPages);
    pageNums.forEach(p => {
        if (p === '...') {
            const dots = document.createElement('span');
            dots.textContent = '…';
            dots.style.cssText = 'font-size:12px; color:#475569; padding:0 4px;';
            pages.appendChild(dots);
            return;
        }
        const btn = document.createElement('button');
        btn.textContent = p;
        btn.style.cssText = btnStyle(false, p === _currentPage);
        btn.onclick = () => goToPage(p);
        pages.appendChild(btn);
    });

    // Next button
    const next = document.createElement('button');
    next.innerHTML = '<i class="ti ti-chevron-right"></i>';
    next.disabled = _currentPage >= _totalPages;
    next.style.cssText = btnStyle(_currentPage >= _totalPages);
    next.onclick = () => goToPage(_currentPage + 1);
    pages.appendChild(next);

    // Right: page size selector
    const limitWrap = document.createElement('div');
    limitWrap.style.cssText = 'display:flex; align-items:center; gap:6px;';

    const limitLabel = document.createElement('span');
    limitLabel.style.cssText = 'font-size:12px; color:#64748b;';
    limitLabel.textContent = 'Sayfa başına:';

    const limitSel = document.createElement('select');
    limitSel.style.cssText = `
    height: 28px; padding: 0 8px;
    border: 1px solid #334155; border-radius: 6px;
    background: #1e293b; color: #f1f5f9;
    font-size: 12px; font-family: inherit; cursor: pointer;
    outline: none;
  `;
    [10, 25, 50, 100].forEach(n => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        opt.selected = n === _pageLimit;
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
    if (active) return base + 'background:#2563eb; color:#fff; border-color:#2563eb; font-weight:700;';
    return base + 'background:#1e293b; color:#94a3b8;';
}

function getPageRange(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
    if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '...', current - 1, current, current + 1, '...', total];
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

let _lastKpiTotals  = null;
let _lastTrendData  = null;  // { bucket, data: [{period, try_total, usd_total, try_count, usd_count}] }

function _sparklineSvg(points, color) {
    if (!points || points.length < 2) return '';
    const W = 68, H = 32;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const coords = points.map((v, i) => {
        const x = (i / (points.length - 1)) * W;
        const y = H - ((v - min) / range) * (H - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="flex-shrink:0;">
        <polyline points="${coords}" stroke="${color}" stroke-width="1.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="M${coords.split(' ')[0].split(',')[0]},${coords.split(' ')[0].split(',')[1]} ${coords} V${H} H0Z" fill="${color}" fill-opacity="0.08"/>
    </svg>`;
}

function _trendArrow(pct) {
    if (pct > 0)  return { arrow: '↑', color: '#16a34a', text: `↑ %${Math.abs(pct).toFixed(0)}` };
    if (pct < 0)  return { arrow: '↓', color: '#dc2626', text: `↓ %${Math.abs(pct).toFixed(0)}` };
    return { arrow: '→', color: '#94a3b8', text: '→ %0' };
}

function _periodChangePct(data, key) {
    if (!data || data.length < 2) return 0;
    const last = data[data.length - 1]?.[key] || 0;
    const prev = data[data.length - 2]?.[key] || 0;
    if (!prev) return last > 0 ? 100 : 0;
    return ((last - prev) / prev) * 100;
}

function _kpiCard(label, value, sparkSvg, trendText, trendColor) {
    return `<div class="fat-kpi">
      <p class="fat-kpi-label">${label}</p>
      <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:8px; margin-top:6px;">
        <div>
          <p class="fat-kpi-value">${value}</p>
          <p style="font-size:11px; font-weight:500; color:${trendColor}; margin:4px 0 0;">${trendText}</p>
        </div>
        ${sparkSvg}
      </div>
    </div>`;
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
    currentView = view;
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
    else renderDetailView(activeTabKey);
}

function renderInvoiceTable(invoices) {
    _lastListInvoices = invoices || [];
    if (activeTabKey !== 'list') return;
    renderListView(invoices);
    if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
}

function setFatListSort(col) {
    fatListSort = {
        col,
        dir: fatListSort.col === col ? (fatListSort.dir === 'asc' ? 'desc' : 'asc') : (col === 'company' ? 'asc' : 'desc')
    };
    _currentPage = 1;
    refreshData(false);
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
        const arrow = isActive ? `<span class="fat-th-arrow">${fatListSort.dir === 'asc' ? '↑' : '↓'}</span>` : '';
        return `<th class="${isActive ? 'fat-th--active' : ''}" style="${extraStyle}" onclick="setFatListSort('${col}')">${label}${arrow}</th>`;
    };

    _fatDetailList = sorted;

    const rows = sorted.map(inv => {
        const total = formatMoneyDisplay(inv, invNonInternalPayableAmountSrc(inv));
        const comp = (inv.companies?.name || 'Bilinmeyen').replace(/</g, '&lt;');
        const no = (inv.invoice_no || '-').replace(/</g, '&lt;');
        saveFilterState();
        return `<tr onclick="openFatDetailPage('${inv.id}')">
            <td><span class="fat-tbl-no">${no}</span></td>
            <td>${comp}</td>
            <td class="fat-tbl-date">${inv.invoice_date || '-'}</td>
            <td class="fat-tbl-amount">${total}</td>
        </tr>`;
    }).join('');

    content.innerHTML = `<div class="fat-list-view">
        <div class="fat-tbl-wrap">
            <table class="fat-tbl" style="table-layout:fixed; width:100%;">
                <thead><tr>
                    <th style="width:180px;">FATURA NO</th>
                    ${thHtml('company', 'FİRMA', 'width:45%;')}
                    ${thHtml('date', 'TARİH', 'width:120px;')}
                    ${thHtml('total', 'TOPLAM', 'text-align:right; width:160px;')}
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

// ─── Tam ekran detay sayfası ──────────────────────────────────────────────────

function openFatDetailPage(id) {
    let from = '';
    if (window._FAT_PENDING) {
        from = (currentView === 'giden') ? 'bekleyen-giden' : 'bekleyen-gelen';
    }
    const fromParam = from ? `&from=${from}` : '';
    window.location.href = `/faturalar/pages/fatura-detay.html?id=${encodeURIComponent(id)}${fromParam}`;
}



function switchFatDetailPageTab(id, tab) {
    switchFatDetailTab(id, tab);
}

// ─── Sekme geçiş ve tema ──────────────────────────────────────────────────────

function switchView(view) {
    if (currentView === view) return;

    openInvoiceTabs = [];
    activeTabKey = 'list';
    _detailXmlCache = {};
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