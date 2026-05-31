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

### Auth & Multi-Tenancy

Auth is session-based. `public/auth/login.html` posts credentials to `/api/auth`; on success, the server returns a token stored in `sessionStorage` as `inokas_token`.

Every API route (except `/api/auth`) is protected by `middleware/tenant.js`, which reads `x-auth-token` from request headers, looks up the session in the `sessions` Supabase table, and injects `req.tenantId`, `req.userId`, and `req.userRole` into the request.

`public/shared/auth-interceptor.js` is included in every page. It monkey-patches `window.fetch` to automatically attach `x-auth-token` to all `/api/` calls. Pages check `sessionStorage.getItem('inokas_token')` on load and redirect to `/auth/login.html` if missing.

`public/index.html` is a redirect-only entry point — it sends authenticated users to `/faturalar/pages/gelen-faturalar.html` and unauthenticated users to `/auth/login.html`.

### Database: Supabase (PostgreSQL)

All persistent state lives in Supabase. Key tables:
- `sessions` — auth sessions keyed on token; includes `tenant_id`, `user_id`, `role`, `expires_at`
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

### API Routes

Routes are split into separate files under `routes/`. `index.js` mounts them:

| Mount prefix | File |
|---|---|
| `/api/auth` | `routes/auth.js` |
| `/api/invoices`, `/api/save-invoice`, `/api/invoice-items` | `routes/invoices.js` |
| `/api/settings`, `/api/tenant-vkn` | `routes/settings.js` |
| `/api/products`, `/api/category-templates`, `/api/category-attributes`, `/api/product-attribute-values` | `routes/products.js` |
| `/api/purchase-orders`, `/api/purchase-order-items` | `routes/purchase-orders.js` |
| `/api/stocks` | `routes/stocks.js` |
| `/api/payments` | `routes/payments.js` |
| `/api/companies` | `routes/companies.js` |
| `/api/cari` | `routes/cari.js` |
| `/api/dmo` | `routes/dmo.js` (also proxies to Python) |
| `/api/quotes`, `/api/product-groups` | `routes/quotes.js` |
| `/api/chat` | `routes/chat.js` |
| `/api/transcribe` | `routes/transcribe.js` |
| `/api/whatsapp` | `routes/whatsapp.js` |
| `/api/integrations` | `routes/integrations.js` |

### Frontend: Vanilla JS (no framework)

All UI is plain HTML/CSS/JS. No import/export — all functions are global scope. Pages are organized into sections, each with its own `pages/`, `css/`, and `js/` subdirectories under `public/`.

#### Page Structure

| Section | Entry pages |
|---|---|
| **Faturalar** | `public/faturalar/pages/` — gelen-faturalar, giden-faturalar, genel-bakis, bekleyen-gelen, bekleyen-giden, fatura-detay, fatura-yukle, rapor, ofis-ici |
| **Stok** | `public/stok/pages/` — stok, genel-bakis, urunler, stok-hareketleri, urun-hareketleri, backorder, kategori-yonetimi |
| **DMO** | `public/dmo/pages/` — invoice, siparisler, yeni-siparis, sepet-hesapla |
| **Cari** | `public/cari/` — cari-index.html, firma.html |
| **Teklifler** | `public/quotes/pages/` — teklifler, teklif-form |
| **Chat** | `public/chat.html` |
| **Auth** | `public/auth/` — login, signup, onboarding |
| **Settings** | `public/settings.html` |

#### Shared Components (`public/shared/`)

- `sidebar.js` — generates sidebar HTML at runtime; used by all main sections
- `sidebar.css` — dark sidebar theme (`#0f172a`); shared across all sections
- `auth-interceptor.js` — patches `window.fetch` to inject auth token on all `/api/` calls; included in every page
- `supabase-client.js` — browser-side Supabase client (anon key); used by pages that query Supabase directly
- `shared-filters.css` — shared filter bar styles
- `nav-pill.js` / `nav.css` — shared navigation pill component

#### Sidebar Structure

All sections use the same sidebar pattern:
- `<div id="sidebar-container"></div>` in the HTML body
- `<script src="/shared/sidebar.js" defer></script>` in the head
- CSS classes: `.app-shell` (flex container), `#sidebar` (dark panel), `.page-area` (content area), `.sb-item`, `.sb-children` (accordion), `.sb-child`, `.sb-brand`, `.sb-footer`
- `#sidebar.collapsed { width: 52px; }` — `toggleSidebar()` toggles the `collapsed` class

#### Faturalar JS Modules (`public/faturalar/js/`)

`faturalar.html` and the other faturalar pages load scripts in dependency order:

1. `utils.js` — helper functions (formatMoneyDisplay, invPayableAmountSrc, etc.)
2. `xml.js` — UBL-XML browser-side parsing and renderXmlToPdfIframe
3. `api.js` — server API calls
4. `state.js` — global state variables (allInvoicesCache, bekleyenCache, etc.)
5. `list.js` — invoice list view and filter logic
6. `detail.js` — invoice detail panel (bilgiler/ürünler/ödemeler tabs, inline editing)
7. `main.js` — init, hash routing, pending/report page orchestration

Additional standalone page scripts (each page loads only what it needs):
- `genel-bakis.js` — genel-bakis.html only; uses Chart.js
- `bekleyen-page.js` — bekleyen pages
- `fatura-detay.js` — fatura-detay.html standalone detail page
- `ofis-ici.js` — ofis-ici.html
- `rapor.js` — rapor.html

Do not use `import`/`export`. All functions must be global scope.

#### Fatura Detail Tab Behaviour

`detail.js` → `renderDetailTabContent`: bilgiler and ürünler tabs open directly via `enterBilgilerEdit` / `enterUrunlerEdit` — read-only mode (renderBilgilerView / renderUrunlerView) is bypassed.

Ürünler edit (`enterUrunlerEdit`): each row shows a category `<select>`. In-house rows use `INTERNAL_CATEGORY_OPTIONS` (static list); others use `productCategoryOptionList` (from DB). Selecting "+ yeni kategori ekle" shows an inline input (✓/✕ buttons).

#### Stok JS Modules (`public/stok/js/`)

`stok.html` loads all stok scripts together (global scope, dependency order):

1. `utils.js`
2. `urunler.js`
3. `stok-hareketleri.js`
4. `urun-hareketleri.js`
5. `backorder.js`
6. `kategori-yonetimi.js`
7. `analytics.js`
8. `stok.js` — orchestrator / init

`genel-bakis.html` loads only `genel-bakis.js` (standalone, uses Chart.js).

### Invoice XML Flow (UBL Format)

Turkish e-invoices use UBL XML. The frontend parses XML in the browser (`xml.js`) using `DOMParser` + XPath-style namespace queries with the `cbc:`/`cac:` namespace prefixes. After parsing, it POSTs to `/api/save-invoice`.

The server validates direction via `INOKAS_VKN`:
- `INCOMING`: `customer_vkn` must equal `INOKAS_VKN`
- `OUTGOING`: `supplier_vkn` must equal `INOKAS_VKN`

`INOKAS_VKN` is now served via `/api/tenant-vkn` (fetched at runtime) rather than injected into HTML at request time.

### Services (Legacy / Manual Sync)

`services/sync-service.js` and `services/logo-api.js` were used for bulk historical sync from the Logo e-invoice API. They are not invoked by the main server; `services/runSync.js` is a standalone script run manually.

`services/ubl-parser.js` decodes base64-encoded ZIP archives (from Logo API) containing UBL XML files.

### Cache Busting

HTML and JS files are served with `no-cache` headers. JS/CSS files referenced in HTML use `?v=<tag>` query strings (e.g., `?v=20260521-sort`) to bust browser cache after deploys. When updating JS, increment the version tag in the corresponding HTML `<script src>` tag.

### Stock Calculation Details

`routes/stocks.js` → `GET /api/stocks/summary` builds FIFO lots from `INCOMING` invoice items, consumes them against `OUTGOING` items (sorted by invoice date), and computes:
- `current_stock` = total_in − total_out
- `fifo_gross_profit_usd` per product — revenue in USD minus FIFO cost
- USD conversion: items priced in TRY are divided by `calculation_rate` from the invoice header

Lines matching `KARGO` in product name/code are excluded from stock. Items with `is_internal = true` are excluded from cost calculations.
