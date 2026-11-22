'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { createRecognizer } = require('./recognize-claude');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'maa.db');

let secret = process.env.AUTH_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('AUTH_SECRET must be set in production');
    process.exit(1);
  }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('AUTH_SECRET not set: using a random secret (logins reset on restart)');
}

const db = openDb(DB_FILE);
const app = createApp({
  db,
  secret,
  currency: process.env.CURRENCY || 'LYD',
  deliveryFee: Math.round(Number(process.env.DELIVERY_FEE ?? 10) * 100),
  // Order by photo uses Claude; set MAA_PHOTO_ORDERS=off to turn it off.
  recognize: process.env.MAA_PHOTO_ORDERS === 'off' ? null : createRecognizer(),
});

app.listen(PORT, () => console.log(`Maa running on http://localhost:${PORT}`));
