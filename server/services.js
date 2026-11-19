'use strict';
const { normalizeProfile, computeScore, validateForSubmission } = require('./lib/profile');
const { VENDOR_CODE_PREFIX, APPROVAL_VALIDITY_YEARS } = require('./lib/catalog');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function audit(db, { vendorId, userId, action, from = null, to = null, note = null }) {
  db.prepare(
    'INSERT INTO audit_log (vendor_id, user_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(vendorId ?? null, userId ?? null, action, from, to, note);
}

function getVendorRow(db, id) {
  const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
  if (!v) throw new HttpError(404, 'Vendor not found.');
  return v;
}

function listDocuments(db, vendorId) {
  return db.prepare(
    `SELECT id, vendor_id, doc_type, filename, mime, size, issue_date, expiry_date, uploaded_at
     FROM documents WHERE vendor_id = ? ORDER BY doc_type, uploaded_at DESC`
  ).all(vendorId);
}

function profileOf(v) {
  return normalizeProfile(JSON.parse(v.profile_json || '{}'));
}

/** Recalculate and persist the automatic score; keeps categories table in sync with profile. */
function refreshDerived(db, vendorId) {
  const v = getVendorRow(db, vendorId);
  const profile = profileOf(v);
  const docs = listDocuments(db, vendorId);
  const score = computeScore(v, profile, docs);
  db.prepare("UPDATE vendors SET auto_score = ?, grade = ?, updated_at = datetime('now') WHERE id = ?")
    .run(score.total, score.grade, vendorId);
  db.prepare('DELETE FROM vendor_categories WHERE vendor_id = ?').run(vendorId);
  const ins = db.prepare('INSERT INTO vendor_categories (vendor_id, category_code) VALUES (?, ?)');
  for (const c of profile.categories) ins.run(vendorId, c);
  return score;
}

/** Full vendor view used by both the vendor portal and the staff back-office. */
function vendorDetail(db, vendorId, { includeInternal }) {
  const v = getVendorRow(db, vendorId);
  const profile = profileOf(v);
  const documents = listDocuments(db, vendorId);
  const score = computeScore(v, profile, documents);
  const issues = validateForSubmission(v, profile, documents);
  const history = db.prepare(
    `SELECT a.id, a.action, a.from_status, a.to_status, a.note, a.created_at, u.name AS user_name, u.role AS user_role
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.vendor_id = ? ORDER BY a.id DESC`
  ).all(vendorId);
  const out = {
    vendor: {
      id: v.id,
      company_name: v.company_name,
      vendor_type: v.vendor_type,
      country: v.country,
      status: v.status,
      vendor_code: v.vendor_code,
      conditions: v.conditions,
      submitted_at: v.submitted_at,
      approved_at: v.approved_at,
      approval_expires_at: v.approval_expires_at,
      created_at: v.created_at,
      updated_at: v.updated_at,
    },
    profile,
    documents,
    issues,
  };
  if (includeInternal) {
    out.score = score;
    out.history = history;
    out.reviews = db.prepare(
      `SELECT r.*, u.name AS reviewer_name FROM reviews r JOIN users u ON u.id = r.reviewer_id
       WHERE r.vendor_id = ? ORDER BY r.id DESC`
    ).all(vendorId);
    out.users = db.prepare('SELECT id, name, email, active FROM users WHERE vendor_id = ?').all(vendorId);
  } else {
    // Vendors only see status changes and messages addressed to them, not internal reviewer names.
    out.history = history
      .filter((h) => h.to_status || h.action === 'SUBMITTED')
      .map(({ id, action, from_status, to_status, note, created_at, user_role }) => ({
        id, action, from_status, to_status, created_at,
        note: user_role === 'VENDOR' || ['CLARIFICATION_REQUIRED', 'REJECTED', 'CONDITIONALLY_APPROVED', 'SUSPENDED'].includes(to_status) ? note : null,
      }));
  }
  return out;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/** Apply approval side-effects: vendor code, approval and requalification dates. */
function approvalFields(v) {
  const code = v.vendor_code || `PRM-${VENDOR_CODE_PREFIX[v.vendor_type] || 'VEN'}-${String(v.id).padStart(5, '0')}`;
  const now = new Date();
  return { code, approvedAt: now.toISOString(), expires: addYears(now, APPROVAL_VALIDITY_YEARS) };
}

module.exports = {
  HttpError,
  audit,
  getVendorRow,
  listDocuments,
  profileOf,
  refreshDerived,
  vendorDetail,
  approvalFields,
};
