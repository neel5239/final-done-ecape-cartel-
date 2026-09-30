// Owner dashboard API: login, sales numbers, orders with their payment, status changes, CSV export.
// One owner login from ADMIN_EMAIL / ADMIN_PASSWORD. Sessions are signed cookies (HttpOnly,
// SameSite=Strict, Secure on https); every change also needs the x-admin header, so another site
// can't submit a form on the owner's behalf.
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, setStatus, TXN_STATUSES } from './db.js';
import { HttpError, parseCookies, safeEqual, isHttps, rateLimit, clientIp } from './http.js';
import { paymentOverview } from './payments/index.js';

const COOKIE = 'owner_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
// Compare password hashes, not the passwords, so the check takes the same time whatever is typed.
const SALT = crypto.randomBytes(16);
const hash = (s) => crypto.scryptSync(String(s), SALT, 32).toString('hex');
const ADMIN_HASH = config.admin.password ? hash(config.admin.password) : '';

export const adminEnabled = () => !!(config.admin.email && config.admin.password && config.admin.password.length >= 10);

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  if (!safeEqual(expected, mac)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function login(req, res, { email, password }) {
  rateLimit(`login:${clientIp(req)}`, 8, 15 * 60 * 1000);
  if (!adminEnabled()) throw new HttpError(503, 'The owner login is not set up yet (ADMIN_EMAIL and ADMIN_PASSWORD, at least 10 characters).');
  const okEmail = safeEqual(String(email || '').trim().toLowerCase(), config.admin.email);
  const okPass = safeEqual(hash(password || ''), ADMIN_HASH);
  if (!okEmail || !okPass) throw new HttpError(401, 'Wrong email or password.');
  const token = sign({ sub: config.admin.email, exp: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${isHttps(req) ? '; Secure' : ''}`);
}

export function logout(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`);
}

export function requireOwner(req, { mutating = false } = {}) {
  if (!verify(parseCookies(req)[COOKIE])) throw new HttpError(401, 'Please log in.');
  if (mutating && req.headers['x-admin'] !== '1') throw new HttpError(403, 'Blocked (missing x-admin header).');
}

const DAY = 86400000;

// The payment that matters for an order: a refunded or successful one wins over later retries,
// otherwise the newest attempt. No attempt yet counts as 'created'. Used by the list, filter and stats.
const PAY_RANK = `CASE p.status WHEN 'refunded' THEN 0 WHEN 'success' THEN 1 ELSE 2 END, p.created_at DESC, p.rowid DESC`;
const PAY_STATUS = `COALESCE((SELECT p.status FROM payments p WHERE p.order_id = orders.id ORDER BY ${PAY_RANK} LIMIT 1), 'created')`;

function paymentsFor(orderIds) {
  const out = {};
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500);
    const rows = db.prepare(`SELECT * FROM payments p WHERE p.order_id IN (${chunk.map(() => '?').join(',')}) ORDER BY p.order_id, ${PAY_RANK}`).all(...chunk);
    for (const r of rows) {
      const cur = out[r.order_id];
      if (cur) { cur.attempts += 1; continue; }
      out[r.order_id] = {
        id: r.id, status: r.status, mode: r.mode, method: r.method, amount: r.amount, razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id,
        razorpayQrId: r.razorpay_qr_id, refundId: r.refund_id, refundStatus: r.refund_status, refundedAmount: r.refunded_amount, error: r.error, updatedAt: r.updated_at, attempts: 1,
      };
    }
  }
  return out;
}
export function stats() {
  const now = Date.now();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const sum = (since) => db.prepare("SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS n FROM orders WHERE status = 'paid' AND paid_at >= ?").get(since);
  const byStatus = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const from = start.getTime() - i * DAY;
    const r = db.prepare("SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS n FROM orders WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?").get(from, from + DAY);
    const d = new Date(from);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ day, revenue: r.s, orders: r.n });
  }
  const top = db.prepare("SELECT items FROM orders WHERE status = 'paid' AND paid_at >= ?").all(now - 30 * DAY);
  const counts = new Map();
  for (const o of top) for (const it of JSON.parse(o.items)) counts.set(it.name, (counts.get(it.name) || 0) + it.qty);
  return {
    today: sum(start.getTime()), week: sum(now - 7 * DAY), month: sum(now - 30 * DAY), all: sum(0),
    byStatus, days, topItems: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
    byPayment: Object.fromEntries(db.prepare(`SELECT ${PAY_STATUS} AS ps, COUNT(*) AS n FROM orders GROUP BY ps`).all().map((r) => [r.ps, r.n])),
    payments: paymentOverview(),
    currency: config.currency, business: config.business,
  };
}

export function listOrders({ status = '', pay = '', q = '', limit = 100 } = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (TXN_STATUSES.includes(pay)) { where.push(`${PAY_STATUS} = ?`); args.push(pay); }
  if (q) {
    where.push('(id LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR customer_email LIKE ? OR payment_ref LIKE ? OR id IN (SELECT order_id FROM payments WHERE razorpay_payment_id LIKE ? OR razorpay_order_id LIKE ? OR refund_id LIKE ?))');
    const like = `%${String(q).slice(0, 100)}%`;
    args.push(like, like, like, like, like, like, like, like);
  }
  const rows = db.prepare(`SELECT * FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`).all(...args, Math.min(500, Number(limit) || 100));
  const pays = paymentsFor(rows.map((o) => o.id));
  return rows.map(({ token, ...o }) => ({ ...o, items: JSON.parse(o.items), payment: pays[o.id] || null }));
}

export function changeStatus(id, status) {
  if (!['paid', 'cancelled', 'refunded', 'pending'].includes(status)) throw new HttpError(400, 'Unknown status');
  if (!setStatus(id, status, { by: 'owner' })) throw new HttpError(409, 'That status change is not allowed for this order.');
}

export function ordersCsv() {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = listOrders({ limit: 500 });
  const head = ['Order', 'Created', 'Status', 'Amount', 'Customer', 'Phone', 'Email', 'Booking date', 'Items', 'Payment mode', 'Payment ref', 'Paid at',
    'Payment status', 'Method', 'Payment id', 'Gateway order id', 'Refund id', 'Refund status'];
  const lines = rows.map((o) => [o.id, new Date(o.created_at).toISOString(), o.status, (o.amount / 100).toFixed(2), o.customer_name, o.customer_phone, o.customer_email, o.booking_date,
    o.items.map((i) => `${i.name} x${i.qty}`).join('; '), o.payment_mode, o.payment_ref, o.paid_at ? new Date(o.paid_at).toISOString() : '',
    o.payment?.status || 'created', o.payment?.method, o.payment?.razorpayPaymentId, o.payment?.razorpayOrderId, o.payment?.refundId, o.payment?.refundStatus].map(cell).join(','));
  return [head.map(cell).join(','), ...lines].join('\r\n');
}
