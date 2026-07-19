(function () {
  'use strict';

  let _sidebarOpen = false;

  // ─── Sidebar mode: 'expanded' | 'collapsed' | 'hover' ────────────────────
  const SIDEBAR_MODE_KEY = 'inokas_sidebar_mode';
  let _sidebarMode = localStorage.getItem(SIDEBAR_MODE_KEY) || 'hover';

  function setSidebarMode(mode) {
    _sidebarMode = mode;
    localStorage.setItem(SIDEBAR_MODE_KEY, mode);
    applyMode();
  }

  function applyMode() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Remove all mode classes first
    sidebar.classList.remove('sb-mode-expanded', 'sb-mode-collapsed', 'sb-mode-hover');
    document.body.classList.remove('sidebar-collapsed');

    if (_sidebarMode === 'expanded') {
      sidebar.classList.add('sb-mode-expanded');
    } else if (_sidebarMode === 'collapsed') {
      sidebar.classList.add('sb-mode-collapsed','collapsed');
      document.body.classList.add('sidebar-collapsed');
    } else {
      // hover mode — start collapsed, expand on mouseenter
      sidebar.classList.add('sb-mode-hover', 'collapsed');
      document.body.classList.add('sidebar-collapsed');
    }

    // Update toggle buttons active state
    document.querySelectorAll('.sb-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === _sidebarMode);
    });
  }
  let _fatOpen     = false;
  let _stokOpen    = false;
  let _dmoOpen     = false;
  let _bekOpen     = false;
  let _cariOpen    = false;
  let _quotesOpen  = false;
  let _giderOpen   = false;

  const path        = location.pathname;
  const isFaturalar = path === '/' || path.includes('/faturalar/pages/') || path.includes('faturalar.html');
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
    const total = _pendingGelen + _pendingGiden;
    // Update the header badge on faturalar.pages if present
    const headerBadge = document.getElementById('bekleyenBadge');
    if (headerBadge) {
      headerBadge.textContent = total;
      headerBadge.style.display = total > 0 ? '' : 'none';
    }
    // Legacy sidebar badges (for old standalone pages, no-op if not present)
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

    
    <!-- AI Asistan 
    <a href="/chat" class="sb-item${isChat ? ' active' : ''}" style="position:relative;">
      <i class="ti ti-message-bolt" style="color:${isChat ? '#93c5fd' : 'rgba(255,255,255,0.45)'}"></i>
      <span class="sb-label">AI Asistan</span>
      <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,0.7);"></span>
    </a>

    <div class="sb-divider"></div>
    -->

    <!-- Faturalar -->
    <a href="/faturalar/pages/faturalar.html"
       class="sb-item${isFaturalar ? ' active' : ''}"
       id="fat-toggle" onclick="toggleFaturalar(event)">
      <i class="ti ti-file-invoice"></i>
      <span class="sb-label">Faturalar</span>
      <i class="ti ti-chevron-down sb-chevron" id="fat-chevron"></i>
    </a>
    <div class="sb-children" id="fat-children">

      <a href="/faturalar/pages/fatura-yukle.html"
         class="sb-child${path.includes('fatura-yukle') ? ' active' : ''}">
        <i class="ti ti-upload"></i>
        <span class="sb-label">Fatura Yükle</span>
      </a>
      
    </div>

    <div class="sb-divider"></div>

    <!-- Giderler -->
    <button class="sb-item${isGider ? ' active' : ''}" id="gider-toggle" onclick="toggleGider()">
      <i class="ti ti-building"></i>
      <span class="sb-label">Giderler</span>
      <i class="ti ti-chevron-down sb-chevron" id="gider-chevron"></i>
    </button>
    <div class="sb-children" id="gider-children">
      <a href="/giderler/pages/giderler.html"
         class="sb-child${path.includes('ofis-ici') ? ' active' : ''}">
        <i class="ti ti-home"></i>
        <span class="sb-label">Ofis İçi</span>
      </a>
    </div>

    <div class="sb-divider"></div>
    
    
    <!-- Stok -->
    <a href="/stok/pages/stok.html"
       class="sb-item${path.includes('stok') ? ' active' : ''}">
      <i class="ti ti-package"></i>
      <span class="sb-label">Stok</span>
    </a>
    
    <div class="sb-divider"></div>

    <div class="sb-divider"></div>

    <!-- DMO 
    <button class="sb-item${isDmo ? ' active' : ''}" id="dmo-toggle" onclick="toggleDMO()">
      <i class="ti ti-building-store"></i>
      <span class="sb-label">DMO</span>
      <i class="ti ti-chevron-down sb-chevron" id="dmo-chevron"></i>
    </button>
    <div class="sb-children" id="dmo-children">
      <a href="/dmo/pages/siparisler.pages" class="sb-child${path.includes('siparisler') ? ' active' : ''}">
        <i class="ti ti-list"></i>
        <span class="sb-label">Siparişler</span>
      </a>
      <a href="/dmo/pages/sepet-hesapla.pages" class="sb-child${path.includes('sepet-hesapla') ? ' active' : ''}">
        <i class="ti ti-shopping-cart"></i>
        <span class="sb-label">Sepet Hesapla</span>
      </a>
      <a href="/dmo/pages/yeni-siparis.pages" class="sb-child${path.includes('yeni-siparis') ? ' active' : ''}">
        <i class="ti ti-upload"></i>
        <span class="sb-label">Sipariş Yükle</span>
      </a>
    </div>

    <div class="sb-divider"></div>
    -->
    
    <!-- Teklifler 
    <button class="sb-item${isQuotes ? ' active' : ''}" id="quotes-toggle" onclick="toggleQuotes()">
      <i class="ti ti-file-description"></i>
      <span class="sb-label">Teklifler</span>
      <i class="ti ti-chevron-down sb-chevron" id="quotes-chevron"></i>
    </button>
    <div class="sb-children" id="quotes-children">
      <a href="/quotes/pages/teklifler.pages" class="sb-child${path.includes('teklifler') ? ' active' : ''}">
        <i class="ti ti-list"></i>
        <span class="sb-label">Tekliflerim</span>
      </a>
      <a href="/quotes/pages/teklif-form.pages" class="sb-child${path.includes('teklif-form') ? ' active' : ''}">
        <i class="ti ti-plus"></i>
        <span class="sb-label">Teklif Ekle</span>
      </a>
    </div>

    <div class="sb-divider"></div>
    -->
    
    <!-- Cari Analiz 
    <button class="sb-item${isCari ? ' active' : ''}" id="cari-toggle" onclick="toggleCari()">
      <i class="ti ti-users"></i>
      <span class="sb-label">Cari Analiz</span>
      <i class="ti ti-chevron-down sb-chevron" id="cari-chevron"></i>
    </button>
    <div class="sb-children" id="cari-children">
      <a href="/cari/cari-index.pages" class="sb-child${isCari ? ' active' : ''}">
        <i class="ti ti-arrow-down-circle"></i>
        <span class="sb-label">Alışlar Analiz</span>
      </a>
      <a href="/cari/cari-index.pages" class="sb-child">
        <i class="ti ti-arrow-up-circle"></i>
        <span class="sb-label">Satışlar Analiz</span>
      </a>
      
    </div>
    -->
    
    <!--
    <div class="sb-divider"></div>
    <a href="/teknik/pages/teknik-sorunlar.pages" class="sb-item${path.includes('teknik') ? ' active' : ''}">
      <i class="ti ti-tool"></i>
      <span class="sb-label">Teknik Sorunlar</span>
    </a>

    <div class="sb-divider"></div>
    -->

  </nav>
    
  <a href="/settings.html" class="sb-item${path.includes('settings') ? ' active' : ''}">
    <i class="ti ti-settings"></i>
    <span class="sb-label">Ayarlar</span>
  </a>
  <div class="sb-divider"></div>
  <div class="sb-footer">
    <div class="sb-mode-row">
      <button class="sb-mode-btn" data-mode="collapsed" onclick="window.setSidebarMode('collapsed')" title="Daralt">
        <i class="ti ti-layout-sidebar-left-collapse"></i>
      </button>
      <button class="sb-mode-btn" data-mode="hover" onclick="window.setSidebarMode('hover')" title="Hover">
        <i class="ti ti-layout-sidebar"></i>
      </button>
      <button class="sb-mode-btn" data-mode="expanded" onclick="window.setSidebarMode('expanded')" title="Genişlet">
        <i class="ti ti-layout-sidebar-left-expand"></i>
      </button>
    </div>
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
    if (isFaturalar) {
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

    // Apply saved mode
    applyMode();

    // Hover events — only active in hover mode
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.addEventListener('mouseenter', () => {
        if (_sidebarMode !== 'hover') return;
        _sidebarOpen = true;
        sidebar.classList.remove('collapsed');
        document.body.classList.remove('sidebar-collapsed');
      });
      sidebar.addEventListener('mouseleave', () => {
        if (_sidebarMode !== 'hover') return;
        _sidebarOpen = false;
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
      });
    }

    document.getElementById('sb-logout-btn')?.addEventListener('click', () => {
      sessionStorage.removeItem('login_auth_token');
      window.location.replace('/auth/login.html');
    });

    // Load pending counts after render
    loadPendingCounts();
  }

  // ─── Accordion helper ─────────────────────────────────────────────────────
  const _allSections = [
    { key: 'fat',    stateVar: () => _fatOpen,    setState: v => { _fatOpen = v; } },
    { key: 'gider',  stateVar: () => _giderOpen,  setState: v => { _giderOpen = v; } },
    { key: 'stok',   stateVar: () => _stokOpen,   setState: v => { _stokOpen = v; } },
    { key: 'dmo',    stateVar: () => _dmoOpen,    setState: v => { _dmoOpen = v; } },
    { key: 'quotes', stateVar: () => _quotesOpen, setState: v => { _quotesOpen = v; } },
    { key: 'cari',   stateVar: () => _cariOpen,   setState: v => { _cariOpen = v; } },
  ];

  function _accordionToggle(targetKey) {
    const targetSection = _allSections.find(s => s.key === targetKey);
    const isAlreadyOpen = targetSection?.stateVar();
    const hasOpenOther  = _allSections.some(({ key, stateVar }) => key !== targetKey && stateVar());

    // Önce açık olanı kapat
    _allSections.forEach(({ key, stateVar, setState }) => {
      if (key !== targetKey && stateVar()) {
        setState(false);
        document.getElementById(`${key}-children`)?.classList.remove('open');
        document.getElementById(`${key}-chevron`)?.classList.remove('open');
      }
    });

    // Başka bir bölüm açıksa transition bitince aç, yoksa hemen aç
    const delay = hasOpenOther && !isAlreadyOpen ? 300 : 0;
    setTimeout(() => {
      const newState = !isAlreadyOpen;
      targetSection.setState(newState);
      document.getElementById(`${targetKey}-children`)?.classList.toggle('open', newState);
      document.getElementById(`${targetKey}-chevron`)?.classList.toggle('open', newState);
    }, delay);
  }

  // ─── Toggles ──────────────────────────────────────────────────────────────
  window.toggleSidebar = function () {
    if (_sidebarMode === 'hover') {
      _sidebarOpen = !_sidebarOpen;
      document.getElementById('sidebar')?.classList.toggle('collapsed', !_sidebarOpen);
      document.body.classList.toggle('sidebar-collapsed', !_sidebarOpen);
    }
  };

  window.setSidebarMode = setSidebarMode;

  window.toggleFaturalar = function (e) {
    // If chevron clicked, only toggle accordion — don't navigate
    if (e && e.target.closest('.sb-chevron')) {
      e.preventDefault();
      _accordionToggle('fat');
      return;
    }
    // Otherwise let the link navigate, but also open the accordion
    if (!_fatOpen) _accordionToggle('fat');
  };
  window.toggleGider     = function () { _accordionToggle('gider'); };
  window.toggleStok      = function () { _accordionToggle('stok'); };
  window.toggleDMO       = function () { _accordionToggle('dmo'); };
  window.toggleQuotes    = function () { _accordionToggle('quotes'); };
  window.toggleCari      = function () { _accordionToggle('cari'); };

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