const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const app = express();

// 1. ADD THIS: This allows your server to read the "Big Package" (JSON) sent from the browser
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("Supabase URL Check:", process.env.SUPABASE_URL ? "Loaded ✅" : "Not Found ❌");
});