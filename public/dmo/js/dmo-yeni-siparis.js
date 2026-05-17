// ── PDF STATE ─────────────────────────────────────────────────────────────────
let pdfs           = [];
let activePdfIndex = null;

// ── LOAD URUNLER ──────────────────────────────────────────────────────────────
async function loadUrunler() {
    if (urunlerLoaded) return;
    const {data, error} = await db
        .from("products")
        .select("dmo_code, product_name, maliyet_usd");

    if (error) {
        showToast("Ürünler yüklenemedi: " + error.message, "error");
        return;
    }


    data.forEach(p => {
        if (p.dmo_code) {
            URUNLER[parseInt(p.dmo_code)] = {
                urun: p.product_name,
                maliyet_usd: p.maliyet_usd || 0,
            };
        }
    });

    urunlerLoaded = true;
}


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



async function renderSinglePage(pageNum, container) {
    const page     = await _pdfDoc.getPage(pageNum);
    const dpr      = window.devicePixelRatio || 1;

    // Fit to container width
    const containerWidth = document.getElementById("pdfViewer").clientWidth - 16;
    const unscaledVp     = page.getViewport({ scale: 1 });
    const scale          = containerWidth / unscaledVp.width;
    const viewport       = page.getViewport({ scale });

    // Wrapper div for positioning canvas + highlight canvas
    const wrapper = document.createElement("div");
    wrapper.style.cssText = `position:relative; width:${viewport.width}px; height:${viewport.height}px; flex-shrink:0;`;

    // PDF canvas
    const canvas    = document.createElement("canvas");
    canvas.width    = viewport.width  * dpr;
    canvas.height   = viewport.height * dpr;
    canvas.style.cssText = `display:block; width:${viewport.width}px; height:${viewport.height}px;`;

    // Highlight canvas
    const hlCanvas    = document.createElement("canvas");
    hlCanvas.width    = viewport.width  * dpr;
    hlCanvas.height   = viewport.height * dpr;
    hlCanvas.style.cssText = `position:absolute; top:0; left:0; width:${viewport.width}px; height:${viewport.height}px; pointer-events:none;`;

    wrapper.appendChild(canvas);
    wrapper.appendChild(hlCanvas);
    container.appendChild(wrapper);

    // Render PDF page
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Draw highlights for this page
    drawHighlightsOnCanvas(hlCanvas, pageNum - 1, viewport, dpr);
}

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

    // Footer total
    const footer = document.getElementById("lineItemsFooter");
    if (footer) {
        const total = regularItems.reduce((s, i) => s + (parseFloat(i["TUTARI (TL)"]) || 0), 0);
        footer.innerHTML = `
            <tr style="border-top:0.5px solid var(--color-border-tertiary); background:var(--color-background-secondary);">
                <td colspan="4" style="padding:8px 12px; font-size:12px; color:#94a3b8;">${regularItems.length} kalem</td>
                <td style="padding:8px 12px; text-align:right; font-weight:600; font-size:13px;">${formatAmount(total)} ₺</td>
                <td></td>
            </tr>
        `;
    }

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
    const missingMaliyet = (window._lastParsedItems || [])
        .filter(i => !i.is_gift)
        .filter(i => {
            const mal = getLineItemMaliyetTL(i);
            return mal === null || mal === 0;
        })
        .map(i => i["KATALOG KOD NO"] || "?");

    if (missingMaliyet.length > 0) {
        showModalAlert(
            `Şu ürünler için maliyet bulunamadı: <strong>${missingMaliyet.join(", ")}</strong> — Karlılık hesabı eksik olabilir.`,
            "warn"
        );
    } else {
        clearModalAlert();
    }
}

function buildLineItemRow(item, index) {
    const katalogKod   = item["KATALOG KOD NO"] || "";
    const malzemeAdi   = item["MALZEMENIN CINSI(VARSA MARKA VE MODELI)"] || "";
    const malzemeKodu  = item["MALZEME_KODU"] || "";
    const dmoFiyat     = parseFloat(item["KAT.SÖZ.FIY.(TL)"])                || 0;
    const indirimPct   = parseFloat(item["TOPLAM"])                   || 0;
    const indirimFiyat = parseFloat(item["ALIMA ESAS INDIRMLI BIRIM FIYAT"])  || 0;
    const miktar       = parseFloat(item["MIKTAR"] || "0")                    || 0;
    const toplam       = parseFloat(item["TUTARI (TL)"])                      || 0;
    const maliyetTL    = getLineItemMaliyetTL(item);
    const hasMaliyet   = maliyetTL !== null && maliyetTL > 0;
    const detailId     = `line-detail-${index}`;
    const chevronId    = `line-chevron-${index}`;

    const fragment = document.createDocumentFragment();

    // ── MAIN ROW ──────────────────────────────────────────────────────────────
    const mainRow = document.createElement("tr");
    mainRow.style.cursor = "pointer";
    mainRow.style.borderTop = "0.5px solid var(--color-border-tertiary)";
    mainRow.onclick = () => toggleLineDetail(detailId, chevronId);
    mainRow.innerHTML = `
        <td style="padding:10px 8px; text-align:center;">
            <i id="${chevronId}" class="ti ti-chevron-right"
               style="font-size:12px; color:#64748b; transition:transform 0.15s;"
               aria-hidden="true"></i>
        </td>
        <td style="padding:10px 8px; font-size:12px; color:#64748b;">${escapeHtml(katalogKod)}</td>
        <td style="padding:10px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${escapeHtml(malzemeAdi)}
            ${!hasMaliyet ? `<span style="margin-left:6px; font-size:11px; background:#fef3c7; color:#92400e; padding:1px 6px; border-radius:4px;">maliyet yok</span>` : ""}
        </td>
        <td style="padding:10px 8px; text-align:right;">${miktar}</td>
        <td style="padding:10px 8px; text-align:right; font-weight:600;">${formatAmount(toplam)} ₺</td>
        <td style="padding:10px 8px; text-align:center;">
            <button type="button" onclick="event.stopPropagation(); removeLineItem(${index})"
                style="background:none; border:none; cursor:pointer; padding:2px; color:#94a3b8;"
                title="Sil">
                <i class="ti ti-trash" style="font-size:14px;" aria-hidden="true"></i>
            </button>
        </td>
    `;

    // ── DETAIL ROW ────────────────────────────────────────────────────────────
    const detailRow = document.createElement("tr");
    detailRow.id = detailId;
    detailRow.style.display = "none";
    detailRow.style.background = "var(--color-background-secondary)";
    detailRow.innerHTML = `
        <td colspan="6" style="padding:0 12px 12px 44px;">
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; padding-top:12px; border-top:0.5px solid var(--color-border-tertiary);">
                <div>
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Ürün Kodu</div>
                    <input type="text" value="${escapeHtml(malzemeKodu)}"
                        oninput="updateLineItemField(${index}, 'kodu', this.value)"
                        style="font-size:13px; font-weight:500; width:100%; background:transparent; border:none; border-bottom:1px solid #334155; color:inherit; outline:none; padding:2px 0;">
                </div>
                <div>
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">DMO Birim Fiyat</div>
                    <input type="number" step="0.01" value="${dmoFiyat}"
                        oninput="updateLineItemField(${index}, 'dmoFiyat', this.value)"
                        style="font-size:13px; font-weight:500; width:100%; background:transparent; border:none; border-bottom:1px solid #334155; color:inherit; outline:none; padding:2px 0;">
                </div>
                <div>
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">İndirim %</div>
                    <input type="number" step="0.01" value="${indirimPct}"
                        oninput="updateLineItemField(${index}, 'indirimPct', this.value)"
                        style="font-size:13px; font-weight:500; width:100%; background:transparent; border:none; border-bottom:1px solid #334155; color:inherit; outline:none; padding:2px 0;">
                </div>
                <div>
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">İndirimli Birim</div>
                    <input type="number" step="0.01" value="${indirimFiyat}"
                        oninput="updateLineItemField(${index}, 'indirimFiyat', this.value)"
                        style="font-size:13px; font-weight:500; width:100%; background:transparent; border:none; border-bottom:1px solid #334155; color:inherit; outline:none; padding:2px 0;">
                </div>
                <div>
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Ürün Adı</div>
                    <input type="text" value="${escapeHtml(malzemeAdi)}"
                        oninput="updateLineItemField(${index}, 'adi', this.value)"
                        style="font-size:13px; font-weight:500; width:100%; background:transparent; border:none; border-bottom:1px solid #334155; color:inherit; outline:none; padding:2px 0;">
                </div>
                <div>
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Katalog Kod</div>
                    <input type="text" value="${escapeHtml(katalogKod)}"
                        oninput="updateLineItemField(${index}, 'katalog', this.value)"
                        style="font-size:13px; font-weight:500; width:100%; background:transparent; border:none; border-bottom:1px solid #334155; color:inherit; outline:none; padding:2px 0;">
                </div>
                <div>
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Adet</div>
                    <input type="number" step="1" value="${miktar}"
                        oninput="updateLineItemField(${index}, 'miktar', this.value)"
                        style="font-size:13px; font-weight:500; width:100%; background:transparent; border:none; border-bottom:1px solid #334155; color:inherit; outline:none; padding:2px 0;">
                </div>
                <div>
                    <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Maliyet (₺)</div>
                    <div style="font-size:13px; font-weight:500; padding:2px 0; color:${hasMaliyet ? 'inherit' : '#f59e0b'};">
                        ${hasMaliyet ? formatAmount(maliyetTL) + " ₺" : "— bulunamadı"}
                    </div>
                </div>
            </div>
        </td>
    `;

    fragment.appendChild(mainRow);
    fragment.appendChild(detailRow);
    return fragment;
}

function toggleLineDetail(detailId, chevronId) {
    const detail  = document.getElementById(detailId);
    const chevron = document.getElementById(chevronId);
    if (!detail || !chevron) return;
    const isOpen = detail.style.display !== "none";
    detail.style.display    = isOpen ? "none" : "table-row";
    chevron.style.transform = isOpen ? "" : "rotate(90deg)";
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
    setTimeout(() => toggleLineDetail(`line-detail-0`, `line-chevron-0`), 50);
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
    const pctBadge    = document.getElementById("ys-tutar-indirimi-pct");
    if (profitStat) profitStat.textContent = "—";
    if (pctStat)    pctStat.textContent    = "—";
    if (pctBadge)   pctBadge.textContent   = "%0";

    clearModalAlert();
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
    snapshotForm(); // flush current form state into pdfs[activePdfIndex]
    const salesOrderNo = document.getElementById("sales_order_no")?.value?.trim();
    if (!salesOrderNo) {
        showModalAlert("Satış Sipariş No bulunamadı!", "error");
        return;
    }

    const purchaseOrderNo = document.getElementById("purchase_order_no")?.value?.trim();
    const usdRate         = parseFloat(getCurrentRates().usd_try) || 0;

    // Calculate from line items directly — don't rely on DOM inputs
    const regularItems  = (window._lastParsedItems || []).filter(i => !i.is_gift);
    const giftItems     = (window._lastParsedItems || []).filter(i =>  i.is_gift);

    // DMO basket = catalog price × qty (before discount)
    const dmoBasket = regularItems.reduce((s, i) =>
        s + (parseFloat(i["KAT.SÖZ.FIY.(TL)"] || 0) * (parseFloat(i["MIKTAR"]) || 0)), 0);

    // Actual basket = discounted price × qty (what customer pays)
    const actualBasket = regularItems.reduce((s, i) =>
        s + (parseFloat(i["TUTARI (TL)"] || 0)), 0);

    // Tutar indirimi = difference
    const tutarIndirimi   = dmoBasket - actualBasket;
    const tutarIndirimPct = dmoBasket > 0 ? (tutarIndirimi / dmoBasket * 100) : 0;

    // Inokas basket from URUNLER
    const inokasBasket = regularItems.reduce((s, i) => {
        const kod  = parseInt(i["KATALOG KOD NO"] || "0");
        const qty  = parseFloat(i["MIKTAR"] || "0");
        const urun = URUNLER[kod];
        return s + (urun ? urun.maliyet_usd * qty * usdRate : 0);
    }, 0);

    // Gift total
    const giftTotal = giftItems.reduce((s, i) => {
        const kod  = parseInt(i["KATALOG KOD NO"] || "0");
        const qty  = parseFloat(i["MIKTAR"] || "0");
        const urun = URUNLER[kod];
        return s + (urun ? urun.maliyet_usd * qty * usdRate : 0);
    }, 0);

    const stampTax = parseFloat(document.getElementById("stamp_tax")?.value) || 0;

    // All taxes on actualBasket
    const kdv          = actualBasket * 0.20;
    const tevkifat     = kdv * 0.20;
    const gercekKdv    = kdv - tevkifat;
    const risturn      = actualBasket * 0.01;
    const damgaKarar   = actualBasket * 0.01517;
    const toplamGelir  = actualBasket + gercekKdv;
    const toplamGider  = inokasBasket + tutarIndirimi + tevkifat + risturn + damgaKarar + giftTotal;
    const netProfit    = toplamGelir - toplamGider;
    const profitPct    = toplamGelir > 0 ? (netProfit / toplamGelir * 100) : 0;

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
                due_date:            document.getElementById("last_order_date")?.value || null,
                stamp_tax:           stampTax,
                stamp_tax_total:     stampTax,
                pdf_url:             pdfUrl,
                usd_rate:            usdRate,
                dmo_basket_total:    dmoBasket,
                real_dmo_basket:     actualBasket,
                tutar_indirimi:      tutarIndirimi,
                tutar_indirimi_pct:  tutarIndirimPct,
                inokas_basket_total: inokasBasket,
                gift_total:          giftTotal,
                kdv_amount:          kdv,
                tevkifat:            tevkifat,
                gercek_kdv:          gercekKdv,
                risturn_amount:      risturn,
                toplam_gelir:        toplamGelir,
                toplam_gider:        toplamGider,
                net_profit:          netProfit,
                profit_percentage:   profitPct,
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
                });
                if (ie) failedItems++;
            }

            if (failedItems > 0) {
                showModalAlert(`Güncellendi fakat ${failedItems} kalem hatalı!`, "warn");
            } else {
                showModalAlert("Sipariş başarıyla kaydedildi! ✓", "success");
                setTimeout(() => {
                    // Remove the saved PDF tab
                    removePdf(activePdfIndex);

                    // If more PDFs remain, stay on the page
                    if (pdfs.length > 0) {
                        showModalAlert("", "info");
                        clearModalAlert();
                    } else {
                        // All PDFs saved — redirect
                        if (window._onOrderSaved) window._onOrderSaved();
                    }
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
            stamp_tax_total:       stampTax,
            pdf_url:               pdfUrl,
            usd_rate:              usdRate,
            dmo_basket_total:      dmoBasket,
            real_dmo_basket:       actualBasket,
            tutar_indirimi:        tutarIndirimi,
            tutar_indirimi_pct:    tutarIndirimPct,
            inokas_basket_total:   inokasBasket,
            gift_total:            giftTotal,
            kdv_amount:            kdv,
            tevkifat:              tevkifat,
            gercek_kdv:            gercekKdv,
            risturn_amount:        risturn,
            toplam_gelir:          toplamGelir,
            toplam_gider:          toplamGider,
            net_profit:            netProfit,
            profit_percentage:     profitPct,
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

            const indirimPct = parseFloat(item["TOPLAM INDIRIM"] || item["TOPLAM"] || "0") || 0;
            await db.from("dmo_order_items").insert({
                order_id:            order.id,
                product_id:          productId,
                quantity:            miktar,
                unit_price_excl_vat: unitPrice,
                line_total_excl_vat: lineTotal,
                indirim_pct:         indirimPct,
            });
        }

        if (failedItems > 0) {
            showModalAlert(`Sipariş kaydedildi fakat ${failedItems} kalem hatalı!`, "warn");
        } else {
            showModalAlert("Sipariş başarıyla kaydedildi! ✓", "success");
            setTimeout(() => {
                removePdf(activePdfIndex);
                if (window._onOrderSaved) window._onOrderSaved();
            }, 1000);
        }

    } catch (err) {
        console.error("saveOrder error:", err);
        showModalAlert("Beklenmeyen hata: " + err.message, "error");
    }
}

function toggleYSVergiler() {
    const detail = document.getElementById("ys-vergiler-detail");
    const arrow  = document.getElementById("ys-vergiler-arrow");
    const isOpen = detail.style.display !== "none";
    detail.style.display  = isOpen ? "none" : "block";
    arrow.style.transform = isOpen ? "" : "rotate(90deg)";
}
function updateYSStats() {
    const items        = window._lastParsedItems || [];
    const regularItems = items.filter(i => !i.is_gift);

    // Nothing to show — clear and return
    if (regularItems.length === 0) {
        const ids = [
            "ys-dmo-basket", "ys-inokas-basket", "ys-kdv", "ys-gercek-kdv",
            "ys-tutar-indirimi", "ys-tevkifat", "ys-risturn", "ys-damga-karar",
            "ys-vergiler-total", "ys-gift-total", "ys-toplam-gelir", "ys-toplam-gider",
            "ys-net-profit", "ys-profit-pct"
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = "—";
        });
        const pct = document.getElementById("ys-tutar-indirimi-pct");
        if (pct) pct.textContent = "%0";
        return;
    }

    const giftItems    = items.filter(i =>  i.is_gift);

    // DMO basket = sum of catalog price × qty (before discount)
    const dmoBasket = regularItems.reduce((s, i) =>
        s + (parseFloat(i["KAT.SÖZ.FIY.(TL)"] || 0) * (parseFloat(i["MIKTAR"]) || 0)), 0);

    // Actual basket = sum of discounted price × qty (TUTARI TL)
    const actualBasket = regularItems.reduce((s, i) =>
        s + (parseFloat(i["TUTARI (TL)"] || 0)), 0);

    // Tutar indirimi = difference between catalog and actual
    const tutarIndirimi    = dmoBasket - actualBasket;
    const tutarIndirimPct  = dmoBasket > 0 ? (tutarIndirimi / dmoBasket * 100) : 0;

    // Inokas basket
    const inokasBasket = parseFloat(document.getElementById("inokas_basket")?.value) || 0;

    // Gift total
    const usdRate   = parseFloat(getCurrentRates().usd_try) || 0;
    const giftTotal = giftItems.reduce((s, i) => {
        const kod  = parseInt(i["KATALOG KOD NO"] || "0");
        const qty  = parseFloat(i["MIKTAR"] || "0");
        const urun = URUNLER[kod];
        return s + (urun ? urun.maliyet_usd * qty * usdRate : 0);
    }, 0);

    // Taxes on actualBasket
    const kdv          = actualBasket * 0.20;
    const tevkifat     = kdv * 0.20;
    const gercekKdv    = kdv - tevkifat;
    const risturn      = actualBasket * 0.01;
    const damgaKarar   = actualBasket * 0.01517;
    const vergilerTotal = tevkifat + risturn + damgaKarar;

    const toplamGelir  = actualBasket + gercekKdv;
    const toplamGider  = inokasBasket + tutarIndirimi + vergilerTotal + giftTotal;
    const netProfit    = toplamGelir - toplamGider;
    const profitPct    = toplamGelir > 0 ? (netProfit / toplamGelir * 100) : 0;

    const fmt = v => formatAmount(v.toFixed(2)) + " ₺";
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set("ys-dmo-basket",        fmt(dmoBasket));
    set("ys-inokas-basket",     fmt(inokasBasket));
    set("ys-kdv",               fmt(kdv));
    set("ys-gercek-kdv",        fmt(gercekKdv));
    set("ys-tutar-indirimi",    fmt(tutarIndirimi));
    set("ys-tutar-indirimi-pct", "%" + tutarIndirimPct.toFixed(1));
    set("ys-tevkifat",          fmt(tevkifat));
    set("ys-risturn",           fmt(risturn));
    set("ys-damga-karar",       fmt(damgaKarar));
    set("ys-vergiler-total",    fmt(vergilerTotal));
    set("ys-gift-total",        fmt(giftTotal));
    set("ys-toplam-gelir",      fmt(toplamGelir));
    set("ys-toplam-gider",      fmt(toplamGider));

    const profitEl  = document.getElementById("ys-net-profit");
    const percentEl = document.getElementById("ys-profit-pct");
    if (profitEl) {
        profitEl.textContent = fmt(netProfit);
        profitEl.style.color = netProfit >= 0 ? "#16a34a" : "#dc2626";
    }
    if (percentEl) {
        percentEl.textContent = profitPct.toFixed(2) + "%";
        percentEl.style.color = profitPct >= 0 ? "#16a34a" : "#dc2626";
    }
}

function switchYSTab(tab) {
    const bilgiTab   = document.getElementById("ys-tab-bilgi");
    const statsTab   = document.getElementById("ys-tab-stats");
    const bilgiPane  = document.getElementById("ys-pane-bilgi");
    const statsPane  = document.getElementById("ys-pane-stats");

    if (tab === "bilgi") {
        bilgiTab.style.borderBottom  = "2px solid #2563eb";
        bilgiTab.style.color         = "#2563eb";
        bilgiTab.style.fontWeight    = "700";
        statsTab.style.borderBottom  = "2px solid transparent";
        statsTab.style.color         = "#64748b";
        statsTab.style.fontWeight    = "500";
        bilgiPane.style.display      = "flex";
        statsPane.style.display      = "none";
    } else {
        statsTab.style.borderBottom  = "2px solid #2563eb";
        statsTab.style.color         = "#2563eb";
        statsTab.style.fontWeight    = "700";
        bilgiTab.style.borderBottom  = "2px solid transparent";
        bilgiTab.style.color         = "#64748b";
        bilgiTab.style.fontWeight    = "500";
        bilgiPane.style.display      = "none";
        statsPane.style.display      = "block";
    }
}

function renderYSStats() {
    const container = document.getElementById("ys-stats-grid");
    if (!container) return;
    container.innerHTML = buildStatsGridHTML();

    const dmoBasket    = parseFloat(document.getElementById("dmo_basket")?.value)    || 0;
    const inokasBasket = parseFloat(document.getElementById("inokas_basket")?.value) || 0;
    const stampTax     = parseFloat(document.getElementById("stamp_tax")?.value)     || 0;

    const m = computeInvoiceMetrics(dmoBasket, inokasBasket, stampTax);
    const fmt = v => formatAmount(v.toFixed(2)) + " ₺";
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set("dv-dmo-basket",    fmt(dmoBasket));
    set("dv-inokas-basket", fmt(inokasBasket));
    set("dv-kdv",           fmt(m.kdv));
    set("dv-stamp",         fmt(stampTax));
    set("dv-tevkifat",      fmt(m.tevkifat));
    set("dv-gercek-kdv",    fmt(m.gercekKdv));
    set("dv-risturn",       fmt(m.risturn));
    set("dv-toplam-gelir",  fmt(m.toplamGelir));
    set("dv-toplam-gider",  fmt(m.toplamGider));

    const profitEl    = document.getElementById("dv-profit");
    const profitPctEl = document.getElementById("dv-profit-pct");
    if (profitEl) {
        profitEl.textContent = fmt(m.netProfit);
        profitEl.style.color = m.netProfit >= 0 ? "#16a34a" : "#dc2626";
    }
    if (profitPctEl) {
        profitPctEl.textContent = m.profitPct.toFixed(2) + "%";
        profitPctEl.style.color = m.profitPct >= 0 ? "#16a34a" : "#dc2626";
    }
}
// ── PAGE INIT ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    if (!document.getElementById("dmoSiparisForm")) return;
    await loadUrunler();

    // Wire stamp_tax input to recalculate
    document.getElementById("stamp_tax")?.addEventListener("input", calculateProfit);
});