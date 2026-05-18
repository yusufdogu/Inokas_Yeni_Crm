// routes/stocks.js
'use strict';

const express = require('express');
const router  = express.Router();

// GET /api/stocks/summary
router.get('/summary', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');

    const { data: items, error } = await supabase
      .from('invoice_items')
      .select(`
        id,
        product_name,
        product_code,
        is_internal,
        quantity,
        unit_price_cur,
        currency,
        invoices!invoice_items_invoice_id_fkey (
          invoice_date,
          direction,
          currency,
          calculation_rate,
          approval_status
        )
      `);

    if (error) throw error;

    const isKargoLine = (item) => {
      const haystack = `${item?.product_name || ''} ${item?.product_code || ''}`
        .toLocaleUpperCase('tr-TR');
      return haystack.includes('KARGO');
    };

    const { data: productRows, error: productErr } = await supabase
      .from('products')
      .select('id, product_code, product_name, reserved_quantity, gift_quantity, brand, category, model');
    if (productErr) throw productErr;

    const productByCode = new Map(
      (productRows || [])
        .filter(p => String(p.product_code || '').trim())
        .map(p => [
          String(p.product_code || '').trim(),
          {
            id:                p.id,
            reserved_quantity: Number(p.reserved_quantity || 0),
            gift_quantity:     Number(p.gift_quantity || 0),
            brand:             String(p.brand     || '').trim(),
            category:          String(p.category  || '').trim(),
            model:             String(p.model     || '').trim()
          }
        ])
    );

    const grouped          = {};
    const internalSkuSet   = new Set();
    const nonInternalSkuSet = new Set();

    (items || []).forEach(item => {
      const sku            = item.product_code || null;
      const isInternalItem = item.is_internal === true;

      // SKU tracking önce yapılmalı — early return'den etkilenmemeli
      if (sku && !isKargoLine(item)) {
        if (isInternalItem) internalSkuSet.add(String(sku).trim());
        else                nonInternalSkuSet.add(String(sku).trim());
      }

      if (isInternalItem) return;
      if (isKargoLine(item)) return;
      const invoice = item.invoices;
      if (!invoice) return;
      if (invoice.approval_status !== 'approved') return;

      const key = sku ? `SKU:${sku}` : `NAME:${item.product_name}`;
      if (!grouped[key]) {
        grouped[key] = {
          product_name:          item.product_name,
          sku,
          total_in:              0,
          total_out:             0,
          current_stock:         0,
          total_in_usd:          0,
          total_out_usd:         0,
          in_qty_for_avg_usd:    0,
          out_qty_for_avg_usd:   0,
          fifo_out_cost_usd:     0,
          fifo_revenue_usd:      0,
          fifo_gross_profit_usd: 0,
          fifo_lots:             [],
          events:                []
        };
      }

      const qty          = Number(item.quantity) || 0;
      const unitPrice    = Number(item.unit_price_cur) || 0;
      const itemCurrency = String(item.currency || invoice.currency || '').toUpperCase();
      let unitUsd        = null;
      if (unitPrice > 0) {
        if (itemCurrency === 'USD') {
          unitUsd = unitPrice;
        } else if (itemCurrency === 'TRY' && Number(invoice.calculation_rate) > 0) {
          unitUsd = unitPrice / Number(invoice.calculation_rate);
        }
      }

      grouped[key].events.push({
        id:          item.id,
        qty,
        unitUsd,
        isInternal:  isInternalItem,
        invoiceDate: item.invoices?.invoice_date || null,
        direction:   invoice.direction
      });
    });

    const profitEvents = [];
    Object.values(grouped).forEach(row => {
      row.events.sort((a, b) => {
        const ad = String(a.invoiceDate || '');
        const bd = String(b.invoiceDate || '');
        if (ad !== bd) return ad.localeCompare(bd);
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      row.events.forEach(ev => {
        const isIn  = ev.direction === 'INCOMING';
        const isOut = ev.direction === 'OUTGOING';

        if (isIn) {
          row.total_in += ev.qty;
          if (!ev.isInternal && ev.unitUsd !== null) {
            row.total_in_usd       += ev.qty * ev.unitUsd;
            row.in_qty_for_avg_usd += ev.qty;
            row.fifo_lots.push({ remaining: ev.qty, unitUsd: ev.unitUsd });
          }
        }

        if (isOut) {
          row.total_out += ev.qty;
          if (!ev.isInternal && ev.unitUsd !== null) {
            row.total_out_usd        += ev.qty * ev.unitUsd;
            row.out_qty_for_avg_usd  += ev.qty;
            row.fifo_revenue_usd     += ev.qty * ev.unitUsd;
          }

          let qtyToConsume   = ev.qty;
          let thisOutFifoCost = 0;
          while (qtyToConsume > 0 && row.fifo_lots.length > 0) {
            const lot         = row.fifo_lots[0];
            const consumeQty  = Math.min(qtyToConsume, lot.remaining);
            const consumeCost = consumeQty * lot.unitUsd;
            row.fifo_out_cost_usd += consumeCost;
            thisOutFifoCost       += consumeCost;
            lot.remaining         -= consumeQty;
            qtyToConsume          -= consumeQty;
            if (lot.remaining <= 0) row.fifo_lots.shift();
          }

          if (!ev.isInternal && ev.unitUsd !== null) {
            const thisOutRevenue = ev.qty * ev.unitUsd;
            const thisGross      = thisOutRevenue - thisOutFifoCost;
            row.fifo_gross_profit_usd += thisGross;
            profitEvents.push({
              sku:              row.sku || null,
              invoice_date:     ev.invoiceDate || null,
              is_internal:      ev.isInternal === true,
              gross_profit_usd: thisGross
            });
          }
        }
      });

      row.current_stock = row.total_in - row.total_out;
    });

    const summary = Object.values(grouped).map(row => {
      const productMeta   = row.sku ? productByCode.get(String(row.sku).trim()) : null;
      const avgInUnitUsd  = row.in_qty_for_avg_usd  > 0 ? (row.total_in_usd  / row.in_qty_for_avg_usd)  : null;
      const avgOutUnitUsd = row.out_qty_for_avg_usd > 0 ? (row.total_out_usd / row.out_qty_for_avg_usd) : null;
      const fifoStockUsd  = row.fifo_lots.reduce((acc, lot) => acc + (Number(lot.remaining || 0) * Number(lot.unitUsd || 0)), 0);
      const stockUsd      = row.in_qty_for_avg_usd > 0 ? fifoStockUsd : (row.current_stock > 0 ? null : 0);

      return {
        product_name:          row.product_name,
        sku:                   row.sku,
        total_in:              row.total_in,
        total_out:             row.total_out,
        current_stock:         row.current_stock,
        in_unit_usd:           avgInUnitUsd,
        out_unit_usd:          avgOutUnitUsd,
        stock_usd:             stockUsd,
        total_out_usd:         row.total_out_usd,
        fifo_cogs_usd:         row.fifo_out_cost_usd,
        fifo_revenue_usd:      row.fifo_revenue_usd,
        fifo_gross_profit_usd: row.fifo_gross_profit_usd,
        product_id:            productMeta?.id || null,
        reserved_quantity:     Number(productMeta?.reserved_quantity || 0),
        gift_quantity:         Number(productMeta?.gift_quantity || 0),
        brand:                 productMeta?.brand    || '',
        category:              productMeta?.category || '',
        model:                 productMeta?.model    || ''
      };
    }).sort((a, b) => {
      if (b.current_stock !== a.current_stock) return b.current_stock - a.current_stock;
      return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'tr');
    });

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
    }, {
      total_in_qty: 0, total_out_qty: 0, current_qty: 0,
      stock_usd: 0, total_out_usd: 0, fifo_cogs_usd: 0,
      fifo_revenue_usd: 0, fifo_gross_profit_usd: 0
    });

    const productCatalog = (productRows || [])
      .map(p => ({
        product_id:   String(p.id           || ''),
        sku:          String(p.product_code || '').trim(),
        product_name: String(p.product_name || '').trim(),
        brand:        String(p.brand        || '').trim(),
        category:     String(p.category     || '').trim(),
        model:        String(p.model        || '').trim()
      }))
      .filter(p => p.sku);

    const internalOnlySkus = [...internalSkuSet].filter(sku => !nonInternalSkuSet.has(sku));

    res.json({
      data:               summary,
      stats,
      product_catalog:    productCatalog,
      profit_events:      profitEvents,
      internal_only_skus: internalOnlySkus
    });

  } catch (err) {
    console.error('Stok Özet Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stocks/movements
router.get('/movements', async (req, res) => {
  try {
    const supabase      = req.app.get('supabase');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    const skuFilter      = String(req.query.sku              || '').trim();
    const skuLower       = skuFilter.toLowerCase();
    const approvalFilter = String(req.query.approval_status  || 'approved').trim().toLowerCase();

    let query = supabase
      .from('invoices')
      .select(`
        invoice_no, invoice_date, direction, currency,
        approval_status, pdf_url,
        companies ( name ),
        invoice_items (
          id, product_name, product_code,
          quantity, unit_price_cur, currency, is_internal
        )
      `)
      .order('invoice_date', { ascending: false });

    if (approvalFilter) query = query.eq('approval_status', approvalFilter);

    const { data: invoices, error } = await query;
    if (error) throw error;

    const movements = [];
    (invoices || []).forEach(inv => {
      const headerCurrency = inv.currency;
      const companyName    = inv.companies?.name || '—';
      const direction      = String(inv.direction       || '').toUpperCase();
      const approvalStatus = String(inv.approval_status || '').toLowerCase();

      (inv.invoice_items || []).forEach(item => {
        if (item.is_internal === true) return;
        const sku = String(item.product_code || '').trim();
        if (skuFilter && sku.toLowerCase() !== skuLower) return;

        movements.push({
          invoice_date:    inv.invoice_date,
          direction,
          invoice_no:      inv.invoice_no,
          company_name:    companyName,
          product_name:    item.product_name,
          sku,
          quantity:        item.quantity,
          unit_price_cur:  item.unit_price_cur,
          currency:        item.currency || headerCurrency,
          approval_status: approvalStatus,
          pdf_url:         inv.pdf_url || null,
        });
      });
    });

    // Enrich with product metadata and filter out is_internal products
    const skus = [...new Set(movements.map(m => m.sku).filter(Boolean))];
    if (skus.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('product_code, brand, category, model, is_internal')
        .in('product_code', skus);

      const productMap = new Map(
        (products || []).map(p => [String(p.product_code || '').trim(), p])
      );

      const internalProductSkus = new Set(
        (products || []).filter(p => p.is_internal === true).map(p => String(p.product_code || '').trim())
      );

      movements.forEach(m => {
        const p    = productMap.get(m.sku);
        m.brand    = p?.brand    || '';
        m.category = p?.category || '';
        m.model    = p?.model    || '';
      });

      return res.json(movements.filter(m => !internalProductSkus.has(m.sku)));
    }

    res.json(movements);
  } catch (err) {
    console.error('Stok Hareketleri Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;