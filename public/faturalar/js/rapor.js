// ─── Rapor Sayfası — Bağımsız JS ─────────────────────────────────────────────

let allInvoicesCache = null;
let raporMode = 'gelen';
let raporSort = { col: 'usd', dir: 'desc' };
let raporFilters = { company: '', dateStart: '', dateEnd: '', product: '' };
let _raporOpenDetailTr = null;
let _raporCompList = [];
let _raporProdList = [];

async function initRapor() {
    try {
        const res = await fetch('/api/invoices');
        if (!res.ok) throw new Error('Veriler çekilemedi');
        allInvoicesCache = await res.json();
        renderRaporPage();
    } catch (e) {
        console.error('Rapor yüklenemedi:', e);
    }
}

function setRaporMode(mode) {
    raporMode = mode;
    ['gelen', 'giden'].forEach(m => {
        const btn = document.getElementById('rTab' + m.charAt(0).toUpperCase() + m.slice(1));
        if (btn) btn.classList.toggle('rapor-mode-tab--active', m === mode);
    });
    raporSort = { col: 'usd', dir: 'desc' };
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
    renderRaporPage();
}

function renderRaporPage() {
    if (!allInvoicesCache) return;

    const dsEl = document.getElementById('raporFilterDateStart');
    const deEl = document.getElementById('raporFilterDateEnd');
    if (dsEl) raporFilters.dateStart = dsEl.value || '';
    if (deEl) raporFilters.dateEnd   = deEl.value || '';

    const all = allInvoicesCache;

    const source = all.filter(inv => {
        if (raporFilters.company) {
            if ((inv.companies?.name || '') !== raporFilters.company) return false;
        }
        if (raporFilters.dateStart || raporFilters.dateEnd) {
            const invDate = (inv.invoice_date || '').slice(0, 10);
            if (raporFilters.dateStart && invDate < raporFilters.dateStart) return false;
            if (raporFilters.dateEnd   && invDate > raporFilters.dateEnd)   return false;
        }
        return true;
    });

    const productMap = new Map();
    source.forEach(inv => {
        const rate  = invCalculationRate(inv);
        const isUSD = invBaseCurrencyIso(inv) !== 'TRY';
        (inv.invoice_items || []).forEach(item => {
            const code = String(item.product_code || item.sku || '').trim();
            const name = String(item.product_name || code || '').trim();
            if (!name || name.toUpperCase().includes('KARGO')) return;
            const key  = code || name;
            const qty  = parseFloat(item.quantity) || 0;
            const cur  = parseFloat(item.total_price_cur) || 0;
            const usd  = isUSD ? cur : (rate > 0 ? cur / rate : 0);
            const dir  = inv.direction;
            const comp = inv.companies?.name || 'Bilinmeyen';

            const prev = productMap.get(key) || {
                code, name, inQty: 0, outQty: 0, inUsd: 0, outUsd: 0,
                suppliers: new Map(), customers: new Map()
            };
            if (dir === 'INCOMING') {
                prev.inQty += qty; prev.inUsd += usd;
                const s = prev.suppliers.get(comp) || { qty: 0, usd: 0 };
                s.qty += qty; s.usd += usd; prev.suppliers.set(comp, s);
            } else {
                prev.outQty += qty; prev.outUsd += usd;
                const c = prev.customers.get(comp) || { qty: 0, usd: 0 };
                c.qty += qty; c.usd += usd; prev.customers.set(comp, c);
            }
            productMap.set(key, prev);
        });
    });

    const mainUsdOf = p => raporMode === 'giden' ? p.outUsd : p.inUsd;
    const colFn = {
        name:   p => p.name.toLowerCase(),
        inQty:  p => p.inQty,
        outQty: p => p.outQty,
        usd:    p => mainUsdOf(p),
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
        const fa = colFn[raporSort.col](a);
        const fb = colFn[raporSort.col](b);
        const cmp = typeof fa === 'string' ? fa.localeCompare(fb, 'tr') : fa - fb;
        return raporSort.dir === 'asc' ? cmp : -cmp;
    });

    const fmtN   = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtInt = n => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
    const fmtUsd = n => '$' + fmtInt(n);

    const totalInQty  = products.reduce((s, p) => s + p.inQty,  0);
    const totalOutQty = products.reduce((s, p) => s + p.outQty, 0);
    const totalUsd    = products.reduce((s, p) => s + mainUsdOf(p), 0);
    const usdLabel    = raporMode === 'giden' ? 'CİRO USD' : 'HARCAMA USD';

    const modeInvoices   = raporMode === 'giden'
        ? all.filter(i => i.direction === 'OUTGOING')
        : all.filter(i => i.direction === 'INCOMING');
    const modeCompLabel  = raporMode === 'giden' ? 'MÜŞTERİ' : 'TEDARİKÇİ';
    const uniqueCompsMode = new Set(modeInvoices.map(i => i.companies?.name).filter(Boolean)).size;

    document.getElementById('raporKpis').innerHTML = `
        <div class="rapor-kpi"><p class="rapor-kpi-label">FATURA</p><p class="rapor-kpi-value">${fmtInt(modeInvoices.length)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">${modeCompLabel}</p><p class="rapor-kpi-value">${fmtInt(uniqueCompsMode)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">ALINAN ADET</p><p class="rapor-kpi-value">${fmtInt(totalInQty)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">SATILAN ADET</p><p class="rapor-kpi-value">${fmtInt(totalOutQty)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">${usdLabel}</p><p class="rapor-kpi-value" style="color:#2563eb;">${fmtUsd(totalUsd)}</p></div>`;

    function thHtml(col, label, extraCls = '') {
        const isActive = raporSort.col === col;
        const arrow = isActive ? `<span class="rapor-th-arrow">${raporSort.dir === 'asc' ? '↑' : '↓'}</span>` : '';
        const cls = `rapor-th${extraCls ? ' ' + extraCls : ''}${isActive ? ' rapor-th--active' : ''}`;
        return `<th class="${cls}" onclick="raporSortBy('${col}')">${label}${arrow}</th>`;
    }

    document.getElementById('raporThead').innerHTML = `<tr>
        ${thHtml('name',   'Ürün')}
        ${thHtml('inQty',  'Alınan',  'rapor-th-num')}
        ${thHtml('outQty', 'Satılan', 'rapor-th-num')}
        ${thHtml('usd',    usdLabel,  'rapor-th-num')}
    </tr>`;

    const tbody = document.getElementById('raporTbody');
    tbody.innerHTML = '';
    _raporOpenDetailTr = null;
    const colSpan = 4;

    products.forEach(prod => {
        const mUsd      = mainUsdOf(prod);
        const compMap   = raporMode === 'giden' ? prod.customers : prod.suppliers;
        const compList  = [...compMap.entries()].sort((a, b) => b[1].usd - a[1].usd);
        const totalPct  = mUsd || 1;
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
            <td class="rapor-td rapor-td-num rapor-td-money">$${fmtN(mUsd)}</td>`;

        const compRowsHtml = compList.map(([cname, data]) => {
            const pct = ((data.usd / totalPct) * 100).toFixed(1);
            return `<tr class="rapor-comp-row">
                <td class="rapor-comp-td">${cname}</td>
                <td class="rapor-comp-td rapor-comp-num">${fmtInt(data.qty)}</td>
                <td class="rapor-comp-td rapor-comp-num">$${fmtN(data.usd)}</td>
                <td class="rapor-bar-cell">
                    <div class="rapor-bar-wrap">
                        <div class="rapor-bar-track"><div class="rapor-bar-fill" style="width:${pct}%"></div></div>
                        <span class="rapor-bar-pct">%${pct}</span>
                    </div>
                </td>
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
                    <th class="rapor-comp-th rapor-comp-num">USD</th>
                    <th class="rapor-comp-th rapor-comp-num">PAY</th>
                </tr></thead>
                <tbody>${compRowsHtml || '<tr><td colspan="4" style="padding:10px 20px; color:#94a3b8; font-size:12px;">Veri yok</td></tr>'}</tbody>
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
    if (!allInvoicesCache) return;
    const dir = raporMode === 'giden' ? 'OUTGOING' : 'INCOMING';
    _raporCompList = [...new Set(
        allInvoicesCache
            .filter(inv => inv.direction === dir)
            .map(inv => inv.companies?.name)
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'tr-TR'));
}

function toggleRaporCompDropdown() {
    const panel  = document.getElementById('raporCompDropPanel');
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
    if (!allInvoicesCache) return;
    const dir = raporMode === 'giden' ? 'OUTGOING' : 'INCOMING';
    const map = new Map();
    allInvoicesCache
        .filter(inv => inv.direction === dir)
        .forEach(inv => {
            (inv.invoice_items || []).forEach(item => {
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
    const panel  = document.getElementById('raporProdDropPanel');
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

document.addEventListener('DOMContentLoaded', initRapor);
