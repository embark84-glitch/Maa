'use strict';
const path = require('node:path');
const express = require('express');
const { verifyToken } = require('./auth');
const { HttpError, attachUser, errorBody } = require('./http');
const registerRoutes = require('./routes');

/**
 * Build the Express app. `ctx` = { db, secret, deliveryFee, currency }.
 */
function createApp(ctx) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' })); // product files of a few thousand rows

  app.use('/api', attachUser(ctx, verifyToken));
  app.get('/api/config', (_req, res) => res.json({ currency: ctx.currency, deliveryFee: ctx.deliveryFee }));
  registerRoutes(app, ctx);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Upload is too large');
    const { status, body } = errorBody(err);
    if (status >= 500) console.error(err);
    res.status(status).json(body);
  });

  return app;
}

module.exports = { createApp };
