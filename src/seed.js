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

    user('Platform Admin', 'admin@maa.test', 'admin', null, '+218 21 000 0000');

    const pharmacy = org('pharmacy', 'Al Shifa Pharmacy', 'PH-10293', 'Omar Al-Mukhtar Street', 'Tripoli', '+218 91 000 0001');
    user('Sara (Pharmacist)', 'pharmacy@maa.test', 'pharmacy', pharmacy, '+218 91 000 0001');

    const s1 = org('supplier', 'Al Wadi Medical Supplies', 'SUP-5521', 'Gergarish Road, Warehouse 7', 'Tripoli', '+218 92 000 0001');
    const s2 = org('supplier', 'Sahara Pharma Distribution', 'SUP-7780', 'Free Zone, Block 12', 'Misrata', '+218 92 000 0002');
    user('Omar (Al Wadi)', 'supplier@maa.test', 'supplier', s1, '+218 92 000 0001');
    user('Lina (Sahara Pharma)', 'supplier2@maa.test', 'supplier', s2, '+218 92 000 0002');

    user('Youssef (Driver)', 'driver@maa.test', 'driver', null, '+218 94 000 0001', 'Motorbike');

    const product = db.prepare(`INSERT INTO products
      (supplier_id, name, generic_name, category, form, strength, pack_size, sku, price, stock, min_order_qty, cold_chain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const items = [
      [s1, 'Panadol', 'Paracetamol', 'Pain relief', 'Tablet', '500 mg', 'Box of 24', 'NP-PAN-500', 450, 1200, 10, 0],
      [s1, 'Brufen', 'Ibuprofen', 'Pain relief', 'Tablet', '400 mg', 'Box of 30', 'NP-BRU-400', 675, 800, 5, 0],
      [s1, 'Augmentin', 'Amoxicillin + Clavulanate', 'Antibiotics', 'Tablet', '1 g', 'Box of 14', 'NP-AUG-1G', 1800, 300, 2, 0],
      [s1, 'Ventolin Inhaler', 'Salbutamol', 'Respiratory', 'Inhaler', '100 mcg', '200 doses', 'NP-VEN-100', 1250, 150, 1, 0],
      [s1, 'Glucophage', 'Metformin', 'Diabetes', 'Tablet', '850 mg', 'Box of 30', 'NP-GLU-850', 525, 600, 5, 0],
      [s2, 'Lantus SoloStar', 'Insulin glargine', 'Diabetes', 'Pen', '100 IU/ml', '5 pens', 'ML-LAN-100', 8500, 60, 1, 1],
      [s2, 'Concor', 'Bisoprolol', 'Cardio', 'Tablet', '5 mg', 'Box of 30', 'ML-CON-5', 850, 400, 3, 0],
      [s2, 'Nexium', 'Esomeprazole', 'Gastro', 'Capsule', '40 mg', 'Box of 14', 'ML-NEX-40', 1500, 250, 2, 0],
      [s2, 'Zyrtec', 'Cetirizine', 'Allergy', 'Tablet', '10 mg', 'Box of 20', 'ML-ZYR-10', 600, 500, 5, 0],
      [s2, 'Panadol', 'Paracetamol', 'Pain relief', 'Tablet', '500 mg', 'Box of 24', 'ML-PAN-500', 425, 900, 10, 0],
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
