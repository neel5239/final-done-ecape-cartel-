/**
 * Checkout: the one payment page of the site (/checkout).
 *
 *   /checkout?trip=ID            group-trip details step, then payment
 *   /checkout?booking=ID         payment for a trip booking made on this device
 *   /checkout?order=ID&t=TOKEN   payment for a server order (Shop.checkout, old /checkout/ links)
 *
 * Methods: UPI (typed UPI ID with a waiting screen, QR, "Open UPI app"), Google Pay, net banking
 * and cards. Everything talks to the kit's /api/pay/* routes; the server owns every amount.
 *   razorpay  Razorpay Checkout with the public key id from /api/pay/config (never a secret).
 *   demo      no keys: a visible "Demo mode" notice and a practice gateway, same screens.
 *   upi       direct UPI to the owner: QR / UPI app, then the buyer enters the UTR.
 * A trip that is not in data/catalog.json has no server price yet, so its booking is paid with a
 * practice payment saved on this device (demo) until the owner adds the trip to the catalog.
 */

import { getBooking, getTrip, getTrips, createBooking, markPaid, markFailed, joinTrip, read, write, KEYS } from './store.js';
import { DROP_NOTE, PICKUP_POINTS, getPickupPoint } from './data.js';

const $ = (id) => document.getElementById(id);
const enc = encodeURIComponent;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const money = (paise, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: paise % 100 ? 2 : 0 }).format((paise || 0) / 100);
const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ''));
const VPA_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;
const UPI_WAIT_MS = 5 * 60 * 1000;
const POLL_MS = 3000;
const POLL_MAX_MS = 20000;
const ATTEMPT_KEY = 'co-attempt-v1';
const POPULAR_BANKS = ['SBIN', 'HDFC', 'ICIC', 'UTIB', 'KKBK', 'PUNB_R', 'BARB_R', 'YESB'];
const DEMO_METHOD = { gpay: 'Google Pay', netbanking: 'Net banking', card: 'Card', upi: 'UPI' };

function fmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
const itineraryHref = (id) => `/itinerary?trip=${enc(id)}`;
const newKey = () => `att_${(crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`)}`;

/* ---------- API ---------- */
class NetError extends Error {}           // offline, timeout, 5xx, rate limit: friendly retry
class ApiError extends Error {            // the server said no (4xx): show its plain message
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
const errText = (d) => (typeof d?.error === 'string' ? d.error : d?.error?.message) || '';

async function api(path, { method = 'GET', body, key, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    const headers = {};
    if (body) headers['content-type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal, credentials: 'same-origin' });
  } catch {
    throw new NetError("We couldn't reach our server. Check your internet connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 429) throw new NetError('Too many tries in a short time. Wait a minute, then try again.');
  if (r.status >= 500) throw new NetError(errText(data) || 'Our payment service is busy right now. Please try again in a moment.');
  if (!r.ok) throw new ApiError(errText(data) || 'Something went wrong. Please try again.', r.status, data?.code || data?.error?.code);
  return data;
}

// Plain-language reason for a failed payment (Razorpay error objects, server errors, strings).
const REASONS = [
  [/cancel|dismiss|closed/i, 'You cancelled the payment. No money was taken.'],
  [/insufficient|balance/i, "Your account didn't have enough balance for this payment."],
  [/\bpin\b|incorrect_pin/i, 'The UPI PIN was wrong. Try again with the right PIN.'],
  [/expired|timed?[\s_]?out/i, 'The payment request expired before it was approved.'],
  [/limit/i, "This amount is above your bank's limit. Try another method or account."],
  [/authenticat|otp|3ds/i, "The card or bank check (OTP) didn't complete."],
  [/technical|bank_down|server|gateway/i, 'Your bank had a technical problem. Try again in a few minutes, or use another method.'],
  [/vpa|upi id/i, "That UPI ID can't receive payment requests. Check it, or scan the QR instead."],
  [/demo/i, 'The demo bank declined this practice payment.'],
  [/declin|reject|fail/i, 'Your bank or UPI app declined the payment.'],
];
function plainReason(err) {
  const text = typeof err === 'string' ? err : [err?.reason, err?.code, err?.description].filter(Boolean).join(' ');
  for (const [re, msg] of REASONS) if (re.test(text)) return msg;
  return 'The payment did not go through. No money was taken, or any deducted amount comes back automatically.';
}

/* ---------- Adapters: one interface for server orders and device-only trip bookings ---------- */
function normalise(s, attempt) {
  const txn = s.transaction || {};
  if (s.status === 'paid') return { state: 'paid', paymentId: s.reference || txn.paymentId || '' };
  if (s.status === 'cancelled' || s.status === 'refunded') return { state: 'failed', reason: s.status === 'refunded' ? 'This order was refunded.' : 'This order was cancelled.' };
  if (s.status === 'verifying') return { state: 'verifying' };
  const mine = !attempt || !attempt.txn || txn.id === attempt.txn;
  // A failure that was already there when this attempt started is an old one, not an answer.
  const old = attempt?.baseline && attempt.baseline.status === 'failed' && attempt.baseline.paymentId === (txn.paymentId || '');
  if (txn.status === 'failed' && mine && !old) return { state: 'failed', reason: txn.error || 'declined' };
  return { state: 'pending', txn };
}

function serverAdapter(orderId, token) {
  const who = { orderId, t: token };
  const qs = `orderId=${enc(orderId)}&t=${enc(token)}`;
  return {
    kind: 'server',
    ref: orderId,
    load: () => api(`/api/orders/${enc(orderId)}?t=${enc(token)}`),
    start: (key) => api('/api/pay/order', { method: 'POST', body: who, key }),
    upi: (flow, vpa, key) => (flow === 'collect'
      ? api('/api/pay/upi/collect', { method: 'POST', body: { ...who, vpa }, key })
      : api(`/api/pay/upi/${flow}?${qs}`)),
    status: async (attempt) => normalise(await api(`/api/pay/status/${enc(orderId)}?t=${enc(token)}`), attempt),
    raw: () => api(`/api/pay/status/${enc(orderId)}?t=${enc(token)}`),
    demo: async (outcome, method, key) => normalise(await api('/api/pay/demo', { method: 'POST', body: { ...who, outcome, method }, key })),
    verify: async (resp, key) => normalise(await api('/api/pay/verify', { method: 'POST', body: { ...who, ...resp }, key })),
    failed: (err, key) => api('/api/pay/failed', { method: 'POST', key, body: { ...who, error: err, razorpay_order_id: err?.metadata?.order_id, razorpay_payment_id: err?.metadata?.payment_id } }),
    claimUtr: (utr) => api(`/api/orders/${enc(orderId)}/upi-claim`, { method: 'POST', body: { t: token, utr } }),
  };
}

// A trip booking saved in this browser: practice payment, same screens as the server demo.
function localAdapter(bk) {
  const read = () => getBooking(bk.id) || bk;
  const status = (attempt) => {
    const b = read();
    if (b.status === 'paid') return { state: 'paid', paymentId: b.paymentReference || '' };
    if (b.status === 'failed' && (!attempt || Date.parse(b.failedAt || 0) >= attempt.startedAt)) return { state: 'failed', reason: b.failureReason || 'declined' };
    return { state: 'pending' };
  };
  return {
    kind: 'local',
    ref: bk.id,
    start: async () => ({ amount: Math.round(Number(read().amount || 0) * 100), currency: 'INR', mode: 'demo', payment: { mode: 'demo' } }),
    // Device-only bookings have no server order/token for a second phone to open.
    upi: async (flow) => ({ flow, transactionId: `local-${Date.now()}` }),
    status: async (attempt) => status(attempt),
    raw: async () => ({}),
    demo: async (outcome, method) => {
      if (outcome !== 'success') {
        const r = markFailed(bk.id, 'Declined by the demo bank');
        return { state: 'failed', reason: r.booking?.failureReason || 'demo declined' };
      }
      const seat = recordSeat(`DEMO-${Date.now().toString(36).toUpperCase()}`, method);
      if (!seat.ok) throw new ApiError(seat.message, 422);
      return status(null);
    },
  };
}

const travellersOf = (b) => (Array.isArray(b?.travellers) && b.travellers.length ? b.travellers : b ? [{ name: b.name, phone: b.phone, lead: true }] : []);

// Count one seat per traveller and mark the device booking paid (demo payment or a server payment).
function recordSeat(reference, method) {
  const b = S.booking && (getBooking(S.booking.id) || S.booking);
  if (!b) return { ok: true };
  if (b.status === 'paid') return { ok: true };
  const trip = getTrip(b.tripId);
  const members = read(KEYS.groupJoins, {})?.[b.tripId] || [];
  const newSeats = travellersOf(b).filter((t) => !members.some((m) => m.phone === t.phone)).length;
  if (trip && newSeats > trip.seatsLeft) {
    return { ok: false, message: `Only ${trip.seatsLeft} seat${trip.seatsLeft === 1 ? ' is' : 's are'} left on this trip, so no payment was recorded. Book fewer travellers.` };
  }
  for (const t of travellersOf(b)) {
    const seat = joinTrip(b.tripId, { name: t.name, phone: t.phone, pickupId: b.pickupId, budgetConfirmed: true });
    // Already joined with this number (e.g. a retry after success on another tab) still counts as a seat.
    if (!seat.ok && !(seat.errors?.phone || '').includes('already')) {
      return { ok: false, message: seat.reason === 'full' ? 'This trip has filled up, so no payment was recorded. Choose another trip.' : `We could not confirm the seat for ${t.name}. No payment was recorded.` };
    }
  }
  const res = markPaid(b.id, { method, reference });
  S.booking = getBooking(b.id) || res.booking || b;
  return { ok: true };
}

/* ---------- State ---------- */
const query = new URLSearchParams(location.search);
const S = {
  cfg: null,
  adapter: null,
  order: null,          // server order (kit links or a catalog trip)
  booking: null,        // device trip booking
  trip: null,
  session: null,        // /api/pay/order payment block (Razorpay order id ...)
  amount: 0,
  currency: 'INR',
  method: 'upi',
  busy: false,
  attempt: null,        // current UPI / checkout attempt
  banks: null,
  bank: null,
  rzpError: null,
  demo: true,
};

/* ---------- Screens ---------- */
const SECTIONS = ['co-loading', 'co-start', 'co-main', 'co-missing', 'co-success', 'co-failure'];
function show(section) {
  SECTIONS.forEach((id) => { $(id).hidden = id !== section; });
  const noSteps = ['co-missing', 'co-start', 'co-loading'].includes(section);
  $('checkout-progress').hidden = noSteps;
  $('checkout-step').hidden = noSteps;
  $('checkout-title').textContent = section === 'co-start' ? 'Your trip details' : section === 'co-missing' ? 'Choose a trip first' : 'Confirm and pay';
  const el = $(section);
  if (!['co-main', 'co-start', 'co-loading'].includes(section)) {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }
}

function showMissing(title, text) {
  $('missing-title').textContent = title;
  if (text) $('missing-text').textContent = text;
  show('co-missing');
}

/* ---------- Loading + errors ---------- */
function setBusy(btn, on, text) {
  S.busy = on;
  document.querySelectorAll('#co-pay .btn, #gw .btn').forEach((b) => { if (b !== btn && b.id !== 'wait-cancel') b.disabled = on; });
  $('co-pay').setAttribute('aria-busy', String(on));
  if (!btn) return;
  const label = btn.querySelector('.btn__label');
  if (on) {
    btn.dataset.label = label.textContent;
    label.innerHTML = `<span class="btn-spin" aria-hidden="true"></span>${text || 'Please wait…'}`;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
  } else {
    if (btn.dataset.label) label.textContent = btn.dataset.label;
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  }
}
const say = (text) => { $('pay-status').textContent = text || ''; };

let retryAction = null;
function showNetError(message, retry) {
  retryAction = retry;
  $('net-error-text').textContent = message;
  $('net-error').hidden = false;
}
function hideNetError() { $('net-error').hidden = true; retryAction = null; }
function handleError(e, retry) {
  if (e instanceof NetError) { showNetError(e.message, retry); return; }
  hideNetError();
  if (e instanceof ApiError && e.status === 409) { refreshFinal(); return; }
  say(e.message || 'Something went wrong. Please try again.');
}
$('net-retry').addEventListener('click', () => { const fn = retryAction; hideNetError(); if (fn) fn(); });

// The order may already be paid (another tab, the phone, a webhook): show the real result.
async function refreshFinal() {
  try {
    const r = await S.adapter.status(null);
    if (r.state === 'paid') return success(r);
    if (r.state === 'verifying') return verifying();
    say('This order can no longer be paid here. Refresh the page to see its latest status.');
  } catch (e) { handleError(e, refreshFinal); }
}

/* ---------- Budget gate (group trips) ---------- */
function budgetConfirmed() {
  if (!S.booking) return true;
  const ok = $('budget-ok').checked;
  $('budget-err').textContent = ok ? '' : `Tick the box to confirm you can pay the full ${money(S.amount)}.`;
  if (!ok) { $('budget-ok').focus(); $('budget-box').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' }); }
  return ok;
}
$('budget-ok').addEventListener('change', () => { if ($('budget-ok').checked) $('budget-err').textContent = ''; });
$('start-budget').addEventListener('change', () => { if ($('start-budget').checked) $('start-budget-error').textContent = ''; });

/* ---------- Summary ---------- */
function row(name, on) { const el = document.querySelector(`[data-row="${name}"]`); if (el) el.hidden = !on; }

const seatsText = (n) => `${n} seat${n === 1 ? '' : 's'}`;
// Every traveller on its own line: name, WhatsApp number, and the lead booker marked.
function renderTravellers(list) {
  const ol = $('s-travellers');
  ol.textContent = '';
  list.forEach((t, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'co-trav__name';
    name.textContent = t.name || `Traveller ${i + 1}`;
    li.append(name);
    if (t.lead || i === 0) { const tag = document.createElement('span'); tag.className = 'co-trav__tag'; tag.textContent = 'Lead'; li.append(' ', tag); }
    if (t.phone) { const p = document.createElement('span'); p.className = 'co-trav__sub co-mono'; p.textContent = t.phone; li.append(p); }
    ol.append(li);
  });
  $('s-trav-label').textContent = list.length > 1 ? `Travellers (${list.length})` : 'Traveller';
  row('travellers', list.length > 0);
}

function renderSummary() {
  $('s-amount').textContent = money(S.amount, S.currency);
  $('pay-amount').textContent = money(S.amount, S.currency);
  $('gw-amount').textContent = money(S.amount, S.currency);
  $('upi-pay').querySelector('.btn__label').textContent = `Pay ${money(S.amount, S.currency)}`;
  if (S.booking) {
    const b = S.booking;
    const trip = S.trip;
    const pickup = b.pickupLabel || getPickupPoint(b.pickupId)?.label || '';
    $('summary-title').textContent = 'Your trip';
    $('s-title').textContent = b.tripTitle || trip?.title || 'Group trip';
    $('s-dest').textContent = b.destination || trip?.destination || '';
    $('s-date').textContent = fmtDate(b.date || trip?.date);
    $('s-pickup').textContent = pickup;
    $('s-drop').textContent = `${trip?.dropNote || DROP_NOTE} (${pickup})`;
    $('s-ref').textContent = String(S.order?.id || b.id).toUpperCase();
    // Server order: its own traveller list (what was charged); device booking: what was entered.
    const travellers = S.order?.travellers?.length ? S.order.travellers : travellersOf(b);
    const n = travellers.length;
    const each = Math.round(S.amount / Math.max(1, n));
    // Every traveller is listed by name (lead first), so the seat count is visible at a glance.
    row('name', n === 0);
    $('s-name-label').textContent = 'Traveller';
    $('s-name').textContent = b.name || '';
    row('price', true);
    $('s-price').textContent = `${money(each, S.currency)} × ${seatsText(n)} = ${money(S.amount, S.currency)}`;
    renderTravellers(travellers);
    $('s-note').textContent = n > 1 ? `Full trip budget for ${n} travellers, all in. There are no hidden fees at payment.` : 'Full trip budget per person, all in. There are no hidden fees at payment.';
    $('budget-box').hidden = false;
    $('budget-ok-label').textContent = `I confirm I can pay the full trip budget of ${money(S.amount)}.`;
    if (trip) $('s-seats').textContent = trip.isFull ? 'This trip has filled up. Payment cannot confirm a new seat.' : `${trip.seatsLeft} of ${trip.seatsTotal} seats left · ${trip.filledPercent}% filled`;
    return;
  }
  const o = S.order;
  $('summary-title').textContent = 'Your order';
  $('s-title').textContent = o.items.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)).join(', ');
  ['dest', 'pickup', 'drop', 'travellers', 'price'].forEach((n) => row(n, false));
  row('date', !!o.date);
  $('s-date').textContent = fmtDate(o.date);
  row('name', !!o.customer);
  $('s-name').textContent = o.customer || '';
  if (o.travellers?.length > 1) { $('s-name-label').textContent = 'Lead traveller'; renderTravellers(o.travellers); }
  $('s-ref').textContent = o.id.slice(-10).toUpperCase();
  $('s-note').textContent = 'Total worked out by our server from current prices. No extra fees at payment.';
  $('budget-box').hidden = true;
}

function renderMode() {
  const cfg = S.cfg;
  const local = S.adapter.kind === 'local';
  const banner = $('mode-banner');
  if (S.demo) {
    $('mode-tag').textContent = 'DEMO MODE';
    $('mode-text').textContent = local
      ? 'Practice payment: online payment for this trip is not switched on yet. No real money moves.'
      : (cfg.notice || 'No real money moves. This shows how paying will work.');
    banner.hidden = false;
    $('secure-text').textContent = 'Demo mode: practice payments only. No card, bank or UPI details are sent anywhere.';
  } else if (cfg.testMode) {
    $('mode-tag').textContent = 'TEST MODE';
    $('mode-text').textContent = cfg.notice || 'Razorpay test mode: no real money moves.';
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
  if (cfg.warning && !local) say(`Online payments are paused (${cfg.warning}). You can still finish a demo payment.`);

  // Which methods and UPI ways this mode supports.
  // A device-only practice payment offers every method, whatever the server's mode.
  const methods = (!local && cfg.methods) || ['upi', 'card', 'netbanking'];
  const direct = S.cfg.mode === 'upi' && !local;
  const avail = { upi: methods.includes('upi'), gpay: methods.includes('upi') && !direct, netbanking: methods.includes('netbanking'), card: methods.includes('card') };
  document.querySelectorAll('input[name="method"]').forEach((r) => { r.closest('.pm__opt').hidden = !avail[r.value]; });
  const flows = (!local && cfg.upiFlows) || ['intent', 'qr', 'collect'];
  const collect = flows.includes('collect');
  $('upi-form').hidden = !collect;
  $('upi-form').nextElementSibling.hidden = !collect; // the "or" divider
  $('upi-qr-btn').hidden = !flows.includes('qr');
  $('upi-intent').hidden = !flows.includes('intent');
  $('upi-intent-hint').hidden = !flows.includes('intent');
  $('utr-form').hidden = !direct;
}

function showModeNotice(cfg) {
  const banner = $('mode-banner');
  if (cfg.mode === 'demo') {
    $('mode-tag').textContent = 'DEMO MODE';
    $('mode-text').textContent = cfg.notice || 'Demo mode: no real money moves on this page.';
    banner.hidden = false;
  } else if (cfg.testMode) {
    $('mode-tag').textContent = 'TEST MODE';
    $('mode-text').textContent = cfg.notice || 'Razorpay test mode: no real money moves.';
    banner.hidden = false;
  }
}

/* ---------- Method selector ---------- */
function selectMethod(method, { focus = false } = {}) {
  S.method = method;
  const radio = document.querySelector(`input[name="method"][value="${method}"]`);
  if (radio) { radio.checked = true; if (focus) radio.focus(); }
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== method; });
  say('');
  hideNetError();
  if (method === 'netbanking') loadBanks();
}
document.querySelectorAll('input[name="method"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) selectMethod(r.value); }));

/* ---------- UPI: typed UPI ID ---------- */
const vpaInput = $('vpa');
let vpaTimer = 0;
let vpaChecked = { vpa: '', valid: false };
function vpaFormatError(v) {
  if (!v) return 'Enter your UPI ID, for example priya@okaxis.';
  if (!v.includes('@')) return 'A UPI ID has an @ in it, for example priya@okaxis.';
  if (!VPA_RE.test(v)) return "That doesn't look like a UPI ID. Check it in your UPI app (for example 98xxxxxx10@ybl).";
  return '';
}
function showVpa(error, ok) {
  $('vpa-error').textContent = error || '';
  $('vpa-ok').textContent = ok || '';
  if (error) vpaInput.setAttribute('aria-invalid', 'true'); else vpaInput.removeAttribute('aria-invalid');
}
vpaInput.addEventListener('input', () => {
  clearTimeout(vpaTimer);
  const v = vpaInput.value.trim();
  vpaChecked = { vpa: '', valid: false };
  $('vpa-ok').textContent = '';
  // Live format check while typing; only complain once it looks finished.
  vpaTimer = setTimeout(() => {
    if (!v) return showVpa('');
    if (v.includes('@') && v.split('@')[1].length >= 2) showVpa(vpaFormatError(v));
    else if ($('vpa-error').textContent) showVpa(vpaFormatError(v));
  }, 300);
});
vpaInput.addEventListener('blur', () => { const v = vpaInput.value.trim(); if (v && !vpaFormatError(v)) checkVpa(v).catch(() => {}); else if (v) showVpa(vpaFormatError(v)); });

// Server check (format everywhere; Razorpay's lookup when keys are set). Offline: format is enough.
async function checkVpa(v) {
  if (vpaChecked.vpa === v) return vpaChecked.valid;
  let r;
  try { r = await api('/api/pay/vpa/validate', { method: 'POST', body: { vpa: v } }); } catch (e) {
    if (e instanceof NetError) return true;
    throw e;
  }
  if (vpaInput.value.trim() !== v) return false;
  vpaChecked = { vpa: v, valid: !!r.valid };
  if (!r.valid) showVpa(r.reason || vpaFormatError(v) || 'Check the UPI ID.');
  else showVpa('', r.name ? `UPI ID verified: ${r.name}` : r.checked === 'razorpay' ? 'UPI ID verified.' : 'UPI ID looks right.');
  return !!r.valid;
}

$('upi-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (S.busy || !budgetConfirmed()) return;
  const v = vpaInput.value.trim();
  const fmt = vpaFormatError(v);
  if (fmt) { showVpa(fmt); vpaInput.focus(); return; }
  const btn = $('upi-pay');
  setBusy(btn, true, 'Checking UPI ID…');
  try {
    if (!(await checkVpa(v))) { setBusy(btn, false); vpaInput.focus(); return; }
  } catch (err) { setBusy(btn, false); handleError(err); return; }
  setBusy(btn, false);
  startUpi('collect', v);
});

/* ---------- UPI: start (collect / intent / qr) ---------- */
async function startUpi(flow, vpa, key = newKey()) {
  if (S.busy) return;
  const btn = flow === 'collect' ? $('upi-pay') : flow === 'qr' ? $('upi-qr-btn') : $('upi-intent');
  hideNetError();
  say('');
  setBusy(btn, true, flow === 'collect' ? 'Sending request…' : flow === 'qr' ? 'Making QR…' : 'Opening…');
  let r;
  try {
    r = await S.adapter.upi(flow, vpa, key);
  } catch (e) {
    setBusy(btn, false);
    handleError(e, () => startUpi(flow, vpa, key));
    return;
  }
  setBusy(btn, false);
  const expiresAt = flow === 'qr' && r.closeBy ? Math.min(r.closeBy * 1000, Date.now() + 15 * 60 * 1000) : Date.now() + UPI_WAIT_MS;
  const attempt = { ref: S.adapter.ref, flow, method: 'upi', vpa: r.vpa || vpa || '', txn: r.transactionId || '', startedAt: Date.now(), expiresAt, key };
  setAttempt(attempt);
  takeBaseline(attempt);

  if (flow === 'qr') renderQr(r);
  if (flow === 'intent') {
    const link = r.link || r.qr || '';
    if (/^upi:/i.test(link) && isPhone()) location.href = link;
    else if (/^https?:/i.test(link)) window.open(link, '_blank', 'noopener');   // demo: the practice "UPI app" page
  }
  showWait(attempt);
}

// Remember the transaction's state when the attempt starts, so an older failure isn't read as the answer.
function takeBaseline(attempt) {
  if (S.adapter.kind !== 'server') return;
  S.adapter.raw().then((s) => {
    if (!attempt.baseline) attempt.baseline = { status: s.transaction?.status || '', paymentId: s.transaction?.paymentId || '' };
  }).catch(() => {});
}

/* QR */
function renderQr(r) {
  const box = $('upi-qr-box');
  box.textContent = '';
  const text = r.qr || r.link || '';
  if (r.qrImage) {
    const img = new Image(240, 240);
    img.src = r.qrImage;
    img.alt = S.demo ? 'Demo UPI QR code. It is a sample and takes no real money.' : `UPI QR code to pay ${money(S.amount)} to ${S.cfg.upiPayee || S.cfg.business}`;
    img.decoding = 'async';
    box.append(img);
  } else if (text && typeof window.qrcode === 'function') {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    const svg = box.querySelector('svg');
    if (svg) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `UPI QR code to pay ${money(S.amount)}`); }
  } else if (text) {
    const a = document.createElement('a');
    a.href = text;
    a.textContent = 'Open the payment link';
    box.append(a);
  } else if (S.adapter.kind === 'local') {
    const note = document.createElement('p');
    note.textContent = 'A scannable QR needs a server order. Use the demo approval buttons below for this practice booking.';
    box.append(note);
  }
  $('upi-qr-cap').textContent = S.adapter.kind === 'local'
    ? 'Practice booking: no real money moves. Use the demo buttons below to finish.'
    : S.demo
      ? "Demo QR: scanning opens this site's practice payment page on your phone."
      : `Scan with GPay, PhonePe, Paytm or BHIM to pay ${money(S.amount)}.`;
}
$('upi-qr-btn').addEventListener('click', () => { if (budgetConfirmed()) startUpi('qr'); });
$('upi-intent').addEventListener('click', () => {
  if (!budgetConfirmed()) return;
  // A real UPI app link only works on a phone: on a computer, show the QR straight away.
  if (!S.demo && !isPhone()) { startUpi('qr').then(() => { $('wait-status').textContent = 'Open UPI app needs a phone. Scan this QR with your phone instead.'; }); return; }
  startUpi('intent');
});

/* Direct UPI: the buyer enters their UTR after paying */
$('utr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (S.busy || !budgetConfirmed()) return;
  const utr = $('utr').value.replace(/\s/g, '');
  $('utr-error').textContent = /^[A-Za-z0-9]{6,35}$/.test(utr) ? '' : 'Enter the 12-digit UPI reference (UTR) shown in your payment app.';
  if ($('utr-error').textContent) { $('utr').focus(); return; }
  const btn = $('utr-send');
  setBusy(btn, true, 'Sending…');
  try { await S.adapter.claimUtr(utr); setBusy(btn, false); verifying(); } catch (err) { setBusy(btn, false); handleError(err, () => $('utr-form').requestSubmit()); }
});

/* ---------- UPI waiting screen ---------- */
function showWait(attempt) {
  $('pm-choose').hidden = true;
  $('upi-wait').hidden = false;
  $('wait-spin').classList.remove('is-stopped');
  $('wait-retry').hidden = true;
  $('wait-demo').hidden = !S.demo;
  const qr = attempt.flow === 'qr';
  $('upi-qr').hidden = !qr || !$('upi-qr-box').firstChild;
  $('wait-title').textContent = qr ? 'Scan the QR to pay' : attempt.flow === 'collect' ? 'Approve the payment in your UPI app' : 'Finish the payment in your UPI app';
  $('wait-text').innerHTML = '';
  if (attempt.flow === 'collect') {
    $('wait-text').append(`We sent a request for ${money(S.amount)} to `);
    const v = document.createElement('strong'); v.className = 'co-mono'; v.textContent = attempt.vpa;
    $('wait-text').append(v, '. Open your UPI app, check the amount and enter your UPI PIN.');
  } else if (qr) {
    $('wait-text').textContent = 'Pay with any UPI app. This screen updates by itself once the payment is done.';
  } else {
    $('wait-text').textContent = S.demo ? 'Demo mode: in live mode this opens GPay, PhonePe, Paytm or BHIM with the amount filled in.' : 'Your UPI app opened with the amount filled in. Pay there, then come back to this page.';
  }
  $('wait-status').textContent = 'Waiting for your approval…';
  $('upi-wait').focus({ preventScroll: true });
  $('co-pay').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  startPolling(attempt);
}
function closeWait() {
  $('upi-wait').hidden = true;
  $('upi-qr').hidden = true;
  $('upi-qr-box').textContent = '';
  $('pm-choose').hidden = false;
}
$('wait-cancel').addEventListener('click', async () => {
  const a = S.attempt;
  stopPolling();
  clearAttempt();
  closeWait();
  say('Payment cancelled. If you already approved it in your UPI app, we will still record it. Pick a method to pay again.');
  selectMethod('upi', { focus: true });
  // One late check: an approval that raced the cancel still counts.
  if (a) try { const r = await S.adapter.status(a); if (r.state === 'paid') success(r); } catch { /* ignore */ }
});
$('wait-retry').addEventListener('click', () => {
  const a = S.attempt || {};
  closeWait();
  if (a.flow === 'collect' && a.vpa) startUpi('collect', a.vpa);
  else startUpi(a.flow || 'qr', a.vpa);
});
$('wait-demo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-demo]');
  if (b) demoPay(b.dataset.demo, 'upi', b);
});

/* ---------- Status polling (3 s, backing off on network trouble) ---------- */
const poll = { timer: 0, tick: 0, delay: POLL_MS, attempt: null, warned: false };
function startPolling(attempt) {
  stopPolling();
  poll.attempt = attempt;
  poll.delay = POLL_MS;
  poll.warned = false;
  poll.inflight = false;
  updateTimer();
  poll.tick = setInterval(updateTimer, 1000);
  poll.timer = setTimeout(checkNow, POLL_MS);
}
function stopPolling() {
  clearTimeout(poll.timer);
  clearInterval(poll.tick);
  poll.timer = 0;
  poll.tick = 0;
  poll.attempt = null;
}
function updateTimer() {
  const a = poll.attempt;
  if (!a) return;
  const left = Math.max(0, a.expiresAt - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $('wait-timer').textContent = `${m}:${String(s).padStart(2, '0')}`;
  if (left <= 60000 && !poll.warned) { poll.warned = true; $('wait-status').textContent = 'About 1 minute left.'; }
  if (left === 0) { clearInterval(poll.tick); checkNow(true); }
}
async function checkNow(final = false) {
  const a = poll.attempt;
  if (!a || poll.inflight) return;
  clearTimeout(poll.timer);
  poll.inflight = true;
  try {
    const r = await S.adapter.status(a);
    poll.inflight = false;
    if (poll.attempt !== a) return;
    poll.delay = POLL_MS;
    if (r.state === 'paid') return success(r);
    if (r.state === 'failed') return failure(r.reason);
    if (r.state === 'verifying') return verifying();
    if ($('wait-status').dataset.weak) { delete $('wait-status').dataset.weak; $('wait-status').textContent = 'Waiting for your approval…'; }
  } catch (e) {
    poll.inflight = false;
    if (poll.attempt !== a) return;
    if (e instanceof ApiError) { expire(a, e.message); return; }
    poll.delay = Math.min(poll.delay * 2, POLL_MAX_MS);
    $('wait-status').dataset.weak = '1';
    $('wait-status').textContent = 'Your connection is weak. Still checking your payment…';
  }
  if (final || Date.now() >= a.expiresAt) return expire(a);
  poll.timer = setTimeout(checkNow, poll.delay);
}
function expire(a, message) {
  stopPolling();
  $('wait-spin').classList.add('is-stopped');
  $('upi-qr').hidden = true;
  $('wait-title').textContent = a.flow === 'qr' ? 'The QR code expired' : 'The request expired';
  $('wait-status').textContent = message || `It was not paid in time, so no money was taken. Retry to get a new ${a.flow === 'qr' ? 'QR code' : 'request'}, or cancel to pick another method.`;
  $('wait-timer').textContent = '0:00';
  $('wait-retry').hidden = false;
  $('wait-retry').focus();
}
// Back from the UPI app or the bank: check straight away instead of waiting for the next tick.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && poll.attempt) checkNow(); });

/* ---------- Attempt memory (survives a reload or a return from the bank / UPI app) ---------- */
function setAttempt(a) { S.attempt = a; try { sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(a)); } catch { /* private mode */ } }
function clearAttempt() { S.attempt = null; try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* ignore */ } }
function savedAttempt() {
  try {
    const a = JSON.parse(sessionStorage.getItem(ATTEMPT_KEY) || 'null');
    return a && a.ref === S.adapter.ref ? a : null;
  } catch { return null; }
}

/* ---------- Razorpay Checkout (Google Pay, net banking, cards) ---------- */
let rzpScript = null;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (rzpScript) return rzpScript;
  rzpScript = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { rzpScript = null; s.remove(); reject(new NetError("The secure payment window couldn't load. Check your connection and try again.")); };
    document.head.append(s);
  });
  return rzpScript;
}

function displayConfig(method, bank) {
  const blocks = {
    gpay: { name: 'Pay with Google Pay', instruments: [{ method: 'upi', flows: ['intent'], apps: ['google_pay'] }, { method: 'upi', flows: ['qr', 'collect'] }] },
    card: { name: 'Pay by card', instruments: [{ method: 'card' }] },
    netbanking: { name: bank ? `Pay with ${bank.name}` : 'Net banking', instruments: [{ method: 'netbanking', ...(bank ? { banks: [bank.code] } : {}) }] },
  };
  return { display: { blocks: { chosen: blocks[method] }, sequence: ['block.chosen'], preferences: { show_default_blocks: false } } };
}

async function ensureSession(key) {
  if (S.session?.razorpayOrderId) return S.session;
  const r = await S.adapter.start(key);
  S.session = r.payment || null;
  if (!S.session?.razorpayOrderId) throw new ApiError('Online payment could not start for this order. Refresh the page and try again.', 400);
  return S.session;
}

async function payGateway(method, btn, key = newKey()) {
  if (S.busy || !budgetConfirmed()) return;
  hideNetError();
  say('');
  if (S.demo) { openGateway(method, btn); return; }
  if (!S.cfg.razorpayKeyId) { say('Online payments are not set up yet. Please contact us to finish your booking.'); return; }
  setBusy(btn, true, 'Opening secure window…');
  try {
    await loadRazorpay();
    const session = await ensureSession(key);
    S.rzpError = null;
    const prefill = {};
    Object.entries(session.prefill || {}).forEach(([k, v]) => { if (v) prefill[k] = v; });
    if (method === 'gpay' || method === 'card' || method === 'netbanking') prefill.method = method === 'gpay' ? 'upi' : method;
    const rz = new window.Razorpay({
      key: S.cfg.razorpayKeyId,            // public key id from /api/pay/config; the secret stays on the server
      amount: S.amount,
      currency: S.currency,
      order_id: session.razorpayOrderId,
      name: S.cfg.business,
      description: session.description || 'Trip booking',
      prefill,
      notes: { order_id: S.adapter.ref },
      theme: { color: '#000000' },
      config: displayConfig(method, method === 'netbanking' ? S.bank : null),
      retry: { enabled: true },
      handler: (resp) => onGatewaySuccess(resp, key),
      modal: { ondismiss: () => onGatewayClosed(), escape: true, confirm_close: true },
    });
    rz.on('payment.failed', (resp) => {
      S.rzpError = resp.error || { reason: 'payment_failed' };
      S.adapter.failed(resp.error || {}, key).catch(() => {});
    });
    setAttempt({ ref: S.adapter.ref, flow: 'checkout', method, startedAt: Date.now(), expiresAt: Date.now() + 30 * 60 * 1000, key });
    rz.open();
    setBusy(btn, false);
    say(`Secure payment window open. Finish paying there.`);
  } catch (e) {
    setBusy(btn, false);
    handleError(e, () => payGateway(method, btn, key));
  }
}

async function onGatewaySuccess(resp, key, tries = 0) {
  say('Payment received. Confirming it with the bank…');
  setBusy(null, true);
  try {
    const r = await S.adapter.verify(resp, key);
    setBusy(null, false);
    if (r.state === 'paid') return success(r);
    return refreshFinal();
  } catch (e) {
    if (e instanceof NetError && tries < 3) { setTimeout(() => onGatewaySuccess(resp, key, tries + 1), 1500 * 2 ** tries); return; }
    setBusy(null, false);
    // The webhook may still confirm it: keep checking instead of showing a failure.
    if (e instanceof NetError) { showWait({ ...S.attempt, flow: 'intent', expiresAt: Date.now() + UPI_WAIT_MS }); $('wait-title').textContent = 'Confirming your payment'; $('wait-text').textContent = 'Your payment went through at Razorpay. We are confirming it; this screen updates by itself.'; $('wait-demo').hidden = true; return; }
    failure(e.message);
  }
}

async function onGatewayClosed() {
  if (S.rzpError) { const err = S.rzpError; S.rzpError = null; clearAttempt(); failure(err); return; }
  say('Payment window closed. No money was taken. Pick a method to try again.');
  try { const r = await S.adapter.status(null); if (r.state === 'paid') success(r); } catch { /* ignore */ }
}

$('gpay-pay').addEventListener('click', (e) => payGateway('gpay', e.currentTarget));
$('card-pay').addEventListener('click', (e) => payGateway('card', e.currentTarget));
$('nb-pay').addEventListener('click', (e) => {
  if (!S.bank) {
    $('nb-error').textContent = 'Choose your bank first.';
    document.querySelector('#nb-popular input, #nb-list input')?.focus();
    return;
  }
  payGateway('netbanking', e.currentTarget);
});

/* ---------- Net banking: popular grid + searchable list ---------- */
async function loadBanks() {
  if (S.banks) return;
  $('nb-popular').innerHTML = '<p class="co-note">Loading banks…</p>';
  try {
    const r = await api('/api/pay/banks');
    S.banks = (r.banks || []).filter((b) => b && b.code && b.name);
  } catch (e) {
    $('nb-popular').innerHTML = '';
    const p = document.createElement('p');
    p.className = 'co-note';
    p.textContent = e instanceof NetError ? "We couldn't load the bank list. " : `${e.message} `;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost btn--sm';
    b.innerHTML = '<span class="btn__label">Try again</span>';
    b.addEventListener('click', loadBanks);
    $('nb-popular').append(p, b);
    return;
  }
  const popular = POPULAR_BANKS.map((c) => S.banks.find((b) => b.code === c)).filter(Boolean).slice(0, 6);
  $('nb-popular').innerHTML = '';
  popular.forEach((b) => $('nb-popular').append(bankOption(b, 'nb__tile')));
  renderBankList('');
}
function bankOption(b, cls) {
  const label = document.createElement('label');
  label.className = cls;
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'bank';
  input.value = b.code;
  input.checked = S.bank?.code === b.code;
  const name = document.createElement('span');
  name.textContent = b.name;
  label.append(input, name);
  input.addEventListener('change', () => { if (input.checked) chooseBank(b); });
  return label;
}
function chooseBank(b) {
  S.bank = b;
  $('nb-error').textContent = '';
  $('nb-pay').querySelector('.btn__label').textContent = `Pay ${money(S.amount)} with ${b.name}`;
}
function renderBankList(q) {
  const term = q.trim().toLowerCase();
  const list = (S.banks || []).filter((b) => !term || b.name.toLowerCase().includes(term) || b.code.toLowerCase().startsWith(term));
  const box = $('nb-list');
  box.innerHTML = '';
  list.forEach((b) => box.append(bankOption(b, 'nb__item')));
  $('nb-count').textContent = term
    ? (list.length ? `${list.length} bank${list.length === 1 ? '' : 's'} match “${q.trim()}”.` : `No bank matches “${q.trim()}”. Try a short name like SBI or HDFC.`)
    : `${list.length} banks available.`;
}
let nbTimer = 0;
$('nb-q').addEventListener('input', () => { clearTimeout(nbTimer); nbTimer = setTimeout(() => renderBankList($('nb-q').value), 150); });

/* ---------- Demo payments (no keys, or a device-only trip booking) ---------- */
async function demoPay(outcome, method, btn, key = newKey()) {
  if (S.busy) return;
  setBusy(btn, true, 'Processing…');
  try {
    const r = await S.adapter.demo(outcome, method, key);
    setBusy(btn, false);
    stopPolling();
    clearAttempt();
    if (r.state === 'paid') success(r);
    else failure(r.reason || 'demo declined');
  } catch (e) {
    setBusy(btn, false);
    handleError(e, () => demoPay(outcome, method, btn, key));
  }
}

const gw = $('gw');
const gwPanel = gw.querySelector('.gw__panel');
let gwOpener = null;
let gwMethod = 'card';
let gwBusy = false;
const focusables = () => [...gwPanel.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')]
  .filter((el) => !el.disabled && !el.closest('[hidden]'));

function openGateway(method, from) {
  gwMethod = method;
  gwOpener = from || document.activeElement;
  const bank = method === 'netbanking' && S.bank ? ` · ${S.bank.name}` : '';
  $('gw-method').textContent = method === 'gpay'
    ? 'Google Pay (practice). In live mode the GPay app opens to approve the payment.'
    : method === 'netbanking'
      ? `Net banking${bank} (practice). In live mode your bank's login page opens here.`
      : 'Card (practice). In live mode you enter your card in the secure Razorpay window.';
  setGwBusy(false);
  gw.hidden = false;
  document.documentElement.classList.add('gw-open');
  requestAnimationFrame(() => gw.classList.add('is-open'));
  $('gw-success').focus();
}
function closeGateway() {
  if (gwBusy) return;
  gw.classList.remove('is-open');
  gw.hidden = true;
  document.documentElement.classList.remove('gw-open');
  if (gwOpener && document.contains(gwOpener) && !gwOpener.closest('[hidden]')) gwOpener.focus();
}
function setGwBusy(on) {
  gwBusy = on;
  $('gw-form').hidden = on;
  $('gw-loading').hidden = !on;
  gwPanel.setAttribute('aria-busy', String(on));
  gw.querySelectorAll('button[data-gw-close]').forEach((b) => { b.disabled = on; });
  $('gw-live').textContent = on ? 'Processing demo payment' : '';
}
async function simulate(outcome) {
  if (gwBusy) return;
  setGwBusy(true);
  gwPanel.focus();
  const key = newKey();
  const wait = new Promise((r) => setTimeout(r, reduceMotion() ? 300 : 1200));
  let result;
  let error;
  try { [result] = await Promise.all([S.adapter.demo(outcome, gwMethod, key), wait]); } catch (e) { error = e; }
  setGwBusy(false);
  closeGateway();
  if (error) { handleError(error, () => openGateway(gwMethod, gwOpener)); return; }
  if (result.state === 'paid') success(result);
  else failure(result.reason || 'demo declined');
}
gw.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeGateway(); return; }
  if (e.key !== 'Tab') return;
  const list = focusables();
  if (!list.length) { e.preventDefault(); return; }
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && (document.activeElement === first || !gwPanel.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !gwPanel.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
});
gw.querySelectorAll('[data-gw-close]').forEach((el) => el.addEventListener('click', closeGateway));
$('gw-success').addEventListener('click', () => simulate('success'));
$('gw-failure').addEventListener('click', () => simulate('failed'));
gwPanel.tabIndex = -1;

/* ---------- Results ---------- */
function success(r) {
  stopPolling();
  clearAttempt();
  if (S.booking && S.adapter.kind === 'server') recordSeat(r.paymentId || S.order?.id || '', S.method);
  const b = S.booking && (getBooking(S.booking.id) || S.booking);
  const trip = b && getTrip(b.tripId);
  $('success-eyebrow').textContent = S.demo ? 'Demo payment successful' : 'Payment successful';
  $('r-amount').textContent = money(S.amount, S.currency);
  $('r-ref').textContent = String(S.order?.id || b?.id || '').toUpperCase();
  $('r-pay').textContent = r.paymentId || b?.paymentReference || '-';
  row('r-pickup', !!b);
  row('r-seats', !!trip);
  const group = b ? travellersOf(b) : (S.order?.travellers || []);
  row('r-trav', group.length > 0);
  $('r-trav').textContent = group.map((t) => t.name).join(', ');
  if (b) {
    const n = group.length;
    $('success-title').textContent = n > 1 ? `You're in. ${n} seats confirmed.` : "You're in. Seat confirmed.";
    $('success-text').textContent = n > 1
      ? `${b.name}, your payment for ${b.tripTitle} on ${fmtDate(b.date)} is recorded and all ${n} seats are counted.`
      : `${b.name}, your payment for ${b.tripTitle} on ${fmtDate(b.date)} is recorded and your seat is counted.`;
    $('r-pickup').textContent = `${b.pickupLabel}. ${DROP_NOTE}.`;
    $('r-seats').textContent = trip ? `${trip.seatsLeft} of ${trip.seatsTotal}` : '-';
    $('r-next').href = itineraryHref(b.tripId);
    $('r-next').querySelector('.btn__label').textContent = 'See your itinerary';
    $('success-note').textContent = `${S.demo ? 'This was a demo: no money moved. ' : ''}Screenshot this page and share it with the trip group on WhatsApp.`;
  } else {
    $('success-title').textContent = 'Payment received. Thank you!';
    $('success-text').textContent = `${S.order?.customer ? `${S.order.customer}, we` : 'We'} have your order and will contact you shortly.`;
    $('r-next').href = '/trips';
    $('r-next').querySelector('.btn__label').textContent = 'Plan your next trip';
    $('success-note').textContent = S.demo ? 'This was a demo: no money moved.' : 'Keep the order id and payment id for your records.';
  }
  show('co-success');
}

function verifying() {
  stopPolling();
  clearAttempt();
  $('success-eyebrow').textContent = 'Payment sent for checking';
  $('success-title').textContent = 'Thanks! We are checking your UPI payment';
  $('success-text').textContent = 'The owner confirms UPI payments by hand. You will get a message as soon as it is confirmed.';
  $('r-amount').textContent = money(S.amount, S.currency);
  $('r-ref').textContent = String(S.order?.id || '').toUpperCase();
  $('r-pay').textContent = 'Being checked';
  row('r-pickup', false);
  row('r-seats', false);
  row('r-trav', false);
  $('success-note').textContent = 'Keep your UPI reference until the payment is confirmed.';
  show('co-success');
}

function failure(reason) {
  stopPolling();
  clearAttempt();
  closeWait();
  $('failure-reason').textContent = plainReason(reason);
  show('co-failure');
}
$('retry').addEventListener('click', () => {
  show('co-main');
  selectMethod(S.method);
  say('Ready to try again.');
  const btn = { upi: $('upi-form').hidden ? $('upi-qr-btn') : vpaInput, gpay: $('gpay-pay'), netbanking: $('nb-pay'), card: $('card-pay') }[S.method];
  btn?.focus();
});
$('switch-method').addEventListener('click', () => {
  show('co-main');
  const opts = [...document.querySelectorAll('input[name="method"]')].filter((r) => !r.closest('.pm__opt').hidden);
  const next = opts.find((r) => r.value !== S.method) || opts[0];
  selectMethod(next.value, { focus: true });
  say('Pick another way to pay.');
});

/* ---------- Details step (group trips): seats + one card per traveller ----------
   Traveller 1 is the primary contact (name, WhatsApp, email, college / hostel); every other
   traveller gives a name and WhatsApp number. The server checks all of it again and charges
   price x travellers, whatever this page says. */
const MAX_TRAVELLERS = 6;
const MOBILE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const TRAVELLER_FIELDS = [
  { key: 'name', label: 'Full name', placeholder: 'As on ID', autocomplete: 'name', maxLength: 60 },
  { key: 'phone', label: 'Phone (WhatsApp)', placeholder: '10-digit mobile', type: 'tel', inputMode: 'numeric', autocomplete: 'tel-national', maxLength: 14 },
  { key: 'email', label: 'Email', placeholder: 'you@college.edu', type: 'email', autocomplete: 'email', maxLength: 200, leadOnly: true },
  { key: 'college', label: 'College / Hostel', placeholder: 'Optional', autocomplete: 'organization', maxLength: 80, leadOnly: true, optional: true },
];
function tenDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
// { field: message } for traveller i (earlier travellers own a repeated number).
function travellerErrors(t, i, all) {
  const e = {};
  const name = String(t.name || '').trim();
  if (name.length < 2 || !/\p{L}/u.test(name)) e.name = 'Enter the full name, as on ID.';
  const phone = tenDigits(t.phone);
  if (!String(t.phone || '').trim()) e.phone = 'Enter a 10-digit mobile number.';
  else if (!MOBILE_RE.test(phone)) e.phone = 'Enter a 10-digit Indian mobile number (starts with 6, 7, 8 or 9).';
  else if (all.some((o, j) => j < i && tenDigits(o.phone) === phone)) e.phone = 'Each traveller needs their own mobile number.';
  if (i === 0) {
    const email = String(t.email || '').trim();
    if (!email) e.email = 'Enter an email for booking updates.';
    else if (!EMAIL_RE.test(email)) e.email = "That email doesn't look right.";
  }
  return e;
}

function showStart(trip) {
  const price = Number(trip.price ?? trip.budgetPerPerson) || 0;
  const rupees = (r) => money(Math.round(r * 100));
  const seatsLeft = Number.isFinite(trip.seatsLeft) ? trip.seatsLeft : MAX_TRAVELLERS;
  const maxSeats = Math.max(0, Math.min(MAX_TRAVELLERS, seatsLeft));
  const want = Math.floor(Number(query.get('seats')) || 1);
  const F = { list: Array.from({ length: Math.max(1, Math.min(want, maxSeats || 1)) }, () => ({})), touched: new Set(), submitted: false };
  const box = $('travellers');
  const form = $('start-form');

  $('start-trip').textContent = `${trip.title} · ${fmtDate(trip.date)} · ${rupees(price)} per person`;
  $('start-back').href = itineraryHref(trip.id);
  const sel = $('start-pickup');
  sel.textContent = '';
  PICKUP_POINTS.forEach((p) => sel.append(new Option(p.label, p.id, p.id === trip.pickupPointId, p.id === trip.pickupPointId)));
  const img = $('bk-sum-img');
  if (trip.image) {
    img.src = trip.image;
    img.alt = trip.imageAlt || trip.coverAlt || trip.title;
    if (trip.imageWidth && trip.imageHeight) { img.width = trip.imageWidth; img.height = trip.imageHeight; }
    img.hidden = false;
  }
  $('bk-sum-title').textContent = trip.title;
  $('bk-sum-meta').textContent = [trip.destination, fmtDate(trip.date), trip.durationLabel].filter(Boolean).join(' · ');

  const collect = () => box.querySelectorAll('[data-i]').forEach((card) => {
    const t = F.list[Number(card.dataset.i)];
    if (t) card.querySelectorAll('input[data-key]').forEach((inp) => { t[inp.dataset.key] = inp.value; });
  });

  // Show (or clear) the errors of traveller i on the fields that were visited, or all after a submit.
  function paint(i) {
    const errs = travellerErrors(F.list[i], i, F.list);
    TRAVELLER_FIELDS.forEach((f) => {
      const input = $(`trav-${i}-${f.key}`);
      if (!input) return;
      const msg = (F.submitted || F.touched.has(`${i}:${f.key}`)) ? errs[f.key] || '' : '';
      $(`trav-${i}-${f.key}-error`).textContent = msg;
      if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    });
    return errs;
  }

  function card(i) {
    const lead = i === 0;
    const t = F.list[i];
    const el = document.createElement('div');
    el.className = 'bk-trav';
    el.dataset.i = String(i);
    el.setAttribute('role', 'group');
    el.setAttribute('aria-labelledby', `trav-${i}-title`);
    const head = document.createElement('div');
    head.className = 'bk-trav__head';
    const title = document.createElement('p');
    title.className = 'bk-trav__title';
    title.id = `trav-${i}-title`;
    title.textContent = lead ? 'Traveller 1 · Primary contact' : `Traveller ${i + 1}`;
    head.append(title);
    if (!lead) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'bk-trav__remove';
      rm.dataset.remove = String(i);
      rm.textContent = 'Remove';
      rm.setAttribute('aria-label', `Remove traveller ${i + 1}`);
      head.append(rm);
    }
    const grid = document.createElement('div');
    grid.className = 'bk-row';
    TRAVELLER_FIELDS.forEach((f) => {
      if (f.leadOnly && !lead) return;
      const id = `trav-${i}-${f.key}`;
      const wrap = document.createElement('div');
      wrap.className = 'bk-field';
      const label = document.createElement('label');
      label.className = 'bk-label';
      label.htmlFor = id;
      label.textContent = f.label;
      const input = document.createElement('input');
      Object.assign(input, { id, className: 'bk-input', type: f.type || 'text', placeholder: f.placeholder, maxLength: f.maxLength, value: t[f.key] || '' });
      input.dataset.key = f.key;
      if (f.inputMode) input.inputMode = f.inputMode;
      // Only traveller 1 is the person filling the form: no autofill of their own details into the others.
      input.autocomplete = lead ? f.autocomplete : 'off';
      if (!f.optional) { input.required = true; input.setAttribute('aria-required', 'true'); }
      if (f.key === 'name') input.autocapitalize = 'words';
      input.setAttribute('aria-describedby', `${id}-error`);
      const err = document.createElement('p');
      err.className = 'field-error';
      err.id = `${id}-error`;
      wrap.append(label, input, err);
      grid.append(wrap);
    });
    el.append(head, grid);
    return el;
  }

  function totals() {
    const n = F.list.length;
    $('seats-count').textContent = String(n);
    $('seats-minus').disabled = n <= 1;
    $('seats-plus').disabled = n >= maxSeats;
    $('seats-plus').setAttribute('aria-label', n >= maxSeats ? `Add a traveller (maximum ${maxSeats} reached)` : 'Add a traveller');
    $('seats-hint').textContent = `Max ${MAX_TRAVELLERS} per booking · ${seatsLeft} left on this trip`;
    $('bk-sum-line').textContent = `${rupees(price)} × ${seatsText(n)}`;
    $('bk-sum-sub').textContent = rupees(price * n);
    $('bk-sum-total').textContent = rupees(price * n);
    $('start-budget-label').textContent = n > 1
      ? `I confirm our group can pay the full trip budget of ${rupees(price * n)} (${rupees(price)} × ${n}).`
      : `I confirm I can pay the full trip budget of ${rupees(price)}.`;
    whoList();
  }

  // Summary card: one line per traveller, filled in as names and numbers are typed.
  function whoList() {
    const ol = $('bk-sum-trav');
    ol.textContent = '';
    F.list.forEach((t, i) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      const typed = String(t.name || '').trim();
      name.className = typed ? 'co-trav__name' : 'co-trav__name is-empty';
      name.textContent = typed || (i === 0 ? 'Traveller 1 (you)' : `Traveller ${i + 1}`);
      li.append(name);
      if (i === 0) { const tag = document.createElement('span'); tag.className = 'co-trav__tag'; tag.textContent = 'Lead'; li.append(' ', tag); }
      const phone = tenDigits(t.phone);
      if (MOBILE_RE.test(phone)) { const p = document.createElement('span'); p.className = 'co-trav__sub co-mono'; p.textContent = phone; li.append(p); }
      ol.append(li);
    });
  }

  function renderCards() {
    box.textContent = '';
    F.list.forEach((_, i) => box.append(card(i)));
    F.list.forEach((_, i) => paint(i));
    totals();
  }

  function setCount(n) {
    collect();
    const next = Math.max(1, Math.min(maxSeats || 1, n));
    const grew = next > F.list.length;
    while (F.list.length < next) F.list.push({});
    F.list.length = next;
    renderCards();
    if (grew) $(`trav-${next - 1}-name`)?.focus();
  }
  $('seats-minus').addEventListener('click', () => { setCount(F.list.length - 1); $('seats-minus').disabled ? $('seats-plus').focus() : $('seats-minus').focus(); });
  $('seats-plus').addEventListener('click', () => setCount(F.list.length + 1));

  box.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (!rm) return;
    collect();
    const i = Number(rm.dataset.remove);
    F.list.splice(i, 1);
    // Keep "visited" marks with the traveller they belong to.
    F.touched = new Set([...F.touched].map((k) => k.split(':')).filter(([j]) => Number(j) !== i)
      .map(([j, f]) => `${Number(j) > i ? Number(j) - 1 : j}:${f}`));
    renderCards();
    ($(`trav-${Math.min(i, F.list.length - 1)}-name`) || $('seats-plus')).focus();
  });
  box.addEventListener('focusout', (e) => {
    const input = e.target.closest('input[data-key]');
    if (!input) return;
    const i = Number(input.closest('[data-i]').dataset.i);
    collect();
    if (input.value.trim()) F.touched.add(`${i}:${input.dataset.key}`);
    paint(i);
  });
  box.addEventListener('input', (e) => {
    const input = e.target.closest('input[data-key]');
    if (!input) return;
    collect();
    if (input.dataset.key === 'name' || input.dataset.key === 'phone') whoList();
    if (input.getAttribute('aria-invalid') === 'true') paint(Number(input.closest('[data-i]').dataset.i));
  });

  renderCards();
  if (!maxSeats) {
    $('start-error').textContent = 'This trip has filled up. Choose another trip.';
    form.querySelector('.bk-submit').disabled = true;
  }
  show('co-start');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    collect();
    F.submitted = true;
    ['pickup', 'budget'].forEach((f) => { $(`start-${f}-error`).textContent = ''; });
    $('start-error').textContent = '';
    let firstBad = null;
    let bad = 0;
    F.list.forEach((_, i) => {
      const errs = Object.keys(paint(i));
      bad += errs.length;
      if (!firstBad && errs.length) firstBad = $(`trav-${i}-${errs[0]}`);
    });
    const pickupId = sel.value;
    if (!PICKUP_POINTS.some((p) => p.id === pickupId)) { $('start-pickup-error').textContent = 'Choose a pickup point.'; bad++; firstBad = firstBad || sel; }
    if (!$('start-budget').checked) { $('start-budget-error').textContent = 'Tick to confirm the trip budget before continuing.'; bad++; firstBad = firstBad || $('start-budget'); }
    if (F.list.length > maxSeats) { $('start-error').textContent = `Only ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left on this trip.`; return; }
    if (firstBad) {
      $('start-error').textContent = `Please fix ${bad === 1 ? '1 detail' : `${bad} details`} marked below.`;
      firstBad.focus();
      return;
    }
    const travellers = F.list.map((t, i) => {
      const row = { name: String(t.name).trim().replace(/\s+/g, ' '), phone: tenDigits(t.phone) };
      if (i === 0) {
        row.email = String(t.email).trim();
        const college = String(t.college || '').trim();
        if (college) row.college = college;
        row.lead = true;
      }
      return row;
    });
    const lead = travellers[0];
    const result = createBooking({ tripId: trip.id, name: lead.name, phone: lead.phone, pickupId });
    if (!result.ok) { $('start-error').textContent = result.reason === 'full' ? 'This trip has filled up. Choose another trip.' : 'We could not start the booking. Please try again.'; return; }
    // The store saves the lead booker; add the group and the group total to the same booking.
    const n = travellers.length;
    const booking = { ...result.booking, travellers, seats: n, email: lead.email, college: lead.college || '', notes: $('start-notes').value.trim().slice(0, 300), pricePerPerson: price, amount: price * n };
    write(KEYS.groupBookings, { ...(read(KEYS.groupBookings, {}) || {}), [booking.id]: booking });
    history.replaceState(null, '', `/checkout?trip=${enc(trip.id)}&booking=${enc(booking.id)}`);
    $('budget-ok').checked = true; // already confirmed on this form
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    // Never leave the buyer on the loading screen: any failure shows a way forward.
    startBooking(booking).catch((e) => {
      showMissing('Checkout could not load', `${e instanceof NetError || e instanceof ApiError ? e.message : 'Something went wrong.'} Refresh this page to retry your booking, or message us on WhatsApp.`);
    });
  });
}

/* ---------- Boot ---------- */
async function loadConfig() {
  return api('/api/pay/config');
}

// Trip booking: pay through the server when the trip is in data/catalog.json, else a practice payment.
async function startBooking(booking) {
  S.booking = booking;
  S.trip = getTrip(booking.tripId);
  show('co-loading');
  S.cfg = S.cfg || await loadConfig();
  let adapter = localAdapter(booking);
  let inCatalog = false;
  try {
    const items = await api('/api/catalog');
    inCatalog = Array.isArray(items) && items.some((i) => i.id === booking.tripId);
  } catch (e) {
    showMissing('Checkout is temporarily unavailable', `${e.message} Refresh this page to retry your booking.`);
    return;
  }
  // A booking from before the traveller cards has no traveller list (no email): practice payment.
  if (inCatalog && Array.isArray(booking.travellers) && booking.travellers.length) {
    try {
      // Same booking -> same server order (the key is stored on the server for 24 hours).
      // The server charges its own price x the number of travellers; qty here is only a hint.
      const r = await api('/api/pay/order', {
        method: 'POST',
        key: `trip_${booking.id}`,
        body: {
          items: [{ id: booking.tripId, qty: booking.travellers.length }],
          customer: { name: booking.name, phone: booking.phone, email: booking.email || '' },
          travellers: booking.travellers,
          date: booking.date,
          notes: `Trip booking ${booking.id} · pickup: ${booking.pickupLabel || ''}${booking.notes ? ` · ${booking.notes}` : ''}`,
        },
      });
      const srv = serverAdapter(r.orderId, r.token);
      S.order = await srv.load();
      S.session = r.payment;
      adapter = srv;
    } catch (e) {
      showMissing('Checkout is temporarily unavailable', `${e.message} Refresh this page to retry your booking.`);
      return;
    }
  }
  await ready(adapter);
}

async function startOrder(orderId, token) {
  S.cfg = await loadConfig();
  const adapter = serverAdapter(orderId, token);
  try {
    S.order = await adapter.load();
  } catch (e) {
    if (e instanceof NetError) { showMissing("We couldn't load your order", e.message); return; }
    showMissing("We couldn't find that order", 'This payment link is not valid or has expired. Please place the order again.');
    return;
  }
  await ready(adapter);
}

async function ready(adapter) {
  S.adapter = adapter;
  S.demo = adapter.kind === 'local' || S.cfg.mode === 'demo';
  if (adapter.kind === 'server') {
    S.amount = S.order.amount;
    S.currency = S.order.currency || 'INR';
  } else {
    const r = await adapter.start();
    S.amount = r.amount;
  }
  renderSummary();
  selectMethod('upi');
  renderMode();
  if (S.notice) say(S.notice);
  show('co-main');

  if (S.order && S.order.status === 'paid') return success({ paymentId: S.order.reference });
  if (S.order && S.order.status === 'verifying') return verifying();
  if (S.order && !['pending', 'failed'].includes(S.order.status)) { say(`This order is ${S.order.status} and can't be paid here.`); $('pm-choose').hidden = true; return; }
  if (adapter.kind === 'local' && S.booking.status === 'paid') return success({ paymentId: S.booking.paymentReference });
  if (adapter.kind === 'local' && S.booking.status === 'failed') say('Your last payment did not go through. You can try again below.');

  // Returning from a UPI app or bank page, or a reload mid-payment: pick the attempt back up.
  const a = savedAttempt();
  if (a && a.expiresAt > Date.now()) {
    S.attempt = a;
    S.method = a.method;
    selectMethod(a.method);
    if (a.flow === 'checkout') {
      try { const r = await adapter.status(null); if (r.state === 'paid') return success(r); } catch { /* ignore */ }
      clearAttempt();
    } else if (a.flow === 'qr') {
      clearAttempt();
    } else {
      showWait(a);
    }
  } else if (a) clearAttempt();
}

async function boot() {
  // Show the payment setting even on the traveller-details and empty states.
  S.cfg = await loadConfig();
  showModeNotice(S.cfg);
  const orderId = query.get('order');
  const token = query.get('t');
  const bookingId = query.get('booking') || '';
  const tripId = query.get('trip') || query.get('id') || query.get('slug') || '';
  if (orderId && token) return startOrder(orderId, token);
  if (bookingId) {
    const booking = getBooking(bookingId);
    if (booking) return startBooking(booking);
    return showMissing('We could not find that booking', 'It may have been made on another phone or browser, or the link was cut short. Join the trip again to get a fresh checkout.');
  }
  const selected = getTrip(tripId) || getTrips().find((t) => t.slug === tripId);
  if (selected) return showStart(selected);
  // A bare checkout address is still useful for reviewing the group form.
  if (!tripId) {
    const example = getTrip('g02') || getTrips().find((t) => !t.isFull);
    if (example) return showStart(example);
  }
  return showMissing('Start with a trip', tripId ? 'We could not find that trip. Browse the current trips and read an itinerary before joining.' : 'Choose a trip, read its full itinerary, then join from the trip summary.');
}

boot().catch((e) => {
  showMissing('Checkout could not load', e instanceof NetError ? e.message : 'Please refresh the page. If it keeps happening, message us on WhatsApp.');
});
