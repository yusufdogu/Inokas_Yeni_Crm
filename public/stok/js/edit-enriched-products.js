// ═══ ÜRÜN DÜZELTME İNCELEMESİ ════════════════════════════════════════════════
let _erevReviews = [];

// Load pending reviews → update the card. Call on panel load + after decisions.
async function erevLoad() {
  try {
    const data = await _gbFetch('/api/enrichment-reviews');
    _erevReviews = data.reviews || [];
    _erevRenderCard(data.count || 0);
  } catch (err) {
    console.error('İnceleme yüklenemedi:', err);
    // on error, just hide the card (don't block the page)
    const card = document.getElementById('erevCard');
    if (card) card.style.display = 'none';
  }
}

function _erevRenderCard(count) {
  const card = document.getElementById('erevCard');
  if (!card) return;
  if (count > 0) {
    document.getElementById('erevCardTitle').textContent = 'Ürün düzeltmelerini kontrol edin';
    document.getElementById('erevCardSub').textContent = `${count} öneri bekliyor`;
    card.style.display = 'flex';
  } else {
    // per your choice: show a calm "all good" state instead of hiding
    document.getElementById('erevCardTitle').textContent = 'Düzeltme yok';
    document.getElementById('erevCardSub').textContent = 'her şey yolunda';
    card.style.display = 'flex';
  }
}

function erevOpen() {
  _erevRenderList();
  document.getElementById('erevModal').style.display = 'flex';
}
function erevClose() {
  document.getElementById('erevModal').style.display = 'none';
}

function _erevRenderList() {
  const list = document.getElementById('erevList');
  const empty = document.getElementById('erevEmpty');
  const sub = document.getElementById('erevModalSub');

  if (!_erevReviews.length) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    sub.textContent = 'Bekleyen düzeltme yok';
    return;
  }
  empty.style.display = 'none';
  sub.textContent = `${_erevReviews.length} düzeltme önerisi`;

  list.innerHTML = _erevReviews.map(r => {
    const badge = r.is_merge
      ? '<span class="erev-badge erev-badge--merge">Birleştirme</span>'
      : '<span class="erev-badge erev-badge--change">Kod değişikliği</span>';
    const srcBadge = r.official_source
      ? '<span class="erev-badge erev-badge--src">Resmi kaynak</span>' : '';

    const mergeNote = r.is_merge && r.merge
      ? `<div class="erev-merge-note">
           <i class="ti ti-alert-triangle"></i>
           Bu ürün <b>${_erevEsc(r.merge.target_name || r.merge.target_code || '')}</b> ile birleştirilecek.
           ${r.merge.items_to_move} fatura kalemi taşınacak ve bu ürün silinecek.
         </div>`
      : '';

    return `
      <div class="erev-row" id="erev-row-${r.id}" data-id="${r.id}">
        <div class="erev-row-top">
          <span class="erev-row-name">${_erevEsc(r.current_name || '')}</span>
          ${srcBadge}${badge}
        </div>
        <div class="erev-codes">
          <span class="erev-code-old">${_erevEsc(r.current_code || '—')}</span>
          <i class="ti ti-arrow-right erev-code-arrow"></i>
          <span class="erev-code-new">${_erevEsc(r.proposed_mpn || '—')}</span>
        </div>
        ${mergeNote}
        <div class="erev-actions" id="erev-actions-${r.id}">
          <button class="erev-btn erev-btn--accept" onclick="erevDecide('${r.id}','accept')">
            ${r.is_merge ? 'Birleştir' : 'Onayla'}
          </button>
          <button class="erev-btn erev-btn--deny" onclick="erevDecide('${r.id}','deny')">Reddet</button>
          <button class="erev-btn" onclick="erevToggleEdit('${r.id}')">Düzenle</button>
        </div>
        <div class="erev-edit-wrap" id="erev-edit-${r.id}">
          <input type="text" class="erev-edit-input" id="erev-edit-input-${r.id}"
                 value="${_erevEsc(r.proposed_mpn || r.current_code || '')}" placeholder="Doğru kod...">
          <button class="erev-btn erev-btn--accept" onclick="erevSubmitEdit('${r.id}')">Uygula</button>
          <button class="erev-btn" onclick="erevToggleEdit('${r.id}')">İptal</button>
        </div>
        <div class="erev-row-msg" id="erev-msg-${r.id}"></div>
      </div>`;
  }).join('');
}

function erevToggleEdit(id) {
  const actions = document.getElementById('erev-actions-' + id);
  const edit = document.getElementById('erev-edit-' + id);
  const open = edit.classList.contains('open');
  edit.classList.toggle('open', !open);
  actions.style.display = open ? 'flex' : 'none';
  if (!open) document.getElementById('erev-edit-input-' + id)?.focus();
}

function erevSubmitEdit(id) {
  const code = document.getElementById('erev-edit-input-' + id).value.trim();
  if (!code) { _erevMsg(id, 'Kod boş olamaz.', true); return; }
  erevDecide(id, 'edit', code);
}

async function erevDecide(id, decision, editedCode) {
  // disable the row's buttons while working
  const row = document.getElementById('erev-row-' + id);
  row?.querySelectorAll('button').forEach(b => b.disabled = true);
  _erevMsg(id, 'İşleniyor...', false);

  try {
    const res = await fetch(`/api/enrichment-reviews/${id}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, edited_code: editedCode || null }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || `HTTP ${res.status}`);
    }
    const data = await res.json();

    // success — show a brief message, then remove the row from the list
    const label = data.merged ? 'Birleştirildi' :
                  decision === 'deny' ? 'Reddedildi' :
                  decision === 'edit' ? 'Güncellendi' : 'Onaylandı';
    _erevMsg(id, `✓ ${label}`, false, true);

    // drop it from local state + re-render after a short beat
    setTimeout(() => {
      _erevReviews = _erevReviews.filter(r => r.id !== id);
      _erevRenderList();
      _erevRenderCard(_erevReviews.length);
    }, 700);

  } catch (err) {
    _erevMsg(id, err.message, true);
    row?.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

function _erevMsg(id, text, isErr, isOk) {
  const el = document.getElementById('erev-msg-' + id);
  if (!el) return;
  el.textContent = text;
  el.className = 'erev-row-msg' + (isErr ? ' erev-row-msg--err' : isOk ? ' erev-row-msg--ok' : '');
}

function _erevEsc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}