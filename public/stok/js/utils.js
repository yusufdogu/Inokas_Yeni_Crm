// stok/utils.js — pure helpers, no DOM, no fetch

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtQty(v)       { return Number(v || 0).toLocaleString('tr-TR'); }
function fmtUsd(v)       { return `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtUsdOrDash(v) { if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'; return fmtUsd(v); }
function fmtPrice(v, currency) {
  const n = Number(v || 0);
  if (!currency) return n.toLocaleString('tr-TR', { minimumFractionDigits: 2 });
  const symbols = { TRY: '₺', USD: '$', EUR: '€' };
  const sym = symbols[currency] || currency;
  return `${sym}${n.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`;
}
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Session cache ────────────────────────────────────────────────────────────
function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify(data)); } catch {}
}

function clearCache(...keys) {
  keys.forEach(k => { try { sessionStorage.removeItem(k); } catch {} });
}

// ─── Category helpers ─────────────────────────────────────────────────────────
function isSarfCategory(category) {
  return String(category || '').toLocaleLowerCase('tr-TR').includes('sarf');
}

// ─── Movement helpers ─────────────────────────────────────────────────────────
function getSoldQtyLastDaysBySku(allMovements, sku, days) {
  if (!sku) return 0;
  const nowTs = Date.now();
  const maxAge = Number(days || 30) * 24 * 60 * 60 * 1000;
  return allMovements.reduce((sum, mv) => {
    if (String(mv.sku || '') !== sku) return sum;
    if (String(mv.direction || '') !== 'OUTGOING') return sum;
    const ts = mv.invoice_date ? new Date(mv.invoice_date).getTime() : NaN;
    if (!Number.isFinite(ts) || (nowTs - ts) > maxAge) return sum;
    return sum + (Number(mv.quantity || 0) || 0);
  }, 0);
}

function _normalizeForSearch(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[ıİI]/g, 'i')
        .replace(/[şŞ]/g, 's')
        .replace(/[çÇ]/g, 'c')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[üÜ]/g, 'u')
        .replace(/[öÖ]/g, 'o');
}
// ─── Tag-input multi-select helper ───────────────────────────────────────────
// Used by hareketler and urunler for company/product tag filters
function createTagFilter({ wrapId, inputId, dropdownId, placeholder, getOptions, onChange }) {
  const wrap     = document.getElementById(wrapId);
  const input    = document.getElementById(inputId);
  console.log('initFatFilters input el:', document.getElementById('brandTagInput'));
  const dropdown = document.getElementById(dropdownId);
  if (!wrap || !input || !dropdown) return { getSelected: () => [] };

  let selected = [];

  function renderTags() {
    wrap.querySelectorAll('.filter-tag').forEach(el => el.remove());
    selected.forEach(val => {
      const tag = document.createElement('span');
      tag.className = 'filter-tag';
      const display = val.length > 22 ? val.slice(0, 20) + '…' : val;
      tag.innerHTML = `${esc(display)} <span class="filter-tag-remove" data-val="${esc(val)}">×</span>`;
      tag.querySelector('.filter-tag-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        selected = selected.filter(v => v !== val);
        renderTags();
        onChange(selected);
      });
      wrap.insertBefore(tag, input);
    });
  }

  function renderDropdown(query) {
    console.log('renderDropdown called', { query, opts: getOptions(), selected });

    const normalizedQuery = _normalizeForSearch(query);
    const opts = getOptions().filter(o =>
        !selected.includes(o) &&
        (!query || _normalizeForSearch(o).includes(normalizedQuery))
    );

    const list = dropdown.querySelector('.filter-dropdown-list') || (() => {
      const ul = document.createElement('ul');
      ul.className = 'filter-dropdown-list';
      dropdown.appendChild(ul);
      return ul;
    })();
    list.innerHTML = '';
    opts.slice(0, 200).forEach(o => {
      const li = document.createElement('li');
      li.className = 'filter-dropdown-item';
      li.textContent = o;
      li.addEventListener('click', () => {
        if (!selected.includes(o)) { selected.push(o); }
        input.value = '';
        dropdown.classList.remove('open');
        renderTags();
        onChange(selected);
      });
      list.appendChild(li);
    });
    dropdown.classList.toggle('open', opts.length > 0);
  }

  let highlightIdx = -1;

  function getItems() {
    const list = dropdown.querySelector('.filter-dropdown-list');
    return list ? Array.from(list.querySelectorAll('.filter-dropdown-item')) : [];
  }

  function setHighlight(idx) {
    const items = getItems();
    items.forEach((el, i) => el.classList.toggle('highlighted', i === idx));
    highlightIdx = idx;
    if (idx >= 0 && items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  }

  // ✅ FIX 1: always pass '' on focus so full list shows immediately
  input.addEventListener('focus', () => { highlightIdx = -1; renderDropdown(''); });
  input.addEventListener('input', () => { highlightIdx = -1; renderDropdown(input.value); });
  input.addEventListener('keydown', (e) => {
    const items = getItems();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // ✅ FIX 2: pass '' not input.value so reopening also shows full list
      if (!dropdown.classList.contains('open')) { renderDropdown(''); return; }
      setHighlight(Math.min(highlightIdx + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(Math.max(highlightIdx - 1, 0));
    } else if (e.key === 'Enter') {
      if (highlightIdx >= 0 && items[highlightIdx]) {
        e.preventDefault();
        items[highlightIdx].click();
      }
    } else if (e.key === 'Backspace' && !input.value && selected.length) {
      selected.pop();
      renderTags();
      onChange(selected);
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('open');
      highlightIdx = -1;
    }
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) dropdown.classList.remove('open');
  });

  return {
    getSelected: () => [...selected],
    clear: () => { selected = []; renderTags(); },
  };
}