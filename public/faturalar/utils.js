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

function _avgClosureDays(invoices) {
    let total = 0;
    let count = 0;
    invoices.forEach(inv => {
        const st = String(inv.status || '').toLowerCase();
        if (st !== 'paid') return;
        const closure = paymentClosureMap?.[inv.id];
        const lastDate = closure?.last_payment_date;
        if (!lastDate) return;
        const days = _daysBetween(inv.invoice_date, lastDate);
        if (days === null) return;
        total += days;
        count += 1;
    });
    return { avg: count > 0 ? (total / count) : 0, count };
}

function _extractUniqueSkuCount(invoices) {
    const sku = new Set();
    invoices.forEach(inv => (inv.invoice_items || []).forEach(it => {
        const code = String(it.product_code || it.sku || '').trim();
        if (code) sku.add(code);
    }));
    return sku.size;
}

function _extractTotalQty(invoices) {
    return invoices.reduce((acc, inv) => {
        const rowQty = (inv.invoice_items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        return acc + rowQty;
    }, 0);
}
