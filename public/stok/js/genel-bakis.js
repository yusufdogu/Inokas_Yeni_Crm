// stok/genel-bakis.js — Stok Genel Bakış (inline dashboard)
//
// REAL DATA via four tenant-scoped endpoints in routes/stocks.js:
//   GET /api/stocks/value-series?bucket&date_start&date_end  → chart
//   GET /api/stocks/totals?date_start&date_end               → totals card + top-3
//   GET /api/stocks/insights                                 → 3 insight cards (snapshot)
// The time filter refetches totals + value-series (NOT insights).
// Chat has its own history key, separate from the ürünler rail; it streams from
// /api/chat/ask (tab 'stok-genel', read-only) via stok-chat-core.

let _gbReady     = false;
let _gbPeriod    = 'all';           // 'all' | 'month' | 'q' | 'custom'
let _gbDateStart = null;
let _gbDateEnd   = null;
let _gbChart     = null;
let _gbLoadSeq   = 0;               // guards out-of-order fetch responses

// insight cycling state (populated from /insights)
let _gbInsights   = { mover: [], dead: [] };
let _gbInsightIdx = { mover: 0, dead: 0 };
let _gbForecast   = null;

// top-list pagination — full arrays + independent page index per list
const _GB_TOP_PAGE_SIZE = 3;
let _gbTopData = { products: [], categories: [], brands: [] };
let _gbTopPageIdx = { products: 0, categories: 0, brands: 0 };
const _GB_TOP_META = {
  products:   { listId: 'gbTopProducts',   pagerId: 'gbTopProductsPager',   infoId: 'gbTopProductsInfo'   },
  categories: { listId: 'gbTopCategories', pagerId: 'gbTopCategoriesPager', infoId: 'gbTopCategoriesInfo' },
  brands:     { listId: 'gbTopBrands',     pagerId: 'gbTopBrandsPager',     infoId: 'gbTopBrandsInfo'     },
};

// ─── INIT (called by stok.js when the tab first opens) ────────────────────────
async function initGenelBakis() {
  if (_gbReady) return;
  _gbReady = true;

  _gbChatLoad();

  document.addEventListener('click', _gbCloseDatePop);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _gbCloseDatePop(); });

  _gbLoadInsights();   // snapshot, filter-independent
  _gbApplyPeriod();    // totals + chart for the initial period
}

// ─── PERIOD → date range ───────────────────────────────────────────────────────
function _gbPeriodRange() {
  const today = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  if (_gbPeriod === 'custom' && _gbDateStart && _gbDateEnd) {
    const days = (new Date(_gbDateEnd) - new Date(_gbDateStart)) / 86400000;
    const bucket = days <= 45 ? 'day' : (days <= 200 ? 'week' : 'month');
    return { date_start: _gbDateStart, date_end: _gbDateEnd, bucket };
  }
  if (_gbPeriod === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { date_start: iso(start), date_end: iso(today), bucket: 'day' };
  }
  if (_gbPeriod === 'q') {
    const start = new Date(today); start.setMonth(today.getMonth() - 3);
    return { date_start: iso(start), date_end: iso(today), bucket: 'week' };
  }
  return { date_start: null, date_end: null, bucket: 'month' }; // all
}

function gbSetPeriod(period, btn) {
  _gbPeriod = period;
  _gbDateStart = _gbDateEnd = null;
  ['gbChipAll', 'gbChipMonth', 'gbChipQ'].forEach(id =>
    document.getElementById(id)?.classList.remove('gb-date-chip--active'));
  btn?.classList.add('gb-date-chip--active');
  _gbSetText('gbDateDisplay', 'Tarih seç');
  document.getElementById('gbDatePill')?.classList.remove('active');
  _gbApplyPeriod();
}

// Refetch the period-scoped half (totals + chart). Insights untouched.
async function _gbApplyPeriod() {
  const seq = ++_gbLoadSeq;
  const { date_start, date_end, bucket } = _gbPeriodRange();
  _gbSetText('gbChartTitle', _gbPeriodTitle());

  const qs = new URLSearchParams();
  if (date_start) qs.set('date_start', date_start);
  if (date_end)   qs.set('date_end', date_end);

  try {
    const [totals, series] = await Promise.all([
      _gbFetch(`/api/stocks/totals?${qs.toString()}`),
      _gbFetch(`/api/stocks/value-series?bucket=${bucket}&${qs.toString()}`),
    ]);
    if (seq !== _gbLoadSeq) return;               // superseded by a newer request
    _gbRenderTotals(totals);
    _gbRenderTops(totals);
    _gbRenderChart(series);
  } catch (err) {
    console.error('Genel bakış (period) yüklenemedi:', err);
    if (seq === _gbLoadSeq) _gbShowDataError();
  }
}

function _gbPeriodTitle() {
  if (_gbPeriod === 'month') return 'Bu Ay';
  if (_gbPeriod === 'q')     return 'Son 3 Ay';
  if (_gbPeriod === 'custom' && _gbDateStart && _gbDateEnd) return `${_gbDateStart} – ${_gbDateEnd}`;
  return 'Tüm Zamanlar';
}

// ─── TOTALS CARD ────────────────────────────────────────────────────────────────
function _gbRenderTotals(t) {
  if (!t) return;
  _gbSetText('gbTotalTL',  '₺' + Number(t.tl  || 0).toLocaleString('tr-TR'));
  _gbSetText('gbTotalEUR', '€' + Number(t.eur || 0).toLocaleString('tr-TR'));
  _gbSetText('gbTotalUSD', '$' + Number(t.usd || 0).toLocaleString('tr-TR'));
  _gbSetText('gbTotalProducts',   Number(t.products   || 0).toLocaleString('tr-TR'));
  _gbSetText('gbTotalQty',        Number(t.total_qty  || 0).toLocaleString('tr-TR'));
  _gbSetText('gbTotalCategories', String(t.categories || 0));
  _gbSetText('gbTotalBrands',     String(t.brands     || 0));
}

// ─── TOP-3 LISTS ────────────────────────────────────────────────────────────────
// New data from /totals → store full lists, reset all pagers to page 0, render.
function _gbRenderTops(t) {
  if (!t) return;
  _gbTopData.products   = t.top_products   || [];
  _gbTopData.categories = t.top_categories || [];
  _gbTopData.brands     = t.top_brands     || [];
  _gbTopPageIdx = { products: 0, categories: 0, brands: 0 };
  _gbRenderTopList('products');
  _gbRenderTopList('categories');
  _gbRenderTopList('brands');
}

// Pager handler (HTML: gbTopPage('products'|'categories'|'brands', ±1))
function gbTopPage(which, dir) {
  const rows = _gbTopData[which] || [];
  const pages = Math.max(1, Math.ceil(rows.length / _GB_TOP_PAGE_SIZE));
  _gbTopPageIdx[which] = Math.min(pages - 1, Math.max(0, (_gbTopPageIdx[which] || 0) + dir));
  _gbRenderTopList(which);
}

function _gbRenderTopList(which) {
  const meta = _GB_TOP_META[which];
  const rows = _gbTopData[which] || [];
  const listEl  = document.getElementById(meta.listId);
  const pagerEl = document.getElementById(meta.pagerId);
  const infoEl  = document.getElementById(meta.infoId);
  if (!listEl) return;

  if (!rows.length) {
    listEl.innerHTML = '<div style="font-size:11px;color:var(--stk-ink4);">Veri yok</div>';
    if (pagerEl) pagerEl.style.display = 'none';
    return;
  }

  const pages    = Math.ceil(rows.length / _GB_TOP_PAGE_SIZE);
  const page     = Math.min(_gbTopPageIdx[which] || 0, pages - 1);
  const start    = page * _GB_TOP_PAGE_SIZE;
  const pageRows = rows.slice(start, start + _GB_TOP_PAGE_SIZE);

  // bars scale against the overall #1 so ranking reads consistently across pages
  const max = rows[0].val || 1;

  listEl.innerHTML = pageRows.map((r, i) => {
    const rank = start + i + 1;   // continuous rank across pages
    return `
    <div class="gb-top-row">
      <span class="gb-top-rank">${rank}</span>
      <div class="gb-top-body">
        <div class="gb-top-line">
          <span class="gb-top-name" title="${esc(r.name)}">${esc(r.name)}</span>
          <span class="gb-top-amt">${_gbFmtTL(r.val)}</span>
        </div>
        <div class="gb-top-bar"><div class="gb-top-bar-fill" style="width:${Math.max(4, Math.round(r.val / max * 100))}%"></div></div>
      </div>
    </div>`;
  }).join('');

  if (pagerEl) {
    if (pages > 1) {
      pagerEl.style.display = 'flex';
      if (infoEl) infoEl.textContent = `${page + 1} / ${pages}`;
      const btns = pagerEl.querySelectorAll('.gb-top-pager-btn');
      if (btns[0]) btns[0].disabled = page === 0;
      if (btns[1]) btns[1].disabled = page >= pages - 1;
    } else {
      pagerEl.style.display = 'none';
    }
  }
}

// ─── CHART (Chart.js line, single TL series) ────────────────────────────────────
function _gbRenderChart(payload) {
  const canvas = document.getElementById('gbValueChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const series = (payload && payload.series) || [];
  const labels = series.map(pt => _gbPrettyPeriod(pt.period));
  const data   = series.map(pt => Number(pt.value_tl || 0));

  const green = getComputedStyle(document.documentElement).getPropertyValue('--stk-green').trim() || '#1a6b47';

  if (_gbChart) {
    _gbChart.data.labels = labels;
    _gbChart.data.datasets[0].data = data;
    _gbChart.update();
    return;
  }

  _gbChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: green,
        backgroundColor: 'rgba(26,107,71,0.08)',
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: green,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => '₺' + Number(ctx.parsed.y).toLocaleString('tr-TR') } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10, family: 'DM Mono' }, color: '#a8a39a', maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { grid: { color: 'rgba(14,13,11,0.06)' }, ticks: { font: { size: 10, family: 'DM Mono' }, color: '#a8a39a', callback: v => '₺' + _gbShort(v) } },
      },
    },
  });
}

// "2026-03" → "Mar 26";  "2026-03-14" → "14 Mar"
function _gbPrettyPeriod(period) {
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const parts = String(period || '').split('-');
  if (parts.length === 3) return `${parts[2]} ${months[+parts[1] - 1] || ''}`;
  if (parts.length === 2) return `${months[+parts[1] - 1] || ''} ${parts[0].slice(2)}`;
  return String(period || '');
}

// ─── INSIGHTS (snapshot — fetched once) ─────────────────────────────────────────
async function _gbLoadInsights() {
  try {
    const data = await _gbFetch('/api/stocks/insights');
    _gbInsights.mover = (data.risers || []).map(r => ({
      name: r.name, code: r.code, mult: String(r.mult),
      prev: _gbFmtTL(r.prev_tl), now: _gbFmtTL(r.now_tl),
    }));
    const dead  = (data.dead  || []).map(d => ({ kind: 'dead', name: d.name, code: d.code, days: d.days, qty: d.qty, value: _gbFmtTL(d.value_tl) }));
    const risky = (data.risky || []).map(r => ({ kind: 'risk', name: r.name, code: r.code, days: 0,     qty: r.qty, value: _gbFmtTL(r.value_tl) }));
    _gbInsights.dead = [...dead, ...risky];

    if (!_gbInsights.mover.length) _gbInsights.mover = [{ name: '—', code: '', mult: '0', prev: '₺0', now: '₺0' }];
    if (!_gbInsights.dead.length)  _gbInsights.dead  = [{ kind: 'dead', name: '—', code: '', days: 0, qty: 0, value: '₺0' }];

    _gbForecast = data.forecast
      ? { projected: _gbFmtTL(data.forecast.projected_tl), now: _gbFmtTL(data.forecast.now_tl), pct: data.forecast.pct, dayOfMonth: data.forecast.day_of_month }
      : null;

    _gbInsightIdx = { mover: 0, dead: 0 };
    _gbRenderInsights();
    _gbRenderReportFromInsights(data);
  } catch (err) {
    console.error('Insights yüklenemedi:', err);
    _gbSetText('gbMoverValue', 'Veri yüklenemedi');
    _gbSetText('gbDeadValue', 'Veri yüklenemedi');
    _gbSetText('gbForecastValue', 'Veri yüklenemedi');
  }
}

function _gbRenderInsights() {
  _gbRenderMover();
  _gbRenderDead();
  _gbRenderForecast();
}

function gbChangeInsight(which, dir) {
  const arr = _gbInsights[which];
  if (!arr || !arr.length) return;
  _gbInsightIdx[which] = (_gbInsightIdx[which] + dir + arr.length) % arr.length;
  if (which === 'mover') _gbRenderMover();
  else _gbRenderDead();
}

function _gbRenderMover() {
  const arr = _gbInsights.mover, i = _gbInsightIdx.mover, it = arr[i];
  _gbSetHTML('gbMoverValue', `<strong>${esc(it.name)}</strong> giden hacmi <span class="gb-accent">${it.mult}x</span> arttı`);
  _gbSetText('gbMoverHint', `${it.prev} → ${it.now} · son 30 gün`);
  _gbSetText('gbMoverCounter', `${i + 1} / ${arr.length}`);
}

function _gbRenderDead() {
  const arr = _gbInsights.dead, i = _gbInsightIdx.dead, it = arr[i];
  const tag = document.getElementById('gbDeadTag');
  if (it.kind === 'risk') {
    if (tag) { tag.className = 'gb-insight-tag gb-insight-tag--risk'; tag.innerHTML = '<i class="ti ti-alert-triangle"></i> Riskli stok'; }
    _gbSetHTML('gbDeadValue', `<strong>${esc(it.name)}</strong> stoğu <span class="gb-accent-warn">${it.qty} adet</span> kaldı`);
    _gbSetText('gbDeadHint', `${it.value} bağlı değer · kritik seviye`);
  } else {
    if (tag) { tag.className = 'gb-insight-tag gb-insight-tag--down'; tag.innerHTML = '<i class="ti ti-trending-down"></i> Ölü stok'; }
    _gbSetHTML('gbDeadValue', `<strong>${esc(it.name)}</strong> <span class="gb-accent-down">${it.days} gündür</span> hareketsiz`);
    _gbSetText('gbDeadHint', `${it.value} bağlı değer · ${it.qty} adet`);
  }
  _gbSetText('gbDeadCounter', `${i + 1} / ${arr.length}`);
}

function _gbRenderForecast() {
  if (!_gbForecast) return;
  _gbSetHTML('gbForecastValue', `Ay sonu bağlı değer <strong>~${_gbForecast.projected}</strong>`);
  _gbSetText('gbForecastHint', `${_gbForecast.now} bugün · ayın ${_gbForecast.dayOfMonth}. günü`);
  const fill = document.getElementById('gbForecastFill');
  const mark = document.getElementById('gbForecastMark');
  if (fill) fill.style.width = _gbForecast.pct + '%';
  if (mark) mark.style.left  = _gbForecast.pct + '%';
}

// ─── DATE POPOVER (reuses filter-pill / filter-popover) ────────────────────────
function gbToggleDatePop(e) {
  if (e) e.stopPropagation();
  const pop  = document.getElementById('gbDatePop');
  const wrap = document.getElementById('gbDatePillWrap');
  if (!pop || !wrap) return;
  const open = pop.classList.contains('open');
  _gbCloseDatePop();
  if (open) return;
  const rect = wrap.getBoundingClientRect();
  if (rect.left + 240 > window.innerWidth - 12) pop.classList.add('align-right');
  pop.classList.add('open');
  wrap.classList.add('open');
}

function _gbCloseDatePop() {
  document.getElementById('gbDatePop')?.classList.remove('open', 'align-right');
  document.getElementById('gbDatePillWrap')?.classList.remove('open');
}

function gbSetDatePreset(btn, kind) {
  const today = new Date();
  let start = new Date(today);
  if (kind === 'day')   start = today;
  if (kind === 'week')  start.setDate(today.getDate() - today.getDay());
  if (kind === 'month') start = new Date(today.getFullYear(), today.getMonth(), 1);
  if (kind === 'year')  start = new Date(today.getFullYear(), 0, 1);

  _gbDateStart = _gbISO(start);
  _gbDateEnd   = _gbISO(today);
  const s = document.getElementById('gbDateStart'), e = document.getElementById('gbDateEnd');
  if (s) s.value = _gbDateStart;
  if (e) e.value = _gbDateEnd;
  document.querySelectorAll('#gbDatePop .filter-preset-chip').forEach(c => c.classList.toggle('active', c === btn));
  _gbApplyCustomDate();
}

function gbOnDateInput() {
  _gbDateStart = document.getElementById('gbDateStart')?.value || null;
  _gbDateEnd   = document.getElementById('gbDateEnd')?.value   || null;
  document.querySelectorAll('#gbDatePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
  if (_gbDateStart && _gbDateEnd) _gbApplyCustomDate();
}

function _gbApplyCustomDate() {
  _gbPeriod = 'custom';
  ['gbChipAll', 'gbChipMonth', 'gbChipQ'].forEach(id =>
    document.getElementById(id)?.classList.remove('gb-date-chip--active'));
  document.getElementById('gbDatePill')?.classList.add('active');
  if (_gbDateStart && _gbDateEnd) _gbSetText('gbDateDisplay', `${_gbDateStart} → ${_gbDateEnd}`);
  _gbApplyPeriod();
}

function gbClearDate() {
  _gbDateStart = _gbDateEnd = null;
  const s = document.getElementById('gbDateStart'), e = document.getElementById('gbDateEnd');
  if (s) s.value = ''; if (e) e.value = '';
  document.querySelectorAll('#gbDatePop .filter-preset-chip').forEach(c => c.classList.remove('active'));
  _gbCloseDatePop();
  gbSetPeriod('all', document.getElementById('gbChipAll'));
}

// ─── "ASİSTAN DİYOR" REPORT ─────────────────────────────────────────────────────
function _gbRenderReportFromInsights(data) {
  const deadN  = (data.dead  || []).length;
  const riskyN = (data.risky || []).length;
  const totalTL = data.forecast ? _gbFmtTL(data.forecast.now_tl) : '—';
  _gbSetText('gbReportBody',
    `Toplam bağlı stok değeri ${totalTL}. ${deadN} üründe 14+ gündür çıkış yok, ${riskyN} üründe kritik stok seviyesi görünüyor.`);
  const btns = document.getElementById('gbReportBtns');
  if (btns) btns.style.display = '';
}

// ─── CHAT (separate history) ────────────────────────────────────────────────────
const _GB_CHAT_KEY = 'inokas_genel_chat_v1';
let _gbChatMsgs = [];
let _gbChatBusy = false;

function _gbChatLoad() {
  try {
    const raw = sessionStorage.getItem(_GB_CHAT_KEY);
    _gbChatMsgs = raw ? JSON.parse(raw) : [];
  } catch { _gbChatMsgs = []; }
  _gbChatRenderAll();
}

function _gbChatSave() { try { sessionStorage.setItem(_GB_CHAT_KEY, JSON.stringify(_gbChatMsgs)); } catch {} }

function _gbChatRenderAll() {
  const body = document.getElementById('gbChatBody');
  if (!body) return;
  body.querySelectorAll('.ur-msg--dyn').forEach(el => el.remove());
  _gbChatMsgs.forEach(m => body.appendChild(_gbChatBubble(m.role, m.text)));
  body.scrollTop = body.scrollHeight;
}

function _gbChatBubble(role, text) {
  const d = document.createElement('div');
  d.className = 'ur-msg ur-msg--dyn ' + (role === 'user' ? 'ur-msg--user' : 'ur-msg--bot');
  if (role === 'user') d.textContent = text;
  else d.innerHTML = renderChatMarkdown(text);
  return d;
}

function _gbChatAppend(role, text) {
  _gbChatMsgs.push({ role, text });
  _gbChatSave();
  const body = document.getElementById('gbChatBody');
  if (body) { body.appendChild(_gbChatBubble(role, text)); body.scrollTop = body.scrollHeight; }
}

function gbChatGrow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 96) + 'px'; }

function gbChatToggleSend() {
  const inp = document.getElementById('gbChatInput');
  const btn = document.getElementById('gbChatSend');
  if (btn) btn.disabled = _gbChatBusy || !inp || !inp.value.trim();
}

function gbChatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gbSendChat(); } }

function gbChatQuick(btn) {
  const inp = document.getElementById('gbChatInput');
  if (!inp) return;
  inp.value = btn.textContent;
  gbChatGrow(inp);
  gbChatToggleSend();
  gbSendChat();
}

// Streams from /api/chat/ask via stok-chat-core (read-only — no UI actions).
async function gbSendChat() {
  const inp = document.getElementById('gbChatInput');
  if (!inp || _gbChatBusy) return;
  const text = inp.value.trim();
  if (!text) return;

  const history = _gbChatMsgs.slice();   // turns before this new one

  _gbChatAppend('user', text);
  inp.value = ''; gbChatGrow(inp);

  _gbChatBusy = true; gbChatToggleSend();

  // live bot bubble that grows as tokens arrive
  const bubble = _gbChatBubble('bot', '');
  bubble.classList.add('ur-msg--streaming');
  const body = document.getElementById('gbChatBody');
  body?.appendChild(bubble);
  body && (body.scrollTop = body.scrollHeight);

  let acc = '';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    bubble.classList.remove('ur-msg--streaming');
    if (acc.trim()) {
      bubble.innerHTML = renderChatMarkdown(acc);
      _gbChatMsgs.push({ role: 'bot', text: acc }); _gbChatSave();
    }
    _gbChatBusy = false;
    gbChatToggleSend();
    inp.focus();
  };

  await streamStokChat({
    tab: 'stok-genel',
    message: text,
    history,
    onToken: (chunk) => {
      acc += chunk;
      bubble.textContent = acc;
      body && (body.scrollTop = body.scrollHeight);
    },
    // no onAction — genel bakış is read-only
    onDone: finish,
    onError: (msg) => {
      if (!acc.trim()) bubble.textContent = 'Bir hata oluştu, tekrar dener misin?';
      console.error('[stok-genel chat]', msg);
      finish();
    },
  });
}

// ─── FETCH + FORMAT HELPERS ─────────────────────────────────────────────────────
async function _gbFetch(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

function _gbShowDataError() {
  ['gbTopProducts', 'gbTopCategories', 'gbTopBrands'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div style="font-size:11px;color:var(--stk-red);">Veri yüklenemedi</div>';
  });
}

function _gbFmtTL(n) { return '₺' + Math.round(Number(n || 0)).toLocaleString('tr-TR'); }
function _gbShort(n) {
  n = Number(n || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'M';
  if (n >= 1000)    return Math.round(n / 1000) + 'K';
  return String(Math.round(n));
}
function _gbISO(d) { return d.toISOString().slice(0, 10); }
function _gbSetText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function _gbSetHTML(id, v) { const el = document.getElementById(id); if (el) el.innerHTML = v; }