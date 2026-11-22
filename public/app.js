'use strict';
/* Maa web client: one page, hash routes, a view per role. No build step. */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  token: localGet('maa.token'),
  user: null,
  config: { currency: 'LYD', deliveryFee: 0 },
  cart: JSON.parse(localGet('maa.cart') || '{}'), // productId -> { product, qty }
  refreshTimer: null,
};

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }
const saveCart = () => localSet('maa.cart', JSON.stringify(state.cart));

const money = (minor) => new Intl.NumberFormat(undefined, { style: 'currency', currency: state.config.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((minor || 0) / 100);
const when = (iso) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const STATUS_LABEL = {
  placed: 'Awaiting supplier', accepted: 'Being prepared', rejected: 'Rejected', cancelled: 'Cancelled',
  ready_for_pickup: 'Ready for pickup', assigned: 'Driver assigned', picked_up: 'On the way', delivered: 'Delivered',
};
const statusPill = (s) => `<span class="status ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(state.token && { authorization: `Bearer ${state.token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, 3000);
}

/** Wrap an async click handler: disable the button and surface errors. */
function action(fn) {
  return async (ev) => {
    const btn = ev?.currentTarget;
    if (btn) btn.disabled = true;
    try { await fn(ev); } catch (e) { toast(e.message, true); } finally { if (btn && btn.isConnected) btn.disabled = false; }
  };
}

function logout() {
  state.token = null; state.user = null; state.cart = {};
  localSet('maa.token', null); saveCart();
  location.hash = '#login';
  render();
}

// ---------------------------------------------------------------- routing

const NAV = {
  pharmacy: [['#catalog', 'Catalog'], ['#cart', 'Cart'], ['#orders', 'My orders']],
  supplier: [['#incoming', 'Orders'], ['#products', 'My products']],
  driver: [['#jobs', 'Available jobs'], ['#my-deliveries', 'My deliveries']],
  admin: [['#admin', 'Verification'], ['#orders', 'All orders']],
};
const HOME = { pharmacy: '#catalog', supplier: '#incoming', driver: '#jobs', admin: '#admin' };

async function render() {
  clearInterval(state.refreshTimer);
  const view = $('#view');
  // Routes are plain '#name' or '#order-12' so they survive being shared as a link.
  const h = location.hash.replace(/^#\/?/, '');
  const m = h.match(/^order-(\d+)$/);
  const [route, param] = m ? ['order', m[1]] : [h, undefined];

  if (!state.user) {
    $('#nav').innerHTML = ''; $('#who').innerHTML = '';
    return route === 'register' ? renderRegister(view) : renderLogin(view);
  }

  const u = state.user;
  const cartCount = Object.keys(state.cart).length;
  $('#nav').innerHTML = (NAV[u.role] || []).map(([href, label]) =>
    `<a href="${href}" class="${(location.hash === href || (href === '#orders' && /^#order-/.test(location.hash))) ? 'active' : ''}">${label}${href === '#cart' && cartCount ? `<span class="cart-badge">${cartCount}</span>` : ''}</a>`).join('');
  $('#who').innerHTML = `<span class="name muted">${esc(u.organization?.name || u.name)}</span><button class="link" id="logout">Log out</button>`;
  $('#logout').onclick = logout;

  const pending = (u.organization && !u.organization.verified) || !u.approved;
  if (pending) return renderPending(view);

  const routes = {
    catalog: renderCatalog, cart: renderCart, orders: renderOrders, order: renderOrderDetail,
    incoming: renderOrders, products: renderProducts,
    jobs: renderJobs, 'my-deliveries': renderOrders,
    admin: renderAdmin,
  };
  const fn = routes[route];
  if (!fn) { location.hash = HOME[u.role]; return; }
  view.innerHTML = '<p class="muted">Loading…</p>';
  try { await fn(view, param); } catch (e) { view.innerHTML = `<div class="card">${esc(e.message)}</div>`; }
}

window.addEventListener('hashchange', render);

// ---------------------------------------------------------------- auth

const DEMO = [
  ['Pharmacy', 'pharmacy@maa.test'], ['Supplier', 'supplier@maa.test'],
  ['Driver', 'driver@maa.test'], ['Admin', 'admin@maa.test'],
];

async function signedIn({ token, user }) {
  state.token = token; state.user = user;
  localSet('maa.token', token);
  location.hash = HOME[user.role];
  render();
}

function renderLogin(view) {
  view.innerHTML = `
    <div class="auth stack">
      <div class="card stack">
        <h1>Sign in</h1>
        <form id="f" class="stack">
          <label>Email<input name="email" type="email" autocomplete="username" required></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
          <button class="primary" type="submit">Sign in</button>
        </form>
        <p class="small muted">New pharmacy, supplier company or driver? <a href="#register">Create an account</a></p>
      </div>
      <div class="card stack demo">
        <h2>Demo accounts</h2>
        <p class="small muted">Run <code>npm run seed</code> first. Password: <code>password123</code></p>
        <div class="row">${DEMO.map(([l, e]) => `<button data-email="${e}">${l}</button>`).join('')}</div>
      </div>
    </div>`;
  const f = $('#f', view);
  f.onsubmit = action(async (ev) => {
    ev.preventDefault();
    signedIn(await api('POST', '/api/auth/login', Object.fromEntries(new FormData(f))));
  });
  view.querySelectorAll('[data-email]').forEach((b) => {
    b.onclick = action(async () => signedIn(await api('POST', '/api/auth/login', { email: b.dataset.email, password: 'password123' })));
  });
}

function renderRegister(view) {
  view.innerHTML = `
    <div class="auth card stack">
      <h1>Create an account</h1>
      <form id="f" class="stack">
        <label>I am a
          <select name="role" id="role">
            <option value="pharmacy">Pharmacy (buyer)</option>
            <option value="supplier">Pharmaceutical company / distributor (seller)</option>
            <option value="driver">Delivery driver</option>
          </select>
        </label>
        <label>Your name<input name="name" required></label>
        <label>Email<input name="email" type="email" required></label>
        <label>Phone<input name="phone" type="tel" required></label>
        <label>Password (min 8 characters)<input name="password" type="password" minlength="8" required></label>
        <div id="org" class="stack">
          <label>Business name<input name="org_name" required></label>
          <label>License number<input name="license_no" required></label>
          <label>Address<input name="address" required></label>
          <label>City<input name="city"></label>
        </div>
        <div id="veh" hidden><label>Vehicle<input name="vehicle" placeholder="e.g. Motorbike, Van"></label></div>
        <p class="small muted">Licenses are checked by Maa before you can buy or sell.</p>
        <button class="primary" type="submit">Create account</button>
      </form>
      <p class="small"><a href="#login">Back to sign in</a></p>
    </div>`;
  const f = $('#f', view);
  const sync = () => {
    const driver = $('#role', view).value === 'driver';
    $('#org', view).hidden = driver;
    $('#veh', view).hidden = !driver;
    $('#org', view).querySelectorAll('input[name=org_name], input[name=license_no], input[name=address]').forEach((i) => { i.required = !driver; });
  };
  $('#role', view).onchange = sync;
  f.onsubmit = action(async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const body = { role: d.role, name: d.name, email: d.email, phone: d.phone, password: d.password, vehicle: d.vehicle };
    if (d.role !== 'driver') body.organization = { name: d.org_name, license_no: d.license_no, address: d.address, city: d.city };
    signedIn(await api('POST', '/api/auth/register', body));
  });
}

function renderPending(view) {
  const u = state.user;
  view.innerHTML = `
    <div class="auth card stack">
      <h1>Almost there</h1>
      <p>${u.role === 'driver'
        ? 'Your driver account is waiting for approval by the Maa team.'
        : `<strong>${esc(u.organization.name)}</strong> is waiting for license verification (license ${esc(u.organization.license_no)}).`}</p>
      <p class="muted small">We'll unlock ordering and deliveries as soon as it's approved.</p>
      <button id="check">Check again</button>
    </div>`;
  $('#check', view).onclick = action(async () => {
    state.user = (await api('GET', '/api/me')).user;
    render();
  });
}

// ---------------------------------------------------------------- pharmacy

async function renderCatalog(view) {
  const params = new URLSearchParams(renderCatalog.filters || {});
  const [{ products, categories }, { suppliers }] = await Promise.all([
    api('GET', `/api/products?${params}`), api('GET', '/api/suppliers'),
  ]);
  const f = renderCatalog.filters || {};
  view.innerHTML = `
    <div class="row spread"><h1>Order from suppliers</h1></div>
    <form id="filters" class="row" style="margin-bottom:1rem">
      <input name="q" placeholder="Search by brand, generic name or SKU" value="${esc(f.q || '')}" style="flex:2;min-width:200px">
      <select name="category" style="flex:1;min-width:140px"><option value="">All categories</option>
        ${categories.map((c) => `<option ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select name="supplier" style="flex:1;min-width:160px"><option value="">All suppliers</option>
        ${suppliers.map((s) => `<option value="${s.id}" ${String(f.supplier) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <button type="submit">Search</button>
    </form>
    ${products.length ? `<div class="grid">${products.map(productCard).join('')}</div>` : '<div class="card empty">No products match.</div>'}`;
  $('#filters', view).onsubmit = (ev) => {
    ev.preventDefault();
    renderCatalog.filters = Object.fromEntries([...new FormData(ev.target)].filter(([, v]) => v));
    render();
  };
  view.querySelectorAll('[data-add]').forEach((btn) => {
    btn.onclick = () => {
      const p = products.find((x) => x.id === Number(btn.dataset.add));
      const qty = Number(btn.parentElement.querySelector('input').value);
      if (!Number.isInteger(qty) || qty < p.min_order_qty) return toast(`Minimum order is ${p.min_order_qty}`, true);
      const prev = state.cart[p.id]?.qty || 0;
      if (prev + qty > p.stock) return toast(`Only ${p.stock} in stock`, true);
      state.cart[p.id] = { product: p, qty: prev + qty };
      saveCart();
      toast(`Added ${qty} × ${p.name}`);
      render();
    };
  });
}

function productCard(p) {
  const inCart = state.cart[p.id]?.qty;
  return `
    <div class="card product stack">
      <div>
        <div class="name">${esc(p.name)} <span class="muted">${esc(p.strength || '')}</span></div>
        <div class="small muted">${esc([p.generic_name, p.form, p.pack_size].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="row small">
        ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
        ${p.cold_chain ? '<span class="tag cold">Cold chain</span>' : ''}
      </div>
      <div class="small">Sold by <strong>${esc(p.supplier_name)}</strong></div>
      <div class="row spread">
        <span class="price">${money(p.price)}</span>
        <span class="small muted">${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'} · min ${p.min_order_qty}</span>
      </div>
      <div class="row">
        <input class="qty" type="number" min="${p.min_order_qty}" value="${p.min_order_qty}" aria-label="Quantity">
        <button class="primary" data-add="${p.id}" ${p.stock < p.min_order_qty ? 'disabled' : ''}>Add to cart</button>
      </div>
      ${inCart ? `<div class="small muted">${inCart} in cart</div>` : ''}
    </div>`;
}

function renderCart(view) {
  const lines = Object.values(state.cart);
  if (!lines.length) {
    view.innerHTML = '<h1>Cart</h1><div class="card empty">Your cart is empty. <a href="#catalog">Browse the catalog</a></div>';
    return;
  }
  const groups = {};
  for (const l of lines) (groups[l.product.supplier_id] ||= { name: l.product.supplier_name, lines: [] }).lines.push(l);
  const groupList = Object.values(groups);
  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const fees = groupList.length * state.config.deliveryFee;

  view.innerHTML = `
    <h1>Cart</h1>
    <div class="stack">
      ${groupList.map((g) => `
        <div class="card">
          <h2>${esc(g.name)}</h2>
          <div class="table-wrap"><table>
            <tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr>
            ${g.lines.map((l) => `
              <tr>
                <td>${esc(l.product.name)} <span class="muted small">${esc(l.product.strength || '')} ${esc(l.product.pack_size || '')}</span></td>
                <td>${money(l.product.price)}</td>
                <td><input class="qty" type="number" min="${l.product.min_order_qty}" value="${l.qty}" data-qty="${l.product.id}"></td>
                <td>${money(l.product.price * l.qty)}</td>
                <td><button class="link danger" data-remove="${l.product.id}">Remove</button></td>
              </tr>`).join('')}
          </table></div>
          <p class="small muted">Delivered as a separate shipment · delivery ${money(state.config.deliveryFee)}</p>
        </div>`).join('')}
      <div class="card stack">
        <div class="row spread"><span>Products</span><span>${money(subtotal)}</span></div>
        <div class="row spread"><span>Delivery (${groupList.length} shipment${groupList.length > 1 ? 's' : ''})</span><span>${money(fees)}</span></div>
        <div class="row spread"><strong>Total</strong><strong>${money(subtotal + fees)}</strong></div>
        <label>Payment
          <select id="pay">
            <option value="cash_on_delivery">Cash on delivery</option>
            <option value="credit">Supplier credit / invoice</option>
          </select>
        </label>
        <label>Notes for suppliers (optional)<textarea id="notes" rows="2" maxlength="500"></textarea></label>
        <button class="primary" id="place">Place order</button>
      </div>
    </div>`;

  view.querySelectorAll('[data-qty]').forEach((inp) => {
    inp.onchange = () => {
      const l = state.cart[inp.dataset.qty];
      const q = Number(inp.value);
      if (!Number.isInteger(q) || q < l.product.min_order_qty) { toast(`Minimum order is ${l.product.min_order_qty}`, true); inp.value = l.qty; return; }
      l.qty = q; saveCart(); render();
    };
  });
  view.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = () => { delete state.cart[b.dataset.remove]; saveCart(); render(); };
  });
  $('#place', view).onclick = action(async () => {
    const { orders } = await api('POST', '/api/orders', {
      items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty })),
      payment_method: $('#pay', view).value,
      notes: $('#notes', view).value || undefined,
    });
    state.cart = {}; saveCart();
    toast(`${orders.length} order${orders.length > 1 ? 's' : ''} placed`);
    location.hash = orders.length === 1 ? `#order-${orders[0].id}` : '#orders';
  });
}

// ---------------------------------------------------------------- shared order views

const ORDER_TABS = {
  pharmacy: [['Active', 'placed,accepted,ready_for_pickup,assigned,picked_up'], ['Delivered', 'delivered'], ['Closed', 'rejected,cancelled'], ['All', '']],
  supplier: [['New', 'placed'], ['To pack', 'accepted'], ['Awaiting driver', 'ready_for_pickup'], ['In transit', 'assigned,picked_up'], ['Done', 'delivered,rejected,cancelled'], ['All', '']],
  driver: [['Current', 'assigned,picked_up'], ['Completed', 'delivered'], ['All', '']],
  admin: [['Active', 'placed,accepted,ready_for_pickup,assigned,picked_up'], ['All', '']],
};

async function renderOrders(view) {
  const role = state.user.role;
  const tabs = ORDER_TABS[role];
  const tab = renderOrders.tab?.[role] ?? 0;
  const { orders } = await api('GET', `/api/orders?status=${tabs[tab][1]}`);
  const title = { pharmacy: 'My orders', supplier: 'Incoming orders', driver: 'My deliveries', admin: 'All orders' }[role];
  const counterparty = (o) => (role === 'pharmacy' ? o.supplier_name : role === 'supplier' ? o.pharmacy_name : `${o.supplier_name} → ${o.pharmacy_name}`);

  view.innerHTML = `
    <h1>${title}</h1>
    <div class="tabs">${tabs.map(([l], i) => `<button data-tab="${i}" class="${i === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${orders.length ? `
    <div class="card table-wrap"><table>
      <tr><th>#</th><th>${role === 'pharmacy' ? 'Supplier' : role === 'supplier' ? 'Pharmacy' : 'Route'}</th><th>Items</th><th>Total</th><th>Status</th><th>Updated</th></tr>
      ${orders.map((o) => `
        <tr class="clickable" data-id="${o.id}">
          <td>${o.id}</td><td>${esc(counterparty(o))}</td><td>${o.item_count}</td><td>${money(o.total)}</td>
          <td>${statusPill(o.status)}</td><td class="small muted">${when(o.updated_at)}</td>
        </tr>`).join('')}
    </table></div>` : '<div class="card empty">Nothing here yet.</div>'}`;

  view.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => { renderOrders.tab = { ...renderOrders.tab, [role]: Number(b.dataset.tab) }; render(); };
  });
  view.querySelectorAll('[data-id]').forEach((tr) => { tr.onclick = () => { location.hash = `#order-${tr.dataset.id}`; }; });
  state.refreshTimer = setInterval(() => { if (!document.hidden) render(); }, 20000);
}

async function renderOrderDetail(view, id) {
  const { order: o } = await api('GET', `/api/orders/${encodeURIComponent(id)}`);
  const role = state.user.role;
  const backHref = { pharmacy: '#orders', supplier: '#incoming', driver: o.driver_id ? '#my-deliveries' : '#jobs', admin: '#orders' }[role];

  const actions = [];
  if (role === 'supplier') {
    if (o.status === 'placed') actions.push('<button class="primary" data-act="accept">Accept order</button>', '<button class="danger" data-act="reject">Reject</button>');
    if (o.status === 'accepted') actions.push('<button class="primary" data-act="ready">Packed · ready for pickup</button>');
    if (['accepted', 'ready_for_pickup'].includes(o.status)) actions.push('<button class="danger" data-act="cancel">Cancel order</button>');
  }
  if (role === 'pharmacy' && o.status === 'placed') actions.push('<button class="danger" data-act="cancel">Cancel order</button>');
  if (role === 'driver') {
    if (o.status === 'ready_for_pickup') actions.push('<button class="primary" data-act="claim">Take this delivery</button>');
    if (o.status === 'assigned') actions.push('<button class="primary" data-act="pickup">Collected from supplier</button>', '<button data-act="release">Give up job</button>');
    if (o.status === 'picked_up') actions.push(`
      <form id="deliver" class="row">
        <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit code from pharmacy" required style="max-width:240px">
        <button class="primary" type="submit">Confirm delivery</button>
      </form>`);
  }

  const showCode = role === 'pharmacy' && ['assigned', 'picked_up'].includes(o.status) && o.delivery_code;

  view.innerHTML = `
    <p><a href="${backHref}">← Back</a></p>
    <div class="row spread"><h1>Order #${o.id}</h1>${statusPill(o.status)}</div>
    <div class="stack">
      ${showCode ? `
        <div class="callout stack">
          <div><strong>Your delivery code</strong> · give this to the driver when the goods arrive</div>
          <div class="code">${esc(o.delivery_code)}</div>
        </div>` : ''}
      ${actions.length ? `<div class="card row">${actions.join('')}</div>` : ''}
      <div class="grid">
        <div class="card stack small">
          <h2>Pickup</h2>
          <div><strong>${esc(o.supplier_name)}</strong></div>
          ${role !== 'pharmacy' ? `<div>${esc(o.supplier_address)}</div>` : ''}
          ${o.supplier_phone ? `<div><a href="tel:${esc(o.supplier_phone)}">${esc(o.supplier_phone)}</a></div>` : ''}
        </div>
        <div class="card stack small">
          <h2>Deliver to</h2>
          <div><strong>${esc(o.pharmacy_name)}</strong></div>
          <div>${esc(o.delivery_address)}</div>
          ${o.pharmacy_phone ? `<div><a href="tel:${esc(o.pharmacy_phone)}">${esc(o.pharmacy_phone)}</a></div>` : ''}
        </div>
        <div class="card stack small">
          <h2>Driver</h2>
          ${o.driver_name ? `<div><strong>${esc(o.driver_name)}</strong> ${o.driver_vehicle ? `· ${esc(o.driver_vehicle)}` : ''}</div>
            ${o.driver_phone ? `<div><a href="tel:${esc(o.driver_phone)}">${esc(o.driver_phone)}</a></div>` : ''}` : '<div class="muted">Not assigned yet</div>'}
          <div>Payment: ${o.payment_method === 'credit' ? 'Supplier credit' : `Cash on delivery · collect <strong>${money(o.total)}</strong>`}</div>
        </div>
      </div>
      <div class="card table-wrap">
        <h2>Items</h2>
        <table>
          <tr><th>Product</th><th>Unit</th><th>Qty</th><th>Total</th></tr>
          ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${money(i.unit_price)}</td><td>${i.qty}</td><td>${money(i.line_total)}</td></tr>`).join('')}
          <tr><td colspan="3" class="muted">Delivery</td><td>${money(o.delivery_fee)}</td></tr>
          <tr><td colspan="3"><strong>Total</strong></td><td><strong>${money(o.total)}</strong></td></tr>
        </table>
        ${o.notes ? `<p class="small"><strong>Notes:</strong> ${esc(o.notes)}</p>` : ''}
      </div>
      <div class="card">
        <h2>Tracking</h2>
        <ul class="timeline">
          ${o.events.map((e) => `
            <li><strong>${esc(STATUS_LABEL[e.status] || e.status)}</strong>
              <div class="small muted">${when(e.created_at)}${e.actor_name ? ` · ${esc(e.actor_name)}` : ''}</div>
              ${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}</li>`).join('')}
        </ul>
      </div>
    </div>`;

  const ORDER_ACTIONS = { accept: 'orders', reject: 'orders', ready: 'orders', cancel: 'orders', claim: 'deliveries', pickup: 'deliveries', release: 'deliveries' };
  const send = async (act, body = {}) => {
    await api('POST', `/api/${ORDER_ACTIONS[act]}/${o.id}/${act}`, body);
    toast('Updated');
    if (act === 'release') location.hash = '#jobs'; else render();
  };
  view.querySelectorAll('[data-act]').forEach((b) => {
    const act = b.dataset.act;
    if (act !== 'reject' && act !== 'cancel') { b.onclick = action(() => send(act)); return; }
    // Reject/cancel ask for a reason in the page itself (browser pop-ups are not reliable everywhere).
    b.onclick = () => {
      const bar = b.closest('.card');
      const required = act === 'reject';
      bar.innerHTML = `
        <form id="reasonForm" class="stack" style="width:100%">
          <label>${required ? 'Reason for rejecting (shown to the pharmacy)' : 'Reason for cancelling (optional)'}
            <input id="reason" maxlength="300" ${required ? 'required' : ''}></label>
          <div class="row">
            <button class="danger" type="submit">${required ? 'Reject order' : 'Cancel order'}</button>
            <button type="button" id="keep">Go back</button>
          </div>
        </form>`;
      $('#reason', bar).focus();
      $('#keep', bar).onclick = () => render();
      const f = $('#reasonForm', bar);
      f.onsubmit = action(async (ev) => {
        ev.preventDefault();
        const reason = $('#reason', bar).value.trim();
        await send(act, { reason: reason || undefined });
      });
    };
  });
  const df = $('#deliver', view);
  if (df) {
    df.onsubmit = action(async (ev) => {
      ev.preventDefault();
      await api('POST', `/api/deliveries/${o.id}/deliver`, { code: new FormData(df).get('code') });
      toast('Delivery confirmed');
      render();
    });
  }
  if (!['delivered', 'rejected', 'cancelled'].includes(o.status)) {
    state.refreshTimer = setInterval(() => { if (!document.hidden && !document.activeElement?.closest('form')) render(); }, 15000);
  }
}

// ---------------------------------------------------------------- supplier

async function renderProducts(view) {
  const { products } = await api('GET', '/api/supplier/products');
  const editing = renderProducts.editing;
  const e = editing ? products.find((p) => p.id === editing) : null;
  const val = (k, d = '') => esc(e ? e[k] ?? d : d);

  view.innerHTML = `
    <h1>My products</h1>
    <div class="stack">
      <form id="pf" class="card stack">
        <h2>${e ? `Edit ${esc(e.name)}` : 'Add a product'}</h2>
        <div class="form-grid">
          <label>Brand name<input name="name" required value="${val('name')}"></label>
          <label>Generic name<input name="generic_name" value="${val('generic_name')}"></label>
          <label>Category<input name="category" value="${val('category')}" placeholder="e.g. Antibiotics"></label>
          <label>Form<input name="form" value="${val('form')}" placeholder="Tablet, Syrup…"></label>
          <label>Strength<input name="strength" value="${val('strength')}" placeholder="500 mg"></label>
          <label>Pack size<input name="pack_size" value="${val('pack_size')}" placeholder="Box of 20"></label>
          <label>SKU<input name="sku" value="${val('sku')}"></label>
          <label>Price per pack (${esc(state.config.currency)})<input name="price" type="number" step="0.01" min="0" required value="${e ? e.price / 100 : ''}"></label>
          <label>Stock (packs)<input name="stock" type="number" min="0" required value="${val('stock', 0)}"></label>
          <label>Minimum order<input name="min_order_qty" type="number" min="1" required value="${val('min_order_qty', 1)}"></label>
        </div>
        <div class="row">
          <label class="row" style="color:inherit"><input type="checkbox" name="cold_chain" style="width:auto" ${e?.cold_chain ? 'checked' : ''}> Needs cold chain</label>
          <label class="row" style="color:inherit"><input type="checkbox" name="active" style="width:auto" ${!e || e.active ? 'checked' : ''}> Listed for sale</label>
        </div>
        <div class="row">
          <button class="primary" type="submit">${e ? 'Save changes' : 'Add product'}</button>
          ${e ? '<button type="button" id="cancelEdit">Cancel</button>' : ''}
        </div>
      </form>
      <div class="card table-wrap">
        ${products.length ? `<table>
          <tr><th>Product</th><th>Price</th><th>Stock</th><th>Min</th><th>Status</th><th></th></tr>
          ${products.map((p) => `
            <tr>
              <td><strong>${esc(p.name)}</strong> <span class="small muted">${esc([p.strength, p.form, p.pack_size].filter(Boolean).join(' · '))}</span>
                ${p.cold_chain ? ' <span class="tag cold">Cold</span>' : ''}</td>
              <td>${money(p.price)}</td>
              <td>${p.stock}${p.stock < 20 ? ' <span class="small" style="color:var(--warn)">low</span>' : ''}</td>
              <td>${p.min_order_qty}</td>
              <td>${p.active ? 'Listed' : '<span class="muted">Hidden</span>'}</td>
              <td><button class="link" data-edit="${p.id}">Edit</button></td>
            </tr>`).join('')}
        </table>` : '<div class="empty">No products yet. Add your first one above.</div>'}
      </div>
    </div>`;

  const f = $('#pf', view);
  f.onsubmit = action(async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const body = { ...d, cold_chain: !!d.cold_chain, active: !!d.active };
    if (e) await api('PATCH', `/api/supplier/products/${e.id}`, body);
    else await api('POST', '/api/supplier/products', body);
    toast(e ? 'Product updated' : 'Product added');
    renderProducts.editing = null;
    render();
  });
  view.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => { renderProducts.editing = Number(b.dataset.edit); render(); window.scrollTo(0, 0); };
  });
  $('#cancelEdit', view)?.addEventListener('click', () => { renderProducts.editing = null; render(); });
}

// ---------------------------------------------------------------- driver

async function renderJobs(view) {
  const { jobs } = await api('GET', '/api/deliveries/available');
  view.innerHTML = `
    <h1>Available jobs</h1>
    ${jobs.length ? `<div class="grid">${jobs.map((j) => `
      <div class="card stack small">
        <div class="row spread"><strong>Order #${j.id}</strong><span class="price">${money(j.delivery_fee)}</span></div>
        <div><span class="muted">Pick up</span><br><strong>${esc(j.supplier_name)}</strong><br>${esc([j.pickup_address, j.pickup_city].filter(Boolean).join(', '))}</div>
        <div><span class="muted">Drop off</span><br><strong>${esc(j.pharmacy_name)}</strong><br>${esc(j.delivery_address)}</div>
        <div class="row">${j.item_count} product${j.item_count === 1 ? '' : 's'} ${j.cold_chain ? '<span class="tag cold">Cold chain</span>' : ''}
          ${j.payment_method === 'cash_on_delivery' ? `<span class="tag">Collect ${money(j.total)}</span>` : ''}</div>
        <div class="row"><button class="primary" data-claim="${j.id}">Take job</button><a href="#order-${j.id}">Details</a></div>
      </div>`).join('')}</div>` : '<div class="card empty">No deliveries waiting right now. This page refreshes automatically.</div>'}`;
  view.querySelectorAll('[data-claim]').forEach((b) => {
    b.onclick = action(async () => {
      await api('POST', `/api/deliveries/${b.dataset.claim}/claim`);
      toast('Job is yours. Head to the supplier.');
      location.hash = `#order-${b.dataset.claim}`;
    });
  });
  state.refreshTimer = setInterval(() => { if (!document.hidden) render(); }, 15000);
}

// ---------------------------------------------------------------- admin

async function renderAdmin(view) {
  const { organizations, drivers, stats } = await api('GET', '/api/admin/overview');
  view.innerHTML = `
    <h1>Verification</h1>
    <div class="grid" style="margin-bottom:1rem">
      <div class="card"><div class="muted small">Orders</div><div class="price">${stats.orders}</div></div>
      <div class="card"><div class="muted small">In progress</div><div class="price">${stats.in_progress || 0}</div></div>
      <div class="card"><div class="muted small">Delivered value</div><div class="price">${money(stats.delivered_value)}</div></div>
    </div>
    <div class="stack">
      <div class="card table-wrap"><h2>Pharmacies &amp; suppliers</h2><table>
        <tr><th>Name</th><th>Type</th><th>License</th><th>Address</th><th>Status</th><th></th></tr>
        ${organizations.map((o) => `<tr>
          <td>${esc(o.name)}</td><td>${esc(o.type)}</td><td>${esc(o.license_no)}</td><td class="small">${esc([o.address, o.city].filter(Boolean).join(', '))}</td>
          <td>${o.verified ? '<span class="status delivered">Verified</span>' : '<span class="status placed">Pending</span>'}</td>
          <td><button data-org="${o.id}" data-v="${o.verified ? 0 : 1}" class="${o.verified ? 'danger' : 'primary'}">${o.verified ? 'Suspend' : 'Verify'}</button></td>
        </tr>`).join('')}
      </table></div>
      <div class="card table-wrap"><h2>Drivers</h2><table>
        <tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Status</th><th></th></tr>
        ${drivers.map((d) => `<tr>
          <td>${esc(d.name)}<div class="small muted">${esc(d.email)}</div></td><td>${esc(d.phone)}</td><td>${esc(d.vehicle || '')}</td>
          <td>${d.approved ? '<span class="status delivered">Approved</span>' : '<span class="status placed">Pending</span>'}</td>
          <td><button data-drv="${d.id}" data-v="${d.approved ? 0 : 1}" class="${d.approved ? 'danger' : 'primary'}">${d.approved ? 'Suspend' : 'Approve'}</button></td>
        </tr>`).join('')}
      </table></div>
    </div>`;
  view.querySelectorAll('[data-org]').forEach((b) => {
    b.onclick = action(async () => { await api('POST', `/api/admin/organizations/${b.dataset.org}/verify`, { verified: b.dataset.v === '1' }); render(); });
  });
  view.querySelectorAll('[data-drv]').forEach((b) => {
    b.onclick = action(async () => { await api('POST', `/api/admin/drivers/${b.dataset.drv}/approve`, { approved: b.dataset.v === '1' }); render(); });
  });
}

// ---------------------------------------------------------------- boot

(async function boot() {
  try { state.config = await api('GET', '/api/config'); } catch { /* use defaults */ }
  if (state.token) {
    try { state.user = (await api('GET', '/api/me')).user; } catch { state.token = null; localSet('maa.token', null); }
  }
  render();
})();
