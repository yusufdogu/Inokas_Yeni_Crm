// ─── GENEL BAKIŞ — INSIGHTS ─────────────────────────────────────────────────
// Populates the three insight cards at the top of the dashboard:
//   1. Top Mover — biggest company growing fastest in the last 30 days (both directions)
//   2. Cadence Anomaly — regular customer that went silent this month
//   3. Forecast — projection to end of current month, comparing to previous-month average
//
// Called from loadGenelData() on initial load.

// Pagination state
let _insightLists    = { mover: [], anomaly: [] };
let _insightIndex    = { mover: 0,  anomaly: 0  };
let _insightAutoTimer = null;
let _insightAutoPausedUntil = 0;

const INSIGHT_AUTO_CYCLE_MS = 5000;
const INSIGHT_PAUSE_AFTER_MANUAL_MS = 30000;
const INSIGHT_MAX_PER_CARD = 5;   // per direction; combined pool can hold up to 10

// ── Helpers ─────────────────────────────────────────────────────────────────
const _fmtMoney = n => {
    n = parseFloat(n) || 0;
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return Math.round(n / 1_000) + 'K';
    return Math.round(n).toString();
};

const _iso = d => d.toISOString().slice(0, 10);
const _daysAgo = n => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d;
};

const _turkishMonthShort = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];


// ── MAIN ORCHESTRATOR ───────────────────────────────────────────────────────
async function loadInsights() {
    _showInsightsLoading();
    _stopInsightAutoCycle();

    const [moverResult, cadenceResult, forecastResult] = await Promise.allSettled([
        _fetchAndComputeTopMover(),
        _fetchAndComputeCadenceAnomaly(),
        _fetchAndComputeForecast(),
    ]);

    const moverList    = (moverResult.status    === 'fulfilled') ? (moverResult.value    || []) : [];
    const anomalyList  = (cadenceResult.status  === 'fulfilled') ? (cadenceResult.value  || []) : [];
    const forecastData = (forecastResult.status === 'fulfilled') ?  forecastResult.value        : null;

    _insightLists.mover   = moverList;
    _insightLists.anomaly = anomalyList;
    _insightIndex.mover   = 0;
    _insightIndex.anomaly = 0;

    _renderInsightAtIndex('mover',   0);
    _renderInsightAtIndex('anomaly', 0);
    _renderInsight('forecast', forecastData);

    if (moverList.length > 1 || anomalyList.length > 1) {
        _startInsightAutoCycle();
    }
}


// ── TOP MOVER — combines giden + gelen ──────────────────────────────────────
async function _fetchAndComputeTopMover() {
    const today          = new Date(); today.setHours(0, 0, 0, 0);
    const currentStart   = _daysAgo(30);
    const previousStart  = _daysAgo(60);
    const previousEnd    = _daysAgo(30);

    // 4 fetches in parallel
    const [
        currentGiden, previousGiden,
        currentGelen, previousGelen,
    ] = await Promise.all([
        fetch(`/api/invoices/top-companies?direction=OUTGOING&date_start=${_iso(currentStart)}&date_end=${_iso(today)}`).then(r => r.json()),
        fetch(`/api/invoices/top-companies?direction=OUTGOING&date_start=${_iso(previousStart)}&date_end=${_iso(previousEnd)}`).then(r => r.json()),
        fetch(`/api/invoices/top-companies?direction=INCOMING&date_start=${_iso(currentStart)}&date_end=${_iso(today)}`).then(r => r.json()),
        fetch(`/api/invoices/top-companies?direction=INCOMING&date_start=${_iso(previousStart)}&date_end=${_iso(previousEnd)}`).then(r => r.json()),
    ]);

    // Compute movers per direction, tag each with direction
    const gidenMovers = _computeTopMover(currentGiden || [], previousGiden || [], 'giden');
    const gelenMovers = _computeTopMover(currentGelen || [], previousGelen || [], 'gelen');

    // Combine and re-sort by score across both pools
    return [...gidenMovers, ...gelenMovers]
        .sort((a, b) => b.score - a.score)
        .slice(0, INSIGHT_MAX_PER_CARD * 2);   // up to 10 combined
}


function _computeTopMover(currentList, previousList, direction) {
    const amountOf = c => {
        if (direction === 'giden') return parseFloat(c.giden_tl) || 0;
        if (direction === 'gelen') return parseFloat(c.gelen_tl) || 0;
        return (parseFloat(c.giden_tl) || 0) + (parseFloat(c.gelen_tl) || 0);
    };

    const prevMap = new Map();
    previousList.forEach(c => prevMap.set(c.name, amountOf(c)));

    const MIN_VOLUME_TRY = 1_000;
    const candidates = [];

    currentList.forEach(c => {
        const cur = amountOf(c);
        if (cur < MIN_VOLUME_TRY) return;

        const prev = prevMap.get(c.name) || 0;
        const ratio = prev > 0 ? (cur / prev) : Infinity;
        if (ratio < 1.5) return;

        const score = (cur - prev) * Math.min(ratio, 10);
        candidates.push({
            name:      c.name,
            current:   cur,
            previous:  prev,
            ratio,
            score,
            direction,   // tag with direction so renderer knows which pill to show
        });
    });

    return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, INSIGHT_MAX_PER_CARD);
}


// ── CADENCE ANOMALY (unchanged — direction-agnostic makes sense) ────────────
async function _fetchAndComputeCadenceAnomaly() {
    const res  = await fetch('/api/invoices/company-cadence?months=6');
    if (!res.ok) return null;
    const data = await res.json();
    return _computeCadenceAnomaly(data.companies || []);
}

function _computeCadenceAnomaly(companies) {
    const now          = new Date();
    const currentYear  = now.getFullYear();
    const currentMonth = now.getMonth();

    const candidates = [];

    companies.forEach(c => {
        const months = c.months || [];
        if (months.length < 5) return;

        const current  = months.find(m => m.year === currentYear && m.month === currentMonth);
        const baseline = months.filter(m => !(m.year === currentYear && m.month === currentMonth));

        if (!baseline.length) return;

        const activeMonths = baseline.filter(m => (m.count || 0) > 0).length;
        const totalMonths  = baseline.length;
        const activeRatio  = activeMonths / totalMonths;
        if (activeRatio < 0.8) return;

        const currentCount = (current?.count) || 0;
        if (currentCount > 0) return;

        const avgPerMonth = baseline.reduce((s, m) => s + (m.count || 0), 0) / totalMonths;
        const score = activeRatio * avgPerMonth;

        candidates.push({
            name:            c.name,
            activeMonths,
            totalMonths,
            avgPerMonth,
            lastInvoiceDate: c.last_invoice_date,
            score,
        });
    });

    return candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, INSIGHT_MAX_PER_CARD);
}


// ── FORECAST — both directions, compared to previous-month average ──────────
async function _fetchAndComputeForecast() {
    const now         = new Date();
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd    = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const prevStart   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd     = new Date(now.getFullYear(), now.getMonth(), 0);

    // 4 fetches in parallel: current-month + prev-month for each direction
    const [gidenCurRes, gelenCurRes, gidenPrevRes, gelenPrevRes] = await Promise.all([
        fetch(`/api/invoices/cashflow-series?direction=OUTGOING&date_start=${_iso(monthStart)}&date_end=${_iso(now)}&bucket=day`).then(r => r.json()),
        fetch(`/api/invoices/cashflow-series?direction=INCOMING&date_start=${_iso(monthStart)}&date_end=${_iso(now)}&bucket=day`).then(r => r.json()),
        fetch(`/api/invoices/cashflow-series?direction=OUTGOING&date_start=${_iso(prevStart)}&date_end=${_iso(prevEnd)}&bucket=day`).then(r => r.json()),
        fetch(`/api/invoices/cashflow-series?direction=INCOMING&date_start=${_iso(prevStart)}&date_end=${_iso(prevEnd)}&bucket=day`).then(r => r.json()),
    ]);

    const sumTry = series => (series || []).reduce((s, b) => s + (parseFloat(b.try_total) || 0), 0);

    const gidenCurrentTotal  = sumTry(gidenCurRes.series);
    const gelenCurrentTotal  = sumTry(gelenCurRes.series);
    const gidenPreviousTotal = sumTry(gidenPrevRes.series);
    const gelenPreviousTotal = sumTry(gelenPrevRes.series);

    return _computeForecast({
        gidenCurrent:  gidenCurrentTotal,
        gelenCurrent:  gelenCurrentTotal,
        gidenPrevious: gidenPreviousTotal,
        gelenPrevious: gelenPreviousTotal,
        monthStart, monthEnd, now,
    });
}


function _computeForecast(opts) {
    const { gidenCurrent, gelenCurrent, gidenPrevious, gelenPrevious, monthEnd, now } = opts;

    const totalDaysInMonth = monthEnd.getDate();
    const daysElapsed      = now.getDate();

    // Skip if too early in the month AND no previous-month data to fall back on
    if (daysElapsed < 3 && !gidenPrevious && !gelenPrevious) return null;

    // For each direction, compute projected total using two methods and blend:
    //   1. Linear extrapolation from current month rate
    //   2. Previous-month total as baseline
    // Weight recent data more as month progresses.
    const projectDirection = (current, previous) => {
        // If no activity at all, return 0 (both current & previous empty)
        if (!current && !previous) return 0;

        // Linear projection from current month
        const dailyRate    = daysElapsed > 0 ? (current / daysElapsed) : 0;
        const linearProj   = dailyRate * totalDaysInMonth;

        // Weight: more days elapsed → more weight on linear
        //         early in month → lean on previous-month baseline
        const linearWeight = Math.min(daysElapsed / 10, 1);   // full weight after day 10
        const prevWeight   = 1 - linearWeight;

        return (linearProj * linearWeight) + (previous * prevWeight);
    };

    const gidenProjected = projectDirection(gidenCurrent, gidenPrevious);
    const gelenProjected = projectDirection(gelenCurrent, gelenPrevious);

    return {
        giden: {
            currentTotal:  gidenCurrent,
            previousTotal: gidenPrevious,
            projectedTotal: gidenProjected,
        },
        gelen: {
            currentTotal:  gelenCurrent,
            previousTotal: gelenPrevious,
            projectedTotal: gelenProjected,
        },
        daysElapsed,
        totalDaysInMonth,
        percentElapsed: (daysElapsed / totalDaysInMonth) * 100,
    };
}


// ── RENDERERS ───────────────────────────────────────────────────────────────
function _renderInsight(kind, data) {
    // Only called for forecast
    const cardId  = 'gbInsightForecast';
    const valueId = 'gbInsightForecastValue';
    const hintId  = 'gbInsightForecastHint';

    const card = document.getElementById(cardId);
    if (!card) return;
    card.classList.remove('gb-insight--loading');

    if (!data || (!data.giden.projectedTotal && !data.gelen.projectedTotal)) {
        card.style.display = 'none';
        return;
    }

    card.style.display = '';
    const valueEl = document.getElementById(valueId);
    const hintEl  = document.getElementById(hintId);

    const lines = ['Ay sonu tahmini:'];
    if (data.giden.projectedTotal > 0) {
        lines.push(`<span class="gb-dir-badge gb-dir-giden">Giden</span> <strong>~₺${_fmtMoney(data.giden.projectedTotal)}</strong>`);
    }
    if (data.gelen.projectedTotal > 0) {
        lines.push(`<span class="gb-dir-badge gb-dir-gelen">Gelen</span> <strong>~₺${_fmtMoney(data.gelen.projectedTotal)}</strong>`);
    }
    valueEl.innerHTML = lines.join('<br>');

    const fillEl = document.getElementById('gbForecastBarFill');
    const projEl = document.getElementById('gbForecastBarProjected');
    if (fillEl) fillEl.style.width = data.percentElapsed.toFixed(1) + '%';
    if (projEl) projEl.style.left  = data.percentElapsed.toFixed(1) + '%';

    // Hint: show current-so-far vs prev-month average as context
    const parts = [`Ayın ${data.daysElapsed}. günü`];
    if (data.giden.previousTotal > 0 || data.gelen.previousTotal > 0) {
        parts.push(`Geçen ay: G ₺${_fmtMoney(data.giden.previousTotal)} · L ₺${_fmtMoney(data.gelen.previousTotal)}`);
    }
    hintEl.innerHTML = parts.map((p, i) =>
        i === 0 ? `<span>${p}</span>` : `<span class="gb-bullet"></span><span>${p}</span>`
    ).join('');
}


function _renderInsightAtIndex(kind, idx) {
    const cardId    = { mover: 'gbInsightMover', anomaly: 'gbInsightAnomaly' }[kind];
    const valueId   = { mover: 'gbInsightMoverValue', anomaly: 'gbInsightAnomalyValue' }[kind];
    const hintId    = { mover: 'gbInsightMoverHint', anomaly: 'gbInsightAnomalyHint' }[kind];
    const counterId = { mover: 'gbInsightMoverCounter', anomaly: 'gbInsightAnomalyCounter' }[kind];

    const card = document.getElementById(cardId);
    if (!card) return;

    card.classList.remove('gb-insight--loading');

    const list = _insightLists[kind] || [];



    card.style.display = '';

    const total = list.length;
    idx = ((idx % total) + total) % total;
    _insightIndex[kind] = idx;

    const data = list[idx];
    const valueEl   = document.getElementById(valueId);
    const hintEl    = document.getElementById(hintId);
    const counterEl = document.getElementById(counterId);

    // Fade-out, swap, fade-in
    card.classList.add('gb-insight--fading');
    setTimeout(() => {
        if (!data) {
            card.classList.remove('gb-insight--fading');
            return;
        }
        if (kind === 'mover') {
            const dirLabel = data.direction === 'giden' ? 'Giden' : 'Gelen';
            const dirClass = data.direction === 'giden' ? 'gb-dir-giden' : 'gb-dir-gelen';

            const ratioText = isFinite(data.ratio)
                ? `<span class="gb-accent">${data.ratio.toFixed(1)}x</span>`
                : `<span class="gb-accent">yeni</span>`;

            valueEl.innerHTML =
                `<span class="gb-dir-badge ${dirClass}">${dirLabel}</span> ` +
                `<strong>${_esc(data.name)}</strong> ile son 30 gündeki hacim ${ratioText} artmış`;

            hintEl.innerHTML = data.previous > 0
                ? `<span>₺ ${_fmtMoney(data.previous)} → ₺ ${_fmtMoney(data.current)}</span>`
                : `<span>Toplam ₺ ${_fmtMoney(data.current)}</span>`;
        }
        else if (kind === 'anomaly') {
            valueEl.innerHTML = `<strong>${_esc(data.name)}</strong> her ay fatura keser, bu ay <span class="gb-accent-warn">henüz yok</span>`;
            const parts = [];
            parts.push(`Son ${data.totalMonths} ay ort.: ${data.avgPerMonth.toFixed(1)} fatura/ay`);
            if (data.lastInvoiceDate) {
                const d = new Date(data.lastInvoiceDate);
                parts.push(`Son: ${d.getDate()} ${_turkishMonthShort[d.getMonth()]}`);
            }
            hintEl.innerHTML = parts.map((p, i) =>
                i === 0 ? `<span>${p}</span>` : `<span class="gb-bullet"></span><span>${p}</span>`
            ).join('');
        }

        if (counterEl) counterEl.textContent = `${idx + 1} / ${total}`;
        card.classList.remove('gb-insight--fading');
    }, 200);
}

function changeInsight(kind, delta) {
    const list = _insightLists[kind] || [];
    if (list.length < 2) return;

    _insightIndex[kind] = _insightIndex[kind] + delta;
    _renderInsightAtIndex(kind, _insightIndex[kind]);

    _insightAutoPausedUntil = Date.now() + INSIGHT_PAUSE_AFTER_MANUAL_MS;
}


function _startInsightAutoCycle() {
    _stopInsightAutoCycle();
    _insightAutoTimer = setInterval(() => {
        if (Date.now() < _insightAutoPausedUntil) return;

        ['mover', 'anomaly'].forEach(kind => {
            const list = _insightLists[kind] || [];
            if (list.length < 2) return;
            _renderInsightAtIndex(kind, _insightIndex[kind] + 1);
        });
    }, INSIGHT_AUTO_CYCLE_MS);
}


function _stopInsightAutoCycle() {
    if (_insightAutoTimer) {
        clearInterval(_insightAutoTimer);
        _insightAutoTimer = null;
    }
}

function _showInsightsLoading() {
    ['gbInsightMover', 'gbInsightAnomaly', 'gbInsightForecast'].forEach(id => {
        const card = document.getElementById(id);
        if (card) {
            card.style.display = '';
            card.classList.add('gb-insight--loading');
        }
    });

    ['gbInsightMoverCounter', 'gbInsightAnomalyCounter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '— / —';
    });
}


function _esc(str) {
    return String(str || '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}