// 1. ALWAYS FIRST: Load environment variables
require('dotenv').config();

// 2. DEBUG: Verify the correct key is actually there
console.log("Checking Key:", process.env.SUPABASE_KEY ? "EXISTS (Correct Secret Key)" : "MISSING");

const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 3. Initialize Supabase with the SERVICE ROLE KEY
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Use the secret one here!

if (!supabaseKey || !supabaseUrl) {
    console.error("❌ Critical Error: Supabase URL or Key is missing from .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const { testGiderSync} = require('./services/sync-service');

const app = express();
app.use(express.json());

// Main execution block
async function startApp() {
    try {
        console.log("🛠️ Starting Initial Sync...");
        await testGiderSync(); // Use await here inside an async block
        console.log("🏁 Sync Process Finished");

    } catch (err) {
        console.error("🛑 Startup Error:", err);
    }
}

startApp();



app.use(express.static(path.join(__dirname, 'public')));


app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});




// 2. ADD THIS: The new POST route to handle saving the full invoice
app.post('/api/save-invoice', async (req, res) => {
  try {
    const fullData = req.body; // This is the package coming from faturalar.js

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
      .insert(itemsToSave);

    if (itemsError) throw itemsError;

    // If everything worked, send a success message back to the browser
    res.status(200).json({ message: "Fatura başarıyla kaydedildi!" });

  } catch (err) {
    console.error("Kayıt Hatası:", err.message);
    // Supabase (PostgreSQL) hata kodunu (err.code) frontend'e yeni bir paket olarak iletiyoruz!
    res.status(500).json({ error: err.message, errorCode: err.code });
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

    // Frontend'den gelen her şeyi alıyoruz
    const {
      status, paid_amount, due_date, exchange_rate, notes, invoice_type, // Serbest Alanlar
      invoice_no, invoice_date, total_amount_tl, net_amount_tl, tax_amount_tl, currency // Normalde Kilitli Alanlar
    } = req.body;

    // Gönderilen (Boş olmayan) alanları dinamik olarak Supabase paketine ekliyoruz
    const updatePayload = {};

    if (status !== undefined) updatePayload.status = status;
    if (paid_amount !== undefined) updatePayload.paid_amount = paid_amount;
    if (due_date !== undefined) updatePayload.due_date = due_date;
    if (exchange_rate !== undefined) updatePayload.exchange_rate = exchange_rate;
    if (notes !== undefined) updatePayload.notes = notes;
    if (invoice_type !== undefined) updatePayload.invoice_type = invoice_type;

    // Kilitli alanlar da gelirse onları da faturaya işletiyoruz
    if (invoice_no !== undefined) updatePayload.invoice_no = invoice_no;
    if (invoice_date !== undefined) updatePayload.invoice_date = invoice_date;
    if (total_amount_tl !== undefined) updatePayload.total_amount_tl = total_amount_tl;
    if (net_amount_tl !== undefined) updatePayload.net_amount_tl = net_amount_tl;
    if (tax_amount_tl !== undefined) updatePayload.tax_amount_tl = tax_amount_tl;
    if (currency !== undefined) updatePayload.currency = currency;

    // Supabase'e dinamik paketi yolluyoruz
    const { data, error } = await supabase
      .from('invoices')
      .update(updatePayload)
      .eq('id', id)
      .select();

    if (error) throw error;

    res.json({ message: "Fatura başarıyla güncellendi", data: data });

  } catch (error) {
    console.error("PUT /api/invoices/:id hatası:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu" });
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