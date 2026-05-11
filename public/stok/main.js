// ─── STATE ───────────────────────────────────────────────────────────────────
let allStocks       = [];  // Depo durumu (Tab 1)
let allMovements    = [];  // Stok hareketleri (Tab 2)
let allPendingOrders = []; // Bekleyen siparişler (Tab 3)
let allProductsCatalog = []; // Ürün master listesi (kar analizi görünürlüğü)
let allProfitEvents = []; // Tarih kırılımında kar analizi için event listesi
let productCategoryOptions = [];
let internalOnlySkus = []; // Sadece ofis içi hareketi olan SKU listesi
let showOnlyUnmappedStocks = false;
let stockStats      = null;
let currentStockTab = 'depo';
let currentInsightTab = 'profit';
let movementCompanyList = [];
const profitDrillState = { level: 'brand', brand: '', category: '' };
const PROFIT_BAR_COLORS = ['#2563eb', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'];
let _skuMergeContext = null;

const STOCK_CACHE_KEY     = 'inokas_stock_v3';
const MOVEMENT_CACHE_KEY  = 'inokas_movements_v1';
const PO_CACHE_KEY        = 'inokas_pending_po_v1';

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupStockUi();
  await loadAllData();
});

function setupStockUi() {
  document.getElementById('stockSearch')?.addEventListener('input', renderDepoTable);
  document.getElementById('stockCategoryFilter')?.addEventListener('change', renderDepoTable);
  document.getElementById('stockUnmappedFilterBtn')?.addEventListener('click', toggleUnmappedStockFilter);
  document.getElementById('pendingPoForm')?.addEventListener('submit', submitPendingPoForm);
  document.getElementById('poCompanyVkn')?.addEventListener('blur', autoFillCompanyByVkn);
  document.querySelectorAll('.insight-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextTab = btn.dataset.insightTab || 'profit';
      if (nextTab === 'profit_drill' && currentInsightTab !== 'profit_drill') {
        profitDrillState.level = 'brand';
        profitDrillState.brand = '';
        profitDrillState.category = '';
      }
      currentInsightTab = nextTab;
      document.querySelectorAll('.insight-tab-btn').forEach((x) => x.classList.toggle('active', x === btn));
      renderStockInsights();
    });
  });
  document.getElementById('insightBackBtn')?.addEventListener('click', () => {
    if (profitDrillState.level === 'model') {
      profitDrillState.level = 'category';
      profitDrillState.category = '';
    } else if (profitDrillState.level === 'category') {
      profitDrillState.level = 'brand';
      profitDrillState.brand = '';
    }
    renderStockInsights();
  });
  document.getElementById('insightStartDate')?.addEventListener('change', () => renderStockInsights());
  document.getElementById('insightEndDate')?.addEventListener('change', () => renderStockInsights());
  document.getElementById('skuMergeForm')?.addEventListener('submit', submitSkuMergeForm);
  addPendingPoLine();
}

function toggleUnmappedStockFilter() {
  showOnlyUnmappedStocks = !showOnlyUnmappedStocks;
  const btn = document.getElementById('stockUnmappedFilterBtn');
  if (btn) {
    btn.classList.toggle('active', showOnlyUnmappedStocks);
    btn.textContent = "DB'de Olmayanları Filtrele";
  }
  renderDepoTable();
}

async function loadAllData() {
  await Promise.all([
    ensureProductCategoryOptions(),
    loadStockSummary(),
    loadMovements(),
    loadPendingOrders()
  ]);
}

// ensureProductCategoryOptions → stok/api.js dosyasına taşındı

// ─── ÜRÜN EKLE SEKMESİ ───────────────────────────────────────────────────────

const _BRAND_OPTIONS = ['ASUS','EPSON','EPSON-YP','EVERTON','HP','KYOCERA','LG','OKI','SAMSUNG'];
let _extraBrandOptions = [];

let _urunEkleTabInited = false;

function initUrunEkleTab() {
  if (_urunEkleTabInited) return;
  _urunEkleTabInited = true;
  _buildUrunEkleCategorySelect();
  _buildUrunEkleBrandSelect();

  // Category new-item wiring
  const catSel    = document.getElementById('ue-category');
  const catWrap   = document.getElementById('ue-cat-new-wrap');
  const catInput  = document.getElementById('ue-cat-new-input');
  const catSave   = document.getElementById('ue-cat-save-btn');
  const catCancel = document.getElementById('ue-cat-cancel-btn');

  catSel?.addEventListener('change', () => {
    if (catSel.value !== '__new__') return;
    catSel.value = '';
    if (catWrap) { catWrap.style.display = 'flex'; catInput?.focus(); }
  });
  catSave?.addEventListener('click', () => {
    const val = String(catInput?.value || '').trim();
    if (!val) return;
    if (!productCategoryOptions.includes(val)) {
      productCategoryOptions.push(val);
      productCategoryOptions.sort((a, b) => a.localeCompare(b, 'tr'));
    }
    _buildUrunEkleCategorySelect(val);
    if (catWrap) catWrap.style.display = 'none';
    if (catInput) catInput.value = '';
  });
  catCancel?.addEventListener('click', () => {
    if (catWrap) catWrap.style.display = 'none';
    if (catInput) catInput.value = '';
  });

  // Brand new-item wiring
  const brandSel    = document.getElementById('ue-brand');
  const brandWrap   = document.getElementById('ue-brand-new-wrap');
  const brandInput  = document.getElementById('ue-brand-new-input');
  const brandSave   = document.getElementById('ue-brand-save-btn');
  const brandCancel = document.getElementById('ue-brand-cancel-btn');

  brandSel?.addEventListener('change', () => {
    if (brandSel.value !== '__new__') return;
    brandSel.value = '';
    if (brandWrap) { brandWrap.style.display = 'flex'; brandInput?.focus(); }
  });
  brandSave?.addEventListener('click', () => {
    const val = String(brandInput?.value || '').trim().toUpperCase();
    if (!val) return;
    if (!_BRAND_OPTIONS.includes(val) && !_extraBrandOptions.includes(val)) {
      _extraBrandOptions.push(val);
      _extraBrandOptions.sort((a, b) => a.localeCompare(b, 'tr'));
    }
    _buildUrunEkleBrandSelect(val);
    if (brandWrap) brandWrap.style.display = 'none';
    if (brandInput) brandInput.value = '';
  });
  brandCancel?.addEventListener('click', () => {
    if (brandWrap) brandWrap.style.display = 'none';
    if (brandInput) brandInput.value = '';
  });
}

function _buildUrunEkleCategorySelect(selected = '') {
  const sel = document.getElementById('ue-category');
  if (!sel) return;
  const opts = productCategoryOptions || [];
  sel.innerHTML = [
    '<option value="">Kategori seçin...</option>',
    ...opts.map(c => `<option value="${esc(c)}"${c === selected ? ' selected' : ''}>${esc(c)}</option>`),
    '<option value="__new__">+ Yeni kategori ekle</option>'
  ].join('');
}

function _buildUrunEkleBrandSelect(selected = '') {
  const sel = document.getElementById('ue-brand');
  if (!sel) return;
  const opts = [..._BRAND_OPTIONS, ..._extraBrandOptions];
  sel.innerHTML = [
    '<option value="">Marka seçin...</option>',
    ...opts.map(b => `<option value="${esc(b)}"${b === selected ? ' selected' : ''}>${esc(b)}</option>`),
    '<option value="__new__">+ Yeni marka ekle</option>'
  ].join('');
}

async function saveUrunEkle() {
  const nameEl  = document.getElementById('ue-product_name');
  const codeEl  = document.getElementById('ue-product_code');
  const brandEl = document.getElementById('ue-brand');
  const catEl   = document.getElementById('ue-category');
  const dmoEl   = document.getElementById('ue-dmo_code');
  const ppEl    = document.getElementById('ue-purchase_price');
  const pcEl    = document.getElementById('ue-purchase_currency');
  const spEl    = document.getElementById('ue-sales_price');
  const scEl    = document.getElementById('ue-sales_currency');
  const msgEl   = document.getElementById('urunEkleMsg');
  const saveBtn = document.getElementById('urunEkleSaveBtn');

  const product_name = String(nameEl?.value || '').trim();
  const product_code = String(codeEl?.value || '').trim();

  if (!product_name) { showUrunEkleMsg('Ürün adı zorunludur.', 'error'); nameEl?.focus(); return; }
  if (!product_code) { showUrunEkleMsg('Ürün kodu zorunludur.', 'error'); codeEl?.focus(); return; }

  const payload = {
    product_name,
    product_code,
    brand:             String(brandEl?.value || '').trim().toUpperCase() || null,
    category:          String(catEl?.value  || '').trim() || null,
    dmo_code:          String(dmoEl?.value  || '').trim() || null,
    purchase_price:    parseFloat(ppEl?.value)  || null,
    purchase_currency: pcEl?.value  || 'TRY',
    sales_price:       parseFloat(spEl?.value)  || null,
    sales_currency:    scEl?.value  || 'TRY',
  };

  saveBtn.disabled = true;
  showUrunEkleMsg('Kaydediliyor...', '');

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Sunucu hatası');
    showUrunEkleMsg(`✓ "${product_name}" eklendi.`, 'success');
    resetUrunEkleForm();
    // Refresh caches so new product appears in lists
    productCategoryOptions = [];
    await ensureProductCategoryOptions();
    _buildUrunEkleCategorySelect();
    _buildUrunEkleBrandSelect();
  } catch (err) {
    showUrunEkleMsg('Hata: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

function resetUrunEkleForm() {
  ['ue-product_name','ue-product_code','ue-dmo_code','ue-purchase_price','ue-sales_price'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const catSel = document.getElementById('ue-category');
  if (catSel) catSel.value = '';
  const catWrap = document.getElementById('ue-cat-new-wrap');
  if (catWrap) catWrap.style.display = 'none';
  const brandSel = document.getElementById('ue-brand');
  if (brandSel) brandSel.value = '';
  const brandWrap = document.getElementById('ue-brand-new-wrap');
  if (brandWrap) brandWrap.style.display = 'none';
}

function showUrunEkleMsg(text, type) {
  const el = document.getElementById('urunEkleMsg');
  if (!el) return;
  el.textContent = text;
  el.className   = 'urun-ekle-msg' + (type ? ' ' + type : '');
}

function renderProductCategorySelect(selected = '') {
  const select = document.getElementById('pf-category');
  if (!select) return;
  const current = String(selected || '').trim();
  const options = productCategoryOptions || [];
  select.innerHTML = [
    '<option value="">Kategori seçin</option>',
    ...options.map((cat) => {
      const sel = cat === current ? ' selected' : '';
      return `<option value="${esc(cat)}"${sel}>${esc(cat)}</option>`;
    })
  ].join('');
  if (current && !options.includes(current)) {
    const extra = document.createElement('option');
    extra.value = current;
    extra.textContent = current;
    extra.selected = true;
    select.appendChild(extra);
  }
}

// ─── TAB SWITCH ───────────────────────────────────────────────────────────────
function switchStockTab(tab) {
  currentStockTab = tab;
  const tabBtnIds = { depo: 'tabDepo', hareketler: 'tabHareketler', bekleyen: 'tabBekleyen', 'urun-ekle': 'tabUrunEkle' };
  Object.keys(tabBtnIds).forEach(t => {
    document.getElementById(`tabContent-${t}`)?.classList.toggle('active', t === tab);
    document.getElementById(tabBtnIds[t])?.classList.toggle('active', t === tab);
  });
  if (tab === 'urun-ekle') initUrunEkleTab();
}

// ─── TAB 1: DEPO DURUMU ───────────────────────────────────────────────────────
// loadStockSummary → stok/api.js dosyasına taşındı

function renderStockCategoryFilter() {
  const selectEl = document.getElementById('stockCategoryFilter');
  if (!selectEl) return;
  const currentVal = String(selectEl.value || '').trim();
  const categories = [...new Set(
    (allStocks || [])
      .map((r) => String(r.category || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'tr'));

  selectEl.innerHTML = [
    '<option value="">Tüm Kategoriler</option>',
    ...categories.map((cat) => `<option value="${esc(cat)}">${esc(cat)}</option>`)
  ].join('');
  if (currentVal && categories.includes(currentVal)) {
    selectEl.value = currentVal;
  } else {
    selectEl.value = '';
  }
}

// isSarfCategory → stok/utils.js dosyasına taşındı

function getInsightDateRange() {
  const startRaw = document.getElementById('insightStartDate')?.value || '';
  const endRaw = document.getElementById('insightEndDate')?.value || '';
  if (!startRaw && !endRaw) return { start: '', end: '' };
  let start = startRaw;
  let end = endRaw;
  if (start && end && start > end) {
    const t = start;
    start = end;
    end = t;
  }
  return { start, end };
}

// getProfitBySkuInRange, buildProfitDrillRows → stok/utils.js dosyasına taşındı

function renderDepoTable() {
  const body       = document.getElementById('stocksTableBody');
  const emptyEl    = document.getElementById('stocksEmptyState');
  const search     = (document.getElementById('stockSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const categoryFilter = String(document.getElementById('stockCategoryFilter')?.value || '').trim().toLocaleLowerCase('tr-TR');
  if (!body) return;

  const filtered = allStocks.filter(r =>
    (!search ||
      String(r.product_name || '').toLocaleLowerCase('tr-TR').includes(search) ||
      String(r.sku || '').toLocaleLowerCase('tr-TR').includes(search)) &&
    (!categoryFilter || String(r.category || '').toLocaleLowerCase('tr-TR') === categoryFilter) &&
    (!showOnlyUnmappedStocks || !r.product_id)
  );

  body.innerHTML = '';
  if (!filtered.length) {
    showEmpty('stocksEmptyState', search ? 'Arama sonucu bulunamadı.' : 'Henüz stok kaydı yok.');
    return;
  }
  emptyEl.style.display = 'none';

  // Her ürün için bekleyen backorder miktarını bul
  const backorderBySkuMap = {};
  allPendingOrders.forEach(po => {
    const sku = po.products?.product_code || '';
    if (!sku) return;
    const remaining = Number(po.ordered_qty) - Number(po.received_qty);
    if (!backorderBySkuMap[sku]) backorderBySkuMap[sku] = 0;
    backorderBySkuMap[sku] += remaining;
  });

  filtered.forEach(row => {
    const backorder = backorderBySkuMap[row.sku] || 0;
    const stockClass = Number(row.current_stock) <= 0 ? 'text-danger' : Number(row.current_stock) < 5 ? 'text-warning' : 'text-success';
    const tr = document.createElement('tr');
    tr.dataset.productId = row.product_id || '';
    tr.title = row.product_id ? 'Düzenlemek için tıklayın' : 'SKU eşleşmesi yok - düzeltmek için tıklayın';
    tr.onclick = () => handleStockRowClick(row);
    tr.innerHTML = `
      <td style="font-weight:600;">${esc(row.product_name)}</td>
      <td><span class="badge-sku">${esc(row.sku || '-')}</span></td>
      <td class="stock-category-cell">${esc(row.category || '—')}</td>
      <td class="text-right text-success">${fmtQty(row.total_in)}</td>
      <td class="text-right text-danger">${fmtQty(row.total_out)}</td>
      <td class="text-right"><strong class="${stockClass}">${fmtQty(row.current_stock)}</strong></td>
      <td class="text-right">${backorder > 0 ? `<span class="badge-backorder">+${fmtQty(backorder)}</span>` : '<span style="color:#94a3b8;">—</span>'}</td>
      <td class="text-right">${fmtQty(row.reserved_quantity || 0)}</td>
      <td class="text-right">${fmtQty(row.gift_quantity || 0)}</td>
      <td class="text-right">${fmtUsdOrDash(row.stock_usd)}</td>
    `;
    body.appendChild(tr);
    const qtyInput = tr.querySelector('.po-ordered-input');
    const unitInput = tr.querySelector('.po-unit-input');
    const totalInput = tr.querySelector('.po-total-input');
    const recalcTotal = () => {
      if (!qtyInput || !unitInput || !totalInput) return;
      const qty = Number(qtyInput.value || 0);
      const unit = Number(unitInput.value || 0);
      totalInput.value = (qty * unit).toFixed(2);
    };
    qtyInput?.addEventListener('input', recalcTotal);
    unitInput?.addEventListener('input', recalcTotal);
  });
}

async function handleStockRowClick(row) {
  if (row?.product_id) {
    openProductModal(row.product_id);
    return;
  }
  const fromSku = String(row?.sku || '').trim();
  if (!fromSku) {
    alert('Bu satırda ürün kodu bulunamadı.');
    return;
  }
  openSkuMergeModal(row);
}

function openSkuMergeModal(row) {
  _skuMergeContext = row || null;
  const fromSku = String(row?.sku || '').trim();
  const fromInput = document.getElementById('skuMergeFromCode');
  const toInput = document.getElementById('skuMergeToCode');
  const msgEl = document.getElementById('skuMergeMsg');
  const hintEl = document.getElementById('skuMergeHint');
  const createMissing = document.getElementById('skuMergeCreateMissing');
  if (!fromInput || !toInput) return;

  fromInput.value = fromSku;
  toInput.value = fromSku;
  if (createMissing) createMissing.checked = true;
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.className = 'modal-msg';
  }
  if (hintEl) {
    hintEl.textContent = row?.product_name
      ? `${row.product_name} satırı için toplu SKU güncellemesi yapılacak.`
      : 'Seçili satır için toplu SKU güncellemesi yapılacak.';
  }
  document.getElementById('skuMergeModal').style.display = 'flex';
  setTimeout(() => toInput.focus(), 0);
}

function closeSkuMergeModal() {
  document.getElementById('skuMergeModal').style.display = 'none';
  _skuMergeContext = null;
}

async function submitSkuMergeForm(e) {
  e.preventDefault();
  const row = _skuMergeContext;
  const fromSku = String(document.getElementById('skuMergeFromCode')?.value || '').trim();
  const toSku = String(document.getElementById('skuMergeToCode')?.value || '').trim();
  const createIfMissing = !!document.getElementById('skuMergeCreateMissing')?.checked;
  const submitBtn = document.getElementById('skuMergeSubmitBtn');
  const msgEl = document.getElementById('skuMergeMsg');
  if (!row || !fromSku) return;

  if (!toSku) {
    if (msgEl) {
      msgEl.textContent = 'Hedef ürün kodu boş olamaz.';
      msgEl.className = 'modal-msg error';
    }
    return;
  }
  try {
    if (submitBtn) submitBtn.disabled = true;
    if (msgEl) {
      msgEl.textContent = 'İşleniyor...';
      msgEl.className = 'modal-msg';
    }

    // Kod değişmiyorsa normalize adımını atla, direkt products kontrolüne geç
    if (toSku !== fromSku) {
      const res = await fetch('/api/invoice-items/normalize-sku', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_code: fromSku, to_code: toSku })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'SKU güncelleme başarısız');

      sessionStorage.removeItem(STOCK_CACHE_KEY);
      sessionStorage.removeItem(MOVEMENT_CACHE_KEY);
      sessionStorage.removeItem(PO_CACHE_KEY);
      await loadAllData();
    }

    let product = null;
    const byCodeRes = await fetch(`/api/products/by-code?code=${encodeURIComponent(toSku)}`);
    if (byCodeRes.ok) {
      product = await byCodeRes.json();
    } else if (byCodeRes.status === 404 && createIfMissing) {
      const ensureRes = await fetch('/api/products/ensure-by-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_code: toSku,
          product_name: String(row?.product_name || '').trim()
        })
      });
      const ensureData = await ensureRes.json();
      if (!ensureRes.ok) throw new Error(ensureData?.error || 'Ürün oluşturulamadı');
      product = ensureData?.data || null;
    }

    if (msgEl) {
      msgEl.textContent = `Tamamlandı. Güncellenen satır: ${Number(data?.updated_rows || 0)}`;
      msgEl.className = 'modal-msg success';
    }

    if (product?.id) {
      sessionStorage.removeItem(STOCK_CACHE_KEY);
      await loadStockSummary();
      closeSkuMergeModal();
      openProductModal(product.id);
      return;
    }

    closeSkuMergeModal();
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = `Hata: ${err.message}`;
      msgEl.className = 'modal-msg error';
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function renderStockStats() {
  document.getElementById('stat-stock-value').innerText = fmtUsd(stockStats?.stock_usd ?? allStocks.reduce((a, r) => a + Number(r.stock_usd || 0), 0));
  document.getElementById('stat-product-count').innerText = String(allStocks.length);
  document.getElementById('stat-current').innerText   = fmtQty(stockStats?.current_qty   ?? allStocks.reduce((a, r) => a + Number(r.current_stock || 0), 0));
  document.getElementById('stat-total-in').innerText  = fmtQty(stockStats?.total_in_qty  ?? allStocks.reduce((a, r) => a + Number(r.total_in     || 0), 0));
  document.getElementById('stat-total-out').innerText = fmtQty(stockStats?.total_out_qty ?? allStocks.reduce((a, r) => a + Number(r.total_out    || 0), 0));
}

function renderStockInsights() {
  const barsEl = document.getElementById('stockInsightBars');
  const subEl = document.getElementById('stockInsightSubLabel');
  const backBtn = document.getElementById('insightBackBtn');
  const dateFilters = document.getElementById('insightDateFilters');
  if (!barsEl || !subEl || !backBtn || !dateFilters) return;

  if (currentInsightTab === 'profit_drill') {
    dateFilters.style.display = 'flex';
    const { rows, subtitle } = buildProfitDrillRows();
    subEl.textContent = subtitle;
    backBtn.style.display = profitDrillState.level === 'brand' ? 'none' : 'inline-flex';
    barsEl.innerHTML = '';
    if (!rows.length) {
      barsEl.innerHTML = '<div class="insight-empty">Kar analizi için yeterli veri yok.</div>';
      return;
    }
    barsEl.className = 'insight-columns';
    const maxVal = rows.reduce((acc, row) => Math.max(acc, Number(row.value || 0)), 0);
    rows.forEach((row, idx) => {
      const col = document.createElement('div');
      const heightPct = maxVal > 0 ? Math.max(3, Math.round((Number(row.value || 0) / maxVal) * 100)) : 0;
      col.className = 'insight-col';
      col.innerHTML = `
        <div class="insight-col-value">${fmtUsd(row.value)}</div>
        <div class="insight-col-bar-wrap">
          <div class="insight-col-bar" style="height:${heightPct}%; background:${PROFIT_BAR_COLORS[idx % PROFIT_BAR_COLORS.length]};"></div>
        </div>
        <div class="insight-col-name" title="${esc(row.name)}">${esc(row.name)}</div>
      `;
      if (row.canDrill) {
        col.classList.add('clickable');
        col.onclick = () => {
          if (profitDrillState.level === 'brand') {
            profitDrillState.level = 'category';
            profitDrillState.brand = row.name;
            profitDrillState.category = '';
          } else if (profitDrillState.level === 'category') {
            profitDrillState.level = 'model';
            profitDrillState.category = row.name;
          }
          renderStockInsights();
        };
      }
      barsEl.appendChild(col);
    });
    return;
  }

  dateFilters.style.display = 'none';
  const model = buildInsightModel();
  const active = model[currentInsightTab] || model.profit;
  const rows = Array.isArray(active.rows) ? active.rows : [];
  const maxVal = rows.reduce((acc, row) => Math.max(acc, Number(row.value) || 0), 0);
  backBtn.style.display = 'none';
  barsEl.className = 'insight-bars';

  subEl.textContent = active.subtitle || 'Top 10';
  barsEl.innerHTML = '';

  if (!rows.length) {
    barsEl.innerHTML = '<div class="insight-empty">Bu görünüm için yeterli veri yok.</div>';
    return;
  }

  rows.forEach((row) => {
    const widthPct = maxVal > 0 ? Math.max(3, Math.round((Number(row.value || 0) / maxVal) * 100)) : 0;
    const el = document.createElement('div');
    el.className = 'insight-row';
    el.innerHTML = `
      <div class="insight-name" title="${esc(row.name)}">${esc(row.name)}</div>
      <div class="insight-track">
        <div class="insight-fill insight-fill--${active.variant}" style="width:${widthPct}%;"></div>
      </div>
      <div class="insight-value">${esc(row.label)}</div>
    `;
    barsEl.appendChild(el);
  });
}

// buildInsightModel, getSoldQtyLastDaysBySku → stok/utils.js dosyasına taşındı

// ─── TAB 2: STOK HAREKETLERİ ──────────────────────────────────────────────────
// loadMovements → stok/api.js dosyasına taşındı

function renderMovementsTable() {
  const body    = document.getElementById('movementsTableBody');
  const emptyEl = document.getElementById('movementsEmptyState');
  const search  = (document.getElementById('movementSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const selectedCompany = (document.getElementById('movementCompany')?.value || '').trim();
  const dir     = document.getElementById('movementDirection')?.value || '';
  if (!body) return;

  const filtered = allMovements.filter(m => {
    const matchSearch = !search ||
      String(m.product_name || '').toLocaleLowerCase('tr-TR').includes(search) ||
      String(m.sku          || '').toLocaleLowerCase('tr-TR').includes(search);
    const matchCompany = !selectedCompany || String(m.company_name || '') === selectedCompany;
    const matchDir = !dir || m.direction === dir;
    return matchSearch && matchCompany && matchDir;
  });

  body.innerHTML = '';
  if (!filtered.length) {
    showEmpty('movementsEmptyState', 'Hareket kaydı bulunamadı.');
    return;
  }
  emptyEl.style.display = 'none';

  filtered.forEach(m => {
    const isIn  = m.direction === 'INCOMING';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="movement-date-cell">${m.invoice_date || '—'}</td>
      <td>
        <span class="badge-dir ${isIn ? 'badge-in' : 'badge-out'}">
          ${isIn ? '▲ Giriş' : '▼ Çıkış'}
        </span>
      </td>
      <td><span class="badge-sku">${esc(m.invoice_no || '—')}</span></td>
      <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(m.company_name || '')}">${esc(m.company_name || '—')}</td>
      <td style="font-weight:500;">${esc(m.product_name || '—')}</td>
      <td><span class="badge-sku">${esc(m.sku || '—')}</span></td>
      <td class="text-right"><strong class="${isIn ? 'text-success' : 'text-danger'}">${isIn ? '+' : '-'}${fmtQty(m.quantity)}</strong></td>
      <td class="text-right">${m.unit_price_cur != null ? Number(m.unit_price_cur).toLocaleString('tr-TR', {minimumFractionDigits:2}) : '—'}</td>
      <td>${esc(m.currency || '—')}</td>
    `;
    body.appendChild(tr);
    const qtyInput = tr.querySelector('.po-ordered-input');
    const unitInput = tr.querySelector('.po-unit-input');
    const totalInput = tr.querySelector('.po-total-input');
    const recalcLineTotal = () => {
      if (!qtyInput || !unitInput || !totalInput) return;
      const qty = Number(qtyInput.value || 0);
      const unit = Number(unitInput.value || 0);
      totalInput.value = (qty * unit).toFixed(2);
    };
    qtyInput?.addEventListener('input', recalcLineTotal);
    unitInput?.addEventListener('input', recalcLineTotal);
  });
}

function renderMovementCompanyOptions() {
  const hidden = document.getElementById('movementCompany');
  const currentVal = String(hidden?.value || '').trim();
  movementCompanyList = [...new Set(
    allMovements
      .map((m) => String(m.company_name || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'tr'));

  if (hidden && currentVal && !movementCompanyList.includes(currentVal)) {
    hidden.value = '';
  }
  _renderMovementCompanyList('');
  _refreshMovementCompanyButton();
}

function filterMovementCompanyDropdown() {
  const q = (document.getElementById('movementCompanyDropdownSearch')?.value || '').toLocaleLowerCase('tr-TR').trim();
  _renderMovementCompanyList(q);
}

function _renderMovementCompanyList(query) {
  const list = document.getElementById('movementCompanyDropdownList');
  const selected = String(document.getElementById('movementCompany')?.value || '');
  if (!list) return;

  const filtered = query
    ? movementCompanyList.filter((name) =>
        name
          .toLocaleLowerCase('tr-TR')
          .split(/\s+/)
          .some((word) => word.startsWith(query))
      )
    : movementCompanyList;

  list.innerHTML = '';
  const allLi = document.createElement('li');
  allLi.textContent = 'Tüm Firmalar';
  allLi.className = 'all-option' + (selected === '' ? ' selected' : '');
  allLi.onclick = () => _setMovementCompanyValue('');
  list.appendChild(allLi);

  filtered.forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    li.title = name;
    if (name === selected) li.classList.add('selected');
    li.onclick = () => _setMovementCompanyValue(name);
    list.appendChild(li);
  });

  if (filtered.length === 0 && query) {
    const empty = document.createElement('li');
    empty.textContent = 'Sonuç bulunamadı';
    empty.style.cssText = 'color:#94a3b8; cursor:default; pointer-events:none;';
    list.appendChild(empty);
  }
}

function _setMovementCompanyValue(val) {
  const hidden = document.getElementById('movementCompany');
  if (hidden) hidden.value = val;
  _refreshMovementCompanyButton();
  closeMovementCompanyDropdown();
  renderMovementsTable();
}

function _refreshMovementCompanyButton() {
  const value = String(document.getElementById('movementCompany')?.value || '');
  const label = document.getElementById('movementCompanyDropdownLabel');
  const btn = document.getElementById('movementCompanyDropdownBtn');
  if (label) label.textContent = value || 'Tüm Firmalar';
  if (btn) btn.style.color = value ? '#0f172a' : '#374151';
}

function toggleMovementCompanyDropdown() {
  const panel = document.getElementById('movementCompanyDropdownPanel');
  const search = document.getElementById('movementCompanyDropdownSearch');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (isOpen) {
    closeMovementCompanyDropdown();
  } else {
    panel.style.display = 'block';
    if (search) {
      search.value = '';
      search.focus();
    }
    _renderMovementCompanyList('');
    setTimeout(() => document.addEventListener('click', outsideMovementCompanyClick), 0);
  }
}

function closeMovementCompanyDropdown() {
  const panel = document.getElementById('movementCompanyDropdownPanel');
  if (panel) panel.style.display = 'none';
  document.removeEventListener('click', outsideMovementCompanyClick);
}

function outsideMovementCompanyClick(e) {
  const wrap = document.getElementById('movementCompanyDropdownWrap');
  if (wrap && !wrap.contains(e.target)) closeMovementCompanyDropdown();
}

// ─── TAB 3: BEKLEYEN SİPARİŞLER ──────────────────────────────────────────────
// loadPendingOrders → stok/api.js dosyasına taşındı

function updatePendingPoStat() {
  const count = allPendingOrders.filter(po => Number(po.ordered_qty) > Number(po.received_qty)).length;
  document.getElementById('stat-pending-po').innerText = String(count);
}

function renderPendingOrdersTable() {
  const body    = document.getElementById('poTableBody');
  const emptyEl = document.getElementById('poEmptyState');
  const search  = (document.getElementById('poSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const showCompleted = !!document.getElementById('poShowCompleted')?.checked;
  if (!body) return;

  const filtered = allPendingOrders.filter(po => {
    const remaining = Number(po.ordered_qty) - Number(po.received_qty);
    if (!showCompleted && remaining <= 0) return false; // sadece bekleyenler
    const companyName = (po.purchase_orders?.companies?.name || '').toLocaleLowerCase('tr-TR');
    const productName = (po.products?.product_name || '').toLocaleLowerCase('tr-TR');
    const productSku  = (po.products?.product_code || '').toLocaleLowerCase('tr-TR');
    return !search || companyName.includes(search) || productName.includes(search) || productSku.includes(search);
  });

  body.innerHTML = '';
  if (!filtered.length) {
    showEmpty('poEmptyState', search ? 'Arama sonucu bulunamadı.' : (showCompleted ? 'Sipariş kaydı yok.' : 'Bekleyen sipariş kaydı yok.'));
    return;
  }
  emptyEl.style.display = 'none';

  filtered.forEach(po => {
    const ordered   = Number(po.ordered_qty)  || 0;
    const received  = Number(po.received_qty) || 0;
    const remaining = ordered - received;
    const isCompleted = remaining <= 0;
    const unitPrice = po.unit_price_cur === null || po.unit_price_cur === undefined ? '' : Number(po.unit_price_cur);
    const currency = String(po.currency || '').trim();
    const lineTotal = po.line_total_cur === null || po.line_total_cur === undefined ? '' : Number(po.line_total_cur);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="badge-sku">${esc(po.purchase_orders?.po_number || '—')}</span></td>
      <td>${po.purchase_orders?.order_date || '—'}</td>
      <td style="max-width:95px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(po.purchase_orders?.companies?.name || '')}">${esc(po.purchase_orders?.companies?.name || '—')}</td>
      <td class="po-product-name-cell" title="${esc(po.products?.product_name || '—')}">${esc(po.products?.product_name || '—')}</td>
      <td><span class="badge-sku">${esc(po.products?.product_code || '—')}</span></td>
      <td class="text-right">
        <input
          type="number"
          min="${Math.max(1, Math.ceil(received))}"
          step="1"
          class="po-ordered-input"
          value="${ordered}"
          data-po-id="${po.id}"
          data-original="${ordered}"
          style="width:70px; text-align:right; border:1px solid #cbd5e1; border-radius:6px; padding:4px 6px;"
        >
      </td>
      <td class="text-right">
        <input
          type="number"
          min="0"
          step="0.01"
          class="po-unit-input"
          value="${unitPrice}"
          data-po-id="${po.id}"
          data-original="${unitPrice}"
          style="width:82px; text-align:right; border:1px solid #cbd5e1; border-radius:6px; padding:4px 6px;"
        >
      </td>
      <td>
        <select
          class="po-cur-input"
          data-po-id="${po.id}"
          data-original="${currency}"
          style="width:72px; border:1px solid #cbd5e1; border-radius:6px; padding:4px 6px;"
        >
          <option value="" ${!currency ? 'selected' : ''}>-</option>
          <option value="TRY" ${currency === 'TRY' ? 'selected' : ''}>TRY</option>
          <option value="USD" ${currency === 'USD' ? 'selected' : ''}>USD</option>
          <option value="EUR" ${currency === 'EUR' ? 'selected' : ''}>EUR</option>
        </select>
      </td>
      <td class="text-right">
        <input
          type="number"
          min="0"
          step="0.01"
          class="po-total-input"
          value="${lineTotal}"
          data-po-id="${po.id}"
          data-original="${lineTotal}"
          style="width:92px; text-align:right; border:1px solid #cbd5e1; border-radius:6px; padding:4px 6px;"
        >
      </td>
      <td class="text-right text-success">${fmtQty(received)}</td>
      <td class="text-right"><strong class="${isCompleted ? 'text-success' : 'text-warning'}">${fmtQty(remaining)}</strong></td>
      <td>
        <div class="po-actions">
          <button type="button" class="po-btn po-btn--save" onclick="savePendingOrderItem('${po.id}', this)">Güncelle</button>
          <button type="button" class="po-btn po-btn--delete" onclick="deletePendingOrderItem('${po.id}', this)">Sil</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
    const qtyInput = tr.querySelector('.po-ordered-input');
    const unitInput = tr.querySelector('.po-unit-input');
    const totalInput = tr.querySelector('.po-total-input');
    const recalcLineTotal = () => {
      if (!qtyInput || !unitInput || !totalInput) return;
      const qty = Number(qtyInput.value || 0);
      const unit = Number(unitInput.value || 0);
      totalInput.value = (qty * unit).toFixed(2);
    };
    qtyInput?.addEventListener('input', recalcLineTotal);
    unitInput?.addEventListener('input', recalcLineTotal);
  });
}

// ─── YARDIMCI FONKSİYONLAR ────────────────────────────────────────────────────
// fmtQty, fmtUsd, fmtUsdOrDash, esc, readCache, writeCache → stok/utils.js dosyasına taşındı

function showEmpty(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'block'; el.innerText = msg; }
}

// ─── MINI FORM: BACKORDER EKLE ────────────────────────────────────────────────
async function autoFillCompanyByVkn() {
  const vknInput = document.getElementById('poCompanyVkn');
  const nameInput = document.getElementById('poCompanyName');
  const vkn = String(vknInput?.value || '').trim();
  if (!nameInput) return;
  if (!vkn) {
    nameInput.value = '';
    return;
  }
  try {
    const res = await fetch(`/api/companies/by-vkn?vkn=${encodeURIComponent(vkn)}`);
    if (!res.ok) return;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return;
    const data = await res.json();
    nameInput.value = data?.name || '';
  } catch {}
}

async function autoFillProductByCode(codeInput, nameInput) {
  const code = String(codeInput?.value || '').trim();
  if (!nameInput) return;
  if (!code) {
    nameInput.value = '';
    return;
  }
  try {
    const res = await fetch(`/api/products/by-code?code=${encodeURIComponent(code)}`);
    if (!res.ok) return;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return;
    const data = await res.json();
    if (data?.product_name) {
      nameInput.value = data.product_name;
    }
  } catch {}
}

function addPendingPoLine() {
  const body = document.getElementById('poLinesBody');
  if (!body) return;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="po-line-code" placeholder="SKU" required></td>
    <td><input type="text" class="po-line-name" placeholder="Ürün adı (otomatik, bulunamazsa manuel girin)"></td>
    <td><input type="number" class="po-line-qty" min="1" step="1" placeholder="Miktar" required></td>
    <td><input type="number" class="po-line-unit-price" min="0" step="0.01" placeholder="0,00"></td>
    <td>
      <select class="po-line-currency">
        <option value="">Seçin</option>
        <option value="TRY">TRY</option>
        <option value="USD">USD</option>
        <option value="EUR">EUR</option>
      </select>
    </td>
    <td><input type="number" class="po-line-total" min="0" step="0.01" placeholder="0,00"></td>
    <td><button type="button" class="po-btn po-btn--delete" onclick="removePendingPoLine(this)">Sil</button></td>
  `;
  const codeInput = tr.querySelector('.po-line-code');
  const nameInput = tr.querySelector('.po-line-name');
  const qtyInput = tr.querySelector('.po-line-qty');
  const unitPriceInput = tr.querySelector('.po-line-unit-price');
  const totalInput = tr.querySelector('.po-line-total');
  codeInput?.addEventListener('blur', () => autoFillProductByCode(codeInput, nameInput));
  const recalcTotal = () => {
    if (!totalInput) return;
    const qty = Number(qtyInput?.value || 0);
    const unitPrice = Number(unitPriceInput?.value || 0);
    totalInput.value = (qty * unitPrice).toFixed(2);
  };
  qtyInput?.addEventListener('input', recalcTotal);
  unitPriceInput?.addEventListener('input', recalcTotal);
  body.appendChild(tr);
}

function removePendingPoLine(btn) {
  const body = document.getElementById('poLinesBody');
  if (!body) return;
  if (body.children.length <= 1) return;
  btn.closest('tr')?.remove();
}

async function submitPendingPoForm(e) {
  e.preventDefault();
  const msgEl = document.getElementById('pendingPoFormMsg');
  const form = document.getElementById('pendingPoForm');
  const payload = {
    company_vkn: String(document.getElementById('poCompanyVkn')?.value || '').trim(),
    company_name: String(document.getElementById('poCompanyName')?.value || '').trim(),
    items: Array.from(document.querySelectorAll('#poLinesBody tr')).map((row) => ({
      product_code: String(row.querySelector('.po-line-code')?.value || '').trim(),
      ordered_qty: Number(row.querySelector('.po-line-qty')?.value || 0),
      unit_price_cur: (() => {
        const raw = String(row.querySelector('.po-line-unit-price')?.value || '').trim();
        return raw === '' ? null : Number(raw);
      })(),
      currency: String(row.querySelector('.po-line-currency')?.value || '').trim() || null,
      line_total_cur: (() => {
        const raw = String(row.querySelector('.po-line-total')?.value || '').trim();
        if (raw !== '') return Number(raw);
        const qty = Number(row.querySelector('.po-line-qty')?.value || 0);
        const unitPrice = Number(row.querySelector('.po-line-unit-price')?.value || 0);
        return unitPrice > 0 ? Number((qty * unitPrice).toFixed(2)) : null;
      })()
    })).filter(x => x.product_code && x.ordered_qty > 0)
  };

  if (!payload.company_vkn || payload.items.length === 0) {
    if (msgEl) msgEl.textContent = 'VKN ve en az bir ürün satırı zorunlu.';
    return;
  }

  if (msgEl) msgEl.textContent = 'Kaydediliyor...';
  try {
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const raw = await res.text();
      const isHtml = raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html');
      throw new Error(isHtml
        ? 'API yerine HTML döndü. Sunucuyu yeniden başlatın ve /api/purchase-orders route’unun yüklendiğini kontrol edin.'
        : 'Sunucudan beklenmeyen cevap alındı.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Kayıt hatası');

    if (msgEl) msgEl.textContent = `Kaydedildi: ${data?.po_number || 'PO oluşturuldu'}`;
    form?.reset();
    const linesBody = document.getElementById('poLinesBody');
    if (linesBody) linesBody.innerHTML = '';
    addPendingPoLine();
    sessionStorage.removeItem(PO_CACHE_KEY);
    sessionStorage.removeItem(STOCK_CACHE_KEY);
    await Promise.all([loadPendingOrders(), loadStockSummary()]);
  } catch (err) {
    if (msgEl) msgEl.textContent = `Hata: ${err.message}`;
  }
}

async function savePendingOrderItem(poItemId, btnEl) {
  const input = document.querySelector(`.po-ordered-input[data-po-id="${poItemId}"]`);
  const unitInput = document.querySelector(`.po-unit-input[data-po-id="${poItemId}"]`);
  const curInput = document.querySelector(`.po-cur-input[data-po-id="${poItemId}"]`);
  const totalInput = document.querySelector(`.po-total-input[data-po-id="${poItemId}"]`);
  if (!input) return;
  const orderedQty = Number(input.value || 0);
  const original = Number(input.dataset.original || 0);
  const unitRaw = String(unitInput?.value || '').trim();
  const totalRaw = String(totalInput?.value || '').trim();
  const curRaw = String(curInput?.value || '').trim();
  const unitPrice = unitRaw === '' ? null : Number(unitRaw);
  const lineTotal = totalRaw === '' ? null : Number(totalRaw);
  const currency = curRaw || null;
  if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
    alert('Sipariş miktarı pozitif sayı olmalı.');
    return;
  }
  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
    alert('Birim fiyat negatif olamaz.');
    return;
  }
  if (lineTotal !== null && (!Number.isFinite(lineTotal) || lineTotal < 0)) {
    alert('Toplam tutar negatif olamaz.');
    return;
  }
  const sameQty = orderedQty === original;
  const sameUnit = String(unitInput?.dataset.original || '') === unitRaw;
  const sameCur = String(curInput?.dataset.original || '') === curRaw;
  const sameTotal = String(totalInput?.dataset.original || '') === totalRaw;
  if (sameQty && sameUnit && sameCur && sameTotal) return;

  btnEl.disabled = true;
  try {
    const res = await fetch(`/api/purchase-order-items/${encodeURIComponent(poItemId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ordered_qty: orderedQty,
        unit_price_cur: unitPrice,
        currency,
        line_total_cur: lineTotal
      })
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const raw = await res.text();
      const isHtml = raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html');
      throw new Error(isHtml
        ? 'API yerine HTML döndü. Sunucuyu yeniden başlatın ve /api/purchase-order-items/:id route’unun yüklendiğini kontrol edin.'
        : 'Sunucudan beklenmeyen cevap alındı.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Güncelleme başarısız');
    input.dataset.original = String(orderedQty);
    if (unitInput) unitInput.dataset.original = unitRaw;
    if (curInput) curInput.dataset.original = curRaw;
    if (totalInput) totalInput.dataset.original = totalRaw;
    sessionStorage.removeItem(PO_CACHE_KEY);
    sessionStorage.removeItem(STOCK_CACHE_KEY);
    await Promise.all([loadPendingOrders(), loadStockSummary()]);
  } catch (err) {
    alert(`Güncelleme hatası: ${err.message}`);
  } finally {
    btnEl.disabled = false;
  }
}

async function deletePendingOrderItem(poItemId, btnEl) {
  if (!confirm('Bu bekleyen sipariş kalemini silmek istiyor musunuz?')) return;
  btnEl.disabled = true;
  try {
    const res = await fetch(`/api/purchase-order-items/${encodeURIComponent(poItemId)}`, {
      method: 'DELETE'
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const raw = await res.text();
      const isHtml = raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html');
      throw new Error(isHtml
        ? 'API yerine HTML döndü. Sunucuyu yeniden başlatın ve /api/purchase-order-items/:id route’unun yüklendiğini kontrol edin.'
        : 'Sunucudan beklenmeyen cevap alındı.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Silme başarısız');
    sessionStorage.removeItem(PO_CACHE_KEY);
    sessionStorage.removeItem(STOCK_CACHE_KEY);
    await Promise.all([loadPendingOrders(), loadStockSummary()]);
  } catch (err) {
    alert(`Silme hatası: ${err.message}`);
  } finally {
    btnEl.disabled = false;
  }
}


// ─── ÜRÜN DETAY MODALİ ───────────────────────────────────────────────────────
let _editingProductId = null;
let _productModalTab = 'info';

function switchProductModalTab(tab) {
  _productModalTab = tab === 'movements' ? 'movements' : 'info';
  document.getElementById('productTabInfoBtn')?.classList.toggle('active', _productModalTab === 'info');
  document.getElementById('productTabMovementsBtn')?.classList.toggle('active', _productModalTab === 'movements');
  document.getElementById('productModalTab-info')?.classList.toggle('active', _productModalTab === 'info');
  document.getElementById('productModalTab-movements')?.classList.toggle('active', _productModalTab === 'movements');
}

function renderProductMovementsBySku(skuRaw) {
  const body = document.getElementById('productMovementsTableBody');
  const emptyEl = document.getElementById('productMovementsEmptyState');
  if (!body || !emptyEl) return;

  const sku = String(skuRaw || '').trim().toLowerCase();
  const rows = (allMovements || []).filter((m) => String(m.sku || '').trim().toLowerCase() === sku);

  body.innerHTML = '';
  if (!sku || rows.length === 0) {
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'Bu ürün için hareket bulunamadı.';
    return;
  }

  emptyEl.style.display = 'none';
  rows.forEach((m) => {
    const tr = document.createElement('tr');
    const isIn = String(m.direction || '').toUpperCase() === 'INCOMING';
    const dirText = isIn ? 'Giriş' : 'Çıkış';
    tr.innerHTML = `
      <td class="movement-date-cell">${esc(m.invoice_date || '-')}</td>
      <td><span class="badge-dir ${isIn ? 'badge-in' : 'badge-out'}">${dirText}</span></td>
      <td>${esc(m.invoice_no || '-')}</td>
      <td title="${esc(m.company_name || '-')}">${esc(m.company_name || '-')}</td>
      <td class="text-right">${fmtQty(m.quantity || 0)}</td>
      <td class="text-right">${Number(m.unit_price_cur || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td>${esc(m.currency || '-')}</td>
    `;
    body.appendChild(tr);
  });
}

async function openProductModal(productId) {
  if (!productId) return;
  _editingProductId = productId;
  switchProductModalTab('movements');

  const msgEl = document.getElementById('productModalMsg');
  const saveBtn = document.getElementById('productModalSaveBtn');
  msgEl.textContent = 'Yükleniyor...';
  msgEl.className = 'modal-msg';
  saveBtn.disabled = true;

  document.getElementById('productEditModal').style.display = 'flex';

  try {
    await ensureProductCategoryOptions();
    const res = await fetch(`/api/products/${productId}`);
    if (!res.ok) throw new Error('Ürün verisi alınamadı.');
    const product = await res.json();

    document.getElementById('productModalTitle').textContent = product.product_name || 'Ürün Detayı';
    const subtitle = document.getElementById('productModalSubTitle');
    if (subtitle) subtitle.textContent = `Kod: ${product.product_code || '—'}`;
    fillProductModal(product);
    renderProductMovementsBySku(product.product_code);
    msgEl.textContent = '';
    saveBtn.disabled = false;
  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className = 'modal-msg error';
  }
}

function fillProductModal(p) {
  const fields = [
    'product_name', 'product_code', 'brand', 'category', 'model',
    'maliyet_usd', 'sozlesme_fiyat_eur',
    'last_purchase_price_cur', 'last_purchase_currency',
    'last_purchase_rate', 'last_purchase_price_tl', 'avg_purchase_price_tl',
    'dmo_code', 'dmo_fiyat_try', 'dmo_url', 'gift_quantity',
    'stock_on_hand', 'reserved_quantity', 'ordered_quantity', 'shipped_total',
  ];
  fields.forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (el) el.value = p[key] ?? '';
  });
  renderProductCategorySelect(p.category || '');

  // Timestamps — format nicely
  ['created_at', 'updated_at', 'dmo_fiyat_updated'].forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (!el) return;
    el.value = p[key] ? new Date(p[key]).toLocaleString('tr-TR') : '—';
  });
}

function closeProductModal() {
  document.getElementById('productEditModal').style.display = 'none';
  _editingProductId = null;
  switchProductModalTab('movements');
  const msgEl = document.getElementById('productModalMsg');
  msgEl.textContent = '';
  msgEl.className = 'modal-msg';
}

async function saveProductModal() {
  if (!_editingProductId) return;

  const msgEl  = document.getElementById('productModalMsg');
  const saveBtn = document.getElementById('productModalSaveBtn');
  msgEl.textContent  = 'Kaydediliyor...';
  msgEl.className    = 'modal-msg';
  saveBtn.disabled   = true;

  const fields = [
    'product_name', 'product_code', 'brand', 'category', 'model',
    'maliyet_usd', 'sozlesme_fiyat_eur',
    'last_purchase_price_cur', 'last_purchase_currency',
    'last_purchase_rate', 'last_purchase_price_tl', 'avg_purchase_price_tl',
    'dmo_code', 'dmo_fiyat_try', 'dmo_url', 'gift_quantity',
    'stock_on_hand', 'reserved_quantity', 'ordered_quantity', 'shipped_total',
  ];

  const numericFields = new Set([
    'maliyet_usd', 'sozlesme_fiyat_eur',
    'last_purchase_price_cur', 'last_purchase_rate',
    'last_purchase_price_tl', 'avg_purchase_price_tl',
    'dmo_fiyat_try', 'gift_quantity',
    'stock_on_hand', 'reserved_quantity', 'ordered_quantity', 'shipped_total',
  ]);

  const payload = {};
  fields.forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (!el) return;
    const raw = el.value.trim();
    if (numericFields.has(key)) {
      payload[key] = raw === '' ? null : Number(raw);
    } else {
      payload[key] = raw === '' ? null : raw;
    }
  });

  try {
    const res = await fetch(`/api/products/${_editingProductId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Kayıt hatası');

    msgEl.textContent = 'Kaydedildi ✓';
    msgEl.className   = 'modal-msg success';
    const subtitle = document.getElementById('productModalSubTitle');
    if (subtitle) subtitle.textContent = `Kod: ${payload.product_code || document.getElementById('pf-product_code')?.value || '—'}`;
    renderProductMovementsBySku(payload.product_code || document.getElementById('pf-product_code')?.value);

    // Update the matching row in allStocks in memory — no full reload
    updateStockRowInMemory(_editingProductId, payload);

    setTimeout(() => {
      closeProductModal();
    }, 800);

  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className   = 'modal-msg error';
  } finally {
    saveBtn.disabled = false;
  }
}

function updateStockRowInMemory(productId, payload) {
  const idx = allStocks.findIndex(r => r.product_id === productId);
  if (idx === -1) return;

  // Update only the fields that exist in allStocks
  if (payload.product_name     !== undefined) allStocks[idx].product_name     = payload.product_name;
  if (payload.category         !== undefined) allStocks[idx].category         = payload.category || '';
  if (payload.reserved_quantity !== undefined) allStocks[idx].reserved_quantity = Number(payload.reserved_quantity || 0);
  if (payload.gift_quantity    !== undefined) allStocks[idx].gift_quantity     = Number(payload.gift_quantity    || 0);
  renderStockCategoryFilter();
  renderDepoTable();
}