'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { seed, DEMO_PASSWORD } = require('../src/seed');

let server; let base;

before(async () => {
  const db = openDb(':memory:');
  seed(db);
  const app = createApp({ db, secret: 'test-secret', currency: 'USD', deliveryFee: 500 });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const login = async (email) => (await api('POST', '/api/auth/login', { body: { email, password: DEMO_PASSWORD } })).body.token;

test('full journey: order from two companies, fulfil, deliver with code', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const supplier = await login('supplier@maa.test');
  const supplier2 = await login('supplier2@maa.test');
  const driver = await login('driver@maa.test');

  const { body: cat } = await api('GET', '/api/products?q=panadol', { token: pharmacy });
  assert.equal(cat.products.length, 2, 'Panadol offered by both companies');
  const [a, b] = cat.products;
  assert.notEqual(a.supplier_id, b.supplier_id);

  const placed = await api('POST', '/api/orders', {
    token: pharmacy,
    body: { items: [{ product_id: a.id, qty: 10 }, { product_id: b.id, qty: 20 }] },
  });
  assert.equal(placed.status, 201);
  assert.equal(placed.body.orders.length, 2, 'cart split into one order per supplier');

  const o = placed.body.orders.find((x) => x.supplier_name === 'Nile Pharma Distribution');
  assert.equal(o.status, 'placed');
  assert.equal(o.total, o.subtotal + 500);
  assert.match(o.delivery_code, /^\d{6}$/);

  // Stock reserved.
  const after = (await api('GET', '/api/supplier/products', { token: supplier })).body.products.find((p) => p.id === o.items[0].product_id);
  assert.equal(after.stock, 1200 - 10);

  // Other supplier can't touch it; the right one can.
  assert.equal((await api('POST', `/api/orders/${o.id}/accept`, { token: supplier2 })).status, 404);
  assert.equal((await api('POST', `/api/orders/${o.id}/ready`, { token: supplier })).status, 409, 'must accept first');
  assert.equal((await api('POST', `/api/orders/${o.id}/accept`, { token: supplier })).body.order.status, 'accepted');
  assert.equal((await api('POST', `/api/orders/${o.id}/ready`, { token: supplier })).body.order.status, 'ready_for_pickup');

  // Supplier never sees the handover code.
  assert.equal((await api('GET', `/api/orders/${o.id}`, { token: supplier })).body.order.delivery_code, undefined);

  const jobs = (await api('GET', '/api/deliveries/available', { token: driver })).body.jobs;
  assert.ok(jobs.some((j) => j.id === o.id));

  const claimed = await api('POST', `/api/deliveries/${o.id}/claim`, { token: driver });
  assert.equal(claimed.body.order.status, 'assigned');
  assert.equal(claimed.body.order.delivery_code, undefined, 'driver cannot see code');
  assert.equal((await api('POST', `/api/deliveries/${o.id}/claim`, { token: driver })).status, 409, 'no double claim');

  assert.equal((await api('POST', `/api/deliveries/${o.id}/deliver`, { token: driver, body: { code: o.delivery_code } })).status, 409, 'must pick up first');
  assert.equal((await api('POST', `/api/deliveries/${o.id}/pickup`, { token: driver })).body.order.status, 'picked_up');
  assert.equal((await api('POST', `/api/deliveries/${o.id}/deliver`, { token: driver, body: { code: '000000' === o.delivery_code ? '111111' : '000000' } })).status, 400);
  const done = await api('POST', `/api/deliveries/${o.id}/deliver`, { token: driver, body: { code: o.delivery_code } });
  assert.equal(done.body.order.status, 'delivered');

  const tracked = (await api('GET', `/api/orders/${o.id}`, { token: pharmacy })).body.order;
  assert.deepEqual(tracked.events.map((e) => e.status), ['placed', 'accepted', 'ready_for_pickup', 'assigned', 'picked_up', 'delivered']);
});

test('reject returns stock; pharmacy cancel only before acceptance', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const supplier = await login('supplier@maa.test');
  const { products } = (await api('GET', '/api/products?q=Brufen', { token: pharmacy })).body;
  const p = products[0];

  const o1 = (await api('POST', '/api/orders', { token: pharmacy, body: { items: [{ product_id: p.id, qty: 5 }] } })).body.orders[0];
  const r = await api('POST', `/api/orders/${o1.id}/reject`, { token: supplier, body: { reason: 'Batch recalled' } });
  assert.equal(r.body.order.status, 'rejected');
  const stock = (await api('GET', '/api/supplier/products', { token: supplier })).body.products.find((x) => x.id === p.id).stock;
  assert.equal(stock, p.stock);

  const o2 = (await api('POST', '/api/orders', { token: pharmacy, body: { items: [{ product_id: p.id, qty: 5 }] } })).body.orders[0];
  await api('POST', `/api/orders/${o2.id}/accept`, { token: supplier });
  assert.equal((await api('POST', `/api/orders/${o2.id}/cancel`, { token: pharmacy })).status, 409);
});

test('stock and minimum order rules are enforced atomically', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const { products } = (await api('GET', '/api/products?q=Lantus', { token: pharmacy })).body;
  const lantus = products[0];
  const { products: pan } = (await api('GET', '/api/products?q=NP-PAN', { token: pharmacy })).body;

  const tooMany = await api('POST', '/api/orders', {
    token: pharmacy, body: { items: [{ product_id: pan[0].id, qty: 10 }, { product_id: lantus.id, qty: 9999 }] },
  });
  assert.equal(tooMany.status, 409);
  const panAfter = (await api('GET', '/api/products?q=NP-PAN', { token: pharmacy })).body.products[0];
  assert.equal(panAfter.stock, pan[0].stock, 'failed checkout rolled back the other line too');

  const tooFew = await api('POST', '/api/orders', { token: pharmacy, body: { items: [{ product_id: pan[0].id, qty: 1 }] } });
  assert.equal(tooFew.status, 400);
  assert.match(tooFew.body.error, /Minimum order/);
});

test('new accounts must be verified/approved before trading', async () => {
  const reg = await api('POST', '/api/auth/register', {
    body: {
      role: 'pharmacy', name: 'New Owner', email: 'new@ph.test', phone: '+1', password: 'longenough1',
      organization: { name: 'New Pharmacy', license_no: 'X-1', address: '1 Road' },
    },
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.organization.verified, false);
  assert.equal((await api('GET', '/api/products', { token: reg.body.token })).status, 403);

  const drv = await api('POST', '/api/auth/register', {
    body: { role: 'driver', name: 'New Driver', email: 'nd@x.test', phone: '+2', password: 'longenough1' },
  });
  assert.equal((await api('GET', '/api/deliveries/available', { token: drv.body.token })).status, 403);

  const admin = await login('admin@maa.test');
  await api('POST', `/api/admin/organizations/${reg.body.user.organization.id}/verify`, { token: admin });
  await api('POST', `/api/admin/drivers/${drv.body.user.id}/approve`, { token: admin });
  assert.equal((await api('GET', '/api/products', { token: reg.body.token })).status, 200);
  assert.equal((await api('GET', '/api/deliveries/available', { token: drv.body.token })).status, 200);

  assert.equal((await api('POST', '/api/auth/register', { body: { role: 'admin', name: 'x', email: 'a@b.co', phone: '1', password: 'longenough1' } })).status, 400);
});

test('roles are isolated', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const driver = await login('driver@maa.test');
  assert.equal((await api('POST', '/api/supplier/products', { token: pharmacy, body: { name: 'x', price: 1 } })).status, 403);
  assert.equal((await api('POST', '/api/orders', { token: driver, body: { items: [] } })).status, 403);
  assert.equal((await api('GET', '/api/orders')).status, 401);
  assert.equal((await api('GET', '/api/admin/overview', { token: pharmacy })).status, 403);
});
