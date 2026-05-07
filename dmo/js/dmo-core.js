// ── GLOBAL STATE ─────────────────────────────────────────────────────────────
let _isTaslakMerge        = false;
let _siparislerScrollTop  = 0;
let _currentDetailOrderId = null;
let _editingOrderId       = null;
let _openedFromSiparisler = false;
let _hhEditingTaslakId    = null;

// ── URUNLER LOOKUP ────────────────────────────────────────────────────────────
let URUNLER       = {};
let urunlerLoaded = false;

// ── FILTER STATE ──────────────────────────────────────────────────────────────
const filterState = {
    search:    "",
    company:   "",
    product:   "",
    dateStart: "",
    dateEnd:   "",
    status:    "",
    category:  "",
    minBasket: null,
    maxBasket: null,
};

// ── HELPERS ───────────────────────────────────────────────────────────────────
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

// "2026-04-17" → "17.04.2026"
function formatDate(dateStr) {
    if (!dateStr) return "-";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
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

function toggleGiderler() {
    const inner = document.getElementById("giderlerFlipInner");
    if (!inner) return;
    inner.classList.toggle("flipped");
}

// ── RATES ─────────────────────────────────────────────────────────────────────
// In-memory cache
window._rates = { usd_try: null, eur_try: null, dmo_eur_try: null };

function getCurrentRates() {
    return window._rates;
}

async function fetchRatesFromDB() {
    try {
        const res  = await fetch('/api/dmo/rates');
        const data = await res.json();
        window._rates = {
            usd_try:     parseFloat(data.usd_try)     || 0,
            eur_try:     parseFloat(data.eur_try)     || 0,
            dmo_eur_try: parseFloat(data.dmo_eur_try) || 0,
        };
    } catch (err) {
        console.error('Kurlar alınamadı:', err.message);
    }
}

async function ensureRatesExist() {
    const rates = window._rates;

    if (!rates.usd_try || !rates.eur_try) {
        console.log('TCMB rates missing, fetching for the first time...');
        await fetch('/api/dmo/fetch-tcmb-now', { method: 'POST' });
        await fetchRatesFromDB();
    }

    if (!window._rates.dmo_eur_try) {
        console.log('DMO rate missing, fetching for the first time...');
        await fetch('/api/dmo/fetch-dmo-rate-now', { method: 'POST' });
        await fetchRatesFromDB();
    }
}


// ── STATS CARDS ───────────────────────────────────────────────────────────────
async function renderStatsCards(orders) {
    const totalOrders   = orders.length;
    const totalDMO      = orders.reduce((s, o) => s + (o.dmo_basket_total    || 0), 0);
    const totalInokas   = orders.reduce((s, o) => s + (o.inokas_basket_total || 0), 0);
    const totalProfit   = orders.reduce((s, o) => s + (o.net_profit          || 0), 0);
    const avgProfitPct  = totalDMO > 0 ? (totalProfit / totalDMO) * 100 : 0;

    const totalKDV      = totalDMO * 0.20;
    const totalTevkifat = totalKDV * 0.20;
    const totalDamga    = orders.reduce((s, o) => s + (o.stamp_tax_total || 0), 0);
    const totalRisturn  = totalDMO * 0.01;
    const totalGiderler = totalTevkifat + totalDamga + totalRisturn;

    document.getElementById("stat-total-debt").textContent     = formatAmount(totalDMO)      + " ₺";
    document.getElementById("stat-supplier-count").textContent = totalOrders + " Sipariş";
    document.getElementById("stat-paid").textContent           = formatAmount(totalInokas)   + " ₺";
    document.getElementById("stat-overdue").textContent        = formatAmount(totalProfit)   + " ₺";
    document.getElementById("stat-overdue-count").textContent  = "%" + avgProfitPct.toFixed(1);
    document.getElementById("stat-diger-giderler").textContent = formatAmount(totalGiderler) + " ₺";
    document.getElementById("stat-tevkifat").textContent       = formatAmount(totalTevkifat) + " ₺";
    document.getElementById("stat-damga").textContent          = formatAmount(totalDamga)    + " ₺";
    document.getElementById("stat-risturn-total").textContent  = formatAmount(totalRisturn)  + " ₺";

}

// ── DASHBOARD INIT ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    await fetchRatesFromDB(); // always fetch rates first

    if (!document.getElementById("summaryCardsContainer")) return;

    const { data: allOrders } = await db
        .from("dmo_orders")
        .select("*")
        .neq("status", "İptal");

    if (allOrders) {
        await renderStatsCards(allOrders);
        await loadMainPageCharts(allOrders);
    }
});