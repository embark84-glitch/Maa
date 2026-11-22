'use strict';
/*
 * Runs the real Maa server inside the browser for the standalone demo:
 *   - the route modules from src/routes (same code as the Node server),
 *   - on SQLite compiled to JavaScript (sql.js), saved in this browser's storage,
 *   - behind window.fetch, so the web client talks to it exactly as it would to a server.
 * Bundled by standalone/build.js; `require` here is the bundle's module loader.
 */
const { applySchema } = require('../src/store');
const { attachUser, HttpError, errorBody } = require('../src/http');
const { verifyToken } = require('../src/auth'); // mapped to standalone/auth-browser.js
const registerRoutes = require('../src/routes');
const { seed, DEMO_PASSWORD } = require('../src/seed');

// The web client reads the shared rules as globals.
window.MaaPayment = require('../shared/payment');
window.MaaImport = require('../shared/import');

const STORE_KEY = 'maa.demo.sqlite.v4';
const CONFIG = { currency: 'LYD', deliveryFee: 1000 };
const OLD_KEYS = ['maa.demo.db', 'maa.demo.db.v2', 'maa.cart', 'maa.demo.sqlite.v3'];

// ---------- node:sqlite-style wrapper over sql.js ----------

function wrap(raw) {
  const statement = (sql) => ({
    run(...args) {
      const st = raw.prepare(sql);
      try { st.bind(args); st.step(); } finally { st.free(); }
      return { changes: raw.getRowsModified(), lastInsertRowid: raw.exec('SELECT last_insert_rowid()')[0].values[0][0] };
    },
    get(...args) {
      const st = raw.prepare(sql);
      try { st.bind(args); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
    },
    all(...args) {
      const st = raw.prepare(sql);
      const rows = [];
      try { st.bind(args); while (st.step()) rows.push(st.getAsObject()); } finally { st.free(); }
      return rows;
    },
  });
  return { exec: (sql) => { raw.exec(sql); }, prepare: statement };
}

const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- a tiny Express-compatible router ----------

function createRouter() {
  const routes = [];
  const app = {};
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    app[m] = (path, ...handlers) => {
      const keys = [];
      const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
      routes.push({ method: m.toUpperCase(), re, keys, handlers });
    };
  }
  const run = (handlers, req, res) => new Promise((resolve, reject) => {
    let i = 0;
    const next = (err) => {
      if (err) return reject(err);
      if (res.sent) return resolve();
      const h = handlers[i++];
      if (!h) return resolve();
      try {
        const out = h(req, res, next);
        if (out && typeof out.then === 'function') out.then(() => res.sent && resolve(), reject);
        else if (res.sent) resolve();
      } catch (e) { reject(e); }
    };
    next();
  });
  const match = (method, path) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  };
  return { app, run, match };
}

// ---------- order by photo through the viewer's Claude ----------

let samplePromise = null;
const unavailable = () => new HttpError(503, 'Photo ordering is not set up on this server', { code: 'recognition_unavailable' });

/** Same contract as src/recognize-claude.js: resolves Claude's JSON answer for the photo. */
async function demoRecognize({ prompt, mime, bytes }) {
  if (!window.claude?.use) throw unavailable();
  const sample = await (samplePromise ||= window.claude.use('sample'));
  if (!sample) throw unavailable();
  const limits = await sample.limits().catch(() => null);
  if (!limits?.images) throw unavailable();
  try {
    return await sample.json(prompt, { images: [new Blob([bytes], { type: mime })], modelTier: 'default', cache: false });
  } catch (e) {
    const code = e?.code;
    if (code === 'not_granted' || code === 'sampling_disabled') throw new HttpError(403, 'Photo reading needs permission to use Claude', { code: 'not_granted' });
    if (code === 'rate_limited') throw new HttpError(503, 'Photo reading is busy. Try again in a minute.', { code: 'recognition_busy' });
    if (['images_unavailable', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) throw unavailable();
    throw new HttpError(422, 'This photo could not be read. Try a clearer photo.', { code: 'recognition_failed' });
  }
}

// ---------- boot ----------

let db = null;
let raw = null;
const router = createRouter();

function save() {
  if (!raw) return;
  const ok = storage.set(STORE_KEY, toB64(raw.export()));
  raw.exec('PRAGMA foreign_keys = ON'); // export() reopens the database and resets pragmas
  if (!ok) console.warn('Maa demo: browser storage is full or blocked; changes last until the page is closed.');
}

const ready = (async () => {
  if (typeof initSqlJs !== 'function') throw new Error('sql.js did not load');
  const SQL = await initSqlJs();
  OLD_KEYS.forEach(storage.del);
  const saved = storage.get(STORE_KEY);
  try {
    raw = saved ? new SQL.Database(fromB64(saved)) : new SQL.Database();
    db = wrap(raw);
    applySchema(db);
  } catch {
    raw = new SQL.Database(); // unreadable or outdated save: start over
    db = wrap(raw);
    applySchema(db);
  }
  if (seed(db)) save();
  const ctx = { db, secret: 'demo', ...CONFIG, recognize: demoRecognize };
  router.attachUser = attachUser(ctx, verifyToken);
  registerRoutes(router.app, ctx);
})();

ready.catch((e) => {
  console.error(e);
  const view = document.getElementById('view');
  if (view) {
    view.innerHTML = '<div class="card">تعذّر تشغيل النسخة التجريبية لأن مكتبة قاعدة البيانات لم تُحمَّل. تحقّق من الاتصال بالإنترنت ثم أعد تحميل الصفحة.<br><span class="small muted">The demo database library did not load. Check the internet connection and reload.</span></div>';
  }
});

async function handle(method, url, headers, bodyText) {
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  try { await ready; } catch { return reply(503, { error: 'Demo database is not available' }); }
  if (url.pathname === '/api/config') return reply(200, CONFIG);

  let body;
  if (bodyText) {
    try { body = JSON.parse(bodyText); } catch { return reply(400, { error: 'Invalid JSON' }); }
  }
  const req = {
    method, path: url.pathname, body, params: {},
    query: Object.fromEntries(url.searchParams),
    get: (name) => headers.get(name),
  };
  const res = {
    statusCode: 200, sent: false, payload: undefined, binary: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    type(mime) { this.headers['content-type'] = mime; return this; },
    json(obj) { this.payload = obj; this.sent = true; return this; },
    send(bytes) { this.binary = bytes; this.sent = true; return this; },
  };
  try {
    await router.run([router.attachUser], req, res);
    const found = router.match(method, url.pathname);
    if (!found) throw new HttpError(404, 'Not found');
    req.params = found.params;
    await router.run(found.route.handlers, req, res);
    if (!res.sent) throw new Error(`No response from ${method} ${url.pathname}`);
    if (method !== 'GET') save();
    if (res.binary) return new Response(res.binary, { status: res.statusCode, headers: res.headers });
    return reply(res.statusCode, res.payload);
  } catch (err) {
    if (!err.status) console.error(err);
    const { status, body: errBody } = errorBody(err);
    return reply(status, errBody);
  }
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  return handle((init.method || 'GET').toUpperCase(), url, new Headers(init.headers || {}), init.body);
};

// ---------- hooks for the guide in app.js ----------

const TERMINAL = "('delivered', 'rejected', 'cancelled')";
window.maaDemo = {
  password: DEMO_PASSWORD,
  accounts: [
    { email: 'pharmacy@maa.test', label: 'Pharmacy' },
    { email: 'supplier@maa.test', label: 'Al Wadi (supplier)' },
    { email: 'supplier2@maa.test', label: 'Sahara (supplier)' },
    { email: 'driver@maa.test', label: 'Driver' },
    { email: 'admin@maa.test', label: 'Admin' },
  ],
  /** How far the oldest open order has got (or the newest delivered one). */
  progress() {
    if (!db) return { state: 'start', order: null };
    const pick = `SELECT o.id, o.status, o.delivery_code AS code, o.upfront_required, o.paid_amount,
      (SELECT email FROM users u WHERE u.org_id = o.supplier_id AND u.role = 'supplier' ORDER BY u.id LIMIT 1) AS supplierEmail FROM orders o`;
    const active = db.prepare(`${pick} WHERE o.status NOT IN ${TERMINAL} ORDER BY o.id LIMIT 1`).get();
    if (active) return { state: 'active', order: active };
    const last = db.prepare(`${pick} ORDER BY o.id DESC LIMIT 1`).get();
    if (last && last.status === 'delivered') return { state: 'done', order: last };
    return { state: 'start', order: null };
  },
};

window.maaResetDemo = () => {
  [STORE_KEY, 'maa.token', 'maa.drafts', 'maa.tabs'].forEach(storage.del);
  location.hash = '';
  location.reload();
};
