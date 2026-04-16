const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const app = express();
try {
  require('dotenv').config();
} catch (err) {
  // Railway gibi ortamlarda env panelden verildiği için dotenv zorunlu değildir.
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
  console.warn('dotenv bulunamadı, ortam değişkenleri platformdan okunuyor.');
}



// 1. ADD THIS: This allows your server to read the "Big Package" (JSON) sent from the browser
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);



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




app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
app.get('/api/stocks/summary', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('invoice_item_id, product_name, sku, movement_type, quantity');

    if (error) throw error;

    const itemIds = [...new Set((data || []).map(r => r.invoice_item_id).filter(Boolean))];
    const itemMap = {};
    const invoiceMap = {};

    if (itemIds.length > 0) {
      const { data: items, error: itemsErr } = await supabase
        .from('invoice_items')
        .select('id, unit_price_cur, invoice_id')
        .in('id', itemIds);
      if (itemsErr) throw itemsErr;
      (items || []).forEach((it) => { itemMap[it.id] = it; });

      const invoiceIds = [...new Set((items || []).map(i => i.invoice_id).filter(Boolean))];
      if (invoiceIds.length > 0) {
        const { data: invoices, error: invErr } = await supabase
          .from('invoices')
          .select('id, currency, exchange_rate')
          .in('id', invoiceIds);
        if (invErr) throw invErr;
        (invoices || []).forEach((inv) => { invoiceMap[inv.id] = inv; });
      }
    }

    const toUnitUsd = (itemId) => {
      const item = itemMap[itemId];
      if (!item) return null;
      const invoice = invoiceMap[item.invoice_id];
      if (!invoice) return null;
      const currency = String(invoice.currency || '').toUpperCase();
      const unitPrice = Number(item.unit_price_cur || 0);
      if (!(unitPrice > 0)) return null;
      // Doğru USD dönüşümü için sadece USD fatura birimini kesin kabul ediyoruz.
      if (currency === 'USD') return unitPrice;
      return null;
    };

    const grouped = {};
    (data || []).forEach((row) => {
      const key = row.sku ? `SKU:${row.sku}` : `NAME:${row.product_name}`;
      if (!grouped[key]) {
        grouped[key] = {
          product_name: row.product_name,
          sku: row.sku || null,
          total_in: 0,
          total_out: 0,
          current_stock: 0,
          total_in_usd: 0,
          total_out_usd: 0,
          in_qty_for_avg_usd: 0,
          out_qty_for_avg_usd: 0,
          in_unit_usd: null,
          out_unit_usd: null,
          stock_usd: null
        };
      }

      const qty = Number(row.quantity) || 0;
      const unitUsd = toUnitUsd(row.invoice_item_id);
      if (row.movement_type === 'IN') {
        grouped[key].total_in += qty;
        if (unitUsd !== null) {
          grouped[key].total_in_usd += qty * unitUsd;
          grouped[key].in_qty_for_avg_usd += qty;
        }
      }
      if (row.movement_type === 'OUT') {
        grouped[key].total_out += qty;
        if (unitUsd !== null) {
          grouped[key].total_out_usd += qty * unitUsd;
          grouped[key].out_qty_for_avg_usd += qty;
        }
      }
      grouped[key].current_stock = grouped[key].total_in - grouped[key].total_out;
    });

    const summary = Object.values(grouped).map((row) => {
      const avgInUnitUsd = row.in_qty_for_avg_usd > 0 ? (row.total_in_usd / row.in_qty_for_avg_usd) : null;
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
      acc.total_in_qty += Number(row.total_in || 0);
      acc.total_out_qty += Number(row.total_out || 0);
      acc.current_qty += Number(row.current_stock || 0);
      acc.stock_usd += Number(row.stock_usd || 0);
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













const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("Supabase URL Check:", process.env.SUPABASE_URL ? "Loaded ✅" : "Not Found ❌");
});