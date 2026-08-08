// offers/js/teklifler.js  —  MERGED: quote list + in-page overlay form (create & edit)
// -----------------------------------------------------------------------------------
//  Sections:
//    A. Shared utils
//    B. List: load / filter / render / row-actions
//    C. Mail modal
//    D. Filter-bar company search dropdown
//    E. Quote form panel: open / close / mode setup
//    F. Stepper / tabs
//    G. Validation / toast
//    H. Create (finish) / Edit (save) / payload
//    I. Load quote + groups
//    J. Rows / recalc / unit-takim
//    K. Terms / extra columns
//    L. Product & company autocomplete (inside form)
//    M. Init
// -----------------------------------------------------------------------------------

let _products = [];
let _companies = [];   // preloaded company list

// ═══════════════════════════════════════════════════════════════════════════════
//  A. SHARED UTILS
// ═══════════════════════════════════════════════════════════════════════════════
// esc() escapes offers too, because it is used inside HTML *attribute* values in the
// form rows. Safe for text content as well.
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function fmtMoney(v) {
  return (parseFloat(v) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  B. LIST
// ═══════════════════════════════════════════════════════════════════════════════
let _offersCache = [];

const STATUS_LABELS = {
  pending: { label: 'Beklemede', cls: 'badge-pending' },
  accepted: { label: 'Kabul', cls: 'badge-accepted' },
  rejected: { label: 'Red', cls: 'badge-rejected' },
  draft: { label: 'Taslak', cls: 'badge-draft' },
};

async function loadoffers() {
  try {
    const res = await fetch('/api/offers');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _offersCache = await res.json();
  } catch (e) {
    _offersCache = [];
    console.error('Teklifler yüklenemedi:', e.message);
  }
  applyFilters();
}

function applyFilters() {
  const q = (document.getElementById('searchInput')?.value || '').toLocaleLowerCase('tr-TR');
  const status = document.getElementById('statusFilter')?.value || '';

  let list = _offersCache;
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
  const tbody = document.getElementById('offersTbody');
  const empty = document.getElementById('offersEmpty');
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

// Edit now opens the same in-page panel instead of navigating away.
function editQuote(id) {
  openQuotePanel(id);
}

async function openPdf(id) {
  const toast = document.createElement('div');
  toast.textContent = 'PDF hazırlanıyor...';
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;color:#fff;padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;';
  document.body.appendChild(toast);
  try {
    const token = sessionStorage.getItem('login_auth_token');
    const res = await fetch(`/api/offers/${encodeURIComponent(id)}/pdf`, { headers: { 'x-auth-token': token } });
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
    const res = await fetch(`/api/offers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _offersCache = _offersCache.filter(qt => qt.id !== id);
    applyFilters();
  } catch (e) {
    alert('Silme hatası: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  C. MAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════════
let _activeMailId = null;
let _activeMailCompany = null;

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
    const token = sessionStorage.getItem('login_auth_token');
    const res = await fetch(`/api/offers/${encodeURIComponent(_activeMailId)}/pdf`, {
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

// ═══════════════════════════════════════════════════════════════════════════════
//  D. FILTER-BAR COMPANY SEARCH DROPDOWN
// ═══════════════════════════════════════════════════════════════════════════════
let _searchTimer = null;

function onSearchInput() {
  const q = document.getElementById('searchInput').value.trim();
  clearTimeout(_searchTimer);
  if (q.length < 1) { closeSearchDropdown(); applyFilters(); return; }
  _searchTimer = setTimeout(() => fetchCompanySuggestions(q), 250);
}

async function fetchCompanySuggestions(q) {
  try {
    const res = await fetch(`/api/companies/search?q=${encodeURIComponent(q)}`);
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

// ═══════════════════════════════════════════════════════════════════════════════
//  E. QUOTE FORM PANEL — open / close / mode
// ═══════════════════════════════════════════════════════════════════════════════
let _quoteId = null;         // id being edited (null = create)
let _rowCount = 0;
let _groups = [];
let _extraColumns = [];
let _currentStep = 1;
let _savedQuoteId = null;
let _groupsLoaded = false;

const TOTAL_STEPS = 3;

// Open the panel. Pass an id to edit, or nothing to create.
async function openQuotePanel(id = null) {
  _quoteId = id || null;

  // reset transient form state
  _rowCount = 0;
  _extraColumns = [];
  _currentStep = 1;
  _savedQuoteId = null;

  // clear previous form contents
  resetFormFields();

  // show overlay
  const overlay = document.getElementById('quotePanelOverlay');
  overlay.classList.remove('hidden');
  document.body.classList.add('panel-open');

  // groups only need to load once per page life
  if (!_groupsLoaded) {   await Promise.all([loadGroups(), loadProducts(), loadCompanies()]);  _groupsLoaded = true; }

  document.getElementById('quoteDate').value = new Date().toISOString().slice(0, 10);

  if (_quoteId) {
    initEditMode();
    document.getElementById('formTitle').textContent = 'Teklif Düzenle';
    await loadQuote(_quoteId);
  } else {
    initCreateMode();
    document.getElementById('formTitle').textContent = 'Yeni Teklif';
    try {
      const res = await fetch('/api/offers/next-ref-no');
      const data = await res.json().catch(() => ({}));
      if (data.reference_no) document.getElementById('formRefNo').value = data.reference_no;
    } catch { /* non-fatal */ }
    addRow();
    renderTerms([]);
    document.getElementById('quoteNotes').value =
      'Sayın ilgili;\nİlgili projeniz kapsamında ihtiyacınız olan ürünler ve hizmetler için hazırlamış olduğumuz teklifimiz ekte görüş ve değerlendirmelerinize sunulmuştur.\nTeklifimiz ile ilgili her türlü soru ve görüşlerinizi lütfen bizimle paylaşınız.\nSaygılarımızla…';
  }
}

function closeQuotePanel() {
  document.getElementById('quotePanelOverlay').classList.add('hidden');
  document.body.classList.remove('panel-open');
  // make sure the success overlay isn't left showing
  document.getElementById('successOverlay')?.classList.remove('show');
}

// Wipe fields so a reopened panel never shows stale data.
function resetFormFields() {
  document.getElementById('formRefNo').textContent = '';
  ['companyName', 'jobName', 'validUntil', 'quoteNotes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const qt = document.getElementById('quoteType'); if (qt) qt.value = '';
  const cur = document.getElementById('currency'); if (cur) cur.value = 'TRY';
  const ss = document.getElementById('statusSelect'); if (ss) ss.value = 'pending';
  const hss = document.getElementById('headerStatusSelect'); if (hss) hss.value = 'pending';
  document.getElementById('itemsTbody').innerHTML = '';
  document.getElementById('termsList').innerHTML = '';
  // remove any extra-column headers left over
  document.querySelectorAll('#itemsTheadRow .extra-col-th').forEach(el => el.remove());
  const td = document.getElementById('totalDisplay'); if (td) td.textContent = '₺0,00';

  const btn = document.getElementById('finishBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-file-type-pdf"></i> PDF Oluştur';
  }
  document.getElementById('successOverlay')?.classList.remove('show');
}

function initCreateMode() {
  document.getElementById('stepperBar').style.display = 'flex';
  document.getElementById('tabBar').style.display = 'none';
  document.getElementById('headerActions').style.display = 'none';
  document.getElementById('createStatusGroup').style.display = 'flex';
  showStep(1);
}

function initEditMode() {
  document.getElementById('stepperBar').style.display = 'none';
  document.getElementById('tabBar').style.display = 'flex';
  document.getElementById('headerActions').style.display = 'flex';
  document.getElementById('createStatusGroup').style.display = 'none';
  document.querySelectorAll('.step-nav-bar').forEach(n => n.style.display = 'none');
  switchTab(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  F. STEPPER / TABS
// ═══════════════════════════════════════════════════════════════════════════════
function switchTab(n) {
  document.querySelectorAll('.step-card').forEach(c => c.style.display = 'none');
  document.getElementById(`card${n}`).style.display = 'block';

  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab${n}`).classList.add('active');

  document.getElementById('formArea').scrollTop = 0;
}

function showStep(n) {
  _currentStep = n;

  document.querySelectorAll('.step-card').forEach(c => c.style.display = 'none');
  document.querySelectorAll('.step-nav-bar').forEach(nav => nav.style.display = 'none');

  document.getElementById(`card${n}`).style.display = 'block';
  document.getElementById(`nav${n}`).style.display = 'flex';

  updateStepper(n);
  document.getElementById('formArea').scrollTop = 0;
}

function updateStepper(step) {
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const circle = document.getElementById(`scircle${i}`);
    const stepEl = document.getElementById(`sstep${i}`);

    if (i < step) {
      circle.innerHTML = '<i class="ti ti-check"></i>';
      stepEl.className = 'stepper-step done';
    } else if (i === step) {
      circle.innerHTML = i;
      stepEl.className = 'stepper-step active';
    } else {
      circle.innerHTML = i;
      stepEl.className = 'stepper-step';
    }

    if (i < TOTAL_STEPS) {
      const line = document.getElementById(`sline${i}`);
      line.className = i < step ? 'stepper-line done' : 'stepper-line';
    }
  }
}

function nextStep() {
  if (_currentStep === 1 && !validateStep1()) return;
  if (_currentStep < TOTAL_STEPS) showStep(_currentStep + 1);
}

function prevStep() {
  if (_currentStep > 1) showStep(_currentStep - 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  G. VALIDATION / TOAST
// ═══════════════════════════════════════════════════════════════════════════════
function validateStep1() {
  const company = document.getElementById('companyName').value.trim();
  const date = document.getElementById('quoteDate').value;
  const type = document.getElementById('quoteType').value;

  if (!company) { highlightError('companyName', 'Şirket adı gerekli.'); return false; }
  if (!date) { highlightError('quoteDate', 'Teklif tarihi gerekli.'); return false; }
  if (!type) { highlightError('quoteType', 'Teklif türü seçilmeli.'); return false; }
  return true;
}

function validateStep3() {
  const rows = document.querySelectorAll('#itemsTbody tr');
  if (!rows.length) { showToast('En az bir ürün kalemi ekleyin.'); return false; }

  for (let i = 0; i < rows.length; i++) {
    const id = rows[i].id;
    const name = document.getElementById(`name_${id}`)?.value.trim() || '';
    const qty = parseFloat(document.getElementById(`qty_${id}`)?.value) || 0;
    const price = document.getElementById(`price_${id}`)?.value.trim() ?? '';

    if (!name) { showToast(`${i + 1}. satırda ürün adı boş olamaz.`); return false; }
    if (qty <= 0) { showToast(`${i + 1}. satırda miktar 0'dan büyük olmalı.`); return false; }
    if (price === '') { showToast(`${i + 1}. satırda birim fiyat boş olamaz.`); return false; }
  }
  return true;
}

function highlightError(fieldId, message) {
  const el = document.getElementById(fieldId);
  if (el) {
    el.style.borderColor = '#dc2626';
    el.focus();
    setTimeout(() => { el.style.borderColor = ''; }, 2500);
  }
  showToast(message);
}

let _toastTimer = null;
function showToast(message) {
  let toast = document.getElementById('formToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'formToast';
    toast.className = 'form-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  H. CREATE (finish) / EDIT (save) / payload
// ═══════════════════════════════════════════════════════════════════════════════
async function finishQuote() {
  if (!validateStep3()) return;

  const btn = document.getElementById('finishBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Kaydediliyor...';

  try {
    const id = await saveQuoteAndGetId();
    _savedQuoteId = id;
    document.getElementById('successOverlay').classList.add('show');
  } catch (e) {
    showToast('Hata: ' + e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-file-type-pdf"></i> PDF Oluştur';
  }
}

async function saveQuoteAndGetId() {
  const payload = buildPayload();
  const res = await fetch('/api/offers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 409) {
    const { error } = await res.json().catch(() => ({}));
    alert(error || 'Bu referans numarası zaten kullanılıyor.');
    document.getElementById('formRefNo').focus();
    return;   // stop — don't close panel or show success
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data.id || data.quote?.id;
}

async function showPdf() {
  if (!_savedQuoteId) return;
  const btn = document.querySelector('.btn-show-pdf');
  if (btn) { btn.disabled = true; btn.textContent = 'Hazırlanıyor...'; }
  try {
    const res = await fetch(`/api/offers/${encodeURIComponent(_savedQuoteId)}/pdf`);
    if (res.ok || res.redirected) {
      window.open(res.url, '_blank');
    } else {
      showToast('PDF henüz hazır değil, bir dakika bekleyin.');
    }
  } catch {
    showToast('PDF açılamadı.');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-external-link"></i> Teklifi Göster'; }
  }
}

// Success-overlay "Tekliflerime Git": close panel and refresh the list in place.
function goToList() {
  closeQuotePanel();
  loadoffers();
}

async function saveQuote() {
  const referenceNo = document.getElementById('formRefNo').value.trim();
  const company_name = document.getElementById('companyName').value.trim();
  const quote_date = document.getElementById('quoteDate').value;
  const items = collectItems();

  if (!referenceNo) { alert('Referans No gerekli.'); return; }
  if (!company_name) { alert('Şirket adı gerekli.'); return; }
  if (!quote_date) { alert('Teklif tarihi gerekli.'); return; }
  if (!items.length) { alert('En az bir ürün kalemi ekleyin.'); return; }

  const payload = buildPayload(true);

  try {
    const url = `/api/offers/${encodeURIComponent(_quoteId)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      const { error } = await res.json().catch(() => ({}));
      alert(error || 'Bu referans numarası zaten kullanılıyor.');
      document.getElementById('formRefNo').focus();
      return;   // stop — don't close panel or show success
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    // stay on page: close panel + reload list
    closeQuotePanel();
    await loadoffers();
  } catch (e) {
    alert('Kaydetme hatası: ' + e.message);
  }
}

function buildPayload(isEdit = false) {
  const statusEl = isEdit
    ? document.getElementById('headerStatusSelect')
    : document.getElementById('statusSelect');

  return {
    reference_no: document.getElementById('formRefNo').value.trim(),
    company_name: document.getElementById('companyName').value.trim(),
    job_name: document.getElementById('jobName').value.trim() || null,
    quote_date: document.getElementById('quoteDate').value,
    valid_until: document.getElementById('validUntil').value || null,
    notes: document.getElementById('quoteNotes').value.trim() || null,
    quote_type: document.getElementById('quoteType').value || null,
    status: statusEl?.value || 'pending',
    terms: getTerms(),
    extra_columns: _extraColumns,
    currency: document.getElementById('currency').value || 'TRY',
    items: collectItems(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  I. LOAD QUOTE + GROUPS
// ═══════════════════════════════════════════════════════════════════════════════
async function loadGroups() {
  try {
    const res = await fetch('/api/offers/product-groups/list');
    if (!res.ok) return;
    _groups = await res.json();
  } catch (e) {
    console.warn('Takımlar yüklenemedi:', e.message);
  }
}
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) return;
    _products = await res.json();
  } catch (e) {
    console.warn('Ürünler yüklenemedi:', e.message);
  }
}
async function loadCompanies() {
  try {
    const res = await fetch('/api/companies');
    if (!res.ok) return;
    _companies = await res.json();
  } catch (e) {
    console.warn('Firmalar yüklenemedi:', e.message);
  }
}

async function loadQuote(id) {
  try {
    const res = await fetch(`/api/offers/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const qt = await res.json();

    document.getElementById('formRefNo').value = qt.reference_no || '';
    document.getElementById('companyName').value = qt.company_name || '';
    document.getElementById('jobName').value = qt.job_name || '';
    document.getElementById('quoteDate').value = (qt.quote_date || '').slice(0, 10);
    document.getElementById('validUntil').value = (qt.valid_until || '').slice(0, 10);
    document.getElementById('currency').value = qt.currency || 'TRY';
    document.getElementById('quoteNotes').value = qt.notes || '';
    document.getElementById('quoteType').value = qt.quote_type || '';
    document.getElementById('headerStatusSelect').value = qt.status || 'pending';

    renderTerms(qt.terms || []);
    _extraColumns = qt.extra_columns || [];
    renderExtraColumnHeaders();
    (qt.quote_items || []).forEach(it => addRow(it));
  } catch (e) {
    alert('Teklif yüklenemedi: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  J. ROWS / RECALC / UNIT-TAKIM
// ═══════════════════════════════════════════════════════════════════════════════
function addRow(item = null) {
  _rowCount++;
  const rowId = `row_${_rowCount}`;
  const tbody = document.getElementById('itemsTbody');

  const groupOptions = _groups.map(g =>
    `<option value="${g.id}">${g.group_name}</option>`
  ).join('');

  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.innerHTML = `
    <td><span class="sira-no" id="sira_${rowId}"></span></td>
    <td><input type="text" class="item-input" id="code_${rowId}" placeholder="Ürün kodu" value="${esc(item?.product_code || '')}" oninput="onCodeInput('${rowId}')" onfocus="onCodeFocus('${rowId}')" autocomplete="off"></td>
    <td><input type="text" class="item-input" id="name_${rowId}" placeholder="Ürün adı" value="${esc(item?.product_name || '')}" oninput="onNameInput('${rowId}')" onfocus="onNameFocus('${rowId}')" autocomplete="off"></td>
    <td>
      <div class="unit-cell">
        <select class="unit-select" id="unit_${rowId}" onchange="onUnitChange('${rowId}')">
          <option value="ADET"${(!item || item.unit === 'ADET') ? ' selected' : ''}>ADET</option>
          <option value="TAKIM"${item?.unit === 'TAKIM' ? ' selected' : ''}>TAKIM</option>
        </select>
        <select class="takim-select${item?.unit === 'TAKIM' ? ' visible' : ''}" id="takim_${rowId}" onchange="onTakimSelect('${rowId}')">
          <option value="">Takım seç...</option>
          ${groupOptions}
        </select>
      </div>
    </td>
    <td><input type="number" class="item-input" id="qty_${rowId}" value="${item?.quantity ?? 1}" min="1" oninput="recalcRow('${rowId}')"></td>
    <td><input type="number" class="item-input" id="price_${rowId}" value="${item?.unit_price ?? ''}" placeholder="0" oninput="recalcRow('${rowId}')"></td>
    <td><input type="number" class="item-input" id="total_${rowId}" value="${item?.total_price ?? ''}" placeholder="0" readonly style="background:#f5f0eb; color:var(--text-sub);"></td>
    <td><button class="btn-row-del" onclick="removeRow('${rowId}')"><i class="ti ti-x"></i></button></td>
  `;
  tbody.appendChild(tr);

  if (_extraColumns.length) {
    const lastTd = tr.querySelector('td:last-child');
    _extraColumns.forEach((col, i) => {
      const extraVals = item?.extra_columns || {};
      const val = extraVals[col] || '';
      const td = document.createElement('td');
      td.className = 'extra-col-td';
      td.innerHTML = `<input type="text" class="item-input extra-col-input" data-col="${i}" value="${esc(val)}" placeholder="${esc(col)}...">`;
      tr.insertBefore(td, lastTd);
    });
  }
  reindexRows();
  recalcRow(rowId);
}

function removeRow(rowId) {
  document.getElementById(rowId)?.remove();
  reindexRows();
  recalcTotal();
}

function reindexRows() {
  document.querySelectorAll('#itemsTbody tr').forEach((tr, i) => {
    const sira = tr.querySelector('.sira-no');
    if (sira) sira.textContent = i + 1;
  });
}

function recalcRow(rowId) {
  const qty = parseFloat(document.getElementById(`qty_${rowId}`)?.value) || 0;
  const price = parseFloat(document.getElementById(`price_${rowId}`)?.value) || 0;
  const total = qty * price;
  const el = document.getElementById(`total_${rowId}`);
  if (el) el.value = total ? total.toFixed(2) : '';
  recalcTotal();
}

function recalcTotal() {
  let sum = 0;
  document.querySelectorAll('#itemsTbody tr').forEach(tr => {
    sum += parseFloat(document.getElementById(`total_${tr.id}`)?.value) || 0;
  });
  const cur = document.getElementById('currency')?.value || 'TRY';
  const symbols = { TRY: '₺', USD: '$', EUR: '€' };
  document.getElementById('totalDisplay').textContent =
    (symbols[cur] || cur) + sum.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function recalc() { recalcTotal(); }

function onUnitChange(rowId) {
  const unit = document.getElementById(`unit_${rowId}`)?.value;
  const takimSel = document.getElementById(`takim_${rowId}`);
  if (!takimSel) return;
  if (unit === 'TAKIM') {
    takimSel.classList.add('visible');
  } else {
    takimSel.classList.remove('visible');
    takimSel.value = '';
  }
}

async function onTakimSelect(rowId) {
  const groupId = document.getElementById(`takim_${rowId}`)?.value;
  if (!groupId) return;

  try {
    const res = await fetch(`/api/offers/product-groups/${encodeURIComponent(groupId)}/items`);
    if (!res.ok) return;
    const items = await res.json();
    if (!items.length) return;

    const qty = parseFloat(document.getElementById(`qty_${rowId}`)?.value) || 1;
    const currentRow = document.getElementById(rowId);
    const tbody = document.getElementById('itemsTbody');

    items.forEach(it => {
      _rowCount++;
      const newId = `row_${_rowCount}`;
      const tr = document.createElement('tr');
      tr.id = newId;
      const groupOptions = _groups.map(g =>
        `<option value="${g.id}">${g.group_name}</option>`
      ).join('');
      tr.innerHTML = `
        <td><span class="sira-no" id="sira_${newId}"></span></td>
        <td><input type="text" class="item-input" id="code_${newId}" value="${esc(it.product_code || '')}"></td>
        <td><input type="text" class="item-input" id="name_${newId}" value="${esc(it.product_name || '')}"></td>
        <td>
          <div class="unit-cell">
            <select class="unit-select" id="unit_${newId}" onchange="onUnitChange('${newId}')">
              <option value="ADET" selected>ADET</option>
              <option value="TAKIM">TAKIM</option>
            </select>
            <select class="takim-select" id="takim_${newId}" onchange="onTakimSelect('${newId}')">
              <option value="">Takım seç...</option>
              ${groupOptions}
            </select>
          </div>
        </td>
        <td><input type="number" class="item-input" id="qty_${newId}" value="${qty}" min="1" oninput="recalcRow('${newId}')"></td>
        <td><input type="number" class="item-input" id="price_${newId}" placeholder="0" oninput="recalcRow('${newId}')"></td>
        <td><input type="number" class="item-input" id="total_${newId}" placeholder="0" readonly style="background:#f5f0eb; color:var(--text-sub);"></td>
        <td><button class="btn-row-del" onclick="removeRow('${newId}')"><i class="ti ti-x"></i></button></td>
      `;
      tbody.insertBefore(tr, currentRow);
    });

    currentRow.remove();
    reindexRows();
    recalcTotal();
  } catch (e) {
    console.error('Takım ürünleri yüklenemedi:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  K. TERMS / EXTRA COLUMNS
// ═══════════════════════════════════════════════════════════════════════════════
function collectItems() {
  const rows = document.querySelectorAll('#itemsTbody tr');
  const items = [];
  rows.forEach((tr, i) => {
    const id = tr.id;
    items.push({
      sort_order: i + 1,
      product_code: document.getElementById(`code_${id}`)?.value.trim() || null,
      product_name: document.getElementById(`name_${id}`)?.value.trim() || '',
      unit: document.getElementById(`unit_${id}`)?.value || 'ADET',
      quantity: parseFloat(document.getElementById(`qty_${id}`)?.value) || 1,
      unit_price: parseFloat(document.getElementById(`price_${id}`)?.value) || 0,
      total_price: parseFloat(document.getElementById(`total_${id}`)?.value) || 0,
      extra_columns: getExtraColumnValues(tr),
    });
  });
  return items;
}

function renderTerms(terms) {
  const list = document.getElementById('termsList');
  if (!list) return;
  const rows = (terms && terms.length ? terms : ['1)Teklifimizdeki fiyatlara KDV dahil değildir.']);
  list.innerHTML = rows.map((t, i) => `
    <div class="terms-row" style="display:flex; gap:8px; margin-bottom:8px;">
      <input type="text" class="form-input term-input" value="${t.replace(/"/g, '&quot;')}" placeholder="Husus yaz...">
      <button type="button" onclick="removeTermRow(${i})"
        style="flex-shrink:0; background:none; border:1px solid #fca5a5; border-radius:6px;
          padding:4px 10px; color:#ef4444; cursor:pointer; font-size:13px; font-family:inherit;">✕</button>
    </div>
  `).join('');
}

function addTermRow() {
  const list = document.getElementById('termsList');
  const idx = list.querySelectorAll('.terms-row').length;
  const div = document.createElement('div');
  div.className = 'terms-row';
  div.style.cssText = 'display:flex; gap:8px; margin-bottom:8px;';
  div.innerHTML = `
    <input type="text" class="form-input term-input" placeholder="Husus yaz...">
    <button type="button" onclick="removeTermRow(${idx})"
      style="flex-shrink:0; background:none; border:1px solid #fca5a5; border-radius:6px;
        padding:4px 10px; color:#ef4444; cursor:pointer; font-size:13px; font-family:inherit;">✕</button>
  `;
  list.appendChild(div);
}

function removeTermRow(idx) {
  const rows = document.getElementById('termsList').querySelectorAll('.terms-row');
  if (rows[idx]) rows[idx].remove();
  document.getElementById('termsList').querySelectorAll('.terms-row').forEach((row, i) => {
    const btn = row.querySelector('button');
    if (btn) btn.setAttribute('onclick', `removeTermRow(${i})`);
  });
}

function getTerms() {
  return [...document.getElementById('termsList').querySelectorAll('.term-input')]
    .map(el => el.value.trim()).filter(Boolean);
}

function addExtraColumn() {
  const name = prompt('Kolon adı girin:');
  if (!name || !name.trim()) return;
  _extraColumns.push(name.trim());
  renderExtraColumnHeaders();
  refreshAllRowExtraCells();
}

function removeExtraColumn(idx) {
  _extraColumns.splice(idx, 1);
  renderExtraColumnHeaders();
  refreshAllRowExtraCells();
}

function renderExtraColumnHeaders() {
  const thead = document.getElementById('itemsTheadRow');
  if (!thead) return;
  thead.querySelectorAll('.extra-col-th').forEach(el => el.remove());
  const lastTh = thead.querySelector('th:last-child');
  _extraColumns.forEach((col, i) => {
    const th = document.createElement('th');
    th.className = 'extra-col-th';
    th.style.cssText = 'min-width:120px; font-size: 15px;';
    th.innerHTML = `${esc(col)} <span onclick="removeExtraColumn(${i})" style="cursor:pointer;color:#ef4444;font-size:10px;margin-left:4px;">✕</span>`;
    thead.insertBefore(th, lastTh);
  });
}

function refreshAllRowExtraCells() {
  document.querySelectorAll('#itemsTbody tr').forEach(row => {
    const savedVals = {};
    row.querySelectorAll('.extra-col-input').forEach(input => {
      savedVals[parseInt(input.dataset.col)] = input.value;
    });
    row.querySelectorAll('.extra-col-td').forEach(el => el.remove());
    const lastTd = row.querySelector('td:last-child');
    _extraColumns.forEach((col, i) => {
      const td = document.createElement('td');
      td.className = 'extra-col-td';
      const val = savedVals[i] !== undefined ? savedVals[i] : '';
      td.innerHTML = `<input type="text" class="item-input extra-col-input" data-col="${i}" value="${esc(val)}" placeholder="${esc(col)}...">`;
      row.insertBefore(td, lastTd);
    });
  });
}

function getExtraColumnValues(row) {
  const vals = {};
  row.querySelectorAll('.extra-col-input').forEach(input => {
    vals[_extraColumns[parseInt(input.dataset.col)]] = input.value.trim();
  });
  return vals;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  L. PRODUCT & COMPANY AUTOCOMPLETE (inside form)
// ═══════════════════════════════════════════════════════════════════════════════
// ── Product Autocomplete (name + code, client-side) ───────────────────────────
let _activeProdRowId = null;
let _activeProdField = 'code'; // 'name' | 'code'

function _getProductDrop() {
  let dd = document.getElementById('_productNameDrop');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = '_productNameDrop';
    dd.style.cssText = [
      'display:none', 'position:fixed', 'background:#fff',
      'border:1px solid var(--border)', 'border-radius:8px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.12)', 'z-index:9999',
      'max-height:260px', 'overflow-y:auto'
    ].join(';');
    document.body.appendChild(dd);
  }
  return dd;
}

function _filterProducts(q, field) {
  const s = (q || '').toLocaleLowerCase('tr-TR').trim();
  const key = field === 'code' ? 'product_code' : 'product_name';

  if (!s) {
    // empty focus → top 15 sorted by the field's key
    return _products
      .slice()
      .sort((a, b) => (a[key] || '').localeCompare(b[key] || '', 'tr'));
  }

  const matches = _products.filter(p =>
    (p.product_name || '').toLocaleLowerCase('tr-TR').includes(s) ||
    (p.product_code || '').toLocaleLowerCase('tr-TR').includes(s)
  );

  // rank: field-key starts-with → field-key contains → other
  matches.sort((a, b) => {
    const av = (a[key] || '').toLocaleLowerCase('tr-TR');
    const bv = (b[key] || '').toLocaleLowerCase('tr-TR');
    const aStarts = av.startsWith(s) ? 0 : 1;
    const bStarts = bv.startsWith(s) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return av.localeCompare(bv, 'tr');
  });

  return matches;
}
// Called on focus + input of the NAME field
function onNameFocus(rowId) { _openProdDrop(rowId, 'name'); }
function onNameInput(rowId) { _openProdDrop(rowId, 'name'); }

// Called on focus + input of the CODE field
function onCodeFocus(rowId) { _openProdDrop(rowId, 'code'); }
function onCodeInput(rowId) { _openProdDrop(rowId, 'code'); }

function _openProdDrop(rowId, field) {
  _activeProdRowId = rowId;
  _activeProdField = field;
  const input = document.getElementById(`${field}_${rowId}`);
  if (!input) return;
  const list = _filterProducts(input.value, field);
  renderProdDrop(input, list, field);
}

function renderProdDrop(input, list, field) {
  const dd = _getProductDrop();
  if (!list.length) { closeNameDrop(); return; }

  const rect = input.getBoundingClientRect();
  dd.style.top   = (rect.bottom + 4) + 'px';
  dd.style.left  = rect.left + 'px';
  dd.style.width = Math.max(rect.width, 280) + 'px';

  dd.innerHTML = '';
  list.forEach(p => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:9px 12px; font-size:13px; cursor:pointer; color:var(--text-main); border-bottom:1px solid #f5f0eb;';
    // code field → lead with code; name field → lead with name
    if (field === 'code') {
      item.innerHTML = `<span style="font-weight:600;">${esc(p.product_code || '—')}</span><span style="font-size:11px; color:var(--text-sub); margin-left:8px;">${esc(p.product_name)}</span>`;
    } else {
      item.innerHTML = `<span style="font-weight:600;">${esc(p.product_name)}</span>${p.product_code ? `<span style="font-size:11px; color:var(--text-sub); margin-left:8px;">${esc(p.product_code)}</span>` : ''}`;
    }
    item.addEventListener('mouseenter', () => item.style.background = '#fdf9f5');
    item.addEventListener('mouseleave', () => item.style.background = '');
    item.addEventListener('mousedown', (e) => {  // mousedown → fires before blur
      e.preventDefault();
      selectProduct(_activeProdRowId, p.product_code || '', p.product_name || '');
    });
    dd.appendChild(item);
  });
  dd.style.display = 'block';
}
function selectProduct(rowId, code, name) {
  const nameEl = document.getElementById(`name_${rowId}`);
  const codeEl = document.getElementById(`code_${rowId}`);
  if (nameEl) nameEl.value = name;
  if (codeEl) codeEl.value = code;
  closeNameDrop();
}

function closeNameDrop() {
  const dd = document.getElementById('_productNameDrop');
  if (dd) dd.style.display = 'none';
}

document.addEventListener('mousedown', e => {
  if (!e.target.closest('[id^="name_"]') &&
      !e.target.closest('[id^="code_"]') &&
      e.target.id !== '_productNameDrop' &&
      !e.target.closest('#_productNameDrop')) {
    closeNameDrop();
  }
});


// ── Company Autocomplete (client-side) ────────────────────────────────────────
let _selectedCompanyVkn = '';

function _filterCompanies(q) {
  const s = (q || '').toLocaleLowerCase('tr-TR').trim();
  if (!s) {
    return _companies
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
  }
  const matches = _companies.filter(c =>
    (c.name || '').toLocaleLowerCase('tr-TR').includes(s) ||
    (c.vkn_tckn || '').toLocaleLowerCase('tr-TR').includes(s)
  );
  matches.sort((a, b) => {
    const an = (a.name || '').toLocaleLowerCase('tr-TR');
    const bn = (b.name || '').toLocaleLowerCase('tr-TR');
    const aStarts = an.startsWith(s) ? 0 : 1;
    const bStarts = bn.startsWith(s) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return an.localeCompare(bn, 'tr');
  });
  return matches;
}

// focus + input both open the dropdown
function onCompanyFocus() { _openCompanyDrop(); }
function onCompanySearch() { _openCompanyDrop(); }

function _openCompanyDrop() {
  const input    = document.getElementById('companyName');
  const dropdown = document.getElementById('companyDropdown');
  if (!input || !dropdown) return;
  _selectedCompanyVkn = '';

  const list = _filterCompanies(input.value);
  if (!list.length) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; return; }

  dropdown.innerHTML = list.map((c, i) =>
    `<div class="company-dropdown-item" data-idx="${i}">
      ${esc(c.name)}<span>${esc(c.vkn_tckn || '')}</span>
    </div>`
  ).join('');

  dropdown._data = list;
  dropdown.querySelectorAll('.company-dropdown-item').forEach((el, i) => {
    el.addEventListener('mousedown', (e) => {   // mousedown → fires before blur
      e.preventDefault();
      const c = dropdown._data[i];
      selectCompany(c.id, c.name, c.vkn_tckn || '');
    });
  });
  dropdown.style.display = 'block';
}

function selectCompany(id, name, vkn) {
  document.getElementById('companyName').value = name;
  _selectedCompanyVkn = vkn;
  const dropdown = document.getElementById('companyDropdown');
  dropdown.style.display = 'none';
  dropdown.innerHTML = '';
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Global click handling — close every open dropdown in one listener.
// ═══════════════════════════════════════════════════════════════════════════════
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#companyName') && !e.target.closest('#companyDropdown')) {
    const d = document.getElementById('companyDropdown');
    if (d) d.style.display = 'none';
  }
});

// Close the panel on Escape.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('quotePanelOverlay').classList.contains('hidden')) {
    closeQuotePanel();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  M. INIT
// ═══════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', loadoffers);