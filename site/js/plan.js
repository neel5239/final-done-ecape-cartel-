/**
 * Custom trip builder (plan.html).
 * Builder choices live in form#builder; contact details in form#plan-form
 * (leads.js). Every change re-runs planner.estimate() and saves the builder
 * state to localStorage via store.js. ?trip=<slug> preselects a destination.
 */
import { TRIPS, STAY_TYPES, ADD_ONS, PRICES_ARE_PUBLIC, getTripBySlug } from './data.js';
import { estimate, formatINR, parseCustomPlaces } from './planner.js';
import { getBuilderState, saveBuilderState, clearBuilderState } from './store.js';
import { attachLeadForm } from './leads.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tick = '<svg class="chip__tick" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
const todayISO = new Date().toISOString().slice(0, 10);
const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const DEFAULTS = { destinations: [], customOn: false, other: '', startDate: '', endDate: '', flexibleDays: 0, groupSize: 2, budget: 15000, stayType: 'standard', addOns: [] };
const GROUP_MIN = 1, GROUP_MAX = 40, OTHER_MAX = 120;
// Places the visitor typed for the custom option (empty unless the chip is on).
const placesOf = (s) => (s.customOn ? parseCustomPlaces(s.other) : []);

const form = $('builder');

/* ---------- Build option chips from data ---------- */
// One chip per destination; the circle thumbnail is the trip's own photo.
$('dest-grid').innerHTML = TRIPS.map((t) => `
  <label class="chip chip--toggle dest-chip">
    <input type="checkbox" name="b-dest" value="${t.id}">
    <img src="${esc(t.image)}" alt="" width="68" height="68" loading="lazy" decoding="async" data-image-reason="Corner-inset circle: a recognition stamp, not a hero">
    <span>${esc(t.destination)}</span>
  </label>`).join('') + `
  <label class="chip chip--toggle dest-chip dest-chip--custom">
    <input type="checkbox" name="b-custom" value="1" aria-controls="other-field">
    <span aria-hidden="true" style="display:inline-grid;place-items:center;width:2.1rem;height:2.1rem;border-radius:50%;border:1.5px dashed currentColor;flex-shrink:0">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="2.4" stroke="currentColor" stroke-width="2"/></svg>
    </span>
    <span>Custom / somewhere else</span>
  </label>`;

$('stay-chips').insertAdjacentHTML('beforeend', STAY_TYPES.map((s) =>
  `<label class="chip"><input type="radio" name="b-stay" value="${s.id}"><span>${esc(s.label)}</span></label>`).join(''));

$('addon-chips').insertAdjacentHTML('beforeend', ADD_ONS.map((a) => {
  const cost = PRICES_ARE_PUBLIC ? (a.perPerson ? `+${formatINR(a.perPerson)}` : `+${formatINR(a.perDay)}/day`) : '';
  return `<label class="chip chip--toggle"><input type="checkbox" name="b-addon" value="${a.id}">${tick}<span>${esc(a.label)}${cost ? ` <span class="muted" style="font-weight:600">${cost}</span>` : ''}</span></label>`;
}).join(''));

$('b-start').min = todayISO;
$('b-end').min = todayISO;

/* ---------- State <-> form ---------- */
function readForm() {
  const fd = new FormData(form);
  return {
    destinations: fd.getAll('b-dest'),
    customOn: fd.get('b-custom') === '1',
    other: String(fd.get('b-other') || '').replace(/\s+/g, ' ').trim().slice(0, OTHER_MAX),
    startDate: fd.get('b-start') || '',
    endDate: fd.get('b-end') || '',
    flexibleDays: Number(fd.get('b-flex')) || 0,
    groupSize: Number(fd.get('b-group')) || 2,
    budget: Number(fd.get('b-budget')) || DEFAULTS.budget,
    stayType: fd.get('b-stay') || 'standard',
    addOns: fd.getAll('b-addon'),
  };
}

function writeForm(s) {
  form.querySelectorAll('[name="b-dest"]').forEach((i) => { i.checked = s.destinations.includes(i.value); });
  form.querySelector('[name="b-custom"]').checked = !!s.customOn;
  $('b-other').value = s.other || '';
  syncOther();
  $('b-start').value = s.startDate && s.startDate >= todayISO ? s.startDate : '';
  $('b-end').value = s.endDate && s.endDate >= todayISO ? s.endDate : '';
  form.querySelectorAll('[name="b-flex"]').forEach((i) => { i.checked = Number(i.value) === Number(s.flexibleDays); });
  setGroup(s.groupSize);
  $('b-budget').value = s.budget;
  form.querySelectorAll('[name="b-stay"]').forEach((i) => { i.checked = i.value === s.stayType; });
  form.querySelectorAll('[name="b-addon"]').forEach((i) => { i.checked = s.addOns.includes(i.value); });
  // let the liquid chips move their bead to the restored choice
  form.querySelectorAll('.chips--liquid').forEach((g) => g.dispatchEvent(new Event('change')));
}

function syncOther() {
  const on = form.querySelector('[name="b-custom"]').checked;
  $('other-field').hidden = !on;
  $('b-other').required = on;
  if (!on) clearOtherError();
}

function showOtherError(msg) {
  const el = $('b-other-error');
  el.textContent = msg;
  el.hidden = false;
  $('b-other').setAttribute('aria-invalid', 'true');
}

function clearOtherError() {
  const el = $('b-other-error');
  el.textContent = '';
  el.hidden = true;
  $('b-other').removeAttribute('aria-invalid');
}

function setGroup(n) {
  const v = Math.max(GROUP_MIN, Math.min(GROUP_MAX, Math.round(n) || 2));
  $('b-group').value = v;
  $('g-val').textContent = String(v);
  $('g-minus').disabled = v <= GROUP_MIN;
  $('g-plus').disabled = v >= GROUP_MAX;
}

/* ---------- Estimate across one or many destinations ---------- */
function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) + 1;
}

function compute(s) {
  const trips = s.destinations.map((id) => TRIPS.find((t) => t.id === id)).filter(Boolean);
  const validRange = s.startDate && s.endDate && s.endDate >= s.startDate;
  // Without dates: longest chosen trip + 2 days per extra stop (a sensible default).
  const days = validRange
    ? Math.min(30, daysBetween(s.startDate, s.endDate))
    : trips.length ? Math.max(...trips.map((t) => t.days)) + 2 * (trips.length - 1) : 5;

  const base = { startDate: s.startDate || undefined, days, flexibleDays: s.flexibleDays, groupSize: s.groupSize, stayType: s.stayType, addOns: s.addOns };
  const places = placesOf(s);
  const runs = trips.length ? trips.map((t) => estimate({ ...base, tripId: t.id })) : [estimate({ ...base, destination: places.join(', ') || 'Custom' })];

  // Average the per-destination estimates (same days, different regional rates).
  const avg = (f) => Math.round(runs.reduce((sum, r) => sum + f(r), 0) / runs.length / 100) * 100;
  const min = avg((r) => r.perPerson.min);
  const max = avg((r) => r.perPerson.max);
  const b = (k) => Math.round(runs.reduce((sum, r) => sum + r.breakdown[k], 0) / runs.length);
  return {
    trips, places, days, min, max,
    total: { min: min * s.groupSize, max: max * s.groupSize },
    season: runs[0].season,
    group: runs[0].discounts.group,
    flex: runs[0].discounts.flexibleDates,
    rows: {
      base: b('base'), stay: b('stay'), season: b('season'),
      group: b('groupDiscount'), flex: b('flexibleDateDiscount'),
      addOns: runs[0].breakdown.addOns.reduce((sum, a) => sum + a.perPerson, 0),
    },
    validRange,
  };
}

/* ---------- Render ---------- */
const signed = (n) => (n > 0 ? `+${formatINR(n)}` : n < 0 ? `−${formatINR(-n)}` : formatINR(0));
let lastRange = '';

function render(save = true) {
  const s = readForm();
  const e = compute(s);

  // Dates hint
  const hint = $('date-hint');
  if (s.startDate && s.endDate && s.endDate < s.startDate) hint.textContent = 'The end date is before the start date. Pick a later end date.';
  else if (e.validRange) hint.textContent = `${fmt(s.startDate)} to ${fmt(s.endDate)} · ${e.days} days${s.flexibleDays ? `, flexible by ${s.flexibleDays} days` : ''}`;
  else hint.textContent = 'No dates yet? Leave them empty and we will suggest the best batch.';
  if (s.startDate) $('b-end').min = s.startDate;

  // Group hint
  const g = e.group;
  $('group-hint').textContent = !PRICES_ARE_PUBLIC ? 'Tell us your group size and we will quote the right stay and transport options.'
    : g < 0 ? 'Solo travellers pay a small single-room supplement.'
    : g > 0 ? `Group saving of about ${Math.round(g * 100)}% per person.`
    : s.groupSize < 4 ? 'Add more friends: from 4 travellers the price per person drops.' : '';

  // Budget output + slider fill
  const bud = $('b-budget');
  $('b-budget-out').textContent = formatINR(s.budget);
  bud.style.setProperty('--fill', `${((s.budget - bud.min) / (bud.max - bud.min)) * 100}%`);

  // Estimate panel
  const range = PRICES_ARE_PUBLIC ? `${formatINR(e.min)} – ${formatINR(e.max)}` : 'Price on request';
  const rangeEl = $('est-range');
  const stops = e.trips.length + e.places.length;
  rangeEl.innerHTML = `${range}<small>per person · ${stops > 1 ? `${stops} destinations` : esc(e.trips[0]?.destination || e.places[0] || 'your custom route')}</small>`;
  if (range !== lastRange && lastRange) { rangeEl.classList.remove('is-tick'); void rangeEl.offsetWidth; rangeEl.classList.add('is-tick'); }
  lastRange = range;
  $('bar-range').textContent = range;
  $('est-days').textContent = `${e.days} days`;
  $('est-total').textContent = PRICES_ARE_PUBLIC
    ? (s.groupSize > 1 ? `${formatINR(e.total.min)} – ${formatINR(e.total.max)} for ${s.groupSize} travellers` : 'For 1 traveller')
    : `Your budget: up to ${formatINR(s.budget)} per person · ${s.groupSize} ${s.groupSize === 1 ? 'traveller' : 'travellers'}`;

  const fit = $('est-fit');
  if (!PRICES_ARE_PUBLIC) fit.textContent = 'Send your choices for a tailored quote on WhatsApp.';
  else if (s.budget >= e.max) fit.textContent = 'Fits your budget.';
  else if (s.budget >= e.min) fit.textContent = 'Close to your budget. We will aim for the lower end.';
  else fit.textContent = `About ${formatINR(e.min - s.budget)} over your budget. Try backpacker stays, fewer days or flexible dates.`;

  const placesRow = e.places.length ? [['Your own places', e.places.join(', ')]] : [];
  const rows = PRICES_ARE_PUBLIC ? [
    ...placesRow,
    [`Trip base (${e.days} days)`, formatINR(e.rows.base)],
    ['Stay type', signed(e.rows.stay)],
    [`Season (${e.season})`, signed(e.rows.season)],
    ['Group size', signed(e.rows.group)],
    ['Flexible dates', signed(e.rows.flex)],
    ['Add-ons', signed(e.rows.addOns)],
  ] : [
    ...placesRow,
    ['Preferred budget', formatINR(s.budget)],
    ['Date flexibility', s.flexibleDays ? `± ${s.flexibleDays} days` : 'Exact dates'],
    ['Group size', String(s.groupSize)],
    ['Stay style', STAY_TYPES.find((stay) => stay.id === s.stayType)?.label || 'Comfort stays'],
    ['Add-ons', ADD_ONS.filter((addon) => s.addOns.includes(addon.id)).map((addon) => addon.label).join(', ') || 'None'],
  ];
  $('est-rows').innerHTML = rows.map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`).join('');

  if (save) {
    const saved = saveBuilderState(s);
    const t = new Date(saved.savedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    $('est-saved').textContent = `Plan saved on this device · ${t}`;
  }
  return { s, e, range };
}

/* ---------- Lead context for WhatsApp ---------- */
function context() {
  const { s, e, range } = render(false);
  const listed = e.trips.map((t) => t.destination);
  const custom = e.places.join(', ');
  const full = `Custom trip: ${[...listed, ...(custom ? [`Other: ${custom}`] : [])].join(' + ') || 'destination open'}`;
  // Context fields are capped at 160 chars by leads.js; long custom lists go in full into the message.
  const trip = full.length <= 150 ? full : `Custom trip: ${[...listed, 'other places (listed below)'].join(' + ')}`;
  const notes = String($('p-msg').value || '').trim();
  const stay = STAY_TYPES.find((x) => x.id === s.stayType);
  const dates = e.validRange
    ? `${fmt(s.startDate)} to ${fmt(s.endDate)} (${e.days} days)`
    : `Dates open (about ${e.days} days)`;
  return {
    trip,
    customPlaces: custom,
    ...(custom ? { message: `Places we want: ${custom}${notes ? `\n\n${notes}` : ''}` } : {}),
    dates: s.flexibleDays ? `${dates}, flexible by ±${s.flexibleDays} days` : dates,
    groupSize: String(s.groupSize),
    budget: `Up to ${formatINR(s.budget)} per person`,
    stay: stay?.label,
    addOns: ADD_ONS.filter((a) => s.addOns.includes(a.id)).map((a) => a.label).join(', ') || 'None',
    estimate: PRICES_ARE_PUBLIC ? `${range} per person (indicative)` : 'Price on request',
  };
}

/* ---------- Events ---------- */
form.addEventListener('input', (ev) => {
  if (ev.target === $('b-other') && parseCustomPlaces($('b-other').value).length) clearOtherError();
  render();
});
form.addEventListener('change', (ev) => {
  if (ev.target.name === 'b-custom') {
    syncOther();
    if (ev.target.checked) $('b-other').focus();
  }
  render();
});
form.addEventListener('submit', (e) => e.preventDefault());
$('g-minus').addEventListener('click', () => { setGroup(Number($('b-group').value) - 1); render(); });
$('g-plus').addEventListener('click', () => { setGroup(Number($('b-group').value) + 1); render(); });
$('start-over').addEventListener('click', () => {
  clearBuilderState();
  writeForm(DEFAULTS);
  lastRange = '';
  render(false);
  $('est-saved').textContent = 'Plan cleared';
  $('s1').scrollIntoView({ block: 'start' });
});

const planForm = $('plan-form');

// Runs before leads.js (registered first): checks the builder choices leads.js cannot see.
planForm.addEventListener('submit', (ev) => {
  const s = readForm();
  let msg = '';
  let target = null;
  if (!s.destinations.length && !s.customOn) {
    msg = 'Choose a destination or select “Custom / somewhere else”.';
    target = form.querySelector('[name="b-dest"]');
  } else if (s.customOn && !parseCustomPlaces(s.other).length) {
    msg = 'Tell us which place(s) you want, or untick “Custom / somewhere else”.';
    showOtherError('Type at least one place, e.g. Hampi, Andaman.');
    target = $('b-other');
  } else if (s.startDate && s.endDate && s.endDate < s.startDate) {
    msg = 'Your end date is before your start date. Please pick a later end date.';
    target = $('b-end');
  }
  if (!msg) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  const status = planForm.querySelector('[data-form-status]');
  status.dataset.state = 'error';
  status.textContent = msg;
  window.EC?.buttons?.setState(planForm.querySelector('.btn--submit'), 'error');
  target.scrollIntoView({ block: 'center' });
  target.focus({ preventScroll: true });
});

attachLeadForm(planForm, { getContext: context });
// Mirror leads.js result on the pill-to-circle button (leads.js handler runs first).
planForm.addEventListener('submit', () => {
  const B = window.EC?.buttons;
  const btn = planForm.querySelector('.btn--submit');
  if (!B || !btn) return;
  if (planForm.querySelector('[data-form-status]').dataset.state === 'success') {
    B.setState(btn, 'loading');
    setTimeout(() => B.setState(btn, 'success'), 450);
    setTimeout(() => B.setState(btn, 'idle'), 3200);
  } else B.setState(btn, 'error');
});

/* Mobile: the summary bar is always present, so lift the WhatsApp button. */
const mq = matchMedia('(max-width: 63.99em)');
const syncBar = () => document.body.classList.toggle('has-bottombar', mq.matches);
mq.addEventListener?.('change', syncBar);
syncBar();

/* ---------- Boot: saved state, then ?trip= preselect ---------- */
const saved = getBuilderState();
const start = { ...DEFAULTS, ...(saved || {}) };
if (saved && saved.customOn === undefined && saved.other) start.customOn = true; // plans saved before the custom chip existed
const pre = getTripBySlug(new URLSearchParams(location.search).get('trip') || '');
if (pre && !start.destinations.includes(pre.id)) start.destinations = [...start.destinations, pre.id];
writeForm(start);
render(!!pre);
if (saved) $('est-saved').textContent = 'Your saved plan is restored';
