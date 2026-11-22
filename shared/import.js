/*
 * Product list import, shared by the server (Excel upload and API) and the web
 * client. Rows come in as plain objects keyed by column header, e.g. from an
 * Excel sheet or a JSON API call. Columns may be in Arabic or English.
 *
 * Products are matched by SKU (the company's own product code): a known SKU
 * updates that product, a new SKU creates one. Nothing is saved until the
 * caller applies the plan, so a file can be previewed first.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MaaImport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_ROWS = 5000;

  // field -> accepted column names (compared after normalising case, spaces and punctuation)
  const COLUMNS = {
    sku: ['sku', 'code', 'product code', 'item code', 'رمز المنتج', 'الرمز', 'كود', 'كود الصنف', 'رمز الصنف'],
    name: ['name', 'brand', 'brand name', 'product', 'product name', 'الاسم التجاري', 'اسم المنتج', 'اسم الصنف', 'الاسم', 'الصنف'],
    generic_name: ['generic', 'generic name', 'active ingredient', 'الاسم العلمي', 'المادة الفعالة'],
    category: ['category', 'الفئة', 'التصنيف'],
    form: ['form', 'dosage form', 'الشكل الدوائي', 'الشكل'],
    strength: ['strength', 'التركيز'],
    pack_size: ['pack', 'pack size', 'package', 'حجم العبوة', 'العبوة'],
    price: ['price', 'unit price', 'pack price', 'السعر', 'سعر العبوة', 'سعر البيع'],
    stock: ['stock', 'qty', 'quantity', 'available', 'المخزون', 'الكمية', 'الكمية المتوفرة', 'الرصيد'],
    min_order_qty: ['min', 'min qty', 'min order', 'minimum order', 'moq', 'الحد الأدنى', 'الحد الأدنى للطلب', 'أقل كمية'],
    cold_chain: ['cold chain', 'cold', 'refrigerated', 'تبريد', 'سلسلة تبريد', 'مبرد'],
    active: ['active', 'listed', 'for sale', 'معروض', 'نشط', 'متاح للبيع'],
  };
  const REQUIRED = ['sku', 'name', 'price'];
  const TEMPLATE_HEADERS = ['رمز المنتج', 'الاسم التجاري', 'الاسم العلمي', 'الفئة', 'الشكل الدوائي', 'التركيز', 'حجم العبوة', 'السعر', 'الكمية المتوفرة', 'الحد الأدنى للطلب', 'تبريد'];
  const TEMPLATE_EXAMPLE = ['NP-PAN-500', 'Panadol', 'Paracetamol', 'مسكنات', 'أقراص', '500 mg', 'علبة 24', '4.50', '1200', '10', 'لا'];

  const norm = (s) => String(s).trim().toLowerCase().replace(/[\s_\-./()]+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').trim();
  const LOOKUP = {};
  for (const [field, names] of Object.entries(COLUMNS)) for (const n of names) LOOKUP[norm(n)] = field;

  // Arabic-Indic (٠-٩) and Persian (۰-۹) digits -> 0-9
  const toLatinDigits = (s) => String(s)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x6F0));

  /** "4,50" / "4.50" / "1,200.50" / "٤٫٥" -> number, or NaN */
  function parseNumber(v) {
    if (typeof v === 'number') return v;
    let s = toLatinDigits(v).replace(/[٫]/g, '.').replace(/[٬\s]/g, '').replace(/(د\.?ل\.?|lyd)/gi, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    return s === '' ? NaN : Number(s);
  }

  function parseBool(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    const s = norm(toLatinDigits(v));
    if (['1', 'yes', 'y', 'true', 'x', 'نعم', 'ن', 'صح'].includes(s)) return true;
    if (['0', 'no', 'n', 'false', 'لا', 'ل'].includes(s)) return false;
    return null;
  }

  const text = (v, max) => {
    if (v === undefined || v === null) return null;
    const s = String(typeof v === 'number' ? v : v).trim();
    return s ? s.slice(0, max) : null;
  };

  /**
   * Turn raw rows into clean product records.
   * Returns { products, errors, unknownColumns }. Each error is
   * { row, code, field?, value?, message } where row is the spreadsheet row number
   * (header = row 1) and message is English; the client translates by code.
   */
  function normalizeProducts(rawRows) {
    const errors = [];
    if (!Array.isArray(rawRows)) return { products: [], errors: [{ row: 0, code: 'not_a_list', message: 'products must be a list' }], unknownColumns: [] };
    if (rawRows.length === 0) return { products: [], errors: [{ row: 0, code: 'empty', message: 'The file has no product rows' }], unknownColumns: [] };
    if (rawRows.length > MAX_ROWS) return { products: [], errors: [{ row: 0, code: 'too_many_rows', value: MAX_ROWS, message: `At most ${MAX_ROWS} rows per upload` }], unknownColumns: [] };

    // Map this file's headers to fields once, from all rows' keys.
    const headerMap = {};
    const unknown = new Set();
    for (const r of rawRows) {
      for (const k of Object.keys(r || {})) {
        if (k in headerMap || unknown.has(k)) continue;
        const f = LOOKUP[norm(k)] || (k in COLUMNS ? k : null);
        if (f) headerMap[k] = f; else unknown.add(k);
      }
    }
    const present = new Set(Object.values(headerMap));
    const missing = REQUIRED.filter((f) => !present.has(f));
    if (missing.length) {
      return { products: [], errors: [{ row: 1, code: 'missing_columns', value: missing.join(', '), message: `Missing required columns: ${missing.join(', ')}` }], unknownColumns: [...unknown] };
    }

    const products = [];
    const seen = new Map();
    rawRows.forEach((raw, i) => {
      const row = i + 2;
      const r = {};
      for (const [k, v] of Object.entries(raw || {})) if (headerMap[k]) r[headerMap[k]] = v;
      if (Object.values(r).every((v) => v === undefined || v === null || String(v).trim() === '')) return; // blank line
      const fail = (code, field, message) => errors.push({ row, code, field, value: r[field] ?? null, message });

      const sku = text(r.sku, 60);
      if (!sku) return fail('missing_sku', 'sku', 'Product code (SKU) is empty');
      if (seen.has(sku)) return fail('duplicate_sku', 'sku', `Code ${sku} also appears on row ${seen.get(sku)}`);
      seen.set(sku, row);
      const name = text(r.name, 150);
      if (!name) return fail('missing_name', 'name', 'Brand name is empty');
      const price = parseNumber(r.price);
      if (!Number.isFinite(price) || price < 0 || price > 10_000_000) return fail('bad_price', 'price', 'Price is not a valid amount');

      const p = { sku, name, price: Math.round(price * 100) };
      for (const f of ['generic_name', 'category', 'form', 'strength', 'pack_size']) {
        if (f in r) p[f] = text(r[f], f === 'generic_name' ? 150 : 60);
      }
      if ('stock' in r && r.stock !== '' && r.stock != null) {
        const n = parseNumber(r.stock);
        if (!Number.isInteger(n) || n < 0) return fail('bad_stock', 'stock', 'Quantity must be a whole number, 0 or more');
        p.stock = n;
      }
      if ('min_order_qty' in r && r.min_order_qty !== '' && r.min_order_qty != null) {
        const n = parseNumber(r.min_order_qty);
        if (!Number.isInteger(n) || n < 1) return fail('bad_min', 'min_order_qty', 'Minimum order must be a whole number, 1 or more');
        p.min_order_qty = n;
      }
      if ('cold_chain' in r) {
        const b = parseBool(r.cold_chain, false);
        if (b === null) return fail('bad_yes_no', 'cold_chain', 'Cold chain must be yes or no');
        p.cold_chain = b;
      }
      if ('active' in r) {
        const b = parseBool(r.active, true);
        if (b === null) return fail('bad_yes_no', 'active', 'Listed must be yes or no');
        p.active = b;
      }
      p.row = row;
      products.push(p);
    });
    return { products, errors, unknownColumns: [...unknown] };
  }

  const FIELDS = ['name', 'generic_name', 'category', 'form', 'strength', 'pack_size', 'price', 'stock', 'min_order_qty', 'cold_chain', 'active'];
  const same = (a, b) => (typeof a === 'boolean' || typeof b === 'boolean' ? !!a === !!b : (a ?? null) === (b ?? null));

  /**
   * Compare clean products with the company's current catalog.
   * `existing` = [{ id, sku, ...fields }]. Returns
   * { create: [product], update: [{ id, sku, name, changes: {field: value}, before: {field: value} }], unchanged, hide: [{ id, sku, name }] }.
   * Products missing from the file are only hidden when `hideMissing` is set.
   */
  function planSync(products, existing, { hideMissing = false } = {}) {
    const bySku = new Map(existing.filter((e) => e.sku).map((e) => [e.sku, e]));
    const plan = { create: [], update: [], unchanged: 0, hide: [] };
    const inFile = new Set();
    for (const p of products) {
      inFile.add(p.sku);
      const cur = bySku.get(p.sku);
      if (!cur) { plan.create.push(p); continue; }
      const changes = {}; const before = {};
      for (const f of FIELDS) {
        if (!(f in p)) continue;
        if (!same(p[f], cur[f])) { changes[f] = p[f]; before[f] = cur[f]; }
      }
      // A product that was hidden comes back when it appears in a new file, unless the file says otherwise.
      if (!('active' in p) && !cur.active) { changes.active = true; before.active = false; }
      if (Object.keys(changes).length) plan.update.push({ id: cur.id, sku: p.sku, name: p.name, changes, before, row: p.row });
      else plan.unchanged += 1;
    }
    if (hideMissing) {
      for (const e of existing) if (e.active && (!e.sku || !inFile.has(e.sku))) plan.hide.push({ id: e.id, sku: e.sku, name: e.name });
    }
    return plan;
  }

  return { COLUMNS, REQUIRED, TEMPLATE_HEADERS, TEMPLATE_EXAMPLE, MAX_ROWS, normalizeProducts, planSync, parseNumber };
});
