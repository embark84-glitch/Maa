'use strict';
const { HttpError, requireRole } = require('../http');
const { tx } = require('../store');
const v = require('../validate');
const { STATUS, setStatus, loadOrder } = require('./orders');
const { collectOnDelivery } = require('../../shared/payment');

/** Driver side: pick up packed orders from suppliers and hand them to pharmacies. */
module.exports = (app, { db }) => {
  /** Jobs waiting for a driver, with pickup and drop-off info. */
  app.get('/api/deliveries/available', requireRole('driver'), (_req, res) => {
    const jobs = db.prepare(`
      SELECT o.id, o.total, o.delivery_fee, o.payment_terms, o.paid_amount, o.updated_at,
             su.name AS supplier_name, su.address AS pickup_address, su.city AS pickup_city,
             ph.name AS pharmacy_name, o.delivery_address,
             (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count,
             (SELECT MAX(p.cold_chain) FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id) AS cold_chain
        FROM orders o
        JOIN organizations su ON su.id = o.supplier_id
        JOIN organizations ph ON ph.id = o.pharmacy_id
       WHERE o.status = ? ORDER BY o.updated_at`).all(STATUS.READY);
    res.json({ jobs: jobs.map((j) => ({ ...j, cold_chain: !!j.cold_chain, collect_on_delivery: collectOnDelivery(j) })) });
  });

  const id = (req) => v.int(req.params.id, 'id', { min: 1 });
  const mine = (req) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ? AND driver_id = ?').get(id(req), req.user.id);
    if (!o) throw new HttpError(404, 'Delivery not found');
    return o;
  };
  const respond = (req, res, orderId) => res.json({ order: loadOrder(db, orderId, req.user) });

  app.post('/api/deliveries/:id/claim', requireRole('driver'), (req, res) => {
    const orderId = id(req);
    // setStatus only matches rows still in ready_for_pickup, so two drivers can't claim the same job.
    tx(db, () => setStatus(db, orderId, [STATUS.READY], STATUS.ASSIGNED, req.user.id, `Driver ${req.user.name} assigned`, { driver_id: req.user.id }));
    respond(req, res, orderId);
  });

  app.post('/api/deliveries/:id/release', requireRole('driver'), (req, res) => {
    const o = mine(req);
    tx(db, () => setStatus(db, o.id, [STATUS.ASSIGNED], STATUS.READY, req.user.id, 'Driver released the job', { driver_id: null }));
    res.json({ ok: true });
  });

  app.post('/api/deliveries/:id/pickup', requireRole('driver'), (req, res) => {
    const o = mine(req);
    tx(db, () => setStatus(db, o.id, [STATUS.ASSIGNED], STATUS.PICKED_UP, req.user.id, 'Collected from supplier, on the way'));
    respond(req, res, o.id);
  });

  /** Proof of delivery: the pharmacy reads its 6-digit code to the driver. */
  app.post('/api/deliveries/:id/deliver', requireRole('driver'), (req, res) => {
    const o = mine(req);
    const code = v.str(req.body?.code, 'code', { max: 10 });
    if (o.status !== STATUS.PICKED_UP) throw new HttpError(409, 'Order has not been picked up yet');
    if (code !== o.delivery_code) throw new HttpError(400, 'Delivery code is incorrect');
    const note = v.str(req.body?.note, 'note', { required: false, max: 300 });
    // Credit terms start counting from the day the goods arrive.
    const extra = o.payment_terms === 'credit' ? { due_date: new Date(Date.now() + o.credit_days * 86_400_000).toISOString().slice(0, 10) } : {};
    tx(db, () => setStatus(db, o.id, [STATUS.PICKED_UP], STATUS.DELIVERED, req.user.id, note || 'Handed over to pharmacy', extra));
    respond(req, res, o.id);
  });
};
