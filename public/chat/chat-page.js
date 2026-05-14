// chat-page.js — İnokas CRM AI Asistan Full Page

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'inokas_chat_history_v1';
const MAX_HISTORY = 20; // messages kept in localStorage
let _isLoading    = false;
let _isRecording  = false;
let _recognition  = null;
let _charts       = {};  // Chart.js instances

// ─── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  showWelcome();
  loadDashboard();
  bindEvents();
  restoreHistory();
});

function bindEvents() {
  document.getElementById('chatSendBtn')?.addEventListener('click', sendMessage);
  document.getElementById('chatVoiceBtn')?.addEventListener('click', toggleVoice);

  const input = document.getElementById('chatInput');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }
}

// ─── Welcome screen ───────────────────────────────────────────────────────────
function showWelcome() {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  msgs.innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-logo">⚡</div>
      <h2>Merhaba!</h2>
      <p>Faturalar, stok, DMO siparişleri veya herhangi bir analiz hakkında soru sorabilirsiniz.</p>
    </div>`;
}

function newConversation() {
  // Destroy existing charts
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch {} });
  _charts = {};

  showWelcome();
  showDashboard();

  const input = document.getElementById('chatInput');
  if (input) { input.value = ''; input.style.height = 'auto'; input.focus(); }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 5000)
  );
  await Promise.allSettled([
    Promise.race([loadUnpaidStat(),        timeout]),
    Promise.race([loadPendingOrdersStat(), timeout]),
    Promise.race([loadLowStockStat(),      timeout]),
  ]);
}

async function loadUnpaidStat() {
  try {
    const res  = await fetch('/api/invoices');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const unpaid = (data || []).filter(inv =>
      inv.approval_status === 'approved' &&
      inv.direction === 'OUTGOING' &&
      inv.status !== 'paid'
    );
    const total = unpaid.reduce((s, inv) => s + (parseFloat(inv.payable_amount_tl) || 0), 0);
    setStatCard(0, {
      icon: 'ti-file-invoice',
      iconClass: 'chat-stat-icon-warn',
      label: 'Ödenmemiş Fatura',
      value: unpaid.length,
      sub: `₺${total.toLocaleString('tr-TR', { minimumFractionDigits: 0 })} toplam`,
    });
  } catch {
    setStatCard(0, { icon: 'ti-file-invoice', iconClass: 'chat-stat-icon-warn', label: 'Ödenmemiş Fatura', value: '—', sub: '' });
  }
}

async function loadPendingOrdersStat() {
  try {
    const res  = await fetch('/api/invoices/pending');
    if (!res.ok) throw new Error();
    const data = await res.json();
    setStatCard(1, {
      icon:      'ti-clock-hour-4',
      iconClass: 'chat-stat-icon-primary',
      label:     'Bekleyen Fatura',
      value:     (data || []).length,
      sub:       'onay bekliyor',
    });
  } catch {
    setStatCard(1, { icon: 'ti-clock-hour-4', iconClass: 'chat-stat-icon-primary', label: 'Bekleyen Fatura', value: '—', sub: '' });
  }
}

async function loadLowStockStat() {
  try {
    const res  = await fetch('/api/products');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const low  = (data || []).filter(p => parseFloat(p.stock_on_hand || 0) > 0 && parseFloat(p.stock_on_hand || 0) < 20);
    setStatCard(2, {
      icon: 'ti-package',
      iconClass: 'chat-stat-icon-danger',
      label: 'Düşük Stok',
      value: low.length,
      sub: 'stok < 20 olan ürün',
    });
  } catch {
    setStatCard(2, { icon: 'ti-package', iconClass: 'chat-stat-icon-danger', label: 'Düşük Stok', value: '—', sub: '' });
  }
}

function setStatCard(idx, { icon, iconClass, label, value, sub }) {
  const grid  = document.getElementById('chatStatGrid');
  if (!grid) return;
  const cards = grid.querySelectorAll('.chat-stat-card');
  if (!cards[idx]) return;
  cards[idx].innerHTML = `
    <div class="chat-stat-icon ${iconClass}"><i class="ti ${icon}"></i></div>
    <div class="chat-stat-info">
      <div class="chat-stat-label">${label}</div>
      <div class="chat-stat-value">${value}</div>
      ${sub ? `<div class="chat-stat-sub">${sub}</div>` : ''}
    </div>`;
  cards[idx].classList.remove('chat-stat-loading');
}

function showDashboard() {
  document.getElementById('chatDashboard').style.display = 'block';
  document.getElementById('chatResults').style.display   = 'none';
}

function showResults() {
  document.getElementById('chatDashboard').style.display = 'none';
  document.getElementById('chatResults').style.display   = 'block';
}

// ─── Suggestion click ─────────────────────────────────────────────────────────
function suggest(text) {
  const input = document.getElementById('chatInput');
  if (input) { input.value = text; input.style.height = 'auto'; }
  sendMessage();
}

// ─── Send message ─────────────────────────────────────────────────────────────
// ─── PATCH: Replace sendMessage() in chat-page.js with this ──────────────────

async function sendMessage() {
  const input   = document.getElementById('chatInput');
  const message = (input?.value || '').trim();
  if (!message || _isLoading) return;

  input.value        = '';
  input.style.height = 'auto';

  document.querySelector('.chat-welcome')?.remove();
  appendUserMessage(message);

  const typingId = appendTyping();
  _isLoading     = true;
  setSendDisabled(true);

  const history = getHistory();

  // Streaming state
  let streamedText      = '';
  let assistantMsgEl    = null;
  let assistantBubbleEl = null;
  let assistantMessage  = null;

  try {
    const response = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, history })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Sunucu hatası');
    }

    // Remove typing indicator, create assistant message container
    removeTyping(typingId);

    const msgs = document.getElementById('chatMessages');
    assistantMsgEl    = document.createElement('div');
    assistantMsgEl.className = 'chat-msg chat-msg-assistant';
    assistantMsgEl.innerHTML = '<div class="chat-msg-label">AI Asistan</div>';

    assistantBubbleEl = document.createElement('div');
    assistantBubbleEl.className = 'chat-bubble';
    assistantBubbleEl.style.minHeight = '20px';
    assistantMsgEl.appendChild(assistantBubbleEl);
    msgs?.appendChild(assistantMsgEl);

    // Read SSE stream
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      let eventType = null;
      let dataLine  = null;

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          dataLine = line.slice(6).trim();
        } else if (line === '' && eventType && dataLine) {
          // Process event
          try {
            const data = JSON.parse(dataLine);

            if (eventType === 'status') {
              // Show status in bubble while querying
              if (assistantBubbleEl) {
                assistantBubbleEl.innerHTML = `<span style="color:#475569; font-size:12px; font-style:italic;">⚙️ ${escHtml(data.text)}</span>`;
              }
            } else if (eventType === 'token') {
              // Stream text tokens
              streamedText += data.text || '';
              if (assistantBubbleEl) {
                assistantBubbleEl.innerHTML = formatText(streamedText);
              }
              scrollToBottom();
            } else if (eventType === 'done') {
              // Render results panel
              renderResults({
                charts: data.charts || [],
                tables: data.tables || [],
                pdfs:   data.pdfs   || [],
              });

              // Add hint if results exist
              const hasResults = data.charts?.length || data.tables?.length || data.pdfs?.length;
              if (hasResults && assistantMsgEl) {
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:11px; color:#475569; margin-top:4px; padding:0 4px;';
                hint.innerHTML = '<i class="ti ti-arrow-right" style="font-size:11px;"></i> Sonuçlar sağ panelde';
                assistantMsgEl.appendChild(hint);
              }

              // Save history
              assistantMessage = data.assistant_message;
              if (assistantMessage) {
                history.push({ role: 'user', content: message });
                history.push(assistantMessage);
                saveHistory(history.slice(-MAX_HISTORY));
              }

            } else if (eventType === 'error') {
              if (assistantBubbleEl) {
                assistantBubbleEl.innerHTML = `<span style="color:#fca5a5;">⚠️ ${escHtml(data.text)}</span>`;
              }
            }
          } catch (e) {
            console.warn('SSE parse error:', e);
          }

          eventType = null;
          dataLine  = null;
        }
      }
    }

  } catch (err) {
    removeTyping(typingId);
    appendError(err.message);
  } finally {
    _isLoading = false;
    setSendDisabled(false);
    input?.focus();
  }
}
// ─── Message rendering ────────────────────────────────────────────────────────
function appendUserMessage(text) {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-user';
  div.innerHTML = `
    <div class="chat-msg-label">Sen</div>
    <div class="chat-bubble">${escHtml(text)}</div>`;
  msgs.appendChild(div);
  scrollToBottom();
}

function appendAssistantMessage(resp) {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;

  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-assistant';

  let innerHtml = '<div class="chat-msg-label">AI Asistan</div>';

  if (resp.text) {
    innerHtml += `<div class="chat-bubble">${formatText(resp.text)}</div>`;
  }

  // If there are charts/tables/pdfs, hint user to look right
  const hasResults = (resp.charts?.length || resp.tables?.length || resp.pdfs?.length);
  if (hasResults) {
    innerHtml += `<div style="font-size:11px; color:#475569; margin-top:4px; padding:0 4px;">
      <i class="ti ti-arrow-right" style="font-size:11px;"></i> Sonuçlar sağ panelde gösterildi
    </div>`;
  }

  div.innerHTML = innerHtml;
  msgs.appendChild(div);
  scrollToBottom();
}

function appendTyping() {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return null;
  const id  = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.id        = id;
  div.className = 'chat-msg chat-msg-assistant';
  div.innerHTML = `
    <div class="chat-msg-label">AI Asistan</div>
    <div class="chat-typing">
      <div class="chat-typing-dot"></div>
      <div class="chat-typing-dot"></div>
      <div class="chat-typing-dot"></div>
    </div>`;
  msgs.appendChild(div);
  scrollToBottom();
  return id;
}

function removeTyping(id) { document.getElementById(id)?.remove(); }

function appendError(msg) {
  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-assistant';
  div.innerHTML = `
    <div class="chat-msg-label">AI Asistan</div>
    <div class="chat-error-bubble">⚠️ ${escHtml(msg)}</div>`;
  msgs.appendChild(div);
  scrollToBottom();
}

// ─── Results panel ────────────────────────────────────────────────────────────
function renderResults(resp) {
  const hasResults = (resp.charts?.length || resp.tables?.length || resp.pdfs?.length);
  if (!hasResults) return;

  // Destroy old charts
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch {} });
  _charts = {};

  const body = document.getElementById('chatResultsBody');
  if (!body) return;
  body.innerHTML = '';

  // Charts
  if (Array.isArray(resp.charts)) {
    resp.charts.forEach((chart, i) => {
      const el = buildResultChart(chart, `chart-${Date.now()}-${i}`);
      if (el) body.appendChild(el);
    });
  }

  // Tables
  if (Array.isArray(resp.tables)) {
    resp.tables.forEach(table => {
      const el = buildResultTable(table);
      if (el) body.appendChild(el);
    });
  }

  // PDFs
  if (Array.isArray(resp.pdfs) && resp.pdfs.length > 0) {
    const el = buildResultPdfs(resp.pdfs);
    if (el) body.appendChild(el);
  }

  showResults();
}

function buildResultChart(chartData, chartId) {
  if (!chartData?.labels?.length || !chartData?.datasets?.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'chat-result-chart';

  if (chartData.title) {
    const title = document.createElement('div');
    title.className = 'chat-result-chart-title';
    title.textContent = chartData.title;
    wrap.appendChild(title);
  }

  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'position:relative; height:220px;';
  const canvas = document.createElement('canvas');
  canvas.className = 'chat-result-chart-canvas';
  canvasWrap.appendChild(canvas);
  wrap.appendChild(canvasWrap);

  // Build chart after DOM insertion
  setTimeout(() => {
    if (typeof Chart === 'undefined') return;

    const colors = ['#2563eb','#0ea5e9','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6','#f97316'];
    const isRound = chartData.type === 'pie' || chartData.type === 'doughnut';

    const datasets = chartData.datasets.map((ds, i) => ({
      label:           ds.label || '',
      data:            ds.data  || [],
      backgroundColor: isRound
        ? colors.slice(0, (ds.data || []).length)
        : (chartData.type === 'line'
            ? (ds.color || colors[i % colors.length]) + '30'
            : (ds.color || colors[i % colors.length])),
      borderColor:  ds.color || colors[i % colors.length],
      borderWidth:  chartData.type === 'line' ? 2 : (isRound ? 2 : 0),
      borderRadius: chartData.type === 'bar' ? 4 : 0,
      fill:         chartData.type === 'line',
      tension:      0.35,
      pointRadius:  chartData.type === 'line' ? 3 : 0,
      borderDash:   [],
    }));

    const instance = new Chart(canvas, {
      type: chartData.type || 'bar',
      data: { labels: chartData.labels, datasets },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: datasets.length > 1 || isRound,
            labels:  {
              color:    '#64748b',
              font:     { size: 11, family: 'Plus Jakarta Sans' },
              boxWidth: 12,
            }
          },
          tooltip: {
            backgroundColor: '#1e293b',
            borderColor:     '#334155',
            borderWidth:     1,
            titleColor:      '#f1f5f9',
            bodyColor:       '#94a3b8',
            callbacks: {
              label: ctx => ` ${Number(ctx.raw).toLocaleString('tr-TR')}`
            }
          }
        },
        scales: isRound ? {} : {
          x: {
            ticks: { color: '#475569', font: { size: 10 }, maxRotation: 45 },
            grid:  { color: '#1e293b' }
          },
          y: {
            ticks: { color: '#475569', font: { size: 10 } },
            grid:  { color: '#1e293b' }
          }
        }
      }
    });

    _charts[chartId] = instance;
  }, 50);

  return wrap;
}

function buildResultTable(tableData) {
  if (!tableData?.headers?.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'chat-result-table';

  if (tableData.title) {
    const title = document.createElement('div');
    title.className = 'chat-result-table-title';
    title.textContent = tableData.title;
    wrap.appendChild(title);
  }

  const tbl   = document.createElement('table');
  tbl.className = 'chat-result-tbl';
  tbl.innerHTML = `
    <thead><tr>${tableData.headers.map(h => `<th>${escHtml(String(h))}</th>`).join('')}</tr></thead>
    <tbody>${(tableData.rows || []).map(row =>
      `<tr>${(Array.isArray(row) ? row : Object.values(row)).map(cell => `<td>${escHtml(String(cell ?? ''))}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;

  wrap.appendChild(tbl);
  return wrap;
}

function buildResultPdfs(pdfs) {
  if (!pdfs?.length) return null;

  const headerDiv = document.createElement('div');
  headerDiv.className = 'chat-right-header';
  headerDiv.innerHTML = `<i class="ti ti-files" style="font-size:15px; color:#ef4444;"></i><span>PDF Faturalar (${pdfs.length})</span>`;

  const listDiv = document.createElement('div');
  listDiv.className = 'chat-result-pdf-list';

  pdfs.forEach(pdf => {
    if (!pdf.pdf_url) return;
    const a = document.createElement('a');
    a.className = 'chat-result-pdf-item';
    a.href      = pdf.pdf_url;
    a.target    = '_blank';
    a.rel       = 'noopener';
    a.innerHTML = `
      <span class="chat-result-pdf-icon"><i class="ti ti-file-type-pdf"></i></span>
      <div class="chat-result-pdf-info">
        <div class="chat-result-pdf-no">${escHtml(pdf.invoice_no || '—')}</div>
        <div class="chat-result-pdf-meta">${escHtml(pdf.company || '')}${pdf.date ? ' · ' + pdf.date : ''}</div>
      </div>
      <i class="ti ti-external-link" style="color:#475569; font-size:13px; flex-shrink:0;"></i>`;
    listDiv.appendChild(a);
  });

  const wrap = document.createElement('div');
  wrap.appendChild(headerDiv);
  wrap.appendChild(listDiv);
  return wrap;
}

// ─── PATCH: Replace the entire voice section in chat-page.js ─────────────────
// Replace toggleVoice, startRecording, stopRecording with these:

let _mediaRecorder = null;
let _audioChunks   = [];

function toggleVoice() {
  _isRecording ? stopRecording() : startRecording();
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Pick best supported format
    const mimeType = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ].find(t => MediaRecorder.isTypeSupported(t)) || '';

    _audioChunks   = [];
    _mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    _mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) _audioChunks.push(e.data);
    };

    _mediaRecorder.onstop = async () => {
      // Stop all tracks to release microphone
      stream.getTracks().forEach(t => t.stop());

      const audioBlob = new Blob(_audioChunks, { type: mimeType || 'audio/webm' });
      _audioChunks    = [];

      await transcribeAudio(audioBlob, mimeType || 'audio/webm');
    };

    _mediaRecorder.start(250); // collect data every 250ms
    _isRecording = true;

    const btn = document.getElementById('chatVoiceBtn');
    if (btn) {
      btn.classList.add('recording');
      btn.innerHTML = '<i class="ti ti-square" style="font-size:13px;"></i>';
      btn.title     = 'Durdurmak için tıkla';
    }

    // Show recording indicator in input
    const input = document.getElementById('chatInput');
    if (input) {
      input.placeholder = '🔴 Kaydediliyor... durdurmak için mikrofona bas';
      input.disabled    = true;
    }

  } catch (err) {
    console.error('Mikrofon hatası:', err);
    if (err.name === 'NotAllowedError') {
      alert('Mikrofon izni verilmedi. Tarayıcı ayarlarından izin verin.');
    } else {
      alert('Mikrofon açılamadı: ' + err.message);
    }
    _isRecording = false;
  }
}

function stopRecording() {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    _mediaRecorder.stop();
  }
  _isRecording = false;

  const btn = document.getElementById('chatVoiceBtn');
  if (btn) {
    btn.classList.remove('recording');
    btn.innerHTML = '<i class="ti ti-microphone"></i>';
    btn.title     = 'Sesli giriş';
    btn.disabled  = true; // disable while transcribing
  }

  const input = document.getElementById('chatInput');
  if (input) {
    input.placeholder = 'Transkript alınıyor...';
  }
}

async function transcribeAudio(audioBlob, mimeType) {
  const btn   = document.getElementById('chatVoiceBtn');
  const input = document.getElementById('chatInput');

  try {
    const res = await fetch('/api/transcribe', {
      method:  'POST',
      headers: { 'Content-Type': mimeType },
      body:    audioBlob,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transkript alınamadı');

    if (input) {
      input.value       = data.text || '';
      input.placeholder = 'Bir şey sorun...';
      input.disabled    = false;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
      input.focus();
    }

  } catch (err) {
    console.error('Transkript hatası:', err);
    if (input) {
      input.placeholder = 'Bir şey sorun...';
      input.disabled    = false;
      input.value       = '';
    }
    appendError('Ses transkripti alınamadı: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled  = false;
      btn.innerHTML = '<i class="ti ti-microphone"></i>';
    }
    _mediaRecorder = null;
  }
}


// ─── History ──────────────────────────────────────────────────────────────────
function getHistory() {
  try {
    const raw  = localStorage.getItem(HISTORY_KEY);
    const data = raw ? JSON.parse(raw) : {};
    const ts   = data.timestamp || 0;
    // Expire after 24 hours
    if (Date.now() - ts > 24 * 60 * 60 * 1000) return [];
    return Array.isArray(data.messages) ? data.messages : [];
  } catch { return []; }
}

function saveHistory(messages) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ timestamp: Date.now(), messages }));
  } catch {}
}

function restoreHistory() {
  // History is sent with each request — no need to re-render on load
  // Fresh visual chat every page open
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function scrollToBottom() {
  const msgs = document.getElementById('chatMessages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function setSendDisabled(v) {
  const btn = document.getElementById('chatSendBtn');
  if (btn) btn.disabled = v;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatText(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#f1f5f9;">$1</strong>')
    .replace(/\n/g, '<br>');
}