'use strict';
const { HttpError, requireRole } = require('../http');
const v = require('../validate');

/** Platform admin: verify pharmacy/supplier licenses and approve drivers. */
module.exports = (app, { db }) => {
  app.get('/api/admin/overview', requireRole('admin'), (_req, res) => {
    const organizations = db.prepare(`
      SELECT o.*, u.name AS contact_name, u.email AS contact_email, u.phone AS contact_phone
        FROM organizations o
        LEFT JOIN users u ON u.id = (SELECT MIN(id) FROM users WHERE org_id = o.id)
       ORDER BY o.verified, o.created_at DESC`).all()
      .map((o) => ({ ...o, verified: !!o.verified }));
    const drivers = db.prepare("SELECT id, name, email, phone, vehicle, approved, created_at FROM users WHERE role = 'driver' ORDER BY approved, created_at DESC").all()
      .map((d) => ({ ...d, approved: !!d.approved }));
    const stats = db.prepare(`
      SELECT COUNT(*) AS orders,
             COALESCE(SUM(CASE WHEN status = 'delivered' THEN total END), 0) AS delivered_value,
             SUM(status = 'delivered') AS delivered,
             SUM(status IN ('placed','accepted','ready_for_pickup','assigned','picked_up')) AS in_progress
        FROM orders`).get();
    res.json({ organizations, drivers, stats });
  });

  app.post('/api/admin/organizations/:id/verify', requireRole('admin'), (req, res) => {
    const verified = req.body?.verified === false ? 0 : 1;
    const r = db.prepare('UPDATE organizations SET verified = ? WHERE id = ?').run(verified, v.int(req.params.id, 'id', { min: 1 }));
    if (!r.changes) throw new HttpError(404, 'Organization not found');
    res.json({ ok: true });
  });

  app.post('/api/admin/drivers/:id/approve', requireRole('admin'), (req, res) => {
    const approved = req.body?.approved === false ? 0 : 1;
    const r = db.prepare("UPDATE users SET approved = ? WHERE id = ? AND role = 'driver'").run(approved, v.int(req.params.id, 'id', { min: 1 }));
    if (!r.changes) throw new HttpError(404, 'Driver not found');
    res.json({ ok: true });
  });
};
