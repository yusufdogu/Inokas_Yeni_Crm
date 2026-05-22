
// routes/integrations.js
'use strict';

const express   = require('express');
const axios     = require('axios');
const router    = express.Router();
const elogoApi  = require('../elogo-api');

// ─── POST /api/integrations/test ─────────────────────────────────────────────
router.post('/test', async (req, res) => {
  console.log('[test] body:', JSON.stringify(req.body));
  const { provider, base_url, api_key, username, password, service_url } = req.body || {};

  // ── eLogo / İşbaşı ──
  if (provider === 'elogo' || provider === 'isbasi') {
    if (!service_url || !username || !password)
      return res.status(400).json({ error: 'service_url, kullanıcı adı ve şifre zorunlu.' });

    try {
      const result = await elogoApi.testConnection({ service_url, username, password });
      console.log('[elogo test result]', result);
      if (result.success) return res.json({ success: true });
      return res.status(400).json({ success: false, error: result.error });
    } catch (err) {
      console.error('[elogo test ERROR]', err.message);
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  // ── Logo REST ──
  if (provider !== 'logo')
    return res.status(400).json({ error: 'Geçersiz provider.' });

  if (!base_url || !api_key || !username || !password)
    return res.status(400).json({ error: 'Tüm alanlar zorunlu.' });

  try {
    const url      = `${base_url.replace(/\/$/, '')}/api/v1.0/user/integrationLogin`;
    const response = await axios.post(url, { username, password }, {
      headers: { 'ApiKey': api_key, 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    if (response.data?.data?.accessToken) {
      return res.json({ success: true, message: 'Bağlantı başarılı.' });
    }

    res.status(400).json({ success: false, error: 'Geçersiz API yanıtı.' });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Bağlantı hatası.';
    res.status(400).json({ success: false, error: msg });
  }
});

// ─── POST /api/integrations — save credentials to Vault ──────────────────────
router.post('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const tenantId = req.tenantId;
  const { provider, base_url, api_key, username, password, service_url } = req.body || {};

  const validProviders = ['logo', 'elogo', 'isbasi'];
  if (!validProviders.includes(provider))
    return res.status(400).json({ error: 'Geçersiz provider.' });

  try {
    let secrets = [];

    if (provider === 'logo') {
      if (!base_url || !api_key || !username || !password)
        return res.status(400).json({ error: 'Tüm alanlar zorunlu.' });
      secrets = [
        { name: `tenant_${tenantId}_logo_base_url`, value: base_url.replace(/\/$/, '') },
        { name: `tenant_${tenantId}_logo_api_key`,  value: api_key  },
        { name: `tenant_${tenantId}_logo_username`, value: username  },
        { name: `tenant_${tenantId}_logo_password`, value: password  },
      ];
    } else {
      // elogo or isbasi
      if (!service_url || !username || !password)
        return res.status(400).json({ error: 'service_url, kullanıcı adı ve şifre zorunlu.' });
      secrets = [
        { name: `tenant_${tenantId}_${provider}_service_url`, value: service_url.replace(/\/$/, '') },
        { name: `tenant_${tenantId}_${provider}_username`,    value: username },
        { name: `tenant_${tenantId}_${provider}_password`,    value: password },
      ];
    }

    for (const secret of secrets) {
      const { error } = await supabase.rpc('store_tenant_secret', {
        p_name:  secret.name,
        p_value: secret.value,
      });
      if (error) throw new Error(`Vault hatası: ${error.message}`);
    }

    // Upsert tenant_integrations row
    const { error: intErr } = await supabase
      .from('tenant_integrations')
      .upsert({ tenant_id: tenantId, provider: 'logo', is_active: true, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,provider' });

    if (intErr) throw new Error(`Entegrasyon kaydı hatası: ${intErr.message}`);

    // Mark onboarding complete
    const { error: tenantErr } = await supabase
      .from('tenants')
      .update({ onboarding_complete: true })
      .eq('id', tenantId);

    if (tenantErr) throw new Error(`Tenant güncelleme hatası: ${tenantErr.message}`);

    res.json({ ok: true, message: 'Entegrasyon başarıyla kaydedildi.' });

  } catch (err) {
    console.error('[integrations] save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/integrations — get current integration status ──────────────────
router.get('/', async (req, res) => {
  const supabase = req.app.get('supabase');
  const tenantId = req.tenantId;

  try {
    const { data, error } = await supabase
      .from('tenant_integrations')
      .select('provider, is_active, created_at, updated_at')
      .eq('tenant_id', tenantId);

    if (error) throw error;

    res.json({ integrations: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/integrations/:provider — remove integration ─────────────────
router.delete('/:provider', async (req, res) => {
  const supabase = req.app.get('supabase');
  const tenantId = req.tenantId;
  const provider = req.params.provider;

  try {
    const { error } = await supabase
      .from('tenant_integrations')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('provider', provider);

    if (error) throw error;

    // Mark onboarding incomplete
    await supabase.from('tenants').update({ onboarding_complete: false }).eq('id', tenantId);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
