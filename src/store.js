'use strict';
/* Database schema and transaction helper. No Node-only APIs: also used by the browser demo. */

const SCHEMA_VERSION = 2;

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
  -- supplier terms of sale (ignored for pharmacies)
  allow_full       INTEGER NOT NULL DEFAULT 1,
  allow_partial    INTEGER NOT NULL DEFAULT 0,
  deposit_percent  INTEGER NOT NULL DEFAULT 30 CHECK (deposit_percent BETWEEN 1 AND 99),
  allow_credit     INTEGER NOT NULL DEFAULT 0,
  credit_days      INTEGER NOT NULL DEFAULT 30 CHECK (credit_days BETWEEN 1 AND 365),
  credit_limit     INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),   -- per pharmacy, minor units
  min_order_value  INTEGER NOT NULL DEFAULT 0 CHECK (min_order_value >= 0),
  bank_details     TEXT,
  products_updated_at TEXT,
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
  sku           TEXT NOT NULL,                    -- the company's own product code; imports match on it
  price         INTEGER NOT NULL CHECK (price >= 0),      -- minor units (cents)
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_order_qty INTEGER NOT NULL DEFAULT 1 CHECK (min_order_qty >= 1),
  cold_chain    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(supplier_id, sku);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  pharmacy_id      INTEGER NOT NULL REFERENCES organizations(id),
  supplier_id      INTEGER NOT NULL REFERENCES organizations(id),
  placed_by        INTEGER NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL,
  subtotal         INTEGER NOT NULL,
  delivery_fee     INTEGER NOT NULL,
  total            INTEGER NOT NULL,
  payment_terms    TEXT NOT NULL CHECK (payment_terms IN ('full','partial','credit')),
  upfront_required INTEGER NOT NULL,              -- must be paid before dispatch
  paid_amount      INTEGER NOT NULL DEFAULT 0,    -- confirmed by the supplier
  payment_reference TEXT,                         -- transfer receipt no. given by the pharmacy
  credit_days      INTEGER,
  due_date         TEXT,                          -- credit: set on delivery
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

CREATE TABLE IF NOT EXISTS order_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL CHECK (method IN ('bank_transfer','cash','card','cheque','other')),
  reference   TEXT,
  recorded_by INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES organizations(id),
  prefix       TEXT NOT NULL,                     -- first characters, shown so people can tell keys apart
  key_hash     TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE TABLE IF NOT EXISTS product_imports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  source      TEXT NOT NULL CHECK (source IN ('excel','api')),
  file_name   TEXT,
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL,
  unchanged   INTEGER NOT NULL,
  hidden      INTEGER NOT NULL,
  actor_id    INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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

/** Create tables on a new database; refuse an old one instead of corrupting it. */
function applySchema(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const hasTables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get().n > 0;
  if (hasTables && version < SCHEMA_VERSION) {
    throw new Error('This database was made by an older version of Maa. Delete the data file (DB_FILE, default data/maa.db) and run "npm run seed" again.');
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
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

module.exports = { applySchema, tx, SCHEMA_VERSION };
