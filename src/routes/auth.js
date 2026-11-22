'use strict';
const { HttpError } = require('../http');
const { hashPassword, verifyPassword, signToken } = require('../auth');
const { tx } = require('../store');
const v = require('../validate');

module.exports = (app, { db, secret }) => {
  const publicUser = (u) => {
    const org = u.org_id ? db.prepare('SELECT * FROM organizations WHERE id = ?').get(u.org_id) : null;
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
      vehicle: u.vehicle, approved: !!u.approved,
      organization: org && { ...org, verified: !!org.verified },
    };
  };

  /**
   * Register a pharmacy, a supplier company, or a driver.
   * Pharmacies/suppliers create their organization at the same time and
   * must be verified by an admin before they can trade. Drivers must be approved.
   */
  app.post('/api/auth/register', (req, res) => {
    const b = req.body || {};
    const role = b.role;
    if (!['pharmacy', 'supplier', 'driver'].includes(role)) throw new HttpError(400, 'role must be pharmacy, supplier or driver');
    const name = v.str(b.name, 'name', { max: 100 });
    const email = v.email(b.email);
    const phone = v.str(b.phone, 'phone', { max: 30 });
    const password = v.str(b.password, 'password', { max: 200 });
    if (password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');

    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists');

    const user = tx(db, () => {
      let orgId = null;
      if (role !== 'driver') {
        const o = b.organization || {};
        const r = db.prepare(
          'INSERT INTO organizations (type, name, license_no, address, city, phone) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          role,
          v.str(o.name, 'organization.name', { max: 150 }),
          v.str(o.license_no, 'organization.license_no', { max: 60 }),
          v.str(o.address, 'organization.address', { max: 300 }),
          v.str(o.city, 'organization.city', { required: false, max: 80 }),
          phone,
        );
        orgId = Number(r.lastInsertRowid);
      }
      const r = db.prepare(
        'INSERT INTO users (name, email, phone, password_hash, role, org_id, vehicle, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(name, email, phone, hashPassword(password), role, orgId,
        role === 'driver' ? v.str(b.vehicle, 'vehicle', { required: false, max: 80 }) : null,
        role === 'driver' ? 0 : 1);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
    });

    res.status(201).json({ token: signToken({ uid: user.id }, secret), user: publicUser(user) });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = v.email(req.body?.email);
    const password = v.str(req.body?.password, 'password');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) throw new HttpError(401, 'Wrong email or password');
    res.json({ token: signToken({ uid: user.id }, secret), user: publicUser(user) });
  });

  // Not using requireRole() here: unapproved users still need to see their own status.
  app.get('/api/me', (req, res) => {
    if (!req.user) throw new HttpError(401, 'Login required');
    res.json({ user: publicUser(req.user) });
  });
};
