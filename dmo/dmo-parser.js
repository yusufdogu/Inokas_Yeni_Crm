// ── API CONFIG ───────────────────────────────────────────────────────────────
// ── URUNLER LOOKUP ───────────────────────────────────────────────────────────
const URUNLER = {
    105809: { urun: "EPSON C13T08H100 WF Enterprise AM-C4000 Black 50k",   maliyet_usd: 107 },
    105810: { urun: "EPSON C13T08H200 WF Enterprise AM-C4000 Cyan 30k",    maliyet_usd: 107 },
    105811: { urun: "EPSON C13T08H300 WF Enterprise AM-C4000 Magenta 30k", maliyet_usd: 107 },
    105812: { urun: "EPSON C13T08H400 WF Enterprise AM-C4000 Yellow 30k",  maliyet_usd: 107 },
    105813: { urun: "EPSON C13T08G100 WF Enterprise AM-C5000 Black 50k",   maliyet_usd: 107 },
    105814: { urun: "EPSON C13T08G200 WF Enterprise AM-C5000 Cyan 30k",    maliyet_usd: 107 },
    105815: { urun: "EPSON C13T08G300 WF Enterprise AM-C5000 Magenta 30k", maliyet_usd: 107 },
    105816: { urun: "EPSON C13T08G400 WF Enterprise AM-C5000 Yellow 30k",  maliyet_usd: 107 },
    105817: { urun: "EPSON C13T11E140 WF-C5390/C5890 XXL Black 10k",       maliyet_usd: 36  },
    105819: { urun: "EPSON C13T11D340 WF-C5390/C5890 XL Magenta 5k",       maliyet_usd: 36  },
    105820: { urun: "EPSON C13T11D440 WF-C5390/C5890 XL Yellow 5k",        maliyet_usd: 36  },
    76618:  { urun: "EPSON C13T02S100 C20750 50000 BLACK",                  maliyet_usd: 130 },
    76619:  { urun: "EPSON C13T02S200 C20750 50000 CYAN",                   maliyet_usd: 213 },
    76620:  { urun: "EPSON C13T02S300 C20750 50000 MAGENTA",                maliyet_usd: 213 },
    76621:  { urun: "EPSON C13T02S400 C20750 50000 YELLOW",                 maliyet_usd: 213 },
    76622:  { urun: "EPSON C13T02Y100 C21000 50000 BLACK",                  maliyet_usd: 119 },
    76623:  { urun: "EPSON C13T02Y200 C21000 50000 CYAN",                   maliyet_usd: 174 },
    76624:  { urun: "EPSON C13T02Y300 C21000 50000 MAGENTA",                maliyet_usd: 174 },
    76625:  { urun: "EPSON C13T02Y400 C21000 50000 YELLOW",                 maliyet_usd: 174 },
    76630:  { urun: "EPSON C13T05B140 C879 86000 BLACK",                    maliyet_usd: 175 },
    76632:  { urun: "EPSON C13T05B240 C879 50000 CYAN",                     maliyet_usd: 225 },
    76633:  { urun: "EPSON C13T05B340 C879 50000 MAGENTA",                  maliyet_usd: 225 },
    76635:  { urun: "EPSON C13T05B440 C879 50000 YELLOW",                   maliyet_usd: 225 },
    105821: { urun: "EPSON C11CJ43401 RENKLİ Yazıcı AM-C4000",             maliyet_usd: 2250},
    106776: { urun: "EPSON C11CK23401 RENKLİ Yazıcı C5890",                maliyet_usd: 295 },
    74012:  { urun: "EPSON C11CH88401 RENKLİ Yazıcı C21000",               maliyet_usd: 7000},
    57205:  { urun: "EPSON DS-970 Tarayıcı A4",                            maliyet_usd: 496 },
    94581:  { urun: "EPSON C13T01C100 WF-C529R/C579R Black XL",            maliyet_usd: 35  },
    94586:  { urun: "EPSON C13T01C200 WF-C529R/C579R Cyan XL",             maliyet_usd: 35  },
    94590:  { urun: "EPSON C13T01C300 WF-C529R/C579R Magenta XL",          maliyet_usd: 35  },
    94593:  { urun: "EPSON C13T01C400 WF-C529R/C579R Yellow XL",           maliyet_usd: 35  },
    112723: { urun: "EPSON C13T12F140 WF-M5399/5899 Black 40K",            maliyet_usd: 140 },
    68443:  { urun: "EPSON C13T04Q100 M20590 60000 BLACK",                  maliyet_usd: 180 },
    112718: { urun: "EPSON C11CK76402 SİYAH-BEYAZ Yazıcı M5899",          maliyet_usd: 295 },
    127105: { urun: "EPSON C11CJ91402 RENKLİ Yazıcı AM-C6000",            maliyet_usd: 3160},
    40876:  { urun: "MÜREKKEP-KARTUŞ 5000 CYAN",                           maliyet_usd: 42  },
    40881:  { urun: "MÜREKKEP-KARTUŞ 5000 YELLOW",                         maliyet_usd: 42  },
    40883:  { urun: "C13T946140 10000 SİYAH-BEYAZ",                        maliyet_usd: 50  },
};

// ── FILTER STATE ─────────────────────────────────────────────────────────────
const filterState = {
    search:    "",
    company:   "",
    product:   "",
    dateStart: "",
    dateEnd:   "",
    status:    "",
    category:  "",
};
function readFilters() {
    filterState.search     = document.getElementById("mainSearch")?.value.toLocaleLowerCase("tr-TR")    || "";
    filterState.company    = filterState.company || "";
    filterState.product    = filterState.product || document.getElementById("filterProduct")?.value.toLocaleLowerCase("tr-TR") || "";
    filterState.dateStart  = document.getElementById("filterDateStart")?.value                          || "";
    filterState.dateEnd    = document.getElementById("filterDateEnd")?.value                            || "";
    filterState.status     = document.getElementById("filterStatus")?.value                             || "";
    filterState.category   = document.getElementById("filterCategory")?.value                           || "";
    filterState.minBasket  = parseFloat(document.getElementById("filterMinBasket")?.value)              || null;
    filterState.maxBasket  = parseFloat(document.getElementById("filterMaxBasket")?.value)              || null;
}

function getActiveFilters() {
    return {
        hasCompany:   !!filterState.company,
        hasProduct:   !!filterState.product,
        hasDateRange: !!(filterState.dateStart && filterState.dateEnd),
        hasSearch:    !!filterState.search,
    };
}

let _editingOrderId = null;
// ── PDF STATE ────────────────────────────────────────────────────────────────
let pdfs            = [];   // { file, blobUrl, parsedData, name }
let activePdfIndex  = null;


// ── PDF UPLOAD & PARSE ───────────────────────────────────────────────────────

async function parseSinglePdf(file) {
    const formData = new FormData();
    formData.append("pdf", file);
    const res = await fetch("/api/dmo/parse-pdf", { method: "POST", body: formData });
    if (!res.ok) {
        let message = "Sunucu hatası";
        try {
            const err = await res.json();
            message = err.error || message;
        } catch {
            try {
                const txt = await res.text();
                if (txt) message = txt.slice(0, 200);
            } catch {
                // keep default message
            }
        }
        throw new Error(message);
    }
    return res.json();
}

async function addPDFs(files) {
    if (!files || files.length === 0) return;

    showToast(`${files.length} PDF ayrıştırılıyor...`, "info");

    let addedCount  = 0;
    let failedCount = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            const data = await parseSinglePdf(file);
            pdfs.push({
                file,
                blobUrl:    URL.createObjectURL(file),
                parsedData: data,
                name:       file.name,
            });
            addedCount++;
        } catch (err) {
            failedCount++;
            showToast(`${file.name} ayrıştırılamadı: ${err.message}`, "error");
        }
    }

    if (addedCount > 0) {
        if (activePdfIndex === null) activePdfIndex = 0;
        showToast(`${addedCount} PDF eklendi!`, "success");
        if (failedCount > 0) {
            showToast(`${failedCount} PDF atlandı`, "warn");
        }
        renderPdfTabs();
        switchTab(activePdfIndex);
    } else if (failedCount > 0) {
        showToast("Uygun PDF bulunamadı", "error");
    }
}
// ── SNAPSHOT FORM → parsedData ────────────────────────────────────────────────
function snapshotForm() {
    if (activePdfIndex === null || !pdfs[activePdfIndex]) return;
    pdfs[activePdfIndex].parsedData = {
        ...pdfs[activePdfIndex].parsedData,
        satis_siparis_no:            document.getElementById("sales_order_no")?.value    || null,
        satinalma_siparis_no:        document.getElementById("purchase_order_no")?.value || null,
        musteri_adi:                 document.getElementById("customer_name")?.value     || null,
        musteri_no:                  document.getElementById("customer_no")?.value       || null,
        tarih:                       document.getElementById("order_date")?.value        || null,
        karar_siparis_damga_vergisi: document.getElementById("stamp_tax")?.value         || null,
        malzeme_tablosu:             window._lastParsedItems                             || [],
    };
}

// ── SWITCH TAB ────────────────────────────────────────────────────────────────
function switchTab(index) {
    // Save only when truly switching away from an existing active tab.
    // This prevents overwriting first parsed PDF with empty form on initial open.
    if (activePdfIndex !== null && activePdfIndex !== index) {
        snapshotForm();
    }

    // 2. Switch
    activePdfIndex = index;
    const pdf = pdfs[index];
    if (!pdf) return;

    // 3. Show iframe
    const pdfViewer      = document.getElementById("pdfViewer");
    const pdfPlaceholder = document.getElementById("pdfPlaceholder");
    pdfViewer.src              = pdf.blobUrl;
    pdfViewer.style.display    = "block";
    pdfPlaceholder.style.display = "none";

    // 4. Fill form
    fillForm(pdf.parsedData);

    // 5. Re-render tabs to update active highlight
    renderPdfTabs();
}

// ── REMOVE PDF ────────────────────────────────────────────────────────────────
function removePdf(index) {
    URL.revokeObjectURL(pdfs[index].blobUrl);
    pdfs.splice(index, 1);

    if (pdfs.length === 0) {
        // No PDFs left — show upload box, clear form
        activePdfIndex = null;
        document.getElementById("pdfViewer").style.display     = "none";
        document.getElementById("pdfViewer").src               = "";
        document.getElementById("pdfPlaceholder").style.display = "flex";
        renderPdfTabs();
        resetFormFields();
        return;
    }

    // Adjust active index
    if (activePdfIndex >= pdfs.length) {
        activePdfIndex = pdfs.length - 1;
    }

    renderPdfTabs();
    switchTab(activePdfIndex);
}

// ── RENDER PDF TABS ───────────────────────────────────────────────────────────
function renderPdfTabs() {
    const container = document.getElementById("pdfTabsContainer");
    if (!container) return;

    if (pdfs.length === 0) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = `
        <div class="pdf-tabs-list">
            ${pdfs.map((pdf, i) => `
                <div class="pdf-tab ${i === activePdfIndex ? "pdf-tab-active" : ""}"
                     onclick="switchTab(${i})">
                    <span class="pdf-tab-name">📄 ${pdf.name}</span>
                    <button class="pdf-tab-remove" onclick="event.stopPropagation(); removePdf(${i})">✕</button>
                </div>
            `).join("")}
            <label class="pdf-tab-add" title="PDF Ekle">
                ＋ PDF Ekle
                <input type="file" accept=".pdf" multiple hidden
                       onchange="addPDFs(this.files); this.value='';">
            </label>
        </div>
    `;
}
// ── FILL FORM ────────────────────────────────────────────────────────────────
function pickItemValue(item, keys, fallback = "") {
    for (const key of keys) {
        const val = item?.[key];
        if (val !== undefined && val !== null && val !== "") return val;
    }
    return fallback;
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeLineItem(item = {}) {
    const katalogKod   = String(pickItemValue(item, ["KATALOG KOD NO", "SIRA NO KATALOG KOD NO"], "")).trim();
    const malzemeAdi   = String(pickItemValue(item, ["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"])).trim();
    const malzemeKodu  = String(pickItemValue(item, ["MALZEME_KODU"], "")).trim();
    const miktar       = parseFloat(String(pickItemValue(item, ["MIKTAR"], "0")).replace(",", ".")) || 0;

    // Use parseAmount only for Turkish-formatted strings from PDF
    // Use parseFloat for values already stored as raw numbers
    const rawDmo      = pickItemValue(item, ["KAT.SÖZ.FIY.(TL)", "KAT.SÃ–Z.FIY.(TL)"], "0");
    const rawIndirim  = pickItemValue(item, ["ALIMA ESAS INDIRMLI BIRIM FIYAT"], "0");
    const rawToplam   = pickItemValue(item, ["TUTARI (TL)"], "0");

    // If value contains comma → Turkish format from PDF → use parseAmount
    // Otherwise → raw float already stored → use parseFloat
    const dmoFiyat    = String(rawDmo).includes(",")    ? parseAmount(rawDmo)    : parseFloat(rawDmo)    || 0;
    const indirimFiyat = String(rawIndirim).includes(",") ? parseAmount(rawIndirim) : parseFloat(rawIndirim) || 0;
    const mevcutToplam = String(rawToplam).includes(",")  ? parseAmount(rawToplam)  : parseFloat(rawToplam)  || 0;

    const toplam = indirimFiyat > 0 && miktar > 0 ? indirimFiyat * miktar : mevcutToplam;

    return {
        "KATALOG KOD NO":                          katalogKod,
        "MALZEMENIN CINSI(VARSA MARKA VE MODELI)": malzemeAdi,
        "MALZEME_KODU":                            malzemeKodu,
        "KAT.SÖZ.FIY.(TL)":                       dmoFiyat,      // store as number, not string
        "ALIMA ESAS INDIRMLI BIRIM FIYAT":         indirimFiyat,  // store as number
        "MIKTAR":                                  String(miktar),
        "TUTARI (TL)":                             String(toplam), // store as raw float string
    };
}

function fillForm(data) {
    setField("sales_order_no", data.satis_siparis_no);
    setField("purchase_order_no",data.satinalma_siparis_no)
    setField("customer_name",  data.musteri_adi);
    setField("customer_no",  data.musteri_no);
    setField("order_date", parseOrderDate(data.tarih));
    setField("stamp_tax",      parseAmount(data.karar_siparis_damga_vergisi));

    window._lastParsedItems = (data.malzeme_tablosu || []).map(normalizeLineItem);
    renderLineItems(window._lastParsedItems);
}

function setField(id, value) {
    const el = document.getElementById(id);
    if (el && value !== null && value !== undefined) {
        el.value = value;
    }
}

// ── LINE ITEMS ────────────────────────────────────────────────────────────────
function renderLineItems(items) {
    const tbody = document.getElementById("lineItemsBody");
    tbody.innerHTML = "";


    items.forEach(item => {
        const katalogKod   = item["KATALOG KOD NO"] || "-";
        const malzemeAdi   = item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || "-";
        const malzemeKodu  = item["MALZEME_KODU"] || "-";
        const dmoFiyat     = item["KAT.SÖZ.FIY.(TL)"] || "0";
        const indirimFiyat = item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] || "0";
        const miktar       = item["MIKTAR"] || "0";
        const toplam       = parseFloat(item["TUTARI (TL)"]) || 0;

        // Maliyet hesabı
        const katalogKodInt = parseInt(katalogKod);
        const usdRate       = parseFloat(document.getElementById("usd_rate")?.value) || 45;
        const urun          = URUNLER[katalogKodInt];
        const maliyetTL     = urun && usdRate > 0
            ? (urun.maliyet_usd * parseInt(miktar) * usdRate).toFixed(2)
            : "-";

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${katalogKod}</td>
            <td>${malzemeAdi}</td>
            <td>${malzemeKodu}</td>
            <td class="text-right">${formatAmount(dmoFiyat)}</td>
            <td class="text-right">${formatAmount(indirimFiyat)}</td>
            <td class="text-right">${miktar}</td>
            <td class="text-right">${maliyetTL !== "-" ? formatAmount(maliyetTL) : "-"}</td>
            <td class="text-right">${formatAmount(toplam)}</td>
        `;
        tbody.appendChild(tr);
    });

    calculateDMOBasket(items);
}

// ── CALCULATIONS ──────────────────────────────────────────────────────────────

// DMO Sepet = sum of TUTARI (TL) from PDF
function calculateDMOBasket(items) {
    const total = items.reduce((sum, item) => {
        return sum + (parseFloat(item["TUTARI (TL)"]) || 0); // ← parseFloat not parseAmount
    }, 0);

    if (total > 0) {
        setField("dmo_basket", total.toFixed(2));
        calculateInokasBasket();
    }
}

function calculateInokasBasket() {
    const usdRate = parseFloat(document.getElementById("usd_rate")?.value) || 45;
    if (!window._lastParsedItems) return;

    let inokasTotal = 0;
    window._lastParsedItems.forEach(item => {
        const katalogKod = parseInt(item["SIRA NO KATALOG KOD NO"] || item["KATALOG KOD NO"] || "0");
        const miktar     = parseInt(item["MIKTAR"] || "0");
        const urun       = URUNLER[katalogKod];
        if (urun && usdRate > 0) {
            inokasTotal += urun.maliyet_usd * miktar * usdRate;
        }
    });

    setField("inokas_basket", inokasTotal.toFixed(2));
    calculateProfit();
}

function getLineItemMaliyetTL(item) {
    const katalogKod = pickItemValue(item, ["KATALOG KOD NO", "SIRA NO KATALOG KOD NO"], "0");
    const katalogKodInt = parseInt(katalogKod || "0", 10);
    const miktar = parseFloat(item["MIKTAR"] || "0") || 0;
    const usdRate = parseFloat(document.getElementById("usd_rate")?.value) || 45;
    const urun = URUNLER[katalogKodInt];
    if (!urun || usdRate <= 0 || miktar <= 0) return null;
    return urun.maliyet_usd * miktar * usdRate;
}

function updateLineItemField(index, field, value) {
    if (!Array.isArray(window._lastParsedItems) || !window._lastParsedItems[index]) return;
    const item = window._lastParsedItems[index];




    if (field === "katalog") {
        item["KATALOG KOD NO"] = String(value || "").trim();
        // When catalog code changes, try to fetch product name from URUNLER
        const katalogKodInt = parseInt(item["KATALOG KOD NO"] || "0");
        const urun = URUNLER[katalogKodInt];
        if (urun && !item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"]) {
            item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] = urun.urun;
        }
    }
    if (field === "adi") item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] = String(value || "").trim();
    if (field === "kodu") item["MALZEME_KODU"] = String(value || "").trim();
    if (field === "dmoFiyat") {
        item["KAT.SÖZ.FIY.(TL)"] = String(value || "0");
    }
    if (field === "indirimFiyat") item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] = String(value || "0");
    if (field === "miktar") item["MIKTAR"] = String(value || "0");

    const miktar = parseFloat(item["MIKTAR"] || "0") || 0;
    const indirimFiyat = parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] || "0") || 0;
    item["TUTARI (TL)"] = String(indirimFiyat * miktar);

    // Re-render to update maliyet column
    renderLineItems(window._lastParsedItems);
}

function removeLineItem(index) {
    if (!Array.isArray(window._lastParsedItems)) return;
    window._lastParsedItems.splice(index, 1);
    renderLineItems(window._lastParsedItems);
}

function addLineItem() {
    const tbody = document.getElementById("lineItemsBody");
    const tr    = document.createElement("tr");
    tr.innerHTML = `
        <td><input type="text" placeholder="Katalog Kod" oninput="recalcLineItems()"></td>
        <td><input type="text" placeholder="Ürün Adı"></td>
        <td><input type="text" placeholder="Ürün Kodu"></td>
        <td><input type="number" placeholder="0" oninput="recalcLineItems()"></td>
        <td><input type="number" placeholder="0" oninput="recalcLineItems()"></td>
        <td><input type="number" placeholder="0" oninput="recalcLineItems()"></td>
        <td><input type="number" placeholder="0" readonly></td>
        <td><input type="number" placeholder="0" oninput="recalcLineItems()"></td>
        <td>
            <button type="button" onclick="this.closest('tr').remove(); recalcLineItems();"
                style="background:#fee2e2; color:#ef4444; border:none; border-radius:6px; padding:4px 8px; cursor:pointer;">✕</button>
        </td>
    `;
    tbody.appendChild(tr);
    // Do NOT call calculateDMOBasket here
}

// Override readonly renderer with editable version without touching parse/save flow.
function renderLineItems(items) {
    const tbody = document.getElementById("lineItemsBody");
    if (!tbody) return;
    window._lastParsedItems = Array.isArray(items) ? items : [];
    tbody.innerHTML = "";

    if (window._lastParsedItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; color:#94a3b8; padding:14px;">
                    Kalem yok. "＋ Kalem Ekle" ile manuel ekleyebilirsiniz.
                </td>
            </tr>
        `;
        calculateDMOBasket([]);
        return;
    }

    window._lastParsedItems.forEach((rawItem, index) => {
        const item = normalizeLineItem(rawItem);
        window._lastParsedItems[index] = item;

        const katalogKod = item["KATALOG KOD NO"] || "";
        const malzemeAdi = item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || "";
        const malzemeKodu = item["MALZEME_KODU"] || "";
        const dmoFiyat     = parseFloat(pickItemValue(item, ["KAT.SÖZ.FIY.(TL)", "KAT.SÃ–Z.FIY.(TL)"], "0")) || 0;
        const indirimFiyat = parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] || "0") || 0;
        const miktar = parseFloat(item["MIKTAR"] || "0") || 0;
        const toplam       = parseFloat(item["TUTARI (TL)"]) || 0;
        const maliyetTL = getLineItemMaliyetTL(item);

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><input type="text" value="${escapeHtml(katalogKod)}" oninput="updateLineItemField(${index}, 'katalog', this.value)"></td>
            <td><input type="text" value="${escapeHtml(malzemeAdi)}" oninput="updateLineItemField(${index}, 'adi', this.value)"></td>
            <td><input type="text" value="${escapeHtml(malzemeKodu)}" oninput="updateLineItemField(${index}, 'kodu', this.value)"></td>
            <td><input type="number" step="0.01" min="0" value="${dmoFiyat}" oninput="updateLineItemField(${index}, 'dmoFiyat', this.value)"></td>
            <td><input type="number" step="0.01" min="0" value="${indirimFiyat}" oninput="updateLineItemField(${index}, 'indirimFiyat', this.value)"></td>
            <td><input type="number" step="1" min="0" value="${miktar}" oninput="updateLineItemField(${index}, 'miktar', this.value)"></td>
            <td class="text-right">${maliyetTL !== null ? formatAmount(maliyetTL) : "-"}</td>
            <td class="text-right">${formatAmount(toplam)}</td>
            <td class="text-right"><button type="button" class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="removeLineItem(${index})">Sil</button></td>
        `;
        tbody.appendChild(tr);
    });

    calculateDMOBasket(window._lastParsedItems);
}

function computeInvoiceMetrics(dmoBasket, inokasBasket, stampTax) {
    const kdv         = dmoBasket * 0.20;
    const tevkifat    = kdv * 0.20;
    const gercekKdv   = kdv - tevkifat;
    const dmoKesinti  = dmoBasket * 0.08;
    const risturn     = dmoBasket * 0.01;
    const toplamGelir = dmoBasket + kdv;
    const toplamGider = inokasBasket + stampTax + tevkifat + dmoKesinti + risturn;
    const netProfit   = toplamGelir - toplamGider;
    const profitPct   = dmoBasket > 0 ? (netProfit / dmoBasket) * 100 : 0;

    return {
        kdv,
        tevkifat,
        gercekKdv,
        dmoKesinti,
        risturn,
        toplamGelir,
        toplamGider,
        netProfit,
        profitPct,
    };
}

function calculateProfit() {
    const dmoBasket    = parseFloat(document.getElementById("dmo_basket")?.value)    || 0;
    const inokasBasket = parseFloat(document.getElementById("inokas_basket")?.value) || 0;
    const stampTax     = parseFloat(document.getElementById("stamp_tax")?.value)     || 0;

    const m = computeInvoiceMetrics(dmoBasket, inokasBasket, stampTax);

    // Set fields
    setField("kdv_tax",          m.kdv.toFixed(2));
    setField("inv_dmo_kesinti",  m.dmoKesinti.toFixed(2));
    setField("inv_tevkifat",     m.tevkifat.toFixed(2));
    setField("inv_gercek_kdv",   m.gercekKdv.toFixed(2));
    setField("inv_toplam_gelir", m.toplamGelir.toFixed(2));
    setField("inv_toplam_gider", m.toplamGider.toFixed(2));
    setField("inv_risturn",m.risturn.toFixed(2))

    const profitEl  = document.getElementById("net_profit_display");
    const percentEl = document.getElementById("profit_percent_display");

    if (profitEl) {
        profitEl.textContent = formatAmount(m.netProfit.toFixed(2)) + " ₺";
        profitEl.style.color = m.netProfit >= 0 ? "#16a34a" : "#dc2626";
    }
    if (percentEl) {
        percentEl.textContent = m.profitPct.toFixed(2) + "%";
        percentEl.style.color = m.profitPct >= 0 ? "#16a34a" : "#dc2626";
    }
}
// Recalculate when user changes risturn or stamp tax manually
["stamp_tax"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", calculateProfit);
});

// ── MODAL ────────────────────────────────────────────────────────────────────
function openInvoiceModal() {
    document.getElementById("invoiceModal").style.display = "flex";
    const currentUsd = parseFloat(document.getElementById("stat-usd-rate")?.textContent);
    if (!isNaN(currentUsd)) {
        setField("usd_rate", currentUsd.toFixed(2));
    }
}

function closeInvoiceModal() {
    document.getElementById("invoiceModal").style.display = "none";
    _editingOrderId = null; // ← reset edit mode
    resetForm();
}

// ── AUTOCOMPLETE ──────────────────────────────────────────────────────────────
function handleMainSearch() {
    const val      = document.getElementById("mainSearch")?.value.toLocaleLowerCase("tr-TR") || "";
    const dropdown = document.getElementById("companyDropdown");

    if (val.length < 1) {
        dropdown.style.display = "none";
        filterState.search     = "";
        filterState.company    = "";
        renderCurrentView();
        return;
    }

    // Show matching companies
    const allCompanies = Array.from(
        document.querySelectorAll("#filterCompany option")
    ).map(o => o.value).filter(Boolean);

    const matches = allCompanies.filter(c =>
        c.toLocaleLowerCase("tr-TR").includes(val)
    );

    if (matches.length > 0) {
        dropdown.style.display = "block";
        dropdown.innerHTML = matches.map(c => `
            <div onclick="selectCompany('${c}')"
                style="padding:8px 12px; cursor:pointer; font-size:13px; border-bottom:1px solid #f1f5f9;"
                onmouseover="this.style.background='#f8fafc'"
                onmouseout="this.style.background='white'">
                🏢 ${c}
            </div>
        `).join("");
    } else {
        dropdown.style.display = "none";
    }

    filterState.search  = val;
    filterState.company = "";
    renderCurrentView();
}

function selectCompany(company) {
    document.getElementById("mainSearch").value          = company;
    document.getElementById("companyDropdown").style.display = "none";
    filterState.company = company;
    filterState.search  = "";
    renderCurrentView();
}

function handleProductSearch() {
    const val      = document.getElementById("filterProduct")?.value.toLocaleLowerCase("tr-TR") || "";
    const dropdown = document.getElementById("productDropdown");

    if (val.length < 2) {
        dropdown.style.display = "none";
        filterState.product    = "";
        renderCurrentView();
        return;
    }

    // Show matching products from hhProducts if loaded, otherwise skip
    const matches = hhProducts.filter(p =>
        p.product_name?.toLocaleLowerCase("tr-TR").includes(val) ||
        p.product_code?.toLocaleLowerCase("tr-TR").includes(val) ||
        p.dmo_code?.toString().includes(val)
    ).slice(0, 8);

    if (matches.length > 0) {
        dropdown.style.display = "block";
        dropdown.innerHTML = matches.map(p => `
            <div onclick="selectProduct('${p.product_code}', '${p.product_name?.replace(/'/g, "\\'")}')"
                style="padding:8px 12px; cursor:pointer; font-size:12px; border-bottom:1px solid #f1f5f9;"
                onmouseover="this.style.background='#f8fafc'"
                onmouseout="this.style.background='white'">
                <strong style="color:#2563eb;">${p.dmo_code}</strong> — ${p.product_name}
            </div>
        `).join("");
    } else {
        dropdown.style.display = "none";
    }

    filterState.product = val;
    renderCurrentView();
}

function selectProduct(code, name) {
    document.getElementById("filterProduct").value           = name;
    document.getElementById("productDropdown").style.display = "none";
    filterState.product = code;
    renderCurrentView();
}

// Close dropdowns when clicking outside
document.addEventListener("click", (e) => {
    if (!e.target.closest("#mainSearch") && !e.target.closest("#companyDropdown")) {
        const d = document.getElementById("companyDropdown");
        if (d) d.style.display = "none";
    }
    if (!e.target.closest("#filterProduct") && !e.target.closest("#productDropdown")) {
        const d = document.getElementById("productDropdown");
        if (d) d.style.display = "none";
    }
});

function resetForm() {
    // Clear PDF state
    pdfs.forEach(p => URL.revokeObjectURL(p.blobUrl));
    pdfs           = [];
    activePdfIndex = null;

    // Clear form fields
    resetFormFields();

    // Reset PDF viewer
    document.getElementById("pdfViewer").style.display            = "none";
    document.getElementById("pdfViewer").src                      = "";
    document.getElementById("pdfPlaceholder").style.display       = "flex";
    document.getElementById("pdfPlaceholder").innerHTML           = `
        <input type="file" id="pdfInput" accept=".pdf" multiple hidden
               onchange="addPDFs(this.files); this.value='';">
        <span class="upload-icon">📁</span>
        <h3>PDF'i Buraya Bırakın</h3>
        <button class="btn btn-primary" onclick="document.getElementById('pdfInput').click()">Dosya Seç</button>
    `;
    const placeholder = document.getElementById("pdfPlaceholder");
    if (placeholder) {
        placeholder.ondragover = function (event) {
            event.preventDefault();
            this.classList.add("drag-over");
        };
        placeholder.ondragleave = function () {
            this.classList.remove("drag-over");
        };
        placeholder.ondrop = function (event) {
            event.preventDefault();
            this.classList.remove("drag-over");
            addPDFs(event.dataTransfer.files);
        };
    }
    renderPdfTabs();
    document.querySelector("#invoiceModal .pdf-preview-side").style.display = "flex";
    document.querySelector("#invoiceModal .modal-form-side").style.flex     = "";
    document.getElementById("modalFormTitle").textContent     = "DMO Sipariş & Karlılık Analizi";
    document.getElementById("btnSaveOrder").textContent       = "Siparişi ve Rezervleri Kaydet";
    clearModalAlert();
    window._lastParsedItems = null;
    _editingOrderId         = null;
}
// Clears only form inputs — used when all PDFs are removed mid-session
function resetFormFields() {
    document.getElementById("dmoSiparisForm").reset();
    document.getElementById("lineItemsBody").innerHTML            = "";
    document.getElementById("net_profit_display").textContent     = "";
    document.getElementById("profit_percent_display").textContent = "";
    window._lastParsedItems = null;
}

function closeInvoiceDetailModal() {
    document.getElementById("invoiceDetailModal").style.display = "none";
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

// "1.244.317,12" → 1244317.12
function parseAmount(str) {
    if (!str) return 0;
    return parseFloat(str.toString().replace(/\./g, "").replace(",", ".")) || 0;
}

// 1244317.12 → "1.244.317,12"
function formatAmount(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast       = document.createElement("div");
    toast.className   = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}


async function saveOrder() {
    const salesOrderNo = document.getElementById("sales_order_no")?.value?.trim();
    if (!salesOrderNo) {
        showModalAlert("Satış Sipariş No bulunamadı!", "error");
        return;
    }

    const purchaseOrderNo = document.getElementById("purchase_order_no")?.value?.trim();
    const dmoBasket       = parseFloat(document.getElementById("dmo_basket")?.value)    || 0;
    const inokasBasket    = parseFloat(document.getElementById("inokas_basket")?.value) || 0;
    const stampTax        = parseFloat(document.getElementById("stamp_tax")?.value)     || 0;
    const m               = computeInvoiceMetrics(dmoBasket, inokasBasket, stampTax);
    const kdv             = m.kdv;
    const netProfit       = m.netProfit;
    const profitPct       = m.profitPct;

    try {
        showModalAlert("Kaydediliyor...", "info");

        // ── 1. Duplicate check ────────────────────────────────────────────────
        const { data: existing } = await db
            .from("dmo_orders")
            .select("id")
            .eq("sales_order_no", salesOrderNo)
            .maybeSingle();

        if (existing) {
            showModalAlert("Bu sipariş zaten kayıtlı: " + salesOrderNo, "error");
            return;
        }
        // ── EDIT MODE ────────────────────────────────────────────────────────────────
        if (_editingOrderId) {
            const { error: updateError } = await db
                .from("dmo_orders")
                .update({
                    purchase_order_no:     purchaseOrderNo,
                    customer_name:         document.getElementById("customer_name")?.value,
                    customer_no:           document.getElementById("customer_no")?.value,
                    order_date:            parseOrderDate(document.getElementById("order_date")?.value),
                    stamp_tax:             stampTax,
                    dmo_basket_total:      dmoBasket,
                    inokas_basket_total:   inokasBasket,
                    stamp_tax_total:       stampTax,
                    net_profit:            netProfit,
                    profit_percentage:     profitPct,
                })
                .eq("id", _editingOrderId);

            if (updateError) {
                showModalAlert("Güncelleme başarısız: " + updateError.message, "error");
                return;
            }

            showModalAlert("Sipariş güncellendi! ✓", "success");
            setTimeout(() => {
                closeInvoiceModal();
                renderCurrentView();
            }, 1000);
            return; // ← stop here, don't run insert logic below
        }

        // ── 2. Save order ─────────────────────────────────────────────────────
        const { data: order, error: orderError } = await db
            .from("dmo_orders")
            .insert({
                sales_order_no:        salesOrderNo,
                purchase_order_no:     purchaseOrderNo,
                customer_name:         document.getElementById("customer_name")?.value,
                customer_no:           document.getElementById("customer_no")?.value,
                order_date:            parseOrderDate(document.getElementById("order_date")?.value) ,
                stamp_tax:             stampTax,
                dmo_basket_total:      dmoBasket,
                inokas_basket_total:   inokasBasket,
                stamp_tax_total:       stampTax,
                net_profit:            netProfit,
                profit_percentage:     profitPct,
                total_amount_excl_vat: dmoBasket,
                status:                "Beklemede",
            })
            .select()
            .single();

        if (orderError) {
            showModalAlert("Sipariş kaydedilemedi: " + orderError.message, "error");
            return;
        }

        // ── 3. Save line items ────────────────────────────────────────────────
        const items     = window._lastParsedItems || [];
        let   failedItems = 0;

        for (const item of items) {
            const katalogKod  = parseInt(item["KATALOG KOD NO"] || "0");
            const malzemeKodu = item["MALZEME_KODU"] || null;
            const miktar      = parseInt(item["MIKTAR"] || "0");
            const unitPrice   = parseAmount(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] || "0");
            const lineTotal   = parseAmount(item["TUTARI (TL)"] || "0");

            let productId = null;

            if (malzemeKodu) {
                const { data: existingProduct } = await db
                    .from("products")
                    .select("id")
                    .eq("product_code", malzemeKodu)
                    .maybeSingle();

                if (existingProduct) {
                    productId = existingProduct.id;
                } else {
                    const urun = URUNLER[katalogKod];
                    const { data: newProduct, error: productError } = await db
                        .from("products")
                        .insert({
                            product_code:            malzemeKodu,
                            product_name:            item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || malzemeKodu,
                            dmo_code:                katalogKod.toString(),
                            last_purchase_price_cur: urun ? urun.maliyet_usd : 0,
                            last_purchase_currency:  "USD",
                        })
                        .select()
                        .single();

                    if (productError) {
                        console.error("Ürün kaydedilemedi:", malzemeKodu, productError.message);
                        failedItems++;
                    } else {
                        productId = newProduct.id;
                    }
                }
            }

            const { error: itemError } = await db
                .from("dmo_order_items")
                .insert({
                    order_id:            order.id,
                    product_id:          productId,
                    quantity:            miktar,
                    unit_price_excl_vat: unitPrice,
                    line_total_excl_vat: lineTotal,
                });

            if (itemError) {
                console.error("Kalem kaydedilemedi:", malzemeKodu, itemError.message);
                failedItems++;
            }
        }

        // ── 4. Final feedback then close ──────────────────────────────────────
        if (failedItems > 0) {
            showModalAlert(`Sipariş kaydedildi fakat ${failedItems} kalem hatalı!`, "warn");
            // stay open so user sees the warning
        } else {
            showModalAlert("Sipariş başarıyla kaydedildi! ✓", "success");
            // close only after success is confirmed
            setTimeout(() => {
                closeInvoiceModal();
                renderCurrentView();
            }, 1000);
        }

    } catch (err) {
        console.error("saveOrder error:", err);
        showModalAlert("Beklenmeyen hata: " + err.message, "error");
    }
}
// ── DETAIL MODAL ─────────────────────────────────────────────────────────────
async function openDetailModal(order) {
    // Fill header
    _currentOrderId = order.id;  // ← add this at the top


    document.getElementById("detail_no_text").textContent  = order.sales_order_no || "Taslak";
    document.getElementById("detail_company").textContent  = order.customer_name  || "-";
    document.getElementById("detail_date").textContent     = formatDate(order.order_date);
    document.getElementById("detail_total").textContent    = formatAmount(order.dmo_basket_total) + " ₺";
    document.getElementById("detail_inokas").textContent   = formatAmount(order.inokas_basket_total) + " ₺";
    document.getElementById("detail_tax").textContent      = formatAmount(order.dmo_basket_total * 0.20) + " ₺";
    document.getElementById("detail_stamp").textContent    = formatAmount(order.stamp_tax_total) + " ₺";
    document.getElementById("detail_tevkifat").textContent = formatAmount(order.dmo_basket_total * 0.20 * 0.20) + " ₺";

    const profitEl = document.getElementById("detail_profit");
    profitEl.textContent = formatAmount(order.net_profit) + " ₺  %" + (order.profit_percentage?.toFixed(1) || "0");
    profitEl.style.color = order.net_profit >= 0 ? "#16a34a" : "#dc2626";
    // Fetch line items
    const { data: items, error } = await db
        .from("dmo_order_items")
        .select(`
            quantity,
            unit_price_excl_vat,
            line_total_excl_vat,
            products (
                product_code,
                product_name,
                last_purchase_price_tl
            )
        `)
        .eq("order_id", order.id);

    console.log("items:", items, "error:", error);

    if (error) {
        showToast("Kalemler yüklenemedi: " + error.message, "error");
        return;
    }

    // Render line items
    const tbody = document.getElementById("detail_items_body");
    tbody.innerHTML = "";

    items.forEach(item => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="padding:10px 15px;">${item.products?.product_name || "-"}</td>
            <td style="padding:10px 15px; text-align:center;">${item.quantity}</td>
            <td style="padding:10px 15px; text-align:right;">${formatAmount(item.unit_price_excl_vat)} ₺</td>
            <td style="padding:10px 15px; text-align:center;">%20</td>
            <td style="padding:10px 15px; text-align:right;">${formatAmount(item.line_total_excl_vat)} ₺</td>
        `;
        tbody.appendChild(tr);
    });

    // Fill notes with profit breakdown
    document.getElementById("detail_notes").innerHTML = `
        DMO Sepet: <strong>${formatAmount(order.dmo_basket_total)} ₺</strong> | 
        İnokas Sepet: <strong>${formatAmount(order.inokas_basket_total)} ₺</strong> | 
        Damga: <strong>${formatAmount(order.stamp_tax_total)} ₺</strong> | 
        KDV: <strong>${formatAmount(order.dmo_basket_total * 0.20)} ₺</strong> | 
        Net Kar: <strong style="color:${order.net_profit >= 0 ? '#16a34a' : '#dc2626'}">${formatAmount(order.net_profit)} ₺</strong> | 
        Kar %: <strong>${order.profit_percentage?.toFixed(2)}%</strong>
    `;

    // Delete button
    document.getElementById("btnDeleteInvoice").onclick = () => deleteOrder(order.id);

    // Edit button — will implement later
    document.getElementById("btnEditInvoice").onclick = () => openEditModal(order);

    document.getElementById("invoiceDetailModal").style.display = "flex";
}

async function openEditModal(order) {
    closeInvoiceDetailModal();
    _editingOrderId = order.id;

    // Open invoice modal
    document.getElementById("invoiceModal").style.display = "flex";

    // Change header and button
    document.getElementById("modalFormTitle").textContent = "DMO Sipariş Düzenle";
    document.getElementById("btnSaveOrder").textContent   = "✏️ Güncelle";



    // Fill form fields
    setField("sales_order_no",   order.sales_order_no);
    setField("purchase_order_no", order.purchase_order_no);
    setField("customer_name",    order.customer_name);
    setField("customer_no",      order.customer_no);
    setField("order_date",       formatDate(order.order_date));
    setField("dmo_basket",       order.dmo_basket_total);
    setField("inokas_basket",    order.inokas_basket_total);
    setField("stamp_tax",        order.stamp_tax_total);

    // Fetch and render line items
    const { data: items, error } = await db
        .from("dmo_order_items")
        .select(`
            quantity,
            unit_price_excl_vat,
            line_total_excl_vat,
            products (
                product_code,
                product_name,
                dmo_code
            )
        `)
        .eq("order_id", order.id);

    if (!error && items) {
        // Convert to same format as _lastParsedItems so calculateProfit works
        window._lastParsedItems = items.map(i => ({
            "KATALOG KOD NO":                           i.products?.dmo_code || "0",
            "MALZEMENIN CINSI(VARSA MARKA VE MODELI)":  i.products?.product_name || "",
            "MALZEME_KODU":                             i.products?.product_code || "",
            "KAT.SÖZ.FIY.(TL)":                         i.unit_price_excl_vat?.toString() || "0",
            "ALIMA ESAS INDIRMLI BIRIM FIYAT":          i.unit_price_excl_vat?.toString() || "0",
            "MIKTAR":                                   i.quantity?.toString() || "0",
            "TUTARI (TL)":                              i.line_total_excl_vat?.toString() || "0",
        }));

        renderLineItems(window._lastParsedItems);
    }

    calculateProfit();
}
// ── MODAL ALERT ───────────────────────────────────────────────────────────────
function showModalAlert(message, type = "info") {
    const el = document.getElementById("modalAlert");
    if (!el) return;

    const styles = {
        info:    { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe", icon: "⏳" },
        success: { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0", icon: "✅" },
        error:   { bg: "#fef2f2", color: "#dc2626", border: "#fecaca", icon: "❌" },
        warn:    { bg: "#fffbeb", color: "#d97706", border: "#fde68a", icon: "⚠️" },
    };

    const s = styles[type] || styles.info;
    el.style.display     = "flex";
    el.style.background  = s.bg;
    el.style.color       = s.color;
    el.style.border      = `1px solid ${s.border}`;
    el.innerHTML         = `<span>${s.icon}</span><span>${message}</span>`;
}

function clearModalAlert() {
    const el = document.getElementById("modalAlert");
    if (el) el.style.display = "none";
}

// ── DELETE ORDER ─────────────────────────────────────────────────────────────
async function deleteOrder(orderId) {
    if (!confirm("Bu siparişi silmek istediğinizden emin misiniz?")) return;

    // Delete line items first (foreign key constraint)
    await db.from("dmo_order_items").delete().eq("order_id", orderId);

    const { error } = await db.from("dmo_orders").delete().eq("id", orderId);

    if (error) {
        showToast("Silinemedi: " + error.message, "error");
        return;
    }

    showToast("Sipariş silindi!", "success");
    closeInvoiceDetailModal();
    renderCurrentView();
}

// DD.MM.YYYY → YYYY-MM-DD (db date format)
function parseOrderDate(dateStr) {
    if (!dateStr) return new Date().toISOString().slice(0, 10);
    const parts = dateStr.split(".");
    if (parts.length !== 3) return new Date().toISOString().slice(0, 10);
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}


// ── CENTRAL CONTROLLER ────────────────────────────────────────────────────────
async function renderCurrentView() {
    readFilters();

    let query = db
        .from("dmo_orders")
        .select("*")
        .order("order_date", { ascending: true });

    if (filterState.dateStart) query = query.gte("order_date", filterState.dateStart);
    if (filterState.dateEnd)   query = query.lte("order_date", filterState.dateEnd);
    if (filterState.company)   query = query.ilike("customer_name", `%${filterState.company}%`);
    if (filterState.status)    query = query.eq("status", filterState.status);

    const { data: orders, error } = await query;
    if (error) {
        showToast("Veri yüklenemedi: " + error.message, "error");
        return;
    }

    let filteredOrders = orders;

    // Product filter — search by name, product code or dmo code
    if (filterState.product) {
        const { data: matchingProducts } = await db
            .from("products")
            .select("id")
            .or(`product_name.ilike.%${filterState.product}%,product_code.ilike.%${filterState.product}%,dmo_code.ilike.%${filterState.product}%`);

        const productIds = matchingProducts?.map(p => p.id) || [];

        if (productIds.length > 0) {
            const { data: matchingItems } = await db
                .from("dmo_order_items")
                .select("order_id")
                .in("product_id", productIds);

            const matchingOrderIds = new Set(matchingItems?.map(i => i.order_id) || []);
            filteredOrders = filteredOrders.filter(o => matchingOrderIds.has(o.id));
        } else {
            filteredOrders = [];
        }
    }

    // Category filter
    if (filterState.category) {
        const { data: categoryProducts } = await db
            .from("products")
            .select("id")
            .eq("category", filterState.category);

        const categoryIds = categoryProducts?.map(p => p.id) || [];

        if (categoryIds.length > 0) {
            const { data: categoryItems } = await db
                .from("dmo_order_items")
                .select("order_id")
                .in("product_id", categoryIds);

            const categoryOrderIds = new Set(categoryItems?.map(i => i.order_id) || []);
            filteredOrders = filteredOrders.filter(o => categoryOrderIds.has(o.id));
        } else {
            filteredOrders = [];
        }
    }

    // Search filter
    if (filterState.search) {
        filteredOrders = filteredOrders.filter(o =>
            o.sales_order_no?.toLocaleLowerCase("tr-TR").includes(filterState.search) ||
            o.customer_name?.toLocaleLowerCase("tr-TR").includes(filterState.search)
        );
    }
    // Basket range filter
    if (filterState.minBasket) {
        filteredOrders = filteredOrders.filter(o => o.dmo_basket_total >= filterState.minBasket);
    }
    if (filterState.maxBasket) {
        filteredOrders = filteredOrders.filter(o => o.dmo_basket_total <= filterState.maxBasket);
    }

    renderTable(filteredOrders);
    renderStatsCards(filteredOrders);
    await loadCharts(filteredOrders);
    populateCompanyFilter(orders);
}


// ── POPULATE COMPANY FILTER DYNAMICALLY ──────────────────────────────────────
function populateCompanyFilter(orders) {
    const select  = document.getElementById("filterCompany");
    if (!select) return; // ← add this
    const current = select.value;

    const companies = [...new Set(orders.map(o => o.customer_name).filter(Boolean))];

    select.innerHTML = `<option value="">Tüm Firmalar</option>`;
    companies.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        if (c === current) opt.selected = true;
        select.appendChild(opt);
    });
}

// ── TOGGLE INVOICE LIST ───────────────────────────────────────────────────────
function toggleInvoiceList() {
    const panel  = document.getElementById("invoiceListPanel");
    const btn    = document.querySelector("[onclick='toggleInvoiceList()']");
    const isOpen = panel.style.display !== "none";

    panel.style.display = isOpen ? "none" : "block";
    btn.textContent     = isOpen ? "📋 Siparişleri Göster" : "📋 Siparişleri Gizle";
}

// ── RENDER INVOICE CARDS ──────────────────────────────────────────────────────
function renderTable(orders) {
    const container = document.getElementById("invoiceCardsContainer");
    container.innerHTML = "";

    if (orders.length === 0) {
        container.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:40px; color:#94a3b8;">
                Sipariş bulunamadı
            </div>`;
        return;
    }

    orders.forEach(order => {
        const profitColor = order.net_profit >= 0 ? "#16a34a" : "#dc2626";
        const card = document.createElement("div");
        card.className = "invoice-card";
        card.onclick   = () => openDetailModal(order);
        card.innerHTML = `
            <div class="invoice-card-header">
                <span class="invoice-card-no">#${order.sales_order_no}</span>
                <span class="invoice-card-date">${formatDate(order.order_date)}</span>
            </div>
            <div class="invoice-card-customer">${order.customer_name || "-"}</div>
            <div class="invoice-card-footer">
                <span class="invoice-card-dmo">DMO: ${formatAmount(order.dmo_basket_total)} ₺</span>
                <span class="invoice-card-profit" style="color:${profitColor}">
                    ${formatAmount(order.net_profit)} ₺
                    <small style="font-weight:500; font-size:11px;">
                        %${order.profit_percentage?.toFixed(1)}
                    </small>
                </span>
            </div>
        `;
        container.appendChild(card);
    });
}


async function renderStatsCards(orders) {
    const totalOrders   = orders.length;
    const totalDMO      = orders.reduce((s, o) => s + (o.dmo_basket_total    || 0), 0);
    const totalInokas   = orders.reduce((s, o) => s + (o.inokas_basket_total || 0), 0);
    const totalProfit   = orders.reduce((s, o) => s + (o.net_profit          || 0), 0);
    const avgProfitPct  = totalDMO > 0 ? (totalProfit / totalDMO) * 100 : 0;

    // Deductions
    const totalKesinti  = totalDMO * 0.08;
    const totalKDV      = totalDMO * 0.20;
    const totalTevkifat = totalKDV * 0.20;
    const totalRisturn  = totalDMO * 0.01;

    // Main cards
    document.getElementById("stat-total-debt").textContent     = formatAmount(totalDMO) + " ₺";
    document.getElementById("stat-supplier-count").textContent = totalOrders + " Sipariş";
    document.getElementById("stat-paid").textContent           = formatAmount(totalInokas) + " ₺";
    document.getElementById("stat-overdue").textContent        = formatAmount(totalProfit) + " ₺";
    document.getElementById("stat-overdue-count").textContent  = "Ort. %" + avgProfitPct.toFixed(1);

    // Deduction cards
    document.getElementById("stat-dmo-kesinti").textContent = formatAmount(totalKesinti) + " ₺";
    document.getElementById("stat-tevkifat").textContent    = formatAmount(totalTevkifat) + " ₺";
    document.getElementById("stat-risturn").textContent     = formatAmount(totalRisturn) + " ₺";

    // Rates
    await fetchAndRenderRates();
}

async function fetchAndRenderRates() {
    try {
        // TCMB rates
        const res  = await fetch("/api/dmo/usd-eur-rate");
        const data = await res.json();

        if (data.USD) document.getElementById("stat-usd-rate").textContent    = parseFloat(data.USD).toFixed(2) + " ₺";
        if (data.EUR) document.getElementById("stat-eur-rate").textContent    = parseFloat(data.EUR).toFixed(2) + " ₺";

        // DMO EUR rate from rate_history
        const { data: rateHistory } = await db
            .from("rate_history")
            .select("dmo_eur_try")
            .not("dmo_eur_try", "is", null)
            .order("recorded_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (rateHistory?.dmo_eur_try) {
            document.getElementById("stat-eurdmo-rate").textContent = parseFloat(rateHistory.dmo_eur_try).toFixed(2) + " ₺";
        }

    } catch (err) {
        console.error("Kur çekilemedi:", err.message);
    }
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
// "2026-04-17" → "17.04.2026"
function formatDate(dateStr) {
    if (!dateStr) return "-";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
}


let _currentOrderId = null;

async function updateOrderStatus() {
    const status = document.getElementById("detail_status")?.value;
    if (!_currentOrderId || !status) return;

    const { error } = await db
        .from("dmo_orders")
        .update({ status })
        .eq("id", _currentOrderId);

    if (error) {
        showToast("Durum güncellenemedi: " + error.message, "error");
        return;
    }

    showToast(`Durum "${status}" olarak güncellendi`, "success");
    renderCurrentView();
}






// ── HIZLI HESAP DATA ──────────────────────────────────────────────────────────

const LIMIT    = 3000000;
let   hhItems  = {};
let   hhProducts  = [];
// Replace getCurrentRates()s with this function
function getCurrentRates() {
    return {
        usd_try:     parseFloat(document.getElementById("stat-usd-rate")?.textContent)     ,
        eur_try:     parseFloat(document.getElementById("stat-eur-rate")?.textContent)     ,
        dmo_eur_try: parseFloat(document.getElementById("stat-eurdmo-rate")?.textContent)  ,
    };
}
async function loadHHData() {
    const { data: products } = await db
        .from("products")
        .select("id, product_code, product_name, model,stock_on_hand, dmo_code, dmo_fiyat_try, sozlesme_fiyat_eur, maliyet_usd")
        .not("dmo_code", "is", null)
        .order("dmo_code");

    hhProducts = products || [];
}

async function openHizliHesap() {
    document.getElementById("hizliHesapModal").style.display = "flex";


    // Show rates from stat cards
    const rates = getCurrentRates();
    const usdEl = document.getElementById("hh_rate_usd");
    const eurEl = document.getElementById("hh_rate_eur");
    const dmoEl = document.getElementById("hh_rate_dmo");
    if (usdEl) usdEl.textContent = rates.usd_try.toFixed(2) + " ₺";
    if (eurEl) eurEl.textContent = rates.eur_try.toFixed(2) + " ₺";
    if (dmoEl) dmoEl.textContent = rates.dmo_eur_try.toFixed(2) + " ₺";

    document.getElementById("hh_product_grid").innerHTML = `
        <div style="text-align:center; padding:40px; color:#94a3b8;">
            Ürünler yükleniyor...
        </div>`;

    await loadHHData();
    renderHHProductTable();
    recalcHizliHesap();
}
function closeHizliHesap() {
    document.getElementById("hizliHesapModal").style.display = "none";
    hhItems = {};
    document.getElementById("hh_customer_name").value = "";
    document.getElementById("hh_usd_rate").value      = "";
    document.getElementById("hh_search").value        = "";
    document.getElementById("hh_product_grid").innerHTML = "";
    recalcHizliHesap();
}


// ── PRODUCT GRID ──────────────────────────────────────────────────────────────
function renderHHProductTable() {
    const container = document.getElementById("hh_product_grid");
    const search    = document.getElementById("hh_search")?.value.toLocaleLowerCase("tr-TR") || "";
    const usdRate   = getCurrentRates().usd_try;

    const filtered = hhProducts.filter(p =>
        p.product_name?.toLocaleLowerCase("tr-TR").includes(search) ||
        p.dmo_code?.toString().includes(search) ||
        p.model?.toLocaleLowerCase("tr-TR").includes(search)
    );

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:40px; color:#94a3b8;">
                Ürün bulunamadı
            </div>`;
        return;
    }

    // Build table
    container.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead>
                <tr style="background:#f1f5f9; color:#64748b; font-weight:700; font-size:11px;">
                    <th style="padding:10px 8px; text-align:left;">DMO KOD</th>
                    <th style="padding:10px 8px; text-align:left;">ÜRÜN</th>
                    <th style="padding:10px 8px; text-align:left;">ÜRÜN KOD</th>
                    <th style="padding:10px 8px; text-align:left;">MODEL</th>
                    <th style="padding:10px 8px; text-align:left;">STOK</th>
                    <th style="padding:10px 8px; text-align:right;">DMO FİYAT</th>
                    <th style="padding:10px 8px; text-align:right;">ALIŞ EUR→TL</th>
                    <th style="padding:10px 8px; text-align:right;">MAL USD→TL</th>
                    <th style="padding:10px 8px; text-align:right;">MARJ %</th>
                    <th style="padding:10px 8px; text-align:center;">ADET</th>
                    <th style="padding:10px 8px; text-align:center;">🎁 ADET</th>
                </tr>
            </thead>
            <tbody>
                ${filtered.map(p => renderHHRow(p, usdRate)).join("")}
            </tbody>
        </table>
    `;
}

function renderHHRow(p, usdRate) {
    const dmoFiyat   = parseFloat(p.dmo_fiyat_try       || 0);
    const alisEur    = parseFloat(p.sozlesme_fiyat_eur   || 0);
    const malUsd     = parseFloat(p.maliyet_usd          || 0);

    const realDMO    = dmoFiyat / 1.08;
    const alisTL     = alisEur * getCurrentRates().dmo_eur_try;
    const malTL      = malUsd  * usdRate;
    const marj       = realDMO > 0 ? ((realDMO - malTL) / realDMO * 100) : 0;
    const marjColor  = marj >= 0 ? "#16a34a" : "#dc2626";

    const item       = hhItems[p.dmo_code] || {};
    const qty        = item.quantity     || "";
    const giftQty    = item.giftQuantity || "";
    const isActive   = qty > 0 || giftQty > 0;

    return `
        <tr style="
            border-bottom:1px solid #e2e8f0;
            background:${isActive ? "#eff6ff" : "white"};
            transition: background 0.15s;
        ">
            <td style="padding:8px; font-weight:700; color:#2563eb;">${p.dmo_code || "-"}</td>
            <td style="padding:8px; color:#0f172a; max-width:200px;">
                <div style="font-weight:600; line-height:1.3;">${p.product_name || "-"}</div>
            </td>
            <td style="padding:8px; font-weight:700; color:#2563eb;">${p.product_code || "-"}</td>
            <td style="padding:8px; color:#64748b;">${p.model || "-"}</td>
            <td style="padding:8px; color:#64748b;">${p.stock_on_hand || "-"}</td>
            <td style="padding:8px; text-align:right; font-weight:600;">
                ${dmoFiyat > 0 ? formatAmount(dmoFiyat) + " ₺" : "-"}
            </td>
            <td style="padding:8px; text-align:right; color:#64748b;">
                ${alisEur > 0 ? `€${alisEur} → ${formatAmount(alisTL)} ₺` : "-"}
            </td>
            <td style="padding:8px; text-align:right; color:#64748b;">
                ${malUsd > 0 ? `$${malUsd} → ${formatAmount(malTL)} ₺` : "-"}
            </td>
            <td style="padding:8px; text-align:right; font-weight:700; color:${marjColor};">
                ${realDMO > 0 ? "%" + marj.toFixed(1) : "-"}
            </td>
            <td style="padding:8px; text-align:center;">
                <input 
                    type="number" 
                    min="0" 
                    placeholder="0"
                    value="${qty}"
                    oninput="updateHHItem('${p.dmo_code}', this.value, false)"
                    style="width:60px; padding:4px 6px; border:1px solid #e2e8f0; border-radius:6px; text-align:center; font-size:12px;"
                >
            </td>
            <td style="padding:8px; text-align:center;">
                <input 
                    type="number" 
                    min="0" 
                    placeholder="0"
                    value="${giftQty}"
                    oninput="updateHHItem('${p.dmo_code}', this.value, true)"
                    style="width:60px; padding:4px 6px; border:1px solid #fed7aa; border-radius:6px; text-align:center; font-size:12px; background:#fff7ed;"
                >
            </td>
        </tr>
    `;
}
function filterHHProducts() {
    renderHHProductTable();
}

function updateHHItem(dmoCode, value, isGift) {
    const quantity = parseInt(value) || 0;
    const product  = hhProducts.find(p => p.dmo_code == dmoCode);
    if (!product) return;

    if (!hhItems[dmoCode]) {
        hhItems[dmoCode] = {
            dmo_code:          dmoCode,        // ← add this
            product_id:        product.id,     // ← add this too
            product_name:      product.product_name,
            dmo_fiyat_try:     product.dmo_fiyat_try,
            sozlesme_fiyat_eur: product.sozlesme_fiyat_eur,
            maliyet_usd:       product.maliyet_usd,
            quantity:          0,
            giftQuantity:      0,
        };
    }

    if (isGift) {
        hhItems[dmoCode].giftQuantity = quantity;
    } else {
        hhItems[dmoCode].quantity = quantity;
    }

    // Remove if both quantities are 0
    if (hhItems[dmoCode].quantity === 0 && hhItems[dmoCode].giftQuantity === 0) {
        delete hhItems[dmoCode];
    }

    recalcHizliHesap();
}


function recalcHizliHesap() {
    const rates    = getCurrentRates();
    const usdRate  = rates.usd_try;

    let dmoBasket    = 0;
    let inokasBasket = 0;
    let giftTotal    = 0;

    Object.values(hhItems).forEach(item => {
        const dmoFiyat = parseFloat(item.dmo_fiyat_try  || 0);
        const malUsd   = parseFloat(item.maliyet_usd    || 0);
        const malTL    = malUsd * usdRate;

        dmoBasket    += dmoFiyat * (item.quantity     || 0);
        inokasBasket += malTL   * (item.quantity     || 0);
        giftTotal    += malTL   * (item.giftQuantity || 0);
    });

    const kdv         = dmoBasket * 0.20;
    const tevkifat    = kdv * 0.20;
    const gercekKdv   = kdv - tevkifat;
    const dmoKesinti  = dmoBasket * 0.08;
    const risturn     = dmoBasket * 0.01;
    const toplamGelir = dmoBasket + kdv;
    const toplamGider = inokasBasket + tevkifat + dmoKesinti + risturn + giftTotal;
    const netProfit   = toplamGelir - toplamGider;
    const profitPct   = dmoBasket > 0 ? (netProfit / dmoBasket) * 100 : 0;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = isNaN(val) ? "0.00" : val.toFixed(2);
    };

    setVal("hh_dmo_basket",    dmoBasket);
    setVal("hh_inokas_basket", inokasBasket);
    setVal("hh_dmo_deduction", dmoKesinti);
    setVal("hh_kdv",           kdv);
    setVal("hh_tevkifat",      tevkifat);
    setVal("hh_gercek_kdv",    gercekKdv);
    setVal("hh_gift_total",    giftTotal);
    setVal("hh_risturn",       risturn);
    setVal("hh_toplam_gelir",  toplamGelir);
    setVal("hh_toplam_gider",  toplamGider);

    // ✅ Fix
    const usdEl = document.getElementById("hh_rate_usd");
    const eurEl = document.getElementById("hh_rate_eur");
    const dmoEl = document.getElementById("hh_rate_dmo");
    if (usdEl) usdEl.textContent = rates.usd_try.toFixed(2) + " ₺";
    if (eurEl) eurEl.textContent = rates.eur_try.toFixed(2) + " ₺";
    if (dmoEl) dmoEl.textContent = rates.dmo_eur_try.toFixed(2) + " ₺";

    const profitEl  = document.getElementById("hh_net_profit");
    const percentEl = document.getElementById("hh_profit_pct");

    if (profitEl) {
        profitEl.textContent = formatAmount(netProfit.toFixed(2)) + " ₺";
        profitEl.style.color = netProfit >= 0 ? "#16a34a" : "#dc2626";
    }
    if (percentEl) {
        percentEl.textContent = profitPct.toFixed(2) + "%";
        percentEl.style.color = profitPct >= 0 ? "#16a34a" : "#dc2626";
    }

    updateLimitBar(dmoBasket);
}

function updateLimitBar(currentDMO = 0) {
    const pct         = Math.min((currentDMO / LIMIT) * 100, 100);
    const remaining   = Math.max(LIMIT - currentDMO, 0);

    const usedEl      = document.getElementById("hh_limit_used");
    const remainingEl = document.getElementById("hh_limit_remaining");
    const barEl       = document.getElementById("hh_limit_bar");
    const textEl      = document.getElementById("hh_limit_text");

    if (usedEl)      usedEl.textContent      = formatAmount(currentDMO) + " ₺";
    if (remainingEl) remainingEl.textContent = formatAmount(remaining) + " ₺";
    if (barEl) {
        barEl.style.width      = pct + "%";
        barEl.style.background = pct > 90 ? "#dc2626" : pct > 70 ? "#d97706" : "#2563eb";
    }
    if (textEl) {
        textEl.textContent = `%${pct.toFixed(1)} kullanıldı`;
        textEl.style.color = pct > 90 ? "#dc2626" : pct > 70 ? "#d97706" : "#2563eb";
    }
}
// ── SAVE AS TASLAK ────────────────────────────────────────────────────────────
async function saveHizliHesapAsTaslak() {
    if (Object.keys(hhItems).length === 0) {
        showToast("Lütfen en az bir ürün ekleyin", "error");
        return;
    }

    const usdRate = getCurrentRates().usd_try;
    const dmoBasket    = parseFloat(document.getElementById("hh_dmo_basket")?.value)     || 0;
    const inokasBasket = parseFloat(document.getElementById("hh_inokas_basket")?.value)  || 0;
    const kdv          = parseFloat(document.getElementById("hh_kdv")?.value)            || 0;
    const tevkifat     = parseFloat(document.getElementById("hh_tevkifat")?.value)       || 0;
    const gercekKdv    = parseFloat(document.getElementById("hh_gercek_kdv")?.value)     || 0;
    const dmoKesinti   = parseFloat(document.getElementById("hh_dmo_deduction")?.value)  || 0;
    const risturn      = parseFloat(document.getElementById("hh_risturn")?.value)        || 0;
    const toplamGelir  = parseFloat(document.getElementById("hh_toplam_gelir")?.value)   || 0;
    const toplamGider  = parseFloat(document.getElementById("hh_toplam_gider")?.value)   || 0;
    const netProfit    = toplamGelir - toplamGider;
    const profitPct    = dmoBasket > 0 ? (netProfit / dmoBasket) * 100 : 0;

    try {
        showToast("Taslak kaydediliyor...", "info");

        const { data: order, error: orderError } = await db
            .from("dmo_orders")
            .insert({
                customer_name:       document.getElementById("hh_customer_name")?.value || null,
                order_date:          new Date().toISOString().slice(0, 10),
                usd_rate:            usdRate,
                dmo_basket_total:    dmoBasket,
                inokas_basket_total: inokasBasket,
                kdv_amount:          kdv,
                tevkifat:            tevkifat,
                gercek_kdv:          gercekKdv,
                dmo_deduction:       dmoKesinti,
                risturn_amount:      risturn,
                toplam_gelir:        toplamGelir,
                toplam_gider:        toplamGider,
                net_profit:          netProfit,
                profit_percentage:   profitPct,
                status:              "Taslak",
            })
            .select()
            .single();

        if (orderError) {
            showToast("Taslak kaydedilemedi: " + orderError.message, "error");
            return;
        }

        for (const item of Object.values(hhItems)) {
            if (item.quantity > 0) {
                await db.from("dmo_order_items").insert({
                    order_id:            order.id,
                    product_id:          item.product_id || null,
                    quantity:            item.quantity,
                    unit_price_excl_vat: parseFloat(item.dmo_fiyat_try || 0),
                    line_total_excl_vat: parseFloat(item.dmo_fiyat_try || 0) * item.quantity,
                    is_gift:             false,
                    katalog_kod:         item.dmo_code?.toString(),
                    maliyet_usd:         parseFloat(item.maliyet_usd || 0),
                    maliyet_tl:          parseFloat(item.maliyet_usd || 0) * usdRate,
                });
            }

            if (item.giftQuantity > 0) {
                await db.from("dmo_order_items").insert({
                    order_id:            order.id,
                    product_id:          item.product_id || null,
                    quantity:            item.giftQuantity,
                    unit_price_excl_vat: parseFloat(item.dmo_fiyat_try || 0),
                    line_total_excl_vat: parseFloat(item.dmo_fiyat_try || 0) * item.giftQuantity,
                    is_gift:             true,
                    katalog_kod:         item.dmo_code?.toString(),
                    maliyet_usd:         parseFloat(item.maliyet_usd || 0),
                    maliyet_tl:          parseFloat(item.maliyet_usd || 0) * usdRate,
                });
            }
        }


        showToast("Taslak başarıyla kaydedildi!", "success");
        closeHizliHesap();
        renderCurrentView();

    } catch (err) {
        showToast("Beklenmeyen hata: " + err.message, "error");
    }
}


async function scrapeDMOPrices() {
    showToast("DMO fiyatları güncelleniyor... Bu işlem ~1 dakika sürebilir", "info");

    try {
        const res = await fetch("/api/dmo/scrape-dmo-prices", {
            method: "POST"
        });
        const data = await res.json();

        showToast(
            `✅ ${data.total_updated} ürün güncellendi, ❌ ${data.total_failed} başarısız`,
            data.total_failed > 0 ? "warn" : "success"
        );

        if (data.dmo_eur_try) {
            showToast(`💱 DMO EUR/TRY: ${data.dmo_eur_try}`, "info");
        }

    } catch (err) {
        showToast("Güncelleme başarısız: " + err.message, "error");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Default: last 3 months
    const end   = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3);

    document.getElementById("filterDateStart").value = start.toISOString().slice(0, 10);
    document.getElementById("filterDateEnd").value   = end.toISOString().slice(0, 10);

    renderCurrentView();
});
