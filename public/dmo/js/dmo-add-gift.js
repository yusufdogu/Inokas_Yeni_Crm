/* ── GIFT EDITING (inline, direct-stock model) ─────────────────────────────── */
// Module-level state, stashed by loadDetailView so gift handlers can reach it.
let _dvOrder        = null;
let _dvRegularItems = [];
let _dvGiftItems    = [];
let _dvGiftPick     = null;   // currently selected product in the picker
let _dvGiftBusy     = false;  // guards double-submit

// Called at the END of loadDetailView (both branches). Pass what it already has.
function dvStashState(order, regularItems, giftItems) {
    _dvOrder        = order;
    _dvRegularItems = regularItems || [];
    _dvGiftItems    = giftItems || [];
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