'use strict';

const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const { spawn }  = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const cron       = require('node-cron');

// ─── Load env ─────────────────────────────────────────────────────────────────
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
  console.warn('dotenv bulunamadı, ortam değişkenleri platformdan okunuyor.');
}

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
app.set('supabase', supabase);


// ─── Tenant Middleware ────────────────────────────────────────────────────────
app.use(require('./middleware/tenant'));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',                require('./routes/auth'));
app.use('/api/invoices',            require('./routes/invoices'));
app.use('/api/save-invoice',        require('./routes/invoices'));
app.use('/api/invoice-items',       require('./routes/invoices'));
app.use('/api/chat', require('./routes/fatura-chat'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/tenant-vkn', require('./routes/settings'));
app.use('/api/products',            require('./routes/products'));
app.use('/api/category-templates',  require('./routes/products'));
app.use('/api/category-attributes', require('./routes/products'));
app.use('/api/product-attribute-values', require('./routes/products'));
app.use('/api/purchase-orders',     require('./routes/purchase-orders'));
app.use('/api/purchase-order-items',require('./routes/purchase-orders'));
app.use('/api/stocks',              require('./routes/stocks'));
app.use('/api/payments',            require('./routes/payments'));
app.use('/api/companies',           require('./routes/companies'));
app.use('/api/cari',                require('./routes/cari'));
app.use('/api/dmo',                 require('./routes/dmo'));
app.use('/api/debug-tcmb',          require('./routes/dmo'));
app.use('/api/quotes',              require('./routes/quotes'));
app.use('/api/product-groups',      require('./routes/quotes'));
app.use('/api/chat',                require('./routes/chat'));
app.use('/api/transcribe',          require('./routes/transcribe'));
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/integrations', require('./routes/integrations'));



// Invoice sync trigger routes (depend on sync-service)
const { runSync, runDailyRecheck } = require('./services/sync-service');
app.post('/api/invoices/sync-now', (req, res) => {
  try { runSync(); res.json({ ok: true, message: 'Sync started.' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/invoices/recheck-now', (req, res) => {
  try { runDailyRecheck(); res.json({ ok: true, message: 'Re-check started.' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});



// ─── Page Routes ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/landing', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'landing.html'))
);

app.get('/signup',     (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth', 'signup.html')));
app.get('/onboarding', (req, res) => res.sendFile(path.join(__dirname, 'public', 'auth', 'onboarding.html')));

app.get('/chat', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/login', (req, res) => res.redirect('/auth/login.html'));


// ─── Static Files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// ─── Cron Jobs ────────────────────────────────────────────────────────────────
const dmoRouter = require('./routes/dmo');

// 08:00 Turkey (05:00 UTC) — DMO EUR rate
cron.schedule('0 5 * * *', () => {
  console.log('Cron: DMO EUR rate fetching...');
  dmoRouter.fetchAndSaveDMORate(supabase);
});

// 15:40 Turkey (12:40 UTC) — TCMB USD/EUR rates
cron.schedule('40 12 * * *', () => {
  console.log('Cron: TCMB rates fetching...');
  dmoRouter.fetchAndSaveTCMBRates(supabase);
});

// Every 5 minutes — invoice sync
cron.schedule('*/360 * * * *', async () => {
  console.log('Cron: Invoice sync starting...');
  try { await runSync(); }
  catch (err) { console.error('Cron: Invoice sync failed:', err.message); }
});

const { runElogoSync, runElogoDailyRecheck } = require('./services/elogo-sync-service');

// In your existing 10-minute cron:
cron.schedule('*/60 * * * *', async () => {
  await runElogoSync();   // eLogo SOAP
});

// In your existing daily cron:
cron.schedule('0 6 * * *', async () => {
  await runDailyRecheck();
  await runElogoDailyRecheck();
});

// 06:00 Turkey (03:00 UTC) — daily invoice re-check
cron.schedule('0 3 * * *', async () => {
  console.log('Cron: Daily invoice re-check starting...');
  try { await runDailyRecheck(); }
  catch (err) { console.error('Cron: Daily re-check failed:', err.message); }
});

// ─── DMO Python Service ───────────────────────────────────────────────────────
let dmoPyProcess = null;

function startDmoPythonService() {
  const shouldAutoStart = String(process.env.DMO_PY_AUTOSTART || 'true').toLowerCase() !== 'false';
  if (!shouldAutoStart) { console.log('DMO Python auto-start kapalı.'); return; }

  const appPyPath = path.join(__dirname, 'app.py');
  if (!fs.existsSync(appPyPath)) { console.warn('DMO Python: app.py bulunamadı.'); return; }

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  dmoPyProcess = spawn(pythonCmd, [appPyPath], {
    cwd:   __dirname,
    env:   process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  dmoPyProcess.stdout.on('data', chunk => { const m = String(chunk || '').trim(); if (m) console.log(`[DMO-PY] ${m}`); });
  dmoPyProcess.stderr.on('data', chunk => { const m = String(chunk || '').trim(); if (m) console.warn(`[DMO-PY] ${m}`); });
  dmoPyProcess.on('exit', (code, signal) => {
    console.warn(`[DMO-PY] sonlandı (code=${code}, signal=${signal || '-'})`);
    dmoPyProcess = null;
  });

  console.log('DMO Python servisi başlatıldı (python3 app.py).');
}

function stopDmoPythonService() {
  if (dmoPyProcess && !dmoPyProcess.killed) dmoPyProcess.kill('SIGTERM');
}

process.on('SIGINT',  () => { stopDmoPythonService(); process.exit(0); });
process.on('SIGTERM', () => { stopDmoPythonService(); process.exit(0); });

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Supabase URL Check:', process.env.SUPABASE_URL ? 'Loaded ✅' : 'Not Found ❌');
  startDmoPythonService();
});