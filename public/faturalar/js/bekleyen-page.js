// faturalar/js/bekleyen-page.js
// Shared logic for bekleyen-gelen.html, bekleyen-giden.html, fatura-yukle.html
// Direction controlled by window._BEK_DIR ('INCOMING' | 'OUTGOING')

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initBekleyen() {
    await loadBekleyenInvoices();
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
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

    activeBekId  = null;
    _bekPdfCache = {};
    renderBekleyenList();
    _hideDetail();
}

// ─── LIST ─────────────────────────────────────────────────────────────────────
function renderBekleyenList() {
    const q      = (document.getElementById('bekSearch')?.value || '').toLocaleLowerCase('tr-TR');
    const dir    = window._BEK_DIR || 'INCOMING';
    let   list   = bekleyenCache.filter(inv => inv.direction === dir);

    if (q) {
        list = list.filter(inv =>
            (inv.invoice_no || '').toLocaleLowerCase('tr-TR').includes(q) ||
            (inv.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q)
        );
    }

    const countEl = document.getElementById('bekCount');
    if (countEl) countEl.textContent = `${list.length} bekleyen fatura`;

    const tbody = document.getElementById('bekTbody');
    if (!tbody) return;

    if (!list.length) {
        tbody.innerHTML = '<div class="bek-empty">Bekleyen fatura yok</div>';
        return;
    }

    const fmtN = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    tbody.innerHTML = list.map(inv => {
        const date    = (inv.invoice_date || '').slice(0, 10);
        const active  = inv.id === activeBekId ? ' bek-card--active' : '';
        const amount  = fmtN(invPayableAmountSrc(inv));
        const cur     = invDisplayCurrencyLabel(inv);
        const company = (inv.companies?.name || '—').replace(/</g, '&lt;');
        return `<div class="bek-card${active}" data-id="${inv.id}" onclick="selectBekInvoice('${inv.id}')">
            <div class="bek-card-header">
                <span class="bek-card-no">${inv.invoice_no || '—'}</span>
                <i class="ti ti-clock-hour-4" style="font-size:13px; color:#94a3b8;"></i>
            </div>
            <div class="bek-card-company">${company}</div>
            <div class="bek-card-footer">
                <span class="bek-card-amount">${amount} ${cur}</span>
                <span class="bek-card-date">${date}</span>
            </div>
        </div>`;
    }).join('');
}

// ─── SELECT INVOICE ───────────────────────────────────────────────────────────
function selectBekInvoice(rawId) {
    const id  = String(rawId);
    const inv = bekleyenCache.find(i => String(i.id) === id);
    if (!inv) return;

    activeBekId = id;

    // Highlight active card
    document.querySelectorAll('.bek-card').forEach(r =>
        r.classList.toggle('bek-card--active', String(r.dataset.id) === id)
    );

    // Navigate to fatura-detay
    window.location.href = `/faturalar/pages/fatura-detay.html?id=${encodeURIComponent(id)}`;
}

// ─── DETAIL PANEL (kept for backward compat but not used on new pages) ────────
function _hideDetail() {
    const dp    = document.getElementById('bekDetailPanel');
    const empty = document.getElementById('bekDetailEmpty');
    if (dp)    { dp.style.display    = 'none'; dp.innerHTML = ''; }
    if (empty) empty.style.display   = 'flex';
}

// ─── APPROVE ─────────────────────────────────────────────────────────────────
async function importPendingInvoice(rawId) {
    const id  = String(rawId);
    const inv = bekleyenCache.find(i => String(i.id) === id);
    const label = inv?.invoice_no || id;
    if (!confirm(`"${label}" faturasını sisteme aktarmak istiyor musunuz?`)) return;

    try {
        const res  = await fetch(`/api/invoices/${encodeURIComponent(id)}/approve`, { method: 'PUT' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);

        const isIncoming = String(inv?.direction || '').toUpperCase() === 'INCOMING';
        window.location.href = isIncoming
            ? '/faturalar/pages/gelen-faturalar.html'
            : '/faturalar/pages/giden-faturalar.html';
    } catch (e) {
        alert('Aktarım hatası: ' + e.message);
    }
}

// ─── BULK UPLOAD ──────────────────────────────────────────────────────────────
function bulkEscapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderBulkLists() {
    const inBody  = document.getElementById('bulkIncomingBody');
    const outBody = document.getElementById('bulkOutgoingBody');
    const failBox = document.getElementById('bulkFailedBox');
    if (!inBody || !outBody) return;

    function rowHtml(entry, col) {
        const t  = entry.pack.company?.name || entry.fileName;
        const no = entry.pack.invoice?.invoice_no || '—';
        return `<div class="bulk-row" data-id="${entry.id}">
            <label class="bulk-row-check"><input type="checkbox" class="bulk-cb" data-col="${col}"></label>
            <div class="bulk-row-main">
                <div class="bulk-row-title">${bulkEscapeHtml(t)}</div>
                <div class="bulk-row-sub">${bulkEscapeHtml(no)} · ${bulkEscapeHtml(entry.fileName)}</div>
            </div>
            <button type="button" class="btn-xs bulk-row-del" data-id="${entry.id}">✕</button>
        </div>`;
    }

    inBody.innerHTML  = bulkIncoming.length ? bulkIncoming.map(e => rowHtml(e,'in')).join('')  : '<div class="bulk-empty">Henüz yok</div>';
    outBody.innerHTML = bulkOutgoing.length ? bulkOutgoing.map(e => rowHtml(e,'out')).join('') : '<div class="bulk-empty">Henüz yok</div>';

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
    document.querySelectorAll(`.bulk-cb[data-col="${dir === 'in' ? 'in' : 'out'}"]`)
        .forEach(cb => { cb.checked = !!checked; });
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

    try { await ensureBulkInokasVkn(); }
    catch (e) { alert(e.message); return; }

    try { await ensureProductCodeLookupSetLoaded(false); }
    catch (e) { console.warn('Ürün kod seti alınamadı:', e?.message || e); }

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
        if (dir === 'NEITHER') { bulkFailed.push({ fileName: file.name, reason: 'İnokas satıcı/alıcı değil' }); continue; }
        if (dir === 'BOTH')    { bulkFailed.push({ fileName: file.name, reason: 'VKN çakışması' }); continue; }

        let pack = null;
        const viewKey = dir === 'INCOMING' ? 'gelen' : 'giden';
        try { pack = buildInvoicePayloadFromXml(xmlDoc, viewKey); }
        catch (e) { bulkFailed.push({ fileName: file.name, reason: e.message || 'UBL hatası' }); continue; }

        const row = {
            id: (crypto.randomUUID?.()) || `bulk_${Date.now()}_${Math.random()}`,
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
    if (!queue.length) { alert('Yüklenecek fatura yok.'); return; }

    bulkUploadRunning = true;
    const succeeded = [];
    const errors    = [];

    for (const entry of queue) {
        const view    = entry.direction === 'INCOMING' ? 'gelen' : 'giden';
        const payload = {
            submit_view: view, parsed_view: view, is_bulk_upload: true,
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
        window.location.href = '/faturalar/pages/bekleyen-gelen.html';
    }
}