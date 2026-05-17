// routes/auth.js
'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const activeSessions = new Set();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const validEmail    = process.env.ADMIN_EMAIL;
  const validPassword = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    return res.status(400).json({ error: 'E-posta ve şifre zorunlu.' });
  }

  if (
    email.trim().toLowerCase() !== String(validEmail || '').trim().toLowerCase() ||
    password !== String(validPassword || '')
  ) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.add(token);
  res.json({ token });
});

router.post('/logout', (req, res) => {
  const token = req.headers['x-auth-token'];
  if (token) activeSessions.delete(token);
  res.json({ ok: true });
});

module.exports = router;