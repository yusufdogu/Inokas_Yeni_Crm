// ── LOAD DETAIL VIEW ──────────────────────────────────────────────────────────
async function loadDetailView(orderId) {
    const { data: order } = await db
        .from("dmo_orders")
        .select("*")
        .eq("id", orderId)
        .single();

    if (!order) return;

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

    // Fetch items
    const { data: items } = await db
        .from("dmo_order_items")
        .select("*, products(product_name)")
        .eq("order_id", orderId);

    const regularItems = (items || []).filter(i => !i.is_gift);
    const giftItems    = (items || []).filter(i =>  i.is_gift);

    const itemRowHTML = (i) => `
        <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:8px 12px; font-weight:500;">${i.products?.product_name || i.katalog_kod || "—"}</td>
            <td style="padding:8px 12px; text-align:center;">${i.quantity}</td>
            <td style="padding:8px 12px; text-align:right;">${formatAmount(i.unit_price_excl_vat)} ₺</td>
            <td style="padding:8px 12px; text-align:right;">${formatAmount(i.line_total_excl_vat)} ₺</td>
        </tr>`;

    const giftRowHTML = (i) => `
        <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:8px 12px; font-weight:500;">${i.products?.product_name || i.katalog_kod || "—"}</td>
            <td style="padding:8px 12px; text-align:center;">${i.quantity}</td>
            <td style="padding:8px 12px; text-align:right; color:#94a3b8;">🎁 Hediye</td>
            <td style="padding:8px 12px; text-align:right;">—</td>
        </tr>`;

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
        if (tBody) tBody.innerHTML = regularItems.map(itemRowHTML).join("");

        const tGiftSection = document.getElementById("dv-t-gift-section");
        const tGiftBody    = document.getElementById("dv-t-gift-items-body");
        if (tGiftSection) tGiftSection.style.display = giftItems.length > 0 ? "block" : "none";
        if (tGiftBody)    tGiftBody.innerHTML = giftItems.map(giftRowHTML).join("");

        const tDelete = document.getElementById("dv-t-btn-delete");
        const tEdit   = document.getElementById("dv-t-btn-edit");
        const tPdf    = document.getElementById("dv-t-btn-add-pdf");
        if (tDelete) tDelete.onclick = () => deleteOrder(orderId);
        if (tEdit)   tEdit.onclick   = () => {
            window.location.href = `/dmo/pages/sepet-hesapla.html?taslak=${orderId}`;
        };
        if (tPdf)    tPdf.onclick    = () => {
            window.location.href = `/dmo/pages/yeni-siparis.html?taslak=${orderId}`;
        };

        // Stats on right
        const statsContainer = document.getElementById("detail-right-stats");
        if (statsContainer) {
            statsContainer.innerHTML = buildStatsGridHTML();
            fillDetailStats(order);
        }

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
        if (body) body.innerHTML = regularItems.map(itemRowHTML).join("");

        const giftSection = document.getElementById("dv-gift-section");
        const giftBody    = document.getElementById("dv-gift-items-body");
        if (giftSection) giftSection.style.display = giftItems.length > 0 ? "block" : "none";
        if (giftBody)    giftBody.innerHTML = giftItems.map(giftRowHTML).join("");

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
            fillDetailStats(order);
        }

        switchDetailTab("bilgi");
    }
}

// ── FILL DETAIL STATS ─────────────────────────────────────────────────────────
function fillDetailStats(order) {
    const dmoBasket    = order.dmo_basket_total    || 0;
    const inokasBasket = order.inokas_basket_total || 0;
    const stampTax     = order.stamp_tax           || 0;
    const tutarIndirimi    = order.tutar_indirimi      || 0;
    const tutarIndirimPct  = order.tutar_indirimi_pct  || 0;
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
    const netProfit    = order.net_profit          || (toplamGelir - toplamGider);
    const profitPct    = order.profit_percentage   || (toplamGelir > 0 ? (netProfit / toplamGelir) * 100 : 0);

    const fmt = v => formatAmount(v.toFixed(2)) + " ₺";
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    set("dv-dmo-basket",        fmt(dmoBasket));
    set("dv-inokas-basket",     fmt(inokasBasket));
    set("dv-kdv",               fmt(kdv));
    set("dv-gercek-kdv",        fmt(gercekKdv));
    set("dv-tutar-indirimi",    fmt(tutarIndirimi));
    set("dv-tutar-indirimi-pct", tutarIndirimPct > 0 ? "%" + tutarIndirimPct.toFixed(1) : "—");
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
    const bilgiTab  = document.getElementById("dv-tab-bilgi");
    const statsTab  = document.getElementById("dv-tab-stats");
    const bilgiPane = document.getElementById("dv-pane-bilgi");
    const statsPane = document.getElementById("dv-pane-stats");

    if (tab === "bilgi") {
        bilgiTab?.classList.add("dv-tab-active");
        statsTab?.classList.remove("dv-tab-active");
        if (bilgiPane) bilgiPane.style.transform = "translateX(0)";
        if (statsPane) statsPane.style.transform = "translateX(100%)";
    } else {
        statsTab?.classList.add("dv-tab-active");
        bilgiTab?.classList.remove("dv-tab-active");
        if (bilgiPane) bilgiPane.style.transform = "translateX(-100%)";
        if (statsPane) statsPane.style.transform = "translateX(0)";
    }
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

    document.getElementById("dv-btn-save-edit").onclick   = () => saveInlineEdit(order.id);
    document.getElementById("dv-btn-cancel-edit").onclick = () => loadDetailView(order.id);
}

async function saveInlineEdit(orderId) {
    const updated = {
        sales_order_no:    document.getElementById("dv-edit-order-no")?.value    || null,
        purchase_order_no: document.getElementById("dv-edit-purchase-no")?.value || null,
        customer_name:     document.getElementById("dv-edit-company")?.value     || null,
        customer_no:       document.getElementById("dv-edit-customer-no")?.value || null,
        order_date:        document.getElementById("dv-edit-date")?.value        || null,
        due_date:          document.getElementById("dv-edit-due-date")?.value    || null,
        status:            document.getElementById("dv-edit-status")?.value      || null,
    };

    const { error } = await db
        .from("dmo_orders")
        .update(updated)
        .eq("id", orderId);

    if (error) {
        showToast("Güncelleme başarısız: " + error.message, "error");
        return;
    }

    showToast("Sipariş güncellendi!", "success");
    await loadDetailView(orderId);
}

// ── DELETE ORDER ──────────────────────────────────────────────────────────────
async function deleteOrder(orderId) {
    if (!confirm("Bu siparişi silmek istediğinizden emin misiniz?")) return;

    const { data: giftItems } = await db
        .from("dmo_order_items")
        .select("product_id, quantity")
        .eq("order_id", orderId)
        .eq("is_gift", true);

    await db.from("dmo_order_items").delete().eq("order_id", orderId);

    const { error } = await db.from("dmo_orders").delete().eq("id", orderId);

    if (error) {
        showToast("Silinemedi: " + error.message, "error");
        return;
    }

    // Restore gift quantities
    if (giftItems && giftItems.length > 0) {
        for (const giftItem of giftItems) {
            if (!giftItem.product_id) continue;
            const { data: product } = await db
                .from("products")
                .select("gift_quentity")
                .eq("id", giftItem.product_id)
                .maybeSingle();
            if (!product) continue;
            const newGift = Math.max(0, Number(product.gift_quentity || 0) - Number(giftItem.quantity || 0));
            await db.from("products").update({ gift_quentity: newGift }).eq("id", giftItem.product_id);
        }
    }

    showToast("Sipariş silindi!", "success");
    setTimeout(() => {
        window.location.href = "/dmo/pages/siparisler.html";
    }, 800);
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
            <div style="padding:8px 14px; border-bottom:1px solid #e2e8f0; border-left:2px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:12px; font-weight:600; color:#dc2626;">Tutar İndirimi</label>
                <div style="text-align:right;">
                    <span id="dv-tutar-indirimi-pct" style="font-size:11px; font-weight:700; color:#dc2626; margin-right:4px;">—</span>
                    <span id="dv-tutar-indirimi" style="font-weight:700; font-size:13px; color:#dc2626;">—</span>
                </div>
            </div>

            <div style="border-bottom:1px solid #e2e8f0; background:#fafafa;"></div>
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
// ── COMPUTE INVOICE METRICS (needed by fillDetailStats) ───────────────────────
function computeInvoiceMetrics(dmoBasket, inokasBasket, stampTax) {
    const kdv         = dmoBasket * 0.20;
    const tevkifat    = kdv * 0.20;
    const gercekKdv   = kdv - tevkifat;
    const dmoKesinti  = dmoBasket * 0.08;
    const risturn     = dmoBasket * 0.01;
    const toplamGelir = dmoBasket + gercekKdv;
    const toplamGider = inokasBasket + dmoKesinti + risturn + (stampTax || 0);
    const netProfit   = toplamGelir - toplamGider;
    const profitPct   = toplamGelir > 0 ? (netProfit / toplamGelir) * 100 : 0;
    return { kdv, tevkifat, gercekKdv, dmoKesinti, risturn, toplamGelir, toplamGider, netProfit, profitPct };
}

function toggleDVVergiler() {
    const detail = document.getElementById("dv-vergiler-detail");
    const arrow  = document.getElementById("dv-vergiler-arrow");
    const isOpen = detail.style.display !== "none";
    detail.style.display  = isOpen ? "none" : "block";
    arrow.style.transform = isOpen ? "" : "rotate(90deg)";
}