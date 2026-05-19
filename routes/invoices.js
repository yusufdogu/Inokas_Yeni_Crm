// routes/invoices.js
'use strict';

const express = require('express');
const router  = express.Router();

// ─── Helper: sync invoice item internal meta + product upsert ────────────────
async function syncInvoiceItemInternalMeta(supabase, invoiceId, payloadItems) {
  const items = Array.isArray(payloadItems) ? payloadItems : [];
  if (!invoiceId || items.length === 0) return;

  const { data: dbItems, error: dbItemsErr } = await supabase
    .from('invoice_items').select('id').eq('invoice_id', invoiceId).order('created_at', { ascending: true });
  if (dbItemsErr) throw dbItemsErr;

  const count = Math.min(dbItems?.length || 0, items.length);

  for (let i = 0; i < count; i++) {
    const rowId          = dbItems[i]?.id;
    if (!rowId) continue;
    const src            = items[i] || {};
    const isInternal     = src.is_internal === true;
    const categoryRaw    = String(src.internal_category || '').trim();
    const internalCategory = isInternal && categoryRaw ? categoryRaw : null;

    const { error: updErr } = await supabase
      .from('invoice_items').update({ is_internal: isInternal, internal_category: internalCategory }).eq('id', rowId);
    if (updErr) throw updErr;

    if (!isInternal) {
      const productCode = String(src.product_code || '').trim();
      if (!productCode) continue;
      const brand    = String(src.brand_name || '').trim() || null;
      const model    = String(src.model      || '').trim() || null;
      const category = String(src.product_category || src.category || '').trim() || null;
      const name     = String(src.product_name    || '').trim();

      const { data: existing } = await supabase.from('products').select('id, brand, category, model').eq('product_code', productCode).maybeSingle();
      if (existing) {
        const updates = { updated_at: new Date().toISOString() };
        if (brand)    updates.brand    = brand;
        if (category) updates.category = category;
        if (model)    updates.model    = model;
        if (Object.keys(updates).length > 1) {
          const { error: pErr } = await supabase.from('products').update(updates).eq('product_code', productCode);
          if (pErr) console.warn('Product update hatası:', pErr.message);
        }
      } else if (name) {
        const { error: insertErr } = await supabase.from('products').insert({ product_code: productCode, product_name: name, brand: brand || null, category: category || null, model: model || null, source: 'invoice' });
        if (insertErr) console.warn('Product insert hatası:', insertErr.message);
      }
    }
  }
}

// ─── Helper: enrich invoice_items with product metadata ──────────────────────
async function enrichItemsWithProductMeta(supabase, data) {
  if (!Array.isArray(data)) return;
  const skus = [...new Set(data.flatMap(inv => (inv.invoice_items || []).map(it => String(it.product_code || '').trim()).filter(Boolean)))];
  if (!skus.length) return;
  const { data: products } = await supabase.from('products').select('product_code, brand, category, model').in('product_code', skus);
  const productMap = new Map((products || []).map(p => [String(p.product_code || '').trim(), p]));
  data.forEach(inv => {
    (inv.invoice_items || []).forEach(item => {
      const p = productMap.get(String(item.product_code || '').trim());
      item.brand    = p?.brand    || '';
      item.category = p?.category || '';
      item.model    = p?.model    || '';
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
      const anyReceived  = orderItems.some(oi  => Number(oi.received_qty || 0) > 0);
      if (allCompleted) nextStatus = 'Tamamlandı';
      else if (anyReceived) nextStatus = 'Kısmi Geldi';
    }
    await supabase.from('purchase_orders').update({ status: nextStatus }).eq('id', orderId);
  }
}

// GET /api/invoices
router.get('/', async (req, res) => {
  try {
    const supabase   = req.app.get('supabase');
    const direction  = req.query.direction;
    const companyId  = req.query.company_id;
    const status     = req.query.status;
    const currency   = req.query.currency;
    const dateStart  = req.query.date_start;
    const dateEnd    = req.query.date_end;
    const search     = req.query.search;
    const companies  = req.query.companies  ? req.query.companies.split(',').map(s => s.trim()).filter(Boolean)  : [];
    const brands     = req.query.brands     ? req.query.brands.split(',').map(s => s.trim()).filter(Boolean)     : [];
    const categories = req.query.categories ? req.query.categories.split(',').map(s => s.trim()).filter(Boolean) : [];
    const page       = Math.max(1, parseInt(req.query.page)  || 1);
    const limit      = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const from       = (page - 1) * limit;
    const to         = from + limit - 1;

    // ── Step 1: get invoice IDs that have at least one non-internal item ──────
    const { data: nonInternalItems, error: niErr } = await supabase
      .from('invoice_items')
      .select('invoice_id')
      .eq('is_internal', false);

    if (niErr) throw niErr;

    const nonInternalIds = [...new Set(
      (nonInternalItems || []).map(r => r.invoice_id).filter(Boolean)
    )];

    if (!nonInternalIds.length) {
      return res.json({ data: [], total: 0, page, limit, total_pages: 0 });
    }

    // ── Step 2: resolve company names to IDs if company tags are active ───────
    let companyIds = [];
    if (companies.length) {
      const { data: matchedCompanies } = await supabase
        .from('companies')
        .select('id')
        .in('name', companies);
      companyIds = (matchedCompanies || []).map(c => c.id);
      if (!companyIds.length) {
        // No matching companies → no results
        return res.json({ data: [], total: 0, page, limit, total_pages: 0 });
      }
    }

    // ── Step 3: resolve brand filters to invoice IDs ──────────────────────────
    let brandFilteredIds = null;
    if (brands.length) {
      const { data: brandItems } = await supabase
        .from('invoice_items')
        .select('invoice_id')
        .in('brand_name', brands);
      brandFilteredIds = [...new Set((brandItems || []).map(r => r.invoice_id).filter(Boolean))];
      if (!brandFilteredIds.length) {
        return res.json({ data: [], total: 0, page, limit, total_pages: 0 });
      }
    }

    // ── Step 4: build main query ───────────────────────────────────────────────
    let query = supabase
      .from('invoices')
      .select('*, companies(*), invoice_items(*)', { count: 'exact' })
      .or('approval_status.neq.pending,approval_status.is.null')
      .in('id', nonInternalIds)
      .order('invoice_date', { ascending: false });

    if (direction)          query = query.eq('direction', direction);
    if (status)             query = query.ilike('status', status);
    if (currency)           query = query.eq('base_currency', currency);
    if (dateStart)          query = query.gte('invoice_date', dateStart);
    if (dateEnd)            query = query.lte('invoice_date', dateEnd);
    if (search)             query = query.or(`invoice_no.ilike.%${search}%`);
    if (companyId)          query = query.eq('company_id', companyId);
    if (companyIds.length)  query = query.in('company_id', companyIds);
    if (brandFilteredIds)   query = query.in('id', brandFilteredIds);

    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    await enrichItemsWithProductMeta(supabase, data);

    res.json({
      data:        data        || [],
      total:       count       || 0,
      page,
      limit,
      total_pages: Math.ceil((count || 0) / limit),
    });

  } catch (err) {
    console.error('Fatura Çekme Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/totals — same filters as GET / but returns only aggregated totals
router.get('/totals', async (req, res) => {
  try {
    const supabase   = req.app.get('supabase');
    const direction  = req.query.direction;
    const status     = req.query.status;
    const currency   = req.query.currency;
    const dateStart  = req.query.date_start;
    const dateEnd    = req.query.date_end;
    const search     = req.query.search;
    const companies  = req.query.companies  ? req.query.companies.split(',').map(s => s.trim()).filter(Boolean) : [];
    const brands     = req.query.brands     ? req.query.brands.split(',').map(s => s.trim()).filter(Boolean)    : [];

    // Step 1: non-internal invoice IDs
    const { data: niItems } = await supabase
      .from('invoice_items')
      .select('invoice_id')
      .eq('is_internal', false);

    const nonInternalIds = [...new Set((niItems || []).map(r => r.invoice_id).filter(Boolean))];
    if (!nonInternalIds.length) return res.json({ total_tl: 0, total_usd: 0, count: 0, unpaid_tl: 0 });

    // Step 2: resolve company names
    let companyIds = [];
    if (companies.length) {
      const { data: matched } = await supabase.from('companies').select('id').in('name', companies);
      companyIds = (matched || []).map(c => c.id);
      if (!companyIds.length) return res.json({ total_tl: 0, total_usd: 0, count: 0, unpaid_tl: 0 });
    }

    // Step 3: resolve brand filters
    let brandIds = null;
    if (brands.length) {
      const { data: bItems } = await supabase.from('invoice_items').select('invoice_id').in('brand_name', brands);
      brandIds = [...new Set((bItems || []).map(r => r.invoice_id).filter(Boolean))];
      if (!brandIds.length) return res.json({ total_tl: 0, total_usd: 0, count: 0, unpaid_tl: 0 });
    }

    // Step 4: fetch all matching invoices (no pagination, only needed fields)
    let query = supabase
      .from('invoices')
      .select('payable_amount_tl, payable_amount_cur, base_currency, status, paid_amount_cur')
      .or('approval_status.neq.pending,approval_status.is.null')
      .in('id', nonInternalIds);

    if (direction)         query = query.eq('direction', direction);
    if (status)            query = query.ilike('status', status);
    if (currency)          query = query.eq('base_currency', currency);
    if (dateStart)         query = query.gte('invoice_date', dateStart);
    if (dateEnd)           query = query.lte('invoice_date', dateEnd);
    if (search)            query = query.or(`invoice_no.ilike.%${search}%`);
    if (companyIds.length) query = query.in('company_id', companyIds);
    if (brandIds)          query = query.in('id', brandIds);

    const { data, error } = await query;
    if (error) throw error;

    const rows      = data || [];
    const total_tl  = rows.reduce((s, r) => s + (parseFloat(r.payable_amount_tl)  || 0), 0);
    const total_usd = rows
      .filter(r => (r.base_currency || '').toUpperCase() === 'USD')
      .reduce((s, r) => s + (parseFloat(r.payable_amount_cur) || 0), 0);
    const unpaid_tl = rows
      .filter(r => r.status !== 'Paid')
      .reduce((s, r) => {
        const paid    = parseFloat(r.paid_amount_cur) || 0;
        const total   = parseFloat(r.payable_amount_cur) || 0;
        const remaining = Math.max(total - paid, 0);
        return s + remaining * (parseFloat(r.calculation_rate) || 1);
      }, 0);

    res.json({
      count:      rows.length,
      total_tl,
      total_usd,
      unpaid_tl,
    });

  } catch (err) {
    console.error('Totals hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/filter-options
router.get('/filter-options', async (req, res) => {
  try {
    const supabase  = req.app.get('supabase');
    const direction = req.query.direction;

    // Get non-internal invoice IDs
    const { data: niItems } = await supabase
      .from('invoice_items')
      .select('invoice_id')
      .eq('is_internal', false);

    const nonInternalIds = [...new Set(
      (niItems || []).map(r => r.invoice_id).filter(Boolean)
    )];

    if (!nonInternalIds.length) {
      return res.json({ companies: [], brands: [], products: [], currencies: [] });
    }

    // Get distinct companies
    let invQuery = supabase
      .from('invoices')
      .select('company_id, base_currency, companies(name)')
      .or('approval_status.neq.pending,approval_status.is.null')
      .in('id', nonInternalIds);

    if (direction) invQuery = invQuery.eq('direction', direction);

    const { data: invRows } = await invQuery;

    const companies  = [...new Set(
      (invRows || []).map(r => r.companies?.name).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'tr'));

    const currencies = [...new Set(
      (invRows || []).map(r => r.base_currency).filter(Boolean)
    )].sort();

    // Get distinct brands and products from invoice_items
    let itemQuery = supabase
      .from('invoice_items')
      .select('brand_name, product_name, product_code, invoices!inner(direction, approval_status)')
      .eq('is_internal', false)
      .or('invoices.approval_status.neq.pending,invoices.approval_status.is.null');

    if (direction) itemQuery = itemQuery.eq('invoices.direction', direction);

    const { data: itemRows } = await itemQuery;

    const brands = [...new Set(
      (itemRows || []).map(r => r.brand_name).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'tr'));

    const products = [...new Set(
      (itemRows || []).map(r => r.product_name).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'tr'));

    res.json({ companies, brands, products, currencies });

  } catch (err) {
    console.error('filter-options hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/pending
router.get('/pending', async (req, res) => {
  try {
    const supabase  = req.app.get('supabase');
    const direction = req.query.direction;
    let query = supabase.from('invoices').select('*, companies(*), invoice_items(*)').eq('approval_status', 'pending').order('invoice_date', { ascending: false });
    if (direction) query = query.eq('direction', direction);
    const { data, error } = await query;
    if (error) throw error;
    await enrichItemsWithProductMeta(supabase, data);
    res.json(data || []);
  } catch (err) {
    console.error('Bekleyen fatura hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/ofis-ici
router.get('/ofis-ici', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data: items, error: itemsErr } = await supabase.from('invoice_items').select('invoice_id').eq('is_internal', true);
    if (itemsErr) throw itemsErr;
    const invoiceIds = [...new Set((items || []).map(it => it.invoice_id).filter(Boolean))];
    if (!invoiceIds.length) return res.json([]);
    const { data, error } = await supabase.from('invoices').select('*, companies(*), invoice_items(*)').in('id', invoiceIds).or('approval_status.eq.approved,approval_status.is.null').order('invoice_date', { ascending: false });
    if (error) throw error;
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
    const id       = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Fatura ID zorunlu.' });

    const { data, error } = await supabase.from('invoices').select('*, companies(*), invoice_items(*)').eq('id', id).single();
    if (error || !data) return res.status(404).json({ error: 'Fatura bulunamadı.' });

    await enrichItemsWithProductMeta(supabase, [data]);
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
    const { id }   = req.params;
    const { data, error } = await supabase.from('payments').select('*').eq('invoice_id', id).order('payment_date', { ascending: true });
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
    const supabase         = req.app.get('supabase');
    const { id }           = req.params;
    const { invoice, company, items } = req.body || {};
    const shouldUpdateStock = req.body?.update_stock !== false;
    const payloadInvoice   = invoice && typeof invoice === 'object' ? invoice : {};
    const payloadCompany   = company && typeof company === 'object' ? company : {};
    const payloadItems     = Array.isArray(items) ? items : [];

    const { data: beforeItems, error: beforeItemsError } = await supabase.from('invoice_items').select('quantity, purchase_order_item_id').eq('invoice_id', id);
    if (beforeItemsError) throw beforeItemsError;

    const { error: deleteItemsError } = await supabase.from('invoice_items').delete().eq('invoice_id', id);
    if (deleteItemsError) throw deleteItemsError;

    const { data, error } = await supabase.rpc('update_invoice_transaction', {
      p_invoice_id:   id,
      p_invoice_data: payloadInvoice,
      p_company_data: payloadCompany,
      p_items_data:   payloadItems
    });
    if (error) throw error;

    await syncInvoiceItemInternalMeta(supabase, id, payloadItems);

    if (shouldUpdateStock) {
      const { data: afterItems, error: afterItemsError } = await supabase.from('invoice_items').select('quantity, purchase_order_item_id').eq('invoice_id', id);
      if (afterItemsError) throw afterItemsError;

      const sumByPo = rows => {
        const map = new Map();
        (rows || []).forEach(r => { const poId = r.purchase_order_item_id; if (!poId) return; map.set(poId, (map.get(poId) || 0) + Number(r.quantity || 0)); });
        return map;
      };

      const beforeMap = sumByPo(beforeItems);
      const afterMap  = sumByPo(afterItems);
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
    const { id }   = req.params;
    const { error } = await supabase.from('invoices').update({ approval_status: 'approved' }).eq('id', id);
    if (error) throw error;
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
    const { id }   = req.params;

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

    const { error } = await supabase.from('invoices').delete().eq('id', id);
    if (error) throw error;

    res.json({ message: 'Fatura başarıyla silindi' });
  } catch (error) {
    console.error('Fatura silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası oluştu' });
  }
});

// POST /api/save-invoice
router.post('/save', async (req, res) => {
  try {
    const supabase          = req.app.get('supabase');
    const fullData          = req.body;
    const shouldUpdateStock = fullData?.update_stock !== false;
    const isBulkUpload      = fullData?.is_bulk_upload === true;
    const inokasVkn         = (process.env.INOKAS_VKN || '').trim();
    const direction         = String(fullData?.invoice?.direction || '').toUpperCase();
    const submitView        = String(fullData?.submit_view || '').trim();
    const parsedView        = String(fullData?.parsed_view || '').trim();
    const viewToDirection   = { gelen: 'INCOMING', giden: 'OUTGOING' };

    if (!['INCOMING', 'OUTGOING'].includes(direction))          return res.status(400).json({ error: 'Geçersiz fatura yönü.' });
    if (!submitView || !viewToDirection[submitView])            return res.status(400).json({ error: 'Geçersiz sekme bilgisi.' });
    if (viewToDirection[submitView] !== direction)              return res.status(400).json({ error: 'Sekme ile fatura yönü eşleşmiyor.' });
    if (!parsedView || parsedView !== submitView)               return res.status(400).json({ error: "XML farklı sekmede parse edilmiş." });
    if (!fullData?.xml_context)                                 return res.status(400).json({ error: 'XML doğrulama bağlamı eksik.' });
    if (!String(fullData?.invoice?.efatura_uuid || '').trim()) return res.status(400).json({ error: 'XML içinde UUID bulunamadı.' });
    if (!inokasVkn)                                             return res.status(500).json({ error: 'INOKAS_VKN tanımlı değil.' });

    if (fullData?.xml_context) {
      const supplierVkn = String(fullData.xml_context.supplier_vkn || '').trim();
      const customerVkn = String(fullData.xml_context.customer_vkn || '').trim();
      if (supplierVkn !== inokasVkn && customerVkn !== inokasVkn) return res.status(400).json({ error: "Bu XML İnokas'a ait görünmüyor." });
      if (direction === 'INCOMING' && customerVkn !== inokasVkn)  return res.status(400).json({ error: "Bu fatura 'Gelen' yönüne uygun değil." });
      if (direction === 'OUTGOING' && supplierVkn !== inokasVkn)  return res.status(400).json({ error: "Bu fatura 'Giden' yönüne uygun değil." });
    }
    if (String(fullData?.company?.vkn_tckn || '').trim() === inokasVkn) return res.status(400).json({ error: "Karşı firma VKN'si İnokas VKN'si ile aynı olamaz." });

    // Step A: Upsert company
    const { data: companyData, error: companyError } = await supabase.from('companies').upsert(fullData.company, { onConflict: 'vkn_tckn' }).select().single();
    if (companyError) throw companyError;

    // Step B: Insert invoice
    const invoiceToSave = { ...fullData.invoice, company_id: companyData.id, ...(isBulkUpload ? { approval_status: 'pending' } : {}) };
    const { data: invoiceData, error: invoiceError } = await supabase.from('invoices').insert(invoiceToSave).select().single();
    if (invoiceError) throw invoiceError;

    // Step B2: Create missing products from categories
    if (!isBulkUpload) {
      const requestedRows = (Array.isArray(fullData?.items) ? fullData.items : [])
        .map(it => ({ product_code: String(it?.product_code || '').trim(), product_name: String(it?.product_name || '').trim(), is_internal: it?.is_internal === true, product_category: String(it?.product_category || '').trim() }))
        .filter(it => it.product_code && !it.is_internal && it.product_category);

      const uniqueByCode = new Map();
      requestedRows.forEach(r => { if (!uniqueByCode.has(r.product_code)) uniqueByCode.set(r.product_code, r); });
      const requested = [...uniqueByCode.values()];

      if (requested.length > 0) {
        const codes = requested.map(x => x.product_code);
        const { data: existingProducts, error: existingErr } = await supabase.from('products').select('product_code').in('product_code', codes);
        if (existingErr) throw existingErr;
        const existingSet = new Set((existingProducts || []).map(x => String(x.product_code || '').trim()));
        const toCreate = requested.filter(x => !existingSet.has(x.product_code));
        if (toCreate.length > 0) {
          const { error: createErr } = await supabase.from('products').insert(toCreate.map(x => ({ product_code: x.product_code, product_name: x.product_name || x.product_code, category: x.product_category })));
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
    await syncInvoiceItemInternalMeta(supabase, invoiceData.id, fullData.items);

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
    const toCode   = String(req.body?.to_code   || '').trim();
    if (!fromCode || !toCode)  return res.status(400).json({ error: 'from_code ve to_code zorunludur.' });
    if (fromCode === toCode)   return res.status(400).json({ error: 'Eski ve yeni kod aynı olamaz.' });

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
    const { data, error } = await supabase.from('invoice_items').select('internal_category').eq('is_internal', true).not('internal_category', 'is', null).neq('internal_category', '');
    if (error) throw error;
    const cats = [...new Set((data || []).map(r => r.internal_category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/internal-categories (with count)
router.get('/internal-categories', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data, error } = await supabase.from('invoice_items').select('internal_category').eq('is_internal', true).not('internal_category', 'is', null).neq('internal_category', '');
    if (error) throw error;
    const countMap = {};
    (data || []).forEach(r => {
      const c = r.internal_category;
      if (c) countMap[c] = (countMap[c] || 0) + 1;
    });
    const result = Object.entries(countMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    res.json(result);
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
    const { error } = await supabase.from('invoice_items').update({ internal_category: to }).eq('internal_category', from);
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
    const { error } = await supabase.from('invoice_items').update({ internal_category: null }).eq('internal_category', name);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inokas-vkn
router.get('/inokas-vkn', async (req, res) => {
  const vkn = (process.env.INOKAS_VKN || '').trim();
  if (!vkn) return res.status(503).json({ error: 'INOKAS_VKN tanımlı değil.' });
  res.json({ vkn });
});

module.exports = router;