'use strict';
/** Fill the database with demo accounts and a starter catalog. Safe to re-run. */
const { tx } = require('./store');
const { hashPassword } = require('./auth');

const DEMO_PASSWORD = 'password123';

/** A valid GTIN-13 in the GS1 internal-use range (prefix 2), so demo codes never collide with real packs. */
function demoBarcode(n) {
  const body = `2000000${String(n).padStart(5, '0')}`;
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

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

    user('مدير المنصة', 'admin@maa.test', 'admin', null, '+218 21 000 0000');

    const pharmacy = org('pharmacy', 'صيدلية الشفاء', 'PH-10293', 'شارع عمر المختار', 'طرابلس', '+218 91 000 0001');
    user('سارة (صيدلانية)', 'pharmacy@maa.test', 'pharmacy', pharmacy, '+218 91 000 0001');

    const s1 = org('supplier', 'شركة الوادي للمستلزمات الطبية', 'SUP-5521', 'طريق قرقارش، مخزن 7', 'طرابلس', '+218 92 000 0001');
    const s2 = org('supplier', 'شركة الصحراء لتوزيع الأدوية', 'SUP-7780', 'المنطقة الحرة، مربع 12', 'مصراتة', '+218 92 000 0002');
    // Different terms of sale per company, so each payment option can be tried.
    const policy = db.prepare(`UPDATE organizations SET allow_full = ?, allow_partial = ?, deposit_percent = ?, allow_credit = ?,
      credit_days = ?, credit_limit = ?, min_order_value = ?, bank_details = ?, products_updated_at = datetime('now') WHERE id = ?`);
    policy.run(1, 1, 30, 1, 30, 500000, 10000, 'مصرف الجمهورية - فرع قرقارش\nحساب رقم: 000-000-0000 (تجريبي)', s1);
    policy.run(1, 0, 30, 1, 15, 200000, 5000, 'مصرف الوحدة - فرع مصراتة\nحساب رقم: 111-111-1111 (تجريبي)', s2);
    user('عمر (الوادي)', 'supplier@maa.test', 'supplier', s1, '+218 92 000 0001');
    user('لينا (الصحراء)', 'supplier2@maa.test', 'supplier', s2, '+218 92 000 0002');

    user('يوسف (سائق)', 'driver@maa.test', 'driver', null, '+218 94 000 0001', 'دراجة نارية');

    const product = db.prepare(`INSERT INTO products
      (supplier_id, name, generic_name, category, form, strength, pack_size, sku, price, stock, min_order_qty, cold_chain, barcode, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Prices and barcodes are illustrative. Barcodes use the GS1 "2" prefix, which is reserved
    // for internal use and never printed on real retail packs, so they cannot be mistaken for real ones.
    // Pack images (img/products) are cropped from a photo of a Libyan pharmacy shelf.
    const items = [
      [s1, 'Panadol', 'Paracetamol', 'مسكنات', 'أقراص', '500 mg', 'علبة 24', 'NP-PAN-500', 450, 1200, 10, 0, null],
      [s1, 'Brufen', 'Ibuprofen', 'مسكنات', 'أقراص', '400 mg', 'علبة 30', 'NP-BRU-400', 675, 800, 5, 0, null],
      [s1, 'Augmentin', 'Amoxicillin + Clavulanate', 'مضادات حيوية', 'أقراص', '1 g', 'علبة 14', 'NP-AUG-1G', 1800, 300, 2, 0, null],
      [s1, 'Clindam', 'Clindamycin', 'مضادات حيوية', 'كبسولات', '300 mg', 'علبة 16', 'NP-CLI-300', 2100, 180, 2, 0, null],
      [s1, 'Ventolin Inhaler', 'Salbutamol', 'الجهاز التنفسي', 'بخاخ', '100 mcg', '200 جرعة', 'NP-VEN-100', 1250, 150, 1, 0, null],
      [s1, 'Glucophage', 'Metformin', 'السكري', 'أقراص', '850 mg', 'علبة 30', 'NP-GLU-850', 525, 600, 5, 0, null],
      [s1, 'Mellitofix', 'Empagliflozin', 'السكري', 'أقراص مغلفة', '25 mg', 'علبة 30', 'NP-MEL-25', 4600, 90, 1, 0, null],
      [s1, 'Tabuvan', 'Valsartan', 'القلب والضغط', 'أقراص', '160 mg', 'علبة 28', 'NP-TAB-160', 1950, 220, 2, 0, null],
      [s2, 'Lantus SoloStar', 'Insulin glargine', 'السكري', 'قلم', '100 IU/ml', '5 أقلام', 'ML-LAN-100', 8500, 60, 1, 1, null],
      [s2, 'Concor', 'Bisoprolol', 'القلب والضغط', 'أقراص', '5 mg', 'علبة 30', 'ML-CON-5', 850, 400, 3, 0, null],
      [s2, 'Nexium', 'Esomeprazole', 'الجهاز الهضمي', 'كبسولات', '40 mg', 'علبة 14', 'ML-NEX-40', 1500, 250, 2, 0, null],
      [s2, 'Zyrtec', 'Cetirizine', 'الحساسية', 'أقراص', '10 mg', 'علبة 20', 'ML-ZYR-10', 600, 500, 5, 0, null],
      [s2, 'Panadol', 'Paracetamol', 'مسكنات', 'أقراص', '500 mg', 'علبة 24', 'ML-PAN-500', 425, 900, 10, 0, null],
      [s2, 'Doliprane Vitamine C', 'Paracetamol + Vitamin C', 'نزلات البرد', 'أقراص فوارة', '500 mg/150 mg', 'علبة 16', 'ML-DOL-VC', 650, 600, 10, 0, 'img/products/doliprane-vitc.jpg'],
      [s2, 'Actifed Rhume', 'Paracetamol + Pseudoephedrine + Triprolidine', 'نزلات البرد', 'أقراص', null, 'علبة 20', 'ML-ACT-RH', 900, 450, 10, 0, 'img/products/actifed-rhume.jpg'],
      [s2, 'Rhinostop', null, 'نزلات البرد', 'أقراص', null, 'علبة 20', 'ML-RHI-20', 750, 380, 10, 0, 'img/products/rhinostop.jpg'],
      [s2, '1-2-3', 'Paracetamol + Pseudoephedrine + Chlorpheniramine', 'نزلات البرد', 'أقراص', null, 'علبة 20', 'ML-123-20', 550, 700, 10, 0, 'img/products/one-two-three.jpg'],
      [s2, 'Larypro', null, 'الحلق', 'أقراص استحلاب', null, 'علبة 20', 'ML-LAR-20', 700, 320, 10, 0, 'img/products/larypro.jpg'],
    ];
    items.forEach((it, i) => product.run(...it.slice(0, 12), demoBarcode(i + 1), it[12]));
  });
  return true;
}

if (require.main === module) {
  // Command line: npm run seed (Node only; the browser demo calls seed() directly).
  const path = require('node:path');
  const { openDb } = require('./db');
  const db = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'maa.db'));
  console.log(seed(db) ? `Seeded demo data. All demo accounts use password "${DEMO_PASSWORD}".` : 'Demo data already present.');
}

module.exports = { seed, DEMO_PASSWORD, demoBarcode };
