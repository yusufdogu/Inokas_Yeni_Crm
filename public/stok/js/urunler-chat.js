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
  d.textContent = text;   // textContent — no HTML injection from messages
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
async function sendUrChat() {
  const inp = document.getElementById('urChatInput');
  if (!inp || _urChatBusy) return;
  const text = inp.value.trim();
  if (!text) return;

  _urChatAppend('user', text);
  inp.value = '';
  urChatGrow(inp);

  _urChatBusy = true;
  urChatToggleSend();
  try {
    const reply = await _urChatReply(text);
    _urChatAppend('bot', reply);
  } catch (err) {
    _urChatAppend('bot', 'Bir hata oluştu, tekrar dener misin?');
  } finally {
    _urChatBusy = false;
    urChatToggleSend();
    inp.focus();
  }
}

// ─── REPLY (PLACEHOLDER) ───────────────────────────────────────────────────────
// TODO: replace this body with the real assistant call. Suggested shape:
//   const res = await fetch('/api/assistant/urunler', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ question, context: _urChatContext() })
//   });
//   const data = await res.json();
//   return data.answer;
async function _urChatReply(question) {
  await new Promise(r => setTimeout(r, 300)); // tiny delay so it reads like a reply
  const rows = Array.isArray(_urFiltered) ? _urFiltered : [];
  const q = String(question || '').toLocaleLowerCase('tr');

  if (q.includes('kaç') && (q.includes('ürün') || q.includes('listele'))) {
    return rows.length.toLocaleString('tr-TR') + ' ürün listeleniyor (mevcut filtrelerle).';
  }
  if (q.includes('değer')) {
    const tl  = document.getElementById('kpi-stock-tl')?.textContent  || '₺0';
    const eur = document.getElementById('kpi-stock-eur')?.textContent || '€0';
    const usd = document.getElementById('kpi-stock-usd')?.textContent || '$0';
    return `Filtrelenmiş toplam stok değeri: ${tl} · ${eur} · ${usd}.`;
  }
  if (q.includes('yüksek') || q.includes('en çok') || q.includes('en fazla')) {
    const top = [...rows].sort((a, b) => Number(b.stock_on_hand || 0) - Number(a.stock_on_hand || 0))[0];
    return top
      ? `En yüksek stok: ${top.product_name} (${top.product_code}) — ${Number(top.stock_on_hand || 0).toLocaleString('tr-TR')} adet.`
      : 'Şu an gösterilecek ürün yok.';
  }
  if (q.includes('kategori')) {
    const c = new Set(rows.map(p => String(p.category || '').trim()).filter(Boolean));
    return c.size + ' farklı kategori görünüyor.';
  }
  if (q.includes('marka')) {
    const b = new Set(rows.map(p => String(p.brand || '').trim()).filter(Boolean));
    return b.size + ' farklı marka görünüyor.';
  }
  return 'Şu an yer tutucu yanıt veriyorum. Gerçek asistan bağlandığında bu soruyu ekrandaki verilerle yanıtlayacağım.';
}

// Context payload the real endpoint will likely want. Kept small on purpose.
function _urChatContext() {
  const rows = Array.isArray(_urFiltered) ? _urFiltered : [];
  return {
    visible_count: rows.length,
    total_count: Array.isArray(allProducts) ? allProducts.length : 0,
    kpis: {
      tl:  document.getElementById('kpi-stock-tl')?.textContent  || null,
      eur: document.getElementById('kpi-stock-eur')?.textContent || null,
      usd: document.getElementById('kpi-stock-usd')?.textContent || null,
      categories: document.getElementById('kpi-categories')?.textContent || null,
      brands:     document.getElementById('kpi-brands')?.textContent || null,
    },
  };
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
// Restore any session history when the script loads.
_urChatLoad();
document.addEventListener('DOMContentLoaded', () => {
  _urChatRenderAll();
  urChatToggleSend();
});