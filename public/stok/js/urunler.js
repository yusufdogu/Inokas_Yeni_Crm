// stok/urunler.js — Ürünler page (info/edit only, no movements tab)

const _BRAND_OPTIONS = ['ASUS','EPSON','EPSON-YP','EVERTON','HP','KYOCERA','LG','OKI','SAMSUNG'];
let _extraBrandOptions     = [];
let productCategoryOptions = [];

let allProducts = [];
let _editingId  = null;
let _isAddMode  = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('urunSearch')?.addEventListener('input', renderTable);
  document.getElementById('filterCategory')?.addEventListener('change', renderTable);
  document.getElementById('filterBrand')?.addEventListener('change', renderTable);
  await Promise.all([loadProducts(), loadCategoryOptions()]);
});

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error();
    allProducts = await res.json();
    renderKpis();
    renderFilterOptions();
    renderTable();
  } catch {
    document.getElementById('urunler-count').textContent = 'Veri alınamadı.';
  }
}

async function loadCategoryOptions() {
  try {
    const res = await fetch('/api/products/category-map');
    if (!res.ok) return;
    const data = await res.json();
    productCategoryOptions = Array.isArray(data?.categories)
      ? data.categories.map(x => String(x || '').trim()).filter(Boolean)
      : [];
  } catch {}
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────
function renderKpis() {
  const categories = new Set(allProducts.map(p => String(p.category || '').trim()).filter(Boolean));
  const brands     = new Set(allProducts.map(p => String(p.brand || '').trim()).filter(Boolean));
  document.getElementById('kpi-total').textContent      = fmtQty(allProducts.length);
  document.getElementById('kpi-categories').textContent = String(categories.size);
  document.getElementById('kpi-brands').textContent     = String(brands.size);
  document.getElementById('urunler-count').textContent  = `${fmtQty(allProducts.length)} ürün`;
}

// ─── FILTER OPTIONS ───────────────────────────────────────────────────────────
function renderFilterOptions() {
  const catSel   = document.getElementById('filterCategory');
  const brandSel = document.getElementById('filterBrand');
  if (!catSel || !brandSel) return;

  const cats   = [...new Set(allProducts.map(p => String(p.category || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr'));
  const brands = [...new Set(allProducts.map(p => String(p.brand || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr'));

  catSel.innerHTML   = '<option value="">Tüm Kategoriler</option>' + cats.map(c   => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  brandSel.innerHTML = '<option value="">Tüm Markalar</option>'    + brands.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
}

function clearFilters() {
  document.getElementById('urunSearch').value     = '';
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterBrand').value    = '';
  renderTable();
}

// ─── TABLE ────────────────────────────────────────────────────────────────────
function renderTable() {
  const body    = document.getElementById('urunlerTableBody');
  const emptyEl = document.getElementById('urunlerEmpty');
  const search   = (document.getElementById('urunSearch')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const category = (document.getElementById('filterCategory')?.value || '').trim();
  const brand    = (document.getElementById('filterBrand')?.value || '').trim();
  if (!body) return;

  const filtered = allProducts.filter(p => {
    if (category && String(p.category || '').trim() !== category) return false;
    if (brand    && String(p.brand    || '').trim() !== brand)    return false;
    if (search) {
      const nameMatch  = String(p.product_name || '').toLocaleLowerCase('tr-TR').includes(search);
      const codeMatch  = String(p.product_code || '').toLocaleLowerCase('tr-TR').includes(search);
      const brandMatch = String(p.brand        || '').toLocaleLowerCase('tr-TR').includes(search);
      if (!nameMatch && !codeMatch && !brandMatch) return false;
    }
    return true;
  });

  body.innerHTML = '';

  if (!filtered.length) {
    emptyEl.classList.add('visible');
    return;
  }
  emptyEl.classList.remove('visible');

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.onclick = () => openEditModal(p.id);
    tr.innerHTML = `
      <td style="font-weight:600;">${esc(p.product_name || '—')}</td>
      <td><span class="badge-sku">${esc(p.product_code || '—')}</span></td>
      <td>${p.brand    ? `<span class="pill-brand">${esc(p.brand)}</span>`       : '—'}</td>
      <td>${p.category ? `<span class="pill-category">${esc(p.category)}</span>` : '—'}</td>
      <td style="color:#64748b; font-size:12px;">${esc(p.model || '—')}</td>
      <td class="text-right price-cell">${p.maliyet_usd != null ? fmtUsd(p.maliyet_usd) : '—'}</td>
      <td class="text-right price-cell">${p.sozlesme_fiyat_eur != null ? `€${Number(p.sozlesme_fiyat_eur).toLocaleString('tr-TR',{minimumFractionDigits:2})}` : '—'}</td>
      <td class="text-right price-cell">${p.last_purchase_price_cur != null ? Number(p.last_purchase_price_cur).toLocaleString('tr-TR',{minimumFractionDigits:2}) : '—'}</td>
      <td>${esc(p.last_purchase_currency || '—')}</td>
    `;
    body.appendChild(tr);
  });
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
const _NUMERIC_FIELDS = new Set([
  'maliyet_usd','sozlesme_fiyat_eur','last_purchase_price_cur','last_purchase_rate',
  'last_purchase_price_tl','avg_purchase_price_tl','dmo_fiyat_try','gift_quantity',
]);
const _READONLY_FIELDS = new Set(['created_at','updated_at','dmo_fiyat_updated']);
const _ALL_FIELDS = [
  'product_name','product_code','brand','category','model',
  'maliyet_usd','sozlesme_fiyat_eur',
  'last_purchase_price_cur','last_purchase_currency','last_purchase_rate',
  'last_purchase_price_tl','avg_purchase_price_tl',
  'dmo_code','dmo_fiyat_try','dmo_url','gift_quantity',
  'created_at','updated_at','dmo_fiyat_updated',
];

function _buildBrandSelect(selected = '') {
  const sel = document.getElementById('pf-brand');
  if (!sel) return;
  const opts = [..._BRAND_OPTIONS, ..._extraBrandOptions];
  sel.innerHTML = [
    '<option value="">Seçin...</option>',
    ...opts.map(b => `<option value="${esc(b)}"${b===selected?' selected':''}>${esc(b)}</option>`),
  ].join('');
}

function _buildCategorySelect(selected = '') {
  const sel = document.getElementById('pf-category');
  if (!sel) return;
  const opts = productCategoryOptions;
  sel.innerHTML = [
    '<option value="">Seçin...</option>',
    ...opts.map(c => `<option value="${esc(c)}"${c===selected?' selected':''}>${esc(c)}</option>`),
    ...(selected && !opts.includes(selected)
      ? [`<option value="${esc(selected)}" selected>${esc(selected)}</option>`]
      : [])
  ].join('');
}

function openAddModal() {
  _editingId = null;
  _isAddMode = true;
  _ALL_FIELDS.forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (el) el.value = '';
  });
  _buildBrandSelect();
  _buildCategorySelect();
  document.getElementById('modalTitle').textContent    = 'Yeni Ürün Ekle';
  document.getElementById('modalSubTitle').textContent = '';
  document.getElementById('modalMsg').textContent      = '';
  document.getElementById('modalMsg').className        = 'modal-msg';
  document.getElementById('modalSaveBtn').disabled     = false;
  document.getElementById('productModal').style.display = 'flex';
}

async function openEditModal(productId) {
  if (!productId) return;
  _editingId = productId;
  _isAddMode = false;

  const msgEl   = document.getElementById('modalMsg');
  const saveBtn = document.getElementById('modalSaveBtn');
  msgEl.textContent = 'Yükleniyor...';
  msgEl.className   = 'modal-msg';
  saveBtn.disabled  = true;
  document.getElementById('productModal').style.display = 'flex';

  try {
    if (!productCategoryOptions.length) await loadCategoryOptions();
    const res = await fetch(`/api/products/${productId}`);
    if (!res.ok) throw new Error('Ürün verisi alınamadı.');
    const product = await res.json();

    document.getElementById('modalTitle').textContent    = product.product_name || 'Ürün Detayı';
    document.getElementById('modalSubTitle').textContent = `Kod: ${product.product_code || '—'}`;

    _ALL_FIELDS.forEach(key => {
      const el = document.getElementById(`pf-${key}`);
      if (!el) return;
      if (_READONLY_FIELDS.has(key)) {
        el.value = product[key] ? new Date(product[key]).toLocaleString('tr-TR') : '—';
      } else {
        el.value = product[key] ?? '';
      }
    });
    _buildBrandSelect(product.brand || '');
    _buildCategorySelect(product.category || '');

    msgEl.textContent = '';
    saveBtn.disabled  = false;
  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className   = 'modal-msg error';
  }
}

function closeModal() {
  document.getElementById('productModal').style.display = 'none';
  _editingId = null;
  _isAddMode = false;
  document.getElementById('modalMsg').textContent = '';
}

// ─── SAVE ─────────────────────────────────────────────────────────────────────
async function saveProduct() {
  const msgEl   = document.getElementById('modalMsg');
  const saveBtn = document.getElementById('modalSaveBtn');
  msgEl.textContent = 'Kaydediliyor...';
  msgEl.className   = 'modal-msg';
  saveBtn.disabled  = true;

  const payload = {};
  _ALL_FIELDS.filter(k => !_READONLY_FIELDS.has(k)).forEach(key => {
    const el = document.getElementById(`pf-${key}`);
    if (!el) return;
    const raw = el.value.trim();
    payload[key] = _NUMERIC_FIELDS.has(key)
      ? (raw === '' ? null : Number(raw))
      : (raw === '' ? null : raw);
  });

  const name = String(document.getElementById('pf-product_name')?.value || '').trim();
  const code = String(document.getElementById('pf-product_code')?.value || '').trim();
  if (!name) { msgEl.textContent = 'Ürün adı zorunludur.'; msgEl.className = 'modal-msg error'; saveBtn.disabled = false; return; }
  if (!code) { msgEl.textContent = 'Ürün kodu zorunludur.'; msgEl.className = 'modal-msg error'; saveBtn.disabled = false; return; }

  try {
    const res = await fetch(
      _isAddMode ? '/api/products' : `/api/products/${_editingId}`,
      {
        method:  _isAddMode ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Kayıt hatası');

    msgEl.textContent = _isAddMode ? `✓ "${name}" eklendi.` : 'Kaydedildi ✓';
    msgEl.className   = 'modal-msg success';
    document.getElementById('modalSubTitle').textContent = `Kod: ${code}`;

    await loadProducts();
    setTimeout(() => closeModal(), 800);
  } catch (err) {
    msgEl.textContent = `Hata: ${err.message}`;
    msgEl.className   = 'modal-msg error';
  } finally {
    saveBtn.disabled = false;
  }
}