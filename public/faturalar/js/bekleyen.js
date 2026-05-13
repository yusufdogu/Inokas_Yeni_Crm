// ─── Bekleyen Faturalar Sayfası — Bağımsız JS ────────────────────────────────

async function initBekleyen() {
    setBekDir('gelen');
    await loadBekleyenInvoices();
}

async function loadBekleyenInvoices() {
    const tbody = document.getElementById('bekTbody');
    if (tbody) tbody.innerHTML = '<div class="bek-empty">Yükleniyor…</div>';
    try {
        const res = await fetch('/api/invoices/pending');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        bekleyenCache = await res.json();
    } catch (e) {
        bekleyenCache = [];
        if (tbody) tbody.innerHTML = `<div class="bek-empty">Yüklenemedi: ${e.message}</div>`;
        return;
    }
    activeBekId = null;
    _bekPdfCache = {};
    renderBekleyenList();
}

function renderBekleyenList() {
    const q = (document.getElementById('bekSearch')?.value || '').toLocaleLowerCase('tr-TR');
    let list = bekleyenCache;

    if (bekDir !== 'all') {
        const dir = bekDir === 'gelen' ? 'INCOMING' : 'OUTGOING';
        list = list.filter(inv => inv.direction === dir);
    }
    if (q) {
        list = list.filter(inv =>
            (inv.invoice_no || '').toLocaleLowerCase('tr-TR').includes(q) ||
            (inv.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q)
        );
    }

    const countEl = document.getElementById('bekCount');
    if (countEl) countEl.textContent = list.length + ' fatura';

    const tbody = document.getElementById('bekTbody');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = '<div class="bek-empty">Bekleyen fatura yok</div>';
        return;
    }

    const fmtN = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    tbody.innerHTML = list.map(inv => {
        const isGelen  = inv.direction === 'INCOMING';
        const date     = (inv.invoice_date || '').slice(0, 10);
        const active   = inv.id === activeBekId ? ' bek-card--active' : '';
        const amount   = fmtN(invPayableAmountSrc(inv));
        const currency = invDisplayCurrencyLabel(inv);
        const dotCls   = isGelen ? 'bek-dot-gelen' : 'bek-dot-giden';
        const company  = (inv.companies?.name || '—').replace(/</g, '&lt;');
        return `<div class="bek-card${active}" data-id="${inv.id}" onclick="selectBekInvoice('${inv.id}')">
            <div class="bek-card-header">
                <span class="bek-card-no">${inv.invoice_no || '—'}</span>
                <span class="bek-card-dot ${dotCls}"></span>
            </div>
            <div class="bek-card-company">${company}</div>
            <div class="bek-card-footer">
                <span class="bek-card-amount">${amount} ${currency}</span>
                <span class="bek-card-date">${date}</span>
            </div>
        </div>`;
    }).join('');
}

function setBekDir(dir) {
    bekDir = dir;
    ['gelen', 'giden'].forEach(d => {
        const btn = document.getElementById('bekDir' + d.charAt(0).toUpperCase() + d.slice(1));
        if (btn) btn.classList.toggle('bek-dir-btn--active', d === dir);
    });
    renderBekleyenList();
}

function switchBekPageTab(tab) {
    _bekPageTab = tab;
    document.getElementById('bekPageTab1')?.classList.toggle('bek-page-tab--active', tab === 'list');
    document.getElementById('bekPageTab2')?.classList.toggle('bek-page-tab--active', tab === 'bulk');
    const lp = document.getElementById('bekListPane');
    const bp = document.getElementById('bekBulkPane');
    if (lp) lp.style.display = tab === 'list' ? 'flex' : 'none';
    if (bp) bp.style.display = tab === 'bulk' ? 'flex' : 'none';
    if (tab === 'bulk') {
        bulkIncoming = [];
        bulkOutgoing = [];
        bulkFailed   = [];
        renderBulkLists();
        const fi = document.getElementById('bulkFileInput');
        if (fi) fi.value = '';
    }
}

function selectBekInvoice(rawId) {
    const id  = String(rawId);
    const inv = bekleyenCache.find(i => String(i.id) === id);
    if (!inv) return;

    activeBekId = id;

    document.querySelectorAll('.bek-card').forEach(r =>
        r.classList.toggle('bek-card--active', String(r.dataset.id) === id)
    );

    const dp = document.getElementById('bekDetailPanel');
    if (!dp) return;
    dp.style.display = '';

    const isGelen  = inv.direction === 'INCOMING';
    const dirLabel = isGelen ? 'Gelen' : 'Giden';
    const dirCls   = isGelen ? 'bek-dir-badge--gelen' : 'bek-dir-badge--giden';

    dp.innerHTML = `
        <div class="bek-detail-topbar">
            <span class="bek-dir-badge ${dirCls}" style="flex-shrink:0;">${dirLabel}</span>
            <span class="bek-detail-title">${inv.invoice_no || '—'} · ${String(inv.companies?.name || '—').replace(/</g,'&lt;')}</span>
            <button class="bek-import-btn" onclick="importPendingInvoice('${id}')">İçeri Aktar</button>
        </div>
        <div class="bek-detail-split">
            <div class="bek-pdf-pane" id="bekPdfPane_${id}">
                <div id="bekPdfEmpty_${id}" class="bek-pdf-empty">PDF yok</div>
                <div id="bekPdfSpinner_${id}" style="display:none; color:#94a3b8; font-size:13px; padding:20px;">Yükleniyor…</div>
                <iframe id="bekPdfIframe_${id}" style="display:none; width:100%; height:100%; border:none;"></iframe>
            </div>
            <div class="bek-info-pane">
                <div class="bek-info-tabs">
                    <button class="bek-itab bek-itab--active" id="bekItab_bilgiler_${id}" onclick="switchBekInfoTab('${id}','bilgiler')">Fatura Bilgileri</button>
                    <button class="bek-itab"                  id="bekItab_urunler_${id}"  onclick="switchBekInfoTab('${id}','urunler')">Fatura Ürünleri</button>
                </div>
                <div class="bek-info-body" id="bekInfoBody_${id}"></div>
            </div>
        </div>`;

    activeBekInfoTab = 'bilgiler';
    enterBilgilerEdit(id);
    _loadBekPdf(id, inv);
}

async function _loadBekPdf(id, inv) {
    const empty   = document.getElementById(`bekPdfEmpty_${id}`);
    const spinner = document.getElementById(`bekPdfSpinner_${id}`);
    const iframe  = document.getElementById(`bekPdfIframe_${id}`);
    if (!iframe) return;

    if (inv?.pdf_url) {
        if (empty)   empty.style.display   = 'none';
        if (spinner) spinner.style.display = 'none';
        iframe.style.display = 'block';
        iframe.src = inv.pdf_url;
        return;
    }

    if (!inv?.xml_url) {
        if (empty)   empty.style.display   = 'block';
        if (spinner) spinner.style.display = 'none';
        iframe.style.display = 'none';
        return;
    }

    if (_bekPdfCache[id]) {
        if (empty)   empty.style.display   = 'none';
        if (spinner) spinner.style.display = 'none';
        iframe.style.display = 'block';
        await renderXmlToPdfIframe(_bekPdfCache[id], iframe);
        return;
    }

    if (empty)   empty.style.display   = 'none';
    if (spinner) spinner.style.display = 'block';
    iframe.style.display = 'none';

    try {
        const resp = await fetch(inv.xml_url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const xmlText = await resp.text();
        _bekPdfCache[id] = xmlText;
        if (spinner) spinner.style.display = 'none';
        iframe.style.display = 'block';
        await renderXmlToPdfIframe(xmlText, iframe);
    } catch (e) {
        if (spinner) spinner.style.display = 'none';
        if (empty) { empty.textContent = 'PDF yüklenemedi'; empty.style.display = 'block'; }
    }
}

function switchBekInfoTab(rawId, tab) {
    const id = String(rawId);
    activeBekId      = id;
    activeBekInfoTab = tab;
    document.getElementById(`bekItab_bilgiler_${id}`)?.classList.toggle('bek-itab--active', tab === 'bilgiler');
    document.getElementById(`bekItab_urunler_${id}`)?.classList.toggle('bek-itab--active',  tab === 'urunler');

    const inv  = bekleyenCache.find(i => String(i.id) === id);
    if (!inv) return;

    if (tab === 'bilgiler') enterBilgilerEdit(id);
    else                    enterUrunlerEdit(id);
}

async function importPendingInvoice(rawId) {
    const id  = String(rawId);
    const inv = bekleyenCache.find(i => String(i.id) === id);
    const label = inv?.invoice_no || id;
    if (!confirm(`"${label}" faturasını sisteme aktarmak istediğinizden emin misiniz?`)) return;

    try {
        const res  = await fetch(`/api/invoices/${encodeURIComponent(id)}/approve`, { method: 'PUT' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);

        bekleyenCache = bekleyenCache.filter(i => String(i.id) !== id);
        if (String(activeBekId) === id) {
            activeBekId = null;
            const dp = document.getElementById('bekDetailPanel');
            if (dp) dp.style.display = 'none';
        }
        renderBekleyenList();
    } catch (e) {
        alert('Aktarım hatası: ' + e.message);
    }
}

// ─── Toplu Yükleme ────────────────────────────────────────────────────────────

function bulkEscapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderBulkLists() {
    const inBody  = document.getElementById('bulkIncomingBody');
    const outBody = document.getElementById('bulkOutgoingBody');
    const failBox = document.getElementById('bulkFailedBox');
    if (!inBody || !outBody) return;

    function rowHtml(entry, col) {
        const t  = entry.pack.company?.name || entry.fileName;
        const no = entry.pack.invoice?.invoice_no || '—';
        return `
            <div class="bulk-row" data-id="${entry.id}">
                <label class="bulk-row-check"><input type="checkbox" class="bulk-cb" data-col="${col}"></label>
                <div class="bulk-row-main">
                    <div class="bulk-row-title">${bulkEscapeHtml(t)}</div>
                    <div class="bulk-row-sub">${bulkEscapeHtml(no)} · ${bulkEscapeHtml(entry.fileName)}</div>
                </div>
                <button type="button" class="btn btn-xs bulk-row-del" data-id="${entry.id}">✕</button>
            </div>`;
    }

    inBody.innerHTML  = bulkIncoming.length ? bulkIncoming.map(e => rowHtml(e, 'in')).join('')   : '<div class="bulk-empty">Henüz yok</div>';
    outBody.innerHTML = bulkOutgoing.length ? bulkOutgoing.map(e => rowHtml(e, 'out')).join('')  : '<div class="bulk-empty">Henüz yok</div>';

    if (failBox) {
        failBox.innerHTML = bulkFailed.length
            ? `<div class="bulk-failed-inner"><strong>İşlenemedi (${bulkFailed.length})</strong><br>${bulkFailed.map(f => `${bulkEscapeHtml(f.fileName)} — ${bulkEscapeHtml(f.reason)}`).join('<br>')}</div>`
            : '';
    }

    inBody.querySelectorAll('.bulk-row-del').forEach(btn => { btn.onclick = () => removeBulkRow(btn.dataset.id); });
    outBody.querySelectorAll('.bulk-row-del').forEach(btn => { btn.onclick = () => removeBulkRow(btn.dataset.id); });

    const saIn  = document.getElementById('bulkSelAllIn');
    const saOut = document.getElementById('bulkSelAllOut');
    if (saIn)  saIn.checked  = false;
    if (saOut) saOut.checked = false;
}

function removeBulkRow(id) {
    bulkIncoming = bulkIncoming.filter(x => x.id !== id);
    bulkOutgoing = bulkOutgoing.filter(x => x.id !== id);
    renderBulkLists();
}

function clearBulkColumn(dir) {
    if (dir === 'in') bulkIncoming = [];
    else              bulkOutgoing = [];
    renderBulkLists();
}

function bulkSelectAllInColumn(dir, checked) {
    const col = dir === 'in' ? 'in' : 'out';
    document.querySelectorAll(`.bulk-cb[data-col="${col}"]`).forEach(cb => { cb.checked = !!checked; });
}

function bulkDeleteSelectedInColumn(dir) {
    const col     = dir === 'in' ? 'in' : 'out';
    const toDelete = new Set();
    document.querySelectorAll(`.bulk-cb[data-col="${col}"]:checked`).forEach(cb => {
        const row = cb.closest('.bulk-row');
        if (row?.dataset.id) toDelete.add(row.dataset.id);
    });
    toDelete.forEach(id => removeBulkRow(id));
}

async function handleBulkFilePick(ev) {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    try {
        await ensureBulkInokasVkn();
    } catch (e) {
        alert(e.message);
        return;
    }
    try {
        await ensureProductCodeLookupSetLoaded(false);
    } catch (e) {
        console.warn('Toplu XML için ürün kod seti alınamadı:', e?.message || e);
    }

    for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.xml')) {
            bulkFailed.push({ fileName: file.name, reason: 'Uzantı .xml değil' });
            continue;
        }
        let text = '';
        try { text = await file.text(); }
        catch (e) { bulkFailed.push({ fileName: file.name, reason: 'Dosya okunamadı' }); continue; }

        let xmlDoc = null;
        try {
            xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
            if (xmlDoc.getElementsByTagName('parsererror').length) throw new Error('parse');
        } catch (e) { bulkFailed.push({ fileName: file.name, reason: 'XML çözülemedi' }); continue; }

        const { supplier, customer } = getSupplierCustomerVknsFromDoc(xmlDoc);
        const dir = classifyInvoiceDirection(supplier, customer, bulkInokasVkn);
        if (dir === 'NEITHER') { bulkFailed.push({ fileName: file.name, reason: 'İnokas satıcı/alıcı olarak görünmüyor' }); continue; }
        if (dir === 'BOTH')    { bulkFailed.push({ fileName: file.name, reason: 'VKN çakışması' }); continue; }

        const viewKey = dir === 'INCOMING' ? 'gelen' : 'giden';
        let pack = null;
        try { pack = buildInvoicePayloadFromXml(xmlDoc, viewKey); }
        catch (e) { bulkFailed.push({ fileName: file.name, reason: e.message || 'UBL ayrıştırma hatası' }); continue; }

        const row = {
            id: (crypto.randomUUID && crypto.randomUUID()) || `bulk_${Date.now()}_${Math.random()}`,
            fileName: file.name,
            pack,
            direction: dir
        };
        if (dir === 'INCOMING') bulkIncoming.push(row);
        else                    bulkOutgoing.push(row);
    }

    renderBulkLists();
    if (ev.target) ev.target.value = '';
}

async function executeBulkUpload() {
    if (bulkUploadRunning) return;
    const queue = [...bulkIncoming, ...bulkOutgoing];
    if (!queue.length) { alert('Yüklenecek fatura yok. Önce XML dosyaları seçin.'); return; }

    bulkUploadRunning = true;
    const succeeded = [];
    const errors    = [];

    for (const entry of queue) {
        const view    = entry.direction === 'INCOMING' ? 'gelen' : 'giden';
        const payload = {
            submit_view: view,
            parsed_view: view,
            is_bulk_upload: true,
            company: entry.pack.company,
            invoice: { ...entry.pack.invoice, status: 'unpaid', paid_amount: 0 },
            xml_context: entry.pack.xml_context,
            items: entry.pack.items
        };
        try {
            const res    = await fetch('/api/save-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
            succeeded.push(entry.id);
        } catch (e) {
            const label = entry.pack.invoice?.invoice_no || entry.fileName;
            errors.push(`${label}: ${e.message}`);
        }
    }

    bulkIncoming      = bulkIncoming.filter(e => !succeeded.includes(e.id));
    bulkOutgoing      = bulkOutgoing.filter(e => !succeeded.includes(e.id));
    bulkUploadRunning = false;
    renderBulkLists();

    let msg = `Tamam: ${succeeded.length} fatura bekleyenlere eklendi.`;
    if (errors.length) msg += `\n\nHata (${errors.length}):\n${errors.join('\n')}`;
    alert(msg);

    if (!errors.length) {
        switchBekPageTab('list');
        loadBekleyenInvoices();
    }
}

document.addEventListener('DOMContentLoaded', initBekleyen);
