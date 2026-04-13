// --- CONFIG & STATE ---
let currentView = 'gelen';
const ns = {
    cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

function setupEventListeners() {
    // XML File Upload
    const xmlInput = document.getElementById('xmlInput');
    xmlInput.addEventListener('change', handleFileUpload);

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

// --- MODAL CONTROLS ---
function openInvoiceModal() {
    document.getElementById('invoiceModal').style.display = 'flex';
}

function closeInvoiceModal() {
    document.getElementById('invoiceModal').style.display = 'none';
    document.getElementById('invoiceForm').reset();
    document.getElementById('lineItemsBody').innerHTML = '';
    document.getElementById('previewPane').innerHTML = `
        <div class="preview-empty-state">
            <div class="upload-box" id="dropZone">
                <input type="file" id="xmlInput" accept=".xml" hidden>
                <span class="upload-icon">📄</span>
                <h3>UBL-XML Dosyasını Yükle</h3>
                <p>Verileri otomatik doldurmak için sürükleyin veya seçin</p>
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('xmlInput').click()">Dosya Seç</button>
            </div>
        </div>`;
    setupEventListeners(); // Re-bind dropzone
}

// --- XML PARSING ENGINE ---
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(event.target.result, "text/xml");
        parseUBL(xmlDoc);
    };
    reader.readAsText(file);
}

function getVal(parent, tagName) {
    const el = parent.getElementsByTagNameNS(ns.cbc, tagName)[0];
    return el ? el.textContent : '';
}

function parseUBL(xml) {
    try {
        // 1. Basic Invoice Info
        const f_no = getVal(xml, 'ID');
        const f_date = getVal(xml, 'IssueDate');
        const f_type = getVal(xml, 'InvoiceTypeCode');

        // 2. DYNAMIC PARTY LOGIC (Determines if we scrape the Sender or Receiver)
        // currentView 'gelen' means the OTHER company is the Supplier (AccountingSupplierParty)
        // currentView 'giden' means the OTHER company is the Customer (AccountingCustomerParty)
        const targetPartyTag = currentView === 'gelen' ? 'AccountingSupplierParty' : 'AccountingCustomerParty';
        const partyWrapper = xml.getElementsByTagNameNS(ns.cac, targetPartyTag)[0];

        if (!partyWrapper) throw new Error("Firma bilgisi bulunamadı.");

        const party = partyWrapper.getElementsByTagNameNS(ns.cac, 'Party')[0];

        // --- COMPANY DATA SCRAPING ---

        // A. Firm Name
        const firmaAdi = party.getElementsByTagNameNS(ns.cac, 'PartyName')[0]?.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent ||
                         party.getElementsByTagNameNS(ns.cbc, 'RegistrationName')[0]?.textContent ||
                         "Bilinmeyen Firma";

        // B. VKN/TCKN (The Unique Identifier)
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

        // C. Address Extraction
        const addrNode = party.getElementsByTagNameNS(ns.cac, 'PostalAddress')[0];
        const street = addrNode?.getElementsByTagNameNS(ns.cbc, 'StreetName')[0]?.textContent || "";
        const bldg = addrNode?.getElementsByTagNameNS(ns.cbc, 'BuildingNumber')[0]?.textContent || "";
        const citySub = addrNode?.getElementsByTagNameNS(ns.cbc, 'CitySubdivisionName')[0]?.textContent || ""; // İlçe
        const city = addrNode?.getElementsByTagNameNS(ns.cbc, 'CityName')[0]?.textContent || ""; // İl
        const fullAddress = `${street} No:${bldg} ${citySub} / ${city}`.trim();

        // D. Contact & Website
        const contactNode = party.getElementsByTagNameNS(ns.cac, 'Contact')[0];
        const phone = contactNode?.getElementsByTagNameNS(ns.cbc, 'Telephone')[0]?.textContent || "";
        const email = contactNode?.getElementsByTagNameNS(ns.cbc, 'ElectronicMail')[0]?.textContent || "";
        const website = party.getElementsByTagNameNS(ns.cbc, 'WebsiteURI')[0]?.textContent || "";

        // 3. FINANCIAL TOTALS & CURRENCY

        const monetaryTotal = xml.getElementsByTagNameNS(ns.cac, 'LegalMonetaryTotal')[0];
        const net = getVal(monetaryTotal, 'TaxExclusiveAmount');
        const total = getVal(monetaryTotal, 'PayableAmount');
        const taxTotalNode = xml.getElementsByTagNameNS(ns.cac, 'TaxTotal')[0];
        const exactTax = taxTotalNode ? taxTotalNode.getElementsByTagNameNS(ns.cbc, 'TaxAmount')[0]?.textContent : (total - net).toFixed(2);

        const currencyNode = monetaryTotal.getElementsByTagNameNS(ns.cbc, 'PayableAmount')[0];
        const currency = currencyNode ? currencyNode.getAttribute('currencyID') : 'TRY';

        // 4. EXCHANGE RATE & NOTES
        const exchangeRateNode = xml.getElementsByTagNameNS(ns.cac, 'PricingExchangeRate')[0];
        const kur = exchangeRateNode ? exchangeRateNode.getElementsByTagNameNS(ns.cbc, 'CalculationRate')[0]?.textContent : "";

        const noteNodes = xml.getElementsByTagNameNS(ns.cbc, 'Note');
        const notesArray = Array.from(noteNodes).map(n => n.textContent.trim()).filter(n => n.length > 0);
        if (kur) notesArray.unshift(`💱 Sistem Notu: Fatura kur değeri 1 ${currency} = ${kur} TL olarak okunmuştur.`);

        // 5. UPDATE THE UI FORM FIELDS
        document.getElementById('f_no').value = f_no;
        document.getElementById('f_date').value = f_date;
        document.getElementById('f_firma').value = firmaAdi;
        document.getElementById('f_vkn').value = vkn;
        document.getElementById('f_address').value = fullAddress;
        document.getElementById('f_phone').value = phone;
        document.getElementById('f_email').value = email;
        document.getElementById('f_website').value = website;
        document.getElementById('f_net').value = net;
        document.getElementById('f_tax').value = exactTax;
        document.getElementById('f_total').value = total;
        document.getElementById('f_currency').value = currency === 'TRY' ? 'TL' : currency;
        document.getElementById('f_kur').value = kur; // Fills the new input field
        document.getElementById('f_notes').value = notesArray.join('\n');

        // 6. PARSE LINE ITEMS (PRODUCTS)
        const lines = xml.getElementsByTagNameNS(ns.cac, 'InvoiceLine');
        const lineItemsBody = document.getElementById('lineItemsBody');
        lineItemsBody.innerHTML = '';

        Array.from(lines).forEach(line => {
            const itemNode = line.getElementsByTagNameNS(ns.cac, 'Item')[0];
            const desc = itemNode.getElementsByTagNameNS(ns.cbc, 'Description')[0]?.textContent ||
                         itemNode.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent ||
                         'İsimsiz Ürün';

            const qty = getVal(line, 'InvoicedQuantity');
            const priceNode = line.getElementsByTagNameNS(ns.cac, 'Price')[0];
            const price = priceNode ? priceNode.getElementsByTagNameNS(ns.cbc, 'PriceAmount')[0]?.textContent : 0;
            const lineTotal = getVal(line, 'LineExtensionAmount');

            addLineItem(desc, qty, price, lineTotal);
        });

        // 7. SHOW SUCCESS UI
        showXmlSuccess(firmaAdi, vkn);

    } catch (err) {
        console.error("XML Parsing Error:", err);
        alert("XML dosyası ayrıştırılamadı. Lütfen geçerli bir UBL-TR dosyası seçin.");
    }
}
function addLineItem(desc = '', qty = 1, price = 0, total = 0) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" value="${desc}" placeholder="Ürün adı"></td>
        <td><input type="number" value="${qty}" class="text-center"></td>
        <td><input type="number" value="${price}" step="0.01"></td>
        <td><input type="number" value="${total}" step="0.01" readonly></td>
        <td><button type="button" class="btn-text" onclick="this.closest('tr').remove()" style="color:var(--danger)">✕</button></td>
    `;
    document.getElementById('lineItemsBody').appendChild(row);
}

function showXmlSuccess(firma, vkn) {
    const previewPane = document.getElementById('previewPane');
    previewPane.innerHTML = `
        <div class="xml-data-view">
            <div class="xml-tag-group">
                <h4>✅ Dosya Doğrulandı</h4>
                <p><strong>Firma:</strong> ${firma}</p>
                <p><strong>VKN:</strong> ${vkn}</p>
            </div>
            <div class="xml-tag-group">
                <h4>🔍 Veri Aktarımı</h4>
                <p>Tüm ürünler ve tutarlar form alanlarına aktarıldı. Lütfen sağ taraftaki verileri kontrol ederek kaydedin.</p>
            </div>
            <button class="btn btn-secondary btn-sm" onclick="closeInvoiceModal()">❌ Dosyayı Kaldır</button>
        </div>
    `;
}

// View switching logic
function switchView(view) {
    currentView = view;
    document.getElementById('tabGelen').classList.toggle('active', view === 'gelen');
    document.getElementById('tabGiden').classList.toggle('active', view === 'giden');
    // Here you would typically reload the table data from Supabase
}