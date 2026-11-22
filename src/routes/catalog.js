'use strict';
const { HttpError, requireRole, toBinary, parseDataUrl } = require('../http');
const { buildPrompt, parseMatches } = require('../../shared/recognize');
const { POLICY_COLS, shapePolicy, creditOutstanding } = require('../policy');
const v = require('../validate');

const PRODUCT_COLS = `p.id, p.supplier_id, p.name, p.generic_name, p.category, p.form, p.strength, p.pack_size,
  p.sku, p.price, p.stock, p.min_order_qty, p.cold_chain, p.active, p.barcode, p.image_url`;
const shapeProduct = (p) => ({ ...p, cold_chain: !!p.cold_chain, active: !!p.active });

/** What pharmacies see: verified companies, their terms, and their products. */
module.exports = (app, { db, recognize }) => {
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

  /** Product photos uploaded by companies. Public, so <img> tags work without a token. */
  app.get('/api/product-images/:id', (req, res) => {
    const img = db.prepare('SELECT mime, data FROM product_images WHERE product_id = ?').get(v.int(req.params.id, 'id', { min: 1 }));
    if (!img) throw new HttpError(404, 'Image not found');
    res.set('Cache-Control', 'public, max-age=300');
    res.type(img.mime).send(toBinary(img.data));
  });

  /**
   * Order by photo: which of this company's products appear in the photo.
   * Only suggests; the pharmacist confirms before anything is added to the order.
   */
  const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  app.post('/api/suppliers/:id/recognize', requireRole('pharmacy'), async (req, res) => {
    const supplierId = v.int(req.params.id, 'id', { min: 1 });
    if (!supplierRow(true).get(supplierId)) throw new HttpError(404, 'Supplier not found');
    if (!recognize) throw new HttpError(503, 'Photo ordering is not set up on this server', { code: 'recognition_unavailable' });
    const img = parseDataUrl(req.body?.image);
    if (!img || !PHOTO_TYPES.includes(img.mime)) throw new HttpError(400, 'Upload a JPEG, PNG or WebP photo');
    if (img.bytes.length > 4_500_000) throw new HttpError(413, 'Upload is too large');
    const products = db.prepare(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.supplier_id = ? AND p.active = 1 ORDER BY p.name`).all(supplierId);
    const answer = await recognize({ prompt: buildPrompt(products), mime: img.mime, b64: img.b64, bytes: img.bytes });
    const { matches, not_found: notFound } = parseMatches(answer, products);
    const byId = new Map(products.map((p) => [p.id, shapeProduct(p)]));
    res.json({ matches: matches.map((m) => ({ ...m, product: byId.get(m.product_id) })), not_found: notFound });
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
    if (typeof req.query.barcode === 'string' && req.query.barcode) {
      where.push('p.barcode = ?');
      args.push(req.query.barcode.replace(/[^0-9]/g, ''));
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
