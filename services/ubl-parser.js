// ubl-parser.js
const AdmZip = require('adm-zip');

const { XMLParser } = require('fast-xml-parser');
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    isArray: (name) =>
        ['InvoiceLine', 'Note', 'AdditionalDocumentReference',
         'PartyIdentification', 'TaxSubtotal', 'TaxTotal'].includes(name)
});

function sanitizeSkuCandidate(v) {
    if (!v) return '';
    const cleaned = v.trim().replace(/\s+/g, ' ');
    // Reject values that are clearly not SKUs (too long, pure numbers that look like VKN etc.)
    if (cleaned.length > 50) return '';
    if (/^\d{10,}$/.test(cleaned)) return '';
    return cleaned;
}

// SKU resolution — mirrors your browser parser logic
// productCodeLookup is a Set populated at startup from your products table
let productCodeLookup = new Set();

function setProductCodeLookup(codes) {
    productCodeLookup = new Set(codes.map(c => c.trim().toUpperCase()));
}

function isInProductCodeLookup(cand) {
    return productCodeLookup.has(cand.trim().toUpperCase());
}

// Extract a plausible SKU from free text by looking for alphanumeric codes
function pickRawSkuFromText(text) {
    if (!text) return '';
    const match = text.match(/\b([A-Z0-9][-A-Z0-9]{2,})\b/i);
    return match ? sanitizeSkuCandidate(match[1]) : '';
}

function pickSkuFromTextAgainstDb(text) {
    if (!text) return '';
    const tokens = text.split(/[\s,;/]+/);
    for (const token of tokens) {
        const cand = sanitizeSkuCandidate(token);
        if (cand && isInProductCodeLookup(cand)) return cand;
    }
    return '';
}

function parseProductCodeForSku(itemNode, viewKey, unresolvedWarnings) {
    if (!itemNode) return '';

    const getRawId = (node) => {
        const id = node?.ID;
        return String(id?.['#text'] ?? id ?? '').trim();
    };

    const manufacturer = getRawId(itemNode.ManufacturersItemIdentification);
    const seller       = getRawId(itemNode.SellersItemIdentification);
    const standard     = getRawId(itemNode.StandardItemIdentification);
    const name         = String(itemNode.Name        ?? '').trim();
    const description  = String(itemNode.Description ?? '').trim();
    const keyword      = String(itemNode.Keyword     ?? '').trim();

    const t = sanitizeSkuCandidate;

    // Outgoing: seller code first
    if (viewKey !== 'gelen') {
        return t(seller) || t(standard) || '';
    }

    // Incoming: manufacturer > seller > standard, validated against DB
    const structuredCandidates = [t(manufacturer), t(seller), t(standard)].filter(Boolean);
    for (const cand of structuredCandidates) {
        if (isInProductCodeLookup(cand)) return cand;
    }

    // Try extracting from name / description / keyword
    const fromName = pickSkuFromTextAgainstDb(name);
    if (fromName) return fromName;
    const fromDesc = pickSkuFromTextAgainstDb(description);
    if (fromDesc) return fromDesc;
    const fromKeyword = pickSkuFromTextAgainstDb(keyword);
    if (fromKeyword) return fromKeyword;

    // Last resort: return best raw candidate and log warning
    const rawFallback =
        structuredCandidates[0] ||
        pickRawSkuFromText(name) ||
        pickRawSkuFromText(description) ||
        pickRawSkuFromText(keyword) ||
        '';

    if (rawFallback && Array.isArray(unresolvedWarnings)) {
        unresolvedWarnings.push(rawFallback);
    }
    return rawFallback;
}
function parseDueDateFromInvoice(inv) {
    const dueDate = String(inv.PaymentMeans?.PaymentDueDate ?? '').trim();
    if (dueDate) return dueDate;

    const note = String(inv.PaymentTerms?.Note ?? '').trim();
    if (note && /^\d{4}-\d{2}-\d{2}$/.test(note)) return note;

    // fallback: PaymentTerms may also carry PaymentDueDate directly
    const termsDueDate = String(inv.PaymentTerms?.PaymentDueDate ?? '').trim();
    if (termsDueDate) return termsDueDate;

    return null;
}


// ─── main export ────────────────────────────────────────────────────────────

function parseUblFromBase64(base64Content, viewKey = 'gelen') {
    try {
        const zipBuffer = Buffer.from(base64Content, 'base64');
        const zip = new AdmZip(zipBuffer);
        const xmlEntry = zip.getEntries().find(e => e.entryName.endsWith('.xml'));
        if (!xmlEntry) { console.warn('⚠️ No XML entry in zip'); return null; }

        const xmlText = xmlEntry.getData().toString('utf8');
        const xml = parser.parse(xmlText);

        return buildInvoicePayload(xml, viewKey);
    } catch (err) {
        console.error('Parser Error:', err.message);
        return null;
    }
}

function buildInvoicePayload(xml, viewKey) {
    const inv = xml.Invoice;
    const f_no = inv.ID || '';
    const f_date = inv.IssueDate || '';
    const profileId = inv.ProfileID || '';
    const f_due_date = parseDueDateFromInvoice(inv);

    const supplierWrapper = inv.AccountingSupplierParty?.Party;
    const customerWrapper = inv.AccountingCustomerParty?.Party;

    if (!supplierWrapper || !customerWrapper) throw new Error("Supplier or customer party missing in UBL");

    const getVkn = (partyNode) => {
        const ids = [].concat(partyNode.PartyIdentification || []);
        const match = ids.find(p =>
            p.ID?.['@_schemeID'] === 'VKN' || p.ID?.['@_schemeID'] === 'TCKN'
        );
        return String(match?.ID?.['#text'] ?? '').trim();
    };

    const supplierVKN = getVkn(supplierWrapper);
    const customerVKN = getVkn(customerWrapper);
    const party = viewKey === 'gelen' ? supplierWrapper : customerWrapper;
    const vkn = viewKey === 'gelen' ? supplierVKN : customerVKN;

    // Company name — org name or person fallback
    const rawOrgName = String(party.PartyName?.Name ?? party.RegistrationName ?? '').trim();
    const firstN = String(party.Person?.FirstName ?? '').trim();
    const lastN  = String(party.Person?.FamilyName ?? '').trim();
    const fromPerson = [firstN, lastN].filter(Boolean).join(' ');
    const firmaAdi = rawOrgName || fromPerson || 'Bilinmeyen Firma';

    // Address
    const addrNode = party.PostalAddress;
    const street  = String(addrNode?.StreetName ?? '').trim();
    const bldg    = String(addrNode?.BuildingNumber ?? '').trim();
    const citySub = String(addrNode?.CitySubdivisionName ?? '').trim();
    const city    = String(addrNode?.CityName ?? '').trim();
    const fullAddress = `${street} No:${bldg} ${citySub} / ${city}`.trim();

    // Contact
    const contactNode = party.Contact;
    const phone   = String(contactNode?.Telephone ?? '').trim();
    const email   = String(contactNode?.ElectronicMail ?? '').trim();
    const website = String(party.WebsiteURI ?? '').trim();

    const taxOffice = String(party.PartyTaxScheme?.TaxScheme?.Name ?? '').trim();

    // Financials
    const monetaryTotal = inv.LegalMonetaryTotal;
    if (!monetaryTotal) throw new Error("LegalMonetaryTotal not found in UBL");

    const taxTotalNode = [].concat(inv.TaxTotal || [])[0];
    const payableCurrencyId = monetaryTotal.PayableAmount?.['@_currencyID'] || 'TRY';

    const exchangeRateNode = inv.PricingExchangeRate;
    const sourceFromRate = String(exchangeRateNode?.SourceCurrencyCode ?? '').trim();
    const targetFromRate = String(exchangeRateNode?.TargetCurrencyCode ?? '').trim();
    const kurRaw = String(exchangeRateNode?.CalculationRate ?? '');
    const calculationRate = (() => { const r = parseFloat(kurRaw); return Number.isFinite(r) && r > 0 ? r : 1; })();

    const baseIso = (sourceFromRate || payableCurrencyId || 'TRY').toUpperCase();
    const targetIso = (targetFromRate || 'TRY').toUpperCase();
    const currencyUi = baseIso === 'TL' ? 'TRY' : baseIso;

    const getAmt = (node, field) => {
        const v = node?.[field];
        return parseFloat(v?.['#text'] ?? v ?? 0) || 0;
    };

    const netCur      = getAmt(monetaryTotal, 'TaxExclusiveAmount');
    const payableCur  = getAmt(monetaryTotal, 'PayableAmount');
    const taxInclusiveRaw = monetaryTotal.TaxInclusiveAmount;
    let taxCur = taxTotalNode ? getAmt(taxTotalNode, 'TaxAmount') : NaN;
    if (!Number.isFinite(taxCur)) taxCur = payableCur - netCur;
    let taxInclusiveCur = taxInclusiveRaw != null
        ? parseFloat(taxInclusiveRaw?.['#text'] ?? taxInclusiveRaw)
        : (netCur + taxCur);
    if (!Number.isFinite(taxInclusiveCur)) taxInclusiveCur = netCur + taxCur;

    const notesArray = [].concat(inv.Note || [])
        .map(n => String(n).trim())
        .filter(n => n.length > 0);


    const lines = [].concat(inv.InvoiceLine || []);
    const items = [];
    const unresolvedSkuWarnings = [];

    lines.forEach(line => {
        const itemNode = line.Item;

        const name = String(itemNode?.Description ?? itemNode?.Name ?? 'İsimsiz Ürün').trim();

        const sku = parseProductCodeForSku(itemNode, viewKey, unresolvedSkuWarnings);

        const qtyField = line.InvoicedQuantity;
        const qty      = parseFloat(qtyField?.['#text'] ?? qtyField ?? 0) || 0;
        const unitCode = String(qtyField?.['@_unitCode'] ?? 'ADET');

        const price     = parseFloat(line.Price?.PriceAmount?.['#text'] ?? line.Price?.PriceAmount ?? 0) || 0;

        const lineTotalField = line.LineExtensionAmount;
        const lineTotal = parseFloat(lineTotalField?.['#text'] ?? lineTotalField ?? 0) || (qty * price);

        const taxSubtotal = [].concat(line.TaxTotal?.[0]?.TaxSubtotal || line.TaxTotal?.TaxSubtotal || [])[0];
        const taxRate = parseInt(taxSubtotal?.Percent ?? 20) || 20;

        const brandName        = String(itemNode?.BrandName ?? '').trim() || null;
        const manufacturerCode = String(itemNode?.ManufacturersItemIdentification?.ID ?? '').trim() || null;

        const lineNoteField = line.Note;
        const lineNote = lineNoteField != null ? String(lineNoteField).trim() || null : null;

        const lineId = parseInt(line.ID) || null;

        items.push({
            line_id: lineId,
            product_name: name,
            product_code: sku || null,
            brand_name: brandName,
            manufacturer_code: manufacturerCode,
            quantity: qty,
            unit_code: unitCode,
            unit_price_cur: price,
            total_price_cur: lineTotal,
            tax_rate: taxRate,
            currency: currencyUi,
            line_note: lineNote,
            item_subcategory: null,
        });
    });

    return {
        company: {
            vkn_tckn: vkn,
            name: firmaAdi,
            tax_office: taxOffice,
            address: fullAddress,
            city: String(addrNode?.CityName ?? '').trim() || null,
            postal_code: String(addrNode?.PostalZone ?? '').trim() || null,
            phone,
            email,
            website,
            is_supplier: viewKey === 'gelen',
            is_client: viewKey === 'giden',
            is_active: true,
        },
        invoice: {
            efatura_uuid: String(inv.UUID ?? '').trim(),
            invoice_no: f_no,
            direction: viewKey === 'gelen' ? 'INCOMING' : 'OUTGOING',
            invoice_date: f_date,
            due_date: f_due_date || null,
            invoice_type: profileId,
            currency: currencyUi,
            base_currency: baseIso,
            target_currency: targetIso,
            calculation_rate: calculationRate,
            total_tax_exclusive_cur: netCur,
            total_tax_inclusive_cur: taxInclusiveCur,
            payable_amount_cur: payableCur,
            total_tax_exclusive_tl: netTl,
            tax_amount_tl: taxTl,
            payable_amount_tl: payableTl,
            notes: notesArray.join('\n') || null,
        },
        xml_context: { supplier_vkn: supplierVKN, customer_vkn: customerVKN },
        items,
        _skuWarnings: Array.from(new Set(unresolvedSkuWarnings)).filter(Boolean),
        _kurXml: kurRaw,
    };
}

module.exports = { parseUblFromBase64, setProductCodeLookup };