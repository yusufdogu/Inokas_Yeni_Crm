// quotes/js/teklif-form.js
let _quoteId      = null;
let _rowCount     = 0;
let _groups       = [];
let _extraColumns = [];
let _currentStep  = 1;
let _savedQuoteId = null;

const TOTAL_STEPS = 3;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  _quoteId = params.get('id') || null;

  document.getElementById('quoteDate').value = new Date().toISOString().slice(0, 10);

  await loadGroups();

  if (_quoteId) {
    initEditMode();
    document.getElementById('formTitle').textContent = 'Teklif Düzenle';
    await loadQuote(_quoteId);
  } else {
    initCreateMode();
    const res = await fetch('/api/quotes/next-ref-no');
    const data = await res.json().catch(() => ({}));
    if (data.reference_no) document.getElementById('formRefNo').textContent = data.reference_no;
    addRow();
    renderTerms([]);
    document.getElementById('quoteNotes').value =
      'Sayın ilgili;\nİlgili projeniz kapsamında ihtiyacınız olan ürünler ve hizmetler için hazırlamış olduğumuz teklifimiz ekte görüş ve değerlendirmelerinize sunulmuştur.\nTeklifimiz ile ilgili her türlü soru ve görüşlerinizi lütfen bizimle paylaşınız.\nSaygılarımızla…';
  }
});

// ── Mode Setup ────────────────────────────────────────────────────────────────
function initCreateMode() {
  document.getElementById('stepperBar').style.display  = 'flex';
  document.getElementById('headerActions').style.display = 'none';
  document.getElementById('createStatusGroup').style.display = 'flex';
  showStep(1);
}

function initEditMode() {
  document.getElementById('stepperBar').style.display    = 'none';
  document.getElementById('tabBar').style.display        = 'flex';
  document.getElementById('headerActions').style.display = 'flex';
  document.getElementById('createStatusGroup').style.display = 'none';
  document.querySelectorAll('.step-nav-bar').forEach(n => n.style.display = 'none');
  switchTab(1);
}

function switchTab(n) {
  document.querySelectorAll('.step-card').forEach(c => c.style.display = 'none');
  document.getElementById(`card${n}`).style.display = 'block';

  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tab${n}`).classList.add('active');

  document.getElementById('formArea').scrollTop = 0;
}

// ── Stepper ───────────────────────────────────────────────────────────────────
function showStep(n) {
  _currentStep = n;

  document.querySelectorAll('.step-card').forEach(c => c.style.display = 'none');
  document.querySelectorAll('.step-nav-bar').forEach(nav => nav.style.display = 'none');

  document.getElementById(`card${n}`).style.display = 'block';
  document.getElementById(`nav${n}`).style.display  = 'flex';

  updateStepper(n);
  document.getElementById('formArea').scrollTop = 0;
}

function updateStepper(step) {
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const circle  = document.getElementById(`scircle${i}`);
    const stepEl  = document.getElementById(`sstep${i}`);

    if (i < step) {
      circle.innerHTML  = '<i class="ti ti-check"></i>';
      stepEl.className  = 'stepper-step done';
    } else if (i === step) {
      circle.innerHTML  = i;
      stepEl.className  = 'stepper-step active';
    } else {
      circle.innerHTML  = i;
      stepEl.className  = 'stepper-step';
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

// ── Validation ────────────────────────────────────────────────────────────────
function validateStep1() {
  const company = document.getElementById('companyName').value.trim();
  const date    = document.getElementById('quoteDate').value;
  const type    = document.getElementById('quoteType').value;

  if (!company) { highlightError('companyName', 'Şirket adı gerekli.'); return false; }
  if (!date)    { highlightError('quoteDate',   'Teklif tarihi gerekli.'); return false; }
  if (!type)    { highlightError('quoteType',   'Teklif türü seçilmeli.'); return false; }
  return true;
}

function validateStep3() {
  const rows = document.querySelectorAll('#itemsTbody tr');
  if (!rows.length) { showToast('En az bir ürün kalemi ekleyin.'); return false; }

  for (let i = 0; i < rows.length; i++) {
    const id    = rows[i].id;
    const name  = document.getElementById(`name_${id}`)?.value.trim() || '';
    const qty   = parseFloat(document.getElementById(`qty_${id}`)?.value) || 0;
    const price = document.getElementById(`price_${id}`)?.value.trim() ?? '';

    if (!name)  { showToast(`${i + 1}. satırda ürün adı boş olamaz.`);      return false; }
    if (qty <= 0){ showToast(`${i + 1}. satırda miktar 0'dan büyük olmalı.`); return false; }
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

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(message) {
  let toast = document.getElementById('formToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id        = 'formToast';
    toast.className = 'form-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── Finish (create mode) ──────────────────────────────────────────────────────
async function finishQuote() {
  if (!validateStep3()) return;

  const btn = document.getElementById('finishBtn');
  btn.disabled     = true;
  btn.innerHTML    = '<i class="ti ti-loader-2"></i> Kaydediliyor...';

  try {
    const id = await saveQuoteAndGetId();
    _savedQuoteId   = id;
    document.getElementById('successOverlay').classList.add('show');
  } catch (e) {
    showToast('Hata: ' + e.message);
    btn.disabled  = false;
    btn.innerHTML = '<i class="ti ti-file-type-pdf"></i> PDF Oluştur';
  }
}

async function saveQuoteAndGetId() {
  const payload = buildPayload();
  const res = await fetch('/api/quotes', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
  return data.id || data.quote?.id;
}

async function showPdf() {
  if (!_savedQuoteId) return;
  const btn = document.querySelector('.btn-show-pdf');
  if (btn) { btn.disabled = true; btn.textContent = 'Hazırlanıyor...'; }
  try {
    const res = await fetch(`/api/quotes/${encodeURIComponent(_savedQuoteId)}/pdf`);
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

function goToList() {
  window.location.href = '/quotes/pages/teklifler.html';
}

// ── Save (edit mode) ──────────────────────────────────────────────────────────
async function saveQuote() {
  const company_name = document.getElementById('companyName').value.trim();
  const quote_date   = document.getElementById('quoteDate').value;
  const items        = collectItems();

  if (!company_name) { alert('Şirket adı gerekli.');        return; }
  if (!quote_date)   { alert('Teklif tarihi gerekli.');      return; }
  if (!items.length) { alert('En az bir ürün kalemi ekleyin.'); return; }

  const payload = buildPayload(true);

  try {
    const url    = `/api/quotes/${encodeURIComponent(_quoteId)}`;
    const res    = await fetch(url, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    window.location.href = '/quotes/pages/teklifler.html';
  } catch (e) {
    alert('Kaydetme hatası: ' + e.message);
  }
}

function buildPayload(isEdit = false) {
  const statusEl = isEdit
    ? document.getElementById('headerStatusSelect')
    : document.getElementById('statusSelect');

  return {
    company_name:  document.getElementById('companyName').value.trim(),
    job_name:      document.getElementById('jobName').value.trim() || null,
    quote_date:    document.getElementById('quoteDate').value,
    valid_until:   document.getElementById('validUntil').value || null,
    notes:         document.getElementById('quoteNotes').value.trim() || null,
    quote_type:    document.getElementById('quoteType').value || null,
    status:        statusEl?.value || 'pending',
    terms:         getTerms(),
    extra_columns: _extraColumns,
    currency:      'TRY',
    items:         collectItems(),
  };
}

// ── Load Quote (edit) ─────────────────────────────────────────────────────────
async function loadGroups() {
  try {
    const res = await fetch('/api/quotes/product-groups/list');
    if (!res.ok) return;
    _groups = await res.json();
  } catch (e) {
    console.warn('Takımlar yüklenemedi:', e.message);
  }
}

async function loadQuote(id) {
  try {
    const res = await fetch(`/api/quotes/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const qt = await res.json();

    document.getElementById('formRefNo').textContent       = qt.reference_no || '';
    document.getElementById('companyName').value           = qt.company_name || '';
    document.getElementById('jobName').value               = qt.job_name || '';
    document.getElementById('quoteDate').value             = (qt.quote_date || '').slice(0, 10);
    document.getElementById('validUntil').value            = (qt.valid_until || '').slice(0, 10);
    document.getElementById('quoteNotes').value            = qt.notes || '';
    document.getElementById('quoteType').value             = qt.quote_type || '';
    document.getElementById('headerStatusSelect').value    = qt.status || 'pending';

    renderTerms(qt.terms || []);
    _extraColumns = qt.extra_columns || [];
    renderExtraColumnHeaders();
    (qt.quote_items || []).forEach(it => addRow(it));
  } catch (e) {
    alert('Teklif yüklenemedi: ' + e.message);
  }
}

// ── Rows ──────────────────────────────────────────────────────────────────────
function addRow(item = null) {
  _rowCount++;
  const rowId  = `row_${_rowCount}`;
  const tbody  = document.getElementById('itemsTbody');

  const groupOptions = _groups.map(g =>
    `<option value="${g.id}">${g.group_name}</option>`
  ).join('');

  const tr = document.createElement('tr');
  tr.id = rowId;
  tr.innerHTML = `
    <td><span class="sira-no" id="sira_${rowId}"></span></td>
    <td><input type="text" class="item-input" id="code_${rowId}" placeholder="Ürün kodu" value="${esc(item?.product_code || '')}" oninput="onCodeInput('${rowId}')"></td>
    <td>
      <input type="text" class="item-input" id="name_${rowId}" placeholder="Ürün adı" value="${esc(item?.product_name || '')}" oninput="onNameInput('${rowId}')" autocomplete="off">
    </td>
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
      const td  = document.createElement('td');
      td.className = 'extra-col-td';
      td.innerHTML = `<input type="text" class="item-input extra-col-input" data-col="${i}" value="${val}" placeholder="${col}...">`;
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
  const qty   = parseFloat(document.getElementById(`qty_${rowId}`)?.value)   || 0;
  const price = parseFloat(document.getElementById(`price_${rowId}`)?.value) || 0;
  const total = qty * price;
  const el    = document.getElementById(`total_${rowId}`);
  if (el) el.value = total ? total.toFixed(2) : '';
  recalcTotal();
}

function recalcTotal() {
  let sum = 0;
  document.querySelectorAll('#itemsTbody tr').forEach(tr => {
    sum += parseFloat(document.getElementById(`total_${tr.id}`)?.value) || 0;
  });
  document.getElementById('totalDisplay').textContent =
    '₺' + sum.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Unit / Takım ──────────────────────────────────────────────────────────────
function onUnitChange(rowId) {
  const unit     = document.getElementById(`unit_${rowId}`)?.value;
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
    const res   = await fetch(`/api/quotes/product-groups/${encodeURIComponent(groupId)}/items`);
    if (!res.ok) return;
    const items = await res.json();
    if (!items.length) return;

    const qty       = parseFloat(document.getElementById(`qty_${rowId}`)?.value) || 1;
    const currentRow = document.getElementById(rowId);
    const tbody      = document.getElementById('itemsTbody');

    items.forEach(it => {
      _rowCount++;
      const newId = `row_${_rowCount}`;
      const tr    = document.createElement('tr');
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

// ── Collect Items ─────────────────────────────────────────────────────────────
function collectItems() {
  const rows  = document.querySelectorAll('#itemsTbody tr');
  const items = [];
  rows.forEach((tr, i) => {
    const id = tr.id;
    items.push({
      sort_order:    i + 1,
      product_code:  document.getElementById(`code_${id}`)?.value.trim() || null,
      product_name:  document.getElementById(`name_${id}`)?.value.trim() || '',
      unit:          document.getElementById(`unit_${id}`)?.value || 'ADET',
      quantity:      parseFloat(document.getElementById(`qty_${id}`)?.value)   || 1,
      unit_price:    parseFloat(document.getElementById(`price_${id}`)?.value) || 0,
      total_price:   parseFloat(document.getElementById(`total_${id}`)?.value) || 0,
      extra_columns: getExtraColumnValues(tr),
    });
  });
  return items;
}

// ── Terms ─────────────────────────────────────────────────────────────────────
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
  const idx  = list.querySelectorAll('.terms-row').length;
  const div  = document.createElement('div');
  div.className  = 'terms-row';
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

// ── Extra Columns ─────────────────────────────────────────────────────────────
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
    th.style.cssText = 'min-width:120px;';
    th.innerHTML = `${col} <span onclick="removeExtraColumn(${i})" style="cursor:pointer;color:#ef4444;font-size:10px;margin-left:4px;">✕</span>`;
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
      const td  = document.createElement('td');
      td.className = 'extra-col-td';
      const val = savedVals[i] !== undefined ? savedVals[i] : '';
      td.innerHTML = `<input type="text" class="item-input extra-col-input" data-col="${i}" value="${val}" placeholder="${col}...">`;
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

// ── Product Name Autocomplete ─────────────────────────────────────────────────
const _nameTimers = {};
let _activeNameRowId = null;

function _getProductDrop() {
  let dd = document.getElementById('_productNameDrop');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = '_productNameDrop';
    dd.style.cssText = [
      'display:none', 'position:fixed', 'background:#fff',
      'border:1px solid var(--border)', 'border-radius:8px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.12)', 'z-index:9999',
      'max-height:220px', 'overflow-y:auto'
    ].join(';');
    document.body.appendChild(dd);
  }
  return dd;
}

function onNameInput(rowId) {
  clearTimeout(_nameTimers[rowId]);
  const q = document.getElementById(`name_${rowId}`)?.value.trim() || '';
  _activeNameRowId = rowId;
  if (q.length < 1) { closeNameDrop(); return; }
  _nameTimers[rowId] = setTimeout(() => searchProductsByName(rowId, q), 280);
}

async function searchProductsByName(rowId, q) {
  try {
    const res  = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const list = await res.json();
    renderNameDrop(rowId, list);
  } catch { closeNameDrop(); }
}

function renderNameDrop(rowId, list) {
  const dd    = _getProductDrop();
  const input = document.getElementById(`name_${rowId}`);
  if (!input || !list.length) { closeNameDrop(); return; }

  const rect = input.getBoundingClientRect();
  dd.style.top   = (rect.bottom + 4) + 'px';
  dd.style.left  = rect.left + 'px';
  dd.style.width = Math.max(rect.width, 260) + 'px';

  dd.innerHTML = '';
  list.forEach(p => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:9px 12px; font-size:13px; cursor:pointer; color:var(--text-main); border-bottom:1px solid #f5f0eb;';
    item.innerHTML = `<span style="font-weight:600;">${esc(p.product_name)}</span>${p.product_code ? `<span style="font-size:11px; color:var(--text-sub); margin-left:8px;">${esc(p.product_code)}</span>` : ''}`;
    item.addEventListener('mouseenter', () => item.style.background = '#fdf9f5');
    item.addEventListener('mouseleave', () => item.style.background = '');
    item.addEventListener('click', () => selectProduct(rowId, p.product_code || '', p.product_name || ''));
    dd.appendChild(item);
  });
  dd.style.display = 'block';
}

function selectProduct(rowId, code, name) {
  const nameEl = document.getElementById(`name_${rowId}`);
  const codeEl = document.getElementById(`code_${rowId}`);
  if (nameEl) nameEl.value = name;
  if (codeEl && !codeEl.value) codeEl.value = code;
  closeNameDrop();
}

function closeNameDrop() {
  const dd = document.getElementById('_productNameDrop');
  if (dd) dd.style.display = 'none';
}

document.addEventListener('click', e => {
  if (!e.target.closest('[id^="name_"]') && e.target.id !== '_productNameDrop' && !e.target.closest('#_productNameDrop')) {
    closeNameDrop();
  }
});

// ── Product Code Lookup ───────────────────────────────────────────────────────
const _codeTimers = {};

function onCodeInput(rowId) {
  clearTimeout(_codeTimers[rowId]);
  const code = document.getElementById(`code_${rowId}`)?.value.trim() || '';
  if (!code) return;
  _codeTimers[rowId] = setTimeout(() => lookupProductCode(rowId, code), 350);
}

async function lookupProductCode(rowId, code) {
  try {
    const res     = await fetch(`/api/products/by-code?code=${encodeURIComponent(code)}`);
    if (!res.ok) return;
    const product = await res.json();
    if (!product?.product_name) return;
    const nameEl = document.getElementById(`name_${rowId}`);
    if (nameEl && !nameEl.value) nameEl.value = product.product_name;
  } catch { }
}

// ── Company Autocomplete ──────────────────────────────────────────────────────
let _companySearchTimer = null;
let _selectedCompanyVkn = '';

function onCompanySearch() {
  const q        = document.getElementById('companyName')?.value.trim() || '';
  const dropdown = document.getElementById('companyDropdown');
  clearTimeout(_companySearchTimer);
  _selectedCompanyVkn = '';

  if (q.length < 1) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; return; }
  _companySearchTimer = setTimeout(() => searchCompanies(q), 300);
}

async function searchCompanies(q) {
  const dropdown = document.getElementById('companyDropdown');
  try {
    const res  = await fetch(`/api/companies/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const list = await res.json();

    if (!list.length) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = list.map((c, i) =>
      `<div class="company-dropdown-item" data-idx="${i}">
        ${c.name}<span>${c.vkn_tckn || ''}</span>
      </div>`
    ).join('');

    dropdown._data = list;
    dropdown.querySelectorAll('.company-dropdown-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        const c = dropdown._data[i];
        selectCompany(c.id, c.name, c.vkn_tckn || '');
      });
    });
    dropdown.style.display = 'block';
  } catch { }
}

function selectCompany(id, name, vkn) {
  document.getElementById('companyName').value = name;
  _selectedCompanyVkn = vkn;
  const dropdown = document.getElementById('companyDropdown');
  dropdown.style.display = 'none';
  dropdown.innerHTML = '';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#companyName') && !e.target.closest('#companyDropdown')) {
    const d = document.getElementById('companyDropdown');
    if (d) d.style.display = 'none';
  }
});

// ── Utility ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
