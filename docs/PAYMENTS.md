# Payments guide: run and test Razorpay (test mode)

Test mode moves **no real money**. With no keys the site runs in **demo mode** (a practice checkout), so nothing breaks if you skip this guide.

## 1. Get Razorpay TEST keys
1. Sign up / log in at <https://dashboard.razorpay.com>.
2. Switch the dashboard to **Test Mode** (toggle at the top).
3. **Account & Settings → API Keys → Generate Test Key**. Copy the **Key Id** (`rzp_test_...`) and **Key Secret** (shown once).
4. **Payment Methods** (Settings): make sure UPI, Cards and Netbanking are enabled.

## 2. Fill `.env`
```bash
cp .env.example .env
```
Edit `.env` (never commit it, never paste keys in chat, code or `site/`):
```ini
PAYMENT_MODE=razorpay
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx        # your test key id
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx   # your test key secret (server only)
RAZORPAY_WEBHOOK_SECRET=pick-a-long-random-text # you choose it in step 4
ADMIN_EMAIL=owner@example.com
ADMIN_PASSWORD=at-least-10-characters
```
If a key is missing or malformed the server prints `PAYMENTS: ... Using demo mode` and falls back to demo. The checkout shows a "test mode" notice when test keys are active.

## 3. Start the site
```bash
npm start        # Node 22.13+, no packages to install
```
Open <http://localhost:3000/itinerary?trip=g02> and use **Join this trip** to check the six-traveller form. You can also inspect it at <http://localhost:3000/checkout?trip=g02&seats=6>. The startup line must say `payments: razorpay`. Owner dashboard: <http://localhost:3000/admin/>.

**Before testing a real Razorpay order:** the six seeded group trips are illustrative and are not in `data/catalog.json`; their checkout deliberately remains a device-only demo. After the owner confirms a trip's price, add its matching `id`, `kind: "booking"`, confirmed rupee `price`, and `maxQty: 6` to `data/catalog.json`, then restart. The checkout will create a server order from that catalog price and use Razorpay test mode. Never copy an illustrative price into the payable catalog as a confirmed quote.

## 4. Webhook through a tunnel
Razorpay cannot reach `localhost`, so expose it:
```bash
ngrok http 3000              # or: cloudflared tunnel --url http://localhost:3000
```
Copy the `https://...` address, then in Razorpay (Test Mode) go to **Account & Settings → Webhooks → Add New Webhook**:

| Field | Value |
| --- | --- |
| Webhook URL | `https://<your-tunnel>/api/pay/webhook` (`/api/webhooks/razorpay` also works) |
| Secret | the same text as `RAZORPAY_WEBHOOK_SECRET` in `.env` |
| Events | `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `qr_code.credited`, `refund.created`, `refund.processed`, `refund.failed` |

Restart `npm start` after editing `.env`. Deliveries are checked with HMAC-SHA256 over the raw body, and each event id is applied once (Razorpay retries are safe). See past deliveries in the same Webhooks page (**Details**), and resend one to see the duplicate handled (`"duplicate": true`).
Without a webhook the site still works while the buyer keeps the page open: it also checks with Razorpay by itself, but the webhook is the reliable path (closed tab, slow bank).

## 5. Test each method
Open checkout for a trip, choose the method, and check the order in `/admin/` (status, method, Razorpay payment id).

| Method | Steps | Expect |
| --- | --- | --- |
| **UPI ID (collect)** | UPI tab → enter `success@razorpay` | Order **Paid**. |
| UPI ID failure | Enter `failure@razorpay` | Order **Failed** with a reason; pay again works. |
| **UPI QR** | UPI tab → show QR (or in Razorpay checkout pick UPI QR) → scan with a test-capable payment flow | Page updates after Razorpay reports the result. `qr_code.credited` webhook arrives if enabled. Device-only demo bookings have no scannable order QR. |
| **UPI intent** | Open checkout on a phone (tunnel URL) → pay with a UPI app | Test mode cannot open a real bank app; use the Razorpay checkout's test UPI flow. Real intent works only on a phone with live keys. |
| **GPay** | Same as intent: on an Android phone choose Google Pay in the UPI list; on desktop use `success@razorpay` | Test mode simulates it; **Paid**. |
| **Net banking** | Netbanking tab → any bank (HDFC, ICICI, SBI) → on the Razorpay test bank page click **Success** or **Failure** | Success: **Paid**. Failure: **Failed**, retry allowed. |
| **Card** | Card tab → card below, any future expiry (`12/30`), any CVV (`123`), any name, OTP page: any code | Success: **Paid**. |

Test cards (from `research/razorpay-api.md`, Razorpay test-card docs; confirm against <https://razorpay.com/docs/payments/payment-gateway/web/test-card-details/> if one is rejected):

| Card | Number |
| --- | --- |
| Visa (domestic) | `4111 1111 1111 1111` |
| Mastercard (domestic) | `5267 3181 8797 5449` |
| Mastercard (international) | `5555 5555 5555 4444` |
| Visa (international) | `4012 8888 8888 1881` |
| Mastercard debit (international) | `5104 0600 0000 0008` |

> **UPI collect note:** NPCI phased out "collect by typing a UPI ID" for most merchants from 28 Feb 2026, and Razorpay's UPI ID validation is not available in test mode. If collect is refused the checkout says so and offers QR / GPay / PhonePe instead. This is expected; the UPI ID format is still checked on our side (`name@bank`).

### Refunds
1. Pay an order (any method) so it shows **Paid** in `/admin/`.
2. Click **Refund** on that order, confirm. The server calls Razorpay with an idempotency key, so a double click cannot refund twice.
3. Order becomes **Refunded** (or shows the refund as pending until the `refund.processed` webhook arrives). Check **Dashboard → Transactions → Refunds** too.

Demo-mode and direct-UPI payments are only marked refunded; send the money back yourself.

## 6. Run the automated tests
```bash
node --disable-warning=ExperimentalWarning tests/logic.test.mjs
```
No network or real keys needed: it uses fake test keys and a temporary database. Covers UPI ID format, checkout and webhook signatures, webhook idempotency, status transitions (a late failure never undoes a success) and the server-side amount.

## 7. Troubleshooting
| Problem | Likely cause and fix |
| --- | --- |
| Site says demo mode / "Using demo mode" in the console | `PAYMENT_MODE` is not `razorpay`, or `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` missing or mistyped. Fix `.env`, restart. |
| "Online payments are not set up correctly" | Wrong key pair (secret from another key) or key regenerated. Generate a new test key, update `.env`. |
| Paid at Razorpay but order stays **Waiting** | Webhook not set up or tunnel down; wait a few seconds for the built-in status check, or fix the webhook. |
| Webhook shows 400 `Bad signature` | Secret in Razorpay differs from `RAZORPAY_WEBHOOK_SECRET`, or something rewrote the body. Retype the secret in both places, restart. |
| Webhook shows 503 | `RAZORPAY_WEBHOOK_SECRET` is empty. |
| Webhook shows 404 / times out | Tunnel URL changed (ngrok gives a new one on every start). Update the URL in Razorpay. |
| Webhook says `"duplicate": true` | Normal: that event id was already applied. |
| UPI collect error | Collect is phased out for most merchants (see note). Use QR or GPay. |
| Order stays **Failed** after a good payment | Retry payment on the same order; a later success replaces a failure, but a failure never replaces a success. |
| Refund rejected | Payment not captured yet, already refunded, or amount over the balance. Read the message shown in `/admin/`. |
| Amount looks wrong | Amounts always come from `data/catalog.json` on the server; edit the catalog and restart. |
| Tests fail to start the server | Port or Node version: needs Node 22.13+. |

## Going live
Only when the owner approves: generate **Live** keys, put them in the hosting variables (not in git), add a live webhook with the real domain, and run one small real payment and refund first. `/admin/` warns when live keys are in use.
