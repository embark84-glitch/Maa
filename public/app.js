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

const money = (minor) => new Intl.NumberFormat(I18N.locale, { style: 'currency', currency: state.config.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((minor || 0) / 100);
const when = (iso) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString(I18N.locale, { dateStyle: 'medium', timeStyle: 'short' });
// Phone numbers and codes stay left-to-right inside Arabic text.
const ltr = (s) => `<bdi dir="ltr">${esc(s)}</bdi>`;
const phone = (p) => (p ? `<div><a href="tel:${esc(p.replace(/\s+/g, ''))}">${ltr(p)}</a></div>` : '');

const STATUS_LABEL = {
  placed: 'Awaiting supplier', accepted: 'Being prepared', rejected: 'Rejected', cancelled: 'Cancelled',
  ready_for_pickup: 'Ready for pickup', assigned: 'Driver assigned', picked_up: 'On the way', delivered: 'Delivered',
};
const statusLabel = (s) => (STATUS_LABEL[s] ? t(STATUS_LABEL[s]) : s);
const statusPill = (s) => `<span class="status ${esc(s)}">${esc(statusLabel(s))}</span>`;

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(state.token && { authorization: `Bearer ${state.token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(); }
  if (!res.ok) throw new Error(data.error ? I18N.tError(data.error) : t('Request failed ({status})', { status: res.status }));
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

  I18N.apply();
  const langBtn = `<button class="link" id="lang">${I18N.lang === 'ar' ? 'English' : 'العربية'}</button>`;
  const bindLang = () => { $('#lang').onclick = () => { I18N.setLang(I18N.lang === 'ar' ? 'en' : 'ar'); render(); }; };

  if (!state.user) {
    $('#nav').innerHTML = ''; $('#who').innerHTML = langBtn; bindLang();
    return route === 'register' ? renderRegister(view) : renderLogin(view);
  }

  const u = state.user;
  const cartCount = Object.keys(state.cart).length;
  $('#nav').innerHTML = (NAV[u.role] || []).map(([href, label]) =>
    `<a href="${href}" class="${(location.hash === href || (href === '#orders' && /^#order-/.test(location.hash))) ? 'active' : ''}">${t(label)}${href === '#cart' && cartCount ? `<span class="cart-badge">${cartCount}</span>` : ''}</a>`).join('');
  $('#who').innerHTML = `<span class="name muted">${esc(u.organization?.name || u.name)}</span>${langBtn}<button class="link" id="logout">${t('Log out')}</button>`;
  $('#logout').onclick = logout;
  bindLang();

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
  view.innerHTML = `<p class="muted">${t('Loading…')}</p>`;
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
        <h1>${t('Sign in')}</h1>
        <form id="f" class="stack">
          <label>${t('Email')}<input name="email" type="email" dir="ltr" autocomplete="username" required></label>
          <label>${t('Password')}<input name="password" type="password" dir="ltr" autocomplete="current-password" required></label>
          <button class="primary" type="submit">${t('Sign in')}</button>
        </form>
        <p class="small muted">${t('New pharmacy, supplier company or driver?')} <a href="#register">${t('Create an account')}</a></p>
      </div>
      <div class="card stack demo">
        <h2>${t('Demo accounts')}</h2>
        <p class="small muted">${t('Password for all demo accounts:')} <code dir="ltr">password123</code></p>
        <div class="row">${DEMO.map(([l, e]) => `<button data-email="${e}">${t(l)}</button>`).join('')}</div>
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
      <h1>${t('Create an account')}</h1>
      <form id="f" class="stack">
        <label>${t('I am a')}
          <select name="role" id="role">
            <option value="pharmacy">${t('Pharmacy (buyer)')}</option>
            <option value="supplier">${t('Pharmaceutical company / distributor (seller)')}</option>
            <option value="driver">${t('Delivery driver')}</option>
          </select>
        </label>
        <label>${t('Your name')}<input name="name" required></label>
        <label>${t('Email')}<input name="email" type="email" dir="ltr" required></label>
        <label>${t('Phone')}<input name="phone" type="tel" dir="ltr" placeholder="+218 9x xxx xxxx" required></label>
        <label>${t('Password (min 8 characters)')}<input name="password" type="password" dir="ltr" minlength="8" required></label>
        <div id="org" class="stack">
          <label>${t('Business name')}<input name="org_name" required></label>
          <label>${t('License number')}<input name="license_no" required></label>
          <label>${t('Address')}<input name="address" required></label>
          <label>${t('City')}<input name="city"></label>
        </div>
        <div id="veh" hidden><label>${t('Vehicle')}<input name="vehicle" placeholder="${t('e.g. Motorbike, Van')}"></label></div>
        <p class="small muted">${t('Licenses are checked by Maa before you can buy or sell.')}</p>
        <button class="primary" type="submit">${t('Create an account')}</button>
      </form>
      <p class="small"><a href="#login">${t('Back to sign in')}</a></p>
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
      <h1>${t('Almost there')}</h1>
      <p>${u.role === 'driver'
        ? t('Your driver account is waiting for approval by the Maa team.')
        : t('{name} is waiting for license verification (license {license}).', { name: `<strong>${esc(u.organization.name)}</strong>`, license: ltr(u.organization.license_no) })}</p>
      <p class="muted small">${t("We'll unlock ordering and deliveries as soon as it's approved.")}</p>
      <button id="check">${t('Check again')}</button>
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
    <div class="row spread"><h1>${t('Order from suppliers')}</h1></div>
    <form id="filters" class="row" style="margin-bottom:1rem">
      <input name="q" placeholder="${t('Search by brand, generic name or SKU')}" value="${esc(f.q || '')}" style="flex:2;min-width:200px">
      <select name="category" style="flex:1;min-width:140px"><option value="">${t('All categories')}</option>
        ${categories.map((c) => `<option ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select name="supplier" style="flex:1;min-width:160px"><option value="">${t('All suppliers')}</option>
        ${suppliers.map((s) => `<option value="${s.id}" ${String(f.supplier) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <button type="submit">${t('Search')}</button>
    </form>
    ${products.length ? `<div class="grid">${products.map(productCard).join('')}</div>` : `<div class="card empty">${t('No products match.')}</div>`}`;
  $('#filters', view).onsubmit = (ev) => {
    ev.preventDefault();
    renderCatalog.filters = Object.fromEntries([...new FormData(ev.target)].filter(([, v]) => v));
    render();
  };
  view.querySelectorAll('[data-add]').forEach((btn) => {
    btn.onclick = () => {
      const p = products.find((x) => x.id === Number(btn.dataset.add));
      const qty = Number(btn.parentElement.querySelector('input').value);
      if (!Number.isInteger(qty) || qty < p.min_order_qty) return toast(t('Minimum order is {n}', { n: p.min_order_qty }), true);
      const prev = state.cart[p.id]?.qty || 0;
      if (prev + qty > p.stock) return toast(t('Only {n} in stock', { n: p.stock }), true);
      state.cart[p.id] = { product: p, qty: prev + qty };
      saveCart();
      toast(t('Added {qty} × {name}', { qty, name: p.name }));
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
        ${p.cold_chain ? `<span class="tag cold">${t('Cold chain')}</span>` : ''}
      </div>
      <div class="small">${t('Sold by')} <strong>${esc(p.supplier_name)}</strong></div>
      <div class="row spread">
        <span class="price">${money(p.price)}</span>
        <span class="small muted">${p.stock > 0 ? t('{n} in stock', { n: p.stock }) : t('Out of stock')} · ${t('min {n}', { n: p.min_order_qty })}</span>
      </div>
      <div class="row">
        <input class="qty" type="number" min="${p.min_order_qty}" value="${p.min_order_qty}" aria-label="${t('Quantity')}">
        <button class="primary" data-add="${p.id}" ${p.stock < p.min_order_qty ? 'disabled' : ''}>${t('Add to cart')}</button>
      </div>
      ${inCart ? `<div class="small muted">${t('{n} in cart', { n: inCart })}</div>` : ''}
    </div>`;
}

function renderCart(view) {
  const lines = Object.values(state.cart);
  if (!lines.length) {
    view.innerHTML = `<h1>${t('Cart')}</h1><div class="card empty">${t('Your cart is empty.')} <a href="#catalog">${t('Browse the catalog')}</a></div>`;
    return;
  }
  const groups = {};
  for (const l of lines) (groups[l.product.supplier_id] ||= { name: l.product.supplier_name, lines: [] }).lines.push(l);
  const groupList = Object.values(groups);
  const subtotal = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
  const fees = groupList.length * state.config.deliveryFee;

  view.innerHTML = `
    <h1>${t('Cart')}</h1>
    <div class="stack">
      ${groupList.map((g) => `
        <div class="card">
          <h2>${esc(g.name)}</h2>
          <div class="table-wrap"><table>
            <tr><th>${t('Product')}</th><th>${t('Price')}</th><th>${t('Qty')}</th><th>${t('Total')}</th><th></th></tr>
            ${g.lines.map((l) => `
              <tr>
                <td>${esc(l.product.name)} <span class="muted small">${esc(l.product.strength || '')} ${esc(l.product.pack_size || '')}</span></td>
                <td>${money(l.product.price)}</td>
                <td><input class="qty" type="number" min="${l.product.min_order_qty}" value="${l.qty}" data-qty="${l.product.id}"></td>
                <td>${money(l.product.price * l.qty)}</td>
                <td><button class="link danger" data-remove="${l.product.id}">${t('Remove')}</button></td>
              </tr>`).join('')}
          </table></div>
          <p class="small muted">${t('Delivered as a separate shipment · delivery {fee}', { fee: money(state.config.deliveryFee) })}</p>
        </div>`).join('')}
      <div class="card stack">
        <div class="row spread"><span>${t('Products')}</span><span>${money(subtotal)}</span></div>
        <div class="row spread"><span>${groupList.length === 1 ? t('Delivery (1 shipment)') : t('Delivery ({n} shipments)', { n: groupList.length })}</span><span>${money(fees)}</span></div>
        <div class="row spread"><strong>${t('Total')}</strong><strong>${money(subtotal + fees)}</strong></div>
        <label>${t('Payment')}
          <select id="pay">
            <option value="cash_on_delivery">${t('Cash on delivery')}</option>
            <option value="credit">${t('Supplier credit / invoice')}</option>
          </select>
        </label>
        <label>${t('Notes for suppliers (optional)')}<textarea id="notes" rows="2" maxlength="500"></textarea></label>
        <button class="primary" id="place">${t('Place order')}</button>
      </div>
    </div>`;

  view.querySelectorAll('[data-qty]').forEach((inp) => {
    inp.onchange = () => {
      const l = state.cart[inp.dataset.qty];
      const q = Number(inp.value);
      if (!Number.isInteger(q) || q < l.product.min_order_qty) { toast(t('Minimum order is {n}', { n: l.product.min_order_qty }), true); inp.value = l.qty; return; }
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
    toast(orders.length === 1 ? t('Order placed') : t('{n} orders placed, one per supplier', { n: orders.length }));
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
  const title = t({ pharmacy: 'My orders', supplier: 'Incoming orders', driver: 'My deliveries', admin: 'All orders' }[role]);
  const counterparty = (o) => (role === 'pharmacy' ? o.supplier_name : role === 'supplier' ? o.pharmacy_name : `${o.supplier_name} ${I18N.lang === 'ar' ? '←' : '→'} ${o.pharmacy_name}`);

  view.innerHTML = `
    <h1>${title}</h1>
    <div class="tabs">${tabs.map(([l], i) => `<button data-tab="${i}" class="${i === tab ? 'on' : ''}">${t(l)}</button>`).join('')}</div>
    ${orders.length ? `
    <div class="card table-wrap"><table>
      <tr><th>#</th><th>${t(role === 'pharmacy' ? 'Supplier' : role === 'supplier' ? 'Pharmacy' : 'Route')}</th><th>${t('Items')}</th><th>${t('Total')}</th><th>${t('Status')}</th><th>${t('Updated')}</th></tr>
      ${orders.map((o) => `
        <tr class="clickable" data-id="${o.id}">
          <td>${o.id}</td><td>${esc(counterparty(o))}</td><td>${o.item_count}</td><td>${money(o.total)}</td>
          <td>${statusPill(o.status)}</td><td class="small muted">${when(o.updated_at)}</td>
        </tr>`).join('')}
    </table></div>` : `<div class="card empty">${t('Nothing here yet.')}</div>`}`;

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
    if (o.status === 'placed') actions.push(`<button class="primary" data-act="accept">${t('Accept order')}</button>`, `<button class="danger" data-act="reject">${t('Reject')}</button>`);
    if (o.status === 'accepted') actions.push(`<button class="primary" data-act="ready">${t('Packed · ready for pickup')}</button>`);
    if (['accepted', 'ready_for_pickup'].includes(o.status)) actions.push(`<button class="danger" data-act="cancel">${t('Cancel order')}</button>`);
  }
  if (role === 'pharmacy' && o.status === 'placed') actions.push(`<button class="danger" data-act="cancel">${t('Cancel order')}</button>`);
  if (role === 'driver') {
    if (o.status === 'ready_for_pickup') actions.push(`<button class="primary" data-act="claim">${t('Take this delivery')}</button>`);
    if (o.status === 'assigned') actions.push(`<button class="primary" data-act="pickup">${t('Collected from supplier')}</button>`, `<button data-act="release">${t('Give up job')}</button>`);
    if (o.status === 'picked_up') actions.push(`
      <form id="deliver" class="row">
        <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" dir="ltr" placeholder="${t('6-digit code from pharmacy')}" required style="max-width:240px">
        <button class="primary" type="submit">${t('Confirm delivery')}</button>
      </form>`);
  }

  const showCode = role === 'pharmacy' && ['assigned', 'picked_up'].includes(o.status) && o.delivery_code;

  view.innerHTML = `
    <p><a href="${backHref}">${I18N.lang === 'ar' ? '→' : '←'} ${t('Back')}</a></p>
    <div class="row spread"><h1>${t('Order #{id}', { id: o.id })}</h1>${statusPill(o.status)}</div>
    <div class="stack">
      ${showCode ? `
        <div class="callout stack">
          <div><strong>${t('Your delivery code')}</strong> · ${t('give this to the driver when the goods arrive')}</div>
          <div class="code" dir="ltr">${esc(o.delivery_code)}</div>
        </div>` : ''}
      ${actions.length ? `<div class="card row">${actions.join('')}</div>` : ''}
      <div class="grid">
        <div class="card stack small">
          <h2>${t('Pickup')}</h2>
          <div><strong>${esc(o.supplier_name)}</strong></div>
          ${role !== 'pharmacy' ? `<div>${esc(o.supplier_address)}</div>` : ''}
          ${phone(o.supplier_phone)}
        </div>
        <div class="card stack small">
          <h2>${t('Deliver to')}</h2>
          <div><strong>${esc(o.pharmacy_name)}</strong></div>
          <div>${esc(o.delivery_address)}</div>
          ${phone(o.pharmacy_phone)}
        </div>
        <div class="card stack small">
          <h2>${t('Driver')}</h2>
          ${o.driver_name ? `<div><strong>${esc(o.driver_name)}</strong> ${o.driver_vehicle ? `· ${esc(o.driver_vehicle)}` : ''}</div>
            ${phone(o.driver_phone)}` : `<div class="muted">${t('Not assigned yet')}</div>`}
          <div>${t('Payment:')} ${o.payment_method === 'credit' ? t('Supplier credit') : t('Cash on delivery · collect {amount}', { amount: `<strong>${money(o.total)}</strong>` })}</div>
        </div>
      </div>
      <div class="card table-wrap">
        <h2>${t('Items')}</h2>
        <table>
          <tr><th>${t('Product')}</th><th>${t('Unit')}</th><th>${t('Qty')}</th><th>${t('Total')}</th></tr>
          ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${money(i.unit_price)}</td><td>${i.qty}</td><td>${money(i.line_total)}</td></tr>`).join('')}
          <tr><td colspan="3" class="muted">${t('Delivery')}</td><td>${money(o.delivery_fee)}</td></tr>
          <tr><td colspan="3"><strong>${t('Total')}</strong></td><td><strong>${money(o.total)}</strong></td></tr>
        </table>
        ${o.notes ? `<p class="small"><strong>${t('Notes:')}</strong> ${esc(o.notes)}</p>` : ''}
      </div>
      <div class="card">
        <h2>${t('Tracking')}</h2>
        <ul class="timeline">
          ${o.events.map((e) => `
            <li><strong>${esc(statusLabel(e.status))}</strong>
              <div class="small muted">${when(e.created_at)}${e.actor_name ? ` · ${esc(e.actor_name)}` : ''}</div>
              ${e.note ? `<div class="small">${esc(I18N.tNote(e.note))}</div>` : ''}</li>`).join('')}
        </ul>
      </div>
    </div>`;

  const ORDER_ACTIONS = { accept: 'orders', reject: 'orders', ready: 'orders', cancel: 'orders', claim: 'deliveries', pickup: 'deliveries', release: 'deliveries' };
  const send = async (act, body = {}) => {
    await api('POST', `/api/${ORDER_ACTIONS[act]}/${o.id}/${act}`, body);
    toast(t('Status updated'));
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
          <label>${t(required ? 'Reason for rejecting (shown to the pharmacy)' : 'Reason for cancelling (optional)')}
            <input id="reason" maxlength="300" ${required ? 'required' : ''}></label>
          <div class="row">
            <button class="danger" type="submit">${t(required ? 'Reject order' : 'Cancel order')}</button>
            <button type="button" id="keep">${t('Go back')}</button>
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
      toast(t('Delivery confirmed'));
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
    <h1>${t('My products')}</h1>
    <div class="stack">
      <form id="pf" class="card stack">
        <h2>${e ? t('Edit {name}', { name: esc(e.name) }) : t('Add a product')}</h2>
        <div class="form-grid">
          <label>${t('Brand name')}<input name="name" required value="${val('name')}"></label>
          <label>${t('Generic name')}<input name="generic_name" value="${val('generic_name')}"></label>
          <label>${t('Category')}<input name="category" value="${val('category')}" placeholder="${t('e.g. Antibiotics')}"></label>
          <label>${t('Form')}<input name="form" value="${val('form')}" placeholder="${t('Tablet, Syrup…')}"></label>
          <label>${t('Strength')}<input name="strength" value="${val('strength')}" placeholder="500 mg"></label>
          <label>${t('Pack size')}<input name="pack_size" value="${val('pack_size')}" placeholder="${t('Box of 20')}"></label>
          <label>${t('SKU')}<input dir="ltr" name="sku" value="${val('sku')}"></label>
          <label>${t('Price per pack ({currency})', { currency: esc(state.config.currency) })}<input name="price" type="number" step="0.01" min="0" required value="${e ? e.price / 100 : ''}"></label>
          <label>${t('Stock (packs)')}<input name="stock" type="number" min="0" required value="${val('stock', 0)}"></label>
          <label>${t('Minimum order')}<input name="min_order_qty" type="number" min="1" required value="${val('min_order_qty', 1)}"></label>
        </div>
        <div class="row">
          <label class="row" style="color:inherit"><input type="checkbox" name="cold_chain" style="width:auto" ${e?.cold_chain ? 'checked' : ''}> ${t('Needs cold chain')}</label>
          <label class="row" style="color:inherit"><input type="checkbox" name="active" style="width:auto" ${!e || e.active ? 'checked' : ''}> ${t('Listed for sale')}</label>
        </div>
        <div class="row">
          <button class="primary" type="submit">${t(e ? 'Save changes' : 'Add product')}</button>
          ${e ? `<button type="button" id="cancelEdit">${t('Cancel')}</button>` : ''}
        </div>
      </form>
      <div class="card table-wrap">
        ${products.length ? `<table>
          <tr><th>${t('Product')}</th><th>${t('Price')}</th><th>${t('Stock')}</th><th>${t('Min')}</th><th>${t('Status')}</th><th></th></tr>
          ${products.map((p) => `
            <tr>
              <td><strong>${esc(p.name)}</strong> <span class="small muted">${esc([p.strength, p.form, p.pack_size].filter(Boolean).join(' · '))}</span>
                ${p.cold_chain ? ` <span class="tag cold">${t('Cold')}</span>` : ''}</td>
              <td>${money(p.price)}</td>
              <td>${p.stock}${p.stock < 20 ? ` <span class="small" style="color:var(--warn)">${t('low')}</span>` : ''}</td>
              <td>${p.min_order_qty}</td>
              <td>${p.active ? t('Listed') : `<span class="muted">${t('Hidden')}</span>`}</td>
              <td><button class="link" data-edit="${p.id}">${t('Edit')}</button></td>
            </tr>`).join('')}
        </table>` : `<div class="empty">${t('No products yet. Add your first one above.')}</div>`}
      </div>
    </div>`;

  const f = $('#pf', view);
  f.onsubmit = action(async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const body = { ...d, cold_chain: !!d.cold_chain, active: !!d.active };
    if (e) await api('PATCH', `/api/supplier/products/${e.id}`, body);
    else await api('POST', '/api/supplier/products', body);
    toast(t(e ? 'Product updated' : 'Product added'));
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
    <h1>${t('Available jobs')}</h1>
    ${jobs.length ? `<div class="grid">${jobs.map((j) => `
      <div class="card stack small">
        <div class="row spread"><strong>${t('Order #{id}', { id: j.id })}</strong><span class="price">${money(j.delivery_fee)}</span></div>
        <div><span class="muted">${t('Pick up')}</span><br><strong>${esc(j.supplier_name)}</strong><br>${esc([j.pickup_address, j.pickup_city].filter(Boolean).join(', '))}</div>
        <div><span class="muted">${t('Drop off')}</span><br><strong>${esc(j.pharmacy_name)}</strong><br>${esc(j.delivery_address)}</div>
        <div class="row">${j.item_count === 1 ? t('1 product') : t('{n} products', { n: j.item_count })} ${j.cold_chain ? `<span class="tag cold">${t('Cold chain')}</span>` : ''}
          ${j.payment_method === 'cash_on_delivery' ? `<span class="tag">${t('Collect {amount}', { amount: money(j.total) })}</span>` : ''}</div>
        <div class="row"><button class="primary" data-claim="${j.id}">${t('Take job')}</button><a href="#order-${j.id}">${t('Details')}</a></div>
      </div>`).join('')}</div>` : `<div class="card empty">${t('No deliveries waiting right now. This page refreshes automatically.')}</div>`}`;
  view.querySelectorAll('[data-claim]').forEach((b) => {
    b.onclick = action(async () => {
      await api('POST', `/api/deliveries/${b.dataset.claim}/claim`);
      toast(t('Job is yours. Head to the supplier.'));
      location.hash = `#order-${b.dataset.claim}`;
    });
  });
  state.refreshTimer = setInterval(() => { if (!document.hidden) render(); }, 15000);
}

// ---------------------------------------------------------------- admin

async function renderAdmin(view) {
  const { organizations, drivers, stats } = await api('GET', '/api/admin/overview');
  view.innerHTML = `
    <h1>${t('Verification')}</h1>
    <div class="grid" style="margin-bottom:1rem">
      <div class="card"><div class="muted small">${t('Orders')}</div><div class="price">${stats.orders}</div></div>
      <div class="card"><div class="muted small">${t('In progress')}</div><div class="price">${stats.in_progress || 0}</div></div>
      <div class="card"><div class="muted small">${t('Delivered value')}</div><div class="price">${money(stats.delivered_value)}</div></div>
    </div>
    <div class="stack">
      <div class="card table-wrap"><h2>${t('Pharmacies & suppliers')}</h2><table>
        <tr><th>${t('Name')}</th><th>${t('Type')}</th><th>${t('License')}</th><th>${t('Address')}</th><th>${t('Status')}</th><th></th></tr>
        ${organizations.map((o) => `<tr>
          <td>${esc(o.name)}</td><td>${esc(t(o.type))}</td><td>${ltr(o.license_no)}</td><td class="small">${esc([o.address, o.city].filter(Boolean).join(', '))}</td>
          <td>${o.verified ? `<span class="status delivered">${t('Verified')}</span>` : `<span class="status placed">${t('Pending')}</span>`}</td>
          <td><button data-org="${o.id}" data-v="${o.verified ? 0 : 1}" class="${o.verified ? 'danger' : 'primary'}">${t(o.verified ? 'Suspend' : 'Verify')}</button></td>
        </tr>`).join('')}
      </table></div>
      <div class="card table-wrap"><h2>${t('Drivers')}</h2><table>
        <tr><th>${t('Name')}</th><th>${t('Phone')}</th><th>${t('Vehicle')}</th><th>${t('Status')}</th><th></th></tr>
        ${drivers.map((d) => `<tr>
          <td>${esc(d.name)}<div class="small muted">${ltr(d.email)}</div></td><td>${ltr(d.phone)}</td><td>${esc(d.vehicle || '')}</td>
          <td>${d.approved ? `<span class="status delivered">${t('Approved')}</span>` : `<span class="status placed">${t('Pending')}</span>`}</td>
          <td><button data-drv="${d.id}" data-v="${d.approved ? 0 : 1}" class="${d.approved ? 'danger' : 'primary'}">${t(d.approved ? 'Suspend' : 'Approve')}</button></td>
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
