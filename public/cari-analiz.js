let analysisView = 'suppliers';
let allInvoices = [];
const CARI_ANALIZ_CACHE_KEY = 'inokas_cari_analiz_invoices_v1';
const CARI_ANALIZ_CACHE_TTL_MS = 10 * 60 * 1000; // 10 dakika

document.addEventListener('DOMContentLoaded', async () => {
  setupAnalysisUi();
  const forceFetchOnLoad = shouldForceFetchOnLoad();
  await fetchInvoicesForAnalysis(forceFetchOnLoad);
  renderCompanyCards();
});

function setupAnalysisUi() {
  const tabSuppliers = document.getElementById('tabSuppliers');
  const tabCustomers = document.getElementById('tabCustomers');
  const searchInput = document.getElementById('companySearch');

  tabSuppliers?.addEventListener('click', () => switchAnalysisView('suppliers'));
  tabCustomers?.addEventListener('click', () => switchAnalysisView('customers'));
  searchInput?.addEventListener('input', renderCompanyCards);
  document.getElementById('btnCloseCompanyModal')?.addEventListener('click', closeCompanyModal);

  // Yenile butonu: cache'i temizleyip sunucudan taze veri çeker, sayfayı yeniden render eder
  document.getElementById('btnRefreshAnaliz')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnRefreshAnaliz');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Yükleniyor...'; }
    sessionStorage.removeItem(CARI_ANALIZ_CACHE_KEY);
    await fetchInvoicesForAnalysis(true);
    renderCompanyCards();
    if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Yenile'; }
  });
  document.getElementById('companyDetailModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'companyDetailModal') closeCompanyModal();
  });
}

function switchAnalysisView(view) {
  analysisView = view;
  document.getElementById('tabSuppliers')?.classList.toggle('active', view === 'suppliers');
  document.getElementById('tabCustomers')?.classList.toggle('active', view === 'customers');
  renderCompanyCards();
}

function readCariAnalizCache() {
  try {
    const raw = sessionStorage.getItem(CARI_ANALIZ_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Geriye dönük uyumluluk: Eski sürüm direkt array yazıyordu.
    if (Array.isArray(parsed)) return parsed;
    if (!parsed || !Array.isArray(parsed.data)) return null;
    const ts = Number(parsed.ts || 0);
    if (!ts || (Date.now() - ts) > CARI_ANALIZ_CACHE_TTL_MS) {
      sessionStorage.removeItem(CARI_ANALIZ_CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch (e) {
    console.warn('Cari analiz cache okunamadı:', e);
    return null;
  }
}

function writeCariAnalizCache(invoices) {
  try {
    sessionStorage.setItem(CARI_ANALIZ_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      data: invoices
    }));
  } catch (e) {
    console.warn('Cari analiz cache yazılamadı:', e);
  }
}

function shouldForceFetchOnLoad() {
  // Kullanıcı browser refresh yaptıysa (F5/Cmd+R), cache'i bypass edip DB'den taze çek.
  const navEntry = performance.getEntriesByType('navigation')[0];
  if (navEntry && navEntry.type === 'reload') return true;

  // Bazı tarayıcılarda eski API fallback'i
  if (performance.navigation && performance.navigation.type === 1) return true;

  return false;
}

async function fetchInvoicesForAnalysis(forceFetch = false) {
  const emptyState = document.getElementById('analysisEmptyState');
  if (!forceFetch) {
    const cached = readCariAnalizCache();
    if (cached !== null) {
      allInvoices = cached;
      return;
    }
  }

  if (emptyState) {
    emptyState.style.display = 'block';
    emptyState.innerText = 'Rapor verisi yükleniyor...';
  }

  try {
    const response = await fetch('/api/invoices');
    if (!response.ok) throw new Error('Faturalar çekilemedi');
    allInvoices = await response.json();
    writeCariAnalizCache(allInvoices);
  } catch (error) {
    console.error('Cari analiz veri çekme hatası:', error);
    allInvoices = [];
    if (emptyState) {
      emptyState.style.display = 'block';
      emptyState.innerText = 'Veriler alınamadı. Lütfen sayfayı yenileyin.';
    }
  }
}

function renderCompanyCards() {
  const grid = document.getElementById('companyCardsGrid');
  const emptyState = document.getElementById('analysisEmptyState');
  const searchText = (document.getElementById('companySearch')?.value || '').trim().toLowerCase();
  if (!grid || !emptyState) return;

  const direction = analysisView === 'suppliers' ? 'INCOMING' : 'OUTGOING';
  const grouped = groupByCompany(allInvoices, direction);
  const cards = Object.values(grouped)
    .filter((c) => !searchText || c.name.toLowerCase().includes(searchText))
    .sort((a, b) => b.pendingTotalTl - a.pendingTotalTl);

  grid.innerHTML = '';
  if (!cards.length) {
    emptyState.style.display = 'block';
    emptyState.innerText = 'Bu görünümde gösterilecek firma bulunamadı.';
    return;
  }

  emptyState.style.display = 'none';
  cards.forEach((company) => grid.appendChild(createCompanyCard(company)));
}

function groupByCompany(invoices, direction) {
  const map = {};

  invoices
    .filter((inv) => inv.direction === direction)
    .forEach((inv) => {
      const name = inv.companies?.name || 'Bilinmeyen Firma';
      if (!map[name]) {
        map[name] = {
          name,
          invoiceCount: 0,
          pendingTotalTl: 0,
          currencyStats: {},
          invoices: []
        };
      }

      const bucket   = map[name];
      const currency = getInvoiceDisplayCurrency(inv);
      const totalCur = getInvoiceCurrencyTotal(inv);
      const paidCur  = getPaidAmountCur(inv);                    // doğru kaynak: paid_amount_cur
      const pendingCur = Math.max(totalCur - paidCur, 0);

      // Sıralama için TL cinsinden kalan borç tahmini
      const rate       = parseFloat(inv.calculation_rate ?? inv.exchange_rate) || 1;
      const iso        = String(inv.base_currency || inv.currency || 'TRY').toUpperCase();
      const pendingTl  = iso === 'TRY' ? pendingCur : pendingCur * rate;

      bucket.invoiceCount    += 1;
      bucket.pendingTotalTl  += pendingTl;
      bucket.invoices.push(inv);

      if (!bucket.currencyStats[currency]) {
        bucket.currencyStats[currency] = { pending: 0, paid: 0 };
      }
      bucket.currencyStats[currency].pending += pendingCur;
      bucket.currencyStats[currency].paid    += paidCur;
    });

  return map;
}

function createCompanyCard(company) {
  const card = document.createElement('article');
  card.className = `company-card ${analysisView === 'suppliers' ? 'supplier' : 'customer'}`;

  const rows = Object.entries(company.currencyStats)
    .sort(([a], [b]) => a.localeCompare(b, 'tr'))
    .map(([currency, stat]) => {
      const sideLabel = analysisView === 'suppliers' ? 'BEKLEYEN' : 'ALACAK';
      const paidLabel = analysisView === 'suppliers' ? 'ÖDENEN' : 'TAHSİL';
      return `
        <div class="company-row">
          <span class="label">${currency} ${sideLabel}</span>
          <span class="value pending">${formatNumber(stat.pending)} ${currency}</span>
        </div>
        <div class="company-row">
          <span class="label">${currency} ${paidLabel}</span>
          <span class="value paid">${formatNumber(stat.paid)} ${currency}</span>
        </div>
      `;
    })
    .join('');

  card.innerHTML = `
    <div class="company-name">${company.name}</div>
    <div class="company-row">
      <span class="label">FATURA</span>
      <span class="value">${company.invoiceCount}</span>
    </div>
    ${rows}
  `;
  card.addEventListener('click', () => openCompanyModal(company));

  return card;
}

function openCompanyModal(company) {
  const modal = document.getElementById('companyDetailModal');
  const header = document.getElementById('companyModalHeader');
  if (!modal || !header) return;

  const isSuppliers = analysisView === 'suppliers';
  header.classList.remove('supplier', 'customer');
  header.classList.add(isSuppliers ? 'supplier' : 'customer');

  document.getElementById('detailCompanyName').innerText = company.name;
  document.getElementById('detailCompanySubtitle').innerText = isSuppliers
    ? 'Tedarikçi Hesap Özeti'
    : 'Müşteri Hesap Özeti';

  document.getElementById('detailInvoiceCount').innerText = String(company.invoiceCount);
  document.getElementById('detailPendingLabel').innerText = isSuppliers ? 'Bekleyen Borç' : 'Bekleyen Alacak';
  document.getElementById('detailPaidLabel').innerText = isSuppliers ? 'Ödenen' : 'Tahsil Edilen';

  const totalsByCurrency = aggregateCompanyCurrencies(company.invoices);
  document.getElementById('detailTotalVolume').innerText = formatCurrencyLines(totalsByCurrency, 'total');
  document.getElementById('detailPending').innerText = formatCurrencyLines(totalsByCurrency, 'pending');
  document.getElementById('detailPaid').innerText = formatCurrencyLines(totalsByCurrency, 'paid');

  renderCompanyInvoiceHistory(company.invoices);
  modal.style.display = 'flex';
}

function closeCompanyModal() {
  const modal = document.getElementById('companyDetailModal');
  if (modal) modal.style.display = 'none';
}

function aggregateCompanyCurrencies(invoices) {
  const byCurrency = {};
  invoices.forEach((inv) => {
    const currency   = getInvoiceDisplayCurrency(inv);
    const totalCur   = getInvoiceCurrencyTotal(inv);
    const paidCur    = getPaidAmountCur(inv);               // doğru kaynak: paid_amount_cur
    const pendingCur = Math.max(totalCur - paidCur, 0);

    if (!byCurrency[currency]) byCurrency[currency] = { total: 0, pending: 0, paid: 0 };
    byCurrency[currency].total   += totalCur;
    byCurrency[currency].pending += pendingCur;
    byCurrency[currency].paid    += paidCur;
  });
  return byCurrency;
}

function formatCurrencyLines(currencyMap, field) {
  const parts = Object.entries(currencyMap)
    .sort(([a], [b]) => a.localeCompare(b, 'tr'))
    .map(([currency, stats]) => `${formatNumber(stats[field])} ${currency}`);
  return parts.length ? parts.join('  ·  ') : '-';
}

function renderCompanyInvoiceHistory(invoices) {
  const tbody = document.getElementById('detailInvoicesBody');
  if (!tbody) return;

  const sorted = [...invoices].sort((a, b) => {
    const da = new Date(a.invoice_date || 0).getTime();
    const db = new Date(b.invoice_date || 0).getTime();
    return db - da;
  });

  tbody.innerHTML = '';
  sorted.forEach((inv) => {
    const tr = document.createElement('tr');
    const currency = normalizeCurrency(inv.currency);
    const status = (inv.status || 'unpaid').toLowerCase();
    tr.innerHTML = `
      <td>${inv.invoice_no || '-'}</td>
      <td>${formatDate(inv.invoice_date)}</td>
      <td>${formatDate(inv.due_date)}</td>
      <td>${formatNumber(getInvoiceCurrencyTotal(inv))} ${currency}</td>
      <td>${renderStatusChip(status)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('tr-TR');
}

function renderStatusChip(status) {
  if (status === 'paid') return '<span class="status-chip paid">Ödendi</span>';
  if (status === 'partial') return '<span class="status-chip partial">Kısmi</span>';
  return '<span class="status-chip unpaid">Bekliyor</span>';
}

function getInvoiceCurrencyTotal(inv) {
  const payableCur = parseFloat(inv.payable_amount_cur);
  if (!Number.isNaN(payableCur) && payableCur > 0) return payableCur;
  const totalCurrency = parseFloat(inv.total_currency);
  if (!Number.isNaN(totalCurrency) && totalCurrency > 0) return totalCurrency;
  return parseFloat(inv.payable_amount_tl ?? inv.total_amount_tl) || 0;
}

// Faturanın ödenen tutarını kaynak para biriminde döndürür.
// Önce paid_amount_cur (yeni sistem), sonra eski TL kaydından kur ile dönüştürür.
function getPaidAmountCur(inv) {
  const totalCur = getInvoiceCurrencyTotal(inv);

  // Yeni sistem: paid_amount_cur doğrudan kaynak para biriminde saklanıyor
  const amtCur = parseFloat(inv?.paid_amount_cur);
  if (Number.isFinite(amtCur) && amtCur > 0) return Math.min(amtCur, totalCur);

  const paidRaw = parseFloat(inv?.paid_amount) || 0;
  if (paidRaw <= 0) return 0;

  const iso  = String(inv?.base_currency || inv?.currency || 'TRY').trim().toUpperCase();
  const rate = parseFloat(inv?.calculation_rate ?? inv?.exchange_rate) || 1;

  if (iso === 'TRY' || iso === 'TL' || rate <= 1) {
    // TL fatura veya kur bilgisi yoksa paid_amount zaten kaynak para biriminde
    return Math.min(paidRaw, totalCur);
  }

  // Dövizli eski kayıt: paid_amount TL ise kura böl; kaynak para birimine çevir
  const fromTl = Math.round((paidRaw / rate) * 100) / 100;
  // Eğer sonuç totalCur'dan büyük değilse TL'den çevirdik; aksi halde zaten kaynak birimindeydi
  return Math.min(fromTl <= totalCur ? fromTl : paidRaw, totalCur);
}

// Faturanın gösterim para birimi etiketini döndürür: TRY→"TL", USD→"USD" ...
function getInvoiceDisplayCurrency(inv) {
  const raw = String(inv?.base_currency || inv?.currency || 'TRY').trim().toUpperCase();
  const iso = raw === 'TL' ? 'TRY' : raw;
  return iso === 'TRY' ? 'TL' : iso;
}

function normalizeCurrency(cur) {
  if (!cur) return 'TL';
  const v = String(cur).toUpperCase();
  if (v === 'TRY') return 'TL';
  return v;
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
