'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL CHECK (type IN ('pharmacy','supplier')),
  name          TEXT NOT NULL,
  license_no    TEXT NOT NULL,
  address       TEXT NOT NULL,
  city          TEXT,
  phone         TEXT,
  verified      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('pharmacy','supplier','driver','admin')),
  org_id        INTEGER REFERENCES organizations(id),
  vehicle       TEXT,
  approved      INTEGER NOT NULL DEFAULT 1,     -- drivers need admin approval
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id   INTEGER NOT NULL REFERENCES organizations(id),
  name          TEXT NOT NULL,
  generic_name  TEXT,
  category      TEXT,
  form          TEXT,
  strength      TEXT,
  pack_size     TEXT,
  sku           TEXT,
  price         INTEGER NOT NULL CHECK (price >= 0),      -- minor units (cents)
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_order_qty INTEGER NOT NULL DEFAULT 1 CHECK (min_order_qty >= 1),
  cold_chain    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id      INTEGER NOT NULL REFERENCES organizations(id),
  supplier_id      INTEGER NOT NULL REFERENCES organizations(id),
  placed_by        INTEGER NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL,
  subtotal         INTEGER NOT NULL,
  delivery_fee     INTEGER NOT NULL,
  total            INTEGER NOT NULL,
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('cash_on_delivery','credit')),
  notes            TEXT,
  delivery_address TEXT NOT NULL,
  delivery_code    TEXT NOT NULL,
  driver_id        INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_pharmacy ON orders(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_orders_supplier ON orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_orders_driver   ON orders(driver_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  name        TEXT NOT NULL,
  unit_price  INTEGER NOT NULL,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  line_total  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  note        TEXT,
  actor_id    INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file) {
  if (file && file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file || ':memory:');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; rolls back on throw. */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, tx };
