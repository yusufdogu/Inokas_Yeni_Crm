// chat-router.js — İnokas CRM AI Asistan Backend
'use strict';

const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const router    = express.Router();
const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── System Prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const today   = now.toISOString().slice(0, 10);
  const yearStart  = `${now.getFullYear()}-01-01`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

  return `Sen İnokas CRM'nin Türkçe konuşan AI asistanısın. Kullanıcıya şirketin verilerine dayalı analizler, raporlar ve içgörüler sunuyorsun.

BUGÜNÜN TARİHİ: ${dateStr} (${today})
Bu yılın başlangıcı: ${yearStart}
Bu ayın başlangıcı: ${monthStart}
Geçen ayın aralığı: ${lastMonthStart} — ${lastMonthEnd}

KURALLAR:
- Her zaman Türkçe yanıt ver.
- Sayısal verileri Türk formatında göster (1.234,56).
- Para birimlerini açıkça belirt (TL, USD, EUR).
- Tarihler için GG.AA.YYYY formatını kullan.
- Yanıtlarını kısa ve net tut.
- "Bu yıl", "bu ay", "geçen ay" gibi ifadeleri yukarıdaki tarihlere göre yorumla.
- Veri bulunamazsa bunu açıkça söyle.

VERİTABANI ŞEMASI:
- invoices: direction(INCOMING/OUTGOING), status(Unpaid/Partial/Paid), approval_status(pending/approved), invoice_date, payable_amount_tl, payable_amount_cur, currency, pdf_url
- invoice_items: product_name, product_code, brand_name, quantity, unit_price_cur, total_price_cur, is_internal, internal_category
- companies: name, vkn_tckn, is_client, is_supplier
- products: product_code, product_name, brand, category, model, stock_on_hand, maliyet_usd, dmo_fiyat_try
- purchase_orders: po_number, status(Bekliyor/Kısmi Geldi/Tamamlandı), order_date
- purchase_order_items: ordered_qty, received_qty, unit_price_cur, currency
- dmo_orders: customer_name, net_profit, profit_percentage, status, order_date, toplam_gelir, toplam_gider
- payments: amount, currency, payment_date
- rate_history: usd_try, eur_try, rate_date

YANIT FORMATI — Her zaman bu JSON formatında döndür:
{
  "text": "Kullanıcıya gösterilecek açıklama",
  "charts": [{
    "type": "bar|line|pie|doughnut",
    "title": "Başlık",
    "labels": ["Ocak", "Şubat"],
    "datasets": [{ "label": "Seri", "data": [100, 200], "color": "#2563eb" }]
  }],
  "tables": [{
    "title": "Tablo başlığı",
    "headers": ["Sütun1", "Sütun2"],
    "rows": [["değer1", "değer2"]]
  }],
  "pdfs": [{
    "invoice_no": "FAT-001",
    "company": "Firma",
    "date": "2025-01-15",
    "amount": "1.234",
    "currency": "TRY",
    "pdf_url": "https://..."
  }]
}`;
}

// ─── Tools ────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_invoice_summary',
    description: 'Onaylanmış faturaları filtrele ve özetle.',
    input_schema: {
      type: 'object',
      properties: {
        direction:    { type: 'string', enum: ['INCOMING', 'OUTGOING', 'ALL'] },
        date_start:   { type: 'string', description: 'YYYY-MM-DD' },
        date_end:     { type: 'string', description: 'YYYY-MM-DD' },
        company_name: { type: 'string' },
        status:       { type: 'string', description: 'Unpaid, Partial, Paid' },
        currency:     { type: 'string', description: 'TRY, USD, EUR' },
        group_by:     { type: 'string', enum: ['month', 'company', 'currency', 'none'] },
      }
    }
  },
  {
    name: 'get_top_companies',
    description: 'En çok işlem yapılan firmaları listeler.',
    input_schema: {
      type: 'object',
      properties: {
        direction:  { type: 'string', enum: ['INCOMING', 'OUTGOING'] },
        date_start: { type: 'string' },
        date_end:   { type: 'string' },
        limit:      { type: 'number' },
        metric:     { type: 'string', enum: ['amount', 'count'] },
      }
    }
  },
  {
    name: 'get_top_products',
    description: 'En çok satılan/alınan ürünleri listeler.',
    input_schema: {
      type: 'object',
      properties: {
        date_start: { type: 'string' },
        date_end:   { type: 'string' },
        brand:      { type: 'string' },
        category:   { type: 'string' },
        limit:      { type: 'number' },
        metric:     { type: 'string', enum: ['quantity', 'amount'] },
      }
    }
  },
  {
    name: 'get_unpaid_invoices',
    description: 'Ödenmemiş veya kısmen ödenmiş faturaları listeler.',
    input_schema: {
      type: 'object',
      properties: {
        direction:    { type: 'string', enum: ['INCOMING', 'OUTGOING', 'ALL'] },
        company_name: { type: 'string' },
        overdue_only: { type: 'boolean' },
      }
    }
  },
  {
    name: 'get_stock_status',
    description: 'Ürün stok durumunu sorgular.',
    input_schema: {
      type: 'object',
      properties: {
        product_code: { type: 'string' },
        brand:        { type: 'string' },
        category:     { type: 'string' },
        low_stock:    { type: 'boolean' },
        limit:        { type: 'number' },
      }
    }
  },
  {
    name: 'get_purchase_orders',
    description: 'Satın alma siparişlerini listeler.',
    input_schema: {
      type: 'object',
      properties: {
        status:       { type: 'string', description: 'Bekliyor, Kısmi Geldi, Tamamlandı' },
        company_name: { type: 'string' },
        date_start:   { type: 'string' },
        date_end:     { type: 'string' },
      }
    }
  },
  {
    name: 'get_dmo_orders',
    description: 'DMO siparişlerini listeler ve kar analizini döndürür.',
    input_schema: {
      type: 'object',
      properties: {
        date_start:    { type: 'string' },
        date_end:      { type: 'string' },
        customer_name: { type: 'string' },
        status:        { type: 'string' },
        group_by:      { type: 'string', enum: ['month', 'customer', 'none'] },
      }
    }
  },
  {
    name: 'get_profit_analysis',
    description: 'DMO kar analizini döndürür.',
    input_schema: {
      type: 'object',
      properties: {
        date_start:    { type: 'string' },
        date_end:      { type: 'string' },
        group_by:      { type: 'string', enum: ['month', 'customer', 'none'] },
        customer_name: { type: 'string' },
      }
    }
  },
  {
    name: 'get_payment_history',
    description: 'Ödeme geçmişini listeler.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string' },
        date_start:   { type: 'string' },
        date_end:     { type: 'string' },
        currency:     { type: 'string' },
      }
    }
  },
  {
    name: 'get_rate_history',
    description: 'Döviz kuru geçmişini döndürür.',
    input_schema: {
      type: 'object',
      properties: {
        date_start: { type: 'string' },
        date_end:   { type: 'string' },
        currency:   { type: 'string', enum: ['usd', 'eur', 'both'] },
      }
    }
  },
  {
    name: 'list_invoices_with_pdf',
    description: "PDF'i olan faturaları listeler.",
    input_schema: {
      type: 'object',
      properties: {
        direction:    { type: 'string', enum: ['INCOMING', 'OUTGOING', 'ALL'] },
        date_start:   { type: 'string' },
        date_end:     { type: 'string' },
        company_name: { type: 'string' },
        limit:        { type: 'number' },
      }
    }
  }
];

// ─── Tool executor ────────────────────────────────────────────────────────────
async function executeTool(name, input, supabase) {
  try {
    switch (name) {
      case 'get_invoice_summary':    return await getInvoiceSummary(input, supabase);
      case 'get_top_companies':      return await getTopCompanies(input, supabase);
      case 'get_top_products':       return await getTopProducts(input, supabase);
      case 'get_unpaid_invoices':    return await getUnpaidInvoices(input, supabase);
      case 'get_stock_status':       return await getStockStatus(input, supabase);
      case 'get_purchase_orders':    return await getPurchaseOrders(input, supabase);
      case 'get_dmo_orders':         return await getDmoOrders(input, supabase);
      case 'get_profit_analysis':    return await getProfitAnalysis(input, supabase);
      case 'get_payment_history':    return await getPaymentHistory(input, supabase);
      case 'get_rate_history':       return await getRateHistory(input, supabase);
      case 'list_invoices_with_pdf': return await listInvoicesWithPdf(input, supabase);
      default: return { error: `Bilinmeyen araç: ${name}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtN(n) { return (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 }); }

// Fetch invoices with company name — join done client-side since
// Supabase doesn't support filtering on foreign table columns in .ilike()
async function fetchInvoices(supabase, { direction, date_start, date_end, status, currency, company_name }) {
  let query = supabase
    .from('invoices')
    .select(`
      id, invoice_no, invoice_date, direction, status, currency,
      payable_amount_tl, payable_amount_cur, paid_amount_cur, due_date,
      approval_status, pdf_url,
      companies ( id, name )
    `)
    .eq('approval_status', 'approved');

  if (direction && direction !== 'ALL') query = query.eq('direction', direction);
  if (date_start) query = query.gte('invoice_date', date_start);
  if (date_end)   query = query.lte('invoice_date', date_end);
  if (status)     query = query.ilike('status', status);  // Unpaid / Partial / Paid
  if (currency)   query = query.eq('currency', currency);

  const { data, error } = await query.order('invoice_date', { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);

  let rows = data || [];

  // Filter by company name client-side
  if (company_name) {
    const q = company_name.toLocaleLowerCase('tr-TR');
    rows = rows.filter(r => (r.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q));
  }

  return rows;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function getInvoiceSummary({ direction, date_start, date_end, company_name, status, currency, group_by }, supabase) {
  const rows     = await fetchInvoices(supabase, { direction, date_start, date_end, status, currency, company_name });
  const total_tl = rows.reduce((s, r) => s + (parseFloat(r.payable_amount_tl) || 0), 0);
  const total_usd = rows.filter(r => r.currency === 'USD').reduce((s, r) => s + (parseFloat(r.payable_amount_cur) || 0), 0);

  let grouped = null;
  if (group_by === 'month') {
    const byMonth = {};
    rows.forEach(r => {
      const m = (r.invoice_date || '').slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { count: 0, total_tl: 0 };
      byMonth[m].count++;
      byMonth[m].total_tl += parseFloat(r.payable_amount_tl) || 0;
    });
    grouped = Object.entries(byMonth).sort(([a],[b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
  } else if (group_by === 'company') {
    const byComp = {};
    rows.forEach(r => {
      const n = r.companies?.name || 'Bilinmiyor';
      if (!byComp[n]) byComp[n] = { count: 0, total_tl: 0 };
      byComp[n].count++;
      byComp[n].total_tl += parseFloat(r.payable_amount_tl) || 0;
    });
    grouped = Object.entries(byComp).sort(([,a],[,b]) => b.total_tl - a.total_tl).slice(0, 20).map(([company, v]) => ({ company, ...v }));
  } else if (group_by === 'currency') {
    const byCur = {};
    rows.forEach(r => {
      const c = r.currency || 'TRY';
      if (!byCur[c]) byCur[c] = { count: 0, total_tl: 0 };
      byCur[c].count++;
      byCur[c].total_tl += parseFloat(r.payable_amount_tl) || 0;
    });
    grouped = Object.entries(byCur).map(([currency, v]) => ({ currency, ...v }));
  }

  return {
    count: rows.length,
    total_tl: fmtN(total_tl),
    total_usd: fmtN(total_usd),
    grouped,
    sample: rows.slice(0, 5).map(r => ({
      invoice_no: r.invoice_no,
      company:    r.companies?.name,
      date:       r.invoice_date,
      amount_tl:  fmtN(r.payable_amount_tl),
      currency:   r.currency,
      status:     r.status,
    }))
  };
}

async function getTopCompanies({ direction, date_start, date_end, limit = 10, metric = 'amount' }, supabase) {
  const rows = await fetchInvoices(supabase, { direction, date_start, date_end });

  const byComp = {};
  rows.forEach(r => {
    const n = r.companies?.name || 'Bilinmiyor';
    if (!byComp[n]) byComp[n] = { count: 0, total_tl: 0 };
    byComp[n].count++;
    byComp[n].total_tl += parseFloat(r.payable_amount_tl) || 0;
  });

  const sorted = Object.entries(byComp)
    .sort(([,a],[,b]) => metric === 'amount' ? b.total_tl - a.total_tl : b.count - a.count)
    .slice(0, limit)
    .map(([company, v]) => ({ company, count: v.count, total_tl: fmtN(v.total_tl) }));

  return { companies: sorted };
}

async function getTopProducts({ date_start, date_end, brand, category, limit = 10, metric = 'quantity' }, supabase) {
  let query = supabase
    .from('invoice_items')
    .select('product_name, product_code, brand_name, quantity, total_price_cur, currency, invoices!inner(invoice_date, approval_status)')
    .eq('invoices.approval_status', 'approved')
    .eq('is_internal', false);

  if (date_start) query = query.gte('invoices.invoice_date', date_start);
  if (date_end)   query = query.lte('invoices.invoice_date', date_end);
  if (brand)      query = query.ilike('brand_name', `%${brand}%`);

  const { data, error } = await query.limit(2000);
  if (error) return { error: error.message };

  const byProduct = {};
  (data || []).forEach(it => {
    const key = it.product_code || it.product_name;
    if (!byProduct[key]) byProduct[key] = { name: it.product_name, code: it.product_code, brand: it.brand_name, qty: 0, amount: 0 };
    byProduct[key].qty    += parseFloat(it.quantity) || 0;
    byProduct[key].amount += parseFloat(it.total_price_cur) || 0;
  });

  const sorted = Object.values(byProduct)
    .sort((a, b) => metric === 'quantity' ? b.qty - a.qty : b.amount - a.amount)
    .slice(0, limit)
    .map(p => ({ ...p, qty: fmtN(p.qty), amount: fmtN(p.amount) }));

  return { products: sorted };
}

async function getUnpaidInvoices({ direction, company_name, overdue_only }, supabase) {
  let query = supabase
    .from('invoices')
    .select('invoice_no, invoice_date, due_date, direction, payable_amount_tl, payable_amount_cur, currency, paid_amount_cur, status, companies(name)')
    .eq('approval_status', 'approved')
    .not('status', 'ilike', 'paid');

  if (direction && direction !== 'ALL') query = query.eq('direction', direction);
  if (overdue_only) query = query.lt('due_date', new Date().toISOString().slice(0, 10));

  const { data, error } = await query.order('due_date', { ascending: true }).limit(100);
  if (error) return { error: error.message };

  let rows = (data || []);
  if (company_name) {
    const q = company_name.toLocaleLowerCase('tr-TR');
    rows = rows.filter(r => (r.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q));
  }

  const total_tl = rows.reduce((s, r) => s + (parseFloat(r.payable_amount_tl) || 0), 0);

  return {
    count: rows.length,
    total_tl: fmtN(total_tl),
    invoices: rows.map(r => ({
      invoice_no: r.invoice_no,
      company:    r.companies?.name,
      date:       r.invoice_date,
      due_date:   r.due_date,
      amount_tl:  fmtN(r.payable_amount_tl),
      currency:   r.currency,
      status:     r.status,
    }))
  };
}

async function getStockStatus({ product_code, brand, category, low_stock, limit = 20 }, supabase) {
  let query = supabase
    .from('products')
    .select('product_code, product_name, brand, category, model, stock_on_hand, maliyet_usd, dmo_fiyat_try');

  if (product_code) query = query.ilike('product_code', `%${product_code}%`);
  if (brand)        query = query.ilike('brand', `%${brand}%`);
  if (category)     query = query.ilike('category', `%${category}%`);
  if (low_stock)    query = query.gt('stock_on_hand', 0).lt('stock_on_hand', 5);

  const { data, error } = await query.order('stock_on_hand', { ascending: false }).limit(limit);
  if (error) return { error: error.message };

  return {
    products: (data || []).map(p => ({
      code:        p.product_code,
      name:        p.product_name,
      brand:       p.brand,
      category:    p.category,
      stock:       p.stock_on_hand,
      maliyet_usd: p.maliyet_usd,
      dmo_try:     p.dmo_fiyat_try,
    }))
  };
}

async function getPurchaseOrders({ status, company_name, date_start, date_end }, supabase) {
  let query = supabase
    .from('purchase_orders')
    .select('po_number, order_date, status, companies(name), purchase_order_items(ordered_qty, received_qty, unit_price_cur, currency, products(product_name, product_code))');

  if (status)     query = query.eq('status', status);
  if (date_start) query = query.gte('order_date', date_start);
  if (date_end)   query = query.lte('order_date', date_end);

  const { data, error } = await query.order('order_date', { ascending: false }).limit(50);
  if (error) return { error: error.message };

  let orders = data || [];
  if (company_name) {
    const q = company_name.toLocaleLowerCase('tr-TR');
    orders = orders.filter(o => (o.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q));
  }

  return {
    count: orders.length,
    orders: orders.map(o => ({
      po_number: o.po_number,
      company:   o.companies?.name,
      date:      o.order_date,
      status:    o.status,
      items:     (o.purchase_order_items || []).map(i => ({
        product:     i.products?.product_name,
        code:        i.products?.product_code,
        ordered:     i.ordered_qty,
        received:    i.received_qty,
        remaining:   (parseFloat(i.ordered_qty) || 0) - (parseFloat(i.received_qty) || 0),
        unit_price:  i.unit_price_cur,
        currency:    i.currency,
      }))
    }))
  };
}

async function getDmoOrders({ date_start, date_end, customer_name, status, group_by }, supabase) {
  let query = supabase
    .from('dmo_orders')
    .select('id, sales_order_no, customer_name, order_date, status, net_profit, profit_percentage, dmo_basket_total, inokas_basket_total, toplam_gelir, toplam_gider');

  if (date_start)    query = query.gte('order_date', date_start);
  if (date_end)      query = query.lte('order_date', date_end);
  if (customer_name) query = query.ilike('customer_name', `%${customer_name}%`);
  if (status)        query = query.eq('status', status);

  const { data, error } = await query.order('order_date', { ascending: false }).limit(200);
  if (error) return { error: error.message };

  const rows         = data || [];
  const total_profit = rows.reduce((s, r) => s + (parseFloat(r.net_profit) || 0), 0);
  const total_gelir  = rows.reduce((s, r) => s + (parseFloat(r.toplam_gelir) || 0), 0);

  let grouped = null;
  if (group_by === 'month') {
    const byMonth = {};
    rows.forEach(r => {
      const m = (r.order_date || '').slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { count: 0, profit: 0, gelir: 0 };
      byMonth[m].count++;
      byMonth[m].profit += parseFloat(r.net_profit)    || 0;
      byMonth[m].gelir  += parseFloat(r.toplam_gelir)  || 0;
    });
    grouped = Object.entries(byMonth).sort(([a],[b]) => a.localeCompare(b)).map(([month, v]) => ({
      month, count: v.count, profit: fmtN(v.profit), gelir: fmtN(v.gelir)
    }));
  } else if (group_by === 'customer') {
    const byCust = {};
    rows.forEach(r => {
      const n = r.customer_name || 'Bilinmiyor';
      if (!byCust[n]) byCust[n] = { count: 0, profit: 0 };
      byCust[n].count++;
      byCust[n].profit += parseFloat(r.net_profit) || 0;
    });
    grouped = Object.entries(byCust).sort(([,a],[,b]) => b.profit - a.profit).slice(0, 20).map(([customer, v]) => ({
      customer, count: v.count, profit: fmtN(v.profit)
    }));
  }

  return {
    count: rows.length,
    total_profit: fmtN(total_profit),
    total_gelir:  fmtN(total_gelir),
    grouped,
    sample: rows.slice(0, 10).map(r => ({
      order_no:   r.sales_order_no,
      customer:   r.customer_name,
      date:       r.order_date,
      status:     r.status,
      profit:     fmtN(r.net_profit),
      profit_pct: r.profit_percentage,
    }))
  };
}

async function getProfitAnalysis(input, supabase) {
  return await getDmoOrders({ ...input, group_by: input.group_by || 'month' }, supabase);
}

async function getPaymentHistory({ company_name, date_start, date_end, currency }, supabase) {
  let query = supabase
    .from('payments')
    .select('amount, currency, payment_date, notes, invoices(invoice_no, companies(name))');

  if (date_start) query = query.gte('payment_date', date_start);
  if (date_end)   query = query.lte('payment_date', date_end);
  if (currency)   query = query.eq('currency', currency);

  const { data, error } = await query.order('payment_date', { ascending: false }).limit(100);
  if (error) return { error: error.message };

  let rows = (data || []).map(p => ({
    amount:     fmtN(p.amount),
    currency:   p.currency,
    date:       p.payment_date,
    invoice_no: p.invoices?.invoice_no,
    company:    p.invoices?.companies?.name,
  }));

  if (company_name) {
    const q = company_name.toLocaleLowerCase('tr-TR');
    rows = rows.filter(r => (r.company || '').toLocaleLowerCase('tr-TR').includes(q));
  }

  return { count: rows.length, payments: rows };
}

async function getRateHistory({ date_start, date_end, currency = 'both' }, supabase) {
  let query = supabase
    .from('rate_history')
    .select('usd_try, eur_try, dmo_eur_try, rate_date')
    .order('rate_date', { ascending: true });

  if (date_start) query = query.gte('rate_date', date_start);
  if (date_end)   query = query.lte('rate_date', date_end);

  const { data, error } = await query.limit(365);
  if (error) return { error: error.message };

  return { rates: data || [] };
}

async function listInvoicesWithPdf({ direction, date_start, date_end, company_name, limit = 20 }, supabase) {
  let query = supabase
    .from('invoices')
    .select('invoice_no, invoice_date, direction, payable_amount_tl, payable_amount_cur, currency, pdf_url, companies(name)')
    .eq('approval_status', 'approved')
    .not('pdf_url', 'is', null);

  if (direction && direction !== 'ALL') query = query.eq('direction', direction);
  if (date_start) query = query.gte('invoice_date', date_start);
  if (date_end)   query = query.lte('invoice_date', date_end);

  const { data, error } = await query.order('invoice_date', { ascending: false }).limit(limit * 2);
  if (error) return { error: error.message };

  let rows = data || [];
  if (company_name) {
    const q = company_name.toLocaleLowerCase('tr-TR');
    rows = rows.filter(r => (r.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q));
  }
  rows = rows.slice(0, limit);

  return {
    count: rows.length,
    pdfs:  rows.map(r => ({
      invoice_no: r.invoice_no,
      company:    r.companies?.name,
      date:       r.invoice_date,
      amount:     fmtN(r.payable_amount_cur || r.payable_amount_tl),
      currency:   r.currency,
      pdf_url:    r.pdf_url,
    }))
  };
}

// ─── Main route ───────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  if (!supabase) return res.status(500).json({ error: 'Supabase bağlantısı yok' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY eksik' });

  const { message, history = [] } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Mesaj boş olamaz' });

  const messages = [
    ...history.slice(-10),
    { role: 'user', content: message.trim() }
  ];

  try {
    let response = await client.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 4096,
      system:     buildSystemPrompt(),
      tools:      TOOLS,
      messages,
    });

    // Tool-use loop
    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults   = [];

      for (const block of toolUseBlocks) {
        const result = await executeTool(block.name, block.input, supabase);
        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     JSON.stringify(result),
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user',      content: toolResults });

      response = await client.messages.create({
        model:      'claude-sonnet-4-5',
        max_tokens: 4096,
        system:     buildSystemPrompt(),
        tools:      TOOLS,
        messages,
      });
    }

    // Parse final response
    const textBlock = response.content.find(b => b.type === 'text');
    const rawText   = textBlock?.text || '{}';

    let parsed;
    try {
      const clean     = rawText.replace(/```json\n?|\n?```/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      parsed          = jsonMatch ? JSON.parse(jsonMatch[0]) : { text: clean };
    } catch {
      parsed = { text: rawText };
    }

    res.json({
      response:          parsed,
      assistant_message: { role: 'assistant', content: response.content },
    });

  } catch (err) {
    console.error('Chat hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;