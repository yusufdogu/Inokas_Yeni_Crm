// routes/invoices.js
'use strict';

const express = require('express');
const router = express.Router();
const { generateAndUploadPdf } = require('../services/pdf-service');


// ── Case-insensitive filter helpers ───────────────────────────────────────────

async function resolveCompanyIds(supabase, tenantId, names) {
    if (!names?.length) return null;
    const { data } = await supabase.from('companies').select('id, name').eq('tenant_id', tenantId);
    const lower = names.map(n => n.toLocaleLowerCase('tr-TR'));
    const ids = (data || []).filter(c => lower.some(q => c.name.toLocaleLowerCase('tr-TR').includes(q))).map(c => c.id);
    return ids;
}

async function resolveInvoiceIdsByBrand(supabase, brands) {
    if (!brands?.length) return null;
    const lower = brands.map(b => b.toLocaleLowerCase('tr-TR'));
    const { data } = await supabase.from('invoice_items').select('invoice_id, brand_name');
    const ids = [...new Set((data || []).filter(r => r.brand_name && lower.some(q => r.brand_name.toLocaleLowerCase('tr-TR').includes(q))).map(r => r.invoice_id).filter(Boolean))];
    return ids;
}

async function resolveInvoiceIdsByProduct(supabase, products) {
    if (!products?.length) return null;
    const lower = products.map(p => p.toLocaleLowerCase('tr-TR'));
    const { data } = await supabase.from('invoice_items').select('invoice_id, product_name');
    const ids = [...new Set((data || []).filter(r => r.product_name && lower.some(q => r.product_name.toLocaleLowerCase('tr-TR').includes(q))).map(r => r.invoice_id).filter(Boolean))];
    return ids;
}

async function resolveInvoiceIdsByCategory(supabase, tenantId, categories) {
    if (!categories?.length) return null;
    const lower = categories.map(c => c.toLocaleLowerCase('tr-TR'));
    const { data: prods } = await supabase.from('products').select('product_code, category').eq('tenant_id', tenantId);
    const codes = (prods || []).filter(p => p.category && lower.some(q => p.category.toLocaleLowerCase('tr-TR').includes(q))).map(p => p.product_code).filter(Boolean);
    if (!codes.length) return [];
    const { data: items } = await supabase.from('invoice_items').select('invoice_id').in('product_code', codes);
    return [...new Set((items || []).map(r => r.invoice_id).filter(Boolean))];
}

// ─── Helper: aynı faturada aynı product_code+product_name olan satırları birleştir ───
async function mergeDuplicateItems(supabase, invoiceId) {
  const { data: items } = await supabase
    .from('invoice_items')
    .select('id, product_code, product_name, quantity, total_price_cur')
    .eq('invoice_id', invoiceId)
    .not('product_code', 'is', null)
    .neq('product_code', '');

  if (!items || items.length === 0) return;

  const groups = {};
  for (const it of items) {
    const key = `${it.product_code}__${it.product_name || ''}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  }

  for (const group of Object.values(groups)) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.id < b.id ? -1 : 1);
    const keep = group[0];
    const rest = group.slice(1);
    const mergedQty = group.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);
    const mergedTotal = group.reduce((s, i) => s + (parseFloat(i.total_price_cur) || 0), 0);

    await supabase.from('invoice_items').update({ quantity: mergedQty, total_price_cur: mergedTotal }).eq('id', keep.id);
    await supabase.from('invoice_items').delete().in('id', rest.map(r => r.id));
  }
}

// ─── Helper: sync invoice item internal meta + product upsert ────────────────
async function syncInvoiceItemInternalMeta(supabase, invoiceId, payloadItems, tenantId) {
  const items = Array.isArray(payloadItems) ? payloadItems : [];
  if (!invoiceId || items.length === 0) return;

  const { data: dbItems, error: dbItemsErr } = await supabase
    .from('invoice_items').select('id').eq('invoice_id', invoiceId).order('created_at', { ascending: true });
  if (dbItemsErr) throw dbItemsErr;

  const count = Math.min(dbItems?.length || 0, items.length);

  for (let i = 0; i < count; i++) {
    const rowId = dbItems[i]?.id;
    if (!rowId) continue;
    const src = items[i] || {};
    const isInternal = src.is_internal === true;
    const categoryRaw = String(src.item_subcategory || '').trim();
    const internalCategory = isInternal && categoryRaw ? categoryRaw : null;

    const { error: updErr } = await supabase
      .from('invoice_items').update({ is_internal: isInternal, item_subcategory: internalCategory }).eq('id', rowId);
    if (updErr) throw updErr;

    if (!isInternal) {
      const productCode = String(src.product_code || '').trim();
      if (!productCode) continue;
      const brand = String(src.brand_name || '').trim() || null;
      const model = String(src.model || '').trim() || null;
      const category = String(src.product_category || src.category || '').trim() || null;
      const name = String(src.product_name || '').trim();

      const { data: existing } = await supabase.from('products').select('id, brand, category, model').eq('product_code', productCode).eq('tenant_id', tenantId).maybeSingle();
      if (existing) {
        const updates = { updated_at: new Date().toISOString() };
        if (brand) updates.brand = brand;
        if (category) updates.category = category;
        if (model) updates.model = model;
        if (Object.keys(updates).length > 1) {
          const { error: pErr } = await supabase.from('products').update(updates).eq('product_code', productCode).eq('tenant_id', tenantId);
          if (pErr) console.warn('Product update hatası:', pErr.message);
        }
      } else if (name) {
        const { error: insertErr } = await supabase.from('products').insert({ product_code: productCode, product_name: name, brand: brand || null, category: category || null, model: model || null, source: 'invoice', tenant_id: tenantId });
        if (insertErr) console.warn('Product insert hatası:', insertErr.message);
      }
    }
  }
}

// ─── Helper: enrich invoice_items with product metadata ──────────────────────
async function enrichItemsWithProductMeta(supabase, data, tenantId) {
  if (!Array.isArray(data)) return;
  const skus = [...new Set(data.flatMap(inv => (inv.invoice_items || []).map(it => String(it.product_code || '').trim()).filter(Boolean)))];
  if (!skus.length) return;
  let q = supabase.from('products').select('product_code, brand, category, model').in('product_code', skus);
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data: products } = await q;
  const productMap = new Map((products || []).map(p => [String(p.product_code || '').trim(), p]));
  data.forEach(inv => {
    (inv.invoice_items || []).forEach(item => {
      const p = productMap.get(String(item.product_code || '').trim());
      item.brand = p?.brand || '';
      item.category = p?.category || '';
      item.model = p?.model || '';
    });
  });
}

// ─── Helper: recalculate purchase order status ───────────────────────────────
async function recalcOrderStatus(supabase, touchedOrderIds) {
  for (const orderId of touchedOrderIds) {
    const { data: orderItems, error } = await supabase.from('purchase_order_items').select('ordered_qty, received_qty').eq('purchase_order_id', orderId);
    if (error) throw error;
    let nextStatus = 'Bekliyor';
    if ((orderItems || []).length > 0) {
      const allCompleted = orderItems.every(oi => Number(oi.received_qty || 0) >= Number(oi.ordered_qty || 0));
      const anyReceived = orderItems.some(oi => Number(oi.received_qty || 0) > 0);
      if (allCompleted) nextStatus = 'Tamamlandı';
      else if (anyReceived) nextStatus = 'Kısmi Geldi';
    }
    await supabase.from('purchase_orders').update({ status: nextStatus }).eq('id', orderId);
  }
}
// ─── SHARED HELPER — used by both the /kpi-summary route AND the chat tool ───
async function fetchKpiSummary(supabase, tenantId, opts = {}) {
    const {
        direction,
        pending          = false,
        dateStart        = null,
        dateEnd          = null,
        currency         = null,
        priceMin         = null,
        priceMax         = null,
        companies        = null,
        brands           = null,
        categories       = null,
        products         = null,
        invoiceNumbers   = null,
    } = opts;

    const emptyRes = {
        totals: { total_count: 0, company_count: 0, try_total: 0, try_count: 0, usd_total: 0, usd_count: 0, eur_total: 0, eur_count: 0 }
    };
    const hasItemFilter = !!(brands?.length || categories?.length || products?.length);

    // ── Step 1: resolve filter IDs ──────────────────────────────────────────
    let brandFilteredIds = null;
    if (brands?.length) {
        const { data: brandItems } = await supabase
            .from('invoice_items').select('invoice_id').in('brand_name', brands);
        brandFilteredIds = [...new Set((brandItems || []).map(r => r.invoice_id).filter(Boolean))];
        if (!brandFilteredIds.length) return emptyRes;
    }

    let categoryFilteredIds = null;
    if (categories?.length) {
        const { data: catProducts } = await supabase
            .from('products').select('product_code').in('category', categories).eq('tenant_id', tenantId);
        const catCodes = (catProducts || []).map(r => r.product_code).filter(Boolean);
        if (!catCodes.length) return emptyRes;
        const { data: catItems } = await supabase
            .from('invoice_items').select('invoice_id').in('product_code', catCodes);
        categoryFilteredIds = [...new Set((catItems || []).map(r => r.invoice_id).filter(Boolean))];
        if (!categoryFilteredIds.length) return emptyRes;
    }

    let productFilteredIds = null;
    if (products?.length) {
        const { data: prodItems } = await supabase
            .from('invoice_items').select('invoice_id').in('product_name', products);
        productFilteredIds = [...new Set((prodItems || []).map(r => r.invoice_id).filter(Boolean))];
        if (!productFilteredIds.length) return emptyRes;
    }

    // ── Step 2: company filter ──────────────────────────────────────────────
    let companyIds = null;
    if (companies?.length) {
        const { data: matchedCompanies } = await supabase
            .from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
        companyIds = (matchedCompanies || []).map(c => c.id);
        if (!companyIds.length) return emptyRes;
    }

    // ── Step 3: excluded ids ────────────────────────────────────────────────
    const { data: excluded } = await supabase
        .from('fully_internal_invoice_ids').select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    // ── Step 4: build query ─────────────────────────────────────────────────
    let q = supabase
        .from('invoices')
        .select('id, company_id, base_currency, payable_amount_tl, payable_amount_cur')
        .eq('tenant_id', tenantId)
        .or('approval_status.neq.pending,approval_status.is.null');

    if (pending) {
        q = supabase.from('invoices')
            .select('id, base_currency, payable_amount_tl, payable_amount_cur')
            .eq('tenant_id', tenantId).eq('approval_status', 'pending');
    }

    if (direction)                    q = q.eq('direction', direction);
    if (currency)                     q = q.eq('base_currency', currency);
    if (dateStart)                    q = q.gte('invoice_date', dateStart);
    if (dateEnd)                      q = q.lte('invoice_date', dateEnd);
    if (priceMin != null)             q = q.gte('payable_amount_tl', priceMin);
    if (priceMax != null)             q = q.lte('payable_amount_tl', priceMax);
    if (companyIds?.length)           q = q.in('company_id', companyIds);
    if (invoiceNumbers?.length)       q = q.in('invoice_no', invoiceNumbers);
    if (excludeIds.length)            q = q.not('id', 'in', `(${excludeIds.join(',')})`);

    // Combine item filter IDs into a single .in() call (URL-length safe)
    let combinedIds = null;
    if (brandFilteredIds !== null) combinedIds = brandFilteredIds;
    if (categoryFilteredIds !== null) {
        combinedIds = combinedIds ? combinedIds.filter(id => categoryFilteredIds.includes(id)) : categoryFilteredIds;
    }
    if (productFilteredIds !== null) {
        combinedIds = combinedIds ? combinedIds.filter(id => productFilteredIds.includes(id)) : productFilteredIds;
    }
    if (combinedIds !== null) q = q.in('id', combinedIds);

    const { data: invoiceRows, error } = await q;
    if (error) throw error;
    if (!invoiceRows?.length) return emptyRes;

    // ── Step 5: aggregate ───────────────────────────────────────────────────
    if (!hasItemFilter) {
        let try_total = 0, try_count = 0, usd_total = 0, usd_count = 0, eur_total = 0, eur_count = 0, total_count = 0;
        invoiceRows.forEach(r => {
            total_count++;
            const cur = (r.base_currency || 'TRY').toUpperCase();
            if (cur === 'USD')                      { usd_total += parseFloat(r.payable_amount_cur) || 0; usd_count++; }
            else if (cur === 'TRY' || cur === 'TL') { try_total += parseFloat(r.payable_amount_tl)  || 0; try_count++; }
            else if (cur === 'EUR')                 { eur_total += parseFloat(r.payable_amount_cur) || 0; eur_count++; }
        });
        const company_count = new Set(invoiceRows.map(r => r.company_id).filter(Boolean)).size;
        return { totals: { total_count, company_count, try_total, try_count, usd_total, usd_count, eur_total, eur_count } };
    }

    // Item filter path — aggregate from items, derive counts from distinct invoices
    const validInvoiceIds = invoiceRows.map(r => r.id);
    const { data: itemRows } = await supabase
        .from('invoice_items')
        .select('invoice_id, currency, total_price_cur, product_code, brand_name, product_name, is_internal')
        .eq('is_internal', false)
        .in('invoice_id', validInvoiceIds);

    let matchingItems = itemRows || [];
    if (brandFilteredIds)    matchingItems = matchingItems.filter(r => brands.includes(r.brand_name));
    if (categoryFilteredIds) matchingItems = matchingItems.filter(r => categoryFilteredIds.includes(r.invoice_id));
    if (productFilteredIds)  matchingItems = matchingItems.filter(r => products.includes(r.product_name));

    if (!matchingItems.length) return emptyRes;

    const matchingInvoiceIds = new Set(matchingItems.map(r => r.invoice_id));
    const matchingInvoices   = invoiceRows.filter(r => matchingInvoiceIds.has(r.id));
    const company_count      = new Set(matchingInvoices.map(r => r.company_id).filter(Boolean)).size;
    const total_count        = matchingInvoiceIds.size;

    let try_total = 0, try_count = 0, usd_total = 0, usd_count = 0, eur_total = 0, eur_count = 0;
    matchingItems.forEach(r => {
        const cur = (r.currency || 'TRY').toUpperCase();
        if (cur === 'USD')                      { usd_total += parseFloat(r.total_price_cur) || 0; usd_count++; }
        else if (cur === 'TRY' || cur === 'TL') { try_total += parseFloat(r.total_price_cur) || 0; try_count++; }
        else if (cur === 'EUR')                 { eur_total += parseFloat(r.total_price_cur) || 0; eur_count++; }
    });

    return { totals: { total_count, company_count, try_total, try_count, usd_total, usd_count, eur_total, eur_count } };
}

async function fetchInvoiceList(supabase, tenantId, opts = {}) {
    const {
        direction,
        dateStart          = null,
        dateEnd            = null,
        currency           = null,
        priceMin           = null,
        priceMax           = null,
        companies          = null,
        brands             = null,
        categories         = null,
        products           = null,
        invoiceNumbers     = null,
        sortBy             = 'date',
        sortDir            = 'desc',
        limit              = 10,
    } = opts;

    const cappedLimit = Math.min(Math.max(limit, 1), 20);

    // ── Step 1: resolve filter IDs (same pattern as fetchKpiSummary) ────────
    let brandFilteredIds = null;
    if (brands?.length) {
        const { data: brandItems } = await supabase
            .from('invoice_items').select('invoice_id').in('brand_name', brands);
        brandFilteredIds = [...new Set((brandItems || []).map(r => r.invoice_id).filter(Boolean))];
        if (!brandFilteredIds.length) return [];
    }

    let categoryFilteredIds = null;
    if (categories?.length) {
        const { data: catProducts } = await supabase
            .from('products').select('product_code').in('category', categories).eq('tenant_id', tenantId);
        const catCodes = (catProducts || []).map(r => r.product_code).filter(Boolean);
        if (!catCodes.length) return [];
        const { data: catItems } = await supabase
            .from('invoice_items').select('invoice_id').in('product_code', catCodes);
        categoryFilteredIds = [...new Set((catItems || []).map(r => r.invoice_id).filter(Boolean))];
        if (!categoryFilteredIds.length) return [];
    }

    let productFilteredIds = null;
    if (products?.length) {
        const { data: prodItems } = await supabase
            .from('invoice_items').select('invoice_id').in('product_name', products);
        productFilteredIds = [...new Set((prodItems || []).map(r => r.invoice_id).filter(Boolean))];
        if (!productFilteredIds.length) return [];
    }

    let companyIds = null;
    if (companies?.length) {
        const { data: matchedCompanies } = await supabase
            .from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
        companyIds = (matchedCompanies || []).map(c => c.id);
        if (!companyIds.length) return [];
    }

    // ── Step 2: excluded IDs ────────────────────────────────────────────────
    const { data: excluded } = await supabase
        .from('fully_internal_invoice_ids').select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    // ── Step 3: sort column resolution ──────────────────────────────────────
    const sortColMap = {
        date:       'invoice_date',
        amount:     'payable_amount_tl',
        company:    'company_name',       // requires the invoices_with_company view
        invoice_no: 'invoice_no',
    };
    const sortCol     = sortColMap[sortBy] || 'invoice_date';
    const sourceTable = sortCol === 'company_name' ? 'invoices_with_company' : 'invoices';

    // ── Step 4: build query ─────────────────────────────────────────────────
    let q = supabase
        .from(sourceTable)
        .select('id, invoice_no, invoice_date, payable_amount_tl, payable_amount_cur, base_currency, pdf_url, companies(name)')
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .or('approval_status.neq.pending,approval_status.is.null');

    if (direction)              q = q.eq('direction', direction);
    if (currency)               q = q.eq('base_currency', currency);
    if (dateStart)              q = q.gte('invoice_date', dateStart);
    if (dateEnd)                q = q.lte('invoice_date', dateEnd);
    if (priceMin != null)       q = q.gte('payable_amount_tl', priceMin);
    if (priceMax != null)       q = q.lte('payable_amount_tl', priceMax);
    if (invoiceNumbers?.length) q = q.in('invoice_no', invoiceNumbers);
    if (companyIds?.length)     q = q.in('company_id', companyIds);
    if (excludeIds.length)      q = q.not('id', 'in', `(${excludeIds.join(',')})`);

    // Combine item filter IDs into single .in() call (URL-length safe)
    let combinedIds = null;
    if (brandFilteredIds !== null) combinedIds = brandFilteredIds;
    if (categoryFilteredIds !== null) {
        combinedIds = combinedIds ? combinedIds.filter(id => categoryFilteredIds.includes(id)) : categoryFilteredIds;
    }
    if (productFilteredIds !== null) {
        combinedIds = combinedIds ? combinedIds.filter(id => productFilteredIds.includes(id)) : productFilteredIds;
    }
    if (combinedIds !== null) q = q.in('id', combinedIds);

    // Sort + limit
    q = q.order(sortCol, { ascending: sortDir === 'asc' }).limit(cappedLimit);

    const { data, error } = await q;
    if (error) throw error;

    // ── Step 5: trim to essentials for Claude ───────────────────────────────
    return (data || []).map(row => ({
        invoice_no: row.invoice_no,
        company:    row.companies?.name || row.company_name || 'Bilinmeyen',
        date:       row.invoice_date,
        amount_tl:  parseFloat(row.payable_amount_tl)  || 0,
        amount_cur: parseFloat(row.payable_amount_cur) || 0,
        currency:   row.base_currency || 'TRY',
        pdf_url:    row.pdf_url || null,   // ← add
    }));
}

async function fetchProductBreakdown(supabase, tenantId, opts = {}) {
    const {
        direction,
        companies      = null,
        dateStart      = null,
        dateEnd        = null,
        currency       = null,
        groupBy        = 'product',
        sortBy         = 'total',
        limit          = 10,
    } = opts;

    const cappedLimit = Math.min(Math.max(limit, 1), 20);

    // Step 1: resolve company IDs
    let companyIds = null;
    if (companies?.length) {
        const { data: matched } = await supabase
            .from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
        companyIds = (matched || []).map(c => c.id);
        if (!companyIds.length) return [];
    }

    // Step 2: get excluded invoice ids
    const { data: excluded } = await supabase
        .from('fully_internal_invoice_ids').select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    // Step 3: fetch invoices matching the filter — capture their calculation_rate too
    let invQ = supabase
        .from('invoices')
        .select('id, calculation_rate, base_currency')
        .eq('tenant_id', tenantId)
        .or('approval_status.neq.pending,approval_status.is.null');

    if (direction)          invQ = invQ.eq('direction', direction);
    if (currency)           invQ = invQ.eq('base_currency', currency);
    if (dateStart)          invQ = invQ.gte('invoice_date', dateStart);
    if (dateEnd)            invQ = invQ.lte('invoice_date', dateEnd);
    if (companyIds?.length) invQ = invQ.in('company_id', companyIds);
    if (excludeIds.length)  invQ = invQ.not('id', 'in', `(${excludeIds.join(',')})`);

    const { data: invRows, error: invErr } = await invQ;
    if (invErr) throw invErr;

    const invoiceIds = (invRows || []).map(r => r.id);
    if (!invoiceIds.length) return [];

    // Build invoice_id → calculation_rate map for TL conversion
    const rateMap = new Map();
    (invRows || []).forEach(r => {
        rateMap.set(r.id, parseFloat(r.calculation_rate) || 1);
    });

    // Step 4: fetch items for those invoices
    // Chunk if too many (URL length safety)
    let itemRows;
    if (invoiceIds.length <= 500) {
        const { data } = await supabase
            .from('invoice_items')
            .select('invoice_id, product_name, product_code, brand_name, quantity, total_price_cur, currency, is_internal')
            .eq('is_internal', false)
            .in('invoice_id', invoiceIds);
        itemRows = data || [];
    } else {
        // Fallback: fetch all non-internal, filter in JS
        const { data } = await supabase
            .from('invoice_items')
            .select('invoice_id, product_name, product_code, brand_name, quantity, total_price_cur, currency, is_internal')
            .eq('is_internal', false);
        const idSet = new Set(invoiceIds);
        itemRows = (data || []).filter(r => idSet.has(r.invoice_id));
    }

    // Step 5: enrich with category if needed
    let categoryMap = {};
    if (groupBy === 'category') {
        const productCodes = [...new Set(itemRows.map(r => r.product_code).filter(Boolean))];
        if (productCodes.length) {
            const { data: productRows } = await supabase
                .from('products')
                .select('product_code, category')
                .eq('tenant_id', tenantId)
                .in('product_code', productCodes);
            (productRows || []).forEach(p => {
                if (p.product_code && p.category) categoryMap[p.product_code] = p.category;
            });
        }
    }

    // Step 6: aggregate — per-currency totals + TL-equivalent for sorting
    const bucketMap = new Map();

    itemRows.forEach(r => {
        let key;
        if (groupBy === 'brand')         key = r.brand_name;
        else if (groupBy === 'category') key = categoryMap[r.product_code];
        else                             key = r.product_name;

        if (!key) return;

        if (!bucketMap.has(key)) {
            bucketMap.set(key, {
                name:          key,
                count:         0,
                quantity:      0,
                try_total:     0,
                usd_total:     0,
                eur_total:     0,
                tl_equivalent: 0,   // used for sorting only, not sent to Claude
            });
        }

        const b        = bucketMap.get(key);
        const rate     = rateMap.get(r.invoice_id) || 1;
        const cur      = (r.currency || 'TRY').toUpperCase();
        const priceCur = parseFloat(r.total_price_cur) || 0;

        b.lineCount++;                                  // number of invoice lines
        b.quantity += parseFloat(r.quantity) || 0;      // total units sold

        if (cur === 'USD') {
            b.usd_total     += priceCur;
            b.tl_equivalent += priceCur * rate;
        } else if (cur === 'EUR') {
            b.eur_total     += priceCur;
            b.tl_equivalent += priceCur * rate;
        } else {
            // TRY / TL
            b.try_total     += priceCur;
            b.tl_equivalent += priceCur;
        }
    });

    // Step 7: sort — use tl_equivalent when sorting by total (for cross-currency correctness)
    const sortKey = sortBy === 'count'    ? 'count'
                  : sortBy === 'quantity' ? 'quantity'
                                          : 'tl_equivalent';

    const sorted = [...bucketMap.values()]
        .sort((a, b) => b[sortKey] - a[sortKey])
        .slice(0, cappedLimit);

    // Step 8: strip tl_equivalent from the response — it was internal-only
    return sorted.map(({ tl_equivalent, ...rest }) => rest);
}


// GET /api/invoices
router.get('/', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const direction = req.query.direction;
    const companyId = req.query.company_id;
    const status = req.query.status;
    const currency = req.query.currency;
    const dateStart = req.query.date_start;
    const dateEnd = req.query.date_end;
    const priceMin = req.query.price_min ? parseFloat(req.query.price_min) : null;
    const priceMax = req.query.price_max ? parseFloat(req.query.price_max) : null;
    const search = req.query.search;
    const invoiceNumbers = req.query.invoice_numbers ? req.query.invoice_numbers.split(',').map(s => s.trim()).filter(Boolean) : [];
    const companies = req.query.companies ? req.query.companies.split(',').map(s => s.trim()).filter(Boolean) : [];
    const brands = req.query.brands ? req.query.brands.split(',').map(s => s.trim()).filter(Boolean) : [];
    const categories = req.query.categories ? req.query.categories.split(',').map(s => s.trim()).filter(Boolean) : [];
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const allowedSortCols = {
        invoice_date:  'invoice_date',
        company_name:  'company_name',   // ← matches the view column
        total:         'payable_amount_tl',
        invoice_no:    'invoice_no',
    };

    const sortBy  = allowedSortCols[req.query.sort_by] || 'invoice_date';   // ← default
    const sortDir = req.query.sort_dir === 'asc' ? 'asc' : 'desc';

    const sourceTable = (sortBy === 'company_name') ? 'invoices_with_company' : 'invoices';
    const sortCol     = (sortBy === 'company_name') ? 'company_name' : sortBy;


    let companyIds = [];
    if (companies.length) {
      const { data: matchedCompanies } = await supabase.from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
      companyIds = (matchedCompanies || []).map(c => c.id);
      if (!companyIds.length) return res.json({ data: [], total: 0, page, limit, total_pages: 0 });
    }

    let brandFilteredIds = null;
    if (brands.length) {
      const { data: brandItems } = await supabase.from('invoice_items').select('invoice_id').in('brand_name', brands);
      brandFilteredIds = [...new Set((brandItems || []).map(r => r.invoice_id).filter(Boolean))];
      if (!brandFilteredIds.length) return res.json({ data: [], total: 0, page, limit, total_pages: 0 });
    }

    let categoryFilteredIds = null;
    if (categories.length) {
      const { data: catProducts } = await supabase.from('products').select('product_code').in('category', categories).eq('tenant_id', tenantId);
      const catCodes = (catProducts || []).map(r => r.product_code).filter(Boolean);
      if (!catCodes.length) return res.json({ data: [], total: 0, page, limit, total_pages: 0 });
      const { data: catItems } = await supabase.from('invoice_items').select('invoice_id').in('product_code', catCodes);
      categoryFilteredIds = [...new Set((catItems || []).map(r => r.invoice_id).filter(Boolean))];
      if (!categoryFilteredIds.length) return res.json({ data: [], total: 0, page, limit, total_pages: 0 });
    }

    const products = req.query.products ? req.query.products.split(',').map(s => decodeURIComponent(s.trim())).filter(Boolean) : [];
    let productFilteredIds = null;
    if (products.length) {
      const { data: prodItems } = await supabase.from('invoice_items').select('invoice_id').in('product_name', products);
      productFilteredIds = [...new Set((prodItems || []).map(r => r.invoice_id).filter(Boolean))];
      if (!productFilteredIds.length) return res.json({ data: [], total: 0, page, limit, total_pages: 0 });
    }


    let query = supabase
      .from(sourceTable)                                              // ← changed
      .select('*, companies(*), invoice_items(*)', { count: 'exact' })
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .or('approval_status.neq.pending,approval_status.is.null')
      .order(sortCol, { ascending: sortDir === 'asc' });


    // Sonra excluded'ı çek ve query'ye ekle
    const { data: excluded } = await supabase
      .from('fully_internal_invoice_ids')
      .select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);
    if (excludeIds.length) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`);
    }

    if (direction) query = query.eq('direction', direction);
    if (status) query = query.ilike('status', status);
    if (currency) query = query.eq('base_currency', currency);
    if (dateStart) query = query.gte('invoice_date', dateStart);
    if (dateEnd) query = query.lte('invoice_date', dateEnd);
    if (priceMin != null) query = query.gte('payable_amount_tl', priceMin);
    if (priceMax != null) query = query.lte('payable_amount_tl', priceMax);
    if (search) query = query.or(`invoice_no.ilike.%${search}%`);
    if (invoiceNumbers.length) query = query.in('invoice_no', invoiceNumbers);
    if (companyId) query = query.eq('company_id', companyId);
    if (companyIds?.length) query = query.in('company_id', companyIds);

    let combinedIds = null;
    if (brandFilteredIds !== null) {
        combinedIds = brandFilteredIds;
    }
    if (categoryFilteredIds !== null) {
        combinedIds = combinedIds
            ? combinedIds.filter(id => categoryFilteredIds.includes(id))
            : categoryFilteredIds;
    }
    if (productFilteredIds !== null) {
        combinedIds = combinedIds
            ? combinedIds.filter(id => productFilteredIds.includes(id))
            : productFilteredIds;
    }

    // Single .in() call with the intersection
    if (combinedIds !== null) query = query.in('id', combinedIds);
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    await enrichItemsWithProductMeta(supabase, data, tenantId);

    res.json({ data: data || [], total: count || 0, page, limit, total_pages: Math.ceil((count || 0) / limit) });
  } catch (err) {
    console.error('Fatura Çekme Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/filter-options', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const direction = req.query.direction;

    //because we don't have invoice based internal-noninternal seperation we do it from invoiceitems
    // Small exclude list — negation is URL-safe
    const { data: excluded } = await supabase
      .from('fully_internal_invoice_ids')
      .select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    let invQuery = supabase
      .from('invoices')
      .select('id, invoice_no, base_currency, companies(name)')
      .eq('tenant_id', tenantId)
      .or('approval_status.neq.pending,approval_status.is.null');

    if (excludeIds.length) invQuery = invQuery.not('id', 'in', `(${excludeIds.join(',')})`);

    if (direction) invQuery = invQuery.eq('direction', direction);

    const { data: invRows } = await invQuery;


    const companies = [...new Set((invRows || []).map(r => r.companies?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    const currencies = [...new Set((invRows || []).map(r => r.base_currency).filter(Boolean))].sort();
    const invoiceNumbers = [...new Set((invRows || []).map(r => r.invoice_no).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));   // ← add

    const invoiceNoMap = {};
    (invRows || []).forEach(r => {
        if (r.id && r.invoice_no) invoiceNoMap[r.id] = r.invoice_no;
    });
    // FIX 1: build invoiceCompanyMap from invRows
    const invoiceCompanyMap = {};
    (invRows || []).forEach(r => {
      if (r.id && r.companies?.name) invoiceCompanyMap[r.id] = r.companies.name;
    });

    // Fetch ALL non-internal items (no huge .in())
    let itemQuery = supabase
      .from('invoice_items')
      .select('invoice_id, brand_name, product_name, product_code')
      .eq('is_internal', false);

    const { data: allItems } = await itemQuery;

    // If direction filter is active, keep only items whose invoice matches
    let itemRows = allItems || [];
    if (direction) {
      const directionInvoiceIds = new Set((invRows || []).map(r => r.id).filter(Boolean));
      itemRows = itemRows.filter(r => directionInvoiceIds.has(r.invoice_id));
    }

    const products  = [...new Set((itemRows || []).map(r => r.product_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    const productCodes = [...new Set((itemRows || []).map(r => r.product_code).filter(Boolean))];

    // FIX 3: initialize to [] so they're never undefined
    let categories    = [];
    let relationships = [];
    let brands              = [];

    if (productCodes.length) {
      const { data: productRows } = await supabase
        .from('products')
        .select('product_code, category,brand, model')
        .eq('tenant_id', tenantId)
        .eq('is_internal', false)
        .in('product_code', productCodes)
        .not('category', 'is', null);

      categories = [...new Set((productRows || []).map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
      brands    = [...new Set((productRows || []).map(r => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));

      const productCodeMeta = {};
      (productRows || []).forEach(r => {
        productCodeMeta[r.product_code] = { category: r.category, model: r.model, brand: r.brand };
      });

      // FIX 4: deduplicate relationships
      const seen = new Set();
      relationships = (itemRows || [])
        .filter(r => r.product_code && productCodeMeta[r.product_code])
        .reduce((acc, r) => {
          const key = `${r.invoice_id}|${r.brand_name}|${r.product_name}|${productCodeMeta[r.product_code].category}`;
          if (!seen.has(key)) {
            seen.add(key);
            acc.push({
              invoiceNo: r.invoice_id ? (invoiceNoMap[r.invoice_id] || null) : null,
              company:  invoiceCompanyMap[r.invoice_id] || null,
              brand:    productCodeMeta[r.product_code].brand   || null,
              product:  r.product_name || null,
              category: productCodeMeta[r.product_code].category,
              model:    productCodeMeta[r.product_code].model || null,
            });
          }
          return acc;
        }, []);
    }

    res.json({ companies, brands, products, categories, currencies, invoiceNumbers, relationships });

  } catch (err) {
    console.error('filter-options hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/totals
router.get('/totals', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const direction = req.query.direction;
    const status = req.query.status;
    const currency = req.query.currency;
    const dateStart = req.query.date_start;
    const dateEnd = req.query.date_end;
    const search = req.query.search;
    const companies = req.query.companies ? req.query.companies.split(',').map(s => s.trim()).filter(Boolean) : [];
    const brands = req.query.brands ? req.query.brands.split(',').map(s => s.trim()).filter(Boolean) : [];

    const { data: niItems } = await supabase.from('invoice_items').select('invoice_id').eq('is_internal', false);
    const nonInternalIds = [...new Set((niItems || []).map(r => r.invoice_id).filter(Boolean))];
    if (!nonInternalIds.length) return res.json({ total_tl: 0, total_usd: 0, count: 0, unpaid_tl: 0 });

    // Companies
    const companyIds = await resolveCompanyIds(supabase, tenantId, companies);
    if (companyIds !== null && !companyIds.length) return res.json(/* empty */);

    // Brands
    const brandIds = await resolveInvoiceIdsByBrand(supabase, brands);
    if (brandIds !== null && !brandIds.length) return res.json(/* empty */);

    // Categories
    const categoryIds = await resolveInvoiceIdsByCategory(supabase, tenantId, categories);
    if (categoryIds !== null && !categoryIds.length) return res.json(/* empty */);

    // Products
    const productIds = await resolveInvoiceIdsByProduct(supabase, products);
    if (productIds !== null && !productIds.length) return res.json(/* empty */);

    const pendingOnly = req.query.pending === 'true';
    let query = supabase
      .from('invoices')
      .select('payable_amount_tl, payable_amount_cur, base_currency, status, paid_amount_cur, calculation_rate')
      .eq('tenant_id', tenantId)
      .in('id', nonInternalIds);

    if (pendingOnly) query = query.eq('approval_status', 'pending');
    else query = query.or('approval_status.neq.pending,approval_status.is.null');

    if (direction) query = query.eq('direction', direction);
    if (status) query = query.ilike('status', status);
    if (currency) query = query.eq('base_currency', currency);
    if (dateStart) query = query.gte('invoice_date', dateStart);
    if (dateEnd) query = query.lte('invoice_date', dateEnd);
    if (search) query = query.or(`invoice_no.ilike.%${search}%`);
    if (companyIds?.length) query = query.in('company_id', companyIds);
    if (brandIds) query = query.in('id', brandIds);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const total_tl = rows.filter(r => (r.base_currency || 'TRY').toUpperCase() === 'TRY').reduce((s, r) => s + (parseFloat(r.payable_amount_tl) || 0), 0);
    const total_usd = rows.filter(r => (r.base_currency || '').toUpperCase() === 'USD').reduce((s, r) => s + (parseFloat(r.payable_amount_cur) || 0), 0);
    const unpaid_tl = rows.filter(r => r.status !== 'Paid').reduce((s, r) => {
      const paid = parseFloat(r.paid_amount_cur) || 0;
      const total = parseFloat(r.payable_amount_cur) || 0;
      return s + Math.max(total - paid, 0) * (parseFloat(r.calculation_rate) || 1);
    }, 0);

    res.json({ count: rows.length, total_tl, total_usd, unpaid_tl });
  } catch (err) {
    console.error('Totals hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// GET /api/invoices/price-histogram
router.get('/price-histogram', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const direction = req.query.direction;
    const BIN_COUNT = 10;



    // Build query — only fetch payable_amount_tl
    let query = supabase
      .from('invoices')
      .select('payable_amount_tl')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .or('approval_status.neq.pending,approval_status.is.null')
      .not('payable_amount_tl', 'is', null);

    if (direction) query = query.eq('direction', direction);

    const { data, error } = await query;
    if (error) throw error;

    const amounts = (data || []).map(r => parseFloat(r.payable_amount_tl)).filter(n => !isNaN(n) && n > 0);

    if (!amounts.length) {
      return res.json({ min: 0, max: 0, bins: [] });
    }

    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const range = max - min || 1;
    const binWidth = range / BIN_COUNT;

    const bins = Array.from({ length: BIN_COUNT }, (_, i) => ({
      rangeStart: Math.round(min + i * binWidth),
      rangeEnd:   Math.round(min + (i + 1) * binWidth),
      count: 0,
    }));

    amounts.forEach(a => {
      let idx = Math.floor((a - min) / binWidth);
      if (idx >= BIN_COUNT) idx = BIN_COUNT - 1;
      bins[idx].count++;
    });

    res.json({ min: Math.round(min), max: Math.round(max), bins });
  } catch (err) {
    console.error('price-histogram hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/kpi-summary', async (req, res) => {
    try {
        const opts = {
            direction:      req.query.direction,
            pending:        req.query.pending === 'true',
            dateStart:      req.query.date_start,
            dateEnd:        req.query.date_end,
            currency:       req.query.currency,
            priceMin:       req.query.price_min ? parseFloat(req.query.price_min) : null,
            priceMax:       req.query.price_max ? parseFloat(req.query.price_max) : null,
            companies:      req.query.companies?.split(',').map(s => s.trim()).filter(Boolean),
            brands:         req.query.brands?.split(',').map(s => s.trim()).filter(Boolean),
            categories:     req.query.categories?.split(',').map(s => s.trim()).filter(Boolean),
            products:       req.query.products?.split(',').map(s => decodeURIComponent(s.trim())).filter(Boolean),
            invoiceNumbers: req.query.invoice_numbers?.split(',').map(s => s.trim()).filter(Boolean),
        };
        const result = await fetchKpiSummary(req.app.get('supabase'), req.tenantId, opts);
        res.json(result);
    } catch (err) {
        console.error('kpi-summary hatası:', err.message);
        res.status(500).json({ error: err.message });
    }
});
router.get('/kpi-deltas', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const direction = req.query.direction;

    // Compute date windows
    const iso = d => d.toISOString().slice(0, 10);
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const daysAgo = n => {
      const d = new Date(today);
      d.setDate(today.getDate() - n);
      return d;
    };

    const currentStart  = daysAgo(30);
    const currentEnd    = today;
    const previousStart = daysAgo(60);
    const previousEnd   = daysAgo(30);

    // Fetch exclude list once (fully-internal invoices)
    const { data: excluded } = await supabase
      .from('fully_internal_invoice_ids')
      .select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    // Helper — fetch a window and reduce to totals
    async function _fetchWindow(startDate, endDateExclusive) {
      let q = supabase
        .from('invoices')
        .select('company_id, base_currency, payable_amount_tl, payable_amount_cur')
        .eq('tenant_id', tenantId)
        .or('approval_status.neq.pending,approval_status.is.null')
        .gte('invoice_date', iso(startDate))
        .lt('invoice_date', iso(endDateExclusive));

      if (direction) q = q.eq('direction', direction);
      if (excludeIds.length) q = q.not('id', 'in', `(${excludeIds.join(',')})`);

      const { data, error } = await q;
      if (error) return { count: 0, company_count: 0, try_total: 0, usd_total: 0, eur_total: 0 };

      const totals = { count: 0, try_total: 0, usd_total: 0, eur_total: 0, companies: new Set() };

      (data || []).forEach(r => {
        totals.count++;
        if (r.company_id) totals.companies.add(r.company_id);

        const cur = (r.base_currency || 'TRY').toUpperCase();
        if (cur === 'USD')                      totals.usd_total += parseFloat(r.payable_amount_cur) || 0;
        else if (cur === 'TRY' || cur === 'TL') totals.try_total += parseFloat(r.payable_amount_tl)  || 0;
        else if (cur === 'EUR')                 totals.eur_total += parseFloat(r.payable_amount_cur) || 0;
      });

      return {
        count:         totals.count,
        company_count: totals.companies.size,
        try_total:     totals.try_total,
        usd_total:     totals.usd_total,
        eur_total:     totals.eur_total,
      };
    }

    // Fetch both windows in parallel
    const [current, previous] = await Promise.all([
      _fetchWindow(currentStart,  currentEnd),
      _fetchWindow(previousStart, previousEnd),
    ]);

    res.json({
      current,
      previous,
      window: {
        current_start:  iso(currentStart),
        current_end:    iso(currentEnd),
        previous_start: iso(previousStart),
        previous_end:   iso(previousEnd),
      },
    });

  } catch (err) {
    console.error('kpi-deltas hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/cashflow-series', async (req, res) => {
  try {
    const supabase  = req.app.get('supabase');
    const tenantId  = req.tenantId;
    const { direction, date_start, date_end, bucket = 'month' } = req.query;

    // get excluded invoice ids
    const { data: excluded } = await supabase
      .from('fully_internal_invoice_ids')
      .select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    let q = supabase
      .from('invoices')
      .select('invoice_date, base_currency, payable_amount_tl, payable_amount_cur')
      .eq('tenant_id', tenantId)
      .or('approval_status.neq.pending,approval_status.is.null');

    if (direction)  q = q.eq('direction', direction);
    if (date_start) q = q.gte('invoice_date', date_start);
    if (date_end)   q = q.lte('invoice_date', date_end);
    if (excludeIds.length) q = q.not('id', 'in', `(${excludeIds.join(',')})`);

    const { data: rows, error } = await q;
    if (error) throw error;

    // Bucket key generator based on requested grain
    const keyOf = d => {
      if (bucket === 'day') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      if (bucket === 'week') {
        // Monday-start week — return ISO date of the Monday
        const day = d.getDay() || 7;   // Sun=0 → 7
        const monday = new Date(d);
        monday.setHours(0, 0, 0, 0);
        monday.setDate(d.getDate() - (day - 1));
        return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      }
      // default: month
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const buckets = {};
    (rows || []).forEach(r => {
      if (!r.invoice_date) return;
      const d = new Date(r.invoice_date);
      const k = keyOf(d);
      if (!buckets[k]) buckets[k] = { period: k, try_total: 0, usd_total: 0, eur_total: 0 };
      const cur = (r.base_currency || 'TRY').toUpperCase();
      if (cur === 'USD')                      buckets[k].usd_total += parseFloat(r.payable_amount_cur) || 0;
      else if (cur === 'TRY' || cur === 'TL') buckets[k].try_total += parseFloat(r.payable_amount_tl)  || 0;
      else if (cur === 'EUR')                 buckets[k].eur_total += parseFloat(r.payable_amount_cur) || 0;
    });

    const series = Object.values(buckets).sort((a, b) => a.period.localeCompare(b.period));
    res.json({ series, bucket });

  } catch (err) {
    console.error('cashflow-series hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});


router.get('/top-companies', async (req, res) => {
  try {
    const supabase   = req.app.get('supabase');
    const tenantId   = req.tenantId;
    const limit = parseInt(req.query.limit) || null;
    const direction  = req.query.direction;
    const dateStart  = req.query.date_start;
    const dateEnd    = req.query.date_end;

    // Exclude fully-internal invoices
    // Fetch the small "fully internal" exclude list
    const { data: excluded } = await supabase
      .from('fully_internal_invoice_ids')
      .select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    // Fetch invoices with company name, direction, amounts
    let query = supabase
      .from('invoices')
      .select('direction, base_currency, payable_amount_tl, payable_amount_cur, calculation_rate, companies(name)')
      .eq('tenant_id', tenantId)
      .or('approval_status.neq.pending,approval_status.is.null');

    if (excludeIds.length) query = query.not('id', 'in', `(${excludeIds.join(',')})`);

    if (direction)  query = query.eq('direction', direction);
    if (dateStart)  query = query.gte('invoice_date', dateStart);
    if (dateEnd)    query = query.lte('invoice_date', dateEnd);

    const { data, error } = await query;
    if (error) throw error;

    // Group by company name
    const map = new Map();
    for (const row of (data || [])) {
      const name = row.companies?.name;
      if (!name) continue;

      if (!map.has(name)) map.set(name, { name, giden_tl: 0, gelen_tl: 0, total: 0 });
      const entry = map.get(name);

      const isUSD  = (row.base_currency || 'TRY').toUpperCase() === 'USD';
      const rate   = parseFloat(row.calculation_rate) || 1;
      const amtTL  = isUSD
        ? (parseFloat(row.payable_amount_cur) || 0) * rate
        : (parseFloat(row.payable_amount_tl)  || 0);

      if (row.direction === 'OUTGOING') entry.giden_tl += amtTL;
      else                              entry.gelen_tl += amtTL;
      entry.total += amtTL;
    }

    const result = [...map.values()]
      .sort((a, b) => b.total - a.total);

    res.json(limit ? result.slice(0, limit) : result);
  } catch (err) {
    console.error('top-companies hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/company-cadence', async (req, res) => {
  try {
    const supabase  = req.app.get('supabase');
    const tenantId  = req.tenantId;
    const direction = req.query.direction;

    const monthsParam = parseInt(req.query.months) || 6;
    const months      = Math.min(Math.max(monthsParam, 2), 12);

    // Compute date window — first day of the earliest month we care about
    const now         = new Date(); now.setHours(0, 0, 0, 0);
    const windowStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const iso         = d => d.toISOString().slice(0, 10);

    // Exclude fully-internal invoices (same pattern as other routes)
    const { data: excluded } = await supabase
      .from('fully_internal_invoice_ids')
      .select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    // Fetch invoices in window
    let q = supabase
      .from('invoices')
      .select('invoice_date, companies(name)')
      .eq('tenant_id', tenantId)
      .or('approval_status.neq.pending,approval_status.is.null')
      .gte('invoice_date', iso(windowStart))
      .not('invoice_date', 'is', null);

    if (direction)         q = q.eq('direction', direction);
    if (excludeIds.length) q = q.not('id', 'in', `(${excludeIds.join(',')})`);

    const { data: rows, error } = await q;
    if (error) throw error;

    // Group by company → per-month count + last invoice date
    const map = new Map();

    (rows || []).forEach(r => {
      const name = r.companies?.name;
      if (!name || !r.invoice_date) return;

      const d = new Date(r.invoice_date);
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;

      if (!map.has(name)) {
        map.set(name, { name, monthCounts: new Map(), lastDate: null });
      }
      const entry = map.get(name);
      entry.monthCounts.set(monthKey, (entry.monthCounts.get(monthKey) || 0) + 1);

      if (!entry.lastDate || d > new Date(entry.lastDate)) {
        entry.lastDate = r.invoice_date;
      }
    });

    // Build the expected month list (chronological, oldest → newest)
    const monthsExpected = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthsExpected.push({ year: d.getFullYear(), month: d.getMonth() });
    }

    // Format the response — for each company, fill in counts for every expected month
    // (missing months → count: 0)
    const companies = [];
    for (const [name, entry] of map.entries()) {
      const monthsArr = monthsExpected.map(m => ({
        year:  m.year,
        month: m.month,
        count: entry.monthCounts.get(`${m.year}-${m.month}`) || 0,
      }));

      // Lightweight backend filter: only include companies with at least
      // 2 months of activity in the window (skip one-time customers)
      const activeMonths = monthsArr.filter(m => m.count > 0).length;
      if (activeMonths < 2) continue;

      companies.push({
        name,
        months:            monthsArr,
        last_invoice_date: entry.lastDate,
      });
    }

    res.json({ companies });

  } catch (err) {
    console.error('company-cadence hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/trend
// Returns bucketed time-series data for sparklines.
// Bucket size: 'week' (default) or 'month', auto-selected by date range.
// Respects all the same filters as /totals.
router.get('/trend', async (req, res) => {
  try {
    const supabase   = req.app.get('supabase');
    const tenantId   = req.tenantId;
    const direction  = req.query.direction;
    const currency   = req.query.currency;
    const dateStart  = req.query.date_start;
    const dateEnd    = req.query.date_end;
    const search     = req.query.search;
    const pendingOnly = req.query.pending === 'true';
    const companies  = req.query.companies  ? req.query.companies.split(',').map(s => s.trim()).filter(Boolean)  : [];
    const brands     = req.query.brands     ? req.query.brands.split(',').map(s => s.trim()).filter(Boolean)     : [];
    const categories = req.query.categories ? req.query.categories.split(',').map(s => s.trim()).filter(Boolean) : [];
    const products   = req.query.products   ? req.query.products.split(',').map(s => s.trim()).filter(Boolean)   : [];

    // Companies
    const companyIds = await resolveCompanyIds(supabase, tenantId, companies);
    if (companyIds !== null && !companyIds.length) return res.json(/* empty */);

    // Brands
    const brandIds = await resolveInvoiceIdsByBrand(supabase, brands);
    if (brandIds !== null && !brandIds.length) return res.json(/* empty */);

    // Categories
    const categoryIds = await resolveInvoiceIdsByCategory(supabase, tenantId, categories);
    if (categoryIds !== null && !categoryIds.length) return res.json(/* empty */);

    // Products
    const productIds = await resolveInvoiceIdsByProduct(supabase, products);
    if (productIds !== null && !productIds.length) return res.json(/* empty */);

    // Exclude fully-internal invoices
    const { data: excluded } = await supabase.from('fully_internal_invoice_ids').select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    // ── Fetch raw invoice dates + amounts ─────────────────────────────────
    let query = supabase
      .from('invoices')
      .select('invoice_date, base_currency, payable_amount_tl, payable_amount_cur')
      .eq('tenant_id', tenantId);

    if (pendingOnly) query = query.eq('approval_status', 'pending');
    else             query = query.or('approval_status.neq.pending,approval_status.is.null');

    if (direction)      query = query.eq('direction', direction);
    if (currency)       query = query.eq('base_currency', currency);
    if (dateStart)      query = query.gte('invoice_date', dateStart);
    if (dateEnd)        query = query.lte('invoice_date', dateEnd);
    if (search)         query = query.or(`invoice_no.ilike.%${search}%`);
    if (companyIds?.length) query = query.in('company_id', companyIds);
    if (brandIds)       query = query.in('id', brandIds);
    if (categoryIds)    query = query.in('id', categoryIds);
    if (productIds)     query = query.in('id', productIds);
    if (modelIds)       query = query.in('id', modelIds);
    if (excludeIds.length)  query = query.not('id', 'in', `(${excludeIds.join(',')})`);

    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows || !rows.length) return res.json([]);

    // ── Auto-select bucket size based on date range ───────────────────────
    const dates    = rows.map(r => r.invoice_date).filter(Boolean).sort();
    const earliest = dateStart || dates[0];
    const latest   = dateEnd   || dates[dates.length - 1];
    const daySpan  = earliest && latest
      ? (new Date(latest) - new Date(earliest)) / 86400000
      : 60;
    const bucket = daySpan > 90 ? 'month' : 'week';

    // ── Group rows into buckets ───────────────────────────────────────────
    function getBucketKey(dateStr, bucket) {
      const d = new Date(dateStr);
      if (bucket === 'month') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      // ISO week: Monday-anchored
      const day  = d.getDay() || 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - (day - 1));
      return monday.toISOString().slice(0, 10);
    }

    const buckets = {};
    for (const row of rows) {
      if (!row.invoice_date) continue;
      const key  = getBucketKey(row.invoice_date, bucket);
      const isTRY = (row.base_currency || 'TRY').toUpperCase() !== 'USD';
      if (!buckets[key]) buckets[key] = { period: key, try_total: 0, usd_total: 0, try_count: 0, usd_count: 0 };
      if (isTRY) {
        buckets[key].try_total += parseFloat(row.payable_amount_tl) || 0;
        buckets[key].try_count += 1;
      } else {
        buckets[key].usd_total += parseFloat(row.payable_amount_cur) || 0;
        buckets[key].usd_count += 1;
      }
    }

    const result = Object.values(buckets).sort((a, b) => a.period.localeCompare(b.period));
    res.json({ bucket, data: result });

  } catch (err) {
    console.error('Trend hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/pending
router.get('/pending', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const direction = req.query.direction;
    const dateStart = req.query.date_start;
    const dateEnd = req.query.date_end;
    const currency = req.query.currency;
    const search = req.query.search;
    const companies = req.query.companies ? req.query.companies.split(',').map(s => s.trim()).filter(Boolean) : [];
    const brands = req.query.brands ? req.query.brands.split(',').map(s => s.trim()).filter(Boolean) : [];
    const categories = req.query.categories ? req.query.categories.split(',').map(s => s.trim()).filter(Boolean) : [];
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 0);

    let companyIds = [];
    if (companies.length) {
      const { data: matched } = await supabase.from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
      companyIds = (matched || []).map(c => c.id);
      if (!companyIds.length) return res.json({ data: [], total: 0, total_pages: 0, page });
    }

    let brandFilteredIds = null;
    if (brands.length) {
      const { data: bItems } = await supabase.from('invoice_items').select('invoice_id').in('brand_name', brands);
      brandFilteredIds = [...new Set((bItems || []).map(r => r.invoice_id).filter(Boolean))];
      if (!brandFilteredIds.length) return res.json({ data: [], total: 0, total_pages: 0, page });
    }

    let categoryFilteredIds = null;
    if (categories.length) {
      const { data: cItems } = await supabase.from('invoice_items').select('invoice_id').in('category', categories);
      categoryFilteredIds = [...new Set((cItems || []).map(r => r.invoice_id).filter(Boolean))];
      if (!categoryFilteredIds.length) return res.json({ data: [], total: 0, total_pages: 0, page });
    }

    let query = supabase
      .from('invoices')
      .select('*, companies(*), invoice_items(*)', { count: 'exact' })
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .eq('approval_status', 'pending')
      .order('invoice_date', { ascending: false });

    if (direction) query = query.eq('direction', direction);
    if (currency) query = query.eq('base_currency', currency);
    if (dateStart) query = query.gte('invoice_date', dateStart);
    if (dateEnd) query = query.lte('invoice_date', dateEnd);
    if (search) query = query.or(`invoice_no.ilike.%${search}%`);
    if (companyIds?.length) query = query.in('company_id', companyIds);
    if (brandFilteredIds) query = query.in('id', brandFilteredIds);
    if (categoryFilteredIds) query = query.in('id', categoryFilteredIds);
    if (limit > 0) query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    await enrichItemsWithProductMeta(supabase, data, tenantId);

    if (limit > 0) res.json({ data: data || [], total: count || 0, total_pages: Math.ceil((count || 0) / limit), page });
    else res.json(data || []);
  } catch (err) {
    console.error('Bekleyen fatura hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/ofis-ici
router.get('/ofis-ici', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const search = req.query.search || '';
    const dateStart = req.query.date_start || '';
    const dateEnd = req.query.date_end || '';
    const category = req.query.category || '';
    const companies = req.query.companies ? req.query.companies.split(',').map(s => s.trim()).filter(Boolean) : [];
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 0);
    const totalsOnly = req.query.totals === 'true';

    let itemQuery = supabase.from('invoice_items').select('invoice_id').eq('is_internal', true);
    if (category) itemQuery = itemQuery.eq('item_subcategory', category);
    const { data: items, error: itemsErr } = await itemQuery;
    if (itemsErr) throw itemsErr;
    const invoiceIds = [...new Set((items || []).map(it => it.invoice_id).filter(Boolean))];
    if (!invoiceIds.length) return res.json(limit > 0 ? { data: [], total: 0, total_pages: 0, page } : []);

    let companyIds = [];
    if (companies.length) {
      const { data: matched } = await supabase.from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
      companyIds = (matched || []).map(c => c.id);
      if (!companyIds.length) return res.json(limit > 0 ? { data: [], total: 0, total_pages: 0, page } : []);
    }

    let query = supabase
      .from('invoices')
      .select('*, companies(*), invoice_items(*)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .in('id', invoiceIds)
      .or('approval_status.eq.approved,approval_status.is.null')
      .order('invoice_date', { ascending: false });

    if (search) query = query.or(`invoice_no.ilike.%${search}%`);
    if (dateStart) query = query.gte('invoice_date', dateStart);
    if (dateEnd) query = query.lte('invoice_date', dateEnd);
    if (companyIds?.length) query = query.in('company_id', companyIds);

    if (totalsOnly) {
      const { data, error, count } = await query;
      if (error) throw error;
      const rows = data || [];
      let tryTotal = 0, usdTotal = 0;
      const catMap = {};
      rows.forEach(inv => {
        const isUSD = (inv.base_currency || '').toUpperCase() === 'USD';
        (inv.invoice_items || []).filter(it => it.is_internal).forEach(it => {
          const lineTotal = parseFloat(it.total_price_cur) || 0;
          if (isUSD) usdTotal += lineTotal; else tryTotal += lineTotal;
          const cat = it.item_subcategory || 'diğer';
          catMap[cat] = (catMap[cat] || 0) + (parseFloat(it.quantity) || 1);
        });
      });
      return res.json({ count: count || 0, total_tl: tryTotal, total_usd: usdTotal, cat_map: catMap });
    }

    if (limit > 0) query = query.range((page - 1) * limit, page * limit - 1);
    const { data, error, count } = await query;
    if (error) throw error;

    if (limit > 0) return res.json({ data: data || [], total: count || 0, total_pages: Math.ceil((count || 0) / limit), page });
    res.json(data || []);
  } catch (err) {
    console.error('Ofis içi fatura hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/:id
router.get('/:id([0-9a-fA-F-]{36})', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Fatura ID zorunlu.' });

    const { data, error } = await supabase.from('invoices').select('*, companies(*), invoice_items(*)').eq('id', id).eq('tenant_id', tenantId).single();
    if (error || !data) return res.status(404).json({ error: 'Fatura bulunamadı.' });

    await enrichItemsWithProductMeta(supabase, [data], tenantId);
    res.json(data);
  } catch (err) {
    console.error('GET /api/invoices/:id hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/:id/payments
router.get('/:id/payments', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id } = req.params;
    const { data, error } = await supabase.from('payments').select('*').eq('invoice_id', id).eq('tenant_id', req.tenantId).order('payment_date', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Ödeme listesi hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/invoices/:id
router.put('/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { invoice, company, items } = req.body || {};
    const shouldUpdateStock = req.body?.update_stock !== false;
    const payloadInvoice = invoice && typeof invoice === 'object' ? invoice : {};
    const payloadCompany = company && typeof company === 'object' ? company : {};
    const payloadItems = Array.isArray(items) ? items : [];

    const { data: beforeItems, error: beforeItemsError } = await supabase.from('invoice_items').select('quantity, purchase_order_item_id').eq('invoice_id', id);
    if (beforeItemsError) throw beforeItemsError;

    const { error: deleteItemsError } = await supabase.from('invoice_items').delete().eq('invoice_id', id);
    if (deleteItemsError) throw deleteItemsError;

    const { data, error } = await supabase.rpc('update_invoice_transaction', {
      p_invoice_id: id,
      p_invoice_data: payloadInvoice,
      p_company_data: payloadCompany,
      p_items_data: payloadItems
    });
    if (error) throw error;

    await syncInvoiceItemInternalMeta(supabase, id, payloadItems, tenantId);

    if (shouldUpdateStock) {
      const { data: afterItems, error: afterItemsError } = await supabase.from('invoice_items').select('quantity, purchase_order_item_id').eq('invoice_id', id);
      if (afterItemsError) throw afterItemsError;

      const sumByPo = rows => {
        const map = new Map();
        (rows || []).forEach(r => { const poId = r.purchase_order_item_id; if (!poId) return; map.set(poId, (map.get(poId) || 0) + Number(r.quantity || 0)); });
        return map;
      };

      const beforeMap = sumByPo(beforeItems);
      const afterMap = sumByPo(afterItems);
      const touchedOrderIds = new Set();

      for (const poId of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
        const delta = (afterMap.get(poId) || 0) - (beforeMap.get(poId) || 0);
        if (delta === 0) continue;
        const { data: poi, error: poiError } = await supabase.from('purchase_order_items').select('id, received_qty, purchase_order_id').eq('id', poId).single();
        if (poiError || !poi) continue;
        const newReceived = Math.max(0, Number(poi.received_qty || 0) + delta);
        const { error: updatePoiError } = await supabase.from('purchase_order_items').update({ received_qty: newReceived }).eq('id', poId);
        if (updatePoiError) throw updatePoiError;
        if (poi.purchase_order_id) touchedOrderIds.add(poi.purchase_order_id);
      }

      await recalcOrderStatus(supabase, touchedOrderIds);
    }

    res.json({ message: 'Fatura başarıyla güncellendi', data });
  } catch (error) {
    console.error('PUT /api/invoices/:id hatası:', error);
    res.status(500).json({ error: error.message || 'Sunucu hatası', errorCode: error.code });
  }
});

// PUT /api/invoices/:id/approve
router.put('/:id/approve', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id } = req.params;

    // Try with tenant filter first; fall back to id-only if tenant_id is missing on older rows
    let { data, error } = await supabase
      .from('invoices').update({ approval_status: 'approved' }, { count: 'exact' })
      .eq('id', id).eq('tenant_id', req.tenantId)
      .select('id');

    if (error) throw error;

    // If no rows matched (tenant_id mismatch on older data), retry without tenant filter
    if (!data || data.length === 0) {
      const fallback = await supabase
        .from('invoices').update({ approval_status: 'approved' })
        .eq('id', id).select('id');
      if (fallback.error) throw fallback.error;
      if (!fallback.data || fallback.data.length === 0)
        return res.status(404).json({ error: 'Fatura bulunamadı veya zaten onaylı.' });
    }

    res.json({ message: 'Fatura onaylandı' });
  } catch (err) {
    console.error('Fatura onaylama hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/invoices/:id
router.delete('/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id } = req.params;

    const { data: itemsToDelete, error: itemsFetchError } = await supabase.from('invoice_items').select('id, quantity, purchase_order_item_id').eq('invoice_id', id);
    if (itemsFetchError) throw itemsFetchError;

    const touchedOrderIds = new Set();
    for (const item of (itemsToDelete || [])) {
      if (!item.purchase_order_item_id) continue;
      const { data: poi, error: poiError } = await supabase.from('purchase_order_items').select('id, received_qty, purchase_order_id').eq('id', item.purchase_order_item_id).single();
      if (poiError || !poi) continue;
      const newReceived = Math.max(0, Number(poi.received_qty || 0) - Number(item.quantity || 0));
      const { error: poiUpdateError } = await supabase.from('purchase_order_items').update({ received_qty: newReceived }).eq('id', poi.id);
      if (poiUpdateError) throw poiUpdateError;
      if (poi.purchase_order_id) touchedOrderIds.add(poi.purchase_order_id);
    }

    const { error: itemDeleteError } = await supabase.from('invoice_items').delete().eq('invoice_id', id);
    if (itemDeleteError) throw itemDeleteError;

    await recalcOrderStatus(supabase, touchedOrderIds);

    let { error } = await supabase.from('invoices').delete().eq('id', id).eq('tenant_id', req.tenantId);
    if (error) throw error;

    // Fallback: older rows may have null tenant_id
    const { data: stillExists } = await supabase.from('invoices').select('id').eq('id', id).maybeSingle();
    if (stillExists) {
      const { error: fbErr } = await supabase.from('invoices').delete().eq('id', id);
      if (fbErr) throw fbErr;
    }

    res.json({ message: 'Fatura başarıyla silindi' });
  } catch (error) {
    console.error('Fatura silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası oluştu' });
  }
});

// POST /api/save-invoice
router.post('/', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const fullData = req.body;
    const shouldUpdateStock = fullData?.update_stock !== false;
    const isBulkUpload = fullData?.is_bulk_upload === true;
    const inokasVkn = (process.env.INOKAS_VKN || '').trim();
    const direction = String(fullData?.invoice?.direction || '').toUpperCase();
    const submitView = String(fullData?.submit_view || '').trim();
    const parsedView = String(fullData?.parsed_view || '').trim();
    const viewToDirection = { gelen: 'INCOMING', giden: 'OUTGOING' };

    if (!['INCOMING', 'OUTGOING'].includes(direction)) return res.status(400).json({ error: 'Geçersiz fatura yönü.' });
    if (!submitView || !viewToDirection[submitView]) return res.status(400).json({ error: 'Geçersiz sekme bilgisi.' });
    if (viewToDirection[submitView] !== direction) return res.status(400).json({ error: 'Sekme ile fatura yönü eşleşmiyor.' });
    if (!parsedView || parsedView !== submitView) return res.status(400).json({ error: 'XML farklı sekmede parse edilmiş.' });
    if (!fullData?.xml_context) return res.status(400).json({ error: 'XML doğrulama bağlamı eksik.' });
    if (!String(fullData?.invoice?.efatura_uuid || '').trim()) return res.status(400).json({ error: 'XML içinde UUID bulunamadı.' });
    if (!inokasVkn) return res.status(500).json({ error: 'INOKAS_VKN tanımlı değil.' });

    if (fullData?.xml_context) {
      const supplierVkn = String(fullData.xml_context.supplier_vkn || '').trim();
      const customerVkn = String(fullData.xml_context.customer_vkn || '').trim();
      if (supplierVkn !== inokasVkn && customerVkn !== inokasVkn) return res.status(400).json({ error: "Bu XML İnokas'a ait görünmüyor." });
      if (direction === 'INCOMING' && customerVkn !== inokasVkn) return res.status(400).json({ error: "Bu fatura 'Gelen' yönüne uygun değil." });
      if (direction === 'OUTGOING' && supplierVkn !== inokasVkn) return res.status(400).json({ error: "Bu fatura 'Giden' yönüne uygun değil." });
    }
    if (String(fullData?.company?.vkn_tckn || '').trim() === inokasVkn) return res.status(400).json({ error: "Karşı firma VKN'si İnokas VKN'si ile aynı olamaz." });

    // Step A: Upsert company
    const { data: companyData, error: companyError } = await supabase.from('companies').upsert({ ...fullData.company, tenant_id: tenantId }, { onConflict: 'vkn_tckn' }).select().single();
    if (companyError) throw companyError;

    // Step B: Insert invoice
    const invoiceToSave = {
      ...fullData.invoice, company_id: companyData.id, company_name: companyData.name || null, tenant_id: tenantId, ...(isBulkUpload ? {
        approval_status: 'pending'
      } : {})
    };
    const { data: invoiceData, error: invoiceError } = await supabase.from('invoices').insert(invoiceToSave).select().single();
    if (invoiceError) throw invoiceError;

    // Step B2: Create missing products
    if (!isBulkUpload) {
      const requestedRows = (Array.isArray(fullData?.items) ? fullData.items : [])
        .map(it => ({ product_code: String(it?.product_code || '').trim(), product_name: String(it?.product_name || '').trim(), is_internal: it?.is_internal === true, product_category: String(it?.product_category || '').trim() }))
        .filter(it => it.product_code && !it.is_internal && it.product_category);

      const uniqueByCode = new Map();
      requestedRows.forEach(r => { if (!uniqueByCode.has(r.product_code)) uniqueByCode.set(r.product_code, r); });
      const requested = [...uniqueByCode.values()];

      if (requested.length > 0) {
        const codes = requested.map(x => x.product_code);
        const { data: existingProducts, error: existingErr } = await supabase.from('products').select('product_code').in('product_code', codes).eq('tenant_id', tenantId);
        if (existingErr) throw existingErr;
        const existingSet = new Set((existingProducts || []).map(x => String(x.product_code || '').trim()));
        const toCreate = requested.filter(x => !existingSet.has(x.product_code));
        if (toCreate.length > 0) {
          const { error: createErr } = await supabase.from('products').insert(toCreate.map(x => ({ product_code: x.product_code, product_name: x.product_name || x.product_code, category: x.product_category, tenant_id: tenantId })));
          if (createErr) throw createErr;
        }
      }
    }

    // Step C: Insert items
    const itemsToSave = fullData.items.map(item => {
      const { product_category, ...dbSafeItem } = item || {};
      return { ...dbSafeItem, invoice_id: invoiceData.id };
    });

    const { error: itemsError } = await supabase.from('invoice_items').insert(itemsToSave).select('id');
    if (itemsError) throw itemsError;
    await syncInvoiceItemInternalMeta(supabase, invoiceData.id, fullData.items, tenantId);

    // Step C2: Aynı faturada aynı product_code+product_name olan satırları birleştir
    await mergeDuplicateItems(supabase, invoiceData.id);

    // Step D: Update backorder
    if (shouldUpdateStock) {
      for (const item of itemsToSave) {
        if (!item.purchase_order_item_id) continue;
        const { data: poi } = await supabase.from('purchase_order_items').select('received_qty, purchase_order_id').eq('id', item.purchase_order_item_id).single();
        if (poi) {
          const newQty = Number(poi.received_qty) + Number(item.quantity);
          await supabase.from('purchase_order_items').update({ received_qty: newQty }).eq('id', item.purchase_order_item_id);
          await supabase.from('purchase_orders').update({ status: 'Kısmi Geldi' }).eq('id', poi.purchase_order_id).eq('status', 'Bekliyor');
        }
      }
    }

    res.json({ message: 'Fatura başarıyla kaydedildi!' });

    // Arka planda PDF üret (response'u bekletmez)
    const xmlUrl = invoiceData?.xml_url;
    const savedId = invoiceData?.id;
    if (savedId && xmlUrl) {
      generateAndUploadPdf(req.app.get('supabase'), savedId, xmlUrl)
        .catch(e => console.error('[pdf-service] arka plan hatası:', e.message));
    }
  } catch (err) {
    console.error('Kayıt Hatası:', err.message);
    res.status(500).json({ error: err.message, errorCode: err.code });
  }
});

// POST /api/invoice-items/normalize-sku
router.post('/items/normalize-sku', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const fromCode = String(req.body?.from_code || '').trim();
    const toCode = String(req.body?.to_code || '').trim();
    if (!fromCode || !toCode) return res.status(400).json({ error: 'from_code ve to_code zorunludur.' });
    if (fromCode === toCode) return res.status(400).json({ error: 'Eski ve yeni kod aynı olamaz.' });

    const { data: rows, error: selectError } = await supabase.from('invoice_items').select('id').eq('product_code', fromCode);
    if (selectError) throw selectError;
    const ids = (rows || []).map(r => r.id).filter(Boolean);
    if (!ids.length) return res.json({ message: 'Güncellenecek satır bulunamadı.', updated_rows: 0 });

    const { error: updateError } = await supabase.from('invoice_items').update({ product_code: toCode }).in('id', ids);
    if (updateError) throw updateError;

    res.json({ message: 'SKU normalizasyonu tamamlandı.', from_code: fromCode, to_code: toCode, updated_rows: ids.length });
  } catch (err) {
    console.error('normalize-sku hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/ofis-ici-categories
router.get('/ofis-ici-categories', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data, error } = await supabase.from('invoice_items').select('item_subcategory').eq('is_internal', true).not('item_subcategory', 'is', null).neq('item_subcategory', '');
    if (error) throw error;
    const cats = [...new Set((data || []).map(r => r.item_subcategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/internal-categories
router.get('/internal-categories', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data, error } = await supabase.from('invoice_items').select('item_subcategory').eq('is_internal', true).not('item_subcategory', 'is', null).neq('item_subcategory', '');
    if (error) throw error;
    const countMap = {};
    (data || []).forEach(r => { const c = r.item_subcategory; if (c) countMap[c] = (countMap[c] || 0) + 1; });
    res.json(Object.entries(countMap).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'tr')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/invoices/internal-categories/rename
router.put('/internal-categories/rename', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from ve to zorunlu.' });
    const { error } = await supabase.from('invoice_items').update({ item_subcategory: to }).eq('item_subcategory', from);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/invoices/internal-categories/:name
router.delete('/internal-categories/:name', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const name = decodeURIComponent(req.params.name);
    const { error } = await supabase.from('invoice_items').update({ item_subcategory: null }).eq('item_subcategory', name);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/:id/pdf-url
router.get('/:id/pdf-url', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');

    // Verify invoice belongs to this tenant
    const { data: inv, error } = await supabase
      .from('invoices')
      .select('pdf_url')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)
      .single();

    if (error || !inv) return res.status(404).json({ error: 'Fatura bulunamadı' });
    if (!inv.pdf_url) return res.status(404).json({ error: 'PDF bulunamadı' });

    // Extract just the filename from the full URL
    // e.g. https://xxx.supabase.co/storage/v1/object/public/invoice-pdfs/abc.pdf
    // → abc.pdf
    const filename = inv.pdf_url.split('/dmo-pdfs/').pop().split('?')[0];

    const { data, error: signErr } = await supabase.storage
      .from('invoice-pdfs')
      .createSignedUrl(filename, 3600); // 1 hour expiry

    if (signErr) throw signErr;
    res.json({ url: data.signedUrl });

  } catch (err) {
    console.error('PDF URL hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/invoices/:id/items/batch-category
router.put('/:id/items/batch-category', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { assignments } = req.body || {};

    if (!Array.isArray(assignments) || !assignments.length)
      return res.status(400).json({ error: 'assignments dizisi zorunlu.' });

    // Fetch item rows to get their product_id for product table sync
    const itemIds = assignments.map(a => a.item_id).filter(Boolean);
    const { data: itemRows } = await supabase
      .from('invoice_items')
      .select('id, product_id')
      .in('id', itemIds)
      .eq('invoice_id', req.params.id);

    const productIdByItemId = new Map((itemRows || []).map(r => [r.id, r.product_id]));

    const errors = [];
    await Promise.all(assignments.map(async ({ item_id, item_subcategory }) => {
      if (!item_id) return;

      const { error: itemErr } = await supabase
        .from('invoice_items')
        .update({ item_subcategory: item_subcategory || null, is_internal: !!item_subcategory })
        .eq('id', item_id)
        .eq('invoice_id', req.params.id);
      if (itemErr) { errors.push({ item_id, error: itemErr.message }); return; }

      // Also sync to products.category so the product is categorized going forward
      const productId = productIdByItemId.get(item_id);
      if (productId && item_subcategory) {
        await supabase
          .from('products')
          .update({ category: item_subcategory })
          .eq('id', productId);
      }
    }));

    if (errors.length) return res.status(207).json({ ok: false, errors });
    res.json({ ok: true, updated: assignments.length });
  } catch (err) {
    console.error('batch-category hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.fetchKpiSummary = fetchKpiSummary;   // ← add this line
module.exports.fetchInvoiceList = fetchInvoiceList;
module.exports.fetchProductBreakdown = fetchProductBreakdown;