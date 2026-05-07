// ── STATE ─────────────────────────────────────────────────────────────────────
let hhProducts  = [];
let hhItems     = {};  // pending (not yet in sepet)
let hhSepet     = {};  // confirmed basket
let hhActiveTab = "urunler";

const LIMIT = 3_000_000;

// ── LOAD DATA ─────────────────────────────────────────────────────────────────
async function loadHHData() {
    const { data: products } = await db
        .from("products")
        .select("id, product_code, product_name, model, stock_on_hand, dmo_code, dmo_fiyat_try, sozlesme_fiyat_eur, maliyet_usd")
        .not("dmo_code", "is", null)
        .order("dmo_code");

    hhProducts = products || [];
    window.hhProducts = hhProducts; // expose for dmo-siparisler.js autocomplete
}

// ── OPEN / CLOSE ──────────────────────────────────────────────────────────────
async function openHizliHesap() {
    document.getElementById("hh_product_grid").innerHTML = `
        <div style="text-align:center; padding:40px; color:#94a3b8;">
            Ürünler yükleniyor...
        </div>`;

    await loadHHData();
    renderHHProductTable();
    recalcHizliHesap();
}

function closeHizliHesap() {
    hhItems            = {};
    hhSepet            = {};
    hhActiveTab        = "urunler";
    _hhEditingTaslakId = null;

    const customerEl = document.getElementById("hh_customer_name");
    const searchEl   = document.getElementById("hh_search");
    const gridEl     = document.getElementById("hh_product_grid");
    if (customerEl) customerEl.value = "";
    if (searchEl)   searchEl.value   = "";
    if (gridEl)     gridEl.innerHTML = "";

    const saveBtn = document.querySelector(".btn-primary[onclick='saveHizliHesapAsTaslak()']");
    if (saveBtn) saveBtn.textContent = "💾 Taslak Kaydet";

    recalcHizliHesap();
}

// ── OPEN FOR TASLAK EDIT ──────────────────────────────────────────────────────
async function openHizliHesapForTaslak(orderId) {
    _hhEditingTaslakId = orderId;

    await openHizliHesap();

    // Pre-fill customer name
    const { data: order } = await db
        .from("dmo_orders")
        .select("customer_name")
        .eq("id", orderId)
        .single();

    if (order?.customer_name) {
        const el = document.getElementById("hh_customer_name");
        if (el) el.value = order.customer_name;
    }

    // Load existing items into hhSepet
    const { data: items } = await db
        .from("dmo_order_items")
        .select("*, products(id, product_name, dmo_code, dmo_fiyat_try, maliyet_usd)")
        .eq("order_id", orderId);

    (items || []).forEach(item => {
        const p    = item.products;
        if (!p?.dmo_code) return;
        const code = p.dmo_code;

        const existing = hhSepet[code] || {
            id:           p.id,
            dmo_code:     code,
            product_name: p.product_name,
            dmo_fiyat_try: p.dmo_fiyat_try || 0,
            maliyet_usd:  p.maliyet_usd    || 0,
            quantity:     0,
            giftQuantity: 0,
        };

        if (item.is_gift) {
            existing.giftQuantity = (existing.giftQuantity || 0) + item.quantity;
        } else {
            existing.quantity = (existing.quantity || 0) + item.quantity;
        }

        hhSepet[code] = existing;
    });

    hhActiveTab = "sepet";
    updateHHTabUI();
    renderHHProductTable();
    recalcHizliHesap();

    // Update save button label
    const saveBtn = document.querySelector(".btn-primary[onclick='saveHizliHesapAsTaslak()']");
    if (saveBtn) saveBtn.textContent = "💾 Taslak Güncelle";
}

// ── PRODUCT GRID ──────────────────────────────────────────────────────────────
function renderHHProductTable() {
    const container = document.getElementById("hh_product_grid");
    const search    = document.getElementById("hh_search")?.value.toLocaleLowerCase("tr-TR") || "";
    const usdRate   = getCurrentRates().usd_try;

    const sepetCount = Object.keys(hhSepet).length;
    const sepetBadge = document.getElementById("hh_tab_sepet_count");
    if (sepetBadge) sepetBadge.textContent = sepetCount > 0 ? ` (${sepetCount})` : "";

    const tableHeader = `
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead>
                <tr style="background:#f1f5f9; color:#64748b; font-weight:700; font-size:11px;">
                    <th style="padding:10px 8px; text-align:left;">DMO KOD</th>
                    <th style="padding:10px 8px; text-align:left;">ÜRÜN</th>
                    <th style="padding:10px 8px; text-align:left;">ÜRÜN KOD</th>
                    <th style="padding:10px 8px; text-align:left;">MODEL</th>
                    <th style="padding:10px 8px; text-align:left;">STOK</th>
                    <th style="padding:10px 8px; text-align:right;">DMO FİYAT</th>
                    <th style="padding:10px 8px; text-align:right;">ALIŞ EUR→TL</th>
                    <th style="padding:10px 8px; text-align:right;">MAL USD→TL</th>
                    <th style="padding:10px 8px; text-align:right;">MARJ %</th>
                    <th style="padding:10px 8px; text-align:center;">ADET</th>
                    <th style="padding:10px 8px; text-align:center;">🎁 ADET</th>
                    <th style="padding:10px 8px; text-align:center;"></th>
                </tr>
            </thead>
            <tbody>`;

    if (hhActiveTab === "urunler") {
        const filtered = hhProducts.filter(p =>
            !hhSepet[p.dmo_code] && (
                p.product_name?.toLocaleLowerCase("tr-TR").includes(search) ||
                p.dmo_code?.toString().includes(search) ||
                p.model?.toLocaleLowerCase("tr-TR").includes(search)
            )
        );

        if (filtered.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:40px; color:#94a3b8;">Ürün bulunamadı</div>`;
            return;
        }

        container.innerHTML = tableHeader + filtered.map(p => renderHHRow(p, usdRate, "urunler")).join("") + `</tbody></table>`;

    } else {
        const filtered = Object.values(hhSepet).filter(p =>
            p.product_name?.toLocaleLowerCase("tr-TR").includes(search) ||
            p.dmo_code?.toString().includes(search) ||
            p.model?.toLocaleLowerCase("tr-TR").includes(search)
        );

        if (filtered.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:40px; color:#94a3b8;">Sepet boş</div>`;
            return;
        }

        container.innerHTML = tableHeader + filtered.map(p => renderHHRow(p, usdRate, "sepet")).join("") + `</tbody></table>`;
    }
}

function renderHHRow(p, usdRate, tab) {
    const dmoFiyat  = parseFloat(p.dmo_fiyat_try      || 0);
    const alisEur   = parseFloat(p.sozlesme_fiyat_eur  || 0);
    const malUsd    = parseFloat(p.maliyet_usd         || 0);
    const realDMO   = dmoFiyat / 1.08;
    const alisTL    = alisEur * getCurrentRates().eur_try;
    const malTL     = malUsd  * usdRate;
    const marj      = realDMO > 0 ? ((realDMO - malTL) / realDMO * 100) : 0;
    const marjColor = marj >= 0 ? "#16a34a" : "#dc2626";

    let qty, giftQty, actionBtn;

    if (tab === "sepet") {
        qty      = hhSepet[p.dmo_code]?.quantity     || 0;
        giftQty  = hhSepet[p.dmo_code]?.giftQuantity || 0;
        actionBtn = `<button onclick="removeFromSepet('${p.dmo_code}')"
            style="padding:4px 10px; background:#fee2e2; color:#dc2626; border:1px solid #fecaca; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">
            Çıkar</button>`;
    } else {
        const item = hhItems[p.dmo_code] || {};
        qty      = item.quantity     || 0;
        giftQty  = item.giftQuantity || 0;
        const hasQty = qty > 0 || giftQty > 0;
        actionBtn = hasQty
            ? `<button onclick="addToSepet('${p.dmo_code}')"
                style="padding:4px 10px; background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">
                Ekle</button>`
            : `<span style="display:inline-block; width:52px;"></span>`;
    }

    const qtyInput      = tab === "sepet" ? `oninput="updateSepetItem('${p.dmo_code}', this.value, 'qty')"` : `oninput="updateHHItem('${p.dmo_code}', this.value, 'qty')"`;
    const giftInput     = tab === "sepet" ? `oninput="updateSepetItem('${p.dmo_code}', this.value, 'gift')"` : `oninput="updateHHItem('${p.dmo_code}', this.value, 'gift')"`;

    return `
        <tr style="border-bottom:1px solid #e2e8f0; background:${tab === "sepet" ? "#f0fdf4" : "white"};">
            <td style="padding:8px; font-weight:700; color:#2563eb;">${p.dmo_code || "-"}</td>
            <td style="padding:8px; color:#0f172a; max-width:200px;"><div style="font-weight:600; line-height:1.3;">${p.product_name || "-"}</div></td>
            <td style="padding:8px; font-weight:700; color:#2563eb;">${p.product_code || "-"}</td>
            <td style="padding:8px; color:#64748b;">${p.model || "-"}</td>
            <td style="padding:8px; color:#64748b;">${p.stock_on_hand || "-"}</td>
            <td style="padding:8px; text-align:right; font-weight:600;">${dmoFiyat > 0 ? `${formatAmount(dmoFiyat)} ₺ → ${formatAmount(realDMO)} ₺` : "-"}</td>
            <td style="padding:8px; text-align:right; color:#64748b;">${alisEur > 0 ? `€${alisEur} → ${formatAmount(alisTL)} ₺` : "-"}</td>
            <td style="padding:8px; text-align:right; color:#64748b;">${malUsd > 0 ? `$${malUsd} → ${formatAmount(malTL)} ₺` : "-"}</td>
            <td style="padding:8px; text-align:right; font-weight:700; color:${marjColor};">${realDMO > 0 ? "%" + marj.toFixed(1) : "-"}</td>
            <td style="padding:8px; text-align:center;">
                <input type="number" min="0" placeholder="0" value="${qty}" ${qtyInput}
                    style="width:60px; padding:4px 6px; border:1px solid #e2e8f0; border-radius:6px; text-align:center; font-size:12px;">
            </td>
            <td style="padding:8px; text-align:center;">
                <input type="number" min="0" placeholder="0" value="${giftQty}" ${giftInput}
                    style="width:60px; padding:4px 6px; border:1px solid #fed7aa; border-radius:6px; text-align:center; font-size:12px; background:#fff7ed;">
            </td>
            
            <td style="padding:8px; text-align:center;">${actionBtn}</td>
        </tr>`;
}

function filterHHProducts() { renderHHProductTable(); }

// ── SEPET ACTIONS ─────────────────────────────────────────────────────────────
function addToSepet(dmoCode) {
    const product = hhProducts.find(p => p.dmo_code == dmoCode);
    if (!product) return;

    const item = hhItems[dmoCode] || {};
    hhSepet[dmoCode] = {
        ...product,
        quantity:     item.quantity     || 0,
        giftQuantity: item.giftQuantity || 0,
    };

    delete hhItems[dmoCode];
    hhActiveTab = "sepet";
    updateHHTabUI();
    renderHHProductTable();
    recalcHizliHesap();
}

function removeFromSepet(dmoCode) {
    if (!hhSepet[dmoCode]) return;

    hhItems[dmoCode] = {
        quantity:     hhSepet[dmoCode].quantity     || 0,
        giftQuantity: hhSepet[dmoCode].giftQuantity || 0,
    };

    if (hhItems[dmoCode].quantity === 0 && hhItems[dmoCode].giftQuantity === 0) {
        delete hhItems[dmoCode];
    }

    delete hhSepet[dmoCode];
    renderHHProductTable();
    recalcHizliHesap();
}

function updateSepetItem(dmoCode, value, col) {
    if (!hhSepet[dmoCode]) return;
    const qty = parseInt(value) || 0;

    if (col === "gift")      hhSepet[dmoCode].giftQuantity = qty;
    if (col === "qty")  hhSepet[dmoCode].quantity     = qty;

    if (hhSepet[dmoCode].quantity === 0 && hhSepet[dmoCode].giftQuantity === 0) {
        removeFromSepet(dmoCode);
        return;
    }

    recalcHizliHesap();
}

function updateHHItem(dmoCode, value, col) {
    const quantity = parseInt(value) || 0;
    const product  = hhProducts.find(p => p.dmo_code == dmoCode);
    if (!product) return;

    if (!hhItems[dmoCode]) {
        hhItems[dmoCode] = {
            dmo_code:           dmoCode,
            product_id:         product.id,
            product_name:       product.product_name,
            dmo_fiyat_try:      product.dmo_fiyat_try,
            sozlesme_fiyat_eur: product.sozlesme_fiyat_eur,
            maliyet_usd:        product.maliyet_usd,
            quantity:           0,
            giftQuantity:       0,
        };
    }

    if (col === "gift")      hhItems[dmoCode].giftQuantity = quantity;
    if (col === "qty")  hhItems[dmoCode].quantity     = quantity;

    if (hhItems[dmoCode].quantity === 0 && hhItems[dmoCode].giftQuantity === 0) {
        delete hhItems[dmoCode];
    }

    // Update Ekle button without full re-render
    const rows = document.querySelectorAll("#hh_product_grid tbody tr");
    rows.forEach(tr => {
        const dmoCell = tr.querySelector("td:first-child");
        if (!dmoCell || dmoCell.textContent.trim() !== String(dmoCode)) return;
        const actionCell = tr.querySelector("td:last-child");
        if (!actionCell) return;
        const item   = hhItems[dmoCode] || {};
        const hasQty = (item.quantity || 0) > 0 || (item.giftQuantity || 0) > 0;
        actionCell.innerHTML = hasQty
            ? `<button onclick="addToSepet('${dmoCode}')" style="padding:4px 10px; background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">Ekle</button>`
            : `<span style="display:inline-block; width:52px;"></span>`;
    });

    recalcHizliHesap();
}

// ── TAB UI ────────────────────────────────────────────────────────────────────
function switchHHTab(tab) {
    hhActiveTab = tab;
    updateHHTabUI();
    renderHHProductTable();
}

function updateHHTabUI() {
    const urunlerBtn = document.getElementById("hh_tab_urunler");
    const sepetBtn   = document.getElementById("hh_tab_sepet");

    if (urunlerBtn) {
        urunlerBtn.style.fontWeight   = hhActiveTab === "urunler" ? "800" : "500";
        urunlerBtn.style.borderBottom = hhActiveTab === "urunler" ? "2px solid #2563eb" : "2px solid transparent";
        urunlerBtn.style.color        = hhActiveTab === "urunler" ? "#2563eb" : "#64748b";
    }
    if (sepetBtn) {
        sepetBtn.style.fontWeight   = hhActiveTab === "sepet" ? "800" : "500";
        sepetBtn.style.borderBottom = hhActiveTab === "sepet" ? "2px solid #2563eb" : "2px solid transparent";
        sepetBtn.style.color        = hhActiveTab === "sepet" ? "#2563eb" : "#64748b";
    }
}
function getTutarIndirimPct(basket) {
    if (basket <= 375000)           return 0;
    if (basket <= 750000)           return 0.01;
    if (basket <= 1125000)          return 0.02;
    if (basket <= 1500000)          return 0.03;
    if (basket <= 1875000)          return 0.04;
    if (basket <= 2250000)          return 0.05;
    if (basket <= 2625000)          return 0.06;
    return                                 0.07;
}
function toggleVergiler() {
    const detail = document.getElementById("vergiler_detail");
    const arrow  = document.getElementById("vergiler_arrow");
    const isOpen = detail.style.display !== "none";
    detail.style.display = isOpen ? "none" : "block";
    arrow.textContent    = isOpen ? "▶" : "▼";
}
// ── RECALCULATE ───────────────────────────────────────────────────────────────
function recalcHizliHesap() {
    const rates   = getCurrentRates();
    const usdRate = parseFloat(rates.usd_try) || 0;

    let dmoBasket    = 0;
    let inokasBasket = 0;
    let giftTotal    = 0;

    Object.values(hhSepet).forEach(item => {
        const dmoFiyat = parseFloat(item.dmo_fiyat_try || 0);
        const malUsd   = parseFloat(item.maliyet_usd   || 0);
        const malTL    = malUsd * usdRate;

        dmoBasket    += dmoFiyat * (item.quantity     || 0);
        inokasBasket += malTL   * (item.quantity     || 0);
        giftTotal    += malTL   * (item.giftQuantity || 0);
    });

    // Step 2 — tutar indirimi
    const tutarIndirimPct  = getTutarIndirimPct(dmoBasket);
    const tutarIndirimi    = dmoBasket * tutarIndirimPct;

    // Step 3 — real basket after discount
    const realDmoBasket    = dmoBasket - tutarIndirimi;

    // Step 4 — all taxes on realDmoBasket
    const kdv              = realDmoBasket * 0.20;
    const tevkifat         = kdv * 0.20;
    const gercekKdv        = kdv - tevkifat;
    const risturn          = realDmoBasket * 0.01;
    const damgaKarar       = realDmoBasket * 0.01517;
    const vergilerTotal    = tevkifat + risturn + damgaKarar;

    // Step 5 — totals
    const toplamGelir      = realDmoBasket + gercekKdv;
    const toplamGider      = inokasBasket + tutarIndirimi + vergilerTotal + giftTotal;
    const netProfit        = toplamGelir - toplamGider;
    const profitPct        = toplamGelir > 0 ? (netProfit / toplamGelir) * 100 : 0;

    // ── UPDATE DOM ────────────────────────────────────────────────────────────
    const fmt = v => formatAmount(v.toFixed(2)) + " ₺";
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    set("hh_dmo_basket",         fmt(dmoBasket));
    set("hh_inokas_basket",      fmt(inokasBasket));
    set("hh_kdv",                fmt(kdv));
    set("hh_gercek_kdv",         fmt(gercekKdv));
    set("hh_tutar_indirimi",     fmt(tutarIndirimi));
    set("hh_tutar_indirimi_pct", "%" + (tutarIndirimPct * 100).toFixed(0));
    set("hh_tevkifat",           fmt(tevkifat));
    set("hh_risturn",            fmt(risturn));
    set("hh_damga_karar",        fmt(damgaKarar));
    set("hh_vergiler_total",     fmt(vergilerTotal));
    set("hh_gift_total",         fmt(giftTotal));
    set("hh_toplam_gelir",       fmt(toplamGelir));
    set("hh_toplam_gider",       fmt(toplamGider));

    const profitEl  = document.getElementById("hh_net_profit");
    const percentEl = document.getElementById("hh_profit_pct");
    if (profitEl) {
        profitEl.textContent = fmt(netProfit);
        profitEl.style.color = netProfit >= 0 ? "#16a34a" : "#dc2626";
    }
    if (percentEl) {
        percentEl.textContent = profitPct.toFixed(2) + "%";
        percentEl.style.color = profitPct >= 0 ? "#16a34a" : "#dc2626";
    }

    // Rate display
    const usdEl = document.getElementById("hh_rate_usd");
    const eurEl = document.getElementById("hh_rate_eur");
    const dmoEl = document.getElementById("hh_rate_dmo");
    const rateLabel    = rates.rate_date     ? `<div style="font-size:9px; color:#94a3b8; margin-top:2px;">${rates.rate_date}</div>`     : "";
    const dmoRateLabel = rates.dmo_rate_date ? `<div style="font-size:9px; color:#94a3b8; margin-top:2px;">${rates.dmo_rate_date}</div>` : "";
    if (usdEl) usdEl.innerHTML = (rates.usd_try ? parseFloat(rates.usd_try).toFixed(2) + " ₺" : "—") + rateLabel;
    if (eurEl) eurEl.innerHTML = (rates.eur_try ? parseFloat(rates.eur_try).toFixed(2) + " ₺" : "—") + rateLabel;
    if (dmoEl) dmoEl.innerHTML = (rates.dmo_eur_try ? parseFloat(rates.dmo_eur_try).toFixed(4) + " ₺" : "—") + dmoRateLabel;

    updateLimitBar(dmoBasket,tutarIndirimi);
}


function updateLimitBar(currentDMO = 0,currentIndirim=0) {
    const pct       = Math.min((currentDMO / LIMIT) * 100, 100);
    const remaining = Math.max(LIMIT - currentDMO, 0);

    const usedEl      = document.getElementById("hh_limit_used");
    const remainingEl = document.getElementById("hh_limit_remaining");
    const barEl       = document.getElementById("hh_limit_bar");
    const textEl      = document.getElementById("hh_limit_text");

    if (usedEl)      usedEl.textContent      = formatAmount(currentDMO-currentIndirim) + " ₺";
    if (remainingEl) remainingEl.textContent = formatAmount(remaining)  + " ₺";
    if (barEl) {
        barEl.style.width      = pct + "%";
        barEl.style.background = pct > 90 ? "#dc2626" : pct > 70 ? "#d97706" : "#2563eb";
    }
    if (textEl) {
        textEl.textContent = `%${pct.toFixed(1)} kullanıldı`;
        textEl.style.color = pct > 90 ? "#dc2626" : pct > 70 ? "#d97706" : "#2563eb";
    }
}

// ── UPDATE PRICES ─────────────────────────────────────────────────────────────
async function updateHHPrices() {
    const btn = document.getElementById("hhUpdateBtn");
    if (!btn) return;

    const toUpdate = hhProducts.filter(p => p.dmo_code && p.id);
    if (toUpdate.length === 0) { showToast("Güncellenecek ürün bulunamadı", "error"); return; }

    btn.disabled = true;
    let done = 0;
    const total = toUpdate.length;

    for (const product of toUpdate) {
        btn.textContent = `⏳ Güncelleniyor... (${done}/${total})`;
        try {
            const res  = await fetch("/api/dmo/find-dmo-url", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ dmo_code: String(product.dmo_code), product_id: String(product.id) })
            });
            const data = await res.json();

            if (!res.ok) {
                showToast(`❌ ${product.dmo_code} — hata: ${data.error || "bilinmeyen"}`, "error");
            } else if (!data.found) {
                showToast(`❌ ${product.dmo_code} DMO'da bulunamadı`, "error");
            } else if (data.price) {
                const idx = hhProducts.findIndex(p => p.dmo_code == product.dmo_code);
                if (idx !== -1) { hhProducts[idx].dmo_fiyat_try = data.price; hhProducts[idx].dmo_url = data.url; }
                showToast(`✅ ${product.dmo_code} güncellendi → ${formatAmount(data.price)} ₺`, "success");
            } else {
                showToast(`🔍 ${product.dmo_code} bulundu ama fiyat alınamadı`, "warn");
            }
        } catch (err) {
            showToast(`❌ ${product.dmo_code} — ${err.message}`, "error");
        }
        done++;
        await new Promise(r => setTimeout(r, 500));
    }

    renderHHProductTable();
    recalcHizliHesap();
    btn.disabled    = false;
    btn.textContent = "🔄 Fiyatları Güncelle";
    showToast(`Güncelleme tamamlandı: ${done}/${total}`, "success");
}

// ── SAVE AS TASLAK ────────────────────────────────────────────────────────────
async function saveHizliHesapAsTaslak() {
    if (Object.keys(hhSepet).length === 0) {
        showToast("Lütfen en az bir ürün ekleyin", "error");
        return;
    }

    const usdRate          = getCurrentRates().usd_try;
    const getText          = id => parseFloat(document.getElementById(id)?.textContent?.replace(/\./g, "").replace(",", ".").replace(" ₺", "")) || 0;
    const dmoBasket        = getText("hh_dmo_basket");
    const inokasBasket     = getText("hh_inokas_basket");
    const kdv              = getText("hh_kdv");
    const tevkifat         = getText("hh_tevkifat");
    const gercekKdv        = getText("hh_gercek_kdv");
    const risturn          = getText("hh_risturn");
    const tutarIndirimi    = getText("hh_tutar_indirimi");
    const toplamGelir      = getText("hh_toplam_gelir");
    const toplamGider      = getText("hh_toplam_gider");
    const netProfit        = toplamGelir - toplamGider;
    const profitPct        = toplamGelir > 0 ? (netProfit / toplamGelir) * 100 : 0;
    const tutarIndirimPct  = getTutarIndirimPct(dmoBasket);
    const realDmoBasket    = dmoBasket - tutarIndirimi;

    const orderPayload = {
            customer_name:        document.getElementById("hh_customer_name")?.value || null,
            usd_rate:             usdRate,
            dmo_basket_total:     dmoBasket,
            real_dmo_basket:      realDmoBasket,
            tutar_indirimi:       tutarIndirimi,
            tutar_indirimi_pct:   tutarIndirimPct * 100,
            inokas_basket_total:  inokasBasket,
            kdv_amount:           kdv,
            tevkifat:             tevkifat,
            gercek_kdv:           gercekKdv,
            risturn_amount:       risturn,
            toplam_gelir:         toplamGelir,
            toplam_gider:         toplamGider,
            net_profit:           netProfit,
            profit_percentage:    profitPct,
            status:               "Taslak",
        };

    try {
        showToast("Taslak kaydediliyor...", "info");

        let order;
        if (_hhEditingTaslakId) {
            // Update existing taslak
            await db.from("dmo_order_items").delete().eq("order_id", _hhEditingTaslakId);
            const { data: updated, error: updateError } = await db
                .from("dmo_orders").update(orderPayload)
                .eq("id", _hhEditingTaslakId).select().single();
            if (updateError) { showToast("Taslak güncellenemedi: " + updateError.message, "error"); return; }
            order = updated;
        } else {
            // Insert new taslak
            const { data: inserted, error: orderError } = await db
                .from("dmo_orders")
                .insert({ ...orderPayload, order_date: new Date().toISOString().slice(0, 10) })
                .select().single();
            if (orderError) { showToast("Taslak kaydedilemedi: " + orderError.message, "error"); return; }
            order = inserted;
        }

        // Insert items
        for (const item of Object.values(hhSepet)) {
            if (item.quantity > 0) {
                await db.from("dmo_order_items").insert({
                    order_id:            order.id,
                    product_id:          item.id || null,
                    quantity:            item.quantity,
                    unit_price_excl_vat: parseFloat(item.dmo_fiyat_try || 0),
                    line_total_excl_vat: parseFloat(item.dmo_fiyat_try || 0) * item.quantity,
                    is_gift:             false,
                    katalog_kod:         item.dmo_code?.toString(),
                    maliyet_usd:         parseFloat(item.maliyet_usd || 0),
                    maliyet_tl:          parseFloat(item.maliyet_usd || 0) * usdRate,
                });
            }
            if (item.giftQuantity > 0) {
                await db.from("dmo_order_items").insert({
                    order_id:            order.id,
                    product_id:          item.id || null,
                    quantity:            item.giftQuantity,
                    unit_price_excl_vat: parseFloat(item.dmo_fiyat_try || 0),
                    line_total_excl_vat: parseFloat(item.dmo_fiyat_try || 0) * item.giftQuantity,
                    is_gift:             true,
                    katalog_kod:         item.dmo_code?.toString(),
                    maliyet_usd:         parseFloat(item.maliyet_usd || 0),
                    maliyet_tl:          parseFloat(item.maliyet_usd || 0) * usdRate,
                });
            }
        }

        showToast("Taslak başarıyla kaydedildi!", "success");
        if (window._onTaslakSaved) {
            setTimeout(() => window._onTaslakSaved(), 800);
        } else {
            closeHizliHesap();
        }

    } catch (err) {
        showToast("Beklenmeyen hata: " + err.message, "error");
    }
}

// ── PAGE INIT ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    if (!document.getElementById("hh_product_grid")) return;

    await fetchRatesFromDB();
    await ensureRatesExist();

    const taslakId = new URLSearchParams(window.location.search).get("taslak");
    if (taslakId) {
        await openHizliHesapForTaslak(taslakId);
    } else {
        await openHizliHesap();
    }

    window._onTaslakSaved = () => {
        window.location.href = "/dmo/pages/siparisler.html";
    };
});