// stok/backorder.js — Bekleyen Siparişler page

const PO_CACHE_KEY    = 'inokas_pending_po_v1';
const STOCK_CACHE_KEY = 'inokas_stock_v3';

let allPendingOrders = [];

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  addPoLine(); // Start with one empty line in the form
  document.getElementById('poCompanyVkn')?.addEventListener('blur', autoFillCompanyByVkn);
  document.getElementById('boSearch')?.addEventListener('input', renderTable);
  document.getElementById('filterDateStart')?.addEventListener('change', renderTable);
  document.getElementById('filterDateEnd')?.addEventListener('change', renderTable);
  document.getElementById('showCompleted')?.addEventListener('change', renderTable);
  await loadPendingOrders();
});

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
  const pending    = allPendingOrders.filter(po => (Number(po.ordered_qty) - Number(po.received_qty)) > 0);
  const pendingQty = pending.reduce((s, po) => s + (Number(po.ordered_qty) - Number(po.received_qty)), 0);
  const receivedQty = allPendingOrders.reduce((s, po) => s + Number(po.received_qty || 0), 0);

  document.getElementById('kpi-pending').textContent  = fmtQty(pending.length);
  document.getElementById('kpi-qty').textContent      = fmtQty(pendingQty);
  document.getElementById('kpi-received').textContent = fmtQty(receivedQty);
  document.getElementById('bo-count').textContent     = `${fmtQty(pending.length)} bekleyen kalem`;
}

// ─── RENDER TABLE ─────────────────────────────────────────────────────────────
function renderTable() {
  const body          = document.getElementById('poTableBody');
  const emptyEl       = document.getElementById('poEmpty');
  const search        = (document.getElementById('boSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const showCompleted = !!document.getElementById('showCompleted')?.checked;
  const dateStart     = document.getElementById('filterDateStart')?.value || '';
  const dateEnd       = document.getElementById('filterDateEnd')?.value   || '';
  if (!body) return;

  const filtered = allPendingOrders.filter(po => {
    const remaining = Number(po.ordered_qty) - Number(po.received_qty);
    if (!showCompleted && remaining <= 0) return false;
    const d = String(po.purchase_orders?.order_date || '').slice(0,10);
    if (dateStart && d < dateStart) return false;
    if (dateEnd   && d > dateEnd)   return false;
    if (search) {
      const company = (po.purchase_orders?.companies?.name || '').toLocaleLowerCase('tr-TR');
      const product = (po.products?.product_name || '').toLocaleLowerCase('tr-TR');
      const sku     = (po.products?.product_code || '').toLocaleLowerCase('tr-TR');
      if (!company.includes(search) && !product.includes(search) && !sku.includes(search)) return false;
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
    const ordered   = Number(po.ordered_qty)  || 0;
    const received  = Number(po.received_qty) || 0;
    const remaining = ordered - received;
    const isDone    = remaining <= 0;
    const unitPrice = po.unit_price_cur ?? '';
    const currency  = String(po.currency || '').trim();
    const lineTotal = po.line_total_cur ?? '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge-sku">${esc(po.purchase_orders?.po_number || '—')}</span></td>
      <td style="white-space:nowrap;">${esc(po.purchase_orders?.order_date || '—')}</td>
      <td style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(po.purchase_orders?.companies?.name||'')}">${esc(po.purchase_orders?.companies?.name || '—')}</td>
      <td style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;" title="${esc(po.products?.product_name||'')}">${esc(po.products?.product_name || '—')}</td>
      <td><span class="badge-sku">${esc(po.products?.product_code || '—')}</span></td>
      <td class="text-right">
        <input type="number" min="${Math.max(1,Math.ceil(received))}" step="1"
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
          <option value="" ${!currency?'selected':''}>—</option>
          <option value="TRY" ${currency==='TRY'?'selected':''}>TRY</option>
          <option value="USD" ${currency==='USD'?'selected':''}>USD</option>
          <option value="EUR" ${currency==='EUR'?'selected':''}>EUR</option>
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

    // Auto-recalc total
    const qtyInput   = tr.querySelector('.po-ordered-input');
    const unitInput  = tr.querySelector('.po-unit-input');
    const totalInput = tr.querySelector('.po-total-input');
    const recalc = () => {
      if (!totalInput) return;
      totalInput.value = (Number(qtyInput?.value||0) * Number(unitInput?.value||0)).toFixed(2);
    };
    qtyInput?.addEventListener('input', recalc);
    unitInput?.addEventListener('input', recalc);

    body.appendChild(tr);
  });
}

function clearFilters() {
  document.getElementById('boSearch').value = '';
  document.getElementById('filterDateStart').value = '';
  document.getElementById('filterDateEnd').value = '';
  document.getElementById('showCompleted').checked = false;
  renderTable();
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
  } catch {}
}

async function autoFillProductByCode(codeEl, nameEl) {
  const code = String(codeEl?.value || '').trim();
  if (!nameEl || !code) { if (nameEl) nameEl.value = ''; return; }
  try {
    const res = await fetch(`/api/products/by-code?code=${encodeURIComponent(code)}`);
    if (!res.ok) return;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return;
    const data = await res.json();
    if (data?.product_name) nameEl.value = data.product_name;
  } catch {}
}

function addPoLine() {
  const body = document.getElementById('poLinesBody');
  if (!body) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="po-line-code" placeholder="SKU" required></td>
    <td><input type="text" class="po-line-name" placeholder="(otomatik)"></td>
    <td><input type="number" class="po-line-qty" min="1" step="1" placeholder="Miktar" required></td>
    <td><input type="number" class="po-line-unit" min="0" step="0.01" placeholder="0,00"></td>
    <td>
      <select class="po-line-currency">
        <option value="">—</option>
        <option value="TRY">TRY</option>
        <option value="USD">USD</option>
        <option value="EUR">EUR</option>
      </select>
    </td>
    <td><input type="number" class="po-line-total" min="0" step="0.01" placeholder="0,00"></td>
    <td><button type="button" class="po-btn po-btn-delete" onclick="removePoLine(this)">Sil</button></td>
  `;
  const code = tr.querySelector('.po-line-code');
  const name = tr.querySelector('.po-line-name');
  const qty  = tr.querySelector('.po-line-qty');
  const unit = tr.querySelector('.po-line-unit');
  const tot  = tr.querySelector('.po-line-total');
  code?.addEventListener('blur', () => autoFillProductByCode(code, name));
  const recalc = () => { if (tot) tot.value = (Number(qty?.value||0) * Number(unit?.value||0)).toFixed(2); };
  qty?.addEventListener('input', recalc);
  unit?.addEventListener('input', recalc);
  body.appendChild(tr);
}

function removePoLine(btn) {
  const body = document.getElementById('poLinesBody');
  if (!body || body.children.length <= 1) return;
  btn.closest('tr')?.remove();
}

async function submitPoForm() {
  const msgEl = document.getElementById('poFormMsg');
  const payload = {
    company_vkn:  String(document.getElementById('poCompanyVkn')?.value || '').trim(),
    company_name: String(document.getElementById('poCompanyName')?.value || '').trim(),
    items: Array.from(document.querySelectorAll('#poLinesBody tr')).map(row => {
      const unitRaw  = String(row.querySelector('.po-line-unit')?.value  || '').trim();
      const totalRaw = String(row.querySelector('.po-line-total')?.value || '').trim();
      const qty      = Number(row.querySelector('.po-line-qty')?.value   || 0);
      const unitVal  = Number(row.querySelector('.po-line-unit')?.value  || 0);
      return {
        product_code:   String(row.querySelector('.po-line-code')?.value || '').trim(),
        ordered_qty:    qty,
        unit_price_cur: unitRaw  === '' ? null : Number(unitRaw),
        currency:       String(row.querySelector('.po-line-currency')?.value || '').trim() || null,
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
    const ct   = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Sunucudan beklenmeyen cevap alındı.');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Kayıt hatası');
    if (msgEl) { msgEl.textContent = `✓ ${data?.po_number || 'PO oluşturuldu'}`; msgEl.className = 'modal-msg success'; }
    // Reset form
    document.getElementById('poCompanyVkn').value  = '';
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
  const qtyEl   = document.querySelector(`.po-ordered-input[data-po-id="${poItemId}"]`);
  const unitEl  = document.querySelector(`.po-unit-input[data-po-id="${poItemId}"]`);
  const curEl   = document.querySelector(`.po-cur-input[data-po-id="${poItemId}"]`);
  const totalEl = document.querySelector(`.po-total-input[data-po-id="${poItemId}"]`);
  if (!qtyEl) return;

  const orderedQty = Number(qtyEl.value || 0);
  const unitRaw    = String(unitEl?.value  || '').trim();
  const totalRaw   = String(totalEl?.value || '').trim();
  const curRaw     = String(curEl?.value   || '').trim();

  if (!Number.isFinite(orderedQty) || orderedQty <= 0) { alert('Sipariş miktarı pozitif sayı olmalı.'); return; }

  // No-op check
  if (
    orderedQty === Number(qtyEl.dataset.original) &&
    unitRaw  === String(unitEl?.dataset.original  || '') &&
    curRaw   === String(curEl?.dataset.original   || '') &&
    totalRaw === String(totalEl?.dataset.original || '')
  ) return;

  btnEl.disabled = true;
  try {
    const res = await fetch(`/api/purchase-order-items/${encodeURIComponent(poItemId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ordered_qty:    orderedQty,
        unit_price_cur: unitRaw  === '' ? null : Number(unitRaw),
        currency:       curRaw   || null,
        line_total_cur: totalRaw === '' ? null : Number(totalRaw),
      })
    });
    const ct   = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Sunucudan beklenmeyen cevap.');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Güncelleme başarısız');
    qtyEl.dataset.original   = String(orderedQty);
    if (unitEl)  unitEl.dataset.original  = unitRaw;
    if (curEl)   curEl.dataset.original   = curRaw;
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
    const ct   = res.headers.get('content-type') || '';
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