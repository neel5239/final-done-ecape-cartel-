# Full-stack kit: how this site works (read before changing the backend)

This project is a multi-page website with a real backend: orders/bookings, payments (demo, UPI or
Razorpay) and an owner dashboard. The kit is tested; adapt it to the business, do not rewrite it.

## Layout
- `site/` pages, served with clean URLs: `site/catalog/index.html` is `/catalog/`, `site/about.html` is `/about`.
  Every page links the same header/footer and uses relative or root paths (`/css/site.css`).
- `server/app.js` the server (no npm packages, Node 22.13+): pages + `/api/*`. `npm start` runs it.
- `server/payments/index.js` the three payment modes. `server/admin.js` owner login + dashboard API.
- `data/catalog.json` what is sold and its price in **rupees** (`id`, `kind`: product | booking, `name`,
  `description`, `price`, `image`, `category`, `maxQty`, `meta`). Synced into the database on start.
- `site/js/shop.js` the pages' helper: `Shop.catalog()`, `Shop.cart.add(id, qty)`, `Shop.checkout({ customer, date, notes })`, `Shop.money(paise)`.
- `site/checkout/` checkout (all payment modes), `site/pay/` the demo phone page, `site/admin/` owner dashboard.
- Settings are environment variables (`.env` locally, Railway Variables online). See `.env.example`.

## Rules (do not break these)
1. Prices live in `data/catalog.json` only. Pages show prices from `Shop.catalog()`; the server
   recomputes every total. Never send or trust a price from the browser.
2. Build catalog, booking and product pages with `shop.js`: a "Book"/"Buy" button adds to the cart or
   calls `Shop.checkout(...)` directly with the item, the buyer's name + phone/email and (bookings) a date.
3. Do not edit `server/payments/*` or `server/admin.js` unless the task says so. They are verified
   (signatures, webhooks, amounts, status rules, login). New features go in new routes in `server/app.js`.
4. Payment mode is a setting: `PAYMENT_MODE=demo` until the client approves; then `upi` (their UPI ID or
   their QR image in `UPI_QR_IMAGE`) or `razorpay` (their keys). Never hard-code a UPI ID or key.
5. Secrets only in environment variables. Never commit `.env`, never print keys, never put a secret in `site/`.
6. Style checkout, pay and admin pages by changing the CSS variables at the top of
   `site/checkout/checkout.css` and `site/admin/admin.css` to the brand, not their structure.
7. The owner dashboard is at `/admin/` (login from ADMIN_EMAIL / ADMIN_PASSWORD). Link to it only from
   the footer as a small "Owner login", never from the main navigation.
8. Money is whole paise in the server and the API (`49900` = ₹499). The catalog file is in rupees.
9. Check your work: `node --check` every server file you touch; `npm start`, then open the page,
   place an order, pay in demo mode, and see it in `/admin/`.

## Hosting (Railway)
New Project > Deploy from GitHub repo. Add a Volume mounted at `/data` and set `DATA_DIR=/data`, then add
the variables from `.env.example` (ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET, payment settings).
Railway runs `npm start` and gives the server its `PORT`.

## Added for this business: owner trips, visit statistics
- `server/trips.js` (routes wired in `server/app.js`, tables `trips` + `visits` in `server/db.js`).
- Dashboard `/admin/` has tabs: Overview (visitors, funnel, sales), Bookings (orders), Trips (`site/admin/trips.js`).
- Owner trips are one JSON document each (GROUP TRIP SCHEMA in `site/js/data.js`). Published ones are served to every
  page as `/js/live-trips.js` (generated; `site/js/live-trips.js` is only the static fallback) and synced into `items`
  by `upsertTripItem`, so checkout prices them on the server like the seed group trips. Drafts are served only to the
  logged-in owner, so `/itinerary?trip=<id>` works as a preview.
- Photos: resized in the browser, `POST /api/admin/uploads`, saved in `DATA_DIR/uploads`, served at `/uploads/<name>.jpg`.
- Visits: `site/js/core.js` sends a beacon to `POST /api/track` (no cookies, daily hashed visitor id, Do Not Track respected).
- Trip builder (dashboard > Trips): fixed slots. Pick the number of days, fill each day (title, what we do, stay,
  photos); "Deploy to website" publishes it. The timeline's short name and 3 key moments come from the day title
  and first activities (`cleanTrip`).
