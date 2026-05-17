// routes/quotes.js
'use strict';

const express = require('express');
const router  = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSupabase(req) { return req.app.get('supabase'); }

async function getNextRefNo(supabase) {
  const year = new Date().getFullYear();
  const { data } = await supabase
    .from('quotes')
    .select('reference_no')
    .like('reference_no', `${year}-%`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!data || !data.length) return `${year}-1`;
  const last = parseInt((data[0].reference_no || '').split('-')[1] || '0', 10);
  return `${year}-${last + 1}`;
}

// ─── GET /api/quotes/next-ref-no ─────────────────────────────────────────────
router.get('/next-ref-no', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const refNo = await getNextRefNo(supabase);
    res.json({ reference_no: refNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/quotes ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { q, status } = req.query;

    let query = supabase
      .from('quotes')
      .select('*, companies(name)')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    let list = data || [];
    if (q) {
      const ql = q.toLocaleLowerCase('tr-TR');
      list = list.filter(qt =>
        (qt.reference_no || '').toLocaleLowerCase('tr-TR').includes(ql) ||
        (qt.company_name || '').toLocaleLowerCase('tr-TR').includes(ql) ||
        (qt.companies?.name || '').toLocaleLowerCase('tr-TR').includes(ql)
      );
    }

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/quotes/:id ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { data, error } = await supabase
      .from('quotes')
      .select('*, companies(name), quote_items(*)')
      .eq('id', req.params.id)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Teklif bulunamadı.' });

    data.quote_items = (data.quote_items || []).sort((a, b) => a.sort_order - b.sort_order);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/quotes ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { company_id, company_name, quote_date, valid_until, currency, status, notes, items } = req.body;

    const reference_no = await getNextRefNo(supabase);

    const total_excl_tax = (items || []).reduce((s, it) => s + (parseFloat(it.total_price) || 0), 0);

    const { data: quote, error: qErr } = await supabase
      .from('quotes')
      .insert({ reference_no, company_id: company_id || null, company_name, quote_date, valid_until, currency: currency || 'TRY', status: status || 'pending', notes, total_excl_tax })
      .select()
      .single();
    if (qErr) throw qErr;

    if (items && items.length) {
      const rows = items.map((it, i) => ({
        quote_id: quote.id,
        sort_order: i + 1,
        product_code: it.product_code || null,
        product_name: it.product_name,
        unit: it.unit || 'ADET',
        quantity: parseFloat(it.quantity) || 1,
        unit_price: parseFloat(it.unit_price) || 0,
        total_price: parseFloat(it.total_price) || 0,
      }));
      const { error: iErr } = await supabase.from('quote_items').insert(rows);
      if (iErr) throw iErr;
    }

    res.status(201).json(quote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/quotes/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { company_id, company_name, quote_date, valid_until, currency, status, notes, items } = req.body;
    const id = req.params.id;

    const total_excl_tax = (items || []).reduce((s, it) => s + (parseFloat(it.total_price) || 0), 0);

    const { error: qErr } = await supabase
      .from('quotes')
      .update({ company_id: company_id || null, company_name, quote_date, valid_until, currency, status, notes, total_excl_tax })
      .eq('id', id);
    if (qErr) throw qErr;

    if (items) {
      await supabase.from('quote_items').delete().eq('quote_id', id);
      if (items.length) {
        const rows = items.map((it, i) => ({
          quote_id: id,
          sort_order: i + 1,
          product_code: it.product_code || null,
          product_name: it.product_name,
          unit: it.unit || 'ADET',
          quantity: parseFloat(it.quantity) || 1,
          unit_price: parseFloat(it.unit_price) || 0,
          total_price: parseFloat(it.total_price) || 0,
        }));
        const { error: iErr } = await supabase.from('quote_items').insert(rows);
        if (iErr) throw iErr;
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/quotes/:id/status ───────────────────────────────────────────────
router.put('/:id/status', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { status } = req.body;
    if (!['draft', 'pending', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Geçersiz durum.' });
    }
    const { error } = await supabase.from('quotes').update({ status }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/quotes/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    await supabase.from('quote_items').delete().eq('quote_id', req.params.id);
    const { error } = await supabase.from('quotes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/product-groups ──────────────────────────────────────────────────
router.get('/product-groups/list', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { data, error } = await supabase
      .from('product_groups')
      .select('*')
      .order('group_name');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/product-groups/:id/items ───────────────────────────────────────
router.get('/product-groups/:id/items', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { data, error } = await supabase
      .from('product_group_items')
      .select('*')
      .eq('group_id', req.params.id)
      .order('sort_order');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
