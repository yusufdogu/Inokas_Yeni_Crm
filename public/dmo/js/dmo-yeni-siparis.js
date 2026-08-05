// ── PDF STATE ─────────────────────────────────────────────────────────────────
let pdfs           = [];
let activePdfIndex = null;




async function handleDrop(event) {
    const items = event.dataTransfer.items;
    if (!items || items.length === 0) return;

    const collectedFiles = [];
    let hadErrors        = false;

    const readDirEntries = (dirReader) => new Promise((resolve) => {
        dirReader.readEntries((entries) => resolve(entries), () => resolve([]));
    });

    const entryToFile = (entry) => new Promise((resolve) => {
        entry.file(resolve, () => resolve(null));
    });

    for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();

        if (!entry) {
            showToast("Zip veya desteklenmeyen format atlandı", "error");
            hadErrors = true;
            continue;
        }

        if (entry.isFile) {
            const file = await entryToFile(entry);
            if (!file) continue;
            if (file.name.toLowerCase().endsWith(".pdf")) {
                collectedFiles.push(file);
            } else {
                showToast(`PDF olmayan dosya atlandı: ${file.name}`, "warn");
                hadErrors = true;
            }

        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            const entries   = await readDirEntries(dirReader);

            for (const subEntry of entries) {
                if (subEntry.isDirectory) {
                    showToast(`Alt klasörler desteklenmiyor: ${subEntry.name}`, "error");
                    hadErrors = true;
                    continue;
                }

                const file = await entryToFile(subEntry);
                if (!file) continue;

                if (file.name.toLowerCase().endsWith(".pdf")) {
                    collectedFiles.push(file);
                } else {
                    showToast(`PDF olmayan dosya atlandı: ${file.name}`, "warn");
                    hadErrors = true;
                }
            }
        }
    }

    if (collectedFiles.length > 0) {
        await addPDFs(collectedFiles);
    } else if (!hadErrors) {
        showToast("Hiç PDF bulunamadı", "error");
    }
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

    const results = await Promise.allSettled(
        Array.from(files).map(file => parseSinglePdf(file).then(data => ({ file, data })))
    );

    results.forEach(result => {
        if (result.status === "fulfilled") {
            const { file, data } = result.value;
            pdfs.push({
                file,
                blobUrl:    URL.createObjectURL(file),
                parsedData: data,
                name:       file.name,
            });
            addedCount++;
        } else {
            failedCount++;
            showToast(`Bir PDF ayrıştırılamadı: ${result.reason?.message}`, "error");
        }
    });

    if (addedCount > 0) {
        activePdfIndex = pdfs.length - 1; // always point to last added
        showToast(`${addedCount} PDF eklendi!`, "success");
        if (failedCount > 0) showToast(`${failedCount} PDF atlandı`, "warn");
        renderPdfTabs();
        switchTab(activePdfIndex);
    }
}

// ── PDF.JS RENDERER ───────────────────────────────────────────────────────────
let _pdfDoc      = null;
let _highlights  = [];
let _pageSizes   = [];

function drawHighlightsOnCanvas(hlCanvas, pageIndex, viewport, dpr) {
    const ctx       = hlCanvas.getContext("2d");
    const pdfHeight = _pageSizes[pageIndex]?.height || (viewport.height / viewport.scale);
    const scale     = viewport.scale;

    ctx.clearRect(0, 0, hlCanvas.width, hlCanvas.height);
    ctx.scale(dpr, dpr);

    ctx.fillStyle   = "rgba(255, 220, 0, 0.35)";
    ctx.strokeStyle = "rgba(220, 160, 0, 0.8)";
    ctx.lineWidth   = 1.5;

    const pageHighlights = _highlights.filter(h => h.page === pageIndex);

    pageHighlights.forEach(h => {
        const x  = h.x0 * scale;
        const y  = (pdfHeight - h.y1) * scale;
        const w  = (h.x1 - h.x0) * scale;
        const ht = (h.y1 - h.y0) * scale;

        ctx.fillRect(x - 2, y - 2, w + 4, ht + 4);
        ctx.strokeRect(x - 2, y - 2, w + 4, ht + 4);
    });
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
async function switchTab(index) {
    if (activePdfIndex !== null && activePdfIndex !== index) snapshotForm();
    activePdfIndex = index;
    const pdf = pdfs[index];
    if (!pdf) return;

    const pdfViewer      = document.getElementById("pdfViewer");
    const pdfPlaceholder = document.getElementById("pdfPlaceholder");
    pdfViewer.style.display      = "block";
    pdfPlaceholder.style.display = "none";

    fillForm(pdf.parsedData);
    renderPdfTabs();

    pdfViewer.src = pdf.blobUrl;
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
    const indirimPct = dmoFiyat > 0 && tutar > 0
        ? parseFloat(((tutar / dmoFiyat) * 100).toFixed(2))
        : 0;

    return {
        "KATALOG KOD NO":                          katalogKod,
        "MALZEMENIN CINSI(VARSA MARKA VE MODELI)": malzemeAdi,
        "MALZEME_KODU":                            malzemeKodu,
        "TESLIM SURESI (GUN)":                     String(pickItemValue(item, ["TESLIM SURESI (GÜN)", "TESLIM SURESI (GUN)"], "0")),
        "KAT.SÖZ.FIY.(TL)":                        dmoFiyat,
        "TOPLAM INDIRIM":                          indirimPct,
        "ALIMA ESAS INDIRMLI BIRIM FIYAT":         indirimFiyat,
        "MIKTAR":                                  String(miktar),
        "TUTARI (TL)":                             String(toplam),
        "TUTAR":                                   tutar,
        "ILAVE TUTAR":                             ilaveTutar,
        "TOPLAM":                                  toplamIndirim,
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
    switchYSTab('bilgi');
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
    // Check for missing maliyet

}

function buildLineItemRow(item, index) {
    const katalogKod   = item["KATALOG KOD NO"] || "";
    const malzemeAdi   = item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || "";
    const malzemeKodu  = item["MALZEME_KODU"] || "";
    const indirimFiyat = parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"]) || 0;
    const miktar       = parseFloat(item["MIKTAR"] || "0") || 0;
    const toplam       = parseFloat(item["TUTARI (TL)"]) || 0;

    const cell   = "padding:9px 8px; vertical-align:middle;";
    const inp    = "width:100%; background:transparent; border:none; outline:none; font-family:inherit; font-size:13px; color:inherit; padding:3px 4px; border-radius:4px; transition:background .12s;";
    const inpR   = inp + " text-align:right;";
    const focus  = "this.style.background='var(--color-background-secondary)'";
    const blur   = "this.style.background='transparent'";

    const row = document.createElement("tr");
    row.style.borderTop = "0.5px solid var(--color-border-tertiary)";
    row.innerHTML = `
        <td style="${cell}">
            <input type="text" value="${escapeHtml(malzemeAdi)}" placeholder="Ürün adı"
                oninput="updateLineItemField(${index}, 'adi', this.value)"
                onfocus="${focus}" onblur="${blur}" style="${inp} font-weight:500;">
        </td>
        <td style="${cell}">
            <input type="text" value="${escapeHtml(malzemeKodu)}" placeholder="—"
                oninput="updateLineItemField(${index}, 'kodu', this.value)"
                onfocus="${focus}" onblur="${blur}" style="${inp} font-size:12px; color:#64748b;">
        </td>
        <td style="${cell}">
            <input type="text" value="${escapeHtml(katalogKod)}" placeholder="—"
                oninput="updateLineItemField(${index}, 'katalog', this.value)"
                onfocus="${focus}" onblur="${blur}" style="${inp} font-size:12px; color:#64748b;">
        </td>
        <td style="${cell}">
            <input type="number" step="0.01" value="${indirimFiyat}"
                oninput="updateLineItemField(${index}, 'indirimFiyat', this.value)"
                onfocus="${focus}" onblur="${blur}" style="${inpR}">
        </td>
        <td style="${cell}">
            <input type="number" step="1" value="${miktar}"
                oninput="updateLineItemField(${index}, 'miktar', this.value)"
                onfocus="${focus}" onblur="${blur}" style="${inpR}">
        </td>
        <td style="${cell} text-align:right; font-weight:600; white-space:nowrap;">${formatAmount(toplam)} ₺</td>
        <td style="${cell} text-align:center;">
            <button type="button" onclick="removeLineItem(${index})"
                style="background:none; border:none; cursor:pointer; padding:2px; color:#94a3b8;" title="Sil">
                <i class="ti ti-trash" style="font-size:14px;" aria-hidden="true"></i>
            </button>
        </td>
    `;
    return row;
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
    if (!Array.isArray(window._lastParsedItems)) window._lastParsedItems = [];
    window._lastParsedItems.unshift({
        "KATALOG KOD NO":                          "",
        "MALZEMENIN CINSI(VARSA MARKA VE MODELI)": "",
        "MALZEME_KODU":                            "",
        "KAT.SÖZ.FIY.(TL)":                        "0",
        "TOPLAM":                                  "0",
        "ALIMA ESAS INDIRMLI BIRIM FIYAT":         "0",
        "MIKTAR":                                  "0",
        "TUTARI (TL)":                             "0",
    });
    renderLineItems(window._lastParsedItems);

    // Auto-expand the new row
    const newIndex = window._lastParsedItems.filter(i => !i.is_gift).length - 1;
    // Auto-expand the new row (always index 0 since we unshift)
}
// ── CALCULATIONS ──────────────────────────────────────────────────────────────
function calculateDMOBasket(items) {
    const total = items.reduce((sum, item) => sum + (parseFloat(item["TUTARI (TL)"]) || 0), 0);
    if (total > 0) {
        setField("dmo_basket", total.toFixed(2));
    }
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
    updateYSStats();
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

function resetFormFields() {
    document.getElementById("dmoSiparisForm")?.reset();

    const lineItems = document.getElementById("lineItemsBody");
    const lineFoot  = document.getElementById("lineItemsFooter");
    if (lineItems) lineItems.innerHTML = "";
    if (lineFoot)  lineFoot.innerHTML  = "";

    const profitEl  = document.getElementById("net_profit_display");
    const percentEl = document.getElementById("profit_percent_display");
    if (profitEl)  profitEl.textContent  = "";
    if (percentEl) percentEl.textContent = "";

    // Clear stats pane
    const ysStats = [
        "ys-dmo-basket", "ys-inokas-basket", "ys-kdv", "ys-gercek-kdv",
        "ys-tutar-indirimi", "ys-tevkifat", "ys-risturn", "ys-damga-karar",
        "ys-vergiler-total", "ys-gift-total", "ys-toplam-gelir", "ys-toplam-gider"
    ];
    ysStats.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "—";
    });
    const profitStat  = document.getElementById("ys-net-profit");
    const pctStat     = document.getElementById("ys-profit-pct");
    if (profitStat) profitStat.textContent = "—";
    if (pctStat)    pctStat.textContent    = "—";

    clearModalAlert();
    window._lastParsedItems = null;
}

// ── UPLOAD PDF TO STORAGE ─────────────────────────────────────────────────────
async function uploadPDFToStorage(file, salesOrderNo) {
    const fd = new FormData();
    fd.append("pdf", file);
    fd.append("salesOrderNo", salesOrderNo);
    try {
        const res = await fetch("/api/dmo/upload-pdf", { method: "POST", body: fd });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const { url } = await res.json();
        return url || null;
    } catch (err) {
        console.error("PDF upload error:", err.message);
        return null;
    }
}

function buildOrderItems(parsedItems) {
    return (parsedItems || []).map(item => {
        const katalogKod = parseInt(item["KATALOG KOD NO"] || "0");
        return {
            product_code:        item["MALZEME_KODU"] || null,
            product_name:        item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || null,
            dmo_code:            katalogKod ? katalogKod.toString() : null,
            quantity:            parseInt(item["MIKTAR"] || "0"),
            dmo_price_excl_vat:  parseFloat(item["KAT.SÖZ.FIY.(TL)"] || "0") || 0,
            unit_price_excl_vat: parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"] || "0") || 0,
            line_total_excl_vat: parseFloat(item["TUTARI (TL)"]) || 0,
            is_gift:             !!item.is_gift,
            indirim_pct:         parseFloat(item["INDIRIM ORANLARI TUTAR"] || item["TOPLAM"] || "0") || 0,
        };
    });
}

// ── SAVE ORDER ────────────────────────────────────────────────────────────────
async function saveOrder() {
    snapshotForm();
    const salesOrderNo = document.getElementById("sales_order_no")?.value?.trim();
    if (!salesOrderNo) {
        showModalAlert("Satış Sipariş No bulunamadı!", "error");
        return;
    }

    const purchaseOrderNo = document.getElementById("purchase_order_no")?.value?.trim();
    const usdRate         = parseFloat(getCurrentRates().usd_try) || 0;

    // PDF-derived inputs only. Basket = catalog price × qty; discounted basket
    // ("actual") = Σ line totals. We store the RAW basket + the discount; every
    // derived figure (KDV, tevkifat, risturn, gelir, gider, profit) is computed on read.
    const regularItems = (window._lastParsedItems || []).filter(i => !i.is_gift);

    const dmoBasket    = regularItems.reduce((s, i) =>
        s + (parseFloat(i["KAT.SÖZ.FIY.(TL)"] || 0) * (parseFloat(i["MIKTAR"]) || 0)), 0);
    const actualBasket = regularItems.reduce((s, i) => s + (parseFloat(i["TUTARI (TL)"] || 0)), 0);
    const tutarIndirimi = dmoBasket - actualBasket;

    const stampTax = parseFloat(document.getElementById("stamp_tax")?.value) || 0;

    try {
        showModalAlert("Kaydediliyor...", "info");

        let pdfUrl = null;
        const activePdf = pdfs[activePdfIndex];
        if (activePdf?.file) {
            showModalAlert("PDF yükleniyor...", "info");
            pdfUrl = await uploadPDFToStorage(activePdf.file, salesOrderNo);
        }

        const orderPayload = {
            sales_order_no:        salesOrderNo,
            purchase_order_no:     purchaseOrderNo,
            customer_name:         document.getElementById("customer_name")?.value,
            customer_no:           document.getElementById("customer_no")?.value,
            order_date:            parseOrderDate(document.getElementById("order_date")?.value),
            due_date:              document.getElementById("last_order_date")?.value || null,
            stamp_tax:             stampTax,               // real PDF damga
            pdf_url:               pdfUrl,
            usd_rate:              usdRate,
            total_amount_excl_vat: dmoBasket,              // raw DMO basket (from PDF)
            tutar_indirimi:        tutarIndirimi,          // discount (from PDF)
            // dmo_basket_total / real_dmo_basket / kdv_amount / tevkifat / gercek_kdv /
            // risturn_amount / toplam_gelir / tutar_indirimi_pct / stamp_tax_total → GONE.
        };

        // Taslak merge re-inserts only regular items (gifts kept); fresh insert sends all
        const isMerge     = !!(_editingOrderId && _isTaslakMerge);
        const itemsSource = isMerge ? regularItems : (window._lastParsedItems || []);
        const items       = buildOrderItems(itemsSource);

        // Resolve/scrape unknown codes first (blocks if any can't be found on DMO)
        const resolveResults = await resolveUnknownProducts(items);
        const unresolved = Object.entries(resolveResults)
            .filter(([, r]) => !r.resolved)
            .map(([code]) => code);

        const res = await fetch("/api/dmo/orders/received", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: _editingOrderId || null, isMerge, order: orderPayload, items }),
        });

        if (res.status === 409) {
            const e = await res.json().catch(() => ({}));
            showModalAlert(e.error || "Bu sipariş zaten kayıtlı", "error");
            return;
        }
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showModalAlert("Sipariş kaydedilemedi: " + (e.error || res.status), "error");
            return;
        }

        const { failed, zeroCostCodes } = await res.json();
        const warnings = [];
        if (failed > 0)            warnings.push(`${failed} kalem hatalı`);

        showModalAlert(
            warnings.length ? "Sipariş kaydedildi — " + warnings.join(", ") : "Sipariş başarıyla kaydedildi! ✓",
            warnings.length ? "warn" : "success"
        );
        setTimeout(() => {
            removePdf(activePdfIndex);
            if (pdfs.length > 0) clearModalAlert();       // more PDFs queued → stay
            else if (window._onOrderSaved) window._onOrderSaved();
        }, warnings.length ? 1600 : 1000);

    } catch (err) {
        console.error("saveOrder error:", err);
        showModalAlert("Beklenmeyen hata: " + err.message, "error");
    }
}

async function resolveUnknownProducts(items) {
    const codes = [...new Set((items || []).map(i => i.dmo_code).filter(Boolean))];
    const results = {};
    let done = 0;
    showModalAlert(`Ürünler DMO'dan çekiliyor… (0/${codes.length})`, "info");
    for (const code of codes) {
        try {
            const res = await fetch("/api/dmo/resolve-product", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dmo_code: code }),
            });
            showModalAlert(`ürün bilgileri çekildi${await res.json()})`, "info");
            const data = await res.json();
            results[code] = data;
            showModalAlert(
                data.resolved ? `Ürün bulundu: ${code}` : `Ürün bulunamadı: ${code}`,
                "info"
            );
        } catch (e) {
            results[code] = { resolved: false, reason: "error" };
        }
        done++;
        showModalAlert(`Ürünler DMO'dan çekiliyor… (${done}/${codes.length})`, "info");
    }
    return results;
}

function toggleYSVergiler() {
    const detail = document.getElementById("ys-vergiler-detail");
    const arrow  = document.getElementById("ys-vergiler-arrow");
    const isOpen = detail.style.display !== "none";
    detail.style.display  = isOpen ? "none" : "block";
    arrow.style.transform = isOpen ? "" : "rotate(90deg)";
}
async function updateYSStats() {
    const items        = window._lastParsedItems || [];
    const regularItems = items.filter(i => !i.is_gift);

    const ids = ["ys-dmo-basket","ys-inokas-basket","ys-kdv","ys-gercek-kdv",
        "ys-tutar-indirimi","ys-tevkifat","ys-risturn","ys-damga-karar",
        "ys-vergiler-total","ys-gift-total","ys-toplam-gelir","ys-toplam-gider",
        "ys-net-profit","ys-profit-pct"];
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    if (regularItems.length === 0) {
        ids.forEach(id => set(id, "—"));
        return;
    }

    // ── Price/tax side (client, PDF-derived) ──
    const dmoBasket    = regularItems.reduce((s, i) => s + (parseFloat(i["KAT.SÖZ.FIY.(TL)"] || 0) * (parseFloat(i["MIKTAR"]) || 0)), 0);
    const actualBasket = regularItems.reduce((s, i) => s + (parseFloat(i["TUTARI (TL)"] || 0)), 0);
    const tutarIndirimi   = dmoBasket - actualBasket;
    const dmoDiscBasket = dmoBasket - tutarIndirimi;
    const kdv         = actualBasket * 0.20;
    const tevkifat    = kdv * 0.20;
    const gercekKdv   = kdv - tevkifat;
    const risturn     = actualBasket * 0.01;
    const damgaKarar  = actualBasket * 0.01517;
    const vergiler    = tevkifat + risturn + damgaKarar;
    const toplamGelir = actualBasket + gercekKdv;

    // ── Cost side (server) ──
    let cost = { inokas_basket_total: 0, gift_total: 0, zeroCostCodes: [] };
    try {
        const res = await fetch("/api/dmo/preview-cost", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: buildOrderItems(items) }),
        });
        if (res.ok) cost = await res.json();
    } catch (e) { /* leave zeros */ }

    const toplamGider = cost.inokas_basket_total + tutarIndirimi + vergiler + cost.gift_total;
    const netProfit   = toplamGelir - toplamGider;
    const profitPct   = toplamGelir > 0 ? (netProfit / toplamGelir * 100) : 0;

    const fmt = v => formatAmount(v.toFixed(2)) + " ₺";
    set("ys-dmo-basket",         fmt(dmoBasket));
    set("ys-dmo-disc-basket",    fmt(dmoDiscBasket));
    set("ys-inokas-basket",      fmt(cost.inokas_basket_total));
    set("ys-kdv",                fmt(kdv));
    set("ys-gercek-kdv",         fmt(gercekKdv));
    set("ys-tutar-indirimi",     fmt(tutarIndirimi));
    set("ys-tevkifat",           fmt(tevkifat));
    set("ys-risturn",            fmt(risturn));
    set("ys-damga-karar",        fmt(damgaKarar));
    set("ys-vergiler-total",     fmt(vergiler));
    set("ys-gift-total",         fmt(cost.gift_total));
    set("ys-toplam-gelir",       fmt(toplamGelir));
    set("ys-toplam-gider",       fmt(toplamGider));

    const profitEl  = document.getElementById("ys-net-profit");
    const percentEl = document.getElementById("ys-profit-pct");
    if (profitEl)  { profitEl.textContent  = fmt(netProfit); profitEl.style.color  = netProfit >= 0 ? "var(--fat-green, #1a6b47)" : "var(--fat-red, #b83232)"; }
    if (percentEl) { percentEl.textContent = profitPct.toFixed(2) + "%"; percentEl.style.color = profitPct >= 0 ? "var(--fat-green, #1a6b47)" : "var(--fat-red, #b83232)"; }

    // Zero-cost warning (server truth, replaces the old URUNLER scan)
    if (cost.zeroCostCodes && cost.zeroCostCodes.length) {
        showModalAlert(`Maliyeti girilmemiş ürün(ler): ${cost.zeroCostCodes.join(", ")} — kâr eksik olabilir.`, "warn");
    } else {
        clearModalAlert();
    }
}
function switchYSTab(tab) {
    const bilgiTab  = document.getElementById("ys-tab-bilgi");
    const kalemTab  = document.getElementById("ys-tab-kalemler");
    const bilgiPane = document.getElementById("ys-pane-bilgi");
    const kalemPane = document.getElementById("ys-pane-kalemler");

    const on  = "padding:10px 16px; background:none; border:none; border-bottom:2px solid #2563eb; font-size:13px; font-weight:700; color:#2563eb; cursor:pointer; font-family:inherit;";
    const off = "padding:10px 16px; background:none; border:none; border-bottom:2px solid transparent; font-size:13px; font-weight:500; color:#64748b; cursor:pointer; font-family:inherit;";

    if (tab === "kalemler") {
      kalemTab.style.cssText  = on;
      bilgiTab.style.cssText  = off;
      bilgiPane.style.display = "none";
      kalemPane.style.display = "flex";
    } else {
      bilgiTab.style.cssText  = on;
      kalemTab.style.cssText  = off;
      kalemPane.style.display = "none";
      bilgiPane.style.display = "flex";
      calculateProfit();   // stats live in the Bilgi pane → refresh when shown
    }
    }
document.addEventListener("DOMContentLoaded", async () => {
    const taslakId = new URLSearchParams(window.location.search).get("taslak");

    if (taslakId) {
        // Pre-set editing state for taslak merge
        _editingOrderId = taslakId;
        _isTaslakMerge  = true;

        // Update header to show editing context
        const titleEl = document.querySelector(".page-header-title");
        if (titleEl) titleEl.textContent = "Taslak PDF Ekle";

        // Update save button
        const saveBtn = document.getElementById("btnSaveOrder");
        if (saveBtn) saveBtn.textContent = "✓ Siparişi Tamamla";
    }

    window._onOrderSaved = () => {
        if (pdfs.length === 0) {
            window.location.href = "/dmo/pages/dmo.html?tab=bekleyen";
        }
    };
});