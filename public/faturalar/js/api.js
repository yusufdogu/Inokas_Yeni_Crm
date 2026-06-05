// Backend API iletişim katmanı
// Sadece fetch çağrıları ve veri cache'leme — DOM'a dokunmaz.


async function ensureBulkTenantVkn() {
    if (bulkTenantVkn) return bulkTenantVkn;

    const token = sessionStorage.getItem('inokas_token');
    let r;
    try {
        r = await fetch('/api/tenant-vkn', {
          headers: { 'x-auth-token': sessionStorage.getItem('inokas_token') }
        });
    } catch (e) {
        throw new Error('Tenant VKN alınamadı. Sunucu bağlantısını kontrol edin.');
    }
    if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Tenant VKN alınamadı.');
    }
    const j = await r.json();
    bulkTenantVkn = String(j.vkn || '').trim();
    if (!bulkTenantVkn) throw new Error('Firma VKN bilgisi girilmemiş. Lütfen ayarlardan VKN ekleyin.');
    return bulkTenantVkn;
}
// ─── Ana veri yükleme ─────────────────────────────────────────────────────────

// ─── Pagination state ─────────────────────────────────────────────────────
let _currentPage = 1;
let _totalPages = 1;
let _totalCount = 0;
let _pageLimit = 10;

async function initInvoiceView(useCache = false) {
  if (!window._filterOptionsLoaded || window._lastFilterView !== currentView) {
    window._lastFilterView = currentView;
    window._filterOptionsLoaded = true;
    await refreshFilterOptions();
    await refreshKpiSummary();
  }

  if (useCache && allInvoicesCache?.length > 0) {
    _lastListInvoices = allInvoicesCache;
    if (activeTabKey === 'list') {
      renderListView(allInvoicesCache);
      hideLoadingOverlay();
    }
    return;
  }

  try {
    const params = new URLSearchParams();

    if (currentView === 'gelen') params.set('direction', 'INCOMING');
    if (currentView === 'giden') params.set('direction', 'OUTGOING');

    const apiUrl = window._FAT_PENDING ? '/api/invoices/pending' : '/api/invoices';

    params.set('page', _currentPage);
    params.set('limit', _pageLimit);

    const f = window._fatActiveFilters || {};
    if (f.dateStart)       params.set('date_start',  f.dateStart);
    if (f.dateEnd)         params.set('date_end',     f.dateEnd);
    if (f.currency)        params.set('currency',     f.currency);
    if (f.status)          params.set('status',       f.status);
    if (f.search)          params.set('search',       f.search);
    if (f.companies?.length)  params.set('companies',  f.companies.join(','));
    if (f.brands?.length)     params.set('brands',     f.brands.join(','));
    if (f.categories?.length) params.set('categories', f.categories.join(','));
    if (f.products?.length)   params.set('products',   f.products.map(p => encodeURIComponent(p)).join(','));
    if (f.models?.length)     params.set('models',     f.models.join(','));

    if (fatListSort?.col) {
      const colMap = { company: 'company_name', total: 'total', date: 'invoice_date' };
      params.set('sort_by', colMap[fatListSort.col] || 'invoice_date');
      params.set('sort_dir', fatListSort.dir || 'desc');
    }

    const res  = await fetch(`${apiUrl}?${params.toString()}`);
    const json = await res.json();

    allInvoicesCache = json.data        || [];
    _totalCount      = json.total       || 0;
    _totalPages      = json.total_pages || 1;
    _currentPage     = json.page        || 1;

    // in initInvoiceView, replace the render block with:
    if (allInvoicesCache && hasInteracted()) {
      _lastListInvoices = allInvoicesCache;
      saveFilterState();
      if (activeTabKey === 'list' && typeof renderListView === 'function') {
        renderListView(allInvoicesCache);
        if (typeof hideLoadingOverlay === 'function') hideLoadingOverlay();
      }
    }

    renderPagination();

  } catch (err) {
    console.error('initInvoiceView hatası:', err.message);
  }
}

window._fatFilterOptions = {
  companies: [],
  brands: [],
  products: [],
  categories: [],
  models: [],
};

// ─── Brand / Model cache ──────────────────────────────────────────────────────
let _brandOptions = [];          // ['ASUS', 'EPSON', 'HP', ...]
let _modelsByBrand = new Map();   // Map { 'HP' => ['HP LaserJet Pro', ...] }
let _brandModelFetchedAt = 0;
let _brandModelPromise = null;
const BRAND_MODEL_TTL_MS = 5 * 60 * 1000;

async function ensureBrandModelLoaded(force = false) {
  const now = Date.now();
  const fresh = _brandOptions.length > 0 && (now - _brandModelFetchedAt) < BRAND_MODEL_TTL_MS;
  if (!force && fresh) return;
  if (_brandModelPromise) { await _brandModelPromise; return; }

  _brandModelPromise = (async () => {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error('Ürün listesi alınamadı');
    const products = await res.json();

    const brands = new Set();
    const byBrand = new Map();

    (products || []).forEach(p => {
      const brand = String(p.brand || '').trim();
      const model = String(p.model || '').trim();
      if (brand) {
        brands.add(brand);
        if (model) {
          if (!byBrand.has(brand)) byBrand.set(brand, new Set());
          byBrand.get(brand).add(model);
        }
      }
    });

    _brandOptions = [...brands].sort((a, b) => a.localeCompare(b, 'tr'));
    _modelsByBrand = new Map([...byBrand.entries()].map(([b, ms]) => [b, [...ms].sort((a, b) => a.localeCompare(b, 'tr'))]));
    _brandModelFetchedAt = Date.now();
  })();

  try { await _brandModelPromise; }
  finally { _brandModelPromise = null; }
}

// ─── Save new category to a product by SKU ───────────────────────────────────
async function saveNewCategoryToProduct(sku, category) {
  if (!sku || !category) return;
  try {
    const res = await fetch(`/api/products/by-code?code=${encodeURIComponent(sku)}`);
    if (!res.ok) return; // product not found, skip silently
    const product = await res.json();
    if (!product?.id) return;

    await fetch(`/api/products/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category })
    });

    // Update local cache
    if (!productCategoryOptionList.includes(category)) {
      productCategoryOptionList.push(category);
      productCategoryOptionList.sort((a, b) => a.localeCompare(b, 'tr'));
    }
    const normalSku = normalizeProductCodeForMatch(sku);
    if (normalSku) productCategoryByCodeMap.set(normalSku, category);
  } catch (e) {
    console.warn('Kategori kaydedilemedi:', e.message);
  }
}

// ─── Ürün kodu / kategori cache ───────────────────────────────────────────────

async function ensureProductCodeLookupSetLoaded(force = false) {
  const now = Date.now();
  const fresh = productCodeLookupSet && (now - productCodeLookupFetchedAt) < PRODUCT_CODE_CACHE_TTL_MS;
  if (!force && fresh) return;
  if (productCodeLookupPromise) {
    await productCodeLookupPromise;
    return;
  }

  productCodeLookupPromise = (async () => {
    const res = await fetch('/api/products/codes');
    if (!res.ok) throw new Error('Ürün kod listesi alınamadı');
    const json = await res.json();
    const codes = Array.isArray(json?.codes) ? json.codes : [];
    productCodeLookupSet = new Set(
      codes.map((x) => normalizeProductCodeForMatch(x)).filter(Boolean)
    );
    productCodeLookupFetchedAt = Date.now();
  })();

  try {
    await productCodeLookupPromise;
  } finally {
    productCodeLookupPromise = null;
  }
}

async function ensureProductCategoryLookupLoaded(force = false) {
  const now = Date.now();
  const fresh = productCategoryOptionList.length > 0 && (now - productCategoryFetchedAt) < PRODUCT_CODE_CACHE_TTL_MS;
  if (!force && fresh) return;
  if (productCategoryPromise) {
    await productCategoryPromise;
    return;
  }
  productCategoryPromise = (async () => {
    const res = await fetch('/api/products/category-map');
    if (!res.ok) throw new Error('Ürün kategori listesi alınamadı');
    const json = await res.json();
    const rows = Array.isArray(json?.rows) ? json.rows : [];
    const categories = Array.isArray(json?.categories) ? json.categories : [];
    productCategoryByCodeMap = new Map(
      rows
        .map((r) => [normalizeProductCodeForMatch(r?.product_code), String(r?.category || '').trim()])
        .filter(([k]) => !!k)
    );
    productCategoryOptionList = categories
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    productCategoryFetchedAt = Date.now();
  })();
  try {
    await productCategoryPromise;
  } finally {
    productCategoryPromise = null;
  }
}


async function deleteInvoice(id) {
  if (!confirm("⚠️ Bu faturayı ve içerisindeki tüm ürünleri silmek istediğinize emin misiniz?\nBu işlem geri alınamaz!")) return;

  try {
    const response = await fetch(`/api/invoices/${id}`, { method: 'DELETE' });

    // log raw response first
    const text = await response.text();
    console.log('DELETE response status:', response.status);
    console.log('DELETE response body:', text);

    if (!response.ok) throw new Error(`Silinemedi: ${response.status} — ${text}`);

    // in deleteInvoice, replace initInvoiceView(true) with:
    alert("✅ Fatura başarıyla silindi!");
    if (typeof goBack === 'function') goBack();        // detail page — go back to list
    else if (typeof initInvoiceView === 'function') initInvoiceView(true); // list page
  } catch (err) {
    console.error("Silme hatası:", err.message);
    alert("Fatura silinirken bir hata oluştu: " + err.message);
  }
}

async function saveInvoiceToDatabase(e) {
    e.preventDefault();
    if (isInvoiceSaveInFlight) {
        alert("Kaydetme işlemi devam ediyor, lütfen bekleyin.");
        return;
    }
    const invoiceId = document.getElementById('f_id')?.value;
    const fin = readInvoiceFinancialsFromForm();
    const formCurrency = document.getElementById('f_currency')?.value?.trim() || 'TL';

    const lineRows = document.querySelectorAll('#lineItemsBody tr');
    let itemsFromForm = [];
    try {
        itemsFromForm = Array.from(lineRows).map((row) => {
            const cells = row.querySelectorAll('td');
            const productName = row.querySelector('td:first-child input[type="text"]')?.value?.trim() || cells[0]?.innerText?.trim() || 'İsimsiz Ürün';
            const qtyInput = row.querySelector('input[type="number"]');
            const numberInputs = row.querySelectorAll('input[type="number"]');
            const qty = parseFloat(qtyInput?.value || cells[2]?.innerText || 0) || 0;
            const unitPrice = parseFloat(numberInputs[1]?.value || cells[3]?.innerText || 0) || 0;
            const lineTotal = qty * unitPrice;
            const taxRate = parseFloat(row.querySelector('.tax-rate-val')?.value || cells[5]?.innerText || 0) || 0;
            const internalToggle = row.querySelector('.internal-toggle');
            const isInternal = internalToggle ? !!internalToggle.checked : false;
            const rowCategoryVal = row.querySelector('.line-category-select')?.value?.trim() || '';
            const skuVal = row.querySelector('.line-sku-val')?.value?.trim() || '';
            const poItemId = row.querySelector('.po-item-id-val')?.value || null;
            if (isInternal && !rowCategoryVal) {
                throw new Error(`Ofis içi ürünlerde kategori zorunlu: ${productName}`);
            }
            return {
                product_name: productName,
                product_code: skuVal || null,
                quantity: qty,
                unit_code: 'ADET',
                unit_price_cur: unitPrice,
                tax_rate: taxRate,
                total_price_cur: lineTotal,
                currency: formCurrency,
                is_internal: isInternal,
                item_subcategory: isInternal ? rowCategoryVal : null,
                product_category: !isInternal ? (rowCategoryVal || null) : null,
                purchase_order_item_id: poItemId
            };
        }).filter(item => item.product_name && item.quantity > 0);
    } catch (mapErr) {
        alert(mapErr.message || 'Ürün satırları doğrulanamadı.');
        return;
    }

    if (invoiceId) {
        const updatePayload = {
            update_stock: document.getElementById('f_update_stock')?.checked !== false,
            invoice: {
                due_date: document.getElementById('f_due_date')?.value || null,
                notes: document.getElementById('f_notes')?.value || '',
                invoice_type: document.getElementById('f_type')?.value || 'Ticari',
                invoice_no: document.getElementById('f_no')?.value || '',
                invoice_date: document.getElementById('f_date')?.value || null,
                ...fin
            },
            company: {
                vkn_tckn: document.getElementById('f_vkn')?.value?.trim() || '',
                name: document.getElementById('f_firma')?.value?.trim() || '',
                tax_office: document.getElementById('f_tax_office')?.value?.trim() || '',
                phone: document.getElementById('f_phone')?.value?.trim() || '',
                email: document.getElementById('f_email')?.value?.trim() || '',
                website: document.getElementById('f_website')?.value?.trim() || '',
                address: document.getElementById('f_address')?.value?.trim() || ''
            },
            items: itemsFromForm
        };

        try {
            isInvoiceSaveInFlight = true;
            const response = await fetch(`/api/invoices/${invoiceId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatePayload)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Güncelleme hatası");
            alert(result.message || "Fatura başarıyla güncellendi.");
            clearStockCaches();
            closeInvoiceModal();
            await initInvoiceView(true);
            return;
        } catch (err) {
            console.error("Güncelleme Hatası:", err.message);
            alert("Hata oluştu: " + err.message);
            return;
        } finally {
            isInvoiceSaveInFlight = false;
        }
    }

    if (!currentParsedData) {
        alert("Lütfen önce bir XML yükleyin!");
        return;
    }

    const itemsToSave = itemsFromForm;

    const companyFromUi = {
        vkn_tckn: document.getElementById('f_vkn')?.value?.trim() || '',
        name: document.getElementById('f_firma')?.value?.trim() || '',
        tax_office: document.getElementById('f_tax_office')?.value?.trim() || '',
        phone: document.getElementById('f_phone')?.value?.trim() || '',
        email: document.getElementById('f_email')?.value?.trim() || '',
        website: document.getElementById('f_website')?.value?.trim() || '',
        address: document.getElementById('f_address')?.value?.trim() || ''
    };

    const invoiceFromUi = {
        ...fin,
        invoice_no: document.getElementById('f_no')?.value || '',
        invoice_type: document.getElementById('f_type')?.value || 'Ticari',
        invoice_date: document.getElementById('f_date')?.value || null,
        due_date: document.getElementById('f_due_date')?.value || null,
        status: 'unpaid',
        paid_amount: 0,
        paid_amount_cur: 0,
        notes: document.getElementById('f_notes')?.value || ''
    };

    const payload = {
        submit_view: currentView,
        parsed_view: currentParsedData.parsed_view || null,
        update_stock: document.getElementById('f_update_stock')?.checked !== false,
        company: { ...(currentParsedData.company || {}), ...companyFromUi },
        invoice: { ...currentParsedData.invoice, ...invoiceFromUi },
        xml_context: currentParsedData.xml_context || null,
        items: itemsToSave
    };

    try {
        isInvoiceSaveInFlight = true;
        const response = await fetch('/api/save-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
            const errorObj = new Error(result.error || "Sunucu hatası");
            errorObj.code = result.errorCode;
            throw errorObj;
        }
        alert(result.message);
        clearStockCaches();
        closeInvoiceModal();
        await initInvoiceView(true);
    } catch (err) {
        console.error("Kayıt Hatası:", err.message);
        if (err.code === '23505') {
            alert("⚠️ BU FATURA DAHA ÖNCE YÜKLENMİŞ!\nSistemde aynı faturadan zaten bulunduğu için tekrar kaydedilemez.");
        } else {
            alert("Hata oluştu: " + err.message);
        }
    } finally {
        isInvoiceSaveInFlight = false;
    }
}

// api.js — refreshFilterOptions just fetches and stores, nothing else
async function refreshFilterOptions() {
  try {
    const params = new URLSearchParams();
    if (currentView === 'gelen') params.set('direction', 'INCOMING');
    if (currentView === 'giden') params.set('direction', 'OUTGOING');

    const res  = await fetch(`/api/invoices/filter-options?${params.toString()}`);
    const data = await res.json();

    window._fatFilterOptions = {
      companies:     data.companies     || [],
      brands:        data.brands        || [],
      products:      data.products      || [],
      categories:    data.categories    || [],
      currencies:    data.currencies    || [],
      relationships: data.relationships || [],
    };

    // only call UI functions if they exist (not on detail page)
    if (typeof populateCurrencySelect === 'function') populateCurrencySelect();
  } catch (err) {
    console.error('refreshFilterOptions hatası:', err.message);
  }
}
