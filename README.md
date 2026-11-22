# Maa: pharmacy supply marketplace with built-in delivery

Maa lets **pharmacies** order medicines from **pharmaceutical companies and distributors**, and
gets the goods to the pharmacy door with **drivers working in the same app**.

| Role | What they do |
|---|---|
| Pharmacy | Searches one catalog across all suppliers, compares prices, checks out a mixed cart, tracks each shipment, and gives the driver a 6-digit code at handover |
| Supplier company | Lists products (price, stock, minimum order, cold-chain flag), accepts or rejects orders, marks them packed |
| Driver | Sees packed orders waiting for pickup, takes a job, collects it, confirms delivery with the pharmacy's code |
| Admin | Verifies pharmacy/supplier licenses and approves drivers before they can trade |

## Quick start

```bash
npm install
npm run seed     # demo accounts + catalog
npm start        # http://localhost:3000
```

Demo logins (password `password123`): `pharmacy@maa.test`, `supplier@maa.test`,
`supplier2@maa.test`, `driver@maa.test`, `admin@maa.test`. The sign-in page has one-click buttons for each.

Needs Node.js 22.5 or newer (it uses the built-in `node:sqlite`, so there are no native dependencies).

### Single-file HTML demo

`standalone/maa-demo.html` is the whole app in one HTML file that runs with no server: open it in any
browser and use the demo buttons to switch between pharmacy, supplier, driver and admin. Data is kept in
that browser only. It is rebuilt from `public/` with `npm run build:demo`, using an in-browser copy of the
API (`standalone/mock-api.js`). Use it for demos, not real orders.

### Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | |
| `DB_FILE` | `data/maa.db` | SQLite file |
| `AUTH_SECRET` | random per start | **Required** when `NODE_ENV=production` |
| `CURRENCY` | `LYD` | ISO code used for display |
| `DELIVERY_FEE` | `10` | Flat fee per shipment, in major units |

## How an order flows

```
placed ──▶ accepted ──▶ ready_for_pickup ──▶ assigned ──▶ picked_up ──▶ delivered
  │  └▶ rejected   └──────────┴──▶ cancelled    ▲   │
  └▶ cancelled (by pharmacy)                    └───┘ driver releases job
```

* A cart with products from several companies is **split into one order per supplier**; each is a separate shipment.
* Stock is **reserved at checkout** in a single transaction (all lines or none) and returned on reject or cancel.
* Only one driver can claim a job. The **delivery code is visible only to the pharmacy**, so a driver
  can only mark an order delivered after a real handover.
* Every status change is recorded in a tracking timeline with who did it and when.

## Project layout

```
src/
  index.js          server entry point
  app.js            Express app, auth middleware, role guard
  db.js             SQLite schema + transaction helper
  auth.js           scrypt password hashing, signed tokens, delivery codes
  routes/           auth, catalog, orders, deliveries, admin
  seed.js           demo data
public/             web client (plain HTML/CSS/JS, works on phones)
test/               end-to-end API tests: npm test
```

## API summary

All endpoints are JSON under `/api`, with `Authorization: Bearer <token>`.

| Method & path | Who |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `GET /me` | anyone |
| `GET /products?q=&category=&supplier=`, `GET /suppliers` | pharmacy |
| `POST /orders` `{items:[{product_id, qty}], payment_method, notes}` | pharmacy |
| `GET /orders?status=a,b`, `GET /orders/:id` | all roles, scoped to what they may see |
| `POST /orders/:id/accept \| reject \| ready` | supplier |
| `POST /orders/:id/cancel` | pharmacy (before acceptance) or supplier (before pickup) |
| `GET/POST /supplier/products`, `PATCH /supplier/products/:id` | supplier |
| `GET /deliveries/available`, `POST /deliveries/:id/claim \| release \| pickup \| deliver` | driver |
| `GET /admin/overview`, `POST /admin/organizations/:id/verify`, `POST /admin/drivers/:id/approve` | admin |

## Next steps toward production

- Online payments (card / wallet) and supplier invoicing on credit terms
- Live driver GPS on a map, push/SMS notifications on each status change
- Batch/expiry tracking, and extra controls for prescription-only and controlled substances
- Distance-based delivery pricing and driver payouts
- Native mobile apps (the API is ready for them) and Arabic/RTL localisation
- Move to Postgres when you outgrow a single server
