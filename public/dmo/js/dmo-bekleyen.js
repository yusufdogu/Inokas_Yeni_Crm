/* ============================================================================
   DMO BEKLEYEN — open orders (Taslak + Sipariş Alındı)
   List via /api/dmo/orders. Row → Taslak opens Sepet edit, Sipariş Alındı opens
   the order detail. "PDF Yükle" hands off to the existing yeni-siparis flow.
   Depends on: dmo-core.js (formatAmount, formatDate, showToast),
               dmo-shell.js (escapeHtml).
   ========================================================================== */

let _bekleyenStatus = "";   // "" = all open, or "Taslak" / "Sipariş Alındı"
let _bekleyenOrders = [];   // current rendered rows

async function initBekleyen() {
    _bekleyenStatus = "";
    await loadBekleyen();
}

async function loadBekleyen() {
    const tbody = document.getElementById("bekleyen-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="padding:24px 16px;color:var(--fat-muted);font-size:13px;">Yükleniyor…</td></tr>`;

    let url = "/api/dmo/orders";
    if (_bekleyenStatus) url += "?status=" + encodeURIComponent(_bekleyenStatus);

    let orders = [];
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("HTTP " + res.status);
        orders = await res.json();
    } catch (err) {
        console.error("Bekleyen siparişler yüklenemedi:", err.message);
        showToast("Bekleyen siparişler yüklenemedi", "error");
    }
    renderBekleyen(orders);
}

function renderBekleyen(orders) {
    _bekleyenOrders = orders;
    const tbody = document.getElementById("bekleyen-tbody");
    const empty = document.getElementById("bekleyen-empty");
    if (!tbody) return;

    if (!orders.length) {
        tbody.innerHTML = "";
        if (empty) empty.style.display = "block";
    } else {
        if (empty) empty.style.display = "none";
        tbody.innerHTML = orders.map(o => {
            const dmo_disc_total=o.total_amount_excl_vat - o.tutar_indirimi;
            const profit = Number(o.net_profit) || 0;
            return `
            <tr onclick="openBekleyenOrder('${o.id}')">
              <td class="dmo-td-no">${escapeHtml(o.sales_order_no || "—")}</td>
              <td class="dmo-td-firma">${escapeHtml(o.customer_name || "—")}</td>
              <td class="dmo-td-date">${formatDate(o.order_date)}</td>
              <td>${statusChip(o.status)}</td>
              <td class="dmo-td-amount">${formatAmount(dmo_disc_total)} ₺</td>
              <td class="dmo-td-amount" style="color:${profit >= 0 ? "var(--fat-green)" : "var(--fat-red)"};">${formatAmount(o.net_profit)} ₺</td>
            </tr>`;
        }).join("");
    }

    /* Badge reflects the full open set — only update it when nothing is filtered */
    if (_bekleyenStatus === "") setBekleyenBadge(orders.length);
}

function statusChip(status) {
    const map = {
        "Taslak":         { bg: "var(--fat-amber-bg)", color: "var(--fat-amber)" },
        "Sipariş Alındı": { bg: "var(--fat-green-bg)", color: "var(--fat-green)" },
    };
    const s = map[status] || { bg: "var(--fat-bg3)", color: "var(--fat-ink2)" };
    return `<span class="dmo-status" style="background:${s.bg};color:${s.color};">${escapeHtml(status || "—")}</span>`;
}

function openBekleyenOrder(id) {
    window.location.href = "/dmo/pages/invoice.html?id=" + encodeURIComponent(id);
}

function filterBekleyenStatus(status) {
    _bekleyenStatus = status;
    document.querySelectorAll(".bekleyen-tab").forEach(b =>
        b.classList.toggle("active", b.dataset.status === status));
    loadBekleyen();
}

function uploadBekleyenPdf() {
    window.location.href = "/dmo/pages/yeni-siparis.html";
}

function setBekleyenBadge(n) {
    const badge = document.getElementById("nav-bekleyen-count");
    if (!badge) return;
    badge.textContent = n;
    badge.style.display = n ? "" : "none";
}