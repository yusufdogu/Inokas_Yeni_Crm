// ── STATE ─────────────────────────────────────────────────────────────────────
let _categories    = [];
let _activeCatId   = null;
let _editingCatId  = null;
let _editingAttrId = null;

let _internalCats      = [];
let _activeIntCat      = null;
let _editingIntCatName = null;

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { loadCategories(); loadInternalCats(); });

async function loadCategories() {
    try {
        const res = await fetch('/api/products/category-templates');
        if (!res.ok) throw new Error(await res.text());
        _categories = await res.json();
        renderCatList();
        if (_activeCatId) {
            const still = _categories.find(c => c.id === _activeCatId);
            if (still) renderDetail(still); else clearDetail();
        }
    } catch (err) {
        showToast('Kategoriler yüklenemedi: ' + err.message, 'error');
    }
}

// ── KATEGORİ LİSTESİ ─────────────────────────────────────────────────────────
function renderCatList() {
    const list  = document.getElementById('ky-cat-list');
    const badge = document.getElementById('ky-cat-count');
    if (badge) badge.textContent = _categories.length;

    if (!_categories.length) {
        list.innerHTML = '<div class="ky-empty">Henüz kategori yok.</div>';
        return;
    }

    list.innerHTML = _categories.map(c => {
        const attrCount = (c.attributes || []).length;
        const active = c.id === _activeCatId ? ' active' : '';
        return `
<div class="ky-cat-item${active}" onclick="selectCategory('${c.id}')">
  <span class="ky-cat-item-name">${esc(c.name)}</span>
  <span class="ky-cat-attr-count">${attrCount} özellik</span>
  <button class="ky-cat-rename-btn" onclick="event.stopPropagation(); openRenameCategoryModal('${c.id}')" title="Yeniden adlandır">
    <i class="ti ti-pencil"></i>
  </button>
</div>`;
    }).join('');
}

function selectCategory(id) {
    _activeCatId  = id;
    _activeIntCat = null;
    renderCatList();
    renderInternalCatList();
    const cat = _categories.find(c => c.id === id);
    if (cat) renderDetail(cat);
}

// ── DETAY PANELİ ─────────────────────────────────────────────────────────────
function renderDetail(cat) {
    const panel = document.getElementById('ky-detail');
    const attrs = cat.attributes || [];

    const attrsHtml = attrs.length
        ? attrs.map(a => attrRowHtml(a)).join('')
        : `<div class="ky-attr-empty">
             <i class="ti ti-playlist-x" style="font-size:28px;"></i>
             <p>Bu kategoriye henüz özellik eklenmemiş.</p>
           </div>`;

    panel.innerHTML = `
<div class="ky-detail-header">
  <span class="ky-detail-title">${esc(cat.name)}</span>
  <button class="btn-primary" onclick="openAddAttrModal()" style="display:flex; align-items:center; gap:6px; font-size:13px;">
    <i class="ti ti-plus"></i> Özellik Ekle
  </button>
</div>
<div class="ky-detail-body">${attrsHtml}</div>`;
}

function clearDetail() {
    document.getElementById('ky-detail').innerHTML = `
<div class="ky-detail-empty">
  <i class="ti ti-category" style="font-size:32px; color:#94a3b8;"></i>
  <p>Düzenlemek için sol taraftan bir kategori seçin.</p>
</div>`;
}

function attrRowHtml(a) {
    const typeLabel = { text: 'Metin', number: 'Sayı', select: 'Seçim' }[a.attr_type] || a.attr_type;
    const typeCls   = { text: 'ky-type-text', number: 'ky-type-number', select: 'ky-type-select' }[a.attr_type] || '';
    const optText   = a.attr_type === 'select' && a.attr_values?.length
        ? 'Seçenekler: ' + a.attr_values.join(', ')
        : '';

    return `
<div class="ky-attr-row">
  <i class="ti ti-grip-vertical ky-attr-drag"></i>
  <div class="ky-attr-info">
    <div class="ky-attr-name">${esc(a.attr_name)}</div>
    ${optText ? `<div class="ky-attr-meta">${esc(optText)}</div>` : ''}
  </div>
  <span class="ky-attr-type-badge ${typeCls}">${typeLabel}</span>
  <div class="ky-attr-actions">
    <button class="ky-attr-btn" onclick="openEditAttrModal('${a.id}')" title="Düzenle"><i class="ti ti-pencil"></i></button>
    <button class="ky-attr-btn del" onclick="deleteAttr('${a.id}')" title="Sil"><i class="ti ti-trash"></i></button>
  </div>
</div>`;
}

// ── KATEGORİ MODAL (ekle / yeniden adlandır) ──────────────────────────────────
function openAddCategoryModal() {
    _editingCatId = null;
    document.getElementById('ky-cat-modal-title').textContent = 'Yeni Kategori';
    document.getElementById('ky-cat-name-input').value = '';
    document.getElementById('ky-cat-modal-msg').textContent = '';
    document.getElementById('ky-cat-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('ky-cat-name-input').focus(), 50);
}

function openRenameCategoryModal(id) {
    const cat = _categories.find(c => c.id === id);
    if (!cat) return;
    _editingCatId = id;
    document.getElementById('ky-cat-modal-title').textContent = 'Kategoriyi Yeniden Adlandır';
    document.getElementById('ky-cat-name-input').value = cat.name;
    document.getElementById('ky-cat-modal-msg').textContent = '';
    document.getElementById('ky-cat-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('ky-cat-name-input').focus(), 50);
}

function closeAddCategoryModal() {
    document.getElementById('ky-cat-modal').style.display = 'none';
}

async function saveCategoryModal() {
    const name = document.getElementById('ky-cat-name-input').value.trim();
    const msg  = document.getElementById('ky-cat-modal-msg');
    if (!name) { msg.textContent = 'Kategori adı boş olamaz.'; return; }

    try {
        let res;
        if (_editingCatId) {
            res = await fetch(`/api/products/category-templates/${_editingCatId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
        } else {
            res = await fetch('/api/products/category-templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
        }
        if (!res.ok) throw new Error(await res.text());
        closeAddCategoryModal();
        await loadCategories();
        showToast(_editingCatId ? 'Kategori adı güncellendi.' : 'Kategori oluşturuldu.', 'success');
    } catch (err) {
        msg.textContent = err.message;
    }
}

// ── ÖZELLİK MODAL (ekle / düzenle) ───────────────────────────────────────────
function openAddAttrModal() {
    _editingAttrId = null;
    document.getElementById('ky-attr-modal-title').textContent = 'Özellik Ekle';
    document.getElementById('ky-attr-name').value = '';
    document.getElementById('ky-attr-type').value = 'text';
    document.getElementById('ky-attr-order').value = '0';
    document.getElementById('ky-attr-options').value = '';
    document.getElementById('ky-attr-modal-msg').textContent = '';
    document.getElementById('ky-attr-options-wrap').style.display = 'none';
    document.getElementById('ky-attr-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('ky-attr-name').focus(), 50);
}

function openEditAttrModal(attrId) {
    const cat  = _categories.find(c => c.id === _activeCatId);
    const attr = cat?.attributes.find(a => a.id === attrId);
    if (!attr) return;

    _editingAttrId = attrId;
    document.getElementById('ky-attr-modal-title').textContent = 'Özelliği Düzenle';
    document.getElementById('ky-attr-name').value    = attr.attr_name;
    document.getElementById('ky-attr-type').value    = attr.attr_type;
    document.getElementById('ky-attr-order').value   = attr.sort_order ?? 0;
    document.getElementById('ky-attr-options').value = Array.isArray(attr.attr_values) ? attr.attr_values.join(', ') : '';
    document.getElementById('ky-attr-modal-msg').textContent = '';
    document.getElementById('ky-attr-options-wrap').style.display = attr.attr_type === 'select' ? 'block' : 'none';
    document.getElementById('ky-attr-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('ky-attr-name').focus(), 50);
}

function closeAttrModal() {
    document.getElementById('ky-attr-modal').style.display = 'none';
}

function onAttrTypeChange() {
    const type = document.getElementById('ky-attr-type').value;
    document.getElementById('ky-attr-options-wrap').style.display = type === 'select' ? 'block' : 'none';
}

async function saveAttrModal() {
    const name  = document.getElementById('ky-attr-name').value.trim();
    const type  = document.getElementById('ky-attr-type').value;
    const order = parseInt(document.getElementById('ky-attr-order').value) || 0;
    const optRaw = document.getElementById('ky-attr-options').value;
    const attr_values = type === 'select'
        ? optRaw.split(',').map(s => s.trim()).filter(Boolean)
        : null;
    const msg = document.getElementById('ky-attr-modal-msg');

    if (!name) { msg.textContent = 'Özellik adı boş olamaz.'; return; }

    try {
        let res;
        if (_editingAttrId) {
            res = await fetch(`/api/products/category-attributes/${_editingAttrId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ attr_name: name, attr_type: type, attr_values, sort_order: order })
            });
        } else {
            res = await fetch(`/api/products/category-templates/${_activeCatId}/attributes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ attr_name: name, attr_type: type, attr_values, sort_order: order })
            });
        }
        if (!res.ok) throw new Error(await res.text());
        closeAttrModal();
        await loadCategories();
        const cat = _categories.find(c => c.id === _activeCatId);
        if (cat) renderDetail(cat);
        showToast(_editingAttrId ? 'Özellik güncellendi.' : 'Özellik eklendi.', 'success');
    } catch (err) {
        msg.textContent = err.message;
    }
}

async function deleteAttr(attrId) {
    if (!confirm('Bu özellik silinecek. Emin misiniz?')) return;
    try {
        const res = await fetch(`/api/products/category-attributes/${attrId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        await loadCategories();
        const cat = _categories.find(c => c.id === _activeCatId);
        if (cat) renderDetail(cat);
        showToast('Özellik silindi.', 'success');
    } catch (err) {
        showToast('Silinemedi: ' + err.message, 'error');
    }
}

// ── OFİS İÇİ KATEGORİLER ─────────────────────────────────────────────────────
async function loadInternalCats() {
    try {
        const res = await fetch('/api/invoices/internal-categories');
        if (!res.ok) throw new Error(await res.text());
        _internalCats = await res.json();
        renderInternalCatList();
    } catch (err) {
        showToast('Ofis içi kategoriler yüklenemedi: ' + err.message, 'error');
    }
}

function renderInternalCatList() {
    const list  = document.getElementById('ky-int-list');
    const badge = document.getElementById('ky-int-count');
    if (badge) badge.textContent = _internalCats.length;
    if (!_internalCats.length) {
        list.innerHTML = '<div class="ky-empty">Kategori yok.</div>';
        return;
    }
    list.innerHTML = _internalCats.map(c => {
        const active = c.name === _activeIntCat ? ' active' : '';
        return `
<div class="ky-cat-item${active}" onclick="selectInternalCat('${esc(c.name)}')">
  <span class="ky-cat-item-name">${esc(c.name)}</span>
  <span class="ky-cat-attr-count">${c.count} fatura</span>
  <button class="ky-cat-rename-btn" style="color:#ef4444;" onclick="event.stopPropagation(); deleteInternalCat('${esc(c.name)}')" title="Sil">
    <i class="ti ti-trash"></i>
  </button>
</div>`;
    }).join('');
}

function selectInternalCat(name) {
    _activeIntCat = name;
    _activeCatId  = null;
    renderInternalCatList();
    renderCatList();
    const cat = _internalCats.find(c => c.name === name);
    const panel = document.getElementById('ky-detail');
    panel.innerHTML = `
<div class="ky-detail-header">
  <span class="ky-detail-title">${esc(name)}</span>
  <button class="btn-danger" onclick="deleteInternalCat('${esc(name)}')" style="font-size:13px; display:flex; align-items:center; gap:6px;">
    <i class="ti ti-trash"></i> Sil
  </button>
</div>
<div class="ky-detail-body" style="padding:20px;">
  <div style="max-width:360px;">
    <label style="font-size:12px; font-weight:600; color:#64748b; display:block; margin-bottom:6px;">Yeni Kategori Adı</label>
    <input type="text" id="int-rename-input" value="${esc(name)}" style="width:100%; border:1px solid #e2e8f0; border-radius:8px; padding:8px 12px; font-size:13px; font-family:inherit; outline:none;">
    <button class="btn-primary" onclick="saveRenameIntCat('${esc(name)}')" style="margin-top:12px; font-size:13px; display:flex; align-items:center; gap:6px;">
      <i class="ti ti-check"></i> Kaydet
    </button>
    <p style="margin-top:12px; font-size:11px; color:#94a3b8;">${cat?.count || 0} fatura bu kategoride. Yeniden adlandırılınca tüm faturalar güncellenir.</p>
  </div>
</div>`;
}

function openRenameIntModal(name) {
    selectInternalCat(name);
    setTimeout(() => document.getElementById('int-rename-input')?.focus(), 50);
}

async function saveRenameIntCat(oldName) {
    const newName = document.getElementById('int-rename-input')?.value.trim();
    if (!newName) { showToast('Kategori adı boş olamaz.', 'error'); return; }
    if (newName === oldName) return;
    try {
        const res = await fetch('/api/invoices/internal-categories/rename', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: oldName, to: newName })
        });
        if (!res.ok) throw new Error(await res.text());
        _activeIntCat = newName;
        await loadInternalCats();
        selectInternalCat(newName);
        showToast('Kategori yeniden adlandırıldı.', 'success');
    } catch (err) {
        showToast('Hata: ' + err.message, 'error');
    }
}

async function deleteInternalCat(name) {
    if (!confirm(`"${name}" kategorisi silinecek. Bu kategorideki faturalar kategorisiz kalacak. Emin misiniz?`)) return;
    try {
        const res = await fetch(`/api/invoices/internal-categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        _activeIntCat = null;
        document.getElementById('ky-detail').innerHTML = `
<div class="ky-detail-empty">
  <i class="ti ti-category" style="font-size:32px; color:#94a3b8;"></i>
  <p>Düzenlemek için sol taraftan bir kategori seçin.</p>
</div>`;
        await loadInternalCats();
        showToast('Kategori silindi.', 'success');
    } catch (err) {
        showToast('Silinemedi: ' + err.message, 'error');
    }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}
