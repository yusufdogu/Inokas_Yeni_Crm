// chat.js — İnokas CRM AI Asistan Backend
// Optimizations: Haiku model + streaming + parallel tool execution
'use strict';

const express   = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const router    = express.Router();
const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── System Prompt ────────────────────────────────────────────────────────────
// ─── REPLACE buildSystemPrompt() in chat-router.js with this ─────────────────

function buildSystemPrompt() {
  const now            = new Date();
  const today          = now.toISOString().slice(0, 10);
  const yearStart      = `${now.getFullYear()}-01-01`;
  const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
  const dateStr        = now.toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return `Sen İnokas CRM'nin Türkçe konuşan AI asistanısın. Şirketin verilerine dayalı analizler ve içgörüler sunuyorsun.

BUGÜNÜN TARİHİ: ${dateStr} (${today})
Bu yılın başlangıcı: ${yearStart}
Bu ayın başlangıcı: ${monthStart}
Geçen ayın aralığı: ${lastMonthStart} — ${lastMonthEnd}

KURALLAR:
- Her zaman Türkçe yanıt ver.
- Sayısal verileri Türk formatında göster: 1.234,56
- Para birimlerini açıkça belirt: TL, USD, EUR
- Tarihler için GG.AA.YYYY formatı kullan
- "Bu yıl", "bu ay", "geçen ay" ifadelerini yukarıdaki tarihlere göre yorumla
- Yanıtlarını kısa ve net tut — gereksiz tekrar yapma
- Veri bulunamazsa bunu açıkça söyle
- Kullanıcı PDF veya fatura belgesi istediğinde MUTLAKA list_invoices_with_pdf aracını kullan
- get_invoice_summary PDF döndürmez, sadece özet sayısal bilgi verir

VERİTABANI ŞEMASI:

── FATURALAR ────────────────────────────────────────────────────────────────────

invoices (faturalar):
  id, invoice_no, efatura_uuid
  company_id → companies(id, name, vkn_tckn)
  direction: 'INCOMING' (alış/gelen) | 'OUTGOING' (satış/giden)
  invoice_date: fatura tarihi
  due_date: vade tarihi (vadesi geçmiş kontrolü için bunu kullan)
  base_currency: para birimi (TRY, USD, EUR) — "currency" kolonu da var ama base_currency kullan
  calculation_rate: kur (1 USD = ? TRY, TRY faturalarda 1)
  total_tax_exclusive_tl: matrah (KDV hariç) TL cinsinden
  tax_amount_tl: KDV tutarı TL
  payable_amount_tl: ödenecek toplam TL
  total_tax_exclusive_cur: matrah kaynak para biriminde
  payable_amount_cur: ödenecek toplam kaynak para biriminde
  paid_amount_cur: ödenen tutar kaynak para biriminde
  status: 'Unpaid' | 'Partial' | 'Paid'
  approval_status: 'pending' | 'approved' | 'rejected'
  source: 'api' (e-fatura sistemi) | 'manual' (elle girilmiş)
  invoice_type: fatura türü (TEMELFATURA, TICARIFATURA vb.)
  pdf_url: PDF linki
  NOT: Analizlerde sadece approval_status='approved' faturaları kullan

invoice_items (fatura kalemleri):
  invoice_id → invoices
  product_name, product_code
  brand_name: marka (doğrudan kolonda)
  quantity: miktar
  unit_code: birim (ADET, LTR, KG vb.)
  unit_price_cur: birim fiyat (kaynak para biriminde)
  total_price_cur: kalem toplam (kaynak para biriminde)
  tax_rate: KDV oranı (örn: 20 = %20)
  tax_amount_cur: KDV tutarı
  currency: kalem para birimi
  is_internal: true = ofis içi gider kalemi
  internal_category: ofis içi kategori (teknoloji, araç & yakıt, elektrik & doğalgaz, iletişim, yemek & mutfak, güvenlik, diğer)
  purchase_order_item_id → purchase_order_items (backorder bağlantısı)
  NOT: Ürün brand/category/model için products tablosuna product_code ile join yap

── FİRMALAR ─────────────────────────────────────────────────────────────────────

companies (firmalar):
  id, name, vkn_tckn
  is_client: müşteri mi
  is_supplier: tedarikçi mi
  tax_office, address, phone, email, city

── ÖDEMELER ─────────────────────────────────────────────────────────────────────

payments (ödemeler):
  invoice_id → invoices
  amount: ödeme tutarı
  currency: ödeme para birimi
  payment_date: ödeme tarihi
  notes

── ÜRÜNLER ──────────────────────────────────────────────────────────────────────

products (ürünler):
  product_code (tekil), product_name
  brand:Markası(Epson,Asus gibi), category(Kartuş,yazıcı gibi), model
  stock_on_hand: eldeki stok
  reserved_quantity: rezerve stok
  ordered_quantity: sipariş edilen
  maliyet_usd: maliyet (USD)
  sozlesme_fiyat_eur: sözleşme fiyatı (EUR)
  dmo_fiyat_try: DMO fiyatı (TRY)
  last_purchase_price_cur: son alış fiyatı
  last_purchase_currency: son alış para birimi
  avg_purchase_price_tl: ortalama alış fiyatı TL
  is_internal: sadece ofis içi kullanım ürünü mü
  source: 'manual' | 'invoice' (faturadan otomatik oluşturulmuş)

product_price_history (fiyat geçmişi):
  product_id → products
  dmo_fiyat_try, sozlesme_fiyat_eur, maliyet_usd
  purchase_price, purchase_currency
  sales_price, sales_currency
  recorded_at: kayıt tarihi
  NOT: Fiyat değişimlerini analiz etmek için kullan

── DMO SİPARİŞLERİ ──────────────────────────────────────────────────────────────

dmo_orders (DMO siparişleri):
  sales_order_no, purchase_order_no
  customer_name, customer_no
  order_date, due_date
  status: 'Taslak' | 'Sipariş Alındı' | 'Tamamlandı' | 'İptal'
  usd_rate: sipariş anındaki USD kuru
  dmo_basket_total: DMO sepet toplamı (indirim öncesi)
  real_dmo_basket: gerçek sepet (indirim sonrası = dmo_basket_total - tutar_indirimi)
  tutar_indirimi: sepet indirimi tutarı
  tutar_indirimi_pct: sepet indirimi yüzdesi
  inokas_basket_total: İnokas maliyet sepeti
  net_profit: net kar (TL)
  profit_percentage: kar yüzdesi
  toplam_gelir: toplam gelir
  toplam_gider: toplam gider
  tevkifat, gercek_kdv, kdv_amount, risturn_amount, stamp_tax_total: vergi/kesinti kalemleri
  pdf_url: sipariş PDF linki
  NOT: Kar analizi için net_profit ve profit_percentage kullan

dmo_order_items (DMO sipariş kalemleri):
  order_id → dmo_orders
  product_id → products
  katalog_kod: DMO katalog kodu
  quantity: miktar
  unit_price_excl_vat: birim fiyat (KDV hariç, TRY)
  line_total_excl_vat: kalem toplam (KDV hariç, TRY)
  maliyet_usd: kalem maliyeti (USD)
  maliyet_tl: kalem maliyeti (TL)
  indirim_pct: kalem indirim yüzdesi
  is_gift: hediye mi

── TEKLİFLER ────────────────────────────────────────────────────────────────────

quotes (teklifler):
  reference_no: teklif numarası
  company_id → companies | company_name: firma
  quote_date: teklif tarihi
  valid_until: geçerlilik tarihi
  total_excl_tax: KDV hariç toplam
  currency: para birimi
  status: 'draft' | 'pending' | 'accepted' | 'rejected'
  pdf_url

quote_items (teklif kalemleri):
  quote_id → quotes
  product_code, product_name
  quantity, unit_price, total_price, unit
  sort_order

── TEKNİK SORUNLAR ──────────────────────────────────────────────────────────────

technical_issues (teknik sorunlar — WhatsApp üzerinden gelen):
  customer_name, phone, company_name
  product: sorunlu ürün/cihaz
  issue_description: sorun açıklaması
  priority: 'acil' | 'normal' | 'düşük'
  status: 'bekliyor' | 'inceleniyor' | 'çözüldü' | 'kapatıldı'
  created_at: talep tarihi
  resolved_at: çözüm tarihi
  notes: teknik notlar

── KUR GEÇMİŞİ ──────────────────────────────────────────────────────────────────

rate_history (kur geçmişi):
  usd_try: USD/TRY kuru (TCMB)
  eur_try: EUR/TRY kuru (TCMB)
  dmo_eur_try: DMO EUR/TRY kuru
  rate_date: TCMB kur tarihi
  dmo_rate_date: DMO kur tarihi
  recorded_at: kayıt zamanı
  NOT: Kur analizi ve dönüşüm için kullan. En güncel kur = en son rate_date

── İLİŞKİLER ÖZET ───────────────────────────────────────────────────────────────

invoices.company_id → companies (firma adı için)
invoice_items.invoice_id → invoices
invoice_items.product_code → products.product_code (brand/category/model için)
dmo_order_items.product_id → products
dmo_order_items.order_id → dmo_orders
payments.invoice_id → invoices
quote_items.quote_id → quotes
quotes.company_id → companies
product_price_history.product_id → products
technical_issues: bağımsız tablo

YANIT FORMATI — Her zaman bu JSON formatında döndür:
{
  "text": "Açıklama metni",
  "charts": [{
    "type": "bar | line | pie | doughnut",
    "title": "Başlık",
    "labels": ["Ocak", "Şubat"],
    "datasets": [{ "label": "Seri adı", "data": [100, 200], "color": "#2563eb" }]
  }],
  "tables": [{
    "title": "Tablo başlığı",
    "headers": ["Sütun1", "Sütun2"],
    "rows": [["değer1", "değer2"]]
  }],
  "pdfs": [{
    "invoice_no": "FAT-001",
    "company": "Firma Adı",
    "date": "2025-01-15",
    "amount": "1.234,56",
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
        date_start:   { type: 'string' },
        date_end:     { type: 'string' },
        company_name: { type: 'string' },
        status:       { type: 'string', description: 'Unpaid, Partial, Paid' },
        currency:     { type: 'string' },
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
    description: 'Ödenmemiş faturaları listeler.',
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
        status:       { type: 'string' },
        company_name: { type: 'string' },
        date_start:   { type: 'string' },
        date_end:     { type: 'string' },
      }
    }
  },
  {
    name: 'get_dmo_orders',
    description: 'DMO siparişlerini ve kar analizini döndürür.',
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
  },

  // ─── ADD THESE TO THE TOOLS array in chat-router.js ─────────────────────────
  {
    name: 'get_quotes',
    description: 'Teklifleri listeler ve analiz eder.',
    input_schema: {
      type: 'object',
      properties: {
        status:       { type: 'string', description: 'draft, pending, accepted, rejected' },
        company_name: { type: 'string' },
        date_start:   { type: 'string' },
        date_end:     { type: 'string' },
        currency:     { type: 'string' },
        group_by:     { type: 'string', enum: ['month', 'status', 'company', 'none'] },
      }
    }
  },
  {
    name: 'get_technical_issues',
    description: 'Teknik sorunları listeler ve özetler.',
    input_schema: {
      type: 'object',
      properties: {
        status:    { type: 'string', description: 'bekliyor, inceleniyor, çözüldü, kapatıldı' },
        priority:  { type: 'string', description: 'acil, normal, düşük' },
        date_start:{ type: 'string' },
        date_end:  { type: 'string' },
        product:   { type: 'string', description: 'Ürün/cihaz adı filtresi' },
      }
    }
  },
  {
    name: 'get_price_history',
    description: 'Ürün fiyat geçmişini sorgular. Fiyat değişimlerini analiz eder.',
    input_schema: {
      type: 'object',
      properties: {
        product_code: { type: 'string' },
        product_name: { type: 'string' },
        date_start:   { type: 'string' },
        date_end:     { type: 'string' },
        limit:        { type: 'number' },
      }
    }
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtN = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 });

async function fetchInvoices(supabase, { direction, date_start, date_end, status, currency, company_name }) {
  let query = supabase
    .from('invoices')
    .select('id, invoice_no, invoice_date, direction, status, currency, payable_amount_tl, payable_amount_cur, paid_amount_cur, due_date, approval_status, pdf_url, companies(id, name)')
    .eq('approval_status', 'approved');

  if (direction && direction !== 'ALL') query = query.eq('direction', direction);
  if (date_start) query = query.gte('invoice_date', date_start);
  if (date_end)   query = query.lte('invoice_date', date_end);
  if (status)     query = query.ilike('status', status);
  if (currency)   query = query.eq('currency', currency);

  const { data, error } = await query.order('invoice_date', { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);

  let rows = data || [];
  if (company_name) {
    const q = company_name.toLocaleLowerCase('tr-TR');
    rows = rows.filter(r => (r.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q));
  }
  return rows;
}

// ─── Tool implementations ─────────────────────────────────────────────────────
async function getInvoiceSummary({ direction, date_start, date_end, company_name, status, currency, group_by }, supabase) {
  const rows      = await fetchInvoices(supabase, { direction, date_start, date_end, status, currency, company_name });
  const total_tl  = rows.reduce((s, r) => s + (parseFloat(r.payable_amount_tl) || 0), 0);
  const total_usd = rows.filter(r => r.currency === 'USD').reduce((s, r) => s + (parseFloat(r.payable_amount_cur) || 0), 0);

  let grouped = null;
  if (group_by === 'month') {
    const m = {};
    rows.forEach(r => {
      const k = (r.invoice_date || '').slice(0, 7);
      if (!m[k]) m[k] = { count: 0, total_tl: 0 };
      m[k].count++; m[k].total_tl += parseFloat(r.payable_amount_tl) || 0;
    });
    grouped = Object.entries(m).sort(([a],[b]) => a.localeCompare(b)).map(([month, v]) => ({ month, count: v.count, total_tl: fmtN(v.total_tl) }));
  } else if (group_by === 'company') {
    const c = {};
    rows.forEach(r => {
      const n = r.companies?.name || 'Bilinmiyor';
      if (!c[n]) c[n] = { count: 0, total_tl: 0 };
      c[n].count++; c[n].total_tl += parseFloat(r.payable_amount_tl) || 0;
    });
    grouped = Object.entries(c).sort(([,a],[,b]) => b.total_tl - a.total_tl).slice(0, 20).map(([company, v]) => ({ company, count: v.count, total_tl: fmtN(v.total_tl) }));
  }

  return { count: rows.length, total_tl: fmtN(total_tl), total_usd: fmtN(total_usd), grouped, sample: rows.slice(0, 5).map(r => ({ invoice_no: r.invoice_no, company: r.companies?.name, date: r.invoice_date, amount_tl: fmtN(r.payable_amount_tl), currency: r.currency, status: r.status })) };
}

async function getTopCompanies({ direction, date_start, date_end, limit = 10, metric = 'amount' }, supabase) {
  const rows = await fetchInvoices(supabase, { direction, date_start, date_end });
  const c = {};
  rows.forEach(r => {
    const n = r.companies?.name || 'Bilinmiyor';
    if (!c[n]) c[n] = { count: 0, total_tl: 0 };
    c[n].count++; c[n].total_tl += parseFloat(r.payable_amount_tl) || 0;
  });
  return { companies: Object.entries(c).sort(([,a],[,b]) => metric === 'amount' ? b.total_tl - a.total_tl : b.count - a.count).slice(0, limit).map(([company, v]) => ({ company, count: v.count, total_tl: fmtN(v.total_tl) })) };
}

async function getTopProducts({ date_start, date_end, brand, category, limit = 10, metric = 'quantity' }, supabase) {
  let query = supabase.from('invoice_items').select('product_name, product_code, brand_name, quantity, total_price_cur, invoices!inner(invoice_date, approval_status)').eq('invoices.approval_status', 'approved').eq('is_internal', false);
  if (date_start) query = query.gte('invoices.invoice_date', date_start);
  if (date_end)   query = query.lte('invoices.invoice_date', date_end);
  if (brand)      query = query.ilike('brand_name', `%${brand}%`);
  const { data, error } = await query.limit(2000);
  if (error) return { error: error.message };
  const p = {};
  (data || []).forEach(it => {
    const k = it.product_code || it.product_name;
    if (!p[k]) p[k] = { name: it.product_name, code: it.product_code, brand: it.brand_name, qty: 0, amount: 0 };
    p[k].qty += parseFloat(it.quantity) || 0;
    p[k].amount += parseFloat(it.total_price_cur) || 0;
  });
  return { products: Object.values(p).sort((a, b) => metric === 'quantity' ? b.qty - a.qty : b.amount - a.amount).slice(0, limit).map(x => ({ ...x, qty: fmtN(x.qty), amount: fmtN(x.amount) })) };
}

async function getUnpaidInvoices({ direction, company_name, overdue_only }, supabase) {
  let query = supabase.from('invoices').select('invoice_no, invoice_date, due_date, direction, payable_amount_tl, payable_amount_cur, currency, status, companies(name)').eq('approval_status', 'approved').not('status', 'ilike', 'paid');
  if (direction && direction !== 'ALL') query = query.eq('direction', direction);
  if (overdue_only) query = query.lt('due_date', new Date().toISOString().slice(0, 10));
  const { data, error } = await query.order('due_date', { ascending: true }).limit(100);
  if (error) return { error: error.message };
  let rows = data || [];
  if (company_name) { const q = company_name.toLocaleLowerCase('tr-TR'); rows = rows.filter(r => (r.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q)); }
  return { count: rows.length, total_tl: fmtN(rows.reduce((s, r) => s + (parseFloat(r.payable_amount_tl) || 0), 0)), invoices: rows.map(r => ({ invoice_no: r.invoice_no, company: r.companies?.name, date: r.invoice_date, due_date: r.due_date, amount_tl: fmtN(r.payable_amount_tl), status: r.status })) };
}

async function getStockStatus({ product_code, brand, category, low_stock, limit = 20 }, supabase) {
  let query = supabase.from('products').select('product_code, product_name, brand, category, model, stock_on_hand, maliyet_usd, dmo_fiyat_try');
  if (product_code) query = query.ilike('product_code', `%${product_code}%`);
  if (brand)        query = query.ilike('brand', `%${brand}%`);
  if (category)     query = query.ilike('category', `%${category}%`);
  if (low_stock)    query = query.gt('stock_on_hand', 0).lt('stock_on_hand', 5);
  const { data, error } = await query.order('stock_on_hand', { ascending: false }).limit(limit);
  if (error) return { error: error.message };
  return { products: (data || []).map(p => ({ code: p.product_code, name: p.product_name, brand: p.brand, category: p.category, stock: p.stock_on_hand, maliyet_usd: p.maliyet_usd, dmo_try: p.dmo_fiyat_try })) };
}

async function getPurchaseOrders({ status, company_name, date_start, date_end }, supabase) {
  let query = supabase.from('purchase_orders').select('po_number, order_date, status, companies(name), purchase_order_items(ordered_qty, received_qty, unit_price_cur, currency, products(product_name, product_code))');
  if (status)     query = query.eq('status', status);
  if (date_start) query = query.gte('order_date', date_start);
  if (date_end)   query = query.lte('order_date', date_end);
  const { data, error } = await query.order('order_date', { ascending: false }).limit(50);
  if (error) return { error: error.message };
  let orders = data || [];
  if (company_name) { const q = company_name.toLocaleLowerCase('tr-TR'); orders = orders.filter(o => (o.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q)); }
  return { count: orders.length, orders: orders.map(o => ({ po_number: o.po_number, company: o.companies?.name, date: o.order_date, status: o.status, items: (o.purchase_order_items || []).map(i => ({ product: i.products?.product_name, code: i.products?.product_code, ordered: i.ordered_qty, received: i.received_qty, remaining: (parseFloat(i.ordered_qty) || 0) - (parseFloat(i.received_qty) || 0), unit_price: i.unit_price_cur, currency: i.currency })) })) };
}

async function getDmoOrders({ date_start, date_end, customer_name, status, group_by }, supabase) {
  let query = supabase.from('dmo_orders').select('id, sales_order_no, customer_name, order_date, status, net_profit, profit_percentage, toplam_gelir, toplam_gider');
  if (date_start)    query = query.gte('order_date', date_start);
  if (date_end)      query = query.lte('order_date', date_end);
  if (customer_name) query = query.ilike('customer_name', `%${customer_name}%`);
  if (status)        query = query.eq('status', status);
  const { data, error } = await query.order('order_date', { ascending: false }).limit(200);
  if (error) return { error: error.message };
  const rows = data || [];
  const total_profit = rows.reduce((s, r) => s + (parseFloat(r.net_profit) || 0), 0);
  let grouped = null;
  if (group_by === 'month') {
    const m = {};
    rows.forEach(r => { const k = (r.order_date || '').slice(0, 7); if (!m[k]) m[k] = { count: 0, profit: 0 }; m[k].count++; m[k].profit += parseFloat(r.net_profit) || 0; });
    grouped = Object.entries(m).sort(([a],[b]) => a.localeCompare(b)).map(([month, v]) => ({ month, count: v.count, profit: fmtN(v.profit) }));
  } else if (group_by === 'customer') {
    const c = {};
    rows.forEach(r => { const n = r.customer_name || 'Bilinmiyor'; if (!c[n]) c[n] = { count: 0, profit: 0 }; c[n].count++; c[n].profit += parseFloat(r.net_profit) || 0; });
    grouped = Object.entries(c).sort(([,a],[,b]) => b.profit - a.profit).slice(0, 20).map(([customer, v]) => ({ customer, count: v.count, profit: fmtN(v.profit) }));
  }
  return { count: rows.length, total_profit: fmtN(total_profit), grouped, sample: rows.slice(0, 10).map(r => ({ order_no: r.sales_order_no, customer: r.customer_name, date: r.order_date, status: r.status, profit: fmtN(r.net_profit), profit_pct: r.profit_percentage })) };
}

async function getProfitAnalysis(input, supabase) { return getDmoOrders({ ...input, group_by: input.group_by || 'month' }, supabase); }

async function getPaymentHistory({ company_name, date_start, date_end, currency }, supabase) {
  let query = supabase.from('payments').select('amount, currency, payment_date, invoices(invoice_no, companies(name))');
  if (date_start) query = query.gte('payment_date', date_start);
  if (date_end)   query = query.lte('payment_date', date_end);
  if (currency)   query = query.eq('currency', currency);
  const { data, error } = await query.order('payment_date', { ascending: false }).limit(100);
  if (error) return { error: error.message };
  let rows = (data || []).map(p => ({ amount: fmtN(p.amount), currency: p.currency, date: p.payment_date, invoice_no: p.invoices?.invoice_no, company: p.invoices?.companies?.name }));
  if (company_name) { const q = company_name.toLocaleLowerCase('tr-TR'); rows = rows.filter(r => (r.company || '').toLocaleLowerCase('tr-TR').includes(q)); }
  return { count: rows.length, payments: rows };
}

async function getRateHistory({ date_start, date_end }, supabase) {
  let query = supabase.from('rate_history').select('usd_try, eur_try, rate_date').order('rate_date', { ascending: true });
  if (date_start) query = query.gte('rate_date', date_start);
  if (date_end)   query = query.lte('rate_date', date_end);
  const { data, error } = await query.limit(365);
  if (error) return { error: error.message };
  return { rates: data || [] };
}

async function listInvoicesWithPdf({ direction, date_start, date_end, company_name, limit = 20 }, supabase) {
  let query = supabase.from('invoices').select('invoice_no, invoice_date, direction, payable_amount_tl, payable_amount_cur, currency, pdf_url, companies(name)').eq('approval_status', 'approved').not('pdf_url', 'is', null);
  if (direction && direction !== 'ALL') query = query.eq('direction', direction);
  if (date_start) query = query.gte('invoice_date', date_start);
  if (date_end)   query = query.lte('invoice_date', date_end);
  const { data, error } = await query.order('invoice_date', { ascending: false }).limit(limit * 2);
  if (error) return { error: error.message };
  let rows = data || [];
  if (company_name) { const q = company_name.toLocaleLowerCase('tr-TR'); rows = rows.filter(r => (r.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q)); }
  return { count: rows.length, pdfs: rows.slice(0, limit).map(r => ({ invoice_no: r.invoice_no, company: r.companies?.name, date: r.invoice_date, amount: fmtN(r.payable_amount_cur || r.payable_amount_tl), currency: r.currency, pdf_url: r.pdf_url })) };
}

// ─── Tool executor — PARALLEL execution ───────────────────────────────────────
async function executeToolsInParallel(toolUseBlocks, supabase, tenantId) {
  const executions = toolUseBlocks.map(async block => {
    let result;
    try {
      switch (block.name) {
        case 'get_invoice_summary':    result = await getInvoiceSummary(block.input, supabase, tenantId);    break;
        case 'get_top_companies':      result = await getTopCompanies(block.input, supabase, tenantId);      break;
        case 'get_top_products':       result = await getTopProducts(block.input, supabase, tenantId);       break;
        case 'get_unpaid_invoices':    result = await getUnpaidInvoices(block.input, supabase, tenantId);    break;
        case 'get_stock_status':       result = await getStockStatus(block.input, supabase, tenantId);       break;
        case 'get_purchase_orders':    result = await getPurchaseOrders(block.input, supabase, tenantId);    break;
        case 'get_dmo_orders':         result = await getDmoOrders(block.input, supabase, tenantId);         break;
        case 'get_profit_analysis':    result = await getProfitAnalysis(block.input, supabase, tenantId);    break;
        case 'get_payment_history':    result = await getPaymentHistory(block.input, supabase, tenantId);    break;
        case 'get_rate_history':       result = await getRateHistory(block.input, supabase);                 break; // shared
        case 'list_invoices_with_pdf': result = await listInvoicesWithPdf(block.input, supabase, tenantId);  break;
        case 'get_quotes':             result = await getQuotes(block.input, supabase, tenantId);            break;
        case 'get_technical_issues':   result = await getTechnicalIssues(block.input, supabase, tenantId);   break;
        case 'get_price_history':      result = await getPriceHistory(block.input, supabase, tenantId);      break;
        default: result = { error: `Bilinmeyen araç: ${block.name}` };
      }
    } catch (e) {
      result = { error: e.message };
    }
    return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) };
  });
  return Promise.all(executions);
}

async function getQuotes({ status, company_name, date_start, date_end, currency, group_by }, supabase) {
  let query = supabase
    .from('quotes')
    .select('id, reference_no, company_name, quote_date, valid_until, total_excl_tax, currency, status, pdf_url, companies(name)')
    .order('quote_date', { ascending: false });

  if (status)     query = query.eq('status', status);
  if (date_start) query = query.gte('quote_date', date_start);
  if (date_end)   query = query.lte('quote_date', date_end);
  if (currency)   query = query.eq('currency', currency);

  const { data, error } = await query.limit(200);
  if (error) return { error: error.message };

  let rows = data || [];

  // Filter by company name client-side (join can't filter in Supabase)
  if (company_name) {
    const q = company_name.toLocaleLowerCase('tr-TR');
    rows = rows.filter(r =>
      (r.company_name || r.companies?.name || '').toLocaleLowerCase('tr-TR').includes(q)
    );
  }

  const total = rows.reduce((s, r) => s + (parseFloat(r.total_excl_tax) || 0), 0);

  let grouped = null;
  if (group_by === 'status') {
    const byStatus = {};
    rows.forEach(r => {
      const s = r.status || 'unknown';
      if (!byStatus[s]) byStatus[s] = { count: 0, total: 0 };
      byStatus[s].count++;
      byStatus[s].total += parseFloat(r.total_excl_tax) || 0;
    });
    grouped = Object.entries(byStatus).map(([status, v]) => ({ status, count: v.count, total: fmtN(v.total) }));
  } else if (group_by === 'month') {
    const byMonth = {};
    rows.forEach(r => {
      const m = (r.quote_date || '').slice(0, 7);
      if (!byMonth[m]) byMonth[m] = { count: 0, total: 0 };
      byMonth[m].count++;
      byMonth[m].total += parseFloat(r.total_excl_tax) || 0;
    });
    grouped = Object.entries(byMonth).sort(([a],[b]) => a.localeCompare(b)).map(([month, v]) => ({ month, count: v.count, total: fmtN(v.total) }));
  } else if (group_by === 'company') {
    const byComp = {};
    rows.forEach(r => {
      const n = r.company_name || r.companies?.name || 'Bilinmiyor';
      if (!byComp[n]) byComp[n] = { count: 0, total: 0 };
      byComp[n].count++;
      byComp[n].total += parseFloat(r.total_excl_tax) || 0;
    });
    grouped = Object.entries(byComp).sort(([,a],[,b]) => b.total - a.total).slice(0, 20).map(([company, v]) => ({ company, count: v.count, total: fmtN(v.total) }));
  }

  const statusCount = {
    draft:    rows.filter(r => r.status === 'draft').length,
    pending:  rows.filter(r => r.status === 'pending').length,
    accepted: rows.filter(r => r.status === 'accepted').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  };
  const conversionRate = rows.length > 0
    ? ((statusCount.accepted / rows.length) * 100).toFixed(1) + '%'
    : '0%';

  return {
    count: rows.length,
    total: fmtN(total),
    status_breakdown: statusCount,
    conversion_rate: conversionRate,
    grouped,
    sample: rows.slice(0, 10).map(r => ({
      reference_no: r.reference_no,
      company:      r.company_name || r.companies?.name,
      date:         r.quote_date,
      valid_until:  r.valid_until,
      total:        fmtN(r.total_excl_tax),
      currency:     r.currency,
      status:       r.status,
      pdf_url:      r.pdf_url,
    }))
  };
}

async function getTechnicalIssues({ status, priority, date_start, date_end, product }, supabase) {
  let query = supabase
    .from('technical_issues')
    .select('id, created_at, resolved_at, customer_name, phone, company_name, product, issue_description, priority, status, notes')
    .order('created_at', { ascending: false });

  if (status)     query = query.eq('status', status);
  if (priority)   query = query.eq('priority', priority);
  if (date_start) query = query.gte('created_at', date_start);
  if (date_end)   query = query.lte('created_at', date_end + 'T23:59:59');
  if (product)    query = query.ilike('product', `%${product}%`);

  const { data, error } = await query.limit(200);
  if (error) return { error: error.message };

  const rows = data || [];

  const summary = {
    total:       rows.length,
    bekliyor:    rows.filter(r => r.status === 'bekliyor').length,
    inceleniyor: rows.filter(r => r.status === 'inceleniyor').length,
    cozuldu:     rows.filter(r => r.status === 'çözüldü').length,
    kapatildi:   rows.filter(r => r.status === 'kapatıldı').length,
    acil:        rows.filter(r => r.priority === 'acil').length,
    normal:      rows.filter(r => r.priority === 'normal').length,
    dusuk:       rows.filter(r => r.priority === 'düşük').length,
  };

  // Average resolution time for solved issues
  const solved = rows.filter(r => r.resolved_at && r.created_at && r.status === 'çözüldü');
  let avgResolutionHours = null;
  if (solved.length > 0) {
    const totalMs = solved.reduce((s, r) => s + (new Date(r.resolved_at) - new Date(r.created_at)), 0);
    avgResolutionHours = (totalMs / solved.length / 3600000).toFixed(1);
  }

  return {
    summary,
    avg_resolution_hours: avgResolutionHours,
    issues: rows.slice(0, 20).map(r => ({
      id:           r.id,
      date:         r.created_at?.slice(0, 10),
      customer:     r.customer_name,
      company:      r.company_name,
      phone:        r.phone,
      product:      r.product,
      description:  r.issue_description,
      priority:     r.priority,
      status:       r.status,
      notes:        r.notes,
    }))
  };
}

async function getPriceHistory({ product_code, product_name, date_start, date_end, limit = 20 }, supabase) {
  // First find the product
  let productQuery = supabase.from('products').select('id, product_code, product_name, brand, category');
  if (product_code) productQuery = productQuery.ilike('product_code', `%${product_code}%`);
  if (product_name) productQuery = productQuery.ilike('product_name', `%${product_name}%`);

  const { data: products, error: pErr } = await productQuery.limit(5);
  if (pErr) return { error: pErr.message };
  if (!products?.length) return { error: 'Ürün bulunamadı' };

  const productIds = products.map(p => p.id);

  let query = supabase
    .from('product_price_history')
    .select('product_id, dmo_fiyat_try, sozlesme_fiyat_eur, maliyet_usd, purchase_price, purchase_currency, sales_price, sales_currency, recorded_at')
    .in('product_id', productIds)
    .order('recorded_at', { ascending: true });

  if (date_start) query = query.gte('recorded_at', date_start);
  if (date_end)   query = query.lte('recorded_at', date_end);

  const { data, error } = await query.limit(limit * productIds.length);
  if (error) return { error: error.message };

  const productMap = new Map(products.map(p => [p.id, p]));

  const history = (data || []).map(h => ({
    product_code:      productMap.get(h.product_id)?.product_code,
    product_name:      productMap.get(h.product_id)?.product_name,
    date:              h.recorded_at?.slice(0, 10),
    dmo_fiyat_try:     h.dmo_fiyat_try    ? fmtN(h.dmo_fiyat_try)    : null,
    sozlesme_fiyat_eur:h.sozlesme_fiyat_eur ? fmtN(h.sozlesme_fiyat_eur) : null,
    maliyet_usd:       h.maliyet_usd      ? fmtN(h.maliyet_usd)      : null,
    purchase_price:    h.purchase_price   ? fmtN(h.purchase_price)   : null,
    purchase_currency: h.purchase_currency,
    sales_price:       h.sales_price      ? fmtN(h.sales_price)      : null,
    sales_currency:    h.sales_currency,
  }));

  return {
    products: products.map(p => ({ code: p.product_code, name: p.product_name, brand: p.brand })),
    record_count: history.length,
    history,
  };
}

// ─── Main route — STREAMING ───────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  if (!supabase) return res.status(500).json({ error: 'Supabase bağlantısı yok' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY eksik' });

  const tenantId = req.tenantId;

  const { message, history = [] } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Mesaj boş olamaz' });

  // Set up SSE streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering on Railway

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const messages = [
    ...history.slice(-10),
    { role: 'user', content: message.trim() }
  ];

  try {
    let response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',  // ← Haiku: fastest model
      max_tokens: 2048,
      system:     buildSystemPrompt(),
      tools:      TOOLS,
      messages,
    });

    // Tool-use loop with PARALLEL execution
    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      send('status', { text: `${toolUseBlocks.map(b => b.name).join(', ')} sorgulanıyor...` });
      const toolResults = await executeToolsInParallel(toolUseBlocks, supabase, tenantId);

      // Execute all tools in parallel
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user',      content: toolResults });

      response = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system:     buildSystemPrompt(),
        tools:      TOOLS,
        messages,
      });
    }

    // Parse and stream final response
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

    // Stream text word by word for typing effect
    if (parsed.text) {
      const words = parsed.text.split(' ');
      for (let i = 0; i < words.length; i++) {
        send('token', { text: words[i] + (i < words.length - 1 ? ' ' : '') });
        await new Promise(r => setTimeout(r, 15)); // 15ms between words
      }
    }

    // Send structured data (charts, tables, pdfs)
    send('done', {
      charts: parsed.charts || [],
      tables: parsed.tables || [],
      pdfs:   parsed.pdfs   || [],
      assistant_message: { role: 'assistant', content: response.content }
    });

  } catch (err) {
    console.error('Chat hatası:', err.message);
    send('error', { text: err.message });
  } finally {
    res.end();
  }
});



module.exports = router;