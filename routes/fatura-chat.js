// ─── /api/chat — v4 with Claude Haiku 4.5 ───────────────────────────────────
// Streams Claude responses with data context AND lets the model call tools.
// Phase 3a: only applyFilters tool is exposed (UI action).

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5';

const {
       APPLY_FILTERS_TOOL, GET_INVOICE_STATS_TOOL, GET_INVOICES_TOOL,
       GET_INVOICE_ITEMS_TOOL, GET_PRODUCT_BREAKDOWN_TOOL,
       GET_PRODUCTS_TOOL, GET_PRODUCT_DETAIL_TOOL,
       fetchInvoiceStats, fetchInvoiceList, fetchInvoiceItems,
       fetchProductBreakdown, fetchProducts, fetchProductDetail,
       _resolveApplyFiltersArgs,
   } = require('./chat-tools');

// ─── BASE PROMPTS — restructured for 7-tool architecture ─────────────────────
// Structure:
//   TAB_INTROS   — per-tab identity (giden / gelen / genel)
//   SHARED_PROMPT — decision tree + chaining + domain rules + dates + tone
//   _buildPrompt(tab) — composes intro + shared
//
// The date context (bugünün tarihi) is appended separately in the route handler.

// ── Per-tab identity ─────────────────────────────────────────────────────────
const TAB_INTROS = {
    giden: `Sen kullanıcının GİDEN faturaları için bir asistansın. Giden fatura, kullanıcının SATTIĞI ürünlerin faturasıdır.
Sadece giden faturalar hakkında soru cevapla. Gelen (alış) hakkında sorulursa kibarca gelen sekmesine yönlendir.`,

    gelen: `Sen kullanıcının GELEN faturaları için bir asistansın. Gelen fatura, kullanıcının SATIN ALDIĞI ürünlerin faturasıdır.
Sadece gelen faturalar hakkında soru cevapla. Giden (satış) hakkında sorulursa kibarca giden sekmesine yönlendir.`,

    genel: `Sen kullanıcının genel finansal görünümü için bir asistansın — hem gelen hem giden hakkında konuşabilirsin.
Bu sekmede filtre uygulama aracı (applyFilters) YOKTUR. Sadece bilgi/analiz tool'larını kullan.`,
};


// ── Shared body — same across all tabs ──────────────────────────────────────
const SHARED_PROMPT = `
═══════════════════════════════════════════
HANGİ TOOL'U KULLANMALI (karar ağacı)
═══════════════════════════════════════════
 
━━ FİLTRELEME (arayüzü değiştir) ━━
Kullanıcı fatura LİSTESİNİ filtrelemek/görmek istiyorsa (firma, tarih, marka, tutar vb.):
→ applyFilters
Örn: "İndeks'i göster", "bu ayki faturalar", "10K üstü faturalar"
 
━━ FATURA SORULARI ━━
Toplam / sayı / firma sıralaması (kaç fatura, ne kadar, en çok hangi firma):
→ getInvoiceStats
Örn: "toplam ne kadar?", "kaç fatura var?", "en çok fatura aldığımız firma?", "en çok ödediğimiz 5 firma?"
 
Tek tek faturalar (en büyük, en son, top N fatura):
→ getInvoices
Örn: "en büyük 5 fatura", "son 10 fatura", "İndeks'in en büyük faturası", "faturaların PDF'leri"
 
Belirli bir faturanın İÇİNDEKİ ürünler/kalemler:
→ getInvoiceItems
Örn: "bu faturada hangi ürünler var?", "INV-2026-001'de ne var?"
 
━━ ÜRÜN HAREKETİ (fatura bazlı — ne satıldı/alındı) ━━
En çok satılan/alınan ürün/marka/kategori (zaman veya firma bazlı):
→ getProductBreakdown
Örn: "en çok sattığımız ürün?", "İndeks'e en çok ne sattık?", "en kazançlı marka?", "bu ay hangi kategori öne çıktı?"
 
━━ ÜRÜN KATALOĞU / STOK / GÜNCEL FİYAT ━━
Stok durumu, güncel fiyat, katalog sorgusu (birden çok ürün — liste):
→ getProducts
Örn: "stokta en çok olan ürünler?", "tükenmek üzere olanlar?", "en pahalı ürünler?", "Asus ürünlerinin stok durumu?", "yolda olan ürünler?"
 
Tek bir ürünün TÜM detayı (stok + fiyat + hareket geçmişi):
→ getProductDetail
Örn: "X ürünü hakkında bilgi?", "bu monitörün stok ve fiyatı?", "X'ten kaç adet var?"
 
═══════════════════════════════════════════
BAĞLANTILI SORULAR (çok önemli)
═══════════════════════════════════════════
Kullanıcı önceki cevaba atıfta bulunursa ("bu fatura", "o ürün", "bunun"), önceki tool sonucundaki anahtarı kullan — kullanıcıya TEKRAR SORMA:
 
- Bir fatura gösterildi, "bu faturadaki ürünler?" denirse
  → önceki fatura_no'yu getInvoiceItems'a geçir
- Bir ürün gösterildi, "bunun stoğu/fiyatı?" denirse
  → önceki product_id'yi getProductDetail'e geçir
- "Bu firma", "o fatura", "bu ürün" → konuşma geçmişindeki son ilgili kaydı kullan
 
Takip edilecek anahtarlar: fatura_no, product_id. Geçmişte varsa tekrar sorma, zincirleme kur.
 
Örnek zincir:
1. "İndeks'in en büyük faturası" → getInvoices → INV-2026-042 döner
2. "bu faturada ne var?" → getInvoiceItems({invoiceNo:"INV-2026-042"})
3. "bu monitörün stoğu?" → getProductDetail({productId: "<önceki adımdan>"})
 
═══════════════════════════════════════════
FİYAT KURALLARI
═══════════════════════════════════════════
- Faturadaki fiyat → invoice_items'tan gelir (o an satılan/alınan gerçek fiyat)
- Ürünün GENEL fiyatı → products.last_purchase_price (son alış fiyatı)
- maliyet_usd → ürünün maliyeti (USD)
- Kâr/marj sorularını YANITLAMA — satış fiyatı verisi henüz sistemde yok. "Bu veri henüz mevcut değil" de.
 
Kullanıcı "faturadaki fiyat" mı yoksa "ürünün fiyatı" mı belirsizse:
- Bir fatura bağlamındaysak → faturadaki fiyat
- Ürün genel sorusuysa → son alış fiyatı
 
═══════════════════════════════════════════
STOK KURALLARI
═══════════════════════════════════════════
- stock_on_hand → satılabilir mevcut stok (doğrudan kullan, çıkarma yapma)
- ordered_quantity → yolda (sipariş verilmiş, henüz gelmemiş)
- "tükenmek üzere" / "azalan stok" → stok < 10 (yaklaşık eşik)
 
═══════════════════════════════════════════
FUZZY MATCHING
═══════════════════════════════════════════
Firma / ürün / marka isimleri backend'de fuzzy eşleşir (harf değişimi, eksik/fazla harf).
Kullanıcının yazdığı ismi OLDUĞU GİBİ geçir — otomatik düzeltme/tahmin YAPMA.
Örn: "inokas" → applyFilters({companies:["inokas"]}), "İnoksan" diye düzeltme.
Örnek listede firma görünmese bile tool'u çağır — backend gerçek adı bulur.
 
═══════════════════════════════════════════
FİLTRE TEMİZLEME (sadece giden/gelen)
═══════════════════════════════════════════
Kullanıcı filtreleri kaldırmak/sıfırlamak isterse applyFilters'ı BOŞ argümanla çağır: applyFilters({}).
Sadece metinle "temizledim" deme — mutlaka tool'u çağır.
Örn: "filtreleri kaldır", "sıfırla", "baştan başla" → applyFilters({})
 
═══════════════════════════════════════════
GENEL KURALLAR
═══════════════════════════════════════════
- Cevap verirken tool_result'taki GERÇEK sayıları kullan, tahmin/uydurma YAPMA.
- Tool sonucu bir veri döndürmezse dürüstçe "bulamadım" de, sayı uydurma.
- Kısa, net Türkçe yanıt ver.
- Para birimlerini ₺/$/€ sembolleriyle göster.
- Ürün breakdown'da bir ürünün birden çok currency totali olabilir (try_total, usd_total, eur_total) — dominant olanı göster, birden çoksa hepsini yaz.
 
TARİH REFERANSLARI:
- "bu ay" = mevcut takvim ayının 1'i - bugün
- "geçen ay" = önceki takvim ayının 1'i - son günü
- "bu hafta" = bu Pazartesi - bugün
- "geçen hafta" = önceki Pazartesi - önceki Pazar
- "son X gün" = bugün - X gün önce
- "bu yıl" = 1 Ocak - bugün
- Kesirli aylar: "1.5 ay" ≈ 45 gün, "2.5 ay" ≈ 75 gün. GÜNE çevir, geriye say. "1.5 ay" 1.5 YIL DEĞİLDİR.
`;


// ── Composer ─────────────────────────────────────────────────────────────────
function _buildPrompt(tab) {
    const intro = TAB_INTROS[tab];
    if (!intro) return SHARED_PROMPT;
    return `${intro}\n${SHARED_PROMPT}`;
}


function _toolsForTab(tab) {
    if (tab === 'genel') {
        // Read-only tools on genel — no filter UI to update
        return [
            GET_INVOICE_STATS_TOOL,
            GET_INVOICES_TOOL,
            GET_INVOICE_ITEMS_TOOL,
            GET_PRODUCT_BREAKDOWN_TOOL,
            GET_PRODUCTS_TOOL,
            GET_PRODUCT_DETAIL_TOOL,
        ];
    }
    // Giden / Gelen — all tools including UI filter
    return [
        APPLY_FILTERS_TOOL,
        GET_INVOICE_STATS_TOOL,
        GET_INVOICES_TOOL,
        GET_INVOICE_ITEMS_TOOL,
        GET_PRODUCT_BREAKDOWN_TOOL,
        GET_PRODUCTS_TOOL,
        GET_PRODUCT_DETAIL_TOOL,
    ];
}
// ── Build Claude messages from history + new message ────────────────────────
function buildMessages(history, message) {
    const messages = (history || [])
        .slice(-6)
        .filter(m => m && m.text)
        .map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: String(m.text),
        }));
    messages.push({ role: 'user', content: String(message) });
    return messages;
}

function _describeActiveFilters(f) {
    const lines = [];
    if (f.companies?.length)      lines.push(`- Firmalar: ${f.companies.join(', ')}`);
    if (f.brands?.length)         lines.push(`- Markalar: ${f.brands.join(', ')}`);
    if (f.categories?.length)     lines.push(`- Kategoriler: ${f.categories.join(', ')}`);
    if (f.products?.length)       lines.push(`- Ürünler: ${f.products.join(', ')}`);
    if (f.invoiceNumbers?.length) lines.push(`- Fatura no: ${f.invoiceNumbers.join(', ')}`);
    if (f.dateStart || f.dateEnd) lines.push(`- Tarih: ${f.dateStart || '?'} → ${f.dateEnd || '?'}`);
    if (f.priceMin != null || f.priceMax != null) lines.push(`- Tutar: ${f.priceMin ?? '?'} - ${f.priceMax ?? '?'}`);
    if (f.currency)               lines.push(`- Döviz: ${f.currency}`);
    if (!lines.length) return '(Hiçbir filtre aktif değil)';
    return lines.join('\n');
}

async function _streamWithRetry(streamOptions, maxAttempts = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const stream = client.messages.stream(streamOptions);
            return stream;
        } catch (err) {
            lastError = err;
            const isRetryable = err?.status === 529 || err?.error?.type === 'overloaded_error';

            if (!isRetryable || attempt === maxAttempts) throw err;

            // Backoff: 500ms, 1000ms, 2000ms
            const delayMs = 500 * Math.pow(2, attempt - 1);
            console.warn(`[claude] overloaded, retrying in ${delayMs}ms (attempt ${attempt}/${maxAttempts})`);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    throw lastError;
}


// ── POST /api/chat/ask ──────────────────────────────────────────────────────
// ─── POST /api/chat/ask ──────────────────────────────────────────────────────
// Updated for 7-tool architecture:
//   applyFilters, getInvoiceStats, getInvoices, getInvoiceItems,
//   getProductBreakdown, getProducts, getProductDetail
//
// Tool implementations live in ./chat-tools.js


router.post('/ask', async (req, res) => {
    const { tab, message, history, filters } = req.body || {};

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required' });
    }
    if (!['genel', 'giden', 'gelen'].includes(tab)) {
        return res.status(400).json({ error: 'invalid tab' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const direction = tab === 'giden' ? 'OUTGOING' : tab === 'gelen' ? 'INCOMING' : null;

    // ── SSE setup ───────────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (type, data) => {
        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let closed = false;
    req.on('close', () => { closed = true; });

    try {
        // ── System prompt ────────────────────────────────────────────────────
        const today   = new Date().toISOString().slice(0, 10);
        const dayName = new Date().toLocaleDateString('tr-TR', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        const dateContext = `Bugünün tarihi: ${today} (${dayName})`;
        const systemPrompt = `${_buildPrompt(tab)}\n\n${dateContext}`;
        const tools = _toolsForTab(tab);

        // ── Conversation loop ────────────────────────────────────────────────
        const messages = buildMessages(history, message);
        let safety = 0;

        while (safety++ < 5) {
            if (closed) break;

            const stream = client.messages.stream({
                model: MODEL,
                max_tokens: 2048,
                system: systemPrompt,
                messages,
                ...(tools ? { tools } : {}),
            });

            stream.on('text', (text) => {
                if (!closed && text) sendEvent('token', { text });
            });

            const finalMessage = await stream.finalMessage();
            if (closed) break;

            const toolUses = (finalMessage.content || []).filter(c => c.type === 'tool_use');
            if (!toolUses.length) break;

            // Push assistant message with tool_use blocks
            messages.push({ role: 'assistant', content: finalMessage.content });

            // Execute tools
            const toolResults = [];
            for (const toolUse of toolUses) {

                // ── applyFilters — UI action ────────────────────────────────
                if (toolUse.name === 'applyFilters') {
                    console.log('[applyFilters] raw args:', JSON.stringify(toolUse.input, null, 2));
                    sendEvent('tool_call', { name: 'applyFilters', args: toolUse.input || {} });

                    const { applied, warnings } = await _resolveApplyFiltersArgs(
                        toolUse.input || {}, supabase, tenantId, direction
                    );

                    console.log('[applyFilters] resolved:', JSON.stringify(applied, null, 2));
                    if (warnings.length) console.log('[applyFilters] warnings:', warnings);

                    sendEvent('action', { type: 'applyFilters', params: applied });

                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: JSON.stringify({
                            applied,
                            warnings,
                            note: warnings.length
                                ? 'Bazı değerler eşleşmedi: ' + warnings.join('; ')
                                : 'Filtreler başarıyla uygulandı.',
                        }),
                    });
                }

                // ── getInvoiceStats — aggregate totals or company ranking ───
                else if (toolUse.name === 'getInvoiceStats') {
                    console.log('[getInvoiceStats] raw args:', JSON.stringify(toolUse.input, null, 2));
                    sendEvent('tool_call', { name: 'getInvoiceStats', args: toolUse.input || {} });

                    const { applied, warnings } = await _resolveApplyFiltersArgs(
                        toolUse.input || {}, supabase, tenantId, direction
                    );

                    try {
                        const result = await fetchInvoiceStats(supabase, tenantId, {
                            direction,
                            groupBy:   toolUse.input?.groupBy || 'none',
                            sortBy:    toolUse.input?.sortBy  || 'amount',
                            limit:     toolUse.input?.limit   || 10,
                            ...applied,
                        });

                        console.log('[getInvoiceStats] result summary:',
                            result.totals
                                ? `totals: count=${result.totals.total_count}, companies=${result.totals.company_count}`
                                : `groupBy company: ${result.companies?.length || 0} companies`);

                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({
                                ...result,
                                appliedFilters: applied,
                                warnings: warnings.length ? warnings : undefined,
                            }),
                        });
                    } catch (err) {
                        console.error('[getInvoiceStats] error:', err.message);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'İstatistik alınamadı: ' + err.message }),
                            is_error: true,
                        });
                    }
                }

                // ── getInvoices — individual invoice list ───────────────────
                else if (toolUse.name === 'getInvoices') {
                    console.log('[getInvoices] raw args:', JSON.stringify(toolUse.input, null, 2));
                    sendEvent('tool_call', { name: 'getInvoices', args: toolUse.input || {} });

                    const { applied, warnings } = await _resolveApplyFiltersArgs(
                        toolUse.input || {}, supabase, tenantId, direction
                    );

                    try {
                        const invoiceList = await fetchInvoiceList(supabase, tenantId, {
                            direction,
                            sortBy:  toolUse.input?.sortBy  || 'date',
                            sortDir: toolUse.input?.sortDir || 'desc',
                            limit:   toolUse.input?.limit   || 10,
                            ...applied,
                        });

                        console.log('[getInvoices] returned', invoiceList.length, 'invoices');

                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({
                                invoices: invoiceList,
                                count: invoiceList.length,
                                appliedFilters: applied,
                                warnings: warnings.length ? warnings : undefined,
                            }),
                        });
                    } catch (err) {
                        console.error('[getInvoices] error:', err.message);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'Fatura listesi alınamadı: ' + err.message }),
                            is_error: true,
                        });
                    }
                }

                // ── getInvoiceItems — line items of specific invoices ───────
                else if (toolUse.name === 'getInvoiceItems') {
                    console.log('[getInvoiceItems] raw args:', JSON.stringify(toolUse.input, null, 2));
                    sendEvent('tool_call', { name: 'getInvoiceItems', args: toolUse.input || {} });

                    const invoiceNumbers = Array.isArray(toolUse.input?.invoiceNumbers)
                        ? toolUse.input.invoiceNumbers.filter(Boolean)
                        : [];

                    if (!invoiceNumbers.length) {
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'invoiceNumbers boş olamaz.' }),
                            is_error: true,
                        });
                        continue;
                    }

                    try {
                        const items = await fetchInvoiceItems(supabase, tenantId, {
                            invoiceNumbers,
                            direction,   // scope to current tab's direction
                        });

                        console.log('[getInvoiceItems] returned', items.length, 'items');

                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({
                                items,
                                count: items.length,
                                invoiceNumbers,
                            }),
                        });
                    } catch (err) {
                        console.error('[getInvoiceItems] error:', err.message);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'Kalemler alınamadı: ' + err.message }),
                            is_error: true,
                        });
                    }
                }

                // ── getProductBreakdown — product activity from invoices ────
                else if (toolUse.name === 'getProductBreakdown') {
                    console.log('[getProductBreakdown] raw args:', JSON.stringify(toolUse.input, null, 2));
                    sendEvent('tool_call', { name: 'getProductBreakdown', args: toolUse.input || {} });

                    const { applied, warnings } = await _resolveApplyFiltersArgs(
                        toolUse.input || {}, supabase, tenantId, direction
                    );

                    try {
                        const breakdown = await fetchProductBreakdown(supabase, tenantId, {
                            direction,
                            groupBy: toolUse.input?.groupBy || 'product',
                            sortBy:  toolUse.input?.sortBy  || 'total',
                            limit:   toolUse.input?.limit   || 10,
                            companies: applied.companies,
                            dateStart: applied.dateStart,
                            dateEnd:   applied.dateEnd,
                            currency:  applied.currency,
                        });

                        console.log('[getProductBreakdown] returned', breakdown.length, 'items');

                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({
                                breakdown,
                                groupBy: toolUse.input?.groupBy || 'product',
                                sortBy:  toolUse.input?.sortBy  || 'total',
                                appliedFilters: applied,
                                warnings: warnings.length ? warnings : undefined,
                            }),
                        });
                    } catch (err) {
                        console.error('[getProductBreakdown] error:', err.message);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'Ürün dağılımı alınamadı: ' + err.message }),
                            is_error: true,
                        });
                    }
                }

                // ── getProducts — catalog / stock / pricing list ────────────
                else if (toolUse.name === 'getProducts') {
                    console.log('[getProducts] raw args:', JSON.stringify(toolUse.input, null, 2));
                    sendEvent('tool_call', { name: 'getProducts', args: toolUse.input || {} });

                    try {
                        const products = await fetchProducts(supabase, tenantId, {
                            search:   toolUse.input?.search   || null,
                            brand:    toolUse.input?.brand    || null,
                            category: toolUse.input?.category || null,
                            lowStock: toolUse.input?.lowStock === true,
                            onOrder:  toolUse.input?.onOrder  === true,
                            inStock:  toolUse.input?.inStock  === true,
                            sortBy:   toolUse.input?.sortBy  || 'stock',
                            sortDir:  toolUse.input?.sortDir || 'desc',
                            limit:    toolUse.input?.limit   || 10,
                        });

                        console.log('[getProducts] returned', products.length, 'products');

                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({
                                products,
                                count: products.length,
                            }),
                        });
                    } catch (err) {
                        console.error('[getProducts] error:', err.message);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'Ürün listesi alınamadı: ' + err.message }),
                            is_error: true,
                        });
                    }
                }

                // ── getProductDetail — deep-dive on ONE product ─────────────
                else if (toolUse.name === 'getProductDetail') {
                    console.log('[getProductDetail] raw args:', JSON.stringify(toolUse.input, null, 2));
                    sendEvent('tool_call', { name: 'getProductDetail', args: toolUse.input || {} });

                    const identifier = {
                        productId:   toolUse.input?.productId   || null,
                        productName: toolUse.input?.productName || null,
                        productCode: toolUse.input?.productCode || null,
                    };

                    if (!identifier.productId && !identifier.productName && !identifier.productCode) {
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'En az bir tanımlayıcı gerekli: productId, productName veya productCode.' }),
                            is_error: true,
                        });
                        continue;
                    }

                    try {
                        const detail = await fetchProductDetail(supabase, tenantId, identifier);

                        if (!detail) {
                            toolResults.push({
                                type: 'tool_result',
                                tool_use_id: toolUse.id,
                                content: JSON.stringify({ error: 'Ürün bulunamadı.', identifier }),
                            });
                        } else {
                            console.log('[getProductDetail] found:', detail.name);
                            toolResults.push({
                                type: 'tool_result',
                                tool_use_id: toolUse.id,
                                content: JSON.stringify({ product: detail }),
                            });
                        }
                    } catch (err) {
                        console.error('[getProductDetail] error:', err.message);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'Ürün detayı alınamadı: ' + err.message }),
                            is_error: true,
                        });
                    }
                }

                // ── Unknown tool ────────────────────────────────────────────
                else {
                    console.warn('[chat] unknown tool:', toolUse.name);
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: JSON.stringify({ error: 'Bu araç henüz desteklenmiyor.' }),
                        is_error: true,
                    });
                }
            }

            // Push tool results as the next user turn
            messages.push({ role: 'user', content: toolResults });
        }

        sendEvent('done', { ok: true });
        res.end();

    } catch (err) {
        console.error('chat /ask error:', err?.message || err);
        if (!closed) {
            let userMessage = err?.message || 'Bilinmeyen hata';
            if (err?.status === 529 || err?.error?.type === 'overloaded_error') {
                userMessage = 'AI servisi şu an yoğun. Birkaç saniye sonra tekrar dene.';
            } else if (err?.status === 429) {
                userMessage = 'Çok fazla istek gönderildi. Biraz bekleyip tekrar dene.';
            }
            sendEvent('error', { message: userMessage });
            res.end();
        }
    }
});

module.exports = router;