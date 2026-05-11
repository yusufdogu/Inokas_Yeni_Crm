// ── STATE ─────────────────────────────────────────────────────────────────────
let _allRows = [];

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadDashboard);

async function loadDashboard() {
    setListLoading(true);
    try {
        const res  = await fetch('/api/cari/dashboard');
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        renderKpis(data.kpis);
        _allRows = data.firmalar || [];
        renderCariTable(_allRows);
    } catch (err) {
        showToast('Dashboard yüklenemedi: ' + err.message, 'error');
        document.getElementById('cari-list').innerHTML = '<div class="cari-empty">Veriler yüklenemedi.</div>';
    }
}

// ── KPI CARDS ─────────────────────────────────────────────────────────────────
function renderKpis(kpis) {
    const { alacak, odenecek, odenen } = kpis;
    _setKpi('kpi-alacak-usd',   fmtUSD(alacak.usd),   'Toplam Alacak USD');
    _setKpi('kpi-alacak-tl',    fmtTL(alacak.tl),     'Toplam Alacak TL');
    _setKpi('kpi-odenecek-usd', fmtUSD(odenecek.usd), 'Ödenecek USD');
    _setKpi('kpi-odenecek-tl',  fmtTL(odenecek.tl),   'Ödenecek TL');
    _setKpi('kpi-odenen-usd',   fmtUSD(odenen.usd),   'Ödenen USD');
    _setKpi('kpi-odenen-tl',    fmtTL(odenen.tl),     'Ödenen TL');
}

function _setKpi(id, value, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector('.kpi-value').textContent = value;
    el.querySelector('.kpi-label').textContent = label;
}

// ── COMPANY TABLE ─────────────────────────────────────────────────────────────
function renderCariTable(rows) {
    const list = document.getElementById('cari-list');
    const badge = document.getElementById('cari-count');
    if (badge) badge.textContent = rows.length + ' firma';

    if (!rows.length) {
        list.innerHTML = '<div class="cari-empty">Kayıt bulunamadı.</div>';
        return;
    }

    list.innerHTML = rows.map(r => _rowHtml(r)).join('');
}

function _rowHtml(r) {
    const typeLabel = r.type === 'Tedarikçi' ? 'Tedarikçi' : r.type === 'Müşteri' ? 'Müşteri' : 'İkisi de';
    const typeClass = r.type === 'Tedarikçi' ? 'badge-red' : r.type === 'Müşteri' ? 'badge-blue' : 'badge-purple';

    const blocks = [];

    // Tedarikçi tarafı (INCOMING — borcumuz)
    if (r.type === 'Tedarikçi' || r.type === 'İkisi de') {
        const hasKalan = r.kalan_usd > 0.01 || r.kalan_tl > 0.01;
        if (r.type === 'İkisi de') blocks.push(`<span class="cari-section-title">Tedarikçi</span>`);
        blocks.push(_amountGroup('Ödenecek', r.odenecek_usd, r.odenecek_tl));
        blocks.push(_amountGroup('Ödenen',   r.odenen_usd,   r.odenen_tl));
        blocks.push(_amountGroup('Kalan',    r.kalan_usd,    r.kalan_tl, hasKalan ? 'cari-kalan-warn' : ''));
    }

    // Müşteri tarafı (OUTGOING — alacağımız)
    if (r.type === 'Müşteri' || r.type === 'İkisi de') {
        const hasAlacak = r.alacak_usd > 0.01 || r.alacak_tl > 0.01;
        if (r.type === 'İkisi de') blocks.push(`<span class="cari-section-title" style="margin-left:20px;">Müşteri</span>`);
        blocks.push(_amountGroup('Toplam Ciro', r.ciro_usd,   r.ciro_tl));
        blocks.push(_amountGroup('Alacak',      r.alacak_usd, r.alacak_tl, hasAlacak ? 'cari-kalan-warn' : ''));
    }

    return `
<div class="cari-row" onclick="openFirma('${r.company_id}','${r.company_name.replace(/'/g, "\\'")}')">
  <div class="cari-row-top">
    <span class="cari-company-name">${r.company_name}</span>
    <span class="cari-badge ${typeClass}">${typeLabel}</span>
  </div>
  <div class="cari-row-amounts">${blocks.join('')}</div>
</div>`;
}

function _amountGroup(label, usd, tl, extraClass = '') {
    return `<div class="cari-amount-group ${extraClass}">
      <span class="cari-amount-label">${label}</span>
      <span class="cari-amount-value">${_amountLine(usd, tl)}</span>
    </div>`;
}

function _amountLine(usd, tl) {
    const parts = [];
    if (usd > 0.01)  parts.push(fmtUSD(usd));
    if (tl  > 0.01)  parts.push(fmtTL(tl));
    return parts.length ? parts.join(' <span class="cari-sep">|</span> ') : '<span class="cari-dash">—</span>';
}

// ── NAVİGASYON ────────────────────────────────────────────────────────────────
function openFirma(companyId, companyName) {
    if (!companyId) { showToast('Firma ID bulunamadı.', 'warn'); return; }
    window.location.href = `/cari/firma.html?id=${encodeURIComponent(companyId)}&name=${encodeURIComponent(companyName)}`;
}

// ── SEARCH FILTER ─────────────────────────────────────────────────────────────
function filterCariTable() {
    const q = (document.getElementById('cari-search')?.value || '').toLowerCase().trim();
    if (!q) { renderCariTable(_allRows); return; }
    renderCariTable(_allRows.filter(r => r.company_name.toLowerCase().includes(q)));
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function setListLoading(on) {
    const list = document.getElementById('cari-list');
    if (on) list.innerHTML = '<div class="cari-empty">Yükleniyor...</div>';
}
