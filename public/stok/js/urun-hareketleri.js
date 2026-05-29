// stok/urun-hareketleri.js — Ürün Hareketleri detail page

let _sku              = '';

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function initUrunHareketleri(sku)  {
  _sku = sku || '';
  if (!_sku) return;

  document.getElementById('uhProductSku').textContent = _sku;

  document.getElementById('uhFilterDirection')?.addEventListener('change', applyHareketlerFilters);
  document.getElementById('uhFilterDateStart')?.addEventListener('change', applyHareketlerFilters);
  document.getElementById('uhFilterDateEnd')?.addEventListener('change', applyHareketlerFilters);

  await loadMovements();
};

// ─── DATA ─────────────────────────────────────────────────────────────────────
async function loadMovements() {
  try {
    const res = await fetch(`/api/stocks/movements?sku=${encodeURIComponent(_sku)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    allMovements = await res.json();

    // Set product name from first result
    const firstName = allMovements[0]?.product_name || _sku;
    document.getElementById('uhProductName').textContent = firstName;

    // Init company filter after data loads
    _companyFilter = createTagFilter({
      wrapId:     'uhCompanyTagsWrap',
      inputId:    'uhCompanyTagInput',
      dropdownId: 'uhCompanyDropDown',
      getOptions: () => [...new Set(allMovements.map(m => String(m.company_name || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'tr')),
      onChange:   () => applyHareketlerFilters(),
    });

    applyHareketlerFilters();
  } catch {
    document.getElementById('uhProductName').textContent = 'Veri alınamadı';
  }
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────
function applyHareketlerFilters() {
  const companies = _companyFilter?.getSelected() || [];
  const direction = document.getElementById('uhFilterDirection')?.value || '';
  const dateStart = document.getElementById('uhFilterDateStart')?.value || '';
  const dateEnd   = document.getElementById('uhFilterDateEnd')?.value   || '';

  filteredMovements = allMovements.filter(m => {
    if (companies.length && !companies.includes(String(m.company_name || '').trim())) return false;
    if (direction && m.direction !== direction) return false;
    const d = String(m.invoice_date || '').slice(0, 10);
    if (dateStart && d < dateStart) return false;
    if (dateEnd   && d > dateEnd)   return false;
    return true;
  });

  renderStats();
  renderUrunHareketlerTable();
}

function _clearUhFilters() {
  _companyFilter?.clear();
  document.getElementById('uhFilterDirection').value  = '';
  document.getElementById('uhFilterDateStart').value  = '';
  document.getElementById('uhFilterDateEnd').value    = '';
  applyHareketlerFilters();
}

// ─── STATS ────────────────────────────────────────────────────────────────────
function renderStats() {
  const inQty  = filteredMovements.filter(m => m.direction === 'INCOMING').reduce((s,m) => s + Number(m.quantity||0), 0);
  const outQty = filteredMovements.filter(m => m.direction === 'OUTGOING').reduce((s,m) => s + Number(m.quantity||0), 0);
  const net    = inQty - outQty;
  const companies = new Set(filteredMovements.map(m => String(m.company_name || '').trim()).filter(Boolean));

  document.getElementById('statIn').textContent        = `+${fmtQty(inQty)}`;
  document.getElementById('statOut').textContent       = `-${fmtQty(outQty)}`;
  document.getElementById('statNet').textContent       = fmtQty(net);
  document.getElementById('statNet').className         = 'uh-stat-value ' + (net >= 0 ? 'text-success' : 'text-danger');
  document.getElementById('statCompanies').textContent = String(companies.size);
  document.getElementById('statTotal').textContent     = fmtQty(filteredMovements.length);
}

// ─── TABLE ────────────────────────────────────────────────────────────────────
function renderUrunHareketlerTable() {
  const body    = document.getElementById('uhTableBody');
  const emptyEl = document.getElementById('uhEmpty');
  if (!body) return;

  body.innerHTML = '';

  if (!filteredMovements.length) {
    emptyEl.classList.add('visible');
    return;
  }
  emptyEl.classList.remove('visible');

  filteredMovements.forEach(m => {
    const isIn = m.direction === 'INCOMING';
    const tr = document.createElement('tr');

    const pdfCell = m.pdf_url
      ? `<a href="${esc(m.pdf_url)}" target="_blank" rel="noopener" class="pdf-link" title="PDF görüntüle">
           <i class="ti ti-file-type-pdf"></i>
         </a>`
      : `<span style="color:#cbd5e1; font-size:12px;">—</span>`;

    tr.innerHTML = `
      <td style="white-space:nowrap;">${esc(m.invoice_date || '—')}</td>
      <td><span class="badge-dir ${isIn ? 'badge-in' : 'badge-out'}">${isIn ? '▲ Giriş' : '▼ Çıkış'}</span></td>
      <td><span class="badge-sku">${esc(m.invoice_no || '—')}</span></td>
      <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(m.company_name||'')}">${esc(m.company_name || '—')}</td>
      <td class="text-right">
        <strong class="${isIn ? 'text-success' : 'text-danger'}">${isIn ? '+' : '-'}${fmtQty(m.quantity)}</strong>
      </td>
      <td class="text-right">${m.unit_price_cur != null ? Number(m.unit_price_cur).toLocaleString('tr-TR', {minimumFractionDigits:2}) : '—'}</td>
      <td>${esc(m.currency || '—')}</td>
      <td>${pdfCell}</td>
    `;
    body.appendChild(tr);
  });
}