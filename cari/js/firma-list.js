// ── FATURA LİSTESİ (SOL PANEL) ────────────────────────────────────────────────

async function loadFirmaInvoices() {
    const list = document.getElementById('firma-invoice-list');
    list.innerHTML = '<div class="fl-empty">Yükleniyor...</div>';

    try {
        firmaInvoices = await apiFirmaInvoices(firmaCompanyId);
        renderFirmaInvoiceList();
    } catch (err) {
        list.innerHTML = `<div class="fl-empty">Faturalar yüklenemedi: ${err.message}</div>`;
    }
}

function renderFirmaInvoiceList() {
    const list = document.getElementById('firma-invoice-list');

    if (!firmaInvoices.length) {
        list.innerHTML = '<div class="fl-empty">Bu firmaya ait fatura yok.</div>';
        return;
    }

    list.innerHTML = firmaInvoices.map(inv => _invoiceRowHtml(inv)).join('');
}

function _invoiceRowHtml(inv) {
    const isSelected = firmaSelectedInv?.id === inv.id;

    const date      = inv.invoice_date
        ? new Date(inv.invoice_date + 'T00:00:00').toLocaleDateString('tr-TR')
        : '—';

    const iso       = _invIso(inv);
    const payable   = _invPayable(inv);
    const paid      = _invPaid(inv);
    const remaining = Math.max(payable - paid, 0);
    const fmt       = n => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const label     = iso === 'TRY' ? 'TL' : iso;

    const statusDot = remaining < 0.01
        ? '<span class="fl-dot fl-dot-paid" title="Ödendi"></span>'
        : paid > 0.01
            ? '<span class="fl-dot fl-dot-partial" title="Kısmi"></span>'
            : '<span class="fl-dot fl-dot-unpaid" title="Ödenmedi"></span>';

    const dirIcon = inv.direction === 'INCOMING'
        ? '<i class="ti ti-arrow-down-circle" style="color:#16a34a; font-size:14px;"></i>'
        : '<i class="ti ti-arrow-up-circle"   style="color:#2563eb; font-size:14px;"></i>';

    return `
<div class="fl-row${isSelected ? ' fl-row--active' : ''}" onclick="selectInvoice('${inv.id}')">
  <div class="fl-row-top">
    ${statusDot}
    <span class="fl-inv-no">${inv.invoice_no || inv.efatura_uuid?.slice(0,8) || '—'}</span>
    ${dirIcon}
  </div>
  <div class="fl-row-date">${date}</div>
  <div class="fl-row-amounts">
    <div class="fl-amt-group">
      <span class="fl-amt-label">Toplam</span>
      <span class="fl-amt-val">${fmt(payable)} ${label}</span>
    </div>
    <div class="fl-amt-group">
      <span class="fl-amt-label">Ödenen</span>
      <span class="fl-amt-val">${paid > 0.01 ? fmt(paid) + ' ' + label : '—'}</span>
    </div>
    <div class="fl-amt-group ${remaining > 0.01 ? 'fl-amt-warn' : ''}">
      <span class="fl-amt-label">Kalan</span>
      <span class="fl-amt-val">${remaining > 0.01 ? fmt(remaining) + ' ' + label : '<span style="color:#16a34a">✓</span>'}</span>
    </div>
  </div>
</div>`;
}

function selectInvoice(invoiceId) {
    firmaSelectedInv = firmaInvoices.find(i => String(i.id) === String(invoiceId)) || null;
    renderFirmaInvoiceList();   // aktif satırı güncelle
    renderFirmaDetail();        // sağ panel
}

// ── YARDIMCILAR ───────────────────────────────────────────────────────────────
function _invIso(inv) {
    const raw = String(inv.base_currency || inv.currency || 'TRY').trim().toUpperCase();
    return raw === 'TL' ? 'TRY' : raw || 'TRY';
}

function _invRate(inv) {
    const r = parseFloat(inv.calculation_rate ?? inv.exchange_rate);
    return Number.isFinite(r) && r > 0 ? r : 1;
}

function _invPayable(inv) {
    const c = parseFloat(inv.payable_amount_cur);
    if (Number.isFinite(c) && c >= 0) return c;
    return (parseFloat(inv.payable_amount_tl) || 0) / _invRate(inv);
}

function _invPaid(inv) {
    const cur = parseFloat(inv.paid_amount_cur);
    if (Number.isFinite(cur) && cur > 0) return cur;
    return (parseFloat(inv.paid_amount) || 0) / _invRate(inv);
}
