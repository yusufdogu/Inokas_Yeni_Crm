// test-sync-dry-run.js
require('dotenv').config();
const logoApi = require('../services/logo-api');
const { parseUblFromBase64, setProductCodeLookup } = require('../services/ubl-parser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// GELEN TEST
// ─────────────────────────────────────────────────────────────────────────────
async function testGelen() {
    console.log('\n🧪 GELEN DRY RUN — nothing will be written to DB\n');

    const { data: productCodes } = await supabase.from('products').select('product_code');
    if (productCodes) setProductCodeLookup(productCodes.map(p => p.product_code));
    console.log(`📦 Loaded ${productCodes?.length || 0} product codes\n`);

    const invoices = await logoApi.getGelenInvoiceList(1, 5);
    console.log(`📋 Got ${invoices.length} invoices from API\n`);

    let ok = 0, fail = 0;

    for (const inv of invoices) {
        console.log(`${'═'.repeat(70)}`);
        console.log('📋 [API LIST FIELDS]');
        console.log(`   invoiceId                : ${inv.invoiceId}`);
        console.log(`   uuId                     : ${inv.uuId}`);
        console.log(`   type                     : ${inv.type}`);
        console.log(`   typeDesc                 : ${inv.typeDesc || '(none)'}`);
        console.log(`   invoiceType              : ${inv.invoiceType || '(none)'}`);
        console.log(`   eGovermentType           : ${inv.eGovermentType || '(none)'}`);
        console.log(`   EGovermentTypeDesc       : ${inv.EGovermentTypeDesc || '(none)'}`);
        console.log(`   issueDate                : ${inv.issueDate}`);
        console.log(`   amount                   : ${inv.amount}`);
        console.log(`   totalVatBase             : ${inv.totalVatBase}`);
        console.log(`   currency                 : ${inv.currency}`);
        console.log(`   supplier                 : ${inv.supplier}`);
        console.log(`   supplierTcknVkn          : ${inv.supplierTcknVkn}`);
        console.log(`   isPersonal               : ${inv.isPersonal}`);
        console.log(`   isProcessable            : ${inv.isProcessable}`);
        console.log(`   isViewed                 : ${inv.isViewed}`);
        console.log(`   notSelectable            : ${inv.notSelectable}`);
        console.log(`   status                   : ${inv.status}`);
        console.log(`   statusCode               : ${inv.statusCode}`);
        console.log(`   rejectNot                : ${inv.rejectNot || '(none)'}`);
        console.log(`   message                  : ${inv.message || '(none)'}`);
        console.log(`   label                    : ${inv.label || '(none)'}`);
        console.log(`   appRespstatus            : ${inv.appRespstatus || '(none)'}`);
        console.log(`   appRespstatusCode        : ${inv.appRespstatusCode}`);
        console.log(`   connectStatusDescription : ${inv.connectStatusDescription || '(none)'}`);
        console.log(`   connectStatusCode        : ${inv.connectStatusCode}`);
        console.log(`   accountingStatus         : ${JSON.stringify(inv.accountingStatus)}`);
        console.log(`   purchaseInvoiceId        : ${inv.purchaseInvoiceId || '(none)'}`);

        const vatRates = [0,1,4,5,6,8,9,10,13,14,15,16,18,19,20];
        console.log('\n   [VAT Breakdown]');
        let hasVat = false;
        vatRates.forEach(r => {
            const total = inv[`vat${r}VatTotal`];
            const base  = inv[`vat${r}VatMatrah`];
            if (total || base) {
                console.log(`   vat${r}: matrah=${base}  total=${total}  name=${inv[`vat${r}Name`] || '(none)'}`);
                hasVat = true;
            }
        });
        if (!hasVat) console.log('   (all zero)');

        try {
            if (!inv.uuId) { console.log('\n   ❌ No UUID — skipping'); fail++; continue; }

            const base64Content = await logoApi.getInvoiceUBL(inv.uuId);
            if (!base64Content) { console.log('\n   ❌ No UBL content'); fail++; continue; }

            const parsed = parseUblFromBase64(base64Content, 'gelen');
            if (!parsed) { console.log('\n   ❌ Parse failed'); fail++; continue; }

            const { company, invoice, items, _skuWarnings } = parsed;

            console.log('\n🏢 [COMPANY]');
            console.log(`   name         : ${company.name}`);
            console.log(`   vkn_tckn     : ${company.vkn_tckn}`);
            console.log(`   tax_office   : ${company.tax_office || '(none)'}`);
            console.log(`   address      : ${company.address || '(none)'}`);
            console.log(`   city         : ${company.city || '(none)'}`);
            console.log(`   postal_code  : ${company.postal_code || '(none)'}`);
            console.log(`   phone        : ${company.phone || '(none)'}`);
            console.log(`   email        : ${company.email || '(none)'}`);
            console.log(`   website      : ${company.website || '(none)'}`);

            console.log('\n🧾 [INVOICE]');
            console.log(`   efatura_uuid            : ${invoice.efatura_uuid}`);
            console.log(`   invoice_no              : ${invoice.invoice_no}`);
            console.log(`   profile_id              : ${invoice.profile_id || '(none)'}`);
            console.log(`   invoice_type            : ${invoice.invoice_type || '(none)'}`);
            console.log(`   invoice_date            : ${invoice.invoice_date}`);
            console.log(`   direction               : ${invoice.direction}`);
            console.log(`   currency                : ${invoice.currency}`);
            console.log(`   base_currency           : ${invoice.base_currency || '(none)'}`);
            console.log(`   target_currency         : ${invoice.target_currency || '(none)'}`);
            console.log(`   calculation_rate        : ${invoice.calculation_rate}`);
            console.log(`   total_tax_exclusive_cur : ${invoice.total_tax_exclusive_cur}`);
            console.log(`   total_tax_inclusive_cur : ${invoice.total_tax_inclusive_cur}`);
            console.log(`   payable_amount_cur      : ${invoice.payable_amount_cur}`);
            console.log(`   total_tax_exclusive_tl  : ${invoice.total_tax_exclusive_tl}`);
            console.log(`   total_tax_inclusive_tl  : ${invoice.total_tax_inclusive_tl || '(none)'}`);
            console.log(`   tax_amount_tl           : ${invoice.tax_amount_tl}`);
            console.log(`   payable_amount_tl       : ${invoice.payable_amount_tl}`);
            console.log(`   allowance_total_cur     : ${invoice.allowance_total_amount_cur || '(none)'}`);
            console.log(`   payment_due_date        : ${invoice.payment_due_date || '(none)'}`);
            console.log(`   payment_terms_note      : ${invoice.payment_terms_note || '(none)'}`);
            console.log(`   signed_at               : ${invoice.signed_at || '(none)'}`);
            console.log(`   notes                   : ${invoice.notes || '(none)'}`);

            console.log(`\n📦 [ITEMS — ${items.length} line(s)]`);
            items.forEach((item, i) => {
                console.log(`\n   ── Line ${i + 1} ──`);
                console.log(`     line_id           : ${item.line_id || '(none)'}`);
                console.log(`     product_name      : ${item.product_name}`);
                console.log(`     product_code      : ${item.product_code || '(unresolved)'}`);
                console.log(`     brand_name        : ${item.brand_name || '(none)'}`);
                console.log(`     manufacturer_code : ${item.manufacturer_code || '(none)'}`);
                console.log(`     commodity_code    : ${item.commodity_code || '(none)'}`);
                console.log(`     customs_tariff    : ${item.customs_tariff_code || '(none)'}`);
                console.log(`     quantity          : ${item.quantity}`);
                console.log(`     unit_code         : ${item.unit_code || '(none)'}`);
                console.log(`     unit_price_cur    : ${item.unit_price_cur}`);
                console.log(`     tax_rate          : ${item.tax_rate}%`);
                console.log(`     tax_amount_cur    : ${item.tax_amount_cur || '(none)'}`);
                console.log(`     total_price_cur   : ${item.total_price_cur}`);
                console.log(`     currency          : ${item.currency}`);
                console.log(`     line_note         : ${item.line_note || '(none)'}`);
                console.log(`     internal_category : ${item.internal_category || '(none)'}`);
            });

            if (_skuWarnings.length > 0) {
                console.log(`\n  ⚠️  Unresolved SKUs: ${_skuWarnings.join(', ')}`);
            } else {
                console.log(`\n  ✅ All SKUs resolved`);
            }

            ok++;
        } catch (err) {
            console.log(`\n  ❌ Error: ${err.message}`);
            fail++;
        }

        await sleep(500);
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`GELEN Done — ${ok} ok · ${fail} failed\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GIDEN TEST
// ─────────────────────────────────────────────────────────────────────────────
async function testGiden() {
    console.log('\n🧪 GIDEN DRY RUN — nothing will be written to DB\n');

    const { data: productCodes } = await supabase.from('products').select('product_code');
    if (productCodes) setProductCodeLookup(productCodes.map(p => p.product_code));
    console.log(`📦 Loaded ${productCodes?.length || 0} product codes\n`);

    const invoices = await logoApi.getGidenInvoiceList(1, 5);
    console.log(`📋 Got ${invoices.length} invoices from API\n`);

    let ok = 0, fail = 0;

    for (const inv of invoices) {
        console.log(`${'═'.repeat(70)}`);
        console.log('📋 [API LIST FIELDS]');
        console.log(`   id                         : ${inv.id}`);
        console.log(`   invoiceNumber              : ${inv.invoiceNumber || '(none)'}`);
        console.log(`   documentNumber             : ${inv.documentNumber || '(none)'}`);
        console.log(`   date                       : ${inv.date}`);
        console.log(`   createdon                  : ${inv.createdon}`);
        console.log(`   modificationDate           : ${inv.modificationDate || '(none)'}`);
        console.log(`   type                       : ${inv.type}`);
        console.log(`   invoiceType                : ${JSON.stringify(inv.invoiceType) || '(none)'}`);
        console.log(`   invoiceTypeName            : ${inv.invoiceTypeName || '(none)'}`);
        console.log(`   eType                      : ${JSON.stringify(inv.eType) || '(none)'}`);
        console.log(`   eGovernmentType            : ${inv.eGovernmentType || '(none)'}`);
        console.log(`   eStatus                    : ${inv.eStatus}`);
        console.log(`   eStatusDescription         : ${inv.eStatusDescription || '(none)'}`);
        console.log(`   eInvoiceStatus             : ${inv.eInvoiceStatus}`);
        console.log(`   eArchiveStatus             : ${inv.eArchiveStatus}`);
        console.log(`   eReplyDescription          : ${inv.eReplyDescription || '(none)'}`);
        console.log(`   eReplayId                  : ${inv.eReplayId || '(none)'}`);
        console.log(`   eReplayText                : ${inv.eReplayText || '(none)'}`);
        console.log(`   isCancelled                : ${inv.isCancelled}`);
        console.log(`   activeStatus               : ${inv.activeStatus}`);
        console.log(`   gibCode                    : ${inv.gibCode || '(none)'}`);
        console.log(`   currency                   : ${inv.currency}`);
        console.log(`   exchangeRate               : ${inv.exchangeRate}`);
        console.log(`   total                      : ${inv.total}`);
        console.log(`   totalTL                    : ${inv.totalTL}`);
        console.log(`   grossTotal                 : ${inv.grossTotal}`);
        console.log(`   taxableAmount              : ${inv.taxableAmount}`);
        console.log(`   totalVatAmount             : ${inv.totalVatAmount}`);
        console.log(`   totalWitholdingAmount      : ${inv.totalWitholdingAmount}`);
        console.log(`   declaredTotalVatAmount     : ${inv.declaredTotalVatAmount}`);
        console.log(`   TotalDiscounts             : ${inv.TotalDiscounts}`);
        console.log(`   remainingTotal             : ${inv.remainingTotal}`);
        console.log(`   remainingTotalTL           : ${inv.remainingTotalTL}`);
        console.log(`   paymentDate                : ${inv.paymentDate || '(none)'}`);
        console.log(`   paymentDateStatus          : ${inv.paymentDateStatus}`);
        console.log(`   paymentDateStatusDescription: ${inv.paymentDateStatusDescription || '(none)'}`);
        console.log(`   paymentStatus              : ${inv.paymentStatus}`);
        console.log(`   firm                       : ${JSON.stringify(inv.firm) || '(none)'}`);
        console.log(`   firmName                   : ${inv.firmName || '(none)'}`);
        console.log(`   firmVknNo                  : ${inv.firmVknNo || '(none)'}`);
        console.log(`   firmCode                   : ${inv.firmCode || '(none)'}`);
        console.log(`   taxOffice                  : ${inv.taxOffice || '(none)'}`);
        console.log(`   category                   : ${JSON.stringify(inv.category) || '(none)'}`);
        console.log(`   categoryName               : ${inv.categoryName || '(none)'}`);
        console.log(`   tags                       : ${JSON.stringify(inv.tags)}`);
        console.log(`   description                : ${inv.description || '(none)'}`);
        console.log(`   dispatchNumber             : ${inv.dispatchNumber || '(none)'}`);
        console.log(`   vatIncluded                : ${inv.vatIncluded}`);
        console.log(`   documentType               : ${inv.documentType || '(none)'}`);
        console.log(`   accountingStatus           : ${JSON.stringify(inv.accountingStatus)}`);
        console.log(`   hasImage                   : ${inv.hasImage}`);
        console.log(`   isEmailSent                : ${inv.isEmailSent}`);
        console.log(`   fromExim                   : ${inv.fromExim}`);
        console.log(`   purchaseInvoiceId          : ${inv.purchaseInvoiceId || '(none)'}`);
        console.log(`   salesInvoiceId             : ${inv.salesInvoiceId || '(none)'}`);

        try {
            if (!inv.id) { console.log('\n   ❌ No id — skipping'); fail++; continue; }

            const base64Content = await logoApi.getGidenInvoiceUBL(inv.id);
            if (!base64Content) { console.log('\n   ❌ No UBL content'); fail++; continue; }

            const parsed = parseUblFromBase64(base64Content, 'giden');
            if (!parsed) { console.log('\n   ❌ Parse failed'); fail++; continue; }

            const { company, invoice, items, _skuWarnings } = parsed;

            console.log('\n🏢 [COMPANY]');
            console.log(`   name         : ${company.name}`);
            console.log(`   vkn_tckn     : ${company.vkn_tckn}`);
            console.log(`   tax_office   : ${company.tax_office || '(none)'}`);
            console.log(`   address      : ${company.address || '(none)'}`);
            console.log(`   city         : ${company.city || '(none)'}`);
            console.log(`   postal_code  : ${company.postal_code || '(none)'}`);
            console.log(`   phone        : ${company.phone || '(none)'}`);
            console.log(`   email        : ${company.email || '(none)'}`);
            console.log(`   website      : ${company.website || '(none)'}`);

            console.log('\n🧾 [INVOICE]');
            console.log(`   efatura_uuid            : ${invoice.efatura_uuid}`);
            console.log(`   invoice_no              : ${invoice.invoice_no}`);
            console.log(`   profile_id              : ${invoice.profile_id || '(none)'}`);
            console.log(`   invoice_type            : ${invoice.invoice_type || '(none)'}`);
            console.log(`   invoice_date            : ${invoice.invoice_date}`);
            console.log(`   direction               : ${invoice.direction}`);
            console.log(`   currency                : ${invoice.currency}`);
            console.log(`   base_currency           : ${invoice.base_currency || '(none)'}`);
            console.log(`   target_currency         : ${invoice.target_currency || '(none)'}`);
            console.log(`   calculation_rate        : ${invoice.calculation_rate}`);
            console.log(`   total_tax_exclusive_cur : ${invoice.total_tax_exclusive_cur}`);
            console.log(`   total_tax_inclusive_cur : ${invoice.total_tax_inclusive_cur}`);
            console.log(`   payable_amount_cur      : ${invoice.payable_amount_cur}`);
            console.log(`   total_tax_exclusive_tl  : ${invoice.total_tax_exclusive_tl}`);
            console.log(`   total_tax_inclusive_tl  : ${invoice.total_tax_inclusive_tl || '(none)'}`);
            console.log(`   tax_amount_tl           : ${invoice.tax_amount_tl}`);
            console.log(`   payable_amount_tl       : ${invoice.payable_amount_tl}`);
            console.log(`   allowance_total_cur     : ${invoice.allowance_total_amount_cur || '(none)'}`);
            console.log(`   payment_due_date        : ${invoice.payment_due_date || '(none)'}`);
            console.log(`   payment_terms_note      : ${invoice.payment_terms_note || '(none)'}`);
            console.log(`   signed_at               : ${invoice.signed_at || '(none)'}`);
            console.log(`   notes                   : ${invoice.notes || '(none)'}`);

            console.log(`\n📦 [ITEMS — ${items.length} line(s)]`);
            items.forEach((item, i) => {
                console.log(`\n   ── Line ${i + 1} ──`);
                console.log(`     line_id           : ${item.line_id || '(none)'}`);
                console.log(`     product_name      : ${item.product_name}`);
                console.log(`     product_code      : ${item.product_code || '(unresolved)'}`);
                console.log(`     brand_name        : ${item.brand_name || '(none)'}`);
                console.log(`     manufacturer_code : ${item.manufacturer_code || '(none)'}`);
                console.log(`     commodity_code    : ${item.commodity_code || '(none)'}`);
                console.log(`     customs_tariff    : ${item.customs_tariff_code || '(none)'}`);
                console.log(`     quantity          : ${item.quantity}`);
                console.log(`     unit_code         : ${item.unit_code || '(none)'}`);
                console.log(`     unit_price_cur    : ${item.unit_price_cur}`);
                console.log(`     tax_rate          : ${item.tax_rate}%`);
                console.log(`     tax_amount_cur    : ${item.tax_amount_cur || '(none)'}`);
                console.log(`     total_price_cur   : ${item.total_price_cur}`);
                console.log(`     currency          : ${item.currency}`);
                console.log(`     line_note         : ${item.line_note || '(none)'}`);
                console.log(`     internal_category : ${item.internal_category || '(none)'}`);
            });

            if (_skuWarnings.length > 0) {
                console.log(`\n  ⚠️  Unresolved SKUs: ${_skuWarnings.join(', ')}`);
            } else {
                console.log(`\n  ✅ All SKUs resolved`);
            }

            ok++;
        } catch (err) {
            console.log(`\n  ❌ Error: ${err.message}`);
            fail++;
        }

        await sleep(500);
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`GIDEN Done — ${ok} ok · ${fail} failed\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT — comment out whichever you don't want to run
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    await testGelen();
    await testGiden();
}

main().catch(console.error);