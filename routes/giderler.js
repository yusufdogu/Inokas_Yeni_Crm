const express = require('express');
const router  = express.Router();

// ── Apply the shared "what is a gider" filter to a query ──
function baseGiderQuery(supabase, tenantId, select) {
  return supabase
    .from('invoices')
    .select(select, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('invoice_category', 'NON_INTERNAL')
    .or('approval_status.eq.approved,approval_status.is.null');
}

const isUSDinv = inv => (inv.base_currency || '').toUpperCase() === 'USD';
const invRate  = inv => parseFloat(inv.calculation_rate) || 1;

// Sum a single invoice's gider lines → { tl (converted), curRaw (native) }
function sumGiderLines(inv) {
  const rate = invRate(inv);
  let tl = 0, curRaw = 0;
  (inv.invoice_items || [])
    .filter(it => !it.is_internal)
    .forEach(it => {
      const cur = parseFloat(it.total_price_cur) || 0;
      curRaw += cur;
      tl     += cur * rate;
    });
  return { tl, curRaw };
}

// ─── LIST: /invoices ──────────────────────────────────────────────────────────
// Ported from the original /ofis-ici handler. KPI totals stay native (TL/USD
// separate); the table amount also stays native. No conversion here.
router.get('/invoices', async (req, res) => {
  try {
    const supabase   = req.app.get('supabase');
    const tenantId   = req.tenantId;
    const search     = req.query.search     || '';
    const dateStart  = req.query.date_start || '';
    const dateEnd    = req.query.date_end   || '';
    const currency = req.query.currency || '';
    const category = req.query.category || '';
    const minPrice = parseFloat(req.query.min_price);
    const maxPrice = parseFloat(req.query.max_price);
    const companies  = req.query.companies ? req.query.companies.split(',').map(s => s.trim()).filter(Boolean) : [];
    const page       = Math.max(1, parseInt(req.query.page) || 1);
    const limit      = Math.min(200, parseInt(req.query.limit) || 0);
    const totalsOnly = req.query.totals === 'true';

    let companyIds = [];
    if (companies.length) {
      const { data: matched } = await supabase.from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
      companyIds = (matched || []).map(c => c.id);
      if (!companyIds.length) return res.json(limit > 0 ? { data: [], total: 0, total_pages: 0, page } : []);
    }

    let categoryIds = null;
    if (category) {
      const { data: its, error: itErr } = await supabase
        .from('invoice_items')
        .select('invoice_id, invoices!inner(tenant_id)')
        .eq('is_internal', false)
        .eq('item_category', category)
        .eq('invoices.tenant_id', tenantId);
      if (itErr) throw itErr;
      categoryIds = [...new Set((its || []).map(r => r.invoice_id))];
      if (!categoryIds.length) return res.json(limit > 0 ? { data: [], total: 0, total_pages: 0, page } : []);
    }

    let query = baseGiderQuery(supabase, tenantId, '*, companies(*), invoice_items(*)')
      .order('invoice_date', { ascending: false });

    if (search)             query = query.ilike('invoice_no', `%${search}%`);
    if (dateStart)          query = query.gte('invoice_date', dateStart);
    if (dateEnd)            query = query.lte('invoice_date', dateEnd);
    if (companyIds?.length) query = query.in('company_id', companyIds);
    if (categoryIds)        query = query.in('id', categoryIds);
    if (currency) {
      const c = currency.toUpperCase();
      if (c === 'TRY') query = query.or('base_currency.is.null,base_currency.ilike.TRY');
      else             query = query.ilike('base_currency', c);
    }
    if (!isNaN(minPrice))   query = query.gte('payable_amount_tl', minPrice);
    if (!isNaN(maxPrice))   query = query.lte('payable_amount_tl', maxPrice);

    if (totalsOnly) {
      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];

      let tryTotal = 0, usdTotal = 0;
      const catMap = {};
      rows.forEach(inv => {
        const usd = isUSDinv(inv);
        (inv.invoice_items || []).filter(it => !it.is_internal).forEach(it => {
          const line = parseFloat(it.total_price_cur) || 0;
          if (usd) usdTotal += line; else tryTotal += line;
          const cat = it.item_category || 'diğer';
          catMap[cat] = (catMap[cat] || 0) + (parseFloat(it.quantity) || 1);
        });
      });

      return res.json({ count: rows.length, total_tl: tryTotal, total_usd: usdTotal, cat_map: catMap });
    }

    if (limit > 0) query = query.range((page - 1) * limit, page * limit - 1);
    const { data, error, count } = await query;
    if (error) throw error;

    if (limit > 0) return res.json({ data: data || [], total: count || 0, total_pages: Math.ceil((count || 0) / limit), page });
    res.json(data || []);
  } catch (err) {
    console.error('Giderler /invoices hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── OVERVIEW: /overview ──────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const supabase  = req.app.get('supabase');
    const tenantId  = req.tenantId;
    const dateStart = req.query.date_start || '';
    const dateEnd   = req.query.date_end   || '';

    let query = baseGiderQuery(
      supabase, tenantId,
      'id, base_currency, calculation_rate, company_id, companies(name), invoice_items(is_internal, total_price_cur, item_category)'
    ).order('invoice_date', { ascending: true });

    if (dateStart) query = query.gte('invoice_date', dateStart);
    if (dateEnd)   query = query.lte('invoice_date', dateEnd);

    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];

    let totalTlNative = 0, totalUsdNative = 0;     // KPIs (native, separate)
    const companyIds = new Set();
    const companyMap = {};                          // name → { name, tl, count }  (TL-based)
    const catMap     = {};                          // subcat → { name, tl }        (TL-based)

    rows.forEach(inv => {
      const usd  = isUSDinv(inv);
      const rate = invRate(inv);

      let invTL = 0, invCurRaw = 0;
      (inv.invoice_items || []).filter(it => !it.is_internal).forEach(it => {
        const cur = parseFloat(it.total_price_cur) || 0;
        const tl  = cur * rate;
        invTL     += tl;
        invCurRaw += cur;

        const cat = it.item_category || 'Diğer';
        const c   = catMap[cat] || (catMap[cat] = { name: cat, tl: 0 });
        c.tl += tl;                                  // categories ranked in TL
      });

      // KPIs — native split
      if (usd) totalUsdNative += invCurRaw;
      else     totalTlNative  += invCurRaw;

      // Companies — TL-based
      const name = inv.companies?.name || 'Bilinmeyen';
      const co   = companyMap[name] || (companyMap[name] = { name, tl: 0, count: 0 });
      co.tl    += invTL;
      co.count += 1;
      if (inv.company_id) companyIds.add(inv.company_id);
    });

    const byTL = (a, b) => b.tl - a.tl;

    res.json({
      kpis: {
        total_invoices:  rows.length,
        total_companies: companyIds.size,
        total_tl:        totalTlNative,
        total_usd:       totalUsdNative,
      },
      // Full ranked lists — the client paginates 3 at a time.
      top_companies:  Object.values(companyMap).sort(byTL),
      top_categories: Object.values(catMap).sort(byTL),
    });
  } catch (err) {
    console.error('Giderler /overview hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── VALUE SERIES: /value-series (TL only) ────────────────────────────────────
router.get('/value-series', async (req, res) => {
  try {
    const supabase   = req.app.get('supabase');
    const tenantId   = req.tenantId;
    const dateStart  = req.query.date_start || '';
    const dateEnd    = req.query.date_end   || '';
    const granularity = ['month', 'week', 'day'].includes(req.query.granularity) ? req.query.granularity : 'month';

    let query = baseGiderQuery(
      supabase, tenantId,
      'invoice_date, base_currency, calculation_rate, invoice_items(is_internal, total_price_cur)'
    ).order('invoice_date', { ascending: true });

    if (dateStart) query = query.gte('invoice_date', dateStart);
    if (dateEnd)   query = query.lte('invoice_date', dateEnd);

    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];

    const keyOf = (dateStr) => {
      const d = new Date((dateStr || '').slice(0, 10) + 'T00:00:00');
      if (isNaN(d)) return null;
      if (granularity === 'day')  return d.toISOString().slice(0, 10);
      if (granularity === 'week') {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
        return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
      }
      return d.toISOString().slice(0, 7);            // YYYY-MM
    };

    const buckets = {};
    rows.forEach(inv => {
      const period = keyOf(inv.invoice_date);
      if (!period) return;
      const { tl } = sumGiderLines(inv);             // converted to TL
      const b = buckets[period] || (buckets[period] = { period, total_tl: 0, count: 0 });
      b.total_tl += tl;
      b.count    += 1;
    });

    res.json({ granularity, points: Object.values(buckets).sort((a, b) => a.period.localeCompare(b.period)) });
  } catch (err) {
    console.error('Giderler /value-series hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});


router.get('/ofis-ici', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const search = req.query.search || '';
    const dateStart = req.query.date_start || '';
    const dateEnd = req.query.date_end || '';
    const category = req.query.category || '';
    const companies = req.query.companies ? req.query.companies.split(',').map(s => s.trim()).filter(Boolean) : [];
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 0);
    const totalsOnly = req.query.totals === 'true';

    let companyIds = [];
    if (companies.length) {
      const { data: matched } = await supabase.from('companies').select('id').in('name', companies).eq('tenant_id', tenantId);
      companyIds = (matched || []).map(c => c.id);
      if (!companyIds.length) return res.json(limit > 0 ? { data: [], total: 0, total_pages: 0, page } : []);
    }

    // Ofis içi = NON_INTERNAL invoices — straight from the column, no ID array
    let query = supabase
      .from('invoices')
      .select('*, companies(*), invoice_items(*)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('invoice_category', 'NON_INTERNAL')
      .or('approval_status.eq.approved,approval_status.is.null')
      .order('invoice_date', { ascending: false });

    if (search) query = query.or(`invoice_no.ilike.%${search}%`);
    if (dateStart) query = query.gte('invoice_date', dateStart);
    if (dateEnd) query = query.lte('invoice_date', dateEnd);
    if (companyIds?.length) query = query.in('company_id', companyIds);

    if (totalsOnly) {
      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];

      let tryTotal = 0, usdTotal = 0;
      const catMap = {};

      rows.forEach(inv => {
        const isUSD = (inv.base_currency || '').toUpperCase() === 'USD';
        (inv.invoice_items || []).filter(it => !it.is_internal).forEach(it => {
          const lineTotal = parseFloat(it.total_price_cur) || 0;
          if (isUSD) usdTotal += lineTotal;
          else       tryTotal += lineTotal;
          const cat = it.item_category || 'diğer';
          catMap[cat] = (catMap[cat] || 0) + (parseFloat(it.quantity) || 1);
        });
      });

      return res.json({
        count:     rows.length,
        total_tl:  tryTotal,
        total_usd: usdTotal,
        cat_map:   catMap,
      });
    }

    if (limit > 0) query = query.range((page - 1) * limit, page * limit - 1);
    const { data, error, count } = await query;
    if (error) throw error;

    if (limit > 0) return res.json({ data: data || [], total: count || 0, total_pages: Math.ceil((count || 0) / limit), page });
    res.json(data || []);
  } catch (err) {
    console.error('Ofis içi fatura hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});
router.get('/ofis-ici-categories', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data, error } = await supabase.from('invoice_items').select('item_category').eq('is_internal', false).not('item_category', 'is', null).neq('item_category', '');
    if (error) throw error;
    const cats = [...new Set((data || []).map(r => r.item_category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;