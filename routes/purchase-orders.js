// routes/purchase-orders.js
'use strict';

const express = require('express');
const router  = express.Router();

// GET /api/purchase-orders/all-pending
router.get('/all-pending', async (req, res) => {
  try {
    const supabase    = req.app.get('supabase');
    const { data, error } = await supabase
      .from('purchase_order_items')
      .select(`
        id, ordered_qty, received_qty, unit_price_cur,
        currency, line_total_cur, purchase_order_id,
        purchase_orders ( po_number, order_date, status, companies ( name ) ),
        products ( id, product_code, product_name, brand, category, model )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Tüm Bekleyen Siparişler Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchase-orders/pending-by-vkn
router.get('/pending-by-vkn', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { vkn }  = req.query;
    if (!vkn) return res.json([]);

    const { data: company, error: companyError } = await supabase
      .from('companies').select('id').eq('vkn_tckn', vkn).single();
    if (companyError || !company) return res.json([]);

    const { data, error } = await supabase
      .from('purchase_order_items')
      .select(`
        id, ordered_qty, received_qty, unit_price_cur,
        currency, line_total_cur, purchase_order_id,
        purchase_orders!inner ( po_number, order_date, company_id ),
        products!inner ( id, product_code, product_name )
      `)
      .eq('purchase_orders.company_id', company.id);

    if (error) throw error;
    res.json((data || []).filter(item => Number(item.ordered_qty) > Number(item.received_qty)));
  } catch (err) {
    console.error('GET /api/purchase-orders/pending-by-vkn hatası:', err);
    res.status(500).json({ error: 'Bekleyen siparişler alınırken hata oluştu.' });
  }
});

// POST /api/purchase-orders
router.post('/', async (req, res) => {
  try {
    const supabase      = req.app.get('supabase');
    const companyVkn    = String(req.body?.company_vkn    || '').trim();
    const companyName   = String(req.body?.company_name   || '').trim();
    const inputPoNumber = String(req.body?.po_number      || '').trim();
    const forceCreate   = req.body?.force_create === true;
    const rawItems      = Array.isArray(req.body?.items) ? req.body.items : [];

    const items = rawItems.map(it => ({
      product_code:   String(it?.product_code || '').trim(),
      product_name:   String(it?.product_name || '').trim(),
      brand:          String(it?.brand        || '').trim() || null,
      category:       String(it?.category     || '').trim() || null,
      ordered_qty:    Number(it?.ordered_qty  || 0),
      unit_price_cur: it?.unit_price_cur  == null || it?.unit_price_cur  === '' ? null : Number(it.unit_price_cur),
      currency:       String(it?.currency     || '').trim() || null,
      line_total_cur: it?.line_total_cur == null || it?.line_total_cur === '' ? null : Number(it.line_total_cur),
    })).filter(it => it.product_code && it.ordered_qty > 0);

    if (!companyVkn || items.length === 0) {
      return res.status(400).json({ error: 'company_vkn ve en az bir ürün satırı zorunlu.' });
    }

    // Firma bul / oluştur
    let { data: company } = await supabase.from('companies').select('id, name').eq('vkn_tckn', companyVkn).single();
    if (!company) {
      if (!companyName) return res.status(400).json({ error: 'Firma sistemde yok. Firma adı girin.' });
      const { data: createdCompany, error: companyInsertErr } = await supabase
        .from('companies').insert({ vkn_tckn: companyVkn, name: companyName }).select('id, name').single();
      if (companyInsertErr) throw companyInsertErr;
      company = createdCompany;
    }

    // Ürünleri bul / oluştur
    const uniqueCodes = [...new Set(items.map(x => x.product_code))];
    const { data: products, error: productsErr } = await supabase.from('products').select('id, product_code, product_name').in('product_code', uniqueCodes);
    if (productsErr) throw productsErr;
    const productMap  = new Map((products || []).map(p => [p.product_code, p]));
    const missingCodes = uniqueCodes.filter(code => !productMap.has(code));

    if (missingCodes.length > 0 && !forceCreate) {
      return res.status(400).json({ error: `Ürün kodu bulunamadı: ${missingCodes.join(', ')}`, missing_codes: missingCodes });
    }

    if (missingCodes.length > 0 && forceCreate) {
      const itemsByCode = new Map(items.map(it => [it.product_code, it]));
      for (const code of missingCodes) {
        const it = itemsByCode.get(code);
        const { data: newProduct, error: insertErr } = await supabase
          .from('products').insert({ product_code: code, product_name: it?.product_name || code, brand: it?.brand || null, category: it?.category || null })
          .select('id, product_code, product_name').single();
        if (insertErr) throw insertErr;
        productMap.set(code, newProduct);
      }
    }

    // PO numarası oluştur
    const sourceCompanyName     = String(company?.name || companyName || '').trim();
    const firstWord             = sourceCompanyName.split(/\s+/).find(Boolean) || 'FIRMA';
    const normalizedFirstWord   = firstWord.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '').toLocaleUpperCase('tr-TR') || 'FIRMA';
    const poPrefix              = `PO-${normalizedFirstWord}`;
    const { data: existingPoRows, error: poFetchErr } = await supabase.from('purchase_orders').select('po_number').ilike('po_number', `${poPrefix}-%`);
    if (poFetchErr) throw poFetchErr;
    const maxSeq = (existingPoRows || []).reduce((max, row) => {
      const m = String(row?.po_number || '').match(new RegExp(`^${poPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-([0-9]+)$`));
      const n = m ? Number(m[1]) : 0;
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);

    // PO oluştur
    let po = null; let poErr = null; let attemptSeq = maxSeq + 1;
    for (let attempt = 0; attempt < (inputPoNumber ? 1 : 5); attempt++) {
      const attemptPoNumber = inputPoNumber || `${poPrefix}-${attemptSeq}`;
      const result = await supabase.from('purchase_orders').insert({ po_number: attemptPoNumber, company_id: company.id, status: 'Bekliyor' }).select('id, po_number').single();
      po = result.data; poErr = result.error;
      if (!poErr) break;
      if (!inputPoNumber && String(poErr.code || '') === '23505') { attemptSeq++; continue; }
      throw poErr;
    }
    if (poErr) throw poErr;

    // Kalemleri birleştir ve kaydet
    const mergedByProduct = new Map();
    items.forEach(it => {
      if (!mergedByProduct.has(it.product_code)) mergedByProduct.set(it.product_code, { ordered_qty: 0, line_total_cur: 0, currency: null });
      const row = mergedByProduct.get(it.product_code);
      row.ordered_qty    += Number(it.ordered_qty || 0);
      row.line_total_cur += Number(it.line_total_cur != null ? it.line_total_cur : (it.unit_price_cur != null ? Number(it.ordered_qty || 0) * Number(it.unit_price_cur || 0) : 0));
      if (!row.currency && it.currency) row.currency = it.currency;
    });

    const itemRows = Array.from(mergedByProduct.entries()).map(([productCode, row]) => {
      const product   = productMap.get(productCode);
      const qty       = Number(row.ordered_qty || 0);
      const lineTotal = row.line_total_cur > 0 ? Number(row.line_total_cur.toFixed(4)) : null;
      const unitPrice = lineTotal !== null && qty > 0 ? Number((lineTotal / qty).toFixed(4)) : null;
      return { purchase_order_id: po.id, product_id: product.id, ordered_qty: qty, received_qty: 0, unit_price_cur: unitPrice, currency: row.currency, line_total_cur: lineTotal };
    });

    const { error: itemErr } = await supabase.from('purchase_order_items').insert(itemRows);
    if (itemErr) throw itemErr;

    res.status(201).json({ message: 'Backorder kaydedildi.', po_number: po.po_number, item_count: itemRows.length });
  } catch (err) {
    console.error('POST /api/purchase-orders hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/purchase-order-items/:id
router.put('/items/:id', async (req, res) => {
  try {
    const supabase     = req.app.get('supabase');
    const id           = String(req.params.id || '').trim();
    const orderedQty   = Number(req.body?.ordered_qty);
    const unitPriceRaw = req.body?.unit_price_cur;
    const lineTotalRaw = req.body?.line_total_cur;
    const currencyRaw  = req.body?.currency;

    const unitPrice = unitPriceRaw == null || unitPriceRaw === '' ? null : Number(unitPriceRaw);
    const lineTotal = lineTotalRaw == null || lineTotalRaw === '' ? null : Number(lineTotalRaw);
    const currency  = !currencyRaw || String(currencyRaw).trim() === '' ? null : String(currencyRaw).trim().toUpperCase();

    if (!id) return res.status(400).json({ error: 'Kalem id zorunlu.' });
    if (!Number.isFinite(orderedQty) || orderedQty <= 0) return res.status(400).json({ error: 'ordered_qty pozitif sayı olmalı.' });
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) return res.status(400).json({ error: 'unit_price_cur negatif olamaz.' });
    if (lineTotal !== null && (!Number.isFinite(lineTotal) || lineTotal < 0)) return res.status(400).json({ error: 'line_total_cur negatif olamaz.' });

    const { data: existing, error: findErr } = await supabase.from('purchase_order_items').select('id, received_qty').eq('id', id).single();
    if (findErr || !existing) return res.status(404).json({ error: 'Sipariş kalemi bulunamadı.' });

    const minAllowed = Number(existing.received_qty || 0);
    if (orderedQty < minAllowed) return res.status(400).json({ error: `Sipariş miktarı ${minAllowed} altına düşemez (gelen miktar).` });

    const { error: updErr } = await supabase.from('purchase_order_items').update({ ordered_qty: orderedQty, unit_price_cur: unitPrice, currency, line_total_cur: lineTotal }).eq('id', id);
    if (updErr) throw updErr;

    res.json({ message: 'Sipariş kalemi güncellendi.' });
  } catch (err) {
    console.error('PUT /api/purchase-order-items/:id hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/purchase-order-items/:id
router.delete('/items/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const id       = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Kalem id zorunlu.' });

    const { data: item, error: findErr } = await supabase.from('purchase_order_items').select('id, purchase_order_id, received_qty').eq('id', id).single();
    if (findErr || !item) return res.status(404).json({ error: 'Sipariş kalemi bulunamadı.' });

    const { count: linkedCount, error: linkedCountErr } = await supabase.from('invoice_items').select('*', { count: 'exact', head: true }).eq('purchase_order_item_id', id);
    if (linkedCountErr) throw linkedCountErr;
    if ((linkedCount || 0) > 0) return res.status(400).json({ error: 'Bu kaleme bağlı fatura kaydı var, önce ilgili faturayı kaldırın.' });
    if (Number(item.received_qty || 0) > 0) return res.status(400).json({ error: 'Bu kaleme bağlı gelen miktar var, silinemez.' });

    const { error: delErr } = await supabase.from('purchase_order_items').delete().eq('id', id);
    if (delErr) throw delErr;

    // Siparişte hiç kalem kalmadıysa ana siparişi de sil
    const { count, error: countErr } = await supabase.from('purchase_order_items').select('*', { count: 'exact', head: true }).eq('purchase_order_id', item.purchase_order_id);
    if (countErr) throw countErr;
    if ((count || 0) === 0) await supabase.from('purchase_orders').delete().eq('id', item.purchase_order_id);

    res.json({ message: 'Sipariş kalemi silindi.' });
  } catch (err) {
    console.error('DELETE /api/purchase-order-items/:id hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;