// Payments: one interface, three modes. The mode is a setting (PAYMENT_MODE), never a code change.
//
//   demo      For showing clients. The QR opens this site's own /pay page on the phone, where
//             "Pay" marks the order paid; UPI, card and net-banking tabs are simulated. No money moves.
//   upi       Straight to the owner's UPI ID (no gateway, no fees). The QR is a real UPI payment
//             request. UPI has no automatic confirmation without a gateway, so the buyer enters their
//             UPI reference and the owner marks the order paid in the dashboard after checking.
//   razorpay  The owner's own Razorpay account: UPI (intent, QR, GPay, collect), cards, net banking,
//             wallets. The order is created on the server, and "paid" requires Razorpay's signature
//             (checkout) or a signed webhook. Test keys (rzp_test_...) move no real money.
//
// Every payment path also gets a transaction row (db.js `payments`): method, Razorpay ids, status
// created | pending | success | failed | refunded, failure reason and refund. The owner dashboard
// shows it; the state machine in db.js makes sure a late or repeated event never undoes a success.
import crypto from 'node:crypto';
import { config, paymentProblems, paymentWarnings } from '../config.js';
import {
  db, setStatus, logEvent, createTransaction, openTransaction, getTransaction, findTransaction, transactionsForOrder,
  latestTransaction, setTransactionStatus, setTransactionDetails, publicTransaction, runOnce,
} from '../db.js';
import { HttpError } from '../http.js';
import * as rzp from './razorpay.js';

export { transactionsForOrder, latestTransaction, latestTransactionsFor, listTransactions, publicTransaction, TXN_STATUSES } from '../db.js';

export function effectiveMode() {
  return paymentProblems().length ? 'demo' : config.paymentMode;
}

const rupees = (paise) => (paise / 100).toFixed(2);
const PAYABLE = ['pending', 'failed', 'verifying'];
const METHODS = ['upi', 'card', 'netbanking', 'wallet', 'emi', 'paylater', 'cardless_emi'];
const cleanMethod = (m) => { const v = String(m || '').toLowerCase(); return v === 'gpay' || v === 'qr' ? 'upi' : METHODS.includes(v) ? v : ''; };
const testMode = () => effectiveMode() === 'razorpay' && rzp.isTestKey();

// What the checkout page needs to know (never any secret: only the public key id).
export function publicPaymentConfig() {
  const mode = effectiveMode();
  return {
    mode,
    business: config.business,
    currency: config.currency,
    methods: mode === 'upi' ? ['upi'] : ['upi', 'card', 'netbanking'],
    // UPI ways to pay: intent opens GPay/PhonePe/Paytm on a phone, qr is scanned from a desktop,
    // collect sends a request to a typed UPI ID (phased out by NPCI for most merchants in 2026).
    upiFlows: mode === 'upi' ? ['qr', 'intent'] : ['intent', 'qr', 'collect'],
    razorpayKeyId: mode === 'razorpay' ? config.razorpay.keyId : undefined,
    testMode: testMode(),
    demo: mode === 'demo',
    notice: mode === 'demo'
      ? 'Demo mode: this is a practice checkout. No real money moves and no card or bank details are needed.'
      : testMode() ? 'Razorpay test mode: use Razorpay test cards or the UPI ID success@razorpay. No real money moves.' : undefined,
    upiPayee: mode === 'upi' ? config.upi.payee : undefined,
    upiQrImage: mode === 'upi' && !config.upi.vpa && config.upi.qrImage ? `/${config.upi.qrImage}` : undefined,
    warning: paymentProblems()[0],
  };
}

// For /admin only: the mode, whether it is test or live, and what the owner should fix.
export function paymentOverview() {
  return { mode: effectiveMode(), configured: config.paymentMode, testMode: testMode(), webhook: !!config.razorpay.webhookSecret, problems: paymentProblems(), warnings: paymentWarnings() };
}

// Reuse the open transaction for this order and mode, or open one.
function ensureTransaction(order, mode, extra = {}) {
  return openTransaction(order.id, mode) || createTransaction({ orderId: order.id, mode, amount: order.amount, currency: order.currency, ...extra });
}

// Gateway failures: the buyer gets a plain message, the owner gets Razorpay's reason in the order log.
function gatewayError(order, e, what = 'gateway_error') {
  logEvent(order.id, what, `${e.code || ''} ${e.message}`.trim());
  if (e instanceof rzp.RazorpayError && e.status >= 400 && e.status < 500) {
    return new HttpError(e.status === 401 ? 502 : 400, e.status === 401 ? 'Online payments are not set up correctly. Please contact us to complete your booking.' : e.message);
  }
  return new HttpError(502, 'The payment gateway is not responding. Please try again in a minute.');
}

// One Razorpay order per shop order, reused across retries (Razorpay allows several attempts on one
// order). Double clicks share the same in-flight request instead of creating two gateway orders.
const inflight = new Map();
async function razorpayTransaction(order) {
  const open = transactionsForOrder(order.id).find((t) => t.mode === 'razorpay' && t.razorpayOrderId && ['created', 'pending', 'failed'].includes(t.status));
  if (open) return open;
  // Orders that got a Razorpay order before the transactions table existed.
  if (order.payment_ref.startsWith('order_')) return createTransaction({ orderId: order.id, mode: 'razorpay', amount: order.amount, currency: order.currency, razorpayOrderId: order.payment_ref });
  if (inflight.has(order.id)) return inflight.get(order.id);
  const p = (async () => {
    let data;
    try {
      data = await rzp.createOrder({ amount: order.amount, currency: order.currency, receipt: order.id, notes: { order_id: order.id, business: config.business } });
    } catch (e) { throw gatewayError(order, e); }
    if (!data?.id || Number(data.amount) !== order.amount) { logEvent(order.id, 'gateway_error', 'order response did not match'); throw new HttpError(502, 'The payment gateway is not responding. Please try again in a minute.'); }
    db.prepare('UPDATE orders SET payment_ref = ? WHERE id = ?').run(data.id, order.id);
    logEvent(order.id, 'gateway_order', data.id);
    return createTransaction({ orderId: order.id, mode: 'razorpay', amount: order.amount, currency: order.currency, razorpayOrderId: data.id });
  })();
  inflight.set(order.id, p);
  try { return await p; } finally { inflight.delete(order.id); }
}

// Start paying an order: returns what the checkout page shows for the current mode.
export async function startPayment(order, baseUrl) {
  const mode = effectiveMode();
  if (!PAYABLE.includes(order.status)) throw new HttpError(409, `This order is already ${order.status}.`);
  if (order.payment_mode !== mode) db.prepare('UPDATE orders SET payment_mode = ? WHERE id = ?').run(mode, order.id);
  if (mode === 'demo') {
    const txn = ensureTransaction(order, 'demo');
    // The QR opens the demo "bank app" page for this order on the phone that scans it.
    return { mode, demo: true, transactionId: txn.id, qr: `${baseUrl}/pay/?order=${encodeURIComponent(order.id)}&t=${encodeURIComponent(order.token)}`, amount: order.amount };
  }
  if (mode === 'upi' && !config.upi.vpa) {
    const txn = ensureTransaction(order, 'upi', { method: 'upi' });
    // Only the owner's printed QR: the buyer types the amount in their UPI app.
    return { mode, transactionId: txn.id, qrImage: `/${config.upi.qrImage}`, payee: config.upi.payee, amount: order.amount };
  }
  if (mode === 'upi') {
    const txn = ensureTransaction(order, 'upi', { method: 'upi' });
    // Standard UPI deep link (NPCI): the UPI ID keeps its plain "@" (validated in config), other
    // fields are percent-encoded.
    const enc = encodeURIComponent;
    const qr = `upi://pay?pa=${config.upi.vpa}&pn=${enc(config.upi.payee)}&am=${rupees(order.amount)}&cu=INR&tn=${enc(`Order ${order.id.slice(-8)}`)}&tr=${enc(order.id)}`;
    return { mode, transactionId: txn.id, qr, vpa: config.upi.vpa, payee: config.upi.payee, amount: order.amount };
  }
  // Razorpay Orders API: the amount is fixed on the server, so the browser can't change it.
  const txn = await razorpayTransaction(order);
  return {
    mode, transactionId: txn.id, razorpayOrderId: txn.razorpayOrderId, keyId: config.razorpay.keyId, amount: order.amount, currency: order.currency,
    testMode: testMode(), name: config.business, description: `Booking ${order.id.slice(-8)}`,
    prefill: { name: order.customer_name, email: order.customer_email, contact: order.customer_phone },
  };
}

// demo: the phone page (or the desktop's simulated card/net banking) reports the outcome.
export function demoResult(order, outcome, method) {
  if (effectiveMode() !== 'demo') throw new HttpError(403, 'Demo payments are switched off on this site.');
  if (!PAYABLE.includes(order.status)) return; // already paid/cancelled: nothing to simulate
  const ok = outcome === 'success';
  const ref = ok ? `DEMO-${Date.now().toString(36).toUpperCase()}` : '';
  const txn = ensureTransaction(order, 'demo');
  setTransactionStatus(txn.id, ok ? 'success' : 'failed', { paymentId: ref, method: cleanMethod(method) || 'upi', error: ok ? '' : 'Declined in the demo payment page', by: 'demo payment' });
  setStatus(order.id, ok ? 'paid' : 'failed', { ref, by: 'demo payment', skipTxn: true });
}

// upi: the buyer says they paid and gives their UPI reference (UTR); the owner confirms it.
export function upiClaim(order, utr) {
  if (effectiveMode() !== 'upi') throw new HttpError(403, 'UPI confirmation is not used on this site.');
  const ref = String(utr || '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9]{6,35}$/.test(ref)) throw new HttpError(400, 'Enter the UPI transaction ID (UTR) shown in your payment app.');
  if (!PAYABLE.includes(order.status)) throw new HttpError(409, `This order is already ${order.status}.`);
  const txn = ensureTransaction(order, 'upi', { method: 'upi' });
  setTransactionStatus(txn.id, 'pending', { paymentId: ref, method: 'upi', by: 'buyer submitted UPI reference' });
  if (!setStatus(order.id, 'verifying', { ref, by: 'buyer submitted UPI reference', skipTxn: true })) throw new HttpError(409, `This order is already ${order.status}.`);
}

// Map a Razorpay payment entity onto our transaction + order. Razorpay is the source of truth; the
// state machine decides whether the change is still allowed. Returns a short outcome for the log.
const GATEWAY_TO_TXN = { created: '', authorized: 'pending', captured: 'success', failed: 'failed', refunded: 'refunded' };
const TXN_TO_ORDER = { success: 'paid', failed: 'failed', refunded: 'refunded' };
function applyGatewayPayment(txn, pay, by, eventId) {
  const status = GATEWAY_TO_TXN[pay.status];
  if (!status) return `ignored ${pay.status || 'unknown'}`;
  if (status === 'success' && Number(pay.amount) !== txn.amount) {
    logEvent(txn.orderId, 'amount_mismatch', `${pay.id || ''} ${pay.amount} != ${txn.amount}`);
    return 'amount_mismatch';
  }
  const refund = status === 'refunded' ? { refundStatus: 'processed', refundedAmount: Number(pay.amount_refunded) || txn.amount } : {};
  if (!setTransactionStatus(txn.id, status, { paymentId: pay.id, method: cleanMethod(pay.method), error: pay.error_description || pay.error_reason || '', eventId, by, ...refund })) return `ignored ${status} (already ${getTransaction(txn.id)?.status})`;
  const orderStatus = TXN_TO_ORDER[status];
  if (orderStatus && !setStatus(txn.orderId, orderStatus, { ref: status === 'success' ? pay.id : '', by, skipTxn: true })) {
    const o = db.prepare('SELECT status FROM orders WHERE id = ?').get(txn.orderId);
    if (o && o.status !== orderStatus) logEvent(txn.orderId, 'needs_owner', `payment ${status} while the order is ${o.status}`);
  }
  return status;
}

// Fill the method (upi / card / netbanking ...) after a checkout success; best effort, never blocks.
function enrichMethod(txnId, paymentId) {
  if (!rzp.hasKeys() || !paymentId) return;
  rzp.fetchPayment(paymentId).then((p) => setTransactionDetails(txnId, { method: cleanMethod(p.method) })).catch(() => {});
}

// razorpay: checkout success handler -> verify HMAC-SHA256(order_id|payment_id, key_secret).
export function razorpayVerify(order, body) {
  if (effectiveMode() !== 'razorpay') throw new HttpError(403, 'Razorpay is not used on this site.');
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = body || {};
  if (!oid || !pid || !sig) throw new HttpError(400, 'Payment details do not match this order.');
  const known = findTransaction({ razorpayOrderId: oid });
  if (!(known ? known.orderId === order.id : oid === order.payment_ref)) throw new HttpError(400, 'Payment details do not match this order.');
  if (!rzp.verifyCheckoutSignature({ orderId: oid, paymentId: pid, signature: sig })) { logEvent(order.id, 'bad_signature', pid); throw new HttpError(400, 'Payment could not be verified.'); }
  const txn = known || createTransaction({ orderId: order.id, mode: 'razorpay', amount: order.amount, currency: order.currency, razorpayOrderId: oid });
  const by = 'razorpay checkout (signature verified)';
  // A valid signature on our own server-made order means Razorpay accepted the full amount.
  if (setTransactionStatus(txn.id, 'success', { paymentId: pid, by })) {
    if (!setStatus(order.id, 'paid', { ref: pid, by, skipTxn: true }) && order.status !== 'paid') logEvent(order.id, 'needs_owner', `payment success while the order is ${order.status}`);
  }
  enrichMethod(txn.id, pid);
}

// razorpay: the checkout reported a failed attempt. The browser is not trusted: the payment is
// fetched from Razorpay and only its real status is recorded.
export async function razorpayFailed(order, body) {
  if (effectiveMode() !== 'razorpay') throw new HttpError(403, 'Razorpay is not used on this site.');
  const meta = body?.error?.metadata || {};
  const oid = body?.razorpay_order_id || meta.order_id;
  const pid = body?.razorpay_payment_id || meta.payment_id;
  const txn = oid ? findTransaction({ razorpayOrderId: oid }) : null;
  if (!txn || txn.orderId !== order.id) throw new HttpError(400, 'Payment details do not match this order.');
  if (!pid || !/^pay_\w+$/.test(pid)) return publicTransaction(txn);
  let pay;
  try { pay = await rzp.fetchPayment(pid); } catch { return publicTransaction(txn); }
  if (pay.order_id !== oid) throw new HttpError(400, 'Payment details do not match this order.');
  applyGatewayPayment(txn, pay, 'razorpay checkout (failure, confirmed with Razorpay)');
  return publicTransaction(getTransaction(txn.id));
}

// razorpay: webhook -> verify HMAC-SHA256(raw body, webhook secret), then apply it exactly once
// (x-razorpay-event-id; without the header, a hash of the body identifies the delivery).
// Events: payment.authorized | payment.captured | payment.failed | order.paid | qr_code.credited |
// refund.created | refund.processed | refund.failed. Must stay synchronous and fast (5 s limit).
export function razorpayWebhook(raw, signature, eventId) {
  if (!config.razorpay.webhookSecret) throw new HttpError(503, 'Webhook secret not set');
  if (!rzp.verifyWebhookSignature(raw, signature)) throw new HttpError(400, 'Bad signature');
  let ev;
  try { ev = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); } catch { throw new HttpError(400, 'Bad JSON'); }
  const id = String(eventId || '').trim() || `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`;
  return runOnce(id, { source: 'razorpay', type: String(ev.event || '') }, () => handleWebhookEvent(ev, id));
}

// Find the transaction a webhook is about; creates one for orders made before transactions existed.
function webhookTransaction(pay, rzpOrder) {
  const t = findTransaction({ razorpayPaymentId: pay?.id, razorpayOrderId: pay?.order_id || rzpOrder?.id });
  if (t) return t;
  const oid = pay?.order_id || rzpOrder?.id;
  if (!oid) return null;
  const order = db.prepare('SELECT * FROM orders WHERE payment_ref = ? OR id = ?').get(oid, rzpOrder?.receipt || '');
  if (!order) return null;
  return createTransaction({ orderId: order.id, mode: 'razorpay', amount: order.amount, currency: order.currency, razorpayOrderId: oid });
}

const EVENT_STATUS = { 'payment.authorized': 'authorized', 'payment.captured': 'captured', 'payment.failed': 'failed', 'order.paid': 'captured', 'qr_code.credited': 'captured' };
function handleWebhookEvent(ev, eventId) {
  const pay = ev.payload?.payment?.entity;
  const by = `razorpay webhook ${ev.event}`;
  if (EVENT_STATUS[ev.event]) {
    const txn = ev.event === 'qr_code.credited'
      ? findTransaction({ razorpayQrId: ev.payload?.qr_code?.entity?.id, razorpayPaymentId: pay?.id })
      : webhookTransaction(pay, ev.payload?.order?.entity);
    if (!txn) return 'no matching order';
    // order.paid carries the order's amount_paid when the payment snapshot is missing.
    const entity = pay || { id: '', amount: ev.payload?.order?.entity?.amount_paid };
    return { outcome: applyGatewayPayment(txn, { ...entity, status: EVENT_STATUS[ev.event] }, by, eventId), orderId: txn.orderId };
  }
  const refund = ev.payload?.refund?.entity;
  if (refund && String(ev.event || '').startsWith('refund.')) {
    const txn = findTransaction({ razorpayPaymentId: refund.payment_id });
    if (!txn) return 'no matching payment';
    if (ev.event === 'refund.failed') {
      setTransactionStatus(txn.id, txn.status, { refundId: refund.id, refundStatus: 'failed', eventId, by });
      logEvent(txn.orderId, 'refund_failed', `${refund.id} ${refund.amount}`);
      return { outcome: 'refund failed', orderId: txn.orderId };
    }
    const refunded = Number(pay?.amount_refunded) || Number(refund.amount) || 0;
    const full = refunded >= txn.amount;
    const refundStatus = ev.event === 'refund.processed' ? (full ? 'processed' : 'partial') : (full ? 'pending' : 'partial');
    const to = full && txn.status === 'success' ? 'refunded' : txn.status;
    if (setTransactionStatus(txn.id, to, { refundId: refund.id, refundStatus, refundedAmount: refunded, eventId, by }) && to === 'refunded') {
      setStatus(txn.orderId, 'refunded', { by, skipTxn: true });
    }
    return { outcome: `refund ${refundStatus}`, orderId: txn.orderId };
  }
  return `ignored ${ev.event}`;
}

// ---------- UPI: collect (typed UPI ID), intent (opens the UPI app), QR (scan) ----------

// UPI ID check for the checkout form. Format always; with Razorpay keys, also Razorpay's lookup.
export async function checkVpa(vpa) {
  const v = String(vpa || '').trim();
  if (effectiveMode() === 'razorpay') return rzp.validateVpa(v);
  return rzp.VPA_RE.test(v) ? { valid: true, vpa: v, checked: 'format' } : { valid: false, vpa: v, checked: 'format', reason: 'That does not look like a UPI ID (for example name@okhdfcbank).' };
}

// ctx: { baseUrl, ip, userAgent, referer } from the request (Razorpay needs them for S2S UPI).
export async function startUpi(order, { flow, vpa } = {}, ctx = {}) {
  const mode = effectiveMode();
  if (!PAYABLE.includes(order.status)) throw new HttpError(409, `This order is already ${order.status}.`);
  if (!['collect', 'intent', 'qr'].includes(flow)) throw new HttpError(400, 'Choose how to pay with UPI.');
  let checked;
  if (flow === 'collect') {
    checked = await checkVpa(vpa);
    if (!checked.valid) throw new HttpError(400, checked.reason || 'Check the UPI ID.');
  }
  if (mode !== 'razorpay') {
    // demo and direct-UPI modes use startPayment's QR / deep link for every UPI flow.
    const s = await startPayment(order, ctx.baseUrl || config.publicUrl);
    return { ...s, flow, link: s.qr, vpa: checked?.vpa, message: mode === 'demo' ? 'Demo mode: open the link or scan the QR to finish a practice payment.' : undefined };
  }
  if (flow === 'qr') {
    // Reuse a live QR for this order so the buyer can never be shown two payable codes.
    const open = transactionsForOrder(order.id).find((t) => t.razorpayQrId && ['created', 'pending'].includes(t.status));
    if (open) {
      const q = await rzp.fetchUpiQr(open.razorpayQrId).catch(() => null);
      if (q?.status === 'active') return { mode, flow, transactionId: open.id, qrImage: q.image_url, qrId: q.id, closeBy: q.close_by, amount: order.amount, testMode: testMode() };
      if (q) setTransactionStatus(open.id, 'failed', { error: 'QR code expired', by: 'qr check' });
    }
    let q;
    try { q = await rzp.createUpiQr({ amount: order.amount, name: config.business, description: `Booking ${order.id.slice(-8)}`, notes: { order_id: order.id }, closeInMinutes: 20 }); } catch (e) { throw gatewayError(order, e); }
    const txn = createTransaction({ orderId: order.id, mode: 'razorpay', method: 'upi', amount: order.amount, currency: order.currency, razorpayQrId: q.id });
    return { mode, flow, transactionId: txn.id, qrImage: q.image_url, qrId: q.id, closeBy: q.close_by, amount: order.amount, testMode: testMode() };
  }
  const txn = await razorpayTransaction(order);
  let res;
  try {
    res = await (flow === 'collect' ? rzp.createUpiCollect : rzp.createUpiIntent)({
      orderId: txn.razorpayOrderId, amount: order.amount, currency: order.currency, vpa: checked?.vpa,
      email: order.customer_email, contact: order.customer_phone, description: `Booking ${order.id.slice(-8)}`, notes: { order_id: order.id },
      ip: ctx.ip, userAgent: ctx.userAgent, referer: ctx.referer,
    });
  } catch (e) {
    if (e instanceof rzp.RazorpayError && e.status >= 400 && e.status < 500 && e.status !== 401) {
      logEvent(order.id, 'upi_error', `${flow}: ${e.code} ${e.message}`);
      throw new HttpError(400, flow === 'collect' ? 'UPI requests to a typed UPI ID are not available right now. Scan the QR code or pay with GPay / PhonePe instead.' : 'This UPI option is not available right now. Please use the Razorpay checkout or scan the QR code.');
    }
    throw gatewayError(order, e);
  }
  setTransactionStatus(txn.id, 'pending', { paymentId: res.paymentId, method: 'upi', by: `upi ${flow}` });
  return { mode, flow, transactionId: txn.id, razorpayOrderId: txn.razorpayOrderId, paymentId: res.paymentId, link: res.link || undefined, amount: order.amount, testMode: testMode() };
}

// ---------- status tracking ----------

// What the buyer's checkout/status page polls: order status plus the latest transaction.
export function paymentStatus(order) {
  const o = db.prepare('SELECT status, payment_mode FROM orders WHERE id = ?').get(order.id) || order;
  return { status: o.status, mode: o.payment_mode, transaction: publicTransaction(latestTransaction(order.id)) };
}

// Ask Razorpay directly (for when a webhook is slow or not set up). Throttled per order.
const lastSync = new Map();
export async function syncPaymentStatus(order) {
  if (effectiveMode() === 'razorpay' && rzp.hasKeys() && Date.now() - (lastSync.get(order.id) || 0) > 4000) {
    lastSync.set(order.id, Date.now());
    if (lastSync.size > 5000) lastSync.clear();
    const txn = transactionsForOrder(order.id).find((t) => t.mode === 'razorpay' && t.razorpayOrderId && ['created', 'pending', 'failed'].includes(t.status));
    if (txn) {
      const pays = await rzp.fetchOrderPayments(txn.razorpayOrderId).catch(() => null);
      const best = pays && (pays.find((p) => p.status === 'captured') || pays.find((p) => p.status === 'authorized') || pays[0]);
      if (best) applyGatewayPayment(txn, best, 'razorpay status check');
    }
  }
  return paymentStatus(order);
}

// Net-banking banks for the checkout (Razorpay's live list, or a short common list otherwise).
const COMMON_BANKS = [['HDFC', 'HDFC Bank'], ['ICIC', 'ICICI Bank'], ['SBIN', 'State Bank of India'], ['UTIB', 'Axis Bank'], ['KKBK', 'Kotak Mahindra Bank'], ['YESB', 'Yes Bank'], ['PUNB_R', 'Punjab National Bank'], ['BARB_R', 'Bank of Baroda']].map(([code, name]) => ({ code, name }));
export async function netbankingBanks() {
  if (effectiveMode() === 'razorpay') {
    const list = await rzp.listBanks().catch(() => null);
    if (list?.length) return list;
  }
  return COMMON_BANKS;
}

// ---------- refunds (owner) ----------

// Full refund of the order's successful payment. Razorpay payments are refunded through the API with
// an idempotency key (a retry or double click cannot refund twice); demo payments are simply marked;
// direct-UPI payments are marked and the owner returns the money from their UPI app.
const refunding = new Map();
export async function refundPayment(orderId, { by = 'owner', reason = '' } = {}) {
  if (refunding.has(orderId)) return refunding.get(orderId);
  const p = (async () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new HttpError(404, 'Order not found');
    const all = transactionsForOrder(orderId);
    const done = all.find((t) => t.status === 'refunded');
    const txn = all.find((t) => t.status === 'success');
    if (!txn && done) return { already: true, transaction: done };
    if (!txn) {
      if (order.status !== 'paid' || order.payment_mode === 'razorpay') throw new HttpError(409, 'There is no successful payment to refund on this order.');
      if (!setStatus(orderId, 'refunded', { by })) throw new HttpError(409, 'That status change is not allowed for this order.');
      return { manual: order.payment_mode === 'upi', transaction: null };
    }
    if (txn.mode !== 'razorpay') {
      setTransactionStatus(txn.id, 'refunded', { refundStatus: txn.mode === 'demo' ? 'processed' : 'manual', refundedAmount: txn.amount, by });
      setStatus(orderId, 'refunded', { by, skipTxn: true });
      return { manual: txn.mode === 'upi', transaction: getTransaction(txn.id) };
    }
    if (!rzp.hasKeys()) throw new HttpError(409, 'Razorpay keys are not set, so this payment cannot be refunded from here. Refund it in the Razorpay Dashboard.');
    if (!/^pay_\w+$/.test(txn.razorpayPaymentId)) throw new HttpError(409, 'This payment has no Razorpay payment id to refund.');
    let r;
    try {
      r = await rzp.refund(txn.razorpayPaymentId, { idempotencyKey: `refund_${txn.id}`, notes: { order_id: orderId, reason: String(reason).slice(0, 200) } });
    } catch (e) {
      logEvent(orderId, 'refund_error', `${e.code || ''} ${e.message}`.trim());
      if (e instanceof rzp.RazorpayError && e.status >= 400 && e.status < 500) throw new HttpError(409, `Razorpay did not accept the refund: ${e.message}`);
      throw new HttpError(502, 'Razorpay is not responding. Try the refund again in a minute (it will not refund twice).');
    }
    const refunded = Number(r.amount) || txn.amount;
    const full = refunded >= txn.amount;
    setTransactionStatus(txn.id, full ? 'refunded' : 'success', { refundId: r.id, refundStatus: r.status === 'processed' ? (full ? 'processed' : 'partial') : 'pending', refundedAmount: refunded, by: `${by} (Razorpay refund ${r.id})` });
    if (full) setStatus(orderId, 'refunded', { by: `${by} (Razorpay refund ${r.id})`, skipTxn: true });
    return { refundId: r.id, refundStatus: r.status, transaction: getTransaction(txn.id) };
  })();
  refunding.set(orderId, p);
  try { return await p; } finally { refunding.delete(orderId); }
}
