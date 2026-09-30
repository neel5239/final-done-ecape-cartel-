/**
 * Day-by-day "About the trip" timeline on trip.html?slug=...
 * Reads the trip from data.js and its day plan from trip-itinerary-data.js,
 * then fills #tl-* inside <section id="trip-itinerary">. Styles: css/trip-itinerary.css.
 */
import { DIFFICULTY, TRIPS, getTripBySlug } from './data.js';
import { ITINERARY } from './trip-itinerary-data.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtShort = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const root = $('trip-itinerary');
const params = new URLSearchParams(location.search);
const requestedTrip = params.get('slug') || params.get('trip') || params.get('id');
const trip = requestedTrip
  ? getTripBySlug(requestedTrip) || TRIPS.find((t) => t.id === requestedTrip)
  : TRIPS[0];
const plan = trip && ITINERARY[trip.id];

function photos(images, dayNum) {
  return `<div class="tl-photos tl-photos--${images.length}" aria-label="Photos for day ${dayNum}" role="group">${images.map((im) =>
    `<img src="${esc(im.src)}" alt="${esc(im.alt)}" width="128" height="96" loading="lazy" decoding="async" style="object-position:${esc(im.pos)}">`).join('')}</div>`;
}

function day(d, i) {
  return `
    <li class="tl-day${i % 2 ? ' tl-day--flip' : ''}">
      <span class="tl-day__dot" aria-hidden="true"></span>
      <div class="tl-day__text">
        <p class="tl-day__num">Day ${esc(d.day)}</p>
        <h3 class="tl-day__title">${esc(d.title)}</h3>
        <ul class="tl-day__list" role="list">${d.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>
      ${photos(d.images, d.day)}
    </li>`;
}

function render() {
  const diff = DIFFICULTY[trip.difficulty];
  const today = new Date().toISOString().slice(0, 10);
  const next = trip.departures.find((d) => d >= today);
  const facts = [
    ['Next batch', next ? `${fmtShort(next)}${trip.datesAreIndicative ? ' (indicative)' : ''}` : 'New dates soon'],
    ['Duration', `${trip.nights} Nights / ${trip.days} Days`],
    ['Starts from', trip.startPoint],
    ['Difficulty', diff ? diff.label : trip.difficulty],
  ];
  $('tl-intro').textContent = plan.intro;
  $('tl-covers').innerHTML = `You’ll cover: <span>${plan.covers.map(esc).join(', ')}</span>.`;
  $('tl-facts').innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const list = $('tl-days');
  list.innerHTML = plan.days.map(day).join('');

  // Days fade in as they scroll into view; skipped for reduced motion or no observer.
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('is-anim');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px' });
    list.querySelectorAll('.tl-day').forEach((el) => io.observe(el));
  }
  root.hidden = false;
}

if (root && plan) render();
else if (root) root.remove();
