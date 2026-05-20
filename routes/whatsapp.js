// routes/whatsapp.js
'use strict';

const express   = require('express');
const router    = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const twilio    = require('twilio');

const client       = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const conversations    = new Map();
const CONVERSATION_TTL = 30 * 60 * 1000;

const SYSTEM_PROMPT = `Sen İnokas CRM'nin WhatsApp teknik destek asistanısın. Türkçe konuşuyorsun.

Görevin: Müşteriden teknik sorun bilgilerini doğal bir sohbet ile toplamak.

Toplaман gereken bilgiler:
1. Adı soyadı
2. Şirket adı (yoksa atla)
3. Hangi ürün/cihaz sorunlu (marka + model olursa çok iyi, örn: "Epson L3150")
4. Sorunun açıklaması
5. Aciliyet (çok acil mi, normal mi?)

KURALLAR:
- Nazik ve kısa cevaplar ver
- Tek seferde çok soru sorma, birer birer sor
- Müşteri zaten bazı bilgileri verdiyse tekrar sorma
- Tüm bilgileri topladığında şunu söyle: "Talebinizi aldım, en kısa sürede teknik ekibimiz sizinle iletişime geçecek. Teşekkürler!"
- Bilgileri topladığında yanıtının sonuna şunu ekle (müşteri görmez, sadece sistem okur):

[TICKET_READY]
{
  "customer_name": "...",
  "company_name": "...",
  "product": "...",
  "issue_description": "...",
  "priority": "acil|normal|düşük"
}
[/TICKET_READY]

E�er müşteri konudan çok uzaklaşırsa nazikçe teknik destek konusuna geri getir.`;

function extractTicket(text) {
  const match = text.match(/\[TICKET_READY\]([\s\S]*?)\[\/TICKET_READY\]/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch { return null; }
}

function cleanResponse(text) {
  return text.replace(/\[TICKET_READY\][\s\S]*?\[\/TICKET_READY\]/g, '').trim();
}

async function sendReply(to, body) {
  await twilioClient.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`, to, body,
  });
}

async function saveTicket(supabase, phone, ticket, thread, tenantId) {
  const { data, error } = await supabase
    .from('technical_issues')
    .insert({
      phone,
      customer_name:     ticket.customer_name    || null,
      company_name:      ticket.company_name      || null,
      product:           ticket.product           || null,
      issue_description: ticket.issue_description || null,
      priority:          ['acil','normal','düşük'].includes(ticket.priority) ? ticket.priority : 'normal',
      status:            'bekliyor',
      whatsapp_thread:   thread,
      tenant_id:         tenantId,
    })
    .select('id').single();
  if (error) throw error;
  return data.id;
}

// POST /api/whatsapp/webhook — no tenant auth (public webhook from Twilio)
router.post('/webhook', async (req, res) => {
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');

  const supabase    = req.app.get('supabase');
  const incomingMsg = String(req.body?.Body || '').trim();
  const from        = String(req.body?.From || '').trim();
  const phone       = from.replace('whatsapp:', '');

  if (!incomingMsg || !from) return;

  // For webhook, use a default tenant (İnokas)
  // In future: look up tenant by WhatsApp number
  const { data: defaultTenant } = await supabase.from('tenants').select('id').eq('slug', 'inokas').single();
  const tenantId = defaultTenant?.id;
  if (!tenantId) { console.error('[WhatsApp] Default tenant not found'); return; }

  console.log(`[WhatsApp] ${phone}: ${incomingMsg}`);

  if (!conversations.has(phone)) {
    conversations.set(phone, { messages: [], issue_id: null, collected: false, lastActive: Date.now() });
  }

  const conv = conversations.get(phone);
  if (Date.now() - conv.lastActive > CONVERSATION_TTL) {
    conv.messages = []; conv.issue_id = null; conv.collected = false;
  }
  conv.lastActive = Date.now();

  if (conv.collected) {
    await sendReply(from, 'Teknik destek talebiniz zaten alınmıştır. Ekibimiz yakında sizinle iletişime geçecek.');
    return;
  }

  conv.messages.push({ role: 'user', content: incomingMsg });

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 512,
      system: SYSTEM_PROMPT, messages: conv.messages,
    });

    const rawText   = response.content.find(b => b.type === 'text')?.text || '';
    const cleanText = cleanResponse(rawText);
    const ticket    = extractTicket(rawText);

    conv.messages.push({ role: 'assistant', content: rawText });
    if (cleanText) await sendReply(from, cleanText);

    if (ticket && !conv.collected) {
      conv.collected = true;
      const issueId  = await saveTicket(supabase, phone, ticket, conv.messages.map(m => ({
        role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })), tenantId);
      conv.issue_id = issueId;
      console.log(`[WhatsApp] Ticket saved: ${issueId} for ${phone}`);
    }
  } catch (err) {
    console.error('[WhatsApp] Error:', err.message);
    try { await sendReply(from, 'Üzgünüz, bir hata oluştu. Lütfen tekrar deneyin.'); } catch {}
  }
});

// GET /api/whatsapp/issues
router.get('/issues', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const status   = req.query.status;

    let query = supabase
      .from('technical_issues')
      .select('id, created_at, customer_name, phone, company_name, product, issue_description, priority, status, notes, resolved_at')
      .eq('tenant_id', req.tenantId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[WhatsApp] issues fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/whatsapp/issues/:id
router.get('/issues/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data, error } = await supabase
      .from('technical_issues').select('*').eq('id', req.params.id).eq('tenant_id', req.tenantId).single();
    if (error || !data) return res.status(404).json({ error: 'Kayıt bulunamadı' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/whatsapp/issues/:id
router.put('/issues/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { status, notes, priority } = req.body;
    const updates  = {};

    if (status) {
      if (!['bekliyor','inceleniyor','çözüldü','kapatıldı'].includes(status))
        return res.status(400).json({ error: 'Geçersiz durum' });
      updates.status = status;
      if (status === 'çözüldü' || status === 'kapatıldı') updates.resolved_at = new Date().toISOString();
    }
    if (notes    !== undefined) updates.notes    = notes;
    if (priority !== undefined) updates.priority = priority;

    const { error } = await supabase
      .from('technical_issues').update(updates).eq('id', req.params.id).eq('tenant_id', req.tenantId);
    if (error) throw error;
    res.json({ message: 'Güncellendi' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;