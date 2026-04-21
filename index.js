const express = require('express');
const fs = require('fs');
const path = require('path');
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
  process.env.SUPABASE_ANON_KEY
);

/** Ana sayfa: static’ten ÖNCE — aksi halde GET / hiç buraya düşmez, toplu XML için VKN enjekte edilemez */
function getFaturalarIndexHtml() {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const vkn = (process.env.INOKAS_VKN || '').trim();
  const inject = `<script>window.__INOKAS_VKN__=${JSON.stringify(vkn)};</script>`;
  if (html.includes('</head>')) {
    html = html.replace('</head>', `${inject}\n</head>`);
  }
  return html;
}

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.type('html').send(getFaturalarIndexHtml());
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
          direction,
          currency,
          calculation_rate
        )
      `);

    if (error) throw error;

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
        };
      }

      const qty = Number(item.quantity) || 0;
      const unitPrice = Number(item.unit_price_cur) || 0;
      // Fatura kaleminin para birimi, yoksa fatura başlığının para birimi
      const itemCurrency = String(item.currency || invoice.currency || '').toUpperCase();

      // Sadece USD kabul ediyoruz (kullanıcı tercihi: stok USD bazlı)
      const unitUsd = (itemCurrency === 'USD' && unitPrice > 0) ? unitPrice : null;

      const isIn  = invoice.direction === 'INCOMING';
      const isOut = invoice.direction === 'OUTGOING';

      if (isIn) {
        grouped[key].total_in += qty;
        if (unitUsd !== null) {
          grouped[key].total_in_usd    += qty * unitUsd;
          grouped[key].in_qty_for_avg_usd += qty;
        }
      }
      if (isOut) {
        grouped[key].total_out += qty;
        if (unitUsd !== null) {
          grouped[key].total_out_usd    += qty * unitUsd;
          grouped[key].out_qty_for_avg_usd += qty;
        }
      }

      grouped[key].current_stock = grouped[key].total_in - grouped[key].total_out;
    });

    const summary = Object.values(grouped).map((row) => {
      const avgInUnitUsd  = row.in_qty_for_avg_usd  > 0 ? (row.total_in_usd  / row.in_qty_for_avg_usd)  : null;
      const avgOutUnitUsd = row.out_qty_for_avg_usd > 0 ? (row.total_out_usd / row.out_qty_for_avg_usd) : null;
      const stockUsd = avgInUnitUsd !== null ? row.current_stock * avgInUnitUsd : null;
      return {
        product_name: row.product_name,
        sku: row.sku,
        total_in: row.total_in,
        total_out: row.total_out,
        current_stock: row.current_stock,
        in_unit_usd: avgInUnitUsd,
        out_unit_usd: avgOutUnitUsd,
        stock_usd: stockUsd,
        total_out_usd: row.total_out_usd
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
      return acc;
    }, { total_in_qty: 0, total_out_qty: 0, current_qty: 0, stock_usd: 0, total_out_usd: 0 });

    res.status(200).json({ data: summary, stats });
  } catch (err) {
    console.error("Stok Özet Hatası:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. GET ROUTE: Faturaları veritabanından çekip UI'a gönderen yeni kapımız
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
    const payloadInvoice = invoice && typeof invoice === 'object' ? invoice : {};
    const payloadCompany = company && typeof company === 'object' ? company : {};
    const payloadItems = Array.isArray(items) ? items : [];

    const { data, error } = await supabase.rpc('update_invoice_transaction', {
      p_invoice_id: id,
      p_invoice_data: payloadInvoice,
      p_company_data: payloadCompany,
      p_items_data: payloadItems
    });

    if (error) throw error;

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

    // 1- Önce faturanın içindeki 'ürünleri' (invoice_items) temizleyelim ki askıda kalmasın
    await supabase.from('invoice_items').delete().eq('invoice_id', id);

    // 2- Sonra asıl faturayı siliyoruz
    const { error } = await supabase.from('invoices').delete().eq('id', id);

    if (error) throw error;
    res.status(200).json({ message: "Fatura başarıyla silindi" });

  } catch (error) {
    console.error("Fatura silme hatası:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu" });
  }
});













// ─── ÖDEME GEÇMİŞİ API'LERİ ──────────────────────────────────────────────────

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
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("Supabase URL Check:", process.env.SUPABASE_URL ? "Loaded ✅" : "Not Found ❌");
});