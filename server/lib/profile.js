'use strict';
// Normalisation, validation and automatic prequalification scoring of a vendor profile.
const { SECTORS, CATEGORY_CODES, DOCUMENT_TYPES } = require('./catalog');

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const bool = (v) => v === true || v === 'true';
const person = (p = {}) => ({
  name: str(p.name, 120),
  title: str(p.title, 120),
  email: str(p.email, 200),
  phone: str(p.phone, 50),
});

/** Coerce arbitrary client input into the canonical profile shape (unknown keys dropped). */
function normalizeProfile(input = {}) {
  const c = input.company || {};
  const f = input.financial || {};
  const h = input.hse || {};
  const q = input.quality || {};
  const e = input.experience || {};
  const k = input.capacity || {};
  const d = input.declarations || {};
  const ct = input.contacts || {};
  return {
    company: {
      legalName: str(c.legalName, 200),
      tradeName: str(c.tradeName, 200),
      registrationNumber: str(c.registrationNumber, 100),
      taxNumber: str(c.taxNumber, 100),
      yearEstablished: num(c.yearEstablished),
      country: str(c.country, 100),
      city: str(c.city, 100),
      address: str(c.address, 500),
      website: str(c.website, 200),
      ownership: ['LOCAL', 'FOREIGN', 'JV'].includes(c.ownership) ? c.ownership : '',
      localContentPct: num(c.localContentPct),
      employees: num(c.employees),
    },
    contacts: { primary: person(ct.primary), hse: person(ct.hse), quality: person(ct.quality) },
    sectors: Array.isArray(input.sectors) ? [...new Set(input.sectors.filter((s) => s in SECTORS))] : [],
    categories: Array.isArray(input.categories)
      ? [...new Set(input.categories.filter((s) => CATEGORY_CODES.has(s)))]
      : [],
    scopeDescription: str(input.scopeDescription, 3000),
    financial: {
      currency: str(f.currency, 3).toUpperCase() || 'USD',
      turnover: (Array.isArray(f.turnover) ? f.turnover : []).slice(0, 3).map((t) => ({
        year: num(t && t.year),
        amount: num(t && t.amount),
      })),
      bankName: str(f.bankName, 200),
      accountName: str(f.accountName, 200),
      iban: str(f.iban, 50).replace(/\s+/g, '').toUpperCase(),
      swift: str(f.swift, 20).toUpperCase(),
    },
    hse: {
      iso45001: bool(h.iso45001),
      iso14001: bool(h.iso14001),
      hsePolicy: bool(h.hsePolicy),
      manhours3y: num(h.manhours3y),
      trir: num(h.trir),
      ltifr: num(h.ltifr),
      fatalities3y: num(h.fatalities3y),
    },
    quality: {
      iso9001: bool(q.iso9001),
      qaManual: bool(q.qaManual),
      certifications: str(q.certifications, 1000),
    },
    experience: {
      yearsOilGas: num(e.yearsOilGas),
      yearsPower: num(e.yearsPower),
      references: (Array.isArray(e.references) ? e.references : []).slice(0, 20).map((r = {}) => ({
        client: str(r.client, 200),
        project: str(r.project, 200),
        scope: str(r.scope, 500),
        sector: r.sector in SECTORS ? r.sector : '',
        value: num(r.value),
        year: num(r.year),
      })).filter((r) => r.client || r.project),
    },
    capacity: {
      manpowerSkilled: num(k.manpowerSkilled),
      manpowerUnskilled: num(k.manpowerUnskilled),
      workshopArea: num(k.workshopArea),
      majorEquipment: str(k.majorEquipment, 2000),
    },
    declarations: {
      antiBribery: bool(d.antiBribery),
      conflictOfInterest: bool(d.conflictOfInterest),
      conflictDetails: str(d.conflictDetails, 1000),
      sanctions: bool(d.sanctions),
      accuracy: bool(d.accuracy),
      signatoryName: str(d.signatoryName, 120),
      signatoryTitle: str(d.signatoryTitle, 120),
    },
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the list of documents that are mandatory for a vendor type. */
function requiredDocs(vendorType) {
  return Object.entries(DOCUMENT_TYPES)
    .filter(([, d]) => d.required.includes(vendorType))
    .map(([k]) => k);
}

function isExpired(doc, today = new Date().toISOString().slice(0, 10)) {
  return Boolean(doc.expiry_date && doc.expiry_date < today);
}

/**
 * Check that an application is complete enough to submit.
 * Returns an array of human-readable problems (empty = OK).
 */
function validateForSubmission(vendor, profile, documents) {
  const errs = [];
  const c = profile.company;
  if (!c.legalName) errs.push('Company legal name is required.');
  if (!c.registrationNumber) errs.push('Commercial registration number is required.');
  if (!c.taxNumber) errs.push('Tax / VAT number is required.');
  if (!c.country) errs.push('Country of registration is required.');
  if (!c.address) errs.push('Registered address is required.');
  if (!c.yearEstablished || c.yearEstablished < 1800 || c.yearEstablished > new Date().getFullYear())
    errs.push('A valid year of establishment is required.');
  const p = profile.contacts.primary;
  if (!p.name || !EMAIL_RE.test(p.email) || !p.phone)
    errs.push('Primary contact name, valid email and phone are required.');
  if (!profile.sectors.length) errs.push('Select at least one sector (Oil & Gas / Power).');
  if (!profile.categories.length) errs.push('Select at least one product / service category.');
  if (!profile.financial.turnover.some((t) => t.year && t.amount))
    errs.push('Provide annual turnover for at least one of the last three years.');
  if (!profile.financial.bankName || !profile.financial.iban)
    errs.push('Bank name and account / IBAN are required.');
  if (vendor.vendor_type === 'SUBCONTRACTOR') {
    if (profile.hse.trir === null) errs.push('Subcontractors must declare their TRIR.');
    if (profile.hse.fatalities3y === null) errs.push('Subcontractors must declare fatalities in the last 3 years.');
  }
  const d = profile.declarations;
  if (!d.antiBribery || !d.sanctions || !d.accuracy)
    errs.push('All mandatory declarations (anti-bribery, sanctions, accuracy) must be accepted.');
  if (!d.signatoryName || !d.signatoryTitle) errs.push('Authorised signatory name and title are required.');

  for (const type of requiredDocs(vendor.vendor_type)) {
    const docs = documents.filter((x) => x.doc_type === type);
    if (!docs.length) errs.push(`Missing mandatory document: ${DOCUMENT_TYPES[type].name}.`);
    else if (docs.every((x) => isExpired(x))) errs.push(`Document has expired: ${DOCUMENT_TYPES[type].name}.`);
  }
  for (const doc of documents) {
    if (DOCUMENT_TYPES[doc.doc_type]?.expires && !doc.expiry_date)
      errs.push(`Expiry date missing for: ${DOCUMENT_TYPES[doc.doc_type].name} (${doc.filename}).`);
  }
  return errs;
}

/**
 * Automatic prequalification score (0–100) used to support — not replace — evaluator judgement.
 * Weights: Documents 20, Quality 20, HSE 25, Financial 15, Experience 20.
 */
function computeScore(vendor, profile, documents) {
  const has = (t) => documents.some((d) => d.doc_type === t && !isExpired(d));
  const items = [];
  const add = (section, label, points, max) => items.push({ section, label, points: Math.round(points * 10) / 10, max });

  // Documents (20)
  const req = requiredDocs(vendor.vendor_type);
  const valid = req.filter(has).length;
  add('Documents', `Mandatory documents valid (${valid}/${req.length})`, req.length ? (20 * valid) / req.length : 20, 20);

  // Quality (20)
  add('Quality', 'ISO 9001 certified', profile.quality.iso9001 && has('ISO9001') ? 10 : profile.quality.iso9001 ? 5 : 0, 10);
  add('Quality', 'QA/QC manual', profile.quality.qaManual || has('QA_MANUAL') ? 5 : 0, 5);
  add('Quality', 'Product / industry certifications (API, ASME, IEC…)',
    profile.quality.certifications || has('PRODUCT_CERT') ? 5 : 0, 5);

  // HSE (25)
  const h = profile.hse;
  add('HSE', 'ISO 45001 certified', h.iso45001 ? (has('ISO45001') ? 6 : 3) : 0, 6);
  add('HSE', 'ISO 14001 certified', h.iso14001 ? (has('ISO14001') ? 3 : 1.5) : 0, 3);
  add('HSE', 'HSE policy in place', h.hsePolicy || has('HSE_MANUAL') ? 2 : 0, 2);
  let trirPts = 0;
  if (h.trir !== null) trirPts = h.trir <= 0.5 ? 8 : h.trir <= 1 ? 6 : h.trir <= 2 ? 3 : 0;
  add('HSE', `TRIR ${h.trir ?? 'not declared'} (≤0.5 best)`, trirPts, 8);
  let fatPts = 0;
  if (h.fatalities3y !== null) fatPts = h.fatalities3y === 0 ? 6 : 0;
  add('HSE', 'Zero fatalities in last 3 years', fatPts, 6);

  // Financial (15) – based on average declared turnover in USD-equivalent bands.
  const amounts = profile.financial.turnover.map((t) => t.amount).filter((a) => a);
  const avg = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
  const finPts = avg >= 50e6 ? 10 : avg >= 10e6 ? 8 : avg >= 2e6 ? 6 : avg >= 5e5 ? 3 : avg > 0 ? 1 : 0;
  add('Financial', `Average annual turnover (${amounts.length} yr declared)`, finPts, 10);
  add('Financial', 'Audited financial statements', has('FIN') ? 3 : 0, 3);
  add('Financial', 'Bank reference', has('BANK') ? 2 : 0, 2);

  // Experience (20)
  const refs = profile.experience.references.filter((r) => r.sector);
  add('Experience', `Relevant O&G / Power references (${refs.length})`, Math.min(refs.length, 5) * 2, 10);
  const years = Math.max(profile.experience.yearsOilGas || 0, profile.experience.yearsPower || 0);
  add('Experience', `Sector experience (${years} yrs)`, years >= 15 ? 6 : years >= 10 ? 5 : years >= 5 ? 3 : years >= 2 ? 1 : 0, 6);
  const age = profile.company.yearEstablished ? new Date().getFullYear() - profile.company.yearEstablished : 0;
  add('Experience', `Years in business (${age})`, age >= 10 ? 4 : age >= 5 ? 3 : age >= 2 ? 1 : 0, 4);

  const total = Math.round(items.reduce((s, i) => s + i.points, 0));
  const sections = {};
  for (const i of items) {
    sections[i.section] ??= { points: 0, max: 0 };
    sections[i.section].points += i.points;
    sections[i.section].max += i.max;
  }
  const grade = total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : 'D';
  return { total, grade, sections, items };
}

module.exports = { normalizeProfile, validateForSubmission, computeScore, requiredDocs, isExpired };
