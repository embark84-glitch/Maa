'use strict';
/*
 * Stand-in for src/auth.js inside the browser demo, where Node's crypto module
 * does not exist. Same function names; deliberately simple because demo data
 * never leaves the visitor's own browser. Never use this on a server.
 */
const rand = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

module.exports = {
  hashPassword: (pw) => `demo$${pw}`,
  verifyPassword: (pw, stored) => stored === `demo$${pw}`,
  signToken: (payload) => btoa(JSON.stringify(payload)),
  verifyToken: (token) => { try { return JSON.parse(atob(token)); } catch { return null; } },
  deliveryCode: () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0'),
  generateApiKey: () => `maa_${rand(24)}`,
  hashApiKey: (key) => `demo$${key}`,
};
