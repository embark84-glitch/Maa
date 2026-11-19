'use strict';
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const { openDb, tx } = require('./db');
const A = require('./auth');
const C = require('./lib/catalog');
const S = require('./services');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Build the Express application.
 * @param {object} opts { dbFile, uploadDir, maxUploadMb, secureCookies, adminEmail, adminPassword, log }
 */
function createApp(opts = {}) {
  const dataDir = opts.dataDir || path.join(__dirname, '..', 'data');
  const dbFile = opts.dbFile || path.join(dataDir, 'promergon.db');
  const uploadDir = opts.uploadDir || path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDb(dbFile);
  const log = opts.log || console.log;

  bootstrapAdmin(db, opts, log);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', opts.trustProxy ?? false);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(A.loadUser(db));

  // CSRF defence in depth (cookies are SameSite=Strict): mutating API calls must come from our own origin.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && origin !== `${req.protocol}://${req.headers.host}`)
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
    next();
  });

  // ---------- Public / auth ----------
  app.get('/api/meta', (_req, res) => {
    res.json({
      vendorTypes: C.VENDOR_TYPES, sectors: C.SECTORS, categories: C.CATEGORIES, documentTypes: C.DOCUMENT_TYPES,
      statuses: C.STATUSES, roles: C.ROLES, disciplines: C.DISCIPLINES,
    });
  });

  const attempts = new Map(); // naive brute-force throttle: key -> { n, until }
  const throttled = (key) => {
    const a = attempts.get(key);
    return a && a.n >= 5 && a.until > Date.now();
  };
  const fail = (key) => {
    const a = attempts.get(key) || { n: 0, until: 0 };
    a.n += 1;
    a.until = Date.now() + 15 * 60e3;
    attempts.set(key, a);
  };

  app.post('/api/auth/register', (req, res) => {
    const { companyName, vendorType, country, name, email, password } = req.body || {};
    if (!companyName || typeof companyName !== 'string') throw new S.HttpError(400, 'Company name is required.');
    if (!C.VENDOR_TYPES[vendorType]) throw new S.HttpError(400, 'Select a vendor type.');
    if (!name || typeof name !== 'string') throw new S.HttpError(400, 'Your name is required.');
    if (!EMAIL_RE.test(email || '')) throw new S.HttpError(400, 'A valid email address is required.');
    const pwErr = A.passwordProblem(password);
    if (pwErr) throw new S.HttpError(400, pwErr);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.trim()))
      throw new S.HttpError(409, 'An account with this email already exists.');
    const userId = tx(db, () => {
      const profile = { company: { legalName: companyName.trim(), country: String(country || '').trim() },
        contacts: { primary: { name: name.trim(), email: email.trim() } } };
      const v = db.prepare('INSERT INTO vendors (company_name, vendor_type, country, profile_json) VALUES (?, ?, ?, ?)')
        .run(companyName.trim().slice(0, 200), vendorType, String(country || '').trim().slice(0, 100) || null, JSON.stringify(profile));
      const vendorId = Number(v.lastInsertRowid);
      const u = db.prepare("INSERT INTO users (email, password_hash, name, role, vendor_id) VALUES (?, ?, ?, 'VENDOR', ?)")
        .run(email.trim(), A.hashPassword(password), name.trim().slice(0, 120), vendorId);
      S.audit(db, { vendorId, userId: Number(u.lastInsertRowid), action: 'REGISTERED', to: 'DRAFT' });
      S.refreshDerived(db, vendorId);
      return Number(u.lastInsertRowid);
    });
    A.createSession(db, res, userId, opts.secureCookies);
    res.status(201).json({ ok: true });
  });

  app.post('/api/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const key = `${req.ip}|${email}`;
    if (throttled(key)) throw new S.HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
    const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    if (!u || !A.verifyPassword(String(req.body?.password || ''), u.password_hash)) {
      fail(key);
      throw new S.HttpError(401, 'Invalid email or password.');
    }
    attempts.delete(key);
    A.createSession(db, res, u.id, opts.secureCookies);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req, res) => {
    A.destroySession(db, req, res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

  app.post('/api/auth/password', A.requireAuth, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!A.verifyPassword(String(req.body?.currentPassword || ''), u.password_hash))
      throw new S.HttpError(400, 'Current password is incorrect.');
    const pwErr = A.passwordProblem(req.body?.newPassword);
    if (pwErr) throw new S.HttpError(400, pwErr);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(A.hashPassword(req.body.newPassword), u.id);
    res.json({ ok: true });
  });

  // ---------- Documents (shared) ----------
  app.get('/api/documents/:id/download', A.requireAuth, (req, res) => {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
    const allowed = doc && (C.STAFF_ROLES.has(req.user.role) || req.user.vendor_id === doc.vendor_id);
    if (!allowed) throw new S.HttpError(404, 'Document not found.');
    const file = path.join(uploadDir, doc.stored_name);
    if (!fs.existsSync(file)) throw new S.HttpError(410, 'File is no longer available.');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
    fs.createReadStream(file).pipe(res);
  });

  app.use('/api/vendor', require('./routes/vendor')(db, { uploadDir, maxUploadMb: opts.maxUploadMb || 15 }));
  app.use('/api/staff', require('./routes/staff')(db));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // ---------- Front-end ----------
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '1h' }));

  // ---------- Errors ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${opts.maxUploadMb || 15} MB).` : err.message;
      return res.status(400).json({ error: msg });
    }
    if (err instanceof S.HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' });
    log('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  app.locals.db = db;
  return app;
}

function bootstrapAdmin(db, opts, log) {
  if (db.prepare("SELECT 1 FROM users WHERE role = 'ADMIN'").get()) return;
  const email = opts.adminEmail || 'admin@promergon.com';
  const password = opts.adminPassword || crypto.randomBytes(9).toString('base64url') + '9a';
  db.prepare("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, 'System Administrator', 'ADMIN')")
    .run(email, A.hashPassword(password));
  if (!opts.adminPassword) log(`\n  Created administrator account\n    email:    ${email}\n    password: ${password}\n  Change it after first sign-in.\n`);
}

module.exports = { createApp };
