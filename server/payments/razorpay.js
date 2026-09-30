// Razorpay REST client (no SDK: plain fetch, Node 22+). Everything here talks to Razorpay only; the
// order/transaction bookkeeping lives in ./index.js and ../db.js.
//
// Rules this file keeps:
// - Keys come from config (environment only). They are sent as a Basic auth header and never appear
//   in an error message, a log line or a return value.
// - Money is whole paise (integers).
// - Every call has its own timeout. Retries (with backoff) only on network errors and 5xx, never on
//   4xx: a 4xx means the request itself is wrong and repeating it cannot help. Calls that can move
//   money twice (UPI collect/intent) retry only when the request provably never reached Razorpay.
import crypto from 'node:crypto';
import { config } from '../config.js';

export class RazorpayError extends Error {
  constructor(message, { status = 0, code = '', field = '', retryable = false } = {}) {
    super(message);
    this.name = 'RazorpayError';
    this.status = status;   // HTTP status from Razorpay (0 = no response: network error or timeout)
    this.code = code;       // Razorpay error code, e.g. BAD_REQUEST_ERROR
    this.field = field;     // the request field Razorpay complained about, if any
    this.retryable = retryable;
  }
}

// Both keys present: the only thing that makes API calls possible. Mode selection is config.js's job.
export const hasKeys = () => !!(config.razorpay.keyId && config.razorpay.keySecret);
export const isTestKey = () => config.razorpay.keyId.startsWith('rzp_test_');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Connection never opened, so the request cannot have been processed: safe to retry anything.
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);

async function call(method, route, { body, query, headers = {}, timeoutMs = config.razorpay.timeoutMs, retries = config.razorpay.retries, unsafe = false } = {}) {
  if (!hasKeys()) throw new RazorpayError('Razorpay keys are not set', { code: 'NO_KEYS' });
  const url = new URL(`${config.razorpay.apiBase}${route}`);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(Math.min(4000, 300 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 150));
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: { authorization: `Basic ${auth}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const code = e.cause?.code || e.code || '';
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      // A timeout on an unsafe call may mean Razorpay did act: do not repeat it.
      const retryable = unsafe ? NOT_SENT.has(code) : true;
      last = new RazorpayError(timedOut ? 'Razorpay did not answer in time' : 'Could not reach Razorpay', { code: code || (timedOut ? 'TIMEOUT' : 'NETWORK'), retryable });
      if (!retryable) break;
      continue;
    }
    const data = await r.json().catch(() => ({}));
    if (r.ok) return data;
    const err = data?.error || {};
    const retryable = r.status >= 500 && (!unsafe || [502, 503, 504].includes(r.status));
    last = new RazorpayError(err.description || `Razorpay HTTP ${r.status}`, { status: r.status, code: err.code || '', field: err.field || '', retryable });
    if (!retryable) break;
  }
  throw last;
}

// Razorpay limits: receipt <= 40 chars; notes <= 15 keys, key <= 30 chars (we keep it short), value <= 256.
function cleanNotes(notes = {}) {
  const out = {};
  for (const [k, v] of Object.entries(notes).slice(0, 15)) if (v !== undefined && v !== null) out[String(k).slice(0, 30)] = String(v).slice(0, 256);
  return out;
}
function paise(amount) {
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 100) throw new RazorpayError('Amount must be whole paise, at least 100', { code: 'BAD_AMOUNT' });
  return n;
}

// ---------- orders ----------

// Server-side order: fixes amount + currency at Razorpay so the browser cannot change them.
export function createOrder({ amount, currency = config.currency, receipt = '', notes } = {}) {
  return call('POST', '/orders', { body: { amount: paise(amount), currency, receipt: String(receipt).slice(0, 40), notes: cleanNotes(notes) } });
}
export const fetchOrder = (id) => call('GET', `/orders/${encodeURIComponent(id)}`);
// All attempts (failed ones too) made against one Razorpay order, newest first.
export async function fetchOrderPayments(id) {
  const d = await call('GET', `/orders/${encodeURIComponent(id)}/payments`);
  return (d.items || []).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

// ---------- signatures ----------

function hmacMatches(secret, payload, signature) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature.toLowerCase(), 'hex'));
}

// Checkout success handler: HMAC-SHA256("<order_id>|<payment_id>", key secret), hex.
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId) return false;
  return hmacMatches(config.razorpay.keySecret, `${orderId}|${paymentId}`, signature);
}

// Webhook: HMAC-SHA256(raw body bytes exactly as received, webhook secret). Never re-serialise JSON.
export function verifyWebhookSignature(rawBody, signature) {
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') return false;
  return hmacMatches(config.razorpay.webhookSecret, rawBody, signature);
}

// ---------- UPI ----------

export const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;

// Format check always; with keys, also ask Razorpay. That endpoint is not enabled on every account
// (and often not in test mode), so if it errors we fall back to the format result instead of
// blocking the buyer. Returns { valid, vpa, name?, checked: 'format' | 'razorpay', reason? }.
export async function validateVpa(input) {
  const vpa = String(input || '').trim();
  if (!VPA_RE.test(vpa)) return { valid: false, vpa, checked: 'format', reason: 'That does not look like a UPI ID (for example name@okhdfcbank).' };
  if (!hasKeys()) return { valid: true, vpa, checked: 'format' };
  try {
    const d = await call('POST', '/payments/validate/vpa', { body: { vpa }, timeoutMs: 6000, retries: 1 });
    if (d.success === false) return { valid: false, vpa, checked: 'razorpay', reason: 'This UPI ID does not exist. Check it in your UPI app.' };
    return { valid: true, vpa, name: d.customer_name || undefined, checked: 'razorpay' };
  } catch {
    return { valid: true, vpa, checked: 'format' };
  }
}

// S2S UPI payment against an existing Razorpay order. Needs S2S (JSON API) enabled on the account.
// Razorpay wants the buyer's email, contact, IP, user agent and referer.
async function createUpiPayment(flow, { orderId, amount, currency = config.currency, vpa, email, contact, description, notes, ip, userAgent, referer, expiryMinutes = 10 }) {
  if (!orderId) throw new RazorpayError('A Razorpay order id is required', { code: 'NO_ORDER' });
  const upi = { flow };
  if (flow === 'collect') {
    if (!VPA_RE.test(String(vpa || ''))) throw new RazorpayError('Invalid UPI ID', { status: 400, code: 'BAD_VPA', field: 'vpa' });
    upi.vpa = vpa;
    upi.expiry_time = Math.max(5, Math.min(30, expiryMinutes));
  }
  const d = await call('POST', '/payments/create/upi', {
    unsafe: true,
    body: {
      amount: paise(amount), currency, order_id: orderId, method: 'upi',
      email: email || 'void@razorpay.com', contact: String(contact || '').replace(/[^\d+]/g, '') || undefined,
      description: String(description || '').slice(0, 255) || undefined,
      notes: cleanNotes(notes), ip: ip || undefined, user_agent: userAgent || undefined, referer: referer || undefined,
      upi,
    },
  });
  const link = d.link || (d.next || []).find((n) => n.action === 'intent')?.url || '';
  return { paymentId: d.razorpay_payment_id || d.id || '', link, raw: d };
}
// Collect: Razorpay sends a payment request to the buyer's UPI app. NPCI phased collect out for most
// merchant categories from 28 Feb 2026, so expect a 4xx on many accounts; prefer intent or QR.
export const createUpiCollect = (opts) => createUpiPayment('collect', opts);
// Intent: returns a upi://pay link that opens GPay / PhonePe / Paytm / BHIM on the buyer's phone.
export const createUpiIntent = (opts) => createUpiPayment('intent', opts);

// Dynamic single-use QR for an exact amount. Payments on it arrive as a `qr_code.credited` webhook
// (not tied to a Razorpay order), so pass our order id in notes to match it back.
export function createUpiQr({ amount, name, description, notes, closeInMinutes = 20 }) {
  return call('POST', '/payments/qr_codes', {
    body: {
      type: 'upi_qr', usage: 'single_use', fixed_amount: true, payment_amount: paise(amount),
      name: String(name || config.business).slice(0, 60), description: String(description || '').slice(0, 255),
      close_by: Math.floor(Date.now() / 1000) + Math.max(3, closeInMinutes) * 60, notes: cleanNotes(notes),
    },
  });
}
export const fetchUpiQr = (id) => call('GET', `/payments/qr_codes/${encodeURIComponent(id)}`);
export const closeUpiQr =(id) => call('POST', `/payments/qr_codes/${encodeURIComponent(id)}/close`);

// ---------- methods, payments, refunds ----------

// Net-banking banks enabled on the account: [{ code: 'HDFC', name: 'HDFC Bank' }, ...]. Cached 1 hour.
let banksCache = { at: 0, list: null };
export async function listBanks() {
  if (banksCache.list && Date.now() - banksCache.at < 3600_000) return banksCache.list;
  const d = await call('GET', '/methods', { timeoutMs: 8000 });
  const list = Object.entries(d.netbanking || {}).map(([code, name]) => ({ code, name: String(name) })).sort((a, b) => a.name.localeCompare(b.name));
  banksCache = { at: Date.now(), list };
  return list;
}

export const fetchPayment = (id) => call('GET', `/payments/${encodeURIComponent(id)}`);

// Refund a captured payment. No amount = full refund of what is left. The idempotency key makes a
// repeated call (retry, double click) return the same refund instead of refunding twice.
export function refund(paymentId, { amount, notes, receipt, speed = 'normal', idempotencyKey } = {}) {
  const key = String(idempotencyKey || `rf_${paymentId}`).slice(0, 64);
  return call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {
    headers: { 'x-refund-idempotency': key.padEnd(10, '_') },
    body: { ...(amount ? { amount: paise(amount) } : {}), speed: speed === 'optimum' ? 'optimum' : 'normal', notes: cleanNotes(notes), ...(receipt ? { receipt: String(receipt).slice(0, 40) } : {}) },
  });
}
