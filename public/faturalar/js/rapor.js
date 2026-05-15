// ─── Rapor Sayfası — Bağımsız JS ─────────────────────────────────────────────

let allInvoicesCache = null;
let raporMode = 'gelen';
let raporSort = { col: 'try', dir: 'desc' };
let raporFilters = { company: '', dateStart: '', dateEnd: '', product: '' };
let _raporOpenDetailTr = null;
let _raporCompList = [];
let _raporProdList = [];

let ofisInvoicesCache = null;

async function initRapor() {
    try {
        const [res, resOfis] = await Promise.all([
            fetch('/api/invoices'),
            fetch('/api/invoices/ofis-ici')
        ]);
        if (!res.ok) throw new Error('Veriler çekilemedi');
        allInvoicesCache = await res.json();
        ofisInvoicesCache = resOfis.ok ? await resOfis.json() : [];
        renderRaporPage();
    } catch (e) {
        console.error('Rapor yüklenemedi:', e);
    }
}

function setRaporMode(mode) {
    const prevMode = raporMode;
    raporMode = mode;
    ['gelen', 'giden', 'ofis'].forEach(m => {
        const btn = document.getElementById('rTab' + m.charAt(0).toUpperCase() + m.slice(1));
        if (btn) btn.classList.toggle('rapor-mode-tab--active', m === mode);
    });
    raporSort = { col: 'try', dir: 'desc' };

    const switchingToOfis   = mode === 'ofis';
    const switchingFromOfis = prevMode === 'ofis';
    if (switchingToOfis || switchingFromOfis) {
        raporFilters.company = '';
        raporFilters.product = '';
        const lbl1 = document.getElementById('raporCompDropLabel');
        if (lbl1) lbl1.textContent = 'Tüm Firmalar';
        const btn1 = document.getElementById('raporCompDropBtn');
        if (btn1) btn1.style.color = '#374151';
        const lbl2 = document.getElementById('raporProdDropLabel');
        if (lbl2) lbl2.textContent = 'Tüm Ürünler';
        const btn2 = document.getElementById('raporProdDropBtn');
        if (btn2) btn2.style.color = '#374151';
    }

    renderRaporPage();
}

function renderRaporPage() {
    if (raporMode === 'ofis') { renderRaporOfisPage(); return; }
    if (!allInvoicesCache) return;

    const dsEl = document.getElementById('raporFilterDateStart');
    const deEl = document.getElementById('raporFilterDateEnd');
    if (dsEl) raporFilters.dateStart = dsEl.value || '';
    if (deEl) raporFilters.dateEnd = deEl.value || '';

    const all = allInvoicesCache;

    const source = all.filter(inv => {
        if (raporFilters.company) {
            if ((inv.companies?.name || '') !== raporFilters.company) return false;
        }
        if (raporFilters.dateStart || raporFilters.dateEnd) {
            const invDate = (inv.invoice_date || '').slice(0, 10);
            if (raporFilters.dateStart && invDate < raporFilters.dateStart) return false;
            if (raporFilters.dateEnd && invDate > raporFilters.dateEnd) return false;
        }
        return true;
    });

    const productMap = new Map();
    source.forEach(inv => {
        const rate = invCalculationRate(inv);
        (inv.invoice_items || []).forEach(item => {
            const code = String(item.product_code || item.sku || '').trim();
            const name = String(item.product_name || code || '').trim();
            if (!name || name.toUpperCase().includes('KARGO')) return;
            const key = code || name;
            const qty = parseFloat(item.quantity) || 0;
            const itemCurrency = normalizeCurrencyCode(item.currency || inv.currency);
            const tutar = (parseFloat(item.unit_price_cur) || 0) * qty * (1 + (parseFloat(item.tax_rate) || 0) / 100);
            const isTRY = itemCurrency === 'TRY';
            const amountTry = isTRY ? tutar : 0;
            const amountUsd = isTRY ? 0 : tutar;
            const dir = inv.direction;
            const comp = inv.companies?.name || 'Bilinmeyen';

            const prev = productMap.get(key) || {
                code, name,
                inQty: 0, outQty: 0,
                inTry: 0, outTry: 0,
                inUsd: 0, outUsd: 0,
                suppliers: new Map(), customers: new Map()
            };
            if (dir === 'INCOMING') {
                prev.inQty += qty;
                prev.inTry += amountTry;
                prev.inUsd += amountUsd;
                const s = prev.suppliers.get(comp) || { qty: 0, try: 0, usd: 0 };
                s.qty += qty; s.try += amountTry; s.usd += amountUsd;
                prev.suppliers.set(comp, s);
            } else {
                prev.outQty += qty;
                prev.outTry += amountTry;
                prev.outUsd += amountUsd;
                const c = prev.customers.get(comp) || { qty: 0, try: 0, usd: 0 };
                c.qty += qty; c.try += amountTry; c.usd += amountUsd;
                prev.customers.set(comp, c);
            }
            productMap.set(key, prev);
        });
    });

    const mainTryOf = p => raporMode === 'giden' ? p.outTry : p.inTry;
    const mainUsdOf = p => raporMode === 'giden' ? p.outUsd : p.inUsd;

    const colFn = {
        name: p => p.name.toLowerCase(),
        inQty: p => p.inQty,
        outQty: p => p.outQty,
        try: p => mainTryOf(p),
        usd: p => mainUsdOf(p),
    };
    let products = [...productMap.values()];

    if (raporFilters.product) {
        const pf = raporFilters.product.toLocaleLowerCase('tr-TR');
        products = products.filter(p =>
            p.name.toLocaleLowerCase('tr-TR').includes(pf) ||
            p.code.toLocaleLowerCase('tr-TR').includes(pf)
        );
    }

    products.sort((a, b) => {
        const fa = colFn[raporSort.col] ? colFn[raporSort.col](a) : mainTryOf(a);
        const fb = colFn[raporSort.col] ? colFn[raporSort.col](b) : mainTryOf(b);
        const cmp = typeof fa === 'string' ? fa.localeCompare(fb, 'tr') : fa - fb;
        return raporSort.dir === 'asc' ? cmp : -cmp;
    });

    const fmtN = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtInt = n => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 });

    const totalInQty = products.reduce((s, p) => s + p.inQty, 0);
    const totalOutQty = products.reduce((s, p) => s + p.outQty, 0);
    const totalTry = products.reduce((s, p) => s + mainTryOf(p), 0);
    const totalUsd = products.reduce((s, p) => s + mainUsdOf(p), 0);

    const modeInvoices = raporMode === 'giden'
        ? all.filter(i => i.direction === 'OUTGOING')
        : all.filter(i => i.direction === 'INCOMING');
    const modeCompLabel = raporMode === 'giden' ? 'MÜŞTERİ' : 'TEDARİKÇİ';
    const tryLabel = raporMode === 'giden' ? 'CİRO TL' : 'HARCAMA TL';
    const usdLabel = raporMode === 'giden' ? 'CİRO USD' : 'HARCAMA USD';
    const uniqueCompsMode = new Set(modeInvoices.map(i => i.companies?.name).filter(Boolean)).size;

    document.getElementById('raporKpis').innerHTML = `
        <div class="rapor-kpi"><p class="rapor-kpi-label">FATURA</p><p class="rapor-kpi-value">${fmtInt(modeInvoices.length)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">${modeCompLabel}</p><p class="rapor-kpi-value">${fmtInt(uniqueCompsMode)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">ALINAN ADET</p><p class="rapor-kpi-value">${fmtInt(totalInQty)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">SATILAN ADET</p><p class="rapor-kpi-value">${fmtInt(totalOutQty)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">${tryLabel}</p><p class="rapor-kpi-value" style="color:#0f172a;">₺${fmtN(totalTry)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">${usdLabel}</p><p class="rapor-kpi-value" style="color:#2563eb;">$${fmtN(totalUsd)}</p></div>`;

    function thHtml(col, label, extraCls = '') {
        const isActive = raporSort.col === col;
        const arrow = isActive ? `<span class="rapor-th-arrow">${raporSort.dir === 'asc' ? '↑' : '↓'}</span>` : '';
        const cls = `rapor-th${extraCls ? ' ' + extraCls : ''}${isActive ? ' rapor-th--active' : ''}`;
        return `<th class="${cls}" onclick="raporSortBy('${col}')">${label}${arrow}</th>`;
    }

    document.getElementById('raporThead').innerHTML = `<tr>
        ${thHtml('name', 'Ürün')}
        ${thHtml('inQty', 'Alınan', 'rapor-th-num')}
        ${thHtml('outQty', 'Satılan', 'rapor-th-num')}
        ${thHtml('try', tryLabel, 'rapor-th-num')}
        ${thHtml('usd', usdLabel, 'rapor-th-num')}
    </tr>`;

    const tbody = document.getElementById('raporTbody');
    tbody.innerHTML = '';
    _raporOpenDetailTr = null;
    const colSpan = 5;

    products.forEach(prod => {
        const mTry = mainTryOf(prod);
        const mUsd = mainUsdOf(prod);
        const compMap = raporMode === 'giden' ? prod.customers : prod.suppliers;
        const compList = [...compMap.entries()].sort((a, b) => b[1].try - a[1].try);
        const totalPctTry = mTry || 1;
        const compLabel2 = raporMode === 'giden' ? 'MÜŞTERİ' : 'TEDARİKÇİ';

        const tr = document.createElement('tr');
        tr.className = 'rapor-row';
        tr.innerHTML = `
            <td class="rapor-td rapor-td-name">
                <span class="rapor-chevron">›</span>
                <span>
                    <span class="rapor-prod-name">${prod.name}</span>
                    ${prod.code && prod.code !== prod.name ? `<span class="rapor-prod-code">${prod.code}</span>` : ''}
                </span>
            </td>
            <td class="rapor-td rapor-td-num">${fmtInt(prod.inQty)}</td>
            <td class="rapor-td rapor-td-num">${fmtInt(prod.outQty)}</td>
            <td class="rapor-td rapor-td-num rapor-td-money-try">${mTry > 0 ? '₺' + fmtN(mTry) : '—'}</td>
            <td class="rapor-td rapor-td-num rapor-td-money">${mUsd > 0 ? '$' + fmtN(mUsd) : '—'}</td>`;

        const compRowsHtml = compList.map(([cname, data]) => {
            const birimFiyat = data.try > 0
                ? '₺' + fmtN(data.try / data.qty)
                : '$' + fmtN(data.usd / data.qty);
            return `<tr class="rapor-comp-row">
        <td class="rapor-comp-td">${cname}</td>
        <td class="rapor-comp-td rapor-comp-num">${fmtInt(data.qty)}</td>
        <td class="rapor-comp-td rapor-comp-num">${birimFiyat}</td>
        <td class="rapor-comp-td rapor-comp-num">${data.try > 0 ? '₺' + fmtN(data.try) : '—'}</td>
        <td class="rapor-comp-td rapor-comp-num">${data.usd > 0 ? '$' + fmtN(data.usd) : '—'}</td>
    </tr>`;
        }).join('');

        const detailTr = document.createElement('tr');
        detailTr.className = 'rapor-detail-row';
        detailTr.style.display = 'none';
        detailTr.innerHTML = `<td colspan="${colSpan}" class="rapor-detail-cell">
            <table class="rapor-comp-tbl">
                <thead><tr class="rapor-comp-head">
                    <th class="rapor-comp-th">${compLabel2}</th>
                    <th class="rapor-comp-th rapor-comp-num">ADET</th>
                    <th class="rapor-comp-th rapor-comp-num">BİRİM FİYAT</th>
                    <th class="rapor-comp-th rapor-comp-num">TL</th>
                    <th class="rapor-comp-th rapor-comp-num">USD</th>
                </tr></thead>
                <tbody>${compRowsHtml || '<tr><td colspan="5" style="padding:10px 20px; color:#94a3b8; font-size:12px;">Veri yok</td></tr>'}</tbody>
            </table>
        </td>`;

        tr.onclick = () => {
            if (_raporOpenDetailTr && _raporOpenDetailTr !== detailTr) {
                _raporOpenDetailTr.style.display = 'none';
                _raporOpenDetailTr.previousElementSibling?.querySelector('.rapor-chevron')?.classList.remove('open');
                _raporOpenDetailTr.previousElementSibling?.classList.remove('rapor-row--open');
            }
            const isOpen = detailTr.style.display !== 'none';
            detailTr.style.display = isOpen ? 'none' : 'table-row';
            tr.querySelector('.rapor-chevron')?.classList.toggle('open', !isOpen);
            tr.classList.toggle('rapor-row--open', !isOpen);
            _raporOpenDetailTr = isOpen ? null : detailTr;
        };

        tbody.appendChild(tr);
        tbody.appendChild(detailTr);
    });
}

function raporSortBy(col) {
    raporSort = {
        col,
        dir: raporSort.col === col ? (raporSort.dir === 'asc' ? 'desc' : 'asc') : (col === 'name' ? 'asc' : 'desc')
    };
    renderRaporPage();
}

// ─── Firma Dropdown ───────────────────────────────────────────────────────────
function _buildRaporCompList() {
    const source = raporMode === 'ofis' ? ofisInvoicesCache : allInvoicesCache;
    if (!source) return;
    const dir = raporMode === 'giden' ? 'OUTGOING' : 'INCOMING';
    _raporCompList = [...new Set(
        source
            .filter(inv => raporMode === 'ofis' ? true : inv.direction === dir)
            .map(inv => inv.companies?.name)
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'tr-TR'));
}

function toggleRaporCompDropdown() {
    const panel = document.getElementById('raporCompDropPanel');
    const search = document.getElementById('raporCompDropSearch');
    if (!panel) return;
    if (panel.style.display !== 'none') {
        _closeRaporCompDropdown();
    } else {
        _buildRaporCompList();
        panel.style.display = 'block';
        if (search) { search.value = ''; search.focus(); }
        _renderRaporCompList('');
        setTimeout(() => document.addEventListener('click', _outsideRaporCompClick), 0);
    }
}

function _closeRaporCompDropdown() {
    const panel = document.getElementById('raporCompDropPanel');
    if (panel) panel.style.display = 'none';
    document.removeEventListener('click', _outsideRaporCompClick);
}

function _outsideRaporCompClick(e) {
    const wrap = document.getElementById('raporCompDropWrap');
    if (wrap && !wrap.contains(e.target)) _closeRaporCompDropdown();
}

function filterRaporCompDropdown() {
    const q = (document.getElementById('raporCompDropSearch')?.value || '').toLocaleLowerCase('tr-TR');
    _renderRaporCompList(q);
}

function _renderRaporCompList(query) {
    const list = document.getElementById('raporCompDropList');
    if (!list) return;
    const currentVal = raporFilters.company;
    const filtered = query
        ? _raporCompList.filter(n => n.toLocaleLowerCase('tr-TR').includes(query))
        : _raporCompList;

    list.innerHTML = '';
    const allLi = document.createElement('li');
    allLi.textContent = 'Tüm Firmalar';
    allLi.className = 'all-option' + (!currentVal ? ' selected' : '');
    allLi.onclick = () => _setRaporCompValue('');
    list.appendChild(allLi);

    filtered.slice(0, 80).forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        if (currentVal === name) li.classList.add('selected');
        li.onclick = () => _setRaporCompValue(name);
        list.appendChild(li);
    });

    if (filtered.length === 0 && query) {
        const empty = document.createElement('li');
        empty.textContent = 'Sonuç bulunamadı';
        empty.style.cssText = 'color:#94a3b8; cursor:default; pointer-events:none;';
        list.appendChild(empty);
    }
}

function _setRaporCompValue(val) {
    raporFilters.company = val;
    const lbl = document.getElementById('raporCompDropLabel');
    if (lbl) lbl.textContent = val || 'Tüm Firmalar';
    const btn = document.getElementById('raporCompDropBtn');
    if (btn) btn.style.color = val ? '#0f172a' : '#374151';
    _closeRaporCompDropdown();
    renderRaporPage();
}

// ─── Ürün Dropdown ────────────────────────────────────────────────────────────
function _buildRaporProdList() {
    const source = raporMode === 'ofis' ? ofisInvoicesCache : allInvoicesCache;
    if (!source) return;
    const dir = raporMode === 'giden' ? 'OUTGOING' : 'INCOMING';
    const map = new Map();
    source
        .filter(inv => raporMode === 'ofis' ? true : inv.direction === dir)
        .forEach(inv => {
            (inv.invoice_items || []).forEach(item => {
                if (raporMode === 'ofis' && !item.is_internal) return;
                const code = String(item.product_code || item.sku || '').trim();
                const name = String(item.product_name || '').trim();
                if (!name && !code) return;
                const key = code || name;
                if (!map.has(key)) map.set(key, { code, name });
            });
        });
    _raporProdList = [...map.values()].sort((a, b) =>
        (a.name || a.code).localeCompare(b.name || b.code, 'tr-TR')
    );
}

function toggleRaporProdDropdown() {
    const panel = document.getElementById('raporProdDropPanel');
    const search = document.getElementById('raporProdDropSearch');
    if (!panel) return;
    if (panel.style.display !== 'none') {
        _closeRaporProdDropdown();
    } else {
        _buildRaporProdList();
        panel.style.display = 'block';
        if (search) { search.value = ''; search.focus(); }
        _renderRaporProdList('');
        setTimeout(() => document.addEventListener('click', _outsideRaporProdClick), 0);
    }
}

function _closeRaporProdDropdown() {
    const panel = document.getElementById('raporProdDropPanel');
    if (panel) panel.style.display = 'none';
    document.removeEventListener('click', _outsideRaporProdClick);
}

function _outsideRaporProdClick(e) {
    const wrap = document.getElementById('raporProdDropWrap');
    if (wrap && !wrap.contains(e.target)) _closeRaporProdDropdown();
}

function filterRaporProdDropdown() {
    const q = (document.getElementById('raporProdDropSearch')?.value || '').toLocaleLowerCase('tr-TR');
    _renderRaporProdList(q);
}

function _renderRaporProdList(query) {
    const list = document.getElementById('raporProdDropList');
    if (!list) return;
    const currentVal = raporFilters.product;
    const filtered = query
        ? _raporProdList.filter(p => (p.name + ' ' + p.code).toLocaleLowerCase('tr-TR').includes(query))
        : _raporProdList;

    list.innerHTML = '';
    const allLi = document.createElement('li');
    allLi.textContent = 'Tüm Ürünler';
    allLi.className = 'all-option' + (!currentVal ? ' selected' : '');
    allLi.onclick = () => _setRaporProdValue('', 'Tüm Ürünler');
    list.appendChild(allLi);

    filtered.slice(0, 80).forEach(p => {
        const li = document.createElement('li');
        const display = p.name || p.code;
        li.textContent = display;
        if (p.code && p.name && p.code !== p.name) li.title = p.code;
        if (currentVal === (p.code || p.name)) li.classList.add('selected');
        li.onclick = () => _setRaporProdValue(p.code || p.name, display);
        list.appendChild(li);
    });

    if (filtered.length === 0 && query) {
        const empty = document.createElement('li');
        empty.textContent = 'Sonuç bulunamadı';
        empty.style.cssText = 'color:#94a3b8; cursor:default; pointer-events:none;';
        list.appendChild(empty);
    }
}

function _setRaporProdValue(val, label) {
    raporFilters.product = val;
    const lbl = document.getElementById('raporProdDropLabel');
    if (lbl) lbl.textContent = label || 'Tüm Ürünler';
    const btn = document.getElementById('raporProdDropBtn');
    if (btn) btn.style.color = val ? '#0f172a' : '#374151';
    _closeRaporProdDropdown();
    renderRaporPage();
}

function clearRaporFilters() {
    raporFilters = { company: '', dateStart: '', dateEnd: '', product: '' };
    const ds = document.getElementById('raporFilterDateStart');
    const de = document.getElementById('raporFilterDateEnd');
    if (ds) ds.value = '';
    if (de) de.value = '';
    const compLbl = document.getElementById('raporCompDropLabel');
    if (compLbl) compLbl.textContent = 'Tüm Firmalar';
    const compBtn = document.getElementById('raporCompDropBtn');
    if (compBtn) compBtn.style.color = '#374151';
    const prodLbl = document.getElementById('raporProdDropLabel');
    if (prodLbl) prodLbl.textContent = 'Tüm Ürünler';
    const prodBtn = document.getElementById('raporProdDropBtn');
    if (prodBtn) prodBtn.style.color = '#374151';
    renderRaporPage();
}


function renderRaporOfisPage() {
    if (!ofisInvoicesCache) return;

    const all = ofisInvoicesCache;

    const source = all.filter(inv => {
        if (raporFilters.company) {
            if ((inv.companies?.name || '') !== raporFilters.company) return false;
        }
        if (raporFilters.dateStart || raporFilters.dateEnd) {
            const invDate = (inv.invoice_date || '').slice(0, 10);
            if (raporFilters.dateStart && invDate < raporFilters.dateStart) return false;
            if (raporFilters.dateEnd && invDate > raporFilters.dateEnd) return false;
        }
        return true;
    });

    const productMap = new Map();
    source.forEach(inv => {
        const rate = invCalculationRate(inv);
        (inv.invoice_items || []).forEach(item => {
            if (!item.is_internal) return;
            const code = String(item.product_code || '').trim();
            const name = String(item.product_name || code || '').trim();
            if (!name) return;
            const key = code || name;
            const qty = parseFloat(item.quantity) || 0;
            const itemCurrency = normalizeCurrencyCode(item.currency || inv.currency);
            const tutar = (parseFloat(item.unit_price_cur) || 0) * qty * (1 + (parseFloat(item.tax_rate) || 0) / 100);
            const isTRY = itemCurrency === 'TRY';
            const amountTry = isTRY ? tutar : 0;
            const amountUsd = isTRY ? 0 : tutar;
            const comp = inv.companies?.name || 'Bilinmeyen';
            const cat = item.internal_category || 'diğer';

            const prev = productMap.get(key) || {
                code, name, cat, inQty: 0, inTry: 0, inUsd: 0,
                suppliers: new Map()
            };
            prev.inQty += qty;
            prev.inTry += amountTry;
            prev.inUsd += amountUsd;
            const s = prev.suppliers.get(comp) || { qty: 0, try: 0, usd: 0 };
            s.qty += qty; s.try += amountTry; s.usd += amountUsd;
            prev.suppliers.set(comp, s);
            productMap.set(key, prev);
        });
    });

    let products = [...productMap.values()];

    if (raporFilters.product) {
        const pf = raporFilters.product.toLocaleLowerCase('tr-TR');
        products = products.filter(p =>
            p.name.toLocaleLowerCase('tr-TR').includes(pf) ||
            p.code.toLocaleLowerCase('tr-TR').includes(pf)
        );
    }

    const colFn = {
        name: p => p.name.toLowerCase(),
        inQty: p => p.inQty,
        try: p => p.inTry,
        usd: p => p.inUsd,
    };

    products.sort((a, b) => {
        const fa = colFn[raporSort.col] ? colFn[raporSort.col](a) : a.inTry;
        const fb = colFn[raporSort.col] ? colFn[raporSort.col](b) : b.inTry;
        const cmp = typeof fa === 'string' ? fa.localeCompare(fb, 'tr') : fa - fb;
        return raporSort.dir === 'asc' ? cmp : -cmp;
    });

    const fmtN = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtInt = n => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 });

    const totalQty = products.reduce((s, p) => s + p.inQty, 0);
    const totalTry = products.reduce((s, p) => s + p.inTry, 0);
    const totalUsd = products.reduce((s, p) => s + p.inUsd, 0);
    const uniqueSuppliers = new Set(
        source.map(inv => inv.companies?.name).filter(Boolean)
    ).size;

    document.getElementById('raporKpis').innerHTML = `
        <div class="rapor-kpi"><p class="rapor-kpi-label">FATURA</p><p class="rapor-kpi-value">${fmtInt(source.length)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">TEDARİKÇİ</p><p class="rapor-kpi-value">${fmtInt(uniqueSuppliers)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">ALINAN ADET</p><p class="rapor-kpi-value">${fmtInt(totalQty)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">HARCAMA TL</p><p class="rapor-kpi-value" style="color:#0f172a;">₺${fmtN(totalTry)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">HARCAMA USD</p><p class="rapor-kpi-value" style="color:#2563eb;">$${fmtN(totalUsd)}</p></div>`;

    function thHtml(col, label, extraCls = '') {
        const isActive = raporSort.col === col;
        const arrow = isActive ? `<span class="rapor-th-arrow">${raporSort.dir === 'asc' ? '↑' : '↓'}</span>` : '';
        const cls = `rapor-th${extraCls ? ' ' + extraCls : ''}${isActive ? ' rapor-th--active' : ''}`;
        return `<th class="${cls}" onclick="raporSortBy('${col}')">${label}${arrow}</th>`;
    }

    document.getElementById('raporThead').innerHTML = `<tr>
        ${thHtml('name', 'Ürün')}
        ${thHtml('inQty', 'Alınan', 'rapor-th-num')}
        ${thHtml('try', 'HARCAMA TL', 'rapor-th-num')}
        ${thHtml('usd', 'HARCAMA USD', 'rapor-th-num')}
    </tr>`;

    const tbody = document.getElementById('raporTbody');
    tbody.innerHTML = '';
    _raporOpenDetailTr = null;

    products.forEach(prod => {
        const compList = [...prod.suppliers.entries()].sort((a, b) => b[1].try - a[1].try);
        const totalPctTry = prod.inTry || 1;

        const tr = document.createElement('tr');
        tr.className = 'rapor-row';
        tr.innerHTML = `
            <td class="rapor-td rapor-td-name">
                <span class="rapor-chevron">›</span>
                <span>
                    <span class="rapor-prod-name">${prod.name}</span>
                    ${prod.code && prod.code !== prod.name ? `<span class="rapor-prod-code">${prod.code}</span>` : ''}
                </span>
            </td>
            <td class="rapor-td rapor-td-num">${fmtInt(prod.inQty)}</td>
            <td class="rapor-td rapor-td-num rapor-td-money-try">${prod.inTry > 0 ? '₺' + fmtN(prod.inTry) : '—'}</td>
            <td class="rapor-td rapor-td-num rapor-td-money">${prod.inUsd > 0 ? '$' + fmtN(prod.inUsd) : '—'}</td>`;

        const compRowsHtml = compList.map(([cname, data]) => {
            const birimFiyat = data.try > 0
                ? '₺' + fmtN(data.try / data.qty)
                : '$' + fmtN(data.usd / data.qty);
            return `<tr class="rapor-comp-row">
        <td class="rapor-comp-td">${cname}</td>
        <td class="rapor-comp-td rapor-comp-num">${fmtInt(data.qty)}</td>
        <td class="rapor-comp-td rapor-comp-num">${birimFiyat}</td>
        <td class="rapor-comp-td rapor-comp-num">${data.try > 0 ? '₺' + fmtN(data.try) : '—'}</td>
        <td class="rapor-comp-td rapor-comp-num">${data.usd > 0 ? '$' + fmtN(data.usd) : '—'}</td>
    </tr>`;
        }).join('');

        const detailTr = document.createElement('tr');
        detailTr.className = 'rapor-detail-row';
        detailTr.style.display = 'none';
        detailTr.innerHTML = `<td colspan="4" class="rapor-detail-cell">
            <table class="rapor-comp-tbl">
                <thead><tr class="rapor-comp-head">
                    <th class="rapor-comp-th">TEDARİKÇİ</th>
                    <th class="rapor-comp-th rapor-comp-num">ADET</th>
                    <th class="rapor-comp-th rapor-comp-num">BİRİM FİYAT</th>
                    <th class="rapor-comp-th rapor-comp-num">TL</th>
                    <th class="rapor-comp-th rapor-comp-num">USD</th>
                </tr></thead>
                <tbody>${compRowsHtml || '<tr><td colspan="5" style="padding:10px 20px; color:#94a3b8; font-size:12px;">Veri yok</td></tr>'}</tbody>
            </table>
        </td>`;

        tr.onclick = () => {
            if (_raporOpenDetailTr && _raporOpenDetailTr !== detailTr) {
                _raporOpenDetailTr.style.display = 'none';
                _raporOpenDetailTr.previousElementSibling?.querySelector('.rapor-chevron')?.classList.remove('open');
                _raporOpenDetailTr.previousElementSibling?.classList.remove('rapor-row--open');
            }
            const isOpen = detailTr.style.display !== 'none';
            detailTr.style.display = isOpen ? 'none' : 'table-row';
            tr.querySelector('.rapor-chevron')?.classList.toggle('open', !isOpen);
            tr.classList.toggle('rapor-row--open', !isOpen);
            _raporOpenDetailTr = isOpen ? null : detailTr;
        };

        tbody.appendChild(tr);
        tbody.appendChild(detailTr);
    });
}


document.addEventListener('DOMContentLoaded', initRapor);