// Stok sayfası backend API iletişim katmanı
// Veri yükleme ve cache yazma — ağır DOM manipülasyonu içermez.

async function ensureProductCategoryOptions() {
  if (Array.isArray(productCategoryOptions) && productCategoryOptions.length > 0) return;
  try {
    const res = await fetch('/api/products/category-map');
    if (!res.ok) return;
    const data = await res.json();
    productCategoryOptions = Array.isArray(data?.categories)
      ? data.categories.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
  } catch {}
}

async function loadStockSummary() {
  const cached = readCache(STOCK_CACHE_KEY);
  if (cached) {
    allStocks          = cached.data               || [];
    stockStats         = cached.stats              || null;
    allProductsCatalog = cached.product_catalog    || [];
    allProfitEvents    = cached.profit_events      || [];
    internalOnlySkus   = cached.internal_only_skus || [];
    renderStockStats();
    renderStockCategoryFilter();
    renderStockInsights();
    renderDepoTable();
  }

  try {
    const res = await fetch('/api/stocks/summary');
    if (!res.ok) throw new Error('Stok verileri alınamadı');
    const payload = await res.json();
    allStocks          = payload.data               || [];
    stockStats         = payload.stats              || null;
    allProductsCatalog = payload.product_catalog    || [];
    allProfitEvents    = payload.profit_events      || [];
    internalOnlySkus   = payload.internal_only_skus || [];
    writeCache(STOCK_CACHE_KEY, {
      data: allStocks,
      stats: stockStats,
      product_catalog: allProductsCatalog,
      profit_events: allProfitEvents,
      internal_only_skus: internalOnlySkus
    });
    renderStockStats();
    renderStockCategoryFilter();
    renderStockInsights();
    renderDepoTable();
  } catch (err) {
    console.error('Stok hatası:', err);
    if (!cached) showEmpty('stocksEmptyState', 'Stok verileri alınamadı.');
  }
}

async function loadMovements() {
  const cached = readCache(MOVEMENT_CACHE_KEY);
  if (cached) {
    allMovements = cached;
    renderMovementCompanyOptions();
    renderStockInsights();
    renderMovementsTable();
  }

  try {
    const res = await fetch('/api/stocks/movements', { cache: 'no-store' });
    if (!res.ok) throw new Error();
    allMovements = await res.json();
    writeCache(MOVEMENT_CACHE_KEY, allMovements);
    renderMovementCompanyOptions();
    renderStockInsights();
    renderMovementsTable();
  } catch {
    if (!cached) showEmpty('movementsEmptyState', 'Hareket verileri alınamadı.');
  }
}

async function loadPendingOrders() {
  const cached = readCache(PO_CACHE_KEY);
  if (cached) {
    allPendingOrders = cached;
    renderPendingOrdersTable();
    updatePendingPoStat();
    renderStockInsights();
  }

  try {
    const res = await fetch('/api/purchase-orders/all-pending');
    if (!res.ok) throw new Error();
    allPendingOrders = await res.json();
    writeCache(PO_CACHE_KEY, allPendingOrders);
    renderPendingOrdersTable();
    updatePendingPoStat();
    renderStockInsights();
  } catch {
    if (!cached) showEmpty('poEmptyState', 'Sipariş verileri alınamadı.');
  }
}
