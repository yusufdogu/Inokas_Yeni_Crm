// ── FILTER FUNCTIONS ──────────────────────────────────────────────────────────
function readFilters() {
    filterState.dateStart = document.getElementById("filterDateStart")?.value || "";
    filterState.dateEnd   = document.getElementById("filterDateEnd")?.value   || "";
    filterState.status    = document.getElementById("filterStatus")?.value    || "";
    filterState.category  = document.getElementById("filterCategory")?.value  || "";
    filterState.minBasket = parseInt(document.getElementById("basketMin")?.value) || 0;
    filterState.maxBasket = parseInt(document.getElementById("basketMax")?.value) || 3000000;
}

function getActiveFilters() {
    return {
        hasCompany: filterState.companies.length > 0,
        hasProduct: filterState.products.length > 0,
        hasDateRange: !!(filterState.dateStart && filterState.dateEnd),
    };
}


function addTag(type, value, label) {
    if (!value) return;
    const key = type === "company" ? "companies" : type === "product" ? "products" : "brands";
    const arr = filterState[key];
    if (!arr) return;
    if (arr.includes(value)) return;
    arr.push(value);
    renderTags(type);
    // Clear input
    const inputId = type === "company" ? "mainSearch" : type === "brand" ? "brandSearch" : "filterProduct";
    const input = document.getElementById(inputId);
    if (input) input.value = "";
    // Hide dropdown
    const dropId = type === "company" ? "companyDropdown" : type === "brand" ? "brandDropdown" : "productDropdown";
    const drop = document.getElementById(dropId);
    if (drop) drop.style.display = "none";
}

function removeTag(type, value) {
    const key = type === "company" ? "companies" : type === "product" ? "products" : "brands";
    filterState[key] = filterState[key].filter(v => v !== value);
    renderTags(type);
}

function renderTags(type) {
    const key = type === "company" ? "companies" : type === "product" ? "products" : "brands";
    const containerId = type === "company" ? "companyTags" : type === "brand" ? "brandTags" : "productTags";
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = filterState[key].map(v => `
        <span class="filter-tag">
            ${v}
            <button onclick="removeTag('${type}', '${v.replace(/'/g, "\\'")}')" type="button">✕</button>
        </span>
    `).join("");
}

function handleTagKeydown(event, type) {
    if (event.key === "Backspace") {
        const key = type === "brand" ? "brands" : type + "s";
        const input = event.target;
        if (input.value === "" && filterState[key].length > 0) {
            filterState[key].pop();
            renderTags(type);
        }
    }
}

function updateBasketRange() {
    let min = parseInt(document.getElementById("basketMin")?.value) || 0;
    let max = parseInt(document.getElementById("basketMax")?.value) || 3000000;
    if (min > max) { const t = min; min = max; max = t; }
    const label = document.getElementById("basketRangeLabel");
    if (label) label.textContent = `${min.toLocaleString("tr-TR")} — ${max.toLocaleString("tr-TR")} ₺`;
    filterState.minBasket = min;
    filterState.maxBasket = max;
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

function applyFilters() {
    readFilters();
    renderCurrentView();
}

function clearAllFilters() {
    filterState.companies = [];
    filterState.products  = [];
    filterState.brands    = [];
    filterState.dateStart = "";
    filterState.dateEnd   = "";
    filterState.status    = "";
    filterState.category  = "";
    filterState.minBasket = 0;
    filterState.maxBasket = 3000000;

    ["mainSearch", "filterProduct", "brandSearch"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    ["filterStatus", "filterCategory"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    const bMin = document.getElementById("basketMin");
    const bMax = document.getElementById("basketMax");
    if (bMin) bMin.value = "0";
    if (bMax) bMax.value = "3000000";
    updateBasketRange();

    renderTags("company");
    renderTags("product");
    renderTags("brand");
    updateAdvancedBadge();
    renderCurrentView();
}
// ── AUTOCOMPLETE ──────────────────────────────────────────────────────────────
function handleMainSearch() {
    const val      = document.getElementById("mainSearch")?.value.toLocaleLowerCase("tr-TR") || "";
    const dropdown = document.getElementById("companyDropdown");
    if (val.length < 1) { dropdown.style.display = "none"; return; }

    const allCompanies = Array.from(
        document.querySelectorAll("#filterCompany option")
    ).map(o => o.value).filter(Boolean);

    const matches = allCompanies.filter(c =>
        c.toLocaleLowerCase("tr-TR").includes(val) && !filterState.companies.includes(c)
    ).slice(0, 8);

    if (matches.length > 0) {
        dropdown.style.display = "block";
        dropdown.innerHTML = matches.map(c => `
            <div class="filter-dropdown-item" onclick="addTag('company', '${c.replace(/'/g, "\\'")}', '${c.replace(/'/g, "\\'")}')">
                <i class="ti ti-building" style="font-size:12px; margin-right:6px; color:#64748b;" aria-hidden="true"></i>${c}
            </div>
        `).join("");
    } else {
        dropdown.style.display = "none";
    }
}

function handleProductSearch() {
    const val      = document.getElementById("filterProduct")?.value.toLocaleLowerCase("tr-TR") || "";
    const dropdown = document.getElementById("productDropdown");
    if (val.length < 2) { dropdown.style.display = "none"; return; }

    const matches = (window._siparislerProducts || []).filter(p =>
        (p.product_name?.toLocaleLowerCase("tr-TR").includes(val) ||
         p.dmo_code?.toString().includes(val)) &&
        !filterState.products.includes(p.product_code)
    ).slice(0, 8);

    if (matches.length > 0) {
        dropdown.style.display = "block";
        dropdown.innerHTML = matches.map(p => `
            <div class="filter-dropdown-item" onclick="addTag('product', '${p.product_code}', '${(p.product_name || "").replace(/'/g, "\\'")}')">
                <span style="color:#2563eb; font-size:11px; margin-right:6px;">${p.dmo_code}</span>${p.product_name}
            </div>
        `).join("");
    } else {
        dropdown.style.display = "none";
    }
}

async function handleBrandSearch() {
    const val      = document.getElementById("brandSearch")?.value.toLocaleLowerCase("tr-TR") || "";
    const dropdown = document.getElementById("brandDropdown");
    if (val.length < 1) { dropdown.style.display = "none"; return; }

    const { data: brands } = await db
        .from("products")
        .select("brand")
        .not("brand", "is", null)
        .ilike("brand", `%${val}%`)
        .limit(10);

    const unique = [...new Set((brands || []).map(b => b.brand))].filter(b => !filterState.brands.includes(b));

    if (unique.length > 0) {
        dropdown.style.display = "block";
        dropdown.innerHTML = unique.map(b => `
            <div class="filter-dropdown-item" onclick="addTag('brand', '${b.replace(/'/g, "\\'")}', '${b.replace(/'/g, "\\'")}')">
                <i class="ti ti-tag" style="font-size:12px; margin-right:6px; color:#64748b;" aria-hidden="true"></i>${b}
            </div>
        `).join("");
    } else {
        dropdown.style.display = "none";
    }
}


async function populateCategoryFilter() {
    const select = document.getElementById('filterCategory');
    if (!select || select.dataset.loaded) return;

    const { data, error } = await db
        .from('products')
        .select('category')
        .not('category', 'is', null);

    if (error || !data) return;

    const unique = [...new Set(data.map(p => p.category).filter(Boolean))].sort();
    unique.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat.charAt(0) + cat.slice(1).toLowerCase();
        select.appendChild(opt);
    });

    select.dataset.loaded = "true";
}

// Close dropdowns when clicking outside
document.addEventListener("click", (e) => {
    if (!e.target.closest("#mainSearch") && !e.target.closest("#companyDropdown") && !e.target.closest("#companyTagsWrap")) {
        const d = document.getElementById("companyDropdown");
        if (d) d.style.display = "none";
    }
    if (!e.target.closest("#filterProduct") && !e.target.closest("#productDropdown") && !e.target.closest("#productTagsWrap")) {
        const d = document.getElementById("productDropdown");
        if (d) d.style.display = "none";
    }
    if (!e.target.closest("#brandSearch") && !e.target.closest("#brandDropdown") && !e.target.closest("#brandTagsWrap")) {
        const d = document.getElementById("brandDropdown");
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
    if (filterState.companies.length > 0) {
        query = query.or(filterState.companies.map(c => `customer_name.ilike.%${c}%`).join(","));
    }
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

    // Brand filter
    if (filterState.brands.length > 0) {
        const { data: brandProducts } = await db
            .from("products")
            .select("id")
            .in("brand", filterState.brands);

        const brandIds = brandProducts?.map(p => p.id) || [];
        if (brandIds.length > 0) {
            const { data: brandItems } = await db
                .from("dmo_order_items")
                .select("order_id")
                .in("product_id", brandIds);
            const brandOrderIds = new Set(brandItems?.map(i => i.order_id) || []);
            filteredOrders = filteredOrders.filter(o => brandOrderIds.has(o.id));
        } else {
            filteredOrders = [];
        }
    }

    // Products filter — now uses array
    if (filterState.products.length > 0) {
        const { data: matchingProducts } = await db
            .from("products")
            .select("id")
            .in("product_code", filterState.products);

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

    // Basket range filter
    if (filterState.minBasket > 0)       filteredOrders = filteredOrders.filter(o => (o.dmo_basket_total || 0) >= filterState.minBasket);
    if (filterState.maxBasket < 3000000) filteredOrders = filteredOrders.filter(o => (o.dmo_basket_total || 0) <= filterState.maxBasket);

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
                onclick="window.location.href='/dmo/pages/invoice.pages?id=${order.id}'"
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

    const dateStart = document.getElementById("filterDateStart");
    const dateEnd   = document.getElementById("filterDateEnd");
    if (dateStart) dateStart.value = "2026-01-01";
    if (dateEnd)   dateEnd.value   = new Date().toISOString().slice(0, 10);

    // Load products for search
    const { data: products } = await db
        .from("products")
        .select("id, product_code, product_name, dmo_code, brand")
        .not("dmo_code", "is", null);
    window._siparislerProducts = products || [];

    // Load categories once
    await populateCategoryFilter();

    await renderCurrentView();
});