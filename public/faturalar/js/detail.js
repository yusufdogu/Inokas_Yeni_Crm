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
                <button class="fat-dtab${curTab === 'bilgiler'  ? ' fat-dtab--active' : ''}" onclick="switchFatDetailTab('${id}','bilgiler')">Fatura Bilgileri</button>
                <button class="fat-dtab${curTab === 'urunler'   ? ' fat-dtab--active' : ''}" onclick="switchFatDetailTab('${id}','urunler')">Fatura Ürünleri</button>
            </div>
            <div class="fat-dtab-body" id="fatDtabBody_${id}"></div>
        </div>
    </div>`;

    loadDetailPdf(id, inv);
    renderDetailTabContent(id, curTab, inv);
}

async function loadDetailPdf(id, inv) {
    const empty  = document.getElementById(`fatDetailPdfEmpty_${id}`);
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
        const res     = await fetch(inv.xml_url);
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
        const nodes  = xmlDoc.getElementsByTagName('cbc:EmbeddedDocumentBinaryObject');
        for (let i = 0; i < nodes.length; i++) {
            const fn       = (nodes[i].getAttribute('filename') || '').toLowerCase();
            const mime     = (nodes[i].getAttribute('mimeCode') || '').toLowerCase();
            if (!fn.endsWith('.pdf') && mime !== 'application/pdf') continue;
            const b64 = nodes[i].textContent.trim();
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
            _embeddedPdfCache[id] = url;
            return url;
        }
    } catch (_) {}
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
    if (tab === 'urunler')  { renderUrunlerView(id, body, inv); return; }
}

function closeInvoiceDetailModal() { /* artık inline tab sistemi kullanılıyor */ }

// ─── Bilgiler sekmesi ─────────────────────────────────────────────────────────

function _findInvAndBody(id) {
    const sid  = String(id);
    let inv = (allInvoicesCache || []).find(i => String(i.id) === sid) || (typeof bekleyenCache !== 'undefined' ? bekleyenCache : []).find(i => String(i.id) === sid);
    let body   = document.getElementById(`fatDtabBody_${sid}`)
             || document.getElementById('fatDetailTabBody');
    if (!inv || !body) {
        const bekInv  = bekleyenCache.find(i => String(i.id) === sid);
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
        const bg   = opts.accent ? 'background:#eff6ff; border-color:#bfdbfe;' : 'background:#f8fafc;';
        const vc   = opts.accent ? 'color:#2563eb;' : 'color:#0f172a;';
        const vs   = opts.large  ? 'font-size:15px;' : 'font-size:13px;';
        const v    = value != null && value !== '' ? String(value).replace(/</g, '&lt;') : '—';
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

    const netVal  = invNetAmountSrc(inv);
    const taxVal  = invTaxAmountSrc(inv);
    const totalVal = invPayableAmountSrc(inv);
    const kurVal  = invCalculationRate(inv);

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
    const netEl     = document.getElementById('edit_net');
    const taxEl     = document.getElementById('edit_tax');
    const curSel    = document.getElementById('edit_currency');
    const totalDisp = document.getElementById('bilgilerTotalDisplay');

    const updateTotal = () => {
        const net   = parseFloat(netEl?.value)  || 0;
        const tax   = parseFloat(taxEl?.value)  || 0;
        const total = net + tax;
        const lbl   = curSel?.value || currLabel;
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

    const invoice_no   = document.getElementById('edit_invoice_no')?.value?.trim()   || inv.invoice_no  || '';
    const invoice_date = document.getElementById('edit_invoice_date')?.value         || inv.invoice_date || null;
    const invoice_type = document.getElementById('edit_invoice_type')?.value         || inv.invoice_type || 'Ticari';
    const currency_val = document.getElementById('edit_currency')?.value             || invDisplayCurrencyLabel(inv);
    const kur_raw      = parseFloat(document.getElementById('edit_kur')?.value);
    const calc_rate    = Number.isFinite(kur_raw) && kur_raw > 0 ? kur_raw : invCalculationRate(inv);
    const net_cur      = parseFloat(document.getElementById('edit_net')?.value)      || 0;
    const tax_cur      = parseFloat(document.getElementById('edit_tax')?.value)      || 0;
    const payable_cur  = net_cur + tax_cur;
    const due_date     = document.getElementById('edit_due_date')?.value             || null;
    const phone        = document.getElementById('edit_phone')?.value?.trim()        || '';
    const email        = document.getElementById('edit_email')?.value?.trim()        || '';
    const website      = document.getElementById('edit_website')?.value?.trim()      || '';
    const address      = document.getElementById('edit_address')?.value?.trim()      || '';
    const notes        = document.getElementById('edit_notes')?.value                || '';
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
                    total_tax_exclusive_tl: net_cur  * calc_rate,
                    tax_amount_tl:          tax_cur  * calc_rate,
                    payable_amount_tl:      payable_cur * calc_rate
                },
                company: {
                    vkn_tckn:   inv.companies?.vkn_tckn   || '',
                    name:       company_name,
                    tax_office: inv.companies?.tax_office  || '',
                    phone, email, website, address
                },
                items: inv.invoice_items || []
            })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Güncelleme hatası');

        // Update in-memory cache
        inv.invoice_no              = invoice_no;
        inv.invoice_date            = invoice_date;
        inv.invoice_type            = invoice_type;
        inv.currency                = currency_val;
        inv.base_currency           = baseIso;
        inv.calculation_rate        = calc_rate;
        inv.total_tax_exclusive_cur = net_cur;
        inv.tax_amount_tl           = tax_cur  * calc_rate;
        inv.payable_amount_cur      = payable_cur;
        inv.payable_amount_tl       = payable_cur * calc_rate;
        inv.due_date                = due_date;
        inv.notes                   = notes;
        if (inv.companies) {
            inv.companies.name    = company_name;
            inv.companies.phone   = phone;
            inv.companies.email   = email;
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

// ─── Ürünler sekmesi ──────────────────────────────────────────────────────────

async function renderUrunlerView(id, body, inv) {
    const items = inv.invoice_items || [];

    let warnHtml = '';
    try {
        await ensureProductCodeLookupSetLoaded();
        const missing = [...new Set(
            items.map(it => String(it.product_code || it.sku || '').trim())
                .filter(Boolean)
                .filter(s => !isInProductCodeLookup(s))
        )];
        if (missing.length) {
            warnHtml = `<div class="det-sku-warn"><strong>⚠️ Yeni ürün kodu olabilir</strong><br>
            ${missing.join(', ')} — products tablosunda kayıtlı değil.</div>`;
        }
    } catch (e) { }

    try { await ensureProductCategoryLookupLoaded(); } catch (e) { }

    const fmtP = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const row = (label, value, valueStyle = '') =>
        `<div style="display:flex; justify-content:space-between; align-items:baseline; padding:4px 0; border-bottom:1px solid #f1f5f9;">
            <span style="font-size:11px; color:#94a3b8; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; flex-shrink:0;">${label}</span>
            <span style="font-size:12px; color:#1e293b; font-weight:500; text-align:right; ${valueStyle}">${value}</span>
        </div>`;

    const cards = items.map(it => {
        const isInt = !!it.is_internal;
        const code  = String(it.product_code || it.sku || '').trim();
        const name  = String(it.product_name || '').trim();
        const cat   = isInt
            ? (it.internal_category || '—')
            : (productCategoryByCodeMap?.get(normalizeProductCodeForMatch(code)) || '—');

        return `<div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:0;">
            <div style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:8px; line-height:1.4;">${name.replace(/</g, '&lt;') || '—'}</div>
            ${row('Ürün Kodu', code || '—', 'color:#2563eb; font-weight:700;')}
            ${row('Miktar', `${it.quantity || 0}`)}
            ${row('Birim Fiyat', fmtP(it.unit_price_cur))}
            ${row('Toplam', fmtP(it.total_price_cur), 'font-weight:700;')}
            ${row('Ofis İçi', isInt ? '<span style="color:#7c3aed; font-weight:700;">✓</span>' : '—')}
            ${row('Kategori', isInt ? `<em style="color:#7c3aed;">${cat}</em>` : cat)}
        </div>`;
    }).join('');

    const finalHtml = `${warnHtml}
        <div style="display:flex; flex-direction:column; gap:8px; padding:12px;">
            ${cards || '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:13px;">Ürün bulunamadı</div>'}
        </div>
        <div class="det-actions" style="padding:0 12px 12px;">
            <button class="fatura-action-btn fatura-action-btn--primary" onclick="enterUrunlerEdit('${id}')">✏️ Düzenle</button>
        </div>`;

    setTimeout(() => {
        body.innerHTML = finalHtml;
    }, 10);
}

function enterUrunlerEdit(id) {
    const { inv, body } = _findInvAndBody(id);
    if (!inv || !body) return;

    const items = inv.invoice_items || [];
    const fmtP  = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtPN = n => (parseFloat(n) || 0).toFixed(4); // for inputs

    const row = (label, inputHtml) =>
        `<div style="display:flex; justify-content:space-between; align-items:baseline; padding:4px 0; border-bottom:1px solid #f1f5f9;">
            <span style="font-size:11px; color:#94a3b8; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; flex-shrink:0;">${label}</span>
            <span style="font-size:12px; color:#1e293b; font-weight:500; text-align:right; flex:1; display:flex; justify-content:flex-end;">${inputHtml}</span>
        </div>`;

    const cards = items.map((it, idx) => {
        const isInt  = !!it.is_internal;
        const code   = String(it.product_code || it.sku || '').trim();
        const name   = String(it.product_name || '').replace(/"/g, '&quot;');
        const curCat = isInt
            ? (it.internal_category || '')
            : (productCategoryByCodeMap?.get(normalizeProductCodeForMatch(code)) || '');

        return `<div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:0;"
                    data-idx="${idx}" data-internal="${isInt ? 1 : 0}">
            
            <div style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:8px; line-height:1.4;">
                <input class="det-edit-input ue-name" value="${name}" style="font-size:13px; font-weight:700; color:#0f172a; width:100%; border:none; background:transparent; padding:2px 0; margin:0; outline:none; border-bottom:1px dashed #cbd5e1; font-family:inherit;">
            </div>

            ${row('Ürün Kodu', `<input class="det-edit-input ue-code" value="${code.replace(/"/g, '&quot;')}" style="color:#2563eb; font-weight:700; width:100%; max-width:160px; text-align:right; border:none; background:transparent; border-bottom:1px dashed #cbd5e1; outline:none; font-family:inherit; padding:2px;">`)}
            
            ${row('Miktar', `<input class="det-edit-input ue-qty" type="number" step="any" min="0" value="${parseFloat(it.quantity) || 0}" style="width:80px; text-align:right; border:none; background:transparent; border-bottom:1px dashed #cbd5e1; outline:none; font-family:inherit; padding:2px;">`)}
            
            ${row('Birim Fiyat', `<input class="det-edit-input ue-price" type="number" step="any" min="0" value="${fmtPN(it.unit_price_cur)}" style="width:100px; text-align:right; border:none; background:transparent; border-bottom:1px dashed #cbd5e1; outline:none; font-family:inherit; padding:2px;">`)}
            
            ${row('Toplam', `<span class="ue-total" style="font-weight:700; padding:2px;">${fmtP(it.total_price_cur)}</span>`)}
            
            ${row('Ofis İçi', `<label style="cursor:pointer; display:flex; align-items:center; gap:6px; justify-content:flex-end;">
                  <input type="checkbox" class="ue-isint-chk" ${isInt ? 'checked' : ''} style="width:14px; height:14px;">
                  <span style="color:#7c3aed; font-weight:700;">✓</span>
               </label>`)}
               
            ${row('Kategori', `
                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
                    <select class="det-edit-input ue-cat-select" style="text-align:left; border:none; border-bottom:1px dashed #cbd5e1; background:transparent; outline:none; max-width:180px; font-family:inherit; padding:2px; color:#1e293b;"></select>
                    <div class="ue-cat-quick" style="display:none; align-items:center; gap:4px; margin-top:4px;">
                        <input class="det-edit-input ue-cat-input" placeholder="Kategori yazın" style="font-size:11px; width:120px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px;">
                        <button type="button" class="ue-cat-save" style="width:24px;height:24px;border:none;border-radius:4px;background:#16a34a;color:#fff;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;">✓</button>
                        <button type="button" class="ue-cat-cancel" style="width:24px;height:24px;border:none;border-radius:4px;background:#ef4444;color:#fff;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
                    </div>
                </div>
            `)}
        </div>`;
    }).join('');

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px; padding:12px;" id="ueCards_${id}">
            ${cards || '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:13px;">Ürün bulunamadı</div>'}
        </div>
        <div class="det-actions" style="padding:0 12px 12px;">
            <button class="fatura-action-btn fatura-action-btn--primary" onclick="saveUrunlerEdit('${id}')">💾 Kaydet</button>
            <button class="fatura-action-btn" onclick="switchFatDetailTab('${id}','urunler')">İptal</button>
        </div>`;

    const container = document.getElementById(`ueCards_${id}`);
    if (!container) return;

    container.querySelectorAll('[data-idx]').forEach((card) => {
        const idx    = parseInt(card.dataset.idx);
        const isInt  = card.dataset.internal === '1';
        const it     = items[idx] || {};
        const code   = String(it.product_code || it.sku || '').trim();
        const curCat = isInt
            ? (it.internal_category || '')
            : (productCategoryByCodeMap?.get(normalizeProductCodeForMatch(code)) || '');

        const chk       = card.querySelector('.ue-isint-chk');
        const catSel    = card.querySelector('.ue-cat-select');
        const quickWrap = card.querySelector('.ue-cat-quick');
        const catInput  = card.querySelector('.ue-cat-input');
        const catSave   = card.querySelector('.ue-cat-save');
        const catCancel = card.querySelector('.ue-cat-cancel');

        // Checkbox event
        if (chk) {
            chk.addEventListener('change', () => {
                const nowInt = chk.checked;
                card.dataset.internal = nowInt ? '1' : '0';
                if (catSel) {
                    renderRowCategorySelect(catSel, nowInt, nowInt ? '' : catSel.value);
                }
            });
        }

        if (catSel) {
            renderRowCategorySelect(catSel, isInt, curCat);
            catSel.addEventListener('change', () => {
                if (catSel.value !== '__add_new_category__') return;
                catSel.value = '';
                if (quickWrap) quickWrap.style.display = 'flex';
                if (catInput) { catInput.value = ''; catInput.focus(); }
            });
        }
        
        catSave?.addEventListener('click', () => {
            const next = String(catInput?.value || '').trim();
            if (!next) return;
            if (!productCategoryOptionList.includes(next)) {
                productCategoryOptionList.push(next);
                productCategoryOptionList.sort((a, b) => a.localeCompare(b, 'tr'));
            }
            if (catSel) renderRowCategorySelect(catSel, false, next);
            if (quickWrap) quickWrap.style.display = 'none';
        });
        
        catCancel?.addEventListener('click', () => {
            if (quickWrap) quickWrap.style.display = 'none';
        });

        const qtyInput   = card.querySelector('.ue-qty');
        const priceInput = card.querySelector('.ue-price');
        const totalSpan  = card.querySelector('.ue-total');

        const updateTot = () => {
            const q = parseFloat(qtyInput?.value) || 0;
            const p = parseFloat(priceInput?.value) || 0;
            if (totalSpan) totalSpan.textContent = (q * p).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        qtyInput?.addEventListener('input', updateTot);
        priceInput?.addEventListener('input', updateTot);
    });
}

async function saveUrunlerEdit(id) {
    const { inv } = _findInvAndBody(id);
    if (!inv) return;

    const container = document.getElementById(`ueCards_${id}`);
    if (!container) return;

    const originalItems = inv.invoice_items || [];
    const updatedItems  = [];
    container.querySelectorAll('[data-idx]').forEach((card, idx) => {
        const orig       = originalItems[idx] || {};
        const qty        = parseFloat(card.querySelector('.ue-qty')?.value)   || 0;
        const price      = parseFloat(card.querySelector('.ue-price')?.value)  || 0;
        const name       = card.querySelector('.ue-name')?.value?.trim()       || '';
        const code       = card.querySelector('.ue-code')?.value?.trim()       || null;
        const isInternal = card.dataset.internal === '1';
        const catVal     = card.querySelector('.ue-cat-select')?.value         || '';
        if (qty > 0 && name) {
            updatedItems.push({
                ...orig,
                product_name:    name,
                product_code:    code,
                quantity:        qty,
                unit_price_cur:  price,
                total_price_cur: qty * price,
                ...(isInternal ? { internal_category: catVal } : { internal_category: orig.internal_category ?? null })
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
                    vkn_tckn:   inv.companies?.vkn_tckn   || '',
                    name:       inv.companies?.name       || '',
                    tax_office: inv.companies?.tax_office || '',
                    phone:      inv.companies?.phone      || '',
                    email:      inv.companies?.email      || '',
                    website:    inv.companies?.website    || '',
                    address:    inv.companies?.address    || ''
                },
                items: updatedItems
            })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Güncelleme hatası');

        inv.invoice_items = updatedItems;
        clearStockCaches();
        switchFatDetailTab(id, 'urunler');
        const bekIdx = bekleyenCache.findIndex(i => i.id === id);
        if (bekIdx >= 0) bekleyenCache[bekIdx] = inv;
        refreshData(true);
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
    tab1.style.display = n === 1 ? 'flex'  : 'none';
    tab2.style.display = n === 2 ? 'block' : 'none';

    if (n === 1) loadPdfTab();
}

async function loadPdfTab() {
    const inv     = currentDetailInvId ? (allInvoicesCache || []).find(i => i.id === currentDetailInvId) : null;
    const noXml   = document.getElementById('pdfNoXml');
    const loading = document.getElementById('pdfLoading');
    const iframe  = document.getElementById('pdfDetailIframe');
    if (!noXml || !loading || !iframe) return;

    noXml.style.display   = 'none';
    loading.style.display = 'none';
    iframe.style.display  = 'none';

    if (!inv || !inv.xml_url || inv.approval_status !== 'pending') {
        noXml.style.display = 'flex';
        return;
    }

    loading.style.display = 'flex';
    try {
        const res     = await fetch(inv.xml_url);
        if (!res.ok) throw new Error('XML dosyası alınamadı (' + res.status + ')');
        const xmlText = await res.text();
        await renderXmlToPdfIframe(xmlText, iframe);
        loading.style.display = 'none';
        iframe.style.display  = 'block';
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
    const xsltDoc     = parser.parseFromString(decodedXslt, 'text/xml');
    const proc        = new XSLTProcessor();
    proc.importStylesheet(xsltDoc);
    const fragment = proc.transformToFragment(xmlDoc, document);
    if (!fragment) throw new Error('XSLT dönüşümü başarısız oldu.');

    const html       = new XMLSerializer().serializeToString(fragment);
    const iframeDoc  = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();
}

