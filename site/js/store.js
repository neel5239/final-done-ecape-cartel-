/**
 * Persistent visitor state: wishlist, compare list (max 3), saved trip-builder state.
 * localStorage with try/catch (private mode / blocked storage falls back to memory).
 *
 * Events (on window):
 *   'store:change'   detail { key: 'wishlist'|'compare'|'builder', value }
 *   'store:compare-full' detail { max, id }   when adding a 4th trip to compare
 * Changes made in another tab also emit 'store:change'.
 */

import {
  GROUP_TRIPS, GROUP_SEATS_MIN, GROUP_SEATS_MAX, DROP_NOTE,
  getPickupPoint, isValidPickup, groupSeatsLeft, groupFilledPercent, withTripSchema,
} from './data.js';
import { LIVE_TRIPS, BOOKED_SEATS } from './live-trips.js';

/* groupTrips holds trips from the retired public "Create trip" form; they are no longer listed. */
export const KEYS = {
  wishlist: 'tw:wishlist', compare: 'tw:compare', builder: 'tw:builder',
  groupTrips: 'tw:group-trips', groupJoins: 'tw:group-joins', groupBookings: 'tw:group-bookings',
  ownerTrips: 'tw:owner-trips',
};
export const COMPARE_MAX = 3;
export const MAX_BUDGET = 100000;

const memory = new Map();
const hasWindow = typeof window !== 'undefined';

function storage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__tw_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function read(key, fallback) {
  const s = storage();
  try {
    const raw = s ? s.getItem(key) : memory.get(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  const raw = JSON.stringify(value);
  const s = storage();
  try {
    if (s) s.setItem(key, raw);
    else memory.set(key, raw);
    return true;
  } catch {
    memory.set(key, raw); // quota exceeded etc.
    return false;
  }
}

function emit(name, detail) {
  if (hasWindow && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

const nameOf = (storageKey) => Object.keys(KEYS).find((k) => KEYS[k] === storageKey);

function readList(key) {
  const v = read(key, []);
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

function setList(name, list) {
  const clean = [...new Set(list)];
  write(KEYS[name], clean);
  emit('store:change', { key: name, value: clean });
  return clean;
}

/* ---------- Wishlist ---------- */
export const getWishlist = () => readList(KEYS.wishlist);
export const isWishlisted = (id) => getWishlist().includes(id);
export function toggleWishlist(id) {
  const list = getWishlist();
  const on = !list.includes(id);
  setList('wishlist', on ? [...list, id] : list.filter((x) => x !== id));
  return on;
}
export const removeFromWishlist = (id) => setList('wishlist', getWishlist().filter((x) => x !== id));
export const clearWishlist = () => setList('wishlist', []);

/* ---------- Compare (max 3) ---------- */
export const getCompare = () => readList(KEYS.compare).slice(0, COMPARE_MAX);
export const isComparing = (id) => getCompare().includes(id);

/** Returns { ok, list, reason? }. reason 'full' when already at COMPARE_MAX. */
export function addToCompare(id) {
  const list = getCompare();
  if (list.includes(id)) return { ok: true, list };
  if (list.length >= COMPARE_MAX) {
    emit('store:compare-full', { max: COMPARE_MAX, id });
    return { ok: false, list, reason: 'full' };
  }
  return { ok: true, list: setList('compare', [...list, id]) };
}
export const removeFromCompare = (id) => setList('compare', getCompare().filter((x) => x !== id));
export function toggleCompare(id) {
  return isComparing(id) ? { ok: true, list: removeFromCompare(id), on: false } : { ...addToCompare(id), on: isComparing(id) };
}
export const clearCompare = () => setList('compare', []);

/* ---------- Trip builder state ---------- */
export const getBuilderState = (fallback = null) => {
  const v = read(KEYS.builder, fallback);
  return v && typeof v === 'object' ? v : fallback;
};
export function saveBuilderState(state) {
  const value = { ...state, savedAt: new Date().toISOString() };
  write(KEYS.builder, value);
  emit('store:change', { key: 'builder', value });
  return value;
}
export function clearBuilderState() {
  const s = storage();
  try { s ? s.removeItem(KEYS.builder) : memory.delete(KEYS.builder); } catch { /* ignore */ }
  emit('store:change', { key: 'builder', value: null });
}

/* ---------- Student group trips ----------
 * Only the owner creates trips (/owner/create/ -> saveOwnerTrip). Shape: GROUP TRIP SCHEMA in data.js.
 * Storage: owner trips (array, schema + legacy aliases), members per trip ({ [tripId]: member[] }),
 * bookings ({ [id]: booking }). Seed trips (data.js GROUP_TRIPS) are never written; joins add to
 * their membersJoined.
 * TODO(owner): owner trips live in this browser's localStorage only, so students on other devices
 * do not see them yet. Publishing needs a kit route (e.g. POST /api/admin/trips) + image upload.
 * Emits 'store:change' with key 'groupTrips' (trips/joins) or 'groupBookings'.
 * Validation results look like { ok, errors: { field: message }, ... } so forms can show inline errors.
 * Rule: joining needs budgetConfirmed === true (student can pay the full budget). No loan/split/waiver.
 */
const objectOf = (key) => {
  const v = read(key, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
};
const arrayOf = (key) => {
  const v = read(key, []);
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
};

let idCounter = 0;
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const clean = (s, max = 80) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Digits only; drops a leading 91 / 0 country or trunk prefix from longer numbers. */
export function normalizeStudentPhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function validIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function decorate(raw, memberCount, isUserCreated) {
  const membersJoined = (raw.membersJoined || 0) + memberCount;
  const trip = { ...raw, membersJoined, isUserCreated };
  trip.seatsLeft = groupSeatsLeft(trip);
  trip.filledPercent = groupFilledPercent(trip);
  trip.isFull = trip.seatsLeft === 0;
  trip.pickupLabel = getPickupPoint(trip.pickupPointId)?.label || '';
  return trip;
}

/** All group trips: trips published from the owner dashboard (server, newest first), trips from the old
 *  browser-only creator, then seeds. Each has seatsLeft, filledPercent, isFull, pickupLabel.
 *  Seats taken = paid travellers on the server, or this browser's own joins if that is higher.
 *  withDrafts: also the owner's unpublished trips (only served to a logged-in owner, for previews). */
export function getTrips({ withDrafts = false } = {}) {
  const joins = objectOf(KEYS.groupJoins);
  const count = (id) => Math.max(Array.isArray(joins[id]) ? joins[id].length : 0, Number(BOOKED_SEATS[id]) || 0);
  const live = LIVE_TRIPS.filter((t) => withDrafts || !t.draft).map((t) => decorate(t, count(t.id), false));
  const owned = getOwnerTrips().map((t) => decorate(t, count(t.id), false)).reverse();
  const seeds = GROUP_TRIPS.map((t) => decorate(t, count(t.id), false));
  return [...live, ...owned, ...seeds];
}

export const getTrip = (id) => getTrips({ withDrafts: true }).find((t) => t.id === id) || null;

function addMember(tripId, member) {
  const joins = objectOf(KEYS.groupJoins);
  joins[tripId] = [...(Array.isArray(joins[tripId]) ? joins[tripId] : []), member];
  write(KEYS.groupJoins, joins);
}

/* ---------- Owner trips (created at /owner/create/) ---------- */
export const OWNER_LIMITS = { title: 80, destination: 60, summary: 240, text: 600, item: 80, dates: 6, days: 15, activities: 10, inclusions: 12 };

const isImageSrc = (s) => typeof s === 'string' && (s === '' || /^data:image\/(jpeg|png|webp);base64,/.test(s) || /^\/assets\/[\w./-]+$/.test(s));
const cleanList = (list, max, len) => (Array.isArray(list) ? list : String(list ?? '').split('\n'))
  .map((x) => clean(x, len)).filter(Boolean).slice(0, max);

/** Raw owner trips (schema + legacy aliases), oldest first. */
export const getOwnerTrips = () => arrayOf(KEYS.ownerTrips);

/**
 * Validate + normalise owner input into the GROUP TRIP SCHEMA (data.js).
 * Input: { title, destination, price, dates[], seats, pickupPointId, coverImage, coverAlt, summary,
 *          inclusions[] | "line\nline", days: [{ title, place, description, activities[], image, imageAlt, hotel: {name, note} }] }.
 * Returns { ok: true, trip } or { ok: false, errors } where errors keys are field names,
 * or 'days.N.field' (N is 0-based) for day fields.
 */
export function validateOwnerTrip(input = {}) {
  const L = OWNER_LIMITS;
  const errors = {};
  const title = clean(input.title, L.title);
  const destination = clean(input.destination, L.destination);
  const summary = clean(input.summary, L.summary);
  const numOf = (v) => (typeof v === 'string' && v.trim() === '' ? NaN : Number(v));
  const price = numOf(input.price);
  const seats = numOf(input.seats);
  const dates = [...new Set((Array.isArray(input.dates) ? input.dates : []).filter(Boolean))].sort().slice(0, L.dates);

  if (!title) errors.title = 'Give the trip a name students will recognise.';
  if (!destination) errors.destination = 'Enter the destination.';
  if (!Number.isFinite(price) || price <= 0) errors.price = 'Enter the price per person in rupees.';
  else if (price > MAX_BUDGET) errors.price = `Price per person cannot be more than ₹${MAX_BUDGET.toLocaleString('en-IN')}.`;
  if (!dates.length) errors.dates = 'Add at least one departure date.';
  else if (dates.some((d) => !validIsoDate(d))) errors.dates = 'One of the dates is not valid.';
  else if (dates[0] < todayIso()) errors.dates = 'Departure dates must be today or later.';
  if (!Number.isInteger(seats) || seats < GROUP_SEATS_MIN || seats > GROUP_SEATS_MAX) errors.seats = `Seats must be a whole number from ${GROUP_SEATS_MIN} to ${GROUP_SEATS_MAX}.`;
  if (!isValidPickup(input.pickupPointId)) errors.pickupPointId = 'Choose the pickup point.';
  if (!input.coverImage) errors.coverImage = 'Add a cover photo. It is the first thing students see.';
  else if (!isImageSrc(input.coverImage)) errors.coverImage = 'This cover photo could not be read. Choose it again.';
  if (!summary) errors.summary = 'Write one or two lines that sell the trip.';

  const rawDays = Array.isArray(input.days) ? input.days.slice(0, L.days) : [];
  if (!rawDays.length) errors.days = 'Add at least one day to the itinerary.';
  const days = rawDays.map((d, i) => {
    const day = {
      day: i + 1,
      title: clean(d.title, L.title),
      place: clean(d.place, L.destination),
      description: clean(d.description, L.text),
      activities: cleanList(d.activities, L.activities, L.item),
      image: isImageSrc(d.image) ? d.image : '',
      imageAlt: clean(d.imageAlt, 160),
      hotel: null,
    };
    const hotelName = clean(d.hotel?.name, L.item);
    if (hotelName) day.hotel = { name: hotelName, note: clean(d.hotel?.note, 160) };
    if (!day.title) errors[`days.${i}.title`] = `Give day ${i + 1} a title.`;
    if (!day.place) errors[`days.${i}.place`] = `Where is the group on day ${i + 1}?`;
    if (!day.activities.length) errors[`days.${i}.activities`] = `List at least one activity for day ${i + 1}.`;
    return day;
  });
  if (Object.keys(errors).length) return { ok: false, errors };

  const trip = withTripSchema({
    id: input.id && /^o-[\w-]+$/.test(input.id) ? input.id : newId('o'),
    title, destination, price: Math.round(price), dates, seats, summary,
    coverImage: input.coverImage,
    coverAlt: clean(input.coverAlt, 160) || `${title}, ${destination}`,
    inclusions: cleanList(input.inclusions, L.inclusions, L.item),
    days,
    pickupPointId: input.pickupPointId,
    // Legacy aliases (see data.js schema note) so existing cards and the join flow work unchanged.
    budgetPerPerson: Math.round(price), date: dates[0], seatsTotal: seats, membersJoined: 0,
    blurb: summary, image: input.coverImage, imageAlt: clean(input.coverAlt, 160) || `${title}, ${destination}`,
    imageWidth: Number(input.coverWidth) || 1600, imageHeight: Number(input.coverHeight) || 1067,
    dropNote: DROP_NOTE, isOwnerTrip: true,
    createdAt: new Date().toISOString(),
  });
  return { ok: true, trip };
}

/**
 * Save (create or replace by id) an owner trip. Returns { ok: true, trip } or
 * { ok: false, errors } ('storage' when the browser is out of space, usually from large photos).
 */
export function saveOwnerTrip(input = {}) {
  const v = validateOwnerTrip(input);
  if (!v.ok) return v;
  const list = getOwnerTrips().filter((t) => t.id !== v.trip.id);
  if (!write(KEYS.ownerTrips, [...list, v.trip])) {
    return { ok: false, errors: { storage: 'This browser is out of space for photos. Remove a day photo or delete an older trip, then save again.' } };
  }
  emit('store:change', { key: 'groupTrips', value: getTrips() });
  return { ok: true, trip: getTrip(v.trip.id) };
}

export function deleteOwnerTrip(id) {
  const list = getOwnerTrips();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  write(KEYS.ownerTrips, next);
  emit('store:change', { key: 'groupTrips', value: getTrips() });
  return true;
}

/**
 * Join a group trip. Rejects when the trip is missing or full, the pickup is not one of the
 * two fixed points, budgetConfirmed is not exactly true, name/phone are invalid, or the phone
 * already joined. Returns { ok: true, trip, member } or { ok: false, reason, errors }.
 * reason: 'not-found' | 'full' | 'invalid'.
 */
export function joinTrip(tripId, input = {}) {
  const trip = getTrip(tripId);
  if (!trip) return { ok: false, reason: 'not-found', errors: { trip: 'Trip not found' } };
  if (trip.isFull) return { ok: false, reason: 'full', errors: { trip: 'This trip is full' } };

  const errors = {};
  const name = clean(input.name, 60);
  const phone = normalizeStudentPhone(input.phone);
  if (!name) errors.name = 'Enter your name';
  if (!/^\d{10}$/.test(phone)) errors.phone = 'Enter a 10-digit mobile number';
  if (!isValidPickup(input.pickupId)) errors.pickupId = 'Choose Sundar One hostel gate or College gate';
  if (input.budgetConfirmed !== true) errors.budgetConfirmed = `Confirm you can pay the full ₹${trip.budgetPerPerson.toLocaleString('en-IN')} budget to join`;
  if (!errors.phone) {
    const members = objectOf(KEYS.groupJoins)[tripId] || [];
    if (members.some((m) => m.phone === phone)) errors.phone = 'This number has already joined this trip';
  }
  if (Object.keys(errors).length) return { ok: false, reason: 'invalid', errors };

  const member = { id: newId('m'), name, phone, pickupId: input.pickupId, role: 'member', joinedAt: new Date().toISOString() };
  addMember(tripId, member);
  emit('store:change', { key: 'groupTrips', value: getTrips() });
  return { ok: true, trip: getTrip(tripId), member };
}

/* Bookings: created at the end of the flow, then settled by the demo QR / mock gateway. */

/** Create a pending booking for the full trip budget. Input: { tripId, name, phone, pickupId }. */
export function createBooking(input = {}) {
  const trip = getTrip(input.tripId);
  if (!trip) return { ok: false, reason: 'not-found', errors: { trip: 'Trip not found' } };
  if (trip.isFull) return { ok: false, reason: 'full', errors: { trip: 'This trip is full' } };
  const errors = {};
  const name = clean(input.name, 60);
  const phone = normalizeStudentPhone(input.phone);
  if (!name) errors.name = 'Enter your name';
  if (!/^\d{10}$/.test(phone)) errors.phone = 'Enter a 10-digit mobile number';
  if (!isValidPickup(input.pickupId)) errors.pickupId = 'Choose Sundar One hostel gate or College gate';
  if (Object.keys(errors).length) return { ok: false, errors };

  const booking = {
    id: newId('bk'),
    tripId: trip.id,
    tripTitle: trip.title,
    destination: trip.destination,
    date: trip.date,
    name,
    phone,
    pickupId: input.pickupId,
    pickupLabel: getPickupPoint(input.pickupId).label,
    amount: trip.budgetPerPerson,
    currency: 'INR',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  write(KEYS.groupBookings, { ...objectOf(KEYS.groupBookings), [booking.id]: booking });
  emit('store:change', { key: 'groupBookings', value: booking });
  return { ok: true, booking };
}

export const getBooking = (id) => objectOf(KEYS.groupBookings)[id] || null;
export const getBookings = () => Object.values(objectOf(KEYS.groupBookings)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

function settle(id, patch) {
  const all = objectOf(KEYS.groupBookings);
  const cur = all[id];
  if (!cur) return { ok: false, errors: { booking: 'Booking not found' } };
  if (cur.status === 'paid') return { ok: false, reason: 'already-paid', errors: { booking: 'Booking is already paid' }, booking: cur };
  const booking = { ...cur, ...patch };
  write(KEYS.groupBookings, { ...all, [id]: booking });
  emit('store:change', { key: 'groupBookings', value: booking });
  return { ok: true, booking };
}

/** Mark paid. `method` is 'demo-qr' or 'mock-gateway'; `reference` is a demo payment reference. */
export const markPaid = (id, { method = 'mock-gateway', reference = '' } = {}) =>
  settle(id, { status: 'paid', paymentMethod: method, paymentReference: clean(reference, 60), paidAt: new Date().toISOString(), failureReason: '' });

/** Mark failed (a failed booking can be retried and later marked paid). A paid booking never flips back. */
export const markFailed = (id, reason = 'Payment failed') =>
  settle(id, { status: 'failed', failureReason: clean(reason, 120), failedAt: new Date().toISOString() });

/** Subscribe to changes; returns an unsubscribe function. */
export function onStoreChange(handler) {
  if (!hasWindow) return () => {};
  const local = (e) => handler(e.detail);
  const cross = (e) => {
    const key = nameOf(e.key);
    if (key) handler({ key, value: read(e.key, key === 'builder' ? null : []) });
  };
  window.addEventListener('store:change', local);
  window.addEventListener('storage', cross);
  return () => {
    window.removeEventListener('store:change', local);
    window.removeEventListener('storage', cross);
  };
}
