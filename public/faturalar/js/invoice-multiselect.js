/* =========================================================================
   MULTI-SELECT + DOWNLOAD for invoice list view
   Drop these into your invoice page file (the one with renderListView).
   ========================================================================= */

/* -------------------------------------------------------------------------
   1. SELECTION STATE
   A Set of invoice IDs that persists across re-renders / pagination.
   ------------------------------------------------------------------------- */
window._fatSelected = window._fatSelected || new Set();

function fatToggleRow(id, ev) {
    // Stop the row's onclick (openFatDetailPage) from firing
    if (ev) ev.stopPropagation();
    if (window._fatSelected.has(id)) window._fatSelected.delete(id);
    else window._fatSelected.add(id);
    fatSyncSelectionUI();
}

function fatToggleAll(checkbox) {
    const ids = (_fatDetailList || []).map(inv => inv.id);
    if (checkbox.checked) ids.forEach(id => window._fatSelected.add(id));
    else ids.forEach(id => window._fatSelected.delete(id));
    // Re-sync every row's checkbox + the toolbar
    ids.forEach(id => {
        const cb = document.querySelector(`.fat-row-check[data-id="${id}"]`);
        if (cb) cb.checked = window._fatSelected.has(id);
    });
    fatSyncSelectionUI();
}

function fatClearSelection() {
    window._fatSelected.clear();
    document.querySelectorAll('.fat-row-check').forEach(cb => (cb.checked = false));
    const master = document.querySelector('.fat-check-all');
    if (master) { master.checked = false; master.indeterminate = false; }
    fatSyncSelectionUI();
}

/* Updates the floating action bar (count + show/hide) and the header
   master-checkbox indeterminate state. Call after any selection change. */
function fatSyncSelectionUI() {
    const count = window._fatSelected.size;
    const bar = document.getElementById('fatSelectBar');
    if (bar) {
        bar.style.display = count > 0 ? 'flex' : 'none';
        const label = document.getElementById('fatSelectCount');
        if (label) label.textContent = `${count} fatura seçildi`;
    }

    // master checkbox: checked if ALL current-page rows selected,
    // indeterminate if SOME are.
    const master = document.querySelector('.fat-check-all');
    if (master) {
        const pageIds = (_fatDetailList || []).map(inv => inv.id);
        const selectedOnPage = pageIds.filter(id => window._fatSelected.has(id)).length;
        master.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
        master.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
    }
}

/* -------------------------------------------------------------------------
   2. DOWNLOAD LOGIC
   xml_url / pdf_url point to Supabase Storage. We fetch each blob and,
   if more than one, bundle into a ZIP with JSZip.
   ------------------------------------------------------------------------- */

/* Returns the selected invoice objects from the current list.
   NOTE: this only sees invoices on the CURRENT page's _fatDetailList.
   If you need cross-page selection to download, see the note at bottom. */
function fatGetSelectedInvoices() {
    return (_fatDetailList || []).filter(inv => window._fatSelected.has(inv.id));
}

async function fatDownloadSelected(kind /* 'xml' | 'pdf' */) {
    const invoices = fatGetSelectedInvoices();
    if (invoices.length === 0) return;

    const urlField = kind === 'xml' ? 'xml_url' : 'pdf_url';
    const ext = kind === 'xml' ? 'xml' : 'pdf';

    // Split into ones that have a file vs. ones missing it
    const withFile = invoices.filter(inv => inv[urlField]);
    const missing = invoices.filter(inv => !inv[urlField]);

    if (withFile.length === 0) {
        alert(`Seçilen faturalarda ${kind.toUpperCase()} dosyası yok.`);
        return;
    }

    fatSetDownloadBusy(true);
    try {
        // Single file → download directly, no zip
        if (withFile.length === 1) {
            const inv = withFile[0];
            await fatFetchAndSave(inv[urlField], `${fatSafeName(inv)}.${ext}`);
        } else {
            // Multiple → zip
            const zip = new JSZip();
            // Fetch all in parallel but cap concurrency to be nice to Storage
            await fatMapLimit(withFile, 6, async (inv) => {
                try {
                    const resp = await fetch(inv[urlField]);
                    if (!resp.ok) throw new Error(resp.status);
                    const blob = await resp.blob();
                    zip.file(`${fatSafeName(inv)}.${ext}`, blob);
                } catch (e) {
                    console.warn('Dosya alınamadı:', inv.invoice_no, e);
                }
            });
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const stamp = new Date().toISOString().slice(0, 10);
            fatSaveBlob(zipBlob, `faturalar_${ext}_${stamp}.zip`);
        }

        if (missing.length > 0) {
            alert(`${missing.length} faturada ${kind.toUpperCase()} dosyası yoktu, atlandı.`);
        }
    } catch (e) {
        console.error(e);
        alert('İndirme sırasında hata oluştu.');
    } finally {
        fatSetDownloadBusy(false);
    }
}

/* ----- download helpers ----- */

async function fatFetchAndSave(url, filename) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('fetch failed ' + resp.status);
    const blob = await resp.blob();
    fatSaveBlob(blob, filename);
}

function fatSaveBlob(blob, filename) {
    const a = document.createElement('a');
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}

/* Safe filename from an invoice: "<invoice_no>_<company>" cleaned up */
function fatSafeName(inv) {
    const no = (inv.invoice_no || 'fatura').toString();
    const comp = (inv.companies?.name || '').toString();
    const raw = comp ? `${no}_${comp}` : no;
    return raw.replace(/[^\p{L}\p{N}_\-]+/gu, '_').slice(0, 80);
}

/* Simple concurrency-limited map */
async function fatMapLimit(items, limit, fn) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            await fn(item);
        }
    });
    await Promise.all(workers);
}

function fatSetDownloadBusy(busy) {
    const bar = document.getElementById('fatSelectBar');
    if (bar) bar.classList.toggle('fat-select-bar--busy', busy);
    document.querySelectorAll('.fat-select-bar button').forEach(b => (b.disabled = busy));
}

/* -------------------------------------------------------------------------
   3. THE FLOATING ACTION BAR
   Rendered once and reused. Injected into <body> on first call.
   ------------------------------------------------------------------------- */
function fatEnsureSelectBar() {
    if (document.getElementById('fatSelectBar')) return;
    const bar = document.createElement('div');
    bar.id = 'fatSelectBar';
    bar.className = 'fat-select-bar';
    bar.style.display = 'none';
    bar.innerHTML = `
        <span id="fatSelectCount" class="fat-select-count">0 fatura seçildi</span>
        <div class="fat-select-actions">
            <button type="button" onclick="fatDownloadSelected('xml')">
                <i class="ti ti-file-code"></i> XML indir
            </button>
            <button type="button" onclick="fatDownloadSelected('pdf')">
                <i class="ti ti-file-type-pdf"></i> PDF indir
            </button>
            <button type="button" class="fat-select-clear" onclick="fatClearSelection()">
                <i class="ti ti-x"></i> Temizle
            </button>
        </div>`;
    document.body.appendChild(bar);
}

