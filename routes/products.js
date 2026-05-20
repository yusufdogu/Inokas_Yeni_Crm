// routes/products.js
'use strict';

const express = require('express');
const router  = express.Router();

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data, error } = await supabase
      .from('products')
      .select('id, product_code, product_name, brand, category, model, maliyet_usd, sozlesme_fiyat_eur, last_purchase_price_cur, last_purchase_currency, last_purchase_rate, last_purchase_price_tl, avg_purchase_price_tl, dmo_code, dmo_fiyat_try, dmo_url, gift_quantity, stock_on_hand, reserved_quantity, is_internal')
      .eq('tenant_id', req.tenantId)
      .eq('is_internal', false)
      .order('product_name', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('GET /api/products hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products
router.post('/', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const { product_name, product_code, brand, category, dmo_code, purchase_price, purchase_currency, sales_price, sales_currency } = req.body || {};

    if (!product_name || !String(product_name).trim()) return res.status(400).json({ error: 'Ürün adı zorunlu' });
    if (!product_code || !String(product_code).trim()) return res.status(400).json({ error: 'Ürün kodu zorunlu' });

    const code = String(product_code).trim();

    const { data: existing, error: existingErr } = await supabase
      .from('products').select('id, product_code').eq('product_code', code).eq('tenant_id', tenantId).maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return res.status(409).json({ error: `"${code}" kodlu ürün zaten mevcut` });

    const insertPayload = { product_code: code, product_name: String(product_name).trim(), tenant_id: tenantId };
    if (brand)    insertPayload.brand    = String(brand).trim();
    if (category) insertPayload.category = String(category).trim();
    if (dmo_code) insertPayload.dmo_code = String(dmo_code).trim();

    const { data: created, error: createErr } = await supabase
      .from('products').insert(insertPayload).select('id, product_code, product_name').single();
    if (createErr) throw createErr;

    const pricePayload = { product_id: created.id };
    if (purchase_price    != null && purchase_price    !== '') pricePayload.purchase_price    = parseFloat(purchase_price);
    if (purchase_currency) pricePayload.purchase_currency = String(purchase_currency).trim();
    if (sales_price       != null && sales_price       !== '') pricePayload.sales_price       = parseFloat(sales_price);
    if (sales_currency)   pricePayload.sales_currency   = String(sales_currency).trim();

    if (Object.keys(pricePayload).length > 1) {
      const { error: priceErr } = await supabase.from('product_price_history').insert(pricePayload);
      if (priceErr) console.warn('product_price_history insert hatası:', priceErr.message);
    }

    res.json({ created: true, data: created });
  } catch (err) {
    console.error('POST /api/products hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/codes
router.get('/codes', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data, error } = await supabase.from('products').select('product_code').eq('tenant_id', req.tenantId).not('product_code', 'is', null);
    if (error) throw error;
    const codes = (data || []).map(r => String(r.product_code || '').trim()).filter(Boolean);
    res.json({ codes });
  } catch (err) {
    console.error('GET /api/products/codes hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/category-map', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');

    const [{ data, error }, { data: invData }] = await Promise.all([
      supabase.from('products')
        .select('product_code, category, brand, model, is_internal')
        .eq('tenant_id', req.tenantId)
        .not('product_code', 'is', null),
      supabase.from('invoice_items')
        .select('internal_category')
        .eq('is_internal', true)
        .not('internal_category', 'is', null)
        .neq('internal_category', ''),
    ]);

    if (error) throw error;

    const rows = (data || []).map(r => ({
      product_code: String(r.product_code || '').trim(),
      category:     String(r.category     || '').trim(),
      brand:        String(r.brand        || '').trim(),
      model:        String(r.model        || '').trim(),
      is_internal:  !!r.is_internal,
    })).filter(r => r.product_code);

    const categories           = [...new Set(rows.filter(r => !r.is_internal).map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    const internalFromProducts = rows.filter(r => r.is_internal).map(r => r.category).filter(Boolean);
    const internalFromInvoices = (invData || []).map(r => String(r.internal_category || '').trim()).filter(Boolean);
    const internal_categories  = [...new Set([...internalFromProducts, ...internalFromInvoices])].sort((a, b) => a.localeCompare(b, 'tr'));
    const brands               = [...new Set(rows.map(r => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    const models               = [...new Set(rows.filter(r => !r.is_internal).map(r => r.model).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));

    res.json({ items: rows, categories, internal_categories, brands, models });
  } catch (err) {
    console.error('GET /api/products/category-map hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/by-code
router.get('/by-code', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const code     = String(req.query.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Ürün kodu zorunlu' });
    const { data, error } = await supabase.from('products').select('id, product_code, product_name, category, brand, model').eq('product_code', code).eq('tenant_id', req.tenantId).single();
    if (error || !data) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/ensure-by-code
router.post('/ensure-by-code', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const code     = String(req.body?.product_code || '').trim();
    const name     = String(req.body?.product_name || '').trim();
    if (!code) return res.status(400).json({ error: 'product_code zorunlu' });

    const { data: existing, error: existingErr } = await supabase.from('products').select('id, product_code, product_name').eq('product_code', code).eq('tenant_id', tenantId).maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return res.json({ created: false, data: existing });

    const { data: created, error: createErr } = await supabase.from('products').insert({ product_code: code, product_name: name || `Ürün ${code}`, tenant_id: tenantId }).select('id, product_code, product_name').single();
    if (createErr) throw createErr;

    res.json({ created: true, data: created });
  } catch (err) {
    console.error('POST /api/products/ensure-by-code hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id
router.get('/:id([0-9a-fA-F-]{36})', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const id       = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Ürün id zorunlu.' });
    const { data, error } = await supabase.from('products').select('*').eq('id', id).eq('tenant_id', req.tenantId).single();
    if (error || !data) return res.status(404).json({ error: 'Ürün bulunamadı.' });
    res.json(data);
  } catch (err) {
    console.error('GET /api/products/:id hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id
router.put('/:id([0-9a-fA-F-]{36})', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const tenantId = req.tenantId;
    const id       = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Ürün id zorunlu.' });

    const { id: _id, created_at, updated_at, dmo_fiyat_updated, tenant_id, ...fields } = req.body || {};
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'Güncellenecek alan bulunamadı.' });

    fields.updated_at = new Date().toISOString();

    if (fields.product_code) {
      const newCode = String(fields.product_code).trim();
      const { data: current } = await supabase.from('products').select('product_code').eq('id', id).eq('tenant_id', tenantId).single();
      const oldCode = current?.product_code;

      if (oldCode && oldCode !== newCode) {
        const { data: conflicting } = await supabase.from('products').select('id').eq('product_code', newCode).eq('tenant_id', tenantId).maybeSingle();

        if (conflicting) {
          const targetId = conflicting.id;

          await Promise.all([
            supabase.from('invoice_items').update({ product_id: targetId }).eq('product_id', id),
            supabase.from('purchase_order_items').update({ product_id: targetId }).eq('product_id', id),
            supabase.from('dmo_order_items').update({ product_id: targetId }).eq('product_id', id),
            supabase.from('product_price_history').update({ product_id: targetId }).eq('product_id', id),
          ]);

          const { data: srcAttrs } = await supabase.from('product_attribute_values').select('attribute_id, value').eq('product_id', id);
          if (srcAttrs && srcAttrs.length > 0) {
            const { data: dstAttrs } = await supabase.from('product_attribute_values').select('attribute_id').eq('product_id', targetId);
            const dstIds = new Set((dstAttrs || []).map(a => a.attribute_id));
            const toInsert = srcAttrs.filter(a => !dstIds.has(a.attribute_id)).map(a => ({ product_id: targetId, attribute_id: a.attribute_id, value: a.value }));
            if (toInsert.length > 0) await supabase.from('product_attribute_values').insert(toInsert);
          }

          await Promise.all([
            supabase.from('invoice_items').update({ product_code: newCode }).eq('product_code', oldCode),
            supabase.from('product_group_items').update({ product_code: newCode }).eq('product_code', oldCode),
            supabase.from('quote_items').update({ product_code: newCode }).eq('product_code', oldCode),
          ]);

          await supabase.from('product_attribute_values').delete().eq('product_id', id);
          const { error: delErr } = await supabase.from('products').delete().eq('id', id).eq('tenant_id', tenantId);
          if (delErr) throw delErr;

          const { data: merged } = await supabase.from('products').select('*').eq('id', targetId).single();
          return res.json({ message: 'Ürün birleştirildi.', merged: true, data: merged });
        }

        await Promise.all([
          supabase.from('invoice_items').update({ product_code: newCode }).eq('product_code', oldCode),
          supabase.from('product_group_items').update({ product_code: newCode }).eq('product_code', oldCode),
          supabase.from('quote_items').update({ product_code: newCode }).eq('product_code', oldCode),
        ]);
      }
    }

    const { data, error } = await supabase.from('products').update(fields).eq('id', id).eq('tenant_id', tenantId).select().single();
    if (error) throw error;
    res.json({ message: 'Ürün güncellendi.', data });
  } catch (err) {
    console.error('PUT /api/products/:id hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id/attributes
router.get('/:id/attributes', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id }   = req.params;

    const { data: product, error: pErr } = await supabase.from('products').select('id, category').eq('id', id).eq('tenant_id', req.tenantId).single();
    if (pErr) throw pErr;

    const { data: template, error: tErr } = await supabase
      .from('category_templates')
      .select('id, name, category_attributes(id, attr_name, attr_type, attr_values, sort_order)')
      .eq('name', product.category).maybeSingle();
    if (tErr) throw tErr;

    const { data: values, error: vErr } = await supabase.from('product_attribute_values').select('attribute_id, value').eq('product_id', id);
    if (vErr) throw vErr;

    const valueMap = {};
    (values || []).forEach(v => { valueMap[v.attribute_id] = v.value; });

    const attributes = (template?.category_attributes || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(a => ({ ...a, value: valueMap[a.id] ?? null }));

    res.json({ category_template: template ? { id: template.id, name: template.name } : null, attributes });
  } catch (err) {
    console.error('product attributes fetch hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id/attributes
router.put('/:id/attributes', async (req, res) => {
  try {
    const supabase     = req.app.get('supabase');
    const { id }       = req.params;
    const { attributes } = req.body;
    if (!Array.isArray(attributes)) return res.status(400).json({ error: 'attributes dizisi zorunlu.' });

    const rows = attributes.filter(a => a.attribute_id != null).map(a => ({ product_id: id, attribute_id: a.attribute_id, value: a.value ?? null }));
    if (rows.length) {
      const { error } = await supabase.from('product_attribute_values').upsert(rows, { onConflict: 'product_id,attribute_id' });
      if (error) throw error;
    }
    res.json({ message: 'Özellikler kaydedildi.' });
  } catch (err) {
    console.error('product attributes upsert hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/attribute-values
router.get('/attribute-values', async (req, res) => {
  try {
    const supabase     = req.app.get('supabase');
    const { category } = req.query;

    const { data: template, error: tErr } = await supabase
      .from('category_templates')
      .select('id, name, category_attributes(id, attr_name, attr_type, attr_values, sort_order)')
      .eq('name', category).maybeSingle();
    if (tErr) throw tErr;
    if (!template) return res.json({ template: null, values: [] });

    const { data: products, error: pErr } = await supabase.from('products').select('id').eq('category', category).eq('tenant_id', req.tenantId);
    if (pErr) throw pErr;

    const productIds = (products || []).map(p => p.id);
    let values = [];
    if (productIds.length) {
      const { data: vals, error: vErr } = await supabase.from('product_attribute_values').select('product_id, attribute_id, value').in('product_id', productIds);
      if (vErr) throw vErr;
      values = vals || [];
    }

    res.json({ template: { id: template.id, name: template.name, attributes: template.category_attributes || [] }, values });
  } catch (err) {
    console.error('product-attribute-values hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Category Templates (shared — no tenant_id needed) ────────────────────────

router.get('/category-templates', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { data: templates, error: tErr } = await supabase.from('category_templates').select('id, name, created_at').order('name');
    if (tErr) throw tErr;
    const { data: attributes, error: aErr } = await supabase.from('category_attributes').select('id, category_id, attr_name, attr_type, attr_values, sort_order').order('sort_order');
    if (aErr) throw aErr;
    res.json(templates.map(t => ({ ...t, attributes: attributes.filter(a => a.category_id === t.id) })));
  } catch (err) {
    console.error('category-templates fetch hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/category-templates', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Kategori adı zorunlu.' });
    const { data, error } = await supabase.from('category_templates').insert({ name: name.trim() }).select().single();
    if (error) throw error;
    res.status(201).json({ ...data, attributes: [] });
  } catch (err) {
    console.error('category-templates insert hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/category-templates/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id }   = req.params;
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Kategori adı zorunlu.' });
    const { data, error } = await supabase.from('category_templates').update({ name: name.trim() }).eq('id', id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('category-templates update hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/category-templates/:id/attributes', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id }   = req.params;
    const { attr_name, attr_type, attr_values, sort_order } = req.body;
    if (!attr_name || !attr_name.trim()) return res.status(400).json({ error: 'Özellik adı zorunlu.' });
    if (!['text', 'number', 'select'].includes(attr_type)) return res.status(400).json({ error: 'attr_type text | number | select olmalı.' });
    const { data, error } = await supabase.from('category_attributes').insert({ category_id: id, attr_name: attr_name.trim(), attr_type, attr_values: attr_values || null, sort_order: sort_order ?? 0 }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('category-attributes insert hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/category-attributes/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id }   = req.params;
    const { attr_name, attr_type, attr_values, sort_order } = req.body;
    const updates  = {};
    if (attr_name  !== undefined) updates.attr_name  = attr_name.trim();
    if (attr_type  !== undefined) {
      if (!['text', 'number', 'select'].includes(attr_type)) return res.status(400).json({ error: 'attr_type text | number | select olmalı.' });
      updates.attr_type = attr_type;
    }
    if (attr_values !== undefined) updates.attr_values = attr_values;
    if (sort_order  !== undefined) updates.sort_order  = sort_order;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Güncellenecek alan yok.' });
    const { data, error } = await supabase.from('category_attributes').update(updates).eq('id', id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('category-attributes update hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/category-attributes/:id', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');
    const { id }   = req.params;
    const { error } = await supabase.from('category_attributes').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: 'Özellik silindi.' });
  } catch (err) {
    console.error('category-attributes delete hatası:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;