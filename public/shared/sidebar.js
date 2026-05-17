(function () {
  'use strict';

  let _sidebarOpen = true;
  let _fatOpen     = false;
  let _stokOpen    = false;
  let _dmoOpen     = false;
  let _bekOpen     = false;
  let _cariOpen    = false;
  let _quotesOpen  = false;
  let _giderOpen   = false;

  const path        = location.pathname;
  const isFaturalar = path === '/' || path.includes('/faturalar/pages/');
  const isOfisIci   = path.includes('ofis-ici');
  const isStok      = path.includes('/stok');
  const isDmo       = path.includes('/dmo');
  const isCari      = path.includes('/cari');
  const isQuotes    = path.includes('/quotes');
  const isBekleyen  = path.includes('bekleyen');
  const isChat      = path === '/chat' || path.startsWith('/chat?');
  const isGider     = path.includes('ofis-ici');

  // ─── Pending counts ───────────────────────────────────────────────────────
  let _pendingGelen = 0;
  let _pendingGiden = 0;

  async function loadPendingCounts() {
    try {
      const res  = await fetch('/api/invoices/pending');
      if (!res.ok) return;
      const data = await res.json();
      _pendingGelen = (data || []).filter(inv => inv.direction === 'INCOMING').length;
      _pendingGiden = (data || []).filter(inv => inv.direction === 'OUTGOING').length;
      updatePendingBadges();
    } catch {}
  }

  function updatePendingBadges() {
    const gb = document.getElementById('sb-badge-alis-onayla');
    const sb = document.getElementById('sb-badge-satis-onayla');
    if (gb) { gb.textContent = _pendingGelen; gb.classList.toggle('visible', _pendingGelen > 0); }
    if (sb) { sb.textContent = _pendingGiden; sb.classList.toggle('visible', _pendingGiden > 0); }
  }

  function mkBadge(id) {
    return `<span id="${id}" class="sb-badge"></span>`;
  }

  // ─── HTML ─────────────────────────────────────────────────────────────────
  function buildHtml() {
    return `<aside id="sidebar">
  <a href="/chat" class="sb-brand" style="text-decoration:none;">
    <div class="sb-brand-icon"><i class="ti ti-bolt"></i></div>
    <span class="sb-brand-text">İnokas <span>CRM</span></span>
  </a>

  <nav class="sb-nav">

    <!-- AI Asistan -->
    <a href="/chat" class="sb-item${isChat ? ' active' : ''}" style="position:relative;">
      <i class="ti ti-message-bolt" style="color:${isChat ? '#93c5fd' : 'rgba(255,255,255,0.45)'}"></i>
      <span class="sb-label">AI Asistan</span>
      <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,0.7);"></span>
    </a>

    <div class="sb-divider"></div>

    <!-- Faturalar -->
    <button class="sb-item${isFaturalar || isBekleyen ? ' active' : ''}" id="fat-toggle" onclick="toggleFaturalar()">
      <i class="ti ti-file-invoice"></i>
      <span class="sb-label">Faturalar</span>
      <i class="ti ti-chevron-down sb-chevron" id="fat-chevron"></i>
    </button>
    <div class="sb-children" id="fat-children">

      <a href="/faturalar/pages/gelen-faturalar.html"
         class="sb-child${path.includes('gelen-faturalar') ? ' active' : ''}">
        <i class="ti ti-message-arrow-down"></i>
        <span class="sb-label">Alışlar</span>
      </a>

      <a href="/faturalar/pages/bekleyen-gelen.html"
         class="sb-child${path.includes('bekleyen-gelen') ? ' active' : ''}">
        <i class="ti ti-clock-hour-4"></i>
        <span class="sb-label">Alış Onayla</span>
        ${mkBadge('sb-badge-alis-onayla')}
      </a>

      <a href="/faturalar/pages/giden-faturalar.html"
         class="sb-child${path.includes('giden-faturalar') ? ' active' : ''}">
        <i class="ti ti-message-arrow-up"></i>
        <span class="sb-label">Satışlar</span>
      </a>

      <a href="/faturalar/pages/bekleyen-giden.html"
         class="sb-child${path.includes('bekleyen-giden') ? ' active' : ''}">
        <i class="ti ti-clock-hour-4"></i>
        <span class="sb-label">Satış Onayla</span>
        ${mkBadge('sb-badge-satis-onayla')}
      </a>

      <a href="/faturalar/pages/fatura-yukle.html"
         class="sb-child${path.includes('fatura-yukle') ? ' active' : ''}">
        <i class="ti ti-upload"></i>
        <span class="sb-label">Fatura Yükle</span>
      </a>

      <a href="/faturalar/pages/rapor.html"
         class="sb-child${path.includes('rapor') ? ' active' : ''}">
        <i class="ti ti-chart-bar"></i>
        <span class="sb-label">Rapor</span>
      </a>

    </div>

    <!-- Giderler -->
    <button class="sb-item${isGider ? ' active' : ''}" id="gider-toggle" onclick="toggleGider()">
      <i class="ti ti-building"></i>
      <span class="sb-label">Giderler</span>
      <i class="ti ti-chevron-down sb-chevron" id="gider-chevron"></i>
    </button>
    <div class="sb-children" id="gider-children">
      <a href="/faturalar/pages/ofis-ici.html"
         class="sb-child${path.includes('ofis-ici') ? ' active' : ''}">
        <i class="ti ti-home"></i>
        <span class="sb-label">Ofis İçi</span>
      </a>
    </div>

    <!-- Stok -->
    <button class="sb-item${isStok ? ' active' : ''}" id="stok-toggle" onclick="toggleStok()">
      <i class="ti ti-package"></i>
      <span class="sb-label">Stok</span>
      <i class="ti ti-chevron-down sb-chevron" id="stok-chevron"></i>
    </button>
    <div class="sb-children" id="stok-children">
      <a href="/stok/pages/stok-hareketleri.html"
         class="sb-child${path.includes('hareketler') ? ' active' : ''}">
        <i class="ti ti-arrows-exchange"></i>
        <span class="sb-label">Ürün Hareketleri</span>
      </a>
      <a href="/stok/pages/urunler.html"
         class="sb-child${path.includes('urunler') ? ' active' : ''}">
        <i class="ti ti-box"></i>
        <span class="sb-label">Ürünler</span>
      </a>
      <a href="/stok/pages/kategori-yonetimi.html"
         class="sb-child${path.includes('kategori-yonetimi') ? ' active' : ''}">
        <i class="ti ti-category"></i>
        <span class="sb-label">Kategori Yönetimi</span>
      </a>
      <a href="/stok/pages/backorder.html"
         class="sb-child${path.includes('backorder') ? ' active' : ''}">
        <i class="ti ti-clock-pause"></i>
        <span class="sb-label">Backorder</span>
      </a>
    </div>

    <div class="sb-divider"></div>

    <!-- DMO -->
    <button class="sb-item${isDmo ? ' active' : ''}" id="dmo-toggle" onclick="toggleDMO()">
      <i class="ti ti-building-store"></i>
      <span class="sb-label">DMO</span>
      <i class="ti ti-chevron-down sb-chevron" id="dmo-chevron"></i>
    </button>
    <div class="sb-children" id="dmo-children">
      <a href="/dmo/pages/siparisler.html" class="sb-child${path.includes('siparisler') ? ' active' : ''}">
        <i class="ti ti-list"></i>
        <span class="sb-label">Siparişler</span>
      </a>
      <a href="/dmo/pages/sepet-hesapla.html" class="sb-child${path.includes('sepet-hesapla') ? ' active' : ''}">
        <i class="ti ti-shopping-cart"></i>
        <span class="sb-label">Sepet Hesapla</span>
      </a>
      <a href="/dmo/pages/yeni-siparis.html" class="sb-child${path.includes('yeni-siparis') ? ' active' : ''}">
        <i class="ti ti-upload"></i>
        <span class="sb-label">Sipariş Yükle</span>
      </a>
    </div>

    <div class="sb-divider"></div>

    <!-- Teklifler -->
    <button class="sb-item${isQuotes ? ' active' : ''}" id="quotes-toggle" onclick="toggleQuotes()">
      <i class="ti ti-file-description"></i>
      <span class="sb-label">Teklifler</span>
      <i class="ti ti-chevron-down sb-chevron" id="quotes-chevron"></i>
    </button>
    <div class="sb-children" id="quotes-children">
      <a href="/quotes/pages/teklifler.html" class="sb-child${path.includes('teklifler') ? ' active' : ''}">
        <i class="ti ti-list"></i>
        <span class="sb-label">Tekliflerim</span>
      </a>
      <a href="/quotes/pages/teklif-form.html" class="sb-child${path.includes('teklif-form') ? ' active' : ''}">
        <i class="ti ti-plus"></i>
        <span class="sb-label">Teklif Ekle</span>
      </a>
    </div>

    <div class="sb-divider"></div>

    <!-- Cari Analiz -->
    <button class="sb-item${isCari ? ' active' : ''}" id="cari-toggle" onclick="toggleCari()">
      <i class="ti ti-users"></i>
      <span class="sb-label">Cari Analiz</span>
      <i class="ti ti-chevron-down sb-chevron" id="cari-chevron"></i>
    </button>
    <div class="sb-children" id="cari-children">
      <a href="/cari/cari-index.html" class="sb-child${isCari ? ' active' : ''}">
        <i class="ti ti-arrow-down-circle"></i>
        <span class="sb-label">Alışlar Analiz</span>
      </a>
      <a href="/cari/cari-index.html" class="sb-child">
        <i class="ti ti-arrow-up-circle"></i>
        <span class="sb-label">Satışlar Analiz</span>
      </a>
      
    </div>
    
    <a href="teknik/teknik-sorunlar.html" class="sb-item${path.includes('teknik') ? ' active' : ''}">
      <i class="ti ti-tool"></i>
      <span class="sb-label">Teknik Sorunlar</span>
    </a>

  </nav>

  <div class="sb-footer">
    <button class="sb-item" id="sb-logout-btn">
      <i class="ti ti-logout"></i>
      <span class="sb-label">Çıkış</span>
    </button>
  </div>
</aside>`;
  }

  // ─── Inject ───────────────────────────────────────────────────────────────
  function inject() {
    const container = document.getElementById('sidebar-container');
    if (container) container.innerHTML = buildHtml();
    initSidebar();
  }

  function initSidebar() {
    if (isFaturalar || isBekleyen) {
      _fatOpen = true;
      document.getElementById('fat-children')?.classList.add('open');
      document.getElementById('fat-chevron')?.classList.add('open');
    }
    if (isGider) {
      _giderOpen = true;
      document.getElementById('gider-children')?.classList.add('open');
      document.getElementById('gider-chevron')?.classList.add('open');
    }
    if (isStok) {
      _stokOpen = true;
      document.getElementById('stok-children')?.classList.add('open');
      document.getElementById('stok-chevron')?.classList.add('open');
    }
    if (isDmo) {
      _dmoOpen = true;
      document.getElementById('dmo-children')?.classList.add('open');
      document.getElementById('dmo-chevron')?.classList.add('open');
    }
    if (isCari) {
      _cariOpen = true;
      document.getElementById('cari-children')?.classList.add('open');
      document.getElementById('cari-chevron')?.classList.add('open');
    }
    if (isQuotes) {
      _quotesOpen = true;
      document.getElementById('quotes-children')?.classList.add('open');
      document.getElementById('quotes-chevron')?.classList.add('open');
    }

    document.getElementById('sb-logout-btn')?.addEventListener('click', () => {
      sessionStorage.removeItem('inokas_token');
      window.location.replace('/login.html');
    });

    // Load pending counts after render
    loadPendingCounts();
  }

  // ─── Toggles ──────────────────────────────────────────────────────────────
  window.toggleSidebar = function () {
    _sidebarOpen = !_sidebarOpen;
    document.getElementById('sidebar')?.classList.toggle('collapsed', !_sidebarOpen);
    document.body.classList.toggle('sidebar-collapsed', !_sidebarOpen);
  };

  window.toggleFaturalar = function () {
    _fatOpen = !_fatOpen;
    document.getElementById('fat-children')?.classList.toggle('open', _fatOpen);
    document.getElementById('fat-chevron')?.classList.toggle('open', _fatOpen);
  };

  window.toggleGider = function () {
    _giderOpen = !_giderOpen;
    document.getElementById('gider-children')?.classList.toggle('open', _giderOpen);
    document.getElementById('gider-chevron')?.classList.toggle('open', _giderOpen);
  };

  window.toggleStok = function () {
    _stokOpen = !_stokOpen;
    document.getElementById('stok-children')?.classList.toggle('open', _stokOpen);
    document.getElementById('stok-chevron')?.classList.toggle('open', _stokOpen);
  };

  window.toggleDMO = function () {
    _dmoOpen = !_dmoOpen;
    document.getElementById('dmo-children')?.classList.toggle('open', _dmoOpen);
    document.getElementById('dmo-chevron')?.classList.toggle('open', _dmoOpen);
  };

  window.toggleQuotes = function () {
    _quotesOpen = !_quotesOpen;
    document.getElementById('quotes-children')?.classList.toggle('open', _quotesOpen);
    document.getElementById('quotes-chevron')?.classList.toggle('open', _quotesOpen);
  };

  window.toggleCari = function () {
    _cariOpen = !_cariOpen;
    document.getElementById('cari-children')?.classList.toggle('open', _cariOpen);
    document.getElementById('cari-chevron')?.classList.toggle('open', _cariOpen);
  };

  window.toggleBekleyen = function () {
    _bekOpen = !_bekOpen;
  };

  // ─── Boot ─────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

})();