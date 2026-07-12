// ─── GENEL BAKIŞ ──────────────────────────────────────────────────────────────
// Lives inside faturalar.pages (no longer iframe).
// All public IDs prefixed with "gb" to avoid collision with the main filter bar.

// ── State ────────────────────────────────────────────────────────────────────
let _gbCompanies   = { giden: [], gelen: [] };   // full sorted lists from API
let _gbCompanyPage = { giden: 0,  gelen: 0  };   // which 3-item window
const GB_COMPANIES_PER_PAGE = 3;

let _gbLineChart     = null;
let _gbLoaded        = false;
let _gbDateMode ;
let _gbCalSelStart;
let _gbCalSelEnd  ;

const _gbFmt = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const _gbFmtK = n => {
    n = parseFloat(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
    return n.toFixed(0);
};

const _gbCalCtx = {
    selStart: null,
    selEnd: null,
    viewMonth:  { year: new Date().getFullYear(), month: new Date().getMonth() },
    viewMonth2: { year: new Date().getFullYear(), month: new Date().getMonth() },
    cal1Id: 'gbCal1',
    cal2Id: 'gbCal2',
    pickHandler: 'pickGbDay',
    calChangeHandler: '_onGbCalChange',
    firstYear: 2020,
    // In _gbCalCtx context definition:
    onRangeComplete: (start, end) => {
        document.querySelectorAll('#gbDatePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
        _setGbDateInputs(start, end);

        _gbDateMode = 'custom';
        document.getElementById('gbDateChipAll')?.classList.remove('gb-date-chip--active');
        _updateGbChartTitle();   // ← add this

        const s = start.toISOString().slice(0, 10);
        const e = end.toISOString().slice(0, 10);
        loadGenelKPIs(s, e);
        loadGenelCashflow(s, e);
        loadGenelCompanies(s,e);
    }
};

function buildGbCals()                      { buildCals(_gbCalCtx); }
function _onGbCalChange(idx, t, v)          { onCalChange(_gbCalCtx, idx, t, v); }
function pickGbDay(y, m, d)                 { pickCalDay(_gbCalCtx, y, m, d); }


// ── MAIN ENTRY POINT ─────────────────────────────────────────────────────────
async function loadGenelData() {
    // Reset view to start of current month
    _gbCalViewMonth  = { year: new Date().getFullYear(), month: new Date().getMonth() };
    _gbCalViewMonth2 = _gbCalViewMonth.month === 11
        ? { year: _gbCalViewMonth.year + 1, month: 0 }
        : { year: _gbCalViewMonth.year, month: _gbCalViewMonth.month + 1 };

    buildGbCals();

    await Promise.all([
        loadGenelKPIs(null, null),
        loadGenelCashflow(null, null),
        loadGenelCompanies(null,null),
        loadInsights(),
    ]);

    _updateGbChartTitle()
}


// ── KPI CARDS ────────────────────────────────────────────────────────────────
async function loadGenelKPIs(dateStart, dateEnd) {
    try {
        const params = new URLSearchParams();
        if (dateStart) params.set('date_start', dateStart);
        if (dateEnd)   params.set('date_end',   dateEnd);

        const [gidenRes, gelenRes] = await Promise.all([
            fetch(`/api/invoices/kpi-summary?direction=OUTGOING&${params}`).then(r => r.json()),
            fetch(`/api/invoices/kpi-summary?direction=INCOMING&${params}`).then(r => r.json()),
        ]);

        const giden = gidenRes.totals || {};
        const gelen = gelenRes.totals || {};

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        // Giden side
        setVal('gbGidenInvoiceCount', (giden.total_count   || 0).toLocaleString('tr-TR'));
        setVal('gbGidenCompanyCount', (giden.company_count || 0).toLocaleString('tr-TR'));
        setVal('gbGidenTryTotal',     '₺'+_gbFmt(giden.try_total));
        setVal('gbGidenUsdTotal',     '$'+_gbFmt(giden.usd_total));
        setVal('gbGidenEurTotal',     '€'+_gbFmt(giden.eur_total));

        // Gelen side
        setVal('gbGelenInvoiceCount', (gelen.total_count   || 0).toLocaleString('tr-TR'));
        setVal('gbGelenCompanyCount', (gelen.company_count || 0).toLocaleString('tr-TR'));
        setVal('gbGelenTryTotal',     '₺'+_gbFmt(gelen.try_total));
        setVal('gbGelenUsdTotal',     '$'+_gbFmt(gelen.usd_total));
        setVal('gbGelenEurTotal',     '€'+_gbFmt(gelen.eur_total));

    } catch (err) {
        console.error('loadGenelKPIs:', err);
    }
}

async function loadGenelCashflow(dateStart, dateEnd) {
    const loading = document.getElementById('gbChartLoading');
    if (loading) loading.style.display = 'flex';

    try {
        // Decide bucket size from range length
        const bucket = _pickBucketSize(dateStart, dateEnd);

        const params = new URLSearchParams();
        if (dateStart) params.set('date_start', dateStart);
        if (dateEnd)   params.set('date_end',   dateEnd);
        params.set('bucket', bucket);

        const [gidenRes, gelenRes] = await Promise.all([
            fetch(`/api/invoices/cashflow-series?direction=OUTGOING&${params}`).then(r => r.json()),
            fetch(`/api/invoices/cashflow-series?direction=INCOMING&${params}`).then(r => r.json()),
        ]);

        renderGenelChart(gidenRes.series || [], gelenRes.series || [], bucket);
    } catch (err) {
        console.error('loadGenelCashflow:', err);
    } finally {
        if (loading) loading.style.display = 'none';
    }
}
function _updateGbChartTitle() {
    const el = document.getElementById('gbChartTitleValue');
    if (!el) return;

    const start = _gbCalCtx.selStart;
    const end   = _gbCalCtx.selEnd;
    const fmt   = dt => dt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    if (start && end) {
        // Custom range selected — show range
        el.textContent = `${fmt(start)} – ${fmt(end)}`;
        el.classList.remove('gb-chart-title-value--muted');
    } else if (_gbDateMode === 'all') {
        // Default — show "Tüm Zamanlar"
        el.textContent = 'Tüm Zamanlar';
        el.classList.remove('gb-chart-title-value--muted');
    } else {
        // Custom mode but no range picked yet — prompt
        el.textContent = 'Tarih seçin';
        el.classList.add('gb-chart-title-value--muted');
    }
}


// Pick day / week / month based on the selected range length
function _pickBucketSize(dateStart, dateEnd) {
    if (!dateStart || !dateEnd) return 'month';   // all-time → monthly
    const ms     = new Date(dateEnd) - new Date(dateStart);
    const days   = ms / (1000 * 60 * 60 * 24);
    if (days <= 14)  return 'day';
    if (days <= 90)  return 'week';
    return 'month';
}

function renderGenelChart(gidenSeries, gelenSeries, bucket = 'month') {
    const canvas = document.getElementById('gbLineChart');
    if (!canvas) return;

    const labels = gidenSeries.map(b => _formatBucketLabel(b.period, bucket));

    const gidenPts = gidenSeries.map(b => b.try_total || 0);
    const gelenPts = gidenSeries.map(b => {
        const match = gelenSeries.find(g => g.period === b.period);
        return match ? (match.try_total || 0) : 0;
    });

    if (_gbLineChart) { _gbLineChart.destroy(); _gbLineChart = null; }

    _gbLineChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Giden',
                    data: gidenPts,
                    borderColor: '#1a6b47',
                    backgroundColor: 'rgba(26,107,71,0.09)',
                    borderWidth: 2, fill: true, tension: 0.4,
                    pointRadius: 3, pointBackgroundColor: '#1a6b47',
                },
                {
                    label: 'Gelen',
                    data: gelenPts,
                    borderColor: '#9a6318',
                    backgroundColor: 'rgba(154,99,24,0.09)',
                    borderWidth: 2, fill: true, tension: 0.4,
                    pointRadius: 3, pointBackgroundColor: '#9a6318',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: true } },
            scales: {
                x: { ticks: { color: '#6e6a62', font: { size: 10 } }, grid: { color: 'rgba(14,13,11,0.05)' } },
                y: { ticks: { color: '#6e6a62', font: { size: 10 }, callback: v => '₺' + _gbFmtK(v) }, grid: { color: 'rgba(14,13,11,0.05)' } },
            },
        },
    });
}

function _formatBucketLabel(period, bucket) {
    if (bucket === 'day') {
        // period is "2026-06-15" → "15 Haz"
        const d = new Date(period);
        return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
    }
    if (bucket === 'week') {
        // period is "2026-06-15" (Monday) → "15–21 Haz"
        const start = new Date(period);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);

        const startStr = start.toLocaleDateString('tr-TR', { day: 'numeric' });
        const endStr   = end.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });

        // Cross-month: "28 Haz – 4 Tem"
        if (start.getMonth() !== end.getMonth()) {
            const startStrFull = start.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
            return `${startStrFull} – ${endStr}`;
        }
        return `${startStr}–${endStr}`;
    }
    // month: "2026-06" → "Haz 26"
    const d = new Date(period + '-01');
    return d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit' });
}

// ── TOP COMPANIES (split into Giden + Gelen lists) ──────────────────────────
async function loadGenelCompanies(dateStart, dateEnd) {
    renderCompaniesSkeleton('gbCompaniesGiden');
    renderCompaniesSkeleton('gbCompaniesGelen');

    // Also hide pagers during load (they'll reappear in renderGenelCompanies)
    const pagerG = document.getElementById('gbCompaniesPager_giden');
    const pagerL = document.getElementById('gbCompaniesPager_gelen');
    if (pagerG) pagerG.style.display = 'none';
    if (pagerL) pagerL.style.display = 'none';

    try {
        const params = new URLSearchParams();
        if (dateStart) params.set('date_start', dateStart);
        if (dateEnd)   params.set('date_end',   dateEnd);

        const res  = await fetch(`/api/invoices/top-companies?${params}`);
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];

        _gbCompanies.giden = list
            .filter(c => (c.giden_tl || c.giden || 0) > 0)
            .sort((a, b) => (b.giden_tl || b.giden || 0) - (a.giden_tl || a.giden || 0));

        _gbCompanies.gelen = list
            .filter(c => (c.gelen_tl || c.gelen || 0) > 0)
            .sort((a, b) => (b.gelen_tl || b.gelen || 0) - (a.gelen_tl || a.gelen || 0));

        _gbCompanyPage.giden = 0;
        _gbCompanyPage.gelen = 0;

        renderGenelCompanies('giden');
        renderGenelCompanies('gelen');

    } catch (err) {
        console.error('loadGenelCompanies:', err);
    }
}
function renderGenelCompanies(direction) {
    const containerId = direction === 'giden' ? 'gbCompaniesGiden' : 'gbCompaniesGelen';
    const el = document.getElementById(containerId);
    if (!el) return;

    const fullList = _gbCompanies[direction] || [];
    const totalPages = Math.max(1, Math.ceil(fullList.length / GB_COMPANIES_PER_PAGE));
    const page = _gbCompanyPage[direction];
    const slice = fullList.slice(
        page * GB_COMPANIES_PER_PAGE,
        (page + 1) * GB_COMPANIES_PER_PAGE
    );

    // ── Empty state ────────────────────────────────────────────────────────
    if (!fullList.length) {
        el.innerHTML = `<div style="padding:20px;text-align:center;font-size:12px;color:var(--fat-ink4);">Veri bulunamadı</div>`;
        _updateGbCompaniesPager(direction, 0, 0);
        return;
    }

    // ── Render the slice ───────────────────────────────────────────────────
    const amountKey   = direction === 'giden' ? 'giden_tl' : 'gelen_tl';
    const fallbackKey = direction === 'giden' ? 'giden'    : 'gelen';
    // Max across the FULL list for stable bar scaling across pages
    const max = Math.max(...fullList.map(c => c[amountKey] || c[fallbackKey] || 0));

    el.innerHTML = slice.map((c, i) => {
        const amount = c[amountKey] || c[fallbackKey] || 0;
        const pct    = max > 0 ? (amount / max * 100).toFixed(1) : 0;
        // Global rank, not page-relative
        const globalIdx = page * GB_COMPANIES_PER_PAGE + i;
        const rank      = String(globalIdx + 1).padStart(2, '0');

        return `
            <div class="gb-company-row">
                <span class="gb-company-rank">${rank}</span>
                <div class="gb-company-info">
                    <div class="gb-company-top">
                        <span class="gb-company-name">${(c.name || '—').replace(/</g, '&lt;')}</span>
                        <span class="gb-company-amount">₺ ${_gbFmtK(amount)}</span>
                    </div>
                    <div class="gb-company-bar">
                        <div class="gb-company-bar-fill gb-company-bar-fill--${direction}" style="width:${pct}%"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    _updateGbCompaniesPager(direction, page, totalPages);
}

function _updateGbCompaniesPager(direction, page, totalPages) {
    const pager    = document.getElementById(`gbCompaniesPager_${direction}`);
    const info     = document.getElementById(`gbCompaniesPageInfo_${direction}`);
    const prevBtn  = document.getElementById(`gbCompaniesPrev_${direction}`);
    const nextBtn  = document.getElementById(`gbCompaniesNext_${direction}`);

    if (!pager) return;

    // Hide pager entirely if 0 or 1 page
    if (totalPages <= 1) {
        pager.style.display = 'none';
        return;
    }

    pager.style.display = 'flex';
    if (info)    info.textContent     = `${page + 1} / ${totalPages}`;
    if (prevBtn) prevBtn.disabled     = (page <= 0);
    if (nextBtn) nextBtn.disabled     = (page >= totalPages - 1);
}


// ── Pagination action — called by ← / → buttons ─────────────────────────────
function changeGbCompanyPage(direction, delta) {
    const list       = _gbCompanies[direction] || [];
    const totalPages = Math.max(1, Math.ceil(list.length / GB_COMPANIES_PER_PAGE));

    const next = Math.max(0, Math.min(totalPages - 1, _gbCompanyPage[direction] + delta));
    if (next === _gbCompanyPage[direction]) return;   // no-op at boundary

    _gbCompanyPage[direction] = next;
    renderGenelCompanies(direction);
}

// ── DATE MODE (Tüm zamanlar / Özel tarih) ────────────────────────────────────
function setGenelDateMode(mode) {
    if (mode !== 'all') return;  // only 'all' is callable now

    _gbDateMode = 'all';

    const allChip = document.getElementById('gbDateChipAll');
    allChip?.classList.add('gb-date-chip--active');

    // Reset selection
    _gbCalCtx.selStart = null;
    _gbCalCtx.selEnd   = null;
    const dsEl = document.getElementById('gbDateStart');
    const deEl = document.getElementById('gbDateEnd');
    if (dsEl) dsEl.value = '';
    if (deEl) deEl.value = '';
    const disp = document.getElementById('gbDateDisplay');
    if (disp) disp.textContent = 'Tarih seç';
    document.querySelectorAll('#gbDatePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
    buildCals(_gbCalCtx);
    _updateGbChartTitle();

    loadGenelKPIs(null, null);
    loadGenelCashflow(null, null);
    loadGenelCompanies(null,null);
}

// ── DATE PRESETS ─────────────────────────────────────────────────────────────
function setGenelDatePreset(el, type) {
    // Toggle off if already active
    if (el.classList.contains('active')) {
        el.classList.remove('active');

        _gbCalCtx.selStart = null;
        _gbCalCtx.selEnd   = null;

        const dsEl = document.getElementById('gbDateStart');
        const deEl = document.getElementById('gbDateEnd');
        if (dsEl) dsEl.value = '';
        if (deEl) deEl.value = '';

        const disp = document.getElementById('gbDateDisplay');
        if (disp) disp.textContent = 'Tarih seç';

        document.getElementById('gbDatePill')?.classList.remove('active')
        // ── Restore "Tüm zamanlar" default ────────────────────────────────
        _gbDateMode = 'all';
        document.getElementById('gbDateChipAll')?.classList.add('gb-date-chip--active');
        // ──────────────────────────────────────────────────────────────────

        buildCals(_gbCalCtx);
        _updateGbChartTitle();

        loadGenelKPIs(null, null);
        loadGenelCashflow(null, null);
        loadGenelCompanies(null,null);   // also refresh companies if you have this
        return;
    }

    document.querySelectorAll('#gbDatePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start = new Date(today);

    if (type === 'day') {
        // start = today, already set
    } else if (type === 'week') {
        const dow = today.getDay() || 7;
        start = new Date(today);
        start.setDate(today.getDate() - (dow - 1));
    } else if (type === 'month') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (type === 'q') {
        start = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
    } else if (type === 'year') {
        start = new Date(today.getFullYear(), 0, 1);
    }

    _gbCalCtx.selStart = start;
    _gbCalCtx.selEnd   = today;
    buildCals(_gbCalCtx);          // also: use the new generic function
    _setGbDateInputs(start, today);

    document.getElementById('gbDatePill')?.classList.add('active')

    _gbDateMode = 'custom';
    document.getElementById('gbDateChipAll')?.classList.remove('gb-date-chip--active');
    _updateGbChartTitle();

    const startStr = start.toISOString().slice(0, 10);
    const endStr   = today.toISOString().slice(0, 10);

    loadGenelKPIs(startStr, endStr);
    loadGenelCashflow(startStr, endStr);
    loadGenelCompanies(startStr, endStr);   // ← add
}

function _setGbDateInputs(start, end) {
    const fmt = dt => dt.toISOString().slice(0, 10);
    const dsEl = document.getElementById('gbDateStart');
    const deEl = document.getElementById('gbDateEnd');
    if (dsEl) dsEl.value = fmt(start);
    if (deEl) deEl.value = fmt(end);

    const disp = document.getElementById('gbDateDisplay');
    if (disp) {
        const fmtLabel = dt => dt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
        disp.textContent = `${fmtLabel(start)} – ${fmtLabel(end)}`;
    }
}




// ── AI CHAT (UI only) ────────────────────────────────────────────────────────
function gbAiSendMessage() {
    const input    = document.getElementById('gbAiInput');
    const messages = document.getElementById('gbAiMessages');
    if (!input || !messages) return;

    const text = input.value.trim();
    if (!text) return;

    messages.insertAdjacentHTML('beforeend', `
        <div class="ai-msg user">
            <div class="ai-msg-bubble">${_gbAiEscape(text)}</div>
            <div class="ai-msg-meta">Sen</div>
        </div>
    `);
    input.value = '';
    messages.scrollTop = messages.scrollHeight;

    setTimeout(() => {
        messages.insertAdjacentHTML('beforeend', `
            <div class="ai-msg assistant">
                <div class="ai-msg-bubble">Bu özellik henüz geliştirme aşamasında. Yakında gerçek yanıtlar alacaksın.</div>
                <div class="ai-msg-meta">Asistan</div>
            </div>
        `);
        messages.scrollTop = messages.scrollHeight;
    }, 400);
}

function gbAiQuickPrompt(el) {
    const input = document.getElementById('gbAiInput');
    if (input) input.value = el.textContent.trim();
    gbAiSendMessage();
}

function gbAiClearChat() {
    const messages = document.getElementById('gbAiMessages');
    if (!messages) return;
    messages.innerHTML = `
        <div class="ai-msg assistant">
            <div class="ai-msg-bubble">Merhaba! Genel bakış verilerin üzerinde yardımcı olabilirim. Bir şey sor.</div>
            <div class="ai-msg-meta">Asistan</div>
        </div>
    `;
}

function _gbAiEscape(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[ch]));
}


// ── Enter key handler for AI input ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('gbAiInput');
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                gbAiSendMessage();
            }
        });
    }
});