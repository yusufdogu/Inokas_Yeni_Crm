// ── TAB STATE ────────────────────────────────────────────────────────────────
let _activeMainTab  = 'genel';
let _activeBekTab   = 'genel';

// ── LOADING OVERLAY ──────────────────────────────────────────────────────────
function showLoadingOverlay() {
  const overlay = document.getElementById('fatLoadingOverlay');
  const spinner = document.getElementById('fatLoadingSpinner');
  if (!overlay) return;
  overlay.style.background = 'rgba(248,250,252,0.65)';
  overlay.style.backdropFilter = 'blur(3px)';
  overlay.style.pointerEvents = 'all';
  spinner.style.opacity = '1';
  spinner.style.animation = 'fat-spin 0.7s linear infinite';
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('fatLoadingOverlay');
  const spinner = document.getElementById('fatLoadingSpinner');
  if (!overlay) return;
  overlay.style.background = 'rgba(248,250,252,0)';
  overlay.style.backdropFilter = 'blur(0px)';
  overlay.style.pointerEvents = 'none';
  spinner.style.opacity = '0';
  spinner.style.animation = '';
}

// ── MAIN TAB SWITCHER ────────────────────────────────────────────────────────
function switchMainTab(tab) {
  _activeMainTab = tab;
  history.replaceState(null, '', `?tab=${tab}`);

  document.querySelectorAll('.fat-nav-tab').forEach(btn => btn.classList.remove('fat-nav-tab--active'));
  const tabId = { genel: 'navTabGenel', gelen: 'navTabGelen', giden: 'navTabGiden', bekleyen: 'navTabBekleyen' }[tab];
  document.getElementById(tabId)?.classList.add('fat-nav-tab--active');

  const isGenel    = tab === 'genel';
  const isBekleyen = tab === 'bekleyen';
  const isListTab  = tab === 'gelen' || tab === 'giden' || isBekleyen;

  document.getElementById('fatFilterBar').style.display = (isGenel || isBekleyen) ? 'none' : '';
  document.getElementById('fatSubTabBar').style.display = isBekleyen ? '' : 'none';
  document.getElementById('panelGenel').style.display   = isGenel   ? '' : 'none';
  document.getElementById('panelList').style.display    = isListTab ? '' : 'none';

  // ← show/hide instead of remove
  const kpiBar = document.getElementById('fatKpiBar');
  if (kpiBar) kpiBar.style.display = isGenel ? 'none' : 'flex';

  if (isGenel) {
    document.getElementById('fatPagination')?.remove();
    const iframe = document.getElementById('genelBakisFrame');
    if (iframe && !iframe.getAttribute('src')) {
      iframe.src = '/faturalar/pages/genel-bakis.html';
    }
    return;
  }

  if (isBekleyen) {
    window._FAT_PENDING = true;
    loadBekleyenCounts();
    switchBekleyenTab('giden'); // ← delegates everything cleanly
    return; // switchBekleyenTab calls refreshData itself
  } else {
    window._FAT_PENDING = false;
    currentView = tab;
  }

  window._filterOptionsLoaded = false;
  _currentPage = 1;
  showLoadingOverlay();
  refreshData(false);
}
async function loadBekleyenCounts() {
  try {
    const res  = await fetch('/api/invoices/pending');
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || []);
    const gelenCount = list.filter(i => i.direction === 'INCOMING').length;
    const gidenCount = list.filter(i => i.direction === 'OUTGOING').length;
    const gelenBadge = document.getElementById('subTabBekGelenCount');
    const gidenBadge = document.getElementById('subTabBekGidenCount');
    if (gelenBadge) gelenBadge.textContent = gelenCount || '';
    if (gidenBadge) gidenBadge.textContent = gidenCount || '';
  } catch(e) {}
}

function switchBekleyenTab(sub) {
  _activeBekTab = sub;
  document.getElementById('subTabBekGelen')?.classList.remove('fat-sub-tab--active');
  document.getElementById('subTabBekGiden')?.classList.remove('fat-sub-tab--active');
  document.getElementById(sub === 'gelen' ? 'subTabBekGelen' : 'subTabBekGiden')?.classList.add('fat-sub-tab--active');

  currentView = sub;
  window._FAT_PENDING = true;
  window._filterOptionsLoaded = false;
  _currentPage = 1;
  showLoadingOverlay();
  refreshData(false);
}

document.addEventListener('DOMContentLoaded', () => {
  const tab = new URLSearchParams(location.search).get('tab') || 'genel';
  switchMainTab(tab);
});


function updateKpiSummary(data) {
  const bar = document.getElementById('fatKpiBar');
  if (!bar) return;

  // Don't show on genel tab or if no tab is active yet
  const isGenel = _activeMainTab === 'genel';
  bar.style.display = isGenel ? 'none' : 'flex';
  if (isGenel) return;

  const totals  = data?.totals   || {};
  const current = data?.current  || {};
  const prev    = data?.previous || {};
  const label   = data?.comparison_label || '';

  const fmtTRY = n => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n || 0);
  const fmtUSD = n => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);

  function delta(curr, prev) {
    if (!prev || prev === 0) return null;
    const pct  = ((curr - prev) / prev) * 100;
    const sign = pct >= 0 ? '▲' : '▼';
    const cls  = pct >= 0 ? 'fat-kpi-delta--up' : 'fat-kpi-delta--down';
    return { text: `${sign} ${Math.abs(pct).toFixed(1)}% ${label}`, cls };
  }

  function setCard(valueId, deltaId, value, d) {
    const vel = document.getElementById(valueId);
    const del = document.getElementById(deltaId);
    if (vel) vel.textContent = value;
    if (del) {
      del.textContent = d ? d.text : '';
      del.className   = 'fat-kpi-delta' + (d ? ' ' + d.cls : '');
    }
  }

  const tryCount   = totals.try_count || 0;
  const usdCount   = totals.usd_count || 0;
  const totalCount = tryCount + usdCount;
  const avgTRY     = tryCount ? (totals.try_total / tryCount) : 0;

  const prevCount = (prev.try_count    || 0) + (prev.usd_count    || 0);
  const currCount = (current.try_count || 0) + (current.usd_count || 0);
  const prevAvg   = prev.try_count    ? (prev.try_total    / prev.try_count)    : 0;
  const currAvg   = current.try_count ? (current.try_total / current.try_count) : 0;

  setCard('kpiCount',    'kpiCountDelta', totalCount.toLocaleString('tr-TR'), delta(currCount,          prevCount));
  setCard('kpiTryTotal', 'kpiTryDelta',   fmtTRY(totals.try_total),          delta(current.try_total,  prev.try_total));
  setCard('kpiUsdTotal', 'kpiUsdDelta',   fmtUSD(totals.usd_total),          delta(current.usd_total,  prev.usd_total));
  setCard('kpiAvgTry',   'kpiAvgDelta',   fmtTRY(avgTRY),                    delta(currAvg,            prevAvg));
}