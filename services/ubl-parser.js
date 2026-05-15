// ubl-parser.js
const AdmZip = require('adm-zip');
const { DOMParser } = require('@xmldom/xmldom');

const ns = {
    cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
};

const parser = new DOMParser();

// ─── helpers ────────────────────────────────────────────────────────────────

function getVal(node, localName) {
    const el = node.getElementsByTagNameNS(ns.cbc, localName)[0];
    return el ? el.textContent.trim() : '';
}

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
    const manufacturer = itemNode.getElementsByTagNameNS(ns.cac, 'ManufacturersItemIdentification')[0]
        ?.getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent;
    const seller = itemNode.getElementsByTagNameNS(ns.cac, 'SellersItemIdentification')[0]
        ?.getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent;
    const standard = itemNode.getElementsByTagNameNS(ns.cac, 'StandardItemIdentification')[0]
        ?.getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent;
    const name = itemNode.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent;
    const description = itemNode.getElementsByTagNameNS(ns.cbc, 'Description')[0]?.textContent;
    const keyword = itemNode.getElementsByTagNameNS(ns.cbc, 'Keyword')[0]?.textContent;

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

function parseDueDateFromInvoice(xml) {
    // PaymentMeans > PaymentDueDate
    const paymentMeans = xml.getElementsByTagNameNS(ns.cac, 'PaymentMeans')[0];
    if (paymentMeans) {
        const dueDate = paymentMeans.getElementsByTagNameNS(ns.cbc, 'PaymentDueDate')[0]?.textContent?.trim();
        if (dueDate) return dueDate;
    }
    // PaymentTerms > Note (some suppliers put it here as text)
    const paymentTerms = xml.getElementsByTagNameNS(ns.cac, 'PaymentTerms')[0];
    if (paymentTerms) {
        const note = paymentTerms.getElementsByTagNameNS(ns.cbc, 'Note')[0]?.textContent?.trim();
        // Only return if it looks like an actual date (YYYY-MM-DD)
        if (note && /^\d{4}-\d{2}-\d{2}$/.test(note)) return note;
        // Otherwise save it as payment_terms_note, not as a date
    }
    return null;
}

function mapProfileIdToFormInvoiceType(profileId) {
    if (!profileId) return null;
    if (profileId.includes('TICARIFATURA')) return 'TICARIFATURA';
    if (profileId.includes('EARSIVFATURA')) return 'EARSIVFATURA';
    if (profileId.includes('IHRACAT')) return 'IHRACAT';
    return profileId; // fallback: store raw value
}

// ─── main export ────────────────────────────────────────────────────────────

function parseUblFromBase64(base64Content, viewKey = 'gelen') {
    try {
        const zipBuffer = Buffer.from(base64Content, 'base64');
        const zip = new AdmZip(zipBuffer);
        const xmlEntry = zip.getEntries().find(e => e.entryName.endsWith('.xml'));
        if (!xmlEntry) { console.warn('⚠️ No XML entry in zip'); return null; }

        const xmlText = xmlEntry.getData().toString('utf8');
        const xml = parser.parseFromString(xmlText, 'application/xml');

        return buildInvoicePayload(xml, viewKey);
    } catch (err) {
        console.error('Parser Error:', err.message);
        return null;
    }
}

function buildInvoicePayload(xml, viewKey) {
    const f_no = getVal(xml, 'ID');
    const f_date = getVal(xml, 'IssueDate');
    const profileId = getVal(xml, 'ProfileID');
    const invoiceTypeCode = getVal(xml, 'InvoiceTypeCode');
    const formInvoiceType = mapProfileIdToFormInvoiceType(profileId);
    const f_due_date = parseDueDateFromInvoice(xml);

    const supplierWrapper = xml.getElementsByTagNameNS(ns.cac, 'AccountingSupplierParty')[0]
        ?.getElementsByTagNameNS(ns.cac, 'Party')[0];
    const customerWrapper = xml.getElementsByTagNameNS(ns.cac, 'AccountingCustomerParty')[0]
        ?.getElementsByTagNameNS(ns.cac, 'Party')[0];

    if (!supplierWrapper || !customerWrapper) throw new Error("Supplier or customer party missing in UBL");

    // VKN extractor
    const getVkn = (partyNode) => {
        const ids = partyNode.getElementsByTagNameNS(ns.cac, 'PartyIdentification');
        for (let i = 0; i < ids.length; i++) {
            const idEl = ids[i].getElementsByTagNameNS(ns.cbc, 'ID')[0];
            const scheme = idEl?.getAttribute('schemeID');
            if (scheme === 'VKN' || scheme === 'TCKN') return idEl.textContent.trim();
        }
        return '';
    };

    const supplierVKN = getVkn(supplierWrapper);
    const customerVKN = getVkn(customerWrapper);
    const party = viewKey === 'gelen' ? supplierWrapper : customerWrapper;
    const vkn = viewKey === 'gelen' ? supplierVKN : customerVKN;

    // Company name — org name or person fallback
    const rawOrgName = party.getElementsByTagNameNS(ns.cac, 'PartyName')[0]
        ?.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent ||
        party.getElementsByTagNameNS(ns.cbc, 'RegistrationName')[0]?.textContent || '';
    const personNode = party.getElementsByTagNameNS(ns.cac, 'Person')[0];
    const firstN = personNode?.getElementsByTagNameNS(ns.cbc, 'FirstName')[0]?.textContent?.trim() || '';
    const lastN = personNode?.getElementsByTagNameNS(ns.cbc, 'FamilyName')[0]?.textContent?.trim() || '';
    const fromPerson = [firstN, lastN].filter(Boolean).join(' ');
    const firmaAdi = rawOrgName.trim() || fromPerson || 'Bilinmeyen Firma';

    // Address
    const addrNode = party.getElementsByTagNameNS(ns.cac, 'PostalAddress')[0];
    const street = addrNode?.getElementsByTagNameNS(ns.cbc, 'StreetName')[0]?.textContent || '';
    const bldg = addrNode?.getElementsByTagNameNS(ns.cbc, 'BuildingNumber')[0]?.textContent || '';
    const citySub = addrNode?.getElementsByTagNameNS(ns.cbc, 'CitySubdivisionName')[0]?.textContent || '';
    const city = addrNode?.getElementsByTagNameNS(ns.cbc, 'CityName')[0]?.textContent || '';
    const fullAddress = `${street} No:${bldg} ${citySub} / ${city}`.trim();

    // Contact
    const contactNode = party.getElementsByTagNameNS(ns.cac, 'Contact')[0];
    const phone = contactNode?.getElementsByTagNameNS(ns.cbc, 'Telephone')[0]?.textContent || '';
    const email = contactNode?.getElementsByTagNameNS(ns.cbc, 'ElectronicMail')[0]?.textContent || '';
    const website = contactNode?.getElementsByTagNameNS(ns.cbc, 'WebsiteURI')[0]?.textContent || '';

    // Tax office
    const taxOffice = party.getElementsByTagNameNS(ns.cac, 'PartyTaxScheme')[0]
        ?.getElementsByTagNameNS(ns.cac, 'TaxScheme')[0]
        ?.getElementsByTagNameNS(ns.cbc, 'Name')[0]
        ?.textContent?.trim() || '';

    // Financials
    const monetaryTotal = xml.getElementsByTagNameNS(ns.cac, 'LegalMonetaryTotal')[0];
    if (!monetaryTotal) throw new Error("LegalMonetaryTotal not found in UBL");

    const taxTotalNode = xml.getElementsByTagNameNS(ns.cac, 'TaxTotal')[0];
    const currencyNode = monetaryTotal.getElementsByTagNameNS(ns.cbc, 'PayableAmount')[0];
    const payableCurrencyId = currencyNode?.getAttribute('currencyID') || 'TRY';

    const exchangeRateNode = xml.getElementsByTagNameNS(ns.cac, 'PricingExchangeRate')[0];
    const sourceFromRate = exchangeRateNode?.getElementsByTagNameNS(ns.cbc, 'SourceCurrencyCode')[0]?.textContent?.trim() || '';
    const targetFromRate = exchangeRateNode?.getElementsByTagNameNS(ns.cbc, 'TargetCurrencyCode')[0]?.textContent?.trim() || '';
    const kurRaw = exchangeRateNode?.getElementsByTagNameNS(ns.cbc, 'CalculationRate')[0]?.textContent || '';
    const calculationRate = (() => { const r = parseFloat(kurRaw); return Number.isFinite(r) && r > 0 ? r : 1; })();

    const baseIso = (sourceFromRate || payableCurrencyId || 'TRY').toUpperCase();
    const targetIso = (targetFromRate || 'TRY').toUpperCase();
    const currencyUi = baseIso === 'TL' ? 'TRY' : baseIso;

    const netCur = parseFloat(getVal(monetaryTotal, 'TaxExclusiveAmount')) || 0;
    const payableCur = parseFloat(getVal(monetaryTotal, 'PayableAmount')) || 0;
    const taxInclusiveRaw = getVal(monetaryTotal, 'TaxInclusiveAmount');
    let taxCur = taxTotalNode ? parseFloat(getVal(taxTotalNode, 'TaxAmount') || '0') : NaN;
    if (!Number.isFinite(taxCur)) taxCur = payableCur - netCur;
    let taxInclusiveCur = taxInclusiveRaw !== '' ? parseFloat(taxInclusiveRaw) : (netCur + taxCur);
    if (!Number.isFinite(taxInclusiveCur)) taxInclusiveCur = netCur + taxCur;

    // Payment
    const paymentMeans = xml.getElementsByTagNameNS(ns.cac, 'PaymentMeans')[0];
    const paymentInstructionNote = paymentMeans
        ?.getElementsByTagNameNS(ns.cbc, 'InstructionNote')[0]?.textContent?.trim() || null;

    const paymentTermsNote = xml.getElementsByTagNameNS(ns.cac, 'PaymentTerms')[0]
        ?.getElementsByTagNameNS(ns.cbc, 'Note')[0]?.textContent?.trim() || null;
    // TL conversions
    const netTl = netCur * calculationRate;
    const taxTl = taxCur * calculationRate;
    const payableTl = payableCur * calculationRate;

    // Notes
    const noteNodes = xml.getElementsByTagNameNS(ns.cbc, 'Note');
    const notesArray = Array.from(noteNodes).map(n => n.textContent.trim()).filter(n => n.length > 0);


    // Line items
    const lines = xml.getElementsByTagNameNS(ns.cac, 'InvoiceLine');
    const items = [];
    const unresolvedSkuWarnings = [];

    Array.from(lines).forEach(line => {
        const itemNode = line.getElementsByTagNameNS(ns.cac, 'Item')[0];
        const name = itemNode.getElementsByTagNameNS(ns.cbc, 'Description')[0]?.textContent
            || itemNode.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent
            || 'İsimsiz Ürün';
        const sku = parseProductCodeForSku(itemNode, viewKey, unresolvedSkuWarnings);
        const qty = parseFloat(getVal(line, 'InvoicedQuantity')) || 0;
        const priceNode = line.getElementsByTagNameNS(ns.cac, 'Price')[0];
        const price = parseFloat(priceNode?.getElementsByTagNameNS(ns.cbc, 'PriceAmount')[0]?.textContent) || 0;
        const lineTotal = parseFloat(getVal(line, 'LineExtensionAmount')) || (qty * price);
        const taxSubtotal = line.getElementsByTagNameNS(ns.cac, 'TaxTotal')[0]
            ?.getElementsByTagNameNS(ns.cac, 'TaxSubtotal')[0];
        const taxRate = taxSubtotal
            ? parseInt(taxSubtotal.getElementsByTagNameNS(ns.cbc, 'Percent')[0]?.textContent) || 20
            : 20;

        const unitCode = line.getElementsByTagNameNS(ns.cbc, 'InvoicedQuantity')[0]
            ?.getAttribute('unitCode') || 'ADET';
        const brandName = itemNode.getElementsByTagNameNS(ns.cbc, 'BrandName')[0]?.textContent?.trim() || null;
        const manufacturerCode = itemNode.getElementsByTagNameNS(ns.cac, 'ManufacturersItemIdentification')[0]
            ?.getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent?.trim() || null;
        const lineNote = line.getElementsByTagNameNS(ns.cbc, 'Note')[0]?.textContent?.trim() || null;
        const lineId = parseInt(line.getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent) || null;


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
            internal_category: null,
        });
    });

    return {
        company: {
            vkn_tckn: vkn,
            name: firmaAdi,
            tax_office: taxOffice,
            address: fullAddress,
            city: addrNode?.getElementsByTagNameNS(ns.cbc, 'CityName')[0]?.textContent?.trim() || null,
            postal_code: addrNode?.getElementsByTagNameNS(ns.cbc, 'PostalZone')[0]?.textContent?.trim() || null,
            phone,
            email,
            website,
            is_supplier: viewKey === 'gelen',
            is_client: viewKey === 'giden',
            is_active: true,
        },
        invoice: {
            efatura_uuid: xml.getElementsByTagNameNS(ns.cbc, 'UUID')[0]?.textContent?.trim(),
            invoice_no: f_no,
            direction: viewKey === 'gelen' ? 'INCOMING' : 'OUTGOING',
            invoice_date: f_date,
            due_date: f_due_date || null,
            payment_due_date: f_due_date || null,   // only real dates
            payment_instruction_note: paymentInstructionNote,
            invoice_type: formInvoiceType,
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