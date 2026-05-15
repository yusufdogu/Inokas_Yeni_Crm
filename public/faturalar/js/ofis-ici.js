// ─── OFİS İÇİ FATURALAR ───────────────────────────────────────────────────────

let ofisIciCache = [];

document.addEventListener('DOMContentLoaded', () => {
    loadOfisIciInvoices();
});

async function loadOfisIciInvoices() {
    const content = document.getElementById('fatContent');
    if (content) content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px;font-weight:500;">Yükleniyor…</div>';

    try {
        const res = await fetch('/api/invoices/ofis-ici');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        ofisIciCache = await res.json();
    } catch (e) {
        if (content) content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:14px;">Yüklenemedi: ' + e.message + '</div>';
        return;
    }

    populateCategoryFilter();
    renderOfisIciList();
}

function populateCategoryFilter() {
    const sel = document.getElementById('filterCategory');
    if (!sel) return;
    const cats = new Set();
    ofisIciCache.forEach(inv =>
        (inv.invoice_items || []).forEach(it => {
            if (it.is_internal && it.internal_category) cats.add(it.internal_category);
        })
    );
    [...cats].sort((a, b) => a.localeCompare(b, 'tr')).forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        sel.appendChild(opt);
    });
}

function renderOfisIciList() {
    const content = document.getElementById('fatContent');
    if (!content) return;

    const q         = (document.getElementById('mainSearch')?.value || '').toLocaleLowerCase('tr-TR');
    const dateStart = document.getElementById('filterDateStart')?.value || '';
    const dateEnd   = document.getElementById('filterDateEnd')?.value   || '';
    const catFilter = document.getElementById('filterCategory')?.value  || '';

    const list = ofisIciCache.filter(inv => {
        if (q) {
            const no   = (inv.invoice_no || '').toLocaleLowerCase('tr-TR');
            const firm = (inv.companies?.name || '').toLocaleLowerCase('tr-TR');
            if (!no.includes(q) && !firm.includes(q)) return false;
        }
        if (dateStart && (inv.invoice_date || '') < dateStart) return false;
        if (dateEnd   && (inv.invoice_date || '') > dateEnd)   return false;
        if (catFilter) {
            const has = (inv.invoice_items || []).some(it => it.is_internal && it.internal_category === catFilter);
            if (!has) return false;
        }
        return true;
    });

    renderOfisKpi(list);

    if (!list.length) {
        content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px;font-weight:500;">Sonuç bulunamadı.</div>';
        return;
    }

    const fmtMoney = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const rows = list.map(inv => {
        const no            = (inv.invoice_no || '—').replace(/</g, '&lt;');
        const firm          = (inv.companies?.name || '—').replace(/</g, '&lt;');
        const date          = (inv.invoice_date || '').slice(0, 10);
        const isUSD         = (inv.currency || '').toUpperCase() === 'USD';
        const cur           = isUSD ? 'USD' : 'TRY';
        const internalItems = (inv.invoice_items || []).filter(it => it.is_internal);
        const internalTotal = internalItems.reduce((sum, it) => sum + (parseFloat(it.total_price_cur) || 0), 0);
        const internalQty   = internalItems.reduce((sum, it) => sum + (parseFloat(it.quantity) || 0), 0);
        const cats          = [...new Set(internalItems.map(it => it.internal_category).filter(Boolean))];
        const catBadges     = cats.map(c => '<span class="ofis-cat-badge">' + c + '</span>').join('');

        return '<tr class="fat-row" onclick="window.location.href=\'/faturalar/pages/fatura-detay.html?id=' + inv.id + '&from=ofis-ici\'" style="cursor:pointer;">' +
            '<td><span class="fat-tbl-no">' + no + '</span></td>' +
            '<td>' + firm + '</td>' +
            '<td class="fat-tbl-date">' + date + '</td>' +
            '<td class="fat-tbl-amount">' + fmtMoney(internalTotal) + ' <span style="color:#64748b;font-size:11px;">' + cur + '</span></td>' +
            '<td>' + (catBadges || '<span style="color:#475569;font-size:12px;">—</span>') + '</td>' +
            '<td style="color:#64748b;font-size:12px;">' + internalQty + ' adet</td>' +
            '</tr>';
    }).join('');

    content.innerHTML = '<div class="fat-list-view"><div class="fat-tbl-wrap"><table class="fat-tbl"><thead><tr>' +
        '<th>FATURA NO</th><th>FİRMA</th><th>TARİH</th><th style="text-align:right;">TOPLAM</th><th>KATEGORİLER</th><th>OFİS İÇİ</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function renderOfisKpi(list) {
    const bar = document.getElementById('fatKpiBar');
    if (!bar) return;

    const data = list || ofisIciCache;
    const totalFatura = data.length;
    const catMap = {};
    let tryTotal = 0;
    let usdTotal = 0;

    data.forEach(inv => {
        const rate  = parseFloat(inv.calculation_rate) || 1;
        const isUSD = (inv.currency || '').toUpperCase() === 'USD';

        (inv.invoice_items || []).forEach(it => {
            if (!it.is_internal) return;
            const lineTotal = parseFloat(it.total_price_cur) || 0;
            if (isUSD) {
                usdTotal += lineTotal;
            } else {
                tryTotal += lineTotal;
            }
            const cat = it.internal_category || 'diğer';
            catMap[cat] = (catMap[cat] || 0) + (parseFloat(it.quantity) || 1);
        });
    });

    const fmtMoney = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const topCats  = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 3);

    const slimStyle  = 'style="padding:6px 10px; min-width:90px;"';
    const spendStyle = 'style="padding:6px 14px; min-width:150px;"';

    const catHtml = topCats.map(([cat, cnt]) =>
        '<div class="fat-kpi" ' + slimStyle + '><p class="fat-kpi-label">' + cat.toUpperCase() + '</p><p class="fat-kpi-value" style="font-size:15px;">' + cnt + ' adet</p></div>'
    ).join('');

    const usdHtml = usdTotal > 0
        ? '<div class="fat-kpi" ' + spendStyle + '><p class="fat-kpi-label">HARCAMA (USD)</p><p class="fat-kpi-value" style="font-size:15px;color:#2563eb;">$' + fmtMoney(usdTotal) + '</p></div>'
        : '';

    bar.innerHTML =
        '<div class="fat-kpi" ' + slimStyle + '><p class="fat-kpi-label">TOPLAM FATURA</p><p class="fat-kpi-value" style="font-size:15px;">' + totalFatura + '</p></div>' +
        '<div class="fat-kpi" ' + spendStyle + '><p class="fat-kpi-label">HARCAMA (TL)</p><p class="fat-kpi-value" style="font-size:15px;">₺' + fmtMoney(tryTotal) + '</p></div>' +
        usdHtml +
        catHtml;
}

function clearOfisFilters() {
    ['mainSearch', 'filterDateStart', 'filterDateEnd', 'filterCategory'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    renderOfisIciList();
}
