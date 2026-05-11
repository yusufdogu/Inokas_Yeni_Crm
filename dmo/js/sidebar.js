// ── STATE ─────────────────────────────────────────────────────────────────────
let _sidebarOpen = true;
let _dmoOpen     = false;

// ── LOAD & INJECT SIDEBAR ─────────────────────────────────────────────────────
async function loadSidebar() {
    try {
        const res  = await fetch('/dmo/sidebar-snippet.html');
        const html = await res.text();
        const container = document.getElementById('sidebar-container');
        if (container) container.innerHTML = html;
        initSidebar();
    } catch (err) {
        console.error('Sidebar yüklenemedi:', err.message);
    }
}

// ── INIT: active states, DMO auto-open, logout ────────────────────────────────
function initSidebar() {
    const path      = window.location.pathname;
    const isDMOPage = path.includes('/dmo/');

    // Mark active top-level items
    document.querySelectorAll('.sb-item[data-match]').forEach(el => {
        if (el.getAttribute('data-match') === path) el.classList.add('active');
    });

    // Mark active child items
    document.querySelectorAll('.sb-child[data-match]').forEach(el => {
        if (path.includes(el.getAttribute('data-match'))) el.classList.add('active');
    });

    // Auto-open DMO submenu on DMO pages
    if (isDMOPage) {
        _dmoOpen = true;
        document.getElementById('dmo-children')?.classList.add('open');
        document.getElementById('dmo-chevron')?.classList.add('open');
        document.getElementById('dmo-toggle')?.classList.add('active');
    }

    // Logout
    document.getElementById('sb-logout-btn')?.addEventListener('click', () => {
        localStorage.removeItem('inokas_auth');
        window.location.href = '/login.html';
    });
}

// ── TOGGLE SIDEBAR ────────────────────────────────────────────────────────────
function toggleSidebar() {
    _sidebarOpen = !_sidebarOpen;
    document.getElementById('sidebar')?.classList.toggle('collapsed', !_sidebarOpen);
}

// ── TOGGLE DMO SUBMENU ────────────────────────────────────────────────────────
function toggleDMO() {
    _dmoOpen = !_dmoOpen;
    document.getElementById('dmo-children')?.classList.toggle('open', _dmoOpen);
    document.getElementById('dmo-chevron')?.classList.toggle('open', _dmoOpen);
    document.getElementById('dmo-toggle')?.classList.toggle('active', _dmoOpen);
}

// ── AUTO LOAD ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadSidebar);