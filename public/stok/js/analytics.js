// stok/analytics.js — Chart.js based analytics for Stok Hareketleri
// Requires Chart.js loaded via CDN before this file.

let _charts = {};

function renderCharts(movements) {
  const grid = document.getElementById('analizGrid');
  if (!grid) return;

  // Destroy old charts
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch {} });
  _charts = {};

  grid.innerHTML = `
    <div class="analiz-chart-card">
      <div class="analiz-chart-title">Aylık Hareket (Adet)</div>
      <canvas id="chart-monthly" class="analiz-chart-canvas"></canvas>
    </div>
    <div class="analiz-chart-card">
      <div class="analiz-chart-title">Firma Bazlı Hacim (Top 10)</div>
      <canvas id="chart-companies" class="analiz-chart-canvas"></canvas>
    </div>
    <div class="analiz-chart-card">
      <div class="analiz-chart-title">En Çok Hareket Gören Ürünler (Top 10)</div>
      <canvas id="chart-products" class="analiz-chart-canvas"></canvas>
    </div>
    <div class="analiz-chart-card">
      <div class="analiz-chart-title">Giriş / Çıkış Dağılımı</div>
      <canvas id="chart-direction" class="analiz-chart-canvas"></canvas>
    </div>
  `;

  _charts.monthly    = _buildMonthlyChart(movements);
  _charts.companies  = _buildCompaniesChart(movements);
  _charts.products   = _buildProductsChart(movements);
  _charts.direction  = _buildDirectionChart(movements);
}

// ─── Chart 1: Movements over time (monthly bar) ───────────────────────────────
function _buildMonthlyChart(movements) {
  const ctx = document.getElementById('chart-monthly');
  if (!ctx || typeof Chart === 'undefined') return null;

  const byMonth = {};
  movements.forEach(m => {
    const d = String(m.invoice_date || '').slice(0, 7); // YYYY-MM
    if (!d) return;
    if (!byMonth[d]) byMonth[d] = { in: 0, out: 0 };
    if (m.direction === 'INCOMING') byMonth[d].in  += Number(m.quantity || 0);
    else                            byMonth[d].out += Number(m.quantity || 0);
  });

  const labels = Object.keys(byMonth).sort();
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Giriş',
          data: labels.map(l => byMonth[l].in),
          backgroundColor: 'rgba(5,150,105,0.75)',
          borderRadius: 4,
        },
        {
          label: 'Çıkış',
          data: labels.map(l => byMonth[l].out),
          backgroundColor: 'rgba(220,38,38,0.7)',
          borderRadius: 4,
        }
      ]
    },
    options: _baseOptions({ stacked: true }),
  });
}

// ─── Chart 2: Top 10 companies by total quantity ──────────────────────────────
function _buildCompaniesChart(movements) {
  const ctx = document.getElementById('chart-companies');
  if (!ctx || typeof Chart === 'undefined') return null;

  const byCompany = {};
  movements.forEach(m => {
    const name = String(m.company_name || 'Bilinmiyor').trim();
    byCompany[name] = (byCompany[name] || 0) + Number(m.quantity || 0);
  });

  const sorted = Object.entries(byCompany).sort((a,b) => b[1]-a[1]).slice(0,10);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: 'Adet',
        data: sorted.map(([,v]) => v),
        backgroundColor: _palette(sorted.length),
        borderRadius: 4,
      }]
    },
    options: {
      ..._baseOptions(),
      indexAxis: 'y',
    }
  });
}

// ─── Chart 3: Top 10 products by movement count ───────────────────────────────
function _buildProductsChart(movements) {
  const ctx = document.getElementById('chart-products');
  if (!ctx || typeof Chart === 'undefined') return null;

  const byProduct = {};
  movements.forEach(m => {
    const name = String(m.product_name || m.sku || 'Bilinmiyor').trim();
    byProduct[name] = (byProduct[name] || 0) + Number(m.quantity || 0);
  });

  const sorted = Object.entries(byProduct).sort((a,b) => b[1]-a[1]).slice(0,10);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{
        label: 'Adet',
        data: sorted.map(([,v]) => v),
        backgroundColor: _palette(sorted.length, 1),
        borderRadius: 4,
      }]
    },
    options: {
      ..._baseOptions(),
      indexAxis: 'y',
    }
  });
}

// ─── Chart 4: INCOMING vs OUTGOING donut ─────────────────────────────────────
function _buildDirectionChart(movements) {
  const ctx = document.getElementById('chart-direction');
  if (!ctx || typeof Chart === 'undefined') return null;

  const inQty  = movements.filter(m => m.direction === 'INCOMING').reduce((s,m) => s + Number(m.quantity||0), 0);
  const outQty = movements.filter(m => m.direction === 'OUTGOING').reduce((s,m) => s + Number(m.quantity||0), 0);

  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Giriş', 'Çıkış'],
      datasets: [{
        data: [inQty, outQty],
        backgroundColor: ['rgba(5,150,105,0.8)', 'rgba(220,38,38,0.75)'],
        borderWidth: 2,
        borderColor: '#f8fafc',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11, family: 'Plus Jakarta Sans' }, color: '#64748b' }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${Number(ctx.raw).toLocaleString('tr-TR')} adet`
          }
        }
      }
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _baseOptions({ stacked = false } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: stacked,
        labels: { font: { size: 11, family: 'Plus Jakarta Sans' }, color: '#64748b', boxWidth: 12 }
      },
      tooltip: {
        callbacks: {
          label: ctx => ` ${Number(ctx.raw).toLocaleString('tr-TR')}`
        }
      }
    },
    scales: {
      x: {
        stacked,
        ticks: { font: { size: 10, family: 'Plus Jakarta Sans' }, color: '#94a3b8', maxRotation: 45 },
        grid: { color: '#f1f5f9' }
      },
      y: {
        stacked,
        ticks: { font: { size: 10, family: 'Plus Jakarta Sans' }, color: '#94a3b8' },
        grid: { color: '#f1f5f9' }
      }
    }
  };
}

const _PALETTES = [
  ['#2563eb','#0ea5e9','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6','#f97316','#06b6d4','#84cc16'],
  ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#65a30d','#9333ea','#0d9488','#ca8a04'],
];

function _palette(n, set = 0) {
  const p = _PALETTES[set] || _PALETTES[0];
  return Array.from({ length: n }, (_, i) => p[i % p.length]);
}