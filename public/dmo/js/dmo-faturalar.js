/* ============================================================================
   DMO FATURALAR — invoices WHERE dmo_invoice = true
   Data comes straight from Supabase (RLS scopes the tenant, same as dmo_orders).
   Fetched once into a cache; all filtering/KPIs run client-side over that cache.
   Depends on: dmo-core.js (formatAmount, formatDate, showToast),
               dmo-shell.js (filterState, escapeHtml, compactTRY, applyFilters hook).
   ========================================================================== */

let _allDmoInvoices = [];   // full cache (dmo_invoice = true)
let _filtered       = [];   // current filtered view
let _openTabs       = [];   // [{ id, no }]  opened invoice tabs
let _activeInvoiceId = null;

/* ── INIT ──────────────────────────────────────────────────────────────── */
async function initFaturalar() {
    await loadDmoInvoices();
}

async function loadDmoInvoices() {
    const tbody = document.getElementById("faturalar-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="padding:24px 16px;color:var(--fat-muted);font-size:13px;">Yükleniyor…</td></tr>`;

    try {
        const res  = await fetch("/api/dmo/invoices");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        _allDmoInvoices = (data || []).map(inv => { inv._firma = pickCompanyName(inv); return inv; });
    } catch (err) {
        console.error("DMO faturalar yüklenemedi:", err.message);
        showToast("Faturalar yüklenemedi", "error");
        _allDmoInvoices = [];
    }
    applyFilters();
}

/* Company display name (companies.name via the embedded join) */
function pickCompanyName(inv) {
    return inv.companies?.name || "—";
}

/* Company names for the Firma filter dropdown (consumed by dmo-shell.js) */
function getKnownCompanyNames() {
    return [...new Set(_allDmoInvoices.map(i => i._firma).filter(n => n && n !== "—"))]
        .sort((a, b) => a.localeCompare(b, "tr-TR"));
}

/* ============================================================================
   FILTERING  (client-side over the cache)
   ========================================================================== */
function applyFilters() {
    const f  = filterState;
    const ci = s => String(s ?? "").toLocaleLowerCase("tr-TR");

    _filtered = _allDmoInvoices.filter(inv => {
        /* Fatura No chips (any match) */
        if (f.invoiceNos.length &&
            !f.invoiceNos.some(q => ci(inv.invoice_no).includes(ci(q)))) return false;

        /* Firma chips (any match) */
        if (f.companies.length &&
            !f.companies.some(q => ci(inv._firma).includes(ci(q)))) return false;

        /* Date range */
        if (f.dateStart && inv.invoice_date < f.dateStart) return false;
        if (f.dateEnd   && inv.invoice_date > f.dateEnd)   return false;

        /* Amount range (payable_amount_tl) */
        const amt = Number(inv.payable_amount_tl) || 0;
        if (amt < (f.minBasket || 0))                return false;
        if (f.maxBasket !== Infinity && amt > f.maxBasket) return false;

        /* Status (Partial derived from paid_amount) */
        if (f.status) {
            const paid = Number(inv.paid_amount) || 0;
            if (f.status === "Partial") {
                if (!(paid > 0 && paid < amt)) return false;
            } else if (inv.status !== f.status) return false;
        }

        /* Category / Source */
        if (f.category && ci(inv.invoice_category) !== ci(f.category)) return false;
        if (f.source   && inv.source !== f.source)                     return false;

        return true;
    });

    renderFaturalarList(_filtered);
    renderKpis(_filtered);
}

/* ============================================================================
   LIST
   ========================================================================== */
function renderFaturalarList(rows) {
    const tbody = document.getElementById("faturalar-tbody");
    const empty = document.getElementById("faturalar-empty");
    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = "";
        if (empty) empty.style.display = "block";
        return;
    }
    if (empty) empty.style.display = "none";

    tbody.innerHTML = rows.map(inv => `
        <tr class="${inv.id === _activeInvoiceId ? "active-row" : ""}" onclick="openInvoiceDetail('${inv.id}')">
          <td class="dmo-td-no">${escapeHtml(inv.invoice_no || "—")}</td>
          <td class="dmo-td-order-no">${escapeHtml(inv.dmo_order_no || "—")}</td>
          <td class="dmo-td-firma">${escapeHtml(inv._firma)}</td>
          <td class="dmo-td-date">${formatDate(inv.invoice_date)}</td>
          <td class="dmo-td-amount">${formatAmount(inv.payable_amount_tl)} ₺</td>
        </tr>`).join("");
}

/* ============================================================================
   KPIs — values from filtered set; trend badges = this month vs last month
           across the FULL dmo set (a stable trend indicator).
   ========================================================================== */
function renderKpis(rows) {
    const count     = rows.length;
    const companies = new Set(rows.map(r => r._firma).filter(n => n && n !== "—")).size;
    const totalTRY  = rows.reduce((s, r) => s + (Number(r.payable_amount_tl) || 0), 0);

    const r = getCurrentRates();
    // const usd = r.usd_try ? totalTRY / r.usd_try : 0;
    //const eur = r.eur_try ? totalTRY / r.eur_try : 0;

    setText("kpi-count",     count.toLocaleString("tr-TR"));
    setText("kpi-companies", companies.toLocaleString("tr-TR"));
    setText("kpi-total-try", compactTRY(totalTRY));
}


/* ============================================================================
   INVOICE TABS  ("Faturalar" line)
   ========================================================================== */
function renderInvoiceTabs() {
    const wrap = document.getElementById("invoice-tabs");
    if (!wrap) return;
    wrap.innerHTML = _openTabs.map(t => `
        <div class="dmo-invtab ${t.id === _activeInvoiceId ? "active" : ""}" onclick="focusInvoiceTab('${t.id}')">
          <span class="dmo-invtab-no">…${escapeHtml(String(t.no).slice(-4))}</span>
          <i class="ti ti-x dmo-invtab-close" onclick="event.stopPropagation();closeInvoiceTab('${t.id}')"></i>
        </div>`).join("");
}

function focusInvoiceTab(id) { openInvoiceDetail(id); }

function closeInvoiceTab(id) {
    _openTabs = _openTabs.filter(t => t.id !== id);
    if (_activeInvoiceId === id) closeInvoiceDetail();
    renderInvoiceTabs();
}

/* ============================================================================
   DETAIL  (swaps in over the list)
   ========================================================================== */
function openInvoiceDetail(id) {
    window.location.href = "/faturalar/pages/fatura-detay.html?id=" + encodeURIComponent(id) + "&from=dmo";
}

function closeInvoiceDetail() {
    _activeInvoiceId = null;
    document.getElementById("invoice-detail").classList.remove("open");
    const lw = document.getElementById("faturalar-list-wrap");
    if (lw) lw.style.display = "";
    renderInvoiceTabs();
    renderFaturalarList(_filtered);
}


/* ── Line items (lazy per invoice) ─────────────────────────────────────── */
let _itemsCache = {};

async function loadInvoiceItems(invoiceId) {
    const host = document.getElementById("invoice-detail-items");
    if (!host) return;

    if (_itemsCache[invoiceId]) { host.innerHTML = renderItemsTable(_itemsCache[invoiceId]); return; }

    let data;
    try {
        const res = await fetch(`/api/dmo/invoices/${invoiceId}/items`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        data = await res.json();
    } catch (err) {
        console.error("Kalemler yüklenemedi:", err.message);
        host.innerHTML = `<div class="dmo-items-empty">Kalemler yüklenemedi</div>`;
        return;
    }
    _itemsCache[invoiceId] = data || [];
    /* guard: user may have switched invoices before this resolved */
    if (_activeInvoiceId === invoiceId) host.innerHTML = renderItemsTable(_itemsCache[invoiceId]);
}

function renderItemsTable(items) {
    if (!items.length) return `<div class="dmo-items-empty">Kalem bulunamadı</div>`;
    const sym = c => ({ TRY: "₺", USD: "$", EUR: "€" }[c] || c || "");
    const qty = q => Number(q ?? 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });

    return `
      <table class="dmo-items">
        <thead><tr>
          <th>Ürün</th><th>Marka</th>
          <th class="num">Miktar</th><th class="num">Birim Fiyat</th><th class="num">Tutar</th>
        </tr></thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>
                <div class="dmo-item-name">${escapeHtml(it.product_name || "—")}</div>
                ${(it.product_code || it.dmo_code)
                    ? `<div class="dmo-item-code dmo-mono">${escapeHtml(it.product_code || it.dmo_code)}</div>` : ""}
              </td>
              <td>${escapeHtml(it.brand_name || "—")}</td>
              <td class="num dmo-mono">${qty(it.quantity)}${it.unit_code ? ` <span class="dmo-item-unit">${escapeHtml(it.unit_code)}</span>` : ""}</td>
              <td class="num dmo-mono">${formatAmount(it.unit_price_cur)} ${sym(it.currency)}</td>
              <td class="num dmo-mono">${formatAmount(it.total_price_cur)} ${sym(it.currency)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
}

/* Context handed to the AI rail (dmo-shell.js reads this) */
function getFaturalarAiContext() {
    return {
        visible_count: _filtered.length,
        total_count:   _allDmoInvoices.length,
        filters: {
            invoiceNos: filterState.invoiceNos,
            companies:  filterState.companies,
            dateStart:  filterState.dateStart,
            dateEnd:    filterState.dateEnd,
            status:     filterState.status,
            category:   filterState.category,
            source:     filterState.source,
        },
    };
}

/* ── helpers ───────────────────────────────────────────────────────────── */
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function compactCur(n, sym) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e6) return sym + (n / 1e6).toFixed(1) + "M";
    if (Math.abs(n) >= 1e3) return sym + Math.round(n / 1e3) + "K";
    return sym + Math.round(n);
}