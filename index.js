const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const app = express();
try {
  // cwd’den bağımsız: proje kökündeki .env (index.js ile aynı klasör)
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (err) {
  // Railway gibi ortamlarda env panelden verildiği için dotenv zorunlu değildir.
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
  console.warn('dotenv bulunamadı, ortam değişkenleri platformdan okunuyor.');
}

const inokasVknLoaded = !!(process.env.INOKAS_VKN || '').trim();
console.log('INOKAS_VKN:', inokasVknLoaded ? 'yüklendi ✓' : 'TANIMSIZ — .env veya ortam değişkenini kontrol edin');

// 1. ADD THIS: This allows your server to read the "Big Package" (JSON) sent from the browser
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/** Ana sayfa: static’ten ÖNCE — aksi halde GET / hiç buraya düşmez, toplu XML için VKN enjekte edilemez */
function getFaturalarIndexHtml() {
  const htmlPath = path.join(__dirname, 'public', 'index.html'); // 1) public klasöründeki index.html dosyasının tam yolunu üretir (şimdi bu dosyayı okuyacağız)
  
  let html = fs.readFileSync(htmlPath, 'utf8'); // 2) index.html içeriğini düz metin olarak RAM'e alır (response olarak bunu döneceğiz)
  
  const vkn = (process.env.INOKAS_VKN || '').trim(); // 3) Ortam değişkeninden INOKAS_VKN değerini alır; yoksa boş string kullanır
  
  const inject = `<script>window.__INOKAS_VKN__=${JSON.stringify(vkn)};</script>`; // 4) Tarayıcıya enjekte edilecek küçük script'i hazırlar: window.__INOKAS_VKN__
  
  // 5) Güvenli kontrol: </head> etiketi varsa script'i head kapanmadan hemen önce ekler
  if (html.includes('</head>')) {
    
    html = html.replace('</head>', `${inject}\n</head>`); // 6) Script enjekte edilmiş yeni HTML metnini üretir (frontend bu global değişkene buradan erişir)
  }
 
  return html; // 7) Son HTML'i route'a geri döner; app.get('/') bunu browser'a gönderir
}

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.type('html').send(getFaturalarIndexHtml());
});

// DMO sayfası (ayrı klasör) erişimi
app.use('/dmo', express.static(path.join(__dirname, 'dmo')));
app.get('/dmo', (req, res) => {
  res.redirect('/dmo/dmo.html');
});

// DMO Python API proxy (tarayıcıdan localhost:5000 bağımlılığını kaldırır)
const DMO_PY_HOST = process.env.DMO_PY_HOST || '127.0.0.1';
const DMO_PY_PORT = Number(process.env.DMO_PY_PORT || 5000);

app.post('/api/dmo/parse-pdf', (req, res) => {
  const proxyReq = http.request({
    hostname: DMO_PY_HOST,
    port: DMO_PY_PORT,
    path: '/parse-pdf',
    method: 'POST',
    headers: {
      ...req.headers,
      host: `${DMO_PY_HOST}:${DMO_PY_PORT}`
    }
  }, (proxyRes) => {
    res.status(proxyRes.statusCode || 502);
    Object.entries(proxyRes.headers || {}).forEach(([k, v]) => {
      if (v !== undefined) res.setHeader(k, v);
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('DMO parse-pdf proxy hatası:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'DMO parse servisine bağlanılamadı.' });
    }
  });

  req.pipe(proxyReq);
});

app.get('/api/dmo/usd-eur-rate', async (req, res) => {
  try {
    const r = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/usd-eur-rate`);
    const text = await r.text();
    res.status(r.status);
    res.setHeader('content-type', r.headers.get('content-type') || 'application/json; charset=utf-8');
    res.send(text);
  } catch (err) {
    console.error('DMO usd-eur-rate proxy hatası:', err.message);
    res.status(502).json({ error: 'DMO kur servisine bağlanılamadı.' });
  }
});

app.post('/api/dmo/scrape-dmo-prices', async (req, res) => {
  try {
    const r = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/scrape-dmo-prices`, {
      method: 'POST'
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('content-type', r.headers.get('content-type') || 'application/json; charset=utf-8');
    res.send(text);
  } catch (err) {
    console.error('DMO scrape proxy hatası:', err.message);
    res.status(502).json({ error: 'DMO scrape servisine bağlanılamadı.' });
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Tarayıcıların eski index.html / faturalar.js tutmasını engelle (deploy sonrası "eski kod" semptomu)
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

/** Toplu XML sınıflandırması için (VKN kamuya yakın bilgi; sadece yön tespiti) */
app.get('/api/inokas-vkn', (req, res) => {
  const vkn = (process.env.INOKAS_VKN || '').trim();
  if (!vkn) {
    return res.status(503).json({ error: 'Sunucu yapılandırması: INOKAS_VKN tanımlı değil.' });
  }
  res.json({ vkn });
});




// 2. ADD THIS: The new POST route to handle saving the full invoice
app.post('/api/save-invoice', async (req, res) => {
  try {
    const fullData = req.body; // This is the package coming from faturalar.js
    const shouldUpdateStock = fullData?.update_stock !== false;
    const inokasVkn = (process.env.INOKAS_VKN || '').trim();
    const direction = String(fullData?.invoice?.direction || '').toUpperCase();
    const submitView = String(fullData?.submit_view || '').trim();
    const parsedView = String(fullData?.parsed_view || '').trim();

    const viewToDirection = {
      gelen: 'INCOMING',
      giden: 'OUTGOING'
    };

    // Fail-closed: Beklenmeyen payload varsa kayıt yapma
    if (!['INCOMING', 'OUTGOING'].includes(direction)) {
      return res.status(400).json({ error: "Hata: Geçersiz fatura yönü." });
    }
    if (!submitView || !viewToDirection[submitView]) {
      return res.status(400).json({ error: "Hata: Geçersiz sekme bilgisi." });
    }
    if (viewToDirection[submitView] !== direction) {
      return res.status(400).json({ error: "Hata: Sekme ile fatura yönü eşleşmiyor." });
    }
    if (!parsedView || parsedView !== submitView) {
      return res.status(400).json({ error: "Hata: XML farklı sekmede parse edilmiş. Lütfen XML'i aktif sekmede tekrar yükleyin." });
    }
    if (!fullData?.xml_context) {
      return res.status(400).json({ error: "Hata: XML doğrulama bağlamı eksik." });
    }
    if (!String(fullData?.invoice?.efatura_uuid || '').trim()) {
      return res.status(400).json({ error: "Hata: XML içinde UUID bulunamadı. Bu fatura kaydedilemez." });
    }
    if (!inokasVkn) {
      return res.status(500).json({ error: "Sunucu yapılandırma hatası: INOKAS_VKN tanımlı değil." });
    }

    // Backend güvenlik kontrolü: XML bağlamı üzerinden fatura yönünü doğrula
    if (inokasVkn && fullData?.xml_context) {
      const supplierVkn = String(fullData.xml_context.supplier_vkn || '').trim();
      const customerVkn = String(fullData.xml_context.customer_vkn || '').trim();

      if (supplierVkn !== inokasVkn && customerVkn !== inokasVkn) {
        return res.status(400).json({ error: "Güvenlik hatası: Bu XML İnokas'a ait görünmüyor." });
      }
      if (direction === 'INCOMING' && customerVkn !== inokasVkn) {
        return res.status(400).json({ error: "Hata: Bu fatura 'Gelen' yönüne uygun değil." });
      }
      if (direction === 'OUTGOING' && supplierVkn !== inokasVkn) {
        return res.status(400).json({ error: "Hata: Bu fatura 'Giden' yönüne uygun değil." });
      }
    }

    // Karşı firma VKN'si sistem VKN'si ile aynı olamaz
    if (inokasVkn && String(fullData?.company?.vkn_tckn || '').trim() === inokasVkn) {
      return res.status(400).json({ error: "Hata: Karşı firma VKN'si ile İnokas VKN'si aynı olamaz." });
    }

    // --- STEP A: UPSERT COMPANY ---
    const { data: companyData, error: companyError } = await supabase
      .from('companies')
      .upsert(fullData.company, { onConflict: 'vkn_tckn' })
      .select()
      .single();

    if (companyError) throw companyError;

    // --- STEP B: INSERT INVOICE ---
    const invoiceToSave = {
      ...fullData.invoice,
      company_id: companyData.id
    };

    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
      .insert(invoiceToSave)
      .select()
      .single();

    if (invoiceError) throw invoiceError;

    // --- STEP C: INSERT ITEMS ---
    const itemsToSave = fullData.items.map(item => ({
      ...item,
      invoice_id: invoiceData.id
    }));

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(itemsToSave)
      .select('id');

    if (itemsError) throw itemsError;

    // --- STEP D: UPDATE BACKORDER (PURCHASE ORDERS) IF LINKED ---
    if (shouldUpdateStock) {
      for (const item of itemsToSave) {
        if (item.purchase_order_item_id) {
          // Increment received_qty
          // Note: Supabase doesn't have a direct "increment" via standard update without RPC,
          // but we can fetch the current value and update, or use an RPC.
          // Since we're in Node, let's fetch current and update.
          const { data: poi } = await supabase
            .from('purchase_order_items')
            .select('received_qty, purchase_order_id')
            .eq('id', item.purchase_order_item_id)
            .single();

          if (poi) {
            const newQty = Number(poi.received_qty) + Number(item.quantity);
            await supabase
              .from('purchase_order_items')
              .update({ received_qty: newQty })
              .eq('id', item.purchase_order_item_id);
            
            // Update order status to 'Kısmi Geldi' or 'Tamamlandı'
            // For simplicity, just set it to 'Kısmi Geldi' if it was 'Bekliyor'
            await supabase
              .from('purchase_orders')
              .update({ status: 'Kısmi Geldi' })
              .eq('id', poi.purchase_order_id)
              .eq('status', 'Bekliyor');
          }
        }
      }
    }

    // Stok hareketleri DB trigger'ı tarafından otomatik üretilir.

    // If everything worked, send a success message back to the browser
    res.status(200).json({ message: "Fatura başarıyla kaydedildi!" });

  } catch (err) {
    console.error("Kayıt Hatası:", err.message);
    // Supabase (PostgreSQL) hata kodunu (err.code) frontend'e yeni bir paket olarak iletiyoruz!
    res.status(500).json({ error: err.message, errorCode: err.code });
  }
});






// 3.5. GET ROUTE: Stok özetini frontend'e gönderir
// stock_movements tablosuna bağımlı değil: invoice_items + invoices join'i ile türetilir.
app.get('/api/stocks/summary', async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from('invoice_items')
      .select(`
        id,
        product_name,
        product_code,
        quantity,
        unit_price_cur,
        currency,
        invoices!invoice_items_invoice_id_fkey (
          invoice_date,
          direction,
          currency,
          calculation_rate
        )
      `);

    if (error) throw error;

    const { data: productRows, error: productErr } = await supabase
      .from('products')
      .select('id, product_code, reserved_quantity, gift_quantity');
    if (productErr) throw productErr;

    const productByCode = new Map(
      (productRows || [])
        .filter((p) => String(p.product_code || '').trim())
        .map((p) => [
          String(p.product_code || '').trim(),
          {
            id:                p.id,
            reserved_quantity: Number(p.reserved_quantity || 0),
            gift_quantity:     Number(p.gift_quantity || 0)
          }
        ])
    );

    const grouped = {};

    (items || []).forEach((item) => {
      const invoice = item.invoices;
      if (!invoice) return;

      const sku = item.product_code || null;
      const key = sku ? `SKU:${sku}` : `NAME:${item.product_name}`;

      if (!grouped[key]) {
        grouped[key] = {
          product_name: item.product_name,
          sku,
          total_in: 0,
          total_out: 0,
          current_stock: 0,
          total_in_usd: 0,
          total_out_usd: 0,
          in_qty_for_avg_usd: 0,
          out_qty_for_avg_usd: 0,
          fifo_out_cost_usd: 0,
          fifo_revenue_usd: 0,
          fifo_gross_profit_usd: 0,
          fifo_lots: [],
          events: []
        };
      }

      const qty = Number(item.quantity) || 0;
      const unitPrice = Number(item.unit_price_cur) || 0;
      // Fatura kaleminin para birimi, yoksa fatura başlığının para birimi
      const itemCurrency = String(item.currency || invoice.currency || '').toUpperCase();
      // USD fiyat yoksa TRY + calculation_rate ile USD'ye çevir.
      let unitUsd = null;
      if (unitPrice > 0) {
        if (itemCurrency === 'USD') {
          unitUsd = unitPrice;
        } else if (itemCurrency === 'TRY' && Number(invoice.calculation_rate) > 0) {
          unitUsd = unitPrice / Number(invoice.calculation_rate);
        }
      }

      grouped[key].events.push({
        id: item.id,
        qty,
        unitUsd,
        invoiceDate: item.invoices?.invoice_date || null,
        direction: invoice.direction
      });
    });

    Object.values(grouped).forEach((row) => {
      row.events.sort((a, b) => {
        const ad = String(a.invoiceDate || '');
        const bd = String(b.invoiceDate || '');
        if (ad !== bd) return ad.localeCompare(bd);
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      row.events.forEach((ev) => {
        const isIn = ev.direction === 'INCOMING';
        const isOut = ev.direction === 'OUTGOING';

        if (isIn) {
          row.total_in += ev.qty;
          if (ev.unitUsd !== null) {
            row.total_in_usd += ev.qty * ev.unitUsd;
            row.in_qty_for_avg_usd += ev.qty;
            row.fifo_lots.push({ remaining: ev.qty, unitUsd: ev.unitUsd });
          }
        }

        if (isOut) {
          row.total_out += ev.qty;
          if (ev.unitUsd !== null) {
            row.total_out_usd += ev.qty * ev.unitUsd;
            row.out_qty_for_avg_usd += ev.qty;
            row.fifo_revenue_usd += ev.qty * ev.unitUsd;
          }

          // FIFO: çıkışı en eski giriş lotlarından düş
          let qtyToConsume = ev.qty;
          let thisOutFifoCost = 0;
          while (qtyToConsume > 0 && row.fifo_lots.length > 0) {
            const lot = row.fifo_lots[0];
            const consumeQty = Math.min(qtyToConsume, lot.remaining);
            const consumeCost = consumeQty * lot.unitUsd;
            row.fifo_out_cost_usd += consumeCost;
            thisOutFifoCost += consumeCost;
            lot.remaining -= consumeQty;
            qtyToConsume -= consumeQty;
            if (lot.remaining <= 0) row.fifo_lots.shift();
          }

          // Brüt karı sadece satış USD karşılığı biliniyorsa hesapla.
          if (ev.unitUsd !== null) {
            const thisOutRevenue = ev.qty * ev.unitUsd;
            row.fifo_gross_profit_usd += (thisOutRevenue - thisOutFifoCost);
          }
        }
      });

      row.current_stock = row.total_in - row.total_out;
    });

    const summary = Object.values(grouped).map((row) => {
      const productMeta = row.sku ? productByCode.get(String(row.sku).trim()) : null;
      const avgInUnitUsd  = row.in_qty_for_avg_usd  > 0 ? (row.total_in_usd  / row.in_qty_for_avg_usd)  : null;
      const avgOutUnitUsd = row.out_qty_for_avg_usd > 0 ? (row.total_out_usd / row.out_qty_for_avg_usd) : null;
      const fifoStockUsd = row.fifo_lots.reduce((acc, lot) => acc + (Number(lot.remaining || 0) * Number(lot.unitUsd || 0)), 0);
      const stockUsd = row.in_qty_for_avg_usd > 0 ? fifoStockUsd : (row.current_stock > 0 ? null : 0);
      return {
        product_name: row.product_name,
        sku: row.sku,
        total_in: row.total_in,
        total_out: row.total_out,
        current_stock: row.current_stock,
        in_unit_usd: avgInUnitUsd,
        out_unit_usd: avgOutUnitUsd,
        stock_usd: stockUsd,
        total_out_usd: row.total_out_usd,
        fifo_cogs_usd: row.fifo_out_cost_usd,
        fifo_revenue_usd: row.fifo_revenue_usd,
        fifo_gross_profit_usd: row.fifo_gross_profit_usd,
        product_id:        productMeta?.id || null,
        reserved_quantity: Number(productMeta?.reserved_quantity || 0),
        gift_quantity:     Number(productMeta?.gift_quantity || 0)
      };
    }).sort((a, b) => {
      if (b.current_stock !== a.current_stock) return b.current_stock - a.current_stock;
      return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'tr');
    });

    const stats = summary.reduce((acc, row) => {
      acc.total_in_qty  += Number(row.total_in      || 0);
      acc.total_out_qty += Number(row.total_out     || 0);
      acc.current_qty   += Number(row.current_stock || 0);
      acc.stock_usd     += Number(row.stock_usd     || 0);
      acc.total_out_usd += Number(row.total_out_usd || 0);
      acc.fifo_cogs_usd += Number(row.fifo_cogs_usd || 0);
      acc.fifo_revenue_usd += Number(row.fifo_revenue_usd || 0);
      acc.fifo_gross_profit_usd += Number(row.fifo_gross_profit_usd || 0);
      return acc;
    }, {
      total_in_qty: 0,
      total_out_qty: 0,
      current_qty: 0,
      stock_usd: 0,
      total_out_usd: 0,
      fifo_cogs_usd: 0,
      fifo_revenue_usd: 0,
      fifo_gross_profit_usd: 0
    });

    res.status(200).json({ data: summary, stats });
  } catch (err) {
    console.error("Stok Özet Hatası:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── STOK HAREKETLERİ: invoice_items + invoices join ─────────────────────────
app.get('/api/stocks/movements', async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from('invoice_items')
      .select(`
        id,
        product_name,
        product_code,
        quantity,
        unit_price_cur,
        currency,
        invoices!invoice_items_invoice_id_fkey (
          invoice_no,
          invoice_date,
          direction,
          currency,
          companies ( name )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    const movements = (items || [])
      .filter(item => item.invoices)
      .map(item => ({
        invoice_date:   item.invoices.invoice_date,
        direction:      item.invoices.direction,
        invoice_no:     item.invoices.invoice_no,
        company_name:   item.invoices.companies?.name || '—',
        product_name:   item.product_name,
        sku:            item.product_code,
        quantity:       item.quantity,
        unit_price_cur: item.unit_price_cur,
        currency:       item.currency || item.invoices.currency,
      }));

    res.json(movements);
  } catch (err) {
    console.error('Stok Hareketleri Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── TÜM BEKLEYEN SİPARİŞLER (stok sayfası için) ─────────────────────────────
app.get('/api/companies/by-vkn', async (req, res) => {
  try {
    const vkn = String(req.query.vkn || '').trim();
    if (!vkn) return res.status(400).json({ error: 'VKN zorunlu' });
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, vkn_tckn')
      .eq('vkn_tckn', vkn)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Firma bulunamadı' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ÜRÜN DETAY: GET ──────────────────────────────────────────────────────────
app.get('/api/products/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Ürün id zorunlu.' });

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Ürün bulunamadı.' });
    res.json(data);
  } catch (err) {
    console.error('GET /api/products/:id hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── ÜRÜN GÜNCELLE: PUT ───────────────────────────────────────────────────────
app.put('/api/products/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Ürün id zorunlu.' });

    // Strip read-only fields so they can never be overwritten
    const {
      id: _id,
      created_at,
      updated_at,
      dmo_fiyat_updated,
      ...fields
    } = req.body || {};

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'Güncellenecek alan bulunamadı.' });
    }

    fields.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('products')
      .update(fields)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ message: 'Ürün güncellendi.', data });
  } catch (err) {
    console.error('PUT /api/products/:id hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/by-code', async (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Ürün kodu zorunlu' });
    const { data, error } = await supabase
      .from('products')
      .select('id, product_code, product_name')
      .eq('product_code', code)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchase-orders', async (req, res) => {
  try {
    const companyVkn = String(req.body?.company_vkn || '').trim();
    const companyName = String(req.body?.company_name || '').trim();
    const inputPoNumber = String(req.body?.po_number || '').trim();
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

    const items = rawItems
      .map((it) => ({
        product_code: String(it?.product_code || '').trim(),
        ordered_qty: Number(it?.ordered_qty || 0)
      }))
      .filter((it) => it.product_code && it.ordered_qty > 0);

    if (!companyVkn || items.length === 0) {
      return res.status(400).json({ error: 'company_vkn ve en az bir ürün satırı zorunlu.' });
    }

    // Firma bul / yoksa isim geldiyse oluştur
    let { data: company } = await supabase
      .from('companies')
      .select('id, name')
      .eq('vkn_tckn', companyVkn)
      .single();

    if (!company) {
      if (!companyName) return res.status(400).json({ error: 'Firma sistemde yok. Firma adı girin.' });
      const { data: createdCompany, error: companyInsertErr } = await supabase
        .from('companies')
        .insert({ vkn_tckn: companyVkn, name: companyName })
        .select('id, name')
        .single();
      if (companyInsertErr) throw companyInsertErr;
      company = createdCompany;
    }

    const uniqueCodes = [...new Set(items.map((x) => x.product_code))];
    const { data: products, error: productsErr } = await supabase
      .from('products')
      .select('id, product_code, product_name')
      .in('product_code', uniqueCodes);
    if (productsErr) throw productsErr;
    const productMap = new Map((products || []).map((p) => [p.product_code, p]));
    const missingCode = uniqueCodes.find((code) => !productMap.has(code));
    if (missingCode) return res.status(400).json({ error: `Ürün kodu bulunamadı: ${missingCode}` });

    const generatedPoNumber = `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-6)}`;
    const poNumber = inputPoNumber || generatedPoNumber;

    const { data: po, error: poErr } = await supabase
      .from('purchase_orders')
      .insert({
        po_number: poNumber,
        company_id: company.id,
        status: 'Bekliyor'
      })
      .select('id, po_number')
      .single();
    if (poErr) throw poErr;

    const mergedByProduct = new Map();
    items.forEach((it) => {
      if (!mergedByProduct.has(it.product_code)) {
        mergedByProduct.set(it.product_code, 0);
      }
      mergedByProduct.set(it.product_code, mergedByProduct.get(it.product_code) + it.ordered_qty);
    });

    const itemRows = Array.from(mergedByProduct.entries()).map(([productCode, qty]) => {
      const product = productMap.get(productCode);
      return {
        purchase_order_id: po.id,
        product_id: product.id,
        ordered_qty: qty,
        received_qty: 0
      };
    });

    const { error: itemErr } = await supabase
      .from('purchase_order_items')
      .insert(itemRows);
    if (itemErr) throw itemErr;

    res.status(201).json({ message: 'Backorder kaydedildi.', po_number: po.po_number, item_count: itemRows.length });
  } catch (err) {
    console.error('POST /api/purchase-orders hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/purchase-order-items/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const orderedQty = Number(req.body?.ordered_qty);
    if (!id) return res.status(400).json({ error: 'Kalem id zorunlu.' });
    if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
      return res.status(400).json({ error: 'ordered_qty pozitif sayı olmalı.' });
    }

    const { data: existing, error: findErr } = await supabase
      .from('purchase_order_items')
      .select('id, received_qty')
      .eq('id', id)
      .single();
    if (findErr || !existing) return res.status(404).json({ error: 'Sipariş kalemi bulunamadı.' });

    // Gelen miktarın altına düşmeye izin vermeyelim
    const minAllowed = Number(existing.received_qty || 0);
    if (orderedQty < minAllowed) {
      return res.status(400).json({ error: `Sipariş miktarı ${minAllowed} altına düşemez (gelen miktar).` });
    }

    const { error: updErr } = await supabase
      .from('purchase_order_items')
      .update({ ordered_qty: orderedQty })
      .eq('id', id);
    if (updErr) throw updErr;

    res.json({ message: 'Sipariş kalemi güncellendi.' });
  } catch (err) {
    console.error('PUT /api/purchase-order-items/:id hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/purchase-order-items/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Kalem id zorunlu.' });

    const { data: item, error: findErr } = await supabase
      .from('purchase_order_items')
      .select('id, purchase_order_id, received_qty')
      .eq('id', id)
      .single();
    if (findErr || !item) return res.status(404).json({ error: 'Sipariş kalemi bulunamadı.' });

    const { count: linkedInvoiceItemCount, error: linkedCountErr } = await supabase
      .from('invoice_items')
      .select('*', { count: 'exact', head: true })
      .eq('purchase_order_item_id', id);
    if (linkedCountErr) throw linkedCountErr;

    // Gerçekten bağlı fatura kalemi varsa silmeyi engelle
    if ((linkedInvoiceItemCount || 0) > 0) {
      return res.status(400).json({ error: 'Bu kaleme bağlı fatura kaydı var, önce ilgili faturayı kaldırın.' });
    }

    // Gerçek bağlantı görünmese bile kalemde gelen miktar varsa silmeyi engelle.
    // Bu durum geçmiş veri tutarsızlığı olsa dahi yanlışlıkla veri kaybını önler.
    if (Number(item.received_qty || 0) > 0) {
      return res.status(400).json({ error: 'Bu kaleme bağlı gelen miktar var, silinemez.' });
    }

    const { error: delErr } = await supabase
      .from('purchase_order_items')
      .delete()
      .eq('id', id);
    if (delErr) throw delErr;

    // Siparişte hiç kalem kalmadıysa ana siparişi de temizle
    const { count, error: countErr } = await supabase
      .from('purchase_order_items')
      .select('*', { count: 'exact', head: true })
      .eq('purchase_order_id', item.purchase_order_id);
    if (countErr) throw countErr;

    if ((count || 0) === 0) {
      await supabase
        .from('purchase_orders')
        .delete()
        .eq('id', item.purchase_order_id);
    }

    res.json({ message: 'Sipariş kalemi silindi.' });
  } catch (err) {
    console.error('DELETE /api/purchase-order-items/:id hatası:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchase-orders/all-pending', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('purchase_order_items')
      .select(`
        id,
        ordered_qty,
        received_qty,
        purchase_order_id,
        purchase_orders (
          po_number,
          order_date,
          status,
          companies ( name )
        ),
        products (
          id,
          product_code,
          product_name
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Tüm Bekleyen Siparişler Hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- BACKORDER (PURCHASE ORDERS) ENDPOINTS ---
app.get('/api/purchase-orders/pending-by-vkn', async (req, res) => {
  try {
    const { vkn } = req.query;
    if (!vkn) return res.json([]);
    
    // Önce firmayı bulalım
    const { data: company, error: companyError } = await supabase
      .from('companies')
      .select('id')
      .eq('vkn_tckn', vkn)
      .single();
      
    if (companyError || !company) {
       return res.json([]);
    }

    const { data, error } = await supabase
      .from('purchase_order_items')
      .select(`
        id,
        ordered_qty,
        received_qty,
        purchase_order_id,
        purchase_orders!inner (
          po_number,
          order_date,
          company_id
        ),
        products!inner (
          id,
          product_code,
          product_name
        )
      `)
      .eq('purchase_orders.company_id', company.id);

    if (error) throw error;

    const pendingItems = data.filter(item => Number(item.ordered_qty) > Number(item.received_qty));
    res.json(pendingItems);
  } catch (err) {
    console.error("GET /api/purchase-orders/pending-by-vkn hatası:", err);
    res.status(500).json({ error: "Bekleyen siparişler alınırken hata oluştu." });
  }
});

app.get('/api/invoices', async (req, res) => {
  try {
    // direction parametresini tarayıcıdan alıyoruz (?direction=INCOMING gibi)
    const direction = req.query.direction;

    // invoices tablosundan çekiyoruz, company_id üzerinden companies tablosuna bağlanıp firma adını alıyoruz
    let query = supabase.from('invoices')
      .select('*, companies(*), invoice_items(*)')
      .order('invoice_date', { ascending: false });

    // Sadece istenen yöndeki (gelen/giden) faturaları filtrele
    if (direction) {
      query = query.eq('direction', direction);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Bulduğumuz faturaları tarayıcıya geri yolla
    res.status(200).json(data);
  } catch (err) {
    console.error("Fatura Çekme Hatası:", err.message);
    res.status(500).json({ error: err.message });
  }
});





// 4. PUT ROUTE: Faturanın hem Meta-Data hem de (kilidi açılırsa) Resmi alanlarını günceller
app.put('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { invoice, company, items } = req.body || {};
    const shouldUpdateStock = req.body?.update_stock !== false;
    const payloadInvoice = invoice && typeof invoice === 'object' ? invoice : {};
    const payloadCompany = company && typeof company === 'object' ? company : {};
    const payloadItems = Array.isArray(items) ? items : [];

    const { data: beforeItems, error: beforeItemsError } = await supabase
      .from('invoice_items')
      .select('quantity, purchase_order_item_id')
      .eq('invoice_id', id);
    if (beforeItemsError) throw beforeItemsError;

    const { data, error } = await supabase.rpc('update_invoice_transaction', {
      p_invoice_id: id,
      p_invoice_data: payloadInvoice,
      p_company_data: payloadCompany,
      p_items_data: payloadItems
    });

    if (error) throw error;

    if (shouldUpdateStock) {
      const { data: afterItems, error: afterItemsError } = await supabase
        .from('invoice_items')
        .select('quantity, purchase_order_item_id')
        .eq('invoice_id', id);
      if (afterItemsError) throw afterItemsError;

      const sumByPo = (rows) => {
        const map = new Map();
        (rows || []).forEach((r) => {
          const poId = r.purchase_order_item_id;
          if (!poId) return;
          map.set(poId, (map.get(poId) || 0) + Number(r.quantity || 0));
        });
        return map;
      };

      const beforeMap = sumByPo(beforeItems);
      const afterMap = sumByPo(afterItems);
      const poIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);
      const touchedOrderIds = new Set();

      for (const poId of poIds) {
        const delta = (afterMap.get(poId) || 0) - (beforeMap.get(poId) || 0);
        if (delta === 0) continue;

        const { data: poi, error: poiError } = await supabase
          .from('purchase_order_items')
          .select('id, received_qty, purchase_order_id')
          .eq('id', poId)
          .single();
        if (poiError || !poi) continue;

        const newReceived = Math.max(0, Number(poi.received_qty || 0) + Number(delta));
        const { error: updatePoiError } = await supabase
          .from('purchase_order_items')
          .update({ received_qty: newReceived })
          .eq('id', poId);
        if (updatePoiError) throw updatePoiError;

        if (poi.purchase_order_id) touchedOrderIds.add(poi.purchase_order_id);
      }

      for (const orderId of touchedOrderIds) {
        const { data: orderItems, error: orderItemsError } = await supabase
          .from('purchase_order_items')
          .select('ordered_qty, received_qty')
          .eq('purchase_order_id', orderId);
        if (orderItemsError) throw orderItemsError;

        let nextStatus = 'Bekliyor';
        if ((orderItems || []).length > 0) {
          const allCompleted = orderItems.every(oi => Number(oi.received_qty || 0) >= Number(oi.ordered_qty || 0));
          const anyReceived = orderItems.some(oi => Number(oi.received_qty || 0) > 0);
          if (allCompleted) nextStatus = 'Tamamlandı';
          else if (anyReceived) nextStatus = 'Kısmi Geldi';
        }

        const { error: updateOrderStatusError } = await supabase
          .from('purchase_orders')
          .update({ status: nextStatus })
          .eq('id', orderId);
        if (updateOrderStatusError) throw updateOrderStatusError;
      }
    }

    res.json({ message: "Fatura başarıyla güncellendi", data });

  } catch (error) {
    console.error("PUT /api/invoices/:id hatası:", error);
    res.status(500).json({ error: error.message || "Sunucu hatası oluştu", errorCode: error.code });
  }
});





// DELETE ROUTE: Faturayı ve ona bağlı ürünleri veritabanından kalıcı siler
app.delete('/api/invoices/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1- Önce fatura kalemlerini çekip PO bağlantılarını geri alalım
    const { data: itemsToDelete, error: itemsFetchError } = await supabase
      .from('invoice_items')
      .select('id, quantity, purchase_order_item_id')
      .eq('invoice_id', id);
    if (itemsFetchError) throw itemsFetchError;

    const touchedOrderIds = new Set();

    for (const item of (itemsToDelete || [])) {
      if (!item.purchase_order_item_id) continue;

      const { data: poi, error: poiError } = await supabase
        .from('purchase_order_items')
        .select('id, received_qty, purchase_order_id')
        .eq('id', item.purchase_order_item_id)
        .single();
      if (poiError || !poi) continue;

      const qtyToRollback = Number(item.quantity || 0);
      const currentReceived = Number(poi.received_qty || 0);
      const newReceived = Math.max(0, currentReceived - qtyToRollback);

      const { error: poiUpdateError } = await supabase
        .from('purchase_order_items')
        .update({ received_qty: newReceived })
        .eq('id', poi.id);
      if (poiUpdateError) throw poiUpdateError;

      if (poi.purchase_order_id) touchedOrderIds.add(poi.purchase_order_id);
    }

    // 2- Faturanın içindeki ürünleri (invoice_items) sil
    const { error: itemDeleteError } = await supabase
      .from('invoice_items')
      .delete()
      .eq('invoice_id', id);
    if (itemDeleteError) throw itemDeleteError;

    // 3- Etkilenen siparişlerin durumunu yeniden hesapla
    for (const orderId of touchedOrderIds) {
      const { data: orderItems, error: orderItemsError } = await supabase
        .from('purchase_order_items')
        .select('ordered_qty, received_qty')
        .eq('purchase_order_id', orderId);
      if (orderItemsError) throw orderItemsError;

      let nextStatus = 'Bekliyor';
      if ((orderItems || []).length > 0) {
        const allCompleted = orderItems.every(oi => Number(oi.received_qty || 0) >= Number(oi.ordered_qty || 0));
        const anyReceived = orderItems.some(oi => Number(oi.received_qty || 0) > 0);
        if (allCompleted) nextStatus = 'Tamamlandı';
        else if (anyReceived) nextStatus = 'Kısmi Geldi';
      }

      const { error: orderStatusError } = await supabase
        .from('purchase_orders')
        .update({ status: nextStatus })
        .eq('id', orderId);
      if (orderStatusError) throw orderStatusError;
    }

    // 4- Sonra asıl faturayı siliyoruz
    const { error } = await supabase.from('invoices').delete().eq('id', id);

    if (error) throw error;
    res.status(200).json({ message: "Fatura başarıyla silindi" });

  } catch (error) {
    console.error("Fatura silme hatası:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu" });
  }
});













// ─── ÖDEME GEÇMİŞİ API'LERİ ──────────────────────────────────────────────────

// Dashboard için ödeme kapanış özeti: invoice_id bazında son ödeme tarihi ve toplam ödeme
app.get('/api/payments/closure-summary', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('invoice_id, amount, payment_date');
    if (error) throw error;

    const map = {};
    (data || []).forEach((p) => {
      const invoiceId = p.invoice_id;
      if (!invoiceId) return;
      const amount = Number(p.amount || 0);
      const payDate = String(p.payment_date || '');
      if (!map[invoiceId]) {
        map[invoiceId] = { total_paid: 0, last_payment_date: payDate || null };
      }
      map[invoiceId].total_paid += amount;
      if (payDate && (!map[invoiceId].last_payment_date || payDate > map[invoiceId].last_payment_date)) {
        map[invoiceId].last_payment_date = payDate;
      }
    });

    res.status(200).json(map);
  } catch (err) {
    console.error('Ödeme kapanış özeti hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bir faturanın tüm ödemelerini tarihe göre sıralı getirir
app.get('/api/invoices/:id/payments', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', id)
      .order('payment_date', { ascending: true });
    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('Ödeme listesi hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Yeni ödeme ekler, ardından faturanın paid_amount ve status'ünü yeniden hesaplar
app.post('/api/payments', async (req, res) => {
  try {
    const { invoice_id, amount, currency, payment_date, notes } = req.body;

    if (!invoice_id || !amount || !currency || !payment_date) {
      return res.status(400).json({ error: 'invoice_id, amount, currency ve payment_date zorunludur.' });
    }

    // Ödemeyi kaydet
    const { data: payment, error: insertErr } = await supabase
      .from('payments')
      .insert({ invoice_id, amount, currency, payment_date, notes: notes || null })
      .select()
      .single();
    if (insertErr) throw insertErr;

    // Faturanın ödeme toplamını ve durumunu güncelle
    const { error: rpcErr } = await supabase
      .rpc('recalculate_invoice_payment_status', { p_invoice_id: invoice_id });
    if (rpcErr) throw rpcErr;

    res.status(201).json({ message: 'Ödeme kaydedildi.', payment });
  } catch (err) {
    console.error('Ödeme ekleme hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Ödemeyi günceller (tutar, tarih, not), ardından fatura özetini yeniden hesaplar
app.put('/api/payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, currency, payment_date, notes } = req.body;

    // Güncelleme öncesi invoice_id'yi al
    const { data: existing, error: fetchErr } = await supabase
      .from('payments')
      .select('invoice_id')
      .eq('id', id)
      .single();
    if (fetchErr) throw fetchErr;

    const fields = {};
    if (amount     !== undefined) fields.amount       = amount;
    if (currency   !== undefined) fields.currency     = currency;
    if (payment_date !== undefined) fields.payment_date = payment_date;
    if (notes      !== undefined) fields.notes        = notes;

    const { error: updateErr } = await supabase
      .from('payments')
      .update(fields)
      .eq('id', id);
    if (updateErr) throw updateErr;

    // Faturanın ödeme toplamını ve durumunu güncelle
    const { error: rpcErr } = await supabase
      .rpc('recalculate_invoice_payment_status', { p_invoice_id: existing.invoice_id });
    if (rpcErr) throw rpcErr;

    res.status(200).json({ message: 'Ödeme güncellendi.' });
  } catch (err) {
    console.error('Ödeme güncelleme hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Ödeme siler, ardından faturanın paid_amount ve status'ünü yeniden hesaplar
app.delete('/api/payments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Silinmeden önce invoice_id'yi al (yeniden hesaplama için lazım)
    const { data: payment, error: fetchErr } = await supabase
      .from('payments')
      .select('invoice_id')
      .eq('id', id)
      .single();
    if (fetchErr) throw fetchErr;

    const { error: deleteErr } = await supabase
      .from('payments')
      .delete()
      .eq('id', id);
    if (deleteErr) throw deleteErr;

    // Faturanın ödeme toplamını ve durumunu güncelle
    const { error: rpcErr } = await supabase
      .rpc('recalculate_invoice_payment_status', { p_invoice_id: payment.invoice_id });
    if (rpcErr) throw rpcErr;

    res.status(200).json({ message: 'Ödeme silindi.' });
  } catch (err) {
    console.error('Ödeme silme hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
let dmoPyProcess = null;

function startDmoPythonService() {
  const shouldAutoStart = String(process.env.DMO_PY_AUTOSTART || 'true').toLowerCase() !== 'false';
  if (!shouldAutoStart) {
    console.log('DMO Python auto-start kapalı (DMO_PY_AUTOSTART=false).');
    return;
  }

  const appPyPath = path.join(__dirname, 'app.py');
  if (!fs.existsSync(appPyPath)) {
    console.warn('DMO Python servisi başlatılmadı: app.py bulunamadı.');
    return;
  }
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  dmoPyProcess = spawn(pythonCmd, [appPyPath], {
    cwd: __dirname,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  dmoPyProcess.stdout.on('data', (chunk) => {
    const msg = String(chunk || '').trim();
    if (msg) console.log(`[DMO-PY] ${msg}`);
  });

  dmoPyProcess.stderr.on('data', (chunk) => {
    const msg = String(chunk || '').trim();
    if (msg) console.warn(`[DMO-PY] ${msg}`);
  });

  dmoPyProcess.on('exit', (code, signal) => {
    console.warn(`[DMO-PY] süreç sonlandı (code=${code}, signal=${signal || '-'})`);
    dmoPyProcess = null;
  });

  console.log('DMO Python servisi başlatıldı (python3 app.py).');
}

function stopDmoPythonService() {
  if (dmoPyProcess && !dmoPyProcess.killed) {
    dmoPyProcess.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  stopDmoPythonService();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopDmoPythonService();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("Supabase URL Check:", process.env.SUPABASE_URL ? "Loaded ✅" : "Not Found ❌");
  startDmoPythonService();
});