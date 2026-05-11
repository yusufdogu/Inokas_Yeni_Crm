// ── FILTER FUNCTIONS ──────────────────────────────────────────────────────────
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

function toggleAdvancedFilters() {
    const panel   = document.getElementById("advancedFiltersPanel");
    const btnText = document.getElementById("advancedFiltersBtnText");
    const isOpen  = panel.style.display !== "none";
    panel.style.display = isOpen ? "none" : "block";
    btnText.textContent = isOpen ? "▾ Gelişmiş Filtreler" : "▴ Gelişmiş Filtreler";
}

function updateAdvancedBadge() {
    const badge     = document.getElementById("advancedFiltersBadge");
    const status    = document.getElementById("filterStatus")?.value;
    const category  = document.getElementById("filterCategory")?.value;
    const dateStart = document.getElementById("filterDateStart")?.value;
    const dateEnd   = document.getElementById("filterDateEnd")?.value;
    const hasActive = status || category || dateStart || dateEnd;
    if (badge) badge.style.display = hasActive ? "inline-block" : "none";
}

function clearAllFilters() {
    const fields = ["filterStatus", "filterCategory", "filterDateStart", "filterDateEnd",
                    "filterMinBasket", "filterMaxBasket", "mainSearch", "filterProduct"];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    filterState.search    = "";
    filterState.company   = "";
    filterState.product   = "";
    filterState.dateStart = "";
    filterState.dateEnd   = "";
    filterState.status    = "";
    filterState.category  = "";
    filterState.minBasket = null;
    filterState.maxBasket = null;
    document.getElementById('filterMinBasket').value = '';
    document.getElementById('filterMaxBasket').value = '';
    document.getElementById('basketSlider')?.noUiSlider?.set([0, 3000000]);
    renderCurrentView();
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
    document.getElementById("mainSearch").value              = company;
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

    const matches = (window.hhProducts || []).filter(p =>
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

async function populateCategoryFilter() {
    const { data, error } = await db
        .from('products')
        .select('category')
        .not('category', 'is', null);

    if (error || !data) return;

    const unique = [...new Set(data.map(p => p.category).filter(Boolean))].sort();
    const select = document.getElementById('filterCategory');

    unique.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat.charAt(0) + cat.slice(1).toLowerCase(); // KARTUŞ → Kartuş
        select.appendChild(opt);
    });
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

// ── RENDER CURRENT VIEW ───────────────────────────────────────────────────────
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

    // Product filter
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
    if (filterState.minBasket) filteredOrders = filteredOrders.filter(o => o.dmo_basket_total >= filterState.minBasket);
    if (filterState.maxBasket) filteredOrders = filteredOrders.filter(o => o.dmo_basket_total <= filterState.maxBasket);

    await renderTable(filteredOrders);
    await loadCharts(filteredOrders);
    await populateCategoryFilter();
    initBasketSlider()
    populateCompanyFilter(orders);
}


function initBasketSlider() {
    const slider = document.getElementById('basketSlider');
    if (!slider || slider.noUiSlider) return;

    noUiSlider.create(slider, {
        start:   [0, 3000000],
        connect: true,
        range:   { min: 0, max: 3000000 },
        step:    1000,
        tooltips: false,
    });

    slider.noUiSlider.on('update', (values) => {
        const min = Math.round(values[0]);
        const max = Math.round(values[1]);

        document.getElementById('sliderMinLabel').textContent = formatAmount(min) + ' ₺';
        document.getElementById('sliderMaxLabel').textContent = formatAmount(max) + ' ₺';

        filterState.minBasket = min > 0       ? min : null;
        filterState.maxBasket = max < 3000000 ? max : null;
    });

    // Only trigger re-render when user stops dragging, not on every pixel
    slider.noUiSlider.on('change', () => {
        renderCurrentView();
        updateAdvancedBadge();
    });
}
// ── POPULATE COMPANY FILTER ───────────────────────────────────────────────────
function populateCompanyFilter(orders) {
    const select = document.getElementById("filterCompany");
    if (!select) return;
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

// ── RENDER INVOICE CARDS ──────────────────────────────────────────────────────
async function renderTable(orders) {
    const tbody = document.getElementById("sp-tbody");
    const empty = document.getElementById("sp-empty");
    if (!tbody) return;

    window._lastFilteredOrders = orders;

    // Update KPIs
    const totalDMO    = orders.reduce((s, o) => s + (o.dmo_basket_total || 0), 0);
    const totalProfit = orders.reduce((s, o) => s + (o.net_profit       || 0), 0);
    const kpiTotal    = document.getElementById("kpi-total");
    const kpiAmount   = document.getElementById("kpi-amount");
    const kpiProfit   = document.getElementById("kpi-profit");
    if (kpiTotal)  kpiTotal.textContent  = orders.length;
    if (kpiAmount) kpiAmount.textContent = formatAmount(totalDMO) + " ₺";
    if (kpiProfit) {
        kpiProfit.textContent = formatAmount(totalProfit) + " ₺";
        kpiProfit.style.color = totalProfit >= 0 ? "#16a34a" : "#dc2626";
    }

    // Update header count
    const countEl = document.getElementById("sp-order-count");
    if (countEl) countEl.textContent = orders.length + " sipariş";

    if (orders.length === 0) {
        tbody.innerHTML = "";
        if (empty) empty.style.display = "block";
        return;
    }
    if (empty) empty.style.display = "none";

    const statusColors = {
        "Taslak":         { bg: "#f1f5f9", color: "#64748b" },
        "Sipariş Alındı": { bg: "#dbeafe", color: "#1d4ed8" },
        "Tamamlandı":     { bg: "#dcfce7", color: "#166534" },
        "İptal":          { bg: "#fee2e2", color: "#991b1b" },
    };

    tbody.innerHTML = orders.map(order => {
        const sc          = statusColors[order.status] || statusColors["Taslak"];
        const profitColor = (order.net_profit || 0) >= 0 ? "#16a34a" : "#dc2626";
        return `
            <tr style="border-bottom:1px solid #f1f5f9; cursor:pointer; transition:background 0.1s;"
                onclick="window.location.href='/dmo/pages/invoice.html?id=${order.id}'"
                onmouseover="this.style.background='#f8fafc'"
                onmouseout="this.style.background=''"
            >
                <td style="padding:10px 12px 10px 0; font-weight:600; color:#2563eb; white-space:nowrap;">
                    #${order.sales_order_no || "Taslak"}
                </td>
                <td style="padding:10px 12px 10px 0; color:#0f172a; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    ${order.customer_name || "—"}
                </td>
                <td style="padding:10px 12px 10px 0; color:#94a3b8; white-space:nowrap; font-size:12px;">
                    ${formatDate(order.order_date)}
                </td>
                <td style="padding:10px 12px 10px 0;">
                    <span style="padding:3px 8px; border-radius:99px; font-size:11px; font-weight:600; background:${sc.bg}; color:${sc.color};">
                        ${order.status || "Taslak"}
                    </span>
                </td>
                <td style="padding:10px 0; text-align:right; font-weight:600; color:#0f172a; white-space:nowrap;">
                    ${formatAmount(order.dmo_basket_total)} ₺
                </td>
                <td style="padding:10px 0; text-align:right; font-weight:700; color:${profitColor}; white-space:nowrap;">
                    ${formatAmount(order.net_profit)} ₺
                </td>
            </tr>
        `;
    }).join("");
}
// ── PAGE INIT ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    if (!document.getElementById("sp-tbody") && !document.getElementById("invoiceCardsContainer")) return;

    // Set default date range: last 3 months
    const end   = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    const dateStart = document.getElementById("filterDateStart");
    const dateEnd   = document.getElementById("filterDateEnd");
    if (dateStart) dateStart.value = start.toISOString().slice(0, 10);
    if (dateEnd)   dateEnd.value   = end.toISOString().slice(0, 10);

    await renderCurrentView();
});