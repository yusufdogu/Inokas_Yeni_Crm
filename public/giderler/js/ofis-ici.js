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
        const names = [...new Set((all || []).map(inv => inv.companies?.name).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'tr'));
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
    const params    = new URLSearchParams();
    const search    = document.getElementById('mainSearch')?.value || '';
    const dateStart = document.getElementById('filterDateStart')?.value || '';
    const dateEnd   = document.getElementById('filterDateEnd')?.value   || '';
    const category  = document.getElementById('filterCategory')?.value  || '';
    const companies = _ofisCompanyFilter?.getSelected() || [];

    if (search)           params.set('search',     search);
    if (dateStart)        params.set('date_start', dateStart);
    if (dateEnd)          params.set('date_end',   dateEnd);
    if (category)         params.set('category',   category);
    if (companies.length) params.set('companies',  companies.join(','));
    if (withPagination) {
        params.set('page',  _ofisPage);
        params.set('limit', _ofisLimit);
    }
    return params;
}


async function loadOfisIciInvoices() {
    const content = document.getElementById('fatContent');
    if (content) {
        content.innerHTML = '<div class="ofis-state">Yükleniyor…</div>';
    }

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
        if (content) {
            content.innerHTML = `<div class="ofis-state ofis-state--error">Yüklenemedi: ${e.message}</div>`;
        }
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
        const res = await fetch('/api/invoices/ofis-ici?' + params.toString());
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
            if (!it.is_internal && it.item_subcategory) cats.add(it.item_subcategory);
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
        content.innerHTML = '<div class="ofis-state">Sonuç bulunamadı.</div>';
        return;
    }

    const fmtMoney = n => (parseFloat(n) || 0).toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const esc = s => String(s || '').replace(/</g, '&lt;');

    const rows = ofisIciCache.map(inv => {
        const no    = esc(inv.invoice_no || '—');
        const firm  = esc(inv.companies?.name || '—');
        const date  = (inv.invoice_date || '').slice(0, 10);
        const isUSD = (inv.base_currency || '').toUpperCase() === 'USD';
        const cur   = isUSD ? 'USD' : 'TRY';

        // FIX: sum items where is_internal === true (business/office items).
        // This now matches the backend KPI totals branch.
        const internalItems = (inv.invoice_items || []).filter(it => !it.is_internal);
        const internalTotal = internalItems.reduce(
            (sum, it) => sum + (parseFloat(it.total_price_cur) || 0), 0
        );

        const cats = [...new Set(internalItems.map(it => it.item_subcategory).filter(Boolean))];
        const catBadges = cats.length
            ? `<div class="ofis-tbl-cats">${
                cats.map((c, i) =>
                    `<span class="ofis-cat-badge${i % 2 === 1 ? ' ofis-cat-badge--alt' : ''}">${esc(c)}</span>`
                ).join('')
              }</div>`
            : '<span class="ofis-tbl-empty-cell">—</span>';

        const href = `/faturalar/pages/fatura-detay.html?id=${inv.id}&from=ofis-ici`;

        return `
            <tr onclick="window.location.href='${href}'">
                <td><span class="ofis-tbl-no">${no}</span></td>
                <td><span class="ofis-tbl-firm">${firm}</span></td>
                <td class="ofis-tbl-date">${date}</td>
                <td class="ofis-tbl-amount">${fmtMoney(internalTotal)}<span class="ofis-tbl-cur">${cur}</span></td>
                <td>${catBadges}</td>
            </tr>`;
    }).join('');

    content.innerHTML = `
        <div class="ofis-tbl-wrap">
            <table class="ofis-tbl">
                <thead>
                    <tr>
                        <th>Fatura No</th>
                        <th>Firma</th>
                        <th>Tarih</th>
                        <th class="ofis-th-right">Toplam</th>
                        <th>Kategoriler</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}
function renderOfisKpi(totals) {
    const bar = document.getElementById('fatKpiBar');
    if (!bar || !totals) return;

    const fmtMoney = n => (parseFloat(n) || 0).toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

    const tryTotal    = totals.total_tl  || 0;
    const usdTotal    = totals.total_usd || 0;
    const totalFatura = totals.count     || 0;

    const usdCard = usdTotal > 0
        ? `<div class="ofis-kpi">
               <p class="ofis-kpi-label">Harcama (USD)</p>
               <p class="ofis-kpi-value ofis-kpi-value--spend">$ ${fmtMoney(usdTotal)}</p>
           </div>`
        : '';

    bar.innerHTML = `
        <div class="ofis-kpi">
            <p class="ofis-kpi-label">Toplam Fatura</p>
            <p class="ofis-kpi-value">${totalFatura}</p>
        </div>
        <div class="ofis-kpi">
            <p class="ofis-kpi-label">Harcama (TL)</p>
            <p class="ofis-kpi-value ofis-kpi-value--spend">₺ ${fmtMoney(tryTotal)}</p>
        </div>
        ${usdCard}`;
}
function renderOfisPagination() {
    document.getElementById('ofisPagination')?.remove();
    if (_ofisTotal === 0) return;

    const container = document.querySelector('.fat-area');
    if (!container) return;

    const wrap = document.createElement('div');
    wrap.id = 'ofisPagination';
    wrap.className = 'ofis-pagination';

    // ── Info: "1–10 / 142 fatura" ──
    const from = ((_ofisPage - 1) * _ofisLimit) + 1;
    const to   = Math.min(_ofisPage * _ofisLimit, _ofisTotal);
    const info = document.createElement('span');
    info.className   = 'ofis-pag-info';
    info.textContent = `${from}–${to} / ${_ofisTotal} fatura`;

    // ── Page buttons ──
    const pages = document.createElement('div');
    pages.className = 'ofis-pag-pages';

    const prev = document.createElement('button');
    prev.className = 'ofis-pag-btn';
    prev.innerHTML = '<i class="ti ti-chevron-left"></i>';
    prev.disabled  = _ofisPage <= 1;
    prev.onclick   = () => goToOfisPage(_ofisPage - 1);
    pages.appendChild(prev);

    for (let p = 1; p <= _ofisTotalPages; p++) {
        // Collapse middle pages with ellipsis when there are many
        if (_ofisTotalPages > 7 && p > 2 && p < _ofisTotalPages - 1 && Math.abs(p - _ofisPage) > 1) {
            if (p === 3 || p === _ofisTotalPages - 2) {
                const dots = document.createElement('span');
                dots.className   = 'ofis-pag-dots';
                dots.textContent = '…';
                pages.appendChild(dots);
            }
            continue;
        }

        const btn = document.createElement('button');
        btn.className   = 'ofis-pag-btn' + (p === _ofisPage ? ' ofis-pag-btn--active' : '');
        btn.textContent = p;
        btn.onclick     = () => goToOfisPage(p);
        pages.appendChild(btn);
    }

    const next = document.createElement('button');
    next.className = 'ofis-pag-btn';
    next.innerHTML = '<i class="ti ti-chevron-right"></i>';
    next.disabled  = _ofisPage >= _ofisTotalPages;
    next.onclick   = () => goToOfisPage(_ofisPage + 1);
    pages.appendChild(next);

    // ── Per-page limit selector ──
    const limitWrap = document.createElement('div');
    limitWrap.className = 'ofis-pag-limit';

    const limitLabel = document.createElement('span');
    limitLabel.className   = 'ofis-pag-limit-label';
    limitLabel.textContent = 'Sayfa başına:';

    const limitSel = document.createElement('select');
    limitSel.className = 'ofis-pag-limit-select';
    [10, 25, 50, 100].forEach(n => {
        const opt = document.createElement('option');
        opt.value       = n;
        opt.textContent = n;
        opt.selected    = n === _ofisLimit;
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

// ─── CLEAR FILTERS ────────────────────────────────────────────────────────────
function clearOfisFilters() {
    _ofisCompanyFilter?.clear();
    ['mainSearch', 'filterDateStart', 'filterDateEnd', 'filterCategory'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    _ofisKpiTotals = null;
    applyOfisFiltersAndFetch();
}
