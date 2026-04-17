// sync-service.js (Part 1)
const logoApi = require('./logo-api');
const { createClient } = require('@supabase/supabase-js');

// 3. Initialize Supabase with the SERVICE ROLE KEY
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Use the secret one here!

if (!supabaseKey || !supabaseUrl) {
    console.error("❌ Critical Error: Supabase URL or Key is missing from .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Helper function to create a delay
 * @param {number} ms - Milliseconds to wait
 */

const { XMLParser } = require('fast-xml-parser');

// Initialize the parser to handle UBL namespaces
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ""
});
const ublParser= require('./ubl-parser');

const val = (obj) => (obj && typeof obj === 'object' ? obj['#text'] : obj);

// Helper to safely extract VKN/TCKN from an array of IDs
const extractVkn = (partyNode) => {
    if (!partyNode) return null;
    const ids = partyNode['cac:PartyIdentification'] || partyNode['PartyIdentification'];
    if (!ids) return null;

    const idArray = Array.isArray(ids) ? ids : [ids];
    for (const idObj of idArray) {
        const idNode = idObj['cbc:ID'] || idObj['ID'];
        if (idNode) {
            const scheme = idNode['schemeID']; // Fast-xml-parser puts attributes directly on the #text object if configured correctly
            if (scheme === 'VKN' || scheme === 'TCKN') {
                return val(idNode);
            }
        }
    }
    // Fallback to the first ID if no scheme matches
    return val(idArray[0]['cbc:ID'] || idArray[0]['ID']);
};

async function syncGelenInvoices() {
    const UNIT_MAP = {
    'C62': 'Adet',
    'KGM': 'Kilogram',
    'MTR': 'Metre',
    'M4': 'Parça',
    'DAY': 'Gün',
    'HUR': 'Saat',
    'LTR': 'Litre'
    };
    console.log("🚀 Starting Full Historical Sync...");
    let currentPage = 1;
    let hasMore = true;
    let totalSynced = 0;

    while (hasMore) {
        console.log(`\n--- 📂 Fetching Page ${currentPage} ---`);
        const invoices = await logoApi.getGelenInvoiceList(currentPage, 100);

        if (!invoices || invoices.length === 0) {
            hasMore = false;
            break;
        }
        for (const inv of invoices) {
            try {
                const currentId = inv.uuId;

                if (!currentId) {
                    console.warn(`⚠️ Skipping ${inv.invoiceId || 'Unknown'}: No valid UUID/ID found in API response.`);
                    continue;
                }
                // 1. FAST DB CHECK (Skip if already exists)
                const {data: exists} = await supabase
                    .from('invoices')
                    .select('id')
                    .eq('efatura_uuid', currentId)
                    .maybeSingle();

                if (exists) {
                    console.log(`⏩ Skipping ${inv.invoiceId}: Already in Database.`);
                    continue;
                }

                // 2. FETCH & PARSE
                const base64Content = await logoApi.getInvoiceUBL(currentId);

                // 🛑 ADD THIS GUARD
                if (!base64Content) {
                    console.warn(`⚠️ skipping ${inv.invoiceId}: No UBL content found.`);
                    continue; // Move to the next invoice in the loop
                }

                const ubl = ublParser.parseUblFromBase64(base64Content);
                if (!ubl) continue;

                // 3. SECURITY & DIRECTION CHECK (Mirroring Manual Logic)
                const supplierParty = ubl['cac:AccountingSupplierParty']?.['cac:Party'] || ubl['AccountingSupplierParty']?.['Party'];

                const supplierVkn = extractVkn(supplierParty);


                // Supplier Name (Check for Array in PartyName too, just in case)
                const partyNameNode = supplierParty['cac:PartyName']?.['cbc:Name'] || supplierParty['PartyName']?.['Name'];
                const supplierName = val(Array.isArray(partyNameNode) ? partyNameNode[0] : partyNameNode) ||
                    val(supplierParty['cbc:RegistrationName']) || "Bilinmeyen Firma";

                // 4. SYNC COMPANY (Supplier)
                const {data: company, error: coError} = await supabase
                    .from('companies')
                    .upsert({
                        name: supplierName,
                        vkn_tckn: String(supplierVkn),
                        is_supplier: true, // Since this is syncGelenInvoices
                        is_active: true
                    }, {onConflict: 'vkn_tckn'})
                    .select().single();

                if (coError) throw new Error(`Company Sync: ${coError.message}`);

                // 1. Get the primary currency (USD/EUR etc.) from the exchange rate block, fallback to DocumentCurrencyCode
                const currency = val(ubl['cac:PricingExchangeRate']?.['cbc:SourceCurrencyCode']) || val(ubl['cbc:DocumentCurrencyCode']) || 'TRY';

                // 2. Safely parse the CalculationRate, ensuring we default to 1.0 for TRY invoices
                const kur = parseFloat(val(ubl['cac:PricingExchangeRate']?.['cbc:CalculationRate'])) || 1.0;

                // Get Notes
                const noteNodes = ubl['cbc:Note'] || ubl['Note'];
                let notesStr = "";
                if (noteNodes) {
                    const noteArray = Array.isArray(noteNodes) ? noteNodes : [noteNodes];
                    notesStr = noteArray.map(n => val(n)).join('\n');
                }

                // Get Totals from the correct tags
                const netAmountCur = parseFloat(val(ubl['cac:LegalMonetaryTotal']?.['cbc:TaxExclusiveAmount']) || 0);
                const totalAmountCur = parseFloat(val(ubl['cac:LegalMonetaryTotal']?.['cbc:PayableAmount']) || 0);

                // Fix: Get Tax from TaxTotal
                const taxTotalNode = ubl['cac:TaxTotal'] || ubl['TaxTotal'];
                let taxAmountCur = 0;
                if (taxTotalNode) {
                    const taxNode = Array.isArray(taxTotalNode) ? taxTotalNode[0] : taxTotalNode;
                    taxAmountCur = parseFloat(val(taxNode['cbc:TaxAmount']) || 0);
                } else {
                    // Fallback if TaxTotal is completely missing
                    taxAmountCur = parseFloat((totalAmountCur - netAmountCur).toFixed(2));
                }
                // 6. SYNC INVOICE HEADER
                const {data: dbInvoice, error: invError} = await supabase
                    .from('invoices')
                    .upsert({
                        efatura_uuid: ubl['cbc:UUID'] || ubl['UUID'],
                        invoice_no: ubl['cbc:ID'] || ubl['ID'],
                        company_id: company.id,
                        direction: 'INCOMING',
                        invoice_date: ubl['cbc:IssueDate'] || ubl['IssueDate'],
                        currency: currency,
                        exchange_rate: kur,
                        total_currency: totalAmountCur,
                        net_amount_tl: (netAmountCur * kur).toFixed(2),
                        tax_amount_tl: (taxAmountCur * kur).toFixed(2),
                        total_amount_tl: (totalAmountCur * kur).toFixed(2),
                        status: 'Unpaid',
                        invoice_type: ubl['cbc:InvoiceTypeCode']
                    }, {onConflict: 'efatura_uuid'})
                    .select().single();

                if (invError) throw new Error(`Invoice Sync: ${invError.message}`);

                // 7. SYNC INVOICE ITEMS
                const lineTag = ubl['cac:InvoiceLine'] || ubl['InvoiceLine'];
                const ublLines = Array.isArray(lineTag) ? lineTag : [lineTag];

                const itemsToSave = ublLines.map(line => {
                    const item = line['cac:Item'] || line['Item'];
                    const qty = parseFloat(val(line['cbc:InvoicedQuantity'] || line['InvoicedQuantity']));
                    const price = parseFloat(val(line['cac:Price']?.['cbc:PriceAmount'] || line['Price']?.['PriceAmount']));
                    const unitCode = (line['cbc:InvoicedQuantity'] || line['InvoicedQuantity'])?.['unitCode'];

                    return {
                        invoice_id: dbInvoice.id,
                        product_name: val(item['cbc:Description']) || val(item['cbc:Name']) || 'İsimsiz Ürün',
                        sku: val(item['cac:SellersItemIdentification']?.['cbc:ID']) || null,
                        quantity: qty,
                        unit: UNIT_MAP[unitCode] || 'Adet', // Standardizing as per manual parser
                        unit_price_cur: price,
                        tax_rate: parseInt(val(line['cac:TaxTotal']?.['cac:TaxSubtotal']?.['cbc:Percent']) || 20),
                        total_price_cur: parseFloat(val(line['cbc:LineExtensionAmount']) || (qty * price)),
                        is_internal: false
                    };
                });

                const {error: itemError} = await supabase.from('invoice_items').insert(itemsToSave);
                if (itemError) console.error(`❌ Items Error for ${inv.invoiceId}:`, itemError.message);
                else {
                    totalSynced++;
                    console.log(`✅ ${inv.invoiceId} Synced Successfully.`);
                }

                await sleep(400);

            } catch (error) {
                console.error(`❌ Error processing ${inv.invoiceId}:`, error.message);
            }
        }
        currentPage++;
        await sleep(400); // Break between pages
    }
    console.log(`\n✨ Finished. Total Synced: ${totalSynced}`);
}

async function syncGidenInvoices() {
    console.log("🚀 Starting Outgoing (Sales) Invoice Sync...");
    let currentPage = 1;
    let hasMore = true;
    let totalSynced = 0;

    while (hasMore) {
        console.log(`\n--- 📂 Fetching Outgoing Page ${currentPage} ---`);
        const invoices = await logoApi.getGidenInvoiceList(currentPage, 100);

        if (!invoices || invoices.length === 0) {
            hasMore = false;
            break;
        }

        for (const inv of invoices) {
            try {
                // 1. Check if already in DB using the official Invoice Number
                const { data: exists } = await supabase
                    .from('invoices')
                    .select('id')
                    .eq('invoice_no', inv.id)
                    .maybeSingle();

                if (exists) continue;

                // 2. Fetch UBL (Using the invoiceNumber as per Logo Outgoing docs)
                const base64Content = await logoApi.getGidenInvoiceUBL(inv.id);
                if (!base64Content) {
                    console.warn(`⚠️ Skipping ${inv.id}: UBL content null.`);
                    continue;
                }

                const ubl = ublParser.parseUblFromBase64(base64Content);
                if (!ubl) continue;

                // 3. Identify Parties (Inokas is Supplier, Firm is Customer)
                const customerParty = ubl['cac:AccountingCustomerParty']?.['cac:Party'] || ubl['AccountingCustomerParty']?.['Party'];
                const customerVkn = extractVkn(customerParty);
                const customerName = val(customerParty['cac:PartyName']?.['cbc:Name'] || customerParty['PartyName']?.['Name']) ||
                                     val(customerParty['cbc:RegistrationName']) || inv.firmName || "Bilinmeyen Müşteri";

                // Sync Customer Company
                // 3. SYNC CUSTOMER COMPANY
                const { data: company, error: coError } = await supabase
                    .from('companies')
                    .upsert({
                        name: inv.firmName || "Bilinmeyen Müşteri",
                        vkn_tckn: String(inv.firmVknNo),
                        is_client: true, // This is a sales invoice
                        is_active: true
                    }, { onConflict: 'vkn_tckn' }).select().single();

                if (coError) throw coError;

                // Exchange Rates & Financials
                // 1. Get the primary currency (USD/EUR etc.) from the exchange rate block, fallback to DocumentCurrencyCode
                const currency = val(ubl['cac:PricingExchangeRate']?.['cbc:SourceCurrencyCode']) || val(ubl['cbc:DocumentCurrencyCode']) || 'TRY';

                // 2. Safely parse the CalculationRate, ensuring we default to 1.0 for TRY invoices
                const kur = parseFloat(val(ubl['cac:PricingExchangeRate']?.['cbc:CalculationRate'])) || 1.0;

                // 5. SAVE INVOICE
                const { data: dbInvoice, error: invError } = await supabase
                    .from('invoices')
                    .upsert({
                        efatura_uuid: ubl['cbc:UUID'] || ubl['UUID'],
                        invoice_no: inv.invoiceNumber,
                        company_id: company.id,
                        direction: 'OUTGOING',
                        invoice_date: inv.date,
                        currency: currency,
                        exchange_rate: kur,
                        total_currency: inv.total,
                        net_amount_tl: (inv.taxableAmount * kur).toFixed(2),
                        tax_amount_tl: (inv.totalVatAmount * kur).toFixed(2),
                        total_amount_tl: inv.totalTL, // Already calculated by Logo
                        status: 'Unpaid',
                        invoice_type: inv.invoiceType
                    }, { onConflict: 'efatura_uuid' }).select().single();

                if (invError) throw invError;

                // Sync Items
                // (Same mapping as Incoming, ensuring quantity results in stock reduction later)
                // ... [Item mapping code remains the same]

                totalSynced++;
                console.log(`✅ [Outgoing] Synced: ${inv.invoiceNumber}`);
                await sleep(400);

            } catch (err) {
                console.error(`❌ Failed Outgoing ${inv.invoiceNumber}:`, err.message);
            }
        }
        currentPage++;
        await sleep(1000);
    }
}
module.exports = { syncGelenInvoices };
