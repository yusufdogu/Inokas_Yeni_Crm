const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const app = express();
try {
  // cwd’den bağımsız: proje kökündeki .env (index.js ile aynı klasör)
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (err) {
  // Railway gibi ortamlarda env panelden verildiği için dotenv zorunlu değildir.
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
  console.warn('dotenv bulunamadı, ortam değişkenleri platformdan okunuyor.');
}

const crypto = require('crypto');
const activeSessions = new Set();
const inokasVknLoaded = !!(process.env.INOKAS_VKN || '').trim();
console.log('INOKAS_VKN:', inokasVknLoaded ? 'yüklendi ✓' : 'TANIMSIZ — .env veya ortam değişkenini kontrol edin');

// 1. ADD THIS: This allows your server to read the "Big Package" (JSON) sent from the browser
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.set('supabase', supabase);


// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const validEmail = process.env.ADMIN_EMAIL;
  const validPassword = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    return res.status(400).json({ error: 'E-posta ve şifre zorunlu.' });
  }

  if (
    email.trim().toLowerCase() !== String(validEmail || '').trim().toLowerCase() ||
    password !== String(validPassword || '')
  ) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.add(token);
  res.json({ token });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) activeSessions.delete(token);
  res.json({ ok: true });
});


/** Ana sayfa: static’ten ÖNCE — aksi halde GET / hiç buraya düşmez, toplu XML için VKN enjekte edilemez */
function getFaturalarIndexHtml() {
  const htmlPath = path.join(__dirname, 'public', 'index.pages'); // 1) public klasöründeki dmo-index.pages dosyasının tam yolunu üretir (şimdi bu dosyayı okuyacağız)

  let html = fs.readFileSync(htmlPath, 'utf8'); // 2) dmo-index.pages içeriğini düz metin olarak RAM'e alır (response olarak bunu döneceğiz)

  const vkn = (process.env.INOKAS_VKN || '').trim(); // 3) Ortam değişkeninden INOKAS_VKN değerini alır; yoksa boş string kullanır

  const inject = `<script>window.__INOKAS_VKN__=${JSON.stringify(vkn)};</script>`; // 4) Tarayıcıya enjekte edilecek küçük script'i hazırlar: window.__INOKAS_VKN__

  // 5) Güvenli kontrol: </head> etiketi varsa script'i head kapanmadan hemen önce ekler
  if (html.includes('</head>')) {

    html = html.replace('</head>', `${inject}\n</head>`); // 6) Script enjekte edilmiş yeni HTML metnini üretir (frontend bu global değişkene buradan erişir)
  }

  return html; // 7) Son HTML'i route'a geri döner; app.get('/') bunu browser'a gönderir
}



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

async function fetchAndSaveTCMBRates() {
  try {
    const usdRegex = /CurrencyCode="USD"[\s\S]*?<ForexBuying>([\d.]+)<\/ForexBuying>/;
    const eurRegex = /CurrencyCode="EUR"[\s\S]*?<ForexBuying>([\d.]+)<\/ForexBuying>/;

    let usd_try = null;
    let eur_try = null;
    let foundDate = null;

    for (let daysBack = 0; daysBack <= 5; daysBack++) {
      const date = new Date();
      date.setDate(date.getDate() - daysBack);
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();

      const url = daysBack === 0
        ? 'https://www.tcmb.gov.tr/kurlar/today.xml'
        : `https://www.tcmb.gov.tr/kurlar/${yyyy}${mm}/${dd}${mm}${yyyy}.xml`;

      const res = await fetch(url);
      const body = await res.text();

      const usdMatch = body.match(usdRegex);
      const eurMatch = body.match(eurRegex);

      if (usdMatch && eurMatch) {
        usd_try = parseFloat(usdMatch[1]);
        eur_try = parseFloat(eurMatch[1]);
        foundDate = `${yyyy}-${mm}-${dd}`;
        console.log(`TCMB: ${foundDate} tarihli kur bulundu — USD ${usd_try} EUR ${eur_try}`);
        break;
      }

      console.log(`TCMB: ${yyyy}-${mm}-${dd} verisi yok, bir önceki güne bakılıyor...`);
    }

    if (!usd_try || !eur_try || !foundDate) {
      console.error('TCMB: Son 5 gün için kur verisi bulunamadı');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    const { data: existing } = await supabase
      .from('rate_history')
      .select('id')
      .gte('recorded_at', today + 'T00:00:00')
      .lte('recorded_at', today + 'T23:59:59')
      .maybeSingle();

    if (existing) {
      await supabase
        .from('rate_history')
        .update({ usd_try, eur_try, rate_date: foundDate })
        .eq('id', existing.id);
      console.log(`TCMB güncellendi: USD ${usd_try} EUR ${eur_try} (kur tarihi: ${foundDate})`);
    } else {
      await supabase
        .from('rate_history')
        .insert({ usd_try, eur_try, rate_date: foundDate });
      console.log(`TCMB eklendi: USD ${usd_try} EUR ${eur_try} (kur tarihi: ${foundDate})`);
    }
  } catch (err) {
    console.error('TCMB fetch hatası:', err.message);
  }
}
async function fetchAndSaveDMORate() {
  try {
    // Find product 106776's id first
    const { data: product } = await supabase
      .from('products')
      .select('id')
      .eq('dmo_code', '106776')
      .maybeSingle();

    if (!product) {
      console.error('DMO rate: 106776 ürünü bulunamadı');
      return;
    }

    // Trigger the existing Python scraper via internal proxy
    const res = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/find-dmo-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dmo_code: '106776', product_id: product.id })
    });

    const data = await res.json();

    if (!data.price) {
      console.error('DMO rate: fiyat alınamadı', data);
      return;
    }

    const dmo_eur_try = (data.price / 1.08) / 355;
    const today = new Date().toISOString().slice(0, 10);

    // Check if today's row exists
    const { data: existing } = await supabase
      .from('rate_history')
      .select('id')
      .gte('recorded_at', today + 'T00:00:00')
      .lte('recorded_at', today + 'T23:59:59')
      .maybeSingle();

    const dmo_rate_date = new Date().toISOString().slice(0, 10);

    if (existing) {
      await supabase
        .from('rate_history')
        .update({ dmo_eur_try, dmo_rate_date })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('rate_history')
        .insert({ dmo_eur_try, dmo_rate_date });
    }
    console.log(`DMO EUR/TRY güncellendi: ${dmo_eur_try} (tarih: ${dmo_rate_date})`);

  } catch (err) {
    console.error('DMO rate fetch hatası:', err.message);
  }


}

app.get('/dmo/sidebar-snippet.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'dmo', 'sidebar-snippet.pages'));
});

app.get('/cari/sidebar-snippet.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'cari', 'sidebar-snippet.pages'));
});

app.get('/api/debug-tcmb', async (req, res) => {
  try {
    const res2 = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml');
    const text = await res2.text();
    res.send(`<pre>STATUS: ${res2.status}\n\nBODY:\n${text.slice(0, 3000)}</pre>`);
  } catch (err) {
    res.send('ERROR: ' + err.message);
  }
});

app.post('/api/dmo/fetch-tcmb-now', async (req, res) => {
  await fetchAndSaveTCMBRates();
  res.json({ ok: true });
});

app.post('/api/dmo/fetch-dmo-rate-now', async (req, res) => {
  await fetchAndSaveDMORate();
  res.json({ ok: true });
});


app.get('/api/dmo/rates', async (req, res) => {
  try {
    // Get most recent row with dmo_eur_try
    const { data: dmoRow } = await supabase
      .from('rate_history')
      .select('dmo_eur_try, recorded_at')
      .not('dmo_eur_try', 'is', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get most recent row with usd_try and eur_try
    const { data: tcmbRow } = await supabase
      .from('rate_history')
      .select('usd_try, eur_try, recorded_at')
      .not('usd_try', 'is', null)
      .not('eur_try', 'is', null)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({
      usd_try: tcmbRow?.usd_try || null,
      eur_try: tcmbRow?.eur_try || null,
      dmo_eur_try: dmoRow?.dmo_eur_try || null,
      rate_date: tcmbRow?.rate_date || null,
      dmo_rate_date: dmoRow?.dmo_rate_date || null,
    });
  } catch (err) {
    console.error('rates endpoint hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});



app.post('/api/dmo/find-dmo-url', async (req, res) => {
  try {
    const r = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/find-dmo-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader('content-type', r.headers.get('content-type') || 'application/json; charset=utf-8');
    res.send(text);
  } catch (err) {
    console.error('DMO find-url proxy hatası:', err.message);
    res.status(502).json({ error: 'DMO servisine bağlanılamadı.' });
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

app.post('/api/invoices/sync-now', async (req, res) => {
  try {
    runSync(); // fire and forget — don't await, it takes too long for a request
    res.json({ ok: true, message: 'Sync started in background.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoices/recheck-now', async (req, res) => {
  try {
    runDailyRecheck(); // fire and forget
    res.json({ ok: true, message: 'Re-check started in background.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'chat.html'));
});

app.get('/login', (req, res) => res.redirect('/login.html'));

app.get('/chat', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'chat.html'));
});

app.use('/api/chat', require('./chat-router'));

app.use('/api/transcribe', require('./transcribe-router'));


app.use('/dmo', express.static(path.join(__dirname, 'dmo')));
app.get('/dmo', (req, res) => res.redirect('/dmo/dmo-index.html'));
app.get('/dmo/', (req, res) => res.redirect('/dmo/dmo-index.html'));

app.use('/cari', express.static(path.join(__dirname, 'cari')));
app.get('/cari', (req, res) => res.redirect('/cari/cari-index.html'));
app.get('/cari/', (req, res) => res.redirect('/cari/cari-index.html'));




app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
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

async function syncInvoiceItemInternalMeta(invoiceId, payloadItems) {
  const items = Array.isArray(payloadItems) ? payloadItems : [];
  if (!invoiceId || items.length === 0) return;

  const { data: dbItems, error: dbItemsErr } = await supabase
    .from('invoice_items')
    .select('id')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (dbItemsErr) throw dbItemsErr;

  const count = Math.min(dbItems?.length || 0, items.length);

  for (let i = 0; i < count; i += 1) {
    const rowId = dbItems[i]?.id;
    if (!rowId) continue;

    const src = items[i] || {};
    const isInternal = src.is_internal === true;
    const categoryRaw = String(src.internal_category || '').trim();
    const internalCategory = isInternal && categoryRaw ? categoryRaw : null;

    // Save is_internal + internal_category to invoice_items
    const { error: updErr } = await supabase
      .from('invoice_items')
      .update({
        is_internal: isInternal,
        internal_category: internalCategory,
      })
      .eq('id', rowId);
    if (updErr) throw updErr;

    // For non-internal items with a product_code, upsert to products
    if (!isInternal) {
      const productCode = String(src.product_code || '').trim();
      if (!productCode) continue;

      const brand = String(src.brand_name || '').trim() || null;
      const model = String(src.model || '').trim() || null;
      const category = String(src.product_category || src.category || '').trim() || null;
      const name = String(src.product_name || '').trim();

      // Check if product exists
      const { data: existing } = await supabase
        .from('products')
        .select('id, brand, category, model')
        .eq('product_code', productCode)
        .maybeSingle();

      if (existing) {
        // Only update fields that are being set — don't overwrite with nulls
        const updates = { updated_at: new Date().toISOString() };
        if (brand) updates.brand = brand;
        if (category) updates.category = category;
        if (model) updates.model = model;

        if (Object.keys(updates).length > 1) {
          const { error: pErr } = await supabase
            .from('products')
            .update(updates)
            .eq('product_code', productCode);
          if (pErr) console.warn('Product update hatası:', pErr.message);
        }
      } else if (name) {
        // Create new product from invoice item
        const { error: insertErr } = await supabase
          .from('products')
          .insert({
            product_code: productCode,
            product_name: name,
            brand: brand || null,
            category: category || null,
            model: model || null,
            source: 'invoice',
          });
        if (insertErr) console.warn('Product insert hatası:', insertErr.message);
      }
    }
  }
}



// 2. ADD THIS: The new POST route to handle saving the full invoice
app.post('/api/save-invoice', async (req, res) => {
  try {
    const fullData = req.body; // This is the package coming from faturalar.js
    const shouldUpdateStock = fullData?.update_stock !== false;
    const isBulkUpload = fullData?.is_bulk_upload === true;
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
      company_id: companyData.id,
      ...(isBulkUpload ? { approval_status: 'pending' } : {})
    };

    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
      .insert(invoiceToSave)
      .select()
      .single();

    if (invoiceError) throw invoiceError;

    // Tekli yüklemede: kullanıcı kategori seçtiyse, products'ta olmayan SKU'yu oluştur.
    if (!isBulkUpload) {
      const requestedRows = (Array.isArray(fullData?.items) ? fullData.items : [])
        .map((it) => ({
          product_code: String(it?.product_code || '').trim(),
          product_name: String(it?.product_name || '').trim(),
          is_internal: it?.is_internal === true,
          product_category: String(it?.product_category || '').trim()
        }))
        .filter((it) => it.product_code && !it.is_internal && it.product_category);

      const uniqueByCode = new Map();
      requestedRows.forEach((r) => {
        if (!uniqueByCode.has(r.product_code)) uniqueByCode.set(r.product_code, r);
      });
      const requested = [...uniqueByCode.values()];

      if (requested.length > 0) {
        const codes = requested.map((x) => x.product_code);
        const { data: existingProducts, error: existingErr } = await supabase
          .from('products')
          .select('product_code')
          .in('product_code', codes);
        if (existingErr) throw existingErr;
        const existingSet = new Set((existingProducts || []).map((x) => String(x.product_code || '').trim()));

        const toCreate = requested.filter((x) => !existingSet.has(x.product_code));
        if (toCreate.length > 0) {
          const { error: createErr } = await supabase
            .from('products')
            .insert(
              toCreate.map((x) => ({
                product_code: x.product_code,
                product_name: x.product_name || x.product_code,
                category: x.product_category
              }))
            );
          if (createErr) throw createErr;
        }
      }
    }

    // --- STEP C: INSERT ITEMS ---
    const itemsToSave = fullData.items.map(item => {
      const { product_category, ...dbSafeItem } = item || {};
      return {
        ...dbSafeItem,
        invoice_id: invoiceData.id
      };
    });

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(itemsToSave)
      .select('id');

    if (itemsError) throw itemsError;
    await syncInvoiceItemInternalMeta(invoiceData.id, fullData.items);

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
        .filter((p) => String(p.product_code || '').trim())
        .map((p) => [
          String(p.product_code || '').trim(),
          {
            id: p.id,
            reserved_quantity: Number(p.reserved_quantity || 0),
            gift_quantity: Number(p.gift_quantity || 0),
            brand: String(p.brand || '').trim(),
            category: String(p.category || '').trim(),
            model: String(p.model || '').trim()
          }
        ])
    );

    const grouped = {};
    const internalSkuSet = new Set();
    const nonInternalSkuSet = new Set();

    (items || []).forEach((item) => {
      if (item?.is_internal === true) return;
      if (isKargoLine(item)) return;
      const invoice = item.invoices;
      if (!invoice) return;
      if (invoice.approval_status !== 'approved') return;

      const sku = item.product_code || null;
      const key = sku ? `SKU:${sku}` : `NAME:${item.product_name}`;
      const isInternalItem = item.is_internal === true;
      if (sku) {
        if (isInternalItem) internalSkuSet.add(String(sku).trim());
        else nonInternalSkuSet.add(String(sku).trim());
      }

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
        isInternal: isInternalItem,
        invoiceDate: item.invoices?.invoice_date || null,
        direction: invoice.direction
      });
    });

    const profitEvents = [];
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
          if (!ev.isInternal && ev.unitUsd !== null) {
            const thisOutRevenue = ev.qty * ev.unitUsd;
            const thisGross = (thisOutRevenue - thisOutFifoCost);
            row.fifo_gross_profit_usd += thisGross;
            profitEvents.push({
              sku: row.sku || null,
              invoice_date: ev.invoiceDate || null,
              is_internal: true === ev.isInternal,
              gross_profit_usd: thisGross
            });
          }
        }
      });

      row.current_stock = row.total_in - row.total_out;
    });

    const summary = Object.values(grouped).map((row) => {
      const productMeta = row.sku ? productByCode.get(String(row.sku).trim()) : null;
      const avgInUnitUsd = row.in_qty_for_avg_usd > 0 ? (row.total_in_usd / row.in_qty_for_avg_usd) : null;
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
        product_id: productMeta?.id || null,
        reserved_quantity: Number(productMeta?.reserved_quantity || 0),
        gift_quantity: Number(productMeta?.gift_quantity || 0),
        brand: productMeta?.brand || '',
        category: productMeta?.category || '',
        model: productMeta?.model || ''
      };
    }).sort((a, b) => {
      if (b.current_stock !== a.current_stock) return b.current_stock - a.current_stock;
      return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'tr');
    });

    const stats = summary.reduce((acc, row) => {
      acc.total_in_qty += Number(row.total_in || 0);
      acc.total_out_qty += Number(row.total_out || 0);
      acc.current_qty += Number(row.current_stock || 0);
      acc.stock_usd += Number(row.stock_usd || 0);
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

    const productCatalog = (productRows || [])
      .map((p) => ({
        product_id: String(p.id || ''),
        sku: String(p.product_code || '').trim(),
        product_name: String(p.product_name || '').trim(),
        brand: String(p.brand || '').trim(),
        category: String(p.category || '').trim(),
        model: String(p.model || '').trim()
      }))
      .filter((p) => p.sku);

    const internalOnlySkus = [...internalSkuSet].filter((sku) => !nonInternalSkuSet.has(sku));

    res.status(200).json({
      data: summary,
      stats,
      product_catalog: productCatalog,
      profit_events: profitEvents,
      internal_only_skus: internalOnlySkus
    });
  } catch (err) {
    console.error("Stok Özet Hatası:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── STOK HAREKETLERİ: invoice_items + invoices join ─────────────────────────
app.get('/api/stocks/movements', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const skuFilter = String(req.query.sku || '').trim();
    const skuLower = skuFilter.toLowerCase();
    const approvalFilter = String(req.query.approval_status || 'approved').trim().toLowerCase();

    let query = supabase
      .from('invoices')
      .select(`
        invoice_no,
        invoice_date,
        direction,
        currency,
        approval_status,
        pdf_url,
        companies ( name ),
        invoice_items (
          id,
          product_name,
          product_code,
          quantity,
          unit_price_cur,
          currency
        )
      `)
      .order('invoice_date', { ascending: false });

    if (approvalFilter) {
      query = query.eq('approval_status', approvalFilter);
    }

    const { data: invoices, error } = await query;
    if (error) throw error;

    const movements = [];
    (invoices || []).forEach((inv) => {
      const headerCurrency = inv.currency;
      const companyName = inv.companies?.name || '—';
      const direction = String(inv.direction || '').toUpperCase();
      const approvalStatus = String(inv.approval_status || '').toLowerCase();

      (inv.invoice_items || []).forEach((item) => {
        const sku = String(item.product_code || '').trim();
        if (skuFilter && sku.toLowerCase() !== skuLower) return;

        movements.push({
          invoice_date: inv.invoice_date,
          direction,
          invoice_no: inv.invoice_no,
          company_name: companyName,
          product_name: item.product_name,
          sku,
          quantity: item.quantity,
          unit_price_cur: item.unit_price_cur,
          currency: item.currency || headerCurrency,
          approval_status: approvalStatus,
          pdf_url: inv.pdf_url || null,
        });
      });
    });

    // ─── Enrich with product metadata ────────────────────────────────────────
    const skus = [...new Set(movements.map(m => m.sku).filter(Boolean))];

    if (skus.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('product_code, brand, category, model')
        .in('product_code', skus);

      const productMap = new Map(
        (products || []).map(p => [String(p.product_code || '').trim(), p])
      );

      movements.forEach(m => {
        const p = productMap.get(m.sku);
        m.brand = p?.brand || '';
        m.category = p?.category || '';
        m.model = p?.model || '';
      });
    }

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
app.get('/api/products/:id([0-9a-fA-F-]{36})', async (req, res) => {
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
app.put('/api/products/:id([0-9a-fA-F-]{36})', async (req, res) => {
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
      .select('id, product_code, product_name, category, brand, model')
      .eq('product_code', code)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/category-map', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('product_code, category, brand, model')  // model eklendi
      .not('product_code', 'is', null);
    if (error) throw error;
    const rows = (data || []).map((r) => ({
      product_code: String(r.product_code || '').trim(),
      category: String(r.category || '').trim(),
      brand: String(r.brand || '').trim(),
      model: String(r.model || '').trim(),  // model eklendi
    })).filter((r) => r.product_code);
    const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    const brands = [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    res.json({ items: rows, categories, brands });  // rows → items
  } catch (err) {
    console.error('GET /api/products/category-map hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/codes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('product_code')
      .not('product_code', 'is', null);
    if (error) throw error;
    const codes = (data || [])
      .map((r) => String(r.product_code || '').trim())
      .filter(Boolean);
    res.json({ codes });
  } catch (err) {
    console.error('GET /api/products/codes hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// SKU products'ta yoksa hızlıca oluştur (stok ekranındaki eşleştirme akışı için)
app.post('/api/products/ensure-by-code', async (req, res) => {
  try {
    const code = String(req.body?.product_code || '').trim();
    const name = String(req.body?.product_name || '').trim();
    if (!code) return res.status(400).json({ error: 'product_code zorunlu' });

    const { data: existing, error: existingErr } = await supabase
      .from('products')
      .select('id, product_code, product_name')
      .eq('product_code', code)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return res.json({ created: false, data: existing });

    const fallbackName = name || `Ürün ${code}`;
    const { data: created, error: createErr } = await supabase
      .from('products')
      .insert({
        product_code: code,
        product_name: fallbackName
      })
      .select('id, product_code, product_name')
      .single();
    if (createErr) throw createErr;

    res.json({ created: true, data: created });
  } catch (err) {
    console.error('POST /api/products/ensure-by-code hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─── TÜM ÜRÜNLER ─────────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, product_code, product_name, brand, category, model, maliyet_usd, sozlesme_fiyat_eur, last_purchase_price_cur, last_purchase_currency, last_purchase_rate, last_purchase_price_tl, avg_purchase_price_tl, dmo_code, dmo_fiyat_try, dmo_url, gift_quantity, stock_on_hand, reserved_quantity')
      .order('product_name', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GET /api/products hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// Yeni ürün oluştur (Ürün Ekle formu)
app.post('/api/products', async (req, res) => {
  try {
    const {
      product_name, product_code, brand, category, dmo_code,
      purchase_price, purchase_currency, sales_price, sales_currency
    } = req.body || {};

    if (!product_name || !String(product_name).trim()) return res.status(400).json({ error: 'Ürün adı zorunlu' });
    if (!product_code || !String(product_code).trim()) return res.status(400).json({ error: 'Ürün kodu zorunlu' });

    const code = String(product_code).trim();

    const { data: existing, error: existingErr } = await supabase
      .from('products')
      .select('id, product_code')
      .eq('product_code', code)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return res.status(409).json({ error: `"${code}" kodlu ürün zaten mevcut` });

    const insertPayload = {
      product_code: code,
      product_name: String(product_name).trim(),
    };
    if (brand) insertPayload.brand = String(brand).trim();
    if (category) insertPayload.category = String(category).trim();
    if (dmo_code) insertPayload.dmo_code = String(dmo_code).trim();

    const { data: created, error: createErr } = await supabase
      .from('products')
      .insert(insertPayload)
      .select('id, product_code, product_name')
      .single();
    if (createErr) throw createErr;

    const pricePayload = { product_id: created.id };
    if (purchase_price != null && purchase_price !== '') pricePayload.purchase_price = parseFloat(purchase_price);
    if (purchase_currency) pricePayload.purchase_currency = String(purchase_currency).trim();
    if (sales_price != null && sales_price !== '') pricePayload.sales_price = parseFloat(sales_price);
    if (sales_currency) pricePayload.sales_currency = String(sales_currency).trim();

    if (Object.keys(pricePayload).length > 1) {
      const { error: priceErr } = await supabase
        .from('product_price_history')
        .insert(pricePayload);
      if (priceErr) console.warn('product_price_history insert hatası:', priceErr.message);
    }

    res.json({ created: true, data: created });
  } catch (err) {
    console.error('POST /api/products hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchase-orders', async (req, res) => {
  try {
    const companyVkn = String(req.body?.company_vkn || '').trim();
    const companyName = String(req.body?.company_name || '').trim();
    const inputPoNumber = String(req.body?.po_number || '').trim();
    const forceCreate = req.body?.force_create === true;
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

    const items = rawItems
      .map((it) => ({
        product_code: String(it?.product_code || '').trim(),
        product_name: String(it?.product_name || '').trim(),
        brand: String(it?.brand || '').trim() || null,
        category: String(it?.category || '').trim() || null,
        ordered_qty: Number(it?.ordered_qty || 0),
        unit_price_cur: it?.unit_price_cur === null || it?.unit_price_cur === undefined || it?.unit_price_cur === ''
          ? null : Number(it?.unit_price_cur),
        currency: String(it?.currency || '').trim() || null,
        line_total_cur: it?.line_total_cur === null || it?.line_total_cur === undefined || it?.line_total_cur === ''
          ? null : Number(it?.line_total_cur)
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

    const missingCodes = uniqueCodes.filter((code) => !productMap.has(code));
    if (missingCodes.length > 0 && !forceCreate) {
      return res.status(400).json({
        error: `Ürün kodu bulunamadı: ${missingCodes.join(', ')}`,
        missing_codes: missingCodes
      });
    }

    // force_create: eksik ürünleri products tablosuna ekle
    if (missingCodes.length > 0 && forceCreate) {
      const itemsByCode = new Map(items.map((it) => [it.product_code, it]));
      for (const code of missingCodes) {
        const it = itemsByCode.get(code);
        const { data: newProduct, error: insertErr } = await supabase
          .from('products')
          .insert({
            product_code: code,
            product_name: it?.product_name || code,
            brand: it?.brand || null,
            category: it?.category || null,
          })
          .select('id, product_code, product_name')
          .single();
        if (insertErr) throw insertErr;
        productMap.set(code, newProduct);
      }
    }

    const sourceCompanyName = String(company?.name || companyName || '').trim();
    const firstWord = sourceCompanyName.split(/\s+/).find(Boolean) || 'FIRMA';
    const normalizedFirstWord = firstWord
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '')
      .toLocaleUpperCase('tr-TR') || 'FIRMA';
    const poPrefix = `PO-${normalizedFirstWord}`;
    const { data: existingPoRows, error: poFetchErr } = await supabase
      .from('purchase_orders')
      .select('po_number')
      .ilike('po_number', `${poPrefix}-%`);
    if (poFetchErr) throw poFetchErr;
    const maxSeq = (existingPoRows || []).reduce((max, row) => {
      const no = String(row?.po_number || '');
      const m = no.match(new RegExp(`^${poPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-([0-9]+)$`));
      const n = m ? Number(m[1]) : 0;
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    const generatedPoNumber = `${poPrefix}-${maxSeq + 1}`;
    const poNumber = inputPoNumber || generatedPoNumber;

    let po = null;
    let poErr = null;
    let attemptSeq = maxSeq + 1;
    const maxAttempts = inputPoNumber ? 1 : 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const attemptPoNumber = inputPoNumber || `${poPrefix}-${attemptSeq}`;
      const result = await supabase
        .from('purchase_orders')
        .insert({
          po_number: attemptPoNumber,
          company_id: company.id,
          status: 'Bekliyor'
        })
        .select('id, po_number')
        .single();
      po = result.data;
      poErr = result.error;
      if (!poErr) break;
      // unique ihlali ise bir sonraki sıra ile tekrar dene
      if (!inputPoNumber && String(poErr.code || '') === '23505') {
        attemptSeq += 1;
        continue;
      }
      throw poErr;
    }
    if (poErr) throw poErr;

    const mergedByProduct = new Map();
    items.forEach((it) => {
      if (!mergedByProduct.has(it.product_code)) {
        mergedByProduct.set(it.product_code, {
          ordered_qty: 0,
          line_total_cur: 0,
          currency: null
        });
      }
      const row = mergedByProduct.get(it.product_code);
      row.ordered_qty += Number(it.ordered_qty || 0);
      row.line_total_cur += Number(
        it.line_total_cur !== null && it.line_total_cur !== undefined
          ? it.line_total_cur
          : (it.unit_price_cur !== null && it.unit_price_cur !== undefined ? Number(it.ordered_qty || 0) * Number(it.unit_price_cur || 0) : 0)
      );
      if (!row.currency && it.currency) row.currency = it.currency;
      mergedByProduct.set(it.product_code, row);
    });

    const itemRows = Array.from(mergedByProduct.entries()).map(([productCode, row]) => {
      const product = productMap.get(productCode);
      const qty = Number(row.ordered_qty || 0);
      const lineTotal = row.line_total_cur > 0 ? Number(row.line_total_cur.toFixed(4)) : null;
      const unitPrice = lineTotal !== null && qty > 0 ? Number((lineTotal / qty).toFixed(4)) : null;
      return {
        purchase_order_id: po.id,
        product_id: product.id,
        ordered_qty: qty,
        received_qty: 0,
        unit_price_cur: unitPrice,
        currency: row.currency,
        line_total_cur: lineTotal
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
    const unitPriceRaw = req.body?.unit_price_cur;
    const lineTotalRaw = req.body?.line_total_cur;
    const currencyRaw = req.body?.currency;
    const unitPrice = unitPriceRaw === null || unitPriceRaw === undefined || unitPriceRaw === '' ? null : Number(unitPriceRaw);
    const lineTotal = lineTotalRaw === null || lineTotalRaw === undefined || lineTotalRaw === '' ? null : Number(lineTotalRaw);
    const currency = currencyRaw === null || currencyRaw === undefined || String(currencyRaw).trim() === ''
      ? null
      : String(currencyRaw).trim().toUpperCase();
    if (!id) return res.status(400).json({ error: 'Kalem id zorunlu.' });
    if (!Number.isFinite(orderedQty) || orderedQty <= 0) {
      return res.status(400).json({ error: 'ordered_qty pozitif sayı olmalı.' });
    }
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      return res.status(400).json({ error: 'unit_price_cur negatif olamaz.' });
    }
    if (lineTotal !== null && (!Number.isFinite(lineTotal) || lineTotal < 0)) {
      return res.status(400).json({ error: 'line_total_cur negatif olamaz.' });
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
      .update({
        ordered_qty: orderedQty,
        unit_price_cur: unitPrice,
        currency,
        line_total_cur: lineTotal
      })
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
        unit_price_cur,
        currency,
        line_total_cur,
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
          product_name,
          brand,
          category,
          model
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
        unit_price_cur,
        currency,
        line_total_cur,
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
    const companyId = req.query.company_id;

    // invoices tablosundan çekiyoruz, company_id üzerinden companies tablosuna bağlanıp firma adını alıyoruz
    let query = supabase.from('invoices')
      .select('*, companies(*), invoice_items(*)')
      .order('invoice_date', { ascending: false });

    // Sadece istenen yöndeki (gelen/giden) faturaları filtrele
    if (direction) {
      query = query.eq('direction', direction);
    }

    // Belirli bir firmaya ait faturaları filtrele
    if (companyId) {
      query = query.eq('company_id', companyId);
    }

    // Bekleyen (pending) faturalar bu listede görünmemeli
    query = query.or('approval_status.neq.pending,approval_status.is.null');

    const { data, error } = await query;
    if (error) throw error;

    // Mükerrer invoice_items satırlarını temizle: aynı fatura içinde (product_name, quantity,
    // unit_price_cur) üçlüsü aynıysa ilk kaydı tut, diğerlerini at.
    // ─── Enrich invoice_items with product metadata ───────────────────────────
    if (Array.isArray(data)) {
      const skus = [...new Set(
        data.flatMap(inv => (inv.invoice_items || [])
          .map(it => String(it.product_code || '').trim())
          .filter(Boolean)
        )
      )];

      if (skus.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('product_code, brand, category, model')
          .in('product_code', skus);

        const productMap = new Map(
          (products || []).map(p => [String(p.product_code || '').trim(), p])
        );

        data.forEach(inv => {
          (inv.invoice_items || []).forEach(item => {
            const p = productMap.get(String(item.product_code || '').trim());
            item.brand = p?.brand || '';
            item.category = p?.category || '';
            item.model = p?.model || '';
          });
        });
      }
    }

    // Tüm kalemleri ofis-içi olan faturaları alışlar/satışlar listesinden çıkar
    let result = data;
    if (direction && Array.isArray(data)) {
      result = data.filter(inv => {
        const items = inv.invoice_items || [];
        if (!items.length) return true;
        return items.some(it => !it.is_internal);
      });
    }

    // Bulduğumuz faturaları tarayıcıya geri yolla
    res.status(200).json(result);
  } catch (err) {
    console.error("Fatura Çekme Hatası:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// invoice_items SKU toplu normalizasyonu (UI'dan manuel birleştirme)
app.post('/api/invoice-items/normalize-sku', async (req, res) => {
  try {
    const fromCode = String(req.body?.from_code || '').trim();
    const toCode = String(req.body?.to_code || '').trim();
    if (!fromCode || !toCode) {
      return res.status(400).json({ error: 'from_code ve to_code zorunludur.' });
    }
    if (fromCode === toCode) {
      return res.status(400).json({ error: 'Eski ve yeni kod aynı olamaz.' });
    }

    const { data: rows, error: selectError } = await supabase
      .from('invoice_items')
      .select('id')
      .eq('product_code', fromCode);
    if (selectError) throw selectError;
    const ids = (rows || []).map((r) => r.id).filter(Boolean);

    if (!ids.length) {
      return res.json({ message: 'Güncellenecek satır bulunamadı.', updated_rows: 0 });
    }

    const { error: updateError } = await supabase
      .from('invoice_items')
      .update({ product_code: toCode })
      .in('id', ids);
    if (updateError) throw updateError;

    res.json({
      message: 'SKU normalizasyonu tamamlandı.',
      from_code: fromCode,
      to_code: toCode,
      updated_rows: ids.length
    });
  } catch (err) {
    console.error('POST /api/invoice-items/normalize-sku hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});



// ─── ADD THIS TO index.js ────────────────────────────────────────────────────
// Place it BEFORE the existing PUT /api/invoices/:id route (around line 1590)
// and AFTER the GET /api/invoices route.


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

    // Mevcut kalemleri sil: update_invoice_transaction RPC eski kalemleri silmeyip üstüne
    // insert ederse mükerrer satır oluşur. Explicit DELETE ile temiz slate garantisi.
    const { error: deleteItemsError } = await supabase
      .from('invoice_items')
      .delete()
      .eq('invoice_id', id);
    if (deleteItemsError) throw deleteItemsError;

    const { data, error } = await supabase.rpc('update_invoice_transaction', {
      p_invoice_id: id,
      p_invoice_data: payloadInvoice,
      p_company_data: payloadCompany,
      p_items_data: payloadItems
    });

    if (error) throw error;
    await syncInvoiceItemInternalMeta(id, payloadItems);

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

// Bekleyen (pending) faturaları getir
app.get('/api/invoices/pending', async (req, res) => {
  try {
    const direction = req.query.direction;
    let query = supabase.from('invoices')
      .select('*, companies(*), invoice_items(*)')
      .eq('approval_status', 'pending')
      .order('invoice_date', { ascending: false });

    if (direction) query = query.eq('direction', direction);

    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('Pending fatura çekme hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/invoices/ofis-ici', async (req, res) => {
  try {
    const { data: items, error: itemsErr } = await supabase
      .from('invoice_items')
      .select('invoice_id')
      .eq('is_internal', true);

    if (itemsErr) throw itemsErr;

    const invoiceIds = [...new Set((items || []).map(it => it.invoice_id).filter(Boolean))];
    if (!invoiceIds.length) return res.status(200).json([]);

    const { data, error } = await supabase
      .from('invoices')
      .select('*, companies(*), invoice_items(*)')
      .in('id', invoiceIds)
      .or('approval_status.eq.approved,approval_status.is.null')
      .order('invoice_date', { ascending: false });

    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error('Ofis içi fatura çekme hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});



app.get('/api/invoices/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Fatura ID zorunlu.' });

    const { data, error } = await supabase
      .from('invoices')
      .select('*, companies(*), invoice_items(*)')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Fatura bulunamadı.' });

    // Enrich invoice_items with product metadata
    if (Array.isArray(data.invoice_items) && data.invoice_items.length > 0) {
      const skus = [...new Set(
        data.invoice_items
          .map(it => String(it.product_code || '').trim())
          .filter(Boolean)
      )];

      if (skus.length > 0) {
        const { data: products } = await supabase
          .from('products')
          .select('product_code, brand, category, model')
          .in('product_code', skus);

        const productMap = new Map(
          (products || []).map(p => [String(p.product_code || '').trim(), p])
        );

        data.invoice_items.forEach(item => {
          const p = productMap.get(String(item.product_code || '').trim());
          item.brand = p?.brand || '';
          item.category = p?.category || '';
          item.model = p?.model || '';
        });
      }
    }

    res.json(data);
  } catch (err) {
    console.error('GET /api/invoices/:id hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bekleyen faturayı onayla (sisteme aktar)
app.put('/api/invoices/:id/approve', async (req, res) => {
  try {
    const id = req.params.id;
    const { error } = await supabase
      .from('invoices')
      .update({ approval_status: 'approved' })
      .eq('id', id);
    if (error) throw error;
    res.status(200).json({ message: 'Fatura onaylandı' });
  } catch (err) {
    console.error('Fatura onaylama hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});













// ─── CARİ ANALİZ API'LERİ ────────────────────────────────────────────────────

app.get('/api/cari/dashboard', async (req, res) => {
  try {
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('*, companies(name)')
      .or('approval_status.neq.pending,approval_status.is.null');
    if (error) throw error;

    const list = invoices || [];

    // ── helpers ──────────────────────────────────────────────────────────────
    function getIso(inv) {
      const raw = String(inv.base_currency || inv.currency || 'TRY').trim().toUpperCase();
      return raw === 'TL' ? 'TRY' : raw || 'TRY';
    }
    function getRate(inv) {
      const r = parseFloat(inv.calculation_rate ?? inv.exchange_rate);
      return Number.isFinite(r) && r > 0 ? r : 1;
    }
    function getPayableTl(inv) {
      return parseFloat(inv.payable_amount_tl) || 0;
    }
    function getPayableSrc(inv) {
      const c = parseFloat(inv.payable_amount_cur);
      if (Number.isFinite(c) && c >= 0) return c;
      return getPayableTl(inv) / getRate(inv);
    }
    function getPaidSrc(inv) {
      const cur = parseFloat(inv.paid_amount_cur);
      if (Number.isFinite(cur) && cur > 0) return cur;
      const tl = parseFloat(inv.paid_amount) || 0;
      return tl / getRate(inv);
    }
    function getPayableTlActual(inv) {
      const tl = getPayableTl(inv);
      if (tl > 0) return tl;
      return getPayableSrc(inv) * getRate(inv);
    }
    function getPaidTl(inv) {
      const cur = parseFloat(inv.paid_amount_cur);
      if (Number.isFinite(cur) && cur > 0) return cur * getRate(inv);
      return parseFloat(inv.paid_amount) || 0;
    }

    // ── KPI: alacak (OUTGOING receivable), odenecek (INCOMING payable) ──────
    const kpis = {
      alacak: { usd: 0, tl: 0 },
      odenecek: { usd: 0, tl: 0 },
      odenen: { usd: 0, tl: 0 }
    };

    list.forEach(inv => {
      const iso = getIso(inv);
      const payable = getPayableSrc(inv);
      const paid = Math.min(getPaidSrc(inv), payable);
      const payableTl = getPayableTlActual(inv);
      const paidTl = Math.min(getPaidTl(inv), payableTl);
      const remaining = Math.max(payable - paid, 0);
      const remainingTl = Math.max(payableTl - paidTl, 0);

      if (inv.direction === 'OUTGOING') {
        if (iso === 'USD') { kpis.alacak.usd += remaining; }
        else { kpis.alacak.tl += remainingTl; }
      } else if (inv.direction === 'INCOMING') {
        if (iso === 'USD') { kpis.odenecek.usd += remaining; kpis.odenen.usd += paid; }
        else { kpis.odenecek.tl += remainingTl; kpis.odenen.tl += paidTl; }
      }
    });

    // ── FİRMA BAZINDA CARİ TABLO ──────────────────────────────────────────────
    // Her firma için: ödenecek, ödenen, kalan — USD ve TL ayrı
    const firmaMap = {};
    list.forEach(inv => {
      const name = inv.companies?.name || 'Bilinmiyor';
      if (!firmaMap[name]) firmaMap[name] = {
        company_name: name,
        company_id: inv.company_id || null,
        has_incoming: false,
        has_outgoing: false,
        odenecek_usd: 0, odenecek_tl: 0,  // INCOMING: borcumuz
        odenen_usd: 0, odened_tl: 0,  // INCOMING: ödediğimiz
        alacak_usd: 0, alacak_tl: 0,  // OUTGOING: alacağımız (kalan)
        ciro_usd: 0, ciro_tl: 0,  // OUTGOING: toplam ciro
      };
      const f = firmaMap[name];
      const iso = getIso(inv);
      const payable = getPayableSrc(inv);
      const paid = Math.min(getPaidSrc(inv), payable);
      const payableTl = getPayableTlActual(inv);
      const paidTl = Math.min(getPaidTl(inv), payableTl);

      if (inv.direction === 'INCOMING') {
        f.has_incoming = true;
        if (iso === 'USD') { f.odenecek_usd += payable; f.odened_usd = (f.odened_usd || 0) + paid; }
        else { f.odenecek_tl += payableTl; f.odened_tl = (f.odened_tl || 0) + paidTl; }
      } else if (inv.direction === 'OUTGOING') {
        f.has_outgoing = true;
        if (iso === 'USD') { f.ciro_usd += payable; f.alacak_usd += Math.max(payable - paid, 0); }
        else { f.ciro_tl += payableTl; f.alacak_tl += Math.max(payableTl - paidTl, 0); }
      }
    });

    const firmalar = Object.values(firmaMap).map(f => {
      const type = f.has_incoming && f.has_outgoing ? 'İkisi de'
        : f.has_incoming ? 'Tedarikçi'
          : 'Müşteri';
      const odenen_usd = f.odened_usd || 0;
      const odened_tl = f.odened_tl || 0;
      return {
        company_name: f.company_name,
        company_id: f.company_id,
        type,
        // Tedarikçi tarafı
        odenecek_usd: f.odenecek_usd,
        odenecek_tl: f.odenecek_tl,
        odenen_usd,
        odenen_tl: odened_tl,
        kalan_usd: Math.max(f.odenecek_usd - odenen_usd, 0),
        kalan_tl: Math.max(f.odenecek_tl - odened_tl, 0),
        // Müşteri tarafı — alacak (kalan)
        alacak_usd: f.alacak_usd,
        alacak_tl: f.alacak_tl,
        ciro_usd: f.ciro_usd,
        ciro_tl: f.ciro_tl,
        // sort key
        _sort: f.odenecek_usd * 35 + f.odenecek_tl + f.ciro_usd * 35 + f.ciro_tl
      };
    }).sort((a, b) => b._sort - a._sort);

    res.json({ kpis, firmalar });
  } catch (err) {
    console.error('GET /api/cari/dashboard hatası:', err.message);
    res.status(500).json({ error: err.message });
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
    if (amount !== undefined) fields.amount = amount;
    if (currency !== undefined) fields.currency = currency;
    if (payment_date !== undefined) fields.payment_date = payment_date;
    if (notes !== undefined) fields.notes = notes;

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

// GET /api/product-attribute-values?category=X — kategori bazlı toplu özellik değerleri
app.get('/api/product-attribute-values', async (req, res) => {
  try {
    const { category } = req.query;

    const { data: template, error: tErr } = await supabase
      .from('category_templates')
      .select('id, name, category_attributes(id, attr_name, attr_type, attr_values, sort_order)')
      .eq('name', category)
      .maybeSingle();
    if (tErr) throw tErr;

    if (!template) return res.json({ template: null, values: [] });

    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('id')
      .eq('category', category);
    if (pErr) throw pErr;

    const productIds = (products || []).map(p => p.id);

    let values = [];
    if (productIds.length) {
      const { data: vals, error: vErr } = await supabase
        .from('product_attribute_values')
        .select('product_id, attribute_id, value')
        .in('product_id', productIds);
      if (vErr) throw vErr;
      values = vals || [];
    }

    res.json({
      template: { id: template.id, name: template.name, attributes: template.category_attributes || [] },
      values
    });
  } catch (err) {
    console.error('product-attribute-values hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── KATEGORİ ŞABLONLARI ───────────────────────────────────────────────────────

// 1. GET /api/category-templates — tüm kategoriler ve özellikleri
app.get('/api/category-templates', async (req, res) => {
  try {
    const { data: templates, error: tErr } = await supabase
      .from('category_templates')
      .select('id, name, created_at')
      .order('name');
    if (tErr) throw tErr;

    const { data: attributes, error: aErr } = await supabase
      .from('category_attributes')
      .select('id, category_id, attr_name, attr_type, attr_values, sort_order')
      .order('sort_order');
    if (aErr) throw aErr;

    const result = templates.map(t => ({
      ...t,
      attributes: attributes.filter(a => a.category_id === t.id)
    }));

    res.json(result);
  } catch (err) {
    console.error('category-templates fetch hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 8. PUT /api/products/:id/attributes — ürünün özellik değerlerini kaydet (upsert)
app.put('/api/products/:id/attributes', async (req, res) => {
  try {
    const { id } = req.params;
    const { attributes } = req.body; // [{ attribute_id, value }]
    if (!Array.isArray(attributes)) return res.status(400).json({ error: 'attributes dizisi zorunlu.' });

    const rows = attributes
      .filter(a => a.attribute_id != null)
      .map(a => ({ product_id: id, attribute_id: a.attribute_id, value: a.value ?? null }));

    if (rows.length) {
      const { error } = await supabase
        .from('product_attribute_values')
        .upsert(rows, { onConflict: 'product_id,attribute_id' });
      if (error) throw error;
    }

    res.json({ message: 'Özellikler kaydedildi.' });
  } catch (err) {
    console.error('product attributes upsert hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /api/products/:id/attributes — ürünün özellik değerlerini getir
app.get('/api/products/:id/attributes', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: product, error: pErr } = await supabase
      .from('products')
      .select('id, category')
      .eq('id', id)
      .single();
    if (pErr) throw pErr;

    const { data: template, error: tErr } = await supabase
      .from('category_templates')
      .select('id, name, category_attributes(id, attr_name, attr_type, attr_values, sort_order)')
      .eq('name', product.category)
      .maybeSingle();
    if (tErr) throw tErr;

    const { data: values, error: vErr } = await supabase
      .from('product_attribute_values')
      .select('attribute_id, value')
      .eq('product_id', id);
    if (vErr) throw vErr;

    const valueMap = {};
    (values || []).forEach(v => { valueMap[v.attribute_id] = v.value; });

    const attributes = (template?.category_attributes || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(a => ({ ...a, value: valueMap[a.id] ?? null }));

    res.json({ category_template: template ? { id: template.id, name: template.name } : null, attributes });
  } catch (err) {
    console.error('product attributes fetch hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 6. DELETE /api/category-attributes/:id — özelliği sil
app.delete('/api/category-attributes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('category_attributes')
      .delete()
      .eq('id', id);
    if (error) throw error;

    res.json({ message: 'Özellik silindi.' });
  } catch (err) {
    console.error('category-attributes delete hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5. PUT /api/category-attributes/:id — özelliği güncelle
app.put('/api/category-attributes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { attr_name, attr_type, attr_values, sort_order } = req.body;

    const updates = {};
    if (attr_name !== undefined) updates.attr_name = attr_name.trim();
    if (attr_type !== undefined) {
      if (!['text', 'number', 'select'].includes(attr_type)) return res.status(400).json({ error: 'attr_type text | number | select olmalı.' });
      updates.attr_type = attr_type;
    }
    if (attr_values !== undefined) updates.attr_values = attr_values;
    if (sort_order !== undefined) updates.sort_order = sort_order;

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Güncellenecek alan yok.' });

    const { data, error } = await supabase
      .from('category_attributes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('category-attributes update hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /api/category-templates/:id/attributes — kategoriye yeni özellik ekle
app.post('/api/category-templates/:id/attributes', async (req, res) => {
  try {
    const { id } = req.params;
    const { attr_name, attr_type, attr_values, sort_order } = req.body;
    if (!attr_name || !attr_name.trim()) return res.status(400).json({ error: 'Özellik adı zorunlu.' });
    if (!['text', 'number', 'select'].includes(attr_type)) return res.status(400).json({ error: 'attr_type text | number | select olmalı.' });

    const { data, error } = await supabase
      .from('category_attributes')
      .insert({
        category_id: id,
        attr_name: attr_name.trim(),
        attr_type,
        attr_values: attr_values || null,
        sort_order: sort_order ?? 0
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error('category-attributes insert hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. PUT /api/category-templates/:id — kategori adını güncelle
app.put('/api/category-templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Kategori adı zorunlu.' });

    const { data, error } = await supabase
      .from('category_templates')
      .update({ name: name.trim() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('category-templates update hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. POST /api/category-templates — yeni kategori oluştur
app.post('/api/category-templates', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Kategori adı zorunlu.' });

    const { data, error } = await supabase
      .from('category_templates')
      .insert({ name: name.trim() })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({ ...data, attributes: [] });
  } catch (err) {
    console.error('category-templates insert hatası:', err.message);
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


// 08:00 every day — fetch DMO EUR rate (Turkey timezone = UTC+3, so 05:00 UTC)
cron.schedule('0 5 * * *', () => {
  console.log('Cron: DMO EUR rate fetching...');
  fetchAndSaveDMORate();
});

// 15:40 every day — fetch TCMB USD/EUR rates (15:40 Turkey = 12:40 UTC)
cron.schedule('40 12 * * *', () => {
  console.log('Cron: TCMB rates fetching...');
  fetchAndSaveTCMBRates();
});
const { runSync, runDailyRecheck } = require('./services/sync-service');

// Every hour — fetch new invoices (auto-detects initial vs incremental)
cron.schedule('*/10 * * * *', async () => {
  console.log('Cron: Invoice sync starting...');
  try {
    await runSync();
  } catch (err) {
    console.error('Cron: Invoice sync failed:', err.message);
  }
});

// Every day at 06:00 Turkey time (03:00 UTC) — re-check pending/waiting invoices
cron.schedule('0 3 * * *', async () => {
  console.log('Cron: Daily invoice re-check starting...');
  try {
    await runDailyRecheck();
  } catch (err) {
    console.error('Cron: Daily re-check failed:', err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("Supabase URL Check:", process.env.SUPABASE_URL ? "Loaded ✅" : "Not Found ❌");
  startDmoPythonService();
});