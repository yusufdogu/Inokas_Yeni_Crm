// Fatura para birimi ve tutar hesaplama yardımcıları
// DOM veya fetch içermez — sadece veri alır, değer döndürür.

function normalizeCurrencyCode(code) {
    const val = String(code || '').trim().toUpperCase();
    if (val === 'TL') return 'TRY';
    return val;
}

/** UBL `SourceCurrencyCode` ile hizalı ISO kod (DB `base_currency` / form dövizi) */
function invBaseCurrencyIso(inv) {
    const raw = String(inv?.base_currency || inv?.currency || 'TRY').trim().toUpperCase();
    if (raw === 'TL') return 'TRY';
    return raw || 'TRY';
}

/** Tablo / etiket: TRY → TL, aksi halde ISO (USD, EUR…) */
function invDisplayCurrencyLabel(inv) {
    const iso = invBaseCurrencyIso(inv);
    return iso === 'TRY' ? 'TL' : iso;
}

function formatMoneyDisplay(inv, num) {
    const n = Number(num) || 0;
    const iso = invBaseCurrencyIso(inv);
    if (iso === 'TRY') {
        return n.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
    }
    const label = invDisplayCurrencyLabel(inv);
    return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${label}`;
}

/** DB + eski kayıtlar: TL cinsinden ödenecek tutar */
function invPayableAmountTl(inv) {
    const v = inv?.payable_amount_tl ?? inv?.total_amount_tl;
    return parseFloat(v) || 0;
}

/** DB + eski kayıtlar: TL matrah */
function invNetAmountTl(inv) {
    const v = inv?.total_tax_exclusive_tl ?? inv?.net_amount_tl;
    return parseFloat(v) || 0;
}

/** Kur: yeni `calculation_rate`, eski `exchange_rate` */
function invCalculationRate(inv) {
    const r = inv?.calculation_rate ?? inv?.exchange_rate;
    const n = parseFloat(r);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Liste / detay / form: kaynak para (SourceCurrency) cinsinden tutarlar */
function invNetAmountSrc(inv) {
    const c = parseFloat(inv?.total_tax_exclusive_cur);
    if (Number.isFinite(c)) return c;
    return invNetAmountTl(inv) / invCalculationRate(inv);
}

function invTaxAmountSrc(inv) {
    const tl = parseFloat(inv?.tax_amount_tl);
    if (Number.isFinite(tl) && tl >= 0) return tl / invCalculationRate(inv);
    return Math.max(0, invPayableAmountSrc(inv) - invNetAmountSrc(inv));
}

function invPayableAmountSrc(inv) {
    const c = parseFloat(inv?.payable_amount_cur);
    if (Number.isFinite(c) && c >= 0) return c;
    return invPayableAmountTl(inv) / invCalculationRate(inv);
}

function invPaidAmountSrc(inv) {
    // paid_amount_cur: fatura para biriminde saklanan tutar (kur çarpımı yok, kesin doğru)
    // Sadece > 0 ise kullan: 0 değeri "henüz ödenmedi" veya "eski kayıt" anlamına gelir
    const cur = parseFloat(inv?.paid_amount_cur);
    if (Number.isFinite(cur) && cur > 0) return cur;
    // Geriye dönük uyumluluk: eski kayıtlarda paid_amount TL cinsinden saklanmış olabilir
    const paidTl = parseFloat(inv?.paid_amount) || 0;
    return Math.round((paidTl / invCalculationRate(inv)) * 100) / 100;
}

function invRemainingAmountSrc(inv) {
    return Math.max(invPayableAmountSrc(inv) - invPaidAmountSrc(inv), 0);
}

function invCurrencySelectValue(inv) {
    return invDisplayCurrencyLabel(inv);
}

/** Formda gösterilecek kaynak para tutarları (önce cur kolonları, yoksa eski TL kolonları) */
function invNetForForm(inv) {
    const cur = parseFloat(inv?.total_tax_exclusive_cur);
    if (Number.isFinite(cur)) return cur;
    // Fallback: eski kayıt — TL tutarı kura bölerek kaynak para birimine çevir
    const tl = parseFloat(inv?.total_tax_exclusive_tl);
    const rate = invCalculationRate(inv);
    if (Number.isFinite(tl) && rate > 0) return Math.round((tl / rate) * 100) / 100;
    return '';
}

function invTaxForForm(inv) {
    const tl = parseFloat(inv?.tax_amount_tl);
    const rate = invCalculationRate(inv);
    if (Number.isFinite(tl) && rate > 0) return Math.round((tl / rate) * 100) / 100;
    return '';
}

function invPayableForForm(inv) {
    const cur = parseFloat(inv?.payable_amount_cur);
    if (Number.isFinite(cur) && cur > 0) return cur;
    // Fallback: eski kayıt — doğru kolon adı payable_amount_tl
    const tl = parseFloat(inv?.payable_amount_tl);
    const rate = invCalculationRate(inv);
    if (Number.isFinite(tl) && rate > 0) return Math.round((tl / rate) * 100) / 100;
    return '';
}

// Dashboard / özet kart yardımcıları

function _isoLabel(iso) { return iso === 'TRY' ? 'TL' : iso; }

function _fmtAmount(num, iso) {
    const n = Number(num) || 0;
    if (iso === 'TRY') return n.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
    if (iso === 'USD') return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${_isoLabel(iso)}`;
}

function _sumByCurrency(invoices) {
    const out = { TRY: { payable: 0, paid: 0 }, USD: { payable: 0, paid: 0 } };
    invoices.forEach(inv => {
        const iso = invBaseCurrencyIso(inv);
        if (!out[iso]) return;
        const payable = invPayableAmountSrc(inv);
        const paid = Math.min(invPaidAmountSrc(inv), payable);
        out[iso].payable += payable;
        out[iso].paid += paid;
    });
    return out;
}

function _daysBetween(dateStart, dateEnd) {
    const s = new Date(dateStart);
    const e = new Date(dateEnd);
    if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) return null;
    return Math.max(0, Math.round((e - s) / 86400000));
}

function _invPayableUsdEq(inv) {
    // Öncelik: fatura USD ise doğrudan kaynak tutar.
    const baseIso = invBaseCurrencyIso(inv);
    const payableSrc = invPayableAmountSrc(inv);
    if (baseIso === 'USD') return payableSrc;

    // Diğer durumlarda (özellikle TRY), faturadaki kur üzerinden USD eşdeğer hesapla.
    // calculation_rate: 1 USD = ? (fatura ekranındaki kur)
    const payableTl = invPayableAmountTl(inv);
    const rate = invCalculationRate(inv);
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    return payableTl / rate;
}

function _extractTotalQty(invoices) {
    return invoices.reduce((acc, inv) => {
        const rowQty = (inv.invoice_items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        return acc + rowQty;
    }, 0);
}


// ─── APPEND THIS TO THE BOTTOM OF faturalar/js/utils.js ─────────────────────

function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function normalizeProductCodeForMatch(code) {
    return String(code || '').trim().toUpperCase();
}

/** Ofis içi (is_internal) kalemleri düşülmüş kaynak para tutarı — KDV dahil */
function invNonInternalPayableAmountSrc(inv) {
    const items = inv?.invoice_items;
    if (!items || !items.length) return invPayableAmountSrc(inv);
    const hasInternal = items.some(it => it.is_internal);
    if (!hasInternal) return invPayableAmountSrc(inv);
    return items
        .filter(it => !it.is_internal)
        .reduce((sum, it) => {
            const net     = parseFloat(it.total_price_cur) || 0;
            const taxRate = parseFloat(it.tax_rate) || 0;
            return sum + net * (1 + taxRate / 100);
        }, 0);
}

// ─── Tag-input multi-select helper ───────────────────────────────────────────
function createTagFilter({ wrapId, inputId, dropdownId, getOptions, onChange }) {
    const wrap     = document.getElementById(wrapId);
    const input    = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!wrap || !input || !dropdown) return { getSelected: () => [], clear: () => {} };

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
        const opts = getOptions().filter(o =>
            !selected.includes(o) &&
            (!query || o.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')))
        );
        const list = dropdown.querySelector('.filter-dropdown-list') || (() => {
            const ul = document.createElement('ul');
            ul.className = 'filter-dropdown-list';
            dropdown.appendChild(ul);
            return ul;
        })();
        list.innerHTML = '';
        opts.slice(0, 40).forEach(o => {
            const li = document.createElement('li');
            li.className = 'filter-dropdown-item';
            li.textContent = o;
            li.addEventListener('click', () => {
                if (!selected.includes(o)) selected.push(o);
                input.value = '';
                dropdown.classList.remove('open');
                renderTags();
                onChange(selected);
            });
            list.appendChild(li);
        });
        dropdown.classList.toggle('open', opts.length > 0);
    }

    input.addEventListener('input', () => renderDropdown(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && selected.length) {
            selected.pop();
            renderTags();
            onChange(selected);
        }
        if (e.key === 'Escape') dropdown.classList.remove('open');
    });
    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) dropdown.classList.remove('open');
    });

    return {
        getSelected: () => [...selected],
        clear: () => { selected = []; renderTags(); },
    };
}
