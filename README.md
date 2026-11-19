# PROMERGON – Supplier & Subcontractor Registration System

Vendor registration and prequalification portal for **PROMERGON**, an EPC contractor in the **Oil & Gas** and **Power** sectors.
Suppliers, manufacturers, subcontractors and service providers register online. PROMERGON procurement then reviews, evaluates and approves them onto the **Approved Vendor List (AVL)**.

## Features

### Vendor portal
- Self-registration as **Supplier / Stockist, Manufacturer / OEM, Subcontractor, or Service Provider**
- A 9-step prequalification questionnaire, saved as a draft between steps:
  1. Company information: CR and VAT numbers, ownership, local content (IKTVA/ICV)
  2. Contacts: commercial, HSE and QA/QC
  3. Sectors (Upstream, Midstream, Downstream, Generation, T&D, Renewables) and **35 product/work/service categories**
  4. Financials: 3-year turnover, bank details
  5. HSE: ISO 45001/14001, man-hours, TRIR, LTIFR, fatalities
  6. Quality: ISO 9001, QA/QC manual, API/ASME/IEC/ATEX certifications
  7. Experience: O&G/Power project references, manpower, equipment
  8. Documents: mandatory documents depend on vendor type, and expiry dates are captured
  9. Declarations (anti-bribery, sanctions, conflict of interest, accuracy) and submission
- A live checklist of what is still missing before the application can be submitted
- Status tracking. The vendor sees clarification requests, conditions and rejection reasons.
- After approval, vendors can upload renewed certificates.

### Staff back-office
- **Dashboard**: workflow KPIs, review queue, documents expiring within 60 days, requalifications due within 90 days, recent activity
- **Applications**: search and filter by status, vendor type, sector and category
- **Vendor file**: the full application, document register with downloads, automatic score, discipline evaluations and audit history
- **Automatic prequalification score** (0–100, grades A–D) across Documents 20 · Quality 20 · HSE 25 · Financial 15 · Experience 20. It supports evaluator judgement but does not replace it.
- **Discipline evaluations**: Technical, QA/QC, HSE, Finance and Commercial. Each records a score, a recommendation and comments.
- **Workflow with role-based permissions**
- **Approved Vendor List** with CSV export. Exported cells are escaped so spreadsheets cannot run them as formulas.
- **User administration**: staff accounts, roles, evaluator disciplines, enabling and disabling accounts

### Workflow

```
DRAFT ──submit──► SUBMITTED ──► UNDER_REVIEW ──► APPROVED ────────► SUSPENDED
  ▲                  │              │  │  └────► CONDITIONALLY_APPROVED
  │                  ▼              │  └───────► REJECTED
  └── CLARIFICATION_REQUIRED ◄──────┘
```

| Action | Who |
|---|---|
| Edit / submit application | Vendor (only in Draft or Clarification required) |
| Start review, request clarification | Procurement officer, manager, admin |
| Record evaluation | Evaluators (own discipline only), procurement, admin |
| Approve, approve with conditions, reject, suspend, reinstate | Procurement manager, admin |

On approval, the system assigns a vendor code (e.g. `PRM-SUB-00012`, `PRM-SUP-…`, `PRM-MFR-…`, `PRM-SRV-…`) and sets requalification due **3 years** later.

## Running it

Requires **Node.js 22.5+**. It uses Node's built-in SQLite, so no database server is needed.

```bash
npm install
npm start                 # http://localhost:3000
```

On first start the server creates an administrator account and prints its password. Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` to choose them yourself.

### Demo data

```bash
npm run seed:demo         # run against a fresh data directory, before npm start
```

This creates staff users and six sample vendors, one in each workflow state:

| Role | Email | Password |
|---|---|---|
| Administrator | admin@promergon.com | Promergon2026 |
| Procurement officer | procurement@promergon.com | Promergon2026 |
| Procurement manager | manager@promergon.com | Promergon2026 |
| HSE evaluator | hse@promergon.com | Promergon2026 |
| Vendor (draft) | admin@northwind.example | Vendor2026pass |
| Vendor (clarification) | tenders@sungrid.example | Vendor2026pass |
| Vendor (approved) | bids@gulfpiping.example | Vendor2026pass |

### Tests

```bash
npm test
```

The tests cover the full lifecycle: registration, validation, upload rules, submission, role permissions, evaluator discipline limits, clarification and resubmission, approval and vendor codes, AVL/CSV export, document access control, login throttling, cross-origin blocking and scoring.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite database and uploaded files |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | generated | First administrator account |
| `MAX_UPLOAD_MB` | `15` | Upload size limit |
| `SECURE_COOKIES` | `false` | Set `true` behind HTTPS |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy |

## Project structure

```
server/
  index.js            entry point
  app.js              Express app, auth routes, document download, security headers
  auth.js             scrypt password hashing, sessions, role guards
  db.js               SQLite schema
  services.js         shared vendor logic, audit log, approval
  lib/catalog.js      vendor types, sectors, categories, document requirements, workflow rules
  lib/profile.js      profile normalisation, submission validation, prequalification scoring
  routes/vendor.js    vendor portal API
  routes/staff.js     back-office API (dashboard, review, AVL, users)
public/               single-page front-end (no build step)
scripts/seed-demo.js  demo data
test/                 API and unit tests (node:test)
```

Business rules live in `server/lib/catalog.js`: categories, which documents are mandatory for each vendor type, who may make each workflow transition, and how long an approval lasts. Edit that file to match PROMERGON's procurement procedures.

## Security

- Passwords are hashed with scrypt.
- Sessions use HttpOnly, SameSite=Strict cookies, with a 12-hour lifetime.
- State-changing requests from other origins are rejected.
- The Content-Security-Policy allows no inline scripts or styles, and framing is blocked.
- Uploads are checked against an extension allow-list and size limit, stored under random names, and served only as attachments.
- Documents can be downloaded only by their owning vendor and by staff.
- Failed logins are throttled per IP and email address.
- Vendors never see internal scores, evaluator names or review comments.

## Possible next steps

- Email notifications for submission, clarification, approval and expiry reminders (SMTP / Microsoft 365)
- SSO (Azure AD) for PROMERGON staff
- Integration with ERP vendor master data (SAP / Oracle)
- Vendor performance ratings after each purchase order or subcontract
- Arabic / bilingual interface
