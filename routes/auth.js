// routes/auth.js
'use strict';

const express  = require('express');
const crypto   = require('crypto');
const bcrypt   = require('bcrypt');
const router   = express.Router();

// ─── POST /api/auth/signup ────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { company_name, first_name, last_name, email, password } = req.body || {};

  if (!company_name || !email || !password)
    return res.status(400).json({ error: 'Şirket adı, e-posta ve şifre zorunlu.' });

  if (password.length < 8)
    return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı.' });

  try {
    // Check if email already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existingUser)
      return res.status(409).json({ error: 'Bu e-posta adresi zaten kayıtlı.' });

    // Generate slug from company name
    const slug = company_name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) + '-' + crypto.randomBytes(3).toString('hex');

    // Create tenant
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({ name: company_name.trim(), slug, is_active: true, onboarding_complete: false })
      .select('id')
      .single();

    if (tenantErr) throw new Error('Şirket oluşturulamadı: ' + tenantErr.message);

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Create user
    const fullName = [first_name, last_name].filter(Boolean).join(' ');
    const { error: userErr } = await supabase
      .from('users')
      .insert({
        tenant_id:     tenant.id,
        email:         email.trim().toLowerCase(),
        password_hash,
        role:          'admin',
        is_active:     true,
      });

    if (userErr) {
      // Rollback tenant if user creation fails
      await supabase.from('tenants').delete().eq('id', tenant.id);
      throw new Error('Kullanıcı oluşturulamadı: ' + userErr.message);
    }

    // Create session in DB
    const token = crypto.randomBytes(32).toString('hex');
    const { error: sessionErr } = await supabase
      .from('sessions')
      .insert({
        token,
        user_id:    (await supabase.from('users').select('id').eq('email', email.trim().toLowerCase()).single()).data.id,
        tenant_id:  tenant.id,
        role:       'admin',
      });

    if (sessionErr) throw new Error('Oturum oluşturulamadı: ' + sessionErr.message);

    res.status(201).json({ token, onboarding_complete: false });

  } catch (err) {
    console.error('Signup hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { email, password } = req.body || {};

  if (!email || !password)
    return res.status(400).json({ error: 'E-posta ve şifre zorunlu.' });

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, tenant_id, email, password_hash, role, is_active')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (error || !user)
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });

    if (!user.is_active)
      return res.status(401).json({ error: 'Hesabınız aktif değil.' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });

    // Get onboarding status
    const { data: tenant } = await supabase
      .from('tenants')
      .select('onboarding_complete')
      .eq('id', user.tenant_id)
      .single();

    const onboarding_complete = tenant?.onboarding_complete ?? false;

    // Check for existing valid session
    const { data: existingSession } = await supabase
      .from('sessions')
      .select('token, expires_at')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingSession) {
      return res.json({ token: existingSession.token, role: user.role, onboarding_complete });
    }

    // Create new session
    const token      = require('crypto').randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('sessions').insert({
      token, user_id: user.id, tenant_id: user.tenant_id, role: user.role, expires_at
    });

    await supabase.from('sessions').delete()
      .eq('user_id', user.id)
      .lt('expires_at', new Date().toISOString());

    res.json({ token, role: user.role, onboarding_complete });

  } catch (err) {
    console.error('Login hatası:', err.message);
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const supabase = req.app.get('supabase');
  const token    = req.headers['x-auth-token'];
  if (token) await supabase.from('sessions').delete().eq('token', token);
  res.json({ ok: true });
});


module.exports = router;