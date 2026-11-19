'use strict';
// Seeds demo staff accounts and sample vendors in various workflow states, via the real API.
// Usage: npm run seed:demo   (uses DATA_DIR, default ./data)
const { createApp } = require('../server/app');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@promergon.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Promergon2026';
const STAFF_PW = 'Promergon2026';
const VENDOR_PW = 'Vendor2026pass';

const app = createApp({ dataDir: process.env.DATA_DIR, adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD, log: () => {} });
const server = app.listen(0, run);
const base = () => `http://127.0.0.1:${server.address().port}`;

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const headers = cookie ? { cookie } : {};
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await fetch(base() + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    if (!res.ok && res.status !== 409) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
}

const y = new Date().getFullYear();
const VENDORS = [
  { co: 'Gulf Piping & Fabrication LLC', type: 'SUBCONTRACTOR', country: 'Saudi Arabia', city: 'Jubail', email: 'bids@gulfpiping.example',
    sectors: ['OG_DOWNSTREAM', 'OG_MIDSTREAM'], cats: ['W-PIPE', 'W-WELD', 'W-MECH'], turnover: 42e6, trir: 0.32, iso: true, years: 19, est: 2004,
    refs: [['Saudi Aramco', 'Ras Tanura refinery revamp', 'OG_DOWNSTREAM'], ['SABIC', 'Ethylene cracker piping', 'OG_DOWNSTREAM'], ['ADNOC Gas', 'Gas compression station', 'OG_MIDSTREAM']],
    flow: ['SUBMIT', 'UNDER_REVIEW', 'APPROVED'] },
  { co: 'Voltline Power Systems', type: 'MANUFACTURER', country: 'United Arab Emirates', city: 'Abu Dhabi', email: 'sales@voltline.example',
    sectors: ['PWR_TND', 'PWR_GENERATION'], cats: ['S-ELEQ', 'S-CABL'], turnover: 85e6, trir: 0.2, iso: true, years: 25, est: 1998,
    refs: [['DEWA', '400/132 kV GIS substation', 'PWR_TND'], ['TAQA', 'CCGT switchgear package', 'PWR_GENERATION']],
    flow: ['SUBMIT', 'UNDER_REVIEW', 'CONDITIONALLY_APPROVED'] },
  { co: 'Delta Valves Trading', type: 'SUPPLIER', country: 'Oman', city: 'Muscat', email: 'info@deltavalves.example',
    sectors: ['OG_UPSTREAM'], cats: ['S-VALV', 'S-PIPE'], turnover: 6e6, trir: null, iso: false, years: 8, est: 2015,
    refs: [['PDO', 'Wellhead valves supply', 'OG_UPSTREAM']], flow: ['SUBMIT', 'UNDER_REVIEW'] },
  { co: 'SunGrid Renewables EPC', type: 'SUBCONTRACTOR', country: 'Egypt', city: 'Cairo', email: 'tenders@sungrid.example',
    sectors: ['PWR_RENEWABLES'], cats: ['W-ELEC', 'W-CIVL', 'S-RENW'], turnover: 14e6, trir: 1.4, iso: true, years: 6, est: 2017,
    refs: [['ACWA Power', '200 MWp PV plant BOS', 'PWR_RENEWABLES']], flow: ['SUBMIT', 'CLARIFICATION_REQUIRED'] },
  { co: 'Apex Inspection Services', type: 'SERVICE_PROVIDER', country: 'India', city: 'Mumbai', email: 'ops@apexinspect.example',
    sectors: ['OG_DOWNSTREAM', 'PWR_GENERATION'], cats: ['V-INSP'], turnover: 3e6, trir: 0.6, iso: true, years: 12, est: 2010,
    refs: [['Reliance', 'Third-party inspection', 'OG_DOWNSTREAM']], flow: ['SUBMIT'] },
  { co: 'Northwind Scaffolding Co', type: 'SUBCONTRACTOR', country: 'Qatar', city: 'Doha', email: 'admin@northwind.example',
    sectors: ['OG_UPSTREAM'], cats: ['W-SCAF'], turnover: 1.2e6, trir: 2.8, iso: false, years: 3, est: 2021, refs: [], flow: [] },
];

const MANDATORY = {
  SUPPLIER: ['CR', 'TAX', 'PROFILE', 'FIN', 'BANK', 'MAF', 'CATALOGUE', 'CODE_OF_CONDUCT'],
  MANUFACTURER: ['CR', 'TAX', 'PROFILE', 'FIN', 'BANK', 'ISO9001', 'QA_MANUAL', 'CATALOGUE', 'CODE_OF_CONDUCT', 'PRODUCT_CERT'],
  SUBCONTRACTOR: ['CR', 'TAX', 'PROFILE', 'FIN', 'BANK', 'ORG', 'ISO9001', 'HSE_MANUAL', 'QA_MANUAL', 'HSE_STATS', 'INSURANCE', 'REFERENCES', 'CODE_OF_CONDUCT', 'ISO45001'],
  SERVICE_PROVIDER: ['CR', 'TAX', 'PROFILE', 'FIN', 'BANK', 'ORG', 'REFERENCES', 'CODE_OF_CONDUCT', 'ISO9001'],
};
const EXPIRES = new Set(['CR', 'TAX', 'ISO9001', 'ISO45001', 'INSURANCE', 'MAF', 'PRODUCT_CERT']);

async function run() {
  try {
    const admin = client();
    await admin('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const staff = [
      ['Sara Al-Mansour', 'procurement@promergon.com', 'PROCUREMENT_OFFICER'],
      ['Omar Khalid', 'manager@promergon.com', 'PROCUREMENT_MANAGER'],
      ['Priya Nair', 'hse@promergon.com', 'EVALUATOR', 'HSE'],
      ['James Carter', 'qaqc@promergon.com', 'EVALUATOR', 'QA_QC'],
      ['Lina Haddad', 'technical@promergon.com', 'EVALUATOR', 'TECHNICAL'],
    ];
    for (const [name, email, role, discipline] of staff)
      await admin('POST', '/api/staff/users', { name, email, role, discipline, password: STAFF_PW });
    const officer = client();
    await officer('POST', '/api/auth/login', { email: 'procurement@promergon.com', password: STAFF_PW });
    const mgr = client();
    await mgr('POST', '/api/auth/login', { email: 'manager@promergon.com', password: STAFF_PW });
    const hse = client();
    await hse('POST', '/api/auth/login', { email: 'hse@promergon.com', password: STAFF_PW });

    for (const v of VENDORS) {
      const c = client();
      const reg = await c('POST', '/api/auth/register', { companyName: v.co, vendorType: v.type, country: v.country, name: 'Demo Contact', email: v.email, password: VENDOR_PW });
      if (!reg?.ok) { console.log(`  skip ${v.co} (already exists)`); continue; }
      await c('PUT', '/api/vendor/application', { profile: {
        company: { legalName: v.co, registrationNumber: `CR-${Math.floor(Math.random() * 9e6 + 1e6)}`, taxNumber: `TRN-${Math.floor(Math.random() * 9e8 + 1e8)}`,
          yearEstablished: v.est, country: v.country, city: v.city, address: `Industrial Area, ${v.city}`, ownership: 'LOCAL', employees: Math.round(v.turnover / 1e5) },
        contacts: { primary: { name: 'Demo Contact', title: 'Business Development Manager', email: v.email, phone: '+971 4 000 0000' } },
        sectors: v.sectors, categories: v.cats, scopeDescription: `${v.co} – sample demo vendor.`,
        financial: { currency: 'USD', turnover: [0, 1, 2].map((i) => ({ year: y - 1 - i, amount: Math.round(v.turnover * (1 - i * 0.08)) })), bankName: 'Emirates NBD', iban: 'AE070331234567890123456' },
        hse: { iso45001: v.iso, iso14001: v.iso, hsePolicy: true, trir: v.trir, ltifr: v.trir === null ? null : v.trir / 2, fatalities3y: v.trir === null ? null : 0, manhours3y: v.turnover / 10 },
        quality: { iso9001: v.iso, qaManual: v.iso, certifications: v.type === 'MANUFACTURER' ? 'IEC 62271 type tests, KEMA certified' : '' },
        experience: { yearsOilGas: v.sectors.some((s) => s.startsWith('OG')) ? v.years : 0, yearsPower: v.sectors.some((s) => s.startsWith('PWR')) ? v.years : 0,
          references: v.refs.map(([client, project, sector], i) => ({ client, project, sector, scope: 'Supply / execution', value: 2e6 * (i + 1), year: y - 1 - i })) },
        capacity: { manpowerSkilled: 120, manpowerUnskilled: 80 },
        declarations: { antiBribery: true, sanctions: true, accuracy: true, signatoryName: 'Demo Contact', signatoryTitle: 'Managing Director' },
      } });
      if (!v.flow.length) { console.log(`  ${v.co}: DRAFT`); continue; }
      for (const t of MANDATORY[v.type]) {
        const fd = new FormData();
        fd.append('doc_type', t);
        if (EXPIRES.has(t)) fd.append('expiry_date', t === 'INSURANCE' && v.flow.includes('APPROVED') ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) : `${y + 2}-06-30`);
        fd.append('file', new Blob([`%PDF-1.4\n% Demo ${t} for ${v.co}\n`], { type: 'application/pdf' }), `${t.toLowerCase()}.pdf`);
        await c('POST', '/api/vendor/documents', fd);
      }
      const sub = await c('POST', '/api/vendor/submit', { note: 'Submitted for prequalification.' });
      const id = sub.vendor.id;
      for (const to of v.flow.slice(1)) {
        if (to === 'APPROVED' || to === 'CONDITIONALLY_APPROVED')
          await hse('POST', `/api/staff/vendors/${id}/reviews`, { discipline: 'HSE', score: 85, recommendation: 'APPROVE', comments: 'HSE statistics verified.' });
        const actor = to.includes('APPROVED') ? mgr : officer;
        const note = { CLARIFICATION_REQUIRED: 'Please upload the signed HSE statistics for the last 3 years and confirm TRIR calculation basis.',
          CONDITIONALLY_APPROVED: 'Approved for S-ELEQ only. Submit updated KEMA type-test certificates within 90 days.' }[to] || '';
        await actor('POST', `/api/staff/vendors/${id}/transition`, { to, note });
      }
      console.log(`  ${v.co}: ${v.flow.at(-1) === 'SUBMIT' ? 'SUBMITTED' : v.flow.at(-1)}`);
    }
    console.log(`
Demo data ready. Sign-in accounts:
  Administrator         ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}  (only if this seeder created the admin)
  Procurement officer   procurement@promergon.com / ${STAFF_PW}
  Procurement manager   manager@promergon.com / ${STAFF_PW}
  HSE evaluator         hse@promergon.com / ${STAFF_PW}
  Vendor (draft)        admin@northwind.example / ${VENDOR_PW}
  Vendor (clarify)      tenders@sungrid.example / ${VENDOR_PW}
  Vendor (approved)     bids@gulfpiping.example / ${VENDOR_PW}`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}
