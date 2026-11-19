'use strict';
const express = require('express');
const { requireStaff, requireRole, hashPassword, passwordProblem } = require('../auth');
const { STAFF_TRANSITIONS, STATUSES, DISCIPLINES, ROLES, STAFF_ROLES, VENDOR_TYPES, CATEGORIES, SECTORS } = require('../lib/catalog');
const { tx } = require('../db');
const S = require('../services');
const { csvCell } = require('../lib/csv');

const NOTE_REQUIRED = new Set(['CLARIFICATION_REQUIRED', 'REJECTED', 'SUSPENDED', 'CONDITIONALLY_APPROVED']);
const REVIEWABLE = new Set(['SUBMITTED', 'UNDER_REVIEW', 'CONDITIONALLY_APPROVED']);
const RECOMMENDATIONS = new Set(['APPROVE', 'APPROVE_WITH_CONDITIONS', 'REJECT', 'CLARIFY']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function staffRoutes(db) {
  const r = express.Router();
  r.use(requireStaff);

  r.get('/dashboard', (_req, res) => {
    const byStatus = Object.fromEntries(Object.keys(STATUSES).map((s) => [s, 0]));
    for (const row of db.prepare('SELECT status, COUNT(*) n FROM vendors GROUP BY status').all()) byStatus[row.status] = row.n;
    const byType = db.prepare(
      "SELECT vendor_type, COUNT(*) n FROM vendors WHERE status IN ('APPROVED','CONDITIONALLY_APPROVED') GROUP BY vendor_type"
    ).all();
    const today = new Date().toISOString().slice(0, 10);
    const in60 = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const expiringDocs = db.prepare(
      `SELECT d.id, d.doc_type, d.filename, d.expiry_date, v.id AS vendor_id, v.company_name, v.vendor_code
       FROM documents d JOIN vendors v ON v.id = d.vendor_id
       WHERE d.expiry_date IS NOT NULL AND d.expiry_date <= ? AND v.status IN ('APPROVED','CONDITIONALLY_APPROVED')
       ORDER BY d.expiry_date LIMIT 50`
    ).all(in60).map((d) => ({ ...d, expired: d.expiry_date < today }));
    const requalDue = db.prepare(
      `SELECT id, company_name, vendor_code, approval_expires_at FROM vendors
       WHERE status IN ('APPROVED','CONDITIONALLY_APPROVED') AND approval_expires_at <= ? ORDER BY approval_expires_at LIMIT 50`
    ).all(new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10));
    const queue = db.prepare(
      `SELECT id, company_name, vendor_type, status, auto_score, grade, submitted_at FROM vendors
       WHERE status IN ('SUBMITTED','UNDER_REVIEW') ORDER BY submitted_at LIMIT 20`
    ).all();
    const recent = db.prepare(
      `SELECT a.action, a.from_status, a.to_status, a.created_at, v.id AS vendor_id, v.company_name, u.name AS user_name
       FROM audit_log a JOIN vendors v ON v.id = a.vendor_id LEFT JOIN users u ON u.id = a.user_id
       WHERE a.action IN ('REGISTERED', 'SUBMITTED', 'STATUS_CHANGED', 'EVALUATION_RECORDED')
       ORDER BY a.id DESC LIMIT 12`
    ).all();
    res.json({ byStatus, byType, expiringDocs, requalDue, queue, recent });
  });

  r.get('/vendors', (req, res) => {
    const where = [];
    const args = [];
    const { status, type, category, sector, q } = req.query;
    if (status && STATUSES[status]) { where.push('v.status = ?'); args.push(status); }
    if (type && VENDOR_TYPES[type]) { where.push('v.vendor_type = ?'); args.push(type); }
    if (category) { where.push('EXISTS (SELECT 1 FROM vendor_categories c WHERE c.vendor_id = v.id AND c.category_code = ?)'); args.push(String(category)); }
    if (sector && SECTORS[sector]) { where.push("EXISTS (SELECT 1 FROM json_each(v.profile_json, '$.sectors') j WHERE j.value = ?)"); args.push(sector); }
    if (q) {
      where.push('(v.company_name LIKE ? OR v.vendor_code LIKE ? OR v.country LIKE ?)');
      const like = `%${String(q).slice(0, 100)}%`;
      args.push(like, like, like);
    }
    const rows = db.prepare(
      `SELECT v.id, v.company_name, v.vendor_type, v.country, v.status, v.vendor_code, v.auto_score, v.grade,
              v.submitted_at, v.approval_expires_at, v.updated_at,
              (SELECT group_concat(category_code, ',') FROM vendor_categories c WHERE c.vendor_id = v.id) AS categories
       FROM vendors v ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY v.updated_at DESC LIMIT 500`
    ).all(...args);
    res.json(rows.map((x) => ({ ...x, categories: x.categories ? x.categories.split(',') : [] })));
  });

  r.get('/vendors/:id', (req, res) => {
    const detail = S.vendorDetail(db, Number(req.params.id), { includeInternal: true });
    const transitions = STAFF_TRANSITIONS[detail.vendor.status] || {};
    detail.allowedTransitions = Object.entries(transitions)
      .filter(([, roles]) => roles.includes(req.user.role)).map(([to]) => to);
    res.json(detail);
  });

  r.post('/vendors/:id/transition', (req, res) => {
    const v = S.getVendorRow(db, Number(req.params.id));
    const to = req.body?.to;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 4000) : '';
    const roles = STAFF_TRANSITIONS[v.status]?.[to];
    if (!roles) throw new S.HttpError(409, `Cannot move from ${STATUSES[v.status]} to ${STATUSES[to] || to}.`);
    if (!roles.includes(req.user.role)) throw new S.HttpError(403, 'Your role cannot perform this action.');
    if (NOTE_REQUIRED.has(to) && !note) throw new S.HttpError(400, 'A note / reason is required for this action.');

    tx(db, () => {
      if (to === 'APPROVED' || to === 'CONDITIONALLY_APPROVED') {
        const wasApproved = v.status === 'APPROVED' || v.status === 'CONDITIONALLY_APPROVED';
        const a = S.approvalFields(v);
        db.prepare(
          `UPDATE vendors SET status = ?, vendor_code = ?, conditions = ?,
             approved_at = CASE WHEN ? THEN approved_at ELSE ? END,
             approval_expires_at = CASE WHEN ? AND approval_expires_at IS NOT NULL THEN approval_expires_at ELSE ? END,
             updated_at = datetime('now') WHERE id = ?`
        ).run(to, a.code, to === 'CONDITIONALLY_APPROVED' ? note : null,
          wasApproved ? 1 : 0, a.approvedAt, wasApproved || v.status === 'SUSPENDED' ? 1 : 0, a.expires, v.id);
      } else {
        db.prepare("UPDATE vendors SET status = ?, updated_at = datetime('now') WHERE id = ?").run(to, v.id);
      }
      S.audit(db, { vendorId: v.id, userId: req.user.id, action: 'STATUS_CHANGED', from: v.status, to, note: note || null });
    });
    res.json(S.vendorDetail(db, v.id, { includeInternal: true }));
  });

  r.post('/vendors/:id/reviews', requireRole('EVALUATOR', 'PROCUREMENT_OFFICER', 'PROCUREMENT_MANAGER', 'ADMIN'), (req, res) => {
    const v = S.getVendorRow(db, Number(req.params.id));
    if (!REVIEWABLE.has(v.status)) throw new S.HttpError(409, 'Evaluations can only be recorded while the application is under review.');
    const { discipline, recommendation } = req.body || {};
    const score = Number(req.body?.score);
    const comments = typeof req.body?.comments === 'string' ? req.body.comments.trim().slice(0, 4000) : '';
    if (!DISCIPLINES[discipline]) throw new S.HttpError(400, 'Select a valid discipline.');
    if (req.user.role === 'EVALUATOR' && req.user.discipline && req.user.discipline !== discipline)
      throw new S.HttpError(403, `You may only evaluate the ${DISCIPLINES[req.user.discipline]} discipline.`);
    if (!Number.isInteger(score) || score < 0 || score > 100) throw new S.HttpError(400, 'Score must be a whole number from 0 to 100.');
    if (!RECOMMENDATIONS.has(recommendation)) throw new S.HttpError(400, 'Select a valid recommendation.');
    if (recommendation !== 'APPROVE' && !comments) throw new S.HttpError(400, 'Comments are required unless recommending approval.');
    tx(db, () => {
      db.prepare('INSERT INTO reviews (vendor_id, reviewer_id, discipline, score, recommendation, comments) VALUES (?, ?, ?, ?, ?, ?)')
        .run(v.id, req.user.id, discipline, score, recommendation, comments || null);
      S.audit(db, { vendorId: v.id, userId: req.user.id, action: 'EVALUATION_RECORDED',
        note: `${DISCIPLINES[discipline]}: ${score}/100 – ${recommendation}` });
    });
    res.status(201).json(S.vendorDetail(db, v.id, { includeInternal: true }));
  });

  // Approved Vendor List (AVL)
  const avlRows = () => db.prepare(
    `SELECT v.id, v.vendor_code, v.company_name, v.vendor_type, v.country, v.status, v.grade, v.auto_score,
            v.approved_at, v.approval_expires_at, v.conditions, v.profile_json,
            (SELECT group_concat(category_code, ',') FROM vendor_categories c WHERE c.vendor_id = v.id) AS categories
     FROM vendors v WHERE v.status IN ('APPROVED','CONDITIONALLY_APPROVED') ORDER BY v.vendor_code`
  ).all().map(({ profile_json, ...x }) => {
    const p = JSON.parse(profile_json || '{}');
    return { ...x, categories: x.categories ? x.categories.split(',') : [], sectors: p.sectors || [],
      contact: p.contacts?.primary || {} };
  });

  r.get('/avl', (_req, res) => res.json(avlRows()));

  r.get('/avl.csv', (_req, res) => {
    const catName = Object.fromEntries(CATEGORIES.map((c) => [c.code, c.name]));
    const header = ['Vendor code', 'Company', 'Type', 'Country', 'Status', 'Grade', 'Auto score', 'Sectors',
      'Categories', 'Primary contact', 'Email', 'Phone', 'Approved', 'Requalification due', 'Conditions'];
    const lines = [header.map(csvCell).join(',')];
    for (const v of avlRows()) {
      lines.push([v.vendor_code, v.company_name, VENDOR_TYPES[v.vendor_type], v.country, STATUSES[v.status], v.grade,
        v.auto_score, v.sectors.map((s) => SECTORS[s]).join('; '), v.categories.map((c) => `${c} ${catName[c] || ''}`).join('; '),
        v.contact.name, v.contact.email, v.contact.phone, v.approved_at?.slice(0, 10), v.approval_expires_at, v.conditions]
        .map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="promergon-avl-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  });

  // User administration
  const admin = requireRole('ADMIN');
  r.get('/users', admin, (_req, res) => {
    res.json(db.prepare(
      `SELECT u.id, u.email, u.name, u.role, u.discipline, u.active, u.created_at, v.company_name
       FROM users u LEFT JOIN vendors v ON v.id = u.vendor_id ORDER BY u.role = 'VENDOR', u.name`
    ).all());
  });

  r.post('/users', admin, (req, res) => {
    const { email, name, role, discipline, password } = req.body || {};
    if (!EMAIL_RE.test(email || '')) throw new S.HttpError(400, 'Valid email required.');
    if (!name || typeof name !== 'string') throw new S.HttpError(400, 'Name required.');
    if (!STAFF_ROLES.has(role)) throw new S.HttpError(400, 'Select a staff role.');
    if (role === 'EVALUATOR' && !DISCIPLINES[discipline]) throw new S.HttpError(400, 'Evaluators need a discipline.');
    const pwErr = passwordProblem(password);
    if (pwErr) throw new S.HttpError(400, pwErr);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new S.HttpError(409, 'Email already in use.');
    const info = db.prepare('INSERT INTO users (email, password_hash, name, role, discipline) VALUES (?, ?, ?, ?, ?)')
      .run(email.trim(), hashPassword(password), name.trim().slice(0, 120), role, role === 'EVALUATOR' ? discipline : null);
    S.audit(db, { userId: req.user.id, action: 'USER_CREATED', note: `${email} (${ROLES[role]})` });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/users/:id', admin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) throw new S.HttpError(404, 'User not found.');
    if (u.id === req.user.id) throw new S.HttpError(400, 'You cannot change your own account here.');
    if (typeof req.body?.active === 'boolean') {
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, u.id);
      if (!req.body.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      S.audit(db, { vendorId: u.vendor_id, userId: req.user.id, action: req.body.active ? 'USER_ENABLED' : 'USER_DISABLED', note: u.email });
    }
    res.json({ ok: true });
  });

  return r;
};
