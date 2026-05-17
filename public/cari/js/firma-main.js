// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    firmaCompanyId   = params.get('id');
    firmaCompanyName = params.get('name') ? decodeURIComponent(params.get('name')) : null;

    if (!firmaCompanyId) {
        window.location.href = '../cari-index.html';
        return;
    }

    // Başlık
    const titleEl = document.getElementById('firma-page-title');
    const subEl   = document.getElementById('firma-page-sub');
    if (titleEl) titleEl.textContent = firmaCompanyName || 'Firma Detayı';
    if (subEl)   subEl.textContent   = 'Fatura ve ödeme geçmişi';

    // Geri butonu
    document.getElementById('firma-back-btn')?.addEventListener('click', () => {
        window.location.href = '../cari-index.html';
    });

    // Boş sağ panel
    renderFirmaDetail();

    // Fatura listesini yükle
    loadFirmaInvoices();
});
