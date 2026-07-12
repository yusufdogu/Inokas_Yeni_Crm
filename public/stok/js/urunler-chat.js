// stok/urunler-chat.js — Ürünler assistant rail (right 30%)
//
// SCOPE: this is the front-end shell only. Messages render, auto-grow, send on
// Enter, and persist for the browser session. Replies currently come from a
// local placeholder (_urChatReply) that reads the on-screen filtered data so the
// panel feels alive. When the real assistant is ready, replace the body of
// _urChatReply with the API call — everything else (render/persist/UI) stays.
//
// Depends on globals from urunler.js: _urFiltered (current filtered rows),
// allProducts, and the esc() helper from utils.js.

const _UR_CHAT_CACHE_KEY = 'inokas_urunler_chat_v1';

let _urChatMsgs = [];   // [{ role:'user'|'bot', text }]
let _urChatBusy = false;

// ─── PERSISTENCE (session) ─────────────────────────────────────────────────────
function _urChatLoad() {
  try {
    const raw = sessionStorage.getItem(_UR_CHAT_CACHE_KEY);
    _urChatMsgs = raw ? JSON.parse(raw) : [];
  } catch { _urChatMsgs = []; }
}

function _urChatSave() {
  try { sessionStorage.setItem(_UR_CHAT_CACHE_KEY, JSON.stringify(_urChatMsgs)); } catch {}
}

// ─── RENDER ─────────────────────────────────────────────────────────────────────
function _urChatRenderAll() {
  const body = document.getElementById('urChatBody');
  if (!body) return;
  // Keep the very first greeting bubble (authored in HTML); append history after it.
  body.querySelectorAll('.ur-msg--dyn').forEach(el => el.remove());
  _urChatMsgs.forEach(m => body.appendChild(_urChatBubble(m.role, m.text)));
  body.scrollTop = body.scrollHeight;
}

function _urChatBubble(role, text) {
  const d = document.createElement('div');
  d.className = 'ur-msg ur-msg--dyn ' + (role === 'user' ? 'ur-msg--user' : 'ur-msg--bot');
  if (role === 'user') d.textContent = text;              // user stays plain
  else d.innerHTML = renderChatMarkdown(text);            // bot → markdown
  return d;
}

function _urChatAppend(role, text) {
  _urChatMsgs.push({ role, text });
  _urChatSave();
  const body = document.getElementById('urChatBody');
  if (body) {
    body.appendChild(_urChatBubble(role, text));
    body.scrollTop = body.scrollHeight;
  }
}

// Public helper other code can call to drop a note into the rail
// (e.g. row click / add-product), without going through the input.
function urChatNote(text) { _urChatAppend('bot', text); }

// ─── INPUT UI ───────────────────────────────────────────────────────────────────
function urChatGrow(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 96) + 'px';
}

function urChatToggleSend() {
  const inp = document.getElementById('urChatInput');
  const btn = document.getElementById('urChatSend');
  if (btn) btn.disabled = _urChatBusy || !inp || !inp.value.trim();
}

function urChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUrChat(); }
}

function urChatQuick(btn) {
  const inp = document.getElementById('urChatInput');
  if (!inp) return;
  inp.value = btn.textContent;
  urChatGrow(inp);
  urChatToggleSend();
  sendUrChat();
}

// ─── SEND ─────────────────────────────────────────────────────────────────────
// ─── SEND (streams from /api/chat/ask via stok-chat-core) ──────────────────────
async function sendUrChat() {
  const inp = document.getElementById('urChatInput');
  if (!inp || _urChatBusy) return;
  const text = inp.value.trim();
  if (!text) return;

  // history to send = everything BEFORE this new user turn
  const history = _urChatMsgs.slice();

  _urChatAppend('user', text);
  inp.value = '';
  urChatGrow(inp);

  _urChatBusy = true;
  urChatToggleSend();

  // Create a live bot bubble that grows as tokens arrive.
  const bubble = _urChatBubble('bot', '');
  bubble.classList.add('ur-msg--streaming');
  const body = document.getElementById('urChatBody');
  body?.appendChild(bubble);
  body && (body.scrollTop = body.scrollHeight);

  let acc = '';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    bubble.classList.remove('ur-msg--streaming');
    if (acc.trim()) {
      bubble.innerHTML = renderChatMarkdown(acc);   // swap raw text → rendered markdown
      _urChatMsgs.push({ role: 'bot', text: acc }); _urChatSave();
    }
    _urChatBusy = false;
    urChatToggleSend();
    inp.focus();
  };

  await streamStokChat({
    tab: 'stok-urunler',
    message: text,
    history,
    onToken: (chunk) => {
      acc += chunk;
      bubble.textContent = acc;
      body && (body.scrollTop = body.scrollHeight);
    },
    onAction: (type, params) => {
      if (type === 'applyStockFilters' && typeof _applyFiltersFromAssistant === 'function') {
        _applyFiltersFromAssistant(params);
        _urChatAppend('bot', _urFilterNote(params));   // visible confirmation note
      }
    },
    onDone: finish,
    onError: (msg) => {
      if (!acc.trim()) bubble.textContent = 'Bir hata oluştu, tekrar dener misin?';
      console.error('[stok-urunler chat]', msg);
      finish();
    },
  });
}

// Human-readable summary of what the assistant filtered.
function _urFilterNote(p) {
  if (!p) return 'Filtreler güncellendi.';
  if (p.clear) return 'Filtreler temizlendi.';
  const parts = [];
  if (p.brands?.length)       parts.push(p.brands.join(', '));
  if (p.categories?.length)   parts.push(p.categories.join(', '));
  if (p.skus?.length)         parts.push(p.skus.join(', '));
  if (p.productNames?.length) parts.push(p.productNames.join(', '));
  if (p.currency)             parts.push(p.currency);
  if (p.inStock)              parts.push('stokta olanlar');
  if (p.qtyMin != null || p.qtyMax != null) parts.push(`adet ${p.qtyMin ?? 0}–${p.qtyMax ?? '∞'}`);
  if (p.valueMin != null || p.valueMax != null) parts.push(`değer ${p.valueMin ?? 0}–${p.valueMax ?? '∞'}`);
  return parts.length ? `Filtreler uygulandı: ${parts.join(' · ')}` : 'Filtreler uygulandı.';
}




// ─── INIT ─────────────────────────────────────────────────────────────────────
// Restore any session history when the script loads.
_urChatLoad();
document.addEventListener('DOMContentLoaded', () => {
  _urChatRenderAll();
  urChatToggleSend();
});