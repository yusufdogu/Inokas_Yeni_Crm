// Filtrelerin Sekmelere Özel Hafızası (Her sekme kendi seçimini yazar)
// index.html içindeki script ?v= ile aynı tut (deploy sonrası hangi bundle çalışıyor görmek için)
const FATURALAR_BUILD = '20260420-recalc-fix';
console.info('[faturalar] bundle', FATURALAR_BUILD);

const filterMemory = {
    gelen: { search: '', company: '', currency: '', year: '', month: '', status: '' },
    giden: { search: '', company: '', currency: '', year: '', month: '', status: '' }
};




// --- CONFIG & STATE ---
const ns = {
    cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
};
// We read invoice data from UBL-XML nodes (not from a "title").
// UBL defines a standard XML structure for e-invoice data exchange.
// cbc = basic values (ID, Date, Amount, Name, etc.)
// cac = aggregate structures (Party, Address, TaxTotal, InvoiceLine, etc.)

/**
 * XML’deki “ürün kodu” bilgisini okur; `invoice_items.product_code` alanına yazılır.
 * Öncelik: satıcı ürün kodu → yoksa standart kimlik (ör. barkod/GTIN).
 * - cac:Item/cac:SellersItemIdentification/cbc:ID
 * - cac:Item/cac:StandardItemIdentification/cbc:ID
 */
function parseProductCodeForSku(itemNode) {
    if (!itemNode) return '';
    const seller = itemNode.getElementsByTagNameNS(ns.cac, 'SellersItemIdentification')[0]
        ?.getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent;
    const standard = itemNode.getElementsByTagNameNS(ns.cac, 'StandardItemIdentification')[0]
        ?.getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent;
    const t = (v) => String(v ?? '').trim();
    return t(seller) || t(standard) || '';
}

let currentParsedData = null;
let currentView = 'gelen';
let isInvoiceSaveInFlight = false;
// We use `let` for state values because they can change during runtime but const is not.
// `currentParsedData` stores parsed XML data temporarily in RAM because ->
// The user may adjust fields in the UI before saving.
// So the flow is: parse XML -> let user edit -> send final payload to DB.
// `currentView` defaults to "gelen" to define the initial parsing direction and its necessary.



// --- INITIALIZATION ---
// Wait until the HTML is fully loaded before touching DOM elements.
// Then initialize all click/change/drop listeners in one place.
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    refreshData(true);

    // Get the invoice form from the page.
    const invoiceForm = document.getElementById('invoiceForm'); // document is global object in JavaScript to present the HTML page.
    if (invoiceForm) { // 'invoiceForm' is the id of the form in the index.HTML page.
        invoiceForm.addEventListener('submit', saveInvoiceToDatabase); // submit event is triggered when the form is submitted. and saveInvoiceToDatabase is the function we created.
    } // addEventListener is a method and it said -> "if this event happens, then do this".
});






function setupEventListeners() {
    // XML File Upload by using button
    const xmlInput = document.getElementById('xmlInput'); // 'xmlInput' is the id of the input field in the index.HTML page.
    xmlInput.addEventListener('change', handleFileUpload); // When a file is selected (change event), trigger the function to read the invoice.

    // Drag and Drop Logic
    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--success)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--primary)'; });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length) handleFileUpload({ target: { files } });
    });
}
// dragover: Fires continuously while a file is dragged over the zone; preventDefault() stops the browser from opening the file.
// dragleave: Fires when the file is dragged out of the zone; used to reset the visual feedback.
// drop: Fires when the mouse is released; preventDefault() stops the file from opening in a new tab.
// dataTransfer.files: Accesses the specific file data from the drop event to pass it to our parser.




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

    // unpaid / paid durumlarında kullanıcı elle yazamasın
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
// 1- EKRANI "YENİ FATURA" İÇİN (KİLİTSİZ OLARAK) AÇ
function openInvoiceModal() {
    document.getElementById('invoiceForm').reset();
    document.getElementById('f_id').value = '';

    // Her şeyi açık (Kilitsiz) hale getir
    const lockedInputs = document.querySelectorAll('.locked-input');
    lockedInputs.forEach(el => {
        el.removeAttribute('readonly');
        if (el.tagName === 'SELECT') el.removeAttribute('disabled');
        el.style.backgroundColor = '';
    });

    // Kilit Açma Uyarısını Gizle
    document.getElementById('unlockWarningBox').style.display = 'none';

    document.getElementById('invoiceModal').style.display = 'flex';
}










// 2- EKRANI "GÜNCELLEME" İÇİN DOLDURARAK (KİLİTLİ OLARAK) AÇ
function viewInvoice(id) {
    const inv = allInvoicesCache.find(i => i.id === id);
    if (!inv) return;

    document.getElementById('invoiceForm').reset();
    document.getElementById('f_id').value = inv.id;
    document.getElementById('f_vkn').value = inv.companies?.vkn_tckn || '';

    // Ekrana Verileri Dök
    document.getElementById('f_firma').value = inv.companies?.name || '';
    document.getElementById('f_no').value = inv.invoice_no || '';
    document.getElementById('f_type').value = inv.invoice_type || 'Ticari';
    document.getElementById('f_date').value = inv.invoice_date || '';
    document.getElementById('f_due_date').value = inv.due_date || '';
    document.getElementById('f_tax_office').value = inv.companies?.tax_office || '';
    document.getElementById('f_currency').value = invCurrencySelectValue(inv) || inv.currency || 'TL';
    document.getElementById('f_kur').value = inv.calculation_rate ?? inv.exchange_rate ?? '';

    // f_status ve f_paid formdan kaldırıldı — ödeme yönetimi payments tablosundan yapılıyor

    document.getElementById('f_net').value = invNetForForm(inv);
    document.getElementById('f_tax').value = invTaxForForm(inv);
    document.getElementById('f_total').value = invPayableForForm(inv);
    document.getElementById('f_notes').value = inv.notes || '';

    // Resmi kilitleri aktif et ve Label yanlarına Kapalı Kilit 🔒 ekle
    const lockedInputs = document.querySelectorAll('.locked-input');
    lockedInputs.forEach(el => {
        el.setAttribute('readonly', 'true');
        if (el.tagName === 'SELECT') el.setAttribute('disabled', 'true');
        el.style.backgroundColor = '#f1f5f9';

        // Güvenli bir şekilde üstteki Label'ı bulup içini güncelliyoruz
        const label = el.parentElement.querySelector('label');
        if (label) {
            // Eğer daha önce ikon koymadıysak ekle, koyduysak sadece metnini 🔒 yap
            let icon = label.querySelector('.dynamic-lock-icon');
            if (!icon) {
                label.innerHTML += ' <span class="dynamic-lock-icon" style="font-size:13px; margin-left:4px;" title="Bu alan resmi veridir, değiştirilmesi kilitlenmiştir.">🔒</span>';
            } else {
                icon.innerText = '🔒';
            }
        }
    });

    document.getElementById('unlockWarningBox').style.display = 'block';

    // XML'den okunmamış ve düzenleme (Düzenle butonuyla) formuna aktarılmış fatura ürünleri yüklenir
    document.getElementById('lineItemsBody').innerHTML = '';
    if (inv.invoice_items && inv.invoice_items.length > 0) {
        inv.invoice_items.forEach(item => {
            addLineItem(
                item.product_name || '', 
                item.quantity || 1, 
                item.unit_price_cur || 0, 
                item.total_price_cur || 0, 
                item.tax_rate || 20,
                item.product_code || item.sku || ''
            );
        });
    } else {
        // Gösterecek ürün yoksa bile boş bir satır açık tutmak iyidir
        addLineItem();
    }

    document.getElementById('invoiceModal').style.display = 'flex';
}
















// XML Fatura kilidini zorla açar (Manuel Düzenleme Modu)
function unlockInvoiceForm() {
    const lockedInputs = document.querySelectorAll('.locked-input');

    lockedInputs.forEach(el => {
        el.removeAttribute('readonly');
        if (el.tagName === 'SELECT') el.removeAttribute('disabled');
        el.style.backgroundColor = '#ffffff';

        // Kilitleri Açık Kilit 🔓 yapıyoruz
        const label = el.parentElement.querySelector('label');
        if (label) {
            let icon = label.querySelector('.dynamic-lock-icon');
            if (icon) {
                icon.innerText = '🔓';
                icon.title = "Kilit açıldı, dikkatli düzenleyin!";
            }
        }
    });

    // Uyarı kutusunu (Kilidi kır butonunun olduğu sarı yeri) gizle
    document.getElementById('unlockWarningBox').style.display = 'none';
}

















function closeInvoiceModal() {
    document.getElementById('invoiceModal').style.display = 'none'; // close the window
    document.getElementById('invoiceForm').reset(); // reset the form like firm - date - amount
    document.getElementById('lineItemsBody').innerHTML = ''; // clear the information from the table
    // Yeni kompakt XML şeridini geri yükle (eski büyük kutu değil)
    document.getElementById('previewPane').innerHTML = `
        <div id="dropZone" class="upload-box-compact">
            <input type="file" id="xmlInput" accept=".xml" hidden>
            <span class="upload-icon-sm">📄</span>
            <span>UBL-XML ile otomatik doldur (opsiyonel) — sürükleyin veya seçin</span>
            <button class="btn btn-primary btn-sm" onclick="document.getElementById('xmlInput').click()">Dosya Seç</button>
        </div>
        <div id="xmlDataSummary" class="xml-data-view" style="display:none;"></div>`;
    setupEventListeners(); // dropZone event'lerini yeniden bağla
}
// Acts as a "Clean-up Crew". It hides the window and wipes all previous data (form, items, uploads).
// This ensures that every new invoice entry starts with a "clean slate" to prevent data mixing.

















// --- XML PARSING ENGINE ---
function handleFileUpload(e) {
    const file = e.target.files[0]; // keep the firs file user uploaded
    if (!file) return;

    const reader = new FileReader(); // ready-made function created by browser
    reader.onload = function (event) {
        const parser = new DOMParser(); // create object
        const xmlDoc = parser.parseFromString(event.target.result, "text/xml"); // convert the text to readable data tree
        parseUBL(xmlDoc);
    };
    reader.readAsText(file);
}
















/** UBL ProfileID → formdaki Fatura Türü seçimi (Temel / Ticari / e-Arşiv / e-Fatura) */
function mapProfileIdToFormInvoiceType(profileIdRaw) {
    const p = (profileIdRaw || '').toString().trim().toUpperCase();
    if (!p) return 'Ticari';
    if (p.includes('EARSIV')) return 'e-Arşiv';
    if (p.includes('TEMELFATURA')) return 'Temel';
    if (p.includes('TICARIFATURA') || p === 'TICARI') return 'Ticari';
    return 'e-Fatura';
}

/** Vade: kök DueDate veya PaymentTerms / PaymentMeans altındaki PaymentDueDate */
function parseDueDateFromInvoice(xml) {
    const rootDue = getVal(xml, 'DueDate');
    if (rootDue) return rootDue.slice(0, 10);
    const paymentTerms = xml.getElementsByTagNameNS(ns.cac, 'PaymentTerms')[0];
    const d1 = paymentTerms?.getElementsByTagNameNS(ns.cbc, 'PaymentDueDate')[0]?.textContent?.trim();
    if (d1) return d1.slice(0, 10);
    const paymentMeans = xml.getElementsByTagNameNS(ns.cac, 'PaymentMeans')[0];
    const d2 = paymentMeans?.getElementsByTagNameNS(ns.cbc, 'PaymentDueDate')[0]?.textContent?.trim();
    if (d2) return d2.slice(0, 10);
    return '';
}

function getVal(parent, tagName) {
    if (!parent) return '';

    // check there is a ns in this file if not create it
    const namespaces = typeof ns !== 'undefined' ? ns : {
        cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
        cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
    };

    try {
        let el = parent.getElementsByTagNameNS(namespaces.cbc, tagName)[0]; // 1. Attempt: Search using the official Namespace (Best practice)
        if (!el) el = parent.getElementsByTagName('cbc:' + tagName)[0]; // 2. Attempt: Fallback to searching with 'cbc:' prefix(ek)
        if (!el) el = parent.getElementsByTagName(tagName)[0]; // 3. Attempt: Final fallback, search by tag name without any prefix
        return el ? el.textContent.trim() : ''; // remove the redundant space -> like that " ibrahim " -> "ibrahim"
    } catch (e) {
        console.warn(`${tagName} okunurken hata oluştu:`, e);
        return '';
    }
}
// This helper function extracts specific data from the XML tree and cleans it.
// The extracted values are used to fill the HTML form fields on the screen temporarily for user to check them out.
// It ensures that even if the XML structure varies, the requested information is found safely.



















/**
 * UBL XML → kayıt paketi (DOM'a dokunmaz). viewKey: 'gelen' | 'giden'
 */
function buildInvoicePayloadFromXml(xml, viewKey) {
    const f_no = getVal(xml, 'ID');
    const f_date = getVal(xml, 'IssueDate');
    const profileId = getVal(xml, 'ProfileID');
    const invoiceTypeCode = getVal(xml, 'InvoiceTypeCode');
    const formInvoiceType = mapProfileIdToFormInvoiceType(profileId);
    const f_due_date = parseDueDateFromInvoice(xml);

    const supplierWrapper = xml.getElementsByTagNameNS(ns.cac, 'AccountingSupplierParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];
    const customerWrapper = xml.getElementsByTagNameNS(ns.cac, 'AccountingCustomerParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];

    if (!supplierWrapper || !customerWrapper) throw new Error("Gönderen veya Alıcı firma bilgisi eksik!");

    const getVknHizli = (partyNode) => {
        let foundVkn = "";
        const ids = partyNode.getElementsByTagNameNS(ns.cac, 'PartyIdentification');
        for (let i = 0; i < ids.length; i++) {
            const scheme = ids[i].getElementsByTagNameNS(ns.cbc, 'ID')[0]?.getAttribute('schemeID');
            if (scheme === 'VKN' || scheme === 'TCKN') { foundVkn = ids[i].getElementsByTagNameNS(ns.cbc, 'ID')[0].textContent; break; }
        }
        return foundVkn;
    };

    const supplierVKN = getVknHizli(supplierWrapper);
    const customerVKN = getVknHizli(customerWrapper);

    const party = viewKey === 'gelen' ? supplierWrapper : customerWrapper;

    const rawOrgName =
        party.getElementsByTagNameNS(ns.cac, 'PartyName')[0]?.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent ||
        party.getElementsByTagNameNS(ns.cbc, 'RegistrationName')[0]?.textContent ||
        '';
    const personNode = party.getElementsByTagNameNS(ns.cac, 'Person')[0];
    const firstN = personNode?.getElementsByTagNameNS(ns.cbc, 'FirstName')[0]?.textContent?.trim() || '';
    const lastN = personNode?.getElementsByTagNameNS(ns.cbc, 'FamilyName')[0]?.textContent?.trim() || '';
    const fromPerson = [firstN, lastN].filter(Boolean).join(' ').trim();
    const firmaAdi = (rawOrgName || '').trim() || fromPerson || 'Bilinmeyen Firma';

    let vkn = "";
    const idNodes = party.getElementsByTagNameNS(ns.cac, 'PartyIdentification');
    for (let i = 0; i < idNodes.length; i++) {
        const idNode = idNodes[i].getElementsByTagNameNS(ns.cbc, 'ID')[0];
        const scheme = idNode?.getAttribute('schemeID');
        if (scheme === 'VKN' || scheme === 'TCKN') {
            vkn = idNode.textContent;
            break;
        }
    }

    const addrNode = party.getElementsByTagNameNS(ns.cac, 'PostalAddress')[0];
    const street = addrNode?.getElementsByTagNameNS(ns.cbc, 'StreetName')[0]?.textContent || "";
    const bldg = addrNode?.getElementsByTagNameNS(ns.cbc, 'BuildingNumber')[0]?.textContent || "";
    const citySub = addrNode?.getElementsByTagNameNS(ns.cbc, 'CitySubdivisionName')[0]?.textContent || "";
    const city = addrNode?.getElementsByTagNameNS(ns.cbc, 'CityName')[0]?.textContent || "";
    const fullAddress = `${street} No:${bldg} ${citySub} / ${city}`.trim();

    const contactNode = party.getElementsByTagNameNS(ns.cac, 'Contact')[0];
    const phone = contactNode?.getElementsByTagNameNS(ns.cbc, 'Telephone')[0]?.textContent || "";
    const email = contactNode?.getElementsByTagNameNS(ns.cbc, 'ElectronicMail')[0]?.textContent || "";
    const website = contactNode?.getElementsByTagNameNS(ns.cbc, 'WebsiteURI')[0]?.textContent || "";

    const taxOffice =
        party.getElementsByTagNameNS(ns.cac, 'PartyTaxScheme')[0]
            ?.getElementsByTagNameNS(ns.cac, 'TaxScheme')[0]
            ?.getElementsByTagNameNS(ns.cbc, 'Name')[0]
            ?.textContent?.trim() || '';

    const monetaryTotal = xml.getElementsByTagNameNS(ns.cac, 'LegalMonetaryTotal')[0];
    if (!monetaryTotal) throw new Error("HATA: LegalMonetaryTotal bulunamadı.");

    const taxTotalNode = xml.getElementsByTagNameNS(ns.cac, 'TaxTotal')[0];
    const currencyNode = monetaryTotal.getElementsByTagNameNS(ns.cbc, 'PayableAmount')[0];
    const payableCurrencyId = (currencyNode ? currencyNode.getAttribute('currencyID') : 'TRY') || 'TRY';

    const exchangeRateNode = xml.getElementsByTagNameNS(ns.cac, 'PricingExchangeRate')[0];
    const sourceFromRate = exchangeRateNode?.getElementsByTagNameNS(ns.cbc, 'SourceCurrencyCode')[0]?.textContent?.trim() || '';
    const targetFromRate = exchangeRateNode?.getElementsByTagNameNS(ns.cbc, 'TargetCurrencyCode')[0]?.textContent?.trim() || '';
    const kur = exchangeRateNode ? exchangeRateNode.getElementsByTagNameNS(ns.cbc, 'CalculationRate')[0]?.textContent : "";
    const calculationRate = (() => {
        const r = parseFloat(kur);
        return Number.isFinite(r) && r > 0 ? r : 1;
    })();

    const baseIso = (sourceFromRate || payableCurrencyId || 'TRY').toUpperCase();
    const targetIso = (targetFromRate || 'TRY').toUpperCase();
    const currencyRaw = baseIso;

    const netCur = parseFloat(getVal(monetaryTotal, 'TaxExclusiveAmount')) || 0;
    const payableCur = parseFloat(getVal(monetaryTotal, 'PayableAmount')) || 0;
    const taxInclusiveRaw = getVal(monetaryTotal, 'TaxInclusiveAmount');
    let taxCur = taxTotalNode ? parseFloat(getVal(taxTotalNode, 'TaxAmount') || '0') : NaN;
    if (!Number.isFinite(taxCur)) taxCur = payableCur - netCur;
    let taxInclusiveCur = taxInclusiveRaw !== ''
        ? parseFloat(taxInclusiveRaw)
        : (netCur + taxCur);
    if (!Number.isFinite(taxInclusiveCur)) taxInclusiveCur = netCur + taxCur;

    const invCurrencyUi = baseIso === 'TRY' ? 'TL' : baseIso;

    const paymentMeans = xml.getElementsByTagNameNS(ns.cac, 'PaymentMeans')[0];
    const paymentInstructionNote = paymentMeans?.getElementsByTagNameNS(ns.cbc, 'InstructionNote')[0]?.textContent?.trim() || null;

    const netTl = netCur * calculationRate;
    const taxTl = taxCur * calculationRate;
    const payableTl = payableCur * calculationRate;

    const noteNodes = xml.getElementsByTagNameNS(ns.cbc, 'Note');
    const notesArray = Array.from(noteNodes).map(n => n.textContent.trim()).filter(n => n.length > 0);
    if (kur) {
        const tgtLabel = targetIso === 'TRY' ? 'TL' : targetIso;
        notesArray.unshift(`💱 Sistem Notu: 1 ${currencyRaw} = ${kur} ${tgtLabel} (UBL Source→Target kur).`);
    }
    if (invoiceTypeCode) notesArray.unshift(`📋 UBL işlem türü (InvoiceTypeCode): ${invoiceTypeCode}`);

    const lines = xml.getElementsByTagNameNS(ns.cac, 'InvoiceLine');
    const items = [];

    Array.from(lines).forEach(line => {
        const itemNode = line.getElementsByTagNameNS(ns.cac, 'Item')[0];
        const name = itemNode.getElementsByTagNameNS(ns.cbc, 'Description')[0]?.textContent ||
            itemNode.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent ||
            'İsimsiz Ürün';
        const sku = parseProductCodeForSku(itemNode);
        const qty = getVal(line, 'InvoicedQuantity');
        const priceNode = line.getElementsByTagNameNS(ns.cac, 'Price')[0];
        const price = priceNode ? priceNode.getElementsByTagNameNS(ns.cbc, 'PriceAmount')[0]?.textContent : 0;
        const lineTotal = getVal(line, 'LineExtensionAmount');
        const taxSubtotal = line.getElementsByTagNameNS(ns.cac, 'TaxTotal')[0]?.getElementsByTagNameNS(ns.cac, 'TaxSubtotal')[0];
        const taxRate = taxSubtotal ? parseInt(taxSubtotal.getElementsByTagNameNS(ns.cbc, 'Percent')[0]?.textContent) : 20;

        items.push({
            product_name: name,
            product_code: sku || null,
            quantity: parseFloat(qty),
            unit_code: 'ADET',
            unit_price_cur: parseFloat(price),
            total_price_cur: parseFloat(lineTotal),
            tax_rate: taxRate,
            currency: invCurrencyUi
        });
    });

    return {
        parsed_view: viewKey,
        company: {
            vkn_tckn: vkn,
            name: firmaAdi,
            tax_office: taxOffice,
            address: fullAddress,
            phone: phone,
            email: email,
            website: website,
            is_supplier: viewKey === 'gelen',
            is_client: viewKey === 'giden'
        },
        invoice: {
            efatura_uuid: xml.getElementsByTagNameNS(ns.cbc, 'UUID')[0]?.textContent,
            invoice_no: f_no,
            direction: viewKey === 'gelen' ? 'INCOMING' : 'OUTGOING',
            invoice_date: f_date,
            due_date: f_due_date || null,
            payment_due_date: f_due_date || null,
            payment_instruction_note: paymentInstructionNote,
            invoice_type: formInvoiceType,
            currency: invCurrencyUi,
            base_currency: baseIso,
            target_currency: targetIso,
            calculation_rate: calculationRate,
            total_tax_exclusive_cur: netCur,
            total_tax_inclusive_cur: taxInclusiveCur,
            payable_amount_cur: payableCur,
            total_tax_exclusive_tl: netTl,
            tax_amount_tl: taxTl,
            payable_amount_tl: payableTl,
            notes: notesArray.join('\n')
        },
        xml_context: {
            supplier_vkn: supplierVKN,
            customer_vkn: customerVKN
        },
        items,
        _kurXml: kur || ''
    };
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
            item.product_code || ''
        );
    });
}

function parseUBL(xml) {
    try {
        const pack = buildInvoicePayloadFromXml(xml, currentView);
        currentParsedData = pack;
        applyParsedPayloadToForm(pack);
        showXmlSuccess(pack.company.name, pack.company.vkn_tckn);
    } catch (err) {
        console.error("XML Parsing Error:", err);
        if (err.message && (err.message.includes("HATA") || err.message.includes("Güvenlik"))) {
            alert(err.message);
        } else {
            alert("XML dosyası ayrıştırılamadı. Lütfen geçerli bir UBL-TR dosyası seçin.");
        }
    }
}

// --- TOPLU XML YÜKLEME (aynı kayıt API’si; önizleme/düzenleme yok) ---
let bulkInokasVkn = null;
let bulkIncoming = [];
let bulkOutgoing = [];
let bulkFailed = [];
let bulkUploadRunning = false;

function getPartyVknFromNode(partyNode) {
    if (!partyNode) return '';
    const ids = partyNode.getElementsByTagNameNS(ns.cac, 'PartyIdentification');
    for (let i = 0; i < ids.length; i++) {
        const scheme = ids[i].getElementsByTagNameNS(ns.cbc, 'ID')[0]?.getAttribute('schemeID');
        if (scheme === 'VKN' || scheme === 'TCKN') {
            return ids[i].getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent?.trim() || '';
        }
    }
    return '';
}

function getSupplierCustomerVknsFromDoc(xml) {
    const sw = xml.getElementsByTagNameNS(ns.cac, 'AccountingSupplierParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];
    const cw = xml.getElementsByTagNameNS(ns.cac, 'AccountingCustomerParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];
    return { supplier: getPartyVknFromNode(sw), customer: getPartyVknFromNode(cw) };
}

function classifyInvoiceDirection(supplierVkn, customerVkn, inokasVkn) {
    const s = String(supplierVkn || '').trim();
    const c = String(customerVkn || '').trim();
    const io = String(inokasVkn || '').trim();
    if (!io) return null;
    if (s !== io && c !== io) return 'NEITHER';
    if (s === io && c === io) return 'BOTH';
    if (c === io) return 'INCOMING';
    if (s === io) return 'OUTGOING';
    return null;
}

async function ensureBulkInokasVkn() {
    if (bulkInokasVkn) return bulkInokasVkn;
    // Tekli kayıtla aynı kaynak: sunucu .env → ana sayfaya enjekte (GET /); ayrı API şart değil
    const fromPage = typeof window !== 'undefined' ? window.__INOKAS_VKN__ : '';
    const direct = String(fromPage || '').trim();
    if (direct) {
        bulkInokasVkn = direct;
        return bulkInokasVkn;
    }
    let r;
    try {
        r = await fetch('/api/inokas-vkn');
    } catch (e) {
        throw new Error('İnokas VKN yok. Sayfayı `node index.js` ile sunulan adresten açın (ör. http://localhost:3000) ve .env içinde INOKAS_VKN olduğundan emin olun; sunucuyu yeniden başlatın.');
    }
    if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(
            j.error ||
                'İnokas VKN alınamadı. Sunucuda INOKAS_VKN tanımlı mı kontrol edin (.env proje kökünde, sunucuyu yeniden başlatın).'
        );
    }
    const j = await r.json();
    bulkInokasVkn = String(j.vkn || '').trim();
    if (!bulkInokasVkn) throw new Error('İnokas VKN boş.');
    return bulkInokasVkn;
}

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
        `Şu an "${aktif} Faturalar" sekmesindesiniz. "Sisteme yükle" yalnızca ${aktif.toLowerCase()} yönüne uygun XML’leri kaydeder; ` +
        `"${diger}" sütunundaki dosyalar bu adımda kaydedilmez. Düzenleme yok; kayıttan sonra listeden açıp düzenleyebilirsiniz.`;
}

function openBulkUploadModal() {
    bulkIncoming = [];
    bulkOutgoing = [];
    bulkFailed = [];
    const m = document.getElementById('bulkInvoiceModal');
    const fi = document.getElementById('bulkFileInput');
    if (fi) fi.value = '';
    if (m) m.style.display = 'flex';
    renderBulkLists();
    updateBulkDirectionHint();
}

function closeBulkUploadModal() {
    if (bulkUploadRunning) return;
    const m = document.getElementById('bulkInvoiceModal');
    if (m) m.style.display = 'none';
}

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
    const wantGelen = currentView === 'gelen';
    const queue = wantGelen ? [...bulkIncoming] : [...bulkOutgoing];
    if (!queue.length) {
        alert(wantGelen
            ? 'Sol sütunda (Gelen) kaydedilecek fatura yok.'
            : 'Sağ sütunda (Giden) kaydedilecek fatura yok.');
        return;
    }

    const view = wantGelen ? 'gelen' : 'giden';
    bulkUploadRunning = true;
    const succeeded = [];
    const errors = [];

    for (const entry of queue) {
        const payload = {
            submit_view: view,
            parsed_view: view,
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

    if (wantGelen) bulkIncoming = bulkIncoming.filter((e) => !succeeded.includes(e.id));
    else bulkOutgoing = bulkOutgoing.filter((e) => !succeeded.includes(e.id));

    bulkUploadRunning = false;
    renderBulkLists();
    refreshData(true);

    let msg = `Tamam: ${succeeded.length} fatura kaydedildi.`;
    if (errors.length) msg += `\n\nHata (${errors.length}):\n${errors.join('\n')}`;
    alert(msg);
    if (!bulkIncoming.length && !bulkOutgoing.length && !errors.length) closeBulkUploadModal();
}























// --- HAFIZALI (CACHE) TABLO YENİLEME İŞLEMLERİ ---

let allInvoicesCache = null; // Ana Depomuz (Veriler burada tutulacak)
const INVOICE_CACHE_KEY = 'inokas_invoices_cache_v2';
const INVOICE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 dakika

function normalizeCurrencyCode(code) {
    const val = String(code || '').trim().toUpperCase();
    if (val === 'TL') return 'TRY';
    return val;
}

/** UBL `SourceCurrencyCode` ile hizalı ISO kod (DB `base_currency` / form dövizi) */
function invBaseCurrencyIso(inv) {
    const raw = String(inv?.base_currency || inv?.currency || 'TRY').trim().toUpperCase();
    if (raw === 'TL') return 'TRY';
    return raw || 'TRY';
}

/** Tablo / etiket: TRY → TL, aksi halde ISO (USD, EUR…) */
function invDisplayCurrencyLabel(inv) {
    const iso = invBaseCurrencyIso(inv);
    return iso === 'TRY' ? 'TL' : iso;
}

function formatMoneyDisplay(inv, num) {
    const n = Number(num) || 0;
    const iso = invBaseCurrencyIso(inv);
    if (iso === 'TRY') {
        return n.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
    }
    const label = invDisplayCurrencyLabel(inv);
    return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${label}`;
}

/** DB + eski kayıtlar: TL cinsinden ödenecek tutar */
function invPayableAmountTl(inv) {
    const v = inv?.payable_amount_tl ?? inv?.total_amount_tl;
    return parseFloat(v) || 0;
}

/** DB + eski kayıtlar: TL matrah */
function invNetAmountTl(inv) {
    const v = inv?.total_tax_exclusive_tl ?? inv?.net_amount_tl;
    return parseFloat(v) || 0;
}

/** Kur: yeni `calculation_rate`, eski `exchange_rate` */
function invCalculationRate(inv) {
    const r = inv?.calculation_rate ?? inv?.exchange_rate;
    const n = parseFloat(r);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Liste / detay / form: kaynak para (SourceCurrency) cinsinden tutarlar */
function invNetAmountSrc(inv) {
    const c = parseFloat(inv?.total_tax_exclusive_cur);
    if (Number.isFinite(c)) return c;
    return invNetAmountTl(inv) / invCalculationRate(inv);
}

function invTaxAmountSrc(inv) {
    const tl = parseFloat(inv?.tax_amount_tl);
    if (Number.isFinite(tl) && tl >= 0) return tl / invCalculationRate(inv);
    return Math.max(0, invPayableAmountSrc(inv) - invNetAmountSrc(inv));
}

function invPayableAmountSrc(inv) {
    const c = parseFloat(inv?.payable_amount_cur);
    if (Number.isFinite(c) && c >= 0) return c;
    return invPayableAmountTl(inv) / invCalculationRate(inv);
}

function invPaidAmountSrc(inv) {
    // paid_amount_cur: fatura para biriminde saklanan tutar (kur çarpımı yok, kesin doğru)
    // Sadece > 0 ise kullan: 0 değeri "henüz ödenmedi" veya "eski kayıt" anlamına gelir
    const cur = parseFloat(inv?.paid_amount_cur);
    if (Number.isFinite(cur) && cur > 0) return cur;
    // Geriye dönük uyumluluk: eski kayıtlarda paid_amount TL cinsinden saklanmış olabilir
    const paidTl = parseFloat(inv?.paid_amount) || 0;
    return Math.round((paidTl / invCalculationRate(inv)) * 100) / 100;
}

function invRemainingAmountSrc(inv) {
    return Math.max(invPayableAmountSrc(inv) - invPaidAmountSrc(inv), 0);
}

function invCurrencySelectValue(inv) {
    return invDisplayCurrencyLabel(inv);
}

/** Formda gösterilecek kaynak para tutarları (önce cur kolonları, yoksa eski TL kolonları) */
function invNetForForm(inv) {
    const cur = parseFloat(inv?.total_tax_exclusive_cur);
    if (Number.isFinite(cur)) return cur;
    // Fallback: eski kayıt — TL tutarı kura bölerek kaynak para birimine çevir
    const tl = parseFloat(inv?.total_tax_exclusive_tl);
    const rate = invCalculationRate(inv);
    if (Number.isFinite(tl) && rate > 0) return Math.round((tl / rate) * 100) / 100;
    return '';
}

function invTaxForForm(inv) {
    const tl = parseFloat(inv?.tax_amount_tl);
    const rate = invCalculationRate(inv);
    if (Number.isFinite(tl) && rate > 0) return Math.round((tl / rate) * 100) / 100;
    return '';
}

function invPayableForForm(inv) {
    const cur = parseFloat(inv?.payable_amount_cur);
    if (Number.isFinite(cur) && cur > 0) return cur;
    // Fallback: eski kayıt — doğru kolon adı payable_amount_tl
    const tl = parseFloat(inv?.payable_amount_tl);
    const rate = invCalculationRate(inv);
    if (Number.isFinite(tl) && rate > 0) return Math.round((tl / rate) * 100) / 100;
    return '';
}

/**
 * Ekrandan fatura dövizi tutarlarını okur; TL karşılıklarını `calculation_rate` ile üretir (DB şemasına uygun).
 */
function readInvoiceFinancialsFromForm() {
    const fCur = document.getElementById('f_currency')?.value?.trim() || 'TL';
    const baseIso = fCur === 'TL' ? 'TRY' : fCur;
    const rateRaw = parseFloat(document.getElementById('f_kur')?.value);
    const calculationRate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 1;

    const netCur = parseFloat(document.getElementById('f_net')?.value) || 0;
    const taxCur = parseFloat(document.getElementById('f_tax')?.value) || 0;
    const payableCur = parseFloat(document.getElementById('f_total')?.value) || 0;
    const inclusiveCur = netCur + taxCur;

    return {
        currency: fCur,
        base_currency: baseIso,
        target_currency: 'TRY',
        calculation_rate: calculationRate,
        total_tax_exclusive_cur: netCur,
        total_tax_inclusive_cur: inclusiveCur,
        payable_amount_cur: payableCur,
        total_tax_exclusive_tl: netCur * calculationRate,
        tax_amount_tl: taxCur * calculationRate,
        payable_amount_tl: payableCur * calculationRate
    };
}














function readInvoicesFromSession() {
    try {
        const raw = sessionStorage.getItem(INVOICE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);

        // v2 format: { timestamp: number, data: Invoice[] }
        const ts = Number(parsed?.timestamp) || 0;
        const data = parsed?.data;
        if (!Array.isArray(data) || ts <= 0) return null;

        // TTL dolduysa cache'i geçersiz say
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
        const payload = {
            timestamp: Date.now(),
            data: Array.isArray(invoices) ? invoices : []
        };
        sessionStorage.setItem(INVOICE_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn('Session cache yazılamadı:', e);
    }
}
















// 1. Ana Garson (SADECE sayfa açıldığında veya "Yenile"ye basıldığında çalışır)
async function refreshData(forceFetch = false) {
    const tableBody = document.getElementById('invoiceTableBody');
    if (!forceFetch) {
        const cachedInvoices = readInvoicesFromSession();
        if (cachedInvoices !== null) {
            allInvoicesCache = cachedInvoices;
            renderCurrentView();
            return;
        }
    }

    tableBody.innerHTML = '<tr><td colspan="11" class="text-center">Faturalar sunucudan yükleniyor...</td></tr>';

    try {
        // Parametre vermiyoruz, tüm faturaları (Gelen+Giden) tek seferde istiyoruz
        const response = await fetch(`/api/invoices`);
        if (!response.ok) throw new Error("Veriler çekilemedi");

        // Gelen tüm veriyi Kalıcı Hafızaya atıyoruz (İşte Cache burası!)
        allInvoicesCache = await response.json();
        writeInvoicesToSession(allInvoicesCache);

        // Hafızaya alındıktan sonra ekrana basma işini tetikle
        renderCurrentView();

    } catch (error) {
        console.error("Tablo Yenileme Hatası:", error);
        tableBody.innerHTML = '<tr><td colspan="11" class="text-center text-danger">Veriler yüklenirken hata oluştu!</td></tr>';
    }
}

















// 2. Filtreleyici (Sekmeler arası geçişlerde ve menülerde DEVREYE GİRER, Sunucuya gitmez)
function renderCurrentView() {
    if (!allInvoicesCache) return; // Hafıza boşsa işlem yapma

    // A. Hangi sekmedeyiz? (Gelen/Giden)
    const directionFilter = currentView === 'gelen' ? 'INCOMING' : 'OUTGOING';

    // B. Önce o sekmeye ait (Gelen/Giden) tüm faturaları süz
    let filteredInvoices = allInvoicesCache.filter(inv => inv.direction === directionFilter);

    // 🌟 EKRANDAKİ AÇILIR MENÜYÜ DOLDUR 
    // Sekmedeki firmalara göre "Şirket Kutumuzun" içini tazeleyelim
    populateCompanyFilter(filteredInvoices);

    // C. Kullanıcının Seçtiği Filtreleri Yakalayalım
    const companySelected = document.getElementById('filterCompany').value;
    const currencySelected = normalizeCurrencyCode(document.getElementById('filterCurrency').value);
    const searchText = document.getElementById('mainSearch').value.toLocaleLowerCase('tr-TR');

    // Seçimlere göre faturaları bir kez daha elekten geçiriyoruz
    filteredInvoices = filteredInvoices.filter(inv => {
        // Yeni Filtreyi HTML'den Çekelim
        const yearSelected = document.getElementById('filterYear').value;
        const monthSelected = document.getElementById('filterMonth').value;
        const statusSelected = document.getElementById('filterStatus').value;

        // 1- Mevcut Şirket & Döviz & Yazı Filtreleri
        const matchCompany = !companySelected || inv.companies?.name === companySelected;
        const invoiceCurrency = normalizeCurrencyCode(inv.currency);
        const matchCurrency = !currencySelected || invoiceCurrency === currencySelected;
        const matchSearch = !searchText ||
            (inv.companies?.name && inv.companies.name.toLocaleLowerCase('tr-TR').includes(searchText)) ||
            (inv.invoice_no && inv.invoice_no.toLocaleLowerCase('tr-TR').includes(searchText));

        // 2- Ödeme Durumu Filtresi
        const valStatus = (inv.status || 'unpaid').toLowerCase();
        const matchStatus = !statusSelected || valStatus === statusSelected;

        // 3- Yıl ve Ay Filtresi (Faturanın Tarihine Bakıyoruz)
        let matchYear = true;
        let matchMonth = true;
        if (yearSelected || monthSelected) {
            // Faturanın kesim tarihini (invoice_date) Parçalayıp Yıl ve Ayı Alıyoruz
            const d = new Date(inv.invoice_date);
            if (yearSelected) matchYear = d.getFullYear().toString() === yearSelected;

            // JavaScript aylar 0'dan başladığı için (Ocak=0) +1 ekleyip 2 haneli (01, 02) string yapıyoruz
            if (monthSelected) {
                const faturaAyi = String(d.getMonth() + 1).padStart(2, '0');
                matchMonth = faturaAyi === monthSelected;
            }
        }

        // 10 Numara 5 Yıldız Kural: Tüüüüüm filtrelerden "GEÇERLİ (true)" notu alan fatura tabloda kalır!
        return matchCompany && matchCurrency && matchSearch && matchStatus && matchYear && matchMonth;
    });

    // En son sağ kalan (süzülmüş) faturaları masaya (ekrana) bas
    renderInvoiceTable(filteredInvoices);
}



















// ─── ÖZET PROGRESS BARLARI ───────────────────────────────────────────────────

// Fatura listesindeki tüm faturaları para birimine göre gruplar ve
// her para birimi için ödenen / kalan ilerleme barını çizer.
function updateSummaryCards(invoices) {
    const container = document.getElementById('summaryCardsContainer');
    if (!container) return;

    const isIncoming = currentView === 'gelen';

    // Para birimine göre toplamları hesapla: { TRY: {payable, paid, count}, USD: {...}, ... }
    const byCurrency = {};
    invoices.forEach(inv => {
        const iso     = invBaseCurrencyIso(inv);    // "TRY" | "USD" | "EUR" ...
        const payable = invPayableAmountSrc(inv);   // kaynak para biriminde toplam
        const paid    = invPaidAmountSrc(inv);      // kaynak para biriminde ödenen

        if (!byCurrency[iso]) byCurrency[iso] = { payable: 0, paid: 0, count: 0 };
        byCurrency[iso].payable += payable;
        byCurrency[iso].paid    += Math.min(paid, payable); // fazla ödemeyi kırp
        byCurrency[iso].count   += 1;
    });

    container.innerHTML = ''; // önceki barları temizle

    // Görüntüleme sırası: TRY önce, ardından alfabetik dövizler
    const preferredOrder = ['TRY', 'USD', 'EUR'];
    const allIsos = [...new Set([...preferredOrder, ...Object.keys(byCurrency)])];
    const visibleIsos = allIsos.filter(iso => byCurrency[iso] && byCurrency[iso].count > 0);

    if (visibleIsos.length === 0) {
        container.innerHTML = '<p style="color:#94a3b8; font-size:13px; margin:0;">Gösterilecek fatura yok.</p>';
        return;
    }

    visibleIsos.forEach(iso => {
        const { payable, paid } = byCurrency[iso];
        const remaining = Math.max(payable - paid, 0);
        container.appendChild(buildProgressBar(iso, paid, remaining, payable, isIncoming));
    });
}

// Para birimi etiketini döndürür: TRY → "TL", USD → "USD" ...
function _isoLabel(iso) { return iso === 'TRY' ? 'TL' : iso; }

// Sayıyı formatlı string'e çevirir
function _fmtAmount(num, iso) {
    const n = Number(num) || 0;
    if (iso === 'TRY') return n.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
    return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${_isoLabel(iso)}`;
}

// Tek bir progress bar HTML elementi oluşturur ve döndürür
function buildProgressBar(iso, paid, remaining, total, isIncoming) {
    const label   = _isoLabel(iso);
    const paidPct = total > 0 ? Math.round((paid / total) * 100) : 0;
    const remPct  = 100 - paidPct;

    // Başlık: gelen = borç/ödenen, giden = alacak/tahsil
    const titlePaid = isIncoming ? 'Ödenen' : 'Tahsil Edilen';
    const titleRem  = isIncoming ? 'Kalan Borç' : 'Kalan Alacak';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 16px 20px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    `;

    // Para birimi başlığı
    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;';
    heading.innerHTML = `
        <span style="font-size:13px; font-weight:800; color:#64748b; letter-spacing:0.5px;">${label}</span>
        <span style="font-size:12px; color:#94a3b8;">${isIncoming ? 'Toplam' : 'Toplam Alacak'}: ${_fmtAmount(total, iso)}</span>
    `;
    wrapper.appendChild(heading);

    // Progress bar gövdesi
    const barWrap = document.createElement('div');
    barWrap.style.cssText = `
        display: flex;
        height: 28px;
        border-radius: 8px;
        overflow: hidden;
        background: #f1f5f9;
    `;

    // Ödenen (yeşil) dilim — sıfırsa gösterme
    if (paid > 0) {
        const paidBar = document.createElement('div');
        paidBar.style.cssText = `
            width: ${paidPct}%;
            background: linear-gradient(90deg, #16a34a, #22c55e);
            transition: width 0.5s ease;
            min-width: ${paid > 0 ? '4px' : '0'};
        `;
        barWrap.appendChild(paidBar);
    }

    // Kalan (kırmızı) dilim — sıfırsa gösterme
    if (remaining > 0) {
        const remBar = document.createElement('div');
        remBar.style.cssText = `
            width: ${remPct}%;
            background: linear-gradient(90deg, #f87171, #ef4444);
            transition: width 0.5s ease;
            min-width: ${remaining > 0 ? '4px' : '0'};
        `;
        barWrap.appendChild(remBar);
    }

    // Tamamen ödenmişse tüm bar yeşil
    if (paid > 0 && remaining === 0) {
        barWrap.innerHTML = '';
        const fullBar = document.createElement('div');
        fullBar.style.cssText = 'width:100%; background:linear-gradient(90deg,#16a34a,#22c55e); border-radius:8px;';
        barWrap.appendChild(fullBar);
    }

    wrapper.appendChild(barWrap);

    // Sayılar: solda ödenen (yeşil), sağda kalan (kırmızı)
    const labels = document.createElement('div');
    labels.style.cssText = 'display:flex; justify-content:space-between; margin-top:10px;';
    labels.innerHTML = `
        <span style="font-size:13px; font-weight:700; color:#16a34a;">
            ✓ ${titlePaid}: ${_fmtAmount(paid, iso)}
        </span>
        <span style="font-size:13px; font-weight:700; color:#ef4444;">
            ✕ ${titleRem}: ${_fmtAmount(remaining, iso)}
        </span>
    `;
    wrapper.appendChild(labels);

    return wrapper;
}

// ─────────────────────────────────────────────────────────────────────────────















// 🌟 ŞİRKET FİLTRESİNİ DOLDURAN MOTOR
function populateCompanyFilter(invoices) {
    const filterSelect = document.getElementById('filterCompany');

    // Kutudaki mevcut değeri mi okuyalım, yoksa az önce sekme değiştirirken cebimize koyduğumuz eski hafızayı mı?
    const memoryVal = filterSelect.getAttribute('data-memory');
    const currentValue = memoryVal !== null ? memoryVal : filterSelect.value;
    filterSelect.removeAttribute('data-memory'); // İşini bitirdi, sil gitsin

    // Önce kutunun içini "Tüm Firmalar" seçeneği hariç temizliyoruz
    filterSelect.innerHTML = '<option value="">Tüm Firmalar</option>';

    // Elimizdeki faturalardan sadece benzersiz (kopya olmayan) firma isimlerini ayıklıyoruz
    const uniqueCompanies = [...new Set(invoices.map(inv => inv.companies?.name).filter(Boolean))];

    // Ayıkladığımız isimleri alfabetik dizip, filtreleme kutusuna <option> olarak basıyoruz
    uniqueCompanies.sort().forEach(companyName => {
        const option = document.createElement('option');
        option.value = companyName;
        option.textContent = companyName;
        filterSelect.appendChild(option);
    });

    // Sayfa falan yenilenirse, kullanıcının o anki seçimi silinmesin diye (veya hafızadaki değer gelsin diye) geri koyuyoruz
    filterSelect.value = currentValue;
}















// 2. Sunum: Gelen verileri HTML tablosuna dönüştürür
function renderInvoiceTable(invoices) {
    updateSummaryCards(invoices);
    const tableBody = document.getElementById('invoiceTableBody');
    tableBody.innerHTML = ''; // Önce tabloyu temizle

    if (invoices.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="11" class="text-center">Henüz fatura bulunmuyor.</td></tr>';
        return;
    }

    invoices.forEach(inv => {
        const row = document.createElement('tr');

        // YENİ: Satırın her milimetrekaresini Tıklanabilir (Buton) yapıyoruz
        row.style.cursor = "pointer";
        row.onclick = () => viewInvoiceDetails(inv.id);

        // Durum butonunun rengini ayarlamak (DB lowercase veya Capitalize olabilir → normalize et)
        const normStatus = (inv.status || '').toLowerCase();
        let statusHtml = '<span class="status-badge warning">Ödenmedi</span>';
        if (normStatus === 'paid') statusHtml = '<span class="status-badge success">Ödendi</span>';
        else if (normStatus === 'partial') statusHtml = '<span class="status-badge info">Kısmi</span>';

        const netSrc = invNetAmountSrc(inv);
        const taxSrc = invTaxAmountSrc(inv);
        const totalSrc = invPayableAmountSrc(inv);
        const paidSrc = invPaidAmountSrc(inv);
        const remainingSrc = invRemainingAmountSrc(inv);

        // Gelen/Giden durumuna göre Gönderen ve Alıcıyı belirliyoruz
        let senderName = "";
        let receiverName = "";

        if (inv.direction === 'INCOMING') {
            senderName = inv.companies?.name || 'Bilinmeyen Firma';
            receiverName = 'İNOKAS'; // Uzun isme gerek yok, tablo şık kalsın
        } else {
            senderName = 'İNOKAS';   // Uzun isme gerek yok, tablo şık kalsın
            receiverName = inv.companies?.name || 'Bilinmeyen Firma';
        }

        // Tablodaki HTML sütunlarını (Gönderen ve Alıcı olarak) sırayla basıyoruz
        row.innerHTML = `
            <td><strong>${inv.invoice_no}</strong></td>
            <td>${senderName}</td>
            <td><strong>${receiverName}</strong></td>
            <td>${inv.invoice_date}</td>
            <td>${inv.due_date || '-'}</td>
            <td class="text-right">${formatMoneyDisplay(inv, netSrc)}</td>
            <td class="text-right">${formatMoneyDisplay(inv, taxSrc)}</td>
            <td class="text-right"><strong>${formatMoneyDisplay(inv, totalSrc)}</strong></td>
            <td class="text-right text-success">${formatMoneyDisplay(inv, paidSrc)}</td>
            <td class="text-right text-danger">${formatMoneyDisplay(inv, remainingSrc)}</td>
            <td>${statusHtml}</td>
        `;
        tableBody.appendChild(row);
    });
}















function closeInvoiceDetailModal() {
    document.getElementById('invoiceDetailModal').style.display = 'none';
}

// ─── ÖDEME GEÇMİŞİ FONKSİYONLARI ────────────────────────────────────────────

// Fatura için API'den ödeme geçmişini çekip tabloya yazar; sol panel özetini de günceller
async function loadInvoicePayments(inv) {
    const tbody = document.getElementById('detail_payments_body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="padding:16px; text-align:center; color:#94a3b8;">Yükleniyor...</td></tr>';

    try {
        const res = await fetch(`/api/invoices/${inv.id}/payments`);
        const payments = await res.json();
        renderPaymentRows(payments, inv);
        updateDetailModalSummary(payments, inv); // sol panel: toplam ödenen / kalan / durum
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:16px; text-align:center; color:#ef4444;">Ödemeler yüklenemedi.</td></tr>';
    }
}

// Sol paneli (TOPLAM ÖDENEN, KALAN BORÇ, Durum badge) API'den gelen ödemelerle günceller
function updateDetailModalSummary(payments, inv) {
    const totalPayable = invPayableAmountSrc(inv);
    const totalPaid    = (payments || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const remaining    = Math.max(0, totalPayable - totalPaid);
    const currLabel    = invDisplayCurrencyLabel(inv);
    const fmt          = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const elPaid      = document.getElementById('detail_paid');
    const elRemaining = document.getElementById('detail_remaining');
    const elStatus    = document.getElementById('detail_status');
    if (!elPaid || !elRemaining) return;

    elPaid.innerText      = `${fmt(totalPaid)} ${currLabel}`;
    elRemaining.innerText = `${fmt(remaining)} ${currLabel}`;

    // Durum badge: sadece kelime, tutar yok (tutar zaten TOPLAM ÖDENEN'de görünüyor)
    if (elStatus) {
        if (totalPaid > 0 && totalPaid >= totalPayable) {
            elStatus.innerHTML = '<span style="color:#16a34a; font-weight:700; background:#dcfce7; padding:4px 12px; border-radius:12px; font-size:13px;">✓ Ödendi</span>';
        } else if (totalPaid > 0) {
            elStatus.innerHTML = '<span style="color:#d97706; font-weight:700; background:#fef3c7; padding:4px 12px; border-radius:12px; font-size:13px;">◑ Kısmi</span>';
        } else {
            elStatus.innerHTML = '<span style="color:#ef4444; font-weight:700; background:#fee2e2; padding:4px 12px; border-radius:12px; font-size:13px;">✕ Ödenmedi</span>';
        }
    }
}

// Ödeme satırlarını tabloya yazar; her satırda o ödeme sonrasındaki kalan borcu gösterir
function renderPaymentRows(payments, inv) {
    const tbody = document.getElementById('detail_payments_body');
    const totalPayable = invPayableAmountSrc(inv);
    const currLabel    = invDisplayCurrencyLabel(inv);
    const fmt          = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (!payments || payments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:20px; text-align:center; color:#94a3b8;">Henüz ödeme kaydı yok.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    let cumulative = 0;

    payments.forEach((p, i) => {
        cumulative += parseFloat(p.amount) || 0;
        const remaining = Math.max(0, totalPayable - cumulative);
        const tr = document.createElement('tr');
        tr.id = `pay-row-${p.id}`;
        tr.style.borderBottom = '1px solid #f1f5f9';
        if (i % 2 !== 0) tr.style.background = '#f8fafc';

        // Görüntüleme modu (düzenleme kapalı)
        tr.innerHTML = `
            <td style="padding:10px 14px; color:#374151;">
                ${new Date(p.payment_date + 'T00:00:00').toLocaleDateString('tr-TR')}
            </td>
            <td style="padding:10px 14px; text-align:right; font-weight:700; color:#16a34a;">
                ${fmt(parseFloat(p.amount))} ${currLabel}
            </td>
            <td style="padding:10px 14px; text-align:right; font-weight:700; color:${remaining > 0 ? '#e11d48' : '#16a34a'};">
                ${fmt(remaining)} ${currLabel}
            </td>
            <td style="padding:10px 14px; color:#64748b; font-size:12px;">
                ${p.notes ? p.notes.replace(/</g,'&lt;') : '—'}
            </td>
            <td style="padding:10px 14px; text-align:center; white-space:nowrap;">
                <button onclick="togglePaymentEdit('${p.id}','${inv.id}','${p.payment_date}',${parseFloat(p.amount)},'${(p.notes||'').replace(/'/g,"\\'")}')"
                    title="Düzenle"
                    style="background:#dbeafe; color:#2563eb; border:none; border-radius:6px; padding:4px 8px; font-size:12px; cursor:pointer; margin-right:4px;">
                    ✏️
                </button>
                <button onclick="deletePayment('${p.id}','${inv.id}')"
                    title="Ödemeyi sil"
                    style="background:#fee2e2; color:#ef4444; border:none; border-radius:6px; padding:4px 8px; font-size:12px; cursor:pointer;">
                    🗑️
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Satırı inline düzenleme moduna geçirir (mevcut değerler inputlara yüklenir)
function togglePaymentEdit(payId, invoiceId, currentDate, currentAmount, currentNotes) {
    const tr = document.getElementById(`pay-row-${payId}`);
    if (!tr) return;

    const today = new Date().toISOString().slice(0, 10);

    tr.innerHTML = `
        <td style="padding:6px 8px;">
            <input type="date" id="edit_date_${payId}" value="${currentDate}" max="${today}"
                style="padding:5px 8px; border:1px solid #7dd3fc; border-radius:6px; font-size:13px; width:130px;">
        </td>
        <td style="padding:6px 8px;">
            <input type="number" id="edit_amount_${payId}" value="${currentAmount}" step="0.01" min="0.01"
                style="padding:5px 8px; border:1px solid #7dd3fc; border-radius:6px; font-size:13px; width:100px;">
        </td>
        <td style="padding:6px 8px; color:#94a3b8; font-size:12px; text-align:center;">—</td>
        <td style="padding:6px 8px;">
            <input type="text" id="edit_notes_${payId}" value="${currentNotes}"
                style="padding:5px 8px; border:1px solid #7dd3fc; border-radius:6px; font-size:13px; width:100%;">
        </td>
        <td style="padding:6px 8px; text-align:center; white-space:nowrap;">
            <button onclick="savePaymentEdit('${payId}','${invoiceId}')"
                style="background:#0ea5e9; color:white; border:none; border-radius:6px; padding:5px 10px; font-size:12px; cursor:pointer; margin-right:4px;">
                💾 Kaydet
            </button>
            <button onclick="loadInvoicePayments(allInvoicesCache.find(i=>i.id==='${invoiceId}'))"
                style="background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; border-radius:6px; padding:5px 8px; font-size:12px; cursor:pointer;">
                ✕
            </button>
        </td>
    `;
}

// Düzenlenen ödemeyi kaydeder
async function savePaymentEdit(payId, invoiceId) {
    const dateVal   = document.getElementById(`edit_date_${payId}`)?.value;
    const amountVal = parseFloat(document.getElementById(`edit_amount_${payId}`)?.value);
    const notesVal  = document.getElementById(`edit_notes_${payId}`)?.value?.trim() || '';

    const today = new Date().toISOString().slice(0, 10);
    if (!dateVal)              { alert('Lütfen tarih girin.');           return; }
    if (dateVal > today)       { alert('Gelecek tarihe ödeme eklenemez.'); return; }
    if (!amountVal || amountVal <= 0) { alert('Geçerli bir tutar girin.'); return; }

    const inv = allInvoicesCache.find(i => i.id === invoiceId);

    try {
        const res = await fetch(`/api/payments/${payId}`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ amount: amountVal, payment_date: dateVal, notes: notesVal })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Güncellenemedi.');

        if (inv) {
            loadInvoicePayments(inv);
            refreshData(true); // ana listeyi de güncelle
        }
    } catch (err) {
        alert('Hata: ' + err.message);
    }
}

// Yeni ödeme formdaki değerleri okuyup API'ye gönderir, sonra sayfayı günceller
async function saveNewPayment(inv) {
    const dateVal   = document.getElementById('pay_date')?.value;
    const amountVal = parseFloat(document.getElementById('pay_amount')?.value);
    const notesVal  = document.getElementById('pay_notes')?.value?.trim() || '';

    // Gelecek tarih engeli
    const today = new Date().toISOString().slice(0, 10);
    if (!dateVal)              { alert('Lütfen ödeme tarihini seçin.'); return; }
    if (dateVal > today)       { alert('Gelecek tarihe ödeme eklenemez. Bugün veya geçmiş bir tarih seçin.'); return; }
    if (!amountVal || amountVal <= 0) { alert('Lütfen geçerli bir tutar girin.'); return; }

    // Toplam aşım kontrolü: mevcut ödemelerin toplamı + yeni tutar fatura toplamını geçemez
    const totalPayable  = invPayableAmountSrc(inv);
    const currentPaid   = (parseFloat(inv.paid_amount_cur) || 0); // backend son halden gelir, cache'de
    const afterThisPay  = currentPaid + amountVal;
    if (afterThisPay > totalPayable) {
        const currLabel = invDisplayCurrencyLabel(inv);
        const remaining = totalPayable - currentPaid;
        alert(
            `⚠️ Fatura toplamı aşılıyor!\n\n` +
            `Fatura toplamı : ${totalPayable.toLocaleString('tr-TR', {minimumFractionDigits:2})} ${currLabel}\n` +
            `Şimdiye kadar ödenen : ${currentPaid.toLocaleString('tr-TR', {minimumFractionDigits:2})} ${currLabel}\n` +
            `Girebileceğiniz maksimum : ${remaining.toLocaleString('tr-TR', {minimumFractionDigits:2})} ${currLabel}`
        );
        return;
    }

    // Para birimi: faturanın gösterim para birimi (USD, EUR, TRY vs.)
    const currency = invBaseCurrencyIso(inv);

    try {
        const res = await fetch('/api/payments', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ invoice_id: inv.id, amount: amountVal, currency, payment_date: dateVal, notes: notesVal })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Ödeme kaydedilemedi.');

        // Formu gizle
        document.getElementById('newPaymentForm').style.display = 'none';

        // Cache'deki faturayı optimistik olarak güncelle (UI anında tepki versin)
        const cached = allInvoicesCache.find(i => i.id === inv.id);
        if (cached) {
            cached.paid_amount_cur = (parseFloat(cached.paid_amount_cur) || 0) + amountVal;
            cached.paid_amount     = cached.paid_amount_cur;
        }

        // Ödeme tablosunu ve sol paneli yenile (API'den gerçek veriyle)
        await loadInvoicePayments(inv);

        // Ana tablo da güncellensin (backend paid_amount ve status'ü değiştirdi)
        refreshData(true);

    } catch (err) {
        alert('Hata: ' + err.message);
    }
}

// Belirtilen ödeme kaydını siler, tablo ve özeti günceller
async function deletePayment(paymentId, invoiceId) {
    if (!confirm('Bu ödeme kaydı silinsin mi?')) return;

    try {
        const res = await fetch(`/api/payments/${paymentId}`, { method: 'DELETE' });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Silinemedi.');

        // Ödeme listesini ve sol paneli güncelle
        const inv = allInvoicesCache.find(i => i.id === invoiceId);
        if (inv) await loadInvoicePayments(inv);

        // Ana tablo da yenile
        refreshData(true);

    } catch (err) {
        alert('Hata: ' + err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────

function viewInvoiceDetails(id) {
    const inv = allInvoicesCache.find(i => i.id === id);
    if (!inv) return;

    // Düzenle Butonuna Tıklanınca Asıl Formu Aç
    const btnEdit = document.getElementById('btnEditInvoice');
    btnEdit.onclick = () => {
        closeInvoiceDetailModal();
        viewInvoice(id);
    };

    // Sil Butonuna tıklayınca fonksiyonu çalıştır
    const btnDelete = document.getElementById('btnDeleteInvoice');
    if (btnDelete) {
        btnDelete.onclick = () => { deleteInvoice(id); };
    }

    // Kutuları Doldur (Güzel Yuvarlak Kenarlı Tasarım)
    document.getElementById('detail_no_text').innerText = inv.invoice_no || '-';
    document.getElementById('detail_company').innerText = inv.companies?.name || '-';
    document.getElementById('detail_date').innerText = inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString('tr-TR') : '-';
    document.getElementById('detail_due_date').innerText = inv.due_date ? new Date(inv.due_date).toLocaleDateString('tr-TR') : '-';

    const paidAmountSrc = invPaidAmountSrc(inv);
    const tgtIso = String(inv.target_currency || 'TRY').toUpperCase();
    const tgtLabel = tgtIso === 'TRY' ? 'TL' : tgtIso;

    document.getElementById('detail_net').innerText = formatMoneyDisplay(inv, invNetAmountSrc(inv));
    document.getElementById('detail_tax').innerText = formatMoneyDisplay(inv, invTaxAmountSrc(inv));
    document.getElementById('detail_total').innerText = formatMoneyDisplay(inv, invPayableAmountSrc(inv));
    document.getElementById('detail_paid').innerText = formatMoneyDisplay(inv, paidAmountSrc);
    document.getElementById('detail_remaining').innerText = formatMoneyDisplay(inv, invRemainingAmountSrc(inv));

    // TL faturalarda kur gösteriminin anlamı yok → '-'
    const isTRYInvoice = invBaseCurrencyIso(inv) === 'TRY';
    const hasRate      = inv.calculation_rate != null || inv.exchange_rate != null;
    document.getElementById('detail_kur').innerText = (!isTRYInvoice && hasRate)
        ? `1 ${invDisplayCurrencyLabel(inv)} = ${invCalculationRate(inv).toLocaleString('tr-TR')} ${tgtLabel}`
        : '-';
    document.getElementById('detail_notes').innerText = inv.notes || 'Not bulunmuyor.';

    // Durum badge'ini cache'deki anlık değerle hemen göster (API cevabı gelince updateDetailModalSummary günceller)
    const elStatusInit = document.getElementById('detail_status');
    if (elStatusInit) {
        const ns = (inv.status || '').toLowerCase();
        if (ns === 'paid') {
            elStatusInit.innerHTML = '<span style="color:#16a34a; font-weight:700; background:#dcfce7; padding:4px 12px; border-radius:12px; font-size:13px;">✓ Ödendi</span>';
        } else if (ns === 'partial') {
            elStatusInit.innerHTML = '<span style="color:#d97706; font-weight:700; background:#fef3c7; padding:4px 12px; border-radius:12px; font-size:13px;">◑ Kısmi</span>';
        } else {
            elStatusInit.innerHTML = '<span style="color:#ef4444; font-weight:700; background:#fee2e2; padding:4px 12px; border-radius:12px; font-size:13px;">✕ Ödenmedi</span>';
        }
    }

    // 📦 YENİ: ÜRÜNLER (Line Items) TABLOSUNU ÇİZME
    const tbody = document.getElementById('detail_items_body');
    tbody.innerHTML = '';

    // index.js güncellendiği için ürünler artık invoice_items içinde bize geliyor
    if (inv.invoice_items && inv.invoice_items.length > 0) {
        inv.invoice_items.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid #f1f5f9";
            if (index % 2 !== 0) tr.style.background = "#f8fafc"; // Zebra deseni 🦓

            const code = (item.product_code || item.sku) && String(item.product_code || item.sku).trim()
                ? String(item.product_code || item.sku).trim()
                : '—';
            tr.innerHTML = `
                <td style="padding:10px 15px; font-weight:600;">${item.product_name}</td>
                <td style="padding:10px 15px; font-size:12px; color:#475569; font-family:ui-monospace,monospace;">${code}</td>
                <td style="padding:10px 15px; text-align:center;">${item.quantity} ${item.unit || ''}</td>
                <td style="padding:10px 15px; text-align:right;">${(parseFloat(item.unit_price_cur) || 0).toLocaleString('tr-TR')} ${invDisplayCurrencyLabel(inv)}</td>
                <td style="padding:10px 15px; text-align:center;">%${item.tax_rate || 0}</td>
                <td style="padding:10px 15px; text-align:right; font-weight:700; color:#0f172a;">${(parseFloat(item.total_price_cur) || 0).toLocaleString('tr-TR')} ${invDisplayCurrencyLabel(inv)}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:20px; text-align:center; color:#94a3b8; font-style:italic;">Bu faturaya ait ürün detayı bulunamadı. (Faturayı Yenile'ye basarak yeni veriyi çekebilirsin)</td></tr>`;
    }

    // Ödeme geçmişini API'den çek ve sağ sütuna render et
    loadInvoicePayments(inv);

    // "Yeni Ödeme Ekle" butonuna tıklayınca formu aç/kapat
    const btnAdd = document.getElementById('btnAddPayment');
    if (btnAdd) {
        btnAdd.onclick = () => {
            const form = document.getElementById('newPaymentForm');
            const isVisible = form.style.display !== 'none';
            form.style.display = isVisible ? 'none' : 'flex';
            // Varsayılan tarih: bugün; max da bugün (gelecek tarih girilemez)
            if (!isVisible) {
                const today = new Date().toISOString().slice(0, 10);
                const payDateEl = document.getElementById('pay_date');
                payDateEl.value = today;
                payDateEl.max   = today;
                document.getElementById('pay_amount').value = '';
                document.getElementById('pay_notes').value = '';
            }
        };
    }

    // "Kaydet" butonuna tıklayınca ödemeyi kaydet
    const btnSave = document.getElementById('btnSavePayment');
    if (btnSave) {
        btnSave.onclick = () => saveNewPayment(inv);
    }

    // "İptal" butonuna tıklayınca formu gizle
    const btnCancel = document.getElementById('btnCancelPayment');
    if (btnCancel) {
        btnCancel.onclick = () => {
            document.getElementById('newPaymentForm').style.display = 'none';
        };
    }

    document.getElementById('invoiceDetailModal').style.display = 'flex';
}























async function saveInvoiceToDatabase(e) {
    e.preventDefault();
    if (isInvoiceSaveInFlight) {
        alert("Kaydetme işlemi devam ediyor, lütfen bekleyin.");
        return;
    }
    const invoiceId = document.getElementById('f_id')?.value;

    // Ödeme durumu artık payments tablosundan otomatik hesaplanıyor.
    // Düzenle formunda yalnızca fatura bilgileri (tarih, ürünler, kur vs.) güncellenir.
    const fin = readInvoiceFinancialsFromForm();

    const formCurrency = document.getElementById('f_currency')?.value?.trim() || 'TL';

    // Ürün satırlarını ekrandan topla (Güncelleme + Yeni Kayıt akışında ortak kullanılacak)
    const lineRows = document.querySelectorAll('#lineItemsBody tr');
    const itemsFromForm = Array.from(lineRows).map((row) => {
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
        const skuVal = row.querySelector('.line-sku-val')?.value?.trim() || '';
        return {
            product_name: productName,
            product_code: skuVal || null,
            quantity: qty,
            unit_code: 'ADET',
            unit_price_cur: unitPrice,
            tax_rate: taxRate,
            total_price_cur: lineTotal,
            currency: formCurrency,
            is_internal: isInternal
        };
    }).filter(item => item.product_name && item.quantity > 0);

    // GÜNCELLEME MODU: Düzenleme ekranında XML zorunluluğu yok
    if (invoiceId) {
        const updatePayload = {
            invoice: {
                // status ve paid_amount güncellenmez — payments tablosundan otomatik hesaplanıyor
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
            console.info('[faturalar] PUT şekli', Object.keys(updatePayload), 'invoice' in updatePayload ? 'nested ✓' : 'flat ✗');
            const response = await fetch(`/api/invoices/${invoiceId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updatePayload)
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Güncelleme hatası");
            }

            alert(result.message || "Fatura başarıyla güncellendi.");
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

    // YENİ KAYIT MODU: XML ile parse edilen geçici veri şart
    if (!currentParsedData) {
        alert("Lütfen önce bir XML yükleyin!");
        return;
    }

    // 1. Hazırlık: İlk kayıtta da ekrandaki güncel satırları esas al
    // (XML'den gelen başlangıç değerleri değil, kullanıcının son düzenlemesi kaydedilsin)
    const itemsToSave = itemsFromForm;

    // 2. Paketleme: Hibrit model
    // - UI'da görünen alanlar: formdan oku (kullanıcının son düzeltmesi kaydedilsin)
    // - UI'da görünmeyen XML alanları: currentParsedData'dan koru (null kaybı olmasın)
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
        // Yeni fatura başlangıçta 'unpaid', ödemeler payments tablosundan yönetilir
        status: 'unpaid',
        paid_amount: 0,
        paid_amount_cur: 0,
        notes: document.getElementById('f_notes')?.value || ''
    };

    // 2. Paketleme: Sunucuya gidecek tek bir obje oluştur
    const payload = {
        submit_view: currentView,
        parsed_view: currentParsedData.parsed_view || null,
        company: {
            ...(currentParsedData.company || {}),
            ...companyFromUi
        },
        invoice: {
            ...currentParsedData.invoice,
            ...invoiceFromUi
        },
        xml_context: currentParsedData.xml_context || null,
        items: itemsToSave
    };

    try {
        isInvoiceSaveInFlight = true;
        // 3. Gönderim: Tek bir fetch isteği ile backend'e yolla
        const response = await fetch('/api/save-invoice', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            // ŞİMDİ İŞLER DEĞİŞTİ: Hatayı fırlatırken, Backend'den gelen errorCode'u da hatanın cebine koyuyoruz!
            const errorObj = new Error(result.error || "Sunucu hatası");
            errorObj.code = result.errorCode;
            throw errorObj;
        }

        // Başarılı işlem sonrası UI güncellemeleri
        alert(result.message);
        closeInvoiceModal();
        refreshData(true);

    } catch (err) {
        console.error("Kayıt Hatası:", err.message);

        // KUSURSUZ YÖNTEM: Artık metne göre dilenmek yok, direkt veritabanı kuralıyla (23505) konuşuyoruz!
        if (err.code === '23505') {
            alert("⚠️ BU FATURA DAHA ÖNCE YÜKLENMİŞ!\nSistemde aynı faturadan zaten bulunduğu için tekrar kaydedilemez.");
        } else {
            alert("Hata oluştu: " + err.message);
        }
    } finally {
        isInvoiceSaveInFlight = false;
    }
}















// İlgili faturayı backend üzerinden tamamen siliyoruz
async function deleteInvoice(id) {
    if (!confirm("⚠️ Bu faturayı ve içerisindeki tüm ürünleri silmek istediğinize emin misiniz?\nBu işlem geri alınamaz!")) return;

    try {
        const response = await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error("Silinemedi");

        alert("✅ Fatura başarıyla silindi!");
        closeInvoiceDetailModal();   // Görüntüleme penceresini kapat
        refreshData(true);           // Listeyi tazeleyelim ki tablo ekranından da silinip uçsun
    } catch (err) {
        console.error("Silme hatası:", err);
        alert("Fatura silinirken bir ağ hatası oluştu.");
    }
}



















// TCMB API'sinden anlık güncel döviz kurunu çeker
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
        // CORS bypass için public proxy kullanımı (TCMB doğrudan tarayıcı fetch isteklerini kısıtlar)
        const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent('https://www.tcmb.gov.tr/kurlar/today.xml')}`);
        if (!response.ok) throw new Error("Ağ hatası");

        const str = await response.text();
        const xmlDoc = new window.DOMParser().parseFromString(str, "text/xml");

        const currencies = xmlDoc.getElementsByTagName("Currency");
        let found = false;

        for (let i = 0; i < currencies.length; i++) {
            if (currencies[i].getAttribute("CurrencyCode") === currency) {
                // Fatura kesiminde genellikle Döviz Satış (ForexSelling) baz alınır
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











// Tüm line item satırlarını okuyup f_net / f_tax / f_total alanlarını günceller.
// readonly sadece kullanıcı girişini engeller; JS ile .value atamak her zaman çalışır.
function recalcInvoiceTotalsFromLines() {
    const rows = document.querySelectorAll('#lineItemsBody tr');
    let totalNet = 0;
    let totalTax = 0;

    rows.forEach(row => {
        const qty      = parseFloat(row.querySelector('td:nth-child(3) input[type="number"]')?.value) || 0;
        const price    = parseFloat(row.querySelector('td:nth-child(4) input[type="number"]')?.value) || 0;
        const taxRate  = parseFloat(row.querySelector('.tax-rate-val')?.value) || 0;
        const lineNet  = qty * price;
        totalNet += lineNet;
        totalTax += lineNet * taxRate / 100;
    });

    const netEl   = document.getElementById('f_net');
    const taxEl   = document.getElementById('f_tax');
    const totalEl = document.getElementById('f_total');
    if (netEl)   netEl.value   = totalNet.toFixed(2);
    if (taxEl)   taxEl.value   = totalTax.toFixed(2);
    if (totalEl) totalEl.value = (totalNet + totalTax).toFixed(2);
}

function addLineItem(desc = '', qty = 1, price = 0, total = 0, taxRate = 20, sku = '') {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" value="${desc}" placeholder="Ürün adı"></td>
        <td><input type="text" class="line-sku-val" placeholder="Ürün kodu" title="XML / sku" style="width:100%;font-size:13px;"></td>
        <td><input type="number" value="${qty}" class="text-center"></td>
        <td><input type="number" value="${price}" step="0.01"></td>
        <td><input type="number" value="${total}" step="0.01" readonly></td>
        <td class="text-center">
            <input type="checkbox" class="internal-toggle" title="Şirket İçi Kullanım (Sarf)">
            <input type="hidden" class="tax-rate-val" value="${taxRate}">
        </td>
        <td><button type="button" class="btn-text" onclick="this.closest('tr').remove(); recalcInvoiceTotalsFromLines();" style="color:var(--danger)">✕</button></td>
    `;
    const skuInput   = row.querySelector('.line-sku-val');
    if (skuInput) skuInput.value = String(sku ?? '').trim();
    const qtyInput   = row.querySelector('td:nth-child(3) input[type="number"]');
    const priceInput = row.querySelector('td:nth-child(4) input[type="number"]');
    const totalInput = row.querySelector('td:nth-child(5) input[type="number"]');

    const recalcLineTotal = () => {
        const qtyVal   = parseFloat(qtyInput?.value)   || 0;
        const priceVal = parseFloat(priceInput?.value) || 0;
        totalInput.value = (qtyVal * priceVal).toFixed(2);
        // Satır değişince fatura genel toplamlarını da güncelle
        recalcInvoiceTotalsFromLines();
    };

    qtyInput?.addEventListener('input', recalcLineTotal);
    priceInput?.addEventListener('input', recalcLineTotal);

    // Satırı önce DOM'a ekle, sonra hesapla — yoksa recalcInvoiceTotalsFromLines bu satırı göremez
    document.getElementById('lineItemsBody').appendChild(row);
    recalcLineTotal();
}









function showXmlSuccess(firma, vkn) {
    const previewPane = document.getElementById('previewPane');
    // Tek satır koyu şerit: firma adı + VKN + kaldır butonu
    previewPane.innerHTML = `
        <div style="display:flex; align-items:center; gap:16px; background:#0f172a; border-radius:8px; padding:10px 16px; flex-wrap:wrap;">
            <span style="color:#4ade80; font-size:15px; flex-shrink:0;">✓</span>
            <span style="color:#ffffff; font-weight:700; font-size:13px; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${firma}</span>
            <span style="color:#94a3b8; font-size:12px; flex-shrink:0;">VKN: ${vkn || '—'}</span>
            <button onclick="resetXmlStrip()"
                style="background:#ef4444; color:white; border:none; border-radius:6px; padding:5px 12px; font-size:12px; font-weight:600; cursor:pointer; flex-shrink:0;">
                Dosyayı Kaldır
            </button>
        </div>
    `;
}

// Sadece XML şeridini sıfırlar — formu veya modalı kapatmaz
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
    setupEventListeners(); // dropZone eventlerini yeniden bağla
}








// View switching logic (Sekme değişimi ve Hafıza Transferi)
function switchView(view) {
    if (currentView === view) return; // Zaten aynı sekmedeysek boşa yorulma

    // 1- EKRANDAKİLERİ KAYDET (Eski sekmeye veda etmeden hemen önce bavula dolduruyoruz)
    filterMemory[currentView] = {
        search: document.getElementById('mainSearch').value,
        company: document.getElementById('filterCompany').value,
        currency: normalizeCurrencyCode(document.getElementById('filterCurrency').value),
        year: document.getElementById('filterYear') ? document.getElementById('filterYear').value : '',
        month: document.getElementById('filterMonth') ? document.getElementById('filterMonth').value : '',
        status: document.getElementById('filterStatus') ? document.getElementById('filterStatus').value : ''
    };

    // 2- SEKME DEĞİŞİMİ
    currentView = view;
    document.getElementById('tabGelen').classList.toggle('active', view === 'gelen');
    document.getElementById('tabGiden').classList.toggle('active', view === 'giden');

    // 3- YENİ SEKMENİN HAFIZASINI (BAVULUNU) EKRANA GERİ BOŞALT
    const memory = filterMemory[currentView];
    document.getElementById('mainSearch').value = memory.search;
    const rememberedCurrency = normalizeCurrencyCode(memory.currency);
    document.getElementById('filterCurrency').value = rememberedCurrency;
    if (document.getElementById('filterYear')) document.getElementById('filterYear').value = memory.year;
    if (document.getElementById('filterMonth')) document.getElementById('filterMonth').value = memory.month;
    if (document.getElementById('filterStatus')) document.getElementById('filterStatus').value = memory.status;

    // (Şirket kutusu populateCompanyFilter ile özel dolacağı için onun hafızasını filtre motorunun içine yerleştirilmek üzere geçici kutuda saklıyoruz)
    document.getElementById('filterCompany').setAttribute('data-memory', memory.company);

    renderCurrentView();

    const bulkModal = document.getElementById('bulkInvoiceModal');
    if (bulkModal && bulkModal.style.display === 'flex') {
        updateBulkDirectionHint();
    }
}