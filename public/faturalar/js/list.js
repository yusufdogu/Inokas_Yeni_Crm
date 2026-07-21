// ─── FATURALAR — LİSTE GÖRÜNÜMÜ ───────────────────────────────────────────────
// Fatura listesi, tab bar, KPI bar, filtreler, session cache yönetimi
const _fatCalCtx = {
    selStart: null,
    selEnd: null,
    viewMonth:  _gbPrevMonth(),
    viewMonth2: { year: new Date().getFullYear(), month: new Date().getMonth() },
    cal1Id: 'filterCal1',
    cal2Id: 'filterCal2',
    pickHandler: 'pickFilterDay',
    calChangeHandler: '_onFilterCalChange',
    firstYear: 2020,
    onRangeComplete: (start, end) => {
        _setFilterDateInputs(start, end);
        document.querySelectorAll('#datePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
        _fatDatePreset = 'custom';
        applyFiltersAndFetch();
    }
};
window._fatCalCtx = _fatCalCtx;
function _gbPrevMonth() {
  const d = new Date();
  return d.getMonth() === 0
    ? { year: d.getFullYear() - 1, month: 11 }
    : { year: d.getFullYear(), month: d.getMonth() - 1 };
}

// Thin wrappers — keep old function names for HTML onclick compatibility
function buildFilterCals()                  { buildCals(_fatCalCtx); }
function _onFilterCalChange(idx, t, v)      { onCalChange(_fatCalCtx, idx, t, v); }
function pickFilterDay(y, m, d)             { pickCalDay(_fatCalCtx, y, m, d); }

function renderListView(invoices) {
    const content = document.getElementById('fatContent');
    if (!content) return;

    if (!invoices || invoices.length === 0) {
        content.innerHTML = `<div style="flex:1; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:14px; font-weight:500;">
            Fatura bulunamadı. Filtreleri değiştirin.
        </div>`;
        return;
    }


    const thHtml = (col, label, extraStyle = '') => {
        // In bekleyen mode → static, non-clickable header
        if (window._FAT_PENDING) {
            return `<th style="${extraStyle}">
                <span class="fat-th-inner">${label}</span>
            </th>`;
        }

        const isActive = fatListSort.col === col;
        const iconCls  = isActive
            ? (fatListSort.dir === 'desc' ? 'ti-arrow-up' : 'ti-arrow-down')
            : 'ti-arrows-sort';
        const iconColor = isActive ? '' : 'opacity:0.35;';
        return `<th class="${isActive ? 'fat-th--active' : ''}" style="${extraStyle}; cursor:pointer;" onclick="setFatListSort('${col}')">
            <span class="fat-th-inner">
                ${label}
                <i class="ti ${iconCls} fat-th-icon" style="${iconColor}"></i>
            </span>
        </th>`;
    };

    _fatDetailList = invoices;

    const rows = invoices.map(inv => {
        const total = formatMoneyDisplay(inv, invNonInternalPayableAmountSrc(inv));
        const comp = (inv.companies?.name || 'Bilinmeyen').replace(/</g, '&lt;');
        const no = (inv.invoice_no || '-').replace(/</g, '&lt;');
        saveFilterState();
        return `<tr onclick="openFatDetailPage('${inv.id}')">
            <td><span class="fat-tbl-no">${no}</span></td>
            <td>${comp}</td>
            <td class="fat-tbl-date">${inv.invoice_date || '-'}</td>
            <td <span class="fat-tbl-amount">${total}</span></td>
        </tr>`;
    }).join('');

    content.innerHTML = `<div class="fat-list-view">
        <div class="fat-tbl-wrap">
            <table class="fat-tbl" style="table-layout:fixed; width:100%;">
                <thead><tr>
                    ${thHtml('invoice_no',      '<i class="ti ti-hash fat-th-col-icon"></i> FATURA NO', 'width:180px;')}
                    ${thHtml('company', '<i class="ti ti-building fat-th-col-icon"></i> FİRMA',  'width:45%;')}
                    ${thHtml('date',    '<i class="ti ti-calendar fat-th-col-icon"></i> TARİH', 'width:120px;')}
                    ${thHtml('total',   '<i class="ti ti-currency-lira fat-th-col-icon"></i> TOPLAM', 'text-align:right; width:160px;')}
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

// ─── Tam ekran detay sayfası ──────────────────────────────────────────────────

function openFatDetailPage(id) {
    const inv = _lastListInvoices.find(i => i.id === id);
    if (inv) {
        const invoiceNo  = inv.invoice_no || id;
        const direction  = currentView; // 'giden' | 'gelen'
        const alreadyOpen = _invoiceTabList.find(t => t.id === id);
        if (!alreadyOpen) {
            _invoiceTabList.push({ id, invoiceNo, direction });
            renderInvoiceTabBar();
        }
    }
    try {
        sessionStorage.setItem('invoice_tabs', JSON.stringify(_invoiceTabList));
    } catch(e) {}

    let from = '';
    if (window._FAT_PENDING) {
        from = (currentView === 'giden') ? 'bekleyen-giden' : 'bekleyen-gelen';
    }
    const fromParam = from ? `&from=${from}` : '';
    window.location.href = `/faturalar/pages/fatura-detay.html?id=${encodeURIComponent(id)}${fromParam}`;
}

function renderInvoiceTabBar() {
    const bar    = document.getElementById('invoiceTabBar');
    const scroll = document.getElementById('invoiceTabsScroll');
    if (!bar || !scroll) return;

    // Hide on genel and bekleyen tabs
    if (_activeMainTab === 'genel' || _activeMainTab === 'bekleyen') {
        bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';

    // Only show tabs matching current direction
    const visible = _invoiceTabList.filter(t => t.direction === currentView);

    if (visible.length === 0) {
        scroll.innerHTML = '<span class="invoice-tab-empty">Faturalar açıldıkça burada listelenir</span>';
    } else {
        scroll.innerHTML = visible.map(tab => {
            const arrowIcon = tab.direction === 'giden' ? 'ti-arrow-up' : 'ti-arrow-down';
            const arrowCls  = tab.direction === 'giden' ? 'giden' : 'gelen';
            return `<div class="invoice-tab" onclick="openFatDetailPage('${tab.id}')">
                <i class="ti ${arrowIcon} invoice-tab-arrow ${arrowCls}"></i>
                <span class="invoice-tab-no">${tab.invoiceNo}</span>
                <span class="invoice-tab-close" onclick="event.stopPropagation(); closeInvoiceTab('${tab.id}')">×</span>
            </div>`;
        }).join('');
    }
}

function setFatListSort(col) {
    if (window._FAT_PENDING) return;   // no sorting in bekleyen mode

    fatListSort = {
        col,
        dir: fatListSort.col === col
            ? (fatListSort.dir === 'asc' ? 'desc' : 'asc')
            : (col === 'company' || col === 'no' ? 'asc' : 'desc')
    };
    _currentPage = 1;
    initInvoiceView(false);
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


function switchFatTab(view) {
    currentView = view;
    _currentPage = 1;    // ← reset to page 1 when switching tabs
    window._fatActiveFilters = {};  // ← clear filters on tab switch
    initInvoiceView(false);
}


// ─── İçerik render ────────────────────────────────────────────────────────────




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



// ─── Filter popovers ──────────────────────────────────────────────────────────

function initFilterPopovers() {
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.filter-pill-wrap')) {
            document.querySelectorAll('.filter-popover').forEach(p => p.classList.remove('open'));
            document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('open'));
        }
    });
}



function toggleAdvancedFilters() {
    const panel  = document.getElementById('filterAdvPanel');
    const toggle = document.getElementById('filterAdvToggle');
    if (!panel || !toggle) return;
    _fatAdvancedOpen = !_fatAdvancedOpen;
    panel.classList.toggle('open', _fatAdvancedOpen);
    toggle.classList.toggle('open', _fatAdvancedOpen);
}



function updateAdvancedBadge() {
    const count =
        (_fatProductFilter?.getSelected().length  || 0) +
        (_fatBrandFilter?.getSelected().length    || 0) +
        (_fatCategoryFilter?.getSelected().length || 0) +
        (document.getElementById('filterCurrency')?.value ? 1 : 0);

    const badge = document.getElementById('filterAdvBadge');
    if (!badge) return;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

// ─── Date picker ──────────────────────────────────────────────────────────────


function setDatePreset(el, type) {
    // If this preset is already active, deactivate it
    if (el.classList.contains('active')) {
        el.classList.remove('active');
        _fatDatePreset = '';
        _fatCalCtx.selStart = null;              // ← changed
        _fatCalCtx.selEnd   = null;              // ← changed

        const dsEl = document.getElementById('filterDateStart');
        const deEl = document.getElementById('filterDateEnd');
        if (dsEl) dsEl.value = '';
        if (deEl) deEl.value = '';

        const disp = document.getElementById('dateDisplay');
        if (disp) disp.textContent = 'Tüm zamanlar';

        document.getElementById('datePill')?.classList.remove('active');
        buildFilterCals();
        applyFiltersAndFetch();
        return;
    }

    document.querySelectorAll('#datePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    _fatDatePreset = type;

    if (type === 'custom') {
        _fatCalCtx.selStart = null;              // ← changed
        _fatCalCtx.selEnd   = null;              // ← changed
        buildFilterCals();
        const disp = document.getElementById('dateDisplay');
        if (disp) disp.textContent = 'Tarih seç';
        document.getElementById('datePill')?.classList.remove('active');
        return;
    }

    const today = new Date(); today.setHours(0,0,0,0);
    let start = new Date(today);

    if (type === 'day') {
        // start = today
    }
    else if (type === 'week') {
        const dow = today.getDay() || 7;
        start = new Date(today);
        start.setDate(today.getDate() - (dow - 1));
    }
    else if (type === 'month') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    else if (type === 'q') {
        start = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
    }
    else if (type === 'year') {
        start = new Date(today.getFullYear(), 0, 1);
    }

    _fatCalCtx.selStart = start;                 // ← changed
    _fatCalCtx.selEnd   = today;                 // ← changed
    buildFilterCals();
    _setFilterDateInputs(start, today);
    applyFiltersAndFetch();
}
function _setFilterDateInputs(start, end) {
    const fmt = dt => dt.toISOString().slice(0, 10);
    const dsEl = document.getElementById('filterDateStart');
    const deEl = document.getElementById('filterDateEnd');
    if (dsEl) dsEl.value = fmt(start);
    if (deEl) deEl.value = fmt(end);

    const label = _fatDatePreset === 'month' ? 'Bu ay'
                : _fatDatePreset === 'q'     ? 'Son 3 ay'
                : _fatDatePreset === 'year'  ? 'Bu yıl'
                : `${start.toLocaleDateString('tr-TR',{day:'numeric',month:'short'})} – ${end.toLocaleDateString('tr-TR',{day:'numeric',month:'short'})}`;

    const disp = document.getElementById('dateDisplay');
    if (disp) disp.textContent = label;
    document.getElementById('datePill')?.classList.add('active');
}



function closeInvoiceTab(id) {
    _invoiceTabList = _invoiceTabList.filter(t => t.id !== id);
    try {
        sessionStorage.setItem('invoice_tabs', JSON.stringify(_invoiceTabList));
    } catch(e) {}
    renderInvoiceTabBar();
}



// ─── KPI sparkline (mock for now) ────────────────────────────────────────────

function _generateMockSparklineData(days = 90) {
    const points = [];
    let value = 8;
    for (let i = 0; i < days; i++) {
        // gentle upward trend + noise
        value += (Math.random() - 0.4) * 3;
        value = Math.max(1, value);
        points.push(value);
    }
    return points;
}

function renderKpiSparkline(svgId, days = 90) {
    const svg = document.getElementById(svgId);
    if (!svg) return;

    // Read height from viewBox so it works for both 20px and 14px sparklines
    const viewBox = svg.getAttribute('viewBox') || '0 0 200 20';
    const [, , w, h] = viewBox.split(' ').map(Number);

    const data = _generateMockSparklineData(days);
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = (max - min) || 1;

    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * w;
        const y = h - ((v - min) / range) * (h - 2) - 1;
        return [x, y];
    });

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${w},${h} L0,${h} Z`;

    svg.innerHTML = `
        <path d="${area}" fill="var(--fat-green-bg)"/>
        <path d="${line}" stroke="var(--fat-green)" stroke-width="1.5" fill="none"
              stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    `;
}



