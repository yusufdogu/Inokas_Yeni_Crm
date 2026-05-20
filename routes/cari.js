// routes/cari.js
'use strict';

const express = require('express');
const router  = express.Router();

// GET /api/cari/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;

    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('*, companies(name)')
      .eq('tenant_id', tenantId)
      .or('approval_status.neq.pending,approval_status.is.null');

    if (error) throw error;

    const list = invoices || [];

    function getIso(inv) {
      const raw = String(inv.base_currency || inv.currency || 'TRY').trim().toUpperCase();
      return raw === 'TL' ? 'TRY' : raw || 'TRY';
    }
    function getRate(inv) {
      const r = parseFloat(inv.calculation_rate ?? inv.exchange_rate);
      return Number.isFinite(r) && r > 0 ? r : 1;
    }
    function getPayableTl(inv)     { return parseFloat(inv.payable_amount_tl) || 0; }
    function getPayableSrc(inv) {
      const c = parseFloat(inv.payable_amount_cur);
      if (Number.isFinite(c) && c >= 0) return c;
      return getPayableTl(inv) / getRate(inv);
    }
    function getPaidSrc(inv) {
      const cur = parseFloat(inv.paid_amount_cur);
      if (Number.isFinite(cur) && cur > 0) return cur;
      return (parseFloat(inv.paid_amount) || 0) / getRate(inv);
    }
    function getPayableTlActual(inv) {
      const tl = getPayableTl(inv);
      return tl > 0 ? tl : getPayableSrc(inv) * getRate(inv);
    }
    function getPaidTl(inv) {
      const cur = parseFloat(inv.paid_amount_cur);
      if (Number.isFinite(cur) && cur > 0) return cur * getRate(inv);
      return parseFloat(inv.paid_amount) || 0;
    }

    const kpis = {
      alacak:   { usd: 0, tl: 0 },
      odenecek: { usd: 0, tl: 0 },
      odenen:   { usd: 0, tl: 0 }
    };

    list.forEach(inv => {
      const iso         = getIso(inv);
      const payable     = getPayableSrc(inv);
      const paid        = Math.min(getPaidSrc(inv), payable);
      const payableTl   = getPayableTlActual(inv);
      const paidTl      = Math.min(getPaidTl(inv), payableTl);
      const remaining   = Math.max(payable - paid, 0);
      const remainingTl = Math.max(payableTl - paidTl, 0);

      if (inv.direction === 'OUTGOING') {
        if (iso === 'USD') kpis.alacak.usd += remaining;
        else               kpis.alacak.tl  += remainingTl;
      } else if (inv.direction === 'INCOMING') {
        if (iso === 'USD') { kpis.odenecek.usd += remaining; kpis.odenen.usd += paid; }
        else               { kpis.odenecek.tl  += remainingTl; kpis.odenen.tl += paidTl; }
      }
    });

    const firmaMap = {};
    list.forEach(inv => {
      const name = inv.companies?.name || 'Bilinmiyor';
      if (!firmaMap[name]) firmaMap[name] = {
        company_name: name, company_id: inv.company_id || null,
        has_incoming: false, has_outgoing: false,
        odenecek_usd: 0, odenecek_tl: 0, odened_usd: 0, odened_tl: 0,
        alacak_usd: 0, alacak_tl: 0, ciro_usd: 0, ciro_tl: 0,
      };

      const f       = firmaMap[name];
      const iso     = getIso(inv);
      const payable = getPayableSrc(inv);
      const paid    = Math.min(getPaidSrc(inv), payable);
      const payableTl = getPayableTlActual(inv);
      const paidTl    = Math.min(getPaidTl(inv), payableTl);

      if (inv.direction === 'INCOMING') {
        f.has_incoming = true;
        if (iso === 'USD') { f.odenecek_usd += payable;   f.odened_usd += paid; }
        else               { f.odenecek_tl  += payableTl; f.odened_tl  += paidTl; }
      } else if (inv.direction === 'OUTGOING') {
        f.has_outgoing = true;
        if (iso === 'USD') { f.ciro_usd += payable;   f.alacak_usd += Math.max(payable - paid, 0); }
        else               { f.ciro_tl  += payableTl; f.alacak_tl  += Math.max(payableTl - paidTl, 0); }
      }
    });

    const firmalar = Object.values(firmaMap).map(f => {
      const type = f.has_incoming && f.has_outgoing ? 'İkisi de'
        : f.has_incoming ? 'Tedarikçi' : 'Müşteri';
      return {
        company_name: f.company_name, company_id: f.company_id, type,
        odenecek_usd: f.odenecek_usd, odenecek_tl: f.odenecek_tl,
        odenen_usd: f.odened_usd, odenen_tl: f.odened_tl,
        kalan_usd: Math.max(f.odenecek_usd - f.odened_usd, 0),
        kalan_tl:  Math.max(f.odenecek_tl  - f.odened_tl,  0),
        alacak_usd: f.alacak_usd, alacak_tl: f.alacak_tl,
        ciro_usd: f.ciro_usd, ciro_tl: f.ciro_tl,
        _sort: f.odenecek_usd * 35 + f.odenecek_tl + f.ciro_usd * 35 + f.ciro_tl
      };
    }).sort((a, b) => b._sort - a._sort);

    res.json({ kpis, firmalar });
  } catch (err) {
    console.error('GET /api/cari/dashboard hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;