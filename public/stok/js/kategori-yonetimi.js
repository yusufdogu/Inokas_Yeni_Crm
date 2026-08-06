// ═══ KATEGORİ BROWSER — four-column faceted view ═════════════════════════════
const _kbState = { brand: undefined, category: undefined, subcategory: undefined };
let _kbData = { brands: [], categories: [], subcategories: [], products: [] };

const KB_NULL = '__NULL__';   // sentinel for null-valued filter

// Entry point — call when the Kategori tab opens.
async function kbLoad() {
  await kbFetch();
}

async function kbFetch() {
  const qs = new URLSearchParams();
  if (_kbState.brand       !== undefined) qs.set('brand',       _kbState.brand ?? KB_NULL);
  if (_kbState.category    !== undefined) qs.set('category',    _kbState.category ?? KB_NULL);
  if (_kbState.subcategory !== undefined) qs.set('subcategory', _kbState.subcategory ?? KB_NULL);

  try {
    const res = await fetch(`/api/products/facets?${qs.toString()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _kbData = await res.json();
    kbRenderAll();
  } catch (err) {
    console.error('Kategori verileri yüklenemedi:', err);
  }
}

function kbRenderAll() {
  kbRenderColumn('brand',       _kbData.brands);
  kbRenderColumn('category',    _kbData.categories);
  kbRenderColumn('subcategory', _kbData.subcategories);
  kbRenderProducts(_kbData.products);
}

function kbEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// value can be null → rendered as "(boş)" italic, filter uses KB_NULL
function kbRenderColumn(field, items) {
  const listEl = document.getElementById(`kb-list-${field}`);
  const countEl = document.getElementById(`kb-count-${field}`);
  if (!listEl) return;

  countEl.textContent = items.length ? `${items.length}` : '';

  if (!items.length) {
    listEl.innerHTML = `<div class="kb-empty">Sonuç yok</div>`;
    return;
  }

  const selected = _kbState[field];   // undefined = none; null = the null bucket
  listEl.innerHTML = items.map(it => {
    const isNull = it.value === null;
    const selKey = isNull ? null : it.value;
    const isSel  = (field in _kbState) && selected !== undefined && selected === selKey;
    const labelCls = isNull ? 'kb-item-label kb-item-label--null' : 'kb-item-label';
    const label = isNull ? '(boş)' : kbEsc(it.value);
    // data-value carries the real value ('' can't distinguish null, so store a flag)
    return `<div class="kb-item ${isSel ? 'kb-selected' : ''}"
                 data-field="${field}" data-null="${isNull ? '1' : '0'}"
                 data-value="${isNull ? '' : kbEsc(it.value)}"
                 onclick="kbSelect('${field}', this)">
      <span class="${labelCls}">${label}</span>
      <span class="kb-item-count">${it.count}</span>
      <i class="ti ti-pencil kb-item-edit" onclick="event.stopPropagation(); kbStartEdit('${field}', this.closest('.kb-item'))"></i>
    </div>`;
  }).join('');
}

function kbRenderProducts(products) {
  const listEl = document.getElementById('kb-list-products');
  const countEl = document.getElementById('kb-count-products');
  if (!listEl) return;

  countEl.textContent = products.length ? `${products.length}` : '';

  if (!products.length) {
    listEl.innerHTML = `<div class="kb-empty">Ürün yok</div>`;
    return;
  }

  listEl.innerHTML = products.map(p => `
    <div class="kb-prod" onclick="kbOpenProduct('${p.id}', '${kbEsc(p.product_code || '')}')">
      <div class="kb-prod-name">${kbEsc(p.product_name || '—')}</div>
      <div class="kb-prod-meta">
        ${p.product_code ? `<span class="kb-prod-code">${kbEsc(p.product_code)}</span>` : ''}
        ${p.brand ? `<span>${kbEsc(p.brand)}</span>` : ''}
        ${p.stock_on_hand != null ? `<span>· ${p.stock_on_hand} adet</span>` : ''}
      </div>
    </div>`).join('');
}

// ── selection (bidirectional; clicking selected item deselects) ──
function kbSelect(field, el) {
  const isNull = el.dataset.null === '1';
  const value = isNull ? null : el.dataset.value;

  // toggle: if already this selection, clear it
  const current = (field in _kbState) ? _kbState[field] : undefined;
  const same = current !== undefined && current === value;

  if (same) {
    delete _kbState[field];         // clear filter
  } else {
    _kbState[field] = value;        // set (null allowed for the boş bucket)
  }
  kbFetch();
}

// ── client-side search within a column ──
function kbFilterCol(field) {
  const term = (document.getElementById(`kb-search-${field}`)?.value || '').toLocaleLowerCase('tr');
  const listEl = document.getElementById(`kb-list-${field}`);
  if (!listEl) return;

  if (field === 'products') {
    listEl.querySelectorAll('.kb-prod').forEach(el => {
      const txt = el.textContent.toLocaleLowerCase('tr');
      el.style.display = txt.includes(term) ? '' : 'none';
    });
  } else {
    listEl.querySelectorAll('.kb-item').forEach(el => {
      const txt = el.querySelector('.kb-item-label')?.textContent.toLocaleLowerCase('tr') || '';
      el.style.display = txt.includes(term) ? '' : 'none';
    });
  }
}

// ── inline edit + merge warning (vocab columns only) ──
function kbStartEdit(field, itemEl) {
  const isNull = itemEl.dataset.null === '1';
  const oldValue = isNull ? null : itemEl.dataset.value;   // null for the boş bucket

  const labelEl = itemEl.querySelector('.kb-item-label');
  const original = labelEl.textContent;

  const input = document.createElement('input');
  input.className = 'kb-edit-input';
  input.value = isNull ? '' : oldValue;    // empty input for boş (nothing to prefill)
  input.placeholder = isNull ? 'Marka ata...' : '';
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('mousedown', (e) => e.stopPropagation());

  let _done = false;   // guard: finish runs only once

  const finish = async (commit) => {
    if (_done) return;      // already finished — ignore the second call
    _done = true;

    const newValue = input.value.trim();
    const restore = document.createElement('span');
    restore.className = isNull ? 'kb-item-label kb-item-label--null' : 'kb-item-label';
    restore.textContent = original;
    input.replaceWith(restore);

    if (!commit || !newValue) return;
    // for null bucket, oldValue is null; for a real value, skip if unchanged
    if (!isNull && newValue === oldValue) return;

    const listKey = field === 'brand' ? 'brands' : field === 'category' ? 'categories' : 'subcategories';
    const existing = (_kbData[listKey] || []).some(x => x.value !== null && x.value === newValue);

    if (isNull) {
      // assigning a value to previously-empty products
      const ok = confirm(
        `Boş (değeri olmayan) tüm ürünlere "${newValue}" atanacak. Devam edilsin mi?`
      );
      if (!ok) return;
    } else if (existing) {
      const ok = confirm(
        `"${newValue}" zaten mevcut.\n\n"${oldValue}" içindeki tüm ürünler "${newValue}" ile BİRLEŞTİRİLECEK. Devam edilsin mi?`
      );
      if (!ok) return;
    } else {
      const ok = confirm(
        `"${oldValue}" → "${newValue}"\n\nBu değere sahip tüm ürünler güncellenecek. Devam edilsin mi?`
      );
      if (!ok) return;
    }

    // pass null (not '') as `from` when editing the boş bucket
    await kbRelabel(field, isNull ? null : oldValue, newValue);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { finish(false); }
  });
  input.addEventListener('blur', () => finish(false));   // blur cancels
}


async function kbRelabel(field, from, to) {
  try {
    const res = await fetch('/api/products/relabel', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, from, to }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Güncellenemedi'); }

    // if the renamed value was the active filter, update the filter to the new name
    if (_kbState[field] === from) _kbState[field] = to;

    await kbFetch();   // refresh everything
  } catch (err) {
    alert('Hata: ' + err.message);
  }
}

// ── open the product detail panel (reuse existing modal) ──
function kbOpenProduct(productId, code) {
  // NOTE: adjust to your actual product-modal opener on this page.
  if (typeof openUrunModal === 'function') {
    openUrunModal(productId, code);
  } else {
    console.warn('openUrunModal bulunamadı — ürün paneli açılamadı.');
  }
}