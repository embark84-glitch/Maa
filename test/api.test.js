'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/app');

let server;
let base;
let dataDir;
const ADMIN = { email: 'admin@promergon.test', password: 'AdminPass123' };

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prm-test-'));
  const app = createApp({ dataDir, adminEmail: ADMIN.email, adminPassword: ADMIN.password, log: () => {} });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Minimal cookie-jar client. */
function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const headers = cookie ? { cookie } : {};
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b),
    put: (u, b) => call('PUT', u, b),
    patch: (u, b) => call('PATCH', u, b),
    del: (u) => call('DELETE', u),
  };
}

function fullProfile(name) {
  return {
    company: { legalName: name, registrationNumber: 'CR-1010', taxNumber: 'VAT-3000', yearEstablished: 2005,
      country: 'Saudi Arabia', city: 'Dammam', address: '2nd Industrial City', ownership: 'LOCAL' },
    contacts: { primary: { name: 'Ali Hassan', email: 'ali@example.com', phone: '+966 500 000 000' } },
    sectors: ['OG_DOWNSTREAM', 'PWR_TND'],
    categories: ['W-PIPE', 'W-WELD', 'BOGUS'],
    financial: { currency: 'usd', turnover: [{ year: 2025, amount: 25e6 }, { year: 2024, amount: 20e6 }], bankName: 'SNB', iban: 'sa03 8000 0000 6080 1016 7519' },
    hse: { iso45001: true, hsePolicy: true, trir: 0.4, fatalities3y: 0, manhours3y: 3e6 },
    quality: { iso9001: true, qaManual: true, certifications: 'ASME U stamp' },
    experience: { yearsOilGas: 18, references: [
      { client: 'Aramco', project: 'Refinery revamp', sector: 'OG_DOWNSTREAM', value: 12e6, year: 2023 },
      { client: 'SEC', project: '380kV substation', sector: 'PWR_TND', value: 5e6, year: 2022 }] },
    declarations: { antiBribery: true, sanctions: true, accuracy: true, signatoryName: 'Ali Hassan', signatoryTitle: 'CEO' },
  };
}

async function upload(c, docType, expiry) {
  const fd = new FormData();
  fd.append('doc_type', docType);
  if (expiry) fd.append('expiry_date', expiry);
  fd.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), `${docType}.pdf`);
  return c.post('/api/vendor/documents', fd);
}

test('meta endpoint exposes catalog', async () => {
  const r = await client().get('/api/meta');
  assert.equal(r.status, 200);
  assert.ok(r.body.categories.length > 20);
  assert.ok(r.body.documentTypes.CR.required.includes('SUBCONTRACTOR'));
});

test('registration validates input and rejects duplicates', async () => {
  const c = client();
  let r = await c.post('/api/auth/register', { companyName: 'X', vendorType: 'NOPE', name: 'a', email: 'a@b.co', password: 'Password123' });
  assert.equal(r.status, 400);
  r = await c.post('/api/auth/register', { companyName: 'X', vendorType: 'SUPPLIER', name: 'a', email: 'a@b.co', password: 'short' });
  assert.equal(r.status, 400);
  r = await c.post('/api/auth/register', { companyName: 'X Co', vendorType: 'SUPPLIER', name: 'a', email: 'dup@b.co', password: 'Password123' });
  assert.equal(r.status, 201);
  r = await client().post('/api/auth/register', { companyName: 'Y', vendorType: 'SUPPLIER', name: 'a', email: 'DUP@b.co', password: 'Password123' });
  assert.equal(r.status, 409);
});

test('full lifecycle: register → fill → submit → review → clarify → resubmit → approve', async () => {
  const vendor = client();
  let r = await vendor.post('/api/auth/register', { companyName: 'Gulf Piping Co', vendorType: 'SUBCONTRACTOR', country: 'Saudi Arabia', name: 'Ali Hassan', email: 'ali@gulfpiping.test', password: 'Password123' });
  assert.equal(r.status, 201);

  // Vendors cannot reach staff APIs.
  assert.equal((await vendor.get('/api/staff/vendors')).status, 403);

  // Incomplete submission is rejected with a checklist.
  r = await vendor.post('/api/vendor/submit', {});
  assert.equal(r.status, 422);
  assert.ok(r.body.details.some((d) => d.includes('Missing mandatory document')));

  r = await vendor.put('/api/vendor/application', { profile: fullProfile('Gulf Piping Co') });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.profile.categories, ['W-PIPE', 'W-WELD'], 'unknown categories are dropped');
  assert.equal(r.body.profile.financial.iban, 'SA0380000000608010167519');
  assert.equal(r.body.score, undefined, 'internal score hidden from vendors');

  // Expiring doc types need an expiry date; bad extensions are refused.
  assert.equal((await upload(vendor, 'CR')).status, 400);
  const bad = new FormData();
  bad.append('doc_type', 'PROFILE');
  bad.append('file', new Blob(['x']), 'evil.exe');
  assert.equal((await vendor.post('/api/vendor/documents', bad)).status, 400);

  const future = '2099-12-31';
  for (const t of ['CR', 'TAX', 'ISO9001', 'INSURANCE']) assert.equal((await upload(vendor, t, future)).status, 201, t);
  for (const t of ['PROFILE', 'FIN', 'BANK', 'ORG', 'HSE_MANUAL', 'QA_MANUAL', 'HSE_STATS', 'REFERENCES', 'CODE_OF_CONDUCT'])
    assert.equal((await upload(vendor, t)).status, 201, t);

  r = await vendor.get('/api/vendor/application');
  assert.deepEqual(r.body.issues, []);
  r = await vendor.post('/api/vendor/submit', { note: 'Please review' });
  assert.equal(r.status, 200);
  assert.equal(r.body.vendor.status, 'SUBMITTED');
  const vendorId = r.body.vendor.id;

  // Locked after submission.
  assert.equal((await vendor.put('/api/vendor/application', { profile: fullProfile('Changed') })).status, 409);

  // Staff set-up.
  const admin = client();
  assert.equal((await admin.post('/api/auth/login', ADMIN)).status, 200);
  for (const u of [
    { email: 'officer@promergon.test', name: 'Officer', role: 'PROCUREMENT_OFFICER' },
    { email: 'hse@promergon.test', name: 'HSE Eval', role: 'EVALUATOR', discipline: 'HSE' },
    { email: 'mgr@promergon.test', name: 'Manager', role: 'PROCUREMENT_MANAGER' },
  ]) assert.equal((await admin.post('/api/staff/users', { ...u, password: 'StaffPass123' })).status, 201);

  const officer = client();
  await officer.post('/api/auth/login', { email: 'officer@promergon.test', password: 'StaffPass123' });
  const hse = client();
  await hse.post('/api/auth/login', { email: 'hse@promergon.test', password: 'StaffPass123' });
  const mgr = client();
  await mgr.post('/api/auth/login', { email: 'mgr@promergon.test', password: 'StaffPass123' });

  r = await officer.get(`/api/staff/vendors/${vendorId}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.score.total >= 75, `expected grade A, got ${r.body.score.total}`);
  assert.equal(r.body.score.grade, 'A');
  assert.deepEqual(r.body.allowedTransitions.sort(), ['CLARIFICATION_REQUIRED', 'UNDER_REVIEW']);

  r = await officer.get('/api/staff/vendors?category=W-PIPE&sector=PWR_TND');
  assert.equal(r.body.length, 1);
  r = await officer.get('/api/staff/vendors?category=S-VALV');
  assert.equal(r.body.length, 0);

  assert.equal((await officer.post(`/api/staff/vendors/${vendorId}/transition`, { to: 'UNDER_REVIEW' })).status, 200);
  // Officers cannot approve.
  assert.equal((await officer.post(`/api/staff/vendors/${vendorId}/transition`, { to: 'APPROVED' })).status, 403);
  // Clarification needs a note.
  assert.equal((await officer.post(`/api/staff/vendors/${vendorId}/transition`, { to: 'CLARIFICATION_REQUIRED' })).status, 400);

  // Evaluator restricted to own discipline.
  assert.equal((await hse.post(`/api/staff/vendors/${vendorId}/reviews`, { discipline: 'FINANCE', score: 80, recommendation: 'APPROVE' })).status, 403);
  assert.equal((await hse.post(`/api/staff/vendors/${vendorId}/reviews`, { discipline: 'HSE', score: 70, recommendation: 'CLARIFY' })).status, 400);
  assert.equal((await hse.post(`/api/staff/vendors/${vendorId}/reviews`, { discipline: 'HSE', score: 88, recommendation: 'APPROVE' })).status, 201);

  r = await officer.post(`/api/staff/vendors/${vendorId}/transition`, { to: 'CLARIFICATION_REQUIRED', note: 'Provide valid insurance limits.' });
  assert.equal(r.status, 200);

  // Vendor sees the clarification note, but not internal reviews.
  r = await vendor.get('/api/vendor/application');
  assert.equal(r.body.vendor.status, 'CLARIFICATION_REQUIRED');
  assert.ok(r.body.history.some((h) => h.note === 'Provide valid insurance limits.'));
  assert.equal(r.body.reviews, undefined);
  assert.equal((await vendor.put('/api/vendor/application', { profile: fullProfile('Gulf Piping Co') })).status, 200);
  assert.equal((await vendor.post('/api/vendor/submit', {})).body.vendor.status, 'SUBMITTED');

  await officer.post(`/api/staff/vendors/${vendorId}/transition`, { to: 'UNDER_REVIEW' });
  r = await mgr.post(`/api/staff/vendors/${vendorId}/transition`, { to: 'APPROVED' });
  assert.equal(r.status, 200);
  assert.equal(r.body.vendor.status, 'APPROVED');
  assert.equal(r.body.vendor.vendor_code, `PRM-SUB-${String(vendorId).padStart(5, '0')}`);
  assert.match(r.body.vendor.approval_expires_at, /^\d{4}-\d{2}-\d{2}$/);

  // AVL + CSV export.
  r = await mgr.get('/api/staff/avl');
  assert.equal(r.body.length, 1);
  r = await mgr.get('/api/staff/avl.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.ok(r.body.includes('Gulf Piping Co'));

  // Approved vendor can still upload a renewed certificate but cannot delete documents.
  assert.equal((await upload(vendor, 'ISO45001', future)).status, 201);
  const docs = (await vendor.get('/api/vendor/application')).body.documents;
  assert.equal((await vendor.del(`/api/vendor/documents/${docs[0].id}`)).status, 409);

  // Document access control: another vendor cannot download.
  const other = client();
  await other.post('/api/auth/register', { companyName: 'Other', vendorType: 'SUPPLIER', name: 'o', email: 'o@other.test', password: 'Password123' });
  assert.equal((await other.get(`/api/documents/${docs[0].id}/download`)).status, 404);
  assert.equal((await vendor.get(`/api/documents/${docs[0].id}/download`)).status, 200);
  assert.equal((await mgr.get(`/api/documents/${docs[0].id}/download`)).status, 200);

  // Dashboard.
  r = await mgr.get('/api/staff/dashboard');
  assert.equal(r.body.byStatus.APPROVED, 1);

  // Only admins manage users.
  assert.equal((await mgr.get('/api/staff/users')).status, 403);
});

test('login throttling and cross-origin protection', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { email: 'nobody@x.test', password: 'wrong' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'nobody@x.test', password: 'wrong' })).status, 429);
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('csv escaping neutralises formula injection', () => {
  const { csvCell } = require('../server/lib/csv');
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell(null), '');
});

test('scoring rewards HSE and quality credentials', () => {
  const { computeScore, normalizeProfile } = require('../server/lib/profile');
  const v = { vendor_type: 'SUPPLIER' };
  const weak = computeScore(v, normalizeProfile({}), []);
  const strong = computeScore(v, normalizeProfile(fullProfile('S')), [{ doc_type: 'ISO9001', expiry_date: '2099-01-01' }]);
  assert.equal(weak.grade, 'D');
  assert.ok(strong.total > weak.total + 40);
  const expired = computeScore(v, normalizeProfile(fullProfile('S')), [{ doc_type: 'ISO9001', expiry_date: '2000-01-01' }]);
  assert.ok(expired.total < strong.total, 'expired certificates score lower');
});
