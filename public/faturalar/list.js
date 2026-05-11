// ─── FATURALAR — LİSTE GÖRÜNÜMÜ ───────────────────────────────────────────────
// Fatura listesi, tab bar, KPI bar, grafik, filtreler, session cache yönetimi

// ─── Session cache ────────────────────────────────────────────────────────────

function saveFilterState() {
    try {
        const state = {
            company: document.getElementById('filterCompany')?.value || '',
            dateStart: document.getElementById('filterDateStart')?.value || '',
            dateEnd: document.getElementById('filterDateEnd')?.value || '',
            status: document.getElementById('filterStatus')?.value || '',
            currency: document.getElementById('filterCurrency')?.value || '',
            search: document.getElementById('mainSearch')?.value || '',
            product: document.getElementById('filterProduct')?.value || '',
            productLabel: document.getElementById('productDropdownLabel')?.textContent || 'Tüm Ürünler',
            companyLabel: document.getElementById('companyDropdownLabel')?.textContent || 'Firmalar',
            showAllGelen: showAllState.gelen,
            showAllGiden: showAllState.giden,
            interactedGelen: interactedState.gelen,
            interactedGiden: interactedState.giden,
            currentView: currentView,
        };
        sessionStorage.setItem(FILTER_STATE_KEY, JSON.stringify(state));
    } catch (e) { /* sessizce geç */ }
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
        if (s.product !== undefined) {
            const hidden = document.getElementById('filterProduct');
            const label  = document.getElementById('productDropdownLabel');
            if (hidden) hidden.value = s.product;
            if (label)  label.textContent = s.productLabel || (s.product || 'Tüm Ürünler');
        }
        if (s.company !== undefined) {
            const hidden = document.getElementById('filterCompany');
            const label  = document.getElementById('companyDropdownLabel');
            if (hidden) hidden.value = s.company;
            if (label)  label.textContent = s.companyLabel || (s.company || 'Firmalar');
        }

        showAllState.gelen    = !!s.showAllGelen;
        showAllState.giden    = !!s.showAllGiden;
        interactedState.gelen = !!s.interactedGelen;
        interactedState.giden = !!s.interactedGiden;

        const btn = document.getElementById('btnToggleShowAll');
        if (btn) btn.innerText = isShowAll() ? 'Tümünü Gizle' : 'Tümünü Göster';
    } catch (e) { /* sessizce geç */ }
}

function readInvoiceFinancialsFromForm() {
    const fCur = document.getElementById('f_currency')?.value?.trim() || 'TL';
    const baseIso = fCur === 'TL' ? 'TRY' : fCur;
    const rateRaw = parseFloat(document.getElementById('f_kur')?.value);
    const calculationRate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 1;

    const netCur      = parseFloat(document.getElementById('f_net')?.value)   || 0;
    const taxCur      = parseFloat(document.getElementById('f_tax')?.value)   || 0;
    const payableCur  = parseFloat(document.getElementById('f_total')?.value) || 0;
    const inclusiveCur = netCur + taxCur;

    return {
        currency: fCur,
        base_currency: baseIso,
        target_currency: 'TRY',
        calculation_rate: calculationRate,
        total_tax_exclusive_cur: netCur,
        total_tax_inclusive_cur: inclusiveCur,
        payable_amount_cur: payableCur,
        total_tax_exclusive_tl: netCur  * calculationRate,
        tax_amount_tl:          taxCur  * calculationRate,
        payable_amount_tl:      payableCur * calculationRate
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

function readPaymentClosureFromSession() {
    try {
        const raw    = sessionStorage.getItem(PAYMENT_CLOSURE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const ts     = Number(parsed?.timestamp) || 0;
        const data   = parsed?.data;
        if (!data || typeof data !== 'object' || ts <= 0) return null;
        if ((Date.now() - ts) > INVOICE_CACHE_TTL_MS) {
            sessionStorage.removeItem(PAYMENT_CLOSURE_CACHE_KEY);
            return null;
        }
        return data;
    } catch (e) { return null; }
}

function writePaymentClosureToSession(closureMap) {
    try {
        const payload = { timestamp: Date.now(), data: closureMap && typeof closureMap === 'object' ? closureMap : {} };
        sessionStorage.setItem(PAYMENT_CLOSURE_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('Ödeme kapanış cache yazılamadı:', e);
    }
}

// ─── Ana filtre + render döngüsü ──────────────────────────────────────────────

function renderCurrentView() {
    updateCompanyColumnHeader();
    if (!allInvoicesCache) return;

    const directionFilter = currentView === 'gelen' ? 'INCOMING' : 'OUTGOING';
    const scopedInvoices  = allInvoicesCache.filter(inv => inv.direction === directionFilter);

    populateCompanyFilter(scopedInvoices);

    const companySelected  = document.getElementById('filterCompany').value;
    const dateStart        = document.getElementById('filterDateStart')?.value || '';
    const dateEnd          = document.getElementById('filterDateEnd')?.value   || '';
    const statusSelected   = document.getElementById('filterStatus').value;
    const currencySelected = normalizeCurrencyCode(document.getElementById('filterCurrency').value);
    const searchText       = document.getElementById('mainSearch').value;
    const productSelected  = document.getElementById('filterProduct')?.value || '';
    const searchTextLower  = searchText.toLocaleLowerCase('tr-TR');

    const filterMatchedInvoices = scopedInvoices.filter(inv => {
        const matchCompany  = !companySelected || inv.companies?.name === companySelected;
        const invoiceCurrency = normalizeCurrencyCode(inv.currency);
        const matchCurrency = !currencySelected || invoiceCurrency === currencySelected;
        const matchProductCode = !searchTextLower || (inv.invoice_items || []).some((it) =>
            String(it.product_code || '').toLocaleLowerCase('tr-TR').includes(searchTextLower)
        );
        const matchSearch = !searchTextLower ||
            (inv.companies?.name && inv.companies.name.toLocaleLowerCase('tr-TR').includes(searchTextLower)) ||
            (inv.invoice_no && inv.invoice_no.toLocaleLowerCase('tr-TR').includes(searchTextLower)) ||
            matchProductCode;

        const valStatus = (inv.status || 'unpaid').toLowerCase();
        const matchStatus = !statusSelected || valStatus === statusSelected;

        let matchDate = true;
        if (dateStart || dateEnd) {
            const d = inv.invoice_date || '';
            if (dateStart && d < dateStart) matchDate = false;
            if (dateEnd   && d > dateEnd)   matchDate = false;
        }

        const matchProduct = !productSelected || (inv.invoice_items || []).some(it =>
            String(it.product_code || it.sku || '').toLocaleLowerCase('tr-TR').includes(productSelected.toLocaleLowerCase('tr-TR')) ||
            String(it.product_name || '').toLocaleLowerCase('tr-TR').includes(productSelected.toLocaleLowerCase('tr-TR'))
        );

        return matchCompany && matchCurrency && matchSearch && matchStatus && matchDate && matchProduct;
    });

    if (!hasInteracted()) {
        renderInvoiceTable([]);
        updateSummaryCards(filterMatchedInvoices);
        return;
    }

    if (isShowAll()) {
        renderInvoiceTable(scopedInvoices);
        updateSummaryCards(filterMatchedInvoices);
        return;
    }

    renderInvoiceTable(filterMatchedInvoices);
    updateSummaryCards(filterMatchedInvoices);
}

function updateCompanyColumnHeader() {
    // no-op — kart listesi kullanılıyor
}

function toggleShowAll() {
    setShowAll(!isShowAll());
    setInteracted(true);

    const btn = document.getElementById('btnToggleShowAll');

    if (isShowAll()) {
        document.getElementById('filterCompany').value = '';
        const elDs = document.getElementById('filterDateStart'); if (elDs) elDs.value = '';
        const elDe = document.getElementById('filterDateEnd');   if (elDe) elDe.value = '';
        document.getElementById('filterStatus').value   = '';
        document.getElementById('filterCurrency').value = '';
        document.getElementById('mainSearch').value     = '';
        const elProd    = document.getElementById('filterProduct');       if (elProd)    elProd.value    = '';
        const elProdLbl = document.getElementById('productDropdownLabel'); if (elProdLbl) elProdLbl.textContent = 'Tüm Ürünler';
        const lbl       = document.getElementById('companyDropdownLabel'); if (lbl)       lbl.textContent = 'Firmalar';
        btn.innerText = 'Tümünü Gizle';
    } else {
        setInteracted(false);
        btn.innerText = 'Tümünü Göster';
    }

    saveFilterState();
    renderCurrentView();
}

// ─── KPI Dashboard ────────────────────────────────────────────────────────────

function _buildDirectionBaseForShare() {
    const direction       = currentView === 'gelen' ? 'INCOMING' : 'OUTGOING';
    const yearSelected    = document.getElementById('filterYear')?.value    || '';
    const monthSelected   = document.getElementById('filterMonth')?.value   || '';
    const statusSelected  = document.getElementById('filterStatus')?.value  || '';
    const currencySelected = normalizeCurrencyCode(document.getElementById('filterCurrency')?.value || '');
    const searchText      = (document.getElementById('mainSearch')?.value || '').toLocaleLowerCase('tr-TR');

    return (allInvoicesCache || []).filter(inv => {
        if (inv.direction !== direction) return false;
        const invoiceCurrency = normalizeCurrencyCode(inv.currency);
        if (currencySelected && invoiceCurrency !== currencySelected) return false;
        const st = String(inv.status || 'unpaid').toLowerCase();
        if (statusSelected && st !== statusSelected) return false;
        if (searchText) {
            const companyMatch = String(inv.companies?.name || '').toLocaleLowerCase('tr-TR').includes(searchText);
            const noMatch      = String(inv.invoice_no || '').toLocaleLowerCase('tr-TR').includes(searchText);
            if (!companyMatch && !noMatch) return false;
        }
        if (yearSelected || monthSelected) {
            const d = new Date(inv.invoice_date);
            if (yearSelected && d.getFullYear().toString() !== yearSelected) return false;
            if (monthSelected) {
                const m = String(d.getMonth() + 1).padStart(2, '0');
                if (m !== monthSelected) return false;
            }
        }
        return true;
    });
}

function updateSummaryCards(invoices) {
    const container = document.getElementById('summaryCardsContainer');
    if (!container) return;

    const totals = _sumByCurrency(invoices);

    container.innerHTML = `
      <div class="dash-stats-row">
        <div class="dash-stat-card">
          <div class="dash-stat-label">USD TOPLAM</div>
          <div class="dash-stat-value">${_fmtAmount(totals.USD.payable, 'USD')}</div>
        </div>
        <div class="dash-stat-card">
          <div class="dash-stat-label">TL TOPLAM</div>
          <div class="dash-stat-value">${_fmtAmount(totals.TRY.payable, 'TRY')}</div>
        </div>
        <div class="dash-stat-card">
          <div class="dash-stat-label">TOPLAM FATURA</div>
          <div class="dash-stat-value">${invoices.length}</div>
        </div>
      </div>
      <div class="dash-actions-row">
        <button class="dash-action-btn dash-action-btn--purple" onclick="openFaturaListModal()">
          <span class="dash-action-icon">📒</span>
          <span>Faturaları Göster</span>
        </button>
        <button class="dash-action-btn dash-action-btn--green" onclick="openInvoiceModal()">
          <span class="dash-action-icon">➕</span>
          <span>Fatura Ekle</span>
        </button>
        <button class="dash-action-btn dash-action-btn--orange" onclick="openBulkUploadModal()">
          <span class="dash-action-icon">✅</span>
          <span>Toplu XML</span>
        </button>
      </div>
      <div class="dash-charts-section">
        <div class="dash-chart-card">
          <div class="dash-chart-title">Aylık Ciro — Giden Faturalar (TL)</div>
          <canvas id="chartMonthlyRevenue" height="80"></canvas>
        </div>
        <div class="dash-chart-pair">
          <div class="dash-chart-card">
            <div class="dash-chart-title">En Çok Kazandıran 5 Müşteri</div>
            <canvas id="chartTop5Companies" height="160"></canvas>
          </div>
          <div class="dash-chart-card">
            <div class="dash-chart-title">Gelen vs Giden — Aylık (TL)</div>
            <canvas id="chartGelenGiden" height="160"></canvas>
          </div>
        </div>
      </div>
    `;

    renderDashboardCharts();
}

function renderDashboardCharts() {
    if (typeof Chart === 'undefined' || !allInvoicesCache) return;

    Object.values(_dashCharts).forEach(c => { try { c?.destroy(); } catch (e) { } });
    _dashCharts = {};

    const all    = allInvoicesCache;
    const TR     = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    const now    = new Date();
    const last12 = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        return { year: d.getFullYear(), month: d.getMonth(), key: `${d.getFullYear()}-${d.getMonth()}` };
    });
    const fmt  = v => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v));
    const toTl = inv => invPayableAmountSrc(inv) * invCalculationRate(inv);

    // Chart 1 — Monthly revenue (OUTGOING)
    const rev = {};
    last12.forEach(m => { rev[m.key] = 0; });
    all.forEach(inv => {
        if (inv.direction !== 'OUTGOING' || !inv.invoice_date) return;
        const d = new Date(inv.invoice_date);
        const k = `${d.getFullYear()}-${d.getMonth()}`;
        if (k in rev) rev[k] += toTl(inv);
    });
    const c1 = document.getElementById('chartMonthlyRevenue');
    if (c1) {
        _dashCharts.rev = new Chart(c1, {
            type: 'line',
            data: {
                labels: last12.map(m => `${TR[m.month]} ${m.year}`),
                datasets: [{
                    label: 'Giden (TL)', data: last12.map(m => rev[m.key]),
                    borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.07)',
                    borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#2563eb',
                    fill: true, tension: 0.35
                }]
            },
            options: {
                responsive: true, plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { callback: fmt } } }
            }
        });
    }

    // Chart 2 — Top 5 companies by OUTGOING total (TL eşdeğeri)
    const byCompany = {};
    all.forEach(inv => {
        if (inv.direction !== 'OUTGOING') return;
        const name = inv.companies?.name || 'Bilinmeyen';
        byCompany[name] = (byCompany[name] || 0) + toTl(inv);
    });
    const top5      = Object.entries(byCompany).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const shortName = n => n.split(/\s+/).slice(0, 2).join(' ');
    const c2 = document.getElementById('chartTop5Companies');
    if (c2) {
        _dashCharts.top5 = new Chart(c2, {
            type: 'bar',
            data: {
                labels: top5.map(([n]) => shortName(n)),
                datasets: [{
                    label: 'Toplam (TL)', data: top5.map(([, v]) => v),
                    backgroundColor: 'rgba(37,99,235,0.7)', borderColor: '#2563eb',
                    borderWidth: 1, borderRadius: 6
                }]
            },
            options: {
                indexAxis: 'y', responsive: true,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => ' ' + new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(ctx.parsed.x) + ' ₺' } }
                },
                scales: { x: { beginAtZero: true, ticks: { callback: fmt } } }
            }
        });
    }

    // Chart 3 — Gelen vs Giden monthly (TL eşdeğeri)
    const gelen = {}, giden = {};
    last12.forEach(m => { gelen[m.key] = 0; giden[m.key] = 0; });
    all.forEach(inv => {
        if (!inv.invoice_date) return;
        const d = new Date(inv.invoice_date);
        const k = `${d.getFullYear()}-${d.getMonth()}`;
        if (!(k in gelen)) return;
        if (inv.direction === 'INCOMING') gelen[k] += toTl(inv);
        else if (inv.direction === 'OUTGOING') giden[k] += toTl(inv);
    });
    const c3 = document.getElementById('chartGelenGiden');
    if (c3) {
        _dashCharts.gg = new Chart(c3, {
            type: 'bar',
            data: {
                labels: last12.map(m => `${TR[m.month]}'${String(m.year).slice(2)}`),
                datasets: [
                    {
                        label: 'Gelen', data: last12.map(m => gelen[m.key]),
                        backgroundColor: 'rgba(249,115,22,0.7)', borderColor: '#f97316',
                        borderWidth: 1, borderRadius: 4
                    },
                    {
                        label: 'Giden', data: last12.map(m => giden[m.key]),
                        backgroundColor: 'rgba(168,85,247,0.7)', borderColor: '#a855f7',
                        borderWidth: 1, borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } } },
                scales: {
                    x: { ticks: { font: { size: 10 } } },
                    y: { beginAtZero: true, ticks: { callback: fmt } }
                }
            }
        });
    }
}

function openFaturaListModal() {
    setInteracted(true);
    renderCurrentView();
}

function closeFaturaListModal() {
    closeInvoiceDetailModal();
}

function loadInlinePdf(id) {
    const inv = (allInvoicesCache || []).find(i => i.id === id);
    if (!inv) return;
    currentDetailInvId = id;

    document.querySelectorAll('.invoice-card').forEach(c =>
        c.classList.toggle('active', c.dataset.invId === id)
    );

    const actionsEl = document.getElementById('fatPdfActions');
    if (actionsEl) {
        actionsEl.style.display = 'flex';
        const elNo   = document.getElementById('fatPdfInvNo');
        const elComp = document.getElementById('fatPdfCompany');
        const elSt   = document.getElementById('fatPdfStatus');
        if (elNo)   elNo.textContent   = inv.invoice_no || '-';
        if (elComp) elComp.textContent = inv.companies?.name || '-';
        if (elSt) {
            const ns = (inv.status || '').toLowerCase();
            const colors = {
                paid:    { bg: '#dcfce7', color: '#16a34a', label: 'Ödendi' },
                partial: { bg: '#fef3c7', color: '#d97706', label: 'Kısmi' },
            };
            const c = colors[ns] || { bg: '#fee2e2', color: '#ef4444', label: 'Ödenmedi' };
            elSt.innerHTML = `<span style="background:${c.bg}; color:${c.color}; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:700;">${c.label}</span>`;
        }
        const btnEdit = document.getElementById('btnEditInvoice');
        if (btnEdit) btnEdit.onclick = () => viewInvoice(id);
        const btnDel  = document.getElementById('btnDeleteInvoice');
        if (btnDel)  btnDel.onclick  = () => deleteInvoice(id);
        const btnPay  = document.getElementById('btnViewPayments');
        if (btnPay)  btnPay.onclick  = () => viewInvoiceDetails(id);
    }

    loadPdfTab();
}

// ─── Ürün dropdown ────────────────────────────────────────────────────────────

function _buildProductList() {
    if (!allInvoicesCache) return;
    const map = new Map();
    allInvoicesCache.forEach(inv => {
        (inv.invoice_items || []).forEach(item => {
            const code = String(item.product_code || item.sku || '').trim();
            const name = String(item.product_name || '').trim();
            if (!name && !code) return;
            const key = code || name;
            if (!map.has(key)) map.set(key, { code, name });
        });
    });
    _productList = [...map.values()].sort((a, b) =>
        (a.name || a.code).localeCompare(b.name || b.code, 'tr-TR')
    );
}

function _renderProductList(query) {
    const list = document.getElementById('productDropdownList');
    if (!list) return;
    const currentVal = document.getElementById('filterProduct')?.value || '';
    const filtered   = query
        ? _productList.filter(p => (p.name + ' ' + p.code).toLocaleLowerCase('tr-TR').includes(query))
        : _productList;

    list.innerHTML = '';
    const allLi = document.createElement('li');
    allLi.textContent = 'Tüm Ürünler';
    allLi.className   = 'all-option' + (currentVal === '' ? ' selected' : '');
    allLi.onclick     = () => _setProductValue('', 'Tüm Ürünler');
    list.appendChild(allLi);

    filtered.slice(0, 80).forEach(p => {
        const li      = document.createElement('li');
        const display = p.name || p.code;
        li.textContent = display;
        if (p.code && p.name && p.code !== p.name) li.title = p.code;
        if (currentVal === p.code || currentVal === p.name) li.classList.add('selected');
        li.onclick = () => _setProductValue(p.code || p.name, display);
        list.appendChild(li);
    });

    if (filtered.length === 0 && query) {
        const empty = document.createElement('li');
        empty.textContent = 'Sonuç bulunamadı';
        empty.style.cssText = 'color:#94a3b8; cursor:default; pointer-events:none;';
        list.appendChild(empty);
    }
}

function filterProductDropdown() {
    const q = (document.getElementById('productDropdownSearch')?.value || '').toLocaleLowerCase('tr-TR');
    _renderProductList(q);
}

function toggleProductDropdown() {
    const panel  = document.getElementById('productDropdownPanel');
    const search = document.getElementById('productDropdownSearch');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    if (isOpen) {
        _closeProductDropdown();
    } else {
        _buildProductList();
        panel.style.display = 'block';
        if (search) { search.value = ''; search.focus(); }
        _renderProductList('');
        setTimeout(() => document.addEventListener('click', _outsideProductClick), 0);
    }
}

function _closeProductDropdown() {
    const panel = document.getElementById('productDropdownPanel');
    if (panel) panel.style.display = 'none';
    document.removeEventListener('click', _outsideProductClick);
}

function _outsideProductClick(e) {
    const wrap = document.getElementById('productDropdownWrap');
    if (wrap && !wrap.contains(e.target)) _closeProductDropdown();
}

function _setProductValue(val, label) {
    const hidden = document.getElementById('filterProduct');
    const btn    = document.getElementById('productDropdownBtn');
    const lbl    = document.getElementById('productDropdownLabel');
    if (hidden) hidden.value    = val;
    if (lbl)    lbl.textContent = label || 'Tüm Ürünler';
    if (btn)    btn.style.color = val ? '#0f172a' : '#374151';
    _closeProductDropdown();
    setInteracted(true);
    if (isShowAll()) {
        setShowAll(false);
        const tog = document.getElementById('btnToggleShowAll');
        if (tog) tog.innerText = 'Tümünü Göster';
    }
    saveFilterState();
    renderCurrentView();
}

// ─── Firma dropdown ───────────────────────────────────────────────────────────

function populateCompanyFilter(invoices) {
    const hidden    = document.getElementById('filterCompany');
    const memoryVal = hidden ? hidden.getAttribute('data-memory') : null;
    const currentValue = memoryVal !== null ? memoryVal : (hidden ? hidden.value : '');
    if (hidden) hidden.removeAttribute('data-memory');

    _companyList = [...new Set(invoices.map(inv => inv.companies?.name).filter(Boolean))].sort();

    if (hidden && currentValue !== undefined) hidden.value = currentValue;
    const lbl     = document.getElementById('companyDropdownLabel');
    if (lbl) lbl.textContent = currentValue || 'Firmalar';
    const dropBtn = document.getElementById('companyDropdownBtn');
    if (dropBtn) dropBtn.style.color = currentValue ? '#0f172a' : '#374151';

    _renderCompanyList('');
}

function filterCompanyDropdown() {
    const q = (document.getElementById('companyDropdownSearch')?.value || '').toLocaleLowerCase('tr-TR');
    _renderCompanyList(q);
}

function _renderCompanyList(query) {
    const list = document.getElementById('companyDropdownList');
    if (!list) return;

    const currentVal = document.getElementById('filterCompany')?.value || '';
    const filtered   = query
        ? _companyList.filter(n =>
            n.toLocaleLowerCase('tr-TR').split(/\s+/).some(word => word.startsWith(query))
          )
        : _companyList;

    list.innerHTML = '';

    const allLi = document.createElement('li');
    allLi.textContent = 'Tüm Firmalar';
    allLi.className   = 'all-option' + (currentVal === '' ? ' selected' : '');
    allLi.onclick     = () => _setCompanyValue('');
    list.appendChild(allLi);

    filtered.forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        li.title       = name;
        if (name === currentVal) li.classList.add('selected');
        li.onclick = () => _setCompanyValue(name);
        list.appendChild(li);
    });

    if (filtered.length === 0 && query) {
        const empty = document.createElement('li');
        empty.textContent = 'Sonuç bulunamadı';
        empty.style.cssText = 'color:#94a3b8; cursor:default; pointer-events:none;';
        list.appendChild(empty);
    }
}

function _setCompanyValue(val) {
    const hidden = document.getElementById('filterCompany');
    const btn    = document.getElementById('companyDropdownBtn');
    const label  = document.getElementById('companyDropdownLabel');
    if (hidden) hidden.value    = val;
    if (label)  label.textContent = val || 'Firmalar';
    if (btn)    btn.style.color = val ? '#0f172a' : '#374151';
    _closeCompanyDropdown();
    setInteracted(true);
    if (isShowAll()) {
        setShowAll(false);
        const tog = document.getElementById('btnToggleShowAll');
        if (tog) tog.innerText = 'Tümünü Göster';
    }
    saveFilterState();
    renderCurrentView();
}

function toggleCompanyDropdown() {
    const panel  = document.getElementById('companyDropdownPanel');
    const search = document.getElementById('companyDropdownSearch');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    if (isOpen) {
        _closeCompanyDropdown();
    } else {
        panel.style.display = 'block';
        if (search) { search.value = ''; search.focus(); }
        _renderCompanyList('');
        setTimeout(() => document.addEventListener('click', _outsideCompanyClick), 0);
    }
}

function _closeCompanyDropdown() {
    const panel = document.getElementById('companyDropdownPanel');
    if (panel) panel.style.display = 'none';
    document.removeEventListener('click', _outsideCompanyClick);
}

function _outsideCompanyClick(e) {
    const wrap = document.getElementById('companyDropdownWrap');
    if (wrap && !wrap.contains(e.target)) _closeCompanyDropdown();
}

// ─── KPI bar ──────────────────────────────────────────────────────────────────

function renderKpiBar(invoices) {
    const el = document.getElementById('fatKpiBar');
    if (!el) return;

    const titleEl = document.getElementById('fatPageTitle');
    if (titleEl) titleEl.textContent = currentView === 'giden' ? 'Giden' : 'Gelen';

    if (!invoices || invoices.length === 0) { el.innerHTML = ''; return; }

    const fmtN    = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const isGelen = currentView === 'gelen';

    let usdTotal = 0, tryTotal = 0;
    invoices.forEach(inv => {
        const src  = invPayableAmountSrc(inv);
        const rate = invCalculationRate(inv);
        const isUSD = invBaseCurrencyIso(inv) !== 'TRY';
        if (isUSD) { usdTotal += src; tryTotal += src * rate; }
        else       { tryTotal += src; usdTotal += rate > 0 ? src / rate : 0; }
    });

    const usdLabel = isGelen ? 'HARCAMA (USD)' : 'CİRO (USD)';
    const tryLabel = isGelen ? 'HARCAMA (TL)'  : 'CİRO (TL)';

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
            <p class="fat-kpi-value">${invoices.length}</p>
        </div>
    `;
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

function switchFatTab(key) {
    activeTabKey = key;
    renderTabBar();
    renderFatContent();
}

function openInvoiceTab(id) {
    const inv = (allInvoicesCache || []).find(i => i.id === id);
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
    renderKpiBar(invoices);
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
        const total = formatMoneyDisplay(inv, invPayableAmountSrc(inv));
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
    const inv = (allInvoicesCache || []).find(i => i.id === id);
    if (!inv) return;

    _fatDetailIdx = _fatDetailList.findIndex(i => i.id === id);

    // Header
    const firmaEl = document.getElementById('fatDetailFirmaAdi');
    const prevBtn = document.getElementById('fatDetailPrevBtn');
    const nextBtn = document.getElementById('fatDetailNextBtn');
    if (firmaEl) firmaEl.textContent = inv.companies?.name || '—';
    if (prevBtn) prevBtn.disabled = _fatDetailIdx <= 0;
    if (nextBtn) nextBtn.disabled = _fatDetailIdx >= _fatDetailList.length - 1;

    // Sayfa geçişi
    const faturaPage  = document.getElementById('faturaPage');
    const detailPage  = document.getElementById('fatDetailPage');
    if (faturaPage)  faturaPage.style.display  = 'none';
    if (detailPage)  detailPage.style.display  = 'flex';

    // PDF sıfırla
    const iframe = document.getElementById('fatDetailPdfIframe');
    const empty  = document.getElementById('fatDetailPdfEmpty');
    if (iframe) { iframe.style.display = 'none'; iframe.src = ''; }
    if (empty)  empty.style.display = 'flex';

    // Tab bar
    const curTab = activeDetailTab[id] || 'bilgiler';
    const tabBar = document.getElementById('fatDetailTabBar');
    if (tabBar) {
        tabBar.innerHTML = ['bilgiler', 'urunler', 'odemeler'].map(t =>
            `<button class="fat-dtab${curTab === t ? ' fat-dtab--active' : ''}"
                onclick="switchFatDetailPageTab('${id}','${t}')">
                ${{ bilgiler: 'Fatura Bilgileri', urunler: 'Fatura Ürünleri', odemeler: 'Ödeme Kayıtları' }[t]}
            </button>`
        ).join('');
    }

    // İçerik
    const tabBody = document.getElementById('fatDetailTabBody');
    if (tabBody) {
        renderDetailTabContent(id, curTab, inv, tabBody);
    }

    // PDF yükle
    loadDetailPdfInto(id, inv,
        document.getElementById('fatDetailPdfIframe'),
        document.getElementById('fatDetailPdfEmpty')
    );
}

function closeFatDetailPage() {
    const faturaPage = document.getElementById('faturaPage');
    const detailPage = document.getElementById('fatDetailPage');
    if (detailPage) detailPage.style.display = 'none';
    if (faturaPage) faturaPage.style.display  = '';
}

function navigateFatDetail(dir) {
    const newIdx = _fatDetailIdx + dir;
    if (newIdx < 0 || newIdx >= _fatDetailList.length) return;
    openFatDetailPage(_fatDetailList[newIdx].id);
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

    filterMemory[currentView] = {
        search:   document.getElementById('mainSearch').value,
        company:  document.getElementById('filterCompany').value,
        currency: normalizeCurrencyCode(document.getElementById('filterCurrency').value),
        year:     document.getElementById('filterYear')  ? document.getElementById('filterYear').value  : '',
        month:    document.getElementById('filterMonth') ? document.getElementById('filterMonth').value : '',
        status:   document.getElementById('filterStatus') ? document.getElementById('filterStatus').value : ''
    };

    currentView = view;
    updateCompanyColumnHeader();
    updateActionButtonsTheme();

    const _togBtn = document.getElementById('btnToggleShowAll');
    if (_togBtn) _togBtn.innerText = isShowAll() ? 'Tümünü Gizle' : 'Tümünü Göster';

    const memory = filterMemory[currentView];
    document.getElementById('mainSearch').value    = memory.search;
    const rememberedCurrency = normalizeCurrencyCode(memory.currency);
    document.getElementById('filterCurrency').value = rememberedCurrency;
    if (document.getElementById('filterYear'))  document.getElementById('filterYear').value  = memory.year;
    if (document.getElementById('filterMonth')) document.getElementById('filterMonth').value = memory.month;
    if (document.getElementById('filterStatus')) document.getElementById('filterStatus').value = memory.status;

    document.getElementById('filterCompany').setAttribute('data-memory', memory.company);

    renderCurrentView();
}

function updateActionButtonsTheme() {
    document.body.setAttribute('data-view', currentView);
}
