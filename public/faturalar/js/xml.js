// UBL XML namespace sabitleri ve parse fonksiyonları
// DOM veya fetch içermez — XML alır, JS objesi döndürür.

const ns = {
    cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
};

// --- Ürün kodu eşleştirme yardımcıları ---

function normalizeProductCodeForMatch(v) {
    return String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function sanitizeSkuCandidate(v) {
    return String(v ?? '')
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isInProductCodeLookup(candidate) {
    if (!productCodeLookupSet || !(productCodeLookupSet instanceof Set)) return false;
    const key = normalizeProductCodeForMatch(candidate);
    return !!key && productCodeLookupSet.has(key);
}

function pickSkuFromTextAgainstDb(text) {
    const src = String(text || '').trim();
    if (!src) return '';
    const tokens = src.match(/[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*/g) || [];

    // 1) Tek token eşleşmesi
    for (const tok of tokens) {
        const cand = sanitizeSkuCandidate(tok);
        if (isInProductCodeLookup(cand)) return cand;
    }
    // 2) Tek boşluklu iki token birleşimi (ET500I W8 gibi)
    for (let i = 0; i < tokens.length - 1; i++) {
        const pair = sanitizeSkuCandidate(`${tokens[i]} ${tokens[i + 1]}`);
        if (isInProductCodeLookup(pair)) return pair;
    }
    return '';
}

function pickRawSkuFromText(text) {
    const src = String(text || '').trim();
    if (!src) return '';
    const tokens = src.match(/[A-Za-z0-9]+(?:[-_./][A-Za-z0-9]+)*/g) || [];
    const isLikelyCode = (tok) => {
        const t = sanitizeSkuCandidate(tok);
        if (!t) return false;
        const hasLetter = /[A-Za-z]/.test(t);
        const hasDigit = /\d/.test(t);
        if (hasLetter && hasDigit && t.length >= 5) return true;
        if (!hasLetter && hasDigit && t.length >= 6) return true;
        return false;
    };
    for (const tok of tokens) {
        if (isLikelyCode(tok)) return sanitizeSkuCandidate(tok);
    }
    for (let i = 0; i < tokens.length - 1; i++) {
        const pair = sanitizeSkuCandidate(`${tokens[i]} ${tokens[i + 1]}`);
        if (pair && /[A-Za-z0-9]/.test(pair)) return pair;
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
    const t = (v) => sanitizeSkuCandidate(v);

    // Giden akışını bozmayalım: önce satıcı kodu, sonra standart.
    if (viewKey !== 'gelen') {
        return t(seller) || t(standard) || '';
    }

    // Gelen: öncelik üretici > satıcı > standart, ama DB doğrulamasıyla.
    const structuredCandidates = [t(manufacturer), t(seller), t(standard)].filter(Boolean);
    for (const cand of structuredCandidates) {
        if (isInProductCodeLookup(cand)) return cand;
    }

    // Structured alanlar DB'de yoksa metinden (Name/Description) aday bul.
    const fromName = pickSkuFromTextAgainstDb(name);
    if (fromName) return fromName;
    const fromDesc = pickSkuFromTextAgainstDb(description);
    if (fromDesc) return fromDesc;
    const fromKeyword = pickSkuFromTextAgainstDb(keyword);
    if (fromKeyword) return fromKeyword;

    // Son fallback: DB'de olmasa da XML'den gelen en iyi adayı koru.
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

// --- Genel XML yardımcıları ---

function mapProfileIdToFormInvoiceType(profileIdRaw) {
    const p = (profileIdRaw || '').toString().trim().toUpperCase();
    if (!p) return 'Ticari';
    if (p.includes('EARSIV')) return 'e-Arşiv';
    if (p.includes('TEMELFATURA')) return 'Temel';
    if (p.includes('TICARIFATURA') || p === 'TICARI') return 'Ticari';
    return 'e-Fatura';
}

/** Vade: kök DueDate veya PaymentTerms / PaymentMeans altındaki PaymentDueDate */
function parseDueDateFromInvoice(xml) {
    const rootDue = getVal(xml, 'DueDate');
    if (rootDue) return rootDue.slice(0, 10);
    const paymentTerms = xml.getElementsByTagNameNS(ns.cac, 'PaymentTerms')[0];
    const d1 = paymentTerms?.getElementsByTagNameNS(ns.cbc, 'PaymentDueDate')[0]?.textContent?.trim();
    if (d1) return d1.slice(0, 10);
    const paymentMeans = xml.getElementsByTagNameNS(ns.cac, 'PaymentMeans')[0];
    const d2 = paymentMeans?.getElementsByTagNameNS(ns.cbc, 'PaymentDueDate')[0]?.textContent?.trim();
    if (d2) return d2.slice(0, 10);
    return '';
}

function getVal(parent, tagName) {
    if (!parent) return '';
    try {
        let el = parent.getElementsByTagNameNS(ns.cbc, tagName)[0];
        if (!el) el = parent.getElementsByTagName('cbc:' + tagName)[0];
        if (!el) el = parent.getElementsByTagName(tagName)[0];
        return el ? el.textContent.trim() : '';
    } catch (e) {
        console.warn(`${tagName} okunurken hata oluştu:`, e);
        return '';
    }
}

/** UBL XML → kayıt paketi (DOM'a dokunmaz). viewKey: 'gelen' | 'giden' */
function buildInvoicePayloadFromXml(xml, viewKey) {
    const f_no = getVal(xml, 'ID');
    const f_date = getVal(xml, 'IssueDate');
    const profileId = getVal(xml, 'ProfileID');
    const invoiceTypeCode = getVal(xml, 'InvoiceTypeCode');
    const formInvoiceType = mapProfileIdToFormInvoiceType(profileId);
    const f_due_date = parseDueDateFromInvoice(xml);

    const supplierWrapper = xml.getElementsByTagNameNS(ns.cac, 'AccountingSupplierParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];
    const customerWrapper = xml.getElementsByTagNameNS(ns.cac, 'AccountingCustomerParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];

    if (!supplierWrapper || !customerWrapper) throw new Error("Gönderen veya Alıcı firma bilgisi eksik!");

    const getVknHizli = (partyNode) => {
        let foundVkn = "";
        const ids = partyNode.getElementsByTagNameNS(ns.cac, 'PartyIdentification');
        for (let i = 0; i < ids.length; i++) {
            const scheme = ids[i].getElementsByTagNameNS(ns.cbc, 'ID')[0]?.getAttribute('schemeID');
            if (scheme === 'VKN' || scheme === 'TCKN') { foundVkn = ids[i].getElementsByTagNameNS(ns.cbc, 'ID')[0].textContent; break; }
        }
        return foundVkn;
    };

    const supplierVKN = getVknHizli(supplierWrapper);
    const customerVKN = getVknHizli(customerWrapper);

    const party = viewKey === 'gelen' ? supplierWrapper : customerWrapper;

    const rawOrgName =
        party.getElementsByTagNameNS(ns.cac, 'PartyName')[0]?.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent ||
        party.getElementsByTagNameNS(ns.cbc, 'RegistrationName')[0]?.textContent ||
        '';
    const personNode = party.getElementsByTagNameNS(ns.cac, 'Person')[0];
    const firstN = personNode?.getElementsByTagNameNS(ns.cbc, 'FirstName')[0]?.textContent?.trim() || '';
    const lastN = personNode?.getElementsByTagNameNS(ns.cbc, 'FamilyName')[0]?.textContent?.trim() || '';
    const fromPerson = [firstN, lastN].filter(Boolean).join(' ').trim();
    const firmaAdi = (rawOrgName || '').trim() || fromPerson || 'Bilinmeyen Firma';

    let vkn = "";
    const idNodes = party.getElementsByTagNameNS(ns.cac, 'PartyIdentification');
    for (let i = 0; i < idNodes.length; i++) {
        const idNode = idNodes[i].getElementsByTagNameNS(ns.cbc, 'ID')[0];
        const scheme = idNode?.getAttribute('schemeID');
        if (scheme === 'VKN' || scheme === 'TCKN') {
            vkn = idNode.textContent;
            break;
        }
    }

    const addrNode = party.getElementsByTagNameNS(ns.cac, 'PostalAddress')[0];
    const street = addrNode?.getElementsByTagNameNS(ns.cbc, 'StreetName')[0]?.textContent || "";
    const bldg = addrNode?.getElementsByTagNameNS(ns.cbc, 'BuildingNumber')[0]?.textContent || "";
    const citySub = addrNode?.getElementsByTagNameNS(ns.cbc, 'CitySubdivisionName')[0]?.textContent || "";
    const city = addrNode?.getElementsByTagNameNS(ns.cbc, 'CityName')[0]?.textContent || "";
    const fullAddress = `${street} No:${bldg} ${citySub} / ${city}`.trim();

    const contactNode = party.getElementsByTagNameNS(ns.cac, 'Contact')[0];
    const phone = contactNode?.getElementsByTagNameNS(ns.cbc, 'Telephone')[0]?.textContent || "";
    const email = contactNode?.getElementsByTagNameNS(ns.cbc, 'ElectronicMail')[0]?.textContent || "";
    const website = contactNode?.getElementsByTagNameNS(ns.cbc, 'WebsiteURI')[0]?.textContent || "";

    const taxOffice =
        party.getElementsByTagNameNS(ns.cac, 'PartyTaxScheme')[0]
            ?.getElementsByTagNameNS(ns.cac, 'TaxScheme')[0]
            ?.getElementsByTagNameNS(ns.cbc, 'Name')[0]
            ?.textContent?.trim() || '';

    const monetaryTotal = xml.getElementsByTagNameNS(ns.cac, 'LegalMonetaryTotal')[0];
    if (!monetaryTotal) throw new Error("HATA: LegalMonetaryTotal bulunamadı.");

    const taxTotalNode = xml.getElementsByTagNameNS(ns.cac, 'TaxTotal')[0];
    const currencyNode = monetaryTotal.getElementsByTagNameNS(ns.cbc, 'PayableAmount')[0];
    const payableCurrencyId = (currencyNode ? currencyNode.getAttribute('currencyID') : 'TRY') || 'TRY';

    const exchangeRateNode = xml.getElementsByTagNameNS(ns.cac, 'PricingExchangeRate')[0];
    const sourceFromRate = exchangeRateNode?.getElementsByTagNameNS(ns.cbc, 'SourceCurrencyCode')[0]?.textContent?.trim() || '';
    const targetFromRate = exchangeRateNode?.getElementsByTagNameNS(ns.cbc, 'TargetCurrencyCode')[0]?.textContent?.trim() || '';
    const kur = exchangeRateNode ? exchangeRateNode.getElementsByTagNameNS(ns.cbc, 'CalculationRate')[0]?.textContent : "";
    const calculationRate = (() => {
        const r = parseFloat(kur);
        return Number.isFinite(r) && r > 0 ? r : 1;
    })();

    const baseIso = (sourceFromRate || payableCurrencyId || 'TRY').toUpperCase();
    const targetIso = (targetFromRate || 'TRY').toUpperCase();
    const currencyRaw = baseIso;

    const netCur = parseFloat(getVal(monetaryTotal, 'TaxExclusiveAmount')) || 0;
    const payableCur = parseFloat(getVal(monetaryTotal, 'PayableAmount')) || 0;
    const taxInclusiveRaw = getVal(monetaryTotal, 'TaxInclusiveAmount');
    let taxCur = taxTotalNode ? parseFloat(getVal(taxTotalNode, 'TaxAmount') || '0') : NaN;
    if (!Number.isFinite(taxCur)) taxCur = payableCur - netCur;
    let taxInclusiveCur = taxInclusiveRaw !== ''
        ? parseFloat(taxInclusiveRaw)
        : (netCur + taxCur);
    if (!Number.isFinite(taxInclusiveCur)) taxInclusiveCur = netCur + taxCur;

    const invCurrencyUi = baseIso === 'TRY' ? 'TL' : baseIso;

    const paymentMeans = xml.getElementsByTagNameNS(ns.cac, 'PaymentMeans')[0];
    const paymentInstructionNote = paymentMeans?.getElementsByTagNameNS(ns.cbc, 'InstructionNote')[0]?.textContent?.trim() || null;

    const netTl = netCur * calculationRate;
    const taxTl = taxCur * calculationRate;
    const payableTl = payableCur * calculationRate;

    const noteNodes = xml.getElementsByTagNameNS(ns.cbc, 'Note');
    const notesArray = Array.from(noteNodes).map(n => n.textContent.trim()).filter(n => n.length > 0);
    if (kur) {
        const tgtLabel = targetIso === 'TRY' ? 'TL' : targetIso;
        notesArray.unshift(`💱 Sistem Notu: 1 ${currencyRaw} = ${kur} ${tgtLabel} (UBL Source→Target kur).`);
    }
    if (invoiceTypeCode) notesArray.unshift(`📋 UBL işlem türü (InvoiceTypeCode): ${invoiceTypeCode}`);

    const lines = xml.getElementsByTagNameNS(ns.cac, 'InvoiceLine');
    const items = [];
    const unresolvedSkuWarnings = [];

    Array.from(lines).forEach(line => {
        const itemNode = line.getElementsByTagNameNS(ns.cac, 'Item')[0];
        const name = itemNode.getElementsByTagNameNS(ns.cbc, 'Description')[0]?.textContent ||
            itemNode.getElementsByTagNameNS(ns.cbc, 'Name')[0]?.textContent ||
            'İsimsiz Ürün';
        const sku = parseProductCodeForSku(itemNode, viewKey, unresolvedSkuWarnings);
        const qty = getVal(line, 'InvoicedQuantity');
        const priceNode = line.getElementsByTagNameNS(ns.cac, 'Price')[0];
        const price = priceNode ? priceNode.getElementsByTagNameNS(ns.cbc, 'PriceAmount')[0]?.textContent : 0;
        const lineTotal = getVal(line, 'LineExtensionAmount');
        const taxSubtotal = line.getElementsByTagNameNS(ns.cac, 'TaxTotal')[0]?.getElementsByTagNameNS(ns.cac, 'TaxSubtotal')[0];
        const taxRate = taxSubtotal ? parseInt(taxSubtotal.getElementsByTagNameNS(ns.cbc, 'Percent')[0]?.textContent) : 20;

        items.push({
            product_name: name,
            product_code: sku || null,
            quantity: parseFloat(qty),
            unit_code: 'ADET',
            unit_price_cur: parseFloat(price),
            total_price_cur: parseFloat(lineTotal),
            tax_rate: taxRate,
            currency: invCurrencyUi
        });
    });

    return {
        parsed_view: viewKey,
        company: {
            vkn_tckn: vkn,
            name: firmaAdi,
            tax_office: taxOffice,
            address: fullAddress,
            phone: phone,
            email: email,
            website: website,
            is_supplier: viewKey === 'gelen',
            is_client: viewKey === 'giden'
        },
        invoice: {
            efatura_uuid: xml.getElementsByTagNameNS(ns.cbc, 'UUID')[0]?.textContent,
            invoice_no: f_no,
            direction: viewKey === 'gelen' ? 'INCOMING' : 'OUTGOING',
            invoice_date: f_date,
            due_date: f_due_date || null,
            invoice_type: formInvoiceType,
            currency: invCurrencyUi,
            base_currency: baseIso,
            target_currency: targetIso,
            calculation_rate: calculationRate,
            total_tax_exclusive_cur: netCur,
            total_tax_inclusive_cur: taxInclusiveCur,
            payable_amount_cur: payableCur,
            total_tax_exclusive_tl: netTl,
            tax_amount_tl: taxTl,
            payable_amount_tl: payableTl,
            notes: notesArray.join('\n')
        },
        xml_context: {
            supplier_vkn: supplierVKN,
            customer_vkn: customerVKN
        },
        items,
        _skuWarnings: Array.from(new Set(unresolvedSkuWarnings)).filter(Boolean),
        _kurXml: kur || ''
    };
}

// --- Toplu yükleme VKN yardımcıları ---

function getPartyVknFromNode(partyNode) {
    if (!partyNode) return '';
    const ids = partyNode.getElementsByTagNameNS(ns.cac, 'PartyIdentification');
    for (let i = 0; i < ids.length; i++) {
        const scheme = ids[i].getElementsByTagNameNS(ns.cbc, 'ID')[0]?.getAttribute('schemeID');
        if (scheme === 'VKN' || scheme === 'TCKN') {
            return ids[i].getElementsByTagNameNS(ns.cbc, 'ID')[0]?.textContent?.trim() || '';
        }
    }
    return '';
}

function getSupplierCustomerVknsFromDoc(xml) {
    const sw = xml.getElementsByTagNameNS(ns.cac, 'AccountingSupplierParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];
    const cw = xml.getElementsByTagNameNS(ns.cac, 'AccountingCustomerParty')[0]?.getElementsByTagNameNS(ns.cac, 'Party')[0];
    return { supplier: getPartyVknFromNode(sw), customer: getPartyVknFromNode(cw) };
}

function classifyInvoiceDirection(supplierVkn, customerVkn, inokasVkn) {
    const s = String(supplierVkn || '').trim();
    const c = String(customerVkn || '').trim();
    const io = String(inokasVkn || '').trim();
    if (!io) return null;
    if (s !== io && c !== io) return 'NEITHER';
    if (s === io && c === io) return 'BOTH';
    if (c === io) return 'INCOMING';
    if (s === io) return 'OUTGOING';
    return null;
}
