let _lastGidenSeries = [];
let _lastGelenSeries = [];
const _token = sessionStorage.getItem('inokas_token');
const _hdrs  = _token ? { 'x-auth-token': _token } : {};

let _gbHistory  = [];
let _gbLoading  = false;
let _gbStarted  = false;

const _fmt = n => (parseFloat(n)||0).toLocaleString('tr-TR', { minimumFractionDigits:0, maximumFractionDigits:0 });
const _fmtK = n => {
  n = parseFloat(n)||0;
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n/1000).toFixed(0) + 'K';
  return n.toFixed(0);
};

// ── PERIOD STATE ───────────────────────────────────────────────────────────
let _periodMode   = 'all';   // 'all' | 'week' | 'month' | 'year'
let _periodOffset = 0;       // 0 = current, -1 = one back, etc.
let _lineChart    = null;

function getPeriodDates() {
  const now = new Date();
  if (_periodMode === 'all') return { start: null, end: null, bucket: 'month' };

  if (_periodMode === 'week') {
    const day    = now.getDay() || 7;
    const monday = new Date(now); monday.setDate(now.getDate() - (day - 1) + (_periodOffset * 7));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    return {
      start:  monday.toISOString().slice(0,10),
      end:    sunday > now ? now.toISOString().slice(0,10) : sunday.toISOString().slice(0,10),
      bucket: 'week',
      label:  `${monday.toLocaleDateString('tr-TR', {day:'2-digit', month:'2-digit'})} → ${sunday.toLocaleDateString('tr-TR', {day:'2-digit', month:'2-digit'})}`,
    };
  }

  if (_periodMode === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() + _periodOffset, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
      start:  d.toISOString().slice(0,10),
      end:    end > now ? now.toISOString().slice(0,10) : end.toISOString().slice(0,10),
      bucket: 'month',
      label:  d.toLocaleDateString('tr-TR', { month:'long', year:'numeric' }),
    };
  }

  if (_periodMode === 'year') {
    const y   = now.getFullYear() + _periodOffset;
    const end = new Date(y, 11, 31);
    return {
      start:  `${y}-01-01`,
      end:    end > now ? now.toISOString().slice(0,10) : `${y}-12-31`,
      bucket: 'year',
      label:  String(y),
    };
  }
}

function setPeriodMode(mode) {
  _periodMode   = mode;
  _periodOffset = 0;

  document.querySelectorAll('.gb-period-tab').forEach(btn => {
    const map = { all:'Tüm Zamanlar', week:'Hafta', month:'Ay', year:'Yıl' };
    btn.classList.toggle('gb-period-tab--active', btn.textContent.trim() === map[mode]);
  });

  const nav = document.getElementById('gbPeriodNav');
  nav.style.display = mode === 'all' ? 'none' : 'flex';

  loadCashflow();
}

function navigatePeriod(dir) {
  const now    = new Date();
  const newOff = _periodOffset + dir;

  // Block future navigation
  if (dir > 0) {
    const test = getPeriodDatesAt(newOff);
    if (test.start > now.toISOString().slice(0,10)) return;
  }

  _periodOffset = newOff;

  // Disable next button at current period
  const next = document.getElementById('gbPeriodNext');
  if (next) next.style.opacity = _periodOffset >= 0 ? '0.3' : '1';

  loadCashflow();
}

function getPeriodDatesAt(offset) {
  const saved = _periodOffset;
  _periodOffset = offset;
  const result = getPeriodDates();
  _periodOffset = saved;
  return result;
}

// ── CASH FLOW ──────────────────────────────────────────────────────────────
async function loadCashflow() {
  document.getElementById('gbChartLoading').style.display = 'flex';
  try {
    const { start, end, bucket, label } = getPeriodDates();
    const params = new URLSearchParams();
    if (start) params.set('date_start', start);
    if (end)   params.set('date_end',   end);

    // Update period label
    const labelEl = document.getElementById('gbPeriodLabel');
    if (labelEl && label) labelEl.textContent = label;

    const [gidenRes, gelenRes] = await Promise.all([
      fetch(`/api/invoices/kpi-summary?direction=OUTGOING&${params}`, { headers: _hdrs }),
      fetch(`/api/invoices/kpi-summary?direction=INCOMING&${params}`, { headers: _hdrs }),
    ]);
    const [gidenData, gelenData] = await Promise.all([gidenRes.json(), gelenRes.json()]);

    renderAmounts(gidenData, gelenData);
    renderLineChart(gidenData, gelenData, bucket);
  } catch(e) {
    console.error('loadCashflow:', e);
  } finally {
    document.getElementById('gbChartLoading').style.display = 'none';
  }
}

function renderAmounts(gidenData, gelenData) {
  const src = _periodMode === 'all' ? 'totals' : 'current';
  const gidenTRY = gidenData[src]?.try_total || 0;
  const gelenTRY = gelenData[src]?.try_total || 0;
  const gidenUSD = gidenData[src]?.usd_total || 0;
  const gelenUSD = gelenData[src]?.usd_total || 0;

  document.getElementById('gbGidenTRY').textContent = '₺' + _fmt(gidenTRY);
  document.getElementById('gbGelenTRY').textContent = '₺' + _fmt(gelenTRY);
  document.getElementById('gbGidenUSD').textContent = gidenUSD > 0 ? '$' + _fmt(gidenUSD) : '';
  document.getElementById('gbGelenUSD').textContent = gelenUSD > 0 ? '$' + _fmt(gelenUSD) : '';
}

function renderLineChart(gidenData, gelenData, bucket) {
  _lastGidenSeries = gidenData.series || [];
  _lastGelenSeries = gelenData.series || [];

  const labels = _lastGidenSeries.map(b => {
    const d = new Date(b.period);
    if (bucket === 'month' || bucket === 'year') return d.toLocaleDateString('tr-TR', { month:'short', year: bucket === 'year' ? '2-digit' : undefined });
    return b.period.slice(5);
  });

  const gidenPts = _lastGidenSeries.map(b => b.try_total || 0);
  const gelenPts = _lastGidenSeries.map(b => {
    const match = _lastGelenSeries.find(g => g.period === b.period);
    return match ? (match.try_total || 0) : 0;
  });

  const canvas = document.getElementById('gbLineChart');
  if (!canvas) return;
  if (_lineChart) { _lineChart.destroy(); _lineChart = null; }

  document.getElementById('gbChartTooltip')?.remove();

  _lineChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Giden', data:gidenPts, borderColor:'#0e0d0b', backgroundColor:'rgba(14,13,11,0.07)', borderWidth:2, fill:true, tension:0.4, pointRadius:3, pointBackgroundColor:'#0e0d0b', pointBorderColor:'#111827', pointBorderWidth:1.5 },
        { label:'Gelen', data:gelenPts, borderColor:'#9a6318', backgroundColor:'rgba(154,99,24,0.07)', borderWidth:2, fill:true, tension:0.4, pointRadius:3, pointBackgroundColor:'#9a6318', pointBorderColor:'#111827', pointBorderWidth:1.5 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend:  { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: { ticks:{ color:'#d4d0c8', font:{ size:10 } }, grid:{ color:'#e8e4db' } },
        y: { ticks:{ color:'#d4d0c8', font:{ size:10 }, callback: v => '₺'+_fmtK(v) }, grid:{ color:'#e8e4db' } }
      }
    }
  });

  const tooltipEl = document.createElement('div');
  tooltipEl.id = 'gbChartTooltip';
  tooltipEl.style.cssText = [
    'position:absolute', 'pointer-events:none', 'display:none',
    'background:rgba(245,242,236,0.05)', 'border:0.5px solid rgba(245,242,236,0.1)', 'border-radius:10px',
    'padding:12px 16px', 'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
    'z-index:100', 'min-width:130px',
  ].join(';');
  canvas.parentElement.style.position = 'relative';
  canvas.parentElement.appendChild(tooltipEl);

  canvas.addEventListener('mousemove', function(e) {
    const rect   = canvas.getBoundingClientRect();
    const points = _lineChart.getElementsAtEventForMode(e, 'index', { intersect: false }, true);
    if (!points.length) { tooltipEl.style.display = 'none'; return; }

    const idx      = points[0].index;
    const gidenTRY = _lineChart.data.datasets[0].data[idx] || 0;
    const gelenTRY = _lineChart.data.datasets[1].data[idx] || 0;
    const gidenUSD = _lastGidenSeries[idx]?.usd_total || 0;
    const gelenUSD = _lastGelenSeries[idx]?.usd_total || 0;

    const usdRow = (usd, color) => usd > 0
      ? `<div style="font-size:13px;font-weight:600;color:${color};opacity:0.7;">$${_fmt(usd)}</div>`
      : '';

    tooltipEl.innerHTML = `
      <div style="margin-bottom:10px;">
        <div style="font-size:16px;font-weight:700;color:#0e0d0b;">₺${_fmt(gidenTRY)}</div>
        ${usdRow(gidenUSD, '#3a3832')}
      </div>
      <div style="height:1px;background:#334155;margin-bottom:10px;"></div>
      <div>
        <div style="font-size:16px;font-weight:700;color:#9a6318;">₺${_fmt(gelenTRY)}</div>
        ${usdRow(gelenUSD, '#3a3832')}
      </div>
    `;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const tipW = 150;
    tooltipEl.style.left    = (x + tipW > rect.width ? x - tipW - 12 : x + 12) + 'px';
    tooltipEl.style.top     = Math.max(0, y - 20) + 'px';
    tooltipEl.style.display = 'block';
  });

  canvas.addEventListener('mouseleave', () => {
    tooltipEl.style.display = 'none';
  });
}

async function loadReport() {
  const el = document.getElementById('gbReport');
  el.innerHTML = `<div class="gb-report-loading"><div class="gb-spinner"></div><span style="font-size:12px;color:rgba(245,242,236,0.3);margin-top:8px;">Rapor hazırlanıyor...</span></div>`;

  try {
    const today = new Date();
    const fmt   = n => (parseFloat(n)||0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2});

    const [overdueRes, pendingRes, topCoRes, lastRes] = await Promise.all([
      fetch('/api/invoices?status=Unpaid&sort_by=due_date&sort_dir=asc&limit=100', { headers: _hdrs }),
      fetch('/api/invoices/pending', { headers: _hdrs }),
      fetch('/api/invoices/top-companies?limit=20', { headers: _hdrs }),
      fetch('/api/invoices?sort_by=invoice_date&sort_dir=desc&limit=1', { headers: _hdrs }),
    ]);

    const allOverdue = overdueRes.ok ? ((await overdueRes.json()).data || []).filter(inv => inv.due_date && new Date(inv.due_date) < today) : [];
    const pending    = pendingRes.ok ? (await pendingRes.json()) || [] : [];
    const topCos     = topCoRes.ok  ? (await topCoRes.json())   || [] : [];
    const lastInvArr = lastRes.ok   ? ((await lastRes.json()).data || []) : [];

    allOverdue.sort((a,b) => (parseFloat(b.payable_amount_tl)||0) - (parseFloat(a.payable_amount_tl)||0));
    const topOverdue = allOverdue[0];

    const overdueByCompany = {};
    allOverdue.forEach(inv => {
      const name = inv.companies?.name || '—';
      if (!overdueByCompany[name]) overdueByCompany[name] = { name, overdue_tl: 0, count: 0 };
      overdueByCompany[name].overdue_tl += parseFloat(inv.payable_amount_tl) || 0;
      overdueByCompany[name].count++;
    });
    const kritikFirmalar = Object.values(overdueByCompany).sort((a,b) => b.overdue_tl - a.overdue_tl);
    const topKritik  = kritikFirmalar[0];
    const topKritikCo = topCos.find(c => c.name === topKritik?.name);
    const topPending = pending[0];
    const lastInv    = lastInvArr[0];

    const overdueMsg = allOverdue.length > 0
      ? `${allOverdue.length} vadesi geçmiş fatura var. ${topOverdue?.companies?.name || ''} en kritik — ${Math.floor((today - new Date(topOverdue?.due_date)) / 86400000)} gün gecikmiş.`
      : 'Vadesi geçmiş fatura yok.';
    const pendingMsg = pending.length > 0 ? ` ${pending.length} fatura onay bekliyor.` : '';
    const summaryMsg = overdueMsg + pendingMsg;

    el.innerHTML = `

      ${topOverdue ? `
      <div class="gb-report-section" style="border-color:rgba(184,50,50,0.2);">
        <div class="gb-report-section-title">
          <i class="ti ti-alert-circle" style="font-size:13px; color:#b83232;" aria-hidden="true"></i>
          Vadesi Geçmiş
          <span class="gb-report-badge" style="color:#b83232; background:rgba(184,50,50,0.1); margin-left:auto;">${allOverdue.length} fatura</span>
        </div>
        <div class="gb-report-row">
          <div class="gb-report-row-main">
            <span class="gb-report-row-name">${(topOverdue.companies?.name || '—').slice(0,30)}</span>
            <span class="gb-report-row-badge" style="color:#b83232;">En kritik · ${Math.floor((today - new Date(topOverdue.due_date)) / 86400000)} gün</span>
          </div>
          <span class="gb-report-row-amount" style="color:rgba(245,242,236,0.7);">₺${fmt(topOverdue.payable_amount_tl)}</span>
        </div>
      </div>` : ''}

      ${topKritik ? `
      <div class="gb-report-section">
        <div class="gb-report-section-title">
          <i class="ti ti-building" style="font-size:13px; color:rgba(245,242,236,0.2);" aria-hidden="true"></i>
          Kritik Firmalar
          <span class="gb-report-badge" style="color:rgba(245,242,236,0.35); background:rgba(245,242,236,0.06); margin-left:auto;">${kritikFirmalar.length} firma</span>
        </div>
        <div class="gb-report-row">
          <div class="gb-report-row-main">
            <span class="gb-report-row-name">${topKritik.name.slice(0,30)}</span>
            <span class="gb-report-row-badge" style="color:rgba(245,242,236,0.25);">En yüksek hacim${topKritikCo ? ' · ₺' + _fmtK(topKritikCo.total) : ''}</span>
          </div>
          <span class="gb-report-row-amount" style="color:rgba(245,242,236,0.5);">₺${_fmtK(topKritik.overdue_tl)} gecikmiş</span>
        </div>
      </div>` : ''}

      ${topPending ? `
      <div class="gb-report-section">
        <div class="gb-report-section-title">
          <i class="ti ti-clock" style="font-size:13px; color:rgba(245,242,236,0.2);" aria-hidden="true"></i>
          Onay Bekleyen
          <span class="gb-report-badge" style="color:rgba(245,242,236,0.35); background:rgba(245,242,236,0.06); margin-left:auto;">${pending.length} fatura</span>
        </div>
        <div class="gb-report-row">
          <div class="gb-report-row-main">
            <span class="gb-report-row-name">${(topPending.companies?.name || '—').slice(0,30)}</span>
            <span class="gb-report-row-badge" style="color:rgba(245,242,236,0.25);">${topPending.direction === 'INCOMING' ? 'Gelen' : 'Giden'} · ${topPending.invoice_no || '—'}</span>
          </div>
        </div>
      </div>` : ''}

      ${lastInv ? `
      <div style="background:rgba(245,242,236,0.04); border:0.5px solid rgba(245,242,236,0.08); border-radius:10px; padding:10px 14px; display:flex; align-items:center; gap:10px;">
        <i class="ti ti-circle-check" style="font-size:18px; color:#1a6b47; flex-shrink:0;" aria-hidden="true"></i>
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; color:rgba(245,242,236,0.6); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${(lastInv.companies?.name || '—').slice(0,30)}</div>
          <div style="font-size:11px; color:rgba(245,242,236,0.25); margin-top:1px; font-family:'DM Mono',monospace;">${(lastInv.invoice_date || '').slice(0,10)} · ₺${fmt(lastInv.payable_amount_tl)}</div>
        </div>
        <span style="font-size:10px; font-weight:500; color:#1a6b47; background:rgba(26,107,71,0.09); padding:2px 7px; border-radius:99px; flex-shrink:0; font-family:'DM Mono',monospace;">Son İşlem</span>
      </div>` : ''}

      ${!topOverdue && !topPending ? `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; color:rgba(245,242,236,0.25); padding:40px 0;">
        <i class="ti ti-circle-check" style="font-size:32px; color:#1a6b47;" aria-hidden="true"></i>
        <span style="font-size:13px;">Bekleyen kritik işlem yok</span>
      </div>` : ''}

      <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
        <div style="background:rgba(245,242,236,0.04); border:0.5px solid rgba(245,242,236,0.08); border-radius:10px 10px 10px 2px; padding:10px 14px; font-size:12px; color:rgba(245,242,236,0.45); line-height:1.6;">
          ${summaryMsg}
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          ${topOverdue ? `<button onclick="askReport('${(topOverdue.companies?.name||'').replace(/'/g,"\\'")} vadesi geçmiş faturaları')" class="gb-suggest-btn">Tüm vadesi geçmiş faturalar →</button>` : ''}
          ${topPending ? `<button onclick="askReport('Onay bekleyen faturaların detayını göster')" class="gb-suggest-btn">Onay bekleyen detayı →</button>` : ''}
          ${topKritik ? `<button onclick="askReport('${topKritik.name.replace(/'/g,"\\'")} hakkında rapor')" class="gb-suggest-btn">${topKritik.name.slice(0,25)} detayı →</button>` : ''}
        </div>
      </div>
    `;

  } catch(e) {
    console.error('loadReport:', e);
    el.innerHTML = '<div style="padding:20px; text-align:center; font-size:12px; color:rgba(245,242,236,0.25);">Rapor yüklenemedi</div>';
  }
}

function askReport(question) {
  const input = document.getElementById('chatInput');
  if (input) {
    input.value = question;
    input.focus();
  }
}

// ── COMPANIES ──────────────────────────────────────────────────────────────
async function loadCompanies() {
  try {
    const res  = await fetch('/api/invoices/top-companies', { headers: _hdrs });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.length) {
      document.getElementById('gbCompanies').innerHTML =
        '<div style="padding:20px; text-align:center; font-size:12px; color:#475569;">Veri bulunamadı</div>';
      return;
    }
    renderCompanies(data);
  } catch(e) {
    console.error('loadCompanies:', e);
    document.getElementById('gbCompanies').innerHTML =
      '<div style="padding:20px; text-align:center; font-size:12px; color:#475569;">Yüklenemedi</div>';
  }
}

let _companyPage = 0;
let _allCompanies = [];
const _companyPerPage = 3;

function renderCompanies(companies) {
  _allCompanies = companies;
  _companyPage  = 0;
  renderCompanyPage();
}

function renderCompanyPage() {
  const totalPages = Math.ceil(_allCompanies.length / _companyPerPage);
  const slice      = _allCompanies.slice(_companyPage * _companyPerPage, (_companyPage + 1) * _companyPerPage);
  const maxTotal   = Math.max(..._allCompanies.map(c => c.total), 1);

  const initials = name => {
    const words = name.trim().split(/\s+/);
    return (words[0]?.[0] || '') + (words[1]?.[0] || words[0]?.[1] || '');
  };

  const colors     = ['rgba(14,13,11,0.06)','rgba(14,13,11,0.06)','rgba(14,13,11,0.06)',
                      'rgba(14,13,11,0.06)','rgba(14,13,11,0.06)','rgba(14,13,11,0.06)',
                      'rgba(14,13,11,0.06)','rgba(14,13,11,0.06)','rgba(14,13,11,0.06)'];
  const textColors = ['#3a3832','#3a3832','#3a3832','#3a3832','#3a3832','#3a3832','#3a3832','#3a3832','#3a3832'];

  const el = document.getElementById('gbCompanies');

  // Update pagination controls
  document.getElementById('gbCompanyPrev').onclick      = () => { _companyPage = (_companyPage - 1 + totalPages) % totalPages; fadeCompanyPage(); };
  document.getElementById('gbCompanyNext').onclick      = () => { _companyPage = (_companyPage + 1) % totalPages; fadeCompanyPage(); };
  document.getElementById('gbCompanyIndicator').textContent = `${_companyPage + 1} / ${totalPages}`;

  el.style.opacity = '1';
  el.innerHTML = slice.map((c, i) => {
    const globalI  = _companyPage * _companyPerPage + i;
    const giden    = c.giden_tl || c.giden || 0;
    const gelen    = c.gelen_tl || c.gelen || 0;
    const gidenPct = (giden / maxTotal * 100).toFixed(1);
    const gelenPct = (gelen / maxTotal * 100).toFixed(1);
    const isLast   = i === slice.length - 1;
    return `
    <div style="flex:1; display:flex; align-items:center; gap:14px; ${isLast ? '' : 'border-bottom:1px solid #1a2535;'}">
      <div style="width:36px; height:36px; border-radius:9px; background:${colors[globalI % colors.length]}; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:${textColors[globalI % textColors.length]}; flex-shrink:0;">${initials(c.name).toUpperCase()}</div>
      <div style="flex:1; min-width:0;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;">
          <span style="font-size:13px; color:#080a0c; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:fit-content;">${c.name}</span>
          <span style="font-size:13px; font-weight:700; color:#f1f5f9; flex-shrink:0; margin-left:8px;">₺${_fmtK(c.total)}</span>
        </div>
        <div style="height:6px; background:#e4dfd4; border-radius:99px; overflow:hidden; display:flex; gap:1px;">
          <div style="width:${gidenPct}%; background:#0e0d0b; border-radius:99px; cursor:default;" data-giden="₺${_fmtK(giden)}"></div>
          <div style="width:${gelenPct}%; background:#9a6318; cursor:default;" data-gelen="₺${_fmtK(gelen)}"></div>
        </div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('gbCompanyTooltip')?.remove();

  const tip = document.createElement('div');
  tip.id = 'gbCompanyTooltip';
  tip.style.cssText = [
    'position:fixed', 'pointer-events:none', 'display:none',
    'background:rgba(245,242,236,0.05)', 'border:0.5px solid rgba(245,242,236,0.1)', 'border-radius:10px',
    'padding:10px 14px', 'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
    'z-index:200',
  ].join(';');
  document.body.appendChild(tip);

  document.querySelectorAll('[data-giden], [data-gelen]').forEach(bar => {
    bar.addEventListener('mouseenter', e => {
      const isGiden = bar.style.background === 'rgb(59, 130, 246)';
      const val     = isGiden ? bar.dataset.giden : bar.dataset.gelen;
      const color   = isGiden ? '#3a3832' : '#3a3832';
      const label   = isGiden ? 'Giden' : 'Gelen';
      tip.innerHTML = `
        <div style="font-size:11px;font-weight:600;color:${color};margin-bottom:3px;">${label}</div>
        <div style="font-size:15px;font-weight:700;color:${color};">${val}</div>
      `;
      tip.style.display = 'block';
    });
    bar.addEventListener('mousemove', e => {
      tip.style.left = (e.clientX + 12) + 'px';
      tip.style.top  = (e.clientY - 40) + 'px';
    });
    bar.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
    });
  });
}

function fadeCompanyPage() {
  const el = document.getElementById('gbCompanies');
  el.style.opacity = '0';
  setTimeout(() => renderCompanyPage(), 150);
}


async function gbSendMessage() {
  const input   = document.getElementById('chatInput');
  const message = (input?.value || '').trim();
  if (!message || _gbLoading) return;
  input.value = '';

  if (!_gbStarted) {
    _gbStarted = true;
    document.getElementById('gbReport').style.display      = 'none';
    document.getElementById('gbChatMessages').style.display = 'flex';
  }

  const msgs = document.getElementById('gbChatMessages');

  const userEl = document.createElement('div');
  userEl.style.cssText = 'display:flex; justify-content:flex-end;';
  userEl.innerHTML = `<div style="background:rgba(245,242,236,0.1); color:rgba(245,242,236,0.85); padding:9px 13px; border-radius:12px 12px 2px 12px; font-size:13px; line-height:1.55; max-width:85%;">${message}</div>`;
  msgs.appendChild(userEl);
  msgs.scrollTop = msgs.scrollHeight;

  const typingEl = document.createElement('div');
  typingEl.style.cssText = 'display:flex; gap:5px; padding:10px 13px; background:rgba(245,242,236,0.05); border:0.5px solid rgba(245,242,236,0.08); border-radius:12px 12px 12px 2px; width:fit-content;';
  typingEl.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:rgba(245,242,236,0.3);animation:chat-bounce 1.2s infinite;"></span><span style="width:7px;height:7px;border-radius:50%;background:rgba(245,242,236,0.3);animation:chat-bounce 1.2s infinite;animation-delay:0.2s;"></span><span style="width:7px;height:7px;border-radius:50%;background:rgba(245,242,236,0.3);animation:chat-bounce 1.2s infinite;animation-delay:0.4s;"></span>`;
  msgs.appendChild(typingEl);
  msgs.scrollTop = msgs.scrollHeight;

  _gbLoading = true;
  document.getElementById('chatSendBtn').disabled = true;

  let streamedText = '';
  let bubbleEl     = null;

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, history: _gbHistory })
    });
    if (!res.ok) throw new Error('Sunucu hatası');

    typingEl.remove();

    const aEl = document.createElement('div');
    aEl.style.cssText = 'display:flex; flex-direction:column; gap:4px; align-items:flex-start;';
    bubbleEl = document.createElement('div');
    bubbleEl.style.cssText = 'background:rgba(245,242,236,0.05); color:rgba(245,242,236,0.65); border:0.5px solid rgba(245,242,236,0.08); padding:10px 13px; border-radius:12px 12px 12px 2px; font-size:13px; line-height:1.6; max-width:90%;';
    aEl.appendChild(bubbleEl);
    msgs.appendChild(aEl);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      let eventType = null, dataLine = null;
      for (const line of lines) {
        if (line.startsWith('event: '))      eventType = line.slice(7).trim();
        else if (line.startsWith('data: '))  dataLine  = line.slice(6).trim();
        else if (line === '' && eventType && dataLine) {
          try {
            const data = JSON.parse(dataLine);
            if (eventType === 'token') {
              streamedText += data.text || '';
              bubbleEl.innerHTML = simpleMarkdown(streamedText);
              msgs.scrollTop = msgs.scrollHeight;
            } else if (eventType === 'done') {
              if (data.assistant_message) {
                _gbHistory.push({ role: 'user', content: message });
                _gbHistory.push(data.assistant_message);
                if (_gbHistory.length > 20) _gbHistory = _gbHistory.slice(-20);
              }
              if (data.tables?.length) {
                const tablesHtml = data.tables.map(t => `
                  <div style="margin-top:10px; background:rgba(245,242,236,0.03); border:0.5px solid rgba(245,242,236,0.08); border-radius:8px; overflow:hidden;">
                    ${t.title ? `<div style="padding:8px 12px; font-size:11px; font-weight:500; color:rgba(245,242,236,0.3); border-bottom:0.5px solid rgba(245,242,236,0.07); text-transform:uppercase; letter-spacing:0.04em; font-family:'DM Mono',monospace;">${t.title}</div>` : ''}
                    <div style="overflow-x:auto;">
                      <table style="width:100%; border-collapse:collapse; font-size:12px;">
                        <thead><tr>${t.headers.map(h => `<th style="padding:8px 12px; text-align:left; color:rgba(245,242,236,0.3); font-weight:500; font-size:11px; border-bottom:0.5px solid rgba(245,242,236,0.07); white-space:nowrap; font-family:'DM Mono',monospace;">${h}</th>`).join('')}</tr></thead>
                        <tbody>${t.rows.map(row => `<tr style="border-top:0.5px solid rgba(245,242,236,0.05);">${row.map(cell => `<td style="padding:8px 12px; color:rgba(245,242,236,0.6);">${cell}</td>`).join('')}</tr>`).join('')}</tbody>
                      </table>
                    </div>
                  </div>`).join('');
                if (bubbleEl) bubbleEl.innerHTML += tablesHtml;
              }
              if (data.pdfs?.length) {
                const pdfsHtml = data.pdfs.map(p => `
                  <a href="${p.pdf_url}" target="_blank" style="display:flex; align-items:center; gap:10px; margin-top:8px; padding:10px 12px; background:rgba(245,242,236,0.04); border:0.5px solid rgba(245,242,236,0.08); border-radius:8px; text-decoration:none; transition:border-color 0.15s;"
                     onmouseover="this.style.borderColor='rgba(245,242,236,0.25)'" onmouseout="this.style.borderColor='rgba(245,242,236,0.08)'">
                    <i class="ti ti-file-type-pdf" style="font-size:20px; color:#b83232; flex-shrink:0;" aria-hidden="true"></i>
                    <div style="flex:1; min-width:0;">
                      <div style="font-size:12px; font-weight:500; color:rgba(245,242,236,0.7); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.invoice_no || '—'}</div>
                      <div style="font-size:11px; color:rgba(245,242,236,0.3); margin-top:1px; font-family:'DM Mono',monospace;">${p.company || ''} · ${p.amount || ''} ${p.currency || ''}</div>
                    </div>
                    <i class="ti ti-external-link" style="font-size:14px; color:rgba(245,242,236,0.25); flex-shrink:0;" aria-hidden="true"></i>
                  </a>`).join('');
                if (bubbleEl) bubbleEl.innerHTML += pdfsHtml;
              }
            } else if (eventType === 'error') {
              bubbleEl.innerHTML = `<span style="color:#b83232;">⚠️ ${data.text}</span>`;
            }
          } catch(e) {}
          eventType = null; dataLine = null;
        }
      }
    }

  } catch(err) {
    typingEl.remove();
    const errEl = document.createElement('div');
    errEl.style.cssText = 'background:rgba(184,50,50,0.08); border:0.5px solid rgba(184,50,50,0.2); border-radius:10px; padding:9px 13px; font-size:12px; color:#b83232;';
    errEl.textContent = err.message;
    msgs.appendChild(errEl);
  } finally {
    _gbLoading = false;
    document.getElementById('chatSendBtn').disabled = false;
    msgs.scrollTop = msgs.scrollHeight;
    input?.focus();
  }
}function simpleMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code style="background:#0f172a;padding:1px 5px;border-radius:4px;font-size:12px;color:#7dd3fc;">$1</code>')
    .replace(/^- (.+)$/gm, '<div style="display:flex;gap:6px;margin:2px 0;"><span style="color:#475569;flex-shrink:0;">·</span><span>$1</span></div>')
    .replace(/\n/g, '<br>');
}
// ── AUTO-START CHAT ────────────────────────────────────────────────────────
window._CHAT_AUTOSTART = null; // disabled — we use our own report panel
// ── INIT ───────────────────────────────────────────────────────────────────



document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chatSendBtn').addEventListener('click', gbSendMessage);
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gbSendMessage(); }
  });
  loadCashflow();
  loadCompanies();
  loadReport();
});