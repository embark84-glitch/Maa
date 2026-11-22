'use strict';
const { HttpError, requireRole } = require('../http');
const { POLICY_COLS, shapePolicy, creditOutstanding } = require('../policy');
const v = require('../validate');

const PRODUCT_COLS = `p.id, p.supplier_id, p.name, p.generic_name, p.category, p.form, p.strength, p.pack_size,
  p.sku, p.price, p.stock, p.min_order_qty, p.cold_chain, p.active`;
const shapeProduct = (p) => ({ ...p, cold_chain: !!p.cold_chain, active: !!p.active });

/** What pharmacies see: verified companies, their terms, and their products. */
module.exports = (app, { db }) => {
  const supplierRow = (id) => db.prepare(`
    SELECT o.id, o.name, o.city, o.address, o.phone, o.products_updated_at, ${POLICY_COLS},
           (SELECT COUNT(*) FROM products p WHERE p.supplier_id = o.id AND p.active = 1) AS product_count
      FROM organizations o WHERE o.type = 'supplier' AND o.verified = 1 ${id ? 'AND o.id = ?' : ''} ORDER BY o.name`);

  const shapeSupplier = (o, pharmacyId) => {
    const { allow_full, allow_partial, deposit_percent, allow_credit, credit_days, credit_limit, min_order_value, bank_details, ...rest } = o;
    const policy = shapePolicy(o);
    const out = { ...rest, policy };
    if (pharmacyId && policy.allow_credit) {
      const outstanding = creditOutstanding(db, pharmacyId, o.id);
      out.credit = { limit: policy.credit_limit, outstanding, remaining: Math.max(0, policy.credit_limit - outstanding) };
    }
    return out;
  };

  app.get('/api/suppliers', requireRole('pharmacy', 'admin'), (req, res) => {
    const pid = req.user.role === 'pharmacy' ? req.user.org_id : null;
    res.json({ suppliers: supplierRow(false).all().map((o) => shapeSupplier(o, pid)) });
  });

  app.get('/api/suppliers/:id', requireRole('pharmacy', 'admin'), (req, res) => {
    const o = supplierRow(true).get(v.int(req.params.id, 'id', { min: 1 }));
    if (!o) throw new HttpError(404, 'Supplier not found');
    const pid = req.user.role === 'pharmacy' ? req.user.org_id : null;
    const products = db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.supplier_id = ? AND p.active = 1 ORDER BY p.name, p.strength`).all(o.id);
    res.json({ supplier: shapeSupplier(o, pid), products: products.map(shapeProduct) });
  });

  /** Search across all verified suppliers (used to compare prices). */
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
    const rows = db.prepare(`
      SELECT ${PRODUCT_COLS}, o.name AS supplier_name
        FROM products p JOIN organizations o ON o.id = p.supplier_id
       WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT 200`).all(...args);
    res.json({ products: rows.map(shapeProduct) });
  });
};

module.exports.PRODUCT_COLS = PRODUCT_COLS;
module.exports.shapeProduct = shapeProduct;
