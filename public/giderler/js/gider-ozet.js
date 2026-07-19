// ─── GİDERLER — single-page controller (Özet + Faturalar tabs) ───────────────
// Merges the two views into one page. Shared chat rail re-scopes per tab.
// The Faturalar tab is lazily initialised on first open.

const GD_API = '/api/giderler';

// shared formatters
const _gdFull    = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _gdCompact = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { notation: 'compact', maximumFractionDigits: 1 });
const _gdEsc     = s => String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const GD_MONTHS_TR = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];

const OZ_CHIPS  = ['En çok gider yapılan firma?', 'Bu ay toplam gider?', 'En büyük gider kategorisi?'];
const FAT_CHIPS = ['Bu ayki giderleri göster', 'En yüksek tutarlı fatura?', 'Hangi firmadan kaç fatura var?'];

let _gdChat      = null;
let _gdActiveTab = 'ozet';
let _fatLoaded   = false;

document.addEventListener('DOMContentLoaded', () => {
  _gdChat = initGiderChatUI({
    bodyId: 'gdChatBody', inputId: 'gdChatInput', sendId: 'gdChatSend', chipsId: 'gdChips',
    tab: 'gider-ozet', chips: OZ_CHIPS,
  });
  ozInitRange();
  ozRefreshAll();               // default tab (Özet) loads immediately
});

// ─── TAB SWITCH ───────────────────────────────────────────────────────────────
function switchGiderTab(tab) {
  if (tab === _gdActiveTab) return;
  const isOzet = tab === 'ozet';

  document.getElementById('tabOzet').classList.toggle('gd-nav-tab--active', isOzet);
  document.getElementById('tabFaturalar').classList.toggle('gd-nav-tab--active', !isOzet);
  document.getElementById('panelOzet').hidden      = !isOzet;
  document.getElementById('panelFaturalar').hidden = isOzet;
  document.getElementById('gdFilterbar').hidden    = isOzet;    // filter bar: Faturalar only

  // Re-scope the shared chat
  if (isOzet) _gdChat?.setScope('gider-ozet', OZ_CHIPS);
  else        _gdChat?.setScope('gider-faturalar', FAT_CHIPS);

  if (isOzet) {
    _ozChart?.resize();                                         // canvas was hidden → re-fit
  } else if (!_fatLoaded) {
    fatInit();                                                  // lazy first load
    _fatLoaded = true;
  }
  _gdActiveTab = tab;
}

/* ═══════════════════════════════════════════════════════════════════════════
   ÖZET (dashboard)
   ═══════════════════════════════════════════════════════════════════════════ */
const GD_RANK_PER = 3;
let _ozMonths = 12;
let _ozChart  = null;
const _ozRankState = {};

function _ozDateStart() {
  if (!_ozMonths) return '';
  const d = new Date();
  d.setMonth(d.getMonth() - _ozMonths);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function _ozParams(extra = {}) {
  const p = new URLSearchParams();
  const ds = _ozDateStart();
  if (ds) p.set('date_start', ds);
  Object.entries(extra).forEach(([k, v]) => v != null && p.set(k, v));
  return p;
}

function ozRefreshAll() { ozLoadOverview(); ozLoadSeries(); }

function ozInitRange() {
  const wrap = document.getElementById('gdRange');
  if (!wrap) return;
  wrap.querySelectorAll('.gd-range-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.gd-range-pill').forEach(b => b.classList.remove('gd-range-pill--active'));
      btn.classList.add('gd-range-pill--active');
      _ozMonths = parseInt(btn.dataset.months) || 0;
      ozRefreshAll();
    });
  });
}

async function ozLoadOverview() {
  try {
    const res = await fetch(`${GD_API}/overview?` + _ozParams().toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    ozRenderKpis(data.kpis || {});
    ozInitRank('gdTopCompanies', data.top_companies || [], 'co');
    ozInitRank('gdTopCategories', data.top_categories || [], 'cat');
  } catch (e) {
    ['gdTopCompanies', 'gdTopCategories'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="gd-state gd-state--error">Yüklenemedi: ${_gdEsc(e.message)}</div>`;
    });
  }
}

function ozRenderKpis(k) {
  const bar = document.getElementById('gdKpis');
  if (!bar) return;
  const inv = k.total_invoices || 0, co = k.total_companies || 0;
  const tl = k.total_tl || 0, usd = k.total_usd || 0;
  bar.innerHTML = `
    <div class="gd-kpi gd-kpi--inv">
      <div class="gd-kpi-label"><i class="ti ti-file-invoice"></i>Toplam Fatura</div>
      <div class="gd-kpi-value">${inv.toLocaleString('tr-TR')}</div>
    </div>
    <div class="gd-kpi gd-kpi--co">
      <div class="gd-kpi-label"><i class="ti ti-building"></i>Toplam Firma</div>
      <div class="gd-kpi-value">${co.toLocaleString('tr-TR')}</div>
    </div>
    <div class="gd-kpi gd-kpi--tl">
      <div class="gd-kpi-label"><i class="ti ti-cash"></i>Toplam Gider (TL)</div>
      <div class="gd-kpi-value gd-kpi-value--spend" title="₺ ${_gdFull(tl)}"><span class="gd-kpi-cur">₺</span>${_gdFull(tl)}</div>
    </div>
    <div class="gd-kpi gd-kpi--usd">
      <div class="gd-kpi-label"><i class="ti ti-currency-dollar"></i>Toplam Gider (USD)</div>
      <div class="gd-kpi-value gd-kpi-value--usd" title="$ ${_gdFull(usd)}"><span class="gd-kpi-cur">$</span>${_gdFull(usd)}</div>
    </div>`;
}

function ozInitRank(elId, rows, kind) {
  const max = Math.max(...rows.map(r => r.tl), 0);
  _ozRankState[elId] = { rows, page: 0, kind, max };
  ozDrawRank(elId);
}
function ozChangeRankPage(elId, delta) {
  const st = _ozRankState[elId];
  if (!st) return;
  const pages = Math.max(1, Math.ceil(st.rows.length / GD_RANK_PER));
  st.page = Math.min(pages - 1, Math.max(0, st.page + delta));
  ozDrawRank(elId);
}
function ozGoRankPage(elId, page) {
  const st = _ozRankState[elId];
  if (!st) return;
  st.page = page;
  ozDrawRank(elId);
}
function ozDrawRank(elId) {
  const el = document.getElementById(elId);
  const st = _ozRankState[elId];
  if (!el || !st) return;
  const { rows, page, kind, max } = st;
  const pager = document.getElementById('gdPager_' + elId);

  if (!rows.length) {
    el.innerHTML = '<div class="gd-state">Kayıt bulunamadı.</div>';
    if (pager) pager.style.display = 'none';
    return;
  }

  const pages = Math.max(1, Math.ceil(rows.length / GD_RANK_PER));
  const start = page * GD_RANK_PER;
  const slice = rows.slice(start, start + GD_RANK_PER);
  const fillCls = kind === 'co' ? ' gd-rank-bar-fill--co' : '';

  el.innerHTML = '<div class="gd-rank">' + slice.map((r, i) => {
    const rank  = start + i + 1;
    const width = max ? (r.tl / max) * 100 : 0;
    return `
      <div class="gd-rank-row">
        <div class="gd-rank-top">
          <span class="gd-rank-name"><span class="gd-rank-idx">${rank}.</span>${_gdEsc(r.name)}</span>
          <span class="gd-rank-val"><small>₺</small> ${_gdCompact(r.tl)}</span>
        </div>
        <div class="gd-rank-bar"><div class="gd-rank-bar-fill${fillCls}" style="width:${width.toFixed(1)}%"></div></div>
      </div>`;
  }).join('') + '</div>';

  if (pager) {
    pager.style.display = pages > 1 ? 'flex' : 'none';
    const to = Math.min(start + GD_RANK_PER, rows.length);
    const info = document.getElementById('gdInfo_' + elId);
    if (info) info.textContent = `${start + 1}–${to} / ${rows.length}`;
    pager.querySelector('.gd-rank-pg-btn:first-child').disabled = page === 0;
    pager.querySelector('.gd-rank-pg-btn:last-child').disabled  = page >= pages - 1;
    const dots = document.getElementById('gdDots_' + elId);
    if (dots) dots.innerHTML = pages <= 6
      ? Array.from({ length: pages }, (_, p) =>
          `<span class="gd-rank-pg-dot${p === page ? ' gd-rank-pg-dot--active' : ''}" onclick="ozGoRankPage('${elId}',${p})"></span>`).join('')
      : '';
  }
}
async function ozLoadSeries() {
  try {
    const res = await fetch(`${GD_API}/value-series?` + _ozParams({ granularity: 'month' }).toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    ozRenderChart(data.points || []);
  } catch (e) {
    console.error('Chart yüklenemedi:', e.message);
  }
}
function _ozLabel(period) {
  const [y, m] = String(period).split('-');
  const mi = parseInt(m) - 1;
  return (mi >= 0 && mi < 12) ? `${GD_MONTHS_TR[mi]} ${String(y).slice(2)}` : period;
}
function ozRenderChart(points) {
  const canvas = document.getElementById('gdChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const labels = points.map(p => _ozLabel(p.period));
  const tl     = points.map(p => p.total_tl || 0);

  const cfg = {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Harcama (TL)', data: tl,
      borderColor: '#9a6318', backgroundColor: 'rgba(154,99,24,0.10)',
      borderWidth: 2, fill: true, tension: 0.3,
      pointRadius: 2.5, pointHoverRadius: 5, pointBackgroundColor: '#9a6318',
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0e0d0b',
          titleFont: { family: 'DM Sans', size: 12, weight: '700' },
          bodyFont: { family: 'DM Mono', size: 11 }, padding: 10, cornerRadius: 8,
          callbacks: { label: (ctx) => ` ₺ ${_gdFull(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#6b675f', font: { family: 'DM Mono, monospace', size: 10 }, maxRotation: 0, autoSkipPadding: 12 } },
        y: { beginAtZero: true, grid: { color: 'rgba(14,13,11,0.06)' }, ticks: { color: '#9a6318', font: { family: 'DM Mono, monospace', size: 10 }, callback: v => '₺' + _gdCompact(v) } },
      },
    },
  };
  if (_ozChart) { _ozChart.data = cfg.data; _ozChart.options = cfg.options; _ozChart.update(); }
  else          { _ozChart = new Chart(canvas.getContext('2d'), cfg); }
}

