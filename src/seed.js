'use strict';
/** Fill the database with demo accounts and a starter catalog. Safe to re-run. */
const path = require('node:path');
const { openDb, tx } = require('./db');
const { hashPassword } = require('./auth');

const DEMO_PASSWORD = 'password123';

function seed(db) {
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get('admin@maa.test')) return false;
  const pw = hashPassword(DEMO_PASSWORD);

  tx(db, () => {
    const org = (type, name, license, address, city, phone) => Number(db.prepare(
      'INSERT INTO organizations (type, name, license_no, address, city, phone, verified) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run(type, name, license, address, city, phone).lastInsertRowid);
    const user = (name, email, role, orgId, phone, vehicle = null) => db.prepare(
      'INSERT INTO users (name, email, phone, password_hash, role, org_id, vehicle, approved) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
    ).run(name, email, phone, pw, role, orgId, vehicle);

    user('Platform Admin', 'admin@maa.test', 'admin', null, '+000000000');

    const pharmacy = org('pharmacy', 'Al Shifa Pharmacy', 'PH-10293', '12 Market Street', 'Downtown', '+100000001');
    user('Sara (Pharmacist)', 'pharmacy@maa.test', 'pharmacy', pharmacy, '+100000001');

    const s1 = org('supplier', 'Nile Pharma Distribution', 'SUP-5521', 'Industrial Zone, Block 4', 'East City', '+200000001');
    const s2 = org('supplier', 'MedLine Healthcare Co.', 'SUP-7780', '88 Logistics Park', 'North City', '+200000002');
    user('Omar (Nile Pharma)', 'supplier@maa.test', 'supplier', s1, '+200000001');
    user('Lina (MedLine)', 'supplier2@maa.test', 'supplier', s2, '+200000002');

    user('Youssef (Driver)', 'driver@maa.test', 'driver', null, '+300000001', 'Motorbike');

    const product = db.prepare(`INSERT INTO products
      (supplier_id, name, generic_name, category, form, strength, pack_size, sku, price, stock, min_order_qty, cold_chain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const items = [
      [s1, 'Panadol', 'Paracetamol', 'Pain relief', 'Tablet', '500 mg', 'Box of 24', 'NP-PAN-500', 350, 1200, 10, 0],
      [s1, 'Brufen', 'Ibuprofen', 'Pain relief', 'Tablet', '400 mg', 'Box of 30', 'NP-BRU-400', 520, 800, 5, 0],
      [s1, 'Augmentin', 'Amoxicillin + Clavulanate', 'Antibiotics', 'Tablet', '1 g', 'Box of 14', 'NP-AUG-1G', 1450, 300, 2, 0],
      [s1, 'Ventolin Inhaler', 'Salbutamol', 'Respiratory', 'Inhaler', '100 mcg', '200 doses', 'NP-VEN-100', 890, 150, 1, 0],
      [s1, 'Glucophage', 'Metformin', 'Diabetes', 'Tablet', '850 mg', 'Box of 30', 'NP-GLU-850', 410, 600, 5, 0],
      [s2, 'Lantus SoloStar', 'Insulin glargine', 'Diabetes', 'Pen', '100 IU/ml', '5 pens', 'ML-LAN-100', 6200, 60, 1, 1],
      [s2, 'Concor', 'Bisoprolol', 'Cardio', 'Tablet', '5 mg', 'Box of 30', 'ML-CON-5', 640, 400, 3, 0],
      [s2, 'Nexium', 'Esomeprazole', 'Gastro', 'Capsule', '40 mg', 'Box of 14', 'ML-NEX-40', 1180, 250, 2, 0],
      [s2, 'Zyrtec', 'Cetirizine', 'Allergy', 'Tablet', '10 mg', 'Box of 20', 'ML-ZYR-10', 460, 500, 5, 0],
      [s2, 'Panadol', 'Paracetamol', 'Pain relief', 'Tablet', '500 mg', 'Box of 24', 'ML-PAN-500', 340, 900, 10, 0],
    ];
    for (const it of items) product.run(...it);
  });
  return true;
}

if (require.main === module) {
  const db = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'maa.db'));
  console.log(seed(db) ? `Seeded demo data. All demo accounts use password "${DEMO_PASSWORD}".` : 'Demo data already present.');
}

module.exports = { seed, DEMO_PASSWORD };
