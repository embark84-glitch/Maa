'use strict';
// Reference data for PROMERGON vendor registration (Oil & Gas and Power EPC).

const VENDOR_TYPES = {
  SUPPLIER: 'Supplier / Stockist',
  MANUFACTURER: 'Manufacturer / OEM',
  SUBCONTRACTOR: 'Subcontractor',
  SERVICE_PROVIDER: 'Service Provider / Consultant',
};

// Prefix used when generating vendor codes on approval.
const VENDOR_CODE_PREFIX = {
  SUPPLIER: 'SUP',
  MANUFACTURER: 'MFR',
  SUBCONTRACTOR: 'SUB',
  SERVICE_PROVIDER: 'SRV',
};

const SECTORS = {
  OG_UPSTREAM: 'Oil & Gas – Upstream (onshore / offshore production)',
  OG_MIDSTREAM: 'Oil & Gas – Midstream (pipelines, storage, terminals)',
  OG_DOWNSTREAM: 'Oil & Gas – Downstream (refining, petrochemicals, gas processing)',
  PWR_GENERATION: 'Power – Generation (thermal, CCGT)',
  PWR_TND: 'Power – Transmission & Distribution (substations, OHL)',
  PWR_RENEWABLES: 'Power – Renewables (solar, wind, BESS)',
};

// Category codes: S- = supply of goods, W- = works / subcontract, V- = services.
const CATEGORIES = [
  { code: 'S-PIPE', group: 'Supply', name: 'Pipes, fittings & flanges' },
  { code: 'S-VALV', group: 'Supply', name: 'Valves & actuators' },
  { code: 'S-STAT', group: 'Supply', name: 'Pressure vessels, columns & heat exchangers' },
  { code: 'S-ROTA', group: 'Supply', name: 'Rotating equipment (pumps, compressors, turbines)' },
  { code: 'S-PKGE', group: 'Supply', name: 'Packaged units & skids' },
  { code: 'S-ELEQ', group: 'Supply', name: 'Electrical equipment (transformers, switchgear, MCC, UPS)' },
  { code: 'S-CABL', group: 'Supply', name: 'Cables, cable trays & accessories' },
  { code: 'S-INST', group: 'Supply', name: 'Instrumentation, DCS / SCADA & control systems' },
  { code: 'S-FGSS', group: 'Supply', name: 'Fire & gas, safety & fire-fighting systems' },
  { code: 'S-STRS', group: 'Supply', name: 'Structural steel & fabricated items' },
  { code: 'S-CIVM', group: 'Supply', name: 'Civil & building materials' },
  { code: 'S-HVAC', group: 'Supply', name: 'HVAC equipment' },
  { code: 'S-RENW', group: 'Supply', name: 'Solar PV modules, inverters, BESS, wind components' },
  { code: 'S-CHEM', group: 'Supply', name: 'Chemicals, consumables & PPE' },
  { code: 'S-TELE', group: 'Supply', name: 'Telecom & IT systems' },
  { code: 'W-CIVL', group: 'Works', name: 'Civil, earthworks & building works' },
  { code: 'W-MECH', group: 'Works', name: 'Mechanical erection & equipment installation' },
  { code: 'W-PIPE', group: 'Works', name: 'Piping fabrication & installation' },
  { code: 'W-PLIN', group: 'Works', name: 'Cross-country pipeline construction' },
  { code: 'W-ELEC', group: 'Works', name: 'Electrical installation' },
  { code: 'W-INST', group: 'Works', name: 'Instrumentation installation & loop checks' },
  { code: 'W-SUBS', group: 'Works', name: 'Substation construction (HV / EHV)' },
  { code: 'W-OHTL', group: 'Works', name: 'Overhead transmission line works' },
  { code: 'W-WELD', group: 'Works', name: 'Welding, PWHT & NDT' },
  { code: 'W-PAIN', group: 'Works', name: 'Painting, coating & insulation' },
  { code: 'W-SCAF', group: 'Works', name: 'Scaffolding & access' },
  { code: 'W-LIFT', group: 'Works', name: 'Heavy lift, cranes & transportation' },
  { code: 'W-CATH', group: 'Works', name: 'Cathodic protection' },
  { code: 'W-COMM', group: 'Works', name: 'Pre-commissioning & commissioning' },
  { code: 'V-ENGR', group: 'Services', name: 'Engineering & design services' },
  { code: 'V-INSP', group: 'Services', name: 'Third-party inspection & testing' },
  { code: 'V-SURV', group: 'Services', name: 'Surveying & geotechnical investigation' },
  { code: 'V-LOGI', group: 'Services', name: 'Logistics, freight & customs clearance' },
  { code: 'V-MANP', group: 'Services', name: 'Manpower supply' },
  { code: 'V-CAMP', group: 'Services', name: 'Camp, catering & site facilities' },
];
const CATEGORY_CODES = new Set(CATEGORIES.map((c) => c.code));

// Document types. `required` lists vendor types for which the document is mandatory.
// `expires` marks documents that carry an expiry date which must be tracked.
const ALL = Object.keys(VENDOR_TYPES);
const DOCUMENT_TYPES = {
  CR: { name: 'Commercial registration / trade licence', required: ALL, expires: true },
  TAX: { name: 'Tax / VAT registration certificate', required: ALL, expires: true },
  PROFILE: { name: 'Company profile', required: ALL, expires: false },
  FIN: { name: 'Audited financial statements (last 3 years)', required: ALL, expires: false },
  BANK: { name: 'Bank reference letter', required: ALL, expires: false },
  ORG: { name: 'Organisation chart', required: ['SUBCONTRACTOR', 'SERVICE_PROVIDER'], expires: false },
  ISO9001: { name: 'ISO 9001 certificate', required: ['MANUFACTURER', 'SUBCONTRACTOR'], expires: true },
  ISO14001: { name: 'ISO 14001 certificate', required: [], expires: true },
  ISO45001: { name: 'ISO 45001 certificate', required: [], expires: true },
  HSE_MANUAL: { name: 'HSE manual & policy', required: ['SUBCONTRACTOR'], expires: false },
  QA_MANUAL: { name: 'QA/QC manual', required: ['MANUFACTURER', 'SUBCONTRACTOR'], expires: false },
  HSE_STATS: { name: 'HSE statistics (3 years, signed)', required: ['SUBCONTRACTOR'], expires: false },
  INSURANCE: { name: 'Insurance certificates (CAR / EL / PL)', required: ['SUBCONTRACTOR'], expires: true },
  PRODUCT_CERT: { name: 'Product certifications (API, ASME, IEC, UL, ATEX…)', required: [], expires: true },
  MAF: { name: 'Manufacturer authorisation letter', required: ['SUPPLIER'], expires: true },
  CATALOGUE: { name: 'Product catalogue / datasheets', required: ['SUPPLIER', 'MANUFACTURER'], expires: false },
  REFERENCES: { name: 'Client references / completion certificates', required: ['SUBCONTRACTOR', 'SERVICE_PROVIDER'], expires: false },
  CODE_OF_CONDUCT: { name: 'Signed PROMERGON Supplier Code of Conduct', required: ALL, expires: false },
  OTHER: { name: 'Other supporting document', required: [], expires: false },
};

const STATUSES = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  CLARIFICATION_REQUIRED: 'Clarification required',
  APPROVED: 'Approved',
  CONDITIONALLY_APPROVED: 'Conditionally approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
};

// Statuses in which the vendor may edit their application.
const VENDOR_EDITABLE = new Set(['DRAFT', 'CLARIFICATION_REQUIRED']);

const ROLES = {
  VENDOR: 'Vendor',
  PROCUREMENT_OFFICER: 'Procurement officer',
  EVALUATOR: 'Evaluator',
  PROCUREMENT_MANAGER: 'Procurement manager',
  ADMIN: 'Administrator',
};
const STAFF_ROLES = new Set(['PROCUREMENT_OFFICER', 'EVALUATOR', 'PROCUREMENT_MANAGER', 'ADMIN']);

const DISCIPLINES = {
  TECHNICAL: 'Technical / Engineering',
  QA_QC: 'Quality (QA/QC)',
  HSE: 'Health, Safety & Environment',
  FINANCE: 'Finance',
  COMMERCIAL: 'Commercial / Compliance',
};

// Staff workflow transitions: from -> { to: [roles allowed] }.
const MGR = ['PROCUREMENT_MANAGER', 'ADMIN'];
const OFFICER = ['PROCUREMENT_OFFICER', ...MGR];
const STAFF_TRANSITIONS = {
  SUBMITTED: { UNDER_REVIEW: OFFICER, CLARIFICATION_REQUIRED: OFFICER, REJECTED: MGR },
  UNDER_REVIEW: {
    CLARIFICATION_REQUIRED: OFFICER,
    APPROVED: MGR,
    CONDITIONALLY_APPROVED: MGR,
    REJECTED: MGR,
  },
  CONDITIONALLY_APPROVED: { APPROVED: MGR, SUSPENDED: MGR, CLARIFICATION_REQUIRED: OFFICER },
  APPROVED: { SUSPENDED: MGR },
  SUSPENDED: { APPROVED: MGR, REJECTED: MGR },
  REJECTED: { UNDER_REVIEW: MGR },
};

// Approval validity before requalification is due.
const APPROVAL_VALIDITY_YEARS = 3;

module.exports = {
  VENDOR_TYPES,
  VENDOR_CODE_PREFIX,
  SECTORS,
  CATEGORIES,
  CATEGORY_CODES,
  DOCUMENT_TYPES,
  STATUSES,
  VENDOR_EDITABLE,
  ROLES,
  STAFF_ROLES,
  DISCIPLINES,
  STAFF_TRANSITIONS,
  APPROVAL_VALIDITY_YEARS,
};
