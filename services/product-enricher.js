// product-enricher.js
// Enriches INTERNAL invoice line items using Perplexity sonar API.
//
// Flow per item:
//   1. Search by product name (+ code/brand if present) to DISCOVER the brand.
//   2. Go to that brand's OWN official manufacturer site (TR or global).
//   3. Read verified name, code/MPN, model, item_subcategory off that site.
//   4. Perplexity self-reports which sources it used and whether the official
//      site was the basis. We trust that report — no static domain lists.
//
// Trust signal is a single boolean: needs_review.
//   needs_review = true  when the official brand site was NOT the source,
//                        or the product could not be identified.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';
const MODEL              = 'sonar-pro';

const RATE_LIMIT_MS = 100; // pause between calls in a batch
const {findProductByCode}                  = require('./helpers');


// ─── MPN pre-check (cheap, no web search) ─────────────────────────────────────
// Tries to pull the manufacturer part number straight from the invoice fields,
// mainly name/description. Returns { mpn } — mpn is null if not confidently found.
// This is an OPTIMIZATION: a hit lets us skip the expensive enrichment when the
// product is already in the store. A miss just falls through to full enrichment.

async function extractMpn(item) {
    const fields = [];
    if (item.product_name)      fields.push(`urun_adi: "${item.product_name}"`);
    if (item.product_desc)      fields.push(`urun_aciklamasi: "${item.product_desc}"`);
    if (item.line_note)         fields.push(`urun_notu: "${item.line_note}"`);
    if (item.brand_name)        fields.push(`marka: "${item.brand_name}"`);
    if (item.model_name)        fields.push(`model: "${item.model_name}"`);
    if (item.seller_code)       fields.push(`satici_kodu: "${item.seller_code}"`);
    if (item.manufacturer_code) fields.push(`uretici_kodu: "${item.manufacturer_code}"`);

    const prompt = `
Aşağıdaki fatura kaleminden ürünün ÜRETİCİ PARÇA NUMARASINI (MPN) çıkar.
Web araması YAPMA — sadece verilen metne bak.

ALANLAR:
${fields.join('\n')}

KURALLAR:
- MPN çoğu zaman urun_adi,urun_aciklamasi veya urun_notu İÇİNDE gizlidir.
  Örn: "ASUS ExpertCenter D5 SFF D501SER-DI58512B0X-300" → "D501SER-DI58512B0X-300"
- Kısa, sadece rakamdan oluşan kodlar (örn. "122181") genelde distribütör
  SKU'sudur, MPN DEĞİLDİR — bunları MPN olarak verme.
- Spec'ler MPN değildir: "DDR4", "USB3.2", "SATA3", "mATX" gibi ifadeler kod değil.
- MPN'i net olarak tespit edemiyorsan mpn: null döndür. TAHMİN ETME.

Sadece şu JSON'u döndür, başka hiçbir şey yazma:
{ "mpn": "MPN veya null" }
`.trim();

    try {
        const response = await fetch(PERPLEXITY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({
                model:       MODEL,
                temperature: 0.0,
                messages: [
                    { role: 'system', content: 'Sadece JSON döndür. Web araması yapma.' },
                    { role: 'user',   content: prompt },
                ],
            }),
        });

        if (!response.ok) return { mpn: null };

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';

        const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const start = cleaned.indexOf('{');
        const end   = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) return { mpn: null };

        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        let mpn = parsed.mpn;
        if (!mpn || String(mpn).trim().toLowerCase() === 'null') return { mpn: null };

        return { mpn: String(mpn).trim() };

    } catch (err) {
        // pre-check is best-effort — never let it break the pipeline
        return { mpn: null };
    }
}
// ─── main enrich function ─────────────────────────────────────────────────────

async function enrichProduct(item, knownCategories = [], trust = {}) {
    console.log(`\n🔎 Zenginleştiriliyor:`);
    console.log(`   Ürün Adı : ${item.product_name || '-'}`);
    console.log(`   Ürün açıklama : ${item.product_desc || '-'}`);
    console.log(`   Ürün notu : ${item.line_note || '-'}`);
    console.log(`   Kod      : ${item.product_code || '-'}`);
    console.log(`   Marka    : ${item.brand_name   || '-'}`);

    const prompt = buildPrompt(item, knownCategories);

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
                        content: 'Sen bir ürün araştırma asistanısın. Sadece JSON formatında yanıt ver, başka hiçbir şey yazma.',
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

        const data      = await response.json();
        const text      = data.choices[0].message.content;
        const citations = data.citations || [];

        return parseResponse(text, citations, item, trust);

    } catch (err) {
        console.error(`❌ Zenginleştirme başarısız: ${err.message}`);
        return buildFallback(item);
    }
}
// ─── batch enrichment ─────────────────────────────────────────────────────────

// store is an optional object of injected functions:
//   { findProductByCode, upsertProduct, getKnownCategories, addCategory }
// Any missing function degrades gracefully (behaves like the old null gate).
// store: { findProductByCode, upsertProduct, getKnownCategories, addCategory,
//          isOfficialForBrand, recordBrandDomains, getBrandDomains }
async function enrichProducts(items, store = {}, direction = 'gelen') {
    const {
        findProductByCode,
        upsertProduct,
        getKnownCategories,
        isTrustedDomain,
        recordBrandDomain,
    } = store;

    const knownCategories = getKnownCategories ? getKnownCategories() : [];
    const results = [];

    for (const item of items) {

        // 1) skip non-internal
        if (item.item_is_internal !== true) {
            console.log(`⏭️  NON_INTERNAL, atlanıyor: "${item.product_name}"`);
            results.push({ ...item, enriched: false, skip_reason: 'NON_INTERNAL' });
            continue;
        }

        // 2) PRE-CHECK — cheap MPN extraction (no search)
        const { mpn: preMpn } = await extractMpn(item);
        if (preMpn) console.log(`   🔦 Ön-tespit MPN: ${preMpn}`);

        // 3) if pre-check MPN already in store → skip enrichment (dedup)
        if (preMpn && findProductByCode) {
            const existing = await findProductByCode(preMpn);
            if (existing) {
                console.log(`⏭️  Zaten kayıtlı (ön-tespit): ${preMpn}`);
                results.push({
                    ...item,
                    product_code: preMpn,
                    enriched:     false,
                    skip_reason:  'ALREADY_IN_DB_PRECHECK',
                });
                continue;
            }
        }

        // 4) ENRICH — full web search
        const enriched = await enrichProduct(item, knownCategories, { isTrustedDomain, recordBrandDomain });

        // 5) POST-CHECK — dedup on the VERIFIED MPN
        const verifiedCode = enriched.product_code;
        if (verifiedCode && findProductByCode) {
            const existing = await findProductByCode(verifiedCode);
            if (existing) {
                console.log(`⏭️  Zaten kayıtlı (zenginleştirme sonrası): ${verifiedCode}`);
                results.push({ ...enriched, enriched: false, skip_reason: 'ALREADY_IN_DB_POSTCHECK' });
                await sleep(RATE_LIMIT_MS);
                continue;
            }
        }

        // new product — enrichProducts does NOT write to the store.
        // backfill.js handles product upsert, stock, item_subcategory, product_id.
        results.push(enriched);
        await sleep(RATE_LIMIT_MS);
    }

    return results;
}
// ─── prompt builder ───────────────────────────────────────────────────────────


function buildPrompt(item, knownCategories = []) {
    // All raw fields from the invoice line. name + description are highest
    // priority (usually populated); code fields are candidates, not truth.
    const knownParts = [];
    if (item.product_name)      knownParts.push(`urun_adi          : "${item.product_name}"`);
    if (item.product_desc)      knownParts.push(`urun_aciklamasi   : "${item.product_desc}"`);
    if (item.line_note)         knownParts.push(`urun_notu   : "${item.line_note}"`);
    if (item.brand_name)        knownParts.push(`marka    : "${item.brand_name}"`);
    if (item.model_name)        knownParts.push(`model             : "${item.model_name}"`);
    if (item.seller_code)       knownParts.push(`satici_kodu       : "${item.seller_code}"`);
    if (item.buyer_code)        knownParts.push(`alici_kodu        : "${item.buyer_code}"`);
    if (item.manufacturer_code) knownParts.push(`uretici_kodu      : "${item.manufacturer_code}"`);

    // Feed back previously collected specific categories so wording converges.
    const vocabSection = knownCategories.length > 0
        ? `

MEVCUT KATEGORİLER (daha önce kullanılmış):
${knownCategories.map(c => `- ${c}`).join('\n')}

item_subcategory alanını doldururken: yukarıdaki listeden biri ürünün DOĞRU spesifik
kategorisiyse AYNEN onu kullan (aynı yazım, aynı büyük/küçük harf). Ama sırf
yakın diye kullanma — eğer bu ürün listedeki kategoriyi kullanan üründen farklı
bir üründse, o kategoriyi PAYLAŞMAMALI, yeni ve daha spesifik bir kategori üret.`
        : '';

    return `
Aşağıdaki ürün hakkında web araması yap ve doğru, eksiksiz ürün bilgilerini bul.

FATURADAN GELEN HAM BİLGİ:
${knownParts.join('\n')}

⚠️ KODLAR HAKKINDA ÖNEMLİ UYARI:
satici_kodu, alici_kodu gibi kod alanları ÇOĞU ZAMAN distribütörün kendi stok
kodudur (SKU) — üreticinin gerçek parça numarası (MPN) DEĞİLDİR. Örneğin
"122181" veya "1905052" gibi kısa, sadece rakamdan oluşan kodlar neredeyse
kesinlikle SKU'dur, MPN değildir. Bu kodlara MPN olarak GÜVENME.

Gerçek MPN çoğu zaman urun_adi, urun_aciklamasi veya urun_notu İÇİNDE gizlidir —
ve çoğu zaman birden fazla alanı BİRLİKTE okuyunca ortaya çıkar. Tek bir alana
bakma; alanları BİRLEŞTİR ve her alanın NE tür bilgi taşıdığını düşün:

  - urun_adi        → genelde MARKA ve ürün tipini verir (baştaki kelime çoğunlukla marka)
  - urun_aciklamasi → genelde ÜRÜN TİPİNİ / kategorisini verir (ne olduğu)
  - urun_notu       → çoğu zaman MPN, model kodu veya uyumlu olduğu modeli verir
  - uretici_kodu    → gerçek MPN olabilir (ama doğrula)
  - satici/alici_kodu → genelde SKU'dur, MPN DEĞİL
  - uzun sayı dizileri (13 hane vb.) → EAN/barkod olabilir, aranarak ürüne ulaşılır

BİRLEŞTİRME MANTIĞI (örnek kalıplar, gerçek ürüne uyarla):
  - açıklama ürün tipini verir + not bir kod verir
      → "bu tip ürün + bu kod" araması yap (tip aramayı daraltır, kod ürünü bulur)
  - ad belirsiz/genel + not uyumlu bir model kodu verir
      → ürün, o modelin bir aksesuarı/parçası olabilir; o modeli araştır
  - açıklama ürün tipini verir + üretici kodu bir MPN verir
      → üretici kodunu doğrula, doğruysa gerçek MPN olarak kullan
  - ad ve marka yetersiz + notta uzun bir sayı var
      → barkod/EAN olabilir; onu ara, üretici ve MPN'i oradan çöz

ÖNEMLİ: hangi kombinasyonun anlamlı olduğunu düşün. Her alan her zaman
birleştirilmez — ama açıklama+kod, not+açıklama gibi kombinasyonlar genelde
MPN'e giden en iyi yoldur.

ARAMA STRATEJİSİ:
1. MPN ADAYLARINI ÇIKAR. Önce urun_adi, urun_aciklamasi ve urun_notu metnini incele ve
   içindeki olası MPN/model kodlarını bul (harfli-rakamlı, kod görünümlü parçalar
   — spec değil, örn. "DDR4", "USB3.2", "mATX", "SATA3" birer spec'tir, kod
   DEĞİL). Kod alanlarındaki değerleri de aday olarak değerlendir ama düşük
   öncelikle.
1.5. ÇIKARDIĞIN MPN'İ HEMEN ARA. Adım 1'de urun_adi/urun_aciklamasi/urun_notu
   içinden bir MPN/model kodu çıkardıysan (örn. "WF-C20590"),
   İLK aramanı bu kodla yap — kodu doğrudan arama motorunda ara. Bu kod, ürünün
   resmi sayfasına ulaşmanın EN HIZLI yoludur. Genel terimlerle ("dizüstü
   bilgisayar" gibi) arama YAPMA — elindeki spesifik kodu kullan. Kod + marka
   birlikte aranırsa  resmi ürün sayfası genelde
   ilk sonuçlarda çıkar.
2. MARKAYI BELİRLE. Ürün adından, açıklamadan, notundan ve kod kalıbından markayı tespit
   et. Ürün adının başındaki kelime genelde markadır (örn. "ASUS ..." → ASUS,
   "EPSON ..." → Epson). Faturadaki marka alanı yanlış/eksik olabilir, körü
   körüne güvenme.
3. RESMİ ÜRETİCİ SİTESİNE GİT ve DOĞRULA. Markayı belirledikten sonra o markanın
   KENDİ resmi üretici sitesine git (Türkiye veya global — hangisi gerçek üretici
   sitesiyse; perakendeci/distribütör değil). Adım 1'de çıkardığın MPN adaylarını
   resmi sitede ara ve DOĞRULA:
   - Resmi sitede onaylanan gerçek MPN'i product_code olarak kullan.
   - Faturadaki numaralı SKU (örn. "122181") ile resmi MPN farklıysa, HER ZAMAN
     resmi MPN'i tercih et — SKU'yu product_code'a YAZMA.
   - MPN'i resmi sitede birebir doğrulayamıyorsan ama ürünü tanıdıysan, resmi
     sitedeki gerçek MPN'i kullan; alanları boş bırakma.
   - Ürünün hangi ürün olduğundan gerçekten emin olamıyorsan, o zaman emin
     olmadığın alanları null bırak.
4. RESMİ SİTE YOKSA. Distribütör veya büyük perakendeci kaynaklarından en iyi
   bilgiyi topla ve official_source_used: false yap.

GÖREV:
Topladığın bilgileri aşağıdaki JSON formatında döndür.
Sadece JSON döndür, başka hiçbir şey yazma.
${vocabSection}

{
  "product_name":  "Tam ve doğru ürün adı",
  "product_code":  "Üreticinin orijinal MPN/parça numarası (SKU DEĞİL)",
  "brand":         "Marka adı (düzgün yazım, örn: Epson, Canon, HP, ASUS)",
  "item_subcategory":      "Kısa Türkçe kategori (2-3 kelime)",
  "specs": {
    "model": "Model adı/numarası (varsa)"
  },
  "official_source_used": true,
  "search_sources": [
    {
      "url":  "ziyaret edilen URL",
      "type": "official | distributor | retailer | other"
    }
  ]
}

KURALLAR:
- product_code: üreticinin orijinal parça numarası (MPN) olmalı — distribütör
  SKU'su (kısa numaralı kod) DEĞİL. urun_adi/urun_aciklamasi içindeki gerçek
  MPN'i tercih et.
- brand: doğru büyük/küçük harf kullan (Epson, Canon, HP, OKI, ASUS vb.). Marka
  adına "-YP" gibi distribütör ekleri EKLEME.
- specs: ürüne özel teknik detaylar (JSON nesnesi). Anahtarlar ürün tipine göre
  DEĞİŞİR — sabit şema YOK. Türkçe anahtarlar kullan. model bilgisini de buraya
  koy. Örnekler:
    • Toner için:      { "model": "T9661", "renk": "Siyah", "sayfa_verimi": "10000" }
    • Bilgisayar için: { "model": "P1403CVA", "islemci": "Core i5", "ram": "16GB", "depolama": "512GB SSD" }
    • Yazıcı için:     { "model": "WF-C5790", "baski_tipi": "Lazer", "hiz_ppm": "35" }
  Bilmediğin/emin olmadığın özelliği EKLEME — tahmin etme. Hiç özellik yoksa {} bırak.- item_subcategory: ürünün SPESİFİK kategorisi. İKİ SEVİYELİ yapımız var:

    GENEL AİLE (item_category — sınıflandırmadan gelir)
        └── SPESİFİK KATEGORİ (item_subcategory — SEN belirliyorsun)

  ⚠️ item_subcategory bir ETİKETTİR, açıklama DEĞİLDİR. EN FAZLA 2-3 kelime.
     ASLA cümle kurma, "için", "ile", kapasite/renk/özellik ekleme.
     YANLIŞ: "Kurumsal mürekkep püskürtmeli yazıcı için yüksek kapasiteli mavi
              mürekkep paketi"  ← bu bir açıklama, HATA
     DOĞRU:  "Mürekkep Kartuşu"  veya  "Yazıcı Aksesuarı"

  AYIRT EDİLEBİLİRLİK: Aynı genel ailedeki iki farklı ürün aynı item_subcategory'ye
  düşmemeli — düşerse daha spesifik ol (ama yine 2-3 kelimeyle).

  Yapı örnekleri (farklı sektörlerden — seviyeyi göster):
    Genel aile   →  Spesifik kategori
    ───────────────────────────────────────────
    Bilgisayar   →  Dizüstü Bilgisayar / İş İstasyonu / Masaüstü Bilgisayar
    Yazıcı       →  Lazer Yazıcı / Mürekkep Püskürtmeli Yazıcı
    Toner        →  Lazer Toner
    Mobilya      →  Ofis Sandalyesi / Dosya Dolabı

  Türkçe yaz. Kısa ve kesin.
- official_source_used: bilgileri MARKANIN KENDİ RESMİ SİTESİNDEN aldıysan true,
  sadece perakendeci/distribütör/dolaylı kaynaklardan aldıysan false
- search_sources: ziyaret ettiğin tüm kaynakları listele, type'ı sen belirle
- Emin olmadığın alanı null bırak, tahmin etme
- Ürün bulunamazsa tüm alanları null bırak, official_source_used: false
`.trim();
}

// ─── response parser ──────────────────────────────────────────────────────────

function parseResponse(text, citations, originalItem, trust = {}) {
    try {
        const cleaned = text
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        const start = cleaned.indexOf('{');
        const end   = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('JSON bulunamadı');

        const parsed = JSON.parse(cleaned.slice(start, end + 1));

        // sources as Perplexity self-tagged them — no confidence, no tier lookup
        const sources = (parsed.search_sources || [])
            .filter(s => s && s.url)
            .map(s => ({
                url:  s.url,
                type: s.type || 'other',
            }));

        // fold in any raw citations Perplexity returned that we didn't already list
        citations.forEach(url => {
            if (url && !sources.find(s => s.url === url)) {
                sources.push({ url, type: 'other' });
            }
        });

        const brand = parsed.brand || originalItem.brand_name || null;

        // all source URLs (parsed sources + raw citations) for the trust check
        const allUrls = [
            ...sources.map(s => s.url),
            ...citations.filter(Boolean),
        ];

        // ── TRUST: compute it ourselves from trusted domains ──
        // A source is trusted if it's a global domain (DMO) or THIS brand's
        // official domain. If any source is trusted → official_source_used true.
        let trustedByUs = false;
        let trustedMatch = null;
        if (trust.isTrustedDomain && brand) {
            trustedMatch = allUrls.find(url => trust.isTrustedDomain(url, brand)) || null;
            trustedByUs  = Boolean(trustedMatch);
        }

        // Fallback (OR): when our trusted-domain check didn't match — e.g. early
        // runs or an unseen brand — fall back to the model's own claim.
        const official_source_used = trustedByUs || (parsed.official_source_used === true);

        // LEARN: record this brand's official domains for next time.
        // Gate (a)/(b) live inside recordBrandDomain, so only brand-name-matching
        // domains are stored — junk (reddit, retailers) is filtered regardless
        // of how the model tagged it.
        if (trust.recordBrandDomain && brand && allUrls.length) {
            trust.recordBrandDomain(brand, allUrls);
        }

        // did we actually identify the product? (at least one core field present)
        const identified = Boolean(
            parsed.product_name || parsed.product_code || parsed.brand
        );

        // review needed if no trusted/official basis, or product not identified
        const needs_review = !official_source_used || !identified;

        const result = {
            // original invoice line fields (incl. item_category/item_subcategory)
            ...originalItem,

            // enriched product fields — these go to the products table
            product_name:   parsed.product_name || originalItem.product_name,
            product_code:   parsed.product_code || originalItem.product_code   || null,
            brand:          brand,
            specs:          (parsed.specs && typeof parsed.specs === 'object') ? parsed.specs : {},
            item_subcategory:       parsed.item_subcategory     || originalItem.item_category || null,
            search_sources: sources,

            // metadata
            official_source_used,
            needs_review,
            enriched: true,
        };

        console.log(`✅ Tamamlandı — inceleme gerekli: ${needs_review ? 'EVET' : 'HAYIR'}`);
        if (result.brand)    console.log(`   Marka    : ${result.brand}`);
        if (result.specs?.model) console.log(`   Model    : ${result.specs.model}`);
        if (result.category) console.log(`   Kategori : ${result.category}`);
        if (trustedMatch)    console.log(`   ✓ Güvenilir kaynak: ${trustedMatch}`);
        if (sources.length)  console.log(`   Kaynaklar: ${sources.map(s => s.type).join(', ')}`);

        return result;

    } catch (err) {
        console.error('❌ Yanıt parse edilemedi:', err.message);
        console.error('Ham yanıt:', text);
        return buildFallback(originalItem);
    }
}
// ─── fallback ─────────────────────────────────────────────────────────────────

function buildFallback(item) {
    return {
        ...item,
        product_name:         item.product_name || null,
        product_code:         item.product_code || null,
        brand:                item.brand_name   || null,
        specs:                {},
        item_subcategory:             item.item_subcategory || null,
        search_sources:       [],
        official_source_used: false,
        needs_review:         true,
        enriched:             true,
    };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── export ───────────────────────────────────────────────────────────────────

module.exports = { enrichProduct, enrichProducts };