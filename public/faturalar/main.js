// ─── FATURALAR — MAIN ────────────────────────────────────────────────────────
// State       → faturalar/state.js
// List view   → faturalar/list.js
// Detail view → faturalar/detail.js
// XML parsing → faturalar/xml.js
// API calls   → faturalar/api.js
// Utilities   → faturalar/utils.js

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    bindModalOutsideClose();
    restoreFilterState();

    const initHash = location.hash.slice(1);
    if (initHash === 'giden') currentView = 'giden';
    else if (initHash === 'ekle') currentView = 'gelen';
    else currentView = 'gelen';

    showAllState.gelen = true;
    showAllState.giden = true;
    interactedState.gelen = true;
    interactedState.giden = true;

    updateActionButtonsTheme();
    refreshData(false);

    if (initHash === 'ekle') enterEkleView();
    else if (initHash === 'rapor') enterRaporView();
    else if (initHash === 'bekleyen' || initHash === 'toplu') enterBekleyenView();

    window.addEventListener('hashchange', () => {
        const h = location.hash.slice(1);
        closeFatDetailPage();
        if (h === 'ekle') {
            exitRaporView(); exitBekleyenView();
            enterEkleView();
        } else if (h === 'rapor') {
            if (document.body.classList.contains('view-ekle')) exitEkleView();
            exitBekleyenView();
            enterRaporView();
        } else if (h === 'bekleyen' || h === 'toplu') {
            if (document.body.classList.contains('view-ekle')) exitEkleView();
            exitRaporView();
            enterBekleyenView();
        } else {
            if (document.body.classList.contains('view-ekle')) exitEkleView();
            exitRaporView(); exitBekleyenView();
            if (h === 'giden') switchView('giden');
            else switchView('gelen');
        }
    });

    const invoiceForm = document.getElementById('invoiceForm');
    if (invoiceForm) {
        invoiceForm.addEventListener('submit', saveInvoiceToDatabase);
    }

    const onFilterChange = () => {
        setInteracted(true);
        if (isShowAll()) {
            setShowAll(false);
            const btn = document.getElementById('btnToggleShowAll');
            if (btn) btn.innerText = 'Tümünü Göster';
        }
        saveFilterState();
        renderCurrentView();
    };

    document.getElementById('filterDateStart')?.addEventListener('change', onFilterChange);
    document.getElementById('filterDateEnd')?.addEventListener('change', onFilterChange);
    document.getElementById('filterStatus')?.addEventListener('change', onFilterChange);
    document.getElementById('filterCurrency')?.addEventListener('change', onFilterChange);
    document.getElementById('mainSearch')?.addEventListener('input', onFilterChange);
});

function bindModalOutsideClose() {
    const bindOne = (overlayId, closeFn) => {
        const overlay = document.getElementById(overlayId);
        if (!overlay) return;
        if (overlay.dataset.outsideCloseBound === '1') return;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeFn();
        });
        overlay.dataset.outsideCloseBound = '1';
    };
    bindOne('invoiceModal', closeInvoiceModal);
    bindOne('invoiceDetailModal', closeInvoiceDetailModal);
}

function setupEventListeners() {
    const xmlInput = document.getElementById('xmlInput');
    xmlInput.addEventListener('change', handleFileUpload);

    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--success)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--primary)'; });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length) handleFileUpload({ target: { files } });
    });
}

function syncPaidFieldByStatus() {
    const statusEl = document.getElementById('f_status');
    const paidEl = document.getElementById('f_paid');
    const totalEl = document.getElementById('f_total');
    if (!statusEl || !paidEl || !totalEl) return;
    const status = (statusEl.value || 'unpaid').toLowerCase();
    const total = parseFloat(totalEl.value) || 0;
    if (status === 'partial') {
        paidEl.readOnly = false;
        paidEl.placeholder = 'Kısmi ödeme tutarı girin';
        return;
    }
    paidEl.readOnly = true;
    if (status === 'unpaid') {
        paidEl.value = '0';
        paidEl.placeholder = '0,00';
    } else if (status === 'paid') {
        paidEl.value = total > 0 ? String(total) : '0';
        paidEl.placeholder = 'Toplam kadar otomatik';
    }
}

// --- MODAL CONTROLS ---
function openInvoiceModal() {
    document.getElementById('invoiceForm').reset();
    document.getElementById('f_id').value = '';
    if (currentView === 'gelen') {
        ensureProductCodeLookupSetLoaded(false).catch((e) => {
            console.warn('Ürün kod seti ön yükleme hatası:', e?.message || e);
        });
    }
    const lockedInputs = document.querySelectorAll('.locked-input');
    lockedInputs.forEach(el => {
        el.removeAttribute('readonly');
        if (el.tagName === 'SELECT') el.removeAttribute('disabled');
        el.style.backgroundColor = '';
    });
    document.getElementById('unlockWarningBox').style.display = 'none';
    document.getElementById('invoiceModal').style.display = 'flex';
}

async function viewInvoice(id) {
    const inv = allInvoicesCache.find(i => i.id === id);
    if (!inv) return;

    document.getElementById('invoiceForm').reset();
    document.getElementById('f_id').value = inv.id;
    document.getElementById('f_vkn').value = inv.companies?.vkn_tckn || '';

    if (inv.companies?.vkn_tckn) {
        fetchPendingOrdersForCompany(inv.companies.vkn_tckn);
    }

    document.getElementById('f_firma').value = inv.companies?.name || '';
    document.getElementById('f_no').value = inv.invoice_no || '';
    document.getElementById('f_type').value = inv.invoice_type || 'Ticari';
    document.getElementById('f_date').value = inv.invoice_date || '';
    document.getElementById('f_due_date').value = inv.due_date || '';
    document.getElementById('f_tax_office').value = inv.companies?.tax_office || '';
    document.getElementById('f_currency').value = invCurrencySelectValue(inv) || inv.currency || 'TL';
    document.getElementById('f_kur').value = inv.calculation_rate ?? inv.exchange_rate ?? '';
    document.getElementById('f_net').value = invNetForForm(inv);
    document.getElementById('f_tax').value = invTaxForForm(inv);
    document.getElementById('f_total').value = invPayableForForm(inv);
    document.getElementById('f_notes').value = inv.notes || '';

    const lockedInputs = document.querySelectorAll('.locked-input');
    lockedInputs.forEach(el => {
        el.setAttribute('readonly', 'true');
        if (el.tagName === 'SELECT') el.setAttribute('disabled', 'true');
        el.style.backgroundColor = '#f1f5f9';
        const label = el.parentElement.querySelector('label');
        if (label) {
            let icon = label.querySelector('.dynamic-lock-icon');
            if (!icon) {
                label.innerHTML += ' <span class="dynamic-lock-icon" style="font-size:13px; margin-left:4px;" title="Bu alan resmi veridir, değiştirilmesi kilitlenmiştir.">🔒</span>';
            } else {
                icon.innerText = '🔒';
            }
        }
    });

    document.getElementById('unlockWarningBox').style.display = 'block';

    document.getElementById('lineItemsBody').innerHTML = '';
    if (inv.invoice_items && inv.invoice_items.length > 0) {
        inv.invoice_items.forEach(item => {
            addLineItem(
                item.product_name || '',
                item.quantity || 1,
                item.unit_price_cur || 0,
                item.total_price_cur || 0,
                item.tax_rate || 20,
                item.product_code || item.sku || '',
                item.purchase_order_item_id || '',
                !!item.is_internal,
                item.internal_category || '',
                item.product_category || ''
            );
        });
    } else {
        addLineItem();
    }

    try {
        await ensureProductCodeLookupSetLoaded();
        const missingSkus = Array.from(new Set(
            (inv.invoice_items || [])
                .map((it) => String(it.product_code || it.sku || '').trim())
                .filter(Boolean)
                .filter((sku) => !isInProductCodeLookup(sku))
        ));
        if (missingSkus.length) {
            showXmlSuccess(inv.companies?.name || '-', inv.companies?.vkn_tckn || '-', missingSkus);
        }
    } catch (e) {
        console.warn('SKU uyarı kontrolü yapılamadı:', e);
    }

    document.getElementById('invoiceModal').style.display = 'flex';
}

function unlockInvoiceForm() {
    const lockedInputs = document.querySelectorAll('.locked-input');
    lockedInputs.forEach(el => {
        el.removeAttribute('readonly');
        if (el.tagName === 'SELECT') el.removeAttribute('disabled');
        el.style.backgroundColor = '#ffffff';
        const label = el.parentElement.querySelector('label');
        if (label) {
            let icon = label.querySelector('.dynamic-lock-icon');
            if (icon) {
                icon.innerText = '🔓';
                icon.title = "Kilit açıldı, dikkatli düzenleyin!";
            }
        }
    });
    document.getElementById('unlockWarningBox').style.display = 'none';
}

function closeInvoiceModal() {
    if (document.body.classList.contains('view-ekle')) {
        exitEkleView();
        location.hash = currentView;
        return;
    }
    document.getElementById('invoiceModal').style.display = 'none';
    document.getElementById('invoiceForm').reset();
    document.getElementById('lineItemsBody').innerHTML = '';
    document.getElementById('previewPane').innerHTML = `
        <div id="dropZone" class="upload-box-compact">
            <input type="file" id="xmlInput" accept=".xml" hidden>
            <span class="upload-icon-sm">📄</span>
            <span>UBL-XML ile otomatik doldur (opsiyonel) — sürükleyin veya seçin</span>
            <button class="btn btn-primary btn-sm" onclick="document.getElementById('xmlInput').click()">Dosya Seç</button>
        </div>
        <div id="xmlDataSummary" class="xml-data-view" style="display:none;"></div>`;
    setupEventListeners();
}

function enterEkleView() {
    openInvoiceModal();
    document.body.classList.add('view-ekle');
    const h2 = document.querySelector('#invoiceModal .modal-header h2');
    if (h2) h2.textContent = 'Yeni Fatura Ekle';
    const iframe = document.getElementById('eklePdfIframe');
    const drop = document.getElementById('eklePdfDrop');
    const bar = document.getElementById('eklePdfBar');
    if (iframe) { iframe.style.display = 'none'; iframe.src = ''; }
    if (bar) bar.style.display = 'none';
    if (drop) drop.style.display = 'flex';
    const pane = document.getElementById('eklePdfPane');
    if (pane && !pane.dataset.dragBound) {
        pane.dataset.dragBound = '1';
        pane.addEventListener('dragover', (e) => { e.preventDefault(); pane.classList.add('drag-over'); });
        pane.addEventListener('dragleave', () => pane.classList.remove('drag-over'));
        pane.addEventListener('drop', (e) => {
            e.preventDefault();
            pane.classList.remove('drag-over');
            if (e.dataTransfer.files.length) handleFileUpload({ target: { files: e.dataTransfer.files } });
        });
        const eklePdfInput = document.getElementById('eklePdfInput');
        if (eklePdfInput) eklePdfInput.addEventListener('change', handleFileUpload);
    }
}

function resetEklePdf() {
    const iframe = document.getElementById('eklePdfIframe');
    const drop = document.getElementById('eklePdfDrop');
    const bar = document.getElementById('eklePdfBar');
    if (iframe) { iframe.style.display = 'none'; iframe.src = ''; }
    if (bar) bar.style.display = 'none';
    if (drop) drop.style.display = 'flex';
    const inp = document.getElementById('eklePdfInput');
    if (inp) inp.value = '';
    document.getElementById('invoiceForm').reset();
    document.getElementById('lineItemsBody').innerHTML = '';
}

function exitEkleView() {
    document.body.classList.remove('view-ekle');
    document.getElementById('invoiceModal').style.display = 'none';
    document.getElementById('invoiceForm').reset();
    document.getElementById('lineItemsBody').innerHTML = '';
    document.getElementById('previewPane').innerHTML = `
        <div id="dropZone" class="upload-box-compact">
            <input type="file" id="xmlInput" accept=".xml" hidden>
            <span class="upload-icon-sm">📄</span>
            <span>UBL-XML ile otomatik doldur (opsiyonel) — sürükleyin veya seçin</span>
            <button class="btn btn-primary btn-sm" onclick="document.getElementById('xmlInput').click()">Dosya Seç</button>
        </div>
        <div id="xmlDataSummary" class="xml-data-view" style="display:none;"></div>`;
    setupEventListeners();
}

// --- XML PARSING ENGINE ---
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (currentView === 'gelen') {
        try {
            await ensureProductCodeLookupSetLoaded(false);
        } catch (err) {
            console.warn('Ürün kod seti yüklenemedi, fallback sınırlı çalışacak:', err?.message || err);
        }
    }

    const reader = new FileReader();
    reader.onload = function (event) {
        const xmlText = event.target.result;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        parseUBL(xmlDoc);
        if (document.body.classList.contains('view-ekle')) {
            const iframe = document.getElementById('eklePdfIframe');
            const drop = document.getElementById('eklePdfDrop');
            const bar = document.getElementById('eklePdfBar');
            const nameEl = document.getElementById('eklePdfFileName');
            if (nameEl) nameEl.textContent = file.name;
            renderXmlToPdfIframe(xmlText, iframe)
                .then(() => {
                    if (drop) drop.style.display = 'none';
                    if (bar) bar.style.display = 'flex';
                    if (iframe) iframe.style.display = 'block';
                })
                .catch(err => console.warn('Ekle PDF render hatası:', err));
        }
    };
    reader.readAsText(file);
}

function applyParsedPayloadToForm(pack) {
    const inv = pack.invoice;
    const co = pack.company;
    document.getElementById('f_no').value = inv.invoice_no || '';
    document.getElementById('f_date').value = inv.invoice_date || '';
    document.getElementById('f_type').value = inv.invoice_type || 'Ticari';
    document.getElementById('f_due_date').value = inv.due_date || '';
    document.getElementById('f_firma').value = co.name || '';
    document.getElementById('f_vkn').value = co.vkn_tckn || '';
    fetchPendingOrdersForCompany(co.vkn_tckn);
    document.getElementById('f_tax_office').value = co.tax_office || '';
    document.getElementById('f_address').value = co.address || '';
    document.getElementById('f_phone').value = co.phone || '';
    document.getElementById('f_email').value = co.email || '';
    document.getElementById('f_website').value = co.website || '';
    document.getElementById('f_net').value = inv.total_tax_exclusive_cur ?? '';
    const rate = parseFloat(inv.calculation_rate) || 1;
    const taxTl = parseFloat(inv.tax_amount_tl);
    const taxSrc = Number.isFinite(taxTl) && rate > 0 ? taxTl / rate : '';
    document.getElementById('f_tax').value = taxSrc !== '' && !Number.isNaN(taxSrc) ? taxSrc : '';
    document.getElementById('f_total').value = inv.payable_amount_cur ?? '';
    document.getElementById('f_currency').value = inv.currency || 'TL';
    document.getElementById('f_kur').value = pack._kurXml != null ? pack._kurXml : '';
    document.getElementById('f_notes').value = inv.notes || '';

    const lineItemsBody = document.getElementById('lineItemsBody');
    lineItemsBody.innerHTML = '';
    pack.items.forEach((item) => {
        addLineItem(
            item.product_name,
            item.quantity,
            item.unit_price_cur,
            item.total_price_cur,
            item.tax_rate,
            item.product_code || '',
            '',
            false,
            '',
            ''
        );
    });
}

function parseUBL(xml) {
    try {
        const pack = buildInvoicePayloadFromXml(xml, currentView);
        currentParsedData = pack;
        applyParsedPayloadToForm(pack);
        const skuWarnings = (currentView === 'gelen' && Array.isArray(pack._skuWarnings))
            ? pack._skuWarnings
            : [];
        showXmlSuccess(pack.company.name, pack.company.vkn_tckn, skuWarnings);
    } catch (err) {
        console.error("XML Parsing Error:", err);
        if (err.message && (err.message.includes("HATA") || err.message.includes("Güvenlik"))) {
            alert(err.message);
        } else {
            alert("XML dosyası ayrıştırılamadı. Lütfen geçerli bir UBL-TR dosyası seçin.");
        }
    }
}

// --- TOPLU XML YÜKLEME ---
function bulkEscapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function updateBulkDirectionHint() {
    const el = document.getElementById('bulkDirectionHint');
    if (!el) return;
    const gelen = currentView === 'gelen';
    const aktif = gelen ? 'Gelen' : 'Giden';
    const diger = gelen ? 'Giden' : 'Gelen';
    el.textContent =
        `Şu an "${aktif} Faturalar" sekmesindesiniz. "Sisteme yükle" yalnızca ${aktif.toLowerCase()} yönüne uygun XML'leri kaydeder; ` +
        `"${diger}" sütunundaki dosyalar bu adımda kaydedilmez. Düzenleme yok; kayıttan sonra listeden açıp düzenleyebilirsiniz.`;
}

function openBulkUploadModal() {
    location.hash = 'bekleyen';
    setTimeout(() => switchBekPageTab('bulk'), 50);
}

function closeBulkUploadModal() { /* artık modal yok */ }

function renderBulkLists() {
    const inBody = document.getElementById('bulkIncomingBody');
    const outBody = document.getElementById('bulkOutgoingBody');
    const failBox = document.getElementById('bulkFailedBox');
    if (!inBody || !outBody) return;

    function rowHtml(entry, col) {
        const t = entry.pack.company?.name || entry.fileName;
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

    inBody.innerHTML = bulkIncoming.length
        ? bulkIncoming.map((e) => rowHtml(e, 'in')).join('')
        : '<div class="bulk-empty">Henüz yok</div>';
    outBody.innerHTML = bulkOutgoing.length
        ? bulkOutgoing.map((e) => rowHtml(e, 'out')).join('')
        : '<div class="bulk-empty">Henüz yok</div>';

    if (failBox) {
        failBox.innerHTML = bulkFailed.length
            ? `<div class="bulk-failed-inner"><strong>İşlenemedi (${bulkFailed.length})</strong><br>${bulkFailed.map((f) => `${bulkEscapeHtml(f.fileName)} — ${bulkEscapeHtml(f.reason)}`).join('<br>')}</div>`
            : '';
    }

    inBody.querySelectorAll('.bulk-row-del').forEach((btn) => {
        btn.onclick = () => removeBulkRow(btn.dataset.id);
    });
    outBody.querySelectorAll('.bulk-row-del').forEach((btn) => {
        btn.onclick = () => removeBulkRow(btn.dataset.id);
    });

    const saIn = document.getElementById('bulkSelAllIn');
    const saOut = document.getElementById('bulkSelAllOut');
    if (saIn) saIn.checked = false;
    if (saOut) saOut.checked = false;
}

function removeBulkRow(id) {
    bulkIncoming = bulkIncoming.filter((x) => x.id !== id);
    bulkOutgoing = bulkOutgoing.filter((x) => x.id !== id);
    renderBulkLists();
}

function clearBulkColumn(dir) {
    if (dir === 'in') bulkIncoming = [];
    else bulkOutgoing = [];
    renderBulkLists();
}

function bulkSelectAllInColumn(dir, checked) {
    const col = dir === 'in' ? 'in' : 'out';
    document.querySelectorAll(`.bulk-cb[data-col="${col}"]`).forEach((cb) => { cb.checked = !!checked; });
}

function bulkDeleteSelectedInColumn(dir) {
    const col = dir === 'in' ? 'in' : 'out';
    const toDelete = new Set();
    document.querySelectorAll(`.bulk-cb[data-col="${col}"]:checked`).forEach((cb) => {
        const row = cb.closest('.bulk-row');
        if (row?.dataset.id) toDelete.add(row.dataset.id);
    });
    toDelete.forEach((id) => removeBulkRow(id));
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
        try {
            text = await file.text();
        } catch (e) {
            bulkFailed.push({ fileName: file.name, reason: 'Dosya okunamadı' });
            continue;
        }
        let xmlDoc = null;
        try {
            xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
            if (xmlDoc.getElementsByTagName('parsererror').length) throw new Error('parse');
        } catch (e) {
            bulkFailed.push({ fileName: file.name, reason: 'XML çözülemedi' });
            continue;
        }

        const { supplier, customer } = getSupplierCustomerVknsFromDoc(xmlDoc);
        const dir = classifyInvoiceDirection(supplier, customer, bulkInokasVkn);
        if (dir === 'NEITHER') {
            bulkFailed.push({ fileName: file.name, reason: 'İnokas satıcı/alıcı olarak görünmüyor' });
            continue;
        }
        if (dir === 'BOTH') {
            bulkFailed.push({ fileName: file.name, reason: 'VKN çakışması' });
            continue;
        }

        const viewKey = dir === 'INCOMING' ? 'gelen' : 'giden';
        let pack = null;
        try {
            pack = buildInvoicePayloadFromXml(xmlDoc, viewKey);
        } catch (e) {
            bulkFailed.push({ fileName: file.name, reason: e.message || 'UBL ayrıştırma hatası' });
            continue;
        }

        const row = {
            id: (crypto.randomUUID && crypto.randomUUID()) || `bulk_${Date.now()}_${Math.random()}`,
            fileName: file.name,
            pack,
            direction: dir
        };
        if (dir === 'INCOMING') bulkIncoming.push(row);
        else bulkOutgoing.push(row);
    }

    renderBulkLists();
    if (ev.target) ev.target.value = '';
}

async function executeBulkUpload() {
    if (bulkUploadRunning) return;
    const queue = [...bulkIncoming, ...bulkOutgoing];
    if (!queue.length) {
        alert('Yüklenecek fatura yok. Önce XML dosyaları seçin.');
        return;
    }

    bulkUploadRunning = true;
    const succeeded = [];
    const errors = [];

    for (const entry of queue) {
        const view = entry.direction === 'INCOMING' ? 'gelen' : 'giden';
        const payload = {
            submit_view: view,
            parsed_view: view,
            is_bulk_upload: true,
            company: entry.pack.company,
            invoice: {
                ...entry.pack.invoice,
                status: 'unpaid',
                paid_amount: 0
            },
            xml_context: entry.pack.xml_context,
            items: entry.pack.items
        };
        try {
            const res = await fetch('/api/save-invoice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
            succeeded.push(entry.id);
        } catch (e) {
            const label = entry.pack.invoice?.invoice_no || entry.fileName;
            errors.push(`${label}: ${e.message}`);
        }
    }

    bulkIncoming = bulkIncoming.filter((e) => !succeeded.includes(e.id));
    bulkOutgoing = bulkOutgoing.filter((e) => !succeeded.includes(e.id));
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

// ─── RAPOR PANELİ (liste görünümü içinde) ────────────────────────────────────

async function renderReportPanel(invoices) {
    const emptyEl = document.getElementById('listChartsEmpty');
    const contentEl = document.getElementById('listChartsContent');
    if (!emptyEl || !contentEl) return;

    if (!invoices || invoices.length === 0) {
        emptyEl.style.display = 'flex';
        contentEl.style.display = 'none';
        _reportOpenDetailTr = null;
        return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = 'flex';

    const isGiden = currentView === 'giden';
    const fmt = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const productMap = new Map();
    invoices.forEach(inv => {
        const rate = invCalculationRate(inv);
        const isUSD = invBaseCurrencyIso(inv) !== 'TRY';
        (inv.invoice_items || []).forEach(item => {
            const code = String(item.product_code || item.sku || '').trim();
            const name = String(item.product_name || code || '').trim();
            if (!name || name.toUpperCase().includes('KARGO')) return;
            const key = code || name;
            const qty = parseFloat(item.quantity) || 0;
            const cur = parseFloat(item.total_price_cur) || 0;
            const usd = isUSD ? cur : (rate > 0 ? cur / rate : 0);
            const dir = inv.direction;
            const compName = inv.companies?.name || 'Bilinmeyen';

            const prev = productMap.get(key) || { code, name, inQty: 0, outQty: 0, inUsd: 0, outUsd: 0, companies: new Map() };
            if (dir === 'INCOMING') { prev.inQty += qty; prev.inUsd += usd; }
            else { prev.outQty += qty; prev.outUsd += usd; }
            const pc = prev.companies.get(compName) || { qty: 0, usd: 0 };
            if (dir === 'INCOMING') { pc.qty += qty; pc.usd += usd; }
            else { pc.qty += qty; pc.usd += usd; }
            prev.companies.set(compName, pc);
            productMap.set(key, prev);
        });
    });

    const sorted = [...productMap.values()].sort((a, b) =>
        (isGiden ? b.outUsd - a.outUsd : b.inUsd - a.inUsd)
    );

    const fifoMap = new Map();
    if (isGiden) {
        try {
            await ensureStocksSummaryLoaded();
            (_stocksSummaryCache?.products || []).forEach(p => {
                fifoMap.set(String(p.product_code || '').trim().toUpperCase(), parseFloat(p.fifo_gross_profit_usd) || 0);
            });
        } catch (e) { /* sessizce geç */ }
    }

    const totalCompanies = new Set(invoices.map(i => i.companies?.name).filter(Boolean)).size;
    const totalInQty = sorted.reduce((s, p) => s + p.inQty, 0);
    const totalOutQty = sorted.reduce((s, p) => s + p.outQty, 0);
    const totalUsd = sorted.reduce((s, p) => s + (isGiden ? p.outUsd : p.inUsd), 0);
    const totalFifo = isGiden ? [...fifoMap.values()].reduce((s, v) => s + v, 0) : null;

    const summaryEl = document.getElementById('reportSummary');
    if (summaryEl) {
        const fifoClass = isGiden && totalFifo !== null
            ? (totalFifo >= 0 ? 'report-kpi--profit' : 'report-kpi--loss')
            : '';
        summaryEl.innerHTML = `
            <div class="report-kpi"><div class="report-kpi-label">FATURA</div><div class="report-kpi-value">${invoices.length}</div></div>
            <div class="report-kpi"><div class="report-kpi-label">FİRMA</div><div class="report-kpi-value">${totalCompanies}</div></div>
            <div class="report-kpi"><div class="report-kpi-label">ALINAN TOPLAM ÜRÜN</div><div class="report-kpi-value">${totalInQty.toLocaleString('tr-TR')}</div></div>
            <div class="report-kpi"><div class="report-kpi-label">SATILAN TOPLAM ÜRÜN</div><div class="report-kpi-value">${totalOutQty.toLocaleString('tr-TR')}</div></div>
            <div class="report-kpi report-kpi--money"><div class="report-kpi-label">${isGiden ? 'CİRO' : 'HARCAMA'} USD</div><div class="report-kpi-value">$${fmt(totalUsd)}</div></div>
            ${isGiden && totalFifo !== null ? `<div class="report-kpi ${fifoClass}"><div class="report-kpi-label">FIFO KÂR</div><div class="report-kpi-value">$${fmt(totalFifo)}</div></div>` : ''}
        `;
    }

    const thead = document.getElementById('reportThead');
    if (thead) {
        thead.innerHTML = `<tr class="report-thead-row">
            <th class="report-th report-th-name">ÜRÜN</th>
            <th class="report-th report-th-num">ALINAN</th>
            <th class="report-th report-th-num">SATILAN</th>
            <th class="report-th report-th-num">${isGiden ? 'CİRO USD' : 'HARCAMA USD'}</th>
            ${isGiden ? '<th class="report-th report-th-num">FIFO KÂR</th>' : ''}
        </tr>`;
    }

    const tbody = document.getElementById('reportTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    _reportOpenDetailTr = null;

    sorted.forEach(prod => {
        const mainUsd = isGiden ? prod.outUsd : prod.inUsd;
        const codeKey = prod.code.toUpperCase();
        const fifoProfit = isGiden ? (fifoMap.has(codeKey) ? fifoMap.get(codeKey) : null) : null;
        const companies = [...prod.companies.entries()].sort((a, b) => b[1].usd - a[1].usd);
        const colSpan = isGiden ? 5 : 4;

        const tr = document.createElement('tr');
        tr.className = 'report-row';
        const fifoCell = isGiden
            ? `<td class="report-td report-td-num ${fifoProfit !== null ? (fifoProfit >= 0 ? 'report-profit' : 'report-loss') : ''}">${fifoProfit !== null ? '$' + fmt(fifoProfit) : '—'}</td>`
            : '';
        tr.innerHTML = `
            <td class="report-td report-td-name">
                <span class="report-chevron">›</span>
                <span class="report-prod-name">${prod.name}</span>
                ${prod.code && prod.code !== prod.name ? `<span class="report-prod-code">${prod.code}</span>` : ''}
            </td>
            <td class="report-td report-td-num">${prod.inQty.toLocaleString('tr-TR')}</td>
            <td class="report-td report-td-num">${prod.outQty.toLocaleString('tr-TR')}</td>
            <td class="report-td report-td-num report-td-money">$${fmt(mainUsd)}</td>
            ${fifoCell}
        `;

        const detailTr = document.createElement('tr');
        detailTr.className = 'report-detail-row';
        detailTr.style.display = 'none';

        const totalForPct = mainUsd || 1;
        const compRowsHtml = companies.map(([name, data]) => {
            const pct = ((data.usd / totalForPct) * 100).toFixed(1);
            return `<tr class="report-comp-row">
                <td class="report-comp-td report-comp-name">${name}</td>
                <td class="report-comp-td report-comp-num">${data.qty.toLocaleString('tr-TR')}</td>
                <td class="report-comp-td report-comp-num">$${fmt(data.usd)}</td>
                <td class="report-comp-td report-comp-pct">${pct}%</td>
                ${isGiden ? '<td></td>' : ''}
            </tr>`;
        }).join('');

        detailTr.innerHTML = `<td colspan="${colSpan}" class="report-detail-cell">
            <table class="report-comp-table">
                <thead>
                    <tr class="report-comp-head">
                        <th class="report-comp-th">${isGiden ? 'MÜŞTERİ' : 'TEDARİKÇİ'}</th>
                        <th class="report-comp-th report-comp-num">ADET</th>
                        <th class="report-comp-th report-comp-num">USD</th>
                        <th class="report-comp-th report-comp-num">PAY</th>
                        ${isGiden ? '<th></th>' : ''}
                    </tr>
                </thead>
                <tbody>${compRowsHtml}</tbody>
            </table>
        </td>`;

        tr.onclick = () => {
            if (_reportOpenDetailTr && _reportOpenDetailTr !== detailTr) {
                _reportOpenDetailTr.style.display = 'none';
                const prevTr = _reportOpenDetailTr.previousElementSibling;
                if (prevTr) prevTr.querySelector('.report-chevron')?.classList.remove('open');
            }
            const isOpen = detailTr.style.display !== 'none';
            detailTr.style.display = isOpen ? 'none' : 'table-row';
            tr.querySelector('.report-chevron')?.classList.toggle('open', !isOpen);
            _reportOpenDetailTr = isOpen ? null : detailTr;
        };

        tbody.appendChild(tr);
        tbody.appendChild(detailTr);
    });
}

// ─── RAPOR SAYFASI ───────────────────────────────────────────────────────────

function enterRaporView() {
    document.getElementById('faturaPage').style.display = 'none';
    document.getElementById('raporPage').style.display = 'flex';
    const bp = document.getElementById('bekleyenPage');
    if (bp) bp.style.display = 'none';
    renderRaporPage();
}

function exitRaporView() {
    const rp = document.getElementById('raporPage');
    if (rp) rp.style.display = 'none';
    const fp = document.getElementById('faturaPage');
    if (fp && fp.style.display === 'none') fp.style.display = 'flex';
}

function enterBekleyenView() {
    document.getElementById('faturaPage').style.display = 'none';
    const rp = document.getElementById('raporPage');
    if (rp) rp.style.display = 'none';
    const bp = document.getElementById('bekleyenPage');
    if (bp) { bp.style.display = 'flex'; bp.style.flexDirection = 'column'; }
    loadBekleyenInvoices();
}

function exitBekleyenView() {
    const bp = document.getElementById('bekleyenPage');
    if (bp) bp.style.display = 'none';
    const fp = document.getElementById('faturaPage');
    if (fp && fp.style.display === 'none') fp.style.display = 'flex';
}

function enterTopluView() { enterBekleyenView(); }
function exitTopluView()  { exitBekleyenView(); }

// ─── Bekleyen Faturalar Sayfası ───────────────────────────────────────────────

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
    const dp = document.getElementById('bekDetailPanel');
    if (dp) dp.style.display = 'none';
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
        return `<div class="bek-card${active}" data-id="${inv.id}" onclick="openFatDetailPage('${inv.id}')">
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
    const id = String(rawId);
    const inv = bekleyenCache.find(i => String(i.id) === id);
    if (!inv) return;

    activeBekId = id;

    document.querySelectorAll('.bek-card').forEach(r =>
        r.classList.toggle('bek-card--active', String(r.dataset.id) === id)
    );

    const dp = document.getElementById('bekDetailPanel');
    if (!dp) return;
    dp.style.display = '';

    const isGelen = inv.direction === 'INCOMING';
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

    // pdf_url varsa direkt native PDF viewer (loadDetailPdfInto ile aynı mantık)
    if (inv?.pdf_url) {
        if (empty) empty.style.display = 'none';
        if (spinner) spinner.style.display = 'none';
        iframe.style.display = 'block';
        iframe.src = inv.pdf_url;
        return;
    }

    if (!inv?.xml_url) {
        if (empty) empty.style.display = 'block';
        if (spinner) spinner.style.display = 'none';
        iframe.style.display = 'none';
        return;
    }

    if (_bekPdfCache[id]) {
        if (empty) empty.style.display = 'none';
        if (spinner) spinner.style.display = 'none';
        iframe.style.display = 'block';
        await renderXmlToPdfIframe(_bekPdfCache[id], iframe);
        return;
    }

    if (empty) empty.style.display = 'none';
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
    activeBekId = id;
    activeBekInfoTab = tab;
    document.getElementById(`bekItab_bilgiler_${id}`)?.classList.toggle('bek-itab--active', tab === 'bilgiler');
    document.getElementById(`bekItab_urunler_${id}`)?.classList.toggle('bek-itab--active', tab === 'urunler');

    const inv = bekleyenCache.find(i => String(i.id) === id);
    if (!inv) return;
    const body = document.getElementById(`bekInfoBody_${id}`);
    if (!body) return;

    if (tab === 'bilgiler') enterBilgilerEdit(id);
    else                    enterUrunlerEdit(id);
}

async function importPendingInvoice(rawId) {
    const id  = String(rawId);
    const inv = bekleyenCache.find(i => String(i.id) === id);
    const label = inv?.invoice_no || id;
    if (!confirm(`"${label}" faturasını sisteme aktarmak istediğinizden emin misiniz?`)) return;

    try {
        const res = await fetch(`/api/invoices/${encodeURIComponent(id)}/approve`, { method: 'PUT' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);

        bekleyenCache = bekleyenCache.filter(i => String(i.id) !== id);
        if (String(activeBekId) === id) {
            activeBekId = null;
            const dp = document.getElementById('bekDetailPanel');
            if (dp) dp.style.display = 'none';
        }
        renderBekleyenList();
        refreshData(true);
    } catch (e) {
        alert('Aktarım hatası: ' + e.message);
    }
}

// ─── RAPOR SAYFASI (tam sayfa) ────────────────────────────────────────────────

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
        const rate = invCalculationRate(inv);
        const isUSD = invBaseCurrencyIso(inv) !== 'TRY';
        (inv.invoice_items || []).forEach(item => {
            const code = String(item.product_code || item.sku || '').trim();
            const name = String(item.product_name || code || '').trim();
            if (!name || name.toUpperCase().includes('KARGO')) return;
            const key = code || name;
            const qty = parseFloat(item.quantity) || 0;
            const cur = parseFloat(item.total_price_cur) || 0;
            const usd = isUSD ? cur : (rate > 0 ? cur / rate : 0);
            const dir = inv.direction;
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
        name: p => p.name.toLowerCase(),
        inQty: p => p.inQty,
        outQty: p => p.outQty,
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
        const fa = colFn[raporSort.col](a);
        const fb = colFn[raporSort.col](b);
        const cmp = typeof fa === 'string' ? fa.localeCompare(fb, 'tr') : fa - fb;
        return raporSort.dir === 'asc' ? cmp : -cmp;
    });

    const fmtN = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtInt = n => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 });
    const fmtUsd = n => '$' + fmtInt(n);

    const uniqueComps = new Set(source.map(i => i.companies?.name).filter(Boolean)).size;
    const totalInQty = products.reduce((s, p) => s + p.inQty, 0);
    const totalOutQty = products.reduce((s, p) => s + p.outQty, 0);
    const totalUsd = products.reduce((s, p) => s + mainUsdOf(p), 0);

    const usdLabel = raporMode === 'giden' ? 'CİRO USD' : 'HARCAMA USD';

    const modeInvoices   = raporMode === 'giden'
        ? all.filter(i => i.direction === 'OUTGOING')
        : all.filter(i => i.direction === 'INCOMING');
    const modeCompLabel  = raporMode === 'giden' ? 'MÜŞTERİ' : 'TEDARİKÇİ';
    const uniqueCompsMode = new Set(modeInvoices.map(i => i.companies?.name).filter(Boolean)).size;

    const kpisHtml = `
        <div class="rapor-kpi"><p class="rapor-kpi-label">FATURA</p><p class="rapor-kpi-value">${fmtInt(modeInvoices.length)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">${modeCompLabel}</p><p class="rapor-kpi-value">${fmtInt(uniqueCompsMode)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">ALINAN ADET</p><p class="rapor-kpi-value">${fmtInt(totalInQty)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">SATILAN ADET</p><p class="rapor-kpi-value">${fmtInt(totalOutQty)}</p></div>
        <div class="rapor-kpi"><p class="rapor-kpi-label">${usdLabel}</p><p class="rapor-kpi-value" style="color:#2563eb;">${fmtUsd(totalUsd)}</p></div>`;
    document.getElementById('raporKpis').innerHTML = kpisHtml;

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
        ${thHtml('usd', usdLabel, 'rapor-th-num')}
    </tr>`;

    const tbody = document.getElementById('raporTbody');
    tbody.innerHTML = '';
    _raporOpenDetailTr = null;
    const colSpan = 4;

    products.forEach(prod => {
        const mUsd = mainUsdOf(prod);
        const compMap  = raporMode === 'giden' ? prod.customers : prod.suppliers;
        const compList = [...compMap.entries()].sort((a, b) => b[1].usd - a[1].usd);
        const totalPct = mUsd || 1;
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
            <td class="rapor-td rapor-td-num rapor-td-money">$${fmtN(mUsd)}</td>
        `;

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

// ─── Rapor Filtre Dropdown'ları ───────────────────────────────────────────────

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

function toggleRaporCompDropdown() {
    const panel = document.getElementById('raporCompDropPanel');
    const search = document.getElementById('raporCompDropSearch');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    if (isOpen) {
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
    const hidden = document.getElementById('raporFilterCompany');
    if (hidden) hidden.value = val;
    const lbl = document.getElementById('raporCompDropLabel');
    if (lbl) lbl.textContent = val || 'Tüm Firmalar';
    const btn = document.getElementById('raporCompDropBtn');
    if (btn) btn.style.color = val ? '#0f172a' : '#374151';
    _closeRaporCompDropdown();
    renderRaporPage();
}

function toggleRaporProdDropdown() {
    const panel = document.getElementById('raporProdDropPanel');
    const search = document.getElementById('raporProdDropSearch');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    if (isOpen) {
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
    const hidden = document.getElementById('raporFilterProduct');
    if (hidden) hidden.value = val;
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
    document.getElementById('raporFilterCompany')?.setAttribute('value', '');
    const prodLbl = document.getElementById('raporProdDropLabel');
    if (prodLbl) prodLbl.textContent = 'Tüm Ürünler';
    const prodBtn = document.getElementById('raporProdDropBtn');
    if (prodBtn) prodBtn.style.color = '#374151';
    document.getElementById('raporFilterProduct')?.setAttribute('value', '');
    renderRaporPage();
}

// ─────────────────────────────────────────────────────────────────────────────

async function saveInvoiceToDatabase(e) {
    e.preventDefault();
    if (isInvoiceSaveInFlight) {
        alert("Kaydetme işlemi devam ediyor, lütfen bekleyin.");
        return;
    }
    const invoiceId = document.getElementById('f_id')?.value;
    const fin = readInvoiceFinancialsFromForm();
    const formCurrency = document.getElementById('f_currency')?.value?.trim() || 'TL';

    const lineRows = document.querySelectorAll('#lineItemsBody tr');
    let itemsFromForm = [];
    try {
        itemsFromForm = Array.from(lineRows).map((row) => {
            const cells = row.querySelectorAll('td');
            const productName = row.querySelector('td:first-child input[type="text"]')?.value?.trim() || cells[0]?.innerText?.trim() || 'İsimsiz Ürün';
            const qtyInput = row.querySelector('input[type="number"]');
            const numberInputs = row.querySelectorAll('input[type="number"]');
            const qty = parseFloat(qtyInput?.value || cells[2]?.innerText || 0) || 0;
            const unitPrice = parseFloat(numberInputs[1]?.value || cells[3]?.innerText || 0) || 0;
            const lineTotal = qty * unitPrice;
            const taxRate = parseFloat(row.querySelector('.tax-rate-val')?.value || cells[5]?.innerText || 0) || 0;
            const internalToggle = row.querySelector('.internal-toggle');
            const isInternal = internalToggle ? !!internalToggle.checked : false;
            const rowCategoryVal = row.querySelector('.line-category-select')?.value?.trim() || '';
            const skuVal = row.querySelector('.line-sku-val')?.value?.trim() || '';
            const poItemId = row.querySelector('.po-item-id-val')?.value || null;
            if (isInternal && !rowCategoryVal) {
                throw new Error(`Ofis içi ürünlerde kategori zorunlu: ${productName}`);
            }
            return {
                product_name: productName,
                product_code: skuVal || null,
                quantity: qty,
                unit_code: 'ADET',
                unit_price_cur: unitPrice,
                tax_rate: taxRate,
                total_price_cur: lineTotal,
                currency: formCurrency,
                is_internal: isInternal,
                internal_category: isInternal ? rowCategoryVal : null,
                product_category: !isInternal ? (rowCategoryVal || null) : null,
                purchase_order_item_id: poItemId
            };
        }).filter(item => item.product_name && item.quantity > 0);
    } catch (mapErr) {
        alert(mapErr.message || 'Ürün satırları doğrulanamadı.');
        return;
    }

    if (invoiceId) {
        const updatePayload = {
            update_stock: document.getElementById('f_update_stock')?.checked !== false,
            invoice: {
                due_date: document.getElementById('f_due_date')?.value || null,
                notes: document.getElementById('f_notes')?.value || '',
                invoice_type: document.getElementById('f_type')?.value || 'Ticari',
                invoice_no: document.getElementById('f_no')?.value || '',
                invoice_date: document.getElementById('f_date')?.value || null,
                ...fin
            },
            company: {
                vkn_tckn: document.getElementById('f_vkn')?.value?.trim() || '',
                name: document.getElementById('f_firma')?.value?.trim() || '',
                tax_office: document.getElementById('f_tax_office')?.value?.trim() || '',
                phone: document.getElementById('f_phone')?.value?.trim() || '',
                email: document.getElementById('f_email')?.value?.trim() || '',
                website: document.getElementById('f_website')?.value?.trim() || '',
                address: document.getElementById('f_address')?.value?.trim() || ''
            },
            items: itemsFromForm
        };

        try {
            isInvoiceSaveInFlight = true;
            const response = await fetch(`/api/invoices/${invoiceId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatePayload)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Güncelleme hatası");
            alert(result.message || "Fatura başarıyla güncellendi.");
            clearStockCaches();
            closeInvoiceModal();
            refreshData(true);
            return;
        } catch (err) {
            console.error("Güncelleme Hatası:", err.message);
            alert("Hata oluştu: " + err.message);
            return;
        } finally {
            isInvoiceSaveInFlight = false;
        }
    }

    if (!currentParsedData) {
        alert("Lütfen önce bir XML yükleyin!");
        return;
    }

    const itemsToSave = itemsFromForm;

    const companyFromUi = {
        vkn_tckn: document.getElementById('f_vkn')?.value?.trim() || '',
        name: document.getElementById('f_firma')?.value?.trim() || '',
        tax_office: document.getElementById('f_tax_office')?.value?.trim() || '',
        phone: document.getElementById('f_phone')?.value?.trim() || '',
        email: document.getElementById('f_email')?.value?.trim() || '',
        website: document.getElementById('f_website')?.value?.trim() || '',
        address: document.getElementById('f_address')?.value?.trim() || ''
    };

    const invoiceFromUi = {
        ...fin,
        invoice_no: document.getElementById('f_no')?.value || '',
        invoice_type: document.getElementById('f_type')?.value || 'Ticari',
        invoice_date: document.getElementById('f_date')?.value || null,
        due_date: document.getElementById('f_due_date')?.value || null,
        status: 'unpaid',
        paid_amount: 0,
        paid_amount_cur: 0,
        notes: document.getElementById('f_notes')?.value || ''
    };

    const payload = {
        submit_view: currentView,
        parsed_view: currentParsedData.parsed_view || null,
        update_stock: document.getElementById('f_update_stock')?.checked !== false,
        company: { ...(currentParsedData.company || {}), ...companyFromUi },
        invoice: { ...currentParsedData.invoice, ...invoiceFromUi },
        xml_context: currentParsedData.xml_context || null,
        items: itemsToSave
    };

    try {
        isInvoiceSaveInFlight = true;
        const response = await fetch('/api/save-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
            const errorObj = new Error(result.error || "Sunucu hatası");
            errorObj.code = result.errorCode;
            throw errorObj;
        }
        alert(result.message);
        clearStockCaches();
        closeInvoiceModal();
        refreshData(true);
    } catch (err) {
        console.error("Kayıt Hatası:", err.message);
        if (err.code === '23505') {
            alert("⚠️ BU FATURA DAHA ÖNCE YÜKLENMİŞ!\nSistemde aynı faturadan zaten bulunduğu için tekrar kaydedilemez.");
        } else {
            alert("Hata oluştu: " + err.message);
        }
    } finally {
        isInvoiceSaveInFlight = false;
    }
}

async function deleteInvoice(id) {
    if (!confirm("⚠️ Bu faturayı ve içerisindeki tüm ürünleri silmek istediğinize emin misiniz?\nBu işlem geri alınamaz!")) return;

    try {
        const response = await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error("Silinemedi");

        alert("✅ Fatura başarıyla silindi!");

        const isBekleyen = bekleyenCache.some(i => i.id === id);
        if (isBekleyen) {
            bekleyenCache = bekleyenCache.filter(i => i.id !== id);
            if (activeBekId === id) {
                activeBekId = null;
                const dp = document.getElementById('bekDetailPanel');
                if (dp) dp.style.display = 'none';
            }
            renderBekleyenList();
        } else {
            closeInvoiceDetailModal();
            refreshData(true);
        }
    } catch (err) {
        console.error("Silme hatası:", err);
        alert("Fatura silinirken bir ağ hatası oluştu.");
    }
}

async function fetchTCMBKur() {
    const kurInput = document.getElementById('f_kur');
    const currency = document.getElementById('f_currency').value;

    if (currency === 'TL' || currency === 'TRY') {
        kurInput.value = 1.0000;
        alert("TL için kur her zaman 1'dir.");
        return;
    }

    kurInput.placeholder = "Yükleniyor...";

    try {
        const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent('https://www.tcmb.gov.tr/kurlar/today.xml')}`);
        if (!response.ok) throw new Error("Ağ hatası");

        const str = await response.text();
        const xmlDoc = new window.DOMParser().parseFromString(str, "text/xml");
        const currencies = xmlDoc.getElementsByTagName("Currency");
        let found = false;

        for (let i = 0; i < currencies.length; i++) {
            if (currencies[i].getAttribute("CurrencyCode") === currency) {
                const forexSelling = currencies[i].getElementsByTagName("ForexSelling")[0]?.textContent;
                if (forexSelling) {
                    kurInput.value = parseFloat(forexSelling).toFixed(4);
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            alert(currency + " kuru TCMB listesinde bulunamadı.");
            kurInput.placeholder = "0.0000";
        }
    } catch (err) {
        console.error('TCMB Kur çekme hatası:', err);
        alert("TCMB verisi alınırken ağ hatası oluştu. Lütfen manuel giriniz.");
        kurInput.placeholder = "0.0000";
    }
}

function recalcInvoiceTotalsFromLines() {
    const rows = document.querySelectorAll('#lineItemsBody tr');
    let totalNet = 0;
    let totalTax = 0;

    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('td:nth-child(3) input[type="number"]')?.value) || 0;
        const price = parseFloat(row.querySelector('td:nth-child(4) input[type="number"]')?.value) || 0;
        const taxRate = parseFloat(row.querySelector('.tax-rate-val')?.value) || 0;
        const lineNet = qty * price;
        totalNet += lineNet;
        totalTax += lineNet * taxRate / 100;
    });

    const netEl = document.getElementById('f_net');
    const taxEl = document.getElementById('f_tax');
    const totalEl = document.getElementById('f_total');
    if (netEl) netEl.value = totalNet.toFixed(2);
    if (taxEl) taxEl.value = totalTax.toFixed(2);
    if (totalEl) totalEl.value = (totalNet + totalTax).toFixed(2);
}

const INTERNAL_CATEGORY_OPTIONS = [
    'teknoloji',
    'araç & yakıt',
    'elektrik & doğalgaz',
    'iletişim',
    'yemek & mutfak',
    'güvenlik',
    'diğer'
];

function getRowCategoryOptions(isInternal) {
    if (isInternal) return INTERNAL_CATEGORY_OPTIONS;
    return productCategoryOptionList;
}

function renderRowCategorySelect(selectEl, isInternal, value = '') {
    if (!selectEl) return;
    const options = getRowCategoryOptions(isInternal);
    const selectedValue = String(value || '').trim();
    const placeholder = isInternal ? 'Ofis içi kategorisi seçin' : 'Ürün kategorisi seçin';
    const addNewOptionHtml = isInternal ? '' : '<option value="__add_new_category__">+ Yeni kategori ekle</option>';
    selectEl.innerHTML = [
        `<option value="">${placeholder}</option>`,
        ...options.map((opt) => {
            const selectedAttr = opt === selectedValue ? ' selected' : '';
            return `<option value="${opt}"${selectedAttr}>${opt}</option>`;
        }),
        addNewOptionHtml
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
    if ([...categorySelect.options].some((o) => o.value === category)) {
        categorySelect.value = category;
    }
}

function addLineItem(
    desc = '',
    qty = 1,
    price = 0,
    total = 0,
    taxRate = 20,
    sku = '',
    linkedPoItemId = '',
    isInternal = false,
    internalCategory = '',
    productCategory = ''
) {
    const selectedInternalCategory = String(internalCategory || '').trim().toLocaleLowerCase('tr-TR');
    const selectedProductCategory = String(productCategory || '').trim();
    const initialCategory = isInternal ? selectedInternalCategory : selectedProductCategory;

    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" value="${desc}" placeholder="Ürün adı"></td>
        <td><input type="text" class="line-sku-val" placeholder="Ürün kodu" title="XML / sku" style="width:100%;font-size:13px;"></td>
        <td><input type="number" value="${qty}" class="text-center"></td>
        <td><input type="number" value="${price}" step="0.01"></td>
        <td><input type="number" value="${total}" step="0.01" readonly></td>
        <td class="text-center line-internal-cell">
            <label class="line-internal-toggle-row">
                <input type="checkbox" class="internal-toggle" title="Şirket İçi Kullanım (Sarf)" ${isInternal ? 'checked' : ''}>
                <span>Ofis İçi</span>
            </label>
            <input type="hidden" class="tax-rate-val" value="${taxRate}">
            <input type="hidden" class="po-item-id-val" value="${linkedPoItemId || ''}">
        </td>
        <td>
            <select class="line-category-select"></select>
            <div class="line-category-quick-add" style="display:none; margin-top:6px; align-items:center; gap:6px;">
                <input type="text" class="line-category-quick-input" placeholder="Kategori yazın" style="font-size:12px; padding:5px 8px; border:1px solid #cbd5e1; border-radius:6px;">
                <button type="button" class="line-category-quick-save" title="Ekle" style="width:26px; height:26px; border:none; border-radius:6px; background:#16a34a; color:#fff; font-weight:700; cursor:pointer;">✓</button>
                <button type="button" class="line-category-quick-cancel" title="İptal" style="width:26px; height:26px; border:none; border-radius:6px; background:#ef4444; color:#fff; font-weight:700; cursor:pointer;">✕</button>
            </div>
        </td>
        <td style="min-width:60px;">
            <button type="button" class="btn-text" onclick="this.closest('tr').remove(); recalcInvoiceTotalsFromLines();" style="color:var(--danger); float:right;">✕</button>
            <div class="po-badge-container" style="clear:both; margin-top:4px;"></div>
        </td>
    `;
    const skuInput = row.querySelector('.line-sku-val');
    const internalToggle = row.querySelector('.internal-toggle');
    const categorySelect = row.querySelector('.line-category-select');
    const quickAddWrap = row.querySelector('.line-category-quick-add');
    const quickAddInput = row.querySelector('.line-category-quick-input');
    const quickAddSave = row.querySelector('.line-category-quick-save');
    const quickAddCancel = row.querySelector('.line-category-quick-cancel');
    if (skuInput) {
        skuInput.value = String(sku ?? '').trim();
        skuInput.addEventListener('input', () => checkPendingOrdersForRow(row));
        skuInput.addEventListener('blur', () => applySkuBasedProductCategory(row, skuInput.value));
    }
    if (internalToggle && categorySelect) {
        const syncRowCategoryOptions = () => {
            const previous = String(categorySelect.value || '').trim();
            renderRowCategorySelect(categorySelect, internalToggle.checked, previous || initialCategory);
            if (!internalToggle.checked) {
                applySkuBasedProductCategory(row, skuInput?.value || '');
            }
            if (internalToggle.checked && quickAddWrap) {
                quickAddWrap.style.display = 'none';
            }
        };
        categorySelect.addEventListener('change', () => {
            if (categorySelect.value !== '__add_new_category__') return;
            if (internalToggle.checked) return;
            categorySelect.value = '';
            if (quickAddWrap) quickAddWrap.style.display = 'flex';
            if (quickAddInput) {
                quickAddInput.value = '';
                quickAddInput.focus();
            }
        });
        quickAddSave?.addEventListener('click', () => {
            const next = String(quickAddInput?.value || '').trim();
            if (!next) return;
            if (!productCategoryOptionList.includes(next)) {
                productCategoryOptionList.push(next);
                productCategoryOptionList.sort((a, b) => a.localeCompare(b, 'tr'));
            }
            renderRowCategorySelect(categorySelect, false, next);
            if (quickAddWrap) quickAddWrap.style.display = 'none';
        });
        quickAddCancel?.addEventListener('click', () => {
            if (quickAddWrap) quickAddWrap.style.display = 'none';
        });
        internalToggle.addEventListener('change', syncRowCategoryOptions);
        syncRowCategoryOptions();
    }

    const qtyInput = row.querySelector('td:nth-child(3) input[type="number"]');
    const priceInput = row.querySelector('td:nth-child(4) input[type="number"]');
    const totalInput = row.querySelector('td:nth-child(5) input[type="number"]');

    const recalcLineTotal = () => {
        const qtyVal = parseFloat(qtyInput?.value) || 0;
        const priceVal = parseFloat(priceInput?.value) || 0;
        totalInput.value = (qtyVal * priceVal).toFixed(2);
        recalcInvoiceTotalsFromLines();
    };

    qtyInput?.addEventListener('input', recalcLineTotal);
    priceInput?.addEventListener('input', recalcLineTotal);

    document.getElementById('lineItemsBody').appendChild(row);
    recalcLineTotal();

    checkPendingOrdersForRow(row);
    ensureProductCategoryLookupLoaded().then(() => {
        if (categorySelect && internalToggle) {
            renderRowCategorySelect(categorySelect, internalToggle.checked, initialCategory);
            if (!internalToggle.checked) applySkuBasedProductCategory(row, skuInput?.value || '');
        }
    }).catch(() => { });
}

async function fetchPendingOrdersForCompany(companyVknOrId) {
    if (!companyVknOrId) {
        currentPendingOrders = [];
        updateAllRowsWithPendingOrders();
        return;
    }

    try {
        const res = await fetch(`/api/purchase-orders/pending-by-vkn?vkn=${encodeURIComponent(companyVknOrId)}`);
        if (res.ok) {
            currentPendingOrders = await res.json();
        } else {
            currentPendingOrders = [];
        }
    } catch (e) {
        console.error("Backorder çekilirken hata:", e);
        currentPendingOrders = [];
    }

    updateAllRowsWithPendingOrders();
}

function updateAllRowsWithPendingOrders() {
    const rows = document.querySelectorAll('#lineItemsBody tr');
    rows.forEach(row => checkPendingOrdersForRow(row));
}

function clearStockCaches() {
    try {
        sessionStorage.removeItem('inokas_stock_v2');
        sessionStorage.removeItem('inokas_movements_v1');
        sessionStorage.removeItem('inokas_pending_po_v1');
        sessionStorage.removeItem('inokas_stock_summary_v1');
    } catch (e) {
        console.warn('Stok cache temizlenemedi:', e);
    }
}

function checkPendingOrdersForRow(row) {
    const badgeContainer = row.querySelector('.po-badge-container');
    const skuInput = row.querySelector('.line-sku-val');
    const hiddenIdInput = row.querySelector('.po-item-id-val');

    if (!badgeContainer || !skuInput || !hiddenIdInput) return;

    if (hiddenIdInput.value) {
        const linkedPo = currentPendingOrders.find(po => po.id === hiddenIdInput.value);
        const linkedPoNo = linkedPo?.purchase_orders?.po_number || 'Sipariş';
        const linkedInfo = document.createElement('div');
        linkedInfo.style.cssText = 'font-size:11px; color:#16a34a; font-weight:600; margin-top:4px;';
        linkedInfo.innerHTML = `✅ ${linkedPoNo} bağlı`;
        badgeContainer.innerHTML = '';
        badgeContainer.appendChild(linkedInfo);
        return;
    }

    badgeContainer.innerHTML = '';
    const sku = (skuInput.value || '').trim().toLowerCase();

    if (!sku || currentPendingOrders.length === 0) return;

    const matchedItems = currentPendingOrders
        .filter(po =>
            po.products &&
            (po.products.product_code || '').toLowerCase() === sku &&
            (Number(po.ordered_qty) - Number(po.received_qty)) > 0
        )
        .sort((a, b) => {
            const da = String(a.purchase_orders?.order_date || '');
            const db = String(b.purchase_orders?.order_date || '');
            return da.localeCompare(db);
        });

    if (matchedItems.length === 0) return;

    const buildLinkButton = (getSelectedPoItem) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-text';
        btn.style.cssText = 'font-size:11px; color:#0ea5e9; font-weight:600; padding:2px 6px; background:rgba(14,165,233,0.1); border-radius:4px; margin-top:4px;';
        btn.innerHTML = `🔗 Siparişe Bağla`;
        btn.onclick = () => {
            const poItem = getSelectedPoItem();
            if (!poItem) return;
            hiddenIdInput.value = poItem.id;
            btn.style.color = '#16a34a';
            btn.style.background = 'rgba(22,163,74,0.1)';
            btn.innerHTML = `✅ ${poItem.purchase_orders?.po_number || 'Sipariş'} bağlandı`;
            btn.disabled = true;
        };
        return btn;
    };

    if (matchedItems.length === 1) {
        const only = matchedItems[0];
        const remaining = Number(only.ordered_qty) - Number(only.received_qty);
        const info = document.createElement('div');
        info.style.cssText = 'font-size:10px; color:#0369a1; margin-top:2px;';
        info.textContent = `${only.purchase_orders?.po_number || 'PO'} • Bekleyen: ${remaining}`;
        badgeContainer.appendChild(info);
        badgeContainer.appendChild(buildLinkButton(() => only));
        return;
    }

    const select = document.createElement('select');
    select.style.cssText = 'width:100%; margin-top:4px; font-size:11px; padding:4px 6px; border:1px solid #bae6fd; border-radius:4px; color:#0f172a; background:#f0f9ff;';

    matchedItems.forEach((poItem, idx) => {
        const remaining = Number(poItem.ordered_qty) - Number(poItem.received_qty);
        const option = document.createElement('option');
        option.value = poItem.id;
        option.textContent = `${poItem.purchase_orders?.po_number || `PO-${idx + 1}`} • Bekleyen: ${remaining}`;
        select.appendChild(option);
    });

    const help = document.createElement('div');
    help.style.cssText = 'font-size:10px; color:#0369a1; margin-top:2px;';
    help.textContent = `${matchedItems.length} açık sipariş bulundu`;

    badgeContainer.appendChild(help);
    badgeContainer.appendChild(select);
    badgeContainer.appendChild(buildLinkButton(() => matchedItems.find(x => x.id === select.value) || matchedItems[0]));
}

function showXmlSuccess(firma, vkn, skuWarnings = []) {
    const previewPane = document.getElementById('previewPane');
    const warningHtml = Array.isArray(skuWarnings) && skuWarnings.length
        ? `
        <div id="skuWarningCard" class="sku-warning-card">
            <div class="sku-warning-head">
                <div class="sku-warning-title">Dikkat: Yeni urun kodu olabilir</div>
                <button type="button" class="sku-warning-close" onclick="document.getElementById('skuWarningCard')?.remove()">Kapat</button>
            </div>
            <div class="sku-warning-text">
                Asagidaki kodlar products tablosunda kayitli degil. XML'den geldigi gibi satira yazildi:
            </div>
            <div class="sku-warning-chips">
                ${skuWarnings.map((x) => `<span class="sku-warning-chip">${String(x || '').replace(/[<>&"]/g, '')}</span>`).join('')}
            </div>
        </div>`
        : '';
    previewPane.innerHTML = `
        <div class="xml-success-strip">
            <span class="xml-success-icon">✓</span>
            <span class="xml-success-firma">${firma}</span>
            <span class="xml-success-vkn">VKN: ${vkn || '—'}</span>
            <button onclick="resetXmlStrip()" class="xml-success-remove">
                Dosyayı Kaldır
            </button>
        </div>
        ${warningHtml}
    `;
}

function resetXmlStrip() {
    const previewPane = document.getElementById('previewPane');
    previewPane.innerHTML = `
        <div id="dropZone" class="upload-box-compact">
            <input type="file" id="xmlInput" accept=".xml" hidden>
            <span class="upload-icon-sm">📄</span>
            <span>UBL-XML ile otomatik doldur (opsiyonel) — sürükleyin veya seçin</span>
            <button class="btn btn-primary btn-sm" onclick="document.getElementById('xmlInput').click()">Dosya Seç</button>
        </div>
        <div id="xmlDataSummary" class="xml-data-view" style="display:none;"></div>`;
    setupEventListeners();
}


async function approveDetailInvoice(id) {
    if(!confirm("Bu faturayı aktarmak istiyor musunuz?")) return;
    try {
        const res = await fetch('/api/invoices/' + id + '/approve', { method: 'PUT' });
        if(!res.ok) throw new Error("Onayla HTTP " + res.status);
        if(typeof bekleyenCache !== 'undefined') {
            bekleyenCache = bekleyenCache.filter(i => String(i.id) !== id);
        }
        renderBekleyenList();
        refreshData(true);
        closeFatDetailPage(); // Onaylandığı için kapatıyoruz
    } catch (e) { alert("Hata: " + e.message); }
}

async function rejectDetailInvoice(id) {
    if(!confirm("Faturayı tamamen silmek (reddetmek) istiyor musunuz?")) return;
    try {
        const res = await fetch('/api/invoices/' + id, { method: 'DELETE' });
        if(!res.ok) throw new Error("Sil HTTP " + res.status);
        if(typeof bekleyenCache !== 'undefined') {
            bekleyenCache = bekleyenCache.filter(i => String(i.id) !== id);
        }
        renderBekleyenList();
        closeFatDetailPage(); // Silindiği için kapatıyoruz
    } catch (e) { alert("Hata: " + e.message); }
}
