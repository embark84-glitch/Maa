# Maa: pharmacy supply marketplace with built-in delivery

Maa lets **pharmacies** order medicines from **pharmaceutical companies and distributors**, pay on
each company's own terms, and receive the goods from **drivers working in the same app**.
The interface is in **Arabic (right to left) by default**, with an English toggle. Prices are in Libyan dinars.

| Role | What they do |
|---|---|
| Pharmacy (purchasing manager) | **New order → choose a company → its products → payment & confirm.** Tracks each order, adds transfer receipt numbers, gives the driver a 6-digit code at handover |
| Supplier company | Uploads its product list from **Excel** or its own system via the **API**, sets its **payment terms**, accepts orders, records payments received, marks orders packed |
| Driver | Takes packed orders, collects them, collects any cash due, confirms delivery with the pharmacy's code |
| Admin | Verifies pharmacy/company licenses and approves drivers before they can trade |

## Quick start

```bash
npm install
npm run seed     # demo accounts, two companies with different payment terms, starter catalog
npm start        # http://localhost:3000
```

The cold-and-flu products and their pack photos come from a real Libyan pharmacy shelf; prices and barcodes are
illustrative (barcodes use the GS1 `2…` internal-use range, so they never match a real pack).

Demo logins (password `password123`): `pharmacy@maa.test`, `supplier@maa.test` (Al Wadi: full, 30 % deposit
or 30-day credit up to 5,000 LYD, minimum order 100 LYD), `supplier2@maa.test` (Sahara: full or 15-day credit up
to 2,000 LYD), `driver@maa.test`, `admin@maa.test`.

Needs Node.js 22.5 or newer (built-in `node:sqlite`, no native dependencies). The browser loads the Excel
reader from jsDelivr, so uploading files needs an internet connection.

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DB_FILE` | `data/maa.db` | SQLite file. A file from an older version is refused with a message: delete it and seed again |
| `AUTH_SECRET` | random per start | **Required** when `NODE_ENV=production` |
| `CURRENCY` | `LYD` | ISO code used for display |
| `DELIVERY_FEE` | `10` | Flat fee per order, in dinars |

## Ordering and payment

A pharmacy orders from **one company at a time**. The draft is saved on the device as quantities are entered,
so leaving and coming back loses nothing. Quantities below the company's minimum, above its stock, or orders
under its minimum order value are flagged before checkout and refused again by the server.

Each company chooses which payment terms it offers (`Payment & API` page):

| Terms | Before dispatch | Rest |
|---|---|---|
| **Full** | whole total | none |
| **Deposit** | the company's % (e.g. 30 %) | collected by the driver on delivery |
| **Credit** | nothing | due *N* days after delivery, within the company's credit limit per pharmacy |

The company accepts the order (and with it the terms), then **records the money it actually receives**
(bank transfer, cash, cheque…). It cannot mark the order packed until the upfront amount is recorded.
Credit beyond the remaining limit is not offered at checkout and is refused by the server. The rules live
in `shared/payment.js`, used by both the server and the browser so the numbers always match.

```
placed ──accept──▶ accepted ──(upfront paid)──▶ ready_for_pickup ──▶ assigned ──▶ picked_up ──code──▶ delivered
  ├─reject─▶ rejected   └─cancel─▶ cancelled (stock returned)
```

## Adding products faster: photo and barcode

On a company's product page the pharmacist can also:

- **Order by photo**: photograph packs on the shelf, a handwritten shortage list or an old invoice. Claude reads
  the photo and matches what it sees to *this company's* catalogue only (`shared/recognize.js`). Each suggestion
  shows the pack photo, a quantity (taken from the photo when one is written, otherwise the minimum order) and a
  "check this" note when it was unsure. Medicines the company does not sell are listed separately. Nothing is
  added until the pharmacist taps *Add selected*. The Node server calls Claude through the Anthropic SDK
  (`src/recognize-claude.js`: model `claude-opus-5-5`, structured JSON output, server-side refusal fallback).
  Set `ANTHROPIC_API_KEY` (or log in with `ant auth login`); `MAA_PHOTO_ORDERS=off` turns it off.
- **Scan barcodes**: a handheld USB/Bluetooth scanner works in the search box (it types the code and Enter).
  *Scan barcode* opens the phone camera (the browser's `BarcodeDetector` where available, otherwise the
  open-source ZXing reader), or reads a photo of the barcode where live camera access is not allowed.
  A code that only another company sells says which company has it.

Products carry a barcode and a pack photo. Companies add the photo from the product form (it is shrunk in the
browser and stored in the database), or give an `https://` image link in Excel or the API.

## Updating products: Excel or API

Products are matched by the company's **product code (SKU)**: known codes are updated, new codes are added.
Nothing is saved until the company has seen the preview: new / changed / unchanged / hidden / errors, with the
row number and reason for every error. Rows with errors block saving unless the company chooses to skip them.
"Hide products not in this file" stops selling them without deleting anything (old orders keep their history).

**Excel / CSV**: first row = column names, Arabic or English. Required: `رمز المنتج` (sku), `الاسم التجاري` (name),
`السعر` (price). Optional: `الاسم العلمي`, `الفئة`, `الشكل الدوائي`, `التركيز`, `حجم العبوة`, `الكمية المتوفرة`,
`الحد الأدنى للطلب`, `تبريد` (نعم/لا), `الباركود`, `رابط الصورة` (https). Arabic digits and `4,50`-style decimals are understood. The upload page
offers a template and an export of the current list.

**API**: create a key under *Payment & API* (shown once; only its hash is stored), then:

```bash
curl -X POST https://your-host/api/v1/products/sync \
  -H "X-Api-Key: maa_..." -H "Content-Type: application/json" \
  -d '{"products":[{"sku":"NP-PAN-500","name":"Panadol","price":4.5,"stock":1200}], "dry_run": true}'
```

`dry_run: true` returns the same preview without saving; `hide_missing` and `skip_errors` work as in the upload
page. Each sync is logged in the company's update history. Parsing and matching live in `shared/import.js`.

## The one-file demo

`npm run build:demo` writes `standalone/maa-demo.html`: the whole app in one page that needs no server.
It runs **the same server code** (`src/routes`, `src/store.js`, …) inside the browser on SQLite compiled to
JavaScript ([sql.js](https://sql.js.org)), behind `window.fetch`, so the demo behaves exactly like the real
server. Data is saved in that browser only. Order by photo uses the viewer's own Claude through the page's
`sample` capability (the viewer is asked once). Live camera scanning is not available inside the hosted page,
so it falls back to photographing the barcode. A guide panel walks through one order step by step and lets you
switch roles with one tap. Only `src/auth.js` is swapped (for `standalone/auth-browser.js`), because Node's
crypto module is not available in browsers; never use that file on a server.

## Project layout

```
shared/             rules used by server and browser: payment.js, import.js
src/
  index.js          server entry point          app.js   Express wiring
  http.js           errors, auth middleware     store.js schema + transactions (portable)
  db.js             opens the SQLite file       policy.js company terms, open credit
  auth.js           passwords, tokens, API keys seed.js  demo data
  routes/           auth, catalog, supplier (products, import, settings, API), orders, deliveries, admin
public/             web client: index.html, app.js, i18n.js (Arabic/English), styles.css
standalone/         demo bundler, in-browser server, browser auth stand-in
test/               end-to-end API tests: npm test
```

## Next steps toward production

- Online payment (local card/wallet gateways) to confirm transfers automatically instead of by hand
- Per-pharmacy credit limits and statements of account; reminders before credit is due
- SMS / push notifications on each status change; live driver location
- Batch and expiry tracking; extra controls for prescription-only and controlled medicines
- Self-host the Excel reader at a patched version: `xlsx@0.18.5` from npm has a known advisory for crafted files
  (it only ever reads the uploader's own file, in their own browser)
- Move to Postgres when one server is no longer enough
