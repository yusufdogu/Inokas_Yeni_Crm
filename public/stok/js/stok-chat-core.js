// stok/stok-chat-core.js — shared streaming engine for the stock chats
//
// One tab-agnostic function both stock chats call. It POSTs to /api/chat/ask
// (the same endpoint faturalar uses), parses the SSE stream, and invokes
// callbacks. It knows nothing about ürünler or genel-bakış — each caller passes
// its own tab and its own handlers.
//
//   streamStokChat({
//     tab,                       // 'stok-urunler' | 'stok-genel'
//     message,                   // the user's text
//     history,                   // [{ role:'user'|'bot', text }] — mapped below
//     onToken(textChunk),        // called per streamed token
//     onToolCall(name, args),    // optional — assistant invoked a tool
//     onAction(type, params),    // optional — a UI-mutating action (e.g. filters)
//     onDone(),                  // stream finished cleanly
//     onError(message),          // any failure
//     signal,                    // optional AbortSignal
//   })
//
// The endpoint expects history roles of 'user' | 'assistant', but the stock
// chats store 'user' | 'bot'. We map bot→assistant here so callers don't have to.

async function streamStokChat({
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
  // Map local history shape → API shape (bot → assistant), last 6 turns.
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

      // SSE frames are separated by a blank line.
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

  // Some backends end the stream without an explicit 'done' frame; ensure the
  // caller's completion runs exactly once (only if no error already fired).
  if (!sawError) onDone?.();
}

// ─── Shared markdown renderer (marked) ─────────────────────────────────────────
// Renders assistant text to safe-ish HTML with target=_blank links. Falls back
// to escaped plain text if marked isn't loaded. Mirrors faturalar's renderer.
function renderChatMarkdown(text) {
  if (!text) return '';
  if (typeof marked === 'undefined') {
    // no marked → escape and keep newlines
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