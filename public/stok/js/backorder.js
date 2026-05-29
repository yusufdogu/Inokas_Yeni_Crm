// stok/backorder.js — Bekleyen Siparişler page

const PO_CACHE_KEY = 'inokas_pending_po_v1';
const STOCK_CACHE_KEY = 'inokas_stock_v3';

let allPendingOrders = [];
let _brandList = [];
let _categoryList = [];

// Advanced filter state
let _advFilterData = []; // [{category, brand, model}] — DB'den çekilir
let _advSelCategory = '';
let _advSelBrand = '';
let _advSelModel = '';


// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initBackorder() {
  await loadBrandsCategories();
  addPoLine();
  document.getElementById('poCompanyVkn')?.addEventListener('blur', autoFillCompanyByVkn);
  document.getElementById('boSearch')?.addEventListener('input', renderTable);
  document.getElementById('boFilterDateStart')?.addEventListener('change', renderTable);
  document.getElementById('boFilterDateEnd')?.addEventListener('change', renderTable);
  document.getElementById('showCompleted')?.addEventListener('change', renderTable);
  await loadPendingOrders();
};

async function loadBrandsCategories() {
  try {
    const res = await fetch('/api/products/category-map');
    if (!res.ok) return;
    const data = await res.json();
    _brandList = data.brands || [];
    _categoryList = data.categories || [];
    // Advanced filter için zengin veri — [{category, brand, model}]
    _advFilterData = data.items || data.rows || [];
  } catch { }
  initAdvFilters();
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadPendingOrders() {
  const cached = readCache(PO_CACHE_KEY);
  if (cached) {
    allPendingOrders = cached;
    renderKpis();
    renderTable();
  }

  try {
    const res = await fetch('/api/purchase-orders/all-pending');
    if (!res.ok) throw new Error();
    allPendingOrders = await res.json();
    writeCache(PO_CACHE_KEY, allPendingOrders);
    renderKpis();
    renderTable();
  } catch {
    if (!cached) {
      document.getElementById('bo-count').textContent = 'Veri alınamadı.';
    }
  }
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
function renderKpis() {
  const pending = allPendingOrders.filter(po => (Number(po.ordered_qty) - Number(po.received_qty)) > 0);
  const pendingQty = pending.reduce((s, po) => s + (Number(po.ordered_qty) - Number(po.received_qty)), 0);
  const receivedQty = allPendingOrders.reduce((s, po) => s + Number(po.received_qty || 0), 0);

  document.getElementById('kpi-pending').textContent = fmtQty(pending.length);
  document.getElementById('kpi-qty').textContent = fmtQty(pendingQty);
  document.getElementById('kpi-received').textContent = fmtQty(receivedQty);
}

// ─── RENDER TABLE ─────────────────────────────────────────────────────────────
function renderTable() {
  const body = document.getElementById('poTableBody');
  const emptyEl = document.getElementById('poEmpty');
  const search = (document.getElementById('boSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const showCompleted = !!document.getElementById('showCompleted')?.checked;
  const dateStart = document.getElementById('boFilterDateStart')?.value || '';
  const dateEnd = document.getElementById('boFilterDateEnd')?.value || '';
  if (!body) return;

  const filtered = allPendingOrders.filter(po => {
    const remaining = Number(po.ordered_qty) - Number(po.received_qty);
    if (!showCompleted && remaining <= 0) return false;
    const d = String(po.purchase_orders?.order_date || '').slice(0, 10);
    if (dateStart && d < dateStart) return false;
    if (dateEnd && d > dateEnd) return false;
    if (search) {
      const company = (po.purchase_orders?.companies?.name || '').toLocaleLowerCase('tr-TR');
      const product = (po.products?.product_name || '').toLocaleLowerCase('tr-TR');
      const sku = (po.products?.product_code || '').toLocaleLowerCase('tr-TR');
      if (!company.includes(search) && !product.includes(search) && !sku.includes(search)) return false;
    }
    // Advanced filters
    if (_advSelCategory) {
      if ((po.products?.category || '').toLocaleLowerCase('tr-TR') !== _advSelCategory.toLocaleLowerCase('tr-TR')) return false;
    }
    if (_advSelBrand) {
      if ((po.products?.brand || '').toLocaleLowerCase('tr-TR') !== _advSelBrand.toLocaleLowerCase('tr-TR')) return false;
    }
    if (_advSelModel) {
      if ((po.products?.model || '').toLocaleLowerCase('tr-TR') !== _advSelModel.toLocaleLowerCase('tr-TR')) return false;
    }
    return true;
  });

  body.innerHTML = '';

  if (!filtered.length) {
    emptyEl.classList.add('visible');
    return;
  }
  emptyEl.classList.remove('visible');

  filtered.forEach(po => {
    const ordered = Number(po.ordered_qty) || 0;
    const received = Number(po.received_qty) || 0;
    const remaining = ordered - received;
    const isDone = remaining <= 0;
    const unitPrice = po.unit_price_cur ?? '';
    const currency = String(po.currency || '').trim();
    const lineTotal = po.line_total_cur ?? '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge-sku">${esc(po.purchase_orders?.po_number || '—')}</span></td>
      <td style="white-space:nowrap;">${esc(po.purchase_orders?.order_date || '—')}</td>
      <td style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(po.purchase_orders?.companies?.name || '')}">${esc(po.purchase_orders?.companies?.name || '—')}</td>
      <td style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" title="${esc(po.products?.product_name || '')}">${esc(po.products?.product_name || '—')}</td>
      <td><span class="badge-sku">${esc(po.products?.product_code || '—')}</span></td>
      <td class="text-right">
        <input type="number" min="${Math.max(1, Math.ceil(received))}" step="1"
          class="po-edit-input po-ordered-input" value="${ordered}"
          data-po-id="${po.id}" data-original="${ordered}">
      </td>
      <td class="text-right">
        <input type="number" min="0" step="0.01"
          class="po-edit-input po-unit-input" value="${unitPrice}"
          data-po-id="${po.id}" data-original="${unitPrice}">
      </td>
      <td>
        <select class="po-cur-select po-cur-input" data-po-id="${po.id}" data-original="${currency}">
          <option value="" ${!currency ? 'selected' : ''}>—</option>
          <option value="TRY" ${currency === 'TRY' ? 'selected' : ''}>TRY</option>
          <option value="USD" ${currency === 'USD' ? 'selected' : ''}>USD</option>
          <option value="EUR" ${currency === 'EUR' ? 'selected' : ''}>EUR</option>
        </select>
      </td>
      <td class="text-right">
        <input type="number" min="0" step="0.01"
          class="po-edit-input po-total-input" value="${lineTotal}"
          data-po-id="${po.id}" data-original="${lineTotal}">
      </td>
      <td class="text-right text-success">${fmtQty(received)}</td>
      <td class="text-right remaining-cell">
        <strong class="${isDone ? 'text-success' : 'text-warning'}">${fmtQty(remaining)}</strong>
      </td>
      <td>
        <div class="po-actions">
          <button type="button" class="po-btn po-btn-save" onclick="savePo('${po.id}', this)">Güncelle</button>
          <button type="button" class="po-btn po-btn-delete" onclick="deletePo('${po.id}', this)">Sil</button>
        </div>
      </td>
    `;

    const qtyInput = tr.querySelector('.po-ordered-input');
    const unitInput = tr.querySelector('.po-unit-input');
    const totalInput = tr.querySelector('.po-total-input');
    const recalc = () => {
      if (!totalInput) return;
      totalInput.value = (Number(qtyInput?.value || 0) * Number(unitInput?.value || 0)).toFixed(2);
    };
    qtyInput?.addEventListener('input', recalc);
    unitInput?.addEventListener('input', recalc);

    body.appendChild(tr);
  });
}

function _clearBoFilters() {
  document.getElementById('boSearch').value = '';
  document.getElementById('boFilterDateStart').value = '';
  document.getElementById('boFilterDateEnd').value = '';
  document.getElementById('showCompleted').checked = false;
  renderTable();
}


// ─── ADVANCED FILTERS ─────────────────────────────────────────────────────────

function toggleAdvPanel() {
  const panel = document.getElementById('advFilterPanel');
  const toggle = document.getElementById('advFilterToggle');
  const isOpen = panel.classList.toggle('open');
  toggle.classList.toggle('active', isOpen);
}

function initAdvFilters() {
  buildAcField({
    inputId: 'advCategory',
    dropId: 'advCategoryDrop',
    getList: () => [...new Set(_advFilterData.map(x => x.category).filter(Boolean))],
    onSelect: (val) => {
      _advSelCategory = val;
      _advSelBrand = '';
      _advSelModel = '';
      document.getElementById('advBrand').value = '';
      document.getElementById('advModel').value = '';
      document.getElementById('advBrand').disabled = false;
      document.getElementById('advModel').disabled = true;
      renderTable();
    },
    onClear: () => {
      _advSelCategory = '';
      _advSelBrand = '';
      _advSelModel = '';
      document.getElementById('advBrand').value = '';
      document.getElementById('advModel').value = '';
      document.getElementById('advBrand').disabled = true;
      document.getElementById('advModel').disabled = true;
      renderTable();
    }
  });

  buildAcField({
    inputId: 'advBrand',
    dropId: 'advBrandDrop',
    getList: () => {
      const rows = _advSelCategory
        ? _advFilterData.filter(x => x.category === _advSelCategory)
        : _advFilterData;
      return [...new Set(rows.map(x => x.brand).filter(Boolean))];
    },
    onSelect: (val) => {
      _advSelBrand = val;
      _advSelModel = '';
      document.getElementById('advModel').value = '';
      document.getElementById('advModel').disabled = false;
      renderTable();
    },
    onClear: () => {
      _advSelBrand = '';
      _advSelModel = '';
      document.getElementById('advModel').value = '';
      document.getElementById('advModel').disabled = true;
      renderTable();
    }
  });

  buildAcField({
    inputId: 'advModel',
    dropId: 'advModelDrop',
    getList: () => {
      let rows = _advFilterData;
      if (_advSelCategory) rows = rows.filter(x => x.category === _advSelCategory);
      if (_advSelBrand) rows = rows.filter(x => x.brand === _advSelBrand);
      return [...new Set(rows.map(x => x.model).filter(Boolean))];
    },
    onSelect: (val) => { _advSelModel = val; renderTable(); },
    onClear: () => { _advSelModel = ''; renderTable(); }
  });
}

function buildAcField({ inputId, dropId, getList, onSelect, onClear }) {
  const input = document.getElementById(inputId);
  const drop = document.getElementById(dropId);
  if (!input || !drop) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLocaleLowerCase('tr-TR');
    if (!q) { closeDrop(drop); onClear(); return; }

    const matches = getList().filter(v => v.toLocaleLowerCase('tr-TR').startsWith(q));
    if (!matches.length) { closeDrop(drop); return; }

    drop.innerHTML = '';
    matches.forEach(val => {
      const item = document.createElement('div');
      item.className = 'bo-ac-item';
      item.textContent = val;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = val;
        closeDrop(drop);
        onSelect(val);
      });
      drop.appendChild(item);
    });
    drop.classList.add('open');
  });

  input.addEventListener('blur', () => setTimeout(() => closeDrop(drop), 150));
  input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });
}

function closeDrop(drop) { drop.classList.remove('open'); drop.innerHTML = ''; }

function clearAdvFilters() {
  _advSelCategory = ''; _advSelBrand = ''; _advSelModel = '';
  ['advCategory', 'advBrand', 'advModel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('advBrand').disabled = true;
  document.getElementById('advModel').disabled = true;
  ['advCategoryDrop', 'advBrandDrop', 'advModelDrop'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('open'); el.innerHTML = ''; }
  });
  renderTable();
}



// ─── DATALIST HELPERS ─────────────────────────────────────────────────────────


let _dlCounter = 0;

function buildDatalistCell(sourceList, placeholder, cssClass) {
  const td = document.createElement('td');

  const dlId = `dl-dynamic-${_dlCounter++}`;
  const dl = document.createElement('datalist');
  dl.id = dlId;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = cssClass;
  input.placeholder = placeholder;
  input.setAttribute('list', dlId);
  input.autocomplete = 'off';

  input.addEventListener('input', () => {
    const q = input.value.trim().toLocaleLowerCase('tr-TR');
    dl.innerHTML = '';
    if (!q) return;
    sourceList
      .filter(v => v.toLocaleLowerCase('tr-TR').includes(q))
      .forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        dl.appendChild(opt);
      });
  });

  td.appendChild(dl);
  td.appendChild(input);
  return td;
}

// ─── NEW PO FORM ──────────────────────────────────────────────────────────────
async function autoFillCompanyByVkn() {
  const vkn = String(document.getElementById('poCompanyVkn')?.value || '').trim();
  const nameEl = document.getElementById('poCompanyName');
  if (!nameEl || !vkn) { if (nameEl) nameEl.value = ''; return; }
  try {
    const res = await fetch(`/api/companies/by-vkn?vkn=${encodeURIComponent(vkn)}`);
    if (!res.ok) return;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return;
    const data = await res.json();
    nameEl.value = data?.name || '';
  } catch { }
}

async function autoFillProductByCode(codeEl, nameEl, brandTd, categoryTd) {
  const code = String(codeEl?.value || '').trim();
  if (!nameEl || !code) { if (nameEl) nameEl.value = ''; return; }
  try {
    const res = await fetch(`/api/products/by-code?code=${encodeURIComponent(code)}`);
    if (!res.ok) return;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return;
    const data = await res.json();
    if (data?.product_name) nameEl.value = data.product_name;
    if (data?.brand && brandTd) {
      const inp = brandTd.querySelector('input');
      if (inp) inp.value = data.brand;
    }
    if (data?.category && categoryTd) {
      const inp = categoryTd.querySelector('input');
      if (inp) inp.value = data.category;
    }
  } catch { }
}

function addPoLine() {
  const body = document.getElementById('poLinesBody');
  if (!body) return;
  const tr = document.createElement('tr');

  // SKU
  const tdCode = document.createElement('td');
  const codeInput = document.createElement('input');
  codeInput.type = 'text';
  codeInput.className = 'po-line-code';
  codeInput.placeholder = 'SKU';
  codeInput.required = true;
  tdCode.appendChild(codeInput);

  // Ürün Adı
  const tdName = document.createElement('td');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'po-line-name';
  nameInput.placeholder = '(otomatik)';
  tdName.appendChild(nameInput);

  // Marka datalist
  const tdBrand = buildDatalistCell(_brandList, 'Marka', 'po-line-brand');

  // Kategori datalist
  const tdCategory = buildDatalistCell(_categoryList, 'Kategori', 'po-line-category');

  // Miktar
  const tdQty = document.createElement('td');
  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.className = 'po-line-qty';
  qtyInput.min = '1';
  qtyInput.step = '1';
  qtyInput.placeholder = 'Miktar';
  qtyInput.required = true;
  tdQty.appendChild(qtyInput);

  // Birim Fiyat
  const tdUnit = document.createElement('td');
  const unitInput = document.createElement('input');
  unitInput.type = 'number';
  unitInput.className = 'po-line-unit';
  unitInput.min = '0';
  unitInput.step = '0.01';
  unitInput.placeholder = '0,00';
  tdUnit.appendChild(unitInput);

  // Döviz
  const tdCur = document.createElement('td');
  tdCur.innerHTML = `
    <select class="po-line-currency">
      <option value="">—</option>
      <option value="TRY">TRY</option>
      <option value="USD">USD</option>
      <option value="EUR">EUR</option>
    </select>`;

  // Toplam
  const tdTotal = document.createElement('td');
  const totalInput = document.createElement('input');
  totalInput.type = 'number';
  totalInput.className = 'po-line-total';
  totalInput.min = '0';
  totalInput.step = '0.01';
  totalInput.placeholder = '0,00';
  tdTotal.appendChild(totalInput);

  // Sil
  const tdDel = document.createElement('td');
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'po-btn po-btn-delete';
  delBtn.textContent = 'Sil';
  delBtn.onclick = () => removePoLine(delBtn);
  tdDel.appendChild(delBtn);

  tr.append(tdCode, tdName, tdBrand, tdCategory, tdQty, tdUnit, tdCur, tdTotal, tdDel);

  codeInput.addEventListener('blur', () => autoFillProductByCode(codeInput, nameInput, tdBrand, tdCategory));
  const recalc = () => { totalInput.value = (Number(qtyInput.value || 0) * Number(unitInput.value || 0)).toFixed(2); };
  qtyInput.addEventListener('input', recalc);
  unitInput.addEventListener('input', recalc);

  body.appendChild(tr);
}

function removePoLine(btn) {
  const body = document.getElementById('poLinesBody');
  if (!body || body.children.length <= 1) return;
  btn.closest('tr')?.remove();
}

async function submitPoForm(forceCreate = false) {
  const msgEl = document.getElementById('poFormMsg');

  const payload = {
    company_vkn: String(document.getElementById('poCompanyVkn')?.value || '').trim(),
    company_name: String(document.getElementById('poCompanyName')?.value || '').trim(),
    force_create: forceCreate,
    items: Array.from(document.querySelectorAll('#poLinesBody tr')).map(row => {
      const unitRaw = String(row.querySelector('.po-line-unit')?.value || '').trim();
      const totalRaw = String(row.querySelector('.po-line-total')?.value || '').trim();
      const qty = Number(row.querySelector('.po-line-qty')?.value || 0);
      const unitVal = Number(row.querySelector('.po-line-unit')?.value || 0);

      return {
        product_code: String(row.querySelector('.po-line-code')?.value || '').trim(),
        product_name: String(row.querySelector('.po-line-name')?.value || '').trim(),
        brand: String(row.querySelector('.po-line-brand')?.value || '').trim(),
        category: String(row.querySelector('.po-line-category')?.value || '').trim(),
        ordered_qty: qty,
        unit_price_cur: unitRaw === '' ? null : Number(unitRaw),
        currency: String(row.querySelector('.po-line-currency')?.value || '').trim() || null,
        line_total_cur: totalRaw === '' ? (unitVal > 0 ? Number((qty * unitVal).toFixed(2)) : null) : Number(totalRaw),
      };
    }).filter(x => x.product_code && x.ordered_qty > 0)
  };

  if (!payload.company_vkn || !payload.items.length) {
    if (msgEl) { msgEl.textContent = 'VKN ve en az bir ürün satırı zorunlu.'; msgEl.className = 'modal-msg error'; }
    return;
  }

  if (msgEl) { msgEl.textContent = 'Kaydediliyor...'; msgEl.className = 'modal-msg'; }

  try {
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Sunucudan beklenmeyen cevap alındı.');
    const data = await res.json();

    if (!res.ok) {
      // Eksik SKU — onay sor, sonra force_create ile tekrar gönder
      if (res.status === 400 && data?.missing_codes?.length) {
        const codes = data.missing_codes.join(', ');
        const confirmed = confirm(`"${codes}" kodu sistemde bulunamadı.\nYeni ürün olarak eklenecek. Onaylıyor musunuz?`);
        if (confirmed) {
          if (msgEl) { msgEl.textContent = ''; msgEl.className = 'modal-msg'; }
          return submitPoForm(true);
        }
        if (msgEl) { msgEl.textContent = 'İptal edildi.'; msgEl.className = 'modal-msg'; }
        return;
      }
      throw new Error(data?.error || 'Kayıt hatası');
    }

    if (msgEl) { msgEl.textContent = `✓ ${data?.po_number || 'PO oluşturuldu'}`; msgEl.className = 'modal-msg success'; }
    document.getElementById('poCompanyVkn').value = '';
    document.getElementById('poCompanyName').value = '';
    const linesBody = document.getElementById('poLinesBody');
    if (linesBody) linesBody.innerHTML = '';
    addPoLine();
    clearCache(PO_CACHE_KEY, STOCK_CACHE_KEY);
    await loadPendingOrders();
  } catch (err) {
    if (msgEl) { msgEl.textContent = `Hata: ${err.message}`; msgEl.className = 'modal-msg error'; }
  }
}

// ─── INLINE EDIT / DELETE ─────────────────────────────────────────────────────
async function savePo(poItemId, btnEl) {
  const qtyEl = document.querySelector(`.po-ordered-input[data-po-id="${poItemId}"]`);
  const unitEl = document.querySelector(`.po-unit-input[data-po-id="${poItemId}"]`);
  const curEl = document.querySelector(`.po-cur-input[data-po-id="${poItemId}"]`);
  const totalEl = document.querySelector(`.po-total-input[data-po-id="${poItemId}"]`);
  if (!qtyEl) return;

  const orderedQty = Number(qtyEl.value || 0);
  const unitRaw = String(unitEl?.value || '').trim();
  const totalRaw = String(totalEl?.value || '').trim();
  const curRaw = String(curEl?.value || '').trim();

  if (!Number.isFinite(orderedQty) || orderedQty <= 0) { alert('Sipariş miktarı pozitif sayı olmalı.'); return; }

  if (
    orderedQty === Number(qtyEl.dataset.original) &&
    unitRaw === String(unitEl?.dataset.original || '') &&
    curRaw === String(curEl?.dataset.original || '') &&
    totalRaw === String(totalEl?.dataset.original || '')
  ) return;

  btnEl.disabled = true;
  try {
    const res = await fetch(`/api/purchase-order-items/${encodeURIComponent(poItemId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ordered_qty: orderedQty,
        unit_price_cur: unitRaw === '' ? null : Number(unitRaw),
        currency: curRaw || null,
        line_total_cur: totalRaw === '' ? null : Number(totalRaw),
      })
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Sunucudan beklenmeyen cevap.');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Güncelleme başarısız');
    qtyEl.dataset.original = String(orderedQty);
    if (unitEl) unitEl.dataset.original = unitRaw;
    if (curEl) curEl.dataset.original = curRaw;
    if (totalEl) totalEl.dataset.original = totalRaw;
    clearCache(PO_CACHE_KEY, STOCK_CACHE_KEY);
    await loadPendingOrders();
  } catch (err) {
    alert(`Güncelleme hatası: ${err.message}`);
  } finally {
    btnEl.disabled = false;
  }
}

async function deletePo(poItemId, btnEl) {
  if (!confirm('Bu bekleyen sipariş kalemini silmek istiyor musunuz?')) return;
  btnEl.disabled = true;
  try {
    const res = await fetch(`/api/purchase-order-items/${encodeURIComponent(poItemId)}`, { method: 'DELETE' });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Sunucudan beklenmeyen cevap.');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Silme başarısız');
    clearCache(PO_CACHE_KEY, STOCK_CACHE_KEY);
    await loadPendingOrders();
  } catch (err) {
    alert(`Silme hatası: ${err.message}`);
  } finally {
    btnEl.disabled = false;
  }
}
