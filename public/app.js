'use strict';
/*
 * Maa web client: one page, hash routes, a view per role. No build step.
 * Text is written in English and translated through t() (public/i18n.js).
 * Payment and import rules come from /shared (MaaPayment, MaaImport), the same
 * code the server enforces.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }
function readJson(k, fallback) { try { return JSON.parse(localGet(k)) ?? fallback; } catch { return fallback; } }

const state = {
  token: localGet('maa.token'),
  user: null,
  config: { currency: 'LYD', deliveryFee: 0 },
  drafts: readJson('maa.drafts', {}), // supplierId -> { productId: qty }  (one draft order per company)
  refreshTimer: null,
};
const saveDrafts = () => localSet('maa.drafts', JSON.stringify(state.drafts));
/** The shared-link pilot: everyone on the artifact shares one database; accounts follow Claude accounts. */
const SHARED = window.MAA_MODE === 'shared';

// ---------------------------------------------------------------- formatting

const money = (minor) => new Intl.NumberFormat(I18N.locale, { style: 'currency', currency: state.config.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((minor || 0) / 100);
const when = (iso) => new Date(iso.replace(' ', 'T') + (iso.length > 10 ? 'Z' : '')).toLocaleString(I18N.locale, iso.length > 10 ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
const day = (iso) => new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString(I18N.locale, { dateStyle: 'medium', timeZone: 'UTC' });
const ltr = (s) => `<bdi dir="ltr">${esc(s)}</bdi>`;
/** A product name keeps its own direction ("1-2-3" must not read "3-2-1" in Arabic). */
const nm = (s) => `<bdi>${esc(s)}</bdi>`;
const phone = (p) => (p ? `<div><a href="tel:${esc(p.replace(/\s+/g, ''))}">${ltr(p)}</a></div>` : '');
/** Whole number from user input, accepting Arabic-Indic digits. NaN when not a whole number. */
const toInt = (s) => { const n = MaaImport.parseNumber(String(s ?? '').trim()); return Number.isInteger(n) ? n : NaN; };
/** Amount typed in dinars ("4,50", "٤٫٥") -> number of dinars, or NaN. */
const toAmount = (s) => MaaImport.parseNumber(String(s ?? '').trim());

// ---------------------------------------------------------------- product images

const initials = (name) => String(name || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const hue = (name) => [...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
/** A product's pack photo, or a coloured tile with its initials when there is none. */
const thumb = (p, cls = '') => (p?.image_url
  ? `<img class="thumb ${cls}" data-src="${esc(p.image_url)}" data-name="${esc(p.name)}" alt="" loading="lazy">`
  : `<span class="thumb ph ${cls}" style="--h:${hue(p?.name)}" aria-hidden="true">${esc(initials(p?.name))}</span>`);

/** Load images after rendering. In the demo, photos served by the in-browser server go through fetch. */
function hydrateImages(root = document) {
  for (const img of root.querySelectorAll('img[data-src]')) {
    const url = img.dataset.src;
    img.removeAttribute('data-src');
    img.onerror = () => { img.outerHTML = thumb({ name: img.dataset.name }, img.className.replace('thumb', '').trim()); };
    if (window.maaInBrowser && url.startsWith('api/')) {
      fetch(`/${url}`).then((r) => (r.ok ? r.blob() : Promise.reject())).then((b) => { img.src = URL.createObjectURL(b); }).catch(() => img.onerror());
    } else {
      img.src = url;
    }
  }
}

/** Shrink a photo before sending it: longest side `max` px, JPEG. Resolves a data: URL. */
async function shrinkImage(file, max = 1600, quality = 0.85) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const src = bitmap || await new Promise((resolve, reject) => {
    const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = URL.createObjectURL(file);
  });
  const w = src.width; const h = src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

const STATUS_LABEL = {
  placed: 'Awaiting company approval', accepted: 'Accepted by the company', rejected: 'Rejected', cancelled: 'Cancelled',
  ready_for_pickup: 'Ready for pickup', assigned: 'Driver assigned', picked_up: 'On the way', delivered: 'Delivered',
  payment_received: 'Payment received', payment_reference: 'Transfer receipt added',
};
const statusLabel = (s) => (STATUS_LABEL[s] ? t(STATUS_LABEL[s]) : s);
const statusPill = (s) => `<span class="status ${esc(s)}">${esc(statusLabel(s))}</span>`;

const termsLabel = (o) => {
  if (o.payment_terms === 'full') return t('Full payment upfront');
  if (o.payment_terms === 'partial') return t('Deposit {pct}%, rest on delivery', { pct: o.supplier_deposit_percent ?? '' });
  return t('Credit, {days} days', { days: o.credit_days ?? '' });
};

/** Short payment state for lists and headers. */
function paymentPill(o) {
  if (['rejected', 'cancelled'].includes(o.status)) return '';
  if (o.paid_amount >= o.total) return `<span class="status delivered">${t('Paid in full')}</span>`;
  if (o.payment_terms === 'credit') {
    return `<span class="status assigned">${o.due_date ? t('Credit due {date}', { date: day(o.due_date) }) : t('On credit')}</span>`;
  }
  if (o.paid_amount >= o.upfront_required) return `<span class="status assigned">${t('Upfront payment received')}</span>`;
  return `<span class="status placed">${t('Awaiting payment')}</span>`;
}

// ---------------------------------------------------------------- api & feedback

/** Server rejections that carry numbers are explained with formatted amounts. */
function explain(details, fallback) {
  switch (details?.code) {
    case 'min_order_value': return t('The minimum order with this company is {amount}', { amount: money(details.value) });
    case 'credit_limit': return t('This order is above your remaining credit with this company ({amount})', { amount: money(details.remaining) });
    case 'payment_required': return t('Record the upfront payment first: {paid} of {required} received', { paid: money(details.paid), required: money(details.required) });
    case 'overpayment': return t('That is more than the amount still owed ({amount})', { amount: money(details.balance) });
    default: return I18N.tError(fallback);
  }
}

class ApiError extends Error {
  constructor(message, status, details) { super(message); this.status = status; this.details = details; }
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json', ...(state.token && { authorization: `Bearer ${state.token}` }) },
      body: body && JSON.stringify(body),
    });
  } catch {
    throw new ApiError(t('No connection. Check the internet and try again.'), 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) logout();
  if (!res.ok) throw new ApiError(data.error ? explain(data.details, data.error) : t('Request failed ({status})', { status: res.status }), res.status, data.details);
  return data;
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = 'toast'; }, isError ? 5000 : 3000);
}

/** Wrap an async handler: disable the control while it runs and show errors. */
function action(fn) {
  return async (ev) => {
    const btn = ev?.currentTarget instanceof HTMLFormElement ? ev.currentTarget.querySelector('[type=submit]') : ev?.currentTarget;
    if (btn) btn.disabled = true;
    try { await fn(ev); } catch (e) { toast(e.message, true); } finally { if (btn && btn.isConnected) btn.disabled = false; }
  };
}

function logout() {
  state.token = null; state.user = null;
  localSet('maa.token', null);
  location.hash = '#login';
  render();
}

// ---------------------------------------------------------------- routing

const NAV = {
  pharmacy: [['#new', 'New order'], ['#orders', 'My orders']],
  supplier: [['#incoming', 'Orders'], ['#products', 'Products'], ['#import', 'Update products'], ['#settings', 'Payment & API']],
  driver: [['#jobs', 'Available jobs'], ['#my-deliveries', 'My deliveries']],
  admin: [['#admin', 'Verification'], ['#orders', 'All orders']],
};
const HOME = { pharmacy: '#new', supplier: '#incoming', driver: '#jobs', admin: '#admin' };
const ACTIVE_NAV = { shop: '#new', checkout: '#new', order: null };

async function render() {
  clearInterval(state.refreshTimer);
  const seq = ++render.seq;
  const view = $('#view');
  I18N.apply();
  // Routes are '#name' or '#name-12' so they survive being shared as a link.
  const h = location.hash.replace(/^#\/?/, '');
  const m = h.match(/^(order|shop|checkout)-(\d+)$/);
  const [route, param] = m ? [m[1], m[2]] : [h, undefined];

  const langBtn = `<button class="link" id="lang">${I18N.lang === 'ar' ? 'English' : 'العربية'}</button>`;
  const bindLang = () => { $('#lang').onclick = () => { I18N.setLang(I18N.lang === 'ar' ? 'en' : 'ar'); render(); }; };

  renderGuide();
  if (!state.user) {
    $('#nav').innerHTML = ''; $('#who').innerHTML = langBtn; bindLang();
    if (SHARED) return state.sharedProblem ? renderSharedProblem(view) : renderRegister(view);
    return route === 'register' ? renderRegister(view) : renderLogin(view);
  }

  const u = state.user;
  const activeHref = ACTIVE_NAV[route] !== undefined ? ACTIVE_NAV[route] : `#${route}`;
  $('#nav').innerHTML = (NAV[u.role] || []).map(([href, label]) =>
    `<a href="${href}" class="${href === activeHref ? 'active' : ''}">${t(label)}</a>`).join('');
  $('#who').innerHTML = `<span class="name muted">${esc(u.organization?.name || u.name)}</span>${langBtn}${SHARED ? '' : `<button class="link" id="logout">${t('Log out')}</button>`}`;
  if (!SHARED) $('#logout').onclick = logout;
  bindLang();

  if ((u.organization && !u.organization.verified) || !u.approved) return renderPending(view);

  const routes = {
    new: renderChooseSupplier, shop: renderShop, checkout: renderCheckout,
    orders: renderOrders, order: renderOrderDetail, incoming: renderOrders, 'my-deliveries': renderOrders,
    products: renderProducts, import: renderImport, settings: renderSettings,
    jobs: renderJobs, admin: renderAdmin,
  };
  const fn = routes[route];
  if (!fn) { location.hash = HOME[u.role]; return; }
  // Each render builds a fresh page and only the newest one is shown, so a slow
  // earlier render can never overwrite the page the person has since moved to.
  const page = `${route}-${param ?? ''}`;
  if (render.page !== page) view.innerHTML = `<p class="muted">${t('Loading…')}</p>`;
  render.page = page;
  const next = document.createElement('main');
  next.id = 'view';
  next.className = 'view';
  try { await fn(next, param); } catch (e) { next.innerHTML = `<div class="card">${esc(e.message)}</div>`; }
  if (seq !== render.seq) return;
  $('#view').replaceWith(next);
  hydrateImages(next);
  highlightStep();
}

render.seq = 0;
window.addEventListener('hashchange', render);

// ---------------------------------------------------------------- sign in

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
  $$('[data-email]', view).forEach((b) => {
    b.onclick = action(async () => signedIn(await api('POST', '/api/auth/login', { email: b.dataset.email, password: 'password123' })));
  });
}

function renderRegister(view) {
  view.innerHTML = `
    <div class="auth card stack">
      <h1>${t(SHARED ? 'Welcome to Maa' : 'Create an account')}</h1>
      ${SHARED ? `<p class="callout small">${t('Create your account once. It is linked to the Claude account you are signed in with, so there is no password to remember.')}</p>` : ''}
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
        ${SHARED ? '' : `<label>${t('Password (min 8 characters)')}<input name="password" type="password" dir="ltr" minlength="8" required></label>`}
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
      ${SHARED ? '' : `<p class="small"><a href="#login">${t('Back to sign in')}</a></p>`}
    </div>`;
  const f = $('#f', view);
  $('#role', view).onchange = () => {
    const driver = $('#role', view).value === 'driver';
    $('#org', view).hidden = driver;
    $('#veh', view).hidden = !driver;
    $$('input[name=org_name], input[name=license_no], input[name=address]', view).forEach((i) => { i.required = !driver; });
  };
  f.onsubmit = action(async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    // In the shared pilot the Claude account is the login; the password is never used.
    const password = SHARED ? Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('') : d.password;
    const body = { role: d.role, name: d.name, email: d.email, phone: d.phone, password, vehicle: d.vehicle };
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
  $('#check', view).onclick = action(async () => { state.user = (await api('GET', '/api/me')).user; render(); });
}

// ---------------------------------------------------------------- pharmacy: new order

/** The three steps of placing an order, shown at the top of each step. */
function orderSteps(current, supplierId) {
  const steps = [
    ['Choose the company', '#new'],
    ['Choose products', supplierId ? `#shop-${supplierId}` : null],
    ['Payment and confirm', null],
  ];
  return `<ol class="wizard" aria-label="${t('New order')}">${steps.map(([label, href], i) => {
    const cls = i < current ? 'done' : i === current ? 'current' : '';
    const inner = `<span class="num">${i < current ? '✓' : i + 1}</span><span>${t(label)}</span>`;
    return `<li class="${cls}">${i < current && href ? `<a href="${href}">${inner}</a>` : inner}</li>`;
  }).join('')}</ol>`;
}

function termsBadges(policy) {
  const out = [];
  if (policy.allow_full) out.push(t('Full payment'));
  if (policy.allow_partial) out.push(t('Deposit {pct}%', { pct: policy.deposit_percent }));
  if (policy.allow_credit) out.push(t('Credit {days} days', { days: policy.credit_days }));
  return out.map((x) => `<span class="tag">${esc(x)}</span>`).join('');
}

const draftCount = (sid) => Object.values(state.drafts[sid] || {}).filter((q) => q > 0).length;

async function renderChooseSupplier(view) {
  const { suppliers } = await api('GET', '/api/suppliers');
  view.innerHTML = `
    ${orderSteps(0)}
    <h1>${t('Which company do you want to order from?')}</h1>
    <input id="q" class="search" type="search" placeholder="${t('Search companies')}" aria-label="${t('Search companies')}">
    <div class="supplier-list" id="list">
      ${suppliers.map((s) => `
        <a class="card supplier-card" href="#shop-${s.id}" data-name="${esc(s.name.toLowerCase())}">
          <div class="row spread">
            <strong class="supplier-name">${esc(s.name)}</strong>
            ${draftCount(s.id) ? `<span class="status assigned">${t('Draft: {n} items', { n: draftCount(s.id) })}</span>` : ''}
          </div>
          <div class="small muted">${esc(s.city || '')} · ${t('{n} products', { n: s.product_count })}${s.products_updated_at ? ` · ${t('Prices updated {date}', { date: day(s.products_updated_at) })}` : ''}</div>
          <div class="row small">${termsBadges(s.policy)}</div>
          <div class="small muted">
            ${s.policy.min_order_value ? t('Minimum order {amount}', { amount: money(s.policy.min_order_value) }) : t('No minimum order')}
            ${s.credit ? ` · ${t('Your available credit: {amount}', { amount: money(s.credit.remaining) })}` : ''}
          </div>
          <span class="go">${t('Open products')} ${I18N.lang === 'ar' ? '←' : '→'}</span>
        </a>`).join('') || `<div class="card empty">${t('No companies are available yet.')}</div>`}
    </div>`;
  $('#q', view).oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('.supplier-card', view).forEach((c) => { c.hidden = q && !c.dataset.name.includes(q); });
  };
}

/** Company catalogue with quantity steppers; the draft is saved as you type. */
async function renderShop(view, sid) {
  const { supplier: s, products } = await api('GET', `/api/suppliers/${sid}`);
  const draft = (state.drafts[sid] ||= {});
  for (const pid of Object.keys(draft)) if (!products.some((p) => String(p.id) === pid)) delete draft[pid]; // no longer sold
  saveDrafts();
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

  view.innerHTML = `
    ${orderSteps(1, sid)}
    <div class="shop-head">
      <div>
        <h1>${esc(s.name)}</h1>
        <div class="row small">${termsBadges(s.policy)}
          ${s.policy.min_order_value ? `<span class="muted">${t('Minimum order {amount}', { amount: money(s.policy.min_order_value) })}</span>` : ''}</div>
      </div>
      <a href="#new" class="small">${t('Change company')}</a>
    </div>
    <div class="shop-tools">
      <div class="quick-add">
        <label class="btn tool" for="photoFile">${ICON.camera}<span>${t('Order by photo')}</span></label>
        <input type="file" id="photoFile" accept="image/*" hidden>
        <button class="tool" id="scanBtn">${ICON.barcode}<span>${t('Scan barcode')}</span></button>
      </div>
      <input id="q" class="search" type="search" enterkeyhint="search" placeholder="${t('Search by name, or scan a barcode')}" aria-label="${t('Search')}">
      ${categories.length > 1 ? `<div class="chips" id="cats"><button class="chip on" data-cat="">${t('All')}</button>${categories.map((c) => `<button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="product-list" id="plist">
      ${products.map((p) => `
        <div class="prow" data-pid="${p.id}" data-search="${esc([p.name, p.generic_name, p.sku, p.barcode].join(' ').toLowerCase())}" data-cat="${esc(p.category || '')}">
          ${thumb(p)}
          <div class="pinfo">
            <div><strong>${nm(p.name)}</strong> <span class="muted">${esc(p.strength || '')}</span>
              ${p.cold_chain ? `<span class="tag cold">${t('Cold chain')}</span>` : ''}</div>
            <div class="small muted">${esc([p.generic_name, p.form, p.pack_size].filter(Boolean).join(' · '))}</div>
            <div class="small"><span class="price">${money(p.price)}</span>
              <span class="muted">· ${p.stock > 0 ? t('{n} in stock', { n: p.stock }) : t('Out of stock')} · ${t('min {n}', { n: p.min_order_qty })}</span></div>
            <div class="small err" data-err></div>
          </div>
          <div class="pqty" data-qtybox></div>
        </div>`).join('') || `<div class="card empty">${t('This company has no products listed yet.')}</div>`}
    </div>
    <div class="cartbar" id="cartbar"></div>`;

  const byId = new Map(products.map((p) => [String(p.id), p]));
  const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode, p]));
  const rowOf = (p) => $(`.prow[data-pid="${p.id}"]`, view);
  const problem = (p, q) => (q > 0 && q < p.min_order_qty ? t('Minimum order is {n}', { n: p.min_order_qty })
    : q > p.stock ? t('Only {n} in stock', { n: p.stock }) : '');

  const drawRow = (row) => {
    const p = byId.get(row.dataset.pid);
    const q = draft[p.id] || 0;
    const box = $('[data-qtybox]', row);
    if (!q) {
      box.innerHTML = `<button class="primary" data-add ${p.stock < p.min_order_qty ? 'disabled' : ''}>${p.stock < p.min_order_qty ? t('Out of stock') : t('Add')}</button>`;
    } else {
      box.innerHTML = `<div class="stepper">
          <button data-step="-1" aria-label="${t('Less')}">−</button>
          <input data-qty inputmode="numeric" value="${q}" aria-label="${t('Quantity')}">
          <button data-step="1" aria-label="${t('More')}">+</button></div>`;
    }
    $('[data-err]', row).textContent = problem(p, q);
    row.classList.toggle('in', q > 0);
  };

  const drawBar = () => {
    const lines = Object.entries(draft).filter(([, q]) => q > 0).map(([pid, q]) => ({ p: byId.get(pid), q }));
    const subtotal = lines.reduce((sum, l) => sum + l.p.price * l.q, 0);
    const invalid = lines.some((l) => problem(l.p, l.q));
    const short = s.policy.min_order_value - subtotal;
    const bar = $('#cartbar', view);
    bar.hidden = !lines.length;
    bar.innerHTML = `
      <div class="cartbar-inner">
        <div><strong>${t('{n} items', { n: lines.length })} · ${money(subtotal)}</strong>
          <div class="small">${invalid ? `<span class="err">${t('Fix the highlighted quantities')}</span>`
            : short > 0 ? t('Add {amount} more to reach the minimum order', { amount: money(short) }) : t('Delivery fee {amount} is added at checkout', { amount: money(state.config.deliveryFee) })}</div>
        </div>
        <button class="primary" id="continue" ${invalid || short > 0 ? 'disabled' : ''}>${t('Continue to payment')}</button>
      </div>`;
    $('#continue', bar).onclick = () => { location.hash = `#checkout-${sid}`; };
    highlightStep();
  };

  const setQty = (p, q) => {
    if (q > 0) draft[p.id] = q; else delete draft[p.id];
    saveDrafts();
    drawRow(rowOf(p)); drawBar();
  };
  const flash = (p) => {
    const row = rowOf(p);
    row.hidden = false;
    row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
  };
  /** Add one scanned or recognised product: its minimum the first time, one more after that. */
  const addOne = (p) => {
    const cur = draft[p.id] || 0;
    setQty(p, cur ? cur + 1 : p.min_order_qty);
    flash(p);
    return draft[p.id];
  };

  /** A scanned barcode: add it if this company sells it, otherwise say who does. */
  const onBarcode = async (raw) => {
    const code = MaaImport.toLatinDigits(String(raw)).replace(/\D/g, '');
    const p = byBarcode.get(code);
    if (p) {
      const q = addOne(p);
      toast(t('Added {name} · quantity {n}', { name: p.name, n: q }));
      if (navigator.vibrate) navigator.vibrate(60);
      return p;
    }
    const others = (await api('GET', `/api/products?barcode=${encodeURIComponent(code)}`).catch(() => ({ products: [] }))).products;
    toast(others.length
      ? t('{name} is not sold by this company. Available from: {companies}', { name: others[0].name, companies: [...new Set(others.map((o) => o.supplier_name))].join('، ') })
      : t('No product with barcode {code}', { code }), true);
    return null;
  };

  $$('.prow', view).forEach((row) => {
    drawRow(row);
    row.addEventListener('click', (e) => {
      const p = byId.get(row.dataset.pid);
      if (e.target.closest('[data-add]')) { setQty(p, p.min_order_qty); $('[data-qty]', row)?.focus(); }
      const step = e.target.closest('[data-step]');
      if (step) {
        const cur = draft[p.id] || 0;
        let next = cur + Number(step.dataset.step);
        if (next > 0 && next < p.min_order_qty) next = step.dataset.step < 0 ? 0 : p.min_order_qty;
        setQty(p, Math.max(0, next));
      }
    });
    row.addEventListener('change', (e) => {
      if (!e.target.matches('[data-qty]')) return;
      const q = toInt(e.target.value);
      if (Number.isNaN(q) || q < 0) { toast(t('Enter a whole number'), true); drawRow(row); return; }
      setQty(byId.get(row.dataset.pid), q);
    });
  });

  let cat = '';
  const search = $('#q', view);
  const filter = () => {
    const q = search.value.trim().toLowerCase();
    $$('.prow', view).forEach((r) => { r.hidden = (q && !r.dataset.search.includes(q)) || (cat && r.dataset.cat !== cat); });
  };
  search.oninput = filter;
  // Handheld scanners type the code and press Enter.
  search.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const v = MaaImport.toLatinDigits(search.value.trim());
    if (/^\d{8,14}$/.test(v)) { e.preventDefault(); onBarcode(v); search.value = ''; filter(); }
  };
  $$('#cats [data-cat]', view).forEach((b) => {
    b.onclick = () => { cat = b.dataset.cat; $$('#cats [data-cat]', view).forEach((x) => x.classList.toggle('on', x === b)); filter(); };
  });

  $('#scanBtn', view).onclick = () => openScanner(onBarcode);
  $('#photoFile', view).onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) openPhotoOrder(s, file, { draft, byId, setQty, flash, drawBar });
  };
  drawBar();
}

// ---------------------------------------------------------------- order by photo

/** Send a photo, then let the pharmacist confirm what to add. Nothing is added without a tap. */
async function openPhotoOrder(s, file, shop) {
  const sheet = openSheet(`
    <h2>${t('Order by photo')}</h2>
    <div class="photo-wrap"><img id="photoPrev" alt="${t('Your photo')}"></div>
    <div id="photoBody" class="stack"><p class="muted">${t('Reading the photo… this can take up to a minute.')}</p></div>`);
  const prev = $('#photoPrev', sheet.el);
  prev.src = URL.createObjectURL(file);
  let result;
  try {
    const image = await shrinkImage(file);
    result = await api('POST', `/api/suppliers/${s.id}/recognize`, { image });
  } catch (e) {
    if (!sheet.open()) return;
    const code = e.details?.code;
    $('#photoBody', sheet.el).innerHTML = `<p class="err">${esc(code === 'recognition_unavailable' ? t('Order by photo is not set up yet. Ask the Maa team to turn it on.')
      : code === 'not_granted' ? t('Photo reading needs your permission to use Claude. Allow it and try again.') : e.message)}</p>
      <div class="row"><button id="closeSheet">${t('Close')}</button></div>`;
    $('#closeSheet', sheet.el).onclick = sheet.close;
    return;
  }
  if (!sheet.open()) return;
  const { matches, not_found: notFound } = result;
  const body = $('#photoBody', sheet.el);
  body.innerHTML = `
    ${matches.length ? `<p>${t('Found {n} products from {company}. Check the quantities, then add them.', { n: matches.length, company: esc(s.name) })}</p>
      <div class="found-list">${matches.map((m) => {
        const p = m.product;
        const q = m.quantity || shop.draft[p.id] || p.min_order_qty;
        return `<label class="found ${m.confidence}">
          <input type="checkbox" data-pick="${p.id}" ${m.confidence === 'low' ? '' : 'checked'}>
          ${thumb(p, 'sm')}
          <span class="pinfo"><strong>${nm(p.name)}</strong> <span class="small muted">${esc([p.strength, p.pack_size].filter(Boolean).join(' · '))}</span>
            ${m.confidence !== 'high' ? `<span class="small warn-text">${t('Check this: read as “{seen}”', { seen: esc(m.name_seen) })}</span>` : ''}</span>
          <input class="qty-in" data-pq="${p.id}" inputmode="numeric" value="${q}" aria-label="${t('Quantity')}">
        </label>`;
      }).join('')}</div>` : `<p>${t('No products from {company} were recognised in this photo.', { company: esc(s.name) })}</p>`}
    ${notFound.length ? `<div class="small"><strong>${t('Not sold by this company:')}</strong> ${notFound.map(esc).join('، ')}</div>` : ''}
    <div class="row">
      ${matches.length ? `<button class="primary" id="addFound">${t('Add selected to the order')}</button>` : ''}
      <button id="closeSheet">${t(matches.length ? 'Cancel' : 'Close')}</button>
    </div>`;
  hydrateImages(body);
  $('#closeSheet', sheet.el).onclick = sheet.close;
  const add = $('#addFound', sheet.el);
  if (add) {
    add.onclick = () => {
      let n = 0;
      for (const box of $$('[data-pick]:checked', sheet.el)) {
        const p = shop.byId.get(box.dataset.pick);
        const q = toInt($(`[data-pq="${p.id}"]`, sheet.el).value);
        if (!(q > 0)) continue;
        shop.setQty(p, Math.max(q, p.min_order_qty));
        n += 1;
      }
      sheet.close();
      toast(t('Added {n} products to the order', { n }));
    };
  }
}

// ---------------------------------------------------------------- barcode scanning

const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
let zxingLoading;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingLoading ||= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = ZXING_URL; sc.onload = () => resolve(window.ZXing); sc.onerror = () => { zxingLoading = null; reject(new Error('zxing')); };
    document.head.append(sc);
  });
  return zxingLoading;
}
async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = BARCODE_FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new BarcodeDetector({ formats }) : null;
  } catch { return null; }
}

/** Read a barcode from a still photo (works where the live camera is not allowed). */
async function decodePhoto(file) {
  const det = await nativeDetector();
  if (det) {
    const found = await det.detect(await createImageBitmap(file)).catch(() => []);
    if (found[0]) return found[0].rawValue;
  }
  const ZX = await loadZxing();
  const url = URL.createObjectURL(file);
  try {
    const r = await new ZX.BrowserMultiFormatReader().decodeFromImageUrl(url);
    return r.getText();
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** Live camera scanning, with a "photograph the barcode" fallback. */
function openScanner(onCode) {
  const sheet = openSheet(`
    <h2>${t('Scan barcode')}</h2>
    <div class="scan-wrap" id="scanWrap" hidden><video id="scanVideo" playsinline muted></video><span class="scan-line"></span></div>
    <p class="small muted" id="scanMsg">${t('Starting the camera…')}</p>
    <div class="row">
      <label class="btn" for="barPhoto">${ICON.camera}<span>${t('Photograph the barcode')}</span></label>
      <input type="file" id="barPhoto" accept="image/*" capture="environment" hidden>
      <button id="closeSheet">${t('Done')}</button>
    </div>
    <ul class="plain small" id="scanned"></ul>`);
  const el = sheet.el;
  const msg = $('#scanMsg', el);
  let stream = null; let timer = null; let zxReader = null; let last = ''; let lastAt = 0;
  const stop = () => {
    clearInterval(timer);
    zxReader?.reset();
    stream?.getTracks().forEach((tr) => tr.stop());
  };
  sheet.onClose(stop);
  $('#closeSheet', el).onclick = sheet.close;

  const got = async (code) => {
    if (!code || (code === last && Date.now() - lastAt < 2500)) return;
    last = code; lastAt = Date.now();
    const p = await onCode(code);
    $('#scanned', el).insertAdjacentHTML('afterbegin', `<li>${p ? `✓ ${nm(p.name)}` : `<span class="err">✗ ${ltr(code)}</span>`}</li>`);
  };

  $('#barPhoto', el).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    msg.textContent = t('Reading the barcode…');
    try {
      const code = await decodePhoto(file);
      msg.textContent = code ? t('Barcode read: {code}', { code }) : t('No barcode found. Hold the phone closer, in good light, and try again.');
      if (code) got(code);
    } catch {
      msg.textContent = t('The barcode reader did not load. Check the internet connection.');
    }
  };

  (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (!sheet.open()) { stop(); return; }
      const video = $('#scanVideo', el);
      video.srcObject = stream;
      await video.play();
      $('#scanWrap', el).hidden = false;
      msg.textContent = t('Point the camera at the barcode on the pack.');
      const det = await nativeDetector();
      if (det) {
        timer = setInterval(async () => {
          const found = await det.detect(video).catch(() => []);
          if (found[0]) got(found[0].rawValue);
        }, 250);
      } else {
        const ZX = await loadZxing();
        zxReader = new ZX.BrowserMultiFormatReader();
        stream.getTracks().forEach((tr) => tr.stop()); // ZXing opens its own stream
        zxReader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (r) => { if (r) got(r.getText()); });
      }
    } catch {
      if (sheet.open()) msg.textContent = t('The camera is not available here. Photograph the barcode instead, or use a handheld scanner in the search box.');
    }
  })();
}

// ---------------------------------------------------------------- bottom sheet

/** A simple modal panel. Returns { el, close, open(), onClose(fn) }. */
function openSheet(html) {
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(back);
  let isOpen = true; const closers = [];
  const close = () => { if (!isOpen) return; isOpen = false; closers.forEach((f) => f()); back.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  setTimeout(() => back.querySelector('button, [href], input, label.btn')?.focus(), 0);
  return { el: back.querySelector('.sheet'), close, open: () => isOpen, onClose: (f) => closers.push(f) };
}

const ICON = {
  camera: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  barcode: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6v12M7 6v12M11 6v12M14 6v12M17 6v12M20 6v12"/></svg>',
};

async function renderCheckout(view, sid) {
  const { supplier: s, products } = await api('GET', `/api/suppliers/${sid}`);
  const draft = state.drafts[sid] || {};
  const lines = products.filter((p) => draft[p.id] > 0).map((p) => ({ p, q: draft[p.id] }));
  if (!lines.length) { location.hash = `#shop-${sid}`; return; }
  const subtotal = lines.reduce((sum, l) => sum + l.p.price * l.q, 0);
  const fee = state.config.deliveryFee;
  const total = subtotal + fee;
  const options = MaaPayment.paymentOptions(s.policy, total, s.credit?.outstanding || 0);
  let chosen = (options.find((o) => o.available) || {}).terms;

  const optionText = (o) => {
    if (o.terms === 'full') return { title: t('Pay the full amount now'), detail: t('Pay now: {amount}', { amount: money(o.upfront) }) };
    if (o.terms === 'partial') return { title: t('Deposit {pct}% now, the rest on delivery', { pct: o.percent }), detail: t('Now: {now} · On delivery: {later}', { now: money(o.upfront), later: money(o.later) }) };
    return {
      title: t('Credit: pay within {days} days of delivery', { days: o.days }),
      detail: o.available ? t('Nothing to pay now · Your available credit: {amount}', { amount: money(o.remaining) })
        : t('Not available: this order is above your available credit ({amount})', { amount: money(o.remaining) }),
    };
  };

  view.innerHTML = `
    ${orderSteps(2, sid)}
    <h1>${t('Review and pay')}</h1>
    <div class="checkout">
      <div class="stack">
        <div class="card stack">
          <div class="row spread"><h2>${esc(s.name)}</h2><a href="#shop-${sid}" class="small">${t('Edit items')}</a></div>
          <div class="table-wrap"><table>
            <tr><th>${t('Product')}</th><th>${t('Qty')}</th><th>${t('Total')}</th></tr>
            ${lines.map((l) => `<tr><td><div class="with-thumb">${thumb(l.p, 'sm')}<div>${nm(l.p.name)} <span class="small muted">${esc([l.p.strength, l.p.pack_size].filter(Boolean).join(' · '))}</span>
              <div class="small muted">${money(l.p.price)}</div></div></div></td><td>${l.q}</td><td>${money(l.p.price * l.q)}</td></tr>`).join('')}
          </table></div>
          <div class="totals">
            <div class="row spread"><span>${t('Products')}</span><span>${money(subtotal)}</span></div>
            <div class="row spread"><span>${t('Delivery')}</span><span>${money(fee)}</span></div>
            <div class="row spread grand"><strong>${t('Total')}</strong><strong>${money(total)}</strong></div>
          </div>
        </div>
      </div>
      <div class="stack">
        <fieldset class="card stack pay-options">
          <legend><h2>${t('How will you pay?')}</h2></legend>
          <p class="small muted">${t('These are the payment options {company} offers.', { company: esc(s.name) })}</p>
          ${options.map((o) => { const x = optionText(o); return `
            <label class="pay-option ${o.available ? '' : 'disabled'}">
              <input type="radio" name="terms" value="${o.terms}" ${o.available ? '' : 'disabled'} ${o.terms === chosen ? 'checked' : ''}>
              <span><strong>${x.title}</strong><span class="small ${o.available ? 'muted' : 'err'}">${x.detail}</span></span>
            </label>`; }).join('')}
          <div id="bank"></div>
        </fieldset>
        <div class="card stack">
          <label>${t('Notes for the company (optional)')}<textarea id="notes" rows="2" maxlength="500"></textarea></label>
          <button class="primary big" id="sendOrder" ${chosen ? '' : 'disabled'}>${t('Send order to the company')}</button>
          <p class="small muted">${t('The company reviews the order and confirms your payment. Then it is packed and sent with a driver, and you can follow it under My orders.')}</p>
        </div>
      </div>
    </div>`;

  const drawBank = () => {
    const o = options.find((x) => x.terms === chosen);
    $('#bank', view).innerHTML = o && o.upfront > 0 ? `
      <div class="callout stack small">
        <strong>${t('Transfer {amount} to the company', { amount: money(o.upfront) })}</strong>
        ${s.policy.bank_details ? `<div class="pre">${esc(s.policy.bank_details)}</div>` : `<div class="muted">${t('The company will send you its bank details.')}</div>`}
        <label>${t('Transfer receipt number (optional, you can add it later)')}<input id="ref" dir="ltr" maxlength="100"></label>
      </div>` : '';
  };
  drawBank();
  $$('input[name=terms]', view).forEach((r) => { r.onchange = () => { chosen = r.value; drawBank(); }; });

  $('#sendOrder', view).onclick = action(async () => {
    const { order } = await api('POST', '/api/orders', {
      supplier_id: Number(sid),
      items: lines.map((l) => ({ product_id: l.p.id, qty: l.q })),
      payment_terms: chosen,
      payment_reference: $('#ref', view)?.value.trim() || undefined,
      notes: $('#notes', view).value.trim() || undefined,
    });
    delete state.drafts[sid]; saveDrafts();
    toast(t('Your order was sent to the company'));
    location.hash = `#order-${order.id}`;
  });
}

// ---------------------------------------------------------------- order lists

const ORDER_TABS = {
  pharmacy: [['Active', 'placed,accepted,ready_for_pickup,assigned,picked_up'], ['Delivered', 'delivered'], ['Closed', 'rejected,cancelled'], ['All', '']],
  supplier: [['New', 'placed'], ['To pack', 'accepted'], ['Awaiting driver', 'ready_for_pickup'], ['In transit', 'assigned,picked_up'], ['Done', 'delivered,rejected,cancelled'], ['All', '']],
  driver: [['Current', 'assigned,picked_up'], ['Completed', 'delivered'], ['All', '']],
  admin: [['Active', 'placed,accepted,ready_for_pickup,assigned,picked_up'], ['All', '']],
};
const tabState = readJson('maa.tabs', {});

async function renderOrders(view) {
  const role = state.user.role;
  const tabs = ORDER_TABS[role];
  const tab = tabState[role] ?? 0;
  const { orders } = await api('GET', `/api/orders?status=${tabs[tab][1]}`);
  const title = t({ pharmacy: 'My orders', supplier: 'Incoming orders', driver: 'My deliveries', admin: 'All orders' }[role]);
  const who = (o) => (role === 'pharmacy' ? o.supplier_name : role === 'supplier' ? o.pharmacy_name : `${o.supplier_name} ${I18N.lang === 'ar' ? '←' : '→'} ${o.pharmacy_name}`);

  view.innerHTML = `
    <div class="row spread"><h1>${title}</h1>${role === 'pharmacy' ? `<a class="btn primary" href="#new">+ ${t('New order')}</a>` : ''}</div>
    <div class="tabs">${tabs.map(([l], i) => `<button data-tab="${i}" class="${i === tab ? 'on' : ''}">${t(l)}</button>`).join('')}</div>
    ${orders.length ? `<div class="order-list">${orders.map((o) => `
      <a class="card order-card" href="#order-${o.id}">
        <div class="row spread"><strong>${t('Order #{id}', { id: o.id })} · ${esc(who(o))}</strong>${statusPill(o.status)}</div>
        <div class="row spread small">
          <span class="muted">${t('{n} items', { n: o.item_count })} · ${when(o.updated_at)}</span>
          <span class="row"><strong>${money(o.total)}</strong>${role !== 'driver' ? paymentPill(o) : ''}</span>
        </div>
      </a>`).join('')}</div>` : `<div class="card empty">${t('Nothing here yet.')}${role === 'pharmacy' ? ` <a href="#new">${t('Start a new order')}</a>` : ''}</div>`}`;

  $$('[data-tab]', view).forEach((b) => {
    b.onclick = () => { tabState[role] = Number(b.dataset.tab); localSet('maa.tabs', JSON.stringify(tabState)); render(); };
  });
  state.refreshTimer = setInterval(() => { if (!document.hidden) render(); }, 20000);
}

// ---------------------------------------------------------------- order detail

const PROGRESS = [
  ['placed', 'Sent'], ['accepted', 'Accepted'], ['ready_for_pickup', 'Packed'], ['picked_up', 'On the way'], ['delivered', 'Delivered'],
];
const PROGRESS_RANK = { placed: 0, accepted: 1, ready_for_pickup: 2, assigned: 2, picked_up: 3, delivered: 4 };

function progressBar(o) {
  if (['rejected', 'cancelled'].includes(o.status)) return '';
  const r = PROGRESS_RANK[o.status];
  return `<ol class="progress">${PROGRESS.map(([, label], i) =>
    `<li class="${i < r || (i === r && o.status === 'delivered') ? 'done' : i === r ? 'current' : ''}"><span class="dot"></span><span>${t(label)}</span></li>`).join('')}</ol>`;
}

const PAY_METHOD = { bank_transfer: 'Bank transfer', cash: 'Cash', cheque: 'Cheque', card: 'Card', other: 'Other' };

function paymentPanel(o, role) {
  const closed = ['rejected', 'cancelled'].includes(o.status);
  const owedNow = Math.max(0, o.upfront_required - o.paid_amount);
  const rows = [
    [t('Payment terms'), termsLabel(o)],
    [t('Order total'), money(o.total)],
    o.upfront_required ? [t('Due before dispatch'), money(o.upfront_required)] : null,
    [t('Received by the company'), money(o.paid_amount)],
    [t('Remaining'), `<strong>${money(o.balance)}</strong>`],
    o.collect_on_delivery && role !== 'supplier' ? [t('Paid to the driver on delivery'), money(o.collect_on_delivery)] : null,
    o.due_date ? [t('Credit due date'), day(o.due_date)] : null,
    o.payment_reference ? [t('Transfer receipt no.'), ltr(o.payment_reference)] : null,
  ].filter(Boolean);

  let extra = '';
  if (!closed && role === 'pharmacy' && owedNow > 0) {
    extra = `
      <div class="callout stack small">
        <strong>${t('Transfer {amount} so the company can send your order', { amount: money(owedNow) })}</strong>
        ${o.supplier_bank_details ? `<div class="pre">${esc(o.supplier_bank_details)}</div>` : ''}
        <form id="refForm" class="row">
          <input id="refInput" dir="ltr" maxlength="100" placeholder="${t('Transfer receipt number')}" value="${esc(o.payment_reference || '')}" required>
          <button type="submit">${t(o.payment_reference ? 'Update receipt number' : 'Add receipt number')}</button>
        </form>
      </div>`;
  }
  if (!closed && role === 'supplier' && o.status !== 'placed' && o.balance > 0) {
    const suggest = owedNow > 0 ? owedNow : o.balance;
    extra = `
      <form id="payForm" class="stack pay-form">
        <strong>${t('Record a payment you received')}</strong>
        ${owedNow > 0 ? `<div class="small warn-text">${t('{amount} must be received before you can dispatch this order.', { amount: money(owedNow) })}</div>` : ''}
        <div class="form-grid">
          <label>${t('Amount ({currency})', { currency: esc(state.config.currency) })}<input id="payAmount" inputmode="decimal" dir="ltr" value="${(suggest / 100).toFixed(2)}" required></label>
          <label>${t('Method')}<select id="payMethod">
            ${['bank_transfer', 'cash', 'cheque', 'card', 'other'].map((m) => `<option value="${m}">${t(PAY_METHOD[m])}</option>`).join('')}
          </select></label>
          <label>${t('Reference (optional)')}<input id="payRef" dir="ltr" maxlength="100" value="${esc(o.payment_reference || '')}"></label>
        </div>
        <button class="primary" type="submit">${t('Record payment')}</button>
      </form>`;
  }

  return `
    <div class="card stack">
      <div class="row spread"><h2>${t('Payment details')}</h2>${paymentPill(o)}</div>
      <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${o.payments.length ? `<div class="small"><strong>${t('Payments received')}</strong>
        <ul class="plain">${o.payments.map((p) => `<li>${money(p.amount)} · ${t(PAY_METHOD[p.method] || p.method)}${p.reference ? ` · ${ltr(p.reference)}` : ''} <span class="muted">· ${when(p.created_at)}</span></li>`).join('')}</ul></div>` : ''}
      ${extra}
    </div>`;
}

async function renderOrderDetail(view, id) {
  const { order: o } = await api('GET', `/api/orders/${encodeURIComponent(id)}`);
  const role = state.user.role;
  const backHref = { pharmacy: '#orders', supplier: '#incoming', driver: o.driver_id ? '#my-deliveries' : '#jobs', admin: '#orders' }[role];
  const owedNow = Math.max(0, o.upfront_required - o.paid_amount);

  const actions = [];
  if (role === 'supplier') {
    if (o.status === 'placed') actions.push(`<button class="primary" data-act="accept">${t('Accept order and payment terms')}</button>`, `<button class="danger" data-act="reject">${t('Reject')}</button>`);
    if (o.status === 'accepted') {
      actions.push(owedNow > 0
        ? `<button class="primary" disabled>${t('Packed · ready for pickup')}</button><span class="small warn-text">${t('Record the upfront payment below first')}</span>`
        : `<button class="primary" data-act="ready">${t('Packed · ready for pickup')}</button>`);
    }
    if (['accepted', 'ready_for_pickup'].includes(o.status)) actions.push(`<button class="danger" data-act="cancel">${t('Cancel order')}</button>`);
  }
  if (role === 'pharmacy' && o.status === 'placed') actions.push(`<button class="danger" data-act="cancel">${t('Cancel order')}</button>`);
  if (role === 'driver') {
    if (o.status === 'ready_for_pickup') actions.push(`<button class="primary" data-act="claim">${t('Take this delivery')}</button>`);
    if (o.status === 'assigned') actions.push(`<button class="primary" data-act="pickup">${t('Collected from supplier')}</button>`, `<button data-act="release">${t('Give up job')}</button>`);
    if (o.status === 'picked_up') {
      actions.push(`
        <form id="deliver" class="row">
          <input name="code" inputmode="numeric" maxlength="6" dir="ltr" placeholder="${t('6-digit code from pharmacy')}" required style="max-width:240px">
          <button class="primary" type="submit">${t('Confirm delivery')}</button>
        </form>`);
    }
  }
  const nextHint = {
    pharmacy: { placed: 'The company is reviewing your order.', accepted: owedNow > 0 ? 'Waiting for the company to confirm your payment.' : 'The company is packing your order.', ready_for_pickup: 'Waiting for a driver to collect it.' },
    supplier: { placed: 'Check the items and payment terms, then accept or reject.' },
  }[role]?.[o.status];
  const showCode = role === 'pharmacy' && ['assigned', 'picked_up'].includes(o.status) && o.delivery_code;

  view.innerHTML = `
    <p><a href="${backHref}">${I18N.lang === 'ar' ? '→' : '←'} ${t('Back')}</a></p>
    <div class="row spread"><h1>${t('Order #{id}', { id: o.id })}</h1>${statusPill(o.status)}</div>
    ${progressBar(o)}
    <div class="stack">
      ${nextHint ? `<div class="callout small">${t(nextHint)}</div>` : ''}
      ${showCode ? `
        <div class="callout stack">
          <div><strong>${t('Your delivery code')}</strong> · ${t('give this to the driver when the goods arrive')}</div>
          <div class="code" dir="ltr">${esc(o.delivery_code)}</div>
        </div>` : ''}
      ${role === 'driver' && o.collect_on_delivery ? `<div class="callout"><strong>${t('Collect {amount} in cash from the pharmacy', { amount: money(o.collect_on_delivery) })}</strong></div>` : ''}
      ${actions.length ? `<div class="card row actions">${actions.join('')}</div>` : ''}
      ${role !== 'driver' ? paymentPanel(o, role) : ''}
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
          ${o.driver_name ? `<div><strong>${esc(o.driver_name)}</strong> ${o.driver_vehicle ? `· ${esc(o.driver_vehicle)}` : ''}</div>${phone(o.driver_phone)}`
            : `<div class="muted">${t('Not assigned yet')}</div>`}
        </div>
      </div>
      <div class="card table-wrap">
        <h2>${t('Items')}</h2>
        <table>
          <tr><th>${t('Product')}</th><th>${t('Unit')}</th><th>${t('Qty')}</th><th>${t('Total')}</th></tr>
          ${o.items.map((i) => `<tr><td><div class="with-thumb">${thumb(i, 'sm')}<span>${esc(i.name)}</span></div></td><td>${money(i.unit_price)}</td><td>${i.qty}</td><td>${money(i.line_total)}</td></tr>`).join('')}
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
              ${e.note ? `<div class="small">${e.status === 'payment_received' ? money(Number(e.note)) : esc(I18N.tNote(e.note))}</div>` : ''}</li>`).join('')}
        </ul>
      </div>
    </div>`;

  const ORDER_ACTIONS = { accept: 'orders', reject: 'orders', ready: 'orders', cancel: 'orders', claim: 'deliveries', pickup: 'deliveries', release: 'deliveries' };
  const send = async (act, body = {}) => {
    await api('POST', `/api/${ORDER_ACTIONS[act]}/${o.id}/${act}`, body);
    toast(t('Status updated'));
    if (act === 'release') location.hash = '#jobs'; else render();
  };
  $$('[data-act]', view).forEach((b) => {
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
      $('#reasonForm', bar).onsubmit = action(async (ev) => {
        ev.preventDefault();
        await send(act, { reason: $('#reason', bar).value.trim() || undefined });
      });
    };
  });
  const df = $('#deliver', view);
  if (df) {
    df.onsubmit = action(async (ev) => {
      ev.preventDefault();
      const code = toInt(new FormData(df).get('code'));
      await api('POST', `/api/deliveries/${o.id}/deliver`, { code: Number.isNaN(code) ? 'x' : String(code).padStart(6, '0') });
      toast(t('Delivery confirmed'));
      render();
    });
  }
  const pf = $('#payForm', view);
  if (pf) {
    pf.onsubmit = action(async (ev) => {
      ev.preventDefault();
      const amount = toAmount($('#payAmount', pf).value);
      if (!(amount > 0)) throw new Error(t('Enter the amount received'));
      await api('POST', `/api/orders/${o.id}/payments`, { amount, method: $('#payMethod', pf).value, reference: $('#payRef', pf).value.trim() || undefined });
      toast(t('Payment recorded'));
      render();
    });
  }
  const rf = $('#refForm', view);
  if (rf) {
    rf.onsubmit = action(async (ev) => {
      ev.preventDefault();
      await api('POST', `/api/orders/${o.id}/payment-reference`, { reference: $('#refInput', rf).value.trim() });
      toast(t('Receipt number sent to the company'));
      render();
    });
  }
  if (!['delivered', 'rejected', 'cancelled'].includes(o.status)) {
    state.refreshTimer = setInterval(() => { if (!document.hidden && !document.activeElement?.closest('form')) render(); }, 15000);
  }
}

// ---------------------------------------------------------------- supplier: products

async function renderProducts(view) {
  const { products, updated_at: updatedAt } = await api('GET', '/api/supplier/products');
  const editing = renderProducts.editing;
  const e = editing === 'new' ? {} : editing ? products.find((p) => p.id === editing) : null;
  const val = (k, d = '') => esc(e ? e[k] ?? d : d);

  view.innerHTML = `
    <div class="row spread">
      <div><h1>${t('Products')}</h1>
        <div class="small muted">${t('{n} products', { n: products.length })}${updatedAt ? ` · ${t('Last updated {date}', { date: when(updatedAt) })}` : ''}</div></div>
      <div class="row">
        <a class="btn primary" href="#import">${t('Update from Excel')}</a>
        <button id="addOne">${t('Add one product')}</button>
      </div>
    </div>
    ${e ? `
      <form id="pf" class="card stack">
        <h2>${e.id ? t('Edit {name}', { name: esc(e.name) }) : t('Add a product')}</h2>
        <div class="form-grid">
          <label>${t('Product code (SKU)')}<input name="sku" dir="ltr" required value="${val('sku')}"></label>
          <label>${t('Brand name')}<input name="name" required value="${val('name')}"></label>
          <label>${t('Generic name')}<input name="generic_name" value="${val('generic_name')}"></label>
          <label>${t('Category')}<input name="category" value="${val('category')}" placeholder="${t('e.g. Antibiotics')}"></label>
          <label>${t('Form')}<input name="form" value="${val('form')}" placeholder="${t('Tablet, Syrup…')}"></label>
          <label>${t('Strength')}<input name="strength" value="${val('strength')}" placeholder="500 mg"></label>
          <label>${t('Pack size')}<input name="pack_size" value="${val('pack_size')}" placeholder="${t('Box of 20')}"></label>
          <label>${t('Price per pack ({currency})', { currency: esc(state.config.currency) })}<input name="price" inputmode="decimal" dir="ltr" required value="${e.price != null ? (e.price / 100).toFixed(2) : ''}"></label>
          <label>${t('Stock (packs)')}<input name="stock" inputmode="numeric" dir="ltr" required value="${val('stock', 0)}"></label>
          <label>${t('Minimum order')}<input name="min_order_qty" inputmode="numeric" dir="ltr" required value="${val('min_order_qty', 1)}"></label>
          <label>${t('Barcode')}<input name="barcode" inputmode="numeric" dir="ltr" value="${val('barcode')}" placeholder="6221234567890"></label>
        </div>
        ${e.id ? `<div class="row photo-edit">${thumb(e, 'lg')}
          <label class="btn" for="prodPhoto">${ICON.camera}<span>${t(e.image_url ? 'Change photo' : 'Add photo')}</span></label>
          <input type="file" id="prodPhoto" accept="image/*" hidden>
          ${e.image_url ? `<button type="button" class="link danger" id="delPhoto">${t('Remove photo')}</button>` : ''}
        </div>` : `<p class="small muted">${t('You can add a photo after saving the product.')}</p>`}
        <div class="row">
          <label class="check"><input type="checkbox" name="cold_chain" ${e.cold_chain ? 'checked' : ''}> ${t('Needs cold chain')}</label>
          <label class="check"><input type="checkbox" name="active" ${!e.id || e.active ? 'checked' : ''}> ${t('Listed for sale')}</label>
        </div>
        <div class="row">
          <button class="primary" type="submit">${t(e.id ? 'Save changes' : 'Add product')}</button>
          <button type="button" id="cancelEdit">${t('Cancel')}</button>
        </div>
      </form>` : ''}
    <input id="q" class="search" type="search" placeholder="${t('Search by brand, generic name or SKU')}" aria-label="${t('Search')}">
    <div class="card table-wrap">
      ${products.length ? `<table>
        <tr><th>${t('Product')}</th><th>${t('SKU')}</th><th>${t('Price')}</th><th>${t('Stock')}</th><th>${t('Min')}</th><th>${t('Status')}</th><th></th></tr>
        ${products.map((p) => `
          <tr data-search="${esc([p.name, p.generic_name, p.sku].join(' ').toLowerCase())}">
            <td><div class="with-thumb">${thumb(p, 'sm')}<div><strong>${nm(p.name)}</strong> <span class="small muted">${esc([p.strength, p.form, p.pack_size].filter(Boolean).join(' · '))}</span>
              ${p.cold_chain ? ` <span class="tag cold">${t('Cold')}</span>` : ''}</div></div></td>
            <td class="small">${ltr(p.sku)}${p.barcode ? `<div class="muted">${ltr(p.barcode)}</div>` : ''}</td>
            <td>${money(p.price)}</td>
            <td>${p.stock}${p.stock < 20 ? ` <span class="small warn-text">${t('low')}</span>` : ''}</td>
            <td>${p.min_order_qty}</td>
            <td>${p.active ? t('Listed') : `<span class="muted">${t('Hidden')}</span>`}</td>
            <td><button class="link" data-edit="${p.id}">${t('Edit')}</button></td>
          </tr>`).join('')}
      </table>` : `<div class="empty">${t('No products yet.')} <a href="#import">${t('Upload your product list from Excel')}</a></div>`}
    </div>`;

  $('#addOne', view).onclick = () => { renderProducts.editing = 'new'; render(); };
  const f = $('#pf', view);
  if (f) {
    f.onsubmit = action(async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const body = {
        ...d, price: toAmount(d.price), stock: toInt(d.stock), min_order_qty: toInt(d.min_order_qty),
        cold_chain: !!d.cold_chain, active: !!d.active,
      };
      if (e.id) await api('PATCH', `/api/supplier/products/${e.id}`, body);
      else await api('POST', '/api/supplier/products', body);
      toast(t(e.id ? 'Product updated' : 'Product added'));
      renderProducts.editing = null;
      render();
    });
    $('#cancelEdit', view).onclick = () => { renderProducts.editing = null; render(); };
    const photo = $('#prodPhoto', view);
    if (photo) {
      photo.onchange = action(async (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        await api('PUT', `/api/supplier/products/${e.id}/image`, { data_url: await shrinkImage(file, 600, 0.82) });
        toast(t('Photo saved'));
        render();
      });
      const del = $('#delPhoto', view);
      if (del) del.onclick = action(async () => { await api('DELETE', `/api/supplier/products/${e.id}/image`); toast(t('Photo removed')); render(); });
    }
  }
  $$('[data-edit]', view).forEach((b) => {
    b.onclick = () => { renderProducts.editing = Number(b.dataset.edit); render(); window.scrollTo(0, 0); };
  });
  $('#q', view).oninput = (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    $$('tr[data-search]', view).forEach((r) => { r.hidden = q && !r.dataset.search.includes(q); });
  };
}

// ---------------------------------------------------------------- supplier: Excel import

const FIELD_LABEL = {
  sku: 'Product code (SKU)', name: 'Brand name', generic_name: 'Generic name', category: 'Category', form: 'Form', strength: 'Strength',
  pack_size: 'Pack size', price: 'Price', stock: 'Stock', min_order_qty: 'Minimum order', cold_chain: 'Needs cold chain', active: 'Listed for sale',
  barcode: 'Barcode', image_url: 'Photo link',
};
const IMPORT_ERROR = {
  missing_columns: 'Required columns are missing: {value}', missing_sku: 'Product code is empty', duplicate_sku: 'Product code {value} appears more than once',
  missing_name: 'Brand name is empty', bad_price: 'Price is not a valid amount: {value}', bad_stock: 'Quantity must be a whole number, 0 or more',
  bad_min: 'Minimum order must be a whole number, 1 or more', bad_yes_no: 'Must be yes or no', empty: 'The file has no product rows',
  too_many_rows: 'At most {value} rows per file', not_a_list: 'The data is not in the expected format',
  bad_barcode: 'Barcode must be 8 to 14 digits: {value}', duplicate_barcode: 'Barcode {value} appears more than once',
  bad_image_url: 'Photo link must start with https://',
};
const importError = (e) => t(IMPORT_ERROR[e.code] || e.message, {
  value: e.code === 'missing_columns' ? String(e.value).split(', ').map((f) => t(FIELD_LABEL[f] || f)).join('، ') : esc(e.value ?? ''),
});
const fieldValue = (f, v) => (f === 'image_url' ? t(v ? 'New photo' : 'No photo') : f === 'price' ? money(v) : f === 'cold_chain' || f === 'active' ? t(v ? 'Yes' : 'No') : esc(v ?? '—'));

/** Rows read from an uploaded file (or the sample), kept while the preview is open. */
const importState = { rows: null, fileName: null, hideMissing: false, skipErrors: false, result: null };

async function renderImport(view) {
  const [{ products }, settings] = await Promise.all([api('GET', '/api/supplier/products'), api('GET', '/api/supplier/settings')]);
  const canDownload = !window.maaInBrowser && !!window.XLSX;
  const st = importState;

  view.innerHTML = `
    <h1>${t('Update products')}</h1>
    <p class="muted">${t('Upload your price and stock list whenever it changes. Products are matched by product code: existing codes are updated, new codes are added. You see every change before anything is saved.')}</p>
    <div class="import-grid">
      <div class="stack">
        <div class="card stack">
          <h2>1. ${t('Prepare the file')}</h2>
          <p class="small">${t('An Excel (.xlsx) or CSV file with one product per row. The first row holds the column names, in Arabic or English:')}</p>
          <div class="table-wrap"><table class="small">
            <tr><th>${t('Column')}</th><th>${t('Required')}</th><th>${t('Example')}</th></tr>
            ${MaaImport.TEMPLATE_HEADERS.map((h, i) => `<tr><td>${esc(h)}</td><td>${[0, 1, 7].includes(i) ? `<strong>${t('Yes')}</strong>` : t('No')}</td><td>${esc(MaaImport.TEMPLATE_EXAMPLE[i])}</td></tr>`).join('')}
          </table></div>
          ${canDownload ? `<div class="row"><button id="tpl">${t('Download empty template')}</button><button id="export">${t('Download my current list')}</button></div>` : ''}
        </div>
        <div class="card stack">
          <h2>2. ${t('Upload it')}</h2>
          <label class="drop" id="drop">
            <input type="file" id="file" accept=".xlsx,.xls,.csv" hidden>
            <strong>${t('Choose a file')}</strong>
            <span class="small muted">${t('or drag it here · .xlsx, .xls or .csv')}</span>
          </label>
          ${products.length ? `<button id="sample" class="link small">${t('No file to hand? Try a sample file')}</button>` : ''}
        </div>
      </div>
      <div class="stack" id="preview">
        ${st.result ? '' : `<div class="card empty">${t('Choose a file to see what will change.')}</div>`}
      </div>
    </div>
    <div class="card stack">
      <h2>${t('Connect your system (API)')}</h2>
      <p class="small">${t('If your company uses a stock or accounting system, it can send the product list automatically. Create a key under Payment & API.')}</p>
      <a href="#settings" class="small">${t('Set up API access')}</a>
    </div>
    ${settings.imports.length ? `
      <div class="card table-wrap">
        <h2>${t('Recent updates')}</h2>
        <table class="small">
          <tr><th>${t('Date')}</th><th>${t('Source')}</th><th>${t('New')}</th><th>${t('Changed')}</th><th>${t('Hidden')}</th><th>${t('By')}</th></tr>
          ${settings.imports.map((i) => `<tr><td>${when(i.created_at)}</td><td>${i.source === 'api' ? 'API' : esc(i.file_name || 'Excel')}</td><td>${i.created}</td><td>${i.updated}</td><td>${i.hidden}</td><td>${esc(i.actor_name || 'API')}</td></tr>`).join('')}
        </table>
      </div>` : ''}`;

  const preview = async () => {
    const box = $('#preview', view);
    box.innerHTML = `<div class="card">${t('Checking the file…')}</div>`;
    try {
      st.result = await api('POST', '/api/supplier/products/import', { rows: st.rows, dry_run: true, hide_missing: st.hideMissing, file_name: st.fileName });
    } catch (e) {
      box.innerHTML = `<div class="card err">${esc(e.message)}</div>`;
      return;
    }
    drawPreview();
  };

  const drawPreview = () => {
    const r = st.result;
    const s = r.summary;
    const fatal = r.errors.some((e) => e.row <= 1);
    const blocked = fatal || (s.errors && !st.skipErrors);
    const nothing = !s.created && !s.updated && !s.hidden;
    $('#preview', view).innerHTML = `
      <div class="card stack">
        <div class="row spread"><h2>3. ${t('Check and confirm')}</h2><span class="small muted">${esc(st.fileName || '')}</span></div>
        <div class="tiles">
          <div class="tile"><span>${t('New')}</span><strong>${s.created}</strong></div>
          <div class="tile"><span>${t('Changed')}</span><strong>${s.updated}</strong></div>
          <div class="tile"><span>${t('No change')}</span><strong>${s.unchanged}</strong></div>
          <div class="tile"><span>${t('Will be hidden')}</span><strong>${s.hidden}</strong></div>
          <div class="tile ${s.errors ? 'bad' : ''}"><span>${t('Errors')}</span><strong>${s.errors}</strong></div>
        </div>
        ${r.errors.length ? `
          <div class="stack small">
            <strong class="err">${t('Rows with errors')}</strong>
            <div class="table-wrap"><table>
              <tr><th>${t('Row')}</th><th>${t('Problem')}</th></tr>
              ${r.errors.map((e) => `<tr><td>${e.row}</td><td>${importError(e)}</td></tr>`).join('')}
            </table></div>
          </div>` : ''}
        ${r.update.length ? `
          <details class="small" open><summary><strong>${t('Changes to existing products')}</strong></summary>
            <div class="table-wrap"><table>
              <tr><th>${t('Product')}</th><th>${t('Change')}</th></tr>
              ${r.update.slice(0, 50).map((u) => `<tr><td>${nm(u.name)} <span class="muted">${ltr(u.sku)}</span></td>
                <td>${Object.keys(u.changes).map((f) => `${t(FIELD_LABEL[f] || f)}: <span class="muted">${fieldValue(f, u.before[f])}</span> ${I18N.lang === 'ar' ? '←' : '→'} <strong>${fieldValue(f, u.changes[f])}</strong>`).join('<br>')}</td></tr>`).join('')}
            </table></div></details>` : ''}
        ${r.create.length ? `
          <details class="small"><summary><strong>${t('New products')} (${s.created})</strong></summary>
            <ul class="plain">${r.create.slice(0, 50).map((c) => `<li>${nm(c.name)} · ${ltr(c.sku)} · ${money(c.price)}</li>`).join('')}</ul></details>` : ''}
        ${r.hide.length ? `
          <details class="small"><summary><strong>${t('Products that will be hidden')} (${s.hidden})</strong></summary>
            <ul class="plain">${r.hide.slice(0, 50).map((c) => `<li>${nm(c.name)} · ${ltr(c.sku || '')}</li>`).join('')}</ul></details>` : ''}
        <label class="check"><input type="checkbox" id="hideMissing" ${st.hideMissing ? 'checked' : ''}> ${t('Hide my products that are not in this file (they stop being sold, nothing is deleted)')}</label>
        ${s.errors && !fatal ? `<label class="check"><input type="checkbox" id="skipErrors" ${st.skipErrors ? 'checked' : ''}> ${t('Skip the rows with errors and save the rest')}</label>` : ''}
        <div class="row">
          <button class="primary big" id="apply" ${blocked || nothing ? 'disabled' : ''}>${t('Save these changes')}</button>
          <button id="discard">${t('Cancel')}</button>
        </div>
        ${blocked ? `<p class="small err">${t(fatal ? 'This file cannot be used. Check the column names and upload it again.' : 'Fix the rows with errors in your file and upload it again, or choose to skip them.')}</p>`
          : nothing ? `<p class="small muted">${t('Your products already match this file. Nothing to save.')}</p>` : ''}
      </div>`;
    const box = $('#preview', view);
    $('#hideMissing', box).onchange = (ev) => { st.hideMissing = ev.target.checked; preview(); };
    const skip = $('#skipErrors', box);
    if (skip) skip.onchange = (ev) => { st.skipErrors = ev.target.checked; drawPreview(); };
    $('#discard', box).onclick = () => { Object.assign(st, { rows: null, result: null, fileName: null, skipErrors: false }); render(); };
    $('#apply', box).onclick = action(async () => {
      const res = await api('POST', '/api/supplier/products/import', { rows: st.rows, dry_run: false, hide_missing: st.hideMissing, skip_errors: st.skipErrors, file_name: st.fileName });
      Object.assign(st, { rows: null, result: null, fileName: null, skipErrors: false });
      toast(t('Saved: {created} new, {updated} updated, {hidden} hidden', res.summary));
      render();
    });
    highlightStep();
  };

  const readFile = async (file) => {
    if (!window.XLSX) { toast(t('The Excel reader did not load. Check the internet connection and reload the page.'), true); return; }
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', codepage: 65001 });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      st.rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      st.fileName = file.name;
      st.skipErrors = false;
      await preview();
    } catch {
      toast(t('This file could not be read. Save it as .xlsx or .csv and try again.'), true);
    }
  };

  $('#file', view).onchange = (ev) => { if (ev.target.files[0]) readFile(ev.target.files[0]); };
  const drop = $('#drop', view);
  drop.ondragover = (ev) => { ev.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (ev) => { ev.preventDefault(); drop.classList.remove('over'); if (ev.dataTransfer.files[0]) readFile(ev.dataTransfer.files[0]); };

  const sample = $('#sample', view);
  if (sample) {
    sample.onclick = action(async () => {
      // A realistic update: new prices and stock for some products, one new product, one mistake.
      const h = MaaImport.TEMPLATE_HEADERS;
      const row = (p) => ({ [h[0]]: p.sku, [h[1]]: p.name, [h[2]]: p.generic_name || '', [h[3]]: p.category || '', [h[4]]: p.form || '', [h[5]]: p.strength || '', [h[6]]: p.pack_size || '', [h[7]]: (p.price / 100).toFixed(2), [h[8]]: String(p.stock), [h[9]]: String(p.min_order_qty), [h[10]]: p.cold_chain ? 'نعم' : 'لا', [h[11]]: p.barcode || '' });
      st.rows = products.filter((p) => p.active).map((p, i) => (i < 3 ? row({ ...p, price: Math.round(p.price * 1.05), stock: p.stock + 100 }) : row(p)));
      st.rows.push(row({ sku: 'NEW-FUC-15', name: 'Fucidin', generic_name: 'Fusidic acid', category: 'مضادات حيوية', form: 'كريم', strength: '2%', pack_size: 'أنبوب 15 غ', price: 2200, stock: 80, min_order_qty: 5 }));
      st.rows.push({ ...row({ sku: 'NEW-ERR-1', name: 'Vitamin C', price: 0, stock: 10, min_order_qty: 1 }), [h[7]]: 'غير معروف' });
      st.fileName = t('sample-file.xlsx');
      st.skipErrors = false;
      await preview();
    });
  }

  if (canDownload) {
    const save = (rows, name) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'products');
      XLSX.writeFile(wb, name);
    };
    $('#tpl', view).onclick = () => save([MaaImport.TEMPLATE_HEADERS, MaaImport.TEMPLATE_EXAMPLE], 'maa-products-template.xlsx');
    $('#export', view).onclick = () => save([MaaImport.TEMPLATE_HEADERS, ...products.map((p) => [p.sku, p.name, p.generic_name, p.category, p.form, p.strength, p.pack_size, (p.price / 100).toFixed(2), p.stock, p.min_order_qty, p.cold_chain ? 'نعم' : 'لا', p.barcode || '', /^https:/.test(p.image_url || '') ? p.image_url : ''])], 'maa-products.xlsx');
  }

  if (st.result) drawPreview();
}

// ---------------------------------------------------------------- supplier: payment terms & API

async function renderSettings(view) {
  const { policy: p, api_keys: keys } = await api('GET', '/api/supplier/settings');
  const endpoint = `${location.origin}/api/v1/products/sync`;
  const fresh = renderSettings.newKey;
  renderSettings.newKey = null;
  view.innerHTML = `
    <h1>${t('Payment & API')}</h1>
    <form id="policy" class="card stack">
      <h2>${t('How pharmacies can pay you')}</h2>
      <p class="small muted">${t('Pharmacies see only the options you allow here when they place an order.')}</p>
      <label class="check opt"><input type="checkbox" name="allow_full" ${p.allow_full ? 'checked' : ''}>
        <span><strong>${t('Full payment upfront')}</strong><span class="small muted">${t('The pharmacy pays everything before you dispatch.')}</span></span></label>
      <label class="check opt"><input type="checkbox" name="allow_partial" ${p.allow_partial ? 'checked' : ''}>
        <span><strong>${t('Deposit, rest on delivery')}</strong>
          <span class="row small">${t('Deposit')} <input name="deposit_percent" class="num" inputmode="numeric" dir="ltr" value="${p.deposit_percent}"> %</span></span></label>
      <label class="check opt"><input type="checkbox" name="allow_credit" ${p.allow_credit ? 'checked' : ''}>
        <span><strong>${t('Credit (pay later)')}</strong>
          <span class="row small">${t('Pay within')} <input name="credit_days" class="num" inputmode="numeric" dir="ltr" value="${p.credit_days}"> ${t('days')}
          · ${t('Credit limit per pharmacy')} <input name="credit_limit" class="num wide" inputmode="decimal" dir="ltr" value="${(p.credit_limit / 100).toFixed(0)}"> ${esc(state.config.currency)}</span></span></label>
      <div class="form-grid">
        <label>${t('Minimum order value ({currency})', { currency: esc(state.config.currency) })}<input name="min_order_value" inputmode="decimal" dir="ltr" value="${(p.min_order_value / 100).toFixed(0)}"></label>
      </div>
      <label>${t('Bank details shown to pharmacies for transfers')}<textarea name="bank_details" rows="3" maxlength="500">${esc(p.bank_details || '')}</textarea></label>
      <button class="primary" type="submit">${t('Save payment settings')}</button>
    </form>

    <div class="card stack">
      <h2>${t('API access')}</h2>
      <p class="small">${t('Your stock or accounting system can send the full product list automatically, for example every night. Each call works exactly like an Excel upload.')}</p>
      ${fresh ? `
        <div class="callout stack">
          <strong>${t('Copy this key now. It will not be shown again.')}</strong>
          <div class="row"><code class="key" id="newKey" dir="ltr">${esc(fresh)}</code><button id="copyKey">${t('Copy')}</button></div>
        </div>` : ''}
      <form id="keyForm" class="row">
        <input id="keyLabel" maxlength="80" placeholder="${t('Name, e.g. our ERP')}" style="max-width:260px">
        <button type="submit">${t('Create API key')}</button>
      </form>
      ${keys.length ? `<div class="table-wrap"><table class="small">
        <tr><th>${t('Key')}</th><th>${t('Name')}</th><th>${t('Created')}</th><th>${t('Last used')}</th><th></th></tr>
        ${keys.map((k) => `<tr><td>${ltr(k.prefix + '…')}</td><td>${esc(k.label || '')}</td><td>${when(k.created_at)}</td><td>${k.last_used_at ? when(k.last_used_at) : t('Never')}</td>
          <td><button class="link danger" data-revoke="${k.id}">${t('Revoke')}</button></td></tr>`).join('')}
      </table></div>` : ''}
      <details class="small">
        <summary><strong>${t('How to call the API')}</strong></summary>
        <pre class="codeblock" dir="ltr">POST ${esc(endpoint)}
X-Api-Key: maa_…
Content-Type: application/json

{
  "products": [
    { "sku": "NP-PAN-500", "name": "Panadol", "price": 4.50, "stock": 1200,
      "min_order_qty": 10, "generic_name": "Paracetamol", "pack_size": "علبة 24" }
  ],
  "hide_missing": false,
  "dry_run": false
}</pre>
        <p>${t('Use dry_run: true to see the changes without saving. The answer lists new, updated and hidden products and any row errors. Column names can be the same Arabic or English names as in Excel.')}</p>
        ${window.maaInBrowser ? `<p class="muted">${t('In this version the API cannot be reached from outside the browser.')}</p>` : ''}
      </details>
    </div>`;

  const f = $('#policy', view);
  f.onsubmit = action(async (ev) => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    await api('PUT', '/api/supplier/settings', {
      allow_full: !!d.allow_full, allow_partial: !!d.allow_partial, allow_credit: !!d.allow_credit,
      deposit_percent: toInt(d.deposit_percent), credit_days: toInt(d.credit_days),
      credit_limit: toAmount(d.credit_limit), min_order_value: toAmount(d.min_order_value), bank_details: d.bank_details,
    });
    toast(t('Payment settings saved'));
  });
  $('#keyForm', view).onsubmit = action(async (ev) => {
    ev.preventDefault();
    const { key } = await api('POST', '/api/supplier/api-keys', { label: $('#keyLabel', view).value.trim() || undefined });
    renderSettings.newKey = key;
    render();
  });
  const copy = $('#copyKey', view);
  if (copy) {
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(fresh); toast(t('Copied')); } catch {
        const r = document.createRange(); r.selectNodeContents($('#newKey', view));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
        toast(t('Selected. Copy it with your keyboard or long-press.'));
      }
    };
  }
  $$('[data-revoke]', view).forEach((b) => {
    b.onclick = action(async () => { await api('DELETE', `/api/supplier/api-keys/${b.dataset.revoke}`); toast(t('Key revoked')); render(); });
  });
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
          ${j.collect_on_delivery ? `<span class="tag">${t('Collect {amount}', { amount: money(j.collect_on_delivery) })}</span>` : ''}</div>
        <div class="row"><button class="primary" data-claim="${j.id}">${t('Take job')}</button><a href="#order-${j.id}">${t('Details')}</a></div>
      </div>`).join('')}</div>` : `<div class="card empty">${t('No deliveries waiting right now. This page refreshes automatically.')}</div>`}`;
  $$('[data-claim]', view).forEach((b) => {
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
    <div class="tiles" style="margin-bottom:1rem">
      <div class="tile"><span>${t('Orders')}</span><strong>${stats.orders}</strong></div>
      <div class="tile"><span>${t('In progress')}</span><strong>${stats.in_progress || 0}</strong></div>
      <div class="tile"><span>${t('Delivered value')}</span><strong>${money(stats.delivered_value)}</strong></div>
    </div>
    <div class="stack">
      <div class="card table-wrap"><h2>${t('Pharmacies & suppliers')}</h2><table>
        <tr><th>${t('Name')}</th><th>${t('Type')}</th><th>${t('License')}</th><th>${t('Address')}</th><th>${t('Status')}</th><th></th></tr>
        ${organizations.map((o) => `<tr>
          <td>${esc(o.name)}${o.contact_name ? `<div class="small muted">${esc(o.contact_name)} · ${ltr(o.contact_phone || '')}<br>${ltr(o.contact_email || '')}</div>` : ''}</td><td>${esc(t(o.type))}</td><td>${ltr(o.license_no)}</td><td class="small">${esc([o.address, o.city].filter(Boolean).join(', '))}</td>
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
  $$('[data-org]', view).forEach((b) => {
    b.onclick = action(async () => { await api('POST', `/api/admin/organizations/${b.dataset.org}/verify`, { verified: b.dataset.v === '1' }); render(); });
  });
  $$('[data-drv]', view).forEach((b) => {
    b.onclick = action(async () => { await api('POST', `/api/admin/drivers/${b.dataset.drv}/approve`, { approved: b.dataset.v === '1' }); render(); });
  });
}

// ---------------------------------------------------------------- demo guide
// Only in the standalone demo (window.maaDemo comes from standalone/demo-server.js):
// a role switcher and a step-by-step walkthrough of one order.

const GUIDE_STEPS = [
  { text: 'Pharmacy: New order → choose a company → add products → choose how to pay → send', who: () => 'pharmacy@maa.test',
    hash: () => { const sid = Object.keys(state.drafts).find((k) => draftCount(k)); return sid ? `#shop-${sid}` : '#new'; },
    target: '#sendOrder, #continue:not([disabled]), .supplier-card, [data-add]' },
  { text: 'Company: check the order and accept it', who: (o) => o.supplierEmail, hash: (o) => `#order-${o.id}`, target: '[data-act=accept]' },
  { text: 'Company: record the upfront payment received', who: (o) => o.supplierEmail, hash: (o) => `#order-${o.id}`, target: '#payForm [type=submit]' },
  { text: 'Company: mark the order packed and ready', who: (o) => o.supplierEmail, hash: (o) => `#order-${o.id}`, target: '[data-act=ready]' },
  { text: 'Driver: take the delivery job', who: () => 'driver@maa.test', hash: (o) => `#order-${o.id}`, target: '[data-act=claim]' },
  { text: 'Driver: confirm collection from the company', who: () => 'driver@maa.test', hash: (o) => `#order-${o.id}`, target: '[data-act=pickup]' },
  { text: 'Driver: enter the delivery code {code} from the pharmacy', who: () => 'driver@maa.test', hash: (o) => `#order-${o.id}`, target: '#deliver input' },
];

function guideStep() {
  const p = window.maaDemo.progress();
  if (p.state === 'start') return { index: 0, order: null, done: false, skipped: [] };
  if (p.state === 'done') return { index: GUIDE_STEPS.length, order: p.order, done: true, skipped: [] };
  const o = p.order;
  const index = { placed: 1, accepted: o.paid_amount < o.upfront_required ? 2 : 3, ready_for_pickup: 4, assigned: 5, picked_up: 6 }[o.status];
  return { index, order: o, done: false, skipped: o.upfront_required === 0 ? [2] : [] };
}

async function switchTo(email, hash) {
  if (state.user?.email !== email) {
    const { token, user } = await api('POST', '/api/auth/login', { email, password: window.maaDemo.password });
    state.token = token; state.user = user;
    localSet('maa.token', token);
  }
  const target = hash || HOME[state.user.role];
  if (location.hash === target) render(); else location.hash = target;
}

function renderGuide() {
  if (!window.maaDemo) return;
  let el = $('#guide');
  if (!el) {
    el = document.createElement('section');
    el.id = 'guide';
    el.className = 'guide';
    document.body.insertBefore(el, $('#view'));
  }
  el.setAttribute('aria-label', t('Try it step by step'));
  const collapsed = localGet('maa.guide') === 'hidden';
  const { index, order, done, skipped } = guideStep();
  const me = state.user?.email;

  const steps = GUIDE_STEPS.map((s, i) => {
    const skip = skipped.includes(i);
    const cls = skip ? 'done skipped' : i < index ? 'done' : i === index ? 'current' : 'todo';
    const text = skip ? `${t(s.text)} <span class="muted">(${t('not needed for credit')})</span>`
      : t(s.text, { code: order?.code ? `<bdi dir="ltr" class="code-inline">${esc(order.code)}</bdi>` : '' });
    return `<li class="${cls}"><span class="num">${i < index || skip ? '✓' : i + 1}</span><span class="txt">${text}</span>
      ${i === index ? `<button class="primary small-btn" id="goStep">${t('Go to this step')}</button>` : ''}</li>`;
  }).join('');

  el.innerHTML = `
    <div class="guide-inner">
      <div class="row spread">
        <strong>${t('Try it step by step')}</strong>
        <button class="link" id="guideToggle">${t(collapsed ? 'Show steps' : 'Hide steps')}</button>
      </div>
      ${collapsed ? '' : `
        <ol class="steps">${steps}</ol>
        ${done ? `<div class="row guide-done"><span>${t('Done! The order was delivered. Try another order, or open the admin page.')}</span>
          <button class="primary small-btn" id="restart">${t('Start a new order')}</button></div>` : ''}
        <div class="row small also"><span class="muted">${t('Also try:')}</span>
          <button class="link" data-also-pharmacy="new">${t('Pharmacy: order by photo or barcode')}</button>
          <button class="link" data-also="import">${t('Company: update products from Excel')}</button>
          <button class="link" data-also="settings">${t('Company: payment options')}</button></div>`}
      <div class="switch">
        <span class="small muted">${t('Switch role:')}</span>
        ${window.maaDemo.accounts.map((a) => `<button class="chip ${a.email === me ? 'on' : ''}" data-switch="${a.email}" ${a.email === me ? 'aria-pressed="true"' : ''}>${t(a.label)}</button>`).join('')}
      </div>
      <div class="small muted row">${t('Demo version: runs entirely in your browser, data stays on this device.')}
        <button class="link small" id="resetDemo">${t('Reset demo data')}</button></div>
    </div>`;

  $('#guideToggle', el).onclick = () => { localSet('maa.guide', collapsed ? null : 'hidden'); renderGuide(); };
  $('#resetDemo', el).onclick = () => window.maaResetDemo();
  $$('[data-switch]', el).forEach((b) => { b.onclick = action(() => switchTo(b.dataset.switch)); });
  $$('[data-also]', el).forEach((b) => { b.onclick = action(() => switchTo('supplier@maa.test', `#${b.dataset.also}`)); });
  $$('[data-also-pharmacy]', el).forEach((b) => { b.onclick = action(() => switchTo('pharmacy@maa.test', `#${b.dataset.alsoPharmacy}`)); });
  const go = $('#goStep', el);
  if (go) {
    const s = GUIDE_STEPS[index];
    go.onclick = action(() => switchTo(s.who(order), s.hash(order)));
  }
  const restart = $('#restart', el);
  if (restart) restart.onclick = action(() => switchTo('pharmacy@maa.test', '#new'));
}

/** Outline the control the current step needs, if it is on screen for this role. */
function highlightStep() {
  if (!window.maaDemo) return;
  $$('.hint').forEach((n) => n.classList.remove('hint'));
  const { index, order, done } = guideStep();
  if (done) return;
  const s = GUIDE_STEPS[index];
  if (state.user?.email !== s.who(order)) return;
  $(s.target, $('#view'))?.classList.add('hint');
}

// ---------------------------------------------------------------- shared pilot

const SHARED_PROBLEM = {
  not_setup: 'The owner has not set up the shared data yet. Ask them to open this link once, then reload this page.',
  no_access: 'You cannot reach the shared data. Make sure you are signed in to Claude and that the owner added you to this link as an Editor.',
  error: 'The shared data could not be loaded. Check the internet connection and reload the page.',
};

function renderSharedProblem(view) {
  view.innerHTML = `
    <div class="auth card stack">
      <h1>${t('Maa')}</h1>
      <p>${t(SHARED_PROBLEM[state.sharedProblem] || SHARED_PROBLEM.error)}</p>
      <button id="retry">${t('Try again')}</button>
    </div>`;
  $('#retry', view).onclick = () => location.reload();
}

async function bootShared() {
  try {
    const s = await api('GET', '/api/session');
    if (s.user) { state.token = s.token; state.user = s.user; localSet('maa.token', s.token); } else { state.token = null; state.user = null; }
  } catch (e) {
    state.sharedProblem = e.details?.code && SHARED_PROBLEM[e.details.code] ? e.details.code : 'error';
  }
  // Someone else saved: show it, unless this person is typing or has a panel open.
  window.addEventListener('maa:data', async () => {
    // An approval may have just arrived: refresh who this person is (a local read).
    if (state.user) state.user = (await api('GET', '/api/me').catch(() => null))?.user || state.user;
    const typing = document.activeElement?.matches?.('input, textarea, select');
    if (!typing && !$('.sheet-back')) render();
  });
  render();
}

// ---------------------------------------------------------------- boot

(async function boot() {
  try { state.config = await api('GET', '/api/config'); } catch { /* use defaults */ }
  if (SHARED) { await bootShared(); return; }
  if (state.token) {
    try { state.user = (await api('GET', '/api/me')).user; } catch { state.token = null; localSet('maa.token', null); }
  }
  render();
})();
