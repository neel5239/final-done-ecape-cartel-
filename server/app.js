// The website's server: serves the pages in site/ with clean URLs (/catalog, /booking, /admin),
// plus the API for orders, payments and the owner dashboard. No npm packages needed (Node 22.13+).
//
//   Start:   npm start          (PORT, DATA_DIR, PAYMENT_MODE, ADMIN_EMAIL, ADMIN_PASSWORD ... see .env.example)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT, paymentProblems } from './config.js';
import { db, syncCatalog, newId, logEvent, findTransaction, cleanTravellers, travellersOf } from './db.js';
import { HttpError, sendJson, sendError, readJson, readRaw, rateLimit, clientIp, securityHeaders, isHttps } from './http.js';
import {
  publicPaymentConfig, startPayment, demoResult, upiClaim, razorpayVerify, razorpayFailed, razorpayWebhook, effectiveMode,
  checkVpa, startUpi, paymentStatus, syncPaymentStatus, netbankingBanks, refundPayment,
} from './payments/index.js';
import * as admin from './admin.js';
import * as trips from './trips.js';

const SITE = path.join(ROOT, 'site');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

// ---------- orders ----------
const PHONE = /^\+?[0-9][0-9 -]{7,15}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// Group trip: one seat per named traveller (max MAX_TRAVELLERS), traveller 1 is the lead booker.
function groupTravellers(body) {
  if (body.travellers == null) return [];
  const t = cleanTravellers(body.travellers);
  if (!t.ok) throw new HttpError(400, t.error, 'bad_travellers');
  return t.travellers;
}
const itemMeta = (it) => { try { return JSON.parse(it.meta) || {}; } catch { return {}; } };

function createOrder(body) {
  const lines = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  if (!lines.length) throw new HttpError(400, 'Your cart is empty.');
  let travellers = groupTravellers(body);
  const lead = travellers[0];
  // The lead traveller is the customer the owner and Razorpay see.
  const name = lead ? lead.name : clean(body.customer?.name, 80);
  const phone = lead ? lead.phone : clean(body.customer?.phone, 20);
  const email = lead ? lead.email : clean(body.customer?.email, 200);
  if (name.length < 2) throw new HttpError(400, 'Please enter your name.');
  if (!PHONE.test(phone) && !EMAIL.test(email)) throw new HttpError(400, 'Please enter a valid phone number or email so we can reach you.');
  if (email && !EMAIL.test(email)) throw new HttpError(400, 'That email address does not look right.');
  if (phone && !PHONE.test(phone)) throw new HttpError(400, 'That phone number does not look right.');
  let date = clean(body.date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Pick a valid date.');
  // Prices always come from the database, never from the browser.
  const items = [];
  let amount = 0;
  let group = false;
  const get = db.prepare('SELECT * FROM items WHERE id = ? AND active = 1');
  for (const l of lines) {
    const it = get.get(String(l.id || ''));
    if (!it) throw new HttpError(400, 'Something in your cart is no longer available. Please refresh the page.');
    let qty = Math.floor(Number(l.qty) || 1);
    const meta = itemMeta(it);
    if (meta.groupTrip) {
      // Seats = named travellers; the browser's qty and amount are ignored.
      if (lines.length > 1) throw new HttpError(400, 'Book one group trip at a time.');
      if (!travellers.length) throw new HttpError(400, `Add the name and mobile number of each traveller for ${it.name}.`, 'bad_travellers');
      qty = travellers.length;
      group = true;
      if (/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) date = meta.date;
    }
    if (qty < 1 || qty > it.max_qty) throw new HttpError(400, `You can book 1 to ${it.max_qty} of ${it.name}.`);
    if (it.kind === 'booking' && !date) throw new HttpError(400, `Pick a date for ${it.name}.`);
    items.push({ id: it.id, name: it.name, price: it.price, qty, kind: it.kind });
    amount += it.price * qty;
  }
  if (date) {
    const d = new Date(`${date}T00:00:00`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (Number.isNaN(d.getTime()) || d < today) throw new HttpError(400, 'Pick a date from today onwards.');
  }
  if (!group) travellers = [];
  const order = { id: newId('ord'), token: newId('t'), amount };
  db.prepare(`INSERT INTO orders (id, token, items, amount, currency, customer_name, customer_phone, customer_email, booking_date, notes, travellers, status, payment_mode, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(order.id, order.token, JSON.stringify(items), amount, config.currency, name, phone, email, date, clean(body.notes, 1000), JSON.stringify(travellers), effectiveMode(), Date.now());
  logEvent(order.id, 'created', `${items.length} line(s), ${amount} paise${travellers.length ? `, ${travellers.length} traveller(s): ${travellers.map((t) => t.name).join(', ')}` : ''}`);
  return order;
}

// The buyer's browser proves it owns an order with the token it got when creating it.
function ownOrder(id, token) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(id || ''));
  if (!o || !token || o.token !== String(token)) throw new HttpError(404, 'Order not found.');
  return o;
}
const publicOrder = (o) => ({
  id: o.id, status: o.status, amount: o.amount, currency: o.currency, items: JSON.parse(o.items), customer: o.customer_name,
  date: o.booking_date, paymentMode: o.payment_mode, reference: o.status === 'paid' ? o.payment_ref : '', createdAt: o.created_at, paidAt: o.paid_at,
  travellers: travellersOf(o),
});

function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// ---------- payment API helpers (/api/pay/*) ----------
const PAYABLE = ['pending', 'failed', 'verifying'];
const MIN10 = 10 * 60 * 1000;

// Idempotency-Key on POST /api/pay/order: the same key + same cart returns the same order, even
// after a restart (stored in SQLite, kept 24 hours). The same key with a different cart is refused.
db.exec(`CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  order_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`);
db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(Date.now() - 86400_000);

function idempotencyKey(req) {
  const k = String(req.headers['idempotency-key'] || '').trim();
  if (!k) return '';
  if (!/^[\w.:-]{8,100}$/.test(k)) throw new HttpError(400, 'Idempotency-Key must be 8 to 100 letters, digits, dashes or underscores.', 'bad_idempotency_key');
  return k;
}
const cartHash = (b) => crypto.createHash('sha256').update(JSON.stringify([
  (Array.isArray(b.items) ? b.items : []).map((l) => [String(l?.id || ''), Math.floor(Number(l?.qty) || 1)]),
  [b.customer?.name, b.customer?.phone, b.customer?.email].map((v) => clean(v, 200)), clean(b.date, 10), clean(b.notes, 1000),
  (Array.isArray(b.travellers) ? b.travellers : []).map((t) => [t?.name, t?.phone, t?.email, t?.college].map((v) => clean(v, 200))),
])).digest('hex');

// The buyer's order for the /api/pay/* routes: { orderId | order, t } from the body or query string.
function payOrder(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new HttpError(400, 'Send payment details as a JSON object.');
  const get = (k) => (typeof src.get === 'function' ? src.get(k) : src[k]);
  return ownOrder(get('orderId') || get('order'), get('t') || get('token'));
}
const orderRow = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
const reqCtx = (req) => ({ baseUrl: baseUrl(req), ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 300), referer: String(req.headers.referer || '').slice(0, 500) });

// Status for polling: order + latest transaction, plus a simple "done yet?" flag.
function statusBody(o, s) {
  const fresh = orderRow(o.id) || o;
  return {
    // The order status is the truth (a paid order may still have an older, unused QR attempt as its newest row).
    orderId: fresh.id, status: s.status, mode: s.mode, transaction: s.transaction,
    paymentStatus: s.status === 'paid' ? 'success' : s.status === 'refunded' ? 'refunded' : s.transaction?.status || 'created',
    amount: fresh.amount, currency: fresh.currency, reference: fresh.status === 'paid' ? fresh.payment_ref : '', paidAt: fresh.paid_at,
    final: !PAYABLE.includes(s.status),
    travellers: travellersOf(fresh).map((t) => ({ name: t.name, lead: !!t.lead })),
  };
}

// Webhook (also answered on the older /api/webhooks/razorpay address). Duplicates always get 200.
async function webhook(req, res) {
  const raw = await readRaw(req, 256 * 1024);
  const r = razorpayWebhook(raw, req.headers['x-razorpay-signature'], req.headers['x-razorpay-event-id']);
  return sendJson(res, 200, { ok: true, duplicate: !!r?.duplicate });
}

async function payApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const ip = clientIp(req);
  if (p === '/api/pay/config' && m === 'GET') { rateLimit(`pay-config:${ip}`, 120, MIN10); return sendJson(res, 200, publicPaymentConfig()); }
  if (p === '/api/pay/webhook' && m === 'POST') return webhook(req, res);

  // Create (or reuse) the order on the server from catalog prices, then start its payment.
  // Body: { items, customer, date, notes } for a new order, or { orderId, t } to pay an existing one.
  // Amounts sent by the browser are ignored.
  if (p === '/api/pay/order' && m === 'POST') {
    rateLimit(`pay-order:${ip}`, 20, MIN10);
    const key = idempotencyKey(req);
    const body = await readJson(req, 32 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send booking details as a JSON object.');
    let order;
    let replay = false;
    if (body.orderId) order = payOrder(body);
    else {
      const hash = cartHash(body);
      const seen = key && db.prepare('SELECT * FROM idempotency_keys WHERE key = ?').get(key);
      if (seen) {
        if (seen.request_hash !== hash) throw new HttpError(422, 'This request was already used for a different booking. Refresh the page and try again.', 'idempotency_mismatch');
        order = orderRow(seen.order_id);
        replay = !!order;
      }
      if (!order) {
        // No await between the key check and the insert: a double click cannot create two orders.
        const o = createOrder(body);
        if (key) db.prepare('INSERT OR REPLACE INTO idempotency_keys (key, request_hash, order_id, created_at) VALUES (?, ?, ?, ?)').run(key, hash, o.id, Date.now());
        order = orderRow(o.id);
      }
    }
    const payment = PAYABLE.includes(order.status) ? await startPayment(order, baseUrl(req)) : null;
    if (replay) res.setHeader('Idempotent-Replayed', 'true');
    return sendJson(res, replay || body.orderId ? 200 : 201, {
      orderId: order.id, token: order.token, amount: order.amount, currency: order.currency, status: order.status, mode: effectiveMode(),
      payment, checkoutUrl: `/checkout/?order=${order.id}&t=${order.token}`, replayed: replay,
    });
  }

  if (p === '/api/pay/vpa/validate' && m === 'POST') {
    rateLimit(`pay-vpa:${ip}`, 20, MIN10);
    const body = await readJson(req, 2048);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Send a UPI ID as a JSON object.');
    const r = await checkVpa(body.vpa);
    return sendJson(res, 200, { valid: !!r.valid, vpa: r.vpa, name: r.name, checked: r.checked, reason: r.valid ? undefined : r.reason });
  }
  if (p === '/api/pay/upi/collect' && m === 'POST') {
    rateLimit(`pay-upi:${ip}`, 20, MIN10);
    const body = await readJson(req, 4096);
    return sendJson(res, 200, await startUpi(payOrder(body), { flow: 'collect', vpa: body.vpa }, reqCtx(req)));
  }
  if ((p === '/api/pay/upi/intent' || p === '/api/pay/upi/qr') && m === 'GET') {
    rateLimit(`pay-upi:${ip}`, 30, MIN10);
    return sendJson(res, 200, await startUpi(payOrder(url.searchParams), { flow: p.endsWith('qr') ? 'qr' : 'intent' }, reqCtx(req)));
  }
  if (p === '/api/pay/banks' && m === 'GET') {
    rateLimit(`pay-banks:${ip}`, 60, MIN10);
    return sendJson(res, 200, { banks: await netbankingBanks() });
  }

  // Checkout success handler. Safe to repeat: the same signed payment gives the same answer.
  if (p === '/api/pay/verify' && m === 'POST') {
    rateLimit(`pay-verify:${ip}`, 30, MIN10);
    const body = await readJson(req, 8192);
    let order;
    if (body.orderId) order = payOrder(body);
    else {
      // Without our order id, the signed Razorpay order id identifies it (the signature is the proof).
      const txn = /^order_\w+$/.test(String(body.razorpay_order_id || '')) && findTransaction({ razorpayOrderId: body.razorpay_order_id });
      order = txn && orderRow(txn.orderId);
      if (!order) throw new HttpError(400, 'Payment details do not match this order.', 'payment_mismatch');
    }
    razorpayVerify(order, body);
    return sendJson(res, 200, { verified: true, ...statusBody(order, paymentStatus(order)) });
  }
  // Checkout reported a failure: recorded only after Razorpay confirms it.
  if (p === '/api/pay/failed' && m === 'POST') {
    rateLimit(`pay-verify:${ip}`, 30, MIN10);
    const body = await readJson(req, 8192);
    const order = payOrder(body);
    await razorpayFailed(order, body);
    return sendJson(res, 200, statusBody(order, paymentStatus(order)));
  }
  // Demo mode only: finish the practice payment (success or failure) for a given method.
  if (p === '/api/pay/demo' && m === 'POST') {
    rateLimit(`pay-demo:${ip}`, 30, MIN10);
    const body = await readJson(req, 4096);
    const order = payOrder(body);
    demoResult(order, body.outcome === 'failed' ? 'failed' : 'success', body.method);
    return sendJson(res, 200, statusBody(order, paymentStatus(order)));
  }

  const mm = p.match(/^\/api\/pay\/status\/([\w-]+)$/);
  if (mm && m === 'GET') {
    rateLimit(`pay-status:${ip}`, 400, MIN10);
    const order = ownOrder(mm[1], url.searchParams.get('t'));
    // Still open: ask Razorpay too (throttled), in case the webhook is late or not set up.
    const s = PAYABLE.includes(order.status) ? await syncPaymentStatus(order) : paymentStatus(order);
    return sendJson(res, 200, statusBody(order, s));
  }
  throw new HttpError(404, 'Not found');
}

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const ip = clientIp(req);
  if (p === '/api/health') return sendJson(res, 200, { ok: true, payments: effectiveMode() });
  if (p === '/api/catalog' && m === 'GET') {
    const rows = db.prepare('SELECT id, kind, name, description, price, image, category, max_qty AS maxQty, meta FROM items WHERE active = 1 ORDER BY category, name').all();
    return sendJson(res, 200, rows.map((r) => ({ ...r, meta: JSON.parse(r.meta) })));
  }
  if (p.startsWith('/api/pay/')) return payApi(req, res, url);
  // Anonymous page views and clicks for the owner's Overview (site/js/core.js sends them).
  if (p === '/api/track' && m === 'POST') {
    try { rateLimit(`track:${ip}`, 300, MIN10); } catch { return sendJson(res, 200, { ok: true }); }
    trips.recordVisit(await readJson(req, 2048).catch(() => null), { ip, ua: String(req.headers['user-agent'] || ''), host: req.headers.host });
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/orders' && m === 'POST') {
    rateLimit(`order:${ip}`, 20, 10 * 60 * 1000);
    const o = createOrder(await readJson(req, 32 * 1024));
    return sendJson(res, 201, { orderId: o.id, token: o.token, amount: o.amount, checkoutUrl: `/checkout/?order=${o.id}&t=${o.token}` });
  }
  let mm = p.match(/^\/api\/orders\/([\w-]+)$/);
  if (mm && m === 'GET') return sendJson(res, 200, publicOrder(ownOrder(mm[1], url.searchParams.get('t'))));
  mm = p.match(/^\/api\/orders\/([\w-]+)\/pay$/);
  if (mm && m === 'POST') {
    rateLimit(`pay:${ip}`, 40, 10 * 60 * 1000);
    const body = await readJson(req, 4096);
    return sendJson(res, 200, await startPayment(ownOrder(mm[1], body.t), baseUrl(req)));
  }
  mm = p.match(/^\/api\/orders\/([\w-]+)\/(demo|upi-claim|razorpay-verify)$/);
  if (mm && m === 'POST') {
    rateLimit(`confirm:${ip}`, 30, 10 * 60 * 1000);
    const body = await readJson(req, 8192);
    const o = ownOrder(mm[1], body.t);
    if (mm[2] === 'demo') demoResult(o, body.outcome);
    else if (mm[2] === 'upi-claim') upiClaim(o, body.utr);
    else razorpayVerify(o, body);
    return sendJson(res, 200, publicOrder(ownOrder(mm[1], body.t)));
  }
  if (p === '/api/webhooks/razorpay' && m === 'POST') return webhook(req, res);
  // ---- owner ----
  if (p === '/api/admin/login' && m === 'POST') { admin.login(req, res, await readJson(req, 4096)); return sendJson(res, 200, { ok: true }); }
  if (p === '/api/admin/logout' && m === 'POST') { admin.logout(req, res); return sendJson(res, 200, { ok: true }); }
  if (p === '/api/admin/status' && m === 'GET') return sendJson(res, 200, { enabled: admin.adminEnabled(), payments: effectiveMode(), problems: paymentProblems() });
  if (p.startsWith('/api/admin/') && (p.startsWith('/api/admin/trips') || p === '/api/admin/uploads' || p === '/api/admin/visits')) {
    admin.requireOwner(req, { mutating: m !== 'GET' });
    return ownerTripsApi(req, res, url);
  }
  if (p.startsWith('/api/admin/')) {
    admin.requireOwner(req, { mutating: m !== 'GET' });
    if (p === '/api/admin/stats' && m === 'GET') return sendJson(res, 200, admin.stats());
    if (p === '/api/admin/orders' && m === 'GET') return sendJson(res, 200, admin.listOrders(Object.fromEntries(url.searchParams)));
    if (p === '/api/admin/orders.csv' && m === 'GET') {
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' });
      return res.end(`﻿${admin.ordersCsv()}`);
    }
    mm = p.match(/^\/api\/admin\/orders\/([\w-]+)\/status$/);
    if (mm && m === 'POST') { admin.changeStatus(mm[1], (await readJson(req, 1024)).status); return sendJson(res, 200, { ok: true }); }
    // Full refund of the order's successful payment (Razorpay API, or marked for demo / direct UPI).
    if (p === '/api/admin/refund' && m === 'POST') {
      rateLimit(`refund:${ip}`, 20, MIN10);
      const body = await readJson(req, 2048);
      if (!/^[\w-]{1,64}$/.test(String(body.orderId || ''))) throw new HttpError(400, 'Choose an order to refund.');
      const r = await refundPayment(String(body.orderId), { by: 'owner', reason: clean(body.reason, 200) });
      return sendJson(res, 200, { ok: true, ...r });
    }
  }
  throw new HttpError(404, 'Not found');
}

// ---------- owner: trips, photos, visitor stats (server/trips.js) ----------
async function ownerTripsApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const ip = clientIp(req);
  // Form errors go back field by field so the dashboard can show them next to each input.
  const invalid = (e) => { if (e.errors) return sendJson(res, e.status || 422, { error: e.message, errors: e.errors }); throw e; };
  if (p === '/api/admin/visits' && m === 'GET') return sendJson(res, 200, trips.visitStats());
  if (p === '/api/admin/uploads' && m === 'POST') {
    rateLimit(`upload:${ip}`, 200, MIN10);
    return sendJson(res, 201, trips.saveUpload(await readJson(req, 4 * 1024 * 1024)));
  }
  if (p === '/api/admin/trips' && m === 'GET') return sendJson(res, 200, trips.listTrips());
  if (p === '/api/admin/trips' && m === 'POST') {
    try { return sendJson(res, 200, trips.saveTrip(await readJson(req, 256 * 1024))); } catch (e) { return invalid(e); }
  }
  let mm = p.match(/^\/api\/admin\/trips\/sample\/([\w-]{1,64})$/);
  if (mm && m === 'GET') return sendJson(res, 200, { trip: trips.sampleAsDraft(mm[1]) });
  mm = p.match(/^\/api\/admin\/trips\/([\w-]{1,64})$/);
  if (mm && m === 'GET') return sendJson(res, 200, trips.getTripForOwner(mm[1]));
  mm = p.match(/^\/api\/admin\/trips\/([\w-]{1,64})\/(publish|unpublish|delete)$/);
  if (mm && m === 'POST') {
    try {
      if (mm[2] === 'delete') return sendJson(res, 200, trips.deleteTrip(mm[1]));
      return sendJson(res, 200, trips.setPublished(mm[1], mm[2] === 'publish'));
    } catch (e) { return invalid(e); }
  }
  throw new HttpError(404, 'Not found');
}

const isOwner = (req) => { try { admin.requireOwner(req); return true; } catch { return false; } };

// Clean URLs: /catalog -> site/catalog/index.html or site/catalog.html; /catalog/ -> index.html.
function resolveFile(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  const base = path.normalize(path.join(SITE, rel));
  if (base !== SITE && !base.startsWith(SITE + path.sep)) return null;
  const candidates = rel.endsWith('/') ? [path.join(base, 'index.html')] : [base, `${base}.html`, path.join(base, 'index.html')];
  for (const f of candidates) {
    try { if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}

function serveStatic(req, res, url) {
  // Published owner trips for every page (store.js imports it). The owner also gets drafts, for previews.
  if (url.pathname === '/js/live-trips.js') {
    res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
    return res.end(req.method === 'HEAD' ? '' : trips.liveTripsModule({ owner: isOwner(req) }));
  }
  if (url.pathname.startsWith('/uploads/')) {
    const f = trips.uploadFile(url.pathname);
    if (!f) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
    return req.method === 'HEAD' ? res.end() : fs.createReadStream(f).pipe(res);
  }
  // The old browser-only trip creator now lives in the dashboard (Trips tab), saved on the server.
  if (/^\/owner\/create\/?(index\.html)?$/.test(url.pathname)) {
    res.writeHead(302, { location: '/admin/#trips' });
    return res.end();
  }
  if (url.pathname === '/trips/') {
    res.writeHead(302, { location: `/trips${url.search}` });
    return res.end();
  }
  // The public "Create trip" page is retired, and an itinerary needs a trip: go straight to the
  // trips list on the server instead of rendering a page that redirects itself in JS.
  if (['/create', '/create.html', '/create/'].includes(url.pathname)) {
    res.writeHead(301, { location: '/trips' });
    return res.end();
  }
  if (['/itinerary', '/itinerary.html', '/itinerary/'].includes(url.pathname) && !['trip', 'id', 'join'].some((k) => url.searchParams.get(k))) {
    res.writeHead(302, { location: '/trips' });
    return res.end();
  }
  if (url.pathname === '/itinerary/') {
    res.writeHead(301, { location: `/itinerary${url.search}` });
    return res.end();
  }
  // /pay/ is the status page of one order (and the demo QR's practice approval): without an order it has nothing to show.
  if (['/pay', '/pay/', '/pay/index.html'].includes(url.pathname) && !(url.searchParams.get('order') && url.searchParams.get('t'))) {
    res.writeHead(302, { location: '/trips' });
    return res.end();
  }
  // Group-trip Join uses the site's trip checkout; kit payment links retain ?order.
  if (url.pathname === '/checkout/' && !url.searchParams.has('order')) {
    res.writeHead(302, { location: `/checkout${url.search}` });
    return res.end();
  }
  // /catalog.html -> /catalog (one address per page, better for SEO and sharing)
  if (/\.html$/.test(url.pathname) && !url.pathname.endsWith('/index.html') && resolveFile(url.pathname)) {
    res.writeHead(301, { location: url.pathname.replace(/\.html$/, '') + url.search });
    return res.end();
  }
  // /about/ -> /about when the page is a flat about.html (a typed or shared trailing slash must not 404).
  if (url.pathname.length > 1 && url.pathname.endsWith('/') && !resolveFile(url.pathname) && resolveFile(`${url.pathname.slice(0, -1)}.html`)) {
    res.writeHead(301, { location: url.pathname.slice(0, -1) + url.search });
    return res.end();
  }
  const file = resolveFile(url.pathname);
  if (!file) {
    const notFound = path.join(SITE, '404.html');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return fs.existsSync(notFound) ? fs.createReadStream(notFound).pipe(res) : res.end('<h1>Page not found</h1><p><a href="/">Go to the home page</a></p>');
  }
  // A folder page asked without its trailing slash: redirect so relative links inside it work.
  if (!url.pathname.endsWith('/') && path.basename(file) === 'index.html' && path.dirname(file) !== SITE && !fs.existsSync(`${path.join(SITE, decodeURIComponent(url.pathname))}.html`)) {
    res.writeHead(301, { location: `${url.pathname}/${url.search}` });
    return res.end();
  }
  const ext = path.extname(file).toLowerCase();
  res.setHeader('content-type', TYPES[ext] || 'application/octet-stream');
  res.setHeader('cache-control', ext === '.html' ? 'no-cache' : 'public, max-age=3600');
  // Owner pages must never be cached or framed.
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/owner/')) { res.setHeader('cache-control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex'); }
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    // New payment routes: { error: { code, message } }. Older routes keep { error: "message" } for shop.js.
    const modern = url.pathname.startsWith('/api/pay/') || url.pathname === '/api/admin/refund';
    if (!res.headersSent) sendError(res, e, { legacy: !modern });
    else res.end();
  }
});

const count = syncCatalog();
for (const p of paymentProblems()) console.warn(`PAYMENTS: ${p}. Using demo mode until it is fixed.`);
server.listen(config.port, config.host, () => {
  console.log(`${config.business}: http://localhost:${config.port}  (${count} catalog items, payments: ${effectiveMode()}, owner dashboard: ${admin.adminEnabled() ? '/admin' : 'off (set ADMIN_EMAIL and ADMIN_PASSWORD)'})`);
});
