'use strict';
/*
 * Runs the real Maa server inside the browser:
 *   - the route modules from src/routes (same code as the Node server),
 *   - on SQLite compiled to JavaScript (sql.js),
 *   - behind window.fetch, so the web client talks to it exactly as it would to a server.
 *
 * Two modes, chosen at build time (window.MAA_MODE):
 *   demo    data lives in this browser only; demo accounts and a guided walkthrough.
 *   shared  the pilot: one database shared by everyone the artifact is shared with
 *           (standalone/shared-sync.js), each Maa account tied to a Claude account.
 * Bundled by standalone/build.js; `require` here is the bundle's module loader.
 */
const { applySchema } = require('../src/store');
const { attachUser, HttpError, errorBody } = require('../src/http');
const { verifyToken } = require('../src/auth'); // mapped to standalone/auth-browser.js
const registerRoutes = require('../src/routes');
const { seed, DEMO_PASSWORD } = require('../src/seed');
const { hashPassword } = require('../src/auth');
const { createSharedSync, toB64: b64Of, fromB64: bytesOf } = require('./shared-sync');

const SHARED = window.MAA_MODE === 'shared';
window.maaInBrowser = true;

// The web client reads the shared rules as globals.
window.MaaPayment = require('../shared/payment');
window.MaaImport = require('../shared/import');

const STORE_KEY = 'maa.demo.sqlite.v4';
const CONFIG = { currency: 'LYD', deliveryFee: 1000 };
const OLD_KEYS = ['maa.demo.db', 'maa.demo.db.v2', 'maa.cart', 'maa.demo.sqlite.v3'];

// ---------- node:sqlite-style wrapper over sql.js ----------

function wrap(getRaw) {
  const statement = (sql) => ({
    run(...args) {
      const raw = getRaw();
      const st = raw.prepare(sql);
      try { st.bind(args); st.step(); } finally { st.free(); }
      return { changes: raw.getRowsModified(), lastInsertRowid: raw.exec('SELECT last_insert_rowid()')[0].values[0][0] };
    },
    get(...args) {
      const st = getRaw().prepare(sql);
      try { st.bind(args); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); }
    },
    all(...args) {
      const st = getRaw().prepare(sql);
      const rows = [];
      try { st.bind(args); while (st.step()) rows.push(st.getAsObject()); } finally { st.free(); }
      return rows;
    },
  });
  return { exec: (sql) => { getRaw().exec(sql); }, prepare: statement };
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

let raw = null;
const db = wrap(() => raw);
const router = createRouter();
let SQL = null;
let sync = null;          // shared mode
let store = null;         // shared mode: the db capability
let me = null;            // shared mode: { id, isOwner }

function save() {
  if (SHARED || !raw) return;
  const ok = storage.set(STORE_KEY, toB64(raw.export()));
  raw.exec('PRAGMA foreign_keys = ON'); // export() reopens the database and resets pragmas
  if (!ok) console.warn('Maa demo: browser storage is full or blocked; changes last until the page is closed.');
}

function openBytes(bytes) {
  raw?.close();
  raw = bytes ? new SQL.Database(bytes) : new SQL.Database();
  applySchema(db);
  raw.exec('PRAGMA foreign_keys = ON');
}

async function bootDemo() {
  OLD_KEYS.forEach(storage.del);
  const saved = storage.get(STORE_KEY);
  try { openBytes(saved ? fromB64(saved) : null); } catch { openBytes(null); } // unreadable or outdated save: start over
  if (seed(db)) save();
}

/** Shared pilot: connect to the artifact's database and identify the viewer. */
async function bootShared() {
  window.maaShared = { status: 'loading' };
  const [dbCap, userCap] = await Promise.all([window.claude?.use?.('db'), window.claude?.use?.('user')]);
  const id = userCap ? await userCap.id() : null;
  if (!dbCap || !id) { window.maaShared = { status: 'no_access' }; return; }
  store = dbCap;
  me = { id, isOwner: (await userCap.isOwner()) ?? false };
  const holder = `${id}.${Math.random().toString(36).slice(2, 8)}`;
  sync = createSharedSync({
    store, holder, open: openBytes,
    exportBytes: () => { const b = raw.export(); raw.exec('PRAGMA foreign_keys = ON'); return b; },
    onRemote: () => window.dispatchEvent(new Event('maa:data')),
  });
  const status = await sync.start({
    canCreate: me.isOwner,
    // A fresh shared database holds one account: the platform admin, tied to the owner.
    create: () => db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, approved, claude_id)
      VALUES (?, ?, ?, ?, 'admin', 1, ?)`).run('مدير المنصة', 'owner@maa.local', '-', hashPassword(Math.random().toString(36)), me.id),
  });
  window.maaShared = { status, isOwner: me.isOwner };
}

const ready = (async () => {
  if (typeof initSqlJs !== 'function') throw new Error('sql.js did not load');
  SQL = await initSqlJs();
  if (SHARED) await bootShared(); else await bootDemo();
  const ctx = { db, secret: 'demo', ...CONFIG, recognize: demoRecognize };
  router.attachUser = attachUser(ctx, verifyToken);
  registerRoutes(router.app, ctx);
})();

ready.catch((e) => {
  console.error(e);
  if (SHARED) window.maaShared = { status: 'error' };
  const view = document.getElementById('view');
  if (view && !SHARED) {
    view.innerHTML = '<div class="card">تعذّر تشغيل النسخة التجريبية لأن مكتبة قاعدة البيانات لم تُحمَّل. تحقّق من الاتصال بالإنترنت ثم أعد تحميل الصفحة.<br><span class="small muted">The demo database library did not load. Check the internet connection and reload.</span></div>';
  }
});

// ---------- shared pilot: identity, photos, session ----------

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokenFor = (uid) => btoa(JSON.stringify({ uid }));
const IMG_PATH = /^\/api\/product-images\/(\d+)$/;
const IMG_EDIT = /^\/api\/supplier\/products\/(\d+)\/image$/;

/** Answers that need no route, and checks that a request really comes from this viewer's account. */
async function sharedPreflight(method, url, req) {
  const status = window.maaShared?.status;
  if (status !== 'ready') return json(503, { error: 'The shared data is not available', details: { code: status || 'error' } });

  if (url.pathname === '/api/session') {
    const row = db.prepare('SELECT id FROM users WHERE claude_id = ?').get(me.id);
    if (!row) return json(200, { user: null, isOwner: me.isOwner });
    const token = tokenFor(row.id);
    const r = await handle('GET', new URL('/api/me', location.href), new Headers({ authorization: `Bearer ${token}` }));
    return json(200, { token, user: (await r.json()).user, isOwner: me.isOwner });
  }
  if (url.pathname === '/api/auth/login') return json(403, { error: 'You are signed in with your Claude account' });
  if (url.pathname === '/api/auth/register' && db.prepare('SELECT 1 FROM users WHERE claude_id = ?').get(me.id)) {
    return json(409, { error: 'You already have an account. Reload the page.' });
  }
  if (method === 'GET' && IMG_PATH.test(url.pathname)) {
    const snap = await store.doc(`maa/img-${IMG_PATH.exec(url.pathname)[1]}`).get();
    if (!snap.exists) return json(404, { error: 'Image not found' });
    const { mime, b64 } = snap.data();
    return new Response(bytesOf(b64), { status: 200, headers: { 'content-type': mime } });
  }
  // A token may only act for the account tied to this Claude account.
  const auth = req.get('authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const uid = verifyToken(auth.slice(7))?.uid;
    const owner = db.prepare('SELECT claude_id FROM users WHERE id = ?').get(uid)?.claude_id;
    if (owner !== me.id) return json(401, { error: 'Login required' });
  }
  return null;
}

/** After a successful change: tie new accounts to this viewer, keep photos out of the shared file. */
async function sharedAfter(method, url, req, res) {
  if (res.statusCode >= 400) return false;
  if (method === 'POST' && url.pathname === '/api/auth/register') {
    db.prepare('UPDATE users SET claude_id = ? WHERE id = ?').run(me.id, res.payload.user.id);
    res.payload.token = tokenFor(res.payload.user.id);
    return true;
  }
  const m = IMG_EDIT.exec(url.pathname);
  if (m && method === 'PUT') {
    const row = db.prepare('SELECT mime, data FROM product_images WHERE product_id = ?').get(Number(m[1]));
    await store.doc(`maa/img-${m[1]}`).set({ mime: row.mime, b64: b64Of(row.data), at: new Date().toISOString() });
    db.prepare('DELETE FROM product_images WHERE product_id = ?').run(Number(m[1]));
    return true;
  }
  if (m && method === 'DELETE') {
    await store.doc(`maa/img-${m[1]}`).delete();
    return true;
  }
  return false;
}

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
  const runRoute = async () => {
    await router.run([router.attachUser], req, res);
    const found = router.match(method, url.pathname);
    if (!found) throw new HttpError(404, 'Not found');
    req.params = found.params;
    await router.run(found.route.handlers, req, res);
    if (!res.sent) throw new Error(`No response from ${method} ${url.pathname}`);
  };
  try {
    if (SHARED) {
      const early = await sharedPreflight(method, url, req);
      if (early) return early;
    }
    // Reading a photo or previewing a file changes nothing: no need to hold the save lock.
    const readOnly = method === 'GET' || /\/recognize$/.test(url.pathname)
      || (url.pathname === '/api/supplier/products/import' && body?.dry_run !== false);
    if (SHARED && !readOnly) {
      await sync.write(async () => {
        const before = raw.exec('SELECT total_changes()')[0].values[0][0];
        await runRoute();
        const moved = await sharedAfter(method, url, req, res);
        return moved || raw.exec('SELECT total_changes()')[0].values[0][0] !== before;
      });
    } else {
      await runRoute();
      if (method !== 'GET') save();
    }
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

// ---------- hooks for the guide in app.js (demo mode only) ----------

const TERMINAL = "('delivered', 'rejected', 'cancelled')";
if (!SHARED) window.maaDemo = {
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

if (!SHARED) window.maaResetDemo = () => {
  [STORE_KEY, 'maa.token', 'maa.drafts', 'maa.tabs'].forEach(storage.del);
  location.hash = '';
  location.reload();
};
