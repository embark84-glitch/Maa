'use strict';
/* Request plumbing with no Express dependency, so the same route code also runs in the browser demo. */

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

/** Middleware: read the bearer token and attach the signed-in user (if any) to req.user. */
function attachUser({ db, secret }, verifyToken) {
  return (req, _res, next) => {
    const header = (req.get && req.get('authorization')) || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token && verifyToken(token, secret);
    if (payload) {
      const user = db.prepare(`
        SELECT u.id, u.name, u.email, u.phone, u.role, u.org_id, u.vehicle, u.approved, o.verified AS org_verified
          FROM users u LEFT JOIN organizations o ON o.id = u.org_id WHERE u.id = ?`).get(payload.uid);
      if (user) req.user = user;
    }
    next();
  };
}

/** Middleware: require a signed-in, approved user with one of the given roles. */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Login required'));
    if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'Not allowed for your role'));
    if (!req.user.approved) return next(new HttpError(403, 'Your account is awaiting approval'));
    if (req.user.org_id && !req.user.org_verified) return next(new HttpError(403, 'Your organization is awaiting license verification'));
    next();
  };
}

/** Error body shared by both runtimes. */
function errorBody(err) {
  const status = err.status || 500;
  return { status, body: { error: status >= 500 ? 'Internal server error' : err.message, ...(err.details && { details: err.details }) } };
}

/** Bytes for a binary response: a Buffer on Node, plain bytes in the browser demo. */
const toBinary = (bytes) => (typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes);

/** Decode base64 on either runtime. */
function fromBase64(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Split a data: URL into its media type and bytes; null if it is not a base64 data URL. */
function parseDataUrl(s) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(s || ''));
  if (!m) return null;
  const b64 = m[2].replace(/\s/g, '');
  return { mime: m[1].toLowerCase(), b64, bytes: fromBase64(b64) };
}

module.exports = { HttpError, attachUser, requireRole, errorBody, toBinary, fromBase64, parseDataUrl };
