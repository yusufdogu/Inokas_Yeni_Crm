// routes/dmo.js
'use strict';

const express = require('express');
const http    = require('http');
const router  = express.Router();

const DMO_PY_HOST = process.env.DMO_PY_HOST || '127.0.0.1';
const DMO_PY_PORT = Number(process.env.DMO_PY_PORT || 5000);

// ─── TCMB helpers ────────────────────────────────────────────────────────────
async function fetchAndSaveTCMBRates(supabase) {
  try {
    const usdRegex = /CurrencyCode="USD"[\s\S]*?<ForexBuying>([\d.]+)<\/ForexBuying>/;
    const eurRegex = /CurrencyCode="EUR"[\s\S]*?<ForexBuying>([\d.]+)<\/ForexBuying>/;
    let usd_try = null, eur_try = null, foundDate = null;

    for (let daysBack = 0; daysBack <= 5; daysBack++) {
      const date = new Date();
      date.setDate(date.getDate() - daysBack);
      const dd   = String(date.getDate()).padStart(2, '0');
      const mm   = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      const url  = daysBack === 0
        ? 'https://www.tcmb.gov.tr/kurlar/today.xml'
        : `https://www.tcmb.gov.tr/kurlar/${yyyy}${mm}/${dd}${mm}${yyyy}.xml`;

      const res  = await fetch(url);
      const body = await res.text();
      const usdMatch = body.match(usdRegex);
      const eurMatch = body.match(eurRegex);

      if (usdMatch && eurMatch) {
        usd_try   = parseFloat(usdMatch[1]);
        eur_try   = parseFloat(eurMatch[1]);
        foundDate = `${yyyy}-${mm}-${dd}`;
        console.log(`TCMB: ${foundDate} — USD ${usd_try} EUR ${eur_try}`);
        break;
      }
      console.log(`TCMB: ${yyyy}-${mm}-${dd} verisi yok, önceki güne bakılıyor...`);
    }

    if (!usd_try || !eur_try || !foundDate) {
      console.error('TCMB: Son 5 gün için kur bulunamadı');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await supabase.from('rate_history').select('id').gte('recorded_at', today + 'T00:00:00').lte('recorded_at', today + 'T23:59:59').maybeSingle();

    if (existing) {
      await supabase.from('rate_history').update({ usd_try, eur_try, rate_date: foundDate }).eq('id', existing.id);
      console.log(`TCMB güncellendi: USD ${usd_try} EUR ${eur_try}`);
    } else {
      await supabase.from('rate_history').insert({ usd_try, eur_try, rate_date: foundDate });
      console.log(`TCMB eklendi: USD ${usd_try} EUR ${eur_try}`);
    }
  } catch (err) {
    console.error('TCMB fetch hatası:', err.message);
  }
}

async function fetchAndSaveDMORate(supabase) {
  try {
    const { data: product } = await supabase.from('products').select('id').eq('dmo_code', '106776').maybeSingle();
    if (!product) { console.error('DMO rate: 106776 ürünü bulunamadı'); return; }

    const res  = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/find-dmo-url`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ dmo_code: '106776', product_id: product.id })
    });
    const data = await res.json();
    if (!data.price) { console.error('DMO rate: fiyat alınamadı', data); return; }

    const dmo_eur_try   = (data.price / 1.08) / 355;
    const today         = new Date().toISOString().slice(0, 10);
    const dmo_rate_date = today;

    const { data: existing } = await supabase.from('rate_history').select('id').gte('recorded_at', today + 'T00:00:00').lte('recorded_at', today + 'T23:59:59').maybeSingle();

    if (existing) {
      await supabase.from('rate_history').update({ dmo_eur_try, dmo_rate_date }).eq('id', existing.id);
    } else {
      await supabase.from('rate_history').insert({ dmo_eur_try, dmo_rate_date });
    }
    console.log(`DMO EUR/TRY güncellendi: ${dmo_eur_try}`);
  } catch (err) {
    console.error('DMO rate fetch hatası:', err.message);
  }
}

// Export helpers so index.js cron jobs can use them
module.exports.fetchAndSaveTCMBRates = fetchAndSaveTCMBRates;
module.exports.fetchAndSaveDMORate   = fetchAndSaveDMORate;

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/dmo/parse-pdf  — proxy to Python
router.post('/parse-pdf', (req, res) => {
  const proxyReq = http.request({
    hostname: DMO_PY_HOST,
    port:     DMO_PY_PORT,
    path:     '/parse-pdf',
    method:   'POST',
    headers:  { ...req.headers, host: `${DMO_PY_HOST}:${DMO_PY_PORT}` }
  }, proxyRes => {
    res.status(proxyRes.statusCode || 502);
    Object.entries(proxyRes.headers || {}).forEach(([k, v]) => { if (v !== undefined) res.setHeader(k, v); });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', err => {
    console.error('DMO parse-pdf proxy hatası:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'DMO parse servisine bağlanılamadı.' });
  });
  req.pipe(proxyReq);
});

// GET /api/dmo/rates
router.get('/rates', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data: dmoRow  } = await supabase.from('rate_history').select('dmo_eur_try, recorded_at').not('dmo_eur_try', 'is', null).order('recorded_at', { ascending: false }).limit(1).maybeSingle();
    const { data: tcmbRow } = await supabase.from('rate_history').select('usd_try, eur_try, recorded_at').not('usd_try', 'is', null).not('eur_try', 'is', null).order('recorded_at', { ascending: false }).limit(1).maybeSingle();
    res.json({
      usd_try:       tcmbRow?.usd_try      || null,
      eur_try:       tcmbRow?.eur_try      || null,
      dmo_eur_try:   dmoRow?.dmo_eur_try   || null,
      rate_date:     tcmbRow?.rate_date    || null,
      dmo_rate_date: dmoRow?.dmo_rate_date || null,
    });
  } catch (err) {
    console.error('rates endpoint hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dmo/fetch-tcmb-now
router.post('/fetch-tcmb-now', async (req, res) => {
  await fetchAndSaveTCMBRates(req.app.get('supabase'));
  res.json({ ok: true });
});

// POST /api/dmo/fetch-dmo-rate-now
router.post('/fetch-dmo-rate-now', async (req, res) => {
  await fetchAndSaveDMORate(req.app.get('supabase'));
  res.json({ ok: true });
});

// POST /api/dmo/find-dmo-url  — proxy to Python
router.post('/find-dmo-url', async (req, res) => {
  try {
    const r    = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/find-dmo-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
    const text = await r.text();
    res.status(r.status).setHeader('content-type', r.headers.get('content-type') || 'application/json; charset=utf-8').send(text);
  } catch (err) {
    console.error('DMO find-url proxy hatası:', err.message);
    res.status(502).json({ error: 'DMO servisine bağlanılamadı.' });
  }
});

// POST /api/dmo/scrape-dmo-prices  — proxy to Python
router.post('/scrape-dmo-prices', async (req, res) => {
  try {
    const r    = await fetch(`http://${DMO_PY_HOST}:${DMO_PY_PORT}/scrape-dmo-prices`, { method: 'POST' });
    const text = await r.text();
    res.status(r.status).setHeader('content-type', r.headers.get('content-type') || 'application/json; charset=utf-8').send(text);
  } catch (err) {
    console.error('DMO scrape proxy hatası:', err.message);
    res.status(502).json({ error: 'DMO scrape servisine bağlanılamadı.' });
  }
});

// GET /api/debug-tcmb
router.get('/debug-tcmb', async (req, res) => {
  try {
    const r    = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml');
    const text = await r.text();
    res.send(`<pre>STATUS: ${r.status}\n\nBODY:\n${text.slice(0, 3000)}</pre>`);
  } catch (err) {
    res.send('ERROR: ' + err.message);
  }
});

module.exports = router;