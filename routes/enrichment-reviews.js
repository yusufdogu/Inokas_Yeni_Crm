// routes/enrichmentReviews.js
// User-facing review of AI-proposed product code changes + merges.
//   GET  /api/enrichment-reviews          → pending code-changes/merges
//   POST /api/enrichment-reviews/:id/decide → accept | deny | edit  (+ feedback log)
//
// Self-contained: code-change / merge logic lives here (lean version — no
// attribute moving, no stock recalc; those are out of scope for this flow).

const express = require('express');
const router = express.Router();

// ─── lean merge: re-point references from source → target, delete source ──────
async function mergeProducts(supabase, tenantId, sourceId, targetId) {
    await Promise.all([
        supabase.from('invoice_items').update({ product_id: targetId }).eq('product_id', sourceId),
        supabase.from('purchase_order_items').update({ product_id: targetId }).eq('product_id', sourceId),
        supabase.from('dmo_order_items').update({ product_id: targetId }).eq('product_id', sourceId),
        supabase.from('product_price_history').update({ product_id: targetId }).eq('product_id', sourceId),
        supabase.from('dmo_products').update({ product_id: targetId }).eq('product_id', sourceId),
    ]);
    // delete the source product (its references now point at target)
    const { error } = await supabase.from('products')
        .delete().eq('id', sourceId).eq('tenant_id', tenantId);
    if (error) throw new Error(`Kaynak ürün silinemedi: ${error.message}`);
}

// Apply a new code to a product. If it collides with a DIFFERENT product,
// merge into that product instead. Returns { merged, targetId }.
async function applyCode(supabase, tenantId, productId, newCode) {
    // does another product already have this code?
    const { data: existing } = await supabase
        .from('products')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('product_code', newCode)
        .neq('id', productId)
        .maybeSingle();

    if (existing) {
        // collision → merge this product into the existing one
        await mergeProducts(supabase, tenantId, productId, existing.id);
        return { merged: true, targetId: existing.id };
    }

    // no collision → simple code update
    const { error } = await supabase
        .from('products')
        .update({ product_code: newCode, updated_at: new Date().toISOString() })
        .eq('id', productId)
        .eq('tenant_id', tenantId);
    if (error) throw new Error(`Ürün kodu güncellenemedi: ${error.message}`);
    return { merged: false, targetId: null };
}

// ─── GET pending reviews ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const supabase = req.app.get('supabase');
        const tenantId = req.tenantId;

        const { data: rows, error } = await supabase
            .from('product_enrichment_staging')
            .select(`id, product_id, current_code, current_name,
                     resolved_mpn, resolved_brand, resolved_category,
                     needs_review, official_source, merge_target_id, safe_applied`)
            .eq('tenant_id', tenantId)
            .eq('status', 'pending')
            .order('created_at', { ascending: true });
        if (error) throw error;

        // actionable = has a code change or is a merge candidate
        const actionable = (rows || []).filter(r =>
            (r.resolved_mpn && r.resolved_mpn !== r.current_code) || r.merge_target_id
        );

        // fetch merge targets' info for the confirm message
        const targetIds = [...new Set(actionable.map(r => r.merge_target_id).filter(Boolean))];
        let targetMap = {};
        if (targetIds.length) {
            const { data: targets } = await supabase
                .from('products')
                .select('id, product_code, product_name')
                .in('id', targetIds);
            targetMap = Object.fromEntries((targets || []).map(t => [t.id, t]));
        }

        const reviews = [];
        for (const r of actionable) {
            let merge = null;
            if (r.merge_target_id) {
                const t = targetMap[r.merge_target_id];
                const { count } = await supabase
                    .from('invoice_items')
                    .select('id', { count: 'exact', head: true })
                    .eq('product_id', r.product_id);
                merge = {
                    target_id:     r.merge_target_id,
                    target_code:   t?.product_code || null,
                    target_name:   t?.product_name || null,
                    items_to_move: count || 0,
                };
            }
            reviews.push({
                id:              r.id,
                product_id:      r.product_id,
                current_code:    r.current_code,
                current_name:    r.current_name,
                proposed_mpn:    r.resolved_mpn,
                brand:           r.resolved_brand,
                category:        r.resolved_category,
                official_source: r.official_source,
                is_merge:        !!r.merge_target_id,
                merge,
            });
        }

        res.json({ count: reviews.length, reviews });
    } catch (err) {
        console.error('GET /api/enrichment-reviews hatası:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── POST decide — accept | deny | edit ───────────────────────────────────────
router.post('/:id/decide', async (req, res) => {
    try {
        const supabase = req.app.get('supabase');
        const tenantId = req.tenantId;
        const stagingId = req.params.id;
        const { decision, edited_code } = req.body || {};

        if (!['accept', 'deny', 'edit'].includes(decision)) {
            return res.status(400).json({ error: 'Geçersiz karar (accept | deny | edit).' });
        }

        const { data: row, error: rowErr } = await supabase
            .from('product_enrichment_staging')
            .select('*')
            .eq('id', stagingId)
            .eq('tenant_id', tenantId)
            .single();
        if (rowErr || !row) return res.status(404).json({ error: 'İnceleme bulunamadı.' });

        let finalCode = row.current_code;
        let newStatus = 'denied';
        let merged = false;
        let mergeTargetId = null;

        if (decision === 'accept') {
            const codeToApply = row.resolved_mpn;
            if (!codeToApply) return res.status(400).json({ error: 'Önerilen MPN yok.' });
            const r = await applyCode(supabase, tenantId, row.product_id, codeToApply);
            finalCode     = codeToApply;
            merged        = r.merged;
            mergeTargetId = r.targetId;
            newStatus     = 'applied';

        } else if (decision === 'edit') {
            const code = (edited_code || '').trim();
            if (!code) return res.status(400).json({ error: 'Düzenlenen kod boş olamaz.' });
            const r = await applyCode(supabase, tenantId, row.product_id, code);
            finalCode     = code;
            merged        = r.merged;
            mergeTargetId = r.targetId;
            newStatus     = 'edited';

        } else {
            // deny — keep current code, apply nothing
            newStatus = 'denied';
        }

        // update staging status
        await supabase.from('product_enrichment_staging')
            .update({ status: newStatus })
            .eq('id', stagingId);

        // log feedback (for future AI use)
        await supabase.from('enrichment_feedback').insert({
            tenant_id:       tenantId,
            product_id:      row.product_id,
            current_code:    row.current_code,
            proposed_mpn:    row.resolved_mpn,
            decision:        newStatus,
            final_code:      finalCode,
            was_merge:       merged,
            merge_target_id: merged ? mergeTargetId : null,
        });

        res.json({ ok: true, decision: newStatus, final_code: finalCode, merged });
    } catch (err) {
        console.error('POST /api/enrichment-reviews/:id/decide hatası:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;