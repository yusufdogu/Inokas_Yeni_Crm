// quotes/js/teklif-form.js
let _quoteId = null;
let _rowCount = 0;
let _groups = [];

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  _quoteId = params.get('id') || null;

  // Today default
  document.getElementById('quoteDate').value = new Date().toISOString().slice(0, 10);

  await loadGroups();

  if (_quoteId) {
    document.getElementById('formTitle').textContent = 'Teklif Düzenle';
    await loadQuote(_quoteId);
  } else {
    const res = await fetch('/api/quotes/next-ref-no');
    const data = await res.json().catch(() => ({}));
    if (data.reference_no) {
      document.getElementById('formRefNo').textContent = data.reference_no;
    }
    addRow();
  }
});

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

    document.getElementById('formRefNo').textContent = qt.reference_no || '';
    document.getElementById('companyName').value = qt.company_name || '';
    document.getElementById('jobName').value = qt.job_name || '';
    document.getElementById('quoteDate').value = (qt.quote_date || '').slice(0, 10);
    document.getElementById('validUntil').value = (qt.valid_until || '').slice(0, 10);
    document.getElementById('quoteNotes').value = qt.notes || '';
    document.getElementById('statusSelect').value = qt.status || 'pending';

    (qt.quote_items || []).forEach(it => addRow(it));
  } catch (e) {
    alert('Teklif yüklenemedi: ' + e.message);
  }
}

// ── Rows ──────────────────────────────────────────────────────────────────────
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
    <td><input type="text" class="item-input" id="code_${rowId}" placeholder="Ürün kodu" value="${esc(item?.product_code || '')}" oninput="onCodeInput('${rowId}')"></td>
    <td><input type="text" class="item-input" id="name_${rowId}" placeholder="Ürün adı" value="${esc(item?.product_name || '')}"></td>
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
    <td><input type="number" class="item-input" id="total_${rowId}" value="${item?.total_price ?? ''}" placeholder="0" readonly style="background:#f8fafc; color:var(--text-sub);"></td>
    <td><button class="btn-row-del" onclick="removeRow('${rowId}')"><i class="ti ti-x"></i></button></td>
  `;
  tbody.appendChild(tr);
  reindexRows();
  recalcRow(rowId);
}

function removeRow(rowId) {
  document.getElementById(rowId)?.remove();
  reindexRows();
  recalcTotal();
}

function reindexRows() {
  const rows = document.querySelectorAll('#itemsTbody tr');
  rows.forEach((tr, i) => {
    const sira = tr.querySelector('.sira-no');
    if (sira) sira.textContent = i + 1;
  });
}

function recalcRow(rowId) {
  const qty = parseFloat(document.getElementById(`qty_${rowId}`)?.value) || 0;
  const price = parseFloat(document.getElementById(`price_${rowId}`)?.value) || 0;
  const total = qty * price;
  const totalEl = document.getElementById(`total_${rowId}`);
  if (totalEl) totalEl.value = total ? total.toFixed(2) : '';
  recalcTotal();
}

function recalcTotal() {
  const rows = document.querySelectorAll('#itemsTbody tr');
  let sum = 0;
  rows.forEach(tr => {
    const id = tr.id;
    sum += parseFloat(document.getElementById(`total_${id}`)?.value) || 0;
  });
  document.getElementById('totalDisplay').textContent =
    '₺' + sum.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Birim / Takım ─────────────────────────────────────────────────────────────
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
    const res = await fetch(`/api/quotes/product-groups/${encodeURIComponent(groupId)}/items`);
    if (!res.ok) return;
    const items = await res.json();
    if (!items.length) return;

    const qty = parseFloat(document.getElementById(`qty_${rowId}`)?.value) || 1;

    // Remove current row
    const currentRow = document.getElementById(rowId);
    const tbody = document.getElementById('itemsTbody');

    // Insert new rows for each item in group
    items.forEach((it, idx) => {
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
        <td><input type="number" class="item-input" id="total_${newId}" placeholder="0" readonly style="background:#f8fafc; color:var(--text-sub);"></td>
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
    });
  });
  return items;
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function saveQuote() {
  const company_name = document.getElementById('companyName').value.trim();
  const quote_date = document.getElementById('quoteDate').value;
  const valid_until = document.getElementById('validUntil').value || null;
  const job_name = document.getElementById('jobName').value.trim() || null;
  const notes = document.getElementById('quoteNotes').value.trim() || null;
  const status = document.getElementById('statusSelect').value;
  const items = collectItems();

  if (!company_name) { alert('Şirket adı gerekli.'); return; }
  if (!quote_date) { alert('Teklif tarihi gerekli.'); return; }
  if (!items.length) { alert('En az bir ürün kalemi gerekli.'); return; }

  const payload = { company_name, job_name, quote_date, valid_until, notes, status, currency: 'TRY', items };


  try {
    const url = _quoteId ? `/api/quotes/${encodeURIComponent(_quoteId)}` : '/api/quotes';
    const method = _quoteId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);

    window.location.href = '/quotes/pages/teklifler.html';
  } catch (e) {
    alert('Kaydetme hatası: ' + e.message);
  }
}

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
    const res = await fetch(`/api/products/by-code?code=${encodeURIComponent(code)}`);
    if (!res.ok) return;
    const product = await res.json();
    if (!product?.product_name) return;
    const nameEl = document.getElementById(`name_${rowId}`);
    if (nameEl && !nameEl.value) nameEl.value = product.product_name;
  } catch { }
}

let _companySearchTimer = null;
let _selectedCompanyVkn = '';

function onCompanySearch() {
  const q = document.getElementById('companyName')?.value.trim() || '';
  const dropdown = document.getElementById('companyDropdown');
  clearTimeout(_companySearchTimer);
  _selectedCompanyVkn = '';

  if (q.length < 1) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    return;
  }

  _companySearchTimer = setTimeout(() => searchCompanies(q), 300);
}

async function searchCompanies(q) {
  const dropdown = document.getElementById('companyDropdown');
  try {
    const res = await fetch(`/api/companies/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const list = await res.json();

    if (!list.length) {
      dropdown.style.display = 'none';
      return;
    }

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
    document.getElementById('companyDropdown').style.display = 'none';
  }
});


function esc(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
