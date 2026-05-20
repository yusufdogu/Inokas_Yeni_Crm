// routes/companies.js
'use strict';

const express = require('express');
const router  = express.Router();

// GET /api/companies/by-vkn?vkn=...
router.get('/by-vkn', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const vkn      = String(req.query.vkn || '').trim();
    if (!vkn) return res.status(400).json({ error: 'VKN zorunlu' });

    const { data, error } = await supabase
      .from('companies')
      .select('id, name, vkn_tckn')
      .eq('vkn_tckn', vkn)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Firma bulunamadı' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;