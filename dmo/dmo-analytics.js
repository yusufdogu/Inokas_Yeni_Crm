// ── CHARTS ───────────────────────────────────────────────────────────────────

let chartInstances     = {};
let chartModalInstance = null;
let chartDataStore     = {};

function destroyCharts() {
    Object.values(chartInstances).forEach(c => c.destroy());
    chartInstances = {};
}

function clearChartsGrid() {
    destroyCharts();
    chartDataStore = {};
    document.getElementById("chartsGrid").innerHTML = "";
}

function createChartCanvas(id, title, spanTwo = false) {
    const grid = document.getElementById("chartsGrid");
    const div  = document.createElement("div");
    div.className = `chart-card${spanTwo ? " span-2" : ""}`;
    div.innerHTML = `
        <div class="chart-card-header">
            <h3 class="chart-title">${title}</h3>
            <button class="chart-expand-btn" onclick="openChartModal('${id}')" title="Büyüt">⛶</button>
        </div>
        <div class="chart-canvas-wrap">
            <canvas id="${id}"></canvas>
        </div>
    `;
    grid.appendChild(div);
}

// ── SHARED CHART CREATOR ──────────────────────────────────────────────────────
function makeChart(instanceKey, canvasId, title, type, data, options) {
    const el = document.getElementById(canvasId);
    if (!el) return;

    const fullOptions = {
        ...options,
        responsive:          true,
        maintainAspectRatio: false,
    };

    if (chartInstances[instanceKey]) {
        chartInstances[instanceKey].destroy();
    }

    chartInstances[instanceKey] = new Chart(el, { type, data, options: fullOptions });

    chartDataStore[canvasId] = { title, type, data, options: fullOptions };
}

// ── MAIN CHART LOADER ─────────────────────────────────────────────────────────
async function loadCharts(orders) {
    clearChartsGrid();
    const f = getActiveFilters();

    if (orders.length === 0) {
        document.getElementById("chartsGrid").innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:40px; color:#94a3b8;">
                Grafik için yeterli veri yok
            </div>`;
        return;
    }

    createChartCanvas("monthlyProfitChart", "📈 Aylık Net Kar Trendi", true);
    renderMonthlyProfitChart(orders);

    if (!f.hasCompany && !f.hasProduct) {
        createChartCanvas("topCustomersChart",    "🏢 En Çok Sipariş Veren Müşteriler");
        createChartCanvas("topProductsChart",     "📦 En Çok Sipariş Edilen Ürünler");
        createChartCanvas("basketComparisonChart","📊 DMO vs İnokas Sepet", true);
        renderTopCustomersChart(orders);
        await renderTopProductsChart(orders);
        renderBasketComparisonChart(orders);
        return;
    }

    if (f.hasCompany && !f.hasProduct) {
        createChartCanvas("customerProductMixChart",     "🥧 Ürün Dağılımı");
        createChartCanvas("customerOrderFrequencyChart", "📅 Sipariş Sıklığı");
        await renderCustomerProductMixChart(orders);
        renderCustomerOrderFrequencyChart(orders);
        return;
    }

    if (f.hasProduct && !f.hasCompany) {
        createChartCanvas("productCustomerChart",      "🏢 Bu Ürünü En Çok Kim Aldı");
        createChartCanvas("productQuantityTrendChart", "📦 Miktar Trendi");
        await renderProductCustomerChart(orders);
        renderProductQuantityTrendChart(orders);
        return;
    }

    if (f.hasCompany && f.hasProduct) {
        createChartCanvas("marginTrendChart",      "💰 Kar Marjı Trendi",   true);
        createChartCanvas("basketComparisonChart", "📊 DMO vs İnokas Sepet", true);
        renderMarginTrendChart(orders);
        renderBasketComparisonChart(orders);
        return;
    }
}

// ── 1. MONTHLY PROFIT TREND ───────────────────────────────────────────────────
function renderMonthlyProfitChart(orders) {
    const monthly = {};
    orders.forEach(o => {
        const month = o.order_date?.slice(0, 7);
        if (!month) return;
        if (!monthly[month]) monthly[month] = 0;
        monthly[month] += o.net_profit || 0;
    });

    const labels = Object.keys(monthly).map(m => {
        const [y, mo] = m.split("-");
        return `${mo}/${y}`;
    });

    makeChart("monthly", "monthlyProfitChart", "📈 Aylık Net Kar Trendi", "line",
        {
            labels,
            datasets: [{
                label:           "Net Kar (₺)",
                data:            Object.values(monthly),
                borderColor:     "#2563eb",
                backgroundColor: "rgba(37,99,235,0.08)",
                borderWidth:     2,
                pointRadius:     4,
                tension:         0.3,
                fill:            true,
            }]
        },
        {
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => formatAmount(ctx.raw) + " ₺" } }
            },
            scales: { y: { ticks: { callback: val => formatAmount(val) + " ₺" } } }
        }
    );
}

// ── 2. BASKET COMPARISON ──────────────────────────────────────────────────────
function renderBasketComparisonChart(orders) {
    makeChart("bar", "basketComparisonChart", "📊 DMO vs İnokas Sepet", "bar",
        {
            labels: orders.map(o => o.sales_order_no),
            datasets: [
                {
                    label:           "DMO Sepet",
                    data:            orders.map(o => o.dmo_basket_total || 0),
                    backgroundColor: "rgba(37,99,235,0.7)",
                    borderRadius:    4,
                },
                {
                    label:           "İnokas Sepet",
                    data:            orders.map(o => o.inokas_basket_total || 0),
                    backgroundColor: "rgba(22,163,74,0.7)",
                    borderRadius:    4,
                }
            ]
        },
        {
            plugins: {
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatAmount(ctx.raw)} ₺` } }
            },
            scales: { y: { ticks: { callback: val => formatAmount(val) + " ₺" } } }
        }
    );
}

// ── 3. TOP CUSTOMERS ──────────────────────────────────────────────────────────
function renderTopCustomersChart(orders) {
    const customers = {};
    orders.forEach(o => {
        const name = o.customer_name || "Bilinmeyen";
        if (!customers[name]) customers[name] = 0;
        customers[name] += o.dmo_basket_total || 0;
    });

    const sorted = Object.entries(customers).sort((a, b) => b[1] - a[1]).slice(0, 5);

    makeChart("topCustomers", "topCustomersChart", "🏢 En Çok Sipariş Veren Müşteriler", "bar",
        {
            labels: sorted.map(([name]) => name),
            datasets: [{
                data:            sorted.map(([, val]) => val),
                backgroundColor: "rgba(37,99,235,0.7)",
                borderRadius:    4,
            }]
        },
        {
            indexAxis: "y",
            plugins:   { legend: { display: false } },
            scales:    { x: { ticks: { callback: val => formatAmount(val) + " ₺" } } }
        }
    );
}

// ── 4. TOP PRODUCTS ───────────────────────────────────────────────────────────
async function renderTopProductsChart(orders) {
    const el = document.getElementById("topProductsChart");
    if (!el || orders.length === 0) return;

    const orderIds = orders.map(o => o.id);
    const { data: items } = await db
        .from("dmo_order_items")
        .select("quantity, products(product_name)")
        .in("order_id", orderIds);

    if (!items) return;

    const products = {};
    items.forEach(i => {
        const name = i.products?.product_name || "Bilinmeyen";
        if (!products[name]) products[name] = 0;
        products[name] += i.quantity || 0;
    });

    const sorted = Object.entries(products).sort((a, b) => b[1] - a[1]).slice(0, 5);

    makeChart("topProducts", "topProductsChart", "📦 En Çok Sipariş Edilen Ürünler", "bar",
        {
            labels: sorted.map(([name]) => name),
            datasets: [{
                data:            sorted.map(([, val]) => val),
                backgroundColor: "rgba(22,163,74,0.7)",
                borderRadius:    4,
            }]
        },
        {
            indexAxis: "y",
            plugins:   { legend: { display: false } },
            scales:    { x: { ticks: { callback: val => val + " adet" } } }
        }
    );
}

// ── 5. CUSTOMER PRODUCT MIX ───────────────────────────────────────────────────
async function renderCustomerProductMixChart(orders) {
    const el = document.getElementById("customerProductMixChart");
    if (!el || orders.length === 0) return;

    const orderIds = orders.map(o => o.id);
    const { data: items } = await db
        .from("dmo_order_items")
        .select("line_total_excl_vat, products(product_name)")
        .in("order_id", orderIds);

    if (!items) return;

    const products = {};
    items.forEach(i => {
        const name = i.products?.product_name || "Bilinmeyen";
        if (!products[name]) products[name] = 0;
        products[name] += i.line_total_excl_vat || 0;
    });

    const colors = ["#2563eb","#16a34a","#dc2626","#d97706","#7c3aed","#0891b2","#db2777","#65a30d"];
    const labels = Object.keys(products);

    makeChart("customerProductMix", "customerProductMixChart", "🥧 Ürün Dağılımı", "doughnut",
        {
            labels,
            datasets: [{
                data:            Object.values(products),
                backgroundColor: colors.slice(0, labels.length),
                borderWidth:     2,
                borderColor:     "#ffffff"
            }]
        },
        {
            plugins: {
                legend:  { position: "bottom", labels: { font: { size: 11 } } },
                tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatAmount(ctx.raw)} ₺` } }
            }
        }
    );
}

// ── 6. CUSTOMER ORDER FREQUENCY ───────────────────────────────────────────────
function renderCustomerOrderFrequencyChart(orders) {
    const monthly = {};
    orders.forEach(o => {
        const month = o.order_date?.slice(0, 7);
        if (!month) return;
        if (!monthly[month]) monthly[month] = 0;
        monthly[month]++;
    });

    const labels = Object.keys(monthly).map(m => {
        const [y, mo] = m.split("-");
        return `${mo}/${y}`;
    });

    makeChart("orderFrequency", "customerOrderFrequencyChart", "📅 Sipariş Sıklığı", "bar",
        {
            labels,
            datasets: [{
                label:           "Sipariş Sayısı",
                data:            Object.values(monthly),
                backgroundColor: "rgba(124,58,237,0.7)",
                borderRadius:    4,
            }]
        },
        {
            plugins: { legend: { display: false } },
            scales:  { y: { ticks: { stepSize: 1 } } }
        }
    );
}

// ── 7. PRODUCT CUSTOMER CHART ─────────────────────────────────────────────────
async function renderProductCustomerChart(orders) {
    const el = document.getElementById("productCustomerChart");
    if (!el || orders.length === 0) return;

    const orderIds = orders.map(o => o.id);
    const { data: items } = await db
        .from("dmo_order_items")
        .select("quantity, order_id")
        .in("order_id", orderIds);

    if (!items) return;

    const customerQty = {};
    items.forEach(i => {
        const order = orders.find(o => o.id === i.order_id);
        const name  = order?.customer_name || "Bilinmeyen";
        if (!customerQty[name]) customerQty[name] = 0;
        customerQty[name] += i.quantity || 0;
    });

    const sorted = Object.entries(customerQty).sort((a, b) => b[1] - a[1]);
    const colors = ["#2563eb","#16a34a","#dc2626","#d97706","#7c3aed"];

    makeChart("productCustomer", "productCustomerChart", "🏢 Bu Ürünü En Çok Kim Aldı", "doughnut",
        {
            labels: sorted.map(([name]) => name),
            datasets: [{
                data:            sorted.map(([, val]) => val),
                backgroundColor: colors.slice(0, sorted.length),
                borderWidth:     2,
                borderColor:     "#ffffff"
            }]
        },
        {
            plugins: {
                legend:  { position: "bottom" },
                tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} adet` } }
            }
        }
    );
}

// ── 8. PRODUCT QUANTITY TREND ─────────────────────────────────────────────────
async function renderProductQuantityTrendChart(orders) {
    const el = document.getElementById("productQuantityTrendChart");
    if (!el || orders.length === 0) return;

    const orderIds = orders.map(o => o.id);
    const { data: items } = await db
        .from("dmo_order_items")
        .select("quantity, order_id")
        .in("order_id", orderIds);

    if (!items) return;

    const monthly = {};
    items.forEach(i => {
        const order = orders.find(o => o.id === i.order_id);
        const month = order?.order_date?.slice(0, 7);
        if (!month) return;
        if (!monthly[month]) monthly[month] = 0;
        monthly[month] += i.quantity || 0;
    });

    const labels = Object.keys(monthly).map(m => {
        const [y, mo] = m.split("-");
        return `${mo}/${y}`;
    });

    makeChart("productQuantityTrend", "productQuantityTrendChart", "📦 Miktar Trendi", "line",
        {
            labels,
            datasets: [{
                label:           "Toplam Adet",
                data:            Object.values(monthly),
                borderColor:     "#16a34a",
                backgroundColor: "rgba(22,163,74,0.08)",
                borderWidth:     2,
                pointRadius:     4,
                tension:         0.3,
                fill:            true,
            }]
        },
        {
            plugins: { legend: { display: false } },
            scales:  { y: { ticks: { callback: val => val + " adet" } } }
        }
    );
}

// ── 9. MARGIN TREND ───────────────────────────────────────────────────────────
function renderMarginTrendChart(orders) {
    const sorted = [...orders].sort((a, b) => new Date(a.order_date) - new Date(b.order_date));

    makeChart("marginTrend", "marginTrendChart", "💰 Kar Marjı Trendi", "line",
        {
            labels: sorted.map(o => formatDate(o.order_date)),
            datasets: [{
                label:           "Kar %",
                data:            sorted.map(o => o.profit_percentage || 0),
                borderColor:     "#d97706",
                backgroundColor: "rgba(217,119,6,0.08)",
                borderWidth:     2,
                pointRadius:     4,
                tension:         0.3,
                fill:            true,
            }]
        },
        {
            plugins: { legend: { display: false } },
            scales:  { y: { ticks: { callback: val => val.toFixed(1) + "%" } } }
        }
    );
}

// ── CHART MODAL ───────────────────────────────────────────────────────────────
function openChartModal(chartId) {
    const stored = chartDataStore[chartId];
    if (!stored) return;

    let modal = document.getElementById("chartExpandModal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id        = "chartExpandModal";
        modal.className = "chart-modal-overlay";
        modal.innerHTML = `
            <div class="chart-modal-box">
                <div class="chart-modal-header">
                    <h3 id="chartModalTitle"></h3>
                    <button onclick="closeChartModal()" class="chart-modal-close">✕</button>
                </div>
                <div class="chart-modal-body">
                    <canvas id="chartModalCanvas"></canvas>
                </div>
            </div>
        `;
        modal.addEventListener("click", e => {
            if (e.target === modal) closeChartModal();
        });
        document.body.appendChild(modal);
    }

    document.getElementById("chartModalTitle").textContent = stored.title;
    modal.style.display = "flex";

    if (chartModalInstance) {
        chartModalInstance.destroy();
        chartModalInstance = null;
    }

    const canvas = document.getElementById("chartModalCanvas");
    chartModalInstance = new Chart(canvas, {
        type:    stored.type,
        data:    stored.data,
        options: stored.options,
    });
}

function closeChartModal() {
    const modal = document.getElementById("chartExpandModal");
    if (modal) modal.style.display = "none";
    if (chartModalInstance) {
        chartModalInstance.destroy();
        chartModalInstance = null;
    }
}