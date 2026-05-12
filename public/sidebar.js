(function () {
    'use strict';

    let _sidebarOpen = true;
    let _fatOpen     = false;
    let _stokOpen    = false;
    let _dmoOpen     = false;

    const path        = location.pathname;
    const isFaturalar = path === '/' || path === '/index.html';
    const isStok      = path.includes('/stok');
    const isDmo       = path.includes('/dmo');
    const isCari      = path.includes('/cari');

    function buildHtml() {
        return `<aside id="sidebar">
  <a href="/" class="sb-brand" style="text-decoration:none;">
    <div class="sb-brand-icon"><i class="ti ti-bolt"></i></div>
    <span class="sb-brand-text">İnokas <span>CRM</span></span>
  </a>
  <nav class="sb-nav">

    <button class="sb-item${isFaturalar ? ' active' : ''}" id="fat-toggle" onclick="toggleFaturalar()">
      <i class="ti ti-file-invoice"></i>
      <span class="sb-label">Faturalar</span>
      <i class="ti ti-chevron-down sb-chevron" id="fat-chevron"></i>
    </button>
    <div class="sb-children" id="fat-children">
      <a href="/#gelen"    class="sb-child" data-hash="gelen">
        <i class="ti ti-message-arrow-down"></i><span class="sb-label">Gelen</span>
      </a>
      <a href="/#giden"    class="sb-child" data-hash="giden">
        <i class="ti ti-message-arrow-up"></i><span class="sb-label">Giden</span>
      </a>
      <a href="/#bekleyen" class="sb-child" data-hash="bekleyen">
        <i class="ti ti-clock-hour-4"></i><span class="sb-label">Bekleyen</span>
      </a>
      <a href="/#rapor"    class="sb-child" data-hash="rapor">
        <i class="ti ti-chart-bar"></i><span class="sb-label">Rapor</span>
      </a>
      <a href="/#ekle"     class="sb-child" data-hash="ekle">
        <i class="ti ti-plus"></i><span class="sb-label">Fatura Ekle</span>
      </a>
    </div>

    <button class="sb-item${isStok ? ' active' : ''}" id="stok-toggle" onclick="toggleStok()">
      <i class="ti ti-package"></i>
      <span class="sb-label">Stok</span>
      <i class="ti ti-chevron-down sb-chevron" id="stok-chevron"></i>
    </button>
    <div class="sb-children" id="stok-children">
      <a href="/stok/pages/stok-hareketleri.html" class="sb-child${path.includes('hareketler') ? ' active' : ''}">
        <i class="ti ti-arrows-exchange"></i><span class="sb-label">Hareketler</span>
      </a>
      <a href="/stok/pages/backorder.html" class="sb-child${path.includes('backorder') ? ' active' : ''}">
        <i class="ti ti-clock-pause"></i><span class="sb-label">Backorder</span>
      </a>
      <a href="/stok/pages/urunler.html" class="sb-child${path.includes('urunler') ? ' active' : ''}">
        <i class="ti ti-box"></i><span class="sb-label">Ürünler</span>
      </a>
    </div>

    <a href="/cari/cari-index.html" class="sb-item${isCari ? ' active' : ''}">
      <i class="ti ti-users"></i>
      <span class="sb-label">Cari Analiz</span>
    </a>

    <div class="sb-divider"></div>

    <button class="sb-item${isDmo ? ' active' : ''}" id="dmo-toggle" onclick="toggleDMO()">
      <i class="ti ti-building-store"></i>
      <span class="sb-label">DMO</span>
      <i class="ti ti-chevron-down sb-chevron" id="dmo-chevron"></i>
    </button>
    <div class="sb-children" id="dmo-children">
      <a href="/dmo/pages/siparisler.html"   class="sb-child">
        <i class="ti ti-list"></i><span class="sb-label">Siparişler</span>
      </a>
      <a href="/dmo/pages/yeni-siparis.html" class="sb-child">
        <i class="ti ti-plus"></i><span class="sb-label">Yeni Sipariş</span>
      </a>
      <a href="/dmo/pages/sepet-hesapla.html" class="sb-child">
        <i class="ti ti-shopping-cart"></i><span class="sb-label">Sepet Hesapla</span>
      </a>
    </div>

  </nav>
  <div class="sb-footer">
    <button class="sb-item" id="sb-logout-btn">
      <i class="ti ti-logout"></i>
      <span class="sb-label">Çıkış</span>
    </button>
  </div>
</aside>`;
    }

    function inject() {
        const container = document.getElementById('sidebar-container');
        if (container) container.innerHTML = buildHtml();
        initSidebar();
    }

    function initSidebar() {
        if (isFaturalar) {
            _fatOpen = true;
            document.getElementById('fat-children')?.classList.add('open');
            document.getElementById('fat-chevron')?.classList.add('open');
            syncFatHash();
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
        document.getElementById('sb-logout-btn')?.addEventListener('click', () => {
          sessionStorage.removeItem('inokas_token');
          window.location.replace('/login.html');
        });
    }

    function syncFatHash() {
        const h = (location.hash || '#gelen').replace('#', '');
        document.querySelectorAll('#fat-children .sb-child[data-hash]').forEach(el => {
            el.classList.toggle('active', el.getAttribute('data-hash') === h);
        });
    }

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

    if (isFaturalar) window.addEventListener('hashchange', syncFatHash);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }
})();