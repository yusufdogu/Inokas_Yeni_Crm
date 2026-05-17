// routes/payments.js
'use strict';

const express = require('express');
const router  = express.Router();

// GET /api/payments/closure-summary
router.get('/closure-summary', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data, error } = await supabase
      .from('payments')
      .select('invoice_id, amount, payment_date');
    if (error) throw error;

    const map = {};
    (data || []).forEach(p => {
      const invoiceId = p.invoice_id;
      if (!invoiceId) return;
      const amount  = Number(p.amount || 0);
      const payDate = String(p.payment_date || '');
      if (!map[invoiceId]) {
        map[invoiceId] = { total_paid: 0, last_payment_date: payDate || null };
      }
      map[invoiceId].total_paid += amount;
      if (payDate && (!map[invoiceId].last_payment_date || payDate > map[invoiceId].last_payment_date)) {
        map[invoiceId].last_payment_date = payDate;
      }
    });

    res.json(map);
  } catch (err) {
    console.error('Ödeme kapanış özeti hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payments/by-invoice/:id  (invoice bazlı ödemeler)
// Note: mounted as /api/payments, but called via /api/invoices/:id/payments in index.js
// Keep both patterns working — add this to invoices router later
router.get('/by-invoice/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id }   = req.params;
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('invoice_id', id)
      .order('payment_date', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Ödeme listesi hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments
router.post('/', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { invoice_id, amount, currency, payment_date, notes } = req.body;

    if (!invoice_id || !amount || !currency || !payment_date) {
      return res.status(400).json({ error: 'invoice_id, amount, currency ve payment_date zorunludur.' });
    }

    const { data: payment, error: insertErr } = await supabase
      .from('payments')
      .insert({ invoice_id, amount, currency, payment_date, notes: notes || null })
      .select()
      .single();
    if (insertErr) throw insertErr;

    const { error: rpcErr } = await supabase
      .rpc('recalculate_invoice_payment_status', { p_invoice_id: invoice_id });
    if (rpcErr) throw rpcErr;

    res.status(201).json({ message: 'Ödeme kaydedildi.', payment });
  } catch (err) {
    console.error('Ödeme ekleme hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/payments/:id
router.put('/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id }   = req.params;
    const { amount, currency, payment_date, notes } = req.body;

    const { data: existing, error: fetchErr } = await supabase
      .from('payments')
      .select('invoice_id')
      .eq('id', id)
      .single();
    if (fetchErr) throw fetchErr;

    const fields = {};
    if (amount       !== undefined) fields.amount       = amount;
    if (currency     !== undefined) fields.currency     = currency;
    if (payment_date !== undefined) fields.payment_date = payment_date;
    if (notes        !== undefined) fields.notes        = notes;

    const { error: updateErr } = await supabase
      .from('payments')
      .update(fields)
      .eq('id', id);
    if (updateErr) throw updateErr;

    const { error: rpcErr } = await supabase
      .rpc('recalculate_invoice_payment_status', { p_invoice_id: existing.invoice_id });
    if (rpcErr) throw rpcErr;

    res.json({ message: 'Ödeme güncellendi.' });
  } catch (err) {
    console.error('Ödeme güncelleme hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/payments/:id
router.delete('/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id }   = req.params;

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

    const { error: rpcErr } = await supabase
      .rpc('recalculate_invoice_payment_status', { p_invoice_id: payment.invoice_id });
    if (rpcErr) throw rpcErr;

    res.json({ message: 'Ödeme silindi.' });
  } catch (err) {
    console.error('Ödeme silme hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;