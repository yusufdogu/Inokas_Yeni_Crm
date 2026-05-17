const _detailXmlCache = {};

async function loadDetailPdfInto(id, inv, iframe, empty) {
  if (!iframe) return;

  if (inv?.pdf_url) {
    if (empty) empty.style.display = 'none';
    iframe.src = inv.pdf_url;
    iframe.style.display = 'block';
    return;
  }

  // pdf_url yoksa göster ama işlem yapma
  if (empty) empty.innerHTML = `
        <p style="font-size:13px;font-weight:600;color:#94a3b8;">PDF bulunamadı</p>`;
}



// ── SAĞ PANEL — ÖDEME DETAYI ─────────────────────────────────────────────────
function renderFirmaDetail() {
  const panel = document.getElementById('firma-detail-panel');

  if (!firmaSelectedInv) {
    panel.innerHTML = `
<div class="fd-empty">
  <i class="ti ti-receipt" style="font-size:40px; color:#cbd5e1; display:block; margin-bottom:12px;"></i>
  Soldan bir fatura seçin
</div>`;
    // PDF panelini de sıfırla
    const iframe = document.getElementById('firma-pdf-iframe');
    const empty = document.getElementById('firma-pdf-empty');
    if (iframe) { iframe.src = ''; iframe.style.display = 'none'; }
    if (empty) { empty.style.display = 'flex'; }
    return;
  }

  const inv = firmaSelectedInv;
  const iso = _invIso(inv);
  const label = iso === 'TRY' ? 'TL' : iso;
  const payable = _invPayable(inv);
  const paid = _invPaid(inv);
  const remaining = Math.max(payable - paid, 0);
  const fmt = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = inv.invoice_date
    ? new Date(inv.invoice_date + 'T00:00:00').toLocaleDateString('tr-TR')
    : '—';

  panel.innerHTML = `
<div class="fd-header">
  <div>
    <div class="fd-inv-no">${inv.invoice_no || inv.efatura_uuid?.slice(0, 12) || '—'}</div>
    <div class="fd-inv-date">${date}</div>
  </div>
</div>

<div class="fd-summary">
  <div class="fd-sum-card fd-sum-total">
    <span class="fd-sum-label">TOPLAM</span>
    <span class="fd-sum-val">${fmt(payable)} ${label}</span>
  </div>
  <div class="fd-sum-card fd-sum-paid">
    <span class="fd-sum-label">ÖDENEN</span>
    <span class="fd-sum-val" id="fd-paid-val">${fmt(paid)} ${label}</span>
  </div>
  <div class="fd-sum-card fd-sum-remaining">
    <span class="fd-sum-label">KALAN</span>
    <span class="fd-sum-val" id="fd-remaining-val">${fmt(remaining)} ${label}</span>
  </div>
</div>

<div class="fd-section-header">
  <span class="fd-section-title">Ödeme Geçmişi</span>
  <button class="fd-add-btn" onclick="showAddPaymentForm()">
    <i class="ti ti-plus"></i> Yeni Ödeme
  </button>
</div>

<div id="fd-add-form" style="display:none;" class="fd-add-form">
  <div class="fd-form-row">
    <div class="fd-form-group">
      <label>TARİH</label>
      <input type="date" id="fd-pay-date" max="${new Date().toISOString().slice(0, 10)}">
    </div>
    <div class="fd-form-group">
      <label>TUTAR (${label})</label>
      <input type="number" id="fd-pay-amount" step="0.01" placeholder="0.00">
    </div>
    <div class="fd-form-group fd-form-group--wide">
      <label>NOT</label>
      <input type="text" id="fd-pay-notes" placeholder="Açıklama...">
    </div>
  </div>
  <div class="fd-form-actions">
    <button class="fd-btn-save" onclick="submitAddPayment()">Kaydet</button>
    <button class="fd-btn-cancel" onclick="hideAddPaymentForm()">İptal</button>
  </div>
</div>

<div id="fd-payments-wrap">
  <div class="fd-loading">Yükleniyor...</div>
</div>`;

  loadDetailPayments(inv);
  // PDF panelini tetikle
  const iframe = document.getElementById('firma-pdf-iframe');
  const empty = document.getElementById('firma-pdf-empty');
  loadDetailPdfInto(inv.id, inv, iframe, empty);
}

// ── ÖDEME FORMU ───────────────────────────────────────────────────────────────
function showAddPaymentForm() {
  document.getElementById('fd-add-form').style.display = 'block';
  document.getElementById('fd-pay-date').focus();
}

function hideAddPaymentForm() {
  document.getElementById('fd-add-form').style.display = 'none';
  document.getElementById('fd-pay-date').value = '';
  document.getElementById('fd-pay-amount').value = '';
  document.getElementById('fd-pay-notes').value = '';
}

async function submitAddPayment() {
  const inv = firmaSelectedInv;
  if (!inv) return;

  const dateVal = document.getElementById('fd-pay-date')?.value;
  const amountVal = parseFloat(document.getElementById('fd-pay-amount')?.value);
  const notesVal = document.getElementById('fd-pay-notes')?.value?.trim() || '';
  const today = new Date().toISOString().slice(0, 10);

  if (!dateVal) { alert('Lütfen tarih seçin.'); return; }
  if (dateVal > today) { alert('Gelecek tarihe ödeme eklenemez.'); return; }
  if (!amountVal || amountVal <= 0) { alert('Geçerli bir tutar girin.'); return; }

  const payable = _invPayable(inv);
  const paid = _invPaid(inv);
  if (paid + amountVal > payable + 0.01) {
    alert(`Fatura toplamı aşılıyor. Girebileceğiniz maksimum: ${(payable - paid).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`);
    return;
  }

  const iso = _invIso(inv);
  try {
    await apiAddPayment(inv.id, amountVal, iso, dateVal, notesVal);
    hideAddPaymentForm();
    // cache güncelle
    const cached = firmaInvoices.find(i => i.id === inv.id);
    if (cached) {
      const prevCur = parseFloat(cached.paid_amount_cur) || 0;
      cached.paid_amount_cur = prevCur + amountVal;
      cached.paid_amount = cached.paid_amount_cur;
      firmaSelectedInv = cached;
    }
    renderFirmaDetail();
    renderFirmaInvoiceList();
  } catch (err) {
    alert('Hata: ' + err.message);
  }
}

// ── ÖDEME TABLOSU ─────────────────────────────────────────────────────────────
async function loadDetailPayments(inv) {
  const wrap = document.getElementById('fd-payments-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="fd-loading">Yükleniyor...</div>';

  try {
    const payments = await apiGetPayments(inv.id);
    renderPaymentTable(payments, inv);
    updateSummaryCards(payments, inv);
  } catch (err) {
    wrap.innerHTML = `<div class="fd-loading" style="color:#ef4444;">Ödemeler yüklenemedi.</div>`;
  }
}

function updateSummaryCards(payments, inv) {
  const payable = _invPayable(inv);
  const totalPaid = (payments || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const remaining = Math.max(payable - totalPaid, 0);
  const iso = _invIso(inv);
  const label = iso === 'TRY' ? 'TL' : iso;
  const fmt = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const elPaid = document.getElementById('fd-paid-val');
  const elRem = document.getElementById('fd-remaining-val');
  if (elPaid) elPaid.textContent = `${fmt(totalPaid)} ${label}`;
  if (elRem) elRem.textContent = `${fmt(remaining)} ${label}`;
}

function renderPaymentTable(payments, inv) {
  const wrap = document.getElementById('fd-payments-wrap');
  if (!wrap) return;

  if (!payments || payments.length === 0) {
    wrap.innerHTML = '<div class="fd-no-payments">Henüz ödeme kaydı yok.</div>';
    return;
  }

  const iso = _invIso(inv);
  const label = iso === 'TRY' ? 'TL' : iso;
  const payable = _invPayable(inv);
  const fmt = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let cumulative = 0;
  const rows = payments.map((p, i) => {
    cumulative += parseFloat(p.amount) || 0;
    const remaining = Math.max(payable - cumulative, 0);
    const date = new Date(p.payment_date + 'T00:00:00').toLocaleDateString('tr-TR');
    return `
<tr id="fd-pay-row-${p.id}" class="${i % 2 !== 0 ? 'fd-tr-alt' : ''}">
  <td>${date}</td>
  <td class="fd-td-right fd-td-paid">${fmt(parseFloat(p.amount))} ${label}</td>
  <td class="fd-td-right ${remaining > 0 ? 'fd-td-remaining' : 'fd-td-zero'}">${fmt(remaining)} ${label}</td>
  <td class="fd-td-note">${p.notes ? p.notes.replace(/</g, '&lt;') : '—'}</td>
  <td class="fd-td-actions">
    <button class="fd-btn-edit"   onclick="startEditPayment('${p.id}','${inv.id}','${p.payment_date}',${parseFloat(p.amount)},'${(p.notes || '').replace(/'/g, "\\'")}')">✏️</button>
    <button class="fd-btn-delete" onclick="confirmDeletePayment('${p.id}','${inv.id}')">🗑️</button>
  </td>
</tr>`;
  }).join('');

  wrap.innerHTML = `
<table class="fd-table">
  <thead>
    <tr>
      <th>TARİH</th>
      <th class="fd-td-right">TUTAR</th>
      <th class="fd-td-right">KALAN</th>
      <th>NOT</th>
      <th class="fd-td-right">İŞLEM</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

// ── ÖDEME DÜZENLE ─────────────────────────────────────────────────────────────
function startEditPayment(payId, invoiceId, currentDate, currentAmount, currentNotes) {
  const tr = document.getElementById(`fd-pay-row-${payId}`);
  const today = new Date().toISOString().slice(0, 10);
  if (!tr) return;

  tr.innerHTML = `
<td><input type="date" id="fed-date-${payId}" value="${currentDate}" max="${today}" class="fd-inline-input" style="width:130px;"></td>
<td><input type="number" id="fed-amount-${payId}" value="${currentAmount}" step="0.01" class="fd-inline-input" style="width:100px;"></td>
<td>—</td>
<td><input type="text" id="fed-notes-${payId}" value="${currentNotes}" class="fd-inline-input" style="width:100%;"></td>
<td class="fd-td-actions">
  <button class="fd-btn-save-sm" onclick="saveEditPayment('${payId}','${invoiceId}')">💾</button>
  <button class="fd-btn-cancel-sm" onclick="loadDetailPayments(firmaSelectedInv)">✕</button>
</td>`;
}

async function saveEditPayment(payId, invoiceId) {
  const dateVal = document.getElementById(`fed-date-${payId}`)?.value;
  const amountVal = parseFloat(document.getElementById(`fed-amount-${payId}`)?.value);
  const notesVal = document.getElementById(`fed-notes-${payId}`)?.value?.trim() || '';
  const today = new Date().toISOString().slice(0, 10);

  if (!dateVal) { alert('Lütfen tarih girin.'); return; }
  if (dateVal > today) { alert('Gelecek tarihe ödeme eklenemez.'); return; }
  if (!amountVal || amountVal <= 0) { alert('Geçerli bir tutar girin.'); return; }

  try {
    await apiUpdatePayment(payId, amountVal, dateVal, notesVal);
    const payments = await apiGetPayments(invoiceId);
    const totalPaid = payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    const cached = firmaInvoices.find(i => String(i.id) === String(invoiceId));
    if (cached) {
      cached.paid_amount_cur = totalPaid;
      cached.paid_amount = totalPaid;
      firmaSelectedInv = cached;
    }
    await loadDetailPayments(firmaSelectedInv);
    renderFirmaInvoiceList();
  } catch (err) {
    alert('Hata: ' + err.message);
  }
}

async function confirmDeletePayment(paymentId, invoiceId) {
  if (!confirm('Bu ödeme kaydı silinsin mi?')) return;
  try {
    await apiDeletePayment(paymentId);
    const inv = firmaInvoices.find(i => String(i.id) === String(invoiceId));
    if (inv) await loadDetailPayments(inv);
    renderFirmaInvoiceList();
  } catch (err) {
    alert('Hata: ' + err.message);
  }
}
