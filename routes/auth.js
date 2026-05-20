// routes/auth.js
'use strict';

const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcrypt');
const router  = express.Router();

// POST /api/auth/login
// POST /api/auth/login
router.post('/login', async (req, res) => {
  const supabase = req.app.get('supabase');
  const { email, password } = req.body || {};

  if (!email || !password)
    return res.status(400).json({ error: 'E-posta ve şifre zorunlu.' });

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

  const token = crypto.randomBytes(32).toString('hex');

  // Save to DB instead of memory
  const { error: sessionErr } = await supabase
    .from('sessions')
    .insert({ token, user_id: user.id, tenant_id: user.tenant_id, role: user.role });

  if (sessionErr) throw sessionErr;

  res.json({ token });
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const supabase = req.app.get('supabase');
  const token    = req.headers['x-auth-token'];
  if (token) await supabase.from('sessions').delete().eq('token', token);
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const sessions = req.app.get('activeSessions');
  const token    = req.headers['x-auth-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

module.exports = router;