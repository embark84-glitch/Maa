'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { requireVendor } = require('../auth');
const { DOCUMENT_TYPES, VENDOR_EDITABLE } = require('../lib/catalog');
const { normalizeProfile, validateForSubmission } = require('../lib/profile');
const { tx } = require('../db');
const S = require('../services');

const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx', '.zip']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Vendors may still renew/upload documents after approval (e.g. replacing an expired certificate).
const UPLOAD_ALLOWED = new Set([...VENDOR_EDITABLE, 'APPROVED', 'CONDITIONALLY_APPROVED', 'SUSPENDED']);

module.exports = function vendorRoutes(db, { uploadDir, maxUploadMb }) {
  const r = express.Router();
  r.use(requireVendor);

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _f, cb) => cb(null, uploadDir),
      filename: (_req, _f, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
    }),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ok = ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : new S.HttpError(400, `File type not allowed. Allowed: ${[...ALLOWED_EXT].join(', ')}`), ok);
    },
  });

  r.get('/application', (req, res) => {
    res.json(S.vendorDetail(db, req.user.vendor_id, { includeInternal: false }));
  });

  r.put('/application', (req, res) => {
    const v = S.getVendorRow(db, req.user.vendor_id);
    if (!VENDOR_EDITABLE.has(v.status))
      throw new S.HttpError(409, 'Your application is locked while it is being processed.');
    const profile = normalizeProfile(req.body?.profile);
    tx(db, () => {
      db.prepare("UPDATE vendors SET profile_json = ?, company_name = ?, country = ?, updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(profile), profile.company.legalName || v.company_name, profile.company.country || v.country, v.id);
      S.refreshDerived(db, v.id);
    });
    res.json(S.vendorDetail(db, v.id, { includeInternal: false }));
  });

  r.post('/documents', upload.single('file'), (req, res) => {
    const cleanup = () => req.file && fs.rm(req.file.path, { force: true }, () => {});
    try {
      const v = S.getVendorRow(db, req.user.vendor_id);
      if (!UPLOAD_ALLOWED.has(v.status)) throw new S.HttpError(409, 'Documents cannot be uploaded at this stage.');
      if (!req.file) throw new S.HttpError(400, 'No file uploaded.');
      const { doc_type, issue_date = '', expiry_date = '' } = req.body || {};
      if (!DOCUMENT_TYPES[doc_type]) throw new S.HttpError(400, 'Unknown document type.');
      for (const [k, val] of [['Issue date', issue_date], ['Expiry date', expiry_date]])
        if (val && !DATE_RE.test(val)) throw new S.HttpError(400, `${k} must be YYYY-MM-DD.`);
      if (DOCUMENT_TYPES[doc_type].expires && !expiry_date)
        throw new S.HttpError(400, 'This document type requires an expiry date.');
      if (issue_date && expiry_date && expiry_date < issue_date)
        throw new S.HttpError(400, 'Expiry date cannot be before the issue date.');
      const info = tx(db, () => {
        const ins = db.prepare(
          `INSERT INTO documents (vendor_id, doc_type, filename, stored_name, mime, size, issue_date, expiry_date, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(v.id, doc_type, path.basename(req.file.originalname).slice(0, 200), req.file.filename,
          req.file.mimetype, req.file.size, issue_date || null, expiry_date || null, req.user.id);
        S.audit(db, { vendorId: v.id, userId: req.user.id, action: 'DOCUMENT_UPLOADED',
          note: `${DOCUMENT_TYPES[doc_type].name}: ${req.file.originalname}` });
        S.refreshDerived(db, v.id);
        return ins;
      });
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch (e) {
      cleanup();
      throw e;
    }
  });

  r.delete('/documents/:id', (req, res) => {
    const v = S.getVendorRow(db, req.user.vendor_id);
    if (!VENDOR_EDITABLE.has(v.status)) throw new S.HttpError(409, 'Documents cannot be removed at this stage.');
    const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND vendor_id = ?').get(req.params.id, v.id);
    if (!doc) throw new S.HttpError(404, 'Document not found.');
    tx(db, () => {
      db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
      S.audit(db, { vendorId: v.id, userId: req.user.id, action: 'DOCUMENT_DELETED', note: doc.filename });
      S.refreshDerived(db, v.id);
    });
    fs.rm(path.join(uploadDir, doc.stored_name), { force: true }, () => {});
    res.status(204).end();
  });

  r.post('/submit', (req, res) => {
    const v = S.getVendorRow(db, req.user.vendor_id);
    if (!VENDOR_EDITABLE.has(v.status)) throw new S.HttpError(409, 'Application has already been submitted.');
    const issues = validateForSubmission(v, S.profileOf(v), S.listDocuments(db, v.id));
    if (issues.length) throw new S.HttpError(422, 'Application is incomplete.', issues);
    tx(db, () => {
      db.prepare("UPDATE vendors SET status = 'SUBMITTED', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(v.id);
      S.audit(db, { vendorId: v.id, userId: req.user.id, action: 'SUBMITTED', from: v.status, to: 'SUBMITTED',
        note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) || null : null });
      S.refreshDerived(db, v.id);
    });
    res.json(S.vendorDetail(db, v.id, { includeInternal: false }));
  });

  return r;
};
