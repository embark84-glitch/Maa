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
  // Stand-in for Claude: reads the catalogue from the prompt and "sees" Actifed (qty 12),
  // a made-up id, and one medicine this company does not sell.
  const recognize = async ({ prompt, mime }) => {
    if (mime !== 'image/jpeg') throw new Error('unexpected type');
    const actifed = prompt.split('\n').find((l) => l.includes('Actifed'));
    return { items: [
      { product_id: actifed ? Number(actifed.split(' | ')[0]) : null, name_seen: 'Actifed Rhume', quantity: 12, confidence: 'high' },
      { product_id: 99999, name_seen: 'Fake', quantity: null, confidence: 'low' },
      { product_id: null, name_seen: 'Tabuvan 160 mg', quantity: null, confidence: 'medium' },
    ] };
  };
  const app = createApp({ db, secret: 'test-secret', currency: 'LYD', deliveryFee: 1000, recognize });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const login = async (email) => (await api('POST', '/api/auth/login', { body: { email, password: DEMO_PASSWORD } })).body.token;
const WADI = 'شركة الوادي للمستلزمات الطبية';

async function supplierByName(token, name) {
  const { suppliers } = (await api('GET', '/api/suppliers', { token })).body;
  const s = suppliers.find((x) => x.name === name);
  return (await api('GET', `/api/suppliers/${s.id}`, { token })).body;
}

test('order from one company: full payment must be recorded before dispatch, then deliver with code', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const supplier = await login('supplier@maa.test');
  const supplier2 = await login('supplier2@maa.test');
  const driver = await login('driver@maa.test');

  const { supplier: s, products } = await supplierByName(pharmacy, WADI);
  assert.deepEqual(
    { full: s.policy.allow_full, partial: s.policy.allow_partial, credit: s.policy.allow_credit, pct: s.policy.deposit_percent },
    { full: true, partial: true, credit: true, pct: 30 },
  );
  assert.equal(s.credit.remaining, 500000);
  const aug = products.find((p) => p.sku === 'NP-AUG-1G');

  const placed = await api('POST', '/api/orders', {
    token: pharmacy, body: { supplier_id: s.id, items: [{ product_id: aug.id, qty: 10 }], payment_terms: 'full', payment_reference: 'TRX-1' },
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const o = placed.body.order;
  assert.equal(o.total, 18000 + 1000);
  assert.equal(o.upfront_required, o.total);
  assert.equal(o.payment_reference, 'TRX-1');

  assert.equal((await api('POST', `/api/orders/${o.id}/accept`, { token: supplier2 })).status, 404, 'other company cannot touch it');
  assert.equal((await api('POST', `/api/orders/${o.id}/accept`, { token: supplier })).body.order.status, 'accepted');

  const blocked = await api('POST', `/api/orders/${o.id}/ready`, { token: supplier });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.details.code, 'payment_required');

  assert.equal((await api('POST', `/api/orders/${o.id}/payments`, { token: supplier, body: { amount: 500, method: 'bank_transfer' } })).status, 400, 'more than owed');
  const paid = await api('POST', `/api/orders/${o.id}/payments`, { token: supplier, body: { amount: 190, method: 'bank_transfer', reference: 'TRX-1' } });
  assert.equal(paid.body.order.paid_amount, 19000);
  assert.equal(paid.body.order.balance, 0);
  assert.equal((await api('POST', `/api/orders/${o.id}/ready`, { token: supplier })).body.order.status, 'ready_for_pickup');

  const claimed = await api('POST', `/api/deliveries/${o.id}/claim`, { token: driver });
  assert.equal(claimed.body.order.delivery_code, undefined, 'driver cannot see code');
  assert.equal(claimed.body.order.collect_on_delivery, 0, 'nothing to collect on a fully paid order');
  await api('POST', `/api/deliveries/${o.id}/pickup`, { token: driver });
  assert.equal((await api('POST', `/api/deliveries/${o.id}/deliver`, { token: driver, body: { code: o.delivery_code === '000000' ? '111111' : '000000' } })).status, 400);
  assert.equal((await api('POST', `/api/deliveries/${o.id}/deliver`, { token: driver, body: { code: o.delivery_code } })).body.order.status, 'delivered');

  const tracked = (await api('GET', `/api/orders/${o.id}`, { token: pharmacy })).body.order;
  assert.deepEqual(tracked.events.map((e) => e.status),
    ['placed', 'accepted', 'payment_received', 'ready_for_pickup', 'assigned', 'picked_up', 'delivered']);
});

test('partial payment: deposit unlocks dispatch, driver collects the rest', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const supplier = await login('supplier@maa.test');
  const driver = await login('driver@maa.test');
  const { supplier: s, products } = await supplierByName(pharmacy, WADI);
  const p = products.find((x) => x.sku === 'NP-BRU-400');
  const o = (await api('POST', '/api/orders', { token: pharmacy, body: { supplier_id: s.id, items: [{ product_id: p.id, qty: 20 }], payment_terms: 'partial' } })).body.order;
  assert.equal(o.total, 13500 + 1000);
  assert.equal(o.upfront_required, Math.round(14500 * 0.3));
  await api('POST', `/api/orders/${o.id}/accept`, { token: supplier });
  await api('POST', `/api/orders/${o.id}/payments`, { token: supplier, body: { amount: o.upfront_required / 100, method: 'cash' } });
  assert.equal((await api('POST', `/api/orders/${o.id}/ready`, { token: supplier })).status, 200);
  const job = (await api('GET', '/api/deliveries/available', { token: driver })).body.jobs.find((j) => j.id === o.id);
  assert.equal(job.collect_on_delivery, o.total - o.upfront_required);
});

test('credit: only within the company limit, counted as outstanding', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const { supplier: s, products } = await supplierByName(pharmacy, 'شركة الصحراء لتوزيع الأدوية');
  assert.equal(s.policy.allow_partial, false);
  assert.equal((await api('POST', '/api/orders', { token: pharmacy, body: { supplier_id: s.id, items: [{ product_id: products[0].id, qty: products[0].min_order_qty }], payment_terms: 'partial' } })).status, 400, 'not offered');

  const lantus = products.find((x) => x.sku === 'ML-LAN-100'); // 85 LYD each, limit 2000 LYD
  const big = await api('POST', '/api/orders', { token: pharmacy, body: { supplier_id: s.id, items: [{ product_id: lantus.id, qty: 30 }], payment_terms: 'credit' } });
  assert.equal(big.status, 409);
  assert.equal(big.body.details.code, 'credit_limit');

  const ok = await api('POST', '/api/orders', { token: pharmacy, body: { supplier_id: s.id, items: [{ product_id: lantus.id, qty: 10 }], payment_terms: 'credit' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.order.upfront_required, 0);
  const after = (await supplierByName(pharmacy, 'شركة الصحراء لتوزيع الأدوية')).supplier.credit;
  assert.equal(after.outstanding, 85000 + 1000);

  // Stock of a rejected checkout was not touched.
  const lantusNow = (await supplierByName(pharmacy, 'شركة الصحراء لتوزيع الأدوية')).products.find((x) => x.id === lantus.id);
  assert.equal(lantusNow.stock, lantus.stock - 10);
});

test('minimum order value and minimum quantity are enforced', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const { supplier: s, products } = await supplierByName(pharmacy, WADI); // min order 100 LYD
  const pan = products.find((x) => x.sku === 'NP-PAN-500');
  const small = await api('POST', '/api/orders', { token: pharmacy, body: { supplier_id: s.id, items: [{ product_id: pan.id, qty: 10 }], payment_terms: 'full' } });
  assert.equal(small.status, 400);
  assert.equal(small.body.details.code, 'min_order_value');
  const tooFew = await api('POST', '/api/orders', { token: pharmacy, body: { supplier_id: s.id, items: [{ product_id: pan.id, qty: 1 }], payment_terms: 'full' } });
  assert.match(tooFew.body.error, /Minimum order for/);
});

test('Excel import: preview, errors block unless skipped, upsert by code, hide missing', async () => {
  const supplier = await login('supplier@maa.test');
  const rows = [
    { 'رمز المنتج': 'NP-PAN-500', 'الاسم التجاري': 'Panadol', 'السعر': '4,75', 'الكمية المتوفرة': '٥٠٠' }, // update price+stock
    { 'رمز المنتج': 'NP-NEW-1', 'الاسم التجاري': 'Fucidin', 'السعر': '22', 'تبريد': 'لا' }, // new
    { 'رمز المنتج': 'NP-BAD', 'الاسم التجاري': 'Broken', 'السعر': 'abc' }, // error
  ];
  const preview = await api('POST', '/api/supplier/products/import', { token: supplier, body: { rows, dry_run: true } });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.summary, { created: 1, updated: 1, unchanged: 0, hidden: 0, errors: 1, rows: 3 });
  assert.equal(preview.body.errors[0].row, 4);
  assert.equal(preview.body.errors[0].code, 'bad_price');

  const refused = await api('POST', '/api/supplier/products/import', { token: supplier, body: { rows, dry_run: false } });
  assert.equal(refused.status, 422);
  let list = (await api('GET', '/api/supplier/products', { token: supplier })).body.products;
  assert.ok(!list.some((p) => p.sku === 'NP-NEW-1'), 'nothing saved when errors block');

  const applied = await api('POST', '/api/supplier/products/import', { token: supplier, body: { rows, dry_run: false, skip_errors: true, file_name: 'prices.xlsx' } });
  assert.equal(applied.body.applied, true);
  list = (await api('GET', '/api/supplier/products', { token: supplier })).body.products;
  const pan = list.find((p) => p.sku === 'NP-PAN-500');
  assert.equal(pan.price, 475);
  assert.equal(pan.stock, 500);
  assert.ok(list.find((p) => p.sku === 'NP-NEW-1').active);

  // Same file again with hide_missing: only the two listed products stay for sale.
  const hide = await api('POST', '/api/supplier/products/import', { token: supplier, body: { rows: rows.slice(0, 2), dry_run: false, hide_missing: true } });
  assert.equal(hide.body.summary.unchanged, 2);
  list = (await api('GET', '/api/supplier/products', { token: supplier })).body.products;
  assert.deepEqual(list.filter((p) => p.active).map((p) => p.sku).sort(), ['NP-NEW-1', 'NP-PAN-500']);

  const settings = (await api('GET', '/api/supplier/settings', { token: supplier })).body;
  assert.equal(settings.imports.length, 2);
  assert.equal(settings.imports[1].file_name, 'prices.xlsx');

  // A file without the required columns never hides anything.
  const bad = await api('POST', '/api/supplier/products/import', { token: supplier, body: { rows: [{ foo: 1 }], dry_run: false, hide_missing: true, skip_errors: true } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.details.errors[0].code, 'missing_columns');
});

test('API sync with a company key', async () => {
  const supplier2 = await login('supplier2@maa.test');
  const created = await api('POST', '/api/supplier/api-keys', { token: supplier2, body: { label: 'ERP' } });
  assert.match(created.body.key, /^maa_/);
  const key = created.body.key;

  assert.equal((await api('POST', '/api/v1/products/sync', { body: { products: [] } })).status, 401);
  const synced = await api('POST', '/api/v1/products/sync', {
    headers: { 'x-api-key': key }, body: { products: [{ sku: 'ML-ZYR-10', name: 'Zyrtec', price: 6.25, stock: 40 }] },
  });
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.deepEqual([synced.body.applied, synced.body.summary.updated], [true, 1]);
  const keys = (await api('GET', '/api/supplier/settings', { token: supplier2 })).body.api_keys;
  assert.ok(keys[0].last_used_at);

  await api('DELETE', `/api/supplier/api-keys/${created.body.id}`, { token: supplier2 });
  assert.equal((await api('POST', '/api/v1/products/sync', { headers: { 'x-api-key': key }, body: { products: [] } })).status, 401, 'revoked');
});

test('company payment settings are validated', async () => {
  const supplier = await login('supplier@maa.test');
  assert.equal((await api('PUT', '/api/supplier/settings', { token: supplier, body: {} })).status, 400, 'at least one option');
  const r = await api('PUT', '/api/supplier/settings', { token: supplier, body: { allow_full: true, allow_credit: true, credit_days: 45, credit_limit: 3000, min_order_value: 0 } });
  assert.deepEqual([r.body.policy.allow_partial, r.body.policy.credit_days, r.body.policy.credit_limit], [false, 45, 300000]);
});

test('new accounts must be verified/approved before trading', async () => {
  const reg = await api('POST', '/api/auth/register', {
    body: {
      role: 'pharmacy', name: 'New Owner', email: 'new@ph.test', phone: '+1', password: 'longenough1',
      organization: { name: 'New Pharmacy', license_no: 'X-1', address: '1 Road' },
    },
  });
  assert.equal(reg.status, 201);
  assert.equal((await api('GET', '/api/suppliers', { token: reg.body.token })).status, 403);
  const admin = await login('admin@maa.test');
  await api('POST', `/api/admin/organizations/${reg.body.user.organization.id}/verify`, { token: admin });
  assert.equal((await api('GET', '/api/suppliers', { token: reg.body.token })).status, 200);
});

test('roles are isolated', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const driver = await login('driver@maa.test');
  assert.equal((await api('POST', '/api/supplier/products', { token: pharmacy, body: { name: 'x', price: 1 } })).status, 403);
  assert.equal((await api('POST', '/api/supplier/products/import', { token: pharmacy, body: { rows: [] } })).status, 403);
  assert.equal((await api('POST', '/api/orders', { token: driver, body: { items: [] } })).status, 403);
  assert.equal((await api('GET', '/api/orders')).status, 401);
  assert.equal((await api('GET', '/api/admin/overview', { token: pharmacy })).status, 403);
});

const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).toString('base64');

test('barcode lookup finds a product across companies', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const { products } = (await api('GET', '/api/products?q=Actifed', { token: pharmacy })).body;
  const code = products[0].barcode;
  assert.match(code, /^2\d{12}$/);
  const found = (await api('GET', `/api/products?barcode=${code}`, { token: pharmacy })).body.products;
  assert.deepEqual(found.map((p) => p.name), ['Actifed Rhume']);
  assert.equal(found[0].image_url, 'img/products/actifed-rhume.jpg');
});

test('companies upload a product photo; anyone can load it', async () => {
  const supplier = await login('supplier@maa.test');
  const p = (await api('GET', '/api/supplier/products', { token: supplier })).body.products.find((x) => x.sku === 'NP-TAB-160');
  assert.equal((await api('PUT', `/api/supplier/products/${p.id}/image`, { token: supplier, body: { data_url: 'data:text/html;base64,PGI+' } })).status, 400);
  const up = await api('PUT', `/api/supplier/products/${p.id}/image`, { token: supplier, body: { data_url: JPEG } });
  assert.match(up.body.product.image_url, new RegExp(`^api/product-images/${p.id}\\?v=`));
  const img = await fetch(`${base}/api/product-images/${p.id}`);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await img.arrayBuffer()).byteLength, 9);
  const supplier2 = await login('supplier2@maa.test');
  assert.equal((await api('PUT', `/api/supplier/products/${p.id}/image`, { token: supplier2, body: { data_url: JPEG } })).status, 404, 'not their product');
  await api('DELETE', `/api/supplier/products/${p.id}/image`, { token: supplier });
  assert.equal((await fetch(`${base}/api/product-images/${p.id}`)).status, 404);
});

test('order by photo suggests only real catalogue products', async () => {
  const pharmacy = await login('pharmacy@maa.test');
  const { suppliers } = (await api('GET', '/api/suppliers', { token: pharmacy })).body;
  const sahara = suppliers.find((x) => x.name === 'شركة الصحراء لتوزيع الأدوية');
  const r = await api('POST', `/api/suppliers/${sahara.id}/recognize`, { token: pharmacy, body: { image: JPEG } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.matches.map((m) => [m.product.name, m.quantity]), [['Actifed Rhume', 12]]);
  assert.deepEqual(r.body.not_found, ['Fake', 'Tabuvan 160 mg']);
  assert.equal((await api('POST', `/api/suppliers/${sahara.id}/recognize`, { token: pharmacy, body: { image: 'nope' } })).status, 400);
  const driver = await login('driver@maa.test');
  assert.equal((await api('POST', `/api/suppliers/${sahara.id}/recognize`, { token: driver, body: { image: JPEG } })).status, 403);
});

test('import accepts barcodes and refuses bad ones', async () => {
  const supplier2 = await login('supplier2@maa.test');
  const r = await api('POST', '/api/supplier/products/import', { token: supplier2, body: { dry_run: true, rows: [
    { sku: 'ML-ZYR-10', name: 'Zyrtec', price: '6', barcode: '٦٢٢١٠٠٠٠٠٠٠٠١' },
    { sku: 'ML-CON-5', name: 'Concor', price: '8.5', barcode: '12' },
  ] } });
  assert.equal(r.body.update[0].changes.barcode, '6221000000001');
  assert.equal(r.body.errors[0].code, 'bad_barcode');
});
