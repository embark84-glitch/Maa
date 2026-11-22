'use strict';
const { HttpError, requireRole } = require('../http');
const { deliveryCode } = require('../auth');
const { tx } = require('../store');
const v = require('../validate');
const { getPolicy, creditOutstanding } = require('../policy');
const { TERMS, paymentOptions, collectOnDelivery } = require('../../shared/payment');

/**
 * Order lifecycle
 *
 *   placed ──accept──▶ accepted ──mark ready──▶ ready_for_pickup ──driver claims──▶ assigned
 *     │                   │                          ▲                               │
 *     ├─reject──▶ rejected│                          └────────driver releases────────┤
 *     └─cancel──▶ cancelled◀──cancel (supplier)                                      ▼
 *                                                          delivered ◀──code── picked_up
 *
 * Stock is reserved when the order is placed and returned on reject/cancel.
 * An order can only be marked ready once the company has recorded the upfront
 * payment its terms require (full: everything, partial: the deposit, credit: nothing).
 */
const PAYMENT_METHODS = ['bank_transfer', 'cash', 'card', 'cheque', 'other'];

const STATUS = {
  PLACED: 'placed', ACCEPTED: 'accepted', REJECTED: 'rejected', CANCELLED: 'cancelled',
  READY: 'ready_for_pickup', ASSIGNED: 'assigned', PICKED_UP: 'picked_up', DELIVERED: 'delivered',
};

function addEvent(db, orderId, status, actorId, note = null) {
  db.prepare('INSERT INTO order_events (order_id, status, note, actor_id) VALUES (?, ?, ?, ?)').run(orderId, status, note, actorId);
}

function setStatus(db, orderId, from, to, actorId, note, extra = {}) {
  const sets = ['status = ?', "updated_at = datetime('now')", ...Object.keys(extra).map((k) => `${k} = ?`)];
  const r = db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`)
    .run(to, ...Object.values(extra), orderId, ...from);
  if (r.changes !== 1) throw new HttpError(409, `Order cannot move to "${to}" from its current status`);
  addEvent(db, orderId, to, actorId, note);
}

function restock(db, orderId) {
  for (const it of db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(orderId)) {
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.qty, it.product_id);
  }
}

/** Full order view, filtered for what the viewer is allowed to see. */
function loadOrder(db, id, user) {
  const o = db.prepare(`
    SELECT o.*, ph.name AS pharmacy_name, ph.phone AS pharmacy_phone, ph.city AS pharmacy_city,
           su.name AS supplier_name, su.address AS supplier_address, su.phone AS supplier_phone, su.bank_details AS supplier_bank_details,
           su.deposit_percent AS supplier_deposit_percent,
           d.name AS driver_name, d.phone AS driver_phone, d.vehicle AS driver_vehicle
      FROM orders o
      JOIN organizations ph ON ph.id = o.pharmacy_id
      JOIN organizations su ON su.id = o.supplier_id
      LEFT JOIN users d ON d.id = o.driver_id
     WHERE o.id = ?`).get(id);
  if (!o) return null;
  const canSee =
    user.role === 'admin' ||
    (user.role === 'pharmacy' && o.pharmacy_id === user.org_id) ||
    (user.role === 'supplier' && o.supplier_id === user.org_id) ||
    (user.role === 'driver' && (o.driver_id === user.id || o.status === STATUS.READY));
  if (!canSee) return null;
  // Only the receiving pharmacy ever sees the handover code.
  if (!(user.role === 'pharmacy' || user.role === 'admin')) delete o.delivery_code;
  o.items = db.prepare(`SELECT i.product_id, i.name, i.unit_price, i.qty, i.line_total, p.image_url
    FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ?`).all(id);
  o.payments = user.role === 'driver' ? [] : db.prepare(`
    SELECT p.amount, p.method, p.reference, p.created_at, u.name AS recorded_by
      FROM order_payments p LEFT JOIN users u ON u.id = p.recorded_by WHERE p.order_id = ? ORDER BY p.id`).all(id);
  o.balance = o.total - o.paid_amount;
  o.collect_on_delivery = collectOnDelivery(o);
  o.events = db.prepare(`
    SELECT e.status, e.note, e.created_at, u.name AS actor_name, u.role AS actor_role
      FROM order_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.order_id = ? ORDER BY e.id`).all(id);
  return o;
}

function listOrders(db, user, statusFilter) {
  let where; let args;
  switch (user.role) {
    case 'pharmacy': where = 'o.pharmacy_id = ?'; args = [user.org_id]; break;
    case 'supplier': where = 'o.supplier_id = ?'; args = [user.org_id]; break;
    case 'driver': where = 'o.driver_id = ?'; args = [user.id]; break;
    default: where = '1 = 1'; args = [];
  }
  if (statusFilter) {
    const list = String(statusFilter).split(',').filter((s) => Object.values(STATUS).includes(s));
    if (list.length) { where += ` AND o.status IN (${list.map(() => '?').join(',')})`; args.push(...list); }
  }
  return db.prepare(`
    SELECT o.id, o.status, o.total, o.subtotal, o.delivery_fee, o.payment_terms, o.upfront_required, o.paid_amount, o.due_date, o.created_at, o.updated_at,
           o.delivery_address, ph.name AS pharmacy_name, su.name AS supplier_name, d.name AS driver_name,
           (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
      FROM orders o
      JOIN organizations ph ON ph.id = o.pharmacy_id
      JOIN organizations su ON su.id = o.supplier_id
      LEFT JOIN users d ON d.id = o.driver_id
     WHERE ${where} ORDER BY o.id DESC LIMIT 200`).all(...args);
}

module.exports = (app, { db, deliveryFee }) => {
  /**
   * Checkout. A cart can mix products from several companies; it is split
   * into one order per supplier, each delivered separately.
   */
  app.post('/api/orders', requireRole('pharmacy'), (req, res) => {
    const b = req.body || {};
    const supplierId = v.int(b.supplier_id, 'supplier_id', { min: 1 });
    if (!Array.isArray(b.items) || b.items.length === 0) throw new HttpError(400, 'items must be a non-empty list');
    if (b.items.length > 500) throw new HttpError(400, 'Too many items in one order');
    const terms = b.payment_terms;
    if (!TERMS.includes(terms)) throw new HttpError(400, 'payment_terms must be full, partial or credit');
    const notes = v.str(b.notes, 'notes', { required: false, max: 500 });
    const reference = v.str(b.payment_reference, 'payment_reference', { required: false, max: 100 });

    const supplier = db.prepare("SELECT * FROM organizations WHERE id = ? AND type = 'supplier' AND verified = 1").get(supplierId);
    if (!supplier) throw new HttpError(400, 'This company is not available');
    const policy = getPolicy(db, supplierId);

    // Merge duplicate lines.
    const qtyByProduct = new Map();
    for (const it of b.items) {
      const pid = v.int(it?.product_id, 'product_id', { min: 1 });
      const qty = v.int(it?.qty, 'qty', { min: 1, max: 100_000 });
      qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + qty);
    }
    const pharmacy = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.org_id);

    const orderId = tx(db, () => {
      const lines = [];
      for (const [pid, qty] of qtyByProduct) {
        const p = db.prepare('SELECT * FROM products WHERE id = ? AND supplier_id = ? AND active = 1').get(pid, supplierId);
        if (!p) throw new HttpError(400, `Product ${pid} is not available`);
        if (qty < p.min_order_qty) throw new HttpError(400, `Minimum order for ${p.name} is ${p.min_order_qty}`);
        const upd = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?').run(qty, pid, qty);
        if (upd.changes !== 1) throw new HttpError(409, `Not enough stock for ${p.name} (available: ${p.stock})`);
        lines.push({ p, qty });
      }
      const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
      if (subtotal < policy.min_order_value) throw new HttpError(400, `Minimum order value for this company is ${policy.min_order_value}`, { code: 'min_order_value', value: policy.min_order_value });
      const total = subtotal + deliveryFee;

      // Payment terms must be offered by the company, and credit must fit within the limit.
      const option = paymentOptions(policy, total, creditOutstanding(db, pharmacy.id, supplierId)).find((x) => x.terms === terms);
      if (!option) throw new HttpError(400, 'This company does not offer that payment option');
      if (!option.available) throw new HttpError(409, 'This order is above your remaining credit with this company', { code: 'credit_limit', remaining: option.remaining });

      const r = db.prepare(`
        INSERT INTO orders (pharmacy_id, supplier_id, placed_by, status, subtotal, delivery_fee, total, payment_terms,
                            upfront_required, payment_reference, credit_days, notes, delivery_address, delivery_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        pharmacy.id, supplierId, req.user.id, STATUS.PLACED, subtotal, deliveryFee, total, terms,
        option.upfront, reference, terms === 'credit' ? policy.credit_days : null, notes,
        [pharmacy.address, pharmacy.city].filter(Boolean).join(', '), deliveryCode());
      const id = Number(r.lastInsertRowid);
      for (const { p, qty } of lines) {
        const label = [p.name, p.strength, p.form, p.pack_size].filter(Boolean).join(' · ');
        db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price, qty, line_total) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, p.id, label, p.price, qty, p.price * qty);
      }
      addEvent(db, id, STATUS.PLACED, req.user.id);
      return id;
    });

    res.status(201).json({ order: loadOrder(db, orderId, req.user) });
  });

  app.get('/api/orders', requireRole(), (req, res) => {
    res.json({ orders: listOrders(db, req.user, req.query.status) });
  });

  app.get('/api/orders/:id', requireRole(), (req, res) => {
    const o = loadOrder(db, v.int(req.params.id, 'id', { min: 1 }), req.user);
    if (!o) throw new HttpError(404, 'Order not found');
    res.json({ order: o });
  });

  // Fetch an order the current org owns (supplier or pharmacy side) or 404.
  const ownOrder = (req, side) => {
    const id = v.int(req.params.id, 'id', { min: 1 });
    const o = db.prepare(`SELECT * FROM orders WHERE id = ? AND ${side}_id = ?`).get(id, req.user.org_id);
    if (!o) throw new HttpError(404, 'Order not found');
    return o;
  };

  const respond = (req, res, id) => res.json({ order: loadOrder(db, id, req.user) });

  // ---------- Supplier actions ----------

  app.post('/api/orders/:id/accept', requireRole('supplier'), (req, res) => {
    const o = ownOrder(req, 'supplier');
    tx(db, () => setStatus(db, o.id, [STATUS.PLACED], STATUS.ACCEPTED, req.user.id, v.str(req.body?.note, 'note', { required: false, max: 300 })));
    respond(req, res, o.id);
  });

  app.post('/api/orders/:id/reject', requireRole('supplier'), (req, res) => {
    const o = ownOrder(req, 'supplier');
    const reason = v.str(req.body?.reason, 'reason', { max: 300 });
    tx(db, () => { setStatus(db, o.id, [STATUS.PLACED], STATUS.REJECTED, req.user.id, reason); restock(db, o.id); });
    respond(req, res, o.id);
  });

  app.post('/api/orders/:id/ready', requireRole('supplier'), (req, res) => {
    const o = ownOrder(req, 'supplier');
    if (o.paid_amount < o.upfront_required) {
      throw new HttpError(409, `Record the customer's payment first: ${o.paid_amount} of ${o.upfront_required} received`, { code: 'payment_required', paid: o.paid_amount, required: o.upfront_required });
    }
    tx(db, () => setStatus(db, o.id, [STATUS.ACCEPTED], STATUS.READY, req.user.id, 'Packed and waiting for a driver'));
    respond(req, res, o.id);
  });

  // ---------- Pharmacy / supplier cancel ----------

  app.post('/api/orders/:id/cancel', requireRole('pharmacy', 'supplier'), (req, res) => {
    const side = req.user.role;
    const o = ownOrder(req, side);
    // A pharmacy can cancel until the supplier accepts; a supplier until a driver claims it.
    const allowed = side === 'pharmacy' ? [STATUS.PLACED] : [STATUS.ACCEPTED, STATUS.READY];
    const reason = v.str(req.body?.reason, 'reason', { required: false, max: 300 });
    tx(db, () => { setStatus(db, o.id, allowed, STATUS.CANCELLED, req.user.id, reason); restock(db, o.id); });
    respond(req, res, o.id);
  });

  // ---------- Payments ----------

  /** The company records money it has actually received (transfer cleared, cash counted, ...). */
  app.post('/api/orders/:id/payments', requireRole('supplier'), (req, res) => {
    const o = ownOrder(req, 'supplier');
    if ([STATUS.REJECTED, STATUS.CANCELLED].includes(o.status)) throw new HttpError(409, 'This order is closed');
    const amount = v.money(req.body?.amount, 'amount');
    if (amount <= 0) throw new HttpError(400, 'amount must be more than zero');
    if (amount > o.total - o.paid_amount) throw new HttpError(400, `Payment is more than the amount still owed (${o.total - o.paid_amount})`, { code: 'overpayment', balance: o.total - o.paid_amount });
    const method = req.body?.method;
    if (!PAYMENT_METHODS.includes(method)) throw new HttpError(400, `method must be one of ${PAYMENT_METHODS.join(', ')}`);
    const reference = v.str(req.body?.reference, 'reference', { required: false, max: 100 });
    tx(db, () => {
      db.prepare('INSERT INTO order_payments (order_id, amount, method, reference, recorded_by) VALUES (?, ?, ?, ?, ?)').run(o.id, amount, method, reference, req.user.id);
      const r = db.prepare("UPDATE orders SET paid_amount = paid_amount + ?, updated_at = datetime('now') WHERE id = ? AND paid_amount + ? <= total").run(amount, o.id, amount);
      if (r.changes !== 1) throw new HttpError(409, 'The order changed. Refresh and try again.');
      addEvent(db, o.id, 'payment_received', req.user.id, String(amount));
    });
    respond(req, res, o.id);
  });

  /** The pharmacy adds the bank-transfer receipt number so the company can match the payment. */
  app.post('/api/orders/:id/payment-reference', requireRole('pharmacy'), (req, res) => {
    const o = ownOrder(req, 'pharmacy');
    const reference = v.str(req.body?.reference, 'reference', { max: 100 });
    tx(db, () => {
      db.prepare("UPDATE orders SET payment_reference = ?, updated_at = datetime('now') WHERE id = ?").run(reference, o.id);
      addEvent(db, o.id, 'payment_reference', req.user.id, reference);
    });
    respond(req, res, o.id);
  });
};

module.exports.STATUS = STATUS;
module.exports.setStatus = setStatus;
module.exports.loadOrder = loadOrder;
