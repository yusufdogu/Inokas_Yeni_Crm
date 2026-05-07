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
    populateCompanyFilter(orders);
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
    const container = document.getElementById("invoiceCardsContainer");
    container.innerHTML = "";

    if (orders.length === 0) {
        container.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; padding:40px; color:#94a3b8;">
                Sipariş bulunamadı
            </div>`;
        return;
    }

    const statusColors = {
        "Taslak":         { bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" },
        "Sipariş Alındı": { bg: "#eff6ff", color: "#2563eb", border: "#bfdbfe" },
        "Tamamlandı":     { bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0" },
        "İptal":          { bg: "#fef2f2", color: "#dc2626", border: "#fecaca" },
    };

    orders.forEach(order => {
        const profitColor = order.net_profit >= 0 ? "#16a34a" : "#dc2626";
        const status      = order.status || "Taslak";
        const sc          = statusColors[status] || statusColors["Taslak"];

        const card = document.createElement("div");
        card.className = "invoice-card";
        card.onclick   = () => window.location.href = `/dmo/pages/invoice.html?id=${order.id}`;
        card.innerHTML = `
            <div class="invoice-card-header">
                <span class="invoice-card-no">#${order.sales_order_no || "Taslak"}</span>
                <span class="invoice-card-date">${formatDate(order.order_date)}</span>
            </div>
            <div class="invoice-card-customer">${order.customer_name || "-"}</div>
            <div style="margin-bottom:8px;">
                <span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:99px; background:${sc.bg}; color:${sc.color}; border:1px solid ${sc.border};">
                    ${status}
                </span>
            </div>
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

// ── PAGE INIT ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    if (!document.getElementById("invoiceCardsContainer")) return;

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