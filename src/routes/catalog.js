'use strict';
const { HttpError, requireRole } = require('../app');
const v = require('../validate');

const PRODUCT_COLS = `p.id, p.supplier_id, p.name, p.generic_name, p.category, p.form, p.strength, p.pack_size,
  p.sku, p.price, p.stock, p.min_order_qty, p.cold_chain, p.active`;

const shape = (p) => ({ ...p, cold_chain: !!p.cold_chain, active: !!p.active });

module.exports = (app, { db }) => {
  /** Verified supplier companies a pharmacy can buy from. */
  app.get('/api/suppliers', requireRole('pharmacy', 'admin'), (_req, res) => {
    const rows = db.prepare(`
      SELECT o.id, o.name, o.city, o.phone,
             (SELECT COUNT(*) FROM products p WHERE p.supplier_id = o.id AND p.active = 1) AS product_count
        FROM organizations o WHERE o.type = 'supplier' AND o.verified = 1 ORDER BY o.name`).all();
    res.json({ suppliers: rows });
  });

  /** Marketplace search across all verified suppliers. */
  app.get('/api/products', requireRole('pharmacy', 'admin'), (req, res) => {
    const where = ['p.active = 1', 'o.verified = 1'];
    const args = [];
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.push("(p.name LIKE ?1 ESCAPE '\\' OR p.generic_name LIKE ?1 ESCAPE '\\' OR p.sku LIKE ?1 ESCAPE '\\')");
      args.push(`%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`);
    }
    if (req.query.supplier) {
      where.push('p.supplier_id = ?');
      args.push(v.int(req.query.supplier, 'supplier', { min: 1 }));
    }
    if (typeof req.query.category === 'string' && req.query.category) {
      where.push('p.category = ?');
      args.push(req.query.category);
    }
    const rows = db.prepare(`
      SELECT ${PRODUCT_COLS}, o.name AS supplier_name
        FROM products p JOIN organizations o ON o.id = p.supplier_id
       WHERE ${where.join(' AND ')}
       ORDER BY p.name LIMIT 200`).all(...args);
    const categories = db.prepare(`
      SELECT DISTINCT p.category FROM products p JOIN organizations o ON o.id = p.supplier_id
       WHERE p.active = 1 AND o.verified = 1 AND p.category IS NOT NULL ORDER BY 1`).all().map((r) => r.category);
    res.json({ products: rows.map(shape), categories });
  });

  // ---------- Supplier catalog management ----------

  app.get('/api/supplier/products', requireRole('supplier'), (req, res) => {
    const rows = db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.supplier_id = ? ORDER BY p.name`).all(req.user.org_id);
    res.json({ products: rows.map(shape) });
  });

  const readProduct = (b, partial) => {
    const out = {};
    const take = (key, fn) => {
      if (partial && b[key] === undefined) return;
      out[key] = fn(b[key]);
    };
    take('name', (x) => v.str(x, 'name', { max: 150 }));
    take('generic_name', (x) => v.str(x, 'generic_name', { required: false, max: 150 }));
    take('category', (x) => v.str(x, 'category', { required: false, max: 60 }));
    take('form', (x) => v.str(x, 'form', { required: false, max: 60 }));
    take('strength', (x) => v.str(x, 'strength', { required: false, max: 60 }));
    take('pack_size', (x) => v.str(x, 'pack_size', { required: false, max: 60 }));
    take('sku', (x) => v.str(x, 'sku', { required: false, max: 60 }));
    take('price', (x) => v.money(x, 'price'));
    take('stock', (x) => v.int(x ?? 0, 'stock', { min: 0, max: 10_000_000 }));
    take('min_order_qty', (x) => v.int(x ?? 1, 'min_order_qty', { min: 1, max: 100_000 }));
    take('cold_chain', (x) => (x ? 1 : 0));
    take('active', (x) => (x === undefined ? 1 : x ? 1 : 0));
    return out;
  };

  app.post('/api/supplier/products', requireRole('supplier'), (req, res) => {
    const p = readProduct(req.body || {}, false);
    const cols = Object.keys(p);
    const r = db.prepare(
      `INSERT INTO products (supplier_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
    ).run(req.user.org_id, ...Object.values(p));
    const row = db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id = ?`).get(r.lastInsertRowid);
    res.status(201).json({ product: shape(row) });
  });

  app.patch('/api/supplier/products/:id', requireRole('supplier'), (req, res) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const existing = db.prepare('SELECT id FROM products WHERE id = ? AND supplier_id = ?').get(id, req.user.org_id);
    if (!existing) throw new HttpError(404, 'Product not found');
    const p = readProduct(req.body || {}, true);
    const cols = Object.keys(p);
    if (cols.length) {
      db.prepare(`UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(p), id);
    }
    const row = db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id = ?`).get(id);
    res.json({ product: shape(row) });
  });
};
