(function () {
    'use strict';

    let _sidebarOpen = true;
    let _dmoOpen     = false;

    const path   = window.location.pathname;
    const isDMO  = path.includes('/dmo/');
    const isCari = path.includes('/cari/');
    const isStok = path.includes('/stok');
    const isFat  = path === '/' || path === '/index.html';

    function buildHtml() {
        return `<aside id="sidebar">
  <a href="/cari/cari-index.html" class="sb-brand" style="text-decoration:none;">
    <div class="sb-brand-icon"><i class="ti ti-bolt"></i></div>
    <span class="sb-brand-text">İnokas <span>CRM</span></span>
  </a>
  <nav class="sb-nav">

    <a href="/" class="sb-item${isFat ? ' active' : ''}">
      <i class="ti ti-file-invoice"></i>
      <span class="sb-label">Faturalar</span>
    </a>

    <a href="/stok.html" class="sb-item${isStok ? ' active' : ''}">
      <i class="ti ti-package"></i>
      <span class="sb-label">Stok</span>
    </a>

    <a href="/cari/cari-index.html" class="sb-item${isCari ? ' active' : ''}">
      <i class="ti ti-users"></i>
      <span class="sb-label">Cari Analiz</span>
    </a>

    <div class="sb-divider"></div>

    <button class="sb-item${isDMO ? ' active' : ''}" id="dmo-toggle" onclick="toggleDMO()">
      <i class="ti ti-building-store"></i>
      <span class="sb-label">DMO</span>
      <i class="ti ti-chevron-down sb-chevron" id="dmo-chevron"></i>
    </button>
    <div class="sb-children" id="dmo-children">
      <a href="/dmo/pages/siparisler.html"    class="sb-child${path.includes('siparisler')    ? ' active' : ''}">
        <i class="ti ti-list"></i><span class="sb-label">Siparişler</span>
      </a>
      <a href="/dmo/pages/yeni-siparis.html"  class="sb-child${path.includes('yeni-siparis')  ? ' active' : ''}">
        <i class="ti ti-plus"></i><span class="sb-label">Yeni Sipariş Ekle</span>
      </a>
      <a href="/dmo/pages/sepet-hesapla.html" class="sb-child${path.includes('sepet-hesapla') ? ' active' : ''}">
        <i class="ti ti-shopping-cart"></i><span class="sb-label">DMO Sepet Hesapla</span>
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
        if (isDMO) {
            _dmoOpen = true;
            document.getElementById('dmo-children')?.classList.add('open');
            document.getElementById('dmo-chevron')?.classList.add('open');
        }
        document.getElementById('sb-logout-btn')?.addEventListener('click', () => {
            localStorage.removeItem('inokas_auth');
            window.location.href = '/login.html';
        });
    }

    window.toggleSidebar = function () {
        _sidebarOpen = !_sidebarOpen;
        document.getElementById('sidebar')?.classList.toggle('collapsed', !_sidebarOpen);
    };

    window.toggleDMO = function () {
        _dmoOpen = !_dmoOpen;
        document.getElementById('dmo-children')?.classList.toggle('open', _dmoOpen);
        document.getElementById('dmo-chevron')?.classList.toggle('open', _dmoOpen);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }
})();
