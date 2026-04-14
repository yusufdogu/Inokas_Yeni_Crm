// Filtrelerin Sekmelere Özel Hafızası (Her sekme kendi seçimini yazar)
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



let currentParsedData = null;
let currentView = 'gelen';
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
    refreshData();

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
    document.getElementById('f_currency').value = inv.currency || 'TL';
    document.getElementById('f_kur').value = inv.exchange_rate || '';

    document.getElementById('f_status').value = (inv.status || 'unpaid').toLowerCase();
    document.getElementById('f_paid').value = inv.paid_amount || '';

    document.getElementById('f_net').value = inv.net_amount_tl || '';
    document.getElementById('f_tax').value = inv.tax_amount_tl || '';
    document.getElementById('f_total').value = inv.total_amount_tl || '';
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
                item.tax_rate || 20
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
    document.getElementById('previewPane').innerHTML = ` 
        <div class="preview-empty-state">
            <div class="upload-box" id="dropZone">
                <input type="file" id="xmlInput" accept=".xml" hidden>
                <span class="upload-icon">📄</span>
                <h3>UBL-XML Dosyasını Yükle</h3>
                <p>Verileri otomatik doldurmak için sürükleyin veya seçin</p>
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('xmlInput').click()">Dosya Seç</button>
            </div>
        </div>`; // previewPane is rebringing the "dosya yükle" button again
    setupEventListeners(); // Re-bind dropzone
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





function parseUBL(xml) {
    try {
        // 1. Basic Invoice Info
        const f_no = getVal(xml, 'ID'); // invoice number
        const f_date = getVal(xml, 'IssueDate'); // invoice date
        const f_type = getVal(xml, 'InvoiceTypeCode'); // Temel mi, Ticari mi? (görseldeki seçenekler) doğrusu ai önerisi iade mi satış mı felan kontrol edelim sonra 

        // 2. DYNAMIC PARTY LOGIC (Determines if we scrape the Sender or Receiver)
        // currentView 'gelen' means the OTHER company is the Supplier (AccountingSupplierParty)
        // currentView 'giden' means the OTHER company is the Customer (AccountingCustomerParty)
        // 2. GÜVENLİK KONTROLÜ VE YÖN BULMA (KİM KİME KESMİŞ?)
        const INOKAS_VKN = "4780552998"; // USTA BURAYA KENDİ VKN'NİZİ GİRECEKSİN!

        // A. Gönderen (Satıcı) ve Alan (Müşteri) Zarfını aynı anda XML'den bulalım
        const supplierWrapper = xml.getElementsByTagNameNS(ns.cac, 'AccountingSupplierParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];
        const customerWrapper = xml.getElementsByTagNameNS(ns.cac, 'AccountingCustomerParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];

        if (!supplierWrapper || !customerWrapper) throw new Error("Gönderen veya Alıcı firma bilgisi eksik!");

        // B. İkisinin de VKN'sini hızlıca çeken küçük bir ajan (İç fonksiyon)
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

        // --- C. GÜVENLİK KONTROLLERİ ---
        // 1- Bu fatura bizim mi? (İnokas ne satıcıda ne de alıcıda yoksa reddet)
        if (supplierVKN !== INOKAS_VKN && customerVKN !== INOKAS_VKN) {
            throw new Error(`Güvenlik İhlali: Bu fatura İNOKAS'a ait değil! (Gelen VKN'ler: ${supplierVKN} - ${customerVKN})`);
        }

        // 2- Yanlış sekmeye yanlış fatura mı yükleniyor?
        if (currentView === 'gelen' && customerVKN !== INOKAS_VKN) {
            throw new Error("HATA: İnokas'ın KESTİĞİ bir faturayı, 'Gelen' sekmesine yükleyemezsiniz!");
        }
        if (currentView === 'giden' && supplierVKN !== INOKAS_VKN) {
            throw new Error("HATA: İnokas'a KESİLMİŞ bir faturayı, 'Giden' sekmesine yükleyemezsiniz!");
        }

        // D. Kontrollerden geçtik! Artık yönünü biliyoruz. Asıl verileri (VKN, isim) çekeceğimiz "Karşı Tarafı" belirleyelim:
        const party = currentView === 'gelen' ? supplierWrapper : customerWrapper;

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
        const citySub = addrNode?.getElementsByTagNameNS(ns.cbc, 'CitySubdivisionName')[0]?.textContent || ""; // county
        const city = addrNode?.getElementsByTagNameNS(ns.cbc, 'CityName')[0]?.textContent || ""; // city
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

        // ANA VERİ YAPISINI KURUYORUZ (Döngüden önce olması şart)
        currentParsedData = {
            company: {
                vkn_tckn: vkn,
                name: firmaAdi,
                address: fullAddress,
                phone: phone,
                email: email,
                website: website,
                is_supplier: currentView === 'gelen',
                is_client: currentView === 'giden'
            },
            invoice: {
                efatura_uuid: xml.getElementsByTagNameNS(ns.cbc, 'UUID')[0]?.textContent,
                invoice_no: f_no,
                direction: currentView === 'gelen' ? 'INCOMING' : 'OUTGOING',
                invoice_date: f_date,
                currency: currency === 'TRY' ? 'TL' : currency,
                exchange_rate: parseFloat(kur) || 1.0,
                total_currency: parseFloat(total),
                net_amount_tl: (parseFloat(net) * (parseFloat(kur) || 1)).toFixed(2),
                tax_amount_tl: (parseFloat(exactTax) * (parseFloat(kur) || 1)).toFixed(2),
                total_amount_tl: (parseFloat(total) * (parseFloat(kur) || 1)).toFixed(2),
                notes: notesArray.join('\n')
            },
            items: []
        };

        Array.from(lines).forEach(line => {
            const itemNode = line.getElementsByTagNameNS(ns.cac, 'Item')[0];

            // DMO XML'leri için Description etiketini Name'den önce öncelikli yapıyoruz
            const name = itemNode.getElementsByTagNameNS(ns.cbc, 'Description')[0]?.textContent ||
                itemNode.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent ||
                'İsimsiz Ürün';

            const sku = itemNode.getElementsByTagNameNS(ns.cac, 'SellersItemIdentification')[0]?.getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent || '';

            const qty = getVal(line, 'InvoicedQuantity');
            const priceNode = line.getElementsByTagNameNS(ns.cac, 'Price')[0];
            const price = priceNode ? priceNode.getElementsByTagNameNS(ns.cbc, 'PriceAmount')[0]?.textContent : 0;
            const lineTotal = getVal(line, 'LineExtensionAmount');

            const taxSubtotal = line.getElementsByTagNameNS(ns.cac, 'TaxTotal')[0]?.getElementsByTagNameNS(ns.cac, 'TaxSubtotal')[0];
            const taxRate = taxSubtotal ? parseInt(taxSubtotal.getElementsByTagNameNS(ns.cbc, 'Percent')[0]?.textContent) : 20;

            // Ekrana sadece isim basıyoruz (Hizalama bozulmasın diye)
            addLineItem(name, qty, price, lineTotal, taxRate);

            // Veritabanı listesine ikisini de şık bir şekilde ekliyoruz
            currentParsedData.items.push({
                product_name: name,
                sku: sku,
                quantity: parseFloat(qty),
                unit: 'Adet',
                unit_price_cur: parseFloat(price),
                total_price_cur: parseFloat(lineTotal),
                tax_rate: taxRate
            });
        });

        // 7. SHOW SUCCESS UI
        showXmlSuccess(firmaAdi, vkn);

    } catch (err) {
        console.error("XML Parsing Error:", err);
        // Eğer bizim fırlattığımız özel bir hataysa direkt onu ekrana bas:
        if (err.message && (err.message.includes("HATA") || err.message.includes("Güvenlik"))) {
            alert(err.message);
        } else {
            // Gerçekten XML bozuksa genel mesajı ver
            alert("XML dosyası ayrıştırılamadı. Lütfen geçerli bir UBL-TR dosyası seçin.");
        }
    }
}







// --- HAFIZALI (CACHE) TABLO YENİLEME İŞLEMLERİ ---

let allInvoicesCache = null; // Ana Depomuz (Veriler burada tutulacak)

// 1. Ana Garson (SADECE sayfa açıldığında veya "Yenile"ye basıldığında çalışır)
async function refreshData() {
    const tableBody = document.getElementById('invoiceTableBody');
    tableBody.innerHTML = '<tr><td colspan="9" class="text-center">Faturalar sunucudan yükleniyor...</td></tr>';

    try {
        // Parametre vermiyoruz, tüm faturaları (Gelen+Giden) tek seferde istiyoruz
        const response = await fetch(`/api/invoices`);
        if (!response.ok) throw new Error("Veriler çekilemedi");

        // Gelen tüm veriyi Kalıcı Hafızaya atıyoruz (İşte Cache burası!)
        allInvoicesCache = await response.json();

        // Hafızaya alındıktan sonra ekrana basma işini tetikle
        renderCurrentView();

    } catch (error) {
        console.error("Tablo Yenileme Hatası:", error);
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">Veriler yüklenirken hata oluştu!</td></tr>';
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
    const currencySelected = document.getElementById('filterCurrency').value;
    const searchText = document.getElementById('mainSearch').value.toLowerCase();

    // Seçimlere göre faturaları bir kez daha elekten geçiriyoruz
    filteredInvoices = filteredInvoices.filter(inv => {
        // Yeni Filtreyi HTML'den Çekelim
        const yearSelected = document.getElementById('filterYear').value;
        const monthSelected = document.getElementById('filterMonth').value;
        const statusSelected = document.getElementById('filterStatus').value;

        // 1- Mevcut Şirket & Döviz & Yazı Filtreleri
        const matchCompany = !companySelected || inv.companies?.name === companySelected;
        const matchCurrency = !currencySelected || inv.currency === currencySelected;
        const matchSearch = !searchText ||
            (inv.companies?.name && inv.companies.name.toLowerCase().includes(searchText)) ||
            (inv.invoice_no && inv.invoice_no.toLowerCase().includes(searchText));

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










// 🌟 ÖZET KARTLARI MATEMATİK MOTORU
function updateSummaryCards(invoices) {
    // Sadece 'gelen' sekmesindeysek hesaplama yap, yoksa boşa yorulma
    if (currentView !== 'gelen') return;

    let totalDebt = 0;
    let monthlyDebt = 0;
    let overdueDebt = 0;
    let totalPaid = 0;

    let overdueCount = 0;
    let paidCount = 0;

    const uniqueSuppliers = new Set();
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Saati sıfırla ki sadece günü hesaplasın
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    invoices.forEach(inv => {
        const amount = parseFloat(inv.total_amount_tl) || 0;
        const status = (inv.status || 'unpaid').toLowerCase();

        // Ödenmemiş olanları ayıkla
        if (status === 'unpaid' || status === 'partial') {
            totalDebt += amount; // Toplam borca ekle
            if (inv.companies?.name) uniqueSuppliers.add(inv.companies.name);

            if (inv.due_date) {
                const dueDate = new Date(inv.due_date);

                if (dueDate < today) {
                    // Vadesi geçmiş (Bugünden daha eski)
                    overdueDebt += amount;
                    overdueCount++;
                } else if (dueDate.getMonth() === currentMonth && dueDate.getFullYear() === currentYear) {
                    // Vadesi henüz geçmemiş ama bu ay içinde ödenecekler
                    monthlyDebt += amount;
                }
            }
        }
        // Ödenmiş olanlar
        else if (status === 'paid') {
            totalPaid += amount;
            paidCount++;
        }
    });

    // 💰 Sayıları şık bir TL formatına çevirme aracı
    const formatTL = (num) => Number(num).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });

    // 🎯 Bulunan değerleri HTML'deki kimliklere (ID) fırlat!
    document.getElementById('stat-total-debt').innerText = formatTL(totalDebt);
    document.getElementById('stat-supplier-count').innerText = `${uniqueSuppliers.size} Tedarikçi`;

    document.getElementById('stat-monthly-debt').innerText = formatTL(monthlyDebt);

    document.getElementById('stat-overdue').innerText = formatTL(overdueDebt);
    document.getElementById('stat-overdue-count').innerText = `${overdueCount} Fatura`;

    document.getElementById('stat-paid').innerText = formatTL(totalPaid);
    document.getElementById('stat-paid-count').innerText = `${paidCount} Fatura`;
}






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
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center">Henüz fatura bulunmuyor.</td></tr>';
        return;
    }

    invoices.forEach(inv => {
        const row = document.createElement('tr');

        // YENİ: Satırın her milimetrekaresini Tıklanabilir (Buton) yapıyoruz
        row.style.cursor = "pointer";
        row.onclick = () => viewInvoiceDetails(inv.id);

        // Durum butonunun rengini ayarlamak
        let statusHtml = '<span class="status-badge warning">Ödenmedi</span>';
        if (inv.status === 'paid') statusHtml = '<span class="status-badge success">Ödendi</span>';
        else if (inv.status === 'partial') statusHtml = '<span class="status-badge info">Kısmi</span>';

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
            <td class="text-right">${Number(inv.net_amount_tl).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</td>
            <td class="text-right">${Number(inv.tax_amount_tl).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</td>
            <td class="text-right"><strong>${Number(inv.total_amount_tl).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}</strong></td>
            <td>${statusHtml}</td>
            <td class="text-center">
                <button class="btn-text" title="Detay">👁️</button>
            </td>
        `;
        tableBody.appendChild(row);
        // Tabloyu çizerken önce hemen kartları da hızlıca hesapla
        updateSummaryCards(invoices);

    });
}





// --- SADECE OKUNABİLİR ŞIK FATURA DETAY PANELİ KONTROLLERİ ---

function closeInvoiceDetailModal() {
    document.getElementById('invoiceDetailModal').style.display = 'none';
}






// --- SADECE OKUNABİLİR ŞIK FATURA DETAY PANELİ KONTROLLERİ ---
function closeInvoiceDetailModal() {
    document.getElementById('invoiceDetailModal').style.display = 'none';
}

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

    // Paraları formatla
    const currency = inv.currency || 'TL';
    const cSymbol = currency === 'TL' ? '₺' : currency;

    // NOT: _tl uzantılı değerler zaten kur ile çarpılmış Türk Lirası karşılıklarıdır!
    // Bu yüzden yanlarına cSymbol (USD/EUR vb.) değil doğrudan '₺' yazılmalıdır.
    document.getElementById('detail_net').innerText = (parseFloat(inv.net_amount_tl) || 0).toLocaleString('tr-TR') + ' ₺';
    document.getElementById('detail_tax').innerText = (parseFloat(inv.tax_amount_tl) || 0).toLocaleString('tr-TR') + ' ₺';
    document.getElementById('detail_total').innerText = (parseFloat(inv.total_amount_tl) || 0).toLocaleString('tr-TR') + ' ₺';

    document.getElementById('detail_kur').innerText = inv.exchange_rate ? parseFloat(inv.exchange_rate).toLocaleString('tr-TR') + ' ₺' : '-';
    document.getElementById('detail_notes').innerText = inv.notes || 'Not bulunmuyor.';

    // Ödeme Durumunu Şık Balonlara Çevir (Oval)
    let sHtml = '<span style="color:#ef4444; font-weight:700; background:#fee2e2; padding:4px 10px; border-radius:12px;">Ödenmedi</span>';
    if (inv.status === 'paid') sHtml = '<span style="color:#16a34a; font-weight:700; background:#dcfce7; padding:4px 10px; border-radius:12px;">Ödendi</span>';
    else if (inv.status === 'partial') sHtml = `<span style="color:#d97706; font-weight:700; background:#fef3c7; padding:4px 10px; border-radius:12px;">Kısmi (${(inv.paid_amount || 0).toLocaleString('tr-TR')} ₺)</span>`;
    document.getElementById('detail_status').innerHTML = sHtml;

    // 📦 YENİ: ÜRÜNLER (Line Items) TABLOSUNU ÇİZME
    const tbody = document.getElementById('detail_items_body');
    tbody.innerHTML = '';

    // index.js güncellendiği için ürünler artık invoice_items içinde bize geliyor
    if (inv.invoice_items && inv.invoice_items.length > 0) {
        inv.invoice_items.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid #f1f5f9";
            if (index % 2 !== 0) tr.style.background = "#f8fafc"; // Zebra deseni 🦓

            tr.innerHTML = `
                <td style="padding:10px 15px; font-weight:600;">${item.product_name}</td>
                <td style="padding:10px 15px; text-align:center;">${item.quantity} ${item.unit || ''}</td>
                <td style="padding:10px 15px; text-align:right;">${(parseFloat(item.unit_price_cur) || 0).toLocaleString('tr-TR')} ${cSymbol}</td>
                <td style="padding:10px 15px; text-align:center;">%${item.tax_rate || 0}</td>
                <td style="padding:10px 15px; text-align:right; font-weight:700; color:#0f172a;">${(parseFloat(item.total_price_cur) || 0).toLocaleString('tr-TR')} ${cSymbol}</td>
            `;
            tbody.appendChild(tr);
        });
    } else {
        tbody.innerHTML = `<tr><td colspan="5" style="padding:20px; text-align:center; color:#94a3b8; font-style:italic;">Bu faturaya ait ürün detayı bulunamadı. (Faturayı Yenile'ye basarak yeni veriyi çekebilirsin)</td></tr>`;
    }

    document.getElementById('invoiceDetailModal').style.display = 'flex';
}


















async function saveInvoiceToDatabase(e) {
    e.preventDefault();

    if (!currentParsedData) {
        alert("Lütfen önce bir XML yükleyin!");
        return;
    }

    // 1. Hazırlık: UI verilerini (checkboxlar vs) topla
    const lineRows = document.querySelectorAll('#lineItemsBody tr');
    const itemsToSave = currentParsedData.items.map((item, index) => {
        const row = lineRows[index];
        return {
            ...item,
            is_internal: row.querySelector('.internal-toggle').checked,
            tax_rate: parseInt(row.querySelector('.tax-rate-val').value)
        };
    });

    // 2. Paketleme: Sunucuya gidecek tek bir obje oluştur
    const payload = {
        company: currentParsedData.company,
        invoice: currentParsedData.invoice,
        items: itemsToSave
    };

    try {
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
        refreshData();

    } catch (err) {
        console.error("Kayıt Hatası:", err.message);

        // KUSURSUZ YÖNTEM: Artık metne göre dilenmek yok, direkt veritabanı kuralıyla (23505) konuşuyoruz!
        if (err.code === '23505') {
            alert("⚠️ BU FATURA DAHA ÖNCE YÜKLENMİŞ!\nSistemde aynı faturadan zaten bulunduğu için tekrar kaydedilemez.");
        } else {
            alert("Hata oluştu: " + err.message);
        }
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
        refreshData();               // Listeyi tazeleyelim ki tablo ekranından da silinip uçsun
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

function addLineItem(desc = '', qty = 1, price = 0, total = 0, taxRate = 20) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" value="${desc}" placeholder="Ürün adı"></td>
        <td><input type="number" value="${qty}" class="text-center"></td>
        <td><input type="number" value="${price}" step="0.01"></td>
        <td><input type="number" value="${total}" step="0.01" readonly></td>
        <td class="text-center">
            <input type="checkbox" class="internal-toggle" title="Şirket İçi Kullanım (Sarf)">
            <input type="hidden" class="tax-rate-val" value="${taxRate}">
        </td>
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








// View switching logic (Sekme değişimi ve Hafıza Transferi)
function switchView(view) {
    if (currentView === view) return; // Zaten aynı sekmedeysek boşa yorulma

    // 1- EKRANDAKİLERİ KAYDET (Eski sekmeye veda etmeden hemen önce bavula dolduruyoruz)
    filterMemory[currentView] = {
        search: document.getElementById('mainSearch').value,
        company: document.getElementById('filterCompany').value,
        currency: document.getElementById('filterCurrency').value,
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
    document.getElementById('filterCurrency').value = memory.currency;
    if (document.getElementById('filterYear')) document.getElementById('filterYear').value = memory.year;
    if (document.getElementById('filterMonth')) document.getElementById('filterMonth').value = memory.month;
    if (document.getElementById('filterStatus')) document.getElementById('filterStatus').value = memory.status;

    // (Şirket kutusu populateCompanyFilter ile özel dolacağı için onun hafızasını filtre motorunun içine yerleştirilmek üzere geçici kutuda saklıyoruz)
    document.getElementById('filterCompany').setAttribute('data-memory', memory.company);

    // Özet kartları (Sadece Gelen'de Görünsün)
    const summaryContainer = document.getElementById('summaryCardsContainer');
    if (summaryContainer) {
        summaryContainer.style.display = (view === 'gelen') ? '' : 'none';
    }

    renderCurrentView();
}