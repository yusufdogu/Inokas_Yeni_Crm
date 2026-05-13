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
    initFatFilters();

    const initHash = location.hash.slice(1);
    if (initHash === 'giden' || window._FAT_INITIAL_VIEW === 'giden') currentView = 'giden';
    else currentView = 'gelen';

    showAllState.gelen = true;
    showAllState.giden = true;
    interactedState.gelen = true;
    interactedState.giden = true;

    updateActionButtonsTheme();
    refreshData(false);

    if (initHash === 'ekle') enterEkleView();

    window.addEventListener('hashchange', () => {
        const h = location.hash.slice(1);
        closeFatDetailPage();
        if (h === 'ekle') {
            enterEkleView();
        } else {
            if (document.body.classList.contains('view-ekle')) exitEkleView();
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
    if (xmlInput) xmlInput.addEventListener('change', handleFileUpload);

    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--success)'; });
        dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--primary)'; });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length) handleFileUpload({ target: { files } });
        });
    }
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

        closeInvoiceDetailModal();
        refreshData(true);
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


window.approveDetailInvoice = async function(id) {
    const btn = document.querySelector(`[onclick="approveDetailInvoice('${id}')"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Aktarılıyor...'; }

    try {
        const res = await fetch(`/api/invoices/${id}/approve`, { method: 'PUT' });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d?.error || 'Onay başarısız');
        }

        // Redirect back to the correct bekleyen page — it will refresh automatically
        const isIn = String(_detayInv?.direction || '').toUpperCase() === 'INCOMING';
        window.location.href = isIn
            ? '/faturalar/pages/bekleyen-gelen.html'
            : '/faturalar/pages/bekleyen-giden.html';

    } catch (err) {
        alert(`Hata: ${err.message}`);
        if (btn) { btn.disabled = false; btn.textContent = 'Aktar'; }
    }
};

async function rejectDetailInvoice(id) {
    if(!confirm("Faturayı tamamen silmek (reddetmek) istiyor musunuz?")) return;
    try {
        const res = await fetch('/api/invoices/' + id, { method: 'DELETE' });
        if(!res.ok) throw new Error("Sil HTTP " + res.status);
        closeFatDetailPage();
    } catch (e) { alert("Hata: " + e.message); }
}
