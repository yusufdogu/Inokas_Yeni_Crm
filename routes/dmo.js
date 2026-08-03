// routes/dmo-main.js
'use strict';

const express = require('express');
const http    = require('http');
const router  = express.Router();

const DMO_PY_HOST = process.env.DMO_PY_HOST || '127.0.0.1';
const DMO_PY_PORT = Number(process.env.DMO_PY_PORT || 5000);

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── TCMB helpers (shared — no tenant_id) ────────────────────────────────────
async function fetchAndSaveTCMBRates(supabase) {
  try {
    const usdRegex = /CurrencyCode="USD"[\s\S]*?<ForexBuying>([\d.]+)<\/ForexBuying>/;
    const eurRegex = /CurrencyCode="EUR"[\s\S]*?<ForexBuying>([\d.]+)<\/ForexBuying>/;
    let usd_try = null, eur_try = null, foundDate = null;

    for (let daysBack = 0; daysBack <= 5; daysBack++) {
      const date = new Date();
      date.setDate(date.getDate() - daysBack);
      const dd   = String(date.getDate()).padStart(2, '0');
      const mm   = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      const url  = daysBack === 0
        ? 'https://www.tcmb.gov.tr/kurlar/today.xml'
        : `https://www.tcmb.gov.tr/kurlar/${yyyy}${mm}/${dd}${mm}${yyyy}.xml`;

      const res  = await fetch(url);
      const body = await res.text();
      const usdMatch = body.match(usdRegex);
      const eurMatch = body.match(eurRegex);

      if (usdMatch && eurMatch) {
        usd_try = parseFloat(usdMatch[1]); eur_try = parseFloat(eurMatch[1]);
        foundDate = `${yyyy}-${mm}-${dd}`;
        console.log(`TCMB: ${foundDate} — USD ${usd_try} EUR ${eur_try}`);
        break;
      }
      console.log(`TCMB: ${yyyy}-${mm}-${dd} verisi yok, önceki güne bakılıyor...`);
    }

    if (!usd_try || !eur_try || !foundDate) { console.error('TCMB: Son 5 gün için kur bulunamadı'); return; }

    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await supabase.from('rate_history').select('id').gte('recorded_at', today + 'T00:00:00').lte('recorded_at', today + 'T23:59:59').maybeSingle();

    if (existing) {
      await supabase.from('rate_history').update({ usd_try, eur_try, rate_date: foundDate }).eq('id', existing.id);
      console.log(`TCMB güncellendi: USD ${usd_try} EUR ${eur_try}`);
    } else {
      await supabase.from('rate_history').insert({ usd_try, eur_try, rate_date: foundDate });
      console.log(`TCMB eklendi: USD ${usd_try} EUR ${eur_try}`);
    }
  } catch (err) {
    console.error('TCMB fetch hatası:', err.message);
  }
}

async function fetchAndSaveDMORate(supabase) {
  try {

    const res  = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/find-dmo-url`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dmo_code: '106776'})
    });
    const data = await res.json();
    if (!data.price) { console.error('DMO rate: fiyat alınamadı', data); return; }

    const dmo_eur_try = (data.price / 1.08) / 355;
    const today       = new Date().toISOString().slice(0, 10);

    const { data: existing } = await supabase.from('rate_history').select('id').gte('recorded_at', today + 'T00:00:00').lte('recorded_at', today + 'T23:59:59').maybeSingle();

    if (existing) await supabase.from('rate_history').update({ dmo_eur_try, dmo_rate_date: today }).eq('id', existing.id);
    else          await supabase.from('rate_history').insert({ dmo_eur_try, dmo_rate_date: today });

    console.log(`DMO EUR/TRY güncellendi: ${dmo_eur_try}`);
  } catch (err) {
    console.error('DMO rate fetch hatası:', err.message);
  }
}
// each item: { dmo_code, quantity, is_gift }
async function computeCostTotals(supabase, tenantId, items) {
  let inokas = 0, gift = 0;
  const zeroCostCodes = [];
  for (const it of (items || [])) {
    if (!it.dmo_code) continue;
    const r = await resolveDmoProduct(supabase, tenantId, it.dmo_code, { product_name: it.product_name });
    const unit = r.maliyet_tl_unit || 0;
    const line = unit * (Number(it.quantity) || 0);
    if (unit === 0) zeroCostCodes.push(it.dmo_code);
    if (it.is_gift) gift += line; else inokas += line;
  }
  return { inokas_basket_total: inokas, gift_total: gift, zeroCostCodes };
}

async function resolveDmoProduct(supabase, tenantId, dmoCode, hints = {}) {
  const { data: existing } = await supabase.from('dmo_products')
    .select('id, products(last_purchase_price_tl)')
    .eq('dmo_code', dmoCode).eq('tenant_id', tenantId).maybeSingle();
  if (existing) return { id: existing.id, maliyet_tl_unit: Number(existing.products?.last_purchase_price_tl) || 0 };

  let scraped;
  try {
    scraped = await postToFlask('/resolve-product', { dmo_code: dmoCode });   // your http.request helper
  } catch (e) {
    return { error: 'scrape-failed: ' + e.message };
  }
  if (!scraped || !scraped.found || !scraped.mpn) return { error: 'not-found' };
  const mpn = scraped.mpn;

  let { data: prod } = await supabase.from('products')
    .select('id, last_purchase_price_tl').eq('product_code', mpn).eq('tenant_id', tenantId).maybeSingle();
  if (!prod) {
    const { data: np, error: pe } = await supabase.from('products').insert({
      product_code: mpn, product_name: hints.product_name || `${scraped.brand || ''} ${scraped.model || mpn}`.trim(),
      brand: scraped.brand || null, model: scraped.model || null, tenant_id: tenantId,
    }).select('id, last_purchase_price_tl').single();
    if (pe) return { error: pe.message };
    prod = np;
  }

  const { data: dp, error: de } = await supabase.from('dmo_products').insert({
    tenant_id: tenantId, product_id: prod.id, dmo_code: dmoCode,
    dmo_fiyat_try: scraped.price || 0, dmo_url: scraped.url || null,
  }).select('id').single();
  if (de) return { error: de.message };
  return { id: dp.id, created: true, maliyet_tl_unit: Number(prod.last_purchase_price_tl) || 0 };
}
// POST /api/dmo/resolve-product — Node bridge → resolveDmoProduct → Flask /resolve-product

function computeDmoFinancials({
  basket,            // total_amount_excl_vat (raw DMO basket, from PDF)
  tutarIndirimi = 0, // discount (from PDF)
  stampTax = 0,      // damga (from PDF for saved orders; estimated upstream for live calc)
  inokasBasket = 0,  // live cost: Σ last_purchase_price_tl × qty over non-gift items
  giftTotal = 0,     // live cost of gift items
}) {
  const b            = Number(basket) || 0;
  const disc         = Number(tutarIndirimi) || 0;
  const realBasket   = b - disc;

  const kdv          = realBasket * 0.20;
  const tevkifat     = kdv * 0.20;
  const gercekKdv    = kdv - tevkifat;
  const risturn      = realBasket * 0.01;
  const damga        = Number(stampTax) || 0;      // ← read, not computed
  const vergiler     = tevkifat + risturn + damga;

  const toplamGelir  = realBasket + gercekKdv;
  const toplamGider  = (Number(inokasBasket) || 0) + disc + vergiler + (Number(giftTotal) || 0);
  const netProfit    = toplamGelir - toplamGider;
  const profitPct    = toplamGelir > 0 ? (netProfit / toplamGelir) * 100 : 0;

  return {
    realBasket, kdv, tevkifat, gercekKdv, risturn, damga, vergiler,
    toplamGelir, toplamGider, netProfit, profitPct,
  };
}

router.post('/resolve-product', async (req, res) => {
  console.log('[NODE resolve-product] HIT — body:', req.body);
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    const dmoCode = String(req.body.dmo_code || '').trim();
    if (!dmoCode) return res.status(400).json({ error: 'dmo_code zorunlu' });

    const r = await resolveDmoProduct(supabase, tenantId, dmoCode, { product_name: req.body.product_name });
    if (r.id) return res.json({ resolved: true, dmo_code: dmoCode, dmo_product_id: r.id, created: !!r.created });
    return res.json({ resolved: false, dmo_code: dmoCode, reason: r.error || 'not-found' });
  } catch (err) {
    console.error('POST /api/dmo/resolve-product hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dmo/preview-cost — live cost totals for the yeni-siparis screen
router.post('/preview-cost', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });
    const totals = await computeCostTotals(supabase, tenantId, req.body.items || []);
    res.json(totals);
  } catch (err) {
    console.error('preview-cost hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dmo/parse-pdf
router.post('/parse-pdf', (req, res) => {
  const proxyReq = http.request({
    hostname: DMO_PY_HOST, port: DMO_PY_PORT, path: '/parse-pdf', method: 'POST',
    headers: { ...req.headers, host: `${DMO_PY_HOST}:${DMO_PY_PORT}` }
  }, proxyRes => {
    res.status(proxyRes.statusCode || 502);
    Object.entries(proxyRes.headers || {}).forEach(([k, v]) => { if (v !== undefined) res.setHeader(k, v); });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', err => {
    console.error('DMO parse-pdf proxy hatası:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'DMO parse servisine bağlanılamadı.' });
  });
  req.pipe(proxyReq);
});


// POST /api/dmo/orders/:id/gifts — add a single gift line to an existing order
// Gift = cost-only (prices 0). Reserves stock if order is non-Taslak (Option A:
// same reserve/settle lifecycle as regular items; the status trigger settles at Tamamlandı).
router.post('/orders/:id/gifts', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    const orderId = req.params.id;
    const { product_id, quantity } = req.body;
    const qty = Math.floor(Number(quantity) || 0);          // gift_count is integer
    if (!product_id) return res.status(400).json({ error: 'Ürün zorunlu' });
    if (qty <= 0)     return res.status(400).json({ error: 'Miktar 1 veya daha fazla olmalı' });

    // Order must exist + belong to tenant; need its status for stock rule
    const { data: order, error: oErr } = await supabase.from('dmo_orders')
      .select('id, status').eq('id', orderId).eq('tenant_id', tenantId).single();
    if (oErr || !order) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    // Resolve product (cost is looked up server-side — never trust a client cost)
    const { data: prod, error: pErr } = await supabase.from('products')
      .select('id, product_name, last_purchase_price_tl, stock_on_hand, reserved_quantity, gift_count')
      .eq('id', product_id).eq('tenant_id', tenantId).single();
    if (pErr || !prod) return res.status(404).json({ error: 'Ürün bulunamadı' });

    const unitCost = Number(prod.last_purchase_price_tl) || 0;
    const lineCost = unitCost * qty;

    // Does this product have a dmo_products row? If so link via dmo_product_id;
    // otherwise link directly via the new product_id column (b-clean, no auto-catalog).
    const { data: dp } = await supabase.from('dmo_products')
      .select('id').eq('product_id', product_id).eq('tenant_id', tenantId).maybeSingle();

    const { data: giftRow, error: giErr } = await supabase.from('dmo_order_items').insert({
      order_id: orderId, tenant_id: tenantId,
      dmo_product_id: dp?.id || null,
      product_id:     dp?.id ? null : product_id,           // exactly one link is set
      quantity: qty, is_gift: true,
      unit_price_excl_vat: 0, line_total_excl_vat: 0,       // gifts have no revenue
      maliyet_tl: lineCost, indirim_pct: 0,
    }).select('id').single();
    if (giErr) throw giErr;


    const patch = {
      gift_count: (Number(prod.gift_count) || 0) + qty,
      updated_at: new Date().toISOString(),
    };
    if (order.status === 'Sipariş Alındı') {
      patch.stock_on_hand     = (Number(prod.stock_on_hand)     || 0) - qty;
      patch.reserved_quantity = (Number(prod.reserved_quantity) || 0) + qty;
    } else if (order.status === 'Tamamlandı') {
      patch.stock_on_hand     = (Number(prod.stock_on_hand)     || 0) - qty;
    }
    await supabase.from('products').update(patch)
      .eq('id', product_id).eq('tenant_id', tenantId);

    res.json({
      ok: true,
      gift: {
        id: giftRow.id, product_id, product_name: prod.product_name,
        quantity: qty, maliyet_tl: lineCost,
      },
    });
  } catch (err) {
    console.error('POST /orders/:id/gifts hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// POST /api/dmo/orders/received — create (or merge into a taslak) a received order + items
// POST /api/dmo/orders/received — create a received order + items (fresh only, no merge)
router.post('/orders/received', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    const { order, items } = req.body;
    const orderRow = { ...order, tenant_id: tenantId, status: 'Sipariş Alındı' };

    // Duplicate guard
    if (order.sales_order_no) {
      const { data: dup } = await supabase.from('dmo_orders')
        .select('id').eq('sales_order_no', order.sales_order_no).eq('tenant_id', tenantId).maybeSingle();
      if (dup) return res.status(409).json({ error: 'Bu sipariş zaten kayıtlı: ' + order.sales_order_no });
    }

    const { data: inserted, error: insErr } = await supabase
      .from('dmo_orders').insert(orderRow).select('id').single();
    if (insErr) throw insErr;
    const savedId = inserted.id;

    let failed = 0;
    const zeroCostCodes = [];

    for (const it of (items || [])) {
      let dmoProductId = null, productId = null, unitCost = 0;

      if (it.dmo_code) {
        const { data: dp } = await supabase.from('dmo_products')
          .select('id, product_id, products(last_purchase_price_tl)')
          .eq('dmo_code', it.dmo_code).eq('tenant_id', tenantId).maybeSingle();
        if (dp) {
          dmoProductId = dp.id;
          productId    = dp.product_id;                              // for the stock decrement
          unitCost     = Number(dp.products?.last_purchase_price_tl) || 0;
        }
      }

      const qty      = Number(it.quantity) || 0;
      const lineCost = unitCost * qty;
      if (it.dmo_code && unitCost === 0) zeroCostCodes.push(it.dmo_code);

      const { error: ie } = await supabase.from('dmo_order_items').insert({
        order_id: savedId, dmo_product_id: dmoProductId, tenant_id: tenantId,
        quantity: qty, unit_price_excl_vat: it.unit_price_excl_vat, line_total_excl_vat: it.line_total_excl_vat,
        is_gift: !!it.is_gift, katalog_kod: it.dmo_code || null,
        maliyet_tl: lineCost, indirim_pct: it.indirim_pct || 0,
      });

      if (ie) {
        console.error('[received] item insert FAILED:', ie.message, '| code:', ie.code);
        failed++;
        continue;                                                   // no stock move for a failed item
      }

      // Stock decrement — replaces the dropped handle_order_item_insert trigger.
      // Order is Sipariş Alındı (non-Taslak) → reserve stock, mirroring old trigger.
      // Gifts follow their own rule (decrement only when Tamamlandı) and are handled
      // by the gift route / status trigger, so skip them here.
      if (!it.is_gift && productId && qty > 0) {
        const { data: prod, error: pErr } = await supabase.from('products')
          .select('stock_on_hand, reserved_quantity').eq('id', productId).eq('tenant_id', tenantId).single();
        if (!pErr && prod) {
          await supabase.from('products').update({
            stock_on_hand:     (Number(prod.stock_on_hand)     || 0) - qty,
            reserved_quantity: (Number(prod.reserved_quantity) || 0) + qty,
            updated_at:        new Date().toISOString(),
          }).eq('id', productId).eq('tenant_id', tenantId);
        }
      }
    }

    await supabase.from('dmo_orders').update({
      needs_cost_review: zeroCostCodes.length > 0,
    }).eq('id', savedId).eq('tenant_id', tenantId);

    res.json({ ok: true, orderId: savedId, failed, zeroCostCodes });
  } catch (err) {
    console.error('POST /api/dmo/orders/received hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dmo/orders/gifts/:itemId — remove a gift line, reverse its effects
// DELETE /api/dmo/orders/gifts/:itemId — remove a gift line, reverse its stock effect
// Reversal depends on the order's phase:
//   Sipariş Alındı → gift was reserved: stock += qty, reserved -= qty
//   Tamamlandı     → gift was consumed: stock += qty (no reserved)
//   Taslak         → gift moved no stock: gift_count only
router.delete('/orders/gifts/:itemId', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    const itemId = req.params.itemId;

    const { data: row, error: rErr } = await supabase.from('dmo_order_items')
      .select('id, order_id, quantity, is_gift, dmo_product_id, product_id, dmo_orders(status)')
      .eq('id', itemId).eq('tenant_id', tenantId).single();
    if (rErr || !row) return res.status(404).json({ error: 'Kalem bulunamadı' });
    if (!row.is_gift) return res.status(400).json({ error: 'Bu bir hediye kalemi değil' });

    const qty    = Number(row.quantity) || 0;
    const status = row.dmo_orders?.status;

    // Resolve underlying product (direct product_id, or via dmo_products bridge)
    let productId = row.product_id;
    if (!productId && row.dmo_product_id) {
      const { data: dp } = await supabase.from('dmo_products')
        .select('product_id').eq('id', row.dmo_product_id).maybeSingle();
      productId = dp?.product_id || null;
    }

    // Delete the line first
    const { error: dErr } = await supabase.from('dmo_order_items')
      .delete().eq('id', itemId).eq('tenant_id', tenantId);
    if (dErr) throw dErr;

    // Reverse product effects per phase
    if (productId && qty > 0) {
      const { data: prod } = await supabase.from('products')
        .select('stock_on_hand, reserved_quantity, gift_count')
        .eq('id', productId).eq('tenant_id', tenantId).single();

      if (prod) {
        const patch = {
          gift_count: Math.max(0, (Number(prod.gift_count) || 0) - qty),
          updated_at: new Date().toISOString(),
        };

        if (status === 'Sipariş Alındı') {
          // was reserved → release reservation and return stock
          patch.stock_on_hand     = (Number(prod.stock_on_hand)     || 0) + qty;
          patch.reserved_quantity = (Number(prod.reserved_quantity) || 0) - qty;
        } else if (status === 'Tamamlandı') {
          // was consumed directly → just add stock back
          patch.stock_on_hand     = (Number(prod.stock_on_hand)     || 0) + qty;
        }
        // Taslak → no stock had moved; gift_count only

        await supabase.from('products').update(patch)
          .eq('id', productId).eq('tenant_id', tenantId);
      }
    }

    res.json({ ok: true, removedId: itemId, order_id: row.order_id, status });
  } catch (err) {
    console.error('DELETE /orders/gifts/:itemId hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dmo/orders/:id — reverse stock, restore gift stock, then delete (+ items via cascade)
router.delete('/orders/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });
    const orderId = req.params.id;

    // Ensure the order belongs to this tenant, and read its status while it still exists
    const { data: order, error: oe } = await supabase.from('dmo_orders')
      .select('id, status').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
    if (oe) throw oe;
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    // Reverse the reservation only if stock was actually reserved (Sipariş Alındı)
    if (order.status === 'Sipariş Alındı') {
      const { data: rows } = await supabase.from('dmo_order_items')
        .select('quantity, dmo_products(product_id)')
        .eq('order_id', orderId).eq('is_gift', false);

      for (const r of (rows || [])) {
        const pid = r.dmo_products?.product_id;
        if (!pid) continue;                          // unresolved line — nothing to reverse
        const { data: p } = await supabase.from('products')
          .select('stock_on_hand, reserved_quantity').eq('id', pid).maybeSingle();
        if (!p) continue;
        await supabase.from('products').update({
          stock_on_hand:     (Number(p.stock_on_hand) || 0)     + (Number(r.quantity) || 0),
          reserved_quantity: (Number(p.reserved_quantity) || 0) - (Number(r.quantity) || 0),
          updated_at:        new Date().toISOString(),
        }).eq('id', pid);
      }
    }

    // Return gift quantities to dmo_products before deleting
    const { data: gifts } = await supabase.from('dmo_order_items')
      .select('dmo_product_id, quantity').eq('order_id', orderId).eq('is_gift', true);

    for (const g of (gifts || [])) {
      if (!g.dmo_product_id) continue;
      const { data: dp } = await supabase.from('dmo_products')
        .select('gift_quantity').eq('id', g.dmo_product_id).eq('tenant_id', tenantId).maybeSingle();
      if (!dp) continue;
      const restored = (Number(dp.gift_quantity) || 0) + (Number(g.quantity) || 0);
      await supabase.from('dmo_products')
        .update({ gift_quantity: restored })
        .eq('id', g.dmo_product_id).eq('tenant_id', tenantId);
    }

    // Delete the order — dmo_order_items cascade via FK
    const { error: de } = await supabase.from('dmo_orders')
      .delete().eq('id', orderId).eq('tenant_id', tenantId);
    if (de) throw de;

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/dmo/orders/:id hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// PUT /api/dmo/orders/:id — update editable order fields
router.put('/orders/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    const patch = { ...(req.body || {}) };
    delete patch.id;          // never let the client change identity/ownership
    delete patch.tenant_id;

    const { error } = await supabase.from('dmo_orders')
      .update(patch)
      .eq('id', req.params.id).eq('tenant_id', tenantId);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/dmo/orders/:id hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dmo/upload-pdf — order PDF → storage (service-role), returns public URL
router.post('/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });
    if (!req.file)  return res.status(400).json({ error: 'PDF bulunamadı' });

    const safeNo   = String(req.body.salesOrderNo || 'order').replace(/[^a-zA-Z0-9_-]/g, '');
    const fileName = `${tenantId}/${safeNo}_${Date.now()}.pdf`;

    const { error } = await supabase.storage
      .from('dmo-pdfs')
      .upload(fileName, req.file.buffer, { contentType: 'application/pdf', upsert: true });
    if (error) throw error;

    const { data } = supabase.storage.from('dmo-pdfs').getPublicUrl(fileName);
    res.json({ url: data?.publicUrl || null });
  } catch (err) {
    console.error('DMO upload-pdf hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// GET /api/dmo/rates — shared, no tenant filter
router.get('/rates', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data: dmoRow  } = await supabase.from('rate_history').select('dmo_eur_try, dmo_rate_date, recorded_at').not('dmo_eur_try', 'is', null).order('recorded_at', { ascending: false }).limit(1).maybeSingle();
    const { data: tcmbRow } = await supabase.from('rate_history').select('usd_try, eur_try, rate_date, recorded_at').not('usd_try', 'is', null).not('eur_try', 'is', null).order('recorded_at', { ascending: false }).limit(1).maybeSingle();
    res.json({
      usd_try: tcmbRow?.usd_try || null, eur_try: tcmbRow?.eur_try || null,
      dmo_eur_try: dmoRow?.dmo_eur_try || null,
      rate_date: tcmbRow?.rate_date || null, dmo_rate_date: dmoRow?.dmo_rate_date || null,
    });
  } catch (err) {
    console.error('rates endpoint hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dmo/fetch-tcmb-now
router.post('/fetch-tcmb-now', async (req, res) => {
  await fetchAndSaveTCMBRates(req.app.get('supabase'));
  res.json({ ok: true });
});

// POST /api/dmo/fetch-dmo-rate-now
router.post('/fetch-dmo-rate-now', async (req, res) => {
  await fetchAndSaveDMORate(req.app.get('supabase'));
  res.json({ ok: true });
});

// POST /api/dmo/find-dmo-url
router.post('/find-dmo-url', async (req, res) => {
  try {
    const r    = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/find-dmo-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
    const text = await r.text();
    res.status(r.status).setHeader('content-type', r.headers.get('content-type') || 'application/json; charset=utf-8').send(text);
  } catch (err) {
    console.error('DMO find-url proxy hatası:', err.message);
    res.status(502).json({ error: 'DMO servisine bağlanılamadı.' });
  }
});

// POST /api/dmo/scrape-dmo-prices
router.post('/scrape-dmo-prices', async (req, res) => {
  try {
    const r    = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/scrape-dmo-prices`, { method: 'POST' });
    const text = await r.text();
    res.status(r.status).setHeader('content-type', r.headers.get('content-type') || 'application/json; charset=utf-8').send(text);
  } catch (err) {
    console.error('DMO scrape proxy hatası:', err.message);
    res.status(502).json({ error: 'DMO scrape servisine bağlanılamadı.' });
  }
});

// GET /api/debug-tcmb
router.get('/debug-tcmb', async (req, res) => {
  try {
    const r    = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml');
    const text = await r.text();
    res.send(`<pre>STATUS: ${r.status}\n\nBODY:\n${text.slice(0, 3000)}</pre>`);
  } catch (err) {
    res.send('ERROR: ' + err.message);
  }
});

// GET /api/dmo/invoices — DMO invoices for the current tenant
router.get('/invoices', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    const { data, error } = await supabase
      .from('invoices')
      .select('*, companies(name)')
      .eq('dmo_invoice', true)
      .eq('tenant_id', tenantId)
      .order('invoice_date', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('DMO invoices hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dmo/overview — aggregates for Genel Bakış
// completed invoices (dmo_invoice=true) + orders in 'Sipariş Alındı'
// GET /api/dmo/overview — aggregates for Genel Bakış
// completed invoices (dmo_invoice=true) + orders in 'Sipariş Alındı'
router.get('/overview', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    // ── Invoices ──
    const { data: invoices, error: ie } = await supabase
      .from('invoices')
      .select('id, invoice_date, payable_amount_tl, company_id, companies(name)')
      .eq('dmo_invoice', true)
      .eq('tenant_id', tenantId);
    if (ie) throw ie;

    // ── Orders (Sipariş Alındı only) ──
    const { data: orders, error: oe } = await supabase
      .from('dmo_orders')
      .select('id, order_date, dmo_basket_total')
      .eq('tenant_id', tenantId)
      .eq('status', 'Sipariş Alındı');
    if (oe) throw oe;

    // ── Line items for completed invoices (top products) ──
    const invIds = (invoices || []).map(i => i.id);
    let items = [];
    if (invIds.length) {
      const { data: it, error: itErr } = await supabase
        .from('invoice_items')
        .select('invoice_id, product_name, quantity, total_price_cur')
        .in('invoice_id', invIds);
      if (itErr) throw itErr;
      items = it || [];
    }

    // ── Monthly buckets: { 'YYYY-MM': { invoice, order } } ──
    const monthly = {};
    const bucket = (key) => (monthly[key] || (monthly[key] = { invoice: 0, order: 0 }));
    for (const inv of (invoices || [])) {
      if (!inv.invoice_date) continue;
      bucket(inv.invoice_date.slice(0, 7)).invoice += Number(inv.payable_amount_tl) || 0;
    }
    for (const ord of (orders || [])) {
      if (!ord.order_date) continue;
      bucket(ord.order_date.slice(0, 7)).order += Number(ord.dmo_basket_total) || 0;
    }
    const months = Object.keys(monthly).sort();
    const series = months.map(m => ({
      month: m,
      invoice: monthly[m].invoice,
      order: monthly[m].order,
    }));

    // ── Top companies by invoice revenue ──
    const companyMap = {};
    for (const inv of (invoices || [])) {
      const name = inv.companies?.name || 'Bilinmeyen';
      const c = companyMap[name] || (companyMap[name] = { name, total: 0, count: 0 });
      c.total += Number(inv.payable_amount_tl) || 0;
      c.count += 1;
    }
    const topCompanies = Object.values(companyMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    // ── Top products by quantity (grouped by product_name) ──
    const productMap = {};
    for (const it of items) {
      const name = (it.product_name || '').trim() || 'Bilinmeyen';
      const p = productMap[name] || (productMap[name] = { name, qty: 0, revenue: 0 });
      p.qty     += Number(it.quantity) || 0;
      p.revenue += Number(it.total_price_cur) || 0;
    }
    const topProducts = Object.values(productMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 8);

    // ── Totals ──
    const invTotal = (invoices || []).reduce((s, i) => s + (Number(i.payable_amount_tl) || 0), 0);
    const ordTotal = (orders   || []).reduce((s, o) => s + (Number(o.dmo_basket_total) || 0), 0);

    res.json({
      stats: {
        invoiceCount:  (invoices || []).length,
        invoiceTotal:  invTotal,
        orderCount:    (orders || []).length,
        orderTotal:    ordTotal,
        companyCount:  Object.keys(companyMap).length,
        grandTotal:    invTotal + ordTotal,
      },
      series,
      topCompanies,
      topProducts,
    });
  } catch (err) {
    console.error('GET /api/dmo/overview hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dmo/invoices/:id/items — line items (scoped to the tenant's invoice)
router.get('/invoices/:id/items', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    const { data, error } = await supabase
      .from('invoice_items')
      .select('*, invoices!inner(tenant_id)')
      .eq('invoice_id', req.params.id)
      .eq('invoices.tenant_id', tenantId)
      .order('line_id', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('DMO invoice items hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dmo/orders/:id — draft order + its items (Sepet taslak edit)
router.get('/orders/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data: order, error: e1 } = await supabase
      .from('dmo_orders')
      .select('*')
      .eq('id', req.params.id)
      .eq('tenant_id', req.tenantId)          // ← drop if dmo_orders has no tenant_id
      .single();
    if (e1) throw e1;

    const { data: items, error: e2 } = await supabase
      .from('dmo_order_items')
      .select(`
        *,
        dmo_products (
          id, dmo_code, dmo_fiyat_try, sozlesme_fiyat_eur,
          products ( id, product_name, product_code, last_purchase_price_tl, last_purchase_currency, last_purchase_rate, last_purchase_price_cur,
           maliyet_usd, stock_on_hand, model )
        )
      `)
      .eq('order_id', req.params.id);
    if (e2) throw e2;

    res.json({ order, items: items || [] });
  } catch (err) {
    console.error('GET /api/dmo/orders/:id hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dmo/orders/taslak — create or update a draft, then replace its items
router.post('/orders/taslak', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { orderId, order = {}, items } = req.body;

    // Allow-list: only real, surviving columns get written. Anything else the client
    // sends (legacy derived fields) is ignored, so a stray key can't break the insert.
    const clean = {
      customer_name:         order.customer_name ?? null,
      customer_no:           order.customer_no ?? null,
      sales_order_no:        order.sales_order_no ?? null,
      purchase_order_no:     order.purchase_order_no ?? null,
      usd_rate:              order.usd_rate ?? null,
      total_amount_excl_vat: order.total_amount_excl_vat ?? 0,
      tutar_indirimi:        order.tutar_indirimi ?? null,
      stamp_tax:             order.stamp_tax ?? 0,
      due_date:              order.due_date ?? null,
      status:                order.status ?? 'Taslak',
    };

    let saved;
    if (orderId) {
      await supabase.from('dmo_order_items').delete().eq('order_id', orderId);
      const { data, error } = await supabase
        .from('dmo_orders').update(clean)
        .eq('id', orderId).eq('tenant_id', req.tenantId)
        .select().single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await supabase
        .from('dmo_orders')
        .insert({ ...clean, tenant_id: req.tenantId, order_date: new Date().toISOString().slice(0, 10) })
        .select().single();
      if (error) throw error;
      saved = data;
    }

    if (Array.isArray(items) && items.length) {
      const rows = items.map(it => ({ ...it, order_id: saved.id, tenant_id: req.tenantId }));
      const { error } = await supabase.from('dmo_order_items').insert(rows);
      if (error) throw error;
    }

    res.json({ ok: true, order: saved });
  } catch (err) {
    console.error('POST /api/dmo/orders/taslak hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dmo/products — the tenant's DMO catalog (dmo_products + base product)

router.get('/products', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    const { data, error } = await supabase
      .from('dmo_products')
      .select(`
        id, dmo_code, dmo_fiyat_try, sozlesme_fiyat_eur,
        products ( id, product_code, product_name, model, maliyet_usd, stock_on_hand, reserved_quantity, last_purchase_price_tl )
      `)
      .eq('tenant_id', tenantId);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GET /api/dmo/products hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});


router.get('/orders', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'tenant yok' });

    const statuses = req.query.status ? [req.query.status] : ['Taslak', 'Sipariş Alındı', 'Tamamlandı'];

    const { data: orders, error } = await supabase
      .from('dmo_orders')
      .select('id, sales_order_no, total_amount_excl_vat, customer_name, order_date, status, tutar_indirimi, stamp_tax')
      .eq('tenant_id', tenantId)
      .in('status', statuses)
      .order('order_date', { ascending: false });
    if (error) throw error;

    const orderIds = (orders || []).map(o => o.id);
    if (!orderIds.length) return res.json([]);

    // Live cost per order, split gift vs non-gift
    const { data: items, error: itErr } = await supabase
      .from('dmo_order_items')
      .select('order_id, quantity, is_gift, dmo_products(products(last_purchase_price_tl))')
      .in('order_id', orderIds);
    if (itErr) throw itErr;

    const costByOrder = {};
    for (const it of (items || [])) {
      const unit = Number(it.dmo_products?.products?.last_purchase_price_tl) || 0;
      const line = unit * (Number(it.quantity) || 0);
      const c = costByOrder[it.order_id] || (costByOrder[it.order_id] = { inokas: 0, gift: 0 });
      if (it.is_gift) c.gift += line; else c.inokas += line;
    }

    const result = (orders || []).map(o => {
      const c = costByOrder[o.id] || { inokas: 0, gift: 0 };
      const f = computeDmoFinancials({
        basket:        o.total_amount_excl_vat,
        tutarIndirimi: o.tutar_indirimi,
        stampTax:      o.stamp_tax,
        inokasBasket:  c.inokas,
        giftTotal:     c.gift,
      });
      return {
        id: o.id,
        sales_order_no: o.sales_order_no,
        customer_name: o.customer_name,
        order_date: o.order_date,
        status: o.status,
        total_amount_excl_vat: o.total_amount_excl_vat,
        tutar_indirimi: o.tutar_indirimi,
        net_profit: f.netProfit,   // computed, not stored
        dmo_basket_total: o.total_amount_excl_vat, // alias if renderBekleyen still reads this name
      };
    });

    res.json(result);
  } catch (err) {
    console.error('GET /api/dmo/orders hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.fetchAndSaveDMORate = fetchAndSaveDMORate;
router.fetchAndSaveTCMBRates = fetchAndSaveTCMBRates;
module.exports = router;