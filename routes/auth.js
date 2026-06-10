// routes/auth.js
'use strict';

const express  = require('express');
const crypto   = require('crypto');
const bcrypt   = require('bcrypt');
const router   = express.Router();

// ─── POST /api/auth/signup ────────────────────────────────────────────────────
router.post('/signup', async (req,res ) => {
  const supabase    = req.app.get('supabase');
  const { vkn, email } = req.body || {};

  try {
    // ── Check VKN uniqueness ──
    const { data: existingTenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('vkn', vkn)
      .maybeSingle();

    if (existingTenant)
      return res.status(409).json({ error: 'Bu VKN ile kayıtlı bir şirket zaten mevcut.' });

    // ── Check email uniqueness ──
    const { data: existingUser } = await supabase
      .from('users')
      .select('id',)
      .eq('email', email)
      .maybeSingle();

    if (existingUser)
      return res.status(409).json({ error: 'Bu e-posta adresi zaten kayıtlı.' });

    return res.status(200).json({ok:true})
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
      .select('onboarding_complete, onboarding_step')
      .eq('id', user.tenant_id)
      .single();

    const onboarding_complete = tenant?.onboarding_complete ?? false;
    const onboarding_step     = tenant?.onboarding_step     ?? 1;

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
      return res.json({ token: existingSession.token, role: user.role, onboarding_complete, onboarding_step });
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

    res.json({ token, role: user.role, onboarding_complete, onboarding_step });

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


/*// ── Create tenant ──
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({
        name:                company_name,
        vkn:                 vkn,
        is_active:           true,
        onboarding_complete: false,
        onboarding_step:     1,
      })
      .select('id')
      .single();

    if (tenantErr) throw new Error('Şirket oluşturulamadı: ' + tenantErr.message);

    // ── Hash password ──
    const password_hash = await bcrypt.hash(password, 12);

    // ── Create user ──
    const { data: newUser, error: userErr } = await supabase
      .from('users')
      .insert({
        tenant_id:     tenant.id,
        email:         email,
        password_hash,
        role:          'admin',
        is_active:     true,
      })
      .select('id')
      .single();

    if (userErr) {
      // Rollback tenant if user creation fails
      await supabase.from('tenants').delete().eq('id', tenant.id);
      throw new Error('Kullanıcı oluşturulamadı: ' + userErr.message);
    }

    // ── Create session ──
    const token      = crypto.randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: sessionErr } = await supabase
      .from('sessions')
      .insert({
        token,
        user_id:   newUser.id,
        tenant_id: tenant.id,
        role:      'admin',
        expires_at,
      });

    if (sessionErr) throw new Error('Oturum oluşturulamadı: ' + sessionErr.message);*/