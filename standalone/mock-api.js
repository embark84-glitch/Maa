'use strict';
/*
 * In-browser stand-in for the Maa server, used only by the standalone demo
 * (maa-demo.html). It answers the same /api routes as src/routes/*, keeps data
 * in localStorage, and intercepts window.fetch so public/app.js runs unchanged.
 */
(function () {
  const KEY = 'maa.demo.db.v2'; // bump when the demo data changes shape or language
  const CONFIG = { currency: 'LYD', deliveryFee: 1000 };
  const ACTIVE = ['placed', 'accepted', 'ready_for_pickup', 'assigned', 'picked_up'];

  function fresh() {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const orgs = [
      { id: 1, type: 'pharmacy', name: 'صيدلية الشفاء', license_no: 'PH-10293', address: 'شارع عمر المختار', city: 'طرابلس', phone: '+218 91 000 0001', verified: true, created_at: now },
      { id: 2, type: 'supplier', name: 'شركة الوادي للمستلزمات الطبية', license_no: 'SUP-5521', address: 'طريق قرقارش، مخزن 7', city: 'طرابلس', phone: '+218 92 000 0001', verified: true, created_at: now },
      { id: 3, type: 'supplier', name: 'شركة الصحراء لتوزيع الأدوية', license_no: 'SUP-7780', address: 'المنطقة الحرة، مربع 12', city: 'مصراتة', phone: '+218 92 000 0002', verified: true, created_at: now },
    ];
    const u = (id, name, email, role, org_id, phone, vehicle = null) => ({ id, name, email, role, org_id, phone, vehicle, approved: true, password: 'password123', created_at: now });
    const users = [
      u(1, 'مدير المنصة', 'admin@maa.test', 'admin', null, '+218 21 000 0000'),
      u(2, 'سارة (صيدلانية)', 'pharmacy@maa.test', 'pharmacy', 1, '+218 91 000 0001'),
      u(3, 'عمر (الوادي)', 'supplier@maa.test', 'supplier', 2, '+218 92 000 0001'),
      u(4, 'لينا (الصحراء)', 'supplier2@maa.test', 'supplier', 3, '+218 92 000 0002'),
      u(5, 'يوسف (سائق)', 'driver@maa.test', 'driver', null, '+218 94 000 0001', 'دراجة نارية'),
    ];
    const rows = [
      [2, 'Panadol', 'Paracetamol', 'مسكنات', 'أقراص', '500 mg', 'علبة 24', 'NP-PAN-500', 450, 1200, 10, false],
      [2, 'Brufen', 'Ibuprofen', 'مسكنات', 'أقراص', '400 mg', 'علبة 30', 'NP-BRU-400', 675, 800, 5, false],
      [2, 'Augmentin', 'Amoxicillin + Clavulanate', 'مضادات حيوية', 'أقراص', '1 g', 'علبة 14', 'NP-AUG-1G', 1800, 300, 2, false],
      [2, 'Ventolin Inhaler', 'Salbutamol', 'الجهاز التنفسي', 'بخاخ', '100 mcg', '200 جرعة', 'NP-VEN-100', 1250, 150, 1, false],
      [2, 'Glucophage', 'Metformin', 'السكري', 'أقراص', '850 mg', 'علبة 30', 'NP-GLU-850', 525, 600, 5, false],
      [3, 'Lantus SoloStar', 'Insulin glargine', 'السكري', 'قلم', '100 IU/ml', '5 أقلام', 'ML-LAN-100', 8500, 60, 1, true],
      [3, 'Concor', 'Bisoprolol', 'القلب والضغط', 'أقراص', '5 mg', 'علبة 30', 'ML-CON-5', 850, 400, 3, false],
      [3, 'Nexium', 'Esomeprazole', 'الجهاز الهضمي', 'كبسولات', '40 mg', 'علبة 14', 'ML-NEX-40', 1500, 250, 2, false],
      [3, 'Zyrtec', 'Cetirizine', 'الحساسية', 'أقراص', '10 mg', 'علبة 20', 'ML-ZYR-10', 600, 500, 5, false],
      [3, 'Panadol', 'Paracetamol', 'مسكنات', 'أقراص', '500 mg', 'علبة 24', 'ML-PAN-500', 425, 900, 10, false],
    ];
    const products = rows.map((r, i) => ({
      id: i + 1, supplier_id: r[0], name: r[1], generic_name: r[2], category: r[3], form: r[4], strength: r[5],
      pack_size: r[6], sku: r[7], price: r[8], stock: r[9], min_order_qty: r[10], cold_chain: r[11], active: true,
    }));
    return { orgs, users, products, orders: [], seq: { org: 3, user: 5, product: products.length, order: 0 } };
  }

  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { db = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage unavailable: keep in memory */ } };
  window.maaResetDemo = () => { db = fresh(); save(); try { localStorage.removeItem('maa.token'); localStorage.removeItem('maa.cart'); } catch { /* ignore */ } location.hash = ''; location.reload(); };

  class E extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const org = (id) => db.orgs.find((o) => o.id === id);
  const userById = (id) => db.users.find((u) => u.id === id);
  const prodCols = (p) => { const { ...c } = p; return c; };

  function publicUser(u) {
    const o = u.org_id ? org(u.org_id) : null;
    return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, vehicle: u.vehicle, approved: u.approved, organization: o && clone(o) };
  }

  function need(user, ...roles) {
    if (!user) throw new E(401, 'Login required');
    if (roles.length && !roles.includes(user.role)) throw new E(403, 'Not allowed for your role');
    if (!user.approved) throw new E(403, 'Your account is awaiting approval');
    if (user.org_id && !org(user.org_id).verified) throw new E(403, 'Your organization is awaiting license verification');
  }
  const str = (v, f, req = true) => { const t = typeof v === 'string' ? v.trim() : ''; if (req && !t) throw new E(400, `${f} is required`); return t || null; };
  const int = (v, f, min = 0) => { const n = Number(v); if (v === '' || v == null || !Number.isInteger(n) || n < min) throw new E(400, `${f} must be a whole number of at least ${min}`); return n; };

  function addEvent(o, status, actor, note = null) {
    const a = actor && userById(actor);
    o.events.push({ status, note, created_at: nowStr(), actor_name: a?.name ?? null, actor_role: a?.role ?? null });
  }
  function setStatus(o, from, to, actor, note, extra = {}) {
    if (!from.includes(o.status)) throw new E(409, `Order cannot move to "${to}" from its current status`);
    o.status = to; o.updated_at = nowStr(); Object.assign(o, extra); addEvent(o, to, actor, note);
  }
  function restock(o) { for (const it of o.items) { const p = db.products.find((x) => x.id === it.product_id); if (p) p.stock += it.qty; } }

  function view(o, user) {
    const ph = org(o.pharmacy_id); const su = org(o.supplier_id); const d = o.driver_id && userById(o.driver_id);
    const canSee = user.role === 'admin' || (user.role === 'pharmacy' && o.pharmacy_id === user.org_id)
      || (user.role === 'supplier' && o.supplier_id === user.org_id)
      || (user.role === 'driver' && (o.driver_id === user.id || o.status === 'ready_for_pickup'));
    if (!canSee) return null;
    const out = {
      ...clone(o), pharmacy_name: ph.name, pharmacy_phone: ph.phone, pharmacy_city: ph.city,
      supplier_name: su.name, supplier_address: su.address, supplier_phone: su.phone,
      driver_name: d?.name ?? null, driver_phone: d?.phone ?? null, driver_vehicle: d?.vehicle ?? null,
      item_count: o.items.length,
    };
    if (!(user.role === 'pharmacy' || user.role === 'admin')) delete out.delivery_code;
    return out;
  }
  const findOrder = (id) => db.orders.find((o) => o.id === Number(id));

  // [method, pattern, handler(ctx)] — ctx = { user, body, query, params }
  const routes = [
    ['GET', '/api/config', () => CONFIG],

    ['POST', '/api/auth/login', ({ body }) => {
      const u = db.users.find((x) => x.email === String(body.email || '').trim().toLowerCase());
      if (!u || u.password !== body.password) throw new E(401, 'Wrong email or password');
      return { token: String(u.id), user: publicUser(u) };
    }],
    ['POST', '/api/auth/register', ({ body }) => {
      if (!['pharmacy', 'supplier', 'driver'].includes(body.role)) throw new E(400, 'role must be pharmacy, supplier or driver');
      const email = str(body.email, 'email').toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new E(400, 'email is invalid');
      if (db.users.some((u) => u.email === email)) throw new E(409, 'An account with this email already exists');
      if (String(body.password || '').length < 8) throw new E(400, 'password must be at least 8 characters');
      let org_id = null;
      if (body.role !== 'driver') {
        const o = body.organization || {};
        org_id = ++db.seq.org;
        db.orgs.push({ id: org_id, type: body.role, name: str(o.name, 'organization.name'), license_no: str(o.license_no, 'organization.license_no'),
          address: str(o.address, 'organization.address'), city: str(o.city, 'city', false), phone: str(body.phone, 'phone'), verified: false, created_at: nowStr() });
      }
      const u = { id: ++db.seq.user, name: str(body.name, 'name'), email, phone: str(body.phone, 'phone'), role: body.role, org_id,
        vehicle: body.role === 'driver' ? str(body.vehicle, 'vehicle', false) : null, approved: body.role !== 'driver', password: body.password, created_at: nowStr() };
      db.users.push(u);
      return { status: 201, body: { token: String(u.id), user: publicUser(u) } };
    }],
    ['GET', '/api/me', ({ user }) => { if (!user) throw new E(401, 'Login required'); return { user: publicUser(user) }; }],

    ['GET', '/api/suppliers', ({ user }) => {
      need(user, 'pharmacy', 'admin');
      return { suppliers: db.orgs.filter((o) => o.type === 'supplier' && o.verified).sort((a, b) => a.name.localeCompare(b.name))
        .map((o) => ({ id: o.id, name: o.name, city: o.city, phone: o.phone, product_count: db.products.filter((p) => p.supplier_id === o.id && p.active).length })) };
    }],
    ['GET', '/api/products', ({ user, query }) => {
      need(user, 'pharmacy', 'admin');
      const live = db.products.filter((p) => p.active && org(p.supplier_id).verified);
      const q = (query.get('q') || '').trim().toLowerCase();
      const sup = query.get('supplier'); const cat = query.get('category');
      const products = live.filter((p) => (!q || [p.name, p.generic_name, p.sku].some((x) => (x || '').toLowerCase().includes(q)))
        && (!sup || p.supplier_id === Number(sup)) && (!cat || p.category === cat))
        .sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ ...prodCols(p), supplier_name: org(p.supplier_id).name }));
      return { products, categories: [...new Set(live.map((p) => p.category).filter(Boolean))].sort() };
    }],
    ['GET', '/api/supplier/products', ({ user }) => {
      need(user, 'supplier');
      return { products: db.products.filter((p) => p.supplier_id === user.org_id).sort((a, b) => a.name.localeCompare(b.name)).map(prodCols) };
    }],
    ['POST', '/api/supplier/products', ({ user, body }) => {
      need(user, 'supplier');
      const p = { id: ++db.seq.product, supplier_id: user.org_id, ...readProduct(body, false) };
      db.products.push(p);
      return { status: 201, body: { product: prodCols(p) } };
    }],
    ['PATCH', '/api/supplier/products/:id', ({ user, body, params }) => {
      need(user, 'supplier');
      const p = db.products.find((x) => x.id === Number(params.id) && x.supplier_id === user.org_id);
      if (!p) throw new E(404, 'Product not found');
      Object.assign(p, readProduct(body, true));
      return { product: prodCols(p) };
    }],

    ['POST', '/api/orders', ({ user, body }) => {
      need(user, 'pharmacy');
      if (!Array.isArray(body.items) || !body.items.length) throw new E(400, 'items must be a non-empty list');
      const pay = body.payment_method ?? 'cash_on_delivery';
      if (!['cash_on_delivery', 'credit'].includes(pay)) throw new E(400, 'payment_method must be cash_on_delivery or credit');
      const qty = new Map();
      for (const it of body.items) { const id = int(it.product_id, 'product_id', 1); qty.set(id, (qty.get(id) || 0) + int(it.qty, 'qty', 1)); }
      // Validate everything first so a failure changes nothing (same as the server's transaction).
      const bySup = new Map();
      for (const [pid, q] of qty) {
        const p = db.products.find((x) => x.id === pid && x.active && org(x.supplier_id).verified);
        if (!p) throw new E(400, `Product ${pid} is not available`);
        if (q < p.min_order_qty) throw new E(400, `Minimum order for ${p.name} is ${p.min_order_qty}`);
        if (p.stock < q) throw new E(409, `Not enough stock for ${p.name} (available: ${p.stock})`);
        if (!bySup.has(p.supplier_id)) bySup.set(p.supplier_id, []);
        bySup.get(p.supplier_id).push({ p, q });
      }
      const ph = org(user.org_id);
      const created = [];
      for (const [sid, lines] of bySup) {
        const items = lines.map(({ p, q }) => {
          p.stock -= q;
          return { product_id: p.id, name: [p.name, p.strength, p.form, p.pack_size].filter(Boolean).join(' · '), unit_price: p.price, qty: q, line_total: p.price * q };
        });
        const subtotal = items.reduce((s, i) => s + i.line_total, 0);
        const o = { id: ++db.seq.order, pharmacy_id: ph.id, supplier_id: sid, placed_by: user.id, status: 'placed', subtotal,
          delivery_fee: CONFIG.deliveryFee, total: subtotal + CONFIG.deliveryFee, payment_method: pay, notes: str(body.notes, 'notes', false),
          delivery_address: [ph.address, ph.city].filter(Boolean).join(', '), delivery_code: String(Math.floor(Math.random() * 1e6)).padStart(6, '0'),
          driver_id: null, created_at: nowStr(), updated_at: nowStr(), items, events: [] };
        addEvent(o, 'placed', user.id);
        db.orders.push(o); created.push(o);
      }
      return { status: 201, body: { orders: created.map((o) => view(o, user)) } };
    }],
    ['GET', '/api/orders', ({ user, query }) => {
      need(user);
      const st = (query.get('status') || '').split(',').filter(Boolean);
      const mine = db.orders.filter((o) => (user.role === 'pharmacy' ? o.pharmacy_id === user.org_id
        : user.role === 'supplier' ? o.supplier_id === user.org_id : user.role === 'driver' ? o.driver_id === user.id : true)
        && (!st.length || st.includes(o.status)));
      return { orders: mine.sort((a, b) => b.id - a.id).map((o) => view(o, user)) };
    }],
    ['GET', '/api/orders/:id', ({ user, params }) => {
      need(user);
      const o = findOrder(params.id); const v = o && view(o, user);
      if (!v) throw new E(404, 'Order not found');
      return { order: v };
    }],
    ['POST', '/api/orders/:id/:act', ({ user, body, params }) => {
      const { act } = params;
      const side = act === 'cancel' ? user?.role : 'supplier';
      need(user, ...(act === 'cancel' ? ['pharmacy', 'supplier'] : ['supplier']));
      const o = findOrder(params.id);
      if (!o || o[`${side}_id`] !== user.org_id) throw new E(404, 'Order not found');
      if (act === 'accept') setStatus(o, ['placed'], 'accepted', user.id, str(body.note, 'note', false));
      else if (act === 'reject') { setStatus(o, ['placed'], 'rejected', user.id, str(body.reason, 'reason')); restock(o); }
      else if (act === 'ready') setStatus(o, ['accepted'], 'ready_for_pickup', user.id, 'Packed and waiting for a driver');
      else if (act === 'cancel') {
        setStatus(o, side === 'pharmacy' ? ['placed'] : ['accepted', 'ready_for_pickup'], 'cancelled', user.id, str(body.reason, 'reason', false));
        restock(o);
      } else throw new E(404, 'Not found');
      return { order: view(o, user) };
    }],

    ['GET', '/api/deliveries/available', ({ user }) => {
      need(user, 'driver');
      return { jobs: db.orders.filter((o) => o.status === 'ready_for_pickup').map((o) => {
        const su = org(o.supplier_id); const ph = org(o.pharmacy_id);
        return { id: o.id, total: o.total, delivery_fee: o.delivery_fee, payment_method: o.payment_method, updated_at: o.updated_at,
          supplier_name: su.name, pickup_address: su.address, pickup_city: su.city, pharmacy_name: ph.name, delivery_address: o.delivery_address,
          item_count: o.items.length, cold_chain: o.items.some((i) => db.products.find((p) => p.id === i.product_id)?.cold_chain) };
      }) };
    }],
    ['POST', '/api/deliveries/:id/:act', ({ user, body, params }) => {
      need(user, 'driver');
      const o = findOrder(params.id);
      if (!o) throw new E(404, 'Delivery not found');
      if (params.act === 'claim') {
        setStatus(o, ['ready_for_pickup'], 'assigned', user.id, `Driver ${user.name} assigned`, { driver_id: user.id });
        return { order: view(o, user) };
      }
      if (o.driver_id !== user.id) throw new E(404, 'Delivery not found');
      if (params.act === 'release') { setStatus(o, ['assigned'], 'ready_for_pickup', user.id, 'Driver released the job', { driver_id: null }); return { ok: true }; }
      if (params.act === 'pickup') setStatus(o, ['assigned'], 'picked_up', user.id, 'Collected from supplier, on the way');
      else if (params.act === 'deliver') {
        if (o.status !== 'picked_up') throw new E(409, 'Order has not been picked up yet');
        if (str(body.code, 'code') !== o.delivery_code) throw new E(400, 'Delivery code is incorrect');
        setStatus(o, ['picked_up'], 'delivered', user.id, str(body.note, 'note', false) || 'Handed over to pharmacy');
      } else throw new E(404, 'Not found');
      return { order: view(o, user) };
    }],

    ['GET', '/api/admin/overview', ({ user }) => {
      need(user, 'admin');
      const delivered = db.orders.filter((o) => o.status === 'delivered');
      return {
        organizations: clone(db.orgs).sort((a, b) => a.verified - b.verified),
        drivers: db.users.filter((u) => u.role === 'driver').map(({ id, name, email, phone, vehicle, approved, created_at }) => ({ id, name, email, phone, vehicle, approved, created_at }))
          .sort((a, b) => a.approved - b.approved),
        stats: { orders: db.orders.length, delivered: delivered.length, delivered_value: delivered.reduce((s, o) => s + o.total, 0),
          in_progress: db.orders.filter((o) => ACTIVE.includes(o.status)).length },
      };
    }],
    ['POST', '/api/admin/organizations/:id/verify', ({ user, body, params }) => {
      need(user, 'admin');
      const o = org(Number(params.id)); if (!o) throw new E(404, 'Organization not found');
      o.verified = body.verified !== false; return { ok: true };
    }],
    ['POST', '/api/admin/drivers/:id/approve', ({ user, body, params }) => {
      need(user, 'admin');
      const d = db.users.find((u) => u.id === Number(params.id) && u.role === 'driver'); if (!d) throw new E(404, 'Driver not found');
      d.approved = body.approved !== false; return { ok: true };
    }],
  ];

  function readProduct(b, partial) {
    const out = {};
    const take = (k, fn) => { if (partial && b[k] === undefined) return; out[k] = fn(b[k]); };
    take('name', (x) => str(x, 'name'));
    for (const k of ['generic_name', 'category', 'form', 'strength', 'pack_size', 'sku']) take(k, (x) => str(x, k, false));
    take('price', (x) => { const n = Number(x); if (x === '' || x == null || !(n >= 0)) throw new E(400, 'price must be a positive amount'); return Math.round(n * 100); });
    take('stock', (x) => int(x ?? 0, 'stock', 0));
    take('min_order_qty', (x) => int(x ?? 1, 'min_order_qty', 1));
    take('cold_chain', (x) => !!x);
    take('active', (x) => (x === undefined ? true : !!x));
    return out;
  }

  // Read-only hooks for the demo guide in app.js: who to sign in as, and how far the current order has got.
  const TERMINAL = ['delivered', 'rejected', 'cancelled'];
  window.maaDemo = {
    accounts: [
      { email: 'pharmacy@maa.test', label: 'Pharmacy' },
      { email: 'supplier@maa.test', label: 'Al Wadi (supplier)' },
      { email: 'supplier2@maa.test', label: 'Sahara (supplier)' },
      { email: 'driver@maa.test', label: 'Driver' },
      { email: 'admin@maa.test', label: 'Admin' },
    ],
    password: 'password123',
    progress() {
      const shape = (o) => o && ({
        id: o.id, status: o.status, code: o.delivery_code,
        supplierEmail: db.users.find((u) => u.role === 'supplier' && u.org_id === o.supplier_id)?.email,
      });
      const active = db.orders.filter((o) => !TERMINAL.includes(o.status)).sort((a, b) => a.id - b.id)[0];
      if (active) return { state: 'active', order: shape(active) };
      const newest = [...db.orders].sort((a, b) => b.id - a.id)[0];
      if (newest && newest.status === 'delivered') return { state: 'done', order: shape(newest) };
      return { state: 'start', order: null };
    },
  };

  const compiled = routes.map(([m, p, h]) => [m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), h]);
  const realFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const auth = new Headers(init.headers || {}).get('authorization') || '';
    const user = auth.startsWith('Bearer ') ? userById(Number(auth.slice(7))) : null;
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { return reply(400, { error: 'Invalid JSON' }); }
    for (const [m, re, h] of compiled) {
      const match = m === method && url.pathname.match(re);
      if (!match) continue;
      try {
        const out = h({ user, body, query: url.searchParams, params: match.groups || {} });
        save();
        return out && out.status && out.body ? reply(out.status, out.body) : reply(200, out);
      } catch (e) {
        if (!(e instanceof E)) console.error(e);
        return reply(e.status || 500, { error: e instanceof E ? e.message : 'Internal error' });
      }
    }
    return reply(404, { error: 'Not found' });
  };
})();
