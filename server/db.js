// Database: SQLite built into Node (no install, one file). On Railway, mount a volume and set
// DATA_DIR to it so orders survive redeploys. Money is always whole paise (integers), never floats.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config, ROOT } from './config.js';

// The group trips the site lists (site/js/data.js). Their per-person price is synced into the items
// table below, so the server prices a group booking itself: price x number of named travellers.
let GROUP_TRIPS = [];
try { ({ GROUP_TRIPS } = await import(pathToFileURL(path.join(ROOT, 'site', 'js', 'data.js')).href)); } catch (e) { console.warn(`group trips: ${e.message}`); }

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'store.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'product',       -- product | booking
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL,                      -- paise
    image TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    max_qty INTEGER NOT NULL DEFAULT 10,
    meta TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,                         -- lets the buyer's browser see its own order
    items TEXT NOT NULL,                         -- JSON snapshot: [{id,name,price,qty}]
    amount INTEGER NOT NULL,                     -- paise, computed by the server
    currency TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    booking_date TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',      -- pending | verifying | paid | failed | cancelled | refunded
    payment_mode TEXT NOT NULL,                  -- demo | upi | razorpay
    payment_ref TEXT NOT NULL DEFAULT '',        -- gateway order/payment id or the buyer's UPI reference
    created_at INTEGER NOT NULL,
    paid_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);
  CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    type TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL
  );
  -- One row per payment attempt path for an order (one per Razorpay order / QR / demo or UPI try).
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,                         -- txn_...
    order_id TEXT NOT NULL REFERENCES orders(id),
    mode TEXT NOT NULL,                          -- demo | upi | razorpay
    method TEXT NOT NULL DEFAULT '',             -- upi | card | netbanking | wallet | emi | ...
    razorpay_order_id TEXT NOT NULL DEFAULT '',
    razorpay_payment_id TEXT NOT NULL DEFAULT '',
    razorpay_qr_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'created',      -- created | pending | success | failed | refunded
    amount INTEGER NOT NULL,                     -- paise
    currency TEXT NOT NULL DEFAULT 'INR',
    refund_id TEXT NOT NULL DEFAULT '',
    refund_status TEXT NOT NULL DEFAULT '',      -- '' | pending | processed | failed | manual
    refunded_amount INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',              -- last failure reason shown to the owner
    event_ids TEXT NOT NULL DEFAULT '[]',        -- JSON: webhook event ids applied to this row
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id, created_at);
  CREATE INDEX IF NOT EXISTS payments_rzp_order ON payments(razorpay_order_id);
  CREATE INDEX IF NOT EXISTS payments_rzp_payment ON payments(razorpay_payment_id);
  CREATE INDEX IF NOT EXISTS payments_status ON payments(status);
  -- Webhook idempotency: a delivery whose event id is here was already applied.
  CREATE TABLE IF NOT EXISTS processed_events (
    id TEXT PRIMARY KEY,                         -- x-razorpay-event-id (or a hash of the body)
    source TEXT NOT NULL DEFAULT 'razorpay',
    type TEXT NOT NULL DEFAULT '',
    order_id TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    received_at INTEGER NOT NULL
  );
`);
// Owner-made trips (dashboard > Trips): the trip is one JSON document in the GROUP TRIP SCHEMA of
// site/js/data.js. Published ones are listed on the site and bookable (synced into items below).
// Visits: anonymous page views for the dashboard (visitor = daily hash of IP + browser, no cookies).
db.exec(`
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    day TEXT NOT NULL,                           -- YYYY-MM-DD in the business time zone
    visitor TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'view',           -- view | whatsapp | call | join
    path TEXT NOT NULL DEFAULT '',
    trip TEXT NOT NULL DEFAULT '',
    ref TEXT NOT NULL DEFAULT '',                -- referring site or utm_source
    device TEXT NOT NULL DEFAULT ''              -- mobile | tablet | desktop
  );
  CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
  CREATE INDEX IF NOT EXISTS visits_trip ON visits(trip, at);
`);
db.prepare('DELETE FROM visits WHERE at < ?').run(Date.now() - 400 * 86400_000);

export { GROUP_TRIPS };

// Group bookings: one row per named traveller, JSON [{ name, phone, email?, college?, lead? }].
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'travellers')) {
  db.exec(`ALTER TABLE orders ADD COLUMN travellers TEXT NOT NULL DEFAULT '[]'`);
}

// ---------- travellers (group bookings) ----------
// Traveller 1 is the lead booker (primary contact): name, WhatsApp mobile and email required,
// college / hostel optional. Everyone else: name and WhatsApp mobile. Each traveller is one seat.
export const MAX_TRAVELLERS = 6;
const MOBILE = /^[6-9]\d{9}$/;
const MAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** 10-digit Indian mobile (a +91 / 0 prefix is dropped), or '' when it is not one. */
export function indianMobile(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return MOBILE.test(d) ? d : '';
}

/** Returns { ok: true, travellers } or { ok: false, error, index, field } with a message for the buyer. */
export function cleanTravellers(list, { max = MAX_TRAVELLERS } = {}) {
  if (!Array.isArray(list) || !list.length) return { ok: false, error: 'Add the details of each traveller.', index: 0, field: 'name' };
  if (list.length > max) return { ok: false, error: `You can book up to ${max} travellers at a time.`, index: max, field: 'count' };
  const out = [];
  const seen = new Set();
  for (const [i, t] of list.entries()) {
    const who = i === 0 ? 'traveller 1 (primary contact)' : `traveller ${i + 1}`;
    const bad = (field, error) => ({ ok: false, error, index: i, field });
    if (!t || typeof t !== 'object' || Array.isArray(t)) return bad('name', `Add the details of ${who}.`);
    const name = text(t.name, 60);
    if (name.length < 2 || !/\p{L}/u.test(name)) return bad('name', `Enter the full name of ${who}, as on their ID.`);
    const phone = indianMobile(t.phone);
    if (!phone) return bad('phone', `Enter a 10-digit Indian mobile number for ${who}.`);
    if (seen.has(phone)) return bad('phone', `Traveller ${i + 1} has the same mobile number as another traveller. Each traveller needs their own number.`);
    seen.add(phone);
    const row = { name, phone };
    if (i === 0) {
      const email = text(t.email, 200);
      if (!MAIL.test(email)) return bad('email', 'Enter a valid email for traveller 1 (primary contact).');
      row.email = email;
      const college = text(t.college, 80);
      if (college) row.college = college;
      row.lead = true;
    }
    out.push(row);
  }
  return { ok: true, travellers: out };
}

export function travellersOf(order) {
  try { const t = JSON.parse(order?.travellers || '[]'); return Array.isArray(t) ? t : []; } catch { return []; }
}

// data/catalog.json is the source of truth for what is sold and its price; it is synced into the
// database on every start (items removed from the file are hidden, never deleted, so old orders
// keep their history).
export function syncCatalog() {
  const file = path.join(ROOT, 'data', 'catalog.json');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.warn(`catalog: ${e.message}`); return 0; }
  if (!Array.isArray(list)) list = list.items || [];
  const up = db.prepare(`INSERT INTO items (id, kind, name, description, price, image, category, active, max_qty, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, description=excluded.description, price=excluded.price,
      image=excluded.image, category=excluded.category, active=1, max_qty=excluded.max_qty, meta=excluded.meta`);
  const ids = [];
  for (const it of list) {
    const id = String(it.id || '').trim();
    const price = Math.round(Number(it.price) * 100); // catalog prices are in rupees
    if (!/^[\w-]{1,64}$/.test(id) || !it.name || !Number.isFinite(price) || price < 100) { console.warn(`catalog: skipped item ${JSON.stringify(it.id)} (needs id, name, price >= 1)`); continue; }
    up.run(id, it.kind === 'booking' ? 'booking' : 'product', String(it.name).slice(0, 160), String(it.description || '').slice(0, 2000), price,
      String(it.image || '').slice(0, 500), String(it.category || '').slice(0, 80), Math.max(1, Math.min(100, Number(it.maxQty) || 10)), JSON.stringify(it.meta || {}));
    ids.push(id);
  }
  // Group trips from site/js/data.js (a catalog.json entry with the same id wins). Up to
  // MAX_TRAVELLERS seats per booking; the trip's own date is the booking date.
  for (const t of GROUP_TRIPS) {
    const id = String(t?.id || '');
    const price = Math.round(Number(t?.price ?? t?.budgetPerPerson) * 100);
    if (!/^[\w-]{1,64}$/.test(id) || ids.includes(id) || !t.title || !Number.isFinite(price) || price < 100) continue;
    up.run(id, 'booking', String(t.title).slice(0, 160), String(t.summary || t.blurb || '').slice(0, 2000), price, String(t.image || '').slice(0, 500),
      'Group trips', MAX_TRAVELLERS, JSON.stringify({ groupTrip: true, date: t.date || '', destination: t.destination || '', seatsTotal: t.seatsTotal || 0 }));
    ids.push(id);
  }
  // Trips the owner published from the dashboard.
  for (const row of db.prepare('SELECT data FROM trips WHERE published = 1').all()) {
    let t;
    try { t = JSON.parse(row.data); } catch { continue; }
    if (upsertTripItem(t)) ids.push(t.id);
  }
  if (ids.length) db.prepare(`UPDATE items SET active = 0 WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
  return ids.length;
}

/** Makes an owner trip bookable: price per person x named travellers, like the seed group trips. */
export function upsertTripItem(t) {
  const id = String(t?.id || '');
  const price = Math.round(Number(t?.price) * 100);
  if (!/^[\w-]{1,64}$/.test(id) || !t.title || !Number.isFinite(price) || price < 100) return false;
  db.prepare(`INSERT INTO items (id, kind, name, description, price, image, category, active, max_qty, meta)
    VALUES (?, 'booking', ?, ?, ?, ?, 'Group trips', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET kind='booking', name=excluded.name, description=excluded.description, price=excluded.price,
      image=excluded.image, category='Group trips', active=1, max_qty=excluded.max_qty, meta=excluded.meta`)
    .run(id, String(t.title).slice(0, 160), String(t.summary || '').slice(0, 2000), price, String(t.coverImage || '').slice(0, 500), MAX_TRAVELLERS,
      JSON.stringify({ groupTrip: true, date: (t.dates || [])[0] || '', destination: t.destination || '', seatsTotal: t.seats || 0, ownerTrip: true }));
  return true;
}
export const deactivateItem = (id) => db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(String(id));

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

export function logEvent(orderId, type, detail = '') {
  db.prepare('INSERT INTO events (order_id, type, detail, at) VALUES (?, ?, ?, ?)').run(orderId, type, String(detail).slice(0, 1000), Date.now());
}

// Move an order to a new status. Paid is final unless the owner refunds it; returns false if the
// change is not allowed (e.g. a late "failed" callback after it was already paid).
const ALLOWED = {
  pending: ['verifying', 'paid', 'failed', 'cancelled'],
  verifying: ['paid', 'failed', 'cancelled', 'pending'],
  failed: ['pending', 'paid', 'cancelled'],
  paid: ['refunded'],
  cancelled: ['pending'],
  refunded: [],
};
// skipTxn: the caller already moved the exact transaction itself (payments/index.js does).
export function setStatus(orderId, status, { ref, by, skipTxn = false } = {}) {
  const o = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
  if (!o) return false;
  if (o.status === status) return true;
  if (!ALLOWED[o.status]?.includes(status)) return false;
  db.prepare(`UPDATE orders SET status = ?, payment_ref = COALESCE(NULLIF(?, ''), payment_ref), paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END WHERE id = ?`)
    .run(status, ref || '', status, Date.now(), orderId);
  logEvent(orderId, status, by || '');
  if (!skipTxn) mirrorToTransaction(orderId, status, by);
  return true;
}

// ---------- payment transactions ----------
// The order status above is what the buyer and the owner act on; a transaction row is the gateway's
// view of one payment path (method, Razorpay ids, failure reason, refund). Both have a state machine.
// success can only become refunded, refunded is final, so a late "failed" webhook can never undo a
// success and a retried webhook can never undo a refund.
export const TXN_STATUSES = ['created', 'pending', 'success', 'failed', 'refunded'];
const TXN_ALLOWED = {
  created: ['pending', 'success', 'failed'],
  pending: ['success', 'failed'],
  failed: ['pending', 'success'],   // Razorpay lets the buyer retry the same order after a failure
  success: ['refunded'],
  refunded: [],
};
export const canMoveTransaction = (from, to) => from === to || !!TXN_ALLOWED[from]?.includes(to);

function toTxn(r) {
  if (!r) return null;
  let eventIds = [];
  try { eventIds = JSON.parse(r.event_ids); } catch { /* keep [] */ }
  return {
    id: r.id, orderId: r.order_id, mode: r.mode, method: r.method, status: r.status, amount: r.amount, currency: r.currency,
    razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id, razorpayQrId: r.razorpay_qr_id,
    refundId: r.refund_id, refundStatus: r.refund_status, refundedAmount: r.refunded_amount,
    error: r.error, eventIds, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function createTransaction({ orderId, mode, method = '', amount, currency = config.currency, razorpayOrderId = '', razorpayQrId = '' }) {
  const id = newId('txn');
  const now = Date.now();
  db.prepare(`INSERT INTO payments (id, order_id, mode, method, razorpay_order_id, razorpay_qr_id, status, amount, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)`).run(id, orderId, mode, method, razorpayOrderId, razorpayQrId, amount, currency, now, now);
  logEvent(orderId, 'txn_created', `${id} ${mode}${razorpayOrderId ? ` ${razorpayOrderId}` : ''}${razorpayQrId ? ` ${razorpayQrId}` : ''}`);
  return getTransaction(id);
}

export const getTransaction = (id) => toTxn(db.prepare('SELECT * FROM payments WHERE id = ?').get(id));
export const transactionsForOrder = (orderId) => db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC, rowid DESC').all(orderId).map(toTxn);
export const latestTransaction = (orderId) => toTxn(db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(orderId));

// The newest transaction in this mode that can still be paid (reused instead of opening another).
export function openTransaction(orderId, mode) {
  return toTxn(db.prepare(`SELECT * FROM payments WHERE order_id = ? AND mode = ? AND status IN ('created', 'pending', 'failed')
    ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(orderId, mode));
}

// Match a gateway id back to our row (payment id first: it is the most specific).
export function findTransaction({ razorpayPaymentId, razorpayOrderId, razorpayQrId } = {}) {
  const q = (col, v) => v && db.prepare(`SELECT * FROM payments WHERE ${col} = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(v);
  return toTxn(q('razorpay_payment_id', razorpayPaymentId) || q('razorpay_order_id', razorpayOrderId) || q('razorpay_qr_id', razorpayQrId));
}

// For the owner dashboard: { [orderId]: newest transaction } for a page of orders.
export function latestTransactionsFor(orderIds = []) {
  const out = {};
  const ids = [...new Set(orderIds)].filter(Boolean);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db.prepare(`SELECT * FROM payments WHERE order_id IN (${chunk.map(() => '?').join(',')}) ORDER BY created_at ASC, rowid ASC`).all(...chunk);
    for (const r of rows) out[r.order_id] = toTxn(r);
  }
  return out;
}

export function listTransactions({ status, limit = 50, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const rows = TXN_STATUSES.includes(status)
    ? db.prepare('SELECT * FROM payments WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, lim, off)
    : db.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT ? OFFSET ?').all(lim, off);
  return rows.map(toTxn);
}

// What the buyer's own order page may see about its payment (no gateway internals beyond ids).
export function publicTransaction(t) {
  if (!t) return null;
  return { id: t.id, status: t.status, method: t.method, mode: t.mode, paymentId: t.razorpayPaymentId, refundStatus: t.refundStatus, error: t.status === 'failed' ? t.error : '' };
}

// Move a transaction through the state machine. Returns true when it ends in `status` (applied now,
// or already there), false when the move is not allowed; a refused move changes nothing.
// On a move to failed/pending the newest attempt's payment id wins; on success the paying id wins
// and is then kept. Refund fields can always be updated (their own lifecycle).
export function setTransactionStatus(id, status, { paymentId, method, error, eventId, refundId, refundStatus, refundedAmount, by } = {}) {
  if (!TXN_STATUSES.includes(status)) throw new Error(`Unknown transaction status ${status}`);
  const r = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!r) return false;
  if (!canMoveTransaction(r.status, status)) {
    logEvent(r.order_id, 'txn_ignored', `${id} ${r.status} -> ${status} refused${by ? ` (${by})` : ''}`);
    return false;
  }
  const moving = r.status !== status;
  const ids = (() => { try { return JSON.parse(r.event_ids); } catch { return []; } })();
  if (eventId && !ids.includes(eventId)) ids.push(String(eventId).slice(0, 100));
  const pid = paymentId && (moving || !r.razorpay_payment_id || status !== 'success') ? String(paymentId) : r.razorpay_payment_id;
  const newMethod = method && (moving || !r.method || pid !== r.razorpay_payment_id) ? String(method).slice(0, 30) : r.method;
  const newError = status === 'failed' ? String(error ?? r.error).slice(0, 500) : (moving && status === 'success' ? '' : r.error);
  db.prepare(`UPDATE payments SET status = ?, razorpay_payment_id = ?, method = ?, error = ?, event_ids = ?,
      refund_id = COALESCE(NULLIF(?, ''), refund_id), refund_status = COALESCE(NULLIF(?, ''), refund_status),
      refunded_amount = CASE WHEN ? >= 0 THEN ? ELSE refunded_amount END, updated_at = ? WHERE id = ?`)
    .run(status, pid, newMethod, newError, JSON.stringify(ids.slice(-20)), refundId || '', refundStatus || '',
      refundedAmount ?? -1, refundedAmount ?? -1, Date.now(), id);
  if (moving) logEvent(r.order_id, `txn_${status}`, `${id}${pid ? ` ${pid}` : ''}${by ? ` (${by})` : ''}`);
  return true;
}

// Fill in details learned later (e.g. the method after fetching the payment); never changes status.
export function setTransactionDetails(id, { method, paymentId } = {}) {
  db.prepare(`UPDATE payments SET method = CASE WHEN method = '' THEN ? ELSE method END,
      razorpay_payment_id = CASE WHEN razorpay_payment_id = '' THEN ? ELSE razorpay_payment_id END, updated_at = ? WHERE id = ?`)
    .run(String(method || '').slice(0, 30), String(paymentId || ''), Date.now(), id);
}

// Keep the transaction in step when the order status is changed elsewhere (owner in /admin, older
// code paths). A Razorpay payment is never marked refunded here: that needs a real refund call.
const ORDER_TO_TXN = { paid: 'success', failed: 'failed', verifying: 'pending', refunded: 'refunded' };
function mirrorToTransaction(orderId, orderStatus, by) {
  const to = ORDER_TO_TXN[orderStatus];
  if (!to) return;
  const t = to === 'refunded'
    ? toTxn(db.prepare(`SELECT * FROM payments WHERE order_id = ? AND status = 'success' ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(orderId))
    : latestTransaction(orderId);
  if (!t || t.status === to) return;
  if (to === 'refunded' && t.mode === 'razorpay') { logEvent(orderId, 'refund_note', 'Order marked refunded; the Razorpay payment itself is refunded only with the Refund action.'); return; }
  setTransactionStatus(t.id, to, { by: by || 'order status', ...(to === 'refunded' ? { refundStatus: 'manual', refundedAmount: t.amount } : {}) });
}

// ---------- webhook idempotency ----------
// Run fn (synchronous) exactly once per event id. The event is recorded in the same SQLite savepoint
// as fn's writes, so a crash half-way leaves neither and Razorpay's retry is processed normally.
// fn may return a string outcome or { outcome, orderId }.
export function runOnce(eventId, { source = 'razorpay', type = '', orderId = '' } = {}, fn) {
  const id = String(eventId || '').slice(0, 120);
  if (!id) throw new Error('runOnce needs an event id');
  db.exec('SAVEPOINT once');
  try {
    const ins = db.prepare('INSERT OR IGNORE INTO processed_events (id, source, type, order_id, received_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, source, String(type).slice(0, 60), orderId, Date.now());
    if (!ins.changes) { db.exec('RELEASE once'); return { duplicate: true }; }
    const res = fn();
    if (res && typeof res.then === 'function') throw new Error('runOnce handlers must be synchronous');
    const outcome = typeof res === 'string' ? res : res?.outcome || 'processed';
    db.prepare(`UPDATE processed_events SET outcome = ?, order_id = COALESCE(NULLIF(?, ''), order_id) WHERE id = ?`).run(String(outcome).slice(0, 200), res?.orderId || '', id);
    db.exec('RELEASE once');
    return { duplicate: false, outcome };
  } catch (e) {
    db.exec('ROLLBACK TO once');
    db.exec('RELEASE once');
    throw e;
  }
}
export const eventProcessed = (eventId) => !!db.prepare('SELECT 1 FROM processed_events WHERE id = ?').get(String(eventId || ''));
// Razorpay retries for 24 hours; keep 60 days of ids, then forget them.
db.prepare('DELETE FROM processed_events WHERE received_at < ?').run(Date.now() - 60 * 86400_000);
