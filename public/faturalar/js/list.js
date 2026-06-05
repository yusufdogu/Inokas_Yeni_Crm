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
    saveFilterState();
    applyFiltersAndFetch();
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

    saveFilterState();
    applyFiltersAndFetch();
}

// ─── Session cache ────────────────────────────────────────────────────────────


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

async function applyFiltersAndFetch() {
  window._fatActiveFilters = {
    dateStart:  document.getElementById('filterDateStart')?.value  || '',
    dateEnd:    document.getElementById('filterDateEnd')?.value    || '',
    currency:   document.getElementById('filterCurrency')?.value   || '',
    companies:  _fatCompanyFilter?.getSelected()  || [],
    brands:     _fatBrandFilter?.getSelected()    || [],
    categories: _fatCategoryFilter?.getSelected() || [],
    products:   _fatProductFilter?.getSelected()  || [],
  };
  saveFilterState();
  _currentPage = 1;

  // Run both in parallel, don't block one on the other
  await Promise.all([
    refreshKpiSummary(),
    initInvoiceView(false),
  ]);
}


function renderPagination() {
  const wrap = document.getElementById('fatPagination');
  if (!wrap) return;

  const panel = document.getElementById('panelList');
  if (!panel || panel.style.display === 'none' || _totalCount === 0) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'flex';

  // Info text
  const from = ((_currentPage - 1) * _pageLimit) + 1;
  const to   = Math.min(_currentPage * _pageLimit, _totalCount);
  document.getElementById('fatPagInfo').textContent = `${from}–${to} / ${_totalCount} fatura`;

  // Page size selector
  const limitSel = document.getElementById('fatPagLimit');
  if (limitSel) limitSel.value = _pageLimit;

  // Page buttons
  const pages = document.getElementById('fatPagPages');
  pages.innerHTML = '';

  const addBtn = (label, page, isActive = false, isDisabled = false) => {
    const btn = document.createElement('button');
    btn.className = 'fat-pag-btn' + (isActive ? ' fat-pag-btn--active' : '');
    btn.innerHTML = label;
    btn.disabled  = isDisabled;
    if (!isDisabled) btn.onclick = () => goToPage(page);
    pages.appendChild(btn);
  };

  const addDots = () => {
    const span = document.createElement('span');
    span.className   = 'fat-pag-dots';
    span.textContent = '…';
    pages.appendChild(span);
  };

  addBtn('<i class="ti ti-chevron-left"></i>', _currentPage - 1, false, _currentPage <= 1);

  getPageRange(_currentPage, _totalPages).forEach(p => {
    if (p === '...') { addDots(); return; }
    addBtn(p, p, p === _currentPage);
  });

  addBtn('<i class="ti ti-chevron-right"></i>', _currentPage + 1, false, _currentPage >= _totalPages);
}
function getPageRange(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
    if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '...', current - 1, current, current + 1, '...', total];
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
    initInvoiceView(false);
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

function setFatListSort(col) {
    fatListSort = {
        col,
        dir: fatListSort.col === col ? (fatListSort.dir === 'asc' ? 'desc' : 'asc') : (col === 'company' ? 'asc' : 'desc')
    };
    _currentPage = 1;
    initInvoiceView(false);
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



// ─── Sekme geçiş ve tema ──────────────────────────────────────────────────────

function switchView(view) {
    if (currentView === view) return;

    openInvoiceTabs = [];
    activeTabKey = 'list';
    _detailXmlCache = {};
    _detailPdfLoaded = {};

    currentView = view;
    updateActionButtonsTheme();

    const _togBtn = document.getElementById('btnToggleShowAll');
    if (_togBtn) _togBtn.innerText = isShowAll() ? 'Tümünü Gizle' : 'Tümünü Göster';

    applyFiltersAndFetch();
}

function updateActionButtonsTheme() {
    document.body.setAttribute('data-view', currentView);
}


function goToPage(page) {
  if (page < 1 || page > _totalPages) return;
  _currentPage = page;
  initInvoiceView(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function changeLimit(newLimit) {
  _pageLimit = parseInt(newLimit) || 10;
  _currentPage = 1;
  initInvoiceView(false);
}



function populateCurrencySelect() {
  const sel = document.getElementById('filterCurrency');
  if (!sel) return;
  const currencies = window._fatFilterOptions?.currencies || [];
  const current = sel.value; // preserve selected value
  sel.innerHTML = '<option value="">Tüm Dövizler</option>';
  currencies.forEach(cur => {
    const opt = document.createElement('option');
    opt.value = cur;
    opt.textContent = cur;
    if (cur === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

