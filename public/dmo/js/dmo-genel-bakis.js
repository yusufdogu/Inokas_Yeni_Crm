/* ── GENEL BAKIŞ ───────────────────────────────────────────────────────── */
let _gbChart = null;

const _gbTRY = new Intl.NumberFormat("tr-TR", {
    style: "currency", currency: "TRY", maximumFractionDigits: 0,
});
const _gbNum = new Intl.NumberFormat("tr-TR");

async function initGenel() {
    try {
        const res = await fetch("/api/dmo/overview", {
            headers: { Authorization: "Bearer " + sessionStorage.getItem("login_auth_token") },
        });
        if (!res.ok) throw new Error("overview " + res.status);
        const data = await res.json();

        renderGbStats(data.stats);
        renderGbChart(data.series);
        renderGbRank("gb-top-companies", "gb-companies-empty", data.topCompanies, c => ({
            name: c.name,
            meta: `${_gbNum.format(c.count)} fatura`,
            val:  _gbTRY.format(c.total),
            max:  data.topCompanies[0]?.total || 1,
            cur:  c.total,
        }));
        renderGbRank("gb-top-products", "gb-products-empty", data.topProducts, p => ({
            name: p.name,
            meta: _gbTRY.format(p.revenue),
            val:  `${_gbNum.format(p.qty)} ad`,
            max:  data.topProducts[0]?.qty || 1,
            cur:  p.qty,
        }));
    } catch (err) {
        console.error("initGenel hatası:", err);
        _tabInit.genel = false;   // allow retry on next visit
    }
}

function renderGbStats(s) {
    if (!s) return;
    document.getElementById("gb-inv-count").textContent     = _gbNum.format(s.invoiceCount);
    document.getElementById("gb-inv-total").textContent     = _gbTRY.format(s.invoiceTotal);
    document.getElementById("gb-ord-count").textContent     = _gbNum.format(s.orderCount);
    document.getElementById("gb-ord-total").textContent     = _gbTRY.format(s.orderTotal);
    document.getElementById("gb-company-count").textContent = _gbNum.format(s.companyCount);
    document.getElementById("gb-grand-total").textContent   = _gbTRY.format(s.grandTotal);
}

function _gbMonthLabel(ym) {
    const [y, m] = ym.split("-");
    const names = ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
    return `${names[+m - 1]} ${y.slice(2)}`;
}

function renderGbChart(series) {
    const empty = document.getElementById("gb-chart-empty");
    const wrap  = document.querySelector(".dmo-gb-chart-wrap");
    if (!series || !series.length) {
        empty.hidden = false;
        if (wrap) wrap.style.display = "none";
        return;
    }
    empty.hidden = true;
    if (wrap) wrap.style.display = "";

    const css   = getComputedStyle(document.documentElement);
    const green = css.getPropertyValue("--fat-green").trim() || "#1a6b47";
    const amber = css.getPropertyValue("--fat-amber").trim() || "#9a6318";
    const grid  = "rgba(14,13,11,0.06)";
    const ink   = css.getPropertyValue("--fat-muted").trim() || "#8a857c";

    const labels = series.map(s => _gbMonthLabel(s.month));
    const inv    = series.map(s => s.invoice);
    const ord    = series.map(s => s.order);

    if (_gbChart) _gbChart.destroy();
    const ctx = document.getElementById("gb-trend-chart");

    _gbChart = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "Fatura", data: inv,
                    borderColor: green, backgroundColor: green,
                    tension: 0.3, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, fill: false,
                },
                {
                    label: "Sipariş Alındı", data: ord,
                    borderColor: amber, backgroundColor: amber,
                    tension: 0.3, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, fill: false,
                    borderDash: [5, 4],
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: c => `${c.dataset.label}: ${_gbTRY.format(c.parsed.y)}`,
                    },
                },
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: ink, font: { size: 11 } } },
                y: {
                    grid: { color: grid },
                    ticks: {
                        color: ink, font: { size: 11 },
                        callback: v => v >= 1e6 ? (v / 1e6) + "M"
                                     : v >= 1e3 ? (v / 1e3) + "K" : v,
                    },
                },
            },
        },
    });
}

function renderGbRank(listId, emptyId, rows, map) {
    const list  = document.getElementById(listId);
    const empty = document.getElementById(emptyId);
    list.innerHTML = "";
    if (!rows || !rows.length) { empty.hidden = false; return; }
    empty.hidden = true;

    rows.forEach((row, i) => {
        const d   = map(row);
        const pct = d.max > 0 ? Math.max(4, (d.cur / d.max) * 100) : 0;
        const el  = document.createElement("div");
        el.className = "dmo-gb-rankrow";
        el.innerHTML = `
            <span class="dmo-gb-rank-num">${i + 1}</span>
            <div>
                <div class="dmo-gb-rank-name" title="${d.name}">${d.name}</div>
                <div class="dmo-gb-rank-meta">${d.meta}</div>
            </div>
            <span class="dmo-gb-rank-val">${d.val}</span>
            <span class="dmo-gb-rank-bar" style="width:${pct}%"></span>
        `;
        list.appendChild(el);
    });
}