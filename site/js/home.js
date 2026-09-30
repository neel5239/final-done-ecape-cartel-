/**
 * Home page behaviour.
 *  - Hero: word reveal over the static Kedarkantha photo.
 *  - Trip preview: open student groups; every card links to its itinerary.
 *  - Reveal-on-enter with ScrollTrigger (once: true). No scrub, no pinning.
 *  - Student groups: stats and top-3 upcoming groups, all read from
 *    store.getTrips() (seed groups are demo data).
 *  - Lead form wired to js/leads.js with the pill-to-circle submit morph.
 */
import { MONTHS, PICKUP_POINTS } from './data.js';
import { onStoreChange, getTrips as getGroupTrips } from './store.js';
import { attachLeadForm } from './leads.js';

const doc = document;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

/* ---------- 1. Hero -------------------------------------------------------- */
const hero = doc.getElementById('hero');

function splitWords(el) {
  const text = el.textContent.trim();
  el.setAttribute('aria-label', text); // screen readers get the sentence, not fragments
  el.innerHTML = text.split(/\s+/).map((w) => `<span class="w" aria-hidden="true"><span>${esc(w)}</span></span>`).join(' ');
  el.classList.add('is-split');
  return el.querySelectorAll('.w > span');
}

function revealHero() {
  const title = hero.querySelector('[data-split]');
  const fades = hero.querySelectorAll('[data-hero-fade]');
  if (!title) return;
  if (reduced || !gsap) {
    title.classList.add('is-split');
    hero.classList.add('is-revealed');
    return;
  }
  const words = splitWords(title);
  hero.classList.add('is-revealed');
  gsap.timeline({ defaults: { ease: 'expo.out' } })
    .from(words, { yPercent: 115, rotate: 4, duration: 1.1, stagger: 0.045 })
    .from(fades, { y: 24, autoAlpha: 0, duration: 0.9, stagger: 0.1 }, '-=0.75')
    .from('.hero-card', { y: 30, autoAlpha: 0, duration: 1 }, '-=0.7');
}

function fillNextDeparture() {
  const t = openGroups()[0];
  if (!t) return;
  const set = (sel, value) => { const el = hero.querySelector(sel); if (el) el.textContent = value; };
  set('[data-next-trip]', t.title || t.destination);
  set('[data-next-meta]', `${fmtDate(t.date)} · ${inr(t.budgetPerPerson)} / person`);
  set('[data-next-left]', `${t.seatsLeft} ${t.seatsLeft === 1 ? 'seat' : 'seats'} left`);
  set('[data-next-filled]', `${t.filledPercent}% filled`);
  hero.querySelector('[data-next-fill]')?.style.setProperty('--fill', (t.filledPercent / 100).toFixed(2));
  const seats = hero.querySelector('[data-next-seats]');
  if (seats) seats.hidden = false;
  const link = hero.querySelector('[data-next-link]');
  if (link) {
    link.href = joinUrl(t);
    link.setAttribute('aria-label', `View the itinerary for ${t.title || t.destination}`);
  }
}

/* ---------- 2. Stats + group trips (from store, never invented) ---------- */
// Seed groups are demo data; the footer carries the single visible disclosure.
const localIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/** Open groups (not full, date today or later), soonest first. */
function openGroups() {
  const today = localIso();
  return getGroupTrips()
    .filter((t) => !t.isFull && t.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seatsLeft - b.seatsLeft));
}

function fillStats() {
  const all = getGroupTrips();
  const open = openGroups();
  const set = (k, v) => { const el = doc.querySelector(`[data-gstat="${k}"]`); if (el) el.textContent = v; };
  set('groups', open.length);
  set('seats', open.reduce((n, t) => n + t.seatsLeft, 0));
  set('created', all.filter((t) => t.isUserCreated).length);
  set('pickups', PICKUP_POINTS.length);
}

// Every card leads to the full day-by-day itinerary; Join lives on that page.
const joinUrl = (t) => `/itinerary?trip=${encodeURIComponent(t.id)}`;

function groupCardHTML(t) {
  const low = t.seatsLeft <= 3;
  return `
  <li class="group-card">
    <figure class="group-card__media">
      <img src="${esc(t.image)}" alt="${esc(t.imageAlt)}" width="${t.imageWidth || 1600}" height="${t.imageHeight || 1067}" loading="lazy" decoding="async">
      <figcaption class="group-card__tag">${esc(t.durationLabel || 'Group trip')}</figcaption>
    </figure>
    <div class="group-card__body">
      <p class="group-card__where">${esc(t.destination)}</p>
      <h3 class="group-card__name"><a href="${joinUrl(t)}">${esc(t.title || t.destination)}</a></h3>
      <p class="group-card__when">${esc(fmtDate(t.date))} · from ${esc(t.pickupLabel)}</p>
      <div class="spots${low ? ' spots--low' : ''}">
        <span class="spots__row"><span>${t.seatsLeft} ${t.seatsLeft === 1 ? 'seat' : 'seats'} left</span><span>${t.filledPercent}% filled</span></span>
        <span class="spots__bar" role="progressbar" aria-label="${esc(t.title || t.destination)} seats filled" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.filledPercent}"><i style="--fill:${(t.filledPercent / 100).toFixed(2)}"></i></span>
      </div>
      <div class="group-card__foot">
        <p class="group-card__price">${esc(inr(t.budgetPerPerson))}<span> / person</span></p>
        <a class="btn btn--primary btn--sm btn--ripple" href="${joinUrl(t)}" aria-label="View the itinerary for ${esc(t.title || t.destination)}"><span class="btn__label">View itinerary</span></a>
      </div>
    </div>
  </li>`;
}

function renderGroups() {
  const grid = doc.querySelector('[data-group-grid]');
  if (!grid) return;
  const list = openGroups().slice(0, 3);
  grid.innerHTML = list.length
    ? list.map(groupCardHTML).join('')
    : '<li class="group-grid__empty">No open groups right now. <a href="plan.html">Plan a private trip</a> for your friends instead.</li>';
}

/* Sundar One perk card: the open trips that pick up at the hostel gate. */
function renderPerkTrips() {
  const list = doc.querySelector('[data-perk-trips]');
  if (!list) return;
  list.innerHTML = openGroups()
    .filter((t) => t.pickupPointId === 'sundar-one')
    .slice(0, 3)
    .map((t) => `<li><a href="${joinUrl(t)}"><strong>${esc(t.title || t.destination)}</strong><span>${esc(fmtDate(t.date))}</span></a></li>`)
    .join('');
}

/* The floating "Next up" bar is retired: it covered section copy on desktop
   and repeated the hero card, which already shows the next departure. */

/* ---------- 3. Home trip grid: the same groups as the teaser ---------- */
const grid = doc.querySelector('[data-trip-grid]');
const advanced = doc.querySelector('[data-home-filters]');

function cardHTML(t) {
  const url = joinUrl(t);
  const low = t.seatsLeft <= 3;
  return `
  <li class="trip-card" data-reveal data-id="${esc(t.id)}">
    <figure class="trip-card__media">
      <img src="${esc(t.image)}" alt="${esc(t.imageAlt)}" width="${t.imageWidth || 1600}" height="${t.imageHeight || 1067}" loading="lazy" decoding="async">
      <figcaption class="trip-card__tag">${esc(t.durationLabel || 'Group trip')}</figcaption>
    </figure>
    <div class="trip-card__body">
      <p class="trip-card__where">${esc(t.destination)}</p>
      <h3 class="trip-card__name"><a href="${url}">${esc(t.title || t.destination)}</a></h3>
      <p class="trip-card__line">${esc(t.blurb || '')}</p>
      <p class="trip-card__details"><strong>${esc(fmtDate(t.date))}</strong> · Pickup: ${esc(t.pickupLabel)}</p>
      <div class="spots${low ? ' spots--low' : ''}">
        <span class="spots__row"><span>${t.seatsLeft} ${t.seatsLeft === 1 ? 'seat' : 'seats'} left</span><span>${t.filledPercent}% filled</span></span>
        <span class="spots__bar" role="progressbar" aria-label="${esc(t.title || t.destination)} seats filled" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.filledPercent}"><i style="--fill:${(t.filledPercent / 100).toFixed(2)}"></i></span>
      </div>
      <div class="trip-card__foot">
        <p class="trip-card__price">${esc(inr(t.budgetPerPerson))}<span> / person</span></p>
        <a class="btn btn--primary btn--sm btn--ripple" href="${url}" aria-label="View the itinerary for ${esc(t.title || t.destination)}"><span class="btn__label">View itinerary</span></a>
      </div>
    </div>
  </li>`;
}

function renderTrips() {
  if (!grid) return;
  const values = advanced ? new FormData(advanced) : null;
  const destination = values?.get('destination') || '';
  const month = Number(values?.get('month') || 0);
  const matches = openGroups().filter((t) =>
    (!destination || t.destination === destination) &&
    (!month || Number(t.date.slice(5, 7)) === month)
  );
  grid.innerHTML = matches.map(cardHTML).join('');
  grid.classList.toggle('is-empty', matches.length === 0);
  const count = doc.querySelector('[data-more-count]');
  const names = doc.querySelector('[data-more-list]');
  if (count) count.textContent = `${matches.length} open ${matches.length === 1 ? 'group' : 'groups'}`;
  if (names) names.textContent = matches.map((t) => t.destination).join(' · ');
  if (gsap && !reduced) gsap.from(grid.children, { y: 28, autoAlpha: 0, duration: 0.7, stagger: 0.06, ease: 'expo.out', clearProps: 'transform,opacity,visibility' });
}

function initTrips() {
  if (advanced) {
    const destination = advanced.querySelector('[name="destination"]');
    const month = advanced.querySelector('[name="month"]');
    // Only destinations and months that have an open group, so no filter leads nowhere.
    const open = openGroups();
    [...new Set(open.map((t) => t.destination))].sort().forEach((name) => destination?.insertAdjacentHTML('beforeend', `<option value="${esc(name)}">${esc(name)}</option>`));
    [...new Set(open.map((t) => Number(t.date.slice(5, 7))))].forEach((m) => month?.insertAdjacentHTML('beforeend', `<option value="${m}">${esc(MONTHS[m - 1])}</option>`));
    advanced.addEventListener('change', () => renderTrips());
    advanced.addEventListener('submit', (e) => e.preventDefault());
  }
  renderTrips();
  onStoreChange((c) => {
    // Same-tab changes arrive as 'groupTrips'; other tabs report the storage key name.
    if (['groupTrips', 'groupJoins', 'ownerTrips'].includes(c?.key)) { fillStats(); renderGroups(); renderTrips(); renderPerkTrips(); fillNextDeparture(); }
  });
}

/* ---------- Reveal on enter (once) ---------------------------------------- */
function initReveals() {
  if (!gsap || !ScrollTrigger || reduced) return;
  // Transform/opacity only; skipped entirely on reduced motion (guard above).
  const els = doc.querySelectorAll('main [data-reveal]:not(.trip-card)');
  gsap.set(els, { y: 32, autoAlpha: 0 });
  ScrollTrigger.batch(els, {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { y: 0, autoAlpha: 1, duration: 0.9, stagger: 0.08, ease: 'expo.out', overwrite: true }),
  });
  // headings of each section rise in once too
  doc.querySelectorAll('main section:not(.hero) h2').forEach((h) => {
    gsap.from(h, { y: 40, autoAlpha: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: h, start: 'top 90%', once: true } });
  });
  // late layout changes (fonts, images) move trigger points
  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}

/* ---------- 8. Lead form --------------------------------------------------- */
function initForm() {
  const form = doc.querySelector('[data-lead-form]');
  if (!form) return;
  const tripSel = form.querySelector('[data-trip-select]');
  getGroupTrips().forEach((t) => tripSel?.insertAdjacentHTML('beforeend', `<option value="${esc(t.title || t.destination)}">${esc(t.title || t.destination)}</option>`));
  const monthSel = form.querySelector('[data-month-select]');
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    monthSel?.insertAdjacentHTML('beforeend', `<option value="${label}">${label}</option>`);
  }
  const btn = form.querySelector('.btn--submit');
  const status = form.querySelector('[data-form-status]');
  attachLeadForm(form, { getContext: () => ({ source: 'Home page form' }) });
  // Runs after leads.js's own submit handler: mirror its result on the button.
  form.addEventListener('submit', () => {
    const EC = window.EC;
    if (!EC?.buttons || !btn) return;
    const state = status?.dataset.state;
    if (state === 'success') {
      EC.buttons.setState(btn, 'loading');
      setTimeout(() => EC.buttons.setState(btn, 'success'), 450);
    } else if (state === 'error') {
      EC.buttons.setState(btn, 'error');
      form.querySelector('[aria-invalid="true"]')?.focus();
    }
  });
}

/* ---------- boot ----------------------------------------------------------- */
function boot() {
  fillNextDeparture();
  fillStats();
  renderGroups();
  renderPerkTrips();
  initTrips();
  initForm();
  revealHero();
  initReveals();
}

// Module scripts run after the deferred shell scripts; the header partial may
// still be loading, which does not matter here.
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
else boot();
