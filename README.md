# Website with orders, payments and an owner dashboard

- Pages are in `site/` (clean URLs like `/catalog/`), the server is `server/app.js`, what is sold is `data/catalog.json`.
- Run locally: copy `.env.example` to `.env`, then `npm start` (Node 22.13 or newer; no packages to install).
- Owner dashboard: `/admin/` (ADMIN_EMAIL / ADMIN_PASSWORD).
- Razorpay test-mode setup, webhook tunnel and a test guide per payment method: [docs/PAYMENTS.md](docs/PAYMENTS.md).
- Tests: `node --disable-warning=ExperimentalWarning tests/logic.test.mjs`.

## Deploy on Railway
1. New Project > Deploy from GitHub repo > this repo.
2. Add a **Volume** mounted at `/data`, and set the variable `DATA_DIR=/data` (keeps orders safe across deploys).
3. Add the other variables from `.env.example`: `BUSINESS_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ characters),
   `SESSION_SECRET` (long random text) and the payment settings:
   - `PAYMENT_MODE=demo` to show how paying works without real money,
   - `PAYMENT_MODE=upi` with `UPI_ID` (and `UPI_PAYEE_NAME`) for payments straight to the owner's UPI,
   - `PAYMENT_MODE=razorpay` with the owner's `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
     (webhook URL in Razorpay: `https://<your-domain>/api/webhooks/razorpay`, events payment.captured, payment.failed, order.paid).
4. Settings > Networking > Generate Domain (or add the client's domain).

`railway.json` already sets the start command (`npm start`), a health check on `/api/health` and restart on failure;
`.nvmrc` asks for Node 22. No build step and no npm packages.
