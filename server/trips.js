// Owner trips, photo uploads and visitor statistics (dashboard > Trips / Overview).
//
//  - Trips: saved as one JSON document per trip (GROUP TRIP SCHEMA in site/js/data.js). Published trips
//    are served to every page as /js/live-trips.js and synced into the items table so checkout can price them.
//  - Uploads: owner photos (already resized in the browser) saved as JPEG files in DATA_DIR/uploads,
//    served at /uploads/<name>.jpg. On Railway DATA_DIR is the volume, so photos survive redeploys.
//  - Visits: anonymous page views from site/js/core.js (no cookies; visitor = daily hash of IP + browser).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { db, GROUP_TRIPS, upsertTripItem, deactivateItem } from './db.js';
import { HttpError } from './http.js';

const PICKUPS = { 'sundar-one': 'Sundar One hostel gate', 'college-gate': 'College gate (Manipal University Jaipur)' };
const DROP_NOTE = 'Drop back at your pickup area at the end of the trip.';
const UPLOADS = path.join(config.dataDir, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

const DAY = 86400000;
const txt = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v, max, len) => (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((x) => txt(x, len)).filter(Boolean).slice(0, max);
const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const localDay = (ms = Date.now()) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// Photos: our own uploads or images already on the site. Never an outside URL or a data URL.
const img = (s) => {
  const v = String(s ?? '').trim();
  return /^\/uploads\/[a-f0-9]{24}(-sm)?\.jpg$/.test(v) || (/^\/assets\/[\w./-]+\.(jpe?g|png|webp)$/i.test(v) && !v.includes('..')) ? v : '';
};

export const LIMITS = { days: 15, activities: 10, points: 3, photos: 3, inclusions: 12, dates: 6, seatsMin: 2, seatsMax: 60, priceMax: 200000 };

/**
 * Cleans owner (or AI) input into the trip schema. strict = the checks needed to publish.
 * Returns { trip, errors } where errors is { field: message } ('days.N.field' for a day).
 */
export function cleanTrip(input = {}, { strict = false } = {}) {
  const L = LIMITS;
  const errors = {};
  const price = Math.round(Number(input.price));
  const seats = Math.round(Number(input.seats));
  const dates = [...new Set((Array.isArray(input.dates) ? input.dates : String(input.dates || '').split(/[\s,]+/)).map((d) => String(d).trim()).filter(isoOk))].sort().slice(0, L.dates);
  const trip = {
    title: txt(input.title, 80),
    destination: txt(input.destination, 60),
    summary: txt(input.summary, 240),
    price: Number.isFinite(price) && price > 0 ? Math.min(price, L.priceMax) : 0,
    dates,
    seats: Number.isFinite(seats) ? Math.max(L.seatsMin, Math.min(L.seatsMax, seats)) : 20,
    pickupPointId: PICKUPS[input.pickupPointId] ? input.pickupPointId : 'college-gate',
    coverImage: img(input.coverImage),
    coverAlt: txt(input.coverAlt, 160),
    inclusions: list(input.inclusions, L.inclusions, 120),
    highlights: list(input.highlights, 6, 60),
    days: (Array.isArray(input.days) ? input.days : []).slice(0, L.days).map((d, i) => {
      const photos = (Array.isArray(d?.photos) ? d.photos : []).map((p) => ({ src: img(p?.src), thumb: img(p?.thumb) || img(p?.src), alt: txt(p?.alt, 160) }))
        .filter((p) => p.src).slice(0, L.photos);
      const hotelName = txt(d?.hotel?.name, 100);
      const title = txt(d?.title, 90);
      const activities = list(d?.activities, L.activities, 110);
      const cut = (x, n) => (x.length <= n ? x : `${x.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
      const points = list(d?.points, L.points, 44);
      return {
        day: i + 1,
        title,
        // The timeline shows a short name and 3 key moments: taken from the title and first activities when not given.
        short: txt(d?.short, 28) || cut(title, 28),
        place: txt(d?.place, 60),
        points: points.length ? points : activities.slice(0, L.points).map((x) => cut(x, 40)),
        description: txt(d?.description, 1200),
        activities,
        photos,
        hotel: hotelName ? { name: hotelName, note: txt(d?.hotel?.note, 160) } : null,
      };
    }),
  };
  if (!trip.title) errors.title = 'Give the trip a name.';
  if (strict) {
    if (!trip.destination) errors.destination = 'Enter the destination.';
    if (!trip.summary) errors.summary = 'Write one or two lines that sell the trip.';
    if (!trip.price || trip.price < 1) errors.price = 'Enter the price per person in rupees.';
    if (!trip.dates.length) errors.dates = 'Add at least one departure date.';
    else if (trip.dates[trip.dates.length - 1] < localDay()) errors.dates = 'Add a departure date from today onwards.';
    if (!trip.coverImage) errors.coverImage = 'Add a cover photo.';
    if (!trip.days.length) errors.days = 'Add at least one day.';
    trip.days.forEach((d, i) => {
      if (!d.title) errors[`days.${i}.title`] = `Day ${i + 1} needs a title.`;
      if (!d.activities.length && !d.points.length) errors[`days.${i}.activities`] = `List what happens on day ${i + 1}.`;
    });
  }
  return { trip, errors };
}

/** The trip as pages read it: schema fields + the legacy aliases (see data.js) + the timeline fields. */
function publicShape(id, t, { draft = false } = {}) {
  const days = t.days.map((d) => {
    const [main, ...more] = d.photos;
    return {
      day: d.day, title: d.title, short: d.short, place: d.place, points: d.points, description: d.description, activities: d.activities,
      image: main?.src || '', thumb: main?.thumb || '', imageAlt: main?.alt || '', imageFallback: t.coverImage,
      morePhotos: more.map((p) => ({ src: p.src, thumb: p.thumb, alt: p.alt })), hotel: d.hotel,
    };
  });
  return {
    id, title: t.title, destination: t.destination, price: t.price, dates: t.dates, seats: t.seats, coverImage: t.coverImage, coverAlt: t.coverAlt || t.title,
    summary: t.summary, inclusions: t.inclusions, highlights: t.highlights, days, pickupPointId: t.pickupPointId,
    budgetPerPerson: t.price, date: t.dates[0] || '', seatsTotal: t.seats, image: t.coverImage, imageAlt: t.coverAlt || t.title, blurb: t.summary,
    durationLabel: `${days.length} ${days.length === 1 ? 'day' : 'days'}`, membersJoined: 0, dropNote: DROP_NOTE, ownerTrip: true, ...(draft ? { draft: true } : {}),
  };
}

// ---------- trips ----------
const row = (id) => db.prepare('SELECT * FROM trips WHERE id = ?').get(String(id || ''));
const parse = (r) => { try { return JSON.parse(r.data); } catch { return null; } };

function newTripId(title) {
  const slug = String(title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'trip';
  return `o-${slug}-${crypto.randomBytes(2).toString('hex')}`;
}

/** Paid seats per trip id (one seat per named traveller), from real orders. */
export function bookedSeats() {
  const out = {};
  for (const o of db.prepare("SELECT items FROM orders WHERE status = 'paid'").all()) {
    let items = [];
    try { items = JSON.parse(o.items); } catch {}
    for (const it of items) out[it.id] = (out[it.id] || 0) + (Number(it.qty) || 0);
  }
  return out;
}

export function saveTrip(body = {}) {
  const publish = body.publish === true;
  const { trip, errors } = cleanTrip(body.trip, { strict: publish });
  if (Object.keys(errors).length) {
    const e = new HttpError(422, publish ? 'Some details are missing before this trip can go live.' : errors.title, 'invalid_trip');
    e.errors = errors;
    throw e;
  }
  const now = Date.now();
  const old = body.id ? row(body.id) : null;
  if (body.id && !old) throw new HttpError(404, 'That trip no longer exists.');
  const id = old ? old.id : newTripId(trip.title);
  const published = publish ? 1 : body.unpublish ? 0 : old ? old.published : 0;
  if (old) db.prepare('UPDATE trips SET data = ?, published = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(trip), published, now, id);
  else db.prepare('INSERT INTO trips (id, data, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, JSON.stringify(trip), published, now, now);
  if (published) upsertTripItem({ id, ...trip });
  else deactivateItem(id);
  return { id, published: !!published };
}

export function setPublished(id, on) {
  const r = row(id);
  if (!r) throw new HttpError(404, 'That trip no longer exists.');
  const t = parse(r);
  if (on) {
    const { errors } = cleanTrip(t, { strict: true });
    if (Object.keys(errors).length) { const e = new HttpError(422, 'Open the trip and fill in the missing details first.', 'invalid_trip'); e.errors = errors; throw e; }
    upsertTripItem({ id: r.id, ...t });
  } else deactivateItem(r.id);
  db.prepare('UPDATE trips SET published = ?, updated_at = ? WHERE id = ?').run(on ? 1 : 0, Date.now(), r.id);
  return { id: r.id, published: !!on };
}

export function deleteTrip(id) {
  const r = row(id);
  if (!r) throw new HttpError(404, 'That trip no longer exists.');
  const paid = bookedSeats()[r.id] || 0;
  if (paid) throw new HttpError(409, `This trip has ${paid} paid seat(s). Unpublish it instead, so the bookings stay on record.`);
  deactivateItem(r.id);
  db.prepare('DELETE FROM trips WHERE id = ?').run(r.id);
  return { ok: true };
}

export const getTripForOwner = (id) => {
  const r = row(id);
  if (!r) throw new HttpError(404, 'That trip no longer exists.');
  return { id: r.id, published: !!r.published, createdAt: r.created_at, updatedAt: r.updated_at, trip: parse(r) };
};

/** Dashboard list: owner trips (drafts too) and the built-in sample trips, each with views and bookings. */
export function listTrips() {
  const seats = bookedSeats();
  const since = Date.now() - 30 * DAY;
  const views = Object.fromEntries(db.prepare("SELECT trip, COUNT(DISTINCT visitor) AS n FROM visits WHERE type = 'view' AND trip != '' AND at >= ? GROUP BY trip").all(since).map((r) => [r.trip, r.n]));
  const price = Object.fromEntries(db.prepare('SELECT id, price FROM items').all().map((r) => [r.id, r.price]));
  const stat = (id) => ({ views30: views[id] || 0, seatsBooked: seats[id] || 0, revenue: (seats[id] || 0) * (price[id] || 0) });
  const owned = db.prepare('SELECT * FROM trips ORDER BY updated_at DESC').all().map((r) => {
    const t = parse(r) || {};
    return { id: r.id, kind: 'owner', published: !!r.published, updatedAt: r.updated_at, title: t.title, destination: t.destination, price: t.price, dates: t.dates || [], seats: t.seats, days: (t.days || []).length, coverImage: t.coverImage, ...stat(r.id) };
  });
  const samples = GROUP_TRIPS.map((t) => ({
    id: t.id, kind: 'sample', published: true, title: t.title, destination: t.destination, price: t.price, dates: t.dates || [], seats: t.seats,
    days: (t.days || []).length, coverImage: t.coverImage, ...stat(t.id),
  }));
  return { trips: owned, samples };
}

/** A sample trip as an editable draft ("Copy as new trip"). */
export function sampleAsDraft(id) {
  const t = GROUP_TRIPS.find((x) => x.id === id);
  if (!t) throw new HttpError(404, 'Sample trip not found.');
  return cleanTrip({
    ...t, title: `${t.title} (copy)`,
    // The builder's day title is the short timeline name; the full title becomes the day's first line of detail.
    days: t.days.map((d) => ({ ...d, title: d.short || d.title, short: '', points: [], photos: [{ src: d.image, thumb: d.thumb, alt: d.imageAlt }, ...(d.morePhotos || [])] })),
  }).trip;
}

/** Body of /js/live-trips.js: published owner trips (+ the owner's drafts for previews) and paid seats. */
export function liveTripsModule({ owner = false } = {}) {
  const rows = db.prepare(`SELECT * FROM trips ${owner ? '' : 'WHERE published = 1'} ORDER BY created_at DESC`).all();
  const trips = rows.map((r) => { const t = parse(r); return t && publicShape(r.id, t, { draft: !r.published }); }).filter(Boolean);
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `// Generated by the server (server/trips.js) from the owner dashboard. Do not edit.\nexport const LIVE_TRIPS = ${json(trips)};\nexport const BOOKED_SEATS = ${json(bookedSeats())};\n`;
}

// ---------- photo uploads ----------
/** body: { image: 'data:image/jpeg;base64,...' } (the browser has already resized it). */
export function saveUpload(body = {}) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m) throw new HttpError(400, 'Send the photo as a JPEG.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 200 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new HttpError(400, 'That file is not a JPEG photo.');
  if (buf.length > 2.5 * 1024 * 1024) throw new HttpError(413, 'That photo is too large (max 2.5 MB after resizing).');
  const name = `${crypto.randomBytes(12).toString('hex')}${body.thumb ? '-sm' : ''}.jpg`;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return { src: `/uploads/${name}` };
}

/** Absolute file for GET /uploads/<name>.jpg, or null. */
export function uploadFile(pathname) {
  const m = /^\/uploads\/([a-f0-9]{24}(-sm)?\.jpg)$/.exec(pathname);
  if (!m) return null;
  const f = path.join(UPLOADS, m[1]);
  return fs.existsSync(f) ? f : null;
}

// ---------- visits ----------
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python|node-fetch/i;
const TYPES = ['view', 'whatsapp', 'call', 'join'];

/** body: { p: path + query, e: type, r: document.referrer }. Silently ignores bots and owner pages. */
export function recordVisit(body, { ip, ua, host }) {
  if (!body || typeof body !== 'object' || BOT.test(ua || '')) return;
  const type = TYPES.includes(body.e) ? body.e : 'view';
  let u;
  try { u = new URL(String(body.p || '/').slice(0, 400), 'http://x'); } catch { return; }
  const p = u.pathname.replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1') || '/';
  if (/^\/(admin|owner|api|pay)\b/.test(p)) return;
  const trip = txt(u.searchParams.get('trip') || u.searchParams.get('slug') || u.searchParams.get('id') || '', 64).replace(/[^\w-]/g, '');
  let ref = txt(u.searchParams.get('utm_source') || '', 60);
  if (!ref && body.r) {
    try { const h = new URL(String(body.r)).hostname.replace(/^www\./, ''); if (h && h !== String(host || '').split(':')[0]) ref = h.slice(0, 80); } catch {}
  }
  const device = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop';
  const day = localDay();
  const visitor = crypto.createHash('sha256').update(`${config.sessionSecret}|${day}|${ip}|${ua}`).digest('hex').slice(0, 16);
  db.prepare('INSERT INTO visits (at, day, visitor, type, path, trip, ref, device) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(Date.now(), day, visitor, type, p.slice(0, 120), trip, ref, device);
}

const PAGE_NAMES = { '/': 'Home', '/trips': 'All trips', '/itinerary': 'Trip itinerary', '/trip': 'Trip details', '/checkout': 'Checkout', '/plan': 'Plan my trip', '/about': 'About', '/contact': 'Contact', '/privacy': 'Privacy', '/terms': 'Terms' };

/** Visitor numbers for the dashboard Overview. */
export function visitStats() {
  const now = Date.now();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const since = (ms) => db.prepare("SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS views FROM visits WHERE type = 'view' AND at >= ?").get(ms);
  const d30 = now - 30 * DAY;
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const from = start.getTime() - i * DAY;
    const v = db.prepare("SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS views FROM visits WHERE type = 'view' AND at >= ? AND at < ?").get(from, from + DAY);
    const b = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?").get(from, from + DAY);
    days.push({ day: localDay(from), visitors: v.visitors, views: v.views, bookings: b.n });
  }
  const titles = Object.fromEntries([...GROUP_TRIPS.map((t) => [t.id, t.title]), ...db.prepare('SELECT id, data FROM trips').all().map((r) => [r.id, (parse(r) || {}).title || r.id])]);
  for (const r of db.prepare("SELECT id, name FROM items").all()) if (!titles[r.id]) titles[r.id] = r.name;
  const top = (sql) => db.prepare(sql).all(d30);
  const tripVisitors = db.prepare("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE type = 'view' AND trip != '' AND at >= ?").get(d30).n;
  const checkoutVisitors = db.prepare("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE type = 'view' AND path = '/checkout' AND at >= ?").get(d30).n;
  const paid = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(json_array_length(travellers)), 0) AS people FROM orders WHERE status = 'paid' AND paid_at >= ?").get(d30);
  const events = Object.fromEntries(db.prepare("SELECT type, COUNT(*) AS n FROM visits WHERE type != 'view' AND at >= ? GROUP BY type").all(d30).map((r) => [r.type, r.n]));
  return {
    live: db.prepare("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE at >= ?").get(now - 5 * 60000).n,
    today: since(start.getTime()), week: since(now - 7 * DAY), month: since(d30), days,
    pages: top("SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM visits WHERE type = 'view' AND at >= ? GROUP BY path ORDER BY views DESC LIMIT 8")
      .map((r) => ({ ...r, name: PAGE_NAMES[r.path] || r.path })),
    trips: top("SELECT trip, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM visits WHERE type = 'view' AND trip != '' AND at >= ? GROUP BY trip ORDER BY visitors DESC LIMIT 8")
      .map((r) => ({ ...r, name: titles[r.trip] || r.trip })),
    sources: top("SELECT CASE ref WHEN '' THEN 'Direct / typed' ELSE ref END AS name, COUNT(DISTINCT visitor) AS visitors FROM visits WHERE type = 'view' AND at >= ? GROUP BY name ORDER BY visitors DESC LIMIT 6"),
    devices: top("SELECT device AS name, COUNT(DISTINCT visitor) AS visitors FROM visits WHERE type = 'view' AND at >= ? GROUP BY device ORDER BY visitors DESC"),
    funnel: { tripVisitors, checkoutVisitors, bookings: paid.n, travellers: paid.people },
    clicks: { whatsapp: events.whatsapp || 0, call: events.call || 0, join: events.join || 0 },
  };
}
