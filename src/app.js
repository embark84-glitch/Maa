'use strict';
const path = require('node:path');
const express = require('express');
const { verifyToken } = require('./auth');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Build the Express app. `ctx` = { db, secret, deliveryFee, currency }.
 */
function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Attach the authenticated user (if any) to req.user.
  app.use('/api', (req, _res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token && verifyToken(token, ctx.secret);
    if (payload) {
      const user = ctx.db
        .prepare(`SELECT u.id, u.name, u.email, u.phone, u.role, u.org_id, u.vehicle, u.approved,
                         o.verified AS org_verified
                    FROM users u LEFT JOIN organizations o ON o.id = u.org_id WHERE u.id = ?`)
        .get(payload.uid);
      if (user) req.user = user;
    }
    next();
  });

  app.get('/api/config', (_req, res) => res.json({ currency: ctx.currency, deliveryFee: ctx.deliveryFee }));

  require('./routes/auth')(app, ctx);
  require('./routes/catalog')(app, ctx);
  require('./routes/orders')(app, ctx);
  require('./routes/deliveries')(app, ctx);
  require('./routes/admin')(app, ctx);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}

/** Middleware: require a logged-in user with one of the given roles. */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Login required'));
    if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'Not allowed for your role'));
    if (!req.user.approved) return next(new HttpError(403, 'Your account is awaiting approval'));
    if (req.user.org_id && !req.user.org_verified) {
      return next(new HttpError(403, 'Your organization is awaiting license verification'));
    }
    next();
  };
}

module.exports = { createApp, requireRole, HttpError };
