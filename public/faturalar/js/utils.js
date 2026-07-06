// Fatura para birimi ve tutar hesaplama yardımcıları
// DOM veya fetch içermez — sadece veri alır, değer döndürür.

// ─── Skeleton renderer ──────────────────────────────────────────────────────
// Renders N pulsing placeholder rows into a container.
//
// Usage:
//   renderSkeleton('myList', 3, [
//     { width: 14, height: 10 },        // a small block
//     { width: '60%', height: 11 },     // a flexible text line
//     { width: 48, height: 11 },        // a fixed amount block
//   ]);
//
// Or for a row of stacked lines, use multiple rows:
//   renderSkeleton('myList', 3, {
//     rank:    { width: 14, height: 10 },
//     name:    { width: '60%', height: 11 },
//     amount:  { width: 48, height: 11 },
//     bar:     { width: '100%', height: 4, span: 'full' },
//   });

function renderSkeleton(containerId, count, schema) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // Vary widths slightly so rows don't look identical
    const widthVariations = ['58%', '46%', '68%', '52%', '62%'];

    const rows = [];
    for (let i = 0; i < count; i++) {
        const widthIdx = i % widthVariations.length;
        rows.push(_buildSkeletonRow(schema, widthVariations[widthIdx]));
    }

    el.innerHTML = `<div class="skel-list">${rows.join('')}</div>`;
}

function _buildSkeletonRow(schema, nameWidth) {
    // schema can be:
    //   { rank, name, amount, bar }  → row with rank | (name+amount on top, bar below)
    //   simple array → flat row of pills

    if (Array.isArray(schema)) {
        return `<div class="skel-row">${
            schema.map(s => _buildSkelBox(s)).join('')
        }</div>`;
    }

    // structured row (companies-style)
    const parts = [];
    if (schema.rank)   parts.push(_buildSkelBox(schema.rank));
    parts.push(`
        <div class="skel-info">
            <div class="skel-line">
                ${_buildSkelBox({ ...schema.name, width: nameWidth })}
                ${_buildSkelBox(schema.amount)}
            </div>
            ${schema.bar ? _buildSkelBox(schema.bar) : ''}
        </div>
    `);

    return `<div class="skel-row">${parts.join('')}</div>`;
}

function _buildSkelBox({ width, height, radius = 3 }) {
    const w = typeof width === 'number' ? width + 'px' : width;
    const h = typeof height === 'number' ? height + 'px' : height;
    return `<div class="skel-box" style="width:${w}; height:${h}; border-radius:${radius}px;"></div>`;
}

// Companies card (3 rows by default)
function renderCompaniesSkeleton(containerId, count = 3) {
    renderSkeleton(containerId, count, {
        rank:   { width: 14, height: 10 },
        name:   { width: '60%', height: 11 },
        amount: { width: 48, height: 11 },
        bar:    { width: '100%', height: 4, radius: 2 },
    });
}

// KPI cards (3 lines stacked)
function renderKpiSkeleton(containerId) {
    renderSkeleton(containerId, 1, [
        { width: 80, height: 10 },    // label
        { width: 120, height: 22 },   // big value
    ]);
}

// Invoice list row (matches table layout)
function renderInvoiceListSkeleton(containerId, count = 5) {
    renderSkeleton(containerId, count, [
        { width: '40%', height: 40 },   // invoice no
        { width: '40%', height: 40 },   // company
        { width: '10%', height: 40 },    // date
        { width: '10%', height: 40 },    // amount
    ]);
}

// Chat assistant message bubble (single)
function renderChatSkeleton(containerId) {
    renderSkeleton(containerId, 1, [
        { width: 180, height: 11 },
        { width: 240, height: 11 },
        { width: 140, height: 11 },
    ]);
}

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

    let selected     = [];
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

    function selectOption(o) {
        if (!selected.includes(o)) selected.push(o);
        input.value = '';
        dropdown.classList.remove('open');
        highlightIdx = -1;
        renderTags();
        onChange(selected);
    }

    function renderDropdown(query) {
        const opts = getOptions().filter(o =>
            !selected.includes(o) &&
            (!query || o.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')) || o.toLocaleLowerCase('en-US').includes(query.toLocaleLowerCase('en-US')))
        );
        const list = dropdown.querySelector('.filter-dropdown-list') || (() => {
            const ul = document.createElement('ul');
            ul.className = 'filter-dropdown-list';
            dropdown.appendChild(ul);
            return ul;
        })();
        list.innerHTML = '';
        highlightIdx = -1;
        opts.forEach(o => {
            const li = document.createElement('li');
            li.className = 'filter-dropdown-item';
            li.textContent = o;
            li.addEventListener('click', () => selectOption(o));
            list.appendChild(li);
        });
        dropdown.classList.toggle('open', opts.length > 0);
    }
    input.addEventListener('focus', () => { highlightIdx = -1; renderDropdown(''); });  // ← add this
    input.addEventListener('input', () => { highlightIdx = -1; renderDropdown(input.value); });
    input.addEventListener('keydown', (e) => {
        const items = getItems();
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!dropdown.classList.contains('open')) { renderDropdown(input.value); return; }
            setHighlight(Math.min(highlightIdx + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight(Math.max(highlightIdx - 1, -1));
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
        if (!wrap.contains(e.target)) { dropdown.classList.remove('open'); highlightIdx = -1; }
    });

    return {
        // Inside createTagFilter, alongside getSelected/clear:

        getSelected:   () => [...selected],
        clear:         () => {
          selected = [];
          input.value='';
          dropdown.classList.remove('open');
          renderTags(); },

        add: (v) => {
            console.log('[tagFilter.add] called with:', v);
            if (v == null || v === '') return;
            if (selected.includes(v)) {
                console.log('[tagFilter.add] already selected, skipping');
                return;
            }
            selected.push(v);
            console.log('[tagFilter.add] pushed. selected:', selected);
            renderTags();
            if (typeof onChange === 'function') {
                console.log('[tagFilter.add] calling onChange');
                onChange(selected);
            }
        },
        _forceSelect: (v) => {
             if (!selected.includes(v)) {
                selected.push(v);
                renderTags();
                if (!window._restoringFilters) onChange(selected);
            }
        },
    };
}
