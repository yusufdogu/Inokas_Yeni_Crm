# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
# Start the server (Node.js spawns Python automatically)
npm start          # → node index.js on port 3000

# Run the Python DMO service standalone (normally auto-started by Node)
python3 app.py     # → Flask on port 5000
```

There is no build step, no bundler, no test suite. The app is deployed to Railway via `npm start`.

**Environment variables required** (`.env` or Railway env panel):
- `SUPABASE_URL`, `SUPABASE_KEY` — Supabase project credentials
- `INOKAS_VKN` — The company's Turkish tax number (VKN); used server-side for invoice direction validation
- `PORT` — defaults to 3000
- `DMO_PY_HOST`, `DMO_PY_PORT` — defaults to `127.0.0.1:5000`
- `DMO_PY_AUTOSTART` — set to `false` to prevent Node from auto-spawning `app.py`

## Architecture

### Dual-Process Design

`index.js` (Express, Node.js) is the main server. On startup it spawns `app.py` (Flask, Python) as a child process. The Node server proxies `/api/dmo/*` routes to the Python service at `localhost:5000`. The Python service handles PDF parsing and web scraping that require Python libraries (pdfplumber, BeautifulSoup).

### Database: Supabase (PostgreSQL)

All persistent state lives in Supabase. Key tables:
- `companies` — counter-party firms, uniquely keyed on `vkn_tckn`
- `invoices` — invoice headers; `direction` is either `'INCOMING'` or `'OUTGOING'`; `efatura_uuid` is the unique e-invoice identifier from XML
- `invoice_items` — line items; `is_internal` marks inter-company transfers; `product_code` is the SKU
- `products` — product catalog with `product_code` as the business key; stores DMO URL, pricing, category
- `purchase_orders` / `purchase_order_items` — backorder system; `received_qty` is updated when matching invoices arrive
- `payments` — payment history linked to invoices
- `rate_history` — USD/EUR exchange rate log from TCMB

Two Supabase RPCs are used:
- `update_invoice_transaction(p_invoice_id, p_invoice_data, p_company_data, p_items_data)` — atomic invoice update
- `recalculate_invoice_payment_status(p_invoice_id)` — recomputes `paid_amount` and `status` on the invoice row

Stock movements are **not** stored in a dedicated table. The `/api/stocks/summary` endpoint derives all stock positions and FIFO profit analysis dynamically by joining `invoice_items` with `invoices`.

### Frontend: Vanilla JS (no framework)

All UI is plain HTML/CSS/JS. The three main sections correspond to three pages:
- `/` → `public/index.html` — invoice management (parse XML, view, edit, delete invoices; record payments)
- `/stok.html` → `public/stok.html` + `public/stok.js` — stock summary, movements, purchase orders, SKU merging, FIFO profit drill-down
- `/dmo/dmo-index.html` → `dmo/` — DMO.gov.tr price tracking; PDF upload for DMO order parsing

`public/nav-pill.js` and `public/nav.css` are shared navigation components used across pages.

The DMO section (`dmo/`) loads Supabase directly from the browser using a hardcoded anon key in `dmo/supabase-client.js`. All other pages communicate only with the Express server API.

#### Faturalar JS Modülleri (`public/faturalar/`)

`public/index.html` yükleme sırası (bağımlılık sırasına göre):
1. `faturalar/utils.js` — yardımcı fonksiyonlar (formatMoneyDisplay, invPayableAmountSrc, vb.)
2. `faturalar/xml.js` — UBL-XML tarayıcı taraflı parse ve renderXmlToPdfIframe
3. `faturalar/api.js` — sunucu API çağrıları
4. `faturalar/state.js` — global state değişkenleri (allInvoicesCache, bekleyenCache, vb.)
5. `faturalar/list.js` — fatura listesi görünümü ve filtre mantığı
6. `faturalar/detail.js` — fatura detay paneli (bilgiler/ürünler/ödemeler sekmeleri, inline düzenleme)
7. `faturalar/main.js` — başlatma, hash yönlendirme, rapor ve bekleyen sayfaları

Tüm fonksiyonlar global scope'ta tanımlıdır (import/export yok). `import`/`export` kullanma.

#### Sidebar Yapısı

Her iki ana bölüm (faturalar ve DMO) aynı sidebar yapısını paylaşır:
- **Faturalar:** `public/sidebar.js` (çalışma zamanında HTML üretir), `public/sidebar.css` (DMO ile aynı koyu tema)
- **DMO:** `dmo/js/sidebar.js` + `dmo/css/sidebar.css`

Sidebar CSS sınıfları: `.app-shell` (flex kapsayıcı), `#sidebar` (koyu panel, `#0f172a`), `.page-area` (içerik alanı), `.sb-item`, `.sb-children` (akordeon), `.sb-child`, `.sb-brand`, `.sb-footer`.

`#sidebar.collapsed { width: 52px; }` — `toggleSidebar()` ile `collapsed` sınıfı açılır/kapanır.

#### Fatura Detay Sekmelerinin Davranışı

`detail.js` içindeki `renderDetailTabContent`: bilgiler ve ürünler sekmeleri doğrudan `enterBilgilerEdit` / `enterUrunlerEdit` ile açılır — okuma modu (renderBilgilerView / renderUrunlerView) bypass edilir.

Ürünler düzenleme (`enterUrunlerEdit`): her satırda kategori `<select>` gösterilir. Ofis-içi satırlar için `INTERNAL_CATEGORY_OPTIONS` (statik liste), diğerleri için `productCategoryOptionList` (DB'den). "+ yeni kategori ekle" seçeneği seçilince satır içi input gösterilir (✓/✕ butonları).

#### Bekleyen Faturalar Listesi

`renderBekleyenList` (main.js) tablo satırı değil kart (`<div class="bek-card">`) üretir. Her kartta: fatura no (bold), yön noktası (yeşil=gelen/kırmızı=giden), firma adı, tutar+döviz, tarih. `#bekTbody` artık `<div class="bek-card-list">` (tablo değil).

#### Rapor Sayfası Scroll

`.rapor-body` → `overflow: hidden`; `.rapor-table-wrap` → `overflow-y: auto; flex: 1; min-height: 0` — tablo KPI kartlarından bağımsız dikey scroll yapar.

### Invoice XML Flow (UBL Format)

Turkish e-invoices use UBL XML. The frontend parses XML in the browser (`faturalar.js`) using `DOMParser` + XPath-style namespace queries with the `cbc:`/`cac:` namespace prefixes. After parsing, it POSTs to `/api/save-invoice`.

The server validates direction via `INOKAS_VKN`:
- `INCOMING`: `customer_vkn` must equal `INOKAS_VKN`
- `OUTGOING`: `supplier_vkn` must equal `INOKAS_VKN`

`INOKAS_VKN` is injected into `index.html` at request time as `window.__INOKAS_VKN__` (see `getFaturalarIndexHtml()` in `index.js`).

### Services (Legacy / Manual Sync)

`services/sync-service.js` and `services/logo-api.js` were used for bulk historical sync from the Logo e-invoice API. They are not invoked by the main server; `services/runSync.js` is a standalone script run manually.

`services/ubl-parser.js` decodes base64-encoded ZIP archives (from Logo API) containing UBL XML files.

### Cache Busting

HTML and JS files are served with `no-cache` headers. JS/CSS files referenced in HTML use `?v=<tag>` query strings (e.g., `faturalar.js?v=20260423-po-integration`) to bust browser cache after deploys. When updating JS, increment the version tag in the corresponding HTML `<script src>` tag.

### Stock Calculation Details

`/api/stocks/summary` in `index.js` builds FIFO lots from `INCOMING` invoice items, consumes them against `OUTGOING` items (sorted by invoice date), and computes:
- `current_stock` = total_in − total_out
- `fifo_gross_profit_usd` per product — revenue in USD minus FIFO cost
- USD conversion: items priced in TRY are divided by `calculation_rate` from the invoice header

Lines matching `KARGO` in product name/code are excluded from stock. Items with `is_internal = true` are excluded from cost calculations.
