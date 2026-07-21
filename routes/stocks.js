// routes/stocks.js
'use strict';

const express = require('express');
const router  = express.Router();


// ═══════════════════════════════════════════════════════════════════════════
//  NEW STOCK ROUTES — merge these into routes/stocks.js
//  (paste above `module.exports = router;`)
//
//  All four are tenant-scoped (req.tenantId) and reconstruct stock history from
//  invoice_items + invoices, mirroring the existing /summary and the invoices
//  /cashflow-series patterns.
//
//  Value model (agreed): cumulative running balance per product
//    stock(T) = Σ INCOMING qty (date ≤ T) − Σ OUTGOING qty (date ≤ T)
//  valued at the product's latest known unit_price, normalized to TL.
//  Chart = single TL line. Totals card = three separate currencies.
// ═══════════════════════════════════════════════════════════════════════════

// ── Shared helper: load approved, non-internal invoice lines for the tenant ───
// Returns [{ sku, name, qty, direction, date, currency, unit_price_cur, rate }]
// plus a productByCode map (from products) for latest price / brand / category.
async function _loadStockLines(supabase, tenantId, { dateStart, dateEnd } = {}) {
  let query = supabase
    .from('invoices')
    .select(`invoice_date, direction, currency, calculation_rate, approval_status, tenant_id,
             invoice_items(product_name, product_code, quantity, unit_price_cur, currency, is_internal)`)
    .eq('tenant_id', tenantId)
    .eq('approval_status', 'approved')
    .or('invoice_category.eq.INTERNAL,invoice_category.is.null')
    .order('invoice_date', { ascending: true });

  if (dateStart) query = query.gte('invoice_date', dateStart);
  if (dateEnd)   query = query.lte('invoice_date', dateEnd);

  const { data: invoices, error } = await query;
  if (error) throw error;


  const lines = [];
  (invoices || []).forEach(inv => {
    if (!inv || inv.tenant_id !== tenantId) return;
    const direction = String(inv.direction || '').toUpperCase();
    (inv.invoice_items || []).forEach(it => {
      const sku = String(it.product_code || '').trim();
      if (!sku) return;
      lines.push({
        sku,
        name: it.product_name,
        qty: Number(it.quantity) || 0,
        direction,
        date: inv.invoice_date || null,
        currency: String(it.currency || inv.currency || '').toUpperCase(),
        unit_price_cur: Number(it.unit_price_cur) || 0,
        rate: Number(inv.calculation_rate) || 0,
      });
    });
  });

  // latest price / brand / category per product (current snapshot)
  const skus = [...new Set(lines.map(l => l.sku))];
  const productByCode = new Map();
  if (skus.length) {
    const { data: prods, error: pErr } = await supabase
      .from('products')
      .select('product_code, brand, category, stock_on_hand, last_purchase_price_cur, last_purchase_currency, last_purchase_rate, avg_purchase_price_tl, is_internal, is_hidden')
      .eq('tenant_id', tenantId)
      .eq('is_internal',true)
      .in('product_code', skus);
    if (pErr) throw pErr;
    (prods || []).forEach(p => {
      productByCode.set(String(p.product_code || '').trim(), p);
    });
  }

  return { lines, productByCode };
}

// Latest TL unit price for a product (fallbacks mirror the frontend logic).
function _latestUnitTL(p) {
  if (!p) return 0;
  const cur = String(p.last_purchase_currency || '').toUpperCase();
  if ((cur === 'TRY' || cur === 'TL') && Number(p.avg_purchase_price_tl) > 0) return Number(p.avg_purchase_price_tl);
  const unit = Number(p.last_purchase_price_cur) || 0;
  const rate = Number(p.last_purchase_rate) || 0;
  if (unit > 0 && rate > 0) return unit * rate;
  if (Number(p.avg_purchase_price_tl) > 0) return Number(p.avg_purchase_price_tl);
  return 0;
}

// Bucket-key generator (same grains as invoices/cashflow-series).
function _bucketKeyOf(d, bucket) {
  if (bucket === 'day') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  if (bucket === 'week') {
    const day = d.getDay() || 7;
    const monday = new Date(d);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(d.getDate() - (day - 1));
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // month
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stocks/value-series?bucket=day|week|month&date_start&date_end
// Cumulative held-stock value in TL, sampled at each bucket boundary.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/value-series', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const bucket   = String(req.query.bucket || 'month');
    const dateStart = String(req.query.date_start || '').trim() || null;
    const dateEnd   = String(req.query.date_end   || '').trim() || null;

    // NOTE: for a running balance we need ALL history up to date_end, so we do
    // NOT pass dateStart to the loader — we filter the OUTPUT range instead.
    const { lines, productByCode } = await _loadStockLines(supabase, tenantId, { dateEnd });

    // price per sku (latest TL)
    const priceBySku = new Map();
    productByCode.forEach((p, code) => priceBySku.set(code, _latestUnitTL(p)));

    // sort lines by date, assign each a bucket, accumulate net qty per sku
    const dated = lines.filter(l => l.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // running net-qty per sku, snapshot the TOTAL value at each bucket boundary
    const netBySku = new Map();
    const bucketValue = new Map();   // bucketKey -> total TL value at end of bucket
    let lastKey = null;

    const snapshot = () => {
      let total = 0;
      netBySku.forEach((qty, sku) => {
        if (qty > 0) total += qty * (priceBySku.get(sku) || 0);
      });
      return total;
    };

    dated.forEach(l => {
      const d = new Date(l.date);
      const key = _bucketKeyOf(d, bucket);
      if (lastKey !== null && key !== lastKey) {
        bucketValue.set(lastKey, snapshot());   // close previous bucket
      }
      const delta = l.direction === 'INCOMING' ? l.qty : -l.qty;
      netBySku.set(l.sku, (netBySku.get(l.sku) || 0) + delta);
      lastKey = key;
    });
    if (lastKey !== null) bucketValue.set(lastKey, snapshot()); // close final bucket

    let series = [...bucketValue.entries()]
      .map(([period, value_tl]) => ({ period, value_tl: Math.round(value_tl) }))
      .sort((a, b) => a.period.localeCompare(b.period));

    // trim to requested display window (values remain cumulative/correct)
    if (dateStart) {
      const startKey = _bucketKeyOf(new Date(dateStart), bucket);
      series = series.filter(pt => pt.period >= startKey);
    }

    res.json({ series, bucket });
  } catch (err) {
    console.error('value-series hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stocks/totals?date_start&date_end
// Stock as-of period end: 3-currency value + counts + top-3 lists (by TL value).
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stocks/totals?date_end=
// "Now" (no date_end, or date_end >= today) → read the products snapshot
// (stock_on_hand), matching the ürünler page exactly.
// A PAST date_end → reconstruct held stock from invoice history (best-effort).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/totals', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const dateEnd  = String(req.query.date_end || '').trim() || null;

    const today = new Date().toISOString().slice(0, 10);
    const isHistorical = dateEnd && dateEnd < today;

    // ── Build a { sku → netQty } map ─────────────────────────────────────────
    // Snapshot: read stock_on_hand straight from products (source of truth).
    // Historical: reconstruct Σ IN − Σ OUT up to date_end.
    let netBySku = new Map();
    let productByCode;

    if (isHistorical) {
      const loaded = await _loadStockLines(supabase, tenantId, { dateEnd });
      productByCode = loaded.productByCode;
      loaded.lines.filter(l => l.date).forEach(l => {
        const delta = l.direction === 'INCOMING' ? l.qty : -l.qty;
        netBySku.set(l.sku, (netBySku.get(l.sku) || 0) + delta);
      });
    } else {
      // snapshot straight from the products table
      const { data: prods, error } = await supabase
        .from('products')
        .select('product_code, product_name, brand, category, stock_on_hand, last_purchase_price_cur, last_purchase_currency, last_purchase_rate, avg_purchase_price_tl, is_internal, is_hidden')
        .eq('tenant_id', tenantId)
        .eq('is_internal', true)
        .eq('is_hidden', false);
      if (error) throw error;

      productByCode = new Map();
      (prods || []).forEach(p => {
        const code = String(p.product_code || '').trim();
        if (!code) return;
        productByCode.set(code, p);
        netBySku.set(code, Number(p.stock_on_hand || 0));
      });
    }

    // ── Aggregate (identical for both paths) ─────────────────────────────────
    let tl = 0, eur = 0, usd = 0, totalQty = 0, productCount = 0;
    const catVal = {}, brandVal = {}, prodVal = {};
    const cats = new Set(), brands = new Set();

    netBySku.forEach((qty, sku) => {
      if (qty <= 0) return;
      const p = productByCode.get(sku);
      if (!p) return;
      productCount += 1;
      totalQty += qty;

      const cur    = String(p.last_purchase_currency || '').toUpperCase();
      const unit   = Number(p.last_purchase_price_cur) || 0;
      const tlUnit = _latestUnitTL(p);

      // three separate currency totals — mirrors renderUrunlerKpis exactly
      if ((cur === 'TRY' || cur === 'TL') && Number(p.avg_purchase_price_tl) > 0) {
        tl += qty * Number(p.avg_purchase_price_tl);
      } else if (cur === 'EUR' && unit > 0) {
        eur += qty * unit;
      } else if (cur === 'USD' && unit > 0) {
        usd += qty * unit;
      }

      // top lists ranked by TL-equivalent value
      const vTL = qty * tlUnit;
      const cat = String(p.category || '').trim();
      const br  = String(p.brand || '').trim();
      if (cat) { cats.add(cat);  catVal[cat]  = (catVal[cat]  || 0) + vTL; }
      if (br)  { brands.add(br); brandVal[br] = (brandVal[br] || 0) + vTL; }
      prodVal[sku] = { name: p.product_name || sku, val: vTL };
    });

    const rankAll = (obj) =>
      Object.entries(obj).map(([name, val]) => ({ name, val: Math.round(val) }))
        .sort((a, b) => b.val - a.val);

    const topProducts = Object.values(prodVal)
      .map(x => ({ name: x.name, val: Math.round(x.val) }))
      .sort((a, b) => b.val - a.val);

    res.json({
      tl: Math.round(tl), eur: Math.round(eur), usd: Math.round(usd),
      products: productCount, total_qty: totalQty,
      categories: cats.size, brands: brands.size,
      top_products: topProducts,
      top_categories: rankAll(catVal),
      top_brands: rankAll(brandVal),
    });
  } catch (err) {
    console.error('stocks/totals hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stocks/insights
// Snapshot (not period-filtered): risers, dead, risky + a simple forecast.
//   dead  = stock_on_hand > 0 AND no OUTGOING line in last 14 days
//   risky = stock_on_hand < 5
//   riser = OUTGOING value last 30d / prior 30d > 1
// ─────────────────────────────────────────────────────────────────────────────
router.get('/insights', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;

    const { lines, productByCode } = await _loadStockLines(supabase, tenantId, {});

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const d14 = now - 14 * DAY;
    const d30 = now - 30 * DAY;
    const d60 = now - 60 * DAY;

    // per-sku aggregates from movement history
    const lastOutBySku = new Map();          // most recent OUTGOING ts
    const out30 = new Map(), outPrev30 = new Map();  // OUTGOING value windows (TL)

    lines.forEach(l => {
      const ts = l.date ? new Date(l.date).getTime() : NaN;
      if (!Number.isFinite(ts)) return;
      if (l.direction !== 'OUTGOING') return;

      if (!lastOutBySku.has(l.sku) || ts > lastOutBySku.get(l.sku)) lastOutBySku.set(l.sku, ts);

      const p = productByCode.get(l.sku);
      const tlUnit = _latestUnitTL(p);
      const vTL = l.qty * tlUnit;
      if (ts >= d30)                 out30.set(l.sku,     (out30.get(l.sku)     || 0) + vTL);
      else if (ts >= d60 && ts < d30) outPrev30.set(l.sku, (outPrev30.get(l.sku) || 0) + vTL);
    });

    const dead = [], risky = [], risers = [];

    productByCode.forEach((p, sku) => {
      const stock = Number(p.stock_on_hand || 0);
      const tlUnit = _latestUnitTL(p);
      const valueTL = Math.round(stock * tlUnit);

      // dead
      const lastOut = lastOutBySku.get(sku) || 0;
      if (stock > 0 && lastOut < d14) {
        const daysIdle = lastOut ? Math.round((now - lastOut) / DAY) : 999;
        dead.push({ name: p.product_name || sku, code: sku, qty: stock, days: daysIdle, value_tl: valueTL });
      }

      // risky
      if (stock > 0 && stock < 10) {
        risky.push({ name: p.product_name || sku, code: sku, qty: stock, value_tl: valueTL });
      }

      // riser
      const cur = out30.get(sku) || 0;
      const prev = outPrev30.get(sku) || 0;
      if (prev > 0 && cur / prev > 1) {
        risers.push({
          name: p.product_name || sku, code: sku,
          mult: +(cur / prev).toFixed(1),
          prev_tl: Math.round(prev), now_tl: Math.round(cur),
        });
      }
    });

    dead.sort((a, b) => b.value_tl - a.value_tl);
    risky.sort((a, b) => a.qty - b.qty);
    risers.sort((a, b) => b.mult - a.mult);

    // simple month-end forecast from current total held value
    let totalTL = 0;
    productByCode.forEach(p => { totalTL += Number(p.stock_on_hand || 0) * _latestUnitTL(p); });
    const today = new Date();
    const dayOfMonth = today.getDate();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

    res.json({
      risers: risers.slice(0, 8),
      dead:   dead.slice(0, 8),
      risky:  risky.slice(0, 8),
      forecast: {
        now_tl: Math.round(totalTL),
        // naive linear projection to month end (placeholder until real model)
        projected_tl: Math.round(totalTL * (daysInMonth / Math.max(1, dayOfMonth))),
        pct: Math.round(dayOfMonth / daysInMonth * 100),
        day_of_month: dayOfMonth,
      },
    });
  } catch (err) {
    console.error('stocks/insights hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stocks/kpi-deltas
// % change (last 30d vs prior 30–60d) for the ürünler trend pills.
// Compares held-stock value/counts at "today" vs "30 days ago" reconstructions.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/kpi-deltas', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;

    const { lines, productByCode } = await _loadStockLines(supabase, tenantId, {});

    const DAY = 24 * 60 * 60 * 1000;
    const tNow  = Date.now();
    const tPrev = tNow - 30 * DAY;

    // reconstruct net qty per sku as of a cutoff timestamp
    const netAsOf = (cutoffTs) => {
      const net = new Map();
      lines.forEach(l => {
        const ts = l.date ? new Date(l.date).getTime() : NaN;
        if (!Number.isFinite(ts) || ts > cutoffTs) return;
        const delta = l.direction === 'INCOMING' ? l.qty : -l.qty;
        net.set(l.sku, (net.get(l.sku) || 0) + delta);
      });
      return net;
    };

    const measure = (net) => {
      let valueTL = 0, qty = 0, products = 0;
      const cats = new Set(), brands = new Set();
      net.forEach((q, sku) => {
        if (q <= 0) return;
        const p = productByCode.get(sku);
        if (!p) return;
        products += 1;
        qty += q;
        valueTL += q * _latestUnitTL(p);
        const c = String(p.category || '').trim(); if (c) cats.add(c);
        const b = String(p.brand || '').trim();    if (b) brands.add(b);
      });
      return { valueTL, qty, products, categories: cats.size, brands: brands.size };
    };

    const cur  = measure(netAsOf(tNow));
    const prev = measure(netAsOf(tPrev));

    const pct = (a, b) => {
      if (!b) return a > 0 ? 100 : 0;
      return +(((a - b) / b) * 100).toFixed(1);
    };

    res.json({
      value_tl:   pct(cur.valueTL,    prev.valueTL),
      qty:        pct(cur.qty,        prev.qty),
      products:   pct(cur.products,   prev.products),
      categories: pct(cur.categories, prev.categories),
      brands:     pct(cur.brands,     prev.brands),
    });
  } catch (err) {
    console.error('stocks/kpi-deltas hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// GET /api/stocks/summary
router.get('/summary', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;

    const { data: items, error } = await supabase
      .from('invoice_items')
      .select(`
        id, product_name, product_code, is_internal, quantity, unit_price_cur, currency,
        invoices!invoice_items_invoice_id_fkey (
          invoice_date, direction, currency, calculation_rate, approval_status, tenant_id
        )
      `);

    if (error) throw error;

    const isKargoLine = (item) =>
      `${item?.product_name || ''} ${item?.product_code || ''}`.toLocaleUpperCase('tr-TR').includes('KARGO');

    const { data: productRows, error: productErr } = await supabase
      .from('products')
      .select('id, product_code, product_name, reserved_quantity, gift_quantity, brand, category, model')
      .eq('tenant_id', tenantId);
    if (productErr) throw productErr;

    const productByCode = new Map(
      (productRows || []).filter(p => String(p.product_code || '').trim()).map(p => [
        String(p.product_code || '').trim(),
        { id: p.id, reserved_quantity: Number(p.reserved_quantity || 0), gift_quantity: Number(p.gift_quantity || 0), brand: String(p.brand || '').trim(), category: String(p.category || '').trim(), model: String(p.model || '').trim() }
      ])
    );

    const grouped = {}, internalSkuSet = new Set(), nonInternalSkuSet = new Set();

    (items || []).forEach(item => {
      const invoice = item.invoices;
      if (!invoice || invoice.tenant_id !== tenantId) return;

      const sku            = item.product_code || null;
      const isInternalItem = item.is_internal === true;

      if (sku && !isKargoLine(item)) {
        if (isInternalItem) internalSkuSet.add(String(sku).trim());
        else                nonInternalSkuSet.add(String(sku).trim());
      }

      if (isInternalItem) return;
      if (isKargoLine(item)) return;
      if (!invoice) return;
      if (invoice.approval_status !== 'approved') return;

      const key = sku ? `SKU:${sku}` : `NAME:${item.product_name}`;
      if (!grouped[key]) {
        grouped[key] = {
          product_name: item.product_name, sku,
          total_in: 0, total_out: 0, current_stock: 0,
          total_in_usd: 0, total_out_usd: 0,
          in_qty_for_avg_usd: 0, out_qty_for_avg_usd: 0,
          fifo_out_cost_usd: 0, fifo_revenue_usd: 0, fifo_gross_profit_usd: 0,
          fifo_lots: [], events: []
        };
      }

      const qty          = Number(item.quantity) || 0;
      const unitPrice    = Number(item.unit_price_cur) || 0;
      const itemCurrency = String(item.currency || invoice.currency || '').toUpperCase();
      let unitUsd        = null;
      if (unitPrice > 0) {
        if (itemCurrency === 'USD') unitUsd = unitPrice;
        else if (itemCurrency === 'TRY' && Number(invoice.calculation_rate) > 0) unitUsd = unitPrice / Number(invoice.calculation_rate);
      }

      grouped[key].events.push({ id: item.id, qty, unitUsd, isInternal: isInternalItem, invoiceDate: invoice.invoice_date || null, direction: invoice.direction });
    });

    const profitEvents = [];
    Object.values(grouped).forEach(row => {
      row.events.sort((a, b) => {
        const ad = String(a.invoiceDate || ''), bd = String(b.invoiceDate || '');
        if (ad !== bd) return ad.localeCompare(bd);
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      row.events.forEach(ev => {
        const isIn = ev.direction === 'INCOMING', isOut = ev.direction === 'OUTGOING';
        if (isIn) {
          row.total_in += ev.qty;
          if (!ev.isInternal && ev.unitUsd !== null) {
            row.total_in_usd += ev.qty * ev.unitUsd;
            row.in_qty_for_avg_usd += ev.qty;
            row.fifo_lots.push({ remaining: ev.qty, unitUsd: ev.unitUsd });
          }
        }
        if (isOut) {
          row.total_out += ev.qty;
          if (!ev.isInternal && ev.unitUsd !== null) {
            row.total_out_usd += ev.qty * ev.unitUsd;
            row.out_qty_for_avg_usd += ev.qty;
            row.fifo_revenue_usd += ev.qty * ev.unitUsd;
          }
          let qtyToConsume = ev.qty, thisOutFifoCost = 0;
          while (qtyToConsume > 0 && row.fifo_lots.length > 0) {
            const lot = row.fifo_lots[0];
            const consumeQty = Math.min(qtyToConsume, lot.remaining);
            row.fifo_out_cost_usd += consumeQty * lot.unitUsd;
            thisOutFifoCost += consumeQty * lot.unitUsd;
            lot.remaining -= consumeQty;
            qtyToConsume -= consumeQty;
            if (lot.remaining <= 0) row.fifo_lots.shift();
          }
          if (!ev.isInternal && ev.unitUsd !== null) {
            const thisGross = ev.qty * ev.unitUsd - thisOutFifoCost;
            row.fifo_gross_profit_usd += thisGross;
            profitEvents.push({ sku: row.sku || null, invoice_date: ev.invoiceDate || null, is_internal: ev.isInternal === true, gross_profit_usd: thisGross });
          }
        }
      });
      row.current_stock = row.total_in - row.total_out;
    });

    const summary = Object.values(grouped).map(row => {
      const p = row.sku ? productByCode.get(String(row.sku).trim()) : null;
      const avgInUnitUsd  = row.in_qty_for_avg_usd  > 0 ? row.total_in_usd  / row.in_qty_for_avg_usd  : null;
      const avgOutUnitUsd = row.out_qty_for_avg_usd > 0 ? row.total_out_usd / row.out_qty_for_avg_usd : null;
      const fifoStockUsd  = row.fifo_lots.reduce((acc, lot) => acc + Number(lot.remaining || 0) * Number(lot.unitUsd || 0), 0);
      const stockUsd      = row.in_qty_for_avg_usd > 0 ? fifoStockUsd : (row.current_stock > 0 ? null : 0);
      return {
        product_name: row.product_name, sku: row.sku,
        total_in: row.total_in, total_out: row.total_out, current_stock: row.current_stock,
        in_unit_usd: avgInUnitUsd, out_unit_usd: avgOutUnitUsd, stock_usd: stockUsd,
        total_out_usd: row.total_out_usd, fifo_cogs_usd: row.fifo_out_cost_usd,
        fifo_revenue_usd: row.fifo_revenue_usd, fifo_gross_profit_usd: row.fifo_gross_profit_usd,
        product_id: p?.id || null, reserved_quantity: Number(p?.reserved_quantity || 0),
        gift_quantity: Number(p?.gift_quantity || 0),
        brand: p?.brand || '', category: p?.category || '', model: p?.model || ''
      };
    }).sort((a, b) => b.current_stock !== a.current_stock ? b.current_stock - a.current_stock : String(a.product_name || '').localeCompare(String(b.product_name || ''), 'tr'));

    const stats = summary.reduce((acc, row) => {
      acc.total_in_qty          += Number(row.total_in              || 0);
      acc.total_out_qty         += Number(row.total_out             || 0);
      acc.current_qty           += Number(row.current_stock         || 0);
      acc.stock_usd             += Number(row.stock_usd             || 0);
      acc.total_out_usd         += Number(row.total_out_usd         || 0);
      acc.fifo_cogs_usd         += Number(row.fifo_cogs_usd         || 0);
      acc.fifo_revenue_usd      += Number(row.fifo_revenue_usd      || 0);
      acc.fifo_gross_profit_usd += Number(row.fifo_gross_profit_usd || 0);
      return acc;
    }, { total_in_qty: 0, total_out_qty: 0, current_qty: 0, stock_usd: 0, total_out_usd: 0, fifo_cogs_usd: 0, fifo_revenue_usd: 0, fifo_gross_profit_usd: 0 });

    const productCatalog = (productRows || []).map(p => ({
      product_id: String(p.id || ''), sku: String(p.product_code || '').trim(),
      product_name: String(p.product_name || '').trim(), brand: String(p.brand || '').trim(),
      category: String(p.category || '').trim(), model: String(p.model || '').trim()
    })).filter(p => p.sku);

    const internalOnlySkus = [...internalSkuSet].filter(sku => !nonInternalSkuSet.has(sku));
    res.json({ data: summary, stats, product_catalog: productCatalog, profit_events: profitEvents, internal_only_skus: internalOnlySkus });
  } catch (err) {
    console.error('Stok Özet Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stocks/movements
router.get('/movements', async (req, res) => {
  try {
    const supabase      = req.app.get('supabase');
    const tenantId      = req.tenantId;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    const idFilter      = String(req.query.id             || '').trim();
    const approvalFilter = String(req.query.approval_status || 'approved').trim().toLowerCase();

    let query = supabase
      .from('invoices')
      .select(`invoice_no, invoice_date, direction, currency, approval_status, pdf_url, companies(name), invoice_items(id, product_id, product_name, product_code, quantity, unit_price_cur, currency, is_internal)`)
      .eq('tenant_id', tenantId)
      .order('invoice_date', { ascending: false });

    if (approvalFilter) query = query.eq('approval_status', approvalFilter);

    const { data: invoices, error } = await query;
    if (error) throw error;

    const movements = [];
    (invoices || []).forEach(inv => {
      const companyName    = inv.companies?.name || '—';
      const direction      = String(inv.direction       || '').toUpperCase();
      const approvalStatus = String(inv.approval_status || '').toLowerCase();

      (inv.invoice_items || []).forEach(item => {
        if (item.is_internal === false) return;        // skip internal — keep real products

        if (idFilter !== item.product_id) return;

        movements.push({
          invoice_date: inv.invoice_date, direction, invoice_no: inv.invoice_no,
          company_name: companyName, product_name: item.product_name, product_code:item.product_code,
          product_id: item.product_id || null,       // ← carry the FK
          quantity: item.quantity, unit_price_cur: item.unit_price_cur,
          currency: item.currency || inv.currency, approval_status: approvalStatus, pdf_url: inv.pdf_url || null,
        });
      });
    });

    // Enrich brand/category/model by PRODUCT_ID (the real FK), not SKU text.
    const productIds = [...new Set(movements.map(m => m.product_id).filter(Boolean))];
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, brand, category, model, is_internal, is_hidden')
        .eq('tenant_id', tenantId)
        .in('id', productIds);

      const productMap = new Map((products || []).map(p => [p.id, p]));

      // drop movements whose product is internal/hidden (defensive, matches product truth)
      const filtered = movements.filter(m => {
        const p = m.product_id ? productMap.get(m.product_id) : null;
        if (p && (p.is_internal === false || p.is_hidden === true)) return false;
        if (p) { m.brand = p.brand || ''; m.category = p.category || ''; m.model = p.model || ''; }
        else   { m.brand = ''; m.category = ''; m.model = ''; }
        return true;
      });

      return res.json(filtered);
    }

    // no linked products — return as-is with empty enrichment
    movements.forEach(m => { m.brand = ''; m.category = ''; m.model = ''; });
    res.json(movements);
  } catch (err) {
    console.error('Stok Hareketleri Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;