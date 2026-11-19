'use strict';
const crypto = require('node:crypto');
const { STAFF_ROLES } = require('./lib/catalog');

const SESSION_COOKIE = 'prm_session';
const SESSION_HOURS = 12;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, res, userId, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600e3);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires.toISOString());
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`);
}

function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

/** Middleware: attaches req.user when a valid session cookie is present. */
function loadUser(db) {
  const stmt = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.discipline, u.vendor_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`);
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.user = token ? stmt.get(token, new Date().toISOString()) || null : null;
    next();
  };
}

const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Please sign in.' });

const requireVendor = (req, res, next) =>
  req.user?.role === 'VENDOR' && req.user.vendor_id ? next() : res.status(403).json({ error: 'Vendor account required.' });

const requireStaff = (req, res, next) =>
  req.user && STAFF_ROLES.has(req.user.role) ? next() : res.status(403).json({ error: 'Staff access required.' });

const requireRole = (...roles) => (req, res, next) =>
  req.user && roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Insufficient permissions.' });

module.exports = {
  hashPassword,
  verifyPassword,
  passwordProblem,
  createSession,
  destroySession,
  loadUser,
  requireAuth,
  requireVendor,
  requireStaff,
  requireRole,
};
