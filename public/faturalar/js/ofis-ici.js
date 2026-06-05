// ─── OFİS İÇİ FATURALAR ───────────────────────────────────────────────────────

let ofisIciCache   = [];
let _ofisPage      = 1;
let _ofisLimit     = 10;
let _ofisTotal     = 0;
let _ofisTotalPages = 1;
let _ofisKpiTotals = null;
let _ofisCompanyFilter = null;
let _ofisCompanyOptions = [];

document.addEventListener('DOMContentLoaded', () => {
    _initOfisCompanyFilter();
    loadOfisIciInvoices();
    loadOfisCompanyOptions();
    refreshOfisTotals();
});

async function loadOfisCompanyOptions() {
    try {
        const res = await fetch('/api/invoices/ofis-ici');
        if (!res.ok) return;
        const all = await res.json();
        const names = [...new Set((all || []).map(inv => inv.companies?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
        _ofisCompanyOptions = names;
    } catch {}
}

function _initOfisCompanyFilter() {
    _ofisCompanyFilter = createTagFilter({
        wrapId:     'ofisCompanyTagsWrap',
        inputId:    'ofisCompanyTagInput',
        dropdownId: 'ofisCompanyDropdown',
        getOptions: () => _ofisCompanyOptions,
        onChange:   () => applyOfisFiltersAndFetch(),
    });
}

function _ofisParams(withPagination = true) {
    const params = new URLSearchParams();
    const search    = document.getElementById('mainSearch')?.value || '';
    const dateStart = document.getElementById('filterDateStart')?.value || '';
    const dateEnd   = document.getElementById('filterDateEnd')?.value   || '';
    const category  = document.getElementById('filterCategory')?.value  || '';
    const companies = _ofisCompanyFilter?.getSelected() || [];

    if (search)          params.set('search',     search);
    if (dateStart)       params.set('date_start', dateStart);
    if (dateEnd)         params.set('date_end',   dateEnd);
    if (category)        params.set('category',   category);
    if (companies.length) params.set('companies', companies.join(','));
    if (withPagination) {
        params.set('page',  _ofisPage);
        params.set('limit', _ofisLimit);
    }
    return params;
}

async function loadOfisIciInvoices() {
    const content = document.getElementById('fatContent');
    if (content) content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px;font-weight:500;">Yükleniyor…</div>';

    try {
        const params = _ofisParams(true);
        const res = await fetch('/api/invoices/ofis-ici?' + params.toString());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();

        if (Array.isArray(json)) {
            ofisIciCache    = json;
            _ofisTotal      = json.length;
            _ofisTotalPages = 1;
        } else {
            ofisIciCache    = json.data        || [];
            _ofisTotal      = json.total       || 0;
            _ofisTotalPages = json.total_pages || 1;
            _ofisPage       = json.page        || 1;
        }
    } catch (e) {
        if (content) content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:14px;">Yüklenemedi: ' + e.message + '</div>';
        return;
    }

    populateCategoryFilter();
    renderOfisIciList();
    renderOfisPagination();
}

async function refreshOfisTotals() {
    try {
        const params = _ofisParams(false);
        params.set('totals', 'true');
        const res  = await fetch('/api/invoices/ofis-ici?' + params.toString());
        if (!res.ok) return;
        _ofisKpiTotals = await res.json();
        renderOfisKpi(_ofisKpiTotals);
    } catch {}
}

function applyOfisFiltersAndFetch() {
    _ofisPage = 1;
    loadOfisIciInvoices();
    refreshOfisTotals();
}

function goToOfisPage(page) {
    if (page < 1 || page > _ofisTotalPages) return;
    _ofisPage = page;
    loadOfisIciInvoices();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function changeOfisLimit(newLimit) {
    _ofisLimit = parseInt(newLimit) || 10;
    _ofisPage  = 1;
    loadOfisIciInvoices();
}

function populateCategoryFilter() {
    const sel = document.getElementById('filterCategory');
    if (!sel) return;
    const existing = new Set([...sel.options].map(o => o.value).filter(Boolean));
    const cats = new Set();
    ofisIciCache.forEach(inv =>
        (inv.invoice_items || []).forEach(it => {
            if (it.is_internal && it.item_subcategory) cats.add(it.item_subcategory);
        })
    );
    [...cats].sort((a, b) => a.localeCompare(b, 'tr')).forEach(cat => {
        if (!existing.has(cat)) {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            sel.appendChild(opt);
        }
    });
}

function renderOfisIciList() {
    const content = document.getElementById('fatContent');
    if (!content) return;

    if (!ofisIciCache.length) {
        content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px;font-weight:500;">Sonuç bulunamadı.</div>';
        return;
    }

    const fmtMoney = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const rows = ofisIciCache.map(inv => {
        const no            = (inv.invoice_no || '—').replace(/</g, '&lt;');
        const firm          = (inv.companies?.name || '—').replace(/</g, '&lt;');
        const date          = (inv.invoice_date || '').slice(0, 10);
        const isUSD         = (inv.base_currency || '').toUpperCase() === 'USD';
        const cur           = isUSD ? 'USD' : 'TRY';
        const internalItems = (inv.invoice_items || []).filter(it => it.is_internal);
        const internalTotal = internalItems.reduce((sum, it) => sum + (parseFloat(it.total_price_cur) || 0), 0);
        const internalQty   = internalItems.reduce((sum, it) => sum + (parseFloat(it.quantity) || 0), 0);
        const cats          = [...new Set(internalItems.map(it => it.item_subcategory).filter(Boolean))];
        const catBadges     = cats.map(c => '<span class="ofis-cat-badge">' + c + '</span>').join('');

        return '<tr class="fat-row" onclick="window.location.href=\'/faturalar/pages/fatura-detay.html?id=' + inv.id + '&from=ofis-ici\'" style="cursor:pointer;">' +
            '<td><span class="fat-tbl-no">' + no + '</span></td>' +
            '<td>' + firm + '</td>' +
            '<td class="fat-tbl-date">' + date + '</td>' +
            '<td class="fat-tbl-amount">' + fmtMoney(internalTotal) + ' <span style="color:#64748b;font-size:11px;">' + cur + '</span></td>' +
            '<td>' + (catBadges || '<span style="color:#475569;font-size:12px;">—</span>') + '</td>' +
            '</tr>';
    }).join('');

    content.innerHTML = '<div class="fat-list-view"><div class="fat-tbl-wrap"><table class="fat-tbl"><thead><tr>' +
        '<th>FATURA NO</th><th>FİRMA</th><th>TARİH</th><th style="text-align:right;">TOPLAM</th><th>KATEGORİLER</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function renderOfisKpi(totals) {
    const bar = document.getElementById('fatKpiBar');
    if (!bar) return;

    const fmtMoney = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const slimStyle  = 'style="padding:6px 10px; min-width:90px;"';
    const spendStyle = 'style="padding:6px 14px; min-width:150px;"';

    const tryTotal   = totals.total_tl  || 0;
    const usdTotal   = totals.total_usd || 0;
    const totalFatura = totals.count    || 0;
    const catMap     = totals.cat_map   || {};

    const usdHtml = usdTotal > 0
        ? '<div class="fat-kpi" ' + spendStyle + '><p class="fat-kpi-label">HARCAMA (USD)</p><p class="fat-kpi-value" style="font-size:15px;color:#2563eb;">$' + fmtMoney(usdTotal) + '</p></div>'
        : '';

    bar.innerHTML =
        '<div class="fat-kpi" ' + slimStyle + '><p class="fat-kpi-label">TOPLAM FATURA</p><p class="fat-kpi-value" style="font-size:15px;">' + totalFatura + '</p></div>' +
        '<div class="fat-kpi" ' + spendStyle + '><p class="fat-kpi-label">HARCAMA (TL)</p><p class="fat-kpi-value" style="font-size:15px;">₺' + fmtMoney(tryTotal) + '</p></div>' +
        usdHtml;
}

function renderOfisKpiFromCache(list) {
    const bar = document.getElementById('fatKpiBar');
    if (!bar) return;
    const fmtMoney = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const slimStyle  = 'style="padding:6px 10px; min-width:90px;"';
    const spendStyle = 'style="padding:6px 14px; min-width:150px;"';
    const catMap = {};
    let tryTotal = 0, usdTotal = 0;
    (list || []).forEach(inv => {
        const isUSD = (inv.base_currency || '').toUpperCase() === 'USD';
        (inv.invoice_items || []).filter(it => it.is_internal).forEach(it => {
            const lineTotal = parseFloat(it.total_price_cur) || 0;
            if (isUSD) usdTotal += lineTotal; else tryTotal += lineTotal;
            const cat = it.item_subcategory || 'diğer';
            catMap[cat] = (catMap[cat] || 0) + (parseFloat(it.quantity) || 1);
        });
    });
    const usdHtml = usdTotal > 0
        ? '<div class="fat-kpi" ' + spendStyle + '><p class="fat-kpi-label">HARCAMA (USD)</p><p class="fat-kpi-value" style="font-size:15px;color:#2563eb;">$' + fmtMoney(usdTotal) + '</p></div>'
        : '';
    bar.innerHTML =
        '<div class="fat-kpi" ' + slimStyle + '><p class="fat-kpi-label">TOPLAM FATURA</p><p class="fat-kpi-value" style="font-size:15px;">' + (list?.length || 0) + '</p></div>' +
        '<div class="fat-kpi" ' + spendStyle + '><p class="fat-kpi-label">HARCAMA (TL)</p><p class="fat-kpi-value" style="font-size:15px;">₺' + fmtMoney(tryTotal) + '</p></div>' +
        usdHtml;
}

function renderOfisPagination() {
    document.getElementById('ofisPagination')?.remove();
    if (_ofisTotal === 0) return;

    const container = document.querySelector('.fat-area');
    if (!container) return;

    const btnStyle = (disabled = false, active = false) => `
        height:28px; min-width:28px; padding:0 8px; border-radius:6px; border:none; cursor:${disabled ? 'default' : 'pointer'};
        background:${active ? '#2563eb' : (disabled ? '#1e293b' : '#1e293b')};
        color:${active ? '#fff' : (disabled ? '#475569' : '#94a3b8')};
        font-size:12px; font-family:inherit;
    `;

    const wrap = document.createElement('div');
    wrap.id = 'ofisPagination';
    wrap.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:10px 16px; background:#0f172a; border-top:1px solid #1e293b; flex-shrink:0; gap:12px; flex-wrap:wrap;';

    const from = ((_ofisPage - 1) * _ofisLimit) + 1;
    const to   = Math.min(_ofisPage * _ofisLimit, _ofisTotal);
    const info = document.createElement('span');
    info.style.cssText = 'font-size:12px; color:#64748b;';
    info.textContent   = `${from}–${to} / ${_ofisTotal} fatura`;

    const pages = document.createElement('div');
    pages.style.cssText = 'display:flex; align-items:center; gap:4px;';

    const prev = document.createElement('button');
    prev.innerHTML = '<i class="ti ti-chevron-left"></i>';
    prev.disabled  = _ofisPage <= 1;
    prev.style.cssText = btnStyle(_ofisPage <= 1);
    prev.onclick   = () => goToOfisPage(_ofisPage - 1);
    pages.appendChild(prev);

    for (let p = 1; p <= _ofisTotalPages; p++) {
        if (_ofisTotalPages > 7 && p > 2 && p < _ofisTotalPages - 1 && Math.abs(p - _ofisPage) > 1) {
            if (p === 3 || p === _ofisTotalPages - 2) {
                const dots = document.createElement('span');
                dots.textContent = '…';
                dots.style.cssText = 'font-size:12px; color:#475569; padding:0 4px;';
                pages.appendChild(dots);
            }
            continue;
        }
        const btn = document.createElement('button');
        btn.textContent   = p;
        btn.style.cssText = btnStyle(false, p === _ofisPage);
        btn.onclick       = () => goToOfisPage(p);
        pages.appendChild(btn);
    }

    const next = document.createElement('button');
    next.innerHTML = '<i class="ti ti-chevron-right"></i>';
    next.disabled  = _ofisPage >= _ofisTotalPages;
    next.style.cssText = btnStyle(_ofisPage >= _ofisTotalPages);
    next.onclick   = () => goToOfisPage(_ofisPage + 1);
    pages.appendChild(next);

    const limitWrap = document.createElement('div');
    limitWrap.style.cssText = 'display:flex; align-items:center; gap:6px;';
    const limitLabel = document.createElement('span');
    limitLabel.style.cssText = 'font-size:12px; color:#64748b;';
    limitLabel.textContent   = 'Sayfa başına:';
    const limitSel = document.createElement('select');
    limitSel.style.cssText = 'height:28px; padding:0 8px; border:1px solid #334155; border-radius:6px; background:#1e293b; color:#f1f5f9; font-size:12px; font-family:inherit; cursor:pointer; outline:none;';
    [10, 25, 50, 100].forEach(n => {
        const opt = document.createElement('option');
        opt.value = n; opt.textContent = n; opt.selected = n === _ofisLimit;
        limitSel.appendChild(opt);
    });
    limitSel.onchange = () => changeOfisLimit(limitSel.value);
    limitWrap.appendChild(limitLabel);
    limitWrap.appendChild(limitSel);

    wrap.appendChild(info);
    wrap.appendChild(pages);
    wrap.appendChild(limitWrap);
    container.appendChild(wrap);
}

function clearOfisFilters() {
    _ofisCompanyFilter?.clear();
    ['mainSearch', 'filterDateStart', 'filterDateEnd', 'filterCategory'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    _ofisKpiTotals = null;
    applyOfisFiltersAndFetch();
}
