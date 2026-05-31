// quotes/js/teklifler.js
let _quotesCache = [];
let _activeMailId = null;
let _activeMailCompany = null;

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
  _activeMailCompany = companyName;
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
    // 1. PDF indir
    const token = sessionStorage.getItem('inokas_token');
    const res = await fetch(`/api/quotes/${encodeURIComponent(_activeMailId)}/pdf`, {
      headers: { 'x-auth-token': token }
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fileName = (_activeMailCompany || 'teklif').replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ\s]/g, '').trim() + '.pdf';
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // 2. Outlook compose aç
    const outlookUrl = 'https://outlook.office.com/mail/deeplink/compose?' +
      'to=' + encodeURIComponent(to) +
      '&subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
    window.open(outlookUrl, '_blank');

    closeMailModal();
  } catch (e) {
    alert('Hata: ' + e.message);
  }
}

// ── Company Search Dropdown (filter bar) ──────────────────────────────────────
let _searchTimer = null;

function onSearchInput() {
  const q = document.getElementById('searchInput').value.trim();
  clearTimeout(_searchTimer);
  if (q.length < 1) { closeSearchDropdown(); applyFilters(); return; }
  _searchTimer = setTimeout(() => fetchCompanySuggestions(q), 250);
}

async function fetchCompanySuggestions(q) {
  try {
    const res  = await fetch(`/api/companies/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const list = await res.json();
    renderSearchDropdown(list);
  } catch { closeSearchDropdown(); }
}

function renderSearchDropdown(list) {
  const dd = document.getElementById('searchDropdown');
  if (!list.length) { closeSearchDropdown(); return; }
  dd.innerHTML = '';
  list.forEach(c => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:9px 14px; font-size:13px; cursor:pointer; color:var(--text-main); border-bottom:1px solid #f5f0eb;';
    item.textContent = c.name;
    item.addEventListener('mouseenter', () => item.style.background = '#fdf9f5');
    item.addEventListener('mouseleave', () => item.style.background = '');
    item.addEventListener('click', () => selectSearchCompany(c.name));
    dd.appendChild(item);
  });
  dd.style.display = 'block';
}

function selectSearchCompany(name) {
  document.getElementById('searchInput').value = name;
  closeSearchDropdown();
  applyFilters();
}

function closeSearchDropdown() {
  const dd = document.getElementById('searchDropdown');
  if (dd) dd.style.display = 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('#searchInput') && !e.target.closest('#searchDropdown')) {
    closeSearchDropdown();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadQuotes);
