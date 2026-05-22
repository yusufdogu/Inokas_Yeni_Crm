// routes/settings.js
'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();

// Helper to get supabase from app
const db = (req) => req.app.get('supabase');

// ─── GET /api/settings/firma ──────────────────────────────────────────────────
router.get('/firma', async (req, res) => {
  const { data, error } = await db(req)
    .from('tenants')
    .select('name, vkn')
    .eq('id', req.tenantId)
    .single();

  if (error) return res.status(500).json({ error: 'Firma bilgisi alınamadı.' });
  res.json(data);
});

// ─── PUT /api/settings/firma ──────────────────────────────────────────────────
router.put('/firma', async (req, res) => {
  const { name, vkn } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Firma adı zorunlu.' });

  const updates = { name };
  if (vkn !== undefined) updates.vkn = vkn.trim() || null;

  const { error } = await db(req)
    .from('tenants')
    .update(updates)
    .eq('id', req.tenantId);

  if (error) return res.status(500).json({ error: 'Güncelleme başarısız: ' + error.message });
  res.json({ success: true });
});

// ─── GET /api/settings/integrations ──────────────────────────────────────────
router.get('/integrations', async (req, res) => {
  const { data, error } = await db(req)
    .from('tenant_integrations')
    .select('provider, is_active')
    .eq('tenant_id', req.tenantId);

  if (error) return res.status(500).json({ error: 'Entegrasyonlar alınamadı.' });
  res.json({ integrations: data || [] });
});

// ─── PUT /api/settings/integrations/:provider ─────────────────────────────────
router.put('/integrations/:provider', async (req, res) => {
  const { provider }                                          = req.params;
  const { base_url, api_key, service_url, username, password } = req.body || {};
  const tenantId = req.tenantId;

  const validProviders = ['logo', 'elogo', 'isbasi'];
  if (!validProviders.includes(provider))
    return res.status(400).json({ error: 'Geçersiz provider.' });

  try {
    const supabase = db(req);
    const prefix   = `tenant_${tenantId}_${provider}`;

    const secrets = [];
    if (provider === 'logo') {
      if (base_url)  secrets.push({ name: `${prefix}_base_url`, value: base_url.replace(/\/$/, '') });
      if (api_key)   secrets.push({ name: `${prefix}_api_key`,  value: api_key });
      if (username)  secrets.push({ name: `${prefix}_username`, value: username });
      if (password)  secrets.push({ name: `${prefix}_password`, value: password });
    } else {
      if (service_url) secrets.push({ name: `${prefix}_service_url`, value: service_url.replace(/\/$/, '') });
      if (username)    secrets.push({ name: `${prefix}_username`,    value: username });
      if (password)    secrets.push({ name: `${prefix}_password`,    value: password });
    }

    if (!secrets.length) return res.status(400).json({ error: 'Güncellenecek alan yok.' });

    for (const s of secrets) {
      const { error } = await supabase.rpc('store_tenant_secret', {
        p_name: s.name, p_value: s.value,
      });
      if (error) throw new Error(`Vault hatası (${s.name}): ` + error.message);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/settings/integrations/:provider/toggle ────────────────────────
router.post('/integrations/:provider/toggle', async (req, res) => {
  const { provider } = req.params;

  const { data: current, error: fetchErr } = await db(req)
    .from('tenant_integrations')
    .select('is_active')
    .eq('tenant_id', req.tenantId)
    .eq('provider', provider)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!current) return res.status(404).json({ error: 'Entegrasyon bulunamadı.' });

  const { error } = await db(req)
    .from('tenant_integrations')
    .update({ is_active: !current.is_active })
    .eq('tenant_id', req.tenantId)
    .eq('provider', provider);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, is_active: !current.is_active });
});

// ─── GET /api/settings/users ──────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const { data, error } = await db(req)
    .from('users')
    .select('id, email, role, is_active')
    .eq('tenant_id', req.tenantId)
    .order('role', { ascending: false });

  if (error) return res.status(500).json({ error: 'Kullanıcılar alınamadı.' });
  res.json({ users: data || [] });
});

// ─── POST /api/settings/users — invite/create user ───────────────────────────
router.post('/users', async (req, res) => {
  const { email, password, role = 'user' } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'E-posta ve şifre zorunlu.' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Geçersiz rol.' });
  if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });

  // Check if email already exists in this tenant
  const { data: existing } = await db(req)
    .from('users')
    .select('id')
    .eq('tenant_id', req.tenantId)
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing) return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı.' });

  const password_hash = await bcrypt.hash(password, 12);

  const { error } = await db(req)
    .from('users')
    .insert({
      tenant_id:     req.tenantId,
      email:         email.toLowerCase().trim(),
      password_hash,
      role,
      is_active:     true,
    });

  if (error) return res.status(500).json({ error: 'Kullanıcı oluşturulamadı: ' + error.message });
  res.json({ success: true });
});

// ─── PUT /api/settings/password ──────────────────────────────────────────────
router.put('/password', async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Mevcut ve yeni şifre zorunlu.' });
  if (new_password.length < 6)
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });

  // Get current user from session
  const { data: session } = await db(req)
    .from('sessions')
    .select('user_id')
    .eq('token', req.headers['x-auth-token'])
    .single();

  if (!session) return res.status(401).json({ error: 'Oturum bulunamadı.' });

  const { data: user } = await db(req)
    .from('users')
    .select('password_hash')
    .eq('id', session.user_id)
    .single();

  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });

  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Mevcut şifre yanlış.' });

  const new_hash = await bcrypt.hash(new_password, 12);

  const { error } = await db(req)
    .from('users')
    .update({ password_hash: new_hash })
    .eq('id', session.user_id);

  if (error) return res.status(500).json({ error: 'Şifre güncellenemedi.' });
  res.json({ success: true });
});

// ─── GET /api/tenant-vkn — used by fatura-yukle for direction classification ──
router.get('/', async (req, res) => {
  const { data, error } = await db(req)
    .from('tenants')
    .select('vkn')
    .eq('id', req.tenantId)
    .single();

  if (error) return res.status(500).json({ error: 'VKN alınamadı.' });
  if (!data?.vkn) return res.status(404).json({ error: 'Firma VKN bilgisi girilmemiş. Ayarlar > Firma Bilgileri bölümünden ekleyin.' });
  res.json({ vkn: data.vkn });
});

module.exports = router;