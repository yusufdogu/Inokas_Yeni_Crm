// Stok sayfası yardımcı fonksiyonları
// DOM veya fetch içermez — sadece veri alır, değer döndürür.

// ─── Format yardımcıları ──────────────────────────────────────────────────────

function fmtQty(v)       { return Number(v || 0).toLocaleString('tr-TR'); }
function fmtUsd(v)       { return `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtUsdOrDash(v) { if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'; return fmtUsd(v); }
function esc(str)        { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ─── Session cache yardımcıları ───────────────────────────────────────────────

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ─── Kategori kontrolü ────────────────────────────────────────────────────────

function isSarfCategory(category) {
  const c = String(category || '').toLocaleLowerCase('tr-TR');
  return c.includes('sarf');
}

// ─── Stok hareket hesaplamaları ───────────────────────────────────────────────

function getSoldQtyLastDaysBySku(sku, days) {
  if (!sku) return 0;
  const nowTs = Date.now();
  const maxAge = Number(days || 30) * 24 * 60 * 60 * 1000;
  return allMovements.reduce((sum, mv) => {
    if (String(mv.sku || '') !== sku) return sum;
    if (String(mv.direction || '') !== 'OUTGOING') return sum;
    const ts = mv.invoice_date ? new Date(mv.invoice_date).getTime() : NaN;
    if (!Number.isFinite(ts)) return sum;
    if ((nowTs - ts) > maxAge) return sum;
    return sum + (Number(mv.quantity || 0) || 0);
  }, 0);
}

function buildInsightModel() {
  const slowMoving = allStocks
    .map((row) => {
      const sku = String(row.sku || '');
      const current = Number(row.current_stock || 0);
      const sold30 = getSoldQtyLastDaysBySku(sku, 30);
      const coverDays = sold30 > 0 ? Math.round((current / sold30) * 30) : (current > 0 ? 9999 : 0);
      return {
        name: row.product_name || sku || 'Ürün',
        value: coverDays,
        label: coverDays >= 9999 ? 'Satış yok' : `${coverDays} gün`,
        hasStock: current > 0
      };
    })
    .filter((x) => x.hasStock && x.value > 0)
    .sort((a, b) => (b.value - a.value))
    .slice(0, 10);

  const topSold = allStocks
    .map((row) => ({
      name: row.product_name || row.sku || 'Ürün',
      value: Number(row.total_out || 0)
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => (b.value - a.value))
    .slice(0, 10)
    .map((x) => ({ ...x, label: `${fmtQty(x.value)} adet` }));

  const topProfit = allStocks
    .map((row) => ({
      name: row.product_name || row.sku || 'Ürün',
      value: Number(row.fifo_gross_profit_usd || 0)
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => (b.value - a.value))
    .slice(0, 10)
    .map((x) => ({ ...x, label: fmtUsd(x.value) }));

  return {
    slow: { subtitle: 'Top 10 - Depoda en uzun süre yetecek ürünler', variant: 'slow', rows: slowMoving },
    sold: { subtitle: 'Top 10 - Satılan adet', variant: 'sold', rows: topSold },
    profit: { subtitle: 'Top 10 - FIFO brüt kar (USD)', variant: 'profit', rows: topProfit }
  };
}

// ─── Kar drill-down hesaplamaları ─────────────────────────────────────────────

function getProfitBySkuInRange() {
  const { start, end } = getInsightDateRange();
  const map = new Map();
  (allProfitEvents || []).forEach((ev) => {
    if (ev?.is_internal === true) return;
    const sku = String(ev.sku || '').trim();
    const d = String(ev.invoice_date || '').slice(0, 10);
    if (!sku || !d) return;
    if (start && d < start) return;
    if (end && d > end) return;
    map.set(sku, Number(map.get(sku) || 0) + Number(ev.gross_profit_usd || 0));
  });
  return map;
}

function buildProfitDrillRows() {
  const metricBySku = getProfitBySkuInRange();
  const internalOnlySet = new Set((internalOnlySkus || []).map((x) => String(x || '').trim()).filter(Boolean));

  const source = [];
  const seen = new Set();
  (allProductsCatalog || []).forEach((p) => {
    const sku = String(p.sku || '').trim();
    if (!sku || seen.has(sku) || internalOnlySet.has(sku)) return;
    seen.add(sku);
    source.push({
      sku,
      product_name: p.product_name || '',
      brand: p.brand || '',
      category: p.category || '',
      model: p.model || '',
      fifo_gross_profit_usd: metricBySku.has(sku) ? Number(metricBySku.get(sku) || 0) : 0
    });
  });
  (allStocks || []).forEach((r) => {
    const sku = String(r.sku || '').trim();
    if (!sku || seen.has(sku) || internalOnlySet.has(sku)) return;
    seen.add(sku);
    source.push({
      sku,
      product_name: r.product_name || '',
      brand: r.brand || '',
      category: r.category || '',
      model: r.model || '',
      fifo_gross_profit_usd: Number(r.fifo_gross_profit_usd || 0)
    });
  });

  let rows = [];
  let subtitle = 'Marka Bazlı Kar (USD)';
  if (profitDrillState.level === 'brand') {
    const byBrand = new Map();
    source.forEach((r) => {
      const key = String(r.brand || 'Markasız').trim() || 'Markasız';
      byBrand.set(key, Number(byBrand.get(key) || 0) + Number(r.fifo_gross_profit_usd || 0));
    });
    rows = [...byBrand.entries()].map(([name, value]) => ({ name, value, canDrill: true }));
  } else if (profitDrillState.level === 'category') {
    const scoped = source.filter((r) => String(r.brand || 'Markasız').trim() === profitDrillState.brand);
    const byCategory = new Map();
    scoped.forEach((r) => {
      const key = String(r.category || 'Kategorisiz').trim() || 'Kategorisiz';
      byCategory.set(key, Number(byCategory.get(key) || 0) + Number(r.fifo_gross_profit_usd || 0));
    });
    rows = [...byCategory.entries()].map(([name, value]) => ({ name, value, canDrill: !isSarfCategory(name) }));
    subtitle = `${profitDrillState.brand} > Kategori Bazlı Kar`;
  } else {
    const scoped = source.filter((r) =>
      String(r.brand || 'Markasız').trim() === profitDrillState.brand &&
      String(r.category || 'Kategorisiz').trim() === profitDrillState.category
    );
    const byModel = new Map();
    scoped.forEach((r) => {
      const key = String(r.model || r.product_name || r.sku || 'Modelsiz').trim() || 'Modelsiz';
      byModel.set(key, Number(byModel.get(key) || 0) + Number(r.fifo_gross_profit_usd || 0));
    });
    rows = [...byModel.entries()].map(([name, value]) => ({ name, value, canDrill: false }));
    subtitle = `${profitDrillState.brand} > ${profitDrillState.category} > Model Bazlı Kar`;
  }
  rows.sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  return { rows, subtitle };
}
