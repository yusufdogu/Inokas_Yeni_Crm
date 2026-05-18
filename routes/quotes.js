// routes/quotes.js
'use strict';

const express   = require('express');
const router    = express.Router();
const path      = require('path');
const fs        = require('fs');
const puppeteer = require('puppeteer-core');

const BUCKET    = 'quotes-pdf';
const LOGO_PATH = path.join(__dirname, '..', 'public', 'assests', 'inokas_bilgi_sistemleri_for_pdf.jpeg');

function getSupabase(req) { return req.app.get('supabase'); }

// ─── Ref No ───────────────────────────────────────────────────────────────────
async function getNextRefNo(supabase) {
  const year = new Date().getFullYear();
  const { data } = await supabase
    .from('quotes').select('reference_no')
    .like('reference_no', `${year}-%`)
    .order('created_at', { ascending: false }).limit(1);
  if (!data || !data.length) return `${year}-1`;
  const last = parseInt((data[0].reference_no || '').split('-')[1] || '0', 10);
  return `${year}-${last + 1}`;
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────
function logoBase64() {
  try {
    return `data:image/jpeg;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  } catch { return ''; }
}

function formatMoney(n) {
  return '₺' + (parseFloat(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function buildPdfHtml(qt, logo) {
  const companyLines = (qt.company_name || '').split('\n').map(l => l.trim()).filter(Boolean);
  const items = (qt.quote_items || []).sort((a, b) => a.sort_order - b.sort_order);

  const FOOTER = `
    <div style="position:absolute;bottom:28px;right:36px;text-align:center;font-size:8px;color:#444;line-height:1.6;">
      <strong>İNOKAS BİLGİ SİSTEMLERİ VE DANIŞMANLIK HİZMETLERİ TİC. LTD. ŞTİ.</strong><br>
      Eti Mah. Ali Suavi Cad. No:24/A Çankaya/ANKARA<br>
      Tel: 0312 446 00 35 &nbsp;|&nbsp; Faks: 0312 446 00 85<br>
      Mal No.: 178 055 2998 &nbsp;|&nbsp; Mersis No.: 0478055299800018
    </div>`;

  const HEADER = `
    <div style="padding:28px 36px 0;">
      ${logo ? `<img src="${logo}" style="height:56px;object-fit:contain;">` : ''}
    </div>
    <hr style="border:none;border-top:1px solid #ccc;margin:12px 36px 0;">`;

  const page1 = `
  <div style="position:relative;width:210mm;min-height:297mm;font-family:'Times New Roman',serif;font-size:11pt;color:#000;page-break-after:always;">
    ${HEADER}
    <div style="padding:0 36px;">
      <div style="text-align:center;margin-top:40px;">
        ${companyLines.map(l => `<p style="font-weight:bold;margin:4px 0;font-size:12pt;">${l}</p>`).join('')}
      </div>
      <div style="text-align:right;margin-top:24px;font-size:10.5pt;">${formatDate(qt.quote_date)}</div>
      <div style="margin-top:28px;">
        <p><strong>KONU : Yaklaşık Maliyet Fiyat Teklifi</strong></p>
        <p><strong>Ref No: ${qt.reference_no || ''}</strong></p>
      </div>
      <div style="margin-top:32px;"><p>Sayın ilgili;</p></div>
      <div style="margin-top:20px;line-height:1.8;">
        <p>İlgili projeniz kapsamında ihtiyacınız olan ürünler ve hizmetler için hazırlamış olduğumuz teklifimiz ekte görüş</p>
        <p>ve değerlendirmelerinize sunulmuştur.</p>
        <p>Teklifimiz ile ilgili her türlü soru ve görüşlerinizi lütfen bizimle paylaşınız.</p>
      </div>
      <div style="margin-top:28px;"><p>Saygılarımızla…</p></div>
      ${qt.notes ? `<div style="margin-top:20px;"><p>${qt.notes.replace(/\n/g, '<br>')}</p></div>` : ''}
      <div style="margin-top:60px;">
        <p><strong>TEKLİFE İLİŞKİN GENEL HUSUSLAR;</strong></p>
        <p>1)Teklifimizdeki fiyatlara KDV dahil değildir.</p>
      </div>
    </div>
    ${FOOTER}
  </div>`;

  const TH = `background:#c00000;color:#fff;font-weight:bold;padding:7px 6px;text-align:center;border:1px solid #999;font-size:9pt;`;
  const td = (align = 'center') => `padding:6px 5px;border:1px solid #bbb;text-align:${align};font-size:9pt;font-weight:bold;`;

  const rows = items.map((it, i) => `
    <tr>
      <td style="${td()}">${i + 1}</td>
      <td style="${td()}">${it.product_code || ''}</td>
      <td style="${td('left')}">${it.product_name || ''}</td>
      <td style="${td()}">${it.unit || 'ADET'}</td>
      <td style="${td()}">${it.quantity}</td>
      <td style="${td('right')}">${formatMoney(it.unit_price)}</td>
      <td style="${td('right')}">${formatMoney(it.total_price)}</td>
    </tr>`).join('');

  const total = items.reduce((s, it) => s + (parseFloat(it.total_price) || 0), 0);

  const page2 = `
  <div style="position:relative;width:210mm;min-height:297mm;font-family:'Times New Roman',serif;color:#000;">
    ${HEADER}
    <div style="padding:20px 36px 0;">
      <p style="text-align:center;font-weight:bold;font-size:13pt;margin-bottom:20px;">Yaklaşık Maliyet Fiyat Teklifi</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="${TH}width:5%;">SIRA NO</th>
            <th style="${TH}width:13%;">ÜRÜN KODU</th>
            <th style="${TH}">ÜRÜN AÇIKLAMASI</th>
            <th style="${TH}width:7%;">BİRİM</th>
            <th style="${TH}width:7%;">MİKTAR</th>
            <th style="${TH}width:12%;">B.FİYAT</th>
            <th style="${TH}width:13%;">TOPLAM FİYAT</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr>
            <td colspan="5" style="${td('right')}">TOPLAM FİYAT(KDV HARİÇ)</td>
            <td colspan="2" style="${td('right')}">${formatMoney(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    ${FOOTER}
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>* { box-sizing:border-box; margin:0; padding:0; } body { background:#fff; }</style>
  </head><body>${page1}${page2}</body></html>`;
}

async function generateAndStorePdf(supabase, quoteId) {
  const { data: qt } = await supabase
    .from('quotes').select('*, quote_items(*)')
    .eq('id', quoteId).single();
  if (!qt) return null;

  qt.quote_items = (qt.quote_items || []).sort((a, b) => a.sort_order - b.sort_order);

  const html    = buildPdfHtml(qt, logoBase64());
  const { execSync } = require('child_process');
  let chromePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!chromePath) {
    const candidates = [
      '/run/current-system/sw/bin/chromium',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/nix/var/nix/profiles/default/bin/chromium',
    ];
    for (const c of candidates) {
      try { execSync(`test -f ${c}`); chromePath = c; break; } catch {}
    }
  }
  if (!chromePath) {
    try { chromePath = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null', { encoding: 'utf8' }).trim(); } catch {}
  }
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const pg      = await browser.newPage();
  await pg.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuf  = await pg.pdf({ format: 'A4', printBackground: true });
  await browser.close();

  const fileName = `teklif-${qt.reference_no || quoteId}.pdf`;
  await supabase.storage.from(BUCKET).remove([fileName]);
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(fileName, pdfBuf, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw upErr;

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
  const pdfUrl = urlData.publicUrl;

  await supabase.from('quotes').update({ pdf_url: pdfUrl }).eq('id', quoteId);
  return pdfUrl;
}

// ─── GET /debug-chrome ───────────────────────────────────────────────────────
router.get('/debug-chrome', (req, res) => {
  const { execSync } = require('child_process');
  const checks = {};
  ['which chromium', 'which chromium-browser', 'which google-chrome', 'ls /usr/bin/chrom*', 'ls /run/current-system/sw/bin/'].forEach(cmd => {
    try { checks[cmd] = execSync(cmd, { encoding: 'utf8' }).trim(); } catch (e) { checks[cmd] = 'NOT FOUND'; }
  });
  res.json(checks);
});

// ─── GET /next-ref-no ─────────────────────────────────────────────────────────
router.get('/next-ref-no', async (req, res) => {
  try {
    res.json({ reference_no: await getNextRefNo(getSupabase(req)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET / ────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { q, status } = req.query;
    let query = supabase.from('quotes').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    let list = data || [];
    if (q) {
      const ql = q.toLocaleLowerCase('tr-TR');
      list = list.filter(qt =>
        (qt.reference_no || '').toLocaleLowerCase('tr-TR').includes(ql) ||
        (qt.company_name || '').toLocaleLowerCase('tr-TR').includes(ql)
      );
    }
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /product-groups/list ─────────────────────────────────────────────────
router.get('/product-groups/list', async (req, res) => {
  try {
    const { data, error } = await getSupabase(req).from('product_groups').select('*').order('group_name');
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /product-groups/:id/items ───────────────────────────────────────────
router.get('/product-groups/:id/items', async (req, res) => {
  try {
    const { data, error } = await getSupabase(req).from('product_group_items')
      .select('*').eq('group_id', req.params.id).order('sort_order');
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /:id/pdf ─────────────────────────────────────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { data: qt, error } = await supabase.from('quotes').select('id, pdf_url, reference_no')
      .eq('id', req.params.id).single();
    if (error || !qt) return res.status(404).json({ error: 'Teklif bulunamadı.' });

    if (qt.pdf_url) return res.redirect(qt.pdf_url);

    // pdf_url yoksa anlık üret
    const url = await generateAndStorePdf(supabase, req.params.id);
    if (url) return res.redirect(url);
    res.status(500).json({ error: 'PDF oluşturulamadı.' });
  } catch (err) {
    console.error('PDF hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await getSupabase(req).from('quotes')
      .select('*, quote_items(*)').eq('id', req.params.id).single();
    if (error || !data) return res.status(404).json({ error: 'Teklif bulunamadı.' });
    data.quote_items = (data.quote_items || []).sort((a, b) => a.sort_order - b.sort_order);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST / ───────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { company_id, company_name, quote_date, valid_until, currency, status, notes, items } = req.body;
    const reference_no    = await getNextRefNo(supabase);
    const total_excl_tax  = (items || []).reduce((s, it) => s + (parseFloat(it.total_price) || 0), 0);

    const { data: quote, error: qErr } = await supabase.from('quotes')
      .insert({ reference_no, company_id: company_id || null, company_name, quote_date, valid_until, currency: currency || 'TRY', status: status || 'pending', notes, total_excl_tax })
      .select().single();
    if (qErr) throw qErr;

    if (items && items.length) {
      const rows = items.map((it, i) => ({
        quote_id: quote.id, sort_order: i + 1,
        product_code: it.product_code || null, product_name: it.product_name,
        unit: it.unit || 'ADET', quantity: parseFloat(it.quantity) || 1,
        unit_price: parseFloat(it.unit_price) || 0, total_price: parseFloat(it.total_price) || 0,
      }));
      const { error: iErr } = await supabase.from('quote_items').insert(rows);
      if (iErr) throw iErr;
    }

    res.status(201).json(quote);

    // PDF arka planda üret
    generateAndStorePdf(supabase, quote.id).catch(e => console.error('PDF üretim hatası:', e.message));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { company_id, company_name, quote_date, valid_until, currency, status, notes, items } = req.body;
    const id = req.params.id;
    const total_excl_tax = (items || []).reduce((s, it) => s + (parseFloat(it.total_price) || 0), 0);

    const { error: qErr } = await supabase.from('quotes')
      .update({ company_id: company_id || null, company_name, quote_date, valid_until, currency, status, notes, total_excl_tax, pdf_url: null })
      .eq('id', id);
    if (qErr) throw qErr;

    if (items) {
      await supabase.from('quote_items').delete().eq('quote_id', id);
      if (items.length) {
        const rows = items.map((it, i) => ({
          quote_id: id, sort_order: i + 1,
          product_code: it.product_code || null, product_name: it.product_name,
          unit: it.unit || 'ADET', quantity: parseFloat(it.quantity) || 1,
          unit_price: parseFloat(it.unit_price) || 0, total_price: parseFloat(it.total_price) || 0,
        }));
        const { error: iErr } = await supabase.from('quote_items').insert(rows);
        if (iErr) throw iErr;
      }
    }

    res.json({ ok: true });

    // PDF arka planda yeniden üret
    generateAndStorePdf(supabase, id).catch(e => console.error('PDF üretim hatası:', e.message));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PUT /:id/status ──────────────────────────────────────────────────────────
router.put('/:id/status', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { status } = req.body;
    if (!['draft', 'pending', 'accepted', 'rejected'].includes(status))
      return res.status(400).json({ error: 'Geçersiz durum.' });
    const { error } = await supabase.from('quotes').update({ status }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const supabase = getSupabase(req);
    const { data: qt } = await supabase.from('quotes').select('reference_no, pdf_url').eq('id', req.params.id).single();
    if (qt?.reference_no) {
      await supabase.storage.from(BUCKET).remove([`teklif-${qt.reference_no}.pdf`]);
    }
    await supabase.from('quote_items').delete().eq('quote_id', req.params.id);
    const { error } = await supabase.from('quotes').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
