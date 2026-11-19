/* PROMERGON Vendor Registration – single-page front-end (no framework, CSP-safe). */
'use strict';

const state = { user: null, meta: null, app: null, step: 0, dirty: false };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s) => (s ? new Date(s.length === 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + (s.includes('Z') || s.length === 10 ? '' : 'Z')).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const fmtDateTime = (s) => (s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtNum = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString());
const today = () => new Date().toISOString().slice(0, 10);
const chip = (status) => `<span class="chip s-${esc(status)}">${esc(state.meta.statuses[status] || status)}</span>`;
const grade = (g) => (g ? `<span class="grade g${esc(g)}" title="Prequalification grade">${esc(g)}</span>` : '');

// ---------------------------------------------------------------- API
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.details = data.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg, isErr) {
  const el = document.createElement('div');
  el.textContent = msg;
  if (isErr) el.className = 'err';
  $('#toast').append(el);
  setTimeout(() => el.remove(), isErr ? 6000 : 3000);
}

function errorBox(err) {
  return `<div class="alert"><strong>${esc(err.message)}</strong>${err.details?.length ? `<ul>${err.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>`;
}

// Paint progress bars after render (inline style attributes are blocked by CSP).
function paintBars(root = document) {
  for (const el of $$('[data-w]', root)) el.style.width = `${Math.max(0, Math.min(100, Number(el.dataset.w)))}%`;
}

// ---------------------------------------------------------------- Profile helpers
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) { o[k] = value; return; }
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
}
function collectForm(root) {
  const out = {};
  for (const el of $$('[name]', root)) {
    const name = el.name;
    if (el.type === 'checkbox' && el.dataset.array !== undefined) {
      const arr = getPath(out, name) || [];
      if (el.checked) arr.push(el.value);
      setPath(out, name, arr);
    } else if (el.type === 'checkbox') setPath(out, name, el.checked);
    else setPath(out, name, el.value);
  }
  return out;
}
function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}

// Field builders --------------------------------------------------------------
function field(p, name, label, { type = 'text', req, hint, span, options, placeholder, step } = {}) {
  const val = getPath(p, name);
  const id = 'f_' + name.replace(/\./g, '_');
  let input;
  if (type === 'select') {
    input = `<select id="${id}" name="${name}"><option value="">— Select —</option>${Object.entries(options).map(([k, l]) => `<option value="${esc(k)}" ${val === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea id="${id}" name="${name}" placeholder="${esc(placeholder || '')}">${esc(val)}</textarea>`;
  } else {
    input = `<input id="${id}" type="${type}" name="${name}" value="${esc(val ?? '')}" placeholder="${esc(placeholder || '')}" ${type === 'number' ? `min="0" step="${step || 'any'}"` : ''}>`;
  }
  return `<div class="${span || ''}"><label for="${id}">${esc(label)}${req ? ' <span class="req">*</span>' : ''}</label>${input}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
}
function check(p, name, label, hint) {
  return `<label class="check"><input type="checkbox" name="${name}" ${getPath(p, name) ? 'checked' : ''}><span>${label}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</span></label>`;
}

// ---------------------------------------------------------------- Application sections (shared by vendor + staff)
const SECTIONS = [
  { key: 'company', title: 'Company information', render: secCompany },
  { key: 'contacts', title: 'Contacts', render: secContacts },
  { key: 'scope', title: 'Sectors & categories', render: secScope },
  { key: 'financial', title: 'Financial', render: secFinancial },
  { key: 'hse', title: 'HSE', render: secHse },
  { key: 'quality', title: 'Quality', render: secQuality },
  { key: 'experience', title: 'Experience & capacity', render: secExperience },
  { key: 'documents', title: 'Documents', render: null },
  { key: 'declaration', title: 'Declaration & submit', render: secDeclaration },
];

function secCompany(p) {
  return `<h3 class="section-title">Legal entity</h3>
  <div class="grid g2">
    ${field(p, 'company.legalName', 'Registered legal name', { req: true, span: 'span2' })}
    ${field(p, 'company.tradeName', 'Trade name (if different)')}
    ${field(p, 'company.website', 'Website', { type: 'url', placeholder: 'https://' })}
    ${field(p, 'company.registrationNumber', 'Commercial registration (CR) no.', { req: true })}
    ${field(p, 'company.taxNumber', 'Tax / VAT registration no.', { req: true })}
    ${field(p, 'company.yearEstablished', 'Year established', { type: 'number', req: true, step: 1 })}
    ${field(p, 'company.ownership', 'Ownership', { type: 'select', options: { LOCAL: 'Local', FOREIGN: 'Foreign', JV: 'Joint venture' } })}
    ${field(p, 'company.localContentPct', 'Local content / in-country value (%)', { type: 'number', hint: 'Where applicable (e.g. IKTVA, ICV).' })}
    ${field(p, 'company.employees', 'Total permanent employees', { type: 'number', step: 1 })}
  </div>
  <h3 class="section-title">Registered address</h3>
  <div class="grid g2">
    ${field(p, 'company.country', 'Country', { req: true })}
    ${field(p, 'company.city', 'City')}
    ${field(p, 'company.address', 'Full address', { type: 'textarea', req: true, span: 'span2' })}
  </div>`;
}
function contactBlock(p, key, title, req) {
  return `<h3 class="section-title">${esc(title)}</h3><div class="grid g4">
    ${field(p, `contacts.${key}.name`, 'Name', { req })}
    ${field(p, `contacts.${key}.title`, 'Position')}
    ${field(p, `contacts.${key}.email`, 'Email', { type: 'email', req })}
    ${field(p, `contacts.${key}.phone`, 'Phone', { type: 'tel', req })}
  </div>`;
}
function secContacts(p) {
  return contactBlock(p, 'primary', 'Primary / commercial contact', true) +
    contactBlock(p, 'hse', 'HSE representative') + contactBlock(p, 'quality', 'Quality (QA/QC) representative');
}
function secScope(p) {
  const m = state.meta;
  const groups = {};
  for (const c of m.categories) (groups[c.group] ||= []).push(c);
  const sel = new Set(p.categories || []);
  const sectors = new Set(p.sectors || []);
  return `<h3 class="section-title">Sectors served <span class="req">*</span></h3>
  <div class="cat-grid">${Object.entries(m.sectors).map(([k, l]) => `<label class="check"><input type="checkbox" name="sectors" data-array value="${k}" ${sectors.has(k) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
  <h3 class="section-title">Product & service categories <span class="req">*</span></h3>
  ${Object.entries(groups).map(([g, list]) => `<div class="cat-group"><h4>${esc({ Supply: 'Supply of materials & equipment', Works: 'Construction works / subcontracting', Services: 'Services' }[g] || g)}</h4>
    <div class="cat-grid">${list.map((c) => `<label class="check"><input type="checkbox" name="categories" data-array value="${c.code}" ${sel.has(c.code) ? 'checked' : ''}><span>${esc(c.name)} <code>${c.code}</code></span></label>`).join('')}</div></div>`).join('')}
  <div class="grid">${field(p, 'scopeDescription', 'Describe your scope, products, brands represented and key capabilities', { type: 'textarea' })}</div>`;
}
function secFinancial(p) {
  const y = new Date().getFullYear();
  const t = p.financial?.turnover || [];
  const rows = [0, 1, 2].map((i) => `<tr>
    <td><input type="number" name="financial.turnover.${i}.year" value="${esc(t[i]?.year ?? y - 1 - i)}" step="1" min="1900" aria-label="Year"></td>
    <td><input type="number" name="financial.turnover.${i}.amount" value="${esc(t[i]?.amount ?? '')}" min="0" aria-label="Turnover amount"></td></tr>`).join('');
  return `<h3 class="section-title">Annual turnover (last 3 years) <span class="req">*</span></h3>
  <div class="grid g3">${field(p, 'financial.currency', 'Currency (ISO code)', { placeholder: 'USD' })}</div>
  <div class="table-wrap"><table class="ref-table"><thead><tr><th>Financial year</th><th>Turnover</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="hint">Upload audited financial statements under Documents.</p>
  <h3 class="section-title">Bank details</h3>
  <div class="grid g2">
    ${field(p, 'financial.bankName', 'Bank name', { req: true })}
    ${field(p, 'financial.accountName', 'Account name')}
    ${field(p, 'financial.iban', 'IBAN / account no.', { req: true })}
    ${field(p, 'financial.swift', 'SWIFT / BIC')}
  </div>`;
}
function secHse(p) {
  const sub = state.app?.vendor.vendor_type === 'SUBCONTRACTOR';
  return `<h3 class="section-title">Management systems</h3>
  ${check(p, 'hse.iso45001', 'Certified to ISO 45001 (Occupational Health & Safety)')}
  ${check(p, 'hse.iso14001', 'Certified to ISO 14001 (Environmental management)')}
  ${check(p, 'hse.hsePolicy', 'Documented HSE policy signed by top management')}
  <h3 class="section-title">HSE performance – last 3 years ${sub ? '<span class="req">*</span>' : ''}</h3>
  <div class="grid g4">
    ${field(p, 'hse.manhours3y', 'Total man-hours worked', { type: 'number', step: 1 })}
    ${field(p, 'hse.trir', 'TRIR', { type: 'number', req: sub, hint: 'Recordable cases per 200,000 hrs' })}
    ${field(p, 'hse.ltifr', 'LTIFR', { type: 'number', hint: 'Lost-time injuries per 1,000,000 hrs' })}
    ${field(p, 'hse.fatalities3y', 'Fatalities', { type: 'number', req: sub, step: 1 })}
  </div>`;
}
function secQuality(p) {
  return `<h3 class="section-title">Quality management</h3>
  ${check(p, 'quality.iso9001', 'Certified to ISO 9001 (Quality management)')}
  ${check(p, 'quality.qaManual', 'Documented QA/QC manual and inspection & test plans (ITPs)')}
  <div class="grid">${field(p, 'quality.certifications', 'Product & industry certifications / licences', { type: 'textarea', placeholder: 'e.g. API Q1, API 6D, API 5L, ASME U/S stamps, IEC 61439 type tests, ATEX/IECEx, UL, CE, NBIC R…' })}</div>`;
}
function secExperience(p) {
  const refs = p.experience?.references?.length ? p.experience.references : [{}];
  const sectorOpts = (v) => `<option value="">—</option>` + Object.entries(state.meta.sectors).map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${esc(l.split('(')[0])}</option>`).join('');
  return `<h3 class="section-title">Experience</h3>
  <div class="grid g3">
    ${field(p, 'experience.yearsOilGas', 'Years of experience in Oil & Gas', { type: 'number' })}
    ${field(p, 'experience.yearsPower', 'Years of experience in Power', { type: 'number' })}
  </div>
  <h3 class="section-title">Major project references (last 5–10 years)</h3>
  <div class="table-wrap"><table class="ref-table"><thead><tr><th>Client / end user</th><th>Project</th><th>Scope supplied / executed</th><th>Sector</th><th>Value (USD)</th><th>Year</th><th></th></tr></thead>
  <tbody id="refs">${refs.map((r, i) => refRow(r, i, sectorOpts)).join('')}</tbody></table></div>
  <button type="button" class="btn-sm" data-action="add-ref">+ Add reference</button>
  <h3 class="section-title">Resources & capacity</h3>
  <div class="grid g3">
    ${field(p, 'capacity.manpowerSkilled', 'Skilled manpower', { type: 'number', step: 1 })}
    ${field(p, 'capacity.manpowerUnskilled', 'Semi / unskilled manpower', { type: 'number', step: 1 })}
    ${field(p, 'capacity.workshopArea', 'Workshop / factory area (m²)', { type: 'number' })}
    ${field(p, 'capacity.majorEquipment', 'Major owned plant, equipment & facilities', { type: 'textarea', span: 'span-all' })}
  </div>`;
}
function refRow(r, i, sectorOpts) {
  const n = (k) => `experience.references.${i}.${k}`;
  return `<tr>
    <td><input type="text" name="${n('client')}" value="${esc(r.client)}" aria-label="Client"></td>
    <td><input type="text" name="${n('project')}" value="${esc(r.project)}" aria-label="Project"></td>
    <td><input type="text" name="${n('scope')}" value="${esc(r.scope)}" aria-label="Scope"></td>
    <td><select name="${n('sector')}" aria-label="Sector">${sectorOpts(r.sector)}</select></td>
    <td><input type="number" name="${n('value')}" value="${esc(r.value ?? '')}" min="0" aria-label="Value"></td>
    <td><input type="number" name="${n('year')}" value="${esc(r.year ?? '')}" min="1950" step="1" aria-label="Year"></td>
    <td><button type="button" class="btn-sm btn-danger" data-action="del-ref" aria-label="Remove reference">✕</button></td></tr>`;
}
function secDeclaration(p) {
  return `<h3 class="section-title">Declarations</h3>
  ${check(p, 'declarations.antiBribery', '<strong>Anti-bribery & corruption.</strong> We have not offered, paid or received any bribe, kickback or improper payment and comply with applicable anti-corruption laws (e.g. FCPA, UK Bribery Act). <span class="req">*</span>')}
  ${check(p, 'declarations.sanctions', '<strong>Sanctions & export control.</strong> The company, its owners and directors are not subject to UN, EU, UK, US or other applicable sanctions. <span class="req">*</span>')}
  ${check(p, 'declarations.conflictOfInterest', '<strong>Conflict of interest.</strong> We have a relationship with a PROMERGON employee or their family that must be declared.')}
  <div class="grid">${field(p, 'declarations.conflictDetails', 'If yes, provide details', { type: 'textarea' })}</div>
  ${check(p, 'declarations.accuracy', '<strong>Accuracy.</strong> The information provided is true and complete. We accept that false information leads to rejection or removal from the Approved Vendor List, and agree to notify PROMERGON of material changes. <span class="req">*</span>')}
  <h3 class="section-title">Authorised signatory</h3>
  <div class="grid g2">
    ${field(p, 'declarations.signatoryName', 'Full name', { req: true })}
    ${field(p, 'declarations.signatoryTitle', 'Position', { req: true })}
  </div>`;
}

function documentsPanel(app, { editable, canUpload }) {
  const m = state.meta;
  const type = app.vendor.vendor_type;
  const t = today();
  const rows = Object.entries(m.documentTypes).map(([k, d]) => {
    const docs = app.documents.filter((x) => x.doc_type === k);
    const req = d.required.includes(type);
    if (!req && !docs.length) return '';
    const status = !docs.length ? '<span class="chip bad">Missing</span>'
      : docs.every((x) => x.expiry_date && x.expiry_date < t) ? '<span class="chip bad">Expired</span>'
      : '<span class="chip ok">Provided</span>';
    return `<tr><td><strong>${esc(d.name)}</strong>${req ? ' <span class="req">*</span>' : ''}${d.expires ? '<div class="hint">Expiry date tracked</div>' : ''}</td>
      <td>${status}</td>
      <td>${docs.map((x) => `<div class="row"><a href="/api/documents/${x.id}/download">${esc(x.filename)}</a>
        <span class="muted small">${(x.size / 1024).toFixed(0)} KB${x.expiry_date ? ` · expires ${fmtDate(x.expiry_date)}` : ''}</span>
        ${x.expiry_date && x.expiry_date < t ? '<span class="chip bad">expired</span>' : ''}
        ${editable ? `<button type="button" class="btn-sm btn-danger" data-action="del-doc" data-id="${x.id}">Remove</button>` : ''}</div>`).join('') || '<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  const firstMissing = Object.keys(m.documentTypes).find((k) => m.documentTypes[k].required.includes(type) && !app.documents.some((x) => x.doc_type === k));
  const upload = canUpload ? `<form id="upload-form" class="card">
    <h3>Upload a document</h3>
    <div class="grid g4">
      <div class="span2"><label for="u_type">Document type <span class="req">*</span></label><select id="u_type" name="doc_type" required>${Object.entries(m.documentTypes).map(([k, d]) => `<option value="${k}" ${k === firstMissing ? 'selected' : ''}>${esc(d.name)}${d.required.includes(type) ? ' *' : ''}</option>`).join('')}</select></div>
      <div><label for="u_issue">Issue date</label><input id="u_issue" type="date" name="issue_date"></div>
      <div><label for="u_exp">Expiry date <span class="req hidden" id="u_exp_req">*</span></label><input id="u_exp" type="date" name="expiry_date"></div>
      <div class="span2"><label for="u_file">File <span class="req">*</span></label><input id="u_file" type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip"><div class="hint">PDF, image, Office or ZIP · max 15 MB</div></div>
      <div class="span2 row"><div class="spacer"></div><button class="btn-primary" type="submit">Upload</button></div>
    </div></form>` : '';
  return `${upload}<div class="card"><div class="card-head"><h3>Document register</h3><span class="muted small">* mandatory for ${esc(m.vendorTypes[type])}</span></div>
    <div class="table-wrap"><table><thead><tr><th>Document</th><th>Status</th><th>Files</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// ---------------------------------------------------------------- Shell
function shell(content, active) {
  const u = state.user;
  const staff = u.role !== 'VENDOR';
  const links = staff
    ? [['#/dashboard', 'Dashboard'], ['#/vendors', 'Applications'], ['#/avl', 'Approved vendors'], ...(u.role === 'ADMIN' ? [['#/users', 'Users']] : [])]
    : [['#/application', 'My application']];
  links.push(['#/account', 'Account']);
  return `<header class="topbar">
    <a class="brand" href="#/"><img class="brand-mark" src="favicon.svg" alt=""><span>PROMERGON<small>Vendor Registration</small></span></a>
    <nav class="topnav">${links.map(([h, l]) => `<a href="${h}" class="${active === h ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div class="userbox"><span class="who">${esc(u.name)} · ${esc(state.meta.roles[u.role])}${u.discipline ? ` (${esc(state.meta.disciplines[u.discipline])})` : ''}</span>
    <button type="button" class="btn-sm" data-action="logout">Sign out</button></div>
  </header><main>${content}</main><div class="foot">PROMERGON · Oil & Gas and Power EPC · Supplier & subcontractor prequalification</div>`;
}

function render(html) {
  $('#app').innerHTML = html;
  paintBars();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- Auth views
function viewAuth(mode = 'login') {
  const m = state.meta;
  render(`<div class="auth">
    <section class="auth-hero">
      <div class="brand"><img class="brand-mark" src="favicon.svg" alt=""><span>PROMERGON<small>Engineering · Procurement · Construction</small></span></div>
      <div>
        <h1>Supplier & Subcontractor Registration</h1>
        <p>Join PROMERGON's Approved Vendor List to be invited to tender on our Oil & Gas and Power projects.</p>
        <ul>
          <li>Register your company and complete one prequalification questionnaire</li>
          <li>Upload certificates once — we track expiry dates and remind you to renew</li>
          <li>Technical, QA/QC, HSE and financial evaluation by PROMERGON specialists</li>
          <li>Follow your application status and respond to clarifications online</li>
        </ul>
      </div>
      <div class="sector-tags"><span>Upstream</span><span>Midstream</span><span>Downstream</span><span>Power generation</span><span>T&D / Substations</span><span>Renewables</span></div>
    </section>
    <section class="auth-panel"><div class="auth-box">
      <div class="tabs" role="tablist">
        <button type="button" class="${mode === 'login' ? 'active' : ''}" data-action="auth-tab" data-mode="login">Sign in</button>
        <button type="button" class="${mode === 'register' ? 'active' : ''}" data-action="auth-tab" data-mode="register">Register as a new vendor</button>
      </div>
      <div id="auth-err"></div>
      ${mode === 'login' ? `<form id="login-form" class="stack">
        <div><label for="l_email">Email</label><input id="l_email" type="email" name="email" required autocomplete="username"></div>
        <div><label for="l_pw">Password</label><input id="l_pw" type="password" name="password" required autocomplete="current-password"></div>
        <button class="btn-primary" type="submit">Sign in</button>
        <p class="muted small">Vendors: new to PROMERGON? Choose “Register as a new vendor”. PROMERGON staff accounts are created by an administrator.</p>
      </form>` : `<form id="register-form" class="stack">
        <div><label for="r_co">Company legal name <span class="req">*</span></label><input id="r_co" type="text" name="companyName" required></div>
        <div class="grid g2">
          <div><label for="r_type">Registering as <span class="req">*</span></label><select id="r_type" name="vendorType" required><option value="">— Select —</option>${Object.entries(m.vendorTypes).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
          <div><label for="r_ctry">Country</label><input id="r_ctry" type="text" name="country"></div>
        </div>
        <div><label for="r_name">Your full name <span class="req">*</span></label><input id="r_name" type="text" name="name" required autocomplete="name"></div>
        <div><label for="r_email">Business email <span class="req">*</span></label><input id="r_email" type="email" name="email" required autocomplete="email"></div>
        <div><label for="r_pw">Password <span class="req">*</span></label><input id="r_pw" type="password" name="password" required minlength="10" autocomplete="new-password"><div class="hint">At least 10 characters, with letters and numbers.</div></div>
        <button class="btn-accent" type="submit">Create account & start registration</button>
      </form>`}
    </div></section></div>`);
}

// ---------------------------------------------------------------- Vendor portal
const EDITABLE = new Set(['DRAFT', 'CLARIFICATION_REQUIRED']);

async function viewApplication() {
  state.app = await api('GET', '/api/vendor/application');
  state.dirty = false;
  renderApplication();
}

function statusBanner(app) {
  const v = app.vendor;
  const lastNote = app.history.find((h) => h.to_status === v.status && h.note)?.note;
  switch (v.status) {
    case 'DRAFT': return `<div class="banner"><h3>Complete your registration</h3><p>Fill in each section, upload the mandatory documents and submit from the final step. Your progress is saved as a draft.</p></div>`;
    case 'SUBMITTED':
    case 'UNDER_REVIEW': return `<div class="banner"><h3>Application ${v.status === 'SUBMITTED' ? 'submitted' : 'under evaluation'}</h3><p>Submitted ${fmtDate(v.submitted_at)}. PROMERGON's procurement, technical, QA/QC and HSE teams are reviewing your application. The form is locked during review.</p></div>`;
    case 'CLARIFICATION_REQUIRED': return `<div class="banner warn"><h3>Clarification requested</h3><p>Please update your application or documents as requested below and resubmit.</p>${lastNote ? `<p class="quote">${esc(lastNote)}</p>` : ''}</div>`;
    case 'APPROVED': return `<div class="banner ok"><h3>Approved vendor · ${esc(v.vendor_code)}</h3><p>You are on PROMERGON's Approved Vendor List. Approval valid until ${fmtDate(v.approval_expires_at)}. Keep your certificates up to date by uploading renewals under Documents.</p></div>`;
    case 'CONDITIONALLY_APPROVED': return `<div class="banner warn"><h3>Conditionally approved · ${esc(v.vendor_code)}</h3><p>Valid until ${fmtDate(v.approval_expires_at)}, subject to the following conditions:</p><p class="quote">${esc(v.conditions)}</p></div>`;
    case 'REJECTED': return `<div class="banner bad"><h3>Application not approved</h3>${lastNote ? `<p class="quote">${esc(lastNote)}</p>` : ''}<p>Contact PROMERGON procurement if you wish to discuss re-application.</p></div>`;
    case 'SUSPENDED': return `<div class="banner bad"><h3>Registration suspended</h3>${lastNote ? `<p class="quote">${esc(lastNote)}</p>` : ''}</div>`;
    default: return '';
  }
}

function renderApplication() {
  const app = state.app;
  const editable = EDITABLE.has(app.vendor.status);
  const canUpload = editable || ['APPROVED', 'CONDITIONALLY_APPROVED', 'SUSPENDED'].includes(app.vendor.status);
  const step = SECTIONS[state.step];
  let body;
  if (step.key === 'documents') body = documentsPanel(app, { editable, canUpload });
  else {
    body = `<form id="profile-form" class="card"><fieldset ${editable ? '' : 'disabled'}>${step.render(app.profile)}</fieldset></form>`;
    if (step.key === 'declaration') body += submitPanel(app, editable);
  }
  render(shell(`
    <div class="page-head"><div><h1>${esc(app.vendor.company_name)}</h1><p class="muted">${esc(state.meta.vendorTypes[app.vendor.vendor_type])} · ${chip(app.vendor.status)}</p></div>
    ${editable ? '<button type="button" class="btn-primary" data-action="save">Save draft</button>' : ''}</div>
    ${statusBanner(app)}
    <div class="wizard">
      <nav class="steps card" aria-label="Application sections">${SECTIONS.map((s, i) => `<button type="button" data-action="step" data-step="${i}" class="${i === state.step ? 'active' : ''}"><span class="num">${i + 1}</span>${esc(s.title)}</button>`).join('')}</nav>
      <div>
        <h2>${esc(step.title)}</h2>
        ${body}
        <div class="wizard-foot">
          <button type="button" data-action="step" data-step="${state.step - 1}" ${state.step === 0 ? 'disabled' : ''}>← Previous</button>
          ${state.step < SECTIONS.length - 1 ? `<button type="button" class="btn-primary" data-action="step" data-step="${state.step + 1}">${editable ? 'Save & continue' : 'Next'} →</button>` : ''}
        </div>
      </div>
    </div>`, '#/application'));
  if (step.key === 'documents') bindUploadForm();
}

function submitPanel(app, editable) {
  if (!editable) return '';
  const issues = app.issues;
  return `<div class="card" id="submit-card">
    <div class="card-head"><h3>Ready to submit?</h3>${issues.length ? `<span class="chip warn">${issues.length} item(s) outstanding</span>` : '<span class="chip ok">Complete</span>'}</div>
    ${issues.length ? `<p class="muted">Save your changes to refresh this checklist. The following must be completed before submission:</p><ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p>All mandatory information and documents are provided.</p>'}
    <div><label for="submit-note">Message to PROMERGON procurement (optional)</label><textarea id="submit-note" placeholder="${app.vendor.status === 'CLARIFICATION_REQUIRED' ? 'Summarise how you addressed the clarification…' : ''}"></textarea></div>
    <div class="row"><div class="spacer"></div><button type="button" class="btn-accent" data-action="submit">${app.vendor.status === 'CLARIFICATION_REQUIRED' ? 'Resubmit application' : 'Submit application'}</button></div>
  </div>`;
}

async function saveProfile({ quiet } = {}) {
  const form = $('#profile-form');
  if (!form || !EDITABLE.has(state.app.vendor.status)) return true;
  const data = collectForm(form);
  // Rebuild references list from current rows (indices may be sparse after deletions).
  if (data.experience?.references) data.experience.references = data.experience.references.filter(Boolean);
  const profile = deepMerge(structuredClone(state.app.profile), data);
  try {
    state.app = await api('PUT', '/api/vendor/application', { profile });
    state.dirty = false;
    if (!quiet) toast('Draft saved');
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

function bindUploadForm() {
  const form = $('#upload-form');
  if (!form) return;
  const sync = () => $('#u_exp_req').classList.toggle('hidden', !state.meta.documentTypes[$('#u_type').value]?.expires);
  $('#u_type').addEventListener('change', sync);
  sync();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await api('POST', '/api/vendor/documents', new FormData(form));
      toast('Document uploaded');
      await viewApplication();
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------- Staff views
async function viewDashboard() {
  const d = await api('GET', '/api/staff/dashboard');
  const m = state.meta;
  const k = d.byStatus;
  const kpi = (v, l, href, hl) => `<a class="kpi ${hl ? 'hl' : ''}" href="${href}"><div class="v">${v}</div><div class="l">${l}</div></a>`;
  render(shell(`
    <div class="page-head"><div><h1>Procurement dashboard</h1><p class="muted">Vendor registration & prequalification overview</p></div>
    <a class="btn" href="/api/staff/avl.csv">Export AVL (CSV)</a></div>
    <div class="kpis">
      ${kpi(k.SUBMITTED, 'New submissions', '#/vendors?status=SUBMITTED', true)}
      ${kpi(k.UNDER_REVIEW, 'Under review', '#/vendors?status=UNDER_REVIEW', true)}
      ${kpi(k.CLARIFICATION_REQUIRED, 'Awaiting vendor clarification', '#/vendors?status=CLARIFICATION_REQUIRED')}
      ${kpi(k.APPROVED + k.CONDITIONALLY_APPROVED, 'Approved vendors', '#/avl')}
      ${kpi(k.DRAFT, 'Drafts in progress', '#/vendors?status=DRAFT')}
      ${kpi(k.REJECTED + k.SUSPENDED, 'Rejected / suspended', '#/vendors?status=REJECTED')}
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h3>Review queue</h3><a href="#/vendors">All applications →</a></div>
        ${d.queue.length ? `<div class="table-wrap"><table><thead><tr><th>Company</th><th>Type</th><th>Status</th><th class="num">Score</th><th>Submitted</th></tr></thead><tbody>
        ${d.queue.map((v) => `<tr class="clickable" data-href="#/vendors/${v.id}"><td>${esc(v.company_name)}</td><td>${esc(m.vendorTypes[v.vendor_type])}</td><td>${chip(v.status)}</td><td class="num">${v.auto_score ?? '—'} ${grade(v.grade)}</td><td>${fmtDate(v.submitted_at)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No applications waiting for review.</div>'}</div>
      <div class="card"><div class="card-head"><h3>Expiring / expired documents (60 days)</h3></div>
        ${d.expiringDocs.length ? `<div class="table-wrap"><table><thead><tr><th>Vendor</th><th>Document</th><th>Expiry</th></tr></thead><tbody>
        ${d.expiringDocs.map((x) => `<tr class="clickable" data-href="#/vendors/${x.vendor_id}"><td>${esc(x.company_name)}<div class="hint">${esc(x.vendor_code)}</div></td><td>${esc(m.documentTypes[x.doc_type]?.name)}</td><td><span class="chip ${x.expired ? 'bad' : 'warn'}">${fmtDate(x.expiry_date)}</span></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No approved-vendor documents expiring soon.</div>'}</div>
      <div class="card"><div class="card-head"><h3>Requalification due (90 days)</h3></div>
        ${d.requalDue.length ? `<table><tbody>${d.requalDue.map((v) => `<tr class="clickable" data-href="#/vendors/${v.id}"><td>${esc(v.company_name)}<div class="hint">${esc(v.vendor_code)}</div></td><td>${fmtDate(v.approval_expires_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No requalifications due.</div>'}</div>
      <div class="card"><div class="card-head"><h3>Recent activity</h3></div>
        ${d.recent.length ? `<ul class="timeline">${d.recent.map((a) => `<li><a href="#/vendors/${a.vendor_id}">${esc(a.company_name)}</a> — ${esc(actionLabel(a))}<div class="hint">${esc(a.user_name || '')} · ${fmtDateTime(a.created_at)}</div></li>`).join('')}</ul>` : '<div class="empty">No activity yet.</div>'}</div>
    </div>`, '#/dashboard'));
}

function actionLabel(a) {
  if (a.action === 'SUBMITTED') return a.from_status === 'CLARIFICATION_REQUIRED' ? 'Resubmitted after clarification' : 'Application submitted';
  if (a.action === 'STATUS_CHANGED') return `Status → ${state.meta.statuses[a.to_status]}`;
  return { REGISTERED: 'Registered', DOCUMENT_UPLOADED: 'Document uploaded', DOCUMENT_DELETED: 'Document removed', EVALUATION_RECORDED: 'Evaluation recorded', USER_CREATED: 'User created', USER_DISABLED: 'User disabled', USER_ENABLED: 'User enabled' }[a.action] || a.action;
}

async function viewVendors(params) {
  const m = state.meta;
  const qs = new URLSearchParams(params);
  const rows = await api('GET', '/api/staff/vendors?' + qs);
  const opt = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
  render(shell(`
    <div class="page-head"><div><h1>Vendor applications</h1><p class="muted">${rows.length} record(s)</p></div></div>
    <form id="filter-form" class="filters card">
      <input type="text" name="q" placeholder="Search company, vendor code, country…" value="${esc(params.q || '')}" aria-label="Search">
      <select name="status" aria-label="Status"><option value="">All statuses</option>${opt(m.statuses, params.status)}</select>
      <select name="type" aria-label="Vendor type"><option value="">All types</option>${opt(m.vendorTypes, params.type)}</select>
      <select name="sector" aria-label="Sector"><option value="">All sectors</option>${opt(Object.fromEntries(Object.entries(m.sectors).map(([k, l]) => [k, l.split('(')[0]])), params.sector)}</select>
      <select name="category" aria-label="Category"><option value="">All categories</option>${opt(Object.fromEntries(m.categories.map((c) => [c.code, `${c.code} – ${c.name}`])), params.category)}</select>
    </form>
    <div class="card">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Company</th><th>Type</th><th>Country</th><th>Categories</th><th>Status</th><th class="num">Auto score</th><th>Updated</th></tr></thead><tbody>
      ${rows.map((v) => `<tr class="clickable" data-href="#/vendors/${v.id}"><td><strong>${esc(v.company_name)}</strong>${v.vendor_code ? `<div class="hint">${esc(v.vendor_code)}</div>` : ''}</td>
      <td>${esc(m.vendorTypes[v.vendor_type])}</td><td>${esc(v.country || '—')}</td>
      <td class="small">${v.categories.slice(0, 4).map(esc).join(', ')}${v.categories.length > 4 ? ` +${v.categories.length - 4}` : ''}</td>
      <td>${chip(v.status)}</td><td class="num">${v.auto_score ?? '—'} ${grade(v.grade)}</td><td>${fmtDate(v.updated_at)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No vendors match these filters.</div>'}</div>`, '#/vendors'));
  const form = $('#filter-form');
  let t;
  const apply = () => {
    const p = Object.fromEntries([...new FormData(form)].filter(([, v]) => v));
    location.hash = '#/vendors' + (Object.keys(p).length ? '?' + new URLSearchParams(p) : '');
  };
  form.addEventListener('change', apply);
  form.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 400); });
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  if (params.q) { form.q.focus(); form.q.setSelectionRange(form.q.value.length, form.q.value.length); }
}

const TRANSITION_UI = {
  UNDER_REVIEW: ['Start review', 'btn-primary', false],
  CLARIFICATION_REQUIRED: ['Request clarification', '', true],
  APPROVED: ['Approve', 'btn-primary', false],
  CONDITIONALLY_APPROVED: ['Approve with conditions', '', true],
  REJECTED: ['Reject', 'btn-danger', true],
  SUSPENDED: ['Suspend', 'btn-danger', true],
};
const RECS = { APPROVE: 'Approve', APPROVE_WITH_CONDITIONS: 'Approve with conditions', CLARIFY: 'Clarification needed', REJECT: 'Reject' };

async function viewVendorDetail(id, tab = 'profile') {
  const d = await api('GET', `/api/staff/vendors/${id}`);
  state.app = d;
  const m = state.meta;
  const v = d.vendor;
  const u = state.user;
  const tabs = [['profile', 'Application'], ['documents', `Documents (${d.documents.length})`], ['evaluation', `Evaluation (${d.reviews.length})`], ['history', 'History']];
  let body = '';
  if (tab === 'profile') {
    body = SECTIONS.filter((s) => s.render).map((s) => `<div class="card"><h2>${esc(s.title)}</h2><fieldset disabled>${s.render(d.profile)}</fieldset></div>`).join('');
  } else if (tab === 'documents') {
    body = documentsPanel(d, { editable: false, canUpload: false });
  } else if (tab === 'evaluation') {
    const canReview = ['SUBMITTED', 'UNDER_REVIEW', 'CONDITIONALLY_APPROVED'].includes(v.status) && u.role !== 'VENDOR';
    const discOpts = Object.entries(m.disciplines).filter(([k]) => u.role !== 'EVALUATOR' || !u.discipline || k === u.discipline);
    body = `<div class="card"><div class="card-head"><h3>Automatic prequalification score</h3><div class="score-big"><span class="score-num">${d.score.total}</span>${grade(d.score.grade)}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Section</th><th>Criterion</th><th class="num">Points</th></tr></thead><tbody>
      ${d.score.items.map((i) => `<tr><td>${esc(i.section)}</td><td>${esc(i.label)}</td><td class="num">${i.points} / ${i.max}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">Grades: A ≥ 75, B ≥ 60, C ≥ 45, D &lt; 45. The automatic score supports — but does not replace — discipline evaluation.</p></div>
      ${canReview ? `<form id="review-form" class="card"><h3>Record evaluation</h3><div id="review-err"></div><div class="grid g3">
        <div><label for="rv_disc">Discipline</label><select id="rv_disc" name="discipline" required>${discOpts.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div><label for="rv_score">Score (0–100)</label><input id="rv_score" type="number" name="score" min="0" max="100" step="1" required></div>
        <div><label for="rv_rec">Recommendation</label><select id="rv_rec" name="recommendation" required>${Object.entries(RECS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="span-all"><label for="rv_com">Comments / findings</label><textarea id="rv_com" name="comments"></textarea></div>
        <div class="span-all row"><div class="spacer"></div><button class="btn-primary" type="submit">Save evaluation</button></div></div></form>` : ''}
      <div class="card"><h3>Discipline evaluations</h3>${d.reviews.length ? d.reviews.map((r) => `<div class="review"><div class="row"><strong>${esc(m.disciplines[r.discipline])}</strong><span class="chip ${r.recommendation === 'APPROVE' ? 'ok' : r.recommendation === 'REJECT' ? 'bad' : 'warn'}">${esc(RECS[r.recommendation])}</span><div class="spacer"></div><strong>${r.score}/100</strong></div>
        ${r.comments ? `<p class="quote small">${esc(r.comments)}</p>` : ''}<div class="hint">${esc(r.reviewer_name)} · ${fmtDateTime(r.created_at)}</div></div>`).join('') : '<div class="empty">No evaluations recorded yet.</div>'}</div>`;
  } else {
    body = `<div class="card"><ul class="timeline">${d.history.map((h) => `<li><strong>${esc(actionLabel(h))}</strong>${h.from_status && h.to_status ? ` <span class="muted small">(from ${esc(m.statuses[h.from_status])})</span>` : ''}
      ${h.note ? `<div class="note">${esc(h.note)}</div>` : ''}<div class="hint">${esc(h.user_name || 'System')} · ${fmtDateTime(h.created_at)}</div></li>`).join('')}</ul></div>`;
  }

  const sec = d.score.sections;
  const actions = d.allowedTransitions.length ? `<div class="card"><h3>Workflow actions</h3><div id="act-err"></div>
    <label for="act-note">Note / reason <span class="muted small">(sent to vendor for clarification, conditions, rejection or suspension)</span></label>
    <textarea id="act-note"></textarea>
    <div class="row">${d.allowedTransitions.map((t) => `<button type="button" class="${TRANSITION_UI[t]?.[1] || ''}" data-action="transition" data-to="${t}" data-note="${TRANSITION_UI[t]?.[2] ? 1 : 0}">${esc(TRANSITION_UI[t]?.[0] || m.statuses[t])}</button>`).join('')}</div>
    ${d.issues.length && d.allowedTransitions.some((t) => t.includes('APPROVED')) ? `<div class="alert small"><strong>${d.issues.length} completeness issue(s):</strong><ul>${d.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
  </div>` : '';
  const avgReview = d.reviews.length ? Math.round(d.reviews.reduce((s, r) => s + r.score, 0) / d.reviews.length) : null;

  render(shell(`
    <p><a href="#/vendors">← All applications</a></p>
    <div class="page-head"><div><h1>${esc(v.company_name)}</h1><p class="muted">${esc(m.vendorTypes[v.vendor_type])} · ${esc(v.country || '')} ${v.vendor_code ? `· <strong>${esc(v.vendor_code)}</strong>` : ''} · ${chip(v.status)}</p></div></div>
    <div class="detail-grid">
      <div><div class="tabs">${tabs.map(([k, l]) => `<button type="button" class="${tab === k ? 'active' : ''}" data-action="detail-tab" data-tab="${k}" data-id="${v.id}">${esc(l)}</button>`).join('')}</div>${body}</div>
      <aside class="stack">
        <div class="card"><div class="card-head"><h3>Prequalification</h3>${grade(d.score.grade)}</div>
          <div class="score-big"><span class="score-num">${d.score.total}</span><span class="muted">/ 100 automatic<br>${avgReview !== null ? `${avgReview} avg. evaluator score` : 'no evaluations yet'}</span></div>
          <div class="bars">${Object.entries(sec).map(([k, s]) => `<div><div class="lbl"><span>${esc(k)}</span><span>${Math.round(s.points)} / ${s.max}</span></div><div class="bar"><span data-w="${(100 * s.points) / s.max}"></span></div></div>`).join('')}</div>
        </div>
        ${actions}
        <div class="card"><h3>Key facts</h3><dl class="kv">
          <dt>Registered</dt><dd>${fmtDate(v.created_at)}</dd>
          <dt>Submitted</dt><dd>${fmtDate(v.submitted_at)}</dd>
          <dt>Approved</dt><dd>${fmtDate(v.approved_at)}</dd>
          <dt>Requalify by</dt><dd>${fmtDate(v.approval_expires_at)}</dd>
          ${v.conditions ? `<dt>Conditions</dt><dd>${esc(v.conditions)}</dd>` : ''}
          <dt>Primary contact</dt><dd>${esc(d.profile.contacts.primary.name || '—')}<br><span class="small">${esc(d.profile.contacts.primary.email)} ${esc(d.profile.contacts.primary.phone)}</span></dd>
          <dt>Portal users</dt><dd>${d.users.map((x) => esc(x.email)).join('<br>')}</dd>
        </dl></div>
      </aside>
    </div>`, '#/vendors'));

  const rf = $('#review-form');
  if (rf) rf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(rf));
    try {
      await api('POST', `/api/staff/vendors/${v.id}/reviews`, { ...f, score: Number(f.score) });
      toast('Evaluation recorded');
      viewVendorDetail(v.id, 'evaluation');
    } catch (err) { $('#review-err').innerHTML = errorBox(err); }
  });
}

async function viewAvl() {
  const rows = await api('GET', '/api/staff/avl');
  const m = state.meta;
  render(shell(`
    <div class="page-head"><div><h1>Approved Vendor List</h1><p class="muted">${rows.length} approved supplier(s) & subcontractor(s)</p></div>
    <a class="btn btn-primary" href="/api/staff/avl.csv">Download CSV</a></div>
    <div class="card">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Vendor code</th><th>Company</th><th>Type</th><th>Categories</th><th>Status</th><th>Grade</th><th>Contact</th><th>Requalify by</th></tr></thead><tbody>
    ${rows.map((v) => `<tr class="clickable" data-href="#/vendors/${v.id}"><td><strong>${esc(v.vendor_code)}</strong></td><td>${esc(v.company_name)}<div class="hint">${esc(v.country || '')}</div></td><td>${esc(m.vendorTypes[v.vendor_type])}</td>
      <td class="small">${v.categories.map(esc).join(', ')}</td><td>${chip(v.status)}</td><td>${grade(v.grade)}</td>
      <td class="small">${esc(v.contact.name || '')}<br>${esc(v.contact.email || '')}</td><td>${fmtDate(v.approval_expires_at)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No approved vendors yet.</div>'}</div>`, '#/avl'));
}

async function viewUsers() {
  const users = await api('GET', '/api/staff/users');
  const m = state.meta;
  const staffRoles = Object.entries(m.roles).filter(([k]) => k !== 'VENDOR');
  render(shell(`
    <div class="page-head"><div><h1>User administration</h1><p class="muted">PROMERGON staff and vendor portal accounts</p></div></div>
    <form id="user-form" class="card"><h3>Add staff user</h3><div id="user-err"></div><div class="grid g4">
      <div><label for="nu_name">Name</label><input id="nu_name" type="text" name="name" required></div>
      <div><label for="nu_email">Email</label><input id="nu_email" type="email" name="email" required></div>
      <div><label for="nu_role">Role</label><select id="nu_role" name="role">${staffRoles.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
      <div><label for="nu_disc">Discipline (evaluators)</label><select id="nu_disc" name="discipline"><option value="">—</option>${Object.entries(m.disciplines).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
      <div class="span2"><label for="nu_pw">Temporary password</label><input id="nu_pw" type="text" name="password" required minlength="10" autocomplete="off"></div>
      <div class="span2 row"><div class="spacer"></div><button class="btn-primary" type="submit">Create user</button></div>
    </div></form>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Status</th><th></th></tr></thead><tbody>
    ${users.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${esc(m.roles[x.role])}${x.discipline ? `<div class="hint">${esc(m.disciplines[x.discipline])}</div>` : ''}</td><td>${esc(x.company_name || 'PROMERGON')}</td>
      <td>${x.active ? '<span class="chip ok">Active</span>' : '<span class="chip bad">Disabled</span>'}</td>
      <td>${x.id !== state.user.id ? `<button type="button" class="btn-sm" data-action="toggle-user" data-id="${x.id}" data-active="${x.active ? 0 : 1}">${x.active ? 'Disable' : 'Enable'}</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`, '#/users'));
  $('#user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/staff/users', Object.fromEntries(new FormData(e.target)));
      toast('User created');
      viewUsers();
    } catch (err) { $('#user-err').innerHTML = errorBox(err); }
  });
}

function viewAccount() {
  render(shell(`<div class="page-head"><div><h1>Account</h1><p class="muted">${esc(state.user.email)}</p></div></div>
    <form id="pw-form" class="card stack"><h3>Change password</h3><div id="pw-err"></div>
      <div class="grid g2"><div><label for="pw_cur">Current password</label><input id="pw_cur" type="password" name="currentPassword" required autocomplete="current-password"></div>
      <div><label for="pw_new">New password</label><input id="pw_new" type="password" name="newPassword" required minlength="10" autocomplete="new-password"><div class="hint">At least 10 characters, with letters and numbers.</div></div></div>
      <div class="row"><div class="spacer"></div><button class="btn-primary" type="submit">Update password</button></div></form>`, '#/account'));
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/auth/password', Object.fromEntries(new FormData(e.target)));
      e.target.reset();
      toast('Password updated');
    } catch (err) { $('#pw-err').innerHTML = errorBox(err); }
  });
}

// ---------------------------------------------------------------- Router
const go = (hash) => (location.hash === hash ? route() : (location.hash = hash));
async function route() {
  const [path, query] = location.hash.slice(1).split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  try {
    if (!state.user) return viewAuth(path === '/register' ? 'register' : 'login');
    const staff = state.user.role !== 'VENDOR';
    const parts = (path || '/').split('/').filter(Boolean);
    if (parts[0] === 'account') return viewAccount();
    if (!staff) return viewApplication();
    if (parts[0] === 'vendors' && parts[1]) return await viewVendorDetail(Number(parts[1]), params.tab);
    if (parts[0] === 'vendors') return await viewVendors(params);
    if (parts[0] === 'avl') return await viewAvl();
    if (parts[0] === 'users' && state.user.role === 'ADMIN') return await viewUsers();
    return await viewDashboard();
  } catch (e) {
    if (e.status === 401) { state.user = null; return viewAuth(); }
    render(shell(errorBox(e), ''));
  }
}

// ---------------------------------------------------------------- Global event delegation
document.addEventListener('click', async (ev) => {
  const row = ev.target.closest('tr[data-href]');
  if (row && !ev.target.closest('a,button')) { location.hash = row.dataset.href; return; }
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'auth-tab') viewAuth(el.dataset.mode);
  else if (a === 'logout') { await api('POST', '/api/auth/logout'); state.user = null; state.app = null; go('#/'); }
  else if (a === 'step') {
    const to = Number(el.dataset.step);
    if (to < 0 || to >= SECTIONS.length) return;
    if (!(await saveProfile({ quiet: true }))) return;
    state.step = to;
    renderApplication();
  } else if (a === 'save') {
    if (await saveProfile()) renderApplication();
  } else if (a === 'add-ref') {
    const tbody = $('#refs');
    const i = tbody.rows.length ? Math.max(...$$('input[name$=".client"]', tbody).map((x) => Number(x.name.split('.')[2]))) + 1 : 0;
    const sectorOpts = () => `<option value="">—</option>` + Object.entries(state.meta.sectors).map(([k, l]) => `<option value="${k}">${esc(l.split('(')[0])}</option>`).join('');
    tbody.insertAdjacentHTML('beforeend', refRow({}, i, sectorOpts));
  } else if (a === 'del-ref') {
    el.closest('tr').remove();
    if (state.app?.profile?.experience) state.app.profile.experience.references = [];
  } else if (a === 'del-doc') {
    if (!confirm('Remove this document?')) return;
    try { await api('DELETE', `/api/vendor/documents/${el.dataset.id}`); toast('Document removed'); viewApplication(); } catch (e) { toast(e.message, true); }
  } else if (a === 'submit') {
    if (!(await saveProfile({ quiet: true }))) return;
    if (state.app.issues.length) { renderApplication(); toast('Please complete the outstanding items first.', true); return; }
    if (!confirm('Submit your application to PROMERGON? The form will be locked during review.')) return;
    try {
      state.app = await api('POST', '/api/vendor/submit', { note: $('#submit-note')?.value || '' });
      toast('Application submitted');
      state.step = 0;
      renderApplication();
    } catch (e) { toast(e.message, true); }
  } else if (a === 'detail-tab') {
    location.hash = `#/vendors/${el.dataset.id}` + (el.dataset.tab !== 'profile' ? `?tab=${el.dataset.tab}` : '');
  } else if (a === 'transition') {
    const note = $('#act-note').value.trim();
    if (el.dataset.note === '1' && !note) { $('#act-err').innerHTML = errorBox(new Error('Please enter a note / reason for this action.')); $('#act-note').focus(); return; }
    const label = el.textContent.trim();
    if (!confirm(`${label}: ${state.app.vendor.company_name}?`)) return;
    try {
      await api('POST', `/api/staff/vendors/${state.app.vendor.id}/transition`, { to: el.dataset.to, note });
      toast(`${label} — done`);
      route();
    } catch (e) { $('#act-err').innerHTML = errorBox(e); }
  } else if (a === 'toggle-user') {
    try { await api('PATCH', `/api/staff/users/${el.dataset.id}`, { active: el.dataset.active === '1' }); viewUsers(); } catch (e) { toast(e.message, true); }
  }
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  if (form.id !== 'login-form' && form.id !== 'register-form') return;
  ev.preventDefault();
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    await api('POST', form.id === 'login-form' ? '/api/auth/login' : '/api/auth/register', data);
    state.user = (await api('GET', '/api/auth/me')).user;
    state.step = 0;
    go(state.user.role === 'VENDOR' ? '#/application' : '#/dashboard');
  } catch (e) {
    $('#auth-err').innerHTML = errorBox(e);
    btn.disabled = false;
  }
});

document.addEventListener('input', (ev) => { if (ev.target.closest('#profile-form')) state.dirty = true; });
window.addEventListener('beforeunload', (ev) => { if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; } });
window.addEventListener('hashchange', route);

(async function init() {
  try {
    [state.meta, { user: state.user }] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/auth/me')]);
  } catch {
    $('#app').innerHTML = '<div class="boot">Unable to reach the server. Please refresh.</div>';
    return;
  }
  route();
})();
