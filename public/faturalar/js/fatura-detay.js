// faturalar/js/fatura-detay.js
// Standalone invoice detail page — reads ?id= from URL, fetches invoice, renders detail

let _detayInv     = null;
let _detayTab     = 'bilgiler';
let _detayId      = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(location.search);
    _detayId = params.get('id') || '';

    if (!_detayId) {
        showError('Fatura ID bulunamadı.');
        return;
    }

    await loadInternalCategoryOptions();
    await loadInvoice(_detayId);
});

// ─── LOAD ─────────────────────────────────────────────────────────────────────
async function loadInvoice(id) {
    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`Fatura bulunamadı (${res.status})`);
        const inv = await res.json();

        _detayInv = inv;

        // Expose direction on body so any child element can theme accordingly
        // (e.g. renderBilgilerView can pick fat-detail-total--out vs --in from this)
        const dirRaw = String(inv.direction || '').toUpperCase();
        document.body.dataset.invoiceDirection = dirRaw === 'INCOMING' ? 'in' : 'out';

        // Put into allInvoicesCache so detail.js functions (_findInvAndBody etc.) work
        allInvoicesCache = [inv];

        ensureProductCategoryLookupLoaded().catch(() => {});
        renderHeader(inv);
        renderPdf(id, inv);
        renderTabs(id);

    } catch (err) {
        showError(err.message);
    }
}

// ─── HEADER ───────────────────────────────────────────────────────────────────
function renderHeader(inv) {
    const noEl      = document.getElementById('headerInvoiceNo');
    const compEl    = document.getElementById('headerCompany');
    const badgeEl   = document.getElementById('headerDirBadge');
    const actionsEl = document.getElementById('headerActions');

    if (noEl)    noEl.textContent   = inv.invoice_no || '—';
    if (compEl)  compEl.textContent = inv.companies?.name || '—';

    if (badgeEl) {
        const isIn = String(inv.direction || '').toUpperCase() === 'INCOMING';
        badgeEl.textContent = isIn ? '▲ Gelen' : '▼ Giden';
        badgeEl.className   = `detay-dir-badge ${isIn ? 'detay-dir-in' : 'detay-dir-out'}`;
    }

    // Approve button (shown only for pending invoices)
    if (actionsEl) {
        if (inv.approval_status === 'pending') {
            actionsEl.innerHTML = `
                <button onclick="approveDetailInvoice('${inv.id}')" class="detay-approve-btn">
                    Aktar
                </button>`;
        } else {
            actionsEl.innerHTML = '';
        }
    }

    document.title = `${inv.invoice_no || 'Fatura'} — İnokas CRM`;
}

// ─── BACK BUTTON ─────────────────────────────────────────────────────────────
function goBack() {
    const params = new URLSearchParams(location.search);
    const from   = params.get('from') || '';

    if (from === 'dmo') { window.location.href = '/dmo/pages/dmo.html'; return; }

    if (from === 'giderler') {
        window.location.href = '../../giderler/pages/giderler.html';
        return;
    }

    const isIn      = String(_detayInv?.direction || '').toUpperCase() === 'INCOMING';
    const isPending = _detayInv?.approval_status === 'pending';

    if (isPending) {
        window.location.href = '/faturalar/pages/faturalar.html?tab=bekleyen';
        return;
    }

    window.location.href = isIn
        ? '/faturalar/pages/faturalar.html?tab=gelen'
        : '/faturalar/pages/faturalar.html?tab=giden';
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
function renderPdf(id, inv) {
    const iframe = document.getElementById('detayPdfIframe');
    const empty  = document.getElementById('detayPdfEmpty');
    loadDetailPdfInto(id, inv, iframe, empty);
    setupDetayDownloadBar(inv);
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function renderTabs(id) {
    document.getElementById('detayLoading').style.display  = 'none';
    document.getElementById('detayTabBar').style.display   = 'flex';
    document.getElementById('fatDetailTabBody').style.display = 'block';

    const params = new URLSearchParams(location.search);
    const from   = params.get('from') || '';
    const startTab = (from === 'bekleyen-gelen' || from === 'bekleyen-giden') ? 'urunler' : 'bilgiler';
    switchDetayTab(startTab);
}

function switchDetayTab(tab) {
    _detayTab = tab;

    document.getElementById('tabBilgilerBtn')?.classList.toggle('fat-dtab--active', tab === 'bilgiler');
    document.getElementById('tabUrunlerBtn')?.classList.toggle('fat-dtab--active', tab === 'urunler');

    const body = document.getElementById('fatDetailTabBody');
    if (!body || !_detayInv) return;

    body.classList.remove('fat-tab-anim');
    void body.offsetWidth;
    body.classList.add('fat-tab-anim');

    if (tab === 'bilgiler') renderBilgilerView(_detayId);
    if (tab === 'urunler')  renderUrunlerView(_detayId, body, _detayInv);
}

// ─── ERROR ────────────────────────────────────────────────────────────────────
function showError(msg) {
    const el = document.getElementById('detayLoading');
    if (!el) return;
    el.innerHTML = `
        <div class="detay-error">
            <i class="ti ti-alert-circle detay-error-icon"></i>
            <p class="detay-error-msg">${msg}</p>
            <button onclick="goBack()" class="detay-error-btn">Geri Dön</button>
        </div>`;
}

// ─── Override openFatDetailPage so detail.js edit flows stay on this page ────
window.switchFatDetailTab = function(id, tab) {
    switchDetayTab(tab);
};

// approveDetailInvoice may exist in detail.js or main.js — guard it
if (typeof approveDetailInvoice === 'undefined') {
    window.approveDetailInvoice = async function(id) {
        const btn = document.querySelector(`[onclick="approveDetailInvoice('${id}')"]`);
        if (btn) { btn.disabled = true; btn.textContent = 'Aktarılıyor...'; }
        try {
            const res = await fetch(`/api/invoices/${id}/approve`, { method: 'PUT' });
            if (!res.ok) throw new Error('Onay başarısız');

            const freshRes = await fetch(`/api/invoices/${encodeURIComponent(id)}`);
            const freshInv = freshRes.ok ? await freshRes.json() : _detayInv;

            const isIncoming = String(freshInv?.direction || _detayInv?.direction || '').toUpperCase() === 'INCOMING';

            console.log(isIncoming);

            alert('Fatura başarıyla aktarıldı.');

            _activeMainTab = 'bekleyen'
            _activeBekTab = isIncoming ? 'gelen' : 'giden';
            window.location.href = '/faturalar/pages/faturalar.html?tab=bekleyen';

        } catch (err) {
            alert(`Hata: ${err.message}`);
            if (btn) { btn.disabled = false; btn.textContent = 'Aktar'; }
        }
    };
}


// ─── Category select helpers (normally in main.js) ────────────────────────────
async function loadInternalCategoryOptions() {
    try {
        const res = await fetch('/api/invoices/non-internal-categories');
        if (!res.ok) return;
        const data = await res.json();
        // endpoint returns [{name, count}] — dropdown needs strings
        _internalCategoryOptions = (data || []).map(x => x.name).filter(Boolean);
    } catch (e) {
        console.warn('Ofis içi kategoriler alınamadı:', e.message);
    }
}

function getRowCategoryOptions(isInternal) {
    if (isInternal) return _internalCategoryOptions;
    return productCategoryOptionList;
}

function renderRowCategorySelect(selectEl, isInternal, value = '') {
    if (!selectEl) return;
    const options = getRowCategoryOptions(isInternal);
    const selectedValue = String(value || '').trim();
    const placeholder = isInternal ? 'Ofis içi kategorisi seçin' : 'Ürün kategorisi seçin';
    selectEl.innerHTML = [
        `<option value="">${placeholder}</option>`,
        ...options.map(opt => `<option value="${opt}"${opt === selectedValue ? ' selected' : ''}>${opt}</option>`),
        '<option value="__add_new_category__">+ Yeni kategori ekle</option>'
    ].join('');
}

function applySkuBasedProductCategory(row, skuRaw) {
    const sku = normalizeProductCodeForMatch(skuRaw);
    const categorySelect = row.querySelector('.line-category-select');
    const internalToggle = row.querySelector('.internal-toggle');
    if (!categorySelect || !internalToggle || internalToggle.checked) return;
    if (!sku) return;
    const category = String(productCategoryByCodeMap.get(sku) || '').trim();
    if (!category) return;
    if ([...categorySelect.options].some(o => o.value === category)) {
        categorySelect.value = category;
    }
}


// ─── DOWNLOAD (PDF / XML) ─────────────────────────────────────────────────────
function setupDetayDownloadBar(inv) {
    const bar    = document.getElementById('detayDlBar');
    const pdfBtn = document.getElementById('detayDlPdf');
    const xmlBtn = document.getElementById('detayDlXml');
    if (!bar) return;

    const hasPdf = !!inv?.pdf_url;
    const hasXml = !!inv?.xml_url;

    // Nothing to download → keep bar hidden
    if (!hasPdf && !hasXml) { bar.style.display = 'none'; return; }

    bar.style.display = 'flex';

    if (pdfBtn) {
        pdfBtn.style.display = hasPdf ? 'inline-flex' : 'none';
    }
    if (xmlBtn) {
        xmlBtn.style.display = hasXml ? 'inline-flex' : 'none';
    }
}

async function downloadDetayFile(kind /* 'pdf' | 'xml' */) {
    const inv = _detayInv;
    if (!inv) return;

    const url = kind === 'pdf' ? inv.pdf_url : inv.xml_url;
    const ext = kind === 'pdf' ? 'pdf' : 'xml';
    if (!url) return;

    const btn = document.getElementById(kind === 'pdf' ? 'detayDlPdf' : 'detayDlXml');
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = `<i class="ti ti-loader-2 detay-dl-spin"></i> İndiriliyor...`; }

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(resp.status);
        const blob = await resp.blob();

        const a = document.createElement('a');
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        a.download = `${detaySafeFileName(inv)}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (e) {
        console.error('İndirme hatası:', e);
        alert('Dosya indirilemedi.');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    }
}

function detaySafeFileName(inv) {
    const no   = (inv.invoice_no || 'fatura').toString();
    const comp = (inv.companies?.name || '').toString();
    const raw  = comp ? `${no}_${comp}` : no;
    return raw.replace(/[^\p{L}\p{N}_\-]+/gu, '_').slice(0, 80);
}