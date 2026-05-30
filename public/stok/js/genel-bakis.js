// ── genel-bakis.js — Stok Genel Bakış ────────────────────────────────────────
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const LOW_STOCK_THRESHOLD = 10;
const PAGE_SIZE           = 3;

// ── State ─────────────────────────────────────────────────────────────────────
let _movements        = [];
let _internalSkus     = new Set();
let _urunRanking      = [];
let _innerMode        = 'urun';  // 'urun'
let _innerPage        = 0;
let _period           = 'month';  // 'week' | 'month' | 'year'
let _chatHistory      = [];
let _chatLoading      = false;
let _chartInstance=null;
let _periodOffset=0;

let allProducts = [];


// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Promise.all([loadSummary(), loadMovements()]);
  bindChatInput();
});

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadSummary() {
  try {
    const productsRes  = await fetch('/api/products');
    if (!productsRes.ok) throw new Error();
    allProducts = await productsRes.json();

    renderHero(allProducts);
    loadAsistanReport(allProducts);
  } catch (err) {
    console.error('Stok özet yüklenemedi:', err);
    document.getElementById('gbHeroTL').textContent = 'Yüklenemedi';
    document.getElementById('gbAsistanBody').innerHTML = '<span class="gb-error-text">Veri yüklenemedi.</span>';
  }
}

async function loadMovements() {
  try {
    const res  = await fetch('/api/stocks/movements');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _movements = (await res.json()) || [];

    // Filter out internal products
    _movements = _movements.filter(m => m.sku && !_internalSkus.has(m.sku));

    buildRankings();
    renderMovChart()
    renderInnerList();
  } catch (err) {
    console.error('Stok hareketleri yüklenemedi:', err);
    document.getElementById('gbChartWrap').innerHTML = '<div class="gb-empty">Grafik yüklenemedi.</div>';
    document.getElementById('gbInnerList').innerHTML  = '<div class="gb-empty">Veriler yüklenemedi.</div>';
  }
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function renderHero(data) {
  let totalTL  = 0;
  let totalUSD = 0;

  data.forEach(r => {
    const stock       = Number(r.stock_on_hand || 0);
    const avgTL       = Number(r.avg_purchase_price_tl || 0);
    const lastCur     = (r.last_purchase_currency || '').toUpperCase().trim();

    if (Math.floor(stock) > 0) {
      if ((lastCur === 'TRY' || lastCur === 'TL') && avgTL > 0) {
        totalTL+=stock * r.avg_purchase_price_tl
      } else if (lastCur === 'USD' && r.last_purchase_price_cur >0) {
        totalUSD += stock * r.last_purchase_price_cur;
      }
    }
  });

  document.getElementById('gbHeroTL').textContent =
    '₺' + Math.round(totalTL).toLocaleString('tr-TR');
  document.getElementById('gbHeroUSD').textContent =
    '$' + Math.round(totalUSD).toLocaleString('tr-TR');
}

// ── Rankings (built from movements) ──────────────────────────────────────────
function buildRankings() {
  // Firma ranking: sum all quantities (in + out) per company
  const urunMap  = {};


  _movements.forEach(m => {
    // inside the movements.forEach, replace the urunMap block:
    const key   = m.sku || m.product_name || '—';
    const label = m.product_name || m.sku  || '—';
    const qty   = Math.abs(Number(m.quantity || 0));

    if (!urunMap[key]) urunMap[key] = { name: label, sku: m.sku || '', qty: 0, in: 0, out: 0 };
    urunMap[key].qty += qty;
    if (m.direction === 'INCOMING') urunMap[key].in  += qty;
    else                            urunMap[key].out += qty;
  });


  _urunRanking = Object.values(urunMap)
    .sort((a, b) => b.qty - a.qty);
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function renderMovChart() {
  const canvas = document.getElementById('gbMovChart');
  if (!canvas) return;

  const buckets = buildBuckets(_movements, _period, _periodOffset);

  // Update period label
  const labelEl = document.getElementById('gbPeriodLabel');
  if (labelEl && buckets.length) {
    if (_period === 'month')     labelEl.textContent = buckets[0].label + ' – ' + buckets[buckets.length-1].label;
    else if (_period === 'year') labelEl.textContent = buckets[0].label + (buckets.length > 1 ? ' – ' + buckets[buckets.length-1].label : '');
    else                         labelEl.textContent = buckets[0].label + ' – ' + buckets[buckets.length-1].label;
  }

  // Update totals
  const totalIn  = buckets.reduce((s, b) => s + b.in,  0);
  const totalOut = buckets.reduce((s, b) => s + b.out, 0);
  const inEl  = document.getElementById('gbTotalIn');
  const outEl = document.getElementById('gbTotalOut');
  if (inEl)  inEl.textContent  = totalIn.toLocaleString('tr-TR');
  if (outEl) outEl.textContent = totalOut.toLocaleString('tr-TR');

  if (_chartInstance) { _chartInstance.destroy(); _chartInstance = null; }

  if (!buckets.length) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  _chartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: buckets.map(b => b.label),
      datasets: [
        {
          label:       'Giriş',
          data:        buckets.map(b => b.in),
          borderColor: '#6e6a62',
          backgroundColor: 'rgba(110,106,98,0.08)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#6e6a62',
          tension: 0.4,
          fill: true,
        },
        {
          label:       'Çıkış',
          data:        buckets.map(b => b.out),
          borderColor: '#9a6318',
          backgroundColor: 'rgba(154,99,24,0.08)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#9a6318',
          tension: 0.4,
          fill: true,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0e0d0b',
          titleColor:      'rgba(245,242,236,0.5)',
          bodyColor:       'rgba(245,242,236,0.9)',
          padding:         8,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString('tr-TR')} adet`
          }
        }
      },
      scales: {
        x: {
          grid:  { color: 'rgba(14,13,11,0.05)' },
          ticks: { color: '#a8a39a', font: { size: 9, family: 'DM Mono' } },
        },
        y: {
          grid:  { color: 'rgba(14,13,11,0.05)' },
          ticks: { color: '#a8a39a', font: { size: 9, family: 'DM Mono' }, precision: 0 },
          beginAtZero: true,
        }
      }
    }
  });
}

function buildBuckets(movements, period, offset = 0) {
  const map = {};

  movements.forEach(m => {
    const date = m.invoice_date ? new Date(m.invoice_date) : null;
    if (!date || isNaN(date)) return;

    let key, label;
    if (period === 'week') {
      const weekStart = getWeekStart(date);
      key   = weekStart.toISOString().slice(0, 10);
      label = `${weekStart.getDate()}/${weekStart.getMonth() + 1}`;
    } else if (period === 'month') {
      key   = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      label = MONTHS_TR[date.getMonth()];
    } else {
      key   = String(date.getFullYear());
      label = key;
    }

    if (!map[key]) map[key] = { label, in: 0, out: 0 };
    const qty = Math.abs(Number(m.quantity || 0));
    if (m.direction === 'INCOMING') map[key].in  += qty;
    else                            map[key].out += qty;
  });

  const sorted = Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v);

  // Window size per period
  const window = period === 'week' ? 8 : period === 'month' ? 3 : 4;
  const total  = sorted.length;
  // offset 0 = most recent window, offset -1 = one step back, etc.
  const end    = total + offset;  // offset is 0 or negative
  const start  = Math.max(0, end - window);
  return sorted.slice(start, end);
}
function setPeriod(p) {
  _period = p;
  _periodOffset = 0;
  ['week','month','year'].forEach(id => {
    const el = document.getElementById(`ptab${id.charAt(0).toUpperCase() + id.slice(1)}`);
    if (el) el.classList.toggle('gb-ptab--active', id === p);
  });
  renderMovChart();
}
function navigatePeriod(dir) {
  _periodOffset += dir;
  renderMovChart();
}
const MONTHS_TR = ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];


function innerPageNav(dir) {
  const list       = _innerMode === 'urun' ? _urunRanking:'';
  const totalPages = Math.ceil(list.length / PAGE_SIZE);
  _innerPage = Math.max(0, Math.min(totalPages - 1, _innerPage + dir));
  renderInnerList();
}

function renderInnerList() {
  const container  = document.getElementById('gbInnerList');
  const list       = _urunRanking;
  const totalPages = Math.ceil(list.length / PAGE_SIZE) || 1;
  const start      = _innerPage * PAGE_SIZE;
  const pageItems  = list.slice(start, start + PAGE_SIZE);
  const maxTotal   = Math.max(...list.map(p => p.qty), 1);

  document.getElementById('gbPagerIndicator').textContent = `${_innerPage + 1}/${totalPages}`;
  document.getElementById('gbPagerPrev').disabled = _innerPage === 0;
  document.getElementById('gbPagerNext').disabled = _innerPage >= totalPages - 1;

  if (!pageItems.length) {
    container.innerHTML = '<div class="gb-empty">Veri yok.</div>';
    return;
  }

  const initials = name => {
    const w = name.trim().split(/\s+/);
    return ((w[0]?.[0] || '') + (w[1]?.[0] || w[0]?.[1] || '')).toUpperCase();
  };

  container.innerHTML = '';
  pageItems.forEach(item => {
    const inPct  = ((item.in  / maxTotal) * 100).toFixed(1);
    const outPct = ((item.out / maxTotal) * 100).toFixed(1);

    const row = document.createElement('div');
    row.className = 'gb-list-row';
    row.innerHTML = `
      <div class="gb-list-avatar">${initials(item.name)}</div>
      <div class="gb-list-info">
        <div class="gb-list-name">${escHtml(item.name)}</div>
        <div class="gb-list-sub">${escHtml(item.sku || '—')}</div>
        <div class="gb-list-bar-wrap">
          <div class="gb-list-bar-in"  style="width:${inPct}%;"  title="Giriş: ${item.in.toLocaleString('tr-TR')}"></div>
          <div class="gb-list-bar-out" style="width:${outPct}%;" title="Çıkış: ${item.out.toLocaleString('tr-TR')}"></div>
        </div>
      </div>
      <span class="gb-list-val">${item.qty.toLocaleString('tr-TR')}</span>`;
    container.appendChild(row);
  });
}

// ── Asistan Diyor ─────────────────────────────────────────────────────────────
function loadAsistanReport(data) {
  const el = document.getElementById('gbAsistanBody');
  const btns = document.getElementById('gbAsistanBtns');
  if (!el) return;

  try {
    const inStock  = data.filter(r => Number(r.current_stock) > 0);
    const today    = new Date();

    // ── Top value product ─────────────────────────────────────────────────────
    const byValue = inStock
      .map(r => ({
        name:    r.product_name || '—',
        sku:     r.sku || '',
        stock:   Number(r.current_stock || 0),
        valueTL: Number(r.current_stock || 0) * Number(r.avg_purchase_price_tl || 0),
        valueUSD: Number(r.stock_usd || 0),
      }))
      .sort((a, b) => b.valueTL - a.valueTL);

    const totalTL  = byValue.reduce((s, r) => s + r.valueTL, 0);
    const topVal   = byValue[0];
    const topPct   = totalTL > 0 && topVal ? Math.round((topVal.valueTL / totalTL) * 100) : 0;

    // ── Risk altında ──────────────────────────────────────────────────────────
    const riskItems = inStock
      .filter(r => Number(r.current_stock) > 0 && Number(r.current_stock) < LOW_STOCK_THRESHOLD)
      .sort((a, b) => Number(a.current_stock) - Number(b.current_stock));
    const worstRisk = riskItems[0];

    // ── Ölü stok ──────────────────────────────────────────────────────────────
    const deadItems = inStock.filter(r => Number(r.total_out || 0) === 0 && Number(r.total_in || 0) > 0);
    const deadTL    = deadItems.reduce((s, r) => s + Number(r.current_stock || 0) * Number(r.avg_purchase_price_tl || 0), 0);

    // ── Son hareket ───────────────────────────────────────────────────────────
    const lastMov = _movements
      .filter(m => m.invoice_date)
      .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date))[0];

    // ── Summary text ──────────────────────────────────────────────────────────
    const summaryParts = [];
    if (topVal && topPct >= 30) summaryParts.push(`Paranın %${topPct}'i tek üründe (${topVal.name.slice(0, 25)}) — yoğunlaşma riski var.`);
    if (riskItems.length > 0)   summaryParts.push(`${riskItems.length} ürün kritik stok altında.`);
    if (deadItems.length > 0)   summaryParts.push(`${deadItems.length} üründe hiç çıkış hareketi yok.`);
    const summaryText = summaryParts.join(' ') || 'Stok durumu normal görünüyor.';

    // ── Render ────────────────────────────────────────────────────────────────
    el.innerHTML = `

      ${topVal ? `
      <div class="gb-report-section">
        <div class="gb-report-section-title">
          <i class="ti ti-coin" style="font-size:13px;" aria-hidden="true"></i>
          En Yüksek Değer
          <span class="gb-report-badge" style="margin-left:auto;">${topPct}% toplam</span>
        </div>
        <div class="gb-report-row">
          <div class="gb-report-row-main">
            <span class="gb-report-row-name">${escHtml(topVal.name.slice(0, 32))}</span>
            <span class="gb-report-row-badge">${topVal.sku} · ${topVal.stock.toLocaleString('tr-TR')} adet</span>
          </div>
          <span class="gb-report-row-amount">₺${Math.round(topVal.valueTL).toLocaleString('tr-TR')}</span>
        </div>
      </div>` : ''}

      ${riskItems.length > 0 ? `
      <div class="gb-report-section" style="border-color:rgba(184,50,50,0.2);">
        <div class="gb-report-section-title">
          <i class="ti ti-alert-circle" style="font-size:13px; color:#b83232;" aria-hidden="true"></i>
          Risk Altında
          <span class="gb-report-badge" style="color:#b83232; background:rgba(184,50,50,0.1); margin-left:auto;">${riskItems.length} SKU</span>
        </div>
        <div class="gb-report-row">
          <div class="gb-report-row-main">
            <span class="gb-report-row-name">${escHtml((worstRisk.product_name || '—').slice(0, 32))}</span>
            <span class="gb-report-row-badge" style="color:#b83232;">En kritik · ${Number(worstRisk.current_stock)} adet kaldı</span>
          </div>
        </div>
      </div>` : ''}

      ${deadItems.length > 0 ? `
      <div class="gb-report-section">
        <div class="gb-report-section-title">
          <i class="ti ti-ghost" style="font-size:13px;" aria-hidden="true"></i>
          Ölü Stok
          <span class="gb-report-badge" style="margin-left:auto;">${deadItems.length} SKU</span>
        </div>
        <div class="gb-report-row">
          <div class="gb-report-row-main">
            <span class="gb-report-row-name">Hiç çıkış yapılmamış</span>
            <span class="gb-report-row-badge">Değer: ₺${Math.round(deadTL).toLocaleString('tr-TR')}</span>
          </div>
        </div>
      </div>` : ''}

      ${lastMov ? `
      <div class="gb-report-last">
        <i class="ti ti-circle-check" style="font-size:18px; color:#1a6b47; flex-shrink:0;" aria-hidden="true"></i>
        <div style="flex:1; min-width:0;">
          <div class="gb-report-last-name">${escHtml((lastMov.product_name || '—').slice(0, 32))}</div>
          <div class="gb-report-last-sub">${(lastMov.invoice_date || '').slice(0, 10)} · ${lastMov.direction === 'INCOMING' ? 'Giriş' : 'Çıkış'} · ${escHtml(lastMov.company_name || '—')}</div>
        </div>
        <span class="gb-report-last-badge">Son Hareket</span>
      </div>` : ''}

      <div class="gb-report-summary">${escHtml(summaryText)}</div>

      <div class="gb-report-suggests">
        ${riskItems.length > 0 ? `<button class="gb-suggest-btn" onclick="gbPrefill('Risk altındaki ürünleri listele')">Risk altındaki ürünler →</button>` : ''}
        ${deadItems.length > 0 ? `<button class="gb-suggest-btn" onclick="gbPrefill('Ölü stok listesini göster')">Ölü stoğu listele →</button>` : ''}
        ${topVal ? `<button class="gb-suggest-btn" onclick="gbPrefill('En değerli stokları listele')">En değerli stoklar →</button>` : ''}
      </div>`;

    btns.style.display = 'none';

  } catch(e) {
    console.error('loadAsistanReport:', e);
    el.innerHTML = '<span class="gb-error-text">Rapor yüklenemedi.</span>';
  }
}
// ── Chat ──────────────────────────────────────────────────────────────────────
function bindChatInput() {
  const input = document.getElementById('gbChatInput');
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); gbSend(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });
}

async function gbSend() {
  const input   = document.getElementById('gbChatInput');
  const message = (input?.value || '').trim();
  if (!message || _chatLoading) return;

  input.value        = '';
  input.style.height = 'auto';

  appendChatMsg('user', message);
  const typingId = appendTyping();
  _chatLoading = true;
  setSendDisabled(true);

  let bubbleEl = null;

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, history: _chatHistory }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    removeTyping(typingId);

    const msgs = document.getElementById('gbChatMessages');
    const wrap = document.createElement('div');
    wrap.className = 'gb-chat-msg gb-chat-msg--assistant';
    wrap.innerHTML  = '<div class="gb-chat-msg-label">AI Asistan</div>';
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'gb-chat-bubble';
    wrap.appendChild(bubbleEl);
    msgs.appendChild(wrap);
    gbScrollBottom();

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    let   streamed = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      let eventType = null, dataLine = null;
      for (const line of lines) {
        if (line.startsWith('event: '))     eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLine  = line.slice(6).trim();
        else if (line === '' && eventType && dataLine) {
          try {
            const data = JSON.parse(dataLine);
            if (eventType === 'token') {
              streamed += data.text || '';
              if (bubbleEl) bubbleEl.textContent = streamed;
              gbScrollBottom();
            } else if (eventType === 'done' && data.assistant_message) {
              _chatHistory.push({ role: 'user', content: message });
              _chatHistory.push(data.assistant_message);
              if (_chatHistory.length > 20) _chatHistory = _chatHistory.slice(-20);
            }
          } catch {}
          eventType = null; dataLine = null;
        }
      }
    }
  } catch (err) {
    removeTyping(typingId);
    appendChatMsg('assistant', '⚠️ ' + err.message);
  } finally {
    _chatLoading = false;
    setSendDisabled(false);
    document.getElementById('gbChatInput')?.focus();
  }
}

function gbAutoSend(text) {
  const input = document.getElementById('gbChatInput');
  if (input) input.value = text;
  gbSend();
}
function gbPrefill(text) {
  const input = document.getElementById('gbChatInput');
  if (input) { input.value = text; input.focus(); }
}
// ── Chat helpers ──────────────────────────────────────────────────────────────
function appendChatMsg(role, text) {
  const msgs = document.getElementById('gbChatMessages');
  if (!msgs) return;
  const wrap = document.createElement('div');
  wrap.className = `gb-chat-msg gb-chat-msg--${role}`;
  wrap.innerHTML = `
    <div class="gb-chat-msg-label">${role === 'user' ? 'Sen' : 'AI Asistan'}</div>
    <div class="gb-chat-bubble">${escHtml(text)}</div>`;
  msgs.appendChild(wrap);
  gbScrollBottom();
}

function appendTyping() {
  const msgs = document.getElementById('gbChatMessages');
  if (!msgs) return null;
  const id  = 'gb-typing-' + Date.now();
  const div = document.createElement('div');
  div.id        = id;
  div.className = 'gb-chat-msg gb-chat-msg--assistant';
  div.innerHTML = `
    <div class="gb-chat-msg-label">AI Asistan</div>
    <div class="gb-chat-typing">
      <div class="gb-typing-dot"></div>
      <div class="gb-typing-dot"></div>
      <div class="gb-typing-dot"></div>
    </div>`;
  msgs.appendChild(div);
  gbScrollBottom();
  return id;
}

function removeTyping(id)    { document.getElementById(id)?.remove(); }
function gbScrollBottom()    { const m = document.getElementById('gbChatMessages'); if (m) m.scrollTop = m.scrollHeight; }
function setSendDisabled(v)  { const b = document.getElementById('gbChatSend'); if (b) b.disabled = v; }
function escHtml(str)        { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }