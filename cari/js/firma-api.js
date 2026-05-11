// ── FATURA LİSTESİ ────────────────────────────────────────────────────────────
async function apiFirmaInvoices(companyId) {
    const res = await fetch(`/api/invoices?company_id=${encodeURIComponent(companyId)}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

// ── ÖDEME GEÇMİŞİ ────────────────────────────────────────────────────────────
async function apiGetPayments(invoiceId) {
    const res = await fetch(`/api/invoices/${invoiceId}/payments`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

// ── YENİ ÖDEME EKLE ──────────────────────────────────────────────────────────
async function apiAddPayment(invoiceId, amount, currency, paymentDate, notes) {
    const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: invoiceId, amount, currency, payment_date: paymentDate, notes: notes || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ödeme kaydedilemedi.');
    return data;
}

// ── ÖDEME GÜNCELLE ────────────────────────────────────────────────────────────
async function apiUpdatePayment(paymentId, amount, paymentDate, notes) {
    const res = await fetch(`/api/payments/${paymentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, payment_date: paymentDate, notes: notes || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Güncellenemedi.');
    return data;
}

// ── ÖDEME SİL ─────────────────────────────────────────────────────────────────
async function apiDeletePayment(paymentId) {
    const res = await fetch(`/api/payments/${paymentId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Silinemedi.');
    return data;
}
