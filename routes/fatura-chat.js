// ─── /api/chat — v4 with Claude Haiku 4.5 ───────────────────────────────────
// Streams Claude responses with data context AND lets the model call tools.
// Phase 3a: only applyFilters tool is exposed (UI action).

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5';

const { fetchKpiSummary, fetchInvoiceList } = require('./invoices');


const SHARED_PROMPT = `
FIRMA/ÜRÜN/MARKA ADI KURALI:
Kullanıcının yazdığı ismi olduğu gibi araca ilet — otomatik düzeltme YAPMA.
Backend fuzzy matching (harf değişimi, eksik/fazla harf) yapar.
Örnek: kullanıcı "inokas" derse applyFilters({companies:["inokas"]}) çağır.

ÖNEMLİ — Firma araması hakkında:
Örnek listede olmayan bir firmayı arıyorsan bile, kullanıcı sana bir firma adı verdiğinde HER ZAMAN applyFilters aracını çağır.
Kullanıcı "İndeks'i göster" derse:
❌ "Listede İndeks yok" DEME
✅ applyFilters({companies: ["İndeks"]}) çağır

FİLTRE TEMİZLEME:
Kullanıcı filtreleri kaldırmak/sıfırlamak/temizlemek istediğinde applyFilters aracını BOŞ argümanlarla çağır: applyFilters({}).
Sadece "Filtreleri temizledim" gibi bir metinle cevap verme — mutlaka aracı çağır.
Örnekler:
- "Tüm filtreleri kaldır" → applyFilters({})
- "Filtreleri sıfırla" → applyFilters({})
- "Baştan başla" → applyFilters({})

SIRALAMA ÖRNEKLERİ:
- "En pahalı faturalar" → sortBy: "amount", sortDir: "desc"
- "En ucuz faturalar" → sortBy: "amount", sortDir: "asc"
- "En yeni faturalar" → sortBy: "date", sortDir: "desc"
- "En eski faturalar" → sortBy: "date", sortDir: "asc"
- "Alfabetik firma sırasıyla" → sortBy: "company", sortDir: "asc"
- "En pahalı 10 Acme faturası" → sortBy: "amount", sortDir: "desc", companies: ["Acme"]

ARAÇLAR:
- applyFilters: Kullanıcı belirli bir alt küme istediğinde bu aracı çağır. Mevcut filtreleri TAMAMEN değiştirir.
- Filtre uygulandıktan sonra tool_result'ta hangi firma bulunduğunu görebilirsin ve kullanıcıya söyleyebilirsin.
- Filtre uyguladıktan sonra kısa bir özet ver (örn: "Acme firmasını filtreledim.").

Kısa, net Türkçe yanıt ver. Para birimlerini ₺/$/€ sembolleriyle göster.

TARİH REFERANSLARI:
- "bu ay" = mevcut takvim ayının 1'i - bugün
- "geçen ay" = önceki takvim ayının 1'i - son günü (örn. bugün Haziran'daysa 1 Mayıs - 31 Mayıs)
- "bu hafta" = bu Pazartesi - bugün
- "geçen hafta" = önceki Pazartesi - önceki Pazar
- "son X gün" = bugün - X gün önce
- "bu yıl" = 1 Ocak - bugün

KPI ÖZETİ:
Kullanıcı toplam, sayı, ortalama gibi ANALİTİK sorular sorduğunda getKpiSummary tool'unu çağır.
UI'yi değiştirmez — sadece bilgi verir.
Yön (giden/gelen) otomatik uygulanır, parametre olarak geçme.

Örnekler:
- "Toplam ne kadar?" → getKpiSummary({})
- "Kaç fatura var?" → getKpiSummary({})
- "Kaç firmayla çalışıyorum?" → getKpiSummary({})
- "Acme'den kaç fatura var?" → getKpiSummary({companies: ["Acme"]})
- "Bu ay ne kadar ödedim?" → getKpiSummary({dateStart: "2026-07-01", dateEnd: "2026-07-05"})
- "USD faturaların toplamı?" → getKpiSummary({currency: "USD"})

Cevabı verirken tool_result'taki tam sayıları kullan, tahmin YAPMA.

applyFilters vs getKpiSummary:
- applyFilters → UI'yi günceller, kullanıcı fatura listesini filtrelemek istiyorsa
- getKpiSummary → sadece bilgi, kullanıcı sayı/toplam soruyorsa
- İkisi birlikte de kullanılabilir: kullanıcı "Acme'yi filtrele ve toplamı söyle" derse
  önce applyFilters çağır, sonra getKpiSummary çağır.
  
  FATURA LİSTESİ:
Kullanıcı bireysel faturalar hakkında soru sorduğunda (en büyük X, son Y, top N)
getInvoices tool'unu çağır. Maksimum 20 fatura döndürebilir.

Örnekler:
- "En büyük satış ne?" → getInvoices({sortBy:"amount", sortDir:"desc", limit:1})
- "Top 5 fatura" → getInvoices({sortBy:"amount", sortDir:"desc", limit:5})
- "Son 10 fatura" → getInvoices({sortBy:"date", sortDir:"desc", limit:10})
- "Acme'nin en son faturası?" → getInvoices({companies:["Acme"], sortBy:"date", sortDir:"desc", limit:1})

3 tool kararı:
- applyFilters → UI'de filtre uygulamak
- getKpiSummary → toplam/sayı sorular (aggregate)
- getInvoices → tek tek fatura görmek gerekir (top X, en büyük, son N)

Cevap verirken tool_result'taki gerçek verileri kullan, tahmin YAPMA.
`;

const TAB_INTROS = {
    giden: `Sen kullanıcının GİDEN faturaları için bir asistansın. Giden fatura kullanıcının sattığı ürünlerin faturalarıdır.
Sadece giden faturalar hakkında soru cevapla. Gelen hakkında sorulursa kibarca yönlendir.`,

    gelen: `Sen kullanıcının GELEN faturaları için bir asistansın. Gelen fatura kullanıcının satın aldığı ürünlerin faturalarıdır.
Sadece gelen faturalar hakkında soru cevapla. Giden hakkında sorulursa kibarca yönlendir.`,

    genel: `Sen kullanıcının genel finansal görünümü için bir asistansın — hem gelen hem giden hakkında konuşabilirsin.
Bu sekmede filtre uygulama aracı YOKTUR (applyFilters kullanma).
Sadece getKpiSummary ile veri sorularını cevaplayabilirsin.`,
};


// Compose final prompts on demand
function _buildPrompt(tab) {
    const intro = TAB_INTROS[tab];
    if (!intro) return '';

    // Genel doesn't have filter tools — skip the shared filter section
    if (tab === 'genel') {
        return `${intro}\n\nKısa, net Türkçe yanıt ver. Para birimlerini ₺/$/€ sembolleriyle göster.\n\nTARİH REFERANSLARI:\n- "bu ay" = mevcut takvim ayının 1'i - bugün\n- "geçen ay" = önceki takvim ayının 1'i - son günü\n- "bu hafta" = bu Pazartesi - bugün\n- "geçen hafta" = önceki Pazartesi - önceki Pazar\n- "son X gün" = bugün - X gün önce\n- "bu yıl" = 1 Ocak - bugün`;
    }

    return `${intro}\n\n${SHARED_PROMPT}`;
}


// ── Helpers ─────────────────────────────────────────────────────────────────
const _fmt = n => (parseFloat(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
const _safeDate = d => {
    if (!d) return null;
    try { return new Date(d).toISOString().slice(0, 10); } catch { return null; }
};


// ── Data fetchers (unchanged) ───────────────────────────────────────────────


function _bestMatchList(requested, available) {
    if (!Array.isArray(requested) || !requested.length) return { matched: [], unmatched: [] };

    const norm = s => String(s || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[ıİI]/g, 'i').replace(/[şŞ]/g, 's').replace(/[çÇ]/g, 'c')
        .replace(/[ğĞ]/g, 'g').replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o')
        .replace(/[^a-z0-9 ]/g, '')   // strip punctuation
        .replace(/\s+/g, ' ')
        .trim();

    const matched = [];
    const unmatched = [];
    const availNorm = (available || []).map(a => ({ original: a, normalized: norm(a) }));

    for (const q of requested) {
        const qn = norm(q);

        // 1. Exact match
        let hit = availNorm.find(a => a.normalized === qn);

        // 2. Contains match (either direction)
        if (!hit) hit = availNorm.find(a => a.normalized.includes(qn) || qn.includes(a.normalized));

        // 3. Fuzzy match — Levenshtein distance
        //    Threshold: allow ~20% of query length in edits (min 2)
        if (!hit) {
            const maxDistance = Math.max(2, Math.floor(qn.length * 0.25));
            let bestFuzzy = null;
            let bestDist  = Infinity;

            for (const a of availNorm) {
                // Skip huge candidates — probably not typos of a short query
                if (Math.abs(a.normalized.length - qn.length) > maxDistance) {
                    // Try token-level match instead (query might be a substring of any word)
                    const tokens = a.normalized.split(' ');
                    for (const tok of tokens) {
                        if (Math.abs(tok.length - qn.length) > maxDistance) continue;
                        const d = _levenshtein(qn, tok);
                        if (d <= maxDistance && d < bestDist) {
                            bestFuzzy = a;
                            bestDist = d;
                        }
                    }
                    continue;
                }

                const d = _levenshtein(qn, a.normalized);
                if (d <= maxDistance && d < bestDist) {
                    bestFuzzy = a;
                    bestDist = d;
                }
            }

            if (bestFuzzy) hit = bestFuzzy;
        }

        if (hit) matched.push(hit.original);
        else unmatched.push(q);
    }
    return { matched, unmatched };
}

// Levenshtein distance — how many single-char edits to transform a into b
function _levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    // Use only two rows to keep memory O(min(a,b))
    let prev = new Array(b.length + 1);
    let curr = new Array(b.length + 1);

    for (let j = 0; j <= b.length; j++) prev[j] = j;

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = (a[i - 1] === b[j - 1]) ? 0 : 1;
            curr[j] = Math.min(
                curr[j - 1] + 1,        // insertion
                prev[j] + 1,            // deletion
                prev[j - 1] + cost      // substitution
            );
        }
        [prev, curr] = [curr, prev];
    }
    return prev[b.length];
}


// ── Fetch full filter-option lists (unchanged) ──────────────────────────────
async function _fetchFilterOptions(supabase, tenantId, direction) {
    // Exclude fully-internal invoices (small list — safe to serialize)
    const { data: excluded } = await supabase
        .from('fully_internal_invoice_ids')
        .select('invoice_id');
    const excludeIds = (excluded || []).map(r => r.invoice_id);

    let invQuery = supabase
        .from('invoices')
        .select('id, invoice_no, companies(name)')
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .or('approval_status.neq.pending,approval_status.is.null');

    if (direction)         invQuery = invQuery.eq('direction', direction);
    if (excludeIds.length) invQuery = invQuery.not('id', 'in', `(${excludeIds.join(',')})`);

    const { data: invRows } = await invQuery;
    const companies = [...new Set((invRows || []).map(r => r.companies?.name).filter(Boolean))];
    const invoiceNumbers = [...new Set((invRows || []).map(r => r.invoice_no).filter(Boolean))];

    const directionFilteredIds = (invRows || []).map(r => r.id).filter(Boolean);

    // Fetch items — if list is huge, fetch all non-internal and filter in JS
    let itemRows;
    if (directionFilteredIds.length <= 500) {
        const { data } = await supabase
            .from('invoice_items')
            .select('product_name, product_code')
            .eq('is_internal', false)
            .in('invoice_id', directionFilteredIds);
        itemRows = data || [];
    } else {
        const { data } = await supabase
            .from('invoice_items')
            .select('invoice_id, product_name, product_code')
            .eq('is_internal', false);
        const idSet = new Set(directionFilteredIds);
        itemRows = (data || []).filter(r => idSet.has(r.invoice_id));
    }

    const products     = [...new Set(itemRows.map(r => r.product_name).filter(Boolean))];
    const productCodes = [...new Set(itemRows.map(r => r.product_code).filter(Boolean))];

    let brands = [], categories = [];
    if (productCodes.length) {
        // Same handling for products query
        let productRows;
        if (productCodes.length <= 500) {
            const { data } = await supabase
                .from('products')
                .select('brand, category')
                .eq('tenant_id', tenantId)
                .eq('is_internal', false)
                .in('product_code', productCodes);
            productRows = data || [];
        } else {
            const { data } = await supabase
                .from('products')
                .select('product_code, brand, category')
                .eq('tenant_id', tenantId)
                .eq('is_internal', false);
            const codeSet = new Set(productCodes);
            productRows = (data || []).filter(r => codeSet.has(r.product_code));
        }
        brands     = [...new Set(productRows.map(r => r.brand).filter(Boolean))];
        categories = [...new Set(productRows.map(r => r.category).filter(Boolean))];
    }

    return { companies, brands, categories, products, invoiceNumbers };
}

// ── applyFilters resolver (unchanged) ───────────────────────────────────────
async function _resolveApplyFiltersArgs(args, supabase, tenantId, direction) {
    const options = await _fetchFilterOptions(supabase, tenantId, direction);
    const applied = {};
    const warnings = [];

    for (const key of ['companies', 'brands', 'categories', 'products', 'invoiceNumbers']) {
        if (Array.isArray(args[key]) && args[key].length) {
            const { matched, unmatched } = _bestMatchList(args[key], options[key] || []);
            applied[key] = matched;
            if (unmatched.length) warnings.push(`${key}: ${unmatched.join(', ')} bulunamadı`);
        } else {
            applied[key] = [];
        }
    }

    applied.dateStart = args.dateStart ? _safeDate(args.dateStart) : null;
    applied.dateEnd   = args.dateEnd   ? _safeDate(args.dateEnd)   : null;

    // Coerce priceMin/priceMax — handle numbers or numeric strings
    const toNum = v => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? null : n; }
        return null;
    };
    applied.priceMin  = toNum(args.priceMin);
    applied.priceMax  = toNum(args.priceMax);
    applied.currency  = args.currency ? String(args.currency).toUpperCase() : null;

    // ── ADD sort handling ──
    const ALLOWED_SORT_COLS = ['date', 'amount', 'company', 'invoice_no'];
    const ALLOWED_SORT_DIRS = ['asc', 'desc'];

    applied.sortBy  = ALLOWED_SORT_COLS.includes(args.sortBy) ? args.sortBy  : null;
    applied.sortDir = ALLOWED_SORT_DIRS.includes(args.sortDir) ? args.sortDir : null;

    // If sortBy provided but sortDir isn't, default to desc
    if (applied.sortBy && !applied.sortDir) applied.sortDir = 'desc';

    return { applied, warnings };
}


// ── Context builder (unchanged) ─────────────────────────────────────────────


// ── Tool definition — Anthropic schema (JSON Schema, not Google Type enums) ─
const APPLY_FILTERS_TOOL = {
    name: 'applyFilters',
    description: 'Kullanıcı fatura filtresi istediğinde HER ZAMAN çağır. Firma/marka/kategori/ürün için kısmi eşleşme çalışır — kısa isimlerle de çalışır. Backend fuzzy matching ile gerçek ismi bulur.\n' +
        '\n' +
        'ÖNEMLİ ayrım:\n' +
        '- "Asus" gibi bir MARKA adı verildiğinde → brands parametresini kullan (products DEĞİL)\n' +
        '- "Acme Ltd" gibi bir FİRMA adı verildiğinde → companies\n' +
        '- Tam bir ürün adı verildiğinde (model + SKU seviyesi) → products\n' +
        '\n' +
        'Örnek eşleşmeler:\n' +
        '- "Asus faturaları" → brands: ["Asus"]\n' +
        '- "İndeks\'ten olan faturalar" → companies: ["İndeks"]\n' +
        '- "Samsung monitör içeren faturalar" → brands: ["Samsung"], categories: ["Monitör"]\n' +
        '\n' +
        'Mevcut filtreleri TAMAMEN değiştirir.'+
        'Boş argümanlarla çağrıldığında ({}) TÜM filtreleri temizler. Kullanıcı temizleme/sıfırlama istediğinde bu şekilde çağır.',
    input_schema: {
        type: 'object',
        properties: {
            companies: {
                type: 'array',
                items: { type: 'string' },
                description: 'Firma/şirket/tedarikçi/müşteri isimleri. Örn: "Acme Ltd", "İndeks Bilgisayar". Kullanıcı "X firmasının faturaları", "X\'ten faturaları" gibi ifadeler kullandığında burada.',
            },
            brands: {
                type: 'array',
                items: { type: 'string' },
                description: 'ÜRETICI marka isimleri (Asus, Samsung, HP, Nvidia, Apple, Dell gibi). Kullanıcı "X markası", "X marka ürünler", "X ürünü olan faturalar" gibi ifadeler kullandığında burada. Marka bir SKU değil, bir üretici firmadır.',
            },
            categories: {
                type: 'array',
                items: { type: 'string' },
                description: 'Ürün kategorileri (Monitör, Klavye, Yazılım, Sunucu gibi). Belirli bir ürün türü aranıyorsa.',
            },
            products: {
                type: 'array',
                items: { type: 'string' },
                description: 'Spesifik ürün adları (SKU seviyesi). Kullanıcı tam bir ürün adı verirse (örn. "ASUS VZ249HG monitör"). Sadece marka adı için burayı KULLANMA — bunun için brands\'i kullan.',
            },
            invoiceNumbers: {
                type: 'array',
                items: { type: 'string' },
                description: 'Fatura numaraları (örn. "INV-2026-001")',
            },
            dateStart: { type: 'string', description: 'Başlangıç tarihi YYYY-MM-DD' },
            dateEnd:   { type: 'string', description: 'Bitiş tarihi YYYY-MM-DD' },
            priceMin: {
                type: 'number',
                description: 'Minimum tutar. Değer, currency parametresi ile birlikte kullanılır — currency belirtilmezse TL varsayılır. Örn: "10K USD fatura" → priceMin: 10000, currency: "USD".',
            },
            priceMax: {
                type: 'number',
                description: 'Maksimum tutar. currency ile birlikte kullanılır.',
            },
            currency: {type: 'string', description: 'Fatura para birimi (base_currency): TRY, USD veya EUR. Kullanıcı fatura tutarı ile birlikte bir para birimi belirttiğinde MUTLAKA burayı doldur. Örn: "10K TL faturaları" → currency: "TRY", priceMin: 10000. Sadece "10K faturaları" derse currency boş kalabilir.',},
            sortBy: {
                type: 'string',
                enum: ['date', 'amount', 'company', 'invoice_no'],
                description: 'Sıralama kriteri. Kullanıcı "en pahalı", "en yeni", "alfabetik" gibi ifadeler kullandığında burayı doldur.',
            },
            sortDir: {
                type: 'string',
                enum: ['asc', 'desc'],
                description: 'Sıralama yönü. Varsayılan: desc (büyükten küçüğe / yeniden eskiye).',
            },
        },
    },
};
const GET_KPI_SUMMARY_TOOL = {
    name: 'getKpiSummary',
    description: 'Belirli bir filtre kombinasyonu için KPI özetini döndürür — fatura sayısı, farklı firma sayısı, ve para birimlerine göre toplam tutarlar. UI\'yi DEĞİŞTİRMEZ, sadece veri getirir.\n\nKullanıcı toplam, sayı, ortalama gibi ANALİTİK sorular sorduğunda çağır.\n\nÖrnekler:\n- "Toplam ne kadar?" → getKpiSummary({})\n- "İndeks\'in bu ayki toplamı?" → getKpiSummary({companies:["İndeks"], dateStart:"2026-07-01", dateEnd:"2026-07-05"})\n- "USD faturaların sayısı?" → getKpiSummary({currency:"USD"})\n- "Acme\'den kaç fatura var?" → getKpiSummary({companies:["Acme"]})\n\nCevabı verirken tool_result\'taki gerçek sayıları kullan, tahmin ETME.\nUI\'ye filtre uygulamak istiyorsan applyFilters kullan — bu farklı bir araç.',
    input_schema: {
        type: 'object',
        properties: {
            companies:      { type: 'array', items: { type: 'string' }, description: 'Firma isimleri' },
            brands:         { type: 'array', items: { type: 'string' }, description: 'Marka isimleri' },
            categories:     { type: 'array', items: { type: 'string' }, description: 'Kategori isimleri' },
            products:       { type: 'array', items: { type: 'string' }, description: 'Ürün isimleri' },
            invoiceNumbers: { type: 'array', items: { type: 'string' }, description: 'Fatura numaraları' },
            dateStart:      { type: 'string', description: 'Başlangıç tarihi YYYY-MM-DD' },
            dateEnd:        { type: 'string', description: 'Bitiş tarihi YYYY-MM-DD' },
            priceMin:       { type: 'number', description: 'Minimum tutar' },
            priceMax:       { type: 'number', description: 'Maksimum tutar' },
            currency:       { type: 'string', description: 'TRY, USD veya EUR' },
        },
    },
};
const GET_INVOICES_TOOL = {
    name: 'getInvoices',
    description: 'Belirli filtreler ve sıralama ile FATURA LİSTESİNİ döndürür — bireysel fatura kayıtlarına erişim sağlar. UI\'yi DEĞİŞTİRMEZ, sadece Claude için veri getirir.\n\n"En büyük X fatura", "en son Y fatura", "top 5" gibi listeleme soruları için kullan. Ayrıca "en büyük satış ne kadar?" gibi tekil sorular için de çalışır (limit: 1).\n\nÖrnekler:\n- "En büyük satış ne?" → getInvoices({sortBy:"amount", sortDir:"desc", limit:1})\n- "Top 5 fatura?" → getInvoices({sortBy:"amount", sortDir:"desc", limit:5})\n- "En son 10 fatura?" → getInvoices({sortBy:"date", sortDir:"desc", limit:10})\n- "Acme\'nin en büyük 3 faturası?" → getInvoices({companies:["Acme"], sortBy:"amount", sortDir:"desc", limit:3})\n\nMaksimum 20 fatura döndürebilir. UI\'ye filtre uygulamak istiyorsan applyFilters kullan.',
    input_schema: {
        type: 'object',
        properties: {
            companies:      { type: 'array', items: { type: 'string' } },
            brands:         { type: 'array', items: { type: 'string' } },
            categories:     { type: 'array', items: { type: 'string' } },
            products:       { type: 'array', items: { type: 'string' } },
            invoiceNumbers: { type: 'array', items: { type: 'string' } },
            dateStart:      { type: 'string', description: 'YYYY-MM-DD' },
            dateEnd:        { type: 'string', description: 'YYYY-MM-DD' },
            priceMin:       { type: 'number' },
            priceMax:       { type: 'number' },
            currency:       { type: 'string' },
            sortBy: {
                type: 'string',
                enum: ['date', 'amount', 'company', 'invoice_no'],
                description: 'Varsayılan: date',
            },
            sortDir: {
                type: 'string',
                enum: ['asc', 'desc'],
                description: 'Varsayılan: desc',
            },
            limit: {
                type: 'integer',
                description: 'Kaç fatura döndürülsün (varsayılan 10, maks 20)',
            },
        },
    },
};
const GENERATE_REPORT_TOOL = {
    name: 'generateReport',
    description: 'Belirli bir firma için detaylı, indirilebilir bir PDF rapor oluşturur — KPIlar, en büyük faturalar, ürün dağılımı, zaman çizelgesi, ve yorumlar içerir.\n\nKullanıcı "rapor", "özet", "detaylı analiz" istediğinde çağır. UI\'yi değiştirmez, sadece bir PDF dosyası üretir.\n\nÖrnekler:\n- "Acme için bu yılın raporu" → generateReport({companies:["Acme"], dateStart:"2026-01-01", dateEnd:"2026-07-05"})\n- "İndeks için son 3 ay raporu" → generateReport({companies:["İndeks"], dateStart:"2026-04-05", dateEnd:"2026-07-05"})\n- "Bu ayın raporunu hazırla" → generateReport({dateStart:"2026-07-01", dateEnd:"2026-07-05"}) (belirli firma yok)\n\nRapor hazırlandığında kullanıcıya kısa bir özet + indirme bağlantısı sunulur.',
    input_schema: {
        type: 'object',
        properties: {
            companies: { type: 'array', items: { type: 'string' }, description: 'Rapor odağındaki firma(lar). Boşsa tüm firmalar dahil.' },
            dateStart: { type: 'string', description: 'YYYY-MM-DD' },
            dateEnd:   { type: 'string', description: 'YYYY-MM-DD' },
            title:     { type: 'string', description: 'Rapor için özel başlık (opsiyonel). Yoksa otomatik üretilir.' },
        },
    },
};

function _toolsForTab(tab) {
    if (tab === 'genel') return [GET_KPI_SUMMARY_TOOL, GET_INVOICES_TOOL];
    return [APPLY_FILTERS_TOOL, GET_KPI_SUMMARY_TOOL, GET_INVOICES_TOOL];
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

    // SSE setup — same output format the frontend expects
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
        const today   = new Date().toISOString().slice(0, 10);
        const dayName = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const dateContext = `Bugünün tarihi: ${today} (${dayName})`;
        // After building system prompt, add current filter state
        const activeFiltersDesc = _describeActiveFilters(filters || {});
        const systemPrompt = `${_buildPrompt(tab)}\n\n${dateContext}`;
        const tools = _toolsForTab(tab);

        // Conversation loop — keeps going as long as the model requests tools
        const messages = buildMessages(history, message);
        let safety = 0;

        while (safety++ < 5) {
            if (closed) break;

            const stream = await _streamWithRetry({
                model: MODEL,
                max_tokens: 2048,
                system: systemPrompt,
                messages,
                ...(tools ? { tools } : {}),
            });

            // Stream text tokens to the client as they arrive
            stream.on('text', (text) => {
                if (!closed && text) sendEvent('token', { text });
            });

            // Wait for the complete message
            let finalMessage;
            try {
                finalMessage = await stream.finalMessage();
            } catch (err) {
                const isRetryable = err?.status === 529 || err?.error?.type === 'overloaded_error';

                if (isRetryable && safety < 4) {
                    // Retry the whole turn
                    console.warn('[claude] mid-stream overload, retrying turn');
                    await new Promise(r => setTimeout(r, 1000));
                    continue;   // re-run the while loop iteration
                }
                throw err;
            }
            if (closed) break;

            // Find any tool_use blocks in the response
            const toolUses = (finalMessage.content || []).filter(c => c.type === 'tool_use');

            // No tools → conversation is done, exit the loop
            if (!toolUses.length) break;

            // Push assistant message (with tool_use blocks) into history
            messages.push({ role: 'assistant', content: finalMessage.content });

            // Execute each tool, collect results
            const toolResults = [];
            for (const toolUse of toolUses) {
                if (toolUse.name === 'applyFilters') {
                    console.log('[applyFilters] raw args from AI:', JSON.stringify(toolUse.input, null, 2));

                    sendEvent('tool_call', { name: 'applyFilters', args: toolUse.input || {} });

                    const { applied, warnings } = await _resolveApplyFiltersArgs(
                        toolUse.input || {}, supabase, tenantId, direction
                    );

                    console.log('[applyFilters] resolved:', JSON.stringify(applied, null, 2));
                    console.log('[applyFilters] warnings:', warnings);

                    // Emit UI action — frontend applies filters to the visible table
                    sendEvent('action', { type: 'applyFilters', params: applied });

                    // Feed the result back to Claude so it can compose a text reply
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
                else if (toolUse.name === 'getKpiSummary') {
                    console.log('[getKpiSummary] raw args from AI:', JSON.stringify(toolUse.input, null, 2));

                    sendEvent('tool_call', { name: 'getKpiSummary', args: toolUse.input || {} });

                    // Reuse the fuzzy matcher so "İndeks" → "INDEKS BİLGİSAYAR..."
                    const { applied, warnings } = await _resolveApplyFiltersArgs(
                        toolUse.input || {}, supabase, tenantId, direction
                    );

                    // Call the shared helper — auto-scope by tab's direction
                    let kpiResult;
                    try {
                        kpiResult = await fetchKpiSummary(supabase, tenantId, {
                            direction,
                            companies:      applied.companies,
                            brands:         applied.brands,
                            categories:     applied.categories,
                            products:       applied.products,
                            invoiceNumbers: applied.invoiceNumbers,
                            dateStart:      applied.dateStart,
                            dateEnd:        applied.dateEnd,
                            priceMin:       applied.priceMin,
                            priceMax:       applied.priceMax,
                            currency:       applied.currency,
                        });
                    } catch (err) {
                        console.error('[getKpiSummary] error:', err.message);
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'KPI verisi alınamadı: ' + err.message }),
                            is_error: true,
                        });
                        continue;
                    }

                    console.log('[getKpiSummary] result:', JSON.stringify(kpiResult, null, 2));

                    // Feed back to Claude (no UI action — this is data-only)
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: JSON.stringify({
                            totals: kpiResult.totals,
                            appliedFilters: applied,
                            warnings: warnings.length ? warnings : undefined,
                        }),
                    });
                }
                else if (toolUse.name === 'getInvoices') {
                    console.log('[getInvoices] raw args:', JSON.stringify(toolUse.input, null, 2));
                    sendEvent('tool_call', { name: 'getInvoices', args: toolUse.input || {} });

                    const { applied, warnings } = await _resolveApplyFiltersArgs(
                        toolUse.input || {}, supabase, tenantId, direction
                    );

                    // Sort/limit params come through as-is
                    const sortBy  = toolUse.input?.sortBy  || 'date';
                    const sortDir = toolUse.input?.sortDir || 'desc';
                    const limit   = toolUse.input?.limit   || 10;

                    let invoiceList;
                    try {
                        invoiceList = await fetchInvoiceList(supabase, tenantId, {
                            direction,
                            ...applied,
                            sortBy,
                            sortDir,
                            limit,
                        });
                    } catch (err) {
                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: toolUse.id,
                            content: JSON.stringify({ error: 'Fatura verisi alınamadı: ' + err.message }),
                            is_error: true,
                        });
                        continue;
                    }

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
                }

                else {
                    // Unknown tool
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: toolUse.id,
                        content: JSON.stringify({ error: 'Bu araç henüz desteklenmiyor.' }),
                        is_error: true,
                    });
                }
            }

            // Push tool results as the next user message so Claude can continue
            messages.push({ role: 'user', content: toolResults });
        }

        sendEvent('done', { ok: true });
        res.end();

    } catch (err) {
        console.error('chat /ask error:', err?.message || err);

        if (!closed) {
            let userMessage = err?.message || 'Bilinmeyen hata';

            // Recognize common Anthropic errors and translate
            if (err?.status === 529 || err?.error?.type === 'overloaded_error' || userMessage.includes('overloaded')) {
                userMessage = 'AI servisi şu an yoğun. Birkaç saniye sonra tekrar dener misin?';
            } else if (err?.status === 429) {
                userMessage = 'Çok fazla istek gönderildi. Biraz bekleyip tekrar dene.';
            } else if (err?.status >= 500) {
                userMessage = 'AI servisine ulaşılamıyor. Kısa süre sonra tekrar dene.';
            }

            sendEvent('error', { message: userMessage });
            res.end();
        }
    }
});


module.exports = router;