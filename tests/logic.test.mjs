// Run: node tests/logic.test.mjs  (verifies data, filters, estimates, store and lead logic)
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { TRIPS, FLEX_POLICY, IMAGES } = await import('../site/js/data.js');
const P = await import('../site/js/planner.js');
const S = await import('../site/js/store.js');
const L = await import('../site/js/leads.js');
const C = await import('../site/js/compare.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

test('12 trips with required fields', () => {
  assert.equal(TRIPS.length, 12);
  const ids = new Set();
  for (const t of TRIPS) {
    for (const k of ['id', 'slug', 'name', 'region', 'tagline', 'days', 'difficulty', 'months', 'groupMin', 'groupMax', 'spotsLeft', 'basePricePerPerson', 'inclusions', 'exclusions', 'itinerary', 'faqs', 'image', 'imageReason']) assert.ok(t[k] !== undefined, `${t.id} missing ${k}`);
    assert.equal(t.priceIsPlaceholder, true);
    assert.ok(t.itinerary.length >= 5 && t.itinerary.length <= 7, `${t.id} itinerary length`);
    assert.equal(t.itinerary.length, t.days, `${t.id} itinerary matches days`);
    assert.ok(Object.values(IMAGES).some((i) => i.src === t.image));
    assert.ok(!ids.has(t.id)); ids.add(t.id);
  }
  assert.ok(Object.values(FLEX_POLICY).filter((v) => typeof v === 'object').every((v) => v.display && !v.display.includes('[to confirm]')));
});

test('filterTrips', () => {
  assert.equal(P.filterTrips(TRIPS, {}).length, 12);
  assert.deepEqual(P.filterTrips(TRIPS, { destination: 'rajasthan' }).map((t) => t.id), ['t03', 't04']);
  assert.ok(P.filterTrips(TRIPS, { budget: 8000 }).every((t) => t.basePricePerPerson <= 8000));
  assert.ok(P.filterTrips(TRIPS, { budget: 'over18k' }).every((t) => t.basePricePerPerson >= 18000));
  assert.ok(P.filterTrips(TRIPS, { duration: 'long' }).every((t) => t.days >= 7));
  assert.ok(P.filterTrips(TRIPS, { month: 'Jul' }).every((t) => t.months.includes(7)));
  assert.ok(P.filterTrips(TRIPS, { month: 12, difficulty: 'easy' }).every((t) => t.months.includes(12) && t.difficulty === 'easy'));
  assert.equal(P.filterTrips(TRIPS, { destination: 'nowhere' }).length, 0);
});

test('estimate ranges and discounts', () => {
  const base = P.estimate({ tripId: 't01', groupSize: 2, stayType: 'standard', startDate: '2026-11-10' });
  assert.equal(base.isEstimate, true); assert.equal(base.label, 'Estimate');
  assert.ok(base.min < base.max && base.min > 0);
  assert.equal(base.days, 6); assert.equal(base.season, 'shoulder');
  const group = P.estimate({ tripId: 't01', groupSize: 10, stayType: 'standard', startDate: '2026-11-10' });
  assert.ok(group.perPerson.max < base.perPerson.max, 'group discount');
  const solo = P.estimate({ tripId: 't01', groupSize: 1, startDate: '2026-11-10' });
  assert.ok(solo.perPerson.min > base.perPerson.min, 'solo supplement');
  const flex = P.estimate({ tripId: 't01', groupSize: 2, startDate: '2026-11-10', flexibleDays: 7 });
  assert.ok(flex.perPerson.max < base.perPerson.max, 'flexible-date discount');
  const peak = P.estimate({ tripId: 't01', groupSize: 2, startDate: '2026-12-20' });
  assert.equal(peak.season, 'peak'); assert.ok(peak.min > base.min);
  const boutique = P.estimate({ tripId: 't01', groupSize: 2, stayType: 'boutique', startDate: '2026-11-10' });
  const hostel = P.estimate({ tripId: 't01', groupSize: 2, stayType: 'hostel', startDate: '2026-11-10' });
  assert.ok(boutique.min > base.min && hostel.min < base.min);
  const addons = P.estimate({ tripId: 't01', groupSize: 2, startDate: '2026-11-10', addOns: ['photographer', 'private-cab'] });
  assert.ok(addons.min > base.min); assert.equal(addons.breakdown.addOns.length, 2);
  const custom = P.estimate({ destination: 'Anywhere', startDate: '2026-11-01', endDate: '2026-11-04', groupSize: 4 });
  assert.equal(custom.days, 4); assert.ok(custom.total.min === custom.perPerson.min * 4);
  assert.ok(/^Estimate: ₹/.test(base.text));
});

test('priceLabel and filledPercent', () => {
  const t = TRIPS[0];
  assert.equal(P.priceLabel(t).text, 'Price on request');
  assert.equal(P.filledPercent({ groupMax: 20, spotsLeft: 5 }), 75);
});

test('store: wishlist, compare max 3, builder', () => {
  assert.equal(S.toggleWishlist('t01'), true);
  assert.ok(S.isWishlisted('t01'));
  assert.equal(S.toggleWishlist('t01'), false);
  S.addToCompare('t01'); S.addToCompare('t02'); S.addToCompare('t03');
  const r = S.addToCompare('t04');
  assert.equal(r.ok, false); assert.equal(r.reason, 'full'); assert.equal(S.getCompare().length, 3);
  S.removeFromCompare('t02'); assert.deepEqual(S.getCompare(), ['t01', 't03']);
  S.saveBuilderState({ tripId: 't05', groupSize: 4 });
  assert.equal(S.getBuilderState().groupSize, 4);
  mem.set(S.KEYS.wishlist, '{broken'); assert.deepEqual(S.getWishlist(), []);
});

test('compareRows', () => {
  const { trips, rows } = C.compareRows(['t01', 't03', 'bogus']);
  assert.equal(trips.length, 2); assert.ok(rows.find((r) => r.key === 'region').differs);
});

test('lead validation', () => {
  assert.equal(L.normalizePhone('+91 98257 44110'), '9825744110');
  assert.equal(L.normalizePhone('09825744110'), '9825744110');
  assert.equal(L.normalizePhone('91-98257-44110'), '9825744110');
  assert.equal(L.validate({ name: 'Riya', phone: '+91 98765 43210' }).ok, true);
  const bad = L.validate({ name: '', phone: '12345' });
  assert.ok(bad.errors.name && bad.errors.phone);
  assert.ok(L.validate({ name: 'Riya', phone: '5876543210' }).errors.phone, 'must start 6-9');
  assert.ok(L.validate({ name: 'Riya', phone: '98765432101' }).errors.phone, '11 digits');
  assert.ok(L.validate({ name: 'Riya', phone: '9876543210', email: 'nope@' }).errors.email);
  assert.equal(L.validate({ name: 'Riya', phone: '9876543210', email: 'a@b.in' }).ok, true);
  assert.ok(L.validate({ name: 'Riya', phone: '9876543210', message: 'x'.repeat(601) }).errors.message);
  const spam = L.validate({ name: 'Bot', phone: '9876543210', website: 'http://x' });
  assert.equal(spam.spam, true); assert.equal(spam.ok, false);
  assert.equal(L.sanitize({ name: '<b>Riya</b>  <script>x</script>' }).name, 'Riya x');
});

test('WhatsApp URL, save and CSV', () => {
  const { data } = L.validate({ name: 'Riya Shah', phone: '98765 43210', city: 'Ahmedabad', message: 'Trip for 4 & friends' });
  const url = L.buildWhatsAppUrl(data, { trip: 'Kedarkantha Summit Trek', estimate: 'Estimate: ₹9,000 – ₹11,000' });
  assert.ok(url.startsWith('https://wa.me/919825744110?text='));
  const text = decodeURIComponent(url.split('text=')[1]);
  assert.ok(text.includes('Name: Riya Shah') && text.includes('+91 9876543210') && text.includes('Trip: Kedarkantha') && text.includes('& friends'));
  assert.ok(L.saveLead(data, { trip: 'Kedarkantha' }));
  L.saveLead({ ...data, name: '=HYPERLINK("x")', message: 'a, "b"\nc' });
  const csv = L.exportLeadsCSV();
  const lines = csv.split('\r\n');
  assert.ok(lines[0].startsWith('createdAt,name,phone'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'formula escaped');
  assert.ok(csv.includes('"a, ""b""\nc"'));
});

/* ---------- Student group trips ---------- */
const D = await import('../site/js/data.js');
const validOwnerTrip = {
  title: 'Pushkar friends weekend', destination: 'Pushkar', price: 1800,
  dates: ['2027-03-06'], seats: 10, pickupPointId: 'sundar-one',
  coverImage: '/assets/images/places/jaisalmer-camel-cart-natural.jpg',
  coverAlt: 'Camel cart on a sandy road in Rajasthan',
  summary: 'A weekend around the lake and old bazaar.',
  inclusions: ['Return transport', 'One night stay'],
  days: [
    { title: 'Explore Pushkar', place: 'Pushkar', description: 'Walk through the bazaar.', activities: ['Visit the ghats'], image: '', hotel: { name: 'Guesthouse', note: 'Shared rooms' } },
    { title: 'Return to Jaipur', place: 'Jaipur', description: 'Travel home.', activities: ['Breakfast', 'Return transfer'], image: '', hotel: null },
  ],
};
const validJoin = { name: 'Riya Shah', phone: '9123456780', pickupId: 'college-gate', budgetConfirmed: true };

test('group data: exactly two pickup points and 6 seeded trips', () => {
  assert.deepEqual(D.PICKUP_POINTS, [
    { id: 'sundar-one', label: 'Sundar One hostel gate' },
    { id: 'college-gate', label: 'College gate (Manipal University Jaipur)' },
  ]);
  assert.equal(D.GROUP_TRIPS.length, 6);
  const ids = new Set();
  for (const t of D.GROUP_TRIPS) {
    for (const k of ['id', 'destination', 'title', 'date', 'budgetPerPerson', 'seatsTotal', 'membersJoined', 'pickupPointId', 'image', 'dropNote']) assert.ok(t[k] !== undefined, `${t.id} missing ${k}`);
    assert.ok(t.date > '2026-10-31', `${t.id} date after 2026-10`);
    assert.ok(t.budgetPerPerson > 0 && t.membersJoined <= t.seatsTotal);
    assert.ok(D.isValidPickup(t.pickupPointId));
    assert.equal(t.dropNote, 'Drop back at your pickup point');
    assert.ok(/^\/assets\/images\//.test(t.image));
    assert.equal(t.price, t.budgetPerPerson);
    assert.equal(t.coverImage, t.image);
    assert.equal(t.days.length, Number.parseInt(t.durationLabel, 10));
    assert.ok(t.days.every((d, i) => d.day === i + 1 && d.title && d.place && d.activities.length && 'hotel' in d));
    assert.ok(!ids.has(t.id)); ids.add(t.id);
  }
  for (const name of ['Jaipur', 'Pushkar', 'Kedarkantha', 'Jaisalmer', 'Udaipur', 'Rishikesh']) assert.ok(D.GROUP_TRIPS.some((t) => t.destination.includes(name)), name);
});

test('group store: getTrips lists seeds with derived fields', () => {
  const trips = S.getTrips();
  assert.equal(trips.length, 6);
  const g01 = trips.find((t) => t.id === 'g01');
  assert.equal(g01.seatsLeft, 3); assert.equal(g01.filledPercent, 88); assert.equal(g01.isFull, false);
  assert.equal(g01.pickupLabel, 'Sundar One hostel gate');
  mem.set(S.KEYS.groupTrips, '{broken'); mem.set(S.KEYS.groupJoins, '[1]');
  assert.equal(S.getTrips().length, 6, 'corrupt storage falls back to seeds');
  mem.delete(S.KEYS.groupTrips); mem.delete(S.KEYS.groupJoins);
});

test('group store: only owner trip schema saves and appears in getTrips', () => {
  const bad = (patch, field) => {
    const x = S.validateOwnerTrip({ ...validOwnerTrip, ...patch });
    assert.equal(x.ok, false); assert.ok(x.errors[field], `${field} error for ${JSON.stringify(patch)}`);
  };
  bad({ title: '' }, 'title');
  bad({ destination: '' }, 'destination');
  bad({ price: 0 }, 'price');
  bad({ dates: [] }, 'dates');
  bad({ dates: ['2027-02-31'] }, 'dates');
  bad({ seats: 1 }, 'seats');
  bad({ seats: 31 }, 'seats');
  bad({ pickupPointId: 'bus-stand' }, 'pickupPointId');
  bad({ coverImage: '' }, 'coverImage');
  bad({ summary: '' }, 'summary');
  bad({ days: [] }, 'days');
  bad({ days: [{ title: '', place: 'Pushkar', activities: ['Walk'] }] }, 'days.0.title');
  const r = S.saveOwnerTrip(validOwnerTrip);
  assert.equal(r.ok, true);
  assert.equal(r.trip.membersJoined, 0); assert.equal(r.trip.seatsLeft, 10);
  assert.equal(r.trip.isOwnerTrip, true); assert.equal(r.trip.isUserCreated, false);
  assert.equal(r.trip.days.length, 2); assert.equal(r.trip.days[0].hotel.name, 'Guesthouse');
  assert.equal(S.getTrips()[0].id, r.trip.id, 'owner trip first');
  assert.equal(S.getTrips().length, 7);
  assert.equal(S.getTrip(r.trip.id).destination, 'Pushkar');
  assert.equal(S.deleteOwnerTrip(r.trip.id), true);
  assert.equal(S.getTrips().length, 6);
});

test('group store: joinTrip happy path, duplicate, full, invalid pickup, unconfirmed budget', () => {
  const before = S.getTrip('g02').membersJoined;
  const ok = S.joinTrip('g02', validJoin);
  assert.equal(ok.ok, true); assert.equal(ok.trip.membersJoined, before + 1); assert.equal(ok.member.pickupId, 'college-gate');

  const dup = S.joinTrip('g02', validJoin);
  assert.equal(dup.ok, false); assert.ok(dup.errors.phone, 'same phone cannot join twice');

  const badPickup = S.joinTrip('g02', { ...validJoin, phone: '9000000001', pickupId: 'railway-station' });
  assert.equal(badPickup.ok, false); assert.ok(badPickup.errors.pickupId);
  assert.equal(S.joinTrip('g02', { ...validJoin, phone: '9000000001', pickupId: undefined }).ok, false, 'pickup required');

  for (const v of [false, undefined, 'true', 1, null]) {
    const r = S.joinTrip('g02', { ...validJoin, phone: '9000000002', budgetConfirmed: v });
    assert.equal(r.ok, false, `budgetConfirmed ${String(v)} rejected`); assert.equal(r.reason, 'invalid'); assert.ok(r.errors.budgetConfirmed);
  }
  assert.equal(S.getTrip('g02').membersJoined, before + 1, 'rejected joins do not take a seat');

  assert.ok(S.joinTrip('g02', { ...validJoin, phone: '123' }).errors.phone);
  assert.ok(S.joinTrip('g02', { ...validJoin, phone: '9000000003', name: '' }).errors.name);
  assert.equal(S.joinTrip('nope', validJoin).reason, 'not-found');

  // Fill a two-seat owner trip with two joiners, then reject the third.
  const t = S.saveOwnerTrip({ ...validOwnerTrip, seats: 2 }).trip;
  assert.equal(S.joinTrip(t.id, { ...validJoin, phone: '9822222222' }).ok, true);
  assert.equal(S.joinTrip(t.id, { ...validJoin, phone: '9811111111' }).ok, true);
  assert.equal(S.getTrip(t.id).isFull, true); assert.equal(S.getTrip(t.id).filledPercent, 100);
  const full = S.joinTrip(t.id, { ...validJoin, phone: '9833333333' });
  assert.equal(full.ok, false); assert.equal(full.reason, 'full');

  // seeded trip filling up: g01 has 3 seats left
  for (const p of ['9700000001', '9700000002', '9700000003']) assert.equal(S.joinTrip('g01', { ...validJoin, phone: p }).ok, true);
  assert.equal(S.getTrip('g01').seatsLeft, 0);
  assert.equal(S.joinTrip('g01', { ...validJoin, phone: '9700000004' }).reason, 'full');
});

test('group store: bookings, markPaid, markFailed', () => {
  assert.equal(S.createBooking({ tripId: 'nope', name: 'Riya', phone: '9123456780', pickupId: 'sundar-one' }).ok, false);
  assert.ok(S.createBooking({ tripId: 'g03', name: 'Riya', phone: '9123456780', pickupId: 'metro' }).errors.pickupId);
  const { ok, booking } = S.createBooking({ tripId: 'g03', name: 'Riya Shah', phone: '9123456780', pickupId: 'sundar-one' });
  assert.equal(ok, true); assert.equal(booking.status, 'pending'); assert.equal(booking.amount, 8499);
  assert.equal(booking.pickupLabel, 'Sundar One hostel gate');
  assert.equal(S.getBooking(booking.id).amount, 8499); assert.equal(S.getBooking('missing'), null);

  const failed = S.markFailed(booking.id, 'Card declined');
  assert.equal(failed.ok, true); assert.equal(S.getBooking(booking.id).status, 'failed'); assert.equal(S.getBooking(booking.id).failureReason, 'Card declined');
  const paid = S.markPaid(booking.id, { method: 'demo-qr', reference: 'DEMO123' });
  assert.equal(paid.ok, true); assert.equal(S.getBooking(booking.id).status, 'paid'); assert.equal(S.getBooking(booking.id).paymentMethod, 'demo-qr');
  assert.equal(S.markFailed(booking.id).ok, false, 'paid booking cannot flip to failed');
  assert.equal(S.getBooking(booking.id).status, 'paid');
  assert.equal(S.markPaid('missing').ok, false);
  assert.equal(S.getBookings().length, 1);
});

/* ---------- Payments (server side, Razorpay test setup; no network, no real keys) ----------
   Settings go into the environment BEFORE the server modules load, so a real .env is never read
   (config.js does not override variables that are already set) and the database is a temp file. */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KEY_ID = 'rzp_test_UnitTestKey01';
const KEY_SECRET = 'unit_test_key_secret_value';
const WEBHOOK_SECRET = 'unit_test_webhook_secret';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-test-'));
Object.assign(process.env, {
  PAYMENT_MODE: 'razorpay', RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  DATA_DIR: tmpDir, RAZORPAY_API_BASE: 'http://127.0.0.1:9/v1', RAZORPAY_RETRIES: '0', RAZORPAY_TIMEOUT_MS: '2000',
});
const RZP = await import('../server/payments/razorpay.js');
const DB = await import('../server/db.js');
const PAY = await import('../server/payments/index.js');

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
let seq = 0;
// A pending order with one open Razorpay transaction, as the checkout creates them.
function newOrder(amount = 199900) {
  const n = ++seq;
  const orderId = `ord_test${n}`;
  DB.db.prepare(`INSERT INTO orders (id, token, items, amount, currency, customer_name, status, payment_mode, created_at)
    VALUES (?, ?, '[]', ?, 'INR', 'Test Traveller', 'pending', 'razorpay', ?)`).run(orderId, `t_test${n}`, amount, Date.now());
  const txn = DB.createTransaction({ orderId, mode: 'razorpay', amount, razorpayOrderId: `order_test${n}` });
  return { orderId, rzpOrderId: `order_test${n}`, txnId: txn.id, amount, payId: `pay_test${n}` };
}
const orderStatus = (id) => DB.db.prepare('SELECT status FROM orders WHERE id = ?').get(id).status;
const txnStatus = (id) => DB.getTransaction(id).status;
const eventCount = (orderId, type) => DB.db.prepare('SELECT COUNT(*) AS n FROM events WHERE order_id = ? AND type = ?').get(orderId, type).n;
// A signed webhook delivery: returns what razorpayWebhook returns (raw bytes + signature + event id).
function deliver(event, o, { eventId, status, amount } = {}) {
  const raw = Buffer.from(JSON.stringify({ event, payload: { payment: { entity: { id: o.payId, order_id: o.rzpOrderId, amount: amount ?? o.amount, status: status || 'captured', method: 'upi' } } } }));
  return PAY.razorpayWebhook(raw, hmac(WEBHOOK_SECRET, raw), eventId);
}

test('payments: mode is razorpay with test keys (no real keys used)', () => {
  assert.equal(PAY.effectiveMode(), 'razorpay');
  assert.equal(RZP.isTestKey(), true);
  const pub = JSON.stringify(PAY.publicPaymentConfig());
  assert.ok(pub.includes(KEY_ID), 'key id is public');
  assert.ok(!pub.includes(KEY_SECRET) && !pub.includes(WEBHOOK_SECRET), 'secrets never reach the browser config');
});

test('VPA regex: valid and invalid UPI IDs', () => {
  for (const v of ['success@razorpay', 'failure@razorpay', 'riya.shah@okhdfcbank', 'neel-k_2@ybl', '9876543210@paytm', 'ab@ibl']) {
    assert.ok(RZP.VPA_RE.test(v), `${v} should be valid`);
  }
  for (const v of ['', 'plain', '@ybl', 'riya@', 'a@ybl', 'riya@y', 'ri ya@ybl', 'riya@yb l', 'riya@@ybl', 'riya@bank1', 'riya@ybl ', ' riya@ybl', 'ri<ya>@ybl', 'riya@ybl\n', 'a@b@ybl']) {
    assert.ok(!RZP.VPA_RE.test(v), `${JSON.stringify(v)} should be invalid`);
  }
});

test('checkout signature: HMAC-SHA256(order_id|payment_id, key secret)', () => {
  const orderId = 'order_ABC123', paymentId = 'pay_XYZ789';
  const good = hmac(KEY_SECRET, `${orderId}|${paymentId}`);
  assert.equal(RZP.verifyCheckoutSignature({ orderId, paymentId, signature: good }), true);
  assert.equal(RZP.verifyCheckoutSignature({ orderId, paymentId, signature: good.toUpperCase() }), true, 'hex case does not matter');
  assert.equal(RZP.verifyCheckoutSignature({ orderId, paymentId: 'pay_OTHER', signature: good }), false, 'other payment id');
  assert.equal(RZP.verifyCheckoutSignature({ orderId: 'order_OTHER', paymentId, signature: good }), false, 'other order id');
  assert.equal(RZP.verifyCheckoutSignature({ orderId, paymentId, signature: hmac('wrong_secret_value', `${orderId}|${paymentId}`) }), false, 'signed with another secret');
  assert.equal(RZP.verifyCheckoutSignature({ orderId, paymentId, signature: `${paymentId}|${orderId}` }), false, 'not hex');
  assert.equal(RZP.verifyCheckoutSignature({ orderId, paymentId, signature: good.slice(0, 40) }), false, 'too short');
  assert.equal(RZP.verifyCheckoutSignature({ orderId, paymentId, signature: '' }), false);
  assert.equal(RZP.verifyCheckoutSignature({ orderId: '', paymentId, signature: good }), false);
  assert.equal(RZP.verifyCheckoutSignature({ orderId, paymentId, signature: undefined }), false);
});

test('checkout verify: bad signature never marks paid, good signature does (and is repeatable)', () => {
  const o = newOrder();
  const body = { razorpay_order_id: o.rzpOrderId, razorpay_payment_id: o.payId, razorpay_signature: hmac(KEY_SECRET, `${o.rzpOrderId}|${o.payId}`) };
  const order = DB.db.prepare('SELECT * FROM orders WHERE id = ?').get(o.orderId);
  assert.throws(() => PAY.razorpayVerify(order, { ...body, razorpay_signature: hmac('nope_nope_nope_nope', 'x') }), (e) => e.status === 400);
  assert.throws(() => PAY.razorpayVerify(order, { ...body, razorpay_order_id: 'order_someone_else' }), (e) => e.status === 400, 'order id of another order');
  assert.equal(orderStatus(o.orderId), 'pending'); assert.equal(txnStatus(o.txnId), 'created');
  PAY.razorpayVerify(order, body);
  assert.equal(orderStatus(o.orderId), 'paid'); assert.equal(txnStatus(o.txnId), 'success');
  PAY.razorpayVerify(DB.db.prepare('SELECT * FROM orders WHERE id = ?').get(o.orderId), body);
  assert.equal(orderStatus(o.orderId), 'paid', 'repeat is harmless');
  assert.equal(eventCount(o.orderId, 'paid'), 1, 'paid recorded once');
});

test('webhook signature is checked on the raw body bytes', () => {
  const raw = Buffer.from('{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","order_id":"order_1","amount":100,"status":"captured"}}}}');
  const sig = hmac(WEBHOOK_SECRET, raw);
  assert.equal(RZP.verifyWebhookSignature(raw, sig), true);
  assert.equal(RZP.verifyWebhookSignature(raw.toString('utf8'), sig), true, 'string body is the same bytes');
  const pretty = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8')), null, 2));
  assert.equal(RZP.verifyWebhookSignature(pretty, sig), false, 'same JSON, different bytes: the signature no longer matches');
  assert.equal(RZP.verifyWebhookSignature(Buffer.concat([raw, Buffer.from(' ')]), sig), false, 'one extra byte');
  assert.equal(RZP.verifyWebhookSignature(raw, hmac('another_webhook_secret', raw)), false, 'wrong secret');
  assert.equal(RZP.verifyWebhookSignature(raw, hmac(KEY_SECRET, raw)), false, 'key secret is not the webhook secret');
  assert.equal(RZP.verifyWebhookSignature(raw, undefined), false);
  assert.equal(RZP.verifyWebhookSignature(raw, 'zz'), false);
  assert.equal(RZP.verifyWebhookSignature({ not: 'bytes' }, sig), false, 'a parsed object is refused');
  assert.throws(() => PAY.razorpayWebhook(raw, 'a'.repeat(64), 'evt_bad_sig'), (e) => e.status === 400, 'handler rejects a bad signature');
  assert.equal(DB.eventProcessed('evt_bad_sig'), false, 'a rejected delivery is not recorded');
});

test('webhook idempotency: the same event id twice changes state once', () => {
  const o = newOrder();
  const first = deliver('payment.captured', o, { eventId: 'evt_idem_1' });
  assert.equal(first.duplicate, false);
  assert.equal(orderStatus(o.orderId), 'paid'); assert.equal(txnStatus(o.txnId), 'success');
  const paidAt = DB.db.prepare('SELECT paid_at FROM orders WHERE id = ?').get(o.orderId).paid_at;
  const second = deliver('payment.captured', o, { eventId: 'evt_idem_1' });
  assert.equal(second.duplicate, true);
  assert.equal(eventCount(o.orderId, 'paid'), 1, 'order became paid once');
  assert.equal(eventCount(o.orderId, 'txn_success'), 1, 'transaction became success once');
  assert.equal(DB.db.prepare('SELECT paid_at FROM orders WHERE id = ?').get(o.orderId).paid_at, paidAt);
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM processed_events WHERE id = ?').get('evt_idem_1').n, 1);
  assert.ok(DB.eventProcessed('evt_idem_1'));
  // No event id header: the body hash identifies the delivery, so an identical retry is still a duplicate.
  const p = newOrder();
  assert.equal(deliver('payment.captured', p).duplicate, false);
  assert.equal(deliver('payment.captured', p).duplicate, true);
  assert.equal(eventCount(p.orderId, 'txn_success'), 1);
  // A different event id is a different delivery (Razorpay sends order.paid after payment.captured).
  assert.equal(deliver('order.paid', o, { eventId: 'evt_idem_2' }).duplicate, false);
  assert.equal(eventCount(o.orderId, 'txn_success'), 1, 'still one success');
});

test('idempotency: a rolled-back handler does not burn the event id', () => {
  assert.throws(() => DB.runOnce('evt_rollback', {}, () => { throw new Error('boom'); }), /boom/);
  assert.equal(DB.eventProcessed('evt_rollback'), false, 'Razorpay retry will be processed');
  assert.equal(DB.runOnce('evt_rollback', {}, () => 'ok').outcome, 'ok');
});

test('status transitions: a late failed event cannot override success', () => {
  const o = newOrder();
  deliver('payment.captured', o, { eventId: 'evt_t1' });
  const late = deliver('payment.failed', o, { eventId: 'evt_t2', status: 'failed' });
  assert.equal(late.duplicate, false, 'a new event id is processed, but changes nothing');
  assert.equal(txnStatus(o.txnId), 'success'); assert.equal(orderStatus(o.orderId), 'paid');
  assert.ok(eventCount(o.orderId, 'txn_ignored') >= 1, 'refused move is logged');
  // Same story when failed arrives first, then success (buyer retried and paid).
  const r = newOrder();
  deliver('payment.failed', r, { eventId: 'evt_t3', status: 'failed' });
  assert.equal(txnStatus(r.txnId), 'failed'); assert.equal(orderStatus(r.orderId), 'failed');
  deliver('payment.captured', r, { eventId: 'evt_t4' });
  assert.equal(txnStatus(r.txnId), 'success'); assert.equal(orderStatus(r.orderId), 'paid');
});

test('status transitions: state machine rules', () => {
  const ok = [['created', 'pending'], ['created', 'success'], ['created', 'failed'], ['pending', 'success'], ['pending', 'failed'], ['failed', 'pending'], ['failed', 'success'], ['success', 'refunded'], ['success', 'success']];
  const no = [['success', 'failed'], ['success', 'pending'], ['success', 'created'], ['refunded', 'success'], ['refunded', 'failed'], ['refunded', 'pending'], ['pending', 'created']];
  for (const [a, b] of ok) assert.equal(DB.canMoveTransaction(a, b), true, `${a} -> ${b}`);
  for (const [a, b] of no) assert.equal(DB.canMoveTransaction(a, b), false, `${a} -> ${b}`);
  const o = newOrder();
  assert.equal(DB.setStatus(o.orderId, 'paid'), true);
  assert.equal(DB.setStatus(o.orderId, 'failed'), false, 'paid order cannot fail');
  assert.equal(DB.setStatus(o.orderId, 'pending'), false);
  assert.equal(DB.setStatus(o.orderId, 'refunded'), true);
  assert.equal(DB.setStatus(o.orderId, 'paid'), false, 'refunded is final');
  assert.equal(orderStatus(o.orderId), 'refunded');
  assert.throws(() => DB.setTransactionStatus(o.txnId, 'bogus'));
  // refunded transaction: a repeated captured webhook must not bring it back
  const r = newOrder();
  deliver('payment.captured', r, { eventId: 'evt_r1' });
  const refund = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_test', payment_id: r.payId, amount: r.amount } } } };
  const raw = Buffer.from(JSON.stringify(refund));
  PAY.razorpayWebhook(raw, hmac(WEBHOOK_SECRET, raw), 'evt_r2');
  assert.equal(txnStatus(r.txnId), 'refunded'); assert.equal(orderStatus(r.orderId), 'refunded');
  deliver('payment.captured', r, { eventId: 'evt_r3' });
  assert.equal(txnStatus(r.txnId), 'refunded'); assert.equal(orderStatus(r.orderId), 'refunded');
});

test('amount check: a payment for a different amount is not accepted as paid', () => {
  const o = newOrder(199900);
  deliver('payment.captured', o, { eventId: 'evt_amt1', amount: 100 });
  assert.equal(txnStatus(o.txnId), 'created'); assert.equal(orderStatus(o.orderId), 'pending');
  assert.equal(eventCount(o.orderId, 'amount_mismatch'), 1);
  deliver('payment.captured', o, { eventId: 'evt_amt2' });
  assert.equal(orderStatus(o.orderId), 'paid');
});

// Amount computed server-side: start the real server on localhost (demo mode, temp database) and send
// a cart whose prices and total are lies. Only the catalog price times the quantity may be charged.
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); s.on('error', rej); });
async function withServer(fn) {
  const port = await freePort();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'server/app.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PAYMENT_MODE: 'demo', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'pay-srv-')), RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '', ADMIN_EMAIL: '', ADMIN_PASSWORD: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('server did not start')), 15000);
      child.stdout.on('data', (d) => { if (String(d).includes('http://localhost')) { clearTimeout(t); res(); } });
      child.on('exit', (c) => { clearTimeout(t); rej(new Error(`server exited early (${c})`)); });
    });
    return await fn(`http://127.0.0.1:${port}`);
  } finally { child.kill(); }
}
const atest = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

await atest('amount is computed on the server from catalog prices, never from the browser', () => withServer(async (base) => {
  const post = (body, headers = {}) => fetch(`${base}/api/pay/order`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const catalog = await (await fetch(`${base}/api/catalog`)).json();
  const item = catalog.find((i) => !i.meta?.groupTrip) || catalog[0]; // group trips are priced per traveller (tested below)
  assert.ok(item && item.price > 0, 'catalog has an item');
  const date = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
  const qty = Math.min(3, item.maxQty);
  const cart = { items: [{ id: item.id, qty, price: 1, amount: 1 }], amount: 1, total: 1, date, customer: { name: 'Riya Shah', phone: '9876543210' } };
  const r = await post(cart, { 'idempotency-key': 'unit-test-key-0001' });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.amount, item.price * qty, 'paise = catalog price x qty; the 1 sent by the browser is ignored');
  assert.equal(body.payment.amount, body.amount);
  // Same Idempotency-Key + same cart: the same order comes back, no second order.
  const again = await post(cart, { 'idempotency-key': 'unit-test-key-0001' });
  assert.equal(again.status, 200); assert.equal(again.headers.get('idempotent-replayed'), 'true');
  assert.equal((await again.json()).orderId, body.orderId);
  // Same key, different cart: refused.
  const diff = await post({ ...cart, items: [{ id: item.id, qty: 1 }] }, { 'idempotency-key': 'unit-test-key-0001' });
  assert.equal(diff.status, 422);
  // Unknown item and absurd quantity are refused.
  assert.equal((await post({ ...cart, items: [{ id: 'no-such-trip', qty: 1 }] })).status, 400);
  assert.equal((await post({ ...cart, items: [{ id: item.id, qty: 9999 }] })).status, 400);
}));

/* ---------- Group booking: one card per traveller (up to 6), traveller 1 is the primary contact ---------- */
const party = (n) => Array.from({ length: n }, (_, i) => ({ name: ['Riya Shah', 'Aman Verma', 'Neha Gupta', 'Kabir Singh', 'Isha Rao', 'Dev Mehta', 'Tara Jain'][i], phone: `98765432${10 + i}` }));
const withLead = (list) => list.map((t, i) => (i === 0 ? { ...t, email: 'riya@college.edu', college: 'Sundar One hostel' } : t));

test('travellers: validation (name, 10-digit Indian mobile, lead email, max 6, unique numbers)', () => {
  const ok = DB.cleanTravellers(withLead(party(6)));
  assert.equal(ok.ok, true);
  assert.equal(ok.travellers.length, 6);
  assert.deepEqual(ok.travellers[0], { name: 'Riya Shah', phone: '9876543210', email: 'riya@college.edu', college: 'Sundar One hostel', lead: true });
  assert.deepEqual(ok.travellers[1], { name: 'Aman Verma', phone: '9876543211' }, 'others: name + phone only, never marked lead');
  // +91 / 0 prefixes and spaces are cleaned to 10 digits; the college is optional.
  const pre = DB.cleanTravellers([{ name: '  Riya   Shah ', phone: '+91 98765 43210', email: 'riya@college.edu' }, { name: 'Aman', phone: '098765 43211' }]);
  assert.equal(pre.ok, true);
  assert.equal(pre.travellers[0].name, 'Riya Shah');
  assert.deepEqual(pre.travellers.map((t) => t.phone), ['9876543210', '9876543211']);
  assert.equal('college' in pre.travellers[0], false);
  const fail = (list, field, index) => { const r = DB.cleanTravellers(list); assert.equal(r.ok, false, JSON.stringify(list)); assert.equal(r.field, field); if (index !== undefined) assert.equal(r.index, index); return r; };
  fail([], 'name');
  fail('not a list', 'name');
  fail(withLead(party(7)), 'count');
  fail([{ ...withLead(party(1))[0], name: '' }], 'name', 0);
  fail([{ ...withLead(party(1))[0], name: '12' }], 'name', 0);
  fail([{ ...withLead(party(1))[0], email: '' }], 'email', 0, 'lead email required');
  fail([{ ...withLead(party(1))[0], email: 'riya@college' }], 'email', 0);
  fail(withLead([...party(2).slice(0, 1), { name: 'Aman', phone: '' }]), 'phone', 1);
  for (const phone of ['12345', '5876543210', '98765432101', '98765abcde', '+1 415 555 0100']) fail(withLead([...party(1), { name: 'Aman', phone }]), 'phone', 1);
  fail(withLead([...party(1), { name: 'Aman', phone: '+91 9876543210' }]), 'phone', 1, 'same number as traveller 1');
  fail(withLead([...party(1), null]), 'name', 1);
  assert.equal(DB.indianMobile('+91-98765-43210'), '9876543210');
  assert.equal(DB.indianMobile('4876543210'), '');
  // Stored rows are plain text: markup is stripped.
  assert.equal(DB.cleanTravellers([{ name: 'Riya <b>Shah</b>', phone: '9876543210', email: 'riya@college.edu' }]).travellers[0].name.includes('<'), false);
});

await atest('group trip: server charges price x travellers, stores them, shows them in status', () => withServer(async (base) => {
  const post = (body) => fetch(`${base}/api/pay/order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const catalog = await (await fetch(`${base}/api/catalog`)).json();
  const trip = catalog.filter((i) => i.meta?.groupTrip).sort((a, b) => (a.meta.date < b.meta.date ? 1 : -1))[0];
  assert.ok(trip, 'group trips from site/js/data.js are in the catalog');
  assert.equal(trip.maxQty, 6);
  const { GROUP_TRIPS } = await import('../site/js/data.js');
  assert.equal(trip.price, Math.round((GROUP_TRIPS.find((t) => t.id === trip.id).price ?? GROUP_TRIPS.find((t) => t.id === trip.id).budgetPerPerson) * 100), 'price = the trip page price');
  // The browser lies about qty, amount and date: the server uses 6 travellers x its own price and the trip date.
  const cart = { items: [{ id: trip.id, qty: 1, price: 1 }], amount: 1, date: '2099-01-01', customer: { name: 'Someone Else', phone: '9000000000' }, travellers: withLead(party(6)) };
  const r = await post(cart);
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.amount, trip.price * 6, 'paise = per-person price x 6 travellers');
  assert.equal(body.payment.amount, body.amount, 'the payment is started for the same amount');
  const order = await (await fetch(`${base}/api/orders/${body.orderId}?t=${body.token}`)).json();
  assert.equal(order.items[0].qty, 6);
  assert.equal(order.date, trip.meta.date);
  assert.equal(order.customer, 'Riya Shah', 'the lead traveller is the customer');
  assert.deepEqual(order.travellers.map((t) => t.name), party(6).map((t) => t.name));
  assert.equal(order.travellers.filter((t) => t.lead).length, 1);
  const status = await (await fetch(`${base}/api/pay/status/${body.orderId}?t=${body.token}`)).json();
  assert.equal(status.travellers.length, 6);
  assert.equal(status.travellers[0].lead, true);
  assert.equal(JSON.stringify(status.travellers).includes('98765432'), false, 'status polling does not repeat phone numbers');
  // 2 travellers -> 2 seats.
  assert.equal((await (await post({ ...cart, travellers: withLead(party(2)) })).json()).amount, trip.price * 2);
  // Refused: no travellers, 7 travellers, a bad mobile, a repeated number.
  for (const travellers of [undefined, [], withLead(party(7)), withLead([...party(1), { name: 'Aman', phone: '12345' }]), withLead([...party(1), { name: 'Aman', phone: '9876543210' }])]) {
    const bad = await post({ ...cart, travellers });
    assert.equal(bad.status, 400, JSON.stringify(travellers));
  }
  // A group trip is booked on its own.
  assert.equal((await post({ ...cart, items: [{ id: trip.id, qty: 1 }, { id: trip.id, qty: 1 }] })).status, 400);
}));

console.log(`\n${passed} test groups passed`);
fs.rmSync(tmpDir, { recursive: true, force: true });
