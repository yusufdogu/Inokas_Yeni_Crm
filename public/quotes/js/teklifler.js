// quotes/js/teklifler.js
let _quotesCache = [];
let _activeMailId = null;

const STATUS_LABELS = {
  pending: { label: 'Beklemede', cls: 'badge-pending' },
  accepted: { label: 'Kabul', cls: 'badge-accepted' },
  rejected: { label: 'Red', cls: 'badge-rejected' },
  draft: { label: 'Taslak', cls: 'badge-draft' },
};

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function fmtMoney(v) {
  return (parseFloat(v) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadQuotes() {
  try {
    const res = await fetch('/api/quotes');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _quotesCache = await res.json();
  } catch (e) {
    _quotesCache = [];
    console.error('Teklifler yüklenemedi:', e.message);
  }
  applyFilters();
}

// ── Filter & Render ───────────────────────────────────────────────────────────
function applyFilters() {
  const q = (document.getElementById('searchInput')?.value || '').toLocaleLowerCase('tr-TR');
  const status = document.getElementById('statusFilter')?.value || '';

  let list = _quotesCache;
  if (status) list = list.filter(qt => qt.status === status);
  if (q) {
    list = list.filter(qt =>
      (qt.reference_no || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (qt.company_name || '').toLocaleLowerCase('tr-TR').includes(q) ||
      (qt.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q)
    );
  }

  const countEl = document.getElementById('quoteCount');
  if (countEl) countEl.textContent = `${list.length} teklif`;

  renderTable(list);
}

function renderTable(list) {
  const tbody = document.getElementById('quotesTbody');
  const empty = document.getElementById('quotesEmpty');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = list.map(qt => {
    const st = STATUS_LABELS[qt.status] || { label: qt.status, cls: 'badge-draft' };
    const company = esc(qt.company_name || qt.companies?.name || '—');
    return `<tr>
      <td><strong>${esc(qt.reference_no)}</strong></td>
      <td>${company}</td>
      <td>${esc(qt.job_name || '—')}</td>
      <td>${fmtDate(qt.quote_date)}</td>
      <td>${fmtDate(qt.valid_until)}</td>
      <td style="text-align:right;">${fmtMoney(qt.total_excl_tax)}</td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn-icon" title="Düzenle" onclick="editQuote('${qt.id}')"><i class="ti ti-pencil"></i></button>
          <button class="btn-icon" title="PDF" onclick="openPdf('${qt.id}')"><i class="ti ti-file-type-pdf"></i></button>
          <button class="btn-icon" title="Mail Gönder" onclick="openMailModal('${qt.id}', '${esc(qt.company_name || '')}', '${esc(qt.reference_no)}')"><i class="ti ti-mail"></i></button>
          <button class="btn-icon danger" title="Sil" onclick="deleteQuote('${qt.id}', '${esc(qt.reference_no)}')"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Actions ───────────────────────────────────────────────────────────────────
function editQuote(id) {
  window.location.href = `/quotes/pages/teklif-form.html?id=${encodeURIComponent(id)}`;
}

async function openPdf(id) {
  const toast = document.createElement('div');
  toast.textContent = 'PDF hazırlanıyor...';
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;color:#fff;padding:12px 20px; border - radius: 10px; font - size: 13px; font - weight: 600; z - index: 9999; ';
  document.body.appendChild(toast);
  try {
    const token = sessionStorage.getItem('inokas_token');
    const res = await fetch(`/api/quotes/${encodeURIComponent(id)}/pdf`, { headers: { 'x-auth-token': token } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } finally {
    document.body.removeChild(toast);
  }
}




async function deleteQuote(id, refNo) {
  if (!confirm(`"${refNo}" teklifini silmek istiyor musunuz?`)) return;
  try {
    const res = await fetch(`/api/quotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _quotesCache = _quotesCache.filter(qt => qt.id !== id);
    applyFilters();
  } catch (e) {
    alert('Silme hatası: ' + e.message);
  }
}

// ── Mail Modal ────────────────────────────────────────────────────────────────
function openMailModal(id, companyName, refNo) {
  _activeMailId = id;
  document.getElementById('mailTo').value = '';
  document.getElementById('mailSubject').value = `Fiyat Teklifi — ${refNo}`;
  document.getElementById('mailBody').value = `Sayın İlgili,\n\nİlgili projeniz kapsamında hazırlamış olduğumuz teklifimiz ekte sunulmuştur.\n\nSaygılarımızla...`;
  document.getElementById('mailModal').classList.remove('hidden');
}

function closeMailModal() {
  document.getElementById('mailModal').classList.add('hidden');
  _activeMailId = null;
}

async function sendMail() {
  const to = document.getElementById('mailTo').value.trim();
  const subject = document.getElementById('mailSubject').value.trim();
  const body = document.getElementById('mailBody').value.trim();

  if (!to) { alert('E-posta adresi gerekli.'); return; }

  try {
    const res = await fetch(`/api/quotes/${encodeURIComponent(_activeMailId)}/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    alert('Mail başarıyla gönderildi.');
    closeMailModal();
  } catch (e) {
    alert('Mail hatası: ' + e.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadQuotes);
