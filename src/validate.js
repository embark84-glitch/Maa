'use strict';
const { HttpError } = require('./http');

function str(v, field, { required = true, max = 200 } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${field} is required`);
  if (t.length > max) throw new HttpError(400, `${field} is too long`);
  return t || null;
}

function int(v, field, { min = 0, max = Number.MAX_SAFE_INTEGER, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}`);
  return n;
}

/** Accept a price in major units (e.g. 12.5) and return minor units (1250). */
function money(v, field) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < 0 || n > 10_000_000) {
    throw new HttpError(400, `${field} must be a positive amount`);
  }
  return Math.round(n * 100);
}

function email(v) {
  const e = str(v, 'email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'email is invalid');
  return e;
}

module.exports = { str, int, money, email };
