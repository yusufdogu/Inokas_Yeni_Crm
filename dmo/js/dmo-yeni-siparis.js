// ── PDF STATE ─────────────────────────────────────────────────────────────────
let pdfs           = [];
let activePdfIndex = null;

// ── LOAD URUNLER ──────────────────────────────────────────────────────────────
async function loadUrunler() {
    if (urunlerLoaded) return;
    const { data, error } = await db
        .from("products")
        .select("dmo_code, product_name, maliyet_usd");

    if (error) {
        showToast("Ürünler yüklenemedi: " + error.message, "error");
        return;
    }

    data.forEach(p => {
        if (p.dmo_code) {
            URUNLER[parseInt(p.dmo_code)] = {
                urun:        p.product_name,
                maliyet_usd: p.maliyet_usd || 0,
            };
        }
    });

    urunlerLoaded = true;
}

// ── PDF UPLOAD & PARSE ────────────────────────────────────────────────────────
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
            } catch { /* keep default */ }
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
            pdfs.push({ file, blobUrl: URL.createObjectURL(file), parsedData: data, name: file.name });
            addedCount++;
        } catch (err) {
            failedCount++;
            showToast(`${file.name} ayrıştırılamadı: ${err.message}`, "error");
        }
    }

    if (addedCount > 0) {
        if (activePdfIndex === null) activePdfIndex = 0;
        showToast(`${addedCount} PDF eklendi!`, "success");
        if (failedCount > 0) showToast(`${failedCount} PDF atlandı`, "warn");
        renderPdfTabs();
        switchTab(activePdfIndex);
    } else if (failedCount > 0) {
        showToast("Uygun PDF bulunamadı", "error");
    }
}

// ── SNAPSHOT FORM ─────────────────────────────────────────────────────────────
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
    if (activePdfIndex !== null && activePdfIndex !== index) snapshotForm();
    activePdfIndex = index;
    const pdf = pdfs[index];
    if (!pdf) return;

    const pdfViewer      = document.getElementById("pdfViewer");
    const pdfPlaceholder = document.getElementById("pdfPlaceholder");
    pdfViewer.src                = pdf.blobUrl;
    pdfViewer.style.display      = "block";
    pdfPlaceholder.style.display = "none";

    fillForm(pdf.parsedData);
    renderPdfTabs();
}

// ── REMOVE PDF ────────────────────────────────────────────────────────────────
function removePdf(index) {
    URL.revokeObjectURL(pdfs[index].blobUrl);
    pdfs.splice(index, 1);

    if (pdfs.length === 0) {
        activePdfIndex = null;
        document.getElementById("pdfViewer").style.display      = "none";
        document.getElementById("pdfViewer").src                = "";
        document.getElementById("pdfPlaceholder").style.display = "flex";
        renderPdfTabs();
        resetFormFields();
        return;
    }

    if (activePdfIndex >= pdfs.length) activePdfIndex = pdfs.length - 1;
    renderPdfTabs();
    switchTab(activePdfIndex);
}

// ── RENDER PDF TABS ───────────────────────────────────────────────────────────
function renderPdfTabs() {
    const container = document.getElementById("pdfTabsContainer");
    if (!container) return;

    if (pdfs.length === 0) { container.innerHTML = ""; return; }

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

// ── FILL FORM ─────────────────────────────────────────────────────────────────
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
    const katalogKod    = String(pickItemValue(item, ["KATALOG KOD NO", "SIRA NO KATALOG KOD NO"], "")).trim();
    const malzemeAdi    = String(pickItemValue(item, ["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"])).trim();
    const malzemeKodu   = String(pickItemValue(item, ["MALZEME_KODU"], "")).trim();
    const miktar        = parseFloat(String(pickItemValue(item, ["MIKTAR"], "0")).replace(",", ".")) || 0;

    const rawDmo        = pickItemValue(item, ["KAT.SÖZ.FIY.(TL)", "KAT.SÃ–Z.FIY.(TL)"], "0");
    const rawIndirim    = pickItemValue(item, ["ALIMA ESAS INDIRMLI BIRIM FIYAT"], "0");
    const rawToplam     = pickItemValue(item, ["TUTARI (TL)"], "0");
    const rawTutar      = pickItemValue(item, ["INDIRIM ORANLARI TUTAR"], "0");
    const rawIlaveTutar = pickItemValue(item, ["ILAVE TUTAR"], "0");
    const rawToplamInd  = pickItemValue(item, ["TOPLAM"], "0");

    const dmoFiyat      = String(rawDmo).includes(",")     ? parseAmount(rawDmo)     : parseFloat(rawDmo)     || 0;
    const indirimFiyat  = String(rawIndirim).includes(",") ? parseAmount(rawIndirim) : parseFloat(rawIndirim) || 0;
    const mevcutToplam  = String(rawToplam).includes(",")  ? parseAmount(rawToplam)  : parseFloat(rawToplam)  || 0;
    const toplam        = indirimFiyat > 0 && miktar > 0   ? indirimFiyat * miktar   : mevcutToplam;
    const tutar         = String(rawTutar).includes(",")      ? parseAmount(rawTutar)      : parseFloat(rawTutar)      || 0;
    const ilaveTutar    = String(rawIlaveTutar).includes(",") ? parseAmount(rawIlaveTutar) : parseFloat(rawIlaveTutar) || 0;
    const toplamIndirim = String(rawToplamInd).includes(",")  ? parseAmount(rawToplamInd)  : parseFloat(rawToplamInd)  || 0;

    return {
        "KATALOG KOD NO":                          katalogKod,
        "MALZEMENIN CINSI(VARSA MARKA VE MODELI)": malzemeAdi,
        "MALZEME_KODU":                            malzemeKodu,
        "TESLIM SURESI (GUN)":                     String(pickItemValue(item, ["TESLIM SURESI (GÜN)", "TESLIM SURESI (GUN)"], "0")),
        "KAT.SÖZ.FIY.(TL)":                        dmoFiyat,
        "ALIMA ESAS INDIRMLI BIRIM FIYAT":         indirimFiyat,
        // TOPLAM column = total discount % applied (e.g. "3,00" means 3%)
        "TOPLAM INDIRIM":                          toplamIndirim,
        "MIKTAR":                                  String(miktar),
        "TUTARI (TL)":                             String(toplam),
        // Raw discount amount (INDIRIM ORANLARI TUTAR) and ilave tutar kept for reference
        "TUTAR":                                   tutar,
        "ILAVE TUTAR":                             ilaveTutar,
    };
}

function fillForm(data) {
    setField("sales_order_no",    data.satis_siparis_no);
    setField("purchase_order_no", data.satinalma_siparis_no);
    setField("customer_name",     data.musteri_adi);
    setField("customer_no",       data.musteri_no);
    setField("order_date",        parseOrderDate(data.tarih));
    setField("stamp_tax",         parseAmount(data.karar_siparis_damga_vergisi));


    window._lastParsedItems = (data.malzeme_tablosu || []).map(normalizeLineItem);
    renderLineItems(window._lastParsedItems);

    const orderDateVal = document.getElementById("order_date")?.value;
    if (orderDateVal && window._lastParsedItems.length > 0) {
        const maxDays = Math.max(
            ...window._lastParsedItems.map(item => parseInt(item["TESLIM SURESI (GUN)"] || "0") || 0)
        );
        if (maxDays > 0) {
            const orderDate = new Date(orderDateVal);
            orderDate.setDate(orderDate.getDate() + maxDays);
            setField("last_order_date", orderDate.toISOString().slice(0, 10));
        }
    }

    // Auto-switch to stats tab after PDF is parsed
    switchYSTab('stats');
}

function setField(id, value) {
    const el = document.getElementById(id);
    if (el && value !== null && value !== undefined) el.value = value;
}

function parseOrderDate(dateStr) {
    if (!dateStr) return new Date().toISOString().slice(0, 10);
    const parts = dateStr.split(".");
    if (parts.length !== 3) return new Date().toISOString().slice(0, 10);
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

// ── LINE ITEMS ────────────────────────────────────────────────────────────────
function renderLineItems(items) {
    const tbody = document.getElementById("lineItemsBody");
    if (!tbody) return;
    window._lastParsedItems = Array.isArray(items) ? items : [];
    tbody.innerHTML = "";

    const regularItems = window._lastParsedItems.filter(i => !i.is_gift);
    const giftItems    = window._lastParsedItems.filter(i =>  i.is_gift);

    if (regularItems.length === 0 && giftItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center; color:#94a3b8; padding:14px;">
                    Kalem yok. "＋ Kalem Ekle" ile manuel ekleyebilirsiniz.
                </td>
            </tr>`;
        calculateDMOBasket([]);
        return;
    }

    regularItems.forEach((rawItem, index) => {
        const item = normalizeLineItem(rawItem);
        window._lastParsedItems[index] = item;
        tbody.appendChild(buildLineItemRow(item, index));
    });

    if (giftItems.length > 0) {
        const giftHeader = document.createElement("tr");
        giftHeader.innerHTML = `
            <td colspan="9" style="background:#fff7ed; padding:8px 12px; font-size:11px; font-weight:800; color:#d97706; letter-spacing:0.5px;">
                🎁 HEDİYELER
            </td>`;
        tbody.appendChild(giftHeader);

        giftItems.forEach((rawItem) => {
            const item          = normalizeLineItem(rawItem);
            const usdRate       = parseFloat(document.getElementById("usd_rate")?.value) || 45;
            const katalogKodInt = parseInt(item["KATALOG KOD NO"] || "0");
            const miktar        = parseFloat(item["MIKTAR"] || "0");
            const urun          = URUNLER[katalogKodInt];
            const maliyetTL     = urun ? urun.maliyet_usd * miktar * usdRate : 0;

            const tr = document.createElement("tr");
            tr.style.background = "#fff7ed";
            tr.innerHTML = `
                <td style="padding:8px 4px;">${item["KATALOG KOD NO"] || "-"}</td>
                <td style="padding:8px 4px;">${item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || "-"}</td>
                <td style="padding:8px 4px;">${item["MALZEME_KODU"] || "-"}</td>
                <td colspan="3" style="padding:8px 4px; text-align:center; color:#d97706; font-weight:600;">
                    🎁 ${miktar} adet hediye
                </td>
                <td style="padding:8px 4px; text-align:right; color:#d97706; font-weight:700;">
                    ${maliyetTL > 0 ? formatAmount(maliyetTL) + " ₺" : "-"}
                </td>
                <td colspan="2"></td>
            `;
            tbody.appendChild(tr);
        });
    }

    calculateDMOBasket(window._lastParsedItems.filter(i => !i.is_gift));
}

function buildLineItemRow(item, index) {
    const katalogKod   = item["KATALOG KOD NO"] || "";
    const malzemeAdi   = item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || "";
    const malzemeKodu  = item["MALZEME_KODU"] || "";
    const dmoFiyat     = parseFloat(item["KAT.SÖZ.FIY.(TL)"])               || 0;
    const indirimPct   = parseFloat(item["TOPLAM"])                  || 0;
    const indirimFiyat = parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"]) || 0;
    const miktar       = parseFloat(item["MIKTAR"] || "0")                   || 0;
    const toplam       = parseFloat(item["TUTARI (TL)"])                     || 0;
    const maliyetTL    = getLineItemMaliyetTL(item);

    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td><input type="text"   value="${escapeHtml(katalogKod)}"   oninput="updateLineItemField(${index}, 'katalog',       this.value)"></td>
        <td><input type="text"   value="${escapeHtml(malzemeAdi)}"   oninput="updateLineItemField(${index}, 'adi',           this.value)"></td>
        <td><input type="text"   value="${escapeHtml(malzemeKodu)}"  oninput="updateLineItemField(${index}, 'kodu',          this.value)"></td>
        <td><input type="number" step="0.01" min="0" value="${dmoFiyat}"     oninput="updateLineItemField(${index}, 'dmoFiyat',     this.value)"></td>
        <td><input type="number" step="0.01" min="0" value="${indirimPct}"   oninput="updateLineItemField(${index}, 'indirimPct',   this.value)"></td>
        <td><input type="number" step="0.01" min="0" value="${indirimFiyat}" oninput="updateLineItemField(${index}, 'indirimFiyat', this.value)"></td>
        <td><input type="number" step="1"    min="0" value="${miktar}"       oninput="updateLineItemField(${index}, 'miktar',       this.value)"></td>
        <td class="text-right">${maliyetTL !== null ? formatAmount(maliyetTL) : "-"}</td>
        <td class="text-right">${formatAmount(toplam)}</td>
        <td class="text-right">
            <button type="button" class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="removeLineItem(${index})">Sil</button>
        </td>
    `;
    return tr;
}

function getLineItemMaliyetTL(item) {
    const katalogKodInt = parseInt(pickItemValue(item, ["KATALOG KOD NO", "SIRA NO KATALOG KOD NO"], "0") || "0", 10);
    const miktar        = parseFloat(item["MIKTAR"] || "0") || 0;
    const usdRate       = parseFloat(document.getElementById("usd_rate")?.value) || 45;
    const urun          = URUNLER[katalogKodInt];
    if (!urun || usdRate <= 0 || miktar <= 0) return null;
    return urun.maliyet_usd * miktar * usdRate;
}

function updateLineItemField(index, field, value) {
    if (!Array.isArray(window._lastParsedItems) || !window._lastParsedItems[index]) return;
    const item = window._lastParsedItems[index];

    if (field === "katalog") {
        item["KATALOG KOD NO"] = String(value || "").trim();
        const urun = URUNLER[parseInt(item["KATALOG KOD NO"] || "0")];
        if (urun && !item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"]) {
            item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] = urun.urun;
        }
    }
    if (field === "adi")          item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] = String(value || "").trim();
    if (field === "kodu")         item["MALZEME_KODU"] = String(value || "").trim();
    if (field === "dmoFiyat")     item["KAT.SÖZ.FIY.(TL)"] = String(value || "0");
    if (field === "indirimPct")   item["TOPLAM"] = String(value || "0");
    if (field === "indirimFiyat") item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] = String(value || "0");
    if (field === "miktar")       item["MIKTAR"] = String(value || "0");

    const miktar       = parseFloat(item["MIKTAR"] || "0") || 0;
    const indirimFiyat = parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] || "0") || 0;
    item["TUTARI (TL)"] = String(indirimFiyat * miktar);

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
        <td><input type="number" placeholder="0" oninput="recalcLineItems()"></td>
        <td><input type="number" placeholder="0" readonly></td>
        <td><input type="number" placeholder="0" oninput="recalcLineItems()"></td>
        <td>
            <button type="button" onclick="this.closest('tr').remove(); recalcLineItems();"
                style="background:#fee2e2; color:#ef4444; border:none; border-radius:6px; padding:4px 8px; cursor:pointer;">✕</button>
        </td>
    `;
    tbody.appendChild(tr);
}

// ── CALCULATIONS ──────────────────────────────────────────────────────────────
function calculateDMOBasket(items) {
    const total = items.reduce((sum, item) => sum + (parseFloat(item["TUTARI (TL)"]) || 0), 0);
    if (total > 0) {
        setField("dmo_basket", total.toFixed(2));
        calculateInokasBasket();
    }
}

function calculateInokasBasket() {
    const usdRate = parseFloat(document.getElementById("stat-usd-rate")?.value) || 45;
    if (!window._lastParsedItems) return;

    let inokasTotal = 0;
    window._lastParsedItems.forEach(item => {
        const katalogKod = parseInt(item["SIRA NO KATALOG KOD NO"] || item["KATALOG KOD NO"] || "0");
        const miktar     = parseInt(item["MIKTAR"] || "0");
        const urun       = URUNLER[katalogKod];
        if (urun && usdRate > 0) inokasTotal += urun.maliyet_usd * miktar * usdRate;
    });

    setField("inokas_basket", inokasTotal.toFixed(2));
    calculateProfit();
}

function computeInvoiceMetrics(dmoBasket, inokasBasket, stampTax) {
    const kdv         = dmoBasket * 0.20;
    const tevkifat    = kdv * 0.20;
    const gercekKdv   = kdv - tevkifat;
    const risturn     = dmoBasket * 0.01;
    const toplamGelir = dmoBasket + kdv;
    const toplamGider = inokasBasket + stampTax + tevkifat + risturn;
    const netProfit   = toplamGelir - toplamGider;
    const profitPct   = dmoBasket > 0 ? (netProfit / dmoBasket) * 100 : 0;
    return { kdv, tevkifat, gercekKdv, risturn, toplamGelir, toplamGider, netProfit, profitPct };
}

function calculateProfit() {
    const dmoBasket    = parseFloat(document.getElementById("dmo_basket")?.value)    || 0;
    const inokasBasket = parseFloat(document.getElementById("inokas_basket")?.value) || 0;
    const stampTax     = parseFloat(document.getElementById("stamp_tax")?.value)     || 0;

    const kdv         = dmoBasket * 0.20;
    const tevkifat    = kdv * 0.20;
    const gercekKdv   = kdv - tevkifat;
    const risturn     = dmoBasket * 0.01;
    const toplamGelir = dmoBasket + kdv;
    const toplamGider = inokasBasket + stampTax + tevkifat + risturn;
    const netProfit   = toplamGelir - toplamGider;
    const profitPct   = dmoBasket > 0 ? (netProfit / dmoBasket) * 100 : 0;

    // İndirim Kaybı: how much discount was applied in total across all lines.
    // Uses the TOPLAM column (total discount %) from the PDF when available,
    // otherwise falls back to (catalogPrice - discountedPrice) * qty.
    const indirimKaybi = (window._lastParsedItems || []).reduce((sum, item) => {
        const dmoFiyat     = parseFloat(item["KAT.SÖZ.FIY.(TL)"])               || 0;
        const indirimFiyat = parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"]) || 0;
        const miktar       = parseFloat(item["MIKTAR"])                           || 0;
        const toplamPct    = parseFloat(item["TOPLAM INDIRIM"])                   || 0;
        if (toplamPct > 0 && dmoFiyat > 0) {
            return sum + (dmoFiyat * (toplamPct / 100) * miktar);
        }
        return sum + ((dmoFiyat - indirimFiyat) * miktar);
    }, 0);

    setField("kdv_tax",           kdv.toFixed(2));
    setField("inv_tevkifat",      tevkifat.toFixed(2));
    setField("inv_gercek_kdv",    gercekKdv.toFixed(2));
    setField("inv_risturn",       risturn.toFixed(2));
    setField("inv_toplam_gelir",  toplamGelir.toFixed(2));
    setField("inv_toplam_gider",  toplamGider.toFixed(2));
    setField("inv_indirim_kaybi", indirimKaybi > 0 ? indirimKaybi.toFixed(2) : 0);

    const profitEl  = document.getElementById("net_profit_display");
    const percentEl = document.getElementById("profit_percent_display");
    if (profitEl) {
        profitEl.textContent = formatAmount(netProfit.toFixed(2)) + " ₺";
        profitEl.style.color = netProfit >= 0 ? "#16a34a" : "#dc2626";
    }
    if (percentEl) {
        percentEl.textContent = profitPct.toFixed(2) + "%";
        percentEl.style.color = profitPct >= 0 ? "#16a34a" : "#dc2626";
    }
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
    el.style.display    = "flex";
    el.style.background = s.bg;
    el.style.color      = s.color;
    el.style.border     = `1px solid ${s.border}`;
    el.innerHTML        = `<span>${s.icon}</span><span>${message}</span>`;
}

function clearModalAlert() {
    const el = document.getElementById("modalAlert");
    if (el) el.style.display = "none";
}

// ── RESET FORM ────────────────────────────────────────────────────────────────
function resetForm() {
    pdfs.forEach(p => URL.revokeObjectURL(p.blobUrl));
    pdfs           = [];
    activePdfIndex = null;

    document.getElementById("dmoSiparisForm")?.reset();
    const lineItems = document.getElementById("lineItemsBody");
    if (lineItems) lineItems.innerHTML = "";
    const profitEl  = document.getElementById("net_profit_display");
    const percentEl = document.getElementById("profit_percent_display");
    if (profitEl)  profitEl.textContent  = "";
    if (percentEl) percentEl.textContent = "";

    const pdfViewer      = document.getElementById("pdfViewer");
    const pdfPlaceholder = document.getElementById("pdfPlaceholder");
    if (pdfViewer)      { pdfViewer.style.display = "none"; pdfViewer.src = ""; }
    if (pdfPlaceholder)   pdfPlaceholder.style.display = "flex";

    renderPdfTabs();
    clearModalAlert();
    window._lastParsedItems = null;
    _editingOrderId         = null;
    _isTaslakMerge          = false;
}

function resetFormFields() {
    document.getElementById("dmoSiparisForm")?.reset();
    const lineItems = document.getElementById("lineItemsBody");
    if (lineItems) lineItems.innerHTML = "";
    const profitEl  = document.getElementById("net_profit_display");
    const percentEl = document.getElementById("profit_percent_display");
    if (profitEl)  profitEl.textContent  = "";
    if (percentEl) percentEl.textContent = "";
    window._lastParsedItems = null;
}

// ── UPLOAD PDF TO STORAGE ─────────────────────────────────────────────────────
async function uploadPDFToStorage(file, salesOrderNo) {
    const fileName = `${salesOrderNo}_${Date.now()}.pdf`;
    const { data, error } = await db.storage
        .from("dmo-pdfs")
        .upload(fileName, file, { contentType: "application/pdf", upsert: true });

    if (error) { console.error("PDF upload error:", error.message); return null; }

    const { data: urlData } = db.storage.from("dmo-pdfs").getPublicUrl(fileName);
    return urlData?.publicUrl || null;
}

// ── SAVE ORDER ────────────────────────────────────────────────────────────────
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
    const usdRate         = parseFloat(document.getElementById("usd_rate")?.value);

    try {
        showModalAlert("Kaydediliyor...", "info");
        let pdfUrl = null;
        const activePdf = pdfs[activePdfIndex];
        if (activePdf?.file) {
            showModalAlert("PDF yükleniyor...", "info");
            pdfUrl = await uploadPDFToStorage(activePdf.file, salesOrderNo);
        }

        // ── TASLAK MERGE ──────────────────────────────────────────────────────
        if (_editingOrderId && _isTaslakMerge) {
            showModalAlert("Taslak güncelleniyor...", "info");

            const { data: giftItems } = await db
                .from("dmo_order_items").select("*")
                .eq("order_id", _editingOrderId).eq("is_gift", true);

            await db.from("dmo_order_items").delete()
                .eq("order_id", _editingOrderId).eq("is_gift", false);

            const { error: updateError } = await db.from("dmo_orders").update({
                sales_order_no:      salesOrderNo,
                purchase_order_no:   purchaseOrderNo,
                customer_name:       document.getElementById("customer_name")?.value,
                customer_no:         document.getElementById("customer_no")?.value,
                order_date:          parseOrderDate(document.getElementById("order_date")?.value),
                stamp_tax:           stampTax,
                pdf_url:             pdfUrl,
                dmo_basket_total:    dmoBasket,
                inokas_basket_total: inokasBasket,
                stamp_tax_total:     stampTax,
                net_profit:          m.netProfit,
                profit_percentage:   m.profitPct,
                usd_rate:            usdRate,
                status:              "Sipariş Alındı",
            }).eq("id", _editingOrderId);

            if (updateError) { showModalAlert("Güncelleme başarısız: " + updateError.message, "error"); return; }

            const items = window._lastParsedItems || [];
            let failedItems = 0;
            for (const item of items) {
                const katalogKod  = parseInt(item["KATALOG KOD NO"] || "0");
                const malzemeKodu = item["MALZEME_KODU"] || null;
                const miktar      = parseInt(item["MIKTAR"] || "0");
                const unitPrice   = parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] || "0");
                const lineTotal   = parseFloat(item["TUTARI (TL)"]) || 0;
                let productId     = null;

                if (malzemeKodu) {
                    const { data: ep } = await db.from("products").select("id").eq("product_code", malzemeKodu).maybeSingle();
                    if (ep) {
                        productId = ep.id;
                    } else {
                        const urun = URUNLER[katalogKod];
                        const { data: np, error: pe } = await db.from("products").insert({
                            product_code: malzemeKodu,
                            product_name: item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || malzemeKodu,
                            dmo_code:     katalogKod.toString(),
                            last_purchase_price_cur: urun ? urun.maliyet_usd : 0,
                            last_purchase_currency:  "USD",
                            last_purchase_rate:      usdRate,
                            last_purchase_price_tl:  urun ? urun.maliyet_usd * usdRate : 0,
                        }).select().single();
                        if (!pe) productId = np.id;
                    }
                }

                const { error: ie } = await db.from("dmo_order_items").insert({
                    order_id: _editingOrderId, product_id: productId,
                    quantity: miktar, unit_price_excl_vat: unitPrice,
                    line_total_excl_vat: lineTotal, is_gift: false,
                    katalog_kod: katalogKod.toString(),
                    maliyet_usd: URUNLER[katalogKod]?.maliyet_usd || 0,
                    maliyet_tl:  (URUNLER[katalogKod]?.maliyet_usd || 0) * usdRate,
                });
                if (ie) failedItems++;
            }

            if (failedItems > 0) {
                showModalAlert(`Güncellendi fakat ${failedItems} kalem hatalı!`, "warn");
            } else {
                showModalAlert("Taslak → Sipariş Alındı! ✓", "success");
                setTimeout(() => {
                    if (window._onOrderSaved) window._onOrderSaved();
                }, 1000);
            }
            return;
        }

        // ── DUPLICATE CHECK ───────────────────────────────────────────────────
        const { data: existing } = await db.from("dmo_orders").select("id")
            .eq("sales_order_no", salesOrderNo).maybeSingle();
        if (existing) { showModalAlert("Bu sipariş zaten kayıtlı: " + salesOrderNo, "error"); return; }

        // ── INSERT ORDER ──────────────────────────────────────────────────────
        const { data: order, error: orderError } = await db.from("dmo_orders").insert({
            sales_order_no:        salesOrderNo,
            purchase_order_no:     purchaseOrderNo,
            customer_name:         document.getElementById("customer_name")?.value,
            customer_no:           document.getElementById("customer_no")?.value,
            order_date:            parseOrderDate(document.getElementById("order_date")?.value),
            due_date:              document.getElementById("last_order_date")?.value || null,
            stamp_tax:             stampTax,
            dmo_basket_total:      dmoBasket,
            inokas_basket_total:   inokasBasket,
            stamp_tax_total:       stampTax,
            pdf_url:               pdfUrl,
            net_profit:            m.netProfit,
            profit_percentage:     m.profitPct,
            total_amount_excl_vat: dmoBasket,
            status:                "Sipariş Alındı",
        }).select().single();

        if (orderError) { showModalAlert("Sipariş kaydedilemedi: " + orderError.message, "error"); return; }

        // ── INSERT LINE ITEMS ─────────────────────────────────────────────────
        const items = window._lastParsedItems || [];
        let failedItems = 0;

        for (const item of items) {
            const katalogKod  = parseInt(item["KATALOG KOD NO"] || "0");
            const malzemeKodu = item["MALZEME_KODU"] || null;
            const miktar      = parseInt(item["MIKTAR"] || "0");
            const unitPrice   = parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] || "0") || 0;
            const lineTotal   = parseFloat(item["TUTARI (TL)"]) || 0;
            let productId     = null;

            if (malzemeKodu) {
                const { data: ep } = await db.from("products").select("id").eq("product_code", malzemeKodu).maybeSingle();
                if (ep) {
                    productId = ep.id;
                } else {
                    const urun = URUNLER[katalogKod];
                    const { data: np, error: pe } = await db.from("products").insert({
                        product_code: malzemeKodu,
                        product_name: item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || malzemeKodu,
                        dmo_code:     katalogKod.toString(),
                        last_purchase_price_cur: urun ? urun.maliyet_usd : 0,
                        last_purchase_currency:  "USD",
                    }).select().single();
                    if (pe) { failedItems++; continue; }
                    productId = np.id;
                }
            }

            const { error: ie } = await db.from("dmo_order_items").insert({
                order_id: order.id, product_id: productId,
                quantity: miktar, unit_price_excl_vat: unitPrice,
                line_total_excl_vat: lineTotal,
            });
            if (ie) failedItems++;
        }

        if (failedItems > 0) {
            showModalAlert(`Sipariş kaydedildi fakat ${failedItems} kalem hatalı!`, "warn");
        } else {
            showModalAlert("Sipariş başarıyla kaydedildi! ✓", "success");
            setTimeout(() => {
                if (window._onOrderSaved) window._onOrderSaved();
            }, 1000);
        }

    } catch (err) {
        console.error("saveOrder error:", err);
        showModalAlert("Beklenmeyen hata: " + err.message, "error");
    }
}


function switchYSTab(tab) {
    const bilgiBtn  = document.getElementById("ys-tab-bilgi");
    const statsBtn  = document.getElementById("ys-tab-stats");
    const bilgiPane = document.getElementById("ys-pane-bilgi");
    const statsPane = document.getElementById("ys-pane-stats");

    if (tab === "bilgi") {
        if (bilgiBtn) { bilgiBtn.style.borderBottomColor = "#2563eb"; bilgiBtn.style.color = "#2563eb"; bilgiBtn.style.fontWeight = "700"; }
        if (statsBtn) { statsBtn.style.borderBottomColor = "transparent"; statsBtn.style.color = "#64748b"; statsBtn.style.fontWeight = "500"; }
        if (bilgiPane) bilgiPane.style.display = "flex";
        if (statsPane) statsPane.style.display = "none";
    } else {
        if (statsBtn) { statsBtn.style.borderBottomColor = "#2563eb"; statsBtn.style.color = "#2563eb"; statsBtn.style.fontWeight = "700"; }
        if (bilgiBtn) { bilgiBtn.style.borderBottomColor = "transparent"; bilgiBtn.style.color = "#64748b"; bilgiBtn.style.fontWeight = "500"; }
        if (bilgiPane) bilgiPane.style.display = "none";
        if (statsPane) statsPane.style.display = "flex";
    }
}

// ── PAGE INIT ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    if (!document.getElementById("dmoSiparisForm")) return;
    await loadUrunler();

    // Wire stamp_tax input to recalculate
    document.getElementById("stamp_tax")?.addEventListener("input", calculateProfit);
});