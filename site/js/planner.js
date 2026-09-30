/**
 * Pure planning functions: filtering trips and estimating a custom trip.
 * No DOM, no storage. Every estimate is labelled as an estimate and built on
 * placeholder prices until the owner confirms real ones.
 */

import { TRIPS, MONTHS, STAY_TYPES, ADD_ONS, PRICES_ARE_PUBLIC, PUBLIC_INVENTORY_CONFIRMED, getTripById } from './data.js';

/* ---------- Formatting ---------- */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const formatINR = (n) => inr.format(Math.round(Number(n) || 0));

/** Visitor-safe price label. `note` explains the asterisk. */
export function priceLabel(trip) {
  if (!trip || !PRICES_ARE_PUBLIC || !trip.basePricePerPerson) {
    return { text: 'Price on request', note: 'Ask us on WhatsApp for the latest price.', isPlaceholder: true };
  }
  return trip.priceIsPlaceholder
    ? { text: `From ${formatINR(trip.basePricePerPerson)}*`, note: '*Indicative price per person. Final quote on WhatsApp.', isPlaceholder: true }
    : { text: `From ${formatINR(trip.basePricePerPerson)}`, note: 'Per person.', isPlaceholder: false };
}

/**
 * Card-facing price: shows the sample number from data.js, clearly flagged as a
 * placeholder, instead of a bare "Price on request" (cards need a "from" price
 * to compare trips). Real prices drop the flag once PRICES_ARE_PUBLIC is true
 * and priceIsPlaceholder is false.
 * TODO(owner): confirm prices in data.js.
 */
export function displayPrice(trip) {
  if (!trip || !trip.basePricePerPerson || !PRICES_ARE_PUBLIC || trip.priceIsPlaceholder) {
    // TODO(owner): publish a per-person price only after the trip quote is confirmed.
    return { text: 'Price on request', note: 'Ask us on WhatsApp for the latest price.', isPlaceholder: true };
  }
  const text = `From ${formatINR(trip.basePricePerPerson)}`;
  return { text, note: 'Per person.', isPlaceholder: false };
}

/**
 * Card-facing availability from data.js: next departure, group size and spots
 * left. `isPlaceholder` stays true until the owner confirms inventory, and
 * every renderer must show a visible "Placeholder" tag while it is.
 * TODO(owner): confirm departures, group sizes and availability in data.js.
 */
export function displayInventory(trip, today = new Date().toISOString().slice(0, 10)) {
  const deps = (trip?.departures || []).slice().sort();
  const upcoming = deps.filter((d) => d >= today);
  const next = upcoming[0] || null;
  const fmt = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  return {
    next,
    nextLabel: next ? fmt(next) : 'New dates soon',
    moreCount: Math.max(0, upcoming.length - 1),
    group: trip?.groupMin && trip?.groupMax ? `${trip.groupMin}–${trip.groupMax}` : '',
    spotsLeft: trip?.spotsLeft ?? 0,
    filled: filledPercent(trip),
    isPlaceholder: !PUBLIC_INVENTORY_CONFIRMED || !!trip?.datesAreIndicative,
  };
}

/** Share of the group already booked, 0-100 (for spots-left bars). */
export function filledPercent(trip) {
  const max = trip?.groupMax || 0;
  if (!max) return 0;
  return Math.max(0, Math.min(100, Math.round(((max - trip.spotsLeft) / max) * 100)));
}

export const monthNames = (months = []) => months.map((m) => MONTHS[m - 1]).filter(Boolean);

/**
 * Split a free-text "somewhere else" answer into a clean list of places.
 * Accepts commas, semicolons, slashes, "&", new lines and " and ". De-duplicates
 * (case-insensitive) and caps at `max` places.
 */
export function parseCustomPlaces(text, max = 8) {
  const seen = new Set();
  return String(text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .split(/[,;/&\n]|\s+and\s+/i)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => {
      const k = p.toLowerCase();
      if (p.length < 2 || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max);
}

/* ---------- Filtering ---------- */
export const DURATION_BUCKETS = {
  short: { label: 'Up to 5 days', min: 1, max: 5 },
  mid: { label: '6 days', min: 6, max: 6 },
  long: { label: '7+ days', min: 7, max: Infinity },
};

export const BUDGET_BUCKETS = {
  under8k: { label: 'Under ₹8,000', min: 0, max: 7999 },
  '8to12k': { label: '₹8,000 – ₹12,000', min: 8000, max: 12000 },
  '12to18k': { label: '₹12,000 – ₹18,000', min: 12000, max: 18000 },
  over18k: { label: '₹18,000+', min: 18000, max: Infinity },
};

const norm = (s) => String(s ?? '').trim().toLowerCase();
const isSet = (v) => v !== undefined && v !== null && v !== '' && v !== 'all' && !(Array.isArray(v) && !v.length);
const asArray = (v) => (Array.isArray(v) ? v : [v]);

function toRange(v, buckets) {
  if (typeof v === 'string' && buckets[v]) return buckets[v];
  if (typeof v === 'number') return { min: 0, max: v };
  if (v && typeof v === 'object') return { min: Number(v.min) || 0, max: v.max == null || v.max === '' ? Infinity : Number(v.max) };
  return null;
}

/**
 * filterTrips(trips, filters)
 * filters: {
 *   destination: string | string[]  (matches destination, region, name or slug; case-insensitive)
 *   budget:     number (max) | {min,max} | BUDGET_BUCKETS key
 *   duration:   number (exact days) | {min,max} | DURATION_BUCKETS key
 *   month:      1-12 | 'Oct' | array of those
 *   difficulty: 'easy'|'moderate'|'challenging' | array
 *   query:      free text over name/tagline/destination/region
 * }
 */
export function filterTrips(trips = TRIPS, filters = {}) {
  const f = filters || {};
  const dests = isSet(f.destination) ? asArray(f.destination).map(norm) : null;
  const budget = isSet(f.budget) ? toRange(f.budget, BUDGET_BUCKETS) : null;
  const duration = isSet(f.duration)
    ? typeof f.duration === 'number' ? { min: f.duration, max: f.duration } : toRange(f.duration, DURATION_BUCKETS)
    : null;
  const months = isSet(f.month) ? asArray(f.month).map(toMonth).filter(Boolean) : null;
  const diffs = isSet(f.difficulty) ? asArray(f.difficulty).map(norm) : null;
  const q = norm(f.query);

  return trips.filter((t) => {
    if (dests && !dests.some((d) => [t.destination, t.region, t.name, t.slug].some((x) => norm(x) === d))) return false;
    if (budget && !(t.basePricePerPerson >= budget.min && t.basePricePerPerson <= budget.max)) return false;
    if (duration && !(t.days >= duration.min && t.days <= duration.max)) return false;
    if (months && !months.some((m) => t.months.includes(m))) return false;
    if (diffs && !diffs.includes(t.difficulty)) return false;
    if (q && ![t.name, t.tagline, t.destination, t.region].some((x) => norm(x).includes(q))) return false;
    return true;
  });
}

function toMonth(m) {
  if (typeof m === 'number') return m >= 1 && m <= 12 ? m : null;
  const n = Number(m);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const i = MONTHS.findIndex((x) => norm(x) === norm(m).slice(0, 3));
  return i >= 0 ? i + 1 : null;
}

export const SORTS = {
  recommended: (a, b) => a.spotsLeft - b.spotsLeft,
  'price-asc': (a, b) => a.basePricePerPerson - b.basePricePerPerson,
  'price-desc': (a, b) => b.basePricePerPerson - a.basePricePerPerson,
  'days-asc': (a, b) => a.days - b.days,
};
export const sortTrips = (trips, key = 'recommended') => [...trips].sort(SORTS[key] || SORTS.recommended);

/** Options for filter dropdowns, derived from the data. */
export function getFilterOptions(trips = TRIPS) {
  return {
    destinations: [...new Set(trips.map((t) => t.destination))].sort(),
    regions: [...new Set(trips.map((t) => t.region))].sort(),
    difficulties: [...new Set(trips.map((t) => t.difficulty))],
    months: MONTHS.map((label, i) => ({ value: i + 1, label })),
    budgets: Object.entries(BUDGET_BUCKETS).map(([value, b]) => ({ value, label: b.label })),
    durations: Object.entries(DURATION_BUCKETS).map(([value, b]) => ({ value, label: b.label })),
  };
}

/* ---------- Estimate ---------- */
export const ESTIMATE_RULES = {
  // [minTravellers, discount]; highest matching tier wins. Solo travellers pay a small supplement.
  groupTiers: [[1, -0.1], [2, 0], [4, 0.05], [8, 0.08], [12, 0.12]],
  flexTiers: [[3, 0.05], [7, 0.08]], // [flexible by >= N days, discount]
  season: { peak: 1.15, shoulder: 1, off: 0.9 },
  staySharePct: 0.4, // share of the base price that is accommodation
  rangeLow: 0.92,
  rangeHigh: 1.1,
  roundTo: 100,
  defaultPerDay: 1800, // used when no trip is chosen (custom destination)
};

const DAY_MS = 86400000;
const parseDate = (d) => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(x.getTime()) ? null : x;
};

export function tripDays(state, trip) {
  const s = parseDate(state.startDate);
  const e = parseDate(state.endDate);
  if (s && e && e >= s) return Math.round((e - s) / DAY_MS) + 1;
  if (Number(state.days) > 0) return Math.round(Number(state.days));
  return trip?.days || 5;
}

export function seasonFor(month, trip) {
  if (!month) return 'shoulder';
  if (trip?.peakMonths?.includes(month)) return 'peak';
  if (trip && !trip.months.includes(month)) return 'off';
  return 'shoulder';
}

const tier = (tiers, n) => tiers.reduce((acc, [min, v]) => (n >= min ? v : acc), 0);
const roundTo = (n, step) => Math.round(n / step) * step;

/**
 * estimate(builderState) -> price range. Pure.
 * builderState: {
 *   tripId?, destination?, startDate?, endDate?, days?, flexibleDays? (0-14),
 *   groupSize (1+), stayType ('hostel'|'standard'|'boutique'), addOns: string[], month? (1-12)
 * }
 */
export function estimate(state = {}) {
  const trip = state.tripId ? getTripById(state.tripId) : null;
  const R = ESTIMATE_RULES;
  const groupSize = Math.max(1, Math.min(60, Math.round(Number(state.groupSize) || 1)));
  const days = Math.max(1, Math.min(30, tripDays(state, trip)));
  const start = parseDate(state.startDate);
  const month = Number(state.month) || (start ? start.getUTCMonth() + 1 : null);
  const season = seasonFor(month, trip);
  const stay = STAY_TYPES.find((s) => s.id === state.stayType) || STAY_TYPES.find((s) => s.id === 'standard');
  const flexibleDays = Math.max(0, Number(state.flexibleDays) || 0);

  // Base per person, pro-rated to the chosen number of days.
  const perDay = trip ? trip.basePricePerPerson / trip.days : R.defaultPerDay;
  const base = perDay * days;
  const stayAdj = base * R.staySharePct * (stay.multiplier - 1);
  const seasonAdj = (base + stayAdj) * (R.season[season] - 1);
  const subtotal = base + stayAdj + seasonAdj;

  const groupRate = tier(R.groupTiers, groupSize);
  const flexRate = tier(R.flexTiers, flexibleDays);
  const groupAdj = -subtotal * groupRate;
  const flexAdj = -subtotal * flexRate;

  const chosen = ADD_ONS.filter((a) => (state.addOns || []).includes(a.id));
  const addOnItems = chosen.map((a) => ({ id: a.id, label: a.label, perPerson: (a.perPerson || 0) + (a.perDay || 0) * days }));
  const addOnTotal = addOnItems.reduce((s, a) => s + a.perPerson, 0);

  const perPerson = Math.max(0, subtotal + groupAdj + flexAdj + addOnTotal);
  const ppMin = roundTo(perPerson * R.rangeLow, R.roundTo);
  const ppMax = roundTo(perPerson * R.rangeHigh, R.roundTo);

  return {
    isEstimate: true,
    label: 'Estimate',
    priceIsPlaceholder: trip ? trip.priceIsPlaceholder : true,
    currency: 'INR',
    tripId: trip?.id || null,
    destination: trip?.destination || state.destination || null,
    days,
    groupSize,
    season,
    stayType: stay.id,
    perPerson: { min: ppMin, max: ppMax },
    total: { min: ppMin * groupSize, max: ppMax * groupSize },
    min: ppMin,
    max: ppMax,
    discounts: { group: groupRate, flexibleDates: flexRate },
    breakdown: {
      base: Math.round(base),
      stay: Math.round(stayAdj),
      season: Math.round(seasonAdj),
      groupDiscount: Math.round(groupAdj),
      flexibleDateDiscount: Math.round(flexAdj),
      addOns: addOnItems,
    },
    text: `Estimate: ${formatINR(ppMin)} – ${formatINR(ppMax)} per person`,
    note: 'Indicative estimate only. Your final quote is confirmed on WhatsApp.',
  };
}
