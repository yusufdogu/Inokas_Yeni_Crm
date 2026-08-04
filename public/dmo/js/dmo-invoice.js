let _dvOrder        = null;
let _dvRegularItems = [];
let _dvGiftItems    = [];
let _dvGiftPick     = null;   // currently selected product in the picker
let _dvGiftBusy     = false;  // guards double-submit

// ── LOAD DETAIL VIEW ──────────────────────────────────────────────────────────
async function loadDetailView(orderId) {
    let order, items;
    try {
        const res = await fetch(`/api/dmo/orders/${encodeURIComponent(orderId)}`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        ({ order, items } = await res.json());
    } catch (err) {
        console.error("Sipariş yüklenemedi:", err.message);
        return;
    }
    if (!order) return;
    resetEditMode();

    const isTaslak = order.status === "Taslak";
    const hasPdf   = !!(order.pdf_url && String(order.pdf_url).trim() !== "");

    // Update page header title and status badge
    const titleEl = document.getElementById("invoice-page-title");
    const badgeEl = document.getElementById("invoice-status-badge");
    if (titleEl) titleEl.textContent = `${order.sales_order_no || "Taslak"} — ${order.customer_name || "—"}`;

    const statusColors = {
        "Taslak":         { bg: "#f1f5f9", color: "#64748b" },
        "Sipariş Alındı": { bg: "#eff6ff", color: "#2563eb" },
        "Tamamlandı":     { bg: "#f0fdf4", color: "#16a34a" },
        "İptal":          { bg: "#fef2f2", color: "#dc2626" },
    };
    if (badgeEl) {
        const sc = statusColors[order.status] || statusColors["Taslak"];
        badgeEl.textContent       = order.status || "Taslak";
        badgeEl.style.background  = sc.bg;
        badgeEl.style.color       = sc.color;
    }

    const regularItems = (items || []).filter(i => !i.is_gift);
    const giftItems    = (items || []).filter(i =>  i.is_gift);

    const itemRowHTML = (i, idx) => {
        const indirimPct = i.indirim_pct > 0
            ? i.indirim_pct
            : (i.dmo_products?.dmo_fiyat_try && i.unit_price_excl_vat
                ? ((1 - i.unit_price_excl_vat / i.dmo_products?.dmo_fiyat_try) * 100)
                : 0);
        return `
        <tr style="border-top:1px solid #e4dfd4; cursor:pointer;"
            onclick="toggleInvoiceItemDetail('inv-detail-${idx}', 'inv-chevron-${idx}')">
            <td style="padding:10px 8px; text-align:center; width:28px;">
                <i id="inv-chevron-${idx}" class="ti ti-chevron-right"
                   style="font-size:12px; color:#b4b0a6; transition:transform 0.15s;"></i>
            </td>
            <td style="padding:10px 8px; font-size:12px; color:#8a857c; width:90px; white-space:nowrap;">
                ${i.katalog_kod || i.dmo_products?.dmo_code || "—"}
            </td>
            <td style="padding:10px 8px; min-width:0;">
                <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#0e0d0b; font-size:13px; font-weight:500;">
                    ${i.dmo_products?.products?.product_name || "—"}
                </div>
            </td>
            <td style="padding:10px 8px; text-align:right; color:#0e0d0b; width:50px;">
                ${i.quantity}
            </td>
            <td style="padding:10px 8px; text-align:right; font-weight:600; color:#0e0d0b; width:110px; white-space:nowrap;">
                ${formatAmount(i.line_total_excl_vat)} ₺
            </td>
        </tr>
        <tr id="inv-detail-${idx}" style="display:none; background:#faf8f3;">
            <td colspan="5" style="padding:0 12px 12px 36px;">
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; padding-top:12px; border-top:1px solid #e4dfd4;">
                    <div>
                        <div style="font-size:11px; color:#8a857c; margin-bottom:3px;">Ürün Kodu</div>
                        <div style="font-size:13px; font-weight:500; color:#0e0d0b;">${i.dmo_products?.products?.product_code || "—"}</div>
                    </div>
                    <div>
                        <div style="font-size:11px; color:#8a857c; margin-bottom:3px;">DMO Katalog Fiyat</div>
                        <div style="font-size:13px; font-weight:500; color:#0e0d0b;">${i.dmo_products?.dmo_fiyat_try ? formatAmount(i.dmo_products?.dmo_fiyat_try) + " ₺" : "—"}</div>
                    </div>
                    <div>
                        <div style="font-size:11px; color:#8a857c; margin-bottom:3px;">İndirim %</div>
                        <div style="font-size:13px; font-weight:600; color:#b83232;">${indirimPct > 0 ? "%" + indirimPct.toFixed(2) : "—"}</div>
                    </div>
                    <div>
                        <div style="font-size:11px; color:#8a857c; margin-bottom:3px;">İndirimli Birim</div>
                        <div style="font-size:13px; font-weight:500; color:#0e0d0b;">${formatAmount(i.unit_price_excl_vat)} ₺</div>
                    </div>
                    <div>
                        <div style="font-size:11px; color:#8a857c; margin-bottom:3px;">Adet</div>
                        <div style="font-size:13px; font-weight:500; color:#0e0d0b;">${i.quantity}</div>
                    </div>
                    <div>
                        <div style="font-size:11px; color:#8a857c; margin-bottom:3px;">Maliyet TL</div>
                        <div style="font-size:13px; font-weight:500; color:#0e0d0b;">${(() => {
                            const unit = Number(i.dmo_products?.products?.last_purchase_price_tl) || 0;
                            const line = unit * (Number(i.quantity) || 0);
                            return line > 0 ? formatAmount(line) + " ₺" : "—";
                        })()}</div>
                    </div>
                    <div>
                        <div style="font-size:11px; color:#8a857c; margin-bottom:3px;">Toplam</div>
                        <div style="font-size:13px; font-weight:600; color:#0e0d0b;">${formatAmount(i.line_total_excl_vat)} ₺</div>
                    </div>
                </div>
            </td>
        </tr>`;
    };

    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || "—";
    };

    if (!hasPdf) {
        // ── TASLAK LAYOUT ────────────────────────────────────────────────────
        document.getElementById("detail-taslak-side").style.display = "grid";
        document.getElementById("detail-pdf-side").style.display    = "none";

        setEl("dv-t-order-no",    order.sales_order_no);
        setEl("dv-t-purchase-no", order.purchase_order_no);
        setEl("dv-t-company",     order.customer_name);
        setEl("dv-t-customer-no", order.customer_no);
        setEl("dv-t-date",        order.order_date);
        setEl("dv-t-status",      order.status);

        const tBody = document.getElementById("dv-t-items-body");
        if (tBody) tBody.innerHTML = regularItems.map((i, idx) => itemRowHTML(i, idx)).join("");

        // NOTE: taslak gift rendering left to its own section IDs if present.
        // Gift inline-editing is disabled on taslak (redirects to sepet), so
        // taslak gifts render read-only via the taslak gift body below.
        const tGiftSection = document.getElementById("dv-t-gift-section");
        const tGiftBody    = document.getElementById("dv-t-gift-items-body");
        if (tGiftSection) tGiftSection.style.display = giftItems.length > 0 ? "block" : "none";
        if (tGiftBody) {
            tGiftBody.innerHTML = giftItems.map(i => {
                const name = i.dmo_products?.products?.product_name || i.katalog_kod || "—";
                return `
                <tr style="border-top:1px solid #e2e8f0; background:#fff7ed;">
                    <td style="padding:8px 8px; width:28px; text-align:center; color:#d97706; font-size:13px;">🎁</td>
                    <td style="padding:8px 8px; font-size:12px; color:#94a3b8; width:90px;"></td>
                    <td style="padding:8px 8px; font-size:12px; font-weight:600; color:#0f172a;">${escapeHtml(name)}</td>
                    <td style="padding:8px 8px; text-align:right; font-size:12px; color:#64748b; width:50px;">${i.quantity}</td>
                    <td style="padding:8px 8px; width:110px;"></td>
                </tr>`;
            }).join("");
        }

        const tDelete = document.getElementById("dv-t-btn-delete");
        const tEdit   = document.getElementById("dv-t-btn-edit");
        if (tDelete) tDelete.onclick = () => deleteOrder(orderId);
        if (tEdit)   tEdit.onclick   = () => {
            window.location.href = "/dmo/pages/sepet-hesapla.html?taslak=" + encodeURIComponent(orderId);
        };

        // Stats on right
        const statsContainer = document.getElementById("detail-right-stats");
        if (statsContainer) {
            statsContainer.innerHTML = buildStatsGridHTML();
        }

        // Stash state (fills stats via fillDetailStats, wires gift button → sepet redirect)
        dvStashState(order, regularItems, giftItems);

    } else {
        // ── HAS PDF LAYOUT ───────────────────────────────────────────────────
        document.getElementById("detail-taslak-side").style.display = "none";
        document.getElementById("detail-pdf-side").style.display    = "grid";

        const pdfIframe = document.getElementById("detail-pdf-iframe");
        const noPdf     = document.getElementById("detail-no-pdf-placeholder");
        if (pdfIframe) {
            pdfIframe.src           = String(order.pdf_url).trim();
            pdfIframe.style.display = "block";
        }
        if (noPdf) noPdf.style.display = "none";

        setEl("dv-order-no",    order.sales_order_no);
        setEl("dv-purchase-no", order.purchase_order_no);
        setEl("dv-company",     order.customer_name);
        setEl("dv-customer-no", order.customer_no);
        setEl("dv-date",        order.order_date);
        setEl("dv-due-date",    order.due_date);
        setEl("dv-status",      order.status);

        const body = document.getElementById("dv-items-body");
        if (body) body.innerHTML = regularItems.map((i, idx) => itemRowHTML(i, idx)).join("");

        // Gift rows are now rendered by renderGiftRows() via dvStashState — do NOT
        // render them here (old giftRowHTML path removed to avoid double-render
        // and to attach delete buttons).

        // Reset button bars to read mode
        document.getElementById("dv-btn-bar").style.display  = "flex";
        document.getElementById("dv-edit-bar").style.display = "none";

        const deleteBtn = document.getElementById("dv-btn-delete");
        const editBtn   = document.getElementById("dv-btn-edit");
        const pdfBtn    = document.getElementById("dv-btn-add-pdf");
        if (deleteBtn) deleteBtn.onclick = () => deleteOrder(orderId);
        if (editBtn)   editBtn.onclick   = () => activateInlineEdit(order);
        if (pdfBtn)    pdfBtn.style.display = "none";

        // Stats pane
        const statsGrid = document.getElementById("dv-stats-grid");
        if (statsGrid) {
            statsGrid.innerHTML = buildStatsGridHTML();
        }

        switchDetailTab("bilgi");

        // Stash state → fills stats, renders gift rows w/ delete buttons, wires picker
        dvStashState(order, regularItems, giftItems);
    }
}

// ── FILL DETAIL STATS ─────────────────────────────────────────────────────────
function fillDetailStats(order,regularItems) {
    const dmoBasket    = order.total_amount_excl_vat || 0;
    const inokasBasket = (regularItems || []).reduce((sum, i) => {
        const unit = Number(i.dmo_products?.products?.last_purchase_price_tl) || 0;
        return sum + unit * (Number(i.quantity) || 0);
    }, 0);
    const stampTax     = order.stamp_tax           || 0;
    const tutarIndirimi    = order.tutar_indirimi      || 0;
    const dmoDiscBasket = dmoBasket - tutarIndirimi;
    const realDmoBasket    = dmoBasket - tutarIndirimi;

    const kdv          = realDmoBasket * 0.20;
    const tevkifat     = kdv * 0.20;
    const gercekKdv    = kdv - tevkifat;
    const risturn      = realDmoBasket * 0.01;
    const damgaKarar   = realDmoBasket * 0.01517;
    const vergilerTotal = tevkifat + risturn + damgaKarar;
    const giftTotal    = order.gift_total || 0;
    const toplamGelir  = realDmoBasket + gercekKdv;
    const toplamGider  = inokasBasket + tutarIndirimi + vergilerTotal + giftTotal;
    const netProfit    = toplamGelir - toplamGider;
    const profitPct    = toplamGelir > 0 ? (netProfit / toplamGelir) * 100 : 0;

    const fmt = v => formatAmount(v.toFixed(2)) + " ₺";
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set("dv-dmo-basket",        fmt(dmoBasket));
    set("dv-dmo-discount-basket",      fmt(dmoDiscBasket));
    set("dv-inokas-basket",     fmt(inokasBasket));
    set("dv-kdv",               fmt(kdv));
    set("dv-gercek-kdv",        fmt(gercekKdv));
    set("dv-tutar-indirimi",    fmt(tutarIndirimi));
    set("dv-tevkifat",          fmt(tevkifat));
    set("dv-risturn",           fmt(risturn));
    set("dv-damga-karar",       fmt(damgaKarar));
    set("dv-vergiler-total",    fmt(vergilerTotal));
    set("dv-gift-total",        fmt(giftTotal));
    set("dv-toplam-gelir",      fmt(toplamGelir));
    set("dv-toplam-gider",      fmt(toplamGider));


    const profitEl  = document.getElementById("dv-profit");
    const percentEl = document.getElementById("dv-profit-pct");
    if (profitEl) {
        profitEl.textContent = fmt(netProfit);
        profitEl.style.color = netProfit >= 0 ? "#16a34a" : "#dc2626";
    }
    if (percentEl) {
        percentEl.textContent = profitPct.toFixed(2) + "%";
        percentEl.style.color = profitPct >= 0 ? "#16a34a" : "#dc2626";
    }
}
// ── SWITCH DETAIL TAB ─────────────────────────────────────────────────────────
function switchDetailTab(tab) {
    const pdfSide = document.getElementById("detail-pdf-side");
    const isPdf   = pdfSide && pdfSide.offsetParent !== null;   // visible?
    const scope   = document.getElementById(isPdf ? "detail-right-tabbed" : "detail-taslak-tabbed");
    if (!scope) return;
    scope.querySelectorAll(".dv-tab").forEach(b =>
        b.classList.toggle("dv-tab-active", b.dataset.dvtab === tab));
    scope.querySelectorAll(".dv-pane").forEach(p =>
        p.style.display = (p.dataset.dvpane === tab) ? "flex" : "none");
}
// ── INLINE EDIT ───────────────────────────────────────────────────────────────
function activateInlineEdit(order) {
    const fields = [
        ["dv-order-no",    "dv-edit-order-no",    order.sales_order_no],
        ["dv-purchase-no", "dv-edit-purchase-no", order.purchase_order_no],
        ["dv-company",     "dv-edit-company",     order.customer_name],
        ["dv-customer-no", "dv-edit-customer-no", order.customer_no],
        ["dv-date",        "dv-edit-date",        order.order_date],
        ["dv-due-date",    "dv-edit-due-date",    order.due_date],
        ["dv-status",      "dv-edit-status",      order.status],
    ];

    fields.forEach(([spanId, inputId, value]) => {
        const span  = document.getElementById(spanId);
        const input = document.getElementById(inputId);
        if (span)  span.style.display  = "none";
        if (input) {
            input.value         = value || "";
            input.style.display = "block";
        }
    });

    document.getElementById("dv-btn-bar").style.display  = "none";
    document.getElementById("dv-edit-bar").style.display = "flex";


    document.getElementById("dv-btn-save-edit").onclick   = () => saveInlineEdit(order.id, order);
    document.getElementById("dv-btn-cancel-edit").onclick = () => loadDetailView(order.id);
}

async function saveInlineEdit(orderId, originalOrder) {
    const updated = {
        sales_order_no:    document.getElementById("dv-edit-order-no")?.value    || null,
        purchase_order_no: document.getElementById("dv-edit-purchase-no")?.value || null,
        customer_name:     document.getElementById("dv-edit-company")?.value     || null,
        customer_no:       document.getElementById("dv-edit-customer-no")?.value || null,
        order_date:        document.getElementById("dv-edit-date")?.value        || null,
        due_date:          document.getElementById("dv-edit-due-date")?.value    || null,
        status:            document.getElementById("dv-edit-status")?.value      || null,
    };

    // Check if anything actually changed
    const hasChanges =
        updated.sales_order_no    !== (originalOrder.sales_order_no    || null) ||
        updated.purchase_order_no !== (originalOrder.purchase_order_no || null) ||
        updated.customer_name     !== (originalOrder.customer_name     || null) ||
        updated.customer_no       !== (originalOrder.customer_no       || null) ||
        updated.order_date        !== (originalOrder.order_date        || null) ||
        updated.due_date          !== (originalOrder.due_date          || null) ||
        updated.status            !== (originalOrder.status            || null);

    if (!hasChanges) {
        showToast("Değişiklik yapılmadı", "info");
        //await loadDetailView(orderId);
        return;
    }

    try {
        const res = await fetch(`/api/dmo/orders/${encodeURIComponent(orderId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updated),
        });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showToast("Güncellenemedi: " + (e.error || res.status), "error");
            return;
        }
        showToast("Güncellendi", "success");
        await loadDetailView(orderId);   // re-render with fresh data
    } catch (err) {
        showToast("Güncellenemedi: " + err.message, "error");
    }

}

function resetEditMode() {
    const spanIds  = ["dv-order-no", "dv-purchase-no", "dv-company", "dv-customer-no", "dv-date", "dv-due-date", "dv-status"];
    const inputIds = ["dv-edit-order-no", "dv-edit-purchase-no", "dv-edit-company", "dv-edit-customer-no", "dv-edit-date", "dv-edit-due-date", "dv-edit-status"];

    spanIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "";
    });
    inputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });

    const btnBar  = document.getElementById("dv-btn-bar");
    const editBar = document.getElementById("dv-edit-bar");
    const giftBtn = document.getElementById("dv-btn-gift");
    if (btnBar)  btnBar.style.display  = "flex";
    if (editBar) editBar.style.display = "none";
    if (giftBtn) giftBtn.style.display = "flex";
}

// ── DELETE ORDER ──────────────────────────────────────────────────────────────
async function deleteOrder(orderId) {
    if (!confirm("Bu siparişi silmek istediğinizden emin misiniz?")) return;

    try {
        const res = await fetch(`/api/dmo/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
        if (!res.ok) {
            const e = await res.json().catch(() => ({}));
            showToast("Silinemedi: " + (e.error || res.status), "error");
            return;
        }
        showToast("Sipariş silindi", "success");
        window.location.href = "/dmo/pages/dmo.html?tab=bekleyen";
    } catch (err) {
        showToast("Silinemedi: " + err.message, "error");
    }
}

// ── BUILD STATS GRID HTML ─────────────────────────────────────────────────────
function buildStatsGridHTML() {
    return `
        <div style="display:grid; grid-template-columns:1fr 1fr; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">

            <div style="background:#f8fafc; padding:8px 14px; font-size:11px; font-weight:700; color:#64748b; letter-spacing:0.5px; border-bottom:1px solid #e2e8f0; text-transform:uppercase;">GELİR</div>
            <div style="background:#f8fafc; padding:8px 14px; font-size:11px; font-weight:700; color:#64748b; letter-spacing:0.5px; border-bottom:1px solid #e2e8f0; border-left:2px solid #e2e8f0; text-transform:uppercase;">GİDER</div>

            <div style="padding:8px 14px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:12px; font-weight:600; color:#64748b;">DMO Sepet</label>
                <span id="dv-dmo-basket" style="font-weight:700; font-size:13px; color:#0f172a;">—</span>
            </div>
            
            <div style="padding:8px 14px; border-bottom:1px solid #e2e8f0; border-left:2px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:12px; font-weight:600; color:#64748b;">İnokas Maliyet</label>
                <span id="dv-inokas-basket" style="font-weight:700; font-size:13px; color:#0f172a;">—</span>
            </div>
            
            <div style="padding:8px 14px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:12px; font-weight:600; color:#64748b;">DMO İndirimli Sepet</label>
                <span id="dv-dmo-discount-basket" style="font-weight:700; font-size:13px; color:#0f172a;">—</span>
            </div>
            <div style="padding:8px 14px; border-bottom:1px solid #e2e8f0; border-left:2px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:12px; font-weight:600; color:#dc2626;">Tutar İndirimi</label>
                <div style="text-align:right;">
                    <span id="dv-tutar-indirimi" style="font-weight:700; font-size:13px; color:#dc2626;">—</span>
                </div>
            </div>

            <div style="padding:8px 14px; border-bottom:1px solid #e2e8f0; display:flex; flex-direction:column; gap:3px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <label style="font-size:11px; font-weight:600; color:#94a3b8;">KDV (%20)</label>
                    <span id="dv-kdv" style="font-weight:600; font-size:12px; color:#64748b;">—</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <label style="font-size:12px; font-weight:700; color:#0f172a;">Gerçek KDV</label>
                    <span id="dv-gercek-kdv" style="font-weight:700; font-size:13px; color:#0f172a;">—</span>
                </div>
            </div>
            
            <div style="border-bottom:1px solid #e2e8f0; border-left:2px solid #e2e8f0;">
                <div onclick="toggleDVVergiler()"
                    style="padding:8px 14px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; user-select:none;">
                    <label style="font-size:12px; font-weight:600; color:#64748b; cursor:pointer; display:flex; align-items:center; gap:4px;">
                        <i class="ti ti-chevron-right" id="dv-vergiler-arrow" style="font-size:11px; transition:transform 0.2s;"></i>Vergiler
                    </label>
                    <span id="dv-vergiler-total" style="font-weight:700; font-size:13px; color:#0f172a;">—</span>
                </div>
                <div id="dv-vergiler-detail" style="display:none; border-top:1px solid #f1f5f9; background:#f8fafc;">
                    <div style="padding:5px 14px 5px 26px; display:flex; justify-content:space-between;">
                        <label style="font-size:11px; font-weight:600; color:#94a3b8;">Tevkifat (%20)</label>
                        <span id="dv-tevkifat" style="font-size:12px; font-weight:600; color:#64748b;">—</span>
                    </div>
                    <div style="padding:5px 14px 5px 26px; display:flex; justify-content:space-between;">
                        <label style="font-size:11px; font-weight:600; color:#94a3b8;">Risturn (%1)</label>
                        <span id="dv-risturn" style="font-size:12px; font-weight:600; color:#64748b;">—</span>
                    </div>
                    <div style="padding:5px 14px 5px 26px; display:flex; justify-content:space-between; border-bottom:1px solid #f1f5f9;">
                        <label style="font-size:11px; font-weight:600; color:#94a3b8;">Damga + Karar</label>
                        <span id="dv-damga-karar" style="font-size:12px; font-weight:600; color:#64748b;">—</span>
                    </div>
                </div>
            </div>
            

            <div style="border-bottom:1px solid #e2e8f0; background:#fafafa;"></div>
            
            
            <div style="padding:8px 14px; border-bottom:1px solid #e2e8f0; border-left:2px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:12px; font-weight:600; color:#64748b;">🎁 Hediye Toplam</label>
                <span id="dv-gift-total" style="font-weight:700; font-size:13px; color:#0f172a;">—</span>
            </div>
            
            <div style="padding:10px 14px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; background:#f1f5f9;">
                <label style="font-size:12px; font-weight:800; color:#0f172a;">Toplam Gelir</label>
                <span id="dv-toplam-gelir" style="font-weight:800; font-size:14px; color:#0f172a;">—</span>
            </div>
            
            <div style="padding:10px 14px; border-bottom:1px solid #e2e8f0; border-left:2px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; background:#f1f5f9;">
                <label style="font-size:12px; font-weight:800; color:#0f172a;">Toplam Gider</label>
                <span id="dv-toplam-gider" style="font-weight:800; font-size:14px; color:#0f172a;">—</span>
            </div>

            <div style="grid-column:span 2; padding:12px 14px; display:grid; grid-template-columns:1fr 1fr; gap:10px; background:#f8fafc;">
                <div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px; background:white; display:flex; justify-content:space-between; align-items:center;">
                    <label style="font-size:12px; font-weight:800; color:#0f172a;">Net Kar</label>
                    <div id="dv-profit" style="font-size:15px; font-weight:800;">—</div>
                </div>
                <div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px; background:white; display:flex; justify-content:space-between; align-items:center;">
                    <label style="font-size:12px; font-weight:800; color:#0f172a;">Kar %</label>
                    <div id="dv-profit-pct" style="font-size:15px; font-weight:800;">—</div>
                </div>
            </div>

        </div>
    `;
}

function toggleDVVergiler() {
    const detail = document.getElementById("dv-vergiler-detail");
    const arrow  = document.getElementById("dv-vergiler-arrow");
    const isOpen = detail.style.display !== "none";
    detail.style.display  = isOpen ? "none" : "block";
    arrow.style.transform = isOpen ? "" : "rotate(90deg)";
}

function toggleInvoiceItemDetail(detailId, chevronId) {
    const detail  = document.getElementById(detailId);
    const chevron = document.getElementById(chevronId);
    if (!detail || !chevron) return;
    const isOpen = detail.style.display !== "none";
    detail.style.display    = isOpen ? "none" : "table-row";
    chevron.style.transform = isOpen ? "" : "rotate(90deg)";
}

function dvStashState(order, regularItems, giftItems) {
    _dvOrder        = order;
    _dvRegularItems = regularItems || [];
    _dvGiftItems    = giftItems || [];
    if (typeof fillDetailStats === "function") fillDetailStats(order, regularItems);
    wireGiftButton();
    renderGiftRows();
}
function giftEditingAllowed() {
    const s = _dvOrder?.status;
    // Taslak redirects to sepet; only live orders edit gifts inline.
    return s === "Sipariş Alındı" || s === "Tamamlandı";
}

function wireGiftButton() {
    const btn = document.getElementById("dv-btn-gift");
    if (!btn) return;

    if (!giftEditingAllowed()) {
        // Taslak (or unknown): keep old redirect behavior, no inline picker.
        btn.onclick = () => {
            if (_dvOrder?.id)
                window.location.href = "/dmo/pages/sepet-hesapla.html?taslak=" + encodeURIComponent(_dvOrder.id);
        };
        return;
    }

    btn.onclick = () => {
        const picker = document.getElementById("dv-gift-picker");
        if (!picker) return;
        const open = picker.style.display !== "none";
        picker.style.display = open ? "none" : "block";
        if (!open) {
            const search = document.getElementById("dv-gift-search");
            if (search) { search.value = ""; search.focus(); }
            resetGiftSelection();
        }
    };

    wireGiftPicker();
}

/* ── Picker: search + select ── */
let _dvSearchTimer = null;

function wireGiftPicker() {
    const search = document.getElementById("dv-gift-search");
    if (!search || search._wired) return;   // wire once
    search._wired = true;

    search.addEventListener("input", () => {
        clearTimeout(_dvSearchTimer);
        const q = search.value.trim();
        if (q.length < 2) { hideGiftResults(); return; }
        _dvSearchTimer = setTimeout(() => runGiftSearch(q), 250);
    });

    document.getElementById("dv-gift-cancel")?.addEventListener("click", () => {
        document.getElementById("dv-gift-picker").style.display = "none";
        resetGiftSelection();
    });

    document.getElementById("dv-gift-add-confirm")?.addEventListener("click", confirmAddGift);
}

async function runGiftSearch(q) {
    const box = document.getElementById("dv-gift-results");
    if (!box) return;
    try {
        const res = await fetch("/api/products/search?q=" + encodeURIComponent(q));
        if (!res.ok) throw new Error("HTTP " + res.status);
        const rows = await res.json();
        if (!rows.length) {
            box.innerHTML = `<div style="padding:10px 12px; font-size:12px; color:#8a857c;">Sonuç yok</div>`;
            box.style.display = "block";
            return;
        }
        box.innerHTML = rows.map(p => `
            <div class="dv-gift-result" data-id="${p.id}"
                 data-name="${escapeHtml(p.product_name || "")}"
                 data-code="${escapeHtml(p.product_code || "")}"
                 style="padding:9px 12px; cursor:pointer; border-bottom:1px solid #f1efe9;">
                <div style="font-size:13px; font-weight:500; color:#0e0d0b;">${escapeHtml(p.product_name || "—")}</div>
                <div style="font-size:11px; color:#8a857c;">${escapeHtml(p.product_code || "")}${p.brand ? " · " + escapeHtml(p.brand) : ""}</div>
            </div>
        `).join("");
        box.style.display = "block";

        box.querySelectorAll(".dv-gift-result").forEach(el => {
            el.addEventListener("click", () => {
                selectGiftProduct(el.dataset.id, el.dataset.name, el.dataset.code);
            });
            el.addEventListener("mouseenter", () => el.style.background = "#faf8f3");
            el.addEventListener("mouseleave", () => el.style.background = "");
        });
    } catch (err) {
        console.error("Gift search error:", err);
        box.innerHTML = `<div style="padding:10px 12px; font-size:12px; color:#b83232;">Arama hatası</div>`;
        box.style.display = "block";
    }
}

function hideGiftResults() {
    const box = document.getElementById("dv-gift-results");
    if (box) { box.style.display = "none"; box.innerHTML = ""; }
}

function selectGiftProduct(id, name, code) {
    _dvGiftPick = { id, name, code };
    hideGiftResults();
    const search = document.getElementById("dv-gift-search");
    if (search) search.value = name;

    document.getElementById("dv-gift-selected-name").textContent = name;
    document.getElementById("dv-gift-selected-code").textContent = code;
    const sel = document.getElementById("dv-gift-selected");
    if (sel) sel.style.display = "flex";
    const qty = document.getElementById("dv-gift-qty");
    if (qty) { qty.value = "1"; qty.focus(); }
}

function resetGiftSelection() {
    _dvGiftPick = null;
    hideGiftResults();
    const sel = document.getElementById("dv-gift-selected");
    if (sel) sel.style.display = "none";
}

/* ── Add ── */
async function confirmAddGift() {
    if (_dvGiftBusy) return;
    if (!_dvGiftPick) { showToast("Önce ürün seçin", "error"); return; }
    const qty = Math.floor(Number(document.getElementById("dv-gift-qty")?.value) || 0);
    if (qty <= 0) { showToast("Miktar 1 veya daha fazla olmalı", "error"); return; }
    if (!_dvOrder?.id) return;

    _dvGiftBusy = true;
    try {
        const res = await fetch(`/api/dmo/orders/${encodeURIComponent(_dvOrder.id)}/gifts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ product_id: _dvGiftPick.id, quantity: qty }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || "Hediye eklenemedi", "error"); return; }

        // Append to local gift state in the same shape giftRowHTML/fillDetailStats expect.
        _dvGiftItems.push({
            id: data.gift.id,
            quantity: data.gift.quantity,
            is_gift: true,
            katalog_kod: null,
            // name for display; giftRowHTML falls back through these
            dmo_products: { products: { product_name: data.gift.product_name } },
        });

        showToast("Hediye eklendi", "success");
        document.getElementById("dv-gift-picker").style.display = "none";
        resetGiftSelection();
        renderGiftRows();
        recomputeAfterGiftChange();
    } catch (err) {
        showToast("Beklenmeyen hata: " + err.message, "error");
    } finally {
        _dvGiftBusy = false;
    }
}

/* ── Delete ── */
async function deleteGift(itemId) {
    if (_dvGiftBusy) return;
    _dvGiftBusy = true;
    try {
        const res = await fetch(`/api/dmo/orders/gifts/${encodeURIComponent(itemId)}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { showToast(data.error || "Hediye silinemedi", "error"); return; }

        _dvGiftItems = _dvGiftItems.filter(g => g.id !== itemId);
        showToast("Hediye silindi", "success");
        renderGiftRows();
        recomputeAfterGiftChange();
    } catch (err) {
        showToast("Beklenmeyen hata: " + err.message, "error");
    } finally {
        _dvGiftBusy = false;
    }
}

/* ── Render gift rows (with delete buttons) ── */
function renderGiftRows() {
    const section = document.getElementById("dv-gift-section");
    const body    = document.getElementById("dv-gift-items-body");
    if (!body) return;

    if (section) section.style.display = _dvGiftItems.length > 0 ? "block" : "none";

    body.innerHTML = _dvGiftItems.map(i => {
        const name = i.dmo_products?.products?.product_name || i.katalog_kod || "—";
        const canDelete = giftEditingAllowed();
        return `
        <tr style="border-top:1px solid #e2e8f0; background:#fff7ed;">
            <td style="padding:8px 8px; width:28px; text-align:center; color:#d97706; font-size:13px;">🎁</td>
            <td style="padding:8px 8px; width:28px;"></td>
            <td style="padding:8px 8px; font-size:12px; font-weight:600; color:#0f172a;">${escapeHtml(name)}</td>
            <td style="padding:8px 8px; text-align:right; font-size:12px; color:#64748b; width:50px;">${i.quantity}</td>
            <td style="padding:8px 8px; width:110px; text-align:right;">
                ${canDelete ? `<button onclick="deleteGift('${i.id}')" title="Sil"
                    style="background:none; border:none; cursor:pointer; color:#b83232; padding:4px; font-size:14px; line-height:1;">
                    <i class="ti ti-trash"></i></button>` : ""}
            </td>
        </tr>`;
    }).join("");
}

/* ── Live recompute after gift add/delete ── */
function recomputeAfterGiftChange() {
    // fillDetailStats reads gift cost from the order's gift_total? No — it recomputes
    // from items. But our gift cost lives server-side; the client giftItems we appended
    // don't carry maliyet. See note below.
    if (typeof fillDetailStats === "function" && _dvOrder) {
        fillDetailStats(_dvOrder, _dvRegularItems);
    }
}


document.addEventListener("DOMContentLoaded", async () => {
    const params  = new URLSearchParams(window.location.search);
    const orderId = params.get("id");
    const editMode = params.get("edit") === "true";

    if (!orderId) {
      document.getElementById("invoice-loading").innerHTML = `
        <i class="ti ti-alert-triangle" style="font-size:32px; color:#9a6318;"></i>
        <span style="font-size:14px; font-weight:600; color:#b83232;">Sipariş ID bulunamadı.</span>
        <a href="/dmo/pages/dmo.html?tab=bekleyen" style="font-size:13px; color:#0e0d0b; font-weight:600;">← Bekleyene dön</a>
      `;
      return;
    }
    await loadDetailView(orderId);
    document.getElementById("invoice-loading").style.display = "none";

    if (editMode) {
      try {
        const res = await fetch(`/api/dmo/orders/${encodeURIComponent(orderId)}`);
        if (res.ok) { const { order } = await res.json(); if (order) activateInlineEdit(order); }
      } catch (_) {}
    }
  });