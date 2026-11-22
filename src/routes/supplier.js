'use strict';
const { HttpError, requireRole, parseDataUrl } = require('../http');
const { generateApiKey, hashApiKey } = require('../auth');
const { getPolicy } = require('../policy');
const { tx } = require('../store');
const { normalizeProducts, planSync, toLatinDigits } = require('../../shared/import');
const v = require('../validate');
const { PRODUCT_COLS, shapeProduct } = require('./catalog');

const EXISTING_COLS = 'id, sku, name, generic_name, category, form, strength, pack_size, price, stock, min_order_qty, cold_chain, active, barcode, image_url';
const LIST_LIMIT = 300; // rows of detail returned in a preview; the counts are always complete

/**
 * Apply (or preview) a product list for one company. Shared by the Excel upload
 * and the API. Nothing changes unless every row is valid, or the caller asked to
 * skip the rows with errors.
 */
function runImport(db, orgId, rows, { hideMissing = false, dryRun = true, skipErrors = false, source, fileName = null, actorId = null }) {
  const { products, errors, unknownColumns } = normalizeProducts(rows);
  const existing = db.prepare(`SELECT ${EXISTING_COLS} FROM products WHERE supplier_id = ?`).all(orgId);
  // A file that failed as a whole (no usable columns) must never hide the whole catalog.
  const fatal = errors.some((e) => e.row <= 1);
  const plan = planSync(products, existing, { hideMissing: hideMissing && !fatal && (!errors.length || skipErrors) });
  const summary = { created: plan.create.length, updated: plan.update.length, unchanged: plan.unchanged, hidden: plan.hide.length, errors: errors.length, rows: products.length + errors.length };
  const result = {
    dry_run: dryRun, applied: false, summary, unknown_columns: unknownColumns,
    errors: errors.slice(0, LIST_LIMIT),
    create: plan.create.slice(0, LIST_LIMIT).map(({ row, sku, name, price, stock }) => ({ row, sku, name, price, stock })),
    update: plan.update.slice(0, LIST_LIMIT),
    hide: plan.hide.slice(0, LIST_LIMIT),
  };
  if (dryRun) return result;
  if (fatal || (errors.length && !skipErrors)) {
    throw new HttpError(422, 'The file has errors. Fix them, or choose to skip those rows.', { summary, errors: result.errors });
  }

  const bool = (b) => (b ? 1 : 0);
  tx(db, () => {
    const ins = db.prepare(`INSERT INTO products (supplier_id, sku, name, generic_name, category, form, strength, pack_size, price, stock, min_order_qty, cold_chain, active, barcode, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of plan.create) {
      ins.run(orgId, p.sku, p.name, p.generic_name ?? null, p.category ?? null, p.form ?? null, p.strength ?? null, p.pack_size ?? null,
        p.price, p.stock ?? 0, p.min_order_qty ?? 1, bool(p.cold_chain), p.active === false ? 0 : 1, p.barcode ?? null, p.image_url ?? null);
    }
    for (const u of plan.update) {
      const cols = Object.keys(u.changes);
      const vals = cols.map((c) => (typeof u.changes[c] === 'boolean' ? bool(u.changes[c]) : u.changes[c]));
      db.prepare(`UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND supplier_id = ?`).run(...vals, u.id, orgId);
    }
    for (const h of plan.hide) db.prepare('UPDATE products SET active = 0 WHERE id = ? AND supplier_id = ?').run(h.id, orgId);
    db.prepare("UPDATE organizations SET products_updated_at = datetime('now') WHERE id = ?").run(orgId);
    db.prepare('INSERT INTO product_imports (org_id, source, file_name, created, updated, unchanged, hidden, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(orgId, source, fileName, summary.created, summary.updated, summary.unchanged, summary.hidden, actorId);
  });
  result.applied = true;
  return result;
}

module.exports = (app, { db }) => {
  const supplierOnly = requireRole('supplier');

  // ---------- products ----------

  app.get('/api/supplier/products', supplierOnly, (req, res) => {
    const rows = db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.supplier_id = ? ORDER BY p.active DESC, p.name`).all(req.user.org_id);
    const org = db.prepare('SELECT products_updated_at FROM organizations WHERE id = ?').get(req.user.org_id);
    res.json({ products: rows.map(shapeProduct), updated_at: org.products_updated_at });
  });

  const readProduct = (b, partial) => {
    const out = {};
    const take = (key, fn) => { if (partial && b[key] === undefined) return; out[key] = fn(b[key]); };
    take('sku', (x) => v.str(x, 'sku', { max: 60 }));
    take('name', (x) => v.str(x, 'name', { max: 150 }));
    for (const k of ['generic_name', 'category', 'form', 'strength', 'pack_size']) take(k, (x) => v.str(x, k, { required: false, max: 150 }));
    take('price', (x) => v.money(x, 'price'));
    take('stock', (x) => v.int(x ?? 0, 'stock', { min: 0, max: 10_000_000 }));
    take('min_order_qty', (x) => v.int(x ?? 1, 'min_order_qty', { min: 1, max: 100_000 }));
    take('cold_chain', (x) => (x ? 1 : 0));
    take('active', (x) => (x === undefined ? 1 : x ? 1 : 0));
    take('barcode', (x) => {
      const b = x == null || x === '' ? null : toLatinDigits(String(x)).replace(/[\s-]/g, '');
      if (b !== null && !/^\d{8,14}$/.test(b)) throw new HttpError(400, 'Barcode must be 8 to 14 digits');
      return b;
    });
    return out;
  };
  const uniqueSku = (fn) => {
    try { return fn(); } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'Another product already uses this product code');
      throw e;
    }
  };
  const touch = (orgId) => db.prepare("UPDATE organizations SET products_updated_at = datetime('now') WHERE id = ?").run(orgId);

  app.post('/api/supplier/products', supplierOnly, (req, res) => {
    const p = readProduct(req.body || {}, false);
    const cols = Object.keys(p);
    const r = uniqueSku(() => db.prepare(
      `INSERT INTO products (supplier_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    ).run(req.user.org_id, ...Object.values(p)));
    touch(req.user.org_id);
    res.status(201).json({ product: shapeProduct(db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id = ?`).get(r.lastInsertRowid)) });
  });

  app.patch('/api/supplier/products/:id', supplierOnly, (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND supplier_id = ?').get(id, req.user.org_id)) throw new HttpError(404, 'Product not found');
    const p = readProduct(req.body || {}, true);
    const cols = Object.keys(p);
    if (cols.length) {
      uniqueSku(() => db.prepare(`UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(p), id));
      touch(req.user.org_id);
    }
    res.json({ product: shapeProduct(db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id = ?`).get(id)) });
  });

  /** Product photo: the browser shrinks it first; stored in the database and served publicly. */
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  app.put('/api/supplier/products/:id/image', supplierOnly, (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND supplier_id = ?').get(id, req.user.org_id)) throw new HttpError(404, 'Product not found');
    const img = parseDataUrl(req.body?.data_url);
    if (!img || !IMAGE_TYPES.includes(img.mime)) throw new HttpError(400, 'Upload a JPEG, PNG or WebP photo');
    if (img.bytes.length > 600_000) throw new HttpError(413, 'Upload is too large');
    tx(db, () => {
      db.prepare(`INSERT INTO product_images (product_id, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(product_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`).run(id, img.mime, img.bytes);
      db.prepare('UPDATE products SET image_url = ? WHERE id = ?').run(`api/product-images/${id}?v=${Date.now()}`, id);
    });
    res.json({ product: shapeProduct(db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id = ?`).get(id)) });
  });

  app.delete('/api/supplier/products/:id/image', supplierOnly, (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND supplier_id = ?').get(id, req.user.org_id)) throw new HttpError(404, 'Product not found');
    tx(db, () => {
      db.prepare('DELETE FROM product_images WHERE product_id = ?').run(id);
      db.prepare('UPDATE products SET image_url = NULL WHERE id = ?').run(id);
    });
    res.json({ product: shapeProduct(db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id = ?`).get(id)) });
  });

  /** Excel upload. The browser reads the sheet and sends its rows; dry_run previews. */
  app.post('/api/supplier/products/import', supplierOnly, (req, res) => {
    const b = req.body || {};
    res.json(runImport(db, req.user.org_id, b.rows, {
      hideMissing: !!b.hide_missing, dryRun: b.dry_run !== false, skipErrors: !!b.skip_errors,
      source: 'excel', fileName: v.str(b.file_name, 'file_name', { required: false, max: 200 }), actorId: req.user.id,
    }));
  });

  // ---------- terms of sale ----------

  app.get('/api/supplier/settings', supplierOnly, (req, res) => {
    const imports = db.prepare(`SELECT i.source, i.file_name, i.created, i.updated, i.unchanged, i.hidden, i.created_at, u.name AS actor_name
      FROM product_imports i LEFT JOIN users u ON u.id = i.actor_id WHERE i.org_id = ? ORDER BY i.id DESC LIMIT 10`).all(req.user.org_id);
    const keys = db.prepare('SELECT id, prefix, label, created_at, last_used_at FROM api_keys WHERE org_id = ? AND revoked_at IS NULL ORDER BY id DESC').all(req.user.org_id);
    res.json({ policy: getPolicy(db, req.user.org_id), imports, api_keys: keys });
  });

  app.put('/api/supplier/settings', supplierOnly, (req, res) => {
    const b = req.body || {};
    const p = {
      allow_full: b.allow_full ? 1 : 0,
      allow_partial: b.allow_partial ? 1 : 0,
      deposit_percent: v.int(b.deposit_percent ?? 30, 'deposit_percent', { min: 1, max: 99 }),
      allow_credit: b.allow_credit ? 1 : 0,
      credit_days: v.int(b.credit_days ?? 30, 'credit_days', { min: 1, max: 365 }),
      credit_limit: v.money(b.credit_limit ?? 0, 'credit_limit'),
      min_order_value: v.money(b.min_order_value ?? 0, 'min_order_value'),
      bank_details: v.str(b.bank_details, 'bank_details', { required: false, max: 500 }),
    };
    if (!p.allow_full && !p.allow_partial && !p.allow_credit) throw new HttpError(400, 'Choose at least one way pharmacies can pay');
    db.prepare(`UPDATE organizations SET ${Object.keys(p).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(p), req.user.org_id);
    res.json({ policy: getPolicy(db, req.user.org_id) });
  });

  // ---------- API access for the company's own system ----------

  app.post('/api/supplier/api-keys', supplierOnly, (req, res) => {
    const label = v.str(req.body?.label, 'label', { required: false, max: 80 });
    const key = generateApiKey();
    const r = db.prepare('INSERT INTO api_keys (org_id, prefix, key_hash, label) VALUES (?, ?, ?, ?)').run(req.user.org_id, key.slice(0, 10), hashApiKey(key), label);
    res.status(201).json({ id: Number(r.lastInsertRowid), key, prefix: key.slice(0, 10), label });
  });

  app.delete('/api/supplier/api-keys/:id', supplierOnly, (req, res) => {
    const r = db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND org_id = ? AND revoked_at IS NULL")
      .run(v.int(req.params.id, 'id', { min: 1 }), req.user.org_id);
    if (!r.changes) throw new HttpError(404, 'Key not found');
    res.json({ ok: true });
  });

  /**
   * Machine API: the company's ERP/stock system sends its product list.
   *   POST /api/v1/products/sync      header  X-Api-Key: maa_...
   *   { "products": [{ "sku", "name", "price", "stock", ... }], "hide_missing": false, "dry_run": false }
   */
  const apiKeyAuth = (req, _res, next) => {
    const key = (req.get && req.get('x-api-key')) || '';
    const row = key && db.prepare(`SELECT k.id, k.org_id, o.verified FROM api_keys k JOIN organizations o ON o.id = k.org_id
      WHERE k.key_hash = ? AND k.revoked_at IS NULL AND o.type = 'supplier'`).get(hashApiKey(key));
    if (!row) return next(new HttpError(401, 'Missing or invalid API key'));
    if (!row.verified) return next(new HttpError(403, 'Your organization is awaiting license verification'));
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
    req.apiOrgId = row.org_id;
    next();
  };

  app.post('/api/v1/products/sync', apiKeyAuth, (req, res) => {
    const b = req.body || {};
    res.json(runImport(db, req.apiOrgId, b.products, {
      hideMissing: !!b.hide_missing, dryRun: !!b.dry_run, skipErrors: !!b.skip_errors, source: 'api',
    }));
  });
};

module.exports.runImport = runImport;
