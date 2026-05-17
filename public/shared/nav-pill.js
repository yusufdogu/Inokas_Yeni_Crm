/**
 * Üst navbar: aktif sekme arkasında eflatun şeffaf pill; sayfa değişiminde kayma animasyonu.
 * [data-nav-id] ile eşleşir; sessionStorage: inokasNavFrom / inokasNavTo
 *
 * Sayfa geçişi: önce transition kapalı + önceki sekme konumunda anında görünür,
 * sonra yalnızca konum animasyonu (yeniden “inme” hissi yok).
 */
(function () {
  const STORAGE_FROM = 'inokasNavFrom';
  const STORAGE_TO = 'inokasNavTo';

  function movePill(pill, cluster, el) {
    if (!pill || !cluster || !el) return;
    const cr = cluster.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    pill.style.left = er.left - cr.left + 'px';
    pill.style.top = er.top - cr.top + 'px';
    pill.style.width = er.width + 'px';
    pill.style.height = er.height + 'px';
  }

  function freezePill(pill) {
    pill.style.transition = 'none';
  }

  function unfreezePill(pill) {
    pill.style.removeProperty('transition');
  }

  function showPillInstant(pill) {
    pill.style.opacity = '1';
    pill.classList.add('nav-pill--visible');
  }

  function init() {
    const pill = document.getElementById('navPill');
    const cluster = document.querySelector('.nav-cluster');
    const row = document.querySelector('.nav-links-row');
    if (!pill || !cluster || !row) return;

    const activeEl = row.querySelector('.nav-link.active');

    function onResize() {
      const a = row.querySelector('.nav-link.active');
      if (!a) return;
      freezePill(pill);
      movePill(pill, cluster, a);
      requestAnimationFrame(() => unfreezePill(pill));
    }

    row.addEventListener(
      'click',
      (e) => {
        const t = e.target.closest('.nav-link');
        if (!t || !row.contains(t)) return;
        if (t.tagName !== 'A' || !t.getAttribute('href')) return;
        const cur = row.querySelector('.nav-link.active');
        if (!cur || !t.dataset.navId || t === cur) return;
        sessionStorage.setItem(STORAGE_FROM, cur.dataset.navId || '');
        sessionStorage.setItem(STORAGE_TO, t.dataset.navId || '');
      },
      true
    );

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onResize, 100);
    });

    const fromId = sessionStorage.getItem(STORAGE_FROM);
    const toId = sessionStorage.getItem(STORAGE_TO);
    sessionStorage.removeItem(STORAGE_FROM);
    sessionStorage.removeItem(STORAGE_TO);

    if (!activeEl) return;

    if (fromId && toId && fromId !== toId) {
      const fromEl = row.querySelector('[data-nav-id="' + fromId + '"]');
      if (fromEl && fromEl !== activeEl) {
        freezePill(pill);
        showPillInstant(pill);
        movePill(pill, cluster, fromEl);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            unfreezePill(pill);
            movePill(pill, cluster, activeEl);
          });
        });
        return;
      }
    }

    freezePill(pill);
    showPillInstant(pill);
    movePill(pill, cluster, activeEl);
    requestAnimationFrame(() => {
      unfreezePill(pill);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
