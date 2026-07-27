/* ============================================================================
   DMO SHELL — tab switching, rates, filter-bar UI, AI rail
   Depends on dmo-core.js (filterState, fetchRatesFromDB, ensureRatesExist,
   formatAmount, showToast). Tab-specific data lives in dmo-faturalar.js etc.
   ========================================================================== */

/* Extend the shared filter state with invoice-specific fields.
   (companies = Firma chips, minBasket/maxBasket = Tutar range — reused as-is.) */
filterState.invoiceNos = [];   // Fatura No chips
filterState.source     = "";   // source select

/* Which tabs show the AI rail */
const AI_TABS = new Set(["genel", "faturalar"]);

/* First-open guard so each tab initialises its data once */
const _tabInit = { genel: false, faturalar: false, sepet: false, bekleyen: false };

let _activeTab = "faturalar";

/* ── TAB SWITCHING ─────────────────────────────────────────────────────── */
function switchMainTab(tab) {
    _activeTab = tab;

    const u = new URL(location.href);
    u.searchParams.set("tab", tab);
    history.replaceState(null, "", u);

    if (tab === "sepet") { window.location.href = "/dmo/pages/sepet-hesapla.html"; return; }
    document.querySelectorAll(".dmo-panel").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".dmo-navpill").forEach(p => p.classList.remove("active"));
    document.getElementById("panel-" + tab)?.classList.add("active");
    document.getElementById("nav-" + tab)?.classList.add("active");

    /* AI rail visibility */
    const ai = document.getElementById("dmo-ai");
    if (ai) ai.classList.toggle("hidden", !AI_TABS.has(tab));

    /* Close any open filter popovers when leaving */
    closeAllPopovers();

    /* Lazy init per tab */
    if (tab === "faturalar" && !_tabInit.faturalar) {
        _tabInit.faturalar = true;
        if (typeof initFaturalar === "function") initFaturalar();
    }

    if (tab === "bekleyen" && !_tabInit.bekleyen) {
        _tabInit.bekleyen = true;
        if (typeof initBekleyen === "function") initBekleyen();
    }

    if (tab === "genel" && !_tabInit.genel) {
        _tabInit.genel = true;
        if (typeof initGenel === "function") initGenel();
    }
}

/* ── RATES ─────────────────────────────────────────────────────────────── */
function writeRatesToHeader() {
    const r = getCurrentRates();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ? formatAmount(v) : "—"; };
    set("hh_rate_usd", r.usd_try);
    set("hh_rate_eur", r.eur_try);
    set("hh_rate_dmo", r.dmo_eur_try);
}

async function refreshRates() {
    const btn = document.getElementById("ratesRefreshBtn");
    if (btn) { btn.disabled = true; btn.style.opacity = ".6"; }
    try {
        await fetch("/api/dmo/fetch-tcmb-now",     { method: "POST" });
        await fetch("/api/dmo/fetch-dmo-rate-now", { method: "POST" });
        await fetchRatesFromDB();
        writeRatesToHeader();
        showToast("Kurlar güncellendi", "success");
    } catch (err) {
        showToast("Kurlar güncellenemedi", "error");
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = "1"; }
    }
}

/* ============================================================================
   FILTER BAR — popovers
   ========================================================================== */
function closeAllPopovers() {
    document.querySelectorAll(".dmo-popover").forEach(p => p.classList.remove("open"));
    document.querySelectorAll(".dmo-pill").forEach(p => {
        if (!p.classList.contains("dmo-pill--advanced")) p.classList.remove("is-open");
    });
}

function toggleFilterPopover(which) {
    const pop  = document.getElementById("popover-" + which);
    const pill = document.getElementById("pill-" + which);
    if (!pop) return;
    const willOpen = !pop.classList.contains("open");
    closeAllPopovers();
    if (willOpen) { pop.classList.add("open"); pill?.classList.add("is-open"); }
}

/* Close popovers on outside click */
document.addEventListener("click", (e) => {
    if (!e.target.closest(".dmo-pill")) closeAllPopovers();
});

/* ── Date presets ──────────────────────────────────────────────────────── */
function applyDatePreset(kind) {
    const today = new Date();
    const iso   = d => d.toISOString().slice(0, 10);
    let start = "", end = iso(today), label = "";

    if (kind === "today")      { start = iso(today); label = "Bugün"; }
    else if (kind === "week")  { const d = new Date(today); d.setDate(d.getDate() - d.getDay() + 1); start = iso(d); label = "Bu hafta"; }
    else if (kind === "month") { start = iso(new Date(today.getFullYear(), today.getMonth(), 1)); label = "Bu ay"; }
    else if (kind === "90")    { const d = new Date(today); d.setDate(d.getDate() - 90); start = iso(d); label = "Son 90 gün"; }

    filterState.dateStart = start;
    filterState.dateEnd   = end;
    document.getElementById("filter-date-start").value = start;
    document.getElementById("filter-date-end").value   = end;
    setPillLabel("date", label);
    highlightPreset("popover-date", event?.target);
    applyFilters();
}

function onDateInputChange() {
    filterState.dateStart = document.getElementById("filter-date-start").value || "";
    filterState.dateEnd   = document.getElementById("filter-date-end").value   || "";
    const lbl = (filterState.dateStart || filterState.dateEnd)
        ? `${filterState.dateStart ? formatDate(filterState.dateStart) : "…"} — ${filterState.dateEnd ? formatDate(filterState.dateEnd) : "…"}`
        : "";
    setPillLabel("date", lbl);
    applyFilters();
}

/* ── Amount presets ────────────────────────────────────────────────────── */
function applyAmountPreset(min, max) {
    filterState.minBasket = min;
    filterState.maxBasket = max;
    document.getElementById("filter-amount-min").value = min;
    document.getElementById("filter-amount-max").value = max;
    setPillLabel("amount", `${compactTRY(min)} — ${compactTRY(max)}`);
    highlightPreset("popover-amount", event?.target);
    applyFilters();
}

function onAmountInputChange() {
    const min = parseFloat(document.getElementById("filter-amount-min").value);
    const max = parseFloat(document.getElementById("filter-amount-max").value);
    filterState.minBasket = isNaN(min) ? 0       : min;
    filterState.maxBasket = isNaN(max) ? Infinity : max;
    const lbl = (!isNaN(min) || !isNaN(max))
        ? `${isNaN(min) ? "0" : compactTRY(min)} — ${isNaN(max) ? "∞" : compactTRY(max)}`
        : "";
    setPillLabel("amount", lbl);
    applyFilters();
}

/* ── Pill label / preset helpers ───────────────────────────────────────── */
function setPillLabel(which, label) {
    const span = document.getElementById(`pill-${which}-label`);
    const pill = document.getElementById(`pill-${which}`);
    const defaults = { date: "Tüm zamanlar", amount: "Tüm tutarlar" };
    if (span) span.textContent = label || defaults[which];
    if (pill) pill.classList.toggle("is-active", !!label);
}

function highlightPreset(popoverId, target) {
    const pop = document.getElementById(popoverId);
    if (!pop) return;
    pop.querySelectorAll(".dmo-preset").forEach(b => b.classList.remove("active"));
    if (target && target.classList.contains("dmo-preset")) target.classList.add("active");
}

/* ── Advanced panel ────────────────────────────────────────────────────── */
function toggleAdvancedFilters() {
    const panel = document.getElementById("advanced-panel");
    const pill  = document.getElementById("pill-advanced");
    const open  = panel.classList.toggle("open");
    pill.classList.toggle("is-open", open);
}

function updateAdvancedBadge() {
    filterState.status   = document.getElementById("filter-status").value   || "";
    filterState.category = document.getElementById("filter-category").value || "";
    filterState.source   = document.getElementById("filter-source").value   || "";
    const active = !!(filterState.status || filterState.category || filterState.source);
    document.getElementById("advanced-badge").classList.toggle("show", active);
    applyFilters();
}

/* ── Clear all ─────────────────────────────────────────────────────────── */
function clearAllFilters() {
    filterState.invoiceNos = [];
    filterState.companies  = [];
    filterState.dateStart  = "";
    filterState.dateEnd    = "";
    filterState.status     = "";
    filterState.category   = "";
    filterState.source     = "";
    filterState.minBasket  = 0;
    filterState.maxBasket  = Infinity;

    ["input-faturano", "input-firma", "filter-date-start", "filter-date-end",
     "filter-amount-min", "filter-amount-max"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
    });
    ["filter-status", "filter-category", "filter-source"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
    });

    renderFilterTags("faturano");
    renderFilterTags("firma");
    setPillLabel("date", "");
    setPillLabel("amount", "");
    document.getElementById("advanced-badge").classList.remove("show");
    highlightPreset("popover-date", null);
    highlightPreset("popover-amount", null);

    applyFilters();
}

/* ============================================================================
   FILTER BAR — tag chips (Fatura No + Firma)
   key mapping: faturano → invoiceNos, firma → companies
   ========================================================================== */
function _tagKey(type) { return type === "faturano" ? "invoiceNos" : "companies"; }

function addFilterTag(type, value) {
    value = (value || "").trim();
    if (!value) return;
    const arr = filterState[_tagKey(type)];
    if (!arr.some(v => v.toLocaleLowerCase("tr-TR") === value.toLocaleLowerCase("tr-TR"))) {
        arr.push(value);
        renderFilterTags(type);
        applyFilters();
    }
}

function removeFilterTag(type, value) {
    const key = _tagKey(type);
    filterState[key] = filterState[key].filter(v => v !== value);
    renderFilterTags(type);
    applyFilters();
}

function renderFilterTags(type) {
    const wrap = document.getElementById("tags-" + type);
    if (!wrap) return;
    const arr = filterState[_tagKey(type)];
    wrap.innerHTML = arr.map(v => `
        <span class="dmo-tag">${escapeHtml(v)}
          <i class="ti ti-x" onclick="removeFilterTag('${type}', ${JSON.stringify(v).replace(/"/g, "&quot;")})"></i>
        </span>`).join("");
}

/* Enter to add, Backspace (empty) to remove last */
function handleTagKeydown(event, type) {
    const input = event.target;
    if (event.key === "Enter") {
        event.preventDefault();
        /* if a firma dropdown item is highlighted, use it; else raw text */
        const hi = document.querySelector(`#dropdown-${type} .dmo-dd-item.hl`);
        addFilterTag(type, hi ? hi.dataset.value : input.value);
        input.value = "";
        closeTagDropdown(type);
    } else if (event.key === "Backspace" && input.value === "") {
        const arr = filterState[_tagKey(type)];
        if (arr.length) removeFilterTag(type, arr[arr.length - 1]);
    } else if (event.key === "Escape") {
        closeTagDropdown(type);
    }
}

/* Firma live dropdown (company names come from dmo-faturalar's cache) */
function handleTagInput(event, type) {
    if (type !== "firma") return;   /* fatura no is free-text only */
    const val = event.target.value.trim().toLocaleLowerCase("tr-TR");
    const box = document.getElementById("tagbox-firma");
    let dd = document.getElementById("dropdown-firma");
    if (!dd) {
        dd = document.createElement("div");
        dd.id = "dropdown-firma";
        dd.className = "dmo-dd";
        box.appendChild(dd);
    }
    if (!val) { closeTagDropdown("firma"); return; }

    const names = (typeof getKnownCompanyNames === "function") ? getKnownCompanyNames() : [];
    const already = filterState.companies.map(c => c.toLocaleLowerCase("tr-TR"));
    const matches = names
        .filter(n => n.toLocaleLowerCase("tr-TR").includes(val) && !already.includes(n.toLocaleLowerCase("tr-TR")))
        .slice(0, 8);

    if (!matches.length) { closeTagDropdown("firma"); return; }
    dd.innerHTML = matches.map((n, i) =>
        `<div class="dmo-dd-item${i === 0 ? " hl" : ""}" data-value="${escapeHtml(n)}"
              onmousedown="event.preventDefault();addFilterTag('firma','${escapeHtml(n).replace(/'/g, "\\'")}');document.getElementById('input-firma').value='';closeTagDropdown('firma')">
           ${escapeHtml(n)}
         </div>`).join("");
    dd.classList.add("open");
}

function closeTagDropdown(type) {
    document.getElementById("dropdown-" + type)?.classList.remove("open");
}

/* ============================================================================
   AI RAIL  (scaffold — point askDmoAssistant() at your Haiku SSE route)
   ========================================================================== */
function toggleAiActivity() {
    /* Placeholder for the Son Aktivite feed expansion (wired later) */
    const caret = document.getElementById("ai-activity-caret");
    if (caret) caret.style.transform = caret.style.transform === "rotate(180deg)" ? "" : "rotate(180deg)";
}

function newAiChat() {
    const box = document.getElementById("dmo-ai-messages");
    if (box) box.innerHTML = "";
}

function appendAiMessage(kind, html) {
    const box = document.getElementById("dmo-ai-messages");
    if (!box) return null;
    const div = document.createElement("div");
    div.className = "dmo-msg " + (kind === "user" ? "dmo-msg-user" : kind === "card" ? "dmo-msg-card" : "dmo-msg-ai");
    div.innerHTML = html;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
}

function sendAiSuggestion(btn) {
    const input = document.getElementById("dmo-ai-input");
    if (input) input.value = btn.textContent.trim();
    sendAiMessage();
}

async function sendAiMessage() {
    const input = document.getElementById("dmo-ai-input");
    const text  = (input?.value || "").trim();
    if (!text) return;
    input.value = "";
    autoGrowTextarea(input);
    appendAiMessage("user", escapeHtml(text));
    const pending = appendAiMessage("ai", '<span style="color:var(--fat-muted)">…</span>');
    await askDmoAssistant(text, pending);
}

/* Streams from the DMO assistant endpoint.
   NOTE: adjust the URL/payload to match your Haiku route (mirrors fatura-ai.js). */
async function askDmoAssistant(message, targetEl) {
    try {
        const res = await fetch("/api/dmo/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message,
                tab: _activeTab,
                context: (typeof getFaturalarAiContext === "function") ? getFaturalarAiContext() : null,
            }),
        });
        if (!res.ok || !res.body) throw new Error("no stream");

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        targetEl.innerHTML = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            /* SSE: lines like `data: {...}` — tolerate plain text too */
            decoder.decode(value, { stream: true }).split("\n").forEach(line => {
                const t = line.startsWith("data:") ? line.slice(5).trim() : line;
                if (!t || t === "[DONE]") return;
                try { const j = JSON.parse(t); acc += (j.delta || j.text || j.content || ""); }
                catch { acc += t; }
            });
            targetEl.innerHTML = escapeHtml(acc).replace(/\n/g, "<br>");
            document.getElementById("dmo-ai-messages").scrollTop = 1e9;
        }
        if (!acc) targetEl.innerHTML = '<span style="color:var(--fat-muted)">Yanıt alınamadı.</span>';
    } catch (err) {
        targetEl.innerHTML = '<span style="color:var(--fat-red)">Asistan bağlanamadı. (/api/dmo/chat)</span>';
    }
}

function autoGrowTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

/* ============================================================================
   SMALL UTILITIES
   ========================================================================== */
function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Compact TRY for tight KPI/label cells: 1.244.317 → ₺1.2M */
function compactTRY(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e6) return "₺" + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + "M";
    if (Math.abs(n) >= 1e3) return "₺" + Math.round(n / 1e3) + "K";
    return "₺" + Math.round(n);
}

/* ── INIT ──────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
    /* Rates into header */
    try { await fetchRatesFromDB(); await ensureRatesExist(); } catch (_) {}
    writeRatesToHeader();

    /* Wire filter-bar listeners that aren't inline in the HTML */
    const fno = document.getElementById("input-faturano");
    const frm = document.getElementById("input-firma");
    if (fno) fno.addEventListener("keydown", e => handleTagKeydown(e, "faturano"));
    if (frm) {
        frm.addEventListener("keydown", e => handleTagKeydown(e, "firma"));
        frm.addEventListener("keyup",   e => handleTagInput(e, "firma"));
        frm.addEventListener("blur",    () => setTimeout(() => closeTagDropdown("firma"), 120));
    }
    document.getElementById("filter-date-start")?.addEventListener("change", onDateInputChange);
    document.getElementById("filter-date-end")  ?.addEventListener("change", onDateInputChange);
    document.getElementById("filter-amount-min")?.addEventListener("input",  onAmountInputChange);
    document.getElementById("filter-amount-max")?.addEventListener("input",  onAmountInputChange);

    const ai = document.getElementById("dmo-ai-input");
    if (ai) {
        ai.addEventListener("input", () => autoGrowTextarea(ai));
        ai.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAiMessage(); }
        });
    }

    /* Open the requested tab (?tab=), default Faturalar */
    const startTab = new URLSearchParams(location.search).get("tab");
    if (startTab && startTab !== "faturalar" && startTab !== "sepet") {
        switchMainTab(startTab);
    } else {
        _tabInit.faturalar = true;
        if (typeof initFaturalar === "function") initFaturalar();
    }
});