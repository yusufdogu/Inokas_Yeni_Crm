// invoice-classifier.js
// Classifies invoice line items using Perplexity sonar API.
// Determines invoice_category (INTERNAL / NON_INTERNAL / MIXED)
// and item_category + item_category per line item.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const MODEL              = 'sonar-pro';

// ─── hardcoded for testing — will come from tenant record later ──────────────
const TENANT_BUSINESS_SUMMARY =
    "Yazıcı, tarayıcı, BT donanımı ve sarf malzemeleri (mürekkep, toner, kartuş vb.) satıyoruz.";

// ─── main function ────────────────────────────────────────────────────────────

async function classifyInvoice(items, knownInternal = [], knownNonInternal = []) {
    console.log(`\n🏷️  Fatura sınıflandırılıyor... (${items.length} kalem)`);

    const prompt = buildPrompt(items, knownInternal, knownNonInternal);

    try {
        const response = await fetch(PERPLEXITY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({
                model:       MODEL,
                temperature: 0.1,
                messages: [
                    {
                        role:    'system',
                        content: 'Sen bir fatura analiz asistanısın. Sadece JSON formatında yanıt ver, başka hiçbir şey yazma.',
                    },
                    {
                        role:    'user',
                        content: prompt,
                    },
                ],
            }),
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Perplexity API hatası: ${response.status} — ${err}`);
        }

        const data = await response.json();
        const text = data.choices[0].message.content;

        return parseResponse(text, items);

    } catch (err) {
        console.error('❌ Sınıflandırma başarısız:', err.message);
        return buildFallback(items);
    }
}

// ─── prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(items, knownInternal = [], knownNonInternal = []) {
    const itemLines = items.map((item, i) =>
        `${i + 1}. urun_adi: "${item.product_name || '-'}" | kod: "${item.product_desc || '-'}" | marka: "${item.brand_name || '-'}"`
    ).join('\n');

    // Feed back collected subcategories — SEPARATE lists for INTERNAL vs NON_INTERNAL.
    // The model uses whichever matches its own classification of the item.
    const hasVocab = knownInternal.length > 0 || knownNonInternal.length > 0;
    const vocabSection = hasVocab
        ? `
MEVCUT ALT KATEGORİLER (daha önce kullanılmış — yazım tutarlılığı için):

  ÜRÜN AİLELERİ (INTERNAL kalemler için):
${knownInternal.length ? knownInternal.map(s => `  - ${s}`).join('\n') : '  (henüz yok)'}

  GİDER AİLELERİ (NON_INTERNAL kalemler için):
${knownNonInternal.length ? knownNonInternal.map(s => `  - ${s}`).join('\n') : '  (henüz yok)'}

KULLANIM: Bir kalemi INTERNAL yaptıysan ÜRÜN AİLELERİ listesine, NON_INTERNAL
yaptıysan GİDER AİLELERİ listesine bak. Uygun bir aile varsa AYNEN onu kullan
(aynı yazım). Yoksa yeni bir aile üret. İki listeyi birbirine karıştırma.
`
        : '';
    return `
Sen bir fatura analiz asistanısın. Fatura kalemlerini inceleyerek her birinin
bizim işimizle ilgili olup olmadığını belirle.

BİZİM İŞİMİZ:
${TENANT_BUSINESS_SUMMARY}

FATURA KALEMLERİ:
${itemLines}

YAPIMIZ (iki seviye):
  GENEL AİLE (item_category — SEN belirliyorsun)
      └── SPESİFİK KATEGORİ (item_sub_category — sonraki adımda belirlenir)
Sen sadece GENEL AİLE'yi (item_category) belirliyorsun. Bu, altına birden
fazla spesifik ürün türü girebilecek kadar GENİŞ; ama "BT Donanımı" gibi her
şeyi içine alan bir çöp kutusu olacak kadar geniş DEĞİL.

GÖREV:
Her kalem için item_is_internal ve item_category belirle.
Sonra faturanın genel invoice_category'sini belirle.

KURALLAR:
- Bizim işimizle doğrudan ilgili ürünler → INTERNAL
- Operasyonel giderler, bizim satmadığımız şeyler → NON_INTERNAL
- invoice_category: tüm kalemler INTERNAL ise "INTERNAL",
  tüm kalemler NON_INTERNAL ise "NON_INTERNAL", karışık ise "MIXED"
- item_category ürünün GENEL ürün ailesi olmalı — spesifik üründen bir
  seviye YUKARISI. Ne çok spesifik, ne çok geniş olsun.
    • "Lazer Toner" DEĞİL → "Toner"
    • "Dizüstü Bilgisayar" DEĞİL, "İş İstasyonu" DEĞİL,
      "BT Donanımı" DA DEĞİL → "Bilgisayar"
    • "Yazıcı Kartuşu" DEĞİL → "Kartuş"
  Farklı spesifik ürünler AYNI genel aile altında toplanabilmeli:
    Dizüstü Bilgisayar, İş İstasyonu, AI Süper Bilgisayar → hepsi "Bilgisayar"
    Lazer Yazıcı, Mürekkep Püskürtmeli Yazıcı → hepsi "Yazıcı"
    Ofis Sandalyesi, Toplantı Masası → hepsi "Mobilya"
  Mümkünse TEK kelime kullan, gerekiyorsa en fazla İKİ kelime.
  INTERNAL örnekleri: "Toner", "Kartuş", "Yazıcı", "Tarayıcı",
  "Bilgisayar", "Monitör", "Klavye", "Ağ Donanımı" vb.
- item_category false için de aynı kurallar geçerli: GENEL bir aile
  olsun, 1-2 kelime. Aşağıdaki gider alanları yol göstericidir — ürünün hangi
  alana girdiğini bulmana yardım eder. Ama bunlar bir menü DEĞİL: uygun bir alan
  varsa oradan bir aile seç, yoksa yeni bir genel aile üret.
    • Kira & Tesis      → "Kira", "Elektrik", "Su", "İnternet", "Doğalgaz"
    • Ofis & Sarf       → "Kırtasiye", "Mutfak", "Temizlik", "Ofis Malzemesi"
    • Hizmet & Danışmanlık → "Danışmanlık", "Hukuk", "Muhasebe", "Bakım"
    • Lojistik & Kargo  → "Kargo", "Nakliye", "Lojistik"
    • Pazarlama & Reklam → "Reklam", "Pazarlama"
    • Yazılım & Abonelik → "Yazılım", "Abonelik", "Lisans"
      (DİKKAT: bizim satıp yeniden sattığımız donanım/yazılım DEĞİL — bizim
       kendi kullandığımız abonelikler)
    • Personel & Seyahat → "Seyahat", "Konaklama", "Eğitim"
    • Finansal          → "Banka", "Faiz", "Vergi", "Komisyon"
  Not: Sol taraftaki başlıklar (örn. "Kira & Tesis") SADECE alan grubudur,
  item_category olarak KULLANMA. Sağdaki gibi 1-2 kelimelik aile adı kullan.
- Emin olamadığın kalemleri NON_INTERNAL yap, item_category: "Belirsiz"
${vocabSection}
Sadece JSON döndür, başka hiçbir şey yazma:

{
  "invoice_category": "INTERNAL",
  "items": [
    {
      "index": 1,
      "item_is_internal": true,
      "item_category": "Toner"
    }
  ]
}
`.trim();
}
// ─── response parser ──────────────────────────────────────────────────────────

function parseResponse(text, items) {
    try {
        const cleaned = text
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        const start = cleaned.indexOf('{');
        const end   = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('JSON bulunamadı');

        const parsed = JSON.parse(cleaned.slice(start, end + 1));

        const validCategories = ['INTERNAL', 'NON_INTERNAL', 'MIXED'];
        const invoice_category = validCategories.includes(parsed.invoice_category)
            ? parsed.invoice_category
            : 'MIXED';

        const classifiedItems = items.map((item, i) => {
            const match = (parsed.items || []).find(r => r.index === i + 1);
            return {
                ...item,
                item_is_internal:    match?.item_is_internal    === true,
                item_category: match?.item_category || 'Belirsiz',
            };
        });

        console.log(`✅ Sınıflandırma tamamlandı: ${invoice_category}`);
        return { invoice_category, items: classifiedItems };

    } catch (err) {
        console.error('❌ Yanıt parse edilemedi:', err.message);
        console.error('Ham yanıt:', text);
        return buildFallback(items);
    }
}

// ─── fallback ─────────────────────────────────────────────────────────────────

function buildFallback(items) {
    return {
        invoice_category: 'MIXED',
        items: items.map(item => ({
            ...item,
            item_is_internal:    false,
            item_category: 'Belirsiz',
        })),
    };
}

module.exports = { classifyInvoice };