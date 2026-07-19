// giderler/js/gider-chat-core.js — shared streaming engine for the giderler chat
//
// Copy of stok-chat-core.js, tab-agnostic. POSTs to /api/chat/ask, parses the
// SSE stream, and invokes callbacks. Since giderler is a single page with two
// tabs sharing one rail, initGiderChatUI returns a controller whose scope
// (tab + chips) can be updated on tab switch.
//
//   streamGiderChat({ tab, message, history, onToken, onToolCall, onAction, onDone, onError, signal })
//   const chat = initGiderChatUI({ bodyId, inputId, sendId, chipsId, tab, chips })
//   chat.setScope('gider-faturalar', ['chip a', 'chip b'])

async function streamGiderChat({
  tab,
  message,
  history = [],
  onToken,
  onToolCall,
  onAction,
  onDone,
  onError,
  signal,
} = {}) {
  const apiHistory = (history || [])
    .filter(m => m && m.text)
    .slice(-6)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: String(m.text) }));

  let response;
  try {
    response = await fetch('/api/chat/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tab, message, history: apiHistory }),
      signal,
    });
  } catch (err) {
    onError?.(err?.name === 'AbortError' ? 'İptal edildi' : 'Bağlantı kurulamadı');
    return;
  }

  if (!response.ok || !response.body) {
    let msg = `HTTP ${response.status}`;
    try { const t = await response.text(); if (t) msg = t; } catch {}
    onError?.(msg);
    return;
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawError = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        let eventType = 'message';
        let dataStr = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:'))     eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr   = line.slice(5).trim();
        }
        if (!dataStr) continue;

        let data;
        try { data = JSON.parse(dataStr); } catch { continue; }

        if (eventType === 'token' && data.text) {
          onToken?.(data.text);
        } else if (eventType === 'tool_call') {
          onToolCall?.(data.name, data.args);
        } else if (eventType === 'action') {
          onAction?.(data.type, data.params);
        } else if (eventType === 'done') {
          onDone?.();
        } else if (eventType === 'error') {
          sawError = true;
          onError?.(data.message || 'Sunucu hatası');
        }
      }
    }
  } catch (err) {
    onError?.(err?.name === 'AbortError' ? 'İptal edildi' : 'Akış kesildi');
    return;
  }

  if (!sawError) onDone?.();
}

// ─── Shared markdown renderer (marked) ─────────────────────────────────────────
function renderChatMarkdown(text) {
  if (!text) return '';
  if (typeof marked === 'undefined') {
    return String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }
  try {
    const renderer = new marked.Renderer();
    const origLink = renderer.link.bind(renderer);
    renderer.link = (href, title, txt) => {
      const html = origLink(href, title, txt);
      return html.replace(/^<a /, '<a target="_blank" rel="noopener" ');
    };
    return marked.parse(String(text), { renderer, breaks: true, gfm: true });
  } catch {
    return String(text).replace(/</g, '&lt;').replace(/\n/g, '<br>');
  }
}

// ─── Rail UI mount ─────────────────────────────────────────────────────────────
// Wires a chat rail (bubbles, typing dots, chips, Enter-to-send, streaming) to
// streamGiderChat. Returns a controller so the single-page tab switch can update
// the scope (which `tab` is sent + which chips are shown).
//
//   initGiderChatUI({ bodyId, inputId, sendId, chipsId, tab, chips })
//     → { setTab(tab), setChips(list), setScope(tab, list) }
function initGiderChatUI({ bodyId, inputId, sendId, chipsId, tab, chips } = {}) {
  const body  = document.getElementById(bodyId);
  const input = document.getElementById(inputId);
  const send  = document.getElementById(sendId);
  const chipsEl = chipsId ? document.getElementById(chipsId) : null;
  if (!body || !input || !send) return { setTab() {}, setChips() {}, setScope() {} };

  const history = [];
  let streaming  = false;
  let currentTab = tab;
  let started    = false;               // true once the user sends the first message

  const scroll = () => { body.scrollTop = body.scrollHeight; };

  function renderChips(list) {
    if (!chipsEl) return;
    chipsEl.innerHTML = (list || [])
      .map(t => `<button class="gd-chip">${String(t).replace(/</g, '&lt;')}</button>`).join('');
    chipsEl.querySelectorAll('.gd-chip').forEach(chip =>
      chip.addEventListener('click', () => { input.value = chip.textContent; submit(); }));
  }

  function addBubble(text, who) {
    const wrap = document.createElement('div');
    wrap.className = `gd-msg gd-msg--${who}`;
    const bubble = document.createElement('div');
    bubble.className = 'gd-bubble';
    if (who === 'bot') bubble.innerHTML = renderChatMarkdown(text);
    else               bubble.textContent = text;
    wrap.appendChild(bubble);
    body.appendChild(wrap);
    scroll();
    return bubble;
  }

  function addTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'gd-msg gd-msg--bot';
    wrap.innerHTML = '<div class="gd-bubble"><span class="gd-typing"><span></span><span></span><span></span></span></div>';
    body.appendChild(wrap);
    scroll();
    return wrap;
  }

  async function submit() {
    const text = (input.value || '').trim();
    if (!text || streaming) return;

    streaming = true;
    started   = true;
    send.disabled = true;
    input.value = '';
    input.style.height = 'auto';
    if (chipsEl) chipsEl.style.display = 'none';

    addBubble(text, 'user');
    history.push({ role: 'user', text });

    const typing = addTyping();
    let botBubble = null;
    let acc = '';
    const ensureBubble = () => {
      if (!botBubble) { typing.remove(); botBubble = addBubble('', 'bot'); }
      return botBubble;
    };

    await streamGiderChat({
      tab: currentTab,
      message: text,
      history,
      onToken: (chunk) => { acc += chunk; ensureBubble().innerHTML = renderChatMarkdown(acc); scroll(); },
      onDone: () => {
        if (!botBubble && acc === '') { typing.remove(); addBubble('Yanıt alınamadı.', 'bot'); }
        else history.push({ role: 'bot', text: acc });
        streaming = false; send.disabled = false; input.focus();
      },
      onError: (msg) => {
        typing.remove();
        if (botBubble) botBubble.innerHTML = renderChatMarkdown(acc + `\n\n_(hata: ${msg})_`);
        else addBubble('Bir hata oluştu: ' + msg, 'bot');
        streaming = false; send.disabled = false;
      },
    });
  }

  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });

  if (chips) renderChips(chips);

  return {
    setTab:   (t) => { currentTab = t; },
    setChips: (list) => renderChips(list),
    // Update tab + chips together. Chips are only re-shown if the conversation
    // hasn't started yet (once the user chats, we keep the rail clean).
    setScope: (t, list) => {
      currentTab = t;
      renderChips(list);
      if (chipsEl && !started) chipsEl.style.display = '';
    },
  };
}