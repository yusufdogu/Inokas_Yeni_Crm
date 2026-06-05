// ─── FATURALAR — FATURA DETAY PANELİ ─────────────────────────────────────────
// Detay görünümü, PDF, Bilgiler/Ürünler sekmeleri, inline düzenleme

// ─── Detay görünümü (PDF + 2 sekme) ──────────────────────────────────────────

function renderDetailView(id) {
    const sid = String(id);
    let inv = (allInvoicesCache || []).find(i => String(i.id) === sid) || (typeof bekleyenCache !== 'undefined' ? bekleyenCache : []).find(i => String(i.id) === sid);
    if (!inv) return;
    const content = document.getElementById('fatContent');
    if (!content) return;

    const curTab = activeDetailTab[id] || 'bilgiler';

    content.innerHTML = `<div class="fat-detail-view">
        <div class="fat-detail-pdf" id="fatDetailPdfPane_${id}">
            <div class="fat-detail-pdf-empty" id="fatDetailPdfEmpty_${id}">
                <svg width="48" height="48" fill="none" stroke="#cbd5e1" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <p style="font-size:14px; font-weight:600;">XML bulunamadı</p>
                <span style="font-size:12px; color:#cbd5e1;">Bu faturaya ait XML kayıtlı değil.</span>
            </div>
            <iframe id="fatDetailIframe_${id}" style="display:none; flex:1; width:100%; border:none;"></iframe>
        </div>
        <div class="fat-detail-right">
            <div class="fat-dtab-bar">
                <button class="fat-dtab${curTab === 'bilgiler' ? ' fat-dtab--active' : ''}" onclick="switchFatDetailTab('${id}','bilgiler')">Fatura Bilgileri</button>
                <button class="fat-dtab${curTab === 'urunler' ? ' fat-dtab--active' : ''}" onclick="switchFatDetailTab('${id}','urunler')">Fatura Ürünleri</button>
            </div>
            <div class="fat-dtab-body" id="fatDtabBody_${id}"></div>
        </div>
    </div>`;

    loadDetailPdf(id, inv);
    renderDetailTabContent(id, curTab, inv);
}

async function loadDetailPdf(id, inv) {
    const empty = document.getElementById(`fatDetailPdfEmpty_${id}`);
    const iframe = document.getElementById(`fatDetailIframe_${id}`);
    if (!iframe) return;

    // pdf_url varsa direkt native PDF viewer
    if (inv?.pdf_url) {
        iframe.src = inv.pdf_url;
        if (empty) empty.style.display = 'none';
        iframe.style.display = 'block';
        return;
    }

    if (!inv?.xml_url) return;

    if (_detailXmlCache[id]) {
        try {
            await renderXmlToPdfIframe(_detailXmlCache[id], iframe);
            if (empty) empty.style.display = 'none';
            iframe.style.display = 'block';
        } catch (e) { /* sessiz geç */ }
        return;
    }

    if (empty) empty.innerHTML = `
        <div style="width:36px;height:36px;border:3px solid #e2e8f0;border-top-color:#2563eb;border-radius:50%;animation:pdf-spin 0.7s linear infinite;"></div>
        <p style="font-size:13px;font-weight:600;color:#2563eb;margin-top:10px;">XML yükleniyor...</p>`;

    try {
        const res = await fetch(inv.xml_url);
        if (!res.ok) throw new Error('XML alınamadı (' + res.status + ')');
        const xmlText = await res.text();
        _detailXmlCache[id] = xmlText;
        await renderXmlToPdfIframe(xmlText, iframe);
        if (empty) empty.style.display = 'none';
        iframe.style.display = 'block';
    } catch (e) {
        if (empty) empty.innerHTML = `
            <svg width="40" height="40" fill="none" stroke="#fca5a5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
            <p style="font-size:13px;font-weight:600;color:#ef4444;margin-top:8px;">PDF yüklenemedi</p>
            <span style="font-size:11px;color:#94a3b8;">${e.message}</span>`;
    }
}

function switchFatDetailTab(id, tab) {
    activeDetailTab[id] = tab;
    // Eski tab bar (fatDtabBody sistemi)
    ['bilgiler', 'urunler'].forEach(t => {
        const btn = document.querySelector(`[onclick="switchFatDetailTab('${id}','${t}')"]`);
        if (btn) btn.classList.toggle('fat-dtab--active', t === tab);
    });
    // Yeni tam ekran detay sayfası tab bar
    const newTabBar = document.getElementById('fatDetailTabBar');
    if (newTabBar) {
        const tabs = ['bilgiler', 'urunler'];
        newTabBar.querySelectorAll('.fat-dtab').forEach((btn, i) => {
            btn.classList.toggle('fat-dtab--active', tabs[i] === tab);
        });
    }
    const sid = String(id);
    let inv = (allInvoicesCache || []).find(i => String(i.id) === sid) || (typeof bekleyenCache !== 'undefined' ? bekleyenCache : []).find(i => String(i.id) === sid);
    renderDetailTabContent(id, tab, inv);
}

// UBL XML içinde gömülü PDF varsa blob URL döner, yoksa null
const _embeddedPdfCache = {};
function _extractEmbeddedPdfUrl(xmlText, id) {
    if (_embeddedPdfCache[id]) return _embeddedPdfCache[id];
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const nodes = xmlDoc.getElementsByTagName('cbc:EmbeddedDocumentBinaryObject');
        for (let i = 0; i < nodes.length; i++) {
            const fn = (nodes[i].getAttribute('filename') || '').toLowerCase();
            const mime = (nodes[i].getAttribute('mimeCode') || '').toLowerCase();
            if (!fn.endsWith('.pdf') && mime !== 'application/pdf') continue;
            const b64 = nodes[i].textContent.trim();
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            _embeddedPdfCache[id] = url;
            return url;
        }
    } catch (_) { }
    return null;
}

async function loadDetailPdfInto(id, inv, iframe, empty) {
    if (!iframe) return;
    if (inv?.pdf_url) {
        iframe.src = inv.pdf_url;
        if (empty) empty.style.display = 'none';
        iframe.style.display = 'block';
        return;
    }
    if (!inv?.xml_url) return;

    if (empty) empty.innerHTML = `
        <div style="width:36px;height:36px;border:3px solid #e2e8f0;border-top-color:#2563eb;border-radius:50%;animation:pdf-spin 0.7s linear infinite;"></div>
        <p style="font-size:13px;font-weight:600;color:#2563eb;margin-top:10px;">Yükleniyor...</p>`;

    try {
        const xmlText = _detailXmlCache[id] || await (async () => {
            const res = await fetch(inv.xml_url);
            if (!res.ok) throw new Error('XML alınamadı (' + res.status + ')');
            const t = await res.text();
            _detailXmlCache[id] = t;
            return t;
        })();

        // Önce XML içinde gömülü PDF ara — varsa native viewer'da aç
        const embeddedPdf = _extractEmbeddedPdfUrl(xmlText, id);
        if (embeddedPdf) {
            if (empty) empty.style.display = 'none';
            iframe.src = embeddedPdf;
            iframe.style.display = 'block';
            return;
        }

        // Gömülü PDF yoksa XSLT HTML render
        await renderXmlToPdfIframe(xmlText, iframe);
        if (empty) empty.style.display = 'none';
        iframe.style.display = 'block';
    } catch (e) {
        if (empty) empty.innerHTML = `
            <p style="font-size:13px;font-weight:600;color:#ef4444;">PDF yüklenemedi</p>
            <span style="font-size:11px;color:#94a3b8;">${e.message}</span>`;
    }
}

async function renderDetailTabContent(id, tab, inv, _bodyOverride) {
    const body = _bodyOverride
        || document.getElementById(`fatDtabBody_${id}`)
        || document.getElementById('fatDetailTabBody');
    if (!body || !inv) return;
    body.classList.remove('fat-tab-anim');
    void body.offsetWidth;
    body.classList.add('fat-tab-anim');

    if (tab === 'bilgiler') { renderBilgilerView(id); return; }
    if (tab === 'urunler') { renderUrunlerView(id, body, inv); return; }
}

function closeInvoiceDetailModal() { /* artık inline tab sistemi kullanılıyor */ }

// ─── Bilgiler sekmesi ─────────────────────────────────────────────────────────

function _findInvAndBody(id) {
    const sid = String(id);
    let inv = (allInvoicesCache || []).find(i => String(i.id) === sid) || (typeof bekleyenCache !== 'undefined' ? bekleyenCache : []).find(i => String(i.id) === sid);
    let body = document.getElementById(`fatDtabBody_${sid}`)
        || document.getElementById('fatDetailTabBody');
    if (!inv || !body) {
        const bekInv = bekleyenCache.find(i => String(i.id) === sid);
        const bekBody = document.getElementById(`bekInfoBody_${sid}`);
        if (bekInv && bekBody) { inv = bekInv; body = bekBody; }
    }
    return { inv, body };
}

function renderBilgilerView(id) {
    const { inv, body } = _findInvAndBody(id);
    if (!inv || !body) return;

    const currLabel = invDisplayCurrencyLabel(inv);
    const fmtN = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const kurText = invCalculationRate(inv) !== 1 ? `1 ${currLabel} = ${invCalculationRate(inv).toLocaleString('tr-TR')} TL` : '—';

    const card = (label, value, opts = {}) => {
        const full = opts.full ? 'grid-column:span 2;' : '';
        const bg = opts.accent ? 'background:#eff6ff; border-color:#bfdbfe;' : 'background:#f8fafc;';
        const vc = opts.accent ? 'color:#2563eb;' : 'color:#0f172a;';
        const vs = opts.large ? 'font-size:15px;' : 'font-size:13px;';
        const v = value != null && value !== '' ? String(value).replace(/</g, '&lt;') : '—';
        return `<div style="${full} ${bg} border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; display:flex; flex-direction:column; gap:3px;">
            <span style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em;">${label}</span>
            <span style="${vs} font-weight:700; ${vc}">${v}</span>
        </div>`;
    };

    const section = t => `<div style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; margin-top:4px;">${t}</div>`;

    body.innerHTML = `<div style="padding:16px; display:flex; flex-direction:column; gap:14px;">

        ${section('Fatura Bilgileri')}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            ${card('Fatura No', inv.invoice_no, { accent: true })}
            ${card('Fatura Türü', inv.invoice_type)}
            ${card('Tarih', inv.invoice_date)}
            ${card('Vade Tarihi', inv.due_date || '—')}
            ${card('Döviz', currLabel)}
            ${card('Döviz Kuru', kurText)}
            ${card('Matrah', fmtN(invNetAmountSrc(inv)) + ' ' + currLabel)}
            ${card('KDV', fmtN(invTaxAmountSrc(inv)) + ' ' + currLabel)}
            <div style="grid-column:span 2; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:10px; font-weight:800; color:#2563eb; text-transform:uppercase; letter-spacing:0.05em;">GENEL TOPLAM</span>
                <span style="font-size:18px; font-weight:800; color:#2563eb;">${fmtN(invPayableAmountSrc(inv))} ${currLabel}</span>
            </div>
        </div>

        ${section('Firma Bilgileri')}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div style="grid-column:span 2; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px;">
                <div style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em;">Firma</div>
                <div style="font-size:15px; font-weight:800; color:#0f172a; margin-top:2px;">${(inv.companies?.name || '—').replace(/</g, '&lt;')}</div>
            </div>
            ${card('VKN / TCK', inv.companies?.vkn_tckn)}
            ${card('Vergi Dairesi', inv.companies?.tax_office)}
            ${card('Telefon', inv.companies?.phone)}
            ${card('E-posta', inv.companies?.email)}
            ${card('Web Sitesi', inv.companies?.website, { full: true })}
            ${card('Adres', inv.companies?.address, { full: true })}
        </div>

        ${inv.notes ? `${section('Notlar')}<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; font-size:12px; color:#475569; white-space:pre-wrap; line-height:1.5;">${String(inv.notes).replace(/</g, '&lt;')}</div>` : ''}

        <div style="display:flex; gap:8px; justify-content:flex-end; padding-top:8px; border-top:1px solid #f1f5f9; margin-top:4px;">
            <button onclick="deleteInvoice('${id}')"
                style="display:flex; align-items:center; gap:6px; background:#fee2e2; color:#ef4444; padding:7px 14px; border-radius:8px; border:none; font-weight:600; cursor:pointer; font-size:13px; font-family:inherit;">
                <i class="ti ti-trash" style="font-size:14px;"></i>Sil
            </button>
            <button onclick="enterBilgilerEdit('${id}')"
                style="display:flex; align-items:center; gap:6px; background:#2563eb; color:white; padding:7px 16px; border-radius:8px; border:none; font-weight:600; cursor:pointer; font-size:13px; font-family:inherit;">
                <i class="ti ti-pencil" style="font-size:14px;"></i>Düzenlemeyi Aktifleştir
            </button>
        </div>
    </div>`;
}

function enterBilgilerEdit(id) {
    const { inv, body } = _findInvAndBody(id);
    if (!inv || !body) return;

    const currLabel = invDisplayCurrencyLabel(inv);
    const fmtN = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const readCard = (label, value, opts = {}) => {
        const full = opts.full ? 'grid-column:span 2;' : '';
        const v = value != null && value !== '' ? String(value).replace(/</g, '&lt;') : '—';
        return `<div style="${full} background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; display:flex; flex-direction:column; gap:3px;">
            <span style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em;">${label}</span>
            <span style="font-size:13px; font-weight:700; color:#0f172a;">${v}</span>
        </div>`;
    };

    const editCard = (label, inputId, val, type = 'text', opts = {}) => {
        const full = opts.full ? 'grid-column:span 2;' : '';
        const step = type === 'number' ? ' step="any"' : '';
        return `<div style="${full} background:#fff; border:1.5px solid #2563eb; border-radius:10px; padding:8px 14px; display:flex; flex-direction:column; gap:4px;">
            <span style="font-size:10px; font-weight:800; color:#2563eb; text-transform:uppercase; letter-spacing:0.05em;">${label}</span>
            <input id="${inputId}" type="${type}"${step} value="${String(val || '').replace(/"/g, '&quot;')}"
                style="border:none; outline:none; font-size:13px; font-weight:600; color:#0f172a; background:transparent; width:100%; padding:0; font-family:inherit;">
        </div>`;
    };

    const editSelectCard = (label, selectId, currentVal, options, opts = {}) => {
        const full = opts.full ? 'grid-column:span 2;' : '';
        const optHtml = options.map(o => `<option value="${o}"${o === currentVal ? ' selected' : ''}>${o}</option>`).join('');
        return `<div style="${full} background:#fff; border:1.5px solid #2563eb; border-radius:10px; padding:8px 14px; display:flex; flex-direction:column; gap:4px;">
            <span style="font-size:10px; font-weight:800; color:#2563eb; text-transform:uppercase; letter-spacing:0.05em;">${label}</span>
            <select id="${selectId}" style="border:none; outline:none; font-size:13px; font-weight:600; color:#0f172a; background:transparent; width:100%; padding:0; font-family:inherit; cursor:pointer;">
                ${optHtml}
            </select>
        </div>`;
    };

    const section = t => `<div style="font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; margin-top:4px;">${t}</div>`;

    const netVal = invNetAmountSrc(inv);
    const taxVal = invTaxAmountSrc(inv);
    const totalVal = invPayableAmountSrc(inv);
    const kurVal = invCalculationRate(inv);

    body.innerHTML = `<div style="padding:16px; display:flex; flex-direction:column; gap:14px;">

        ${section('Fatura Bilgileri')}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            ${editCard('Fatura No', 'edit_invoice_no', inv.invoice_no || '')}
            ${editSelectCard('Fatura Türü', 'edit_invoice_type', inv.invoice_type || 'Ticari', ['e-Fatura', 'e-Arşiv', 'Temel', 'Ticari'])}
            ${editCard('Tarih', 'edit_invoice_date', inv.invoice_date || '', 'date')}
            ${editCard('Vade Tarihi', 'edit_due_date', inv.due_date || '', 'date')}
            ${editSelectCard('Döviz', 'edit_currency', currLabel, ['TL', 'USD'])}
            ${editCard('Döviz Kuru (1 $ = ?)', 'edit_kur', kurVal !== 1 ? kurVal : '', 'number')}
            ${editCard('Matrah', 'edit_net', parseFloat(netVal.toFixed(2)), 'number')}
            ${editCard('KDV', 'edit_tax', parseFloat(taxVal.toFixed(2)), 'number')}
            <div id="bilgilerTotalCard" style="grid-column:span 2; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:10px; font-weight:800; color:#2563eb; text-transform:uppercase; letter-spacing:0.05em;">GENEL TOPLAM</span>
                <span id="bilgilerTotalDisplay" style="font-size:18px; font-weight:800; color:#2563eb;">${fmtN(totalVal)} ${currLabel}</span>
            </div>
        </div>

        ${section('Firma Bilgileri')}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            ${editCard('Firma Adı', 'edit_company_name', inv.companies?.name || '', 'text', { full: true })}
            ${readCard('VKN / TCK', inv.companies?.vkn_tckn)}
            ${readCard('Vergi Dairesi', inv.companies?.tax_office)}
            ${editCard('Telefon', 'edit_phone', inv.companies?.phone || '')}
            ${editCard('E-posta', 'edit_email', inv.companies?.email || '', 'email')}
            ${editCard('Web Sitesi', 'edit_website', inv.companies?.website || '', 'text', { full: true })}
            ${editCard('Adres', 'edit_address', inv.companies?.address || '', 'text', { full: true })}
        </div>

        ${section('Notlar')}
        <textarea id="edit_notes" style="width:100%; min-height:72px; border:1.5px solid #2563eb; border-radius:10px; padding:10px 14px; font-size:12px; color:#475569; resize:vertical; font-family:inherit; outline:none; box-sizing:border-box;">${String(inv.notes || '').replace(/</g, '&lt;')}</textarea>

        <div style="display:flex; gap:8px; justify-content:flex-end; padding-top:8px; border-top:1px solid #f1f5f9; margin-top:4px;">
            <button onclick="renderBilgilerView('${id}')"
                style="background:#f1f5f9; color:#475569; padding:7px 14px; border-radius:8px; border:none; font-weight:600; cursor:pointer; font-size:13px; font-family:inherit;">
                İptal
            </button>
            <button onclick="saveBilgilerEdit('${id}')"
                style="display:flex; align-items:center; gap:6px; background:#16a34a; color:white; padding:7px 16px; border-radius:8px; border:none; font-weight:600; cursor:pointer; font-size:13px; font-family:inherit;">
                <i class="ti ti-device-floppy" style="font-size:14px;"></i>Kaydet
            </button>
        </div>
    </div>`;

    // Auto-update total display when matrah, KDV, or currency changes
    const netEl = document.getElementById('edit_net');
    const taxEl = document.getElementById('edit_tax');
    const curSel = document.getElementById('edit_currency');
    const totalDisp = document.getElementById('bilgilerTotalDisplay');

    const updateTotal = () => {
        const net = parseFloat(netEl?.value) || 0;
        const tax = parseFloat(taxEl?.value) || 0;
        const total = net + tax;
        const lbl = curSel?.value || currLabel;
        if (totalDisp) {
            totalDisp.textContent = total.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + lbl;
        }
    };

    netEl?.addEventListener('input', updateTotal);
    taxEl?.addEventListener('input', updateTotal);
    curSel?.addEventListener('change', updateTotal);
}

async function saveBilgilerEdit(id) {
    const { inv } = _findInvAndBody(id);
    if (!inv) return;

    const invoice_no = document.getElementById('edit_invoice_no')?.value?.trim() || inv.invoice_no || '';
    const invoice_date = document.getElementById('edit_invoice_date')?.value || inv.invoice_date || null;
    const invoice_type = document.getElementById('edit_invoice_type')?.value || inv.invoice_type || 'Ticari';
    const currency_val = document.getElementById('edit_currency')?.value || invDisplayCurrencyLabel(inv);
    const kur_raw = parseFloat(document.getElementById('edit_kur')?.value);
    const calc_rate = Number.isFinite(kur_raw) && kur_raw > 0 ? kur_raw : invCalculationRate(inv);
    const net_cur = parseFloat(document.getElementById('edit_net')?.value) || 0;
    const tax_cur = parseFloat(document.getElementById('edit_tax')?.value) || 0;
    const payable_cur = net_cur + tax_cur;
    const due_date = document.getElementById('edit_due_date')?.value || null;
    const phone = document.getElementById('edit_phone')?.value?.trim() || '';
    const email = document.getElementById('edit_email')?.value?.trim() || '';
    const website = document.getElementById('edit_website')?.value?.trim() || '';
    const address = document.getElementById('edit_address')?.value?.trim() || '';
    const notes = document.getElementById('edit_notes')?.value || '';
    const company_name = document.getElementById('edit_company_name')?.value?.trim() || inv.companies?.name || '';

    const btn = document.querySelector(`[onclick="saveBilgilerEdit('${id}')"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor...'; }

    const baseIso = currency_val === 'TL' ? 'TRY' : currency_val;

    try {
        const res = await fetch(`/api/invoices/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                update_stock: false,
                invoice: {
                    due_date, notes, invoice_no, invoice_date, invoice_type,
                    currency: currency_val, base_currency: baseIso,
                    calculation_rate: calc_rate,
                    total_tax_exclusive_cur: net_cur,
                    total_tax_inclusive_cur: net_cur + tax_cur,
                    payable_amount_cur: payable_cur,
                    total_tax_exclusive_tl: net_cur * calc_rate,
                    tax_amount_tl: tax_cur * calc_rate,
                    payable_amount_tl: payable_cur * calc_rate
                },
                company: {
                    vkn_tckn: inv.companies?.vkn_tckn || '',
                    name: company_name,
                    tax_office: inv.companies?.tax_office || '',
                    phone, email, website, address
                },
                items: inv.invoice_items || []
            })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Güncelleme hatası');

        // Update in-memory cache
        inv.invoice_no = invoice_no;
        inv.invoice_date = invoice_date;
        inv.invoice_type = invoice_type;
        inv.currency = currency_val;
        inv.base_currency = baseIso;
        inv.calculation_rate = calc_rate;
        inv.total_tax_exclusive_cur = net_cur;
        inv.tax_amount_tl = tax_cur * calc_rate;
        inv.payable_amount_cur = payable_cur;
        inv.payable_amount_tl = payable_cur * calc_rate;
        inv.due_date = due_date;
        inv.notes = notes;
        if (inv.companies) {
            inv.companies.name = company_name;
            inv.companies.phone = phone;
            inv.companies.email = email;
            inv.companies.website = website;
            inv.companies.address = address;
        }

        renderBilgilerView(id);
        const bekIdx = bekleyenCache.findIndex(i => i.id === id);
        if (bekIdx >= 0) bekleyenCache[bekIdx] = inv;
        refreshData(true);
    } catch (e) {
        alert('Hata: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Kaydet'; }
    }
}

// ─── PATCH: Replace these two functions in detail.js ─────────────────────────
// 1. renderUrunlerView  (line ~467)
// 2. enterUrunlerEdit   (line ~526)
// 3. saveUrunlerEdit    (line ~659)
// Everything else in detail.js stays unchanged.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Helper: searchable category dropdown ─────────────────────────────────────
// Creates a custom dropdown on a wrapper element for category selection.
// ─── Generic searchable dropdown ──────────────────────────────────────────────
function _makeSearchableDropdown(wrapEl, {
    getOptions,       // () => string[]
    initialValue = '',
    placeholder = 'Ara...',
    onChange = () => { },
    onAddNew = null,  // null = no add new; fn(value) = called when confirmed
    addNewLabel = v => `+ "${v}" ekle`,
}) {
    if (!wrapEl) return;
    wrapEl.innerHTML = '';
    wrapEl.style.position = 'relative';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialValue || '';
    input.placeholder = placeholder;
    input.style.cssText = 'width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:inherit;outline:none;box-sizing:border-box;background:#fff;color:#0f172a;transition:border-color 0.15s;';
    input.addEventListener('focus', () => { input.style.borderColor = '#2563eb'; renderList(input.value); });
    input.addEventListener('blur', () => { input.style.borderColor = '#e2e8f0'; setTimeout(() => { list.style.display = 'none'; }, 160); });
    wrapEl.appendChild(input);

    const list = document.createElement('ul');
    list.style.cssText = 'position:absolute;top:calc(100% + 2px);left:0;right:0;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:8px;list-style:none;margin:0;padding:4px 0;display:none;max-height:180px;overflow-y:auto;box-shadow:0 8px 20px rgba(0,0,0,0.12);scrollbar-width:thin;';
    wrapEl.appendChild(list);

    function makeLi(text, onClick, style = '') {
        const li = document.createElement('li');
        li.textContent = text;
        li.style.cssText = `padding:7px 12px;font-size:12px;color:#1e293b;cursor:pointer;${style}`;
        li.addEventListener('mouseenter', () => li.style.background = '#f1f5f9');
        li.addEventListener('mouseleave', () => li.style.background = '');
        li.addEventListener('mousedown', e => { e.preventDefault(); onClick(); });
        list.appendChild(li);
    }

    function renderList(query) {
        const q = (query || '').toLocaleLowerCase('tr-TR');
        const opts = getOptions();
        const filtered = opts.filter(o => !q || o.toLocaleLowerCase('tr-TR').includes(q));
        list.innerHTML = '';

        if (!filtered.length && !onAddNew) {
            makeLi('Sonuç bulunamadı', () => { }, 'color:#94a3b8;cursor:default;');
        }

        filtered.forEach(opt => makeLi(opt, () => {
            input.value = opt;
            list.style.display = 'none';
            onChange(opt);
        }));

        // Add new option
        const trimmed = (query || '').trim();
        if (onAddNew && trimmed && !opts.some(o => o.toLowerCase() === trimmed.toLowerCase())) {
            const li = document.createElement('li');
            li.textContent = addNewLabel(trimmed);
            li.style.cssText = 'padding:7px 12px;font-size:12px;color:#059669;font-weight:700;cursor:pointer;border-top:1px solid #f1f5f9;margin-top:2px;';
            li.addEventListener('mouseenter', () => li.style.background = '#f0fdf4');
            li.addEventListener('mouseleave', () => li.style.background = '');
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                input.value = trimmed;
                list.style.display = 'none';
                onAddNew(trimmed);
                onChange(trimmed);
            });
            list.appendChild(li);
        }

        list.style.display = (filtered.length || (onAddNew && trimmed)) ? 'block' : 'none';
    }

    input.addEventListener('input', () => { renderList(input.value); onChange(input.value); });

    // Public API
    wrapEl._getValue = () => input.value.trim();
    wrapEl._setValue = v => { input.value = v || ''; };
    wrapEl._setOptions = () => { }; // options are dynamic via getOptions()
    wrapEl._rebuild = (placeholder2, val) => {
        input.placeholder = placeholder2 || placeholder;
        input.value = val || '';
    };

    return wrapEl;
}

// ─── Category dropdown (with add new → saves to product) ─────────────────────
function _makeCategoryDropdown(wrapEl, isInternal, initialValue, onChange, sku = '') {
    const getOptions = () => isInternal
        ? (_internalCategoryOptions || [])
        : (productCategoryOptionList || []);

    _makeSearchableDropdown(wrapEl, {
        getOptions,
        initialValue,
        placeholder: isInternal ? 'Ofis içi kategorisi...' : 'Kategori ara...',
        onChange,
        onAddNew: async (newCat) => {
            if (isInternal) {
                if (!_internalCategoryOptions.includes(newCat)) {
                    _internalCategoryOptions.push(newCat);
                    _internalCategoryOptions.sort((a, b) => a.localeCompare(b, 'tr'));
                }
            } else {
                if (!productCategoryOptionList.includes(newCat)) {
                    productCategoryOptionList.push(newCat);
                    productCategoryOptionList.sort((a, b) => a.localeCompare(b, 'tr'));
                }
                const activeSku = sku || wrapEl.closest?.('.ue-acc-item')?.querySelector?.('.ue-code')?.value?.trim() || '';
                if (activeSku) {
                    saveNewCategoryToProduct(activeSku, newCat).catch(() => { });
                }
            }
        },
        addNewLabel: v => `+ Yeni kategori: "${v}"`,
    });
}

// ─── Brand dropdown ───────────────────────────────────────────────────────────
function _makeBrandDropdown(wrapEl, initialValue, onBrandChange) {
    _makeSearchableDropdown(wrapEl, {
        getOptions: () => _brandOptions || [],
        initialValue,
        placeholder: 'Marka ara...',
        onChange: onBrandChange,
    });
}

// ─── Model dropdown (filtered by brand) ──────────────────────────────────────
function _makeModelDropdown(wrapEl, initialValue, getBrand) {
    _makeSearchableDropdown(wrapEl, {
        getOptions: () => {
            const brand = getBrand();
            if (brand && _modelsByBrand.has(brand)) return _modelsByBrand.get(brand);
            // No brand selected → show all models
            const all = new Set();
            (_modelsByBrand || new Map()).forEach(models => models.forEach(m => all.add(m)));
            return [...all].sort((a, b) => a.localeCompare(b, 'tr'));
        },
        initialValue,
        placeholder: 'Model ara...',
        onChange: () => { },
    });
}

// ─── 1. renderUrunlerView ─────────────────────────────────────────────────────
async function renderUrunlerView(id, body, inv) {
    const items = inv.invoice_items || [];

    let warnHtml = '';
    try {
        await ensureProductCodeLookupSetLoaded();
        const missing = [...new Set(
            items.map(it => String(it.product_code || it.sku || '').trim())
                .filter(Boolean).filter(s => !isInProductCodeLookup(s))
        )];
        if (missing.length) {
            warnHtml = `<div class="det-sku-warn"><strong>⚠️ Yeni ürün kodu olabilir</strong><br>${missing.join(', ')} — products tablosunda kayıtlı değil.</div>`;
        }
    } catch (e) { }
    try { await ensureProductCategoryLookupLoaded(); } catch (e) { }

    const fmtP = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pill = (val, color = '#64748b', bg = '#f1f5f9') => val
        ? `<span style="font-size:11px;font-weight:600;color:${color};background:${bg};border-radius:5px;padding:2px 7px;white-space:nowrap;">${val}</span>`
        : '';

    const cards = items.map(it => {
        const isInt = !!it.is_internal;
        const code = String(it.product_code || it.sku || '').trim();
        const name = String(it.product_name || '').trim();
        const cat = isInt
            ? (it.item_subcategory || '—')
            : (it.category || productCategoryByCodeMap?.get(normalizeProductCodeForMatch(code)) || '—');
        const brand = it.brand_name || it.brand || '';
        const model = it.model || '';

        return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:11px 14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name.replace(/</g, '&lt;') || '—'}</div>
                    <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
                        ${code ? `<span style="font-size:11px;font-weight:700;color:#2563eb;background:#eff6ff;border-radius:5px;padding:2px 7px;font-family:'Geist Mono',monospace;">${code}</span>` : ''}
                        ${pill(`× ${it.quantity}`)}
                        ${pill(fmtP(it.unit_price_cur) + ' / adet')}
                        ${isInt ? pill('Ofis İçi', '#7c3aed', '#f5f3ff') : ''}
                        ${cat !== '—' ? pill(cat) : ''}
                        ${brand ? pill(brand) : ''}
                        ${model ? pill(model) : ''}
                    </div>
                </div>
                <span style="font-size:14px;font-weight:800;color:#2563eb;white-space:nowrap;flex-shrink:0;">${fmtP((parseFloat(it.total_price_cur) || 0) * (1 + (parseFloat(it.tax_rate) || 0) / 100))}</span>
            </div>
        </div>`;
    }).join('');

    // When coming from a bekleyen page, go straight into batch category mode for all items
    const _fromParam = (typeof location !== 'undefined')
        ? (new URLSearchParams(location.search).get('from') || '')
        : '';
    const _isBekleyen = _fromParam === 'bekleyen-gelen';

    if (_isBekleyen && items.length > 0) {
        setTimeout(() => enterBatchCategoryMode(id, true), 10);
        return;
    }

    setTimeout(() => {
        body.innerHTML = `${warnHtml}
            <div style="display:flex;flex-direction:column;gap:6px;padding:12px;">
                ${cards || '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px;">Ürün bulunamadı</div>'}
            </div>
            <div class="det-actions" style="padding:0 12px 12px;">
                <button class="fatura-action-btn fatura-action-btn--primary" onclick="enterUrunlerEdit('${id}')">✏️ Düzenle</button>
            </div>`;
    }, 10);
}

// ─── 2. enterUrunlerEdit ──────────────────────────────────────────────────────
function enterUrunlerEdit(id) {
    const { inv, body } = _findInvAndBody(id);
    if (!inv || !body) return;

    const items = inv.invoice_items || [];
    let _openIdx = null;

    // Pre-load brand/model data
    ensureBrandModelLoaded().catch(() => { });

    const fmtP = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function buildItem(it, idx) {
        const isInt = !!it.is_internal;
        const code = String(it.product_code || it.sku || '').trim();
        const name = String(it.product_name || '').replace(/</g, '&lt;');
        const brand = String(it.brand_name || it.brand || '').replace(/"/g, '&quot;');
        const model = String(it.model || '').replace(/"/g, '&quot;');
        const qty = parseFloat(it.quantity) || 0;
        const price = parseFloat(it.unit_price_cur) || 0;

        return `<div class="ue-acc-item" data-idx="${idx}"
            style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:visible;transition:border-color 0.15s;">
 
            <!-- Collapsed header -->
            <div class="ue-acc-hdr" style="display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;user-select:none;">
                <i class="ti ti-chevron-right ue-chev" style="font-size:14px;color:#94a3b8;transition:transform 0.2s;flex-shrink:0;"></i>
                <div style="flex:1;min-width:0;">
                    <div class="ue-hdr-name" style="font-size:13px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name || '—'}</div>
                    <div style="display:flex;gap:6px;margin-top:3px;align-items:center;">
                        ${code ? `<span style="font-size:11px;font-weight:700;color:#2563eb;font-family:'Geist Mono',monospace;">${code}</span>` : ''}
                        <span style="font-size:11px;color:#94a3b8;">× ${qty}</span>
                        ${isInt ? `<span style="font-size:11px;color:#7c3aed;font-weight:700;">Ofis İçi</span>` : ''}
                    </div>
                </div>
                <span class="ue-hdr-total" style="font-size:13px;font-weight:800;color:#2563eb;white-space:nowrap;flex-shrink:0;">${fmtP(qty * price)}</span>
                <button type="button" class="ue-del-btn"
                    style="width:28px;height:28px;border:none;border-radius:6px;background:#fee2e2;color:#ef4444;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;"
                    title="Sil">✕</button>
            </div>
 
            <!-- Expanded body -->
            <div class="ue-acc-body" style="display:none;padding:0 12px 14px;border-top:1px solid #f1f5f9;">
 
                <!-- Row 1: SKU + Name -->
                <div style="display:grid;grid-template-columns:140px 1fr;gap:8px;margin-top:12px;margin-bottom:8px;">
                    <div>
                        <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">SKU / Kod</label>
                        <input class="det-edit-input ue-code" value="${code.replace(/"/g, '&quot;')}" placeholder="Ürün kodu"
                            style="width:100%;font-family:'Geist Mono',monospace;font-size:12px;color:#2563eb;font-weight:700;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;outline:none;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Ürün Adı</label>
                        <input class="det-edit-input ue-name" value="${String(it.product_name || '').replace(/"/g, '&quot;')}" placeholder="Ürün adı"
                            style="width:100%;font-size:12px;font-weight:600;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;outline:none;box-sizing:border-box;">
                    </div>
                </div>
 
                <!-- Row 2: Qty + Price + Total -->
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
                    <div>
                        <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Miktar</label>
                        <input class="det-edit-input ue-qty" type="number" step="any" min="0" value="${qty}"
                            style="width:100%;font-size:12px;text-align:right;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;outline:none;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Birim Fiyat</label>
                        <input class="det-edit-input ue-price" type="number" step="any" min="0" value="${price}"
                            style="width:100%;font-size:12px;text-align:right;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;outline:none;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Toplam</label>
                        <div class="ue-total" style="font-size:13px;font-weight:800;color:#2563eb;padding:7px 10px;background:#eff6ff;border-radius:8px;text-align:right;">${fmtP(qty * price)}</div>
                    </div>
                </div>
 
                <!-- Row 3: Ofis İçi + Kategori + Marka + Model -->
                <div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:8px;align-items:start;">
                    <div>
                        <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Ofis İçi</label>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 10px;background:#f5f3ff;border-radius:8px;white-space:nowrap;">
                            <input type="checkbox" class="ue-isint-chk" ${isInt ? 'checked' : ''}
                                style="width:14px;height:14px;accent-color:#7c3aed;">
                            <span style="font-size:12px;font-weight:700;color:#7c3aed;">Ofis İçi</span>
                        </label>
                    </div>
                    <div>
                        <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Kategori</label>
                        <div class="ue-cat-wrap" style="position:relative;"></div>
                    </div>
                    <div>
                        <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Marka</label>
                        <div class="ue-brand-wrap" style="position:relative;"></div>
                    </div>
                    <div>
                        <label style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;display:block;margin-bottom:4px;">Model</label>
                        <div class="ue-model-wrap" style="position:relative;"></div>
                    </div>
                </div>
 
            </div>
        </div>`;
    }

    body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;padding:12px;" id="ueList_${id}">
            ${items.length ? items.map((it, i) => buildItem(it, i)).join('') : '<div style="padding:20px;text-align:center;color:#94a3b8;font-size:13px;">Ürün bulunamadı</div>'}
        </div>
        <div class="det-actions" style="padding:0 12px 12px;justify-content:space-between;">
            <button class="fatura-action-btn" onclick="switchFatDetailTab('${id}','urunler')">İptal</button>
            <button class="fatura-action-btn fatura-action-btn--primary" onclick="saveUrunlerEdit('${id}')">💾 Kaydet</button>
        </div>`;

    const listEl = document.getElementById(`ueList_${id}`);
    if (!listEl) return;

    listEl.querySelectorAll('.ue-acc-item').forEach(item => {
        const idx = parseInt(item.dataset.idx);
        const it = items[idx] || {};
        const isInt = !!it.is_internal;
        const code = String(it.product_code || it.sku || '').trim();
        const curCat = isInt
            ? (it.item_subcategory || '')
            : (it.category || productCategoryByCodeMap?.get(normalizeProductCodeForMatch(code)) || '');
        const curBrand = it.brand_name || it.brand || '';
        const curModel = it.model || '';

        const hdr = item.querySelector('.ue-acc-hdr');
        const bodyEl = item.querySelector('.ue-acc-body');
        const chev = item.querySelector('.ue-chev');
        const delBtn = item.querySelector('.ue-del-btn');
        const chk = item.querySelector('.ue-isint-chk');
        const catWrap = item.querySelector('.ue-cat-wrap');
        const brandWrap = item.querySelector('.ue-brand-wrap');
        const modelWrap = item.querySelector('.ue-model-wrap');
        const qtyInp = item.querySelector('.ue-qty');
        const priceInp = item.querySelector('.ue-price');
        const totalEl = item.querySelector('.ue-total');
        const hdrTotal = item.querySelector('.ue-hdr-total');
        const hdrName = item.querySelector('.ue-hdr-name');
        const nameInp = item.querySelector('.ue-name');
        const codeInp = item.querySelector('.ue-code');

        // Toggle accordion
        hdr.addEventListener('click', e => {
            if (delBtn.contains(e.target)) return;
            const isOpen = bodyEl.style.display !== 'none';
            if (isOpen) {
                bodyEl.style.display = 'none';
                chev.style.transform = '';
                item.style.borderColor = '#e2e8f0';
                _openIdx = null;
            } else {
                if (_openIdx !== null) {
                    const prev = listEl.querySelector(`.ue-acc-item[data-idx="${_openIdx}"]`);
                    if (prev) {
                        prev.querySelector('.ue-acc-body').style.display = 'none';
                        prev.querySelector('.ue-chev').style.transform = '';
                        prev.style.borderColor = '#e2e8f0';
                    }
                }
                bodyEl.style.display = 'block';
                chev.style.transform = 'rotate(90deg)';
                item.style.borderColor = '#2563eb';
                _openIdx = idx;
            }
        });

        // Delete
        delBtn.addEventListener('click', e => { e.stopPropagation(); item.remove(); });

        // Init dropdowns
        _makeCategoryDropdown(catWrap, isInt, curCat, () => { }, code);
        _makeBrandDropdown(brandWrap, curBrand, (newBrand) => {
            // When brand changes, rebuild model dropdown
            if (modelWrap._getValue) {
                const curModel2 = modelWrap._getValue();
                _makeModelDropdown(modelWrap, curModel2, () => brandWrap._getValue?.() || '');
            }
        });
        _makeModelDropdown(modelWrap, curModel, () => brandWrap._getValue?.() || '');

        // Ofis İçi toggle → rebuild category
        chk?.addEventListener('change', () => {
            const nowInt = chk.checked;
            const currentCat = catWrap?._getValue?.() || '';
            const activeSku = codeInp?.value?.trim() || '';
            _makeCategoryDropdown(catWrap, nowInt, nowInt ? '' : currentCat, () => { }, activeSku);
        });

        // SKU blur → auto-fill name, category, brand, model from DB
        codeInp?.addEventListener('blur', async () => {
            const sku = codeInp.value.trim();
            if (!sku || chk?.checked) return;

            try {
                const res = await fetch(`/api/products/by-code?code=${encodeURIComponent(sku)}`);
                if (!res.ok) return;
                const p = await res.json();

                if (p.product_name && nameInp) {
                    nameInp.value = p.product_name;
                    if (hdrName) hdrName.textContent = p.product_name;
                }
                if (p.category && catWrap?._setValue) catWrap._setValue(p.category);

                if (p.brand && brandWrap?._setValue) brandWrap._setValue(p.brand);
                if (p.model && modelWrap?._setValue) modelWrap._setValue(p.model);
            } catch (e) {
                // ürün bulunamazsa sessizce geç
            }
        });

        // Total recalc
        const updateTotal = () => {
            const q = parseFloat(qtyInp?.value) || 0;
            const p = parseFloat(priceInp?.value) || 0;
            const t = fmtP(q * p);
            if (totalEl) totalEl.textContent = t;
            if (hdrTotal) hdrTotal.textContent = t;
        };
        qtyInp?.addEventListener('input', updateTotal);
        priceInp?.addEventListener('input', updateTotal);

        // Sync header name
        nameInp?.addEventListener('input', () => {
            if (hdrName) hdrName.textContent = nameInp.value || '—';
        });
    });
}

// ─── 3. saveUrunlerEdit ───────────────────────────────────────────────────────
async function saveUrunlerEdit(id) {
    const { inv } = _findInvAndBody(id);
    if (!inv) return;

    const listEl = document.getElementById(`ueList_${id}`);
    if (!listEl) return;

    const originalItems = inv.invoice_items || [];
    const updatedItems = [];

    listEl.querySelectorAll('.ue-acc-item').forEach(item => {
        const idx = parseInt(item.dataset.idx);
        const orig = originalItems[idx] || {};
        const qty = parseFloat(item.querySelector('.ue-qty')?.value) || 0;
        const price = parseFloat(item.querySelector('.ue-price')?.value) || 0;
        const name = item.querySelector('.ue-name')?.value?.trim() || '';
        const code = item.querySelector('.ue-code')?.value?.trim() || null;
        const isInternal = !!item.querySelector('.ue-isint-chk')?.checked;
        const catWrap = item.querySelector('.ue-cat-wrap');
        const brandWrap = item.querySelector('.ue-brand-wrap');
        const modelWrap = item.querySelector('.ue-model-wrap');
        const catVal = catWrap?._getValue?.() || '';
        const brandVal = brandWrap?._getValue?.() || '';
        const modelVal = modelWrap?._getValue?.() || '';

        if (qty > 0 && name) {
            updatedItems.push({
                ...orig,
                product_name: name,
                product_code: code,
                quantity: qty,
                unit_price_cur: price,
                total_price_cur: qty * price,
                is_internal: isInternal,
                brand_name: brandVal || null,
                model: modelVal || null,
                product_category: isInternal ? null : (catVal || null),  // ← for syncInvoiceItemInternalMeta
                item_subcategory: isInternal ? (catVal || null) : (orig.item_subcategory ?? null),
            });
        }
    });

    const btn = document.querySelector(`[onclick="saveUrunlerEdit('${id}')"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor...'; }

    try {
        const res = await fetch(`/api/invoices/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                update_stock: true,
                invoice: { due_date: inv.due_date, notes: inv.notes },
                company: {
                    vkn_tckn: inv.companies?.vkn_tckn || '',
                    name: inv.companies?.name || '',
                    tax_office: inv.companies?.tax_office || '',
                    phone: inv.companies?.phone || '',
                    email: inv.companies?.email || '',
                    website: inv.companies?.website || '',
                    address: inv.companies?.address || ''
                },
                items: updatedItems
            })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Güncelleme hatası');

        inv.invoice_items = updatedItems;
        if (typeof clearStockCaches === 'function') clearStockCaches();

        if (typeof loadInvoice === 'function') {
            await loadInvoice(id);
        } else {
            switchFatDetailTab(id, 'urunler');
            if (typeof refreshData === 'function') refreshData(true);
        }
    } catch (e) {
        alert('Hata: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = '💾 Kaydet'; }
    }
}

// ─── Eski detay tab (geriye uyumluluk) ───────────────────────────────────────

function switchDetailTab(n) {
    const btn1 = document.getElementById('detailTabBtn1');
    const btn2 = document.getElementById('detailTabBtn2');
    const tab1 = document.getElementById('detailTab1');
    const tab2 = document.getElementById('detailTab2');
    if (!btn1 || !btn2 || !tab1 || !tab2) return;

    lastActiveDetailTab = n;
    btn1.classList.toggle('active', n === 1);
    btn2.classList.toggle('active', n === 2);
    tab1.style.display = n === 1 ? 'flex' : 'none';
    tab2.style.display = n === 2 ? 'block' : 'none';

    if (n === 1) loadPdfTab();
}

async function loadPdfTab() {
    const inv = currentDetailInvId ? (allInvoicesCache || []).find(i => i.id === currentDetailInvId) : null;
    const noXml = document.getElementById('pdfNoXml');
    const loading = document.getElementById('pdfLoading');
    const iframe = document.getElementById('pdfDetailIframe');
    if (!noXml || !loading || !iframe) return;

    noXml.style.display = 'none';
    loading.style.display = 'none';
    iframe.style.display = 'none';

    if (!inv || !inv.xml_url || inv.approval_status !== 'pending') {
        noXml.style.display = 'flex';
        return;
    }

    loading.style.display = 'flex';
    try {
        const res = await fetch(inv.xml_url);
        if (!res.ok) throw new Error('XML dosyası alınamadı (' + res.status + ')');
        const xmlText = await res.text();
        await renderXmlToPdfIframe(xmlText, iframe);
        loading.style.display = 'none';
        iframe.style.display = 'block';
    } catch (err) {
        loading.style.display = 'none';
        const msgEl = noXml.querySelector('p');
        if (msgEl) msgEl.textContent = 'Hata: ' + err.message;
        noXml.style.display = 'flex';
    }
}

// ─── XML → PDF render ─────────────────────────────────────────────────────────

async function renderXmlToPdfIframe(xmlString, iframe) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    const nodes = xmlDoc.getElementsByTagName('cbc:EmbeddedDocumentBinaryObject');
    let base64Xslt = null;
    for (let i = 0; i < nodes.length; i++) {
        const fn = nodes[i].getAttribute('filename') || '';
        if (fn.toLowerCase().endsWith('.xslt')) { base64Xslt = nodes[i].textContent; break; }
    }
    if (!base64Xslt && nodes.length > 0) base64Xslt = nodes[0].textContent;
    if (!base64Xslt) throw new Error('XML içinde XSLT şablonu bulunamadı.');

    const decodedXslt = decodeURIComponent(escape(window.atob(base64Xslt))).replace(/^﻿/, '');
    const xsltDoc = parser.parseFromString(decodedXslt, 'text/xml');
    const proc = new XSLTProcessor();
    proc.importStylesheet(xsltDoc);
    const fragment = proc.transformToFragment(xmlDoc, document);
    if (!fragment) throw new Error('XSLT dönüşümü başarısız oldu.');

    const html = new XMLSerializer().serializeToString(fragment);
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();
}

// ─── Toplu Kategori Atama ─────────────────────────────────────────────────────

const _batchCatState = {};  // invoiceId → { itemId: category }

function enterBatchCategoryMode(id, allItems) {
    const { inv, body } = _findInvAndBody(id);
    if (!inv || !body) return;

    const internalItems = allItems
        ? (inv.invoice_items || [])
        : (inv.invoice_items || []).filter(it => !!it.is_internal);
    if (!internalItems.length) return;

    // Seed pending state from current values
    _batchCatState[id] = {};
    internalItems.forEach(it => { _batchCatState[id][it.id] = it.item_subcategory || ''; });

    function buildRows() {
        return internalItems.map(it => {
            const cat  = _batchCatState[id][it.id] || '';
            const name = String(it.product_name || '').replace(/</g, '&lt;');
            const code = String(it.product_code || it.sku || '').trim();
            return `<label class="bcat-row" style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;cursor:pointer;user-select:none;" onclick="event.preventDefault();this.querySelector('.bcat-chk').click();">
                <input type="checkbox" class="bcat-chk" data-itemid="${it.id}"
                    style="width:16px;height:16px;accent-color:#7c3aed;flex-shrink:0;cursor:pointer;" onclick="event.stopPropagation();">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name || '—'}</div>
                    ${code ? `<div style="font-size:11px;font-weight:700;color:#2563eb;font-family:'Geist Mono',monospace;margin-top:2px;">${code}</div>` : ''}
                </div>
                <span class="bcat-cur" data-itemid="${it.id}"
                    style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:6px;white-space:nowrap;flex-shrink:0;${cat ? 'background:#eff6ff;color:#2563eb;' : 'background:#f1f5f9;color:#94a3b8;'}">
                    ${cat ? cat.replace(/</g, '&lt;') : 'Kategori yok'}
                </span>
            </label>`;
        }).join('');
    }

    const catOptions = (_internalCategoryOptions || []);
    const optHtml = catOptions.map(o => `<option value="${o.replace(/"/g, '&quot;')}">${o}</option>`).join('');

    body.innerHTML = `
        <div style="padding:12px;display:flex;flex-direction:column;gap:10px;">
            <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:10px 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <span style="font-size:12px;font-weight:700;color:#7c3aed;white-space:nowrap;">Seçilenlere uygula:</span>
                <select id="batchCatSelect_${id}" style="flex:1;min-width:140px;height:32px;padding:0 8px;border:1px solid #c4b5fd;border-radius:8px;background:#fff;color:#1e293b;font-size:12px;font-weight:600;font-family:inherit;outline:none;cursor:pointer;">
                    <option value="">— Kategori seçin —</option>
                    ${optHtml}
                </select>
                <button onclick="applyBatchCategory('${id}')"
                    style="height:32px;padding:0 14px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;">
                    Seçilenlere Uygula
                </button>
                <button onclick="selectAllBatchItems('${id}')"
                    style="height:32px;padding:0 12px;background:#f5f3ff;color:#7c3aed;border:1px solid #c4b5fd;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap;">
                    Tümünü Seç
                </button>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;" id="bcatList_${id}">
                ${buildRows()}
            </div>
        </div>
        <div class="det-actions" style="padding:0 12px 12px;justify-content:space-between;">
            <div style="display:flex;gap:6px;">
                <button class="fatura-action-btn" onclick="switchFatDetailTab('${id}','urunler')">İptal</button>
                <button class="fatura-action-btn" onclick="enterUrunlerEdit('${id}')">✏️ Düzenle</button>
            </div>
            <button class="fatura-action-btn fatura-action-btn--primary" onclick="saveBatchCategoryAssignments('${id}')">💾 Kaydet</button>
        </div>`;
}

function applyBatchCategory(id) {
    const sel = document.getElementById(`batchCatSelect_${id}`);
    const cat = sel?.value || '';
    if (!cat) { alert('Lütfen önce bir kategori seçin.'); return; }

    const list = document.getElementById(`bcatList_${id}`);
    if (!list) return;

    let count = 0;
    list.querySelectorAll('.bcat-chk:checked').forEach(chk => {
        const itemId = chk.dataset.itemid;
        _batchCatState[id][itemId] = cat;
        const badge = list.querySelector(`.bcat-cur[data-itemid="${itemId}"]`);
        if (badge) {
            badge.textContent = cat;
            badge.style.background = '#eff6ff';
            badge.style.color = '#2563eb';
        }
        chk.checked = false;
        count++;
    });

    if (!count) alert('Lütfen önce satırları işaretleyin.');
}

function selectAllBatchItems(id) {
    const list = document.getElementById(`bcatList_${id}`);
    if (!list) return;
    const allChecked = [...list.querySelectorAll('.bcat-chk')].every(c => c.checked);
    list.querySelectorAll('.bcat-chk').forEach(c => { c.checked = !allChecked; });
}

async function saveBatchCategoryAssignments(id) {
    const state = _batchCatState[id];
    if (!state) return;

    // Auto-apply any currently checked+selected items before saving
    const sel = document.getElementById(`batchCatSelect_${id}`);
    const pendingCat = sel?.value || '';
    if (pendingCat) {
        const list = document.getElementById(`bcatList_${id}`);
        list?.querySelectorAll('.bcat-chk:checked').forEach(chk => {
            const itemId = chk.dataset.itemid;
            state[itemId] = pendingCat;
            const badge = list.querySelector(`.bcat-cur[data-itemid="${itemId}"]`);
            if (badge) { badge.textContent = pendingCat; badge.style.background = '#eff6ff'; badge.style.color = '#2563eb'; }
        });
    }

    const assignments = Object.entries(state)
        .filter(([, cat]) => cat)
        .map(([item_id, item_subcategory]) => ({ item_id, item_subcategory }));

    if (!assignments.length) { alert('Kaydedilecek kategori atama bulunamadı.'); return; }

    const btn = document.querySelector(`[onclick="saveBatchCategoryAssignments('${id}')"]`);
    if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor...'; }

    try {
        const res = await fetch(`/api/invoices/${id}/items/batch-category`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignments })
        });
        const result = await res.json();
        if (!res.ok || result.ok === false) throw new Error((result.errors?.[0]?.error) || 'Kaydetme hatası');

        // Update in-memory cache
        const { inv } = _findInvAndBody(id);
        if (inv?.invoice_items) {
            inv.invoice_items.forEach(it => {
                if (state[it.id] !== undefined) {
                    it.item_subcategory = state[it.id] || null;
                    it.is_internal = !!state[it.id];
                }
            });
        }

        delete _batchCatState[id];
        switchFatDetailTab(id, 'urunler');
    } catch (e) {
        alert('Hata: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = '💾 Kaydet'; }
    }
}
