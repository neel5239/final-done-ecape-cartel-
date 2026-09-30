/**
 * Itinerary page (itinerary.html): without a trip ID, visitors go to /trips/.
 *  - ?trip=ID: one trip, read from the schema at the top of data.js: hero (cover, price, dates, seats),
 *              sticky day navigator, a block per day (image, place, what we do, activities, stay),
 *              inclusions + stays + price summary, then "Join this trip" (also a sticky bar on phones).
 * Joining starts at /checkout?trip=ID, where the traveller adds details before demo payment.
 * The seat is counted only after the demo payment succeeds (checkout.js).
 * Legacy ?id=ID and ?join=ID links open the same itinerary.
 */
import { PICKUP_POINTS, DROP_NOTE } from './data.js';
import { getTrips, getTrip, createBooking, onStoreChange } from './store.js';
import { renderGroupCard, itineraryUrl } from './trips.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const params = new URLSearchParams(location.search);
const tripId = params.get('trip') || params.get('id') || params.get('join') || '';
if (tripId && !params.get('trip')) history.replaceState(null, '', itineraryUrl(tripId));

/* =========================== LIST VIEW =========================== */
function initList() {
  const grid = $('it-grid');
  const form = $('it-filters');
  const destGroup = $('it-dest');
  const pickupGroup = $('it-pickup');

  const dests = [...new Set(getTrips().map((t) => t.destination))].sort((a, b) => a.localeCompare(b));
  destGroup.insertAdjacentHTML('beforeend', dests.map((d) =>
    `<label class="chip"><input type="radio" name="dest" value="${esc(d)}"><span>${esc(d)}</span></label>`).join(''));
  pickupGroup.insertAdjacentHTML('beforeend', PICKUP_POINTS.map((p) =>
    `<label class="chip"><input type="radio" name="pickup" value="${esc(p.id)}"><span>${esc(p.label)}</span></label>`).join(''));

  const readState = () => {
    const fd = new FormData(form);
    return { dest: fd.get('dest') || '', pickup: fd.get('pickup') || '', sort: fd.get('sort') || 'soonest' };
  };
  const check = (name, v) => { const el = form.querySelector(`[name="${name}"][value="${CSS.escape(v)}"]`); if (el) el.checked = true; };
  check('dest', params.get('dest') || '');
  check('pickup', params.get('pickup') || '');
  if (['soonest', 'budget', 'filled'].includes(params.get('sort'))) form.elements.sort.value = params.get('sort');

  const SORTS = {
    soonest: (a, b) => String(a.date).localeCompare(String(b.date)),
    budget: (a, b) => a.budgetPerPerson - b.budgetPerPerson || String(a.date).localeCompare(String(b.date)),
    filled: (a, b) => b.filledPercent - a.filledPercent || String(a.date).localeCompare(String(b.date)),
  };

  const render = () => {
    const all = getTrips();
    const s = readState();
    const list = all
      .filter((t) => (!s.dest || t.destination === s.dest) && (!s.pickup || t.pickupPointId === s.pickup))
      .sort(SORTS[s.sort] || SORTS.soonest);
    grid.innerHTML = list.map((t, i) => renderGroupCard(t, i)).join('');
    grid.hidden = list.length === 0;
    $('it-empty').hidden = list.length > 0;
    $('it-loading').hidden = true;
    $('it-count').textContent = `${list.length} ${list.length === 1 ? 'trip' : 'trips'}${list.length !== all.length ? ` of ${all.length}` : ''}`;
    const p = new URLSearchParams();
    if (s.dest) p.set('dest', s.dest);
    if (s.pickup) p.set('pickup', s.pickup);
    if (s.sort !== 'soonest') p.set('sort', s.sort);
    const q = p.toString();
    history.replaceState(null, '', q ? `?${q}` : location.pathname);
  };

  render();
  form.addEventListener('change', render);
  form.addEventListener('submit', (e) => e.preventDefault());
  $('it-reset').addEventListener('click', () => { form.reset(); render(); });
  onStoreChange(({ key }) => { if (['groupTrips', 'groupJoins', 'ownerTrips'].includes(key)) render(); });
}

/* =========================== DETAIL VIEW =========================== */
const ICON = {
  pin: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.2" stroke="currentColor" stroke-width="1.8"/></svg>',
  bed: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 18V7m0 7h18v4M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="11" r="1.8" stroke="currentColor" stroke-width="1.8"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 17h11a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m17 2 3 3-3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  yes: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function setMeta(name, value, attr = 'name') {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el); }
  el.setAttribute('content', value);
}

function showMissing() {
  document.title = 'Trip not found | Escape Cartel';
  $('it-list-view').hidden = true;
  $('it-detail-view').hidden = true;
  $('it-missing').hidden = false;
}

/** Photos for one day: its own photo (small copy in the timeline, full size in the viewer), else the
 *  trip cover, then any extra photos of the same place. `fallback` is tried if a photo fails to load;
 *  after that the photo is dropped from the day and the viewer. */
const dayPhotos = (t, d) => {
  const cover = t.coverImage || t.image || '';
  const main = d.image
    ? { src: d.image, thumb: d.thumb || d.image, alt: d.imageAlt || `${d.place || t.destination}, day ${d.day}`, fallback: d.imageFallback || (d.image !== cover ? cover : '') }
    : { src: cover, thumb: cover, alt: t.coverAlt || t.imageAlt || t.destination, fallback: '' };
  const more = (d.morePhotos || []).map((p) => ({ ...p, fallback: '' }));
  return [main, ...more].filter((p) => p.src).slice(0, 3);
};

/* Broken day photo: try the full-size copy, then the fallback, then remove it (and skip it in the viewer). */
function wireDayImageFallbacks(shots) {
  $('ix-timeline').addEventListener('error', (e) => {
    const im = e.target;
    if (!(im instanceof HTMLImageElement)) return;
    const btn = im.closest('[data-lb]');
    if (!btn) return;
    const shot = shots[Number(btn.dataset.lb)];
    const tries = [...new Set([shot.thumb, shot.src, shot.fallback].filter(Boolean))];
    const step = Number(im.dataset.try || 0) + 1;
    if (step < tries.length) {
      im.dataset.try = String(step);
      if (tries[step] === shot.fallback) shot.src = shot.fallback;
      im.src = tries[step];
      return;
    }
    shot.broken = true;
    const group = btn.parentElement;
    btn.remove();
    group.className = group.className.replace(/tl-photos--\d/, `tl-photos--${group.children.length}`);
    if (!group.children.length) group.remove();
  }, true);
}

/** Short day lines for the timeline: the day's own snapshot, else its first activities. */
const dayPoints = (d) => (d.points && d.points.length ? d.points : (d.activities || []).filter(Boolean).slice(0, 3));
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const fmtDay = (iso, year) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });

function renderDetail(t) {
  $('it-list-view').hidden = true;
  $('it-detail-view').hidden = false;
  const days = Array.isArray(t.days) ? t.days : [];
  const dates = (t.dates && t.dates.length ? t.dates : [t.date]).filter(Boolean);
  const price = t.price ?? t.budgetPerPerson;
  const nights = days.filter((d) => d.hotel).length;
  const seatsText = t.isFull ? 'Full' : `${t.seatsLeft} of ${t.seatsTotal} seats left`;

  /* ---- SEO ---- */
  const desc = `${days.length}-day student group trip to ${t.destination}. ${t.summary || t.blurb || ''} Day-by-day plan, stays, inclusions and price per person.`.trim();
  document.title = `${t.title}: day-by-day itinerary | Escape Cartel`;
  setMeta('description', desc);
  setMeta('og:title', `${t.title} | Escape Cartel`, 'property');
  setMeta('og:description', desc, 'property');
  if (!String(t.coverImage).startsWith('data:')) setMeta('og:image', t.coverImage || t.image, 'property');

  /* ---- Hero ---- */
  const cover = $('ix-cover');
  cover.src = t.coverImage || t.image;
  cover.alt = t.coverAlt || t.imageAlt || '';
  if (t.imageWidth) { cover.width = t.imageWidth; cover.height = t.imageHeight; }
  $('ix-loc').textContent = [t.draft && 'Draft preview (only you can see this)', t.destination, t.durationLabel].filter(Boolean).join(' · ');
  $('ix-title').textContent = t.title;
  $('ix-summary').textContent = t.summary || t.blurb || '';
  const stats = [
    ['Price', `${inr(price)} per person`],
    [dates.length > 1 ? 'Departures' : 'Departure', dates.length ? `${fmtDate(dates[0])}${dates.length > 1 ? ` +${dates.length - 1} more` : ''}` : 'Dates on request'],
    ['Seats', seatsText],
    ['Pickup', t.pickupLabel || 'Shared after you join'],
  ];
  $('ix-stats').innerHTML = stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

  /* ---- Day navigator ---- */
  $('ix-daynav-list').innerHTML = days.map((d) => `
    <li><a class="ix-daynav__link" href="#day-${d.day}" data-day="${d.day}"><strong>Day ${d.day}</strong><span>${esc(d.short || d.place || d.title)}</span></a></li>`).join('')
    + '<li><a class="ix-daynav__link ix-daynav__link--join" href="#ix-book"><strong>Price</strong><span>and join</span></a></li>';

  /* ---- About the trip: story, key facts, then the day-by-day timeline ---- */
  $('ix-intro').textContent = t.summary || t.blurb || '';
  const places = [...new Set(days.map((d) => d.place).filter((p) => p && !/ to /i.test(p)))]
    .filter((p, _, all) => !all.some((q) => q !== p && p.includes(q)));
  $('ix-covers').innerHTML = `You’ll cover: <span>${esc((places.length ? places : [t.destination]).join(', '))}</span>.`;
  const start = dates[0];
  const end = start && days.length > 1 ? addDays(start, days.length - 1) : '';
  const facts = [
    ['Date', start ? (end ? `${fmtDay(start)} – ${fmtDay(end, true)}` : fmtDay(start, true)) : 'On request'],
    ['Duration', days.length > 1 ? `${days.length - 1} ${days.length === 2 ? 'Night' : 'Nights'} / ${days.length} Days` : 'Day trip'],
    ['Pickup', t.pickupLabel || 'Chosen when you join'],
    ['Seats', t.isFull ? 'Full' : `${t.seatsLeft} of ${t.seatsTotal} left`],
  ];
  $('ix-facts').innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

  const shots = [];
  $('ix-timeline').innerHTML = days.map((d, i) => {
    const pics = dayPhotos(t, d).map((p) => {
      const n = shots.push({ ...p, cap: `Day ${d.day}: ${d.place || d.title}` }) - 1;
      return `<button type="button" data-lb="${n}" aria-label="Enlarge photo: ${esc(p.alt)}"><img src="${esc(p.thumb || p.src)}" alt="" width="240" height="160" loading="lazy" decoding="async"></button>`;
    });
    return `
    <li class="tl-day${i % 2 ? ' tl-day--flip' : ''}" id="day-${d.day}">
      <span class="tl-day__dot" aria-hidden="true"></span>
      <div class="tl-day__text">
        <p class="tl-day__num">Day ${d.day}</p>
        <h3 class="tl-day__title" title="${esc(d.title)}">${esc(d.short || d.title)}</h3>
        <ul class="tl-day__list" role="list">${dayPoints(d).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      ${pics.length ? `<div class="tl-photos tl-photos--${pics.length}" role="group" aria-label="Photos for day ${d.day}">${pics.join('')}</div>` : ''}
    </li>`;
  }).join('') || '<li class="tl-day tl-day--empty"><p>The day-by-day plan for this trip is being finalised. Ask us on WhatsApp for the latest plan.</p></li>';
  wireDayImageFallbacks(shots);

  /* ---- Inclusions + stays ---- */
  const incl = (t.inclusions || []).filter(Boolean);
  $('ix-incl').innerHTML = incl.length
    ? incl.map((x) => `<li>${ICON.yes}<span>${esc(x)}</span></li>`).join('')
    : '<li><span class="muted">Inclusions are confirmed on WhatsApp before you pay.</span></li>';
  const stays = days.filter((d) => d.hotel);
  $('ix-stays').innerHTML = stays.length
    ? stays.map((d) => `<li>${ICON.bed}<div><strong>Day ${d.day}, ${esc(d.place || d.title)}</strong><span>${esc(d.hotel.name)}${d.hotel.note ? `. ${esc(d.hotel.note)}` : ''}</span></div></li>`).join('')
    : `<li>${ICON.move}<div><strong>No overnight stay</strong><span>This trip returns the same day.</span></div></li>`;

  /* ---- Price summary + Join ---- */
  $('ix-sum-price').textContent = inr(price);
  const sum = [
    ['Trip', t.title],
    ['Length', `${days.length} ${days.length === 1 ? 'day' : 'days'}${nights ? `, ${nights} ${nights === 1 ? 'night' : 'nights'} stay` : ''}`],
    ['Departure', dates.length ? fmtDate(dates[0]) : 'On request'],
    ['Pickup', t.pickupLabel || 'Chosen when you join'],
    ['Drop', t.dropNote || DROP_NOTE],
  ];
  $('ix-sum-list').innerHTML = sum.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const low = !t.isFull && t.seatsLeft <= 3;
  const seats = $('ix-sum-seats');
  seats.className = `it-seats${t.isFull ? ' it-seats--full' : low ? ' it-seats--low' : ''}`;
  seats.innerHTML = `
    <div class="it-seats__row"><span class="it-seats__left">${esc(t.isFull ? 'Full' : `${t.seatsLeft} ${t.seatsLeft === 1 ? 'seat' : 'seats'} left`)}</span><span>${t.membersJoined} of ${t.seatsTotal} joined</span></div>
    <div class="it-seats__bar" role="presentation"><i style="--filled:${t.filledPercent / 100}"></i></div>`;
  const joinBtn = (extra = '') => (t.isFull
    ? `<a class="btn btn--liquid-fill btn--lg ${extra}" href="plan.html"><span class="btn__label">Trip full: plan a private one</span></a>`
    : `<a class="btn btn--primary btn--lg ${extra}" href="/checkout?trip=${encodeURIComponent(t.id)}"><span class="btn__label">Join this trip</span></a>`);
  $('ix-join-slot').innerHTML = joinBtn('btn--block ix-join');
  $('ix-bar-slot').innerHTML = joinBtn('ix-bar__btn');
  $('ix-bar-price').textContent = inr(price);

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-join]');
    if (b) openJoin(t, b);
  });

  wireDayNav();
  wireLightbox(shots);
  wireBar();
  animate();
}

/* Sticky day navigator: highlight the day on screen, keep its pill in view. */
function wireDayNav() {
  const nav = $('ix-daynav');
  const links = [...nav.querySelectorAll('[data-day]')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const setActive = (day) => links.forEach((a) => {
    const on = a.dataset.day === String(day);
    a.classList.toggle('is-active', on);
    if (on) {
      a.setAttribute('aria-current', 'step');
      const list = a.closest('ol');
      const x = a.offsetLeft - (list.clientWidth - a.offsetWidth) / 2;
      list.scrollTo({ left: Math.max(0, x), behavior: reduced() ? 'auto' : 'smooth' });
    } else a.removeAttribute('aria-current');
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) setActive(en.target.id.replace('day-', '')); });
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('.tl-day[id^="day-"]').forEach((el) => io.observe(el));
}

/* Tap a day photo to see it full screen (useful on phones); arrows / swipe move between days. */
function wireLightbox(shots) {
  const lb = $('ix-lightbox');
  const img = $('ix-lb-img');
  let idx = 0;
  let opener = null;
  const show = (i) => {
    const step = i < idx ? -1 : 1;
    idx = (i + shots.length) % shots.length;
    for (let n = 0; shots[idx].broken && n < shots.length; n += 1) idx = (idx + step + shots.length) % shots.length;
    img.src = shots[idx].src;
    img.alt = shots[idx].alt;
    $('ix-lb-cap').textContent = shots[idx].cap;
    $('ix-lb-count').textContent = `${idx + 1} / ${shots.length}`;
    $('ix-lb-prev').disabled = $('ix-lb-next').disabled = shots.length < 2;
  };
  $('ix-timeline').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lb]');
    if (!b) return;
    opener = b;
    show(Number(b.dataset.lb));
    lb.showModal();
  });
  $('ix-lb-prev').addEventListener('click', () => show(idx - 1));
  $('ix-lb-next').addEventListener('click', () => show(idx + 1));
  lb.querySelector('[data-close]').addEventListener('click', () => lb.close());
  lb.addEventListener('close', () => opener?.focus?.());
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });
  let x0 = null;
  $('ix-lb-stage').addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  $('ix-lb-stage').addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
    else if (e.target === $('ix-lb-stage')) lb.close();
  });
}

/* Mobile join bar: available after the day-by-day plan, hidden while the price summary is on screen. */
function wireBar() {
  const bar = $('ix-bar');
  bar.hidden = false;
  const mq = matchMedia('(max-width: 63.99em)');
  let pastDays = false;
  let atBook = false;
  const update = () => {
    const show = mq.matches && pastDays && !atBook;
    bar.classList.toggle('is-visible', show);
    bar.inert = !show;
    document.body.classList.toggle('has-bottombar', mq.matches && pastDays);
  };
  new IntersectionObserver((e) => { pastDays = !e[0].isIntersecting && e[0].boundingClientRect.bottom < 0; update(); }).observe($('ix-days'));
  new IntersectionObserver((e) => { atBook = e[0].isIntersecting; update(); }).observe(document.querySelector('.ix-summary'));
  mq.addEventListener?.('change', update);
  update();
}

/* GSAP reveals: hero copy settles in, each day rises as it enters, the route line fills with scroll.
   Nothing is hidden unless GSAP runs, and reduced motion skips it all. */
function animate() {
  const gsap = window.gsap;
  const ST = window.ScrollTrigger;
  if (!gsap || !ST || reduced()) return;
  gsap.registerPlugin(ST);
  gsap.from('.ix-hero__inner > *', { y: 28, autoAlpha: 0, duration: 0.9, stagger: 0.07, ease: 'expo.out', clearProps: 'transform,opacity,visibility' });
  gsap.utils.toArray('.tl-day:not(.tl-day--empty)').forEach((day) => {
    const flip = day.classList.contains('tl-day--flip');
    const wide = matchMedia('(min-width: 64em)').matches;
    const tl = gsap.timeline({ scrollTrigger: { trigger: day, start: 'top 82%', once: true } });
    tl.from(day.querySelector('.tl-day__dot'), { scale: 0.3, autoAlpha: 0, duration: 0.5, ease: 'back.out(2.2)', clearProps: 'transform,opacity,visibility' })
      .from(day.querySelector('.tl-day__text'), { x: wide ? (flip ? 36 : -36) : 24, autoAlpha: 0, duration: 0.8, ease: 'expo.out', clearProps: 'transform,opacity,visibility' }, 0.05)
      .from(day.querySelectorAll('.tl-day__list li'), { y: 10, autoAlpha: 0, duration: 0.5, stagger: 0.06, ease: 'power2.out', clearProps: 'transform,opacity,visibility' }, 0.25)
      .from(day.querySelectorAll('.tl-photos > button'), {
        y: 28, rotate: (n) => (n % 2 ? 4 : -4), scale: 0.9, autoAlpha: 0, duration: 0.8, stagger: 0.1, ease: 'expo.out', clearProps: 'transform,opacity,visibility',
      }, 0.15);
  });
  const fill = $('ix-rail-fill');
  if (fill) {
    gsap.fromTo(fill, { scaleY: 0 }, {
      scaleY: 1, ease: 'none',
      scrollTrigger: { trigger: '.ix-route', start: 'top 60%', end: 'bottom 60%', scrub: true },
    });
  }
  gsap.from('.ix-book__info > *, .ix-summary', {
    y: 32, autoAlpha: 0, duration: 0.8, stagger: 0.06, ease: 'expo.out', clearProps: 'transform,opacity,visibility',
    scrollTrigger: { trigger: '#ix-book', start: 'top 80%', once: true },
  });
  // Lazy images change heights after load: keep trigger positions honest.
  document.querySelectorAll('.tl-photos img').forEach((im) => im.addEventListener('load', () => ST.refresh(), { once: true }));
}

/* =========================== JOIN DIALOG =========================== */
const dialog = $('it-join');
const joinForm = $('it-join-form');
const status = $('it-join-status');
const submitBtn = $('it-join-submit');
const fieldMap = { name: 'it-name', phone: 'it-phone', pickupId: 'it-pickup', budgetConfirmed: 'it-budget' };
let current = null;
let opener = null;

$('it-pickup-opts').innerHTML = PICKUP_POINTS.map((p) => `
  <label class="it-radio">
    <input type="radio" name="pickup" value="${esc(p.id)}" required aria-describedby="it-pickup-err">
    <span>${esc(p.label)}</span>
  </label>`).join('');

function setError(field, msg) {
  const err = $(`${fieldMap[field]}-err`);
  if (err) err.textContent = msg || '';
  const controls = field === 'pickupId' ? joinForm.querySelectorAll('[name="pickup"]') : [joinForm.elements[field === 'budgetConfirmed' ? 'budget' : field]];
  controls.forEach((c) => c && (msg ? c.setAttribute('aria-invalid', 'true') : c.removeAttribute('aria-invalid')));
}
const clearErrors = () => { Object.keys(fieldMap).forEach((f) => setError(f, '')); status.textContent = ''; };

function openJoin(t, trigger) {
  const fresh = getTrip(t.id);
  if (!fresh || fresh.isFull) return;
  current = fresh;
  opener = trigger || null;
  joinForm.reset();
  clearErrors();
  $('it-join-title').textContent = `Join: ${fresh.title}`;
  $('it-join-summary').textContent = `${fresh.destination} · ${fmtDate(fresh.date)} · ${inr(fresh.budgetPerPerson)} per person · ${fresh.seatsLeft} ${fresh.seatsLeft === 1 ? 'seat' : 'seats'} left`;
  $('it-budget-label').textContent = `I can pay the trip budget of ${inr(fresh.budgetPerPerson)}`;
  const pre = joinForm.querySelector(`[name="pickup"][value="${CSS.escape(fresh.pickupPointId || '')}"]`);
  if (pre) pre.checked = true;
  submitBtn.disabled = false;
  if (!dialog.open) dialog.showModal();
  $('it-name').focus();
}

function validate(data) {
  const errors = {};
  if (!data.name.trim()) errors.name = 'Enter your name';
  if (!/^\d{10}$/.test(data.phone)) errors.phone = 'Enter a 10-digit mobile number';
  if (!PICKUP_POINTS.some((p) => p.id === data.pickupId)) errors.pickupId = 'Choose Sundar One hostel gate or College gate';
  if (data.budgetConfirmed !== true) errors.budgetConfirmed = `Tick the box to confirm you can pay ${inr(current.budgetPerPerson)}`;
  return errors;
}

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!current) return;
  clearErrors();
  const fd = new FormData(joinForm);
  let phone = String(fd.get('phone') || '').replace(/\D/g, '');
  if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
  else if (phone.length === 11 && phone.startsWith('0')) phone = phone.slice(1);
  const data = { name: String(fd.get('name') || ''), phone, pickupId: String(fd.get('pickup') || ''), budgetConfirmed: joinForm.elements.budget.checked };

  const local = validate(data);
  if (Object.keys(local).length) {
    Object.entries(local).forEach(([f, m]) => setError(f, m));
    const first = ['name', 'phone', 'pickupId', 'budgetConfirmed'].find((f) => local[f]);
    (first === 'pickupId' ? joinForm.querySelector('[name="pickup"]') : joinForm.elements[first === 'budgetConfirmed' ? 'budget' : first])?.focus();
    return;
  }

  submitBtn.disabled = true;
  const booking = createBooking({ tripId: current.id, name: data.name, phone: data.phone, pickupId: data.pickupId });
  if (!booking.ok) {
    submitBtn.disabled = false;
    if (booking.reason === 'full' || booking.reason === 'not-found') {
      status.textContent = booking.reason === 'full' ? 'Sorry, this trip just filled up.' : 'This trip is no longer available.';
      return;
    }
    Object.entries(booking.errors || {}).forEach(([f, m]) => (fieldMap[f] ? setError(f, m) : (status.textContent = m)));
    return;
  }
  location.href = `/checkout?trip=${encodeURIComponent(current.id)}&booking=${encodeURIComponent(booking.booking.id)}`;
});

joinForm.addEventListener('input', (e) => {
  const f = e.target.name === 'pickup' ? 'pickupId' : e.target.name === 'budget' ? 'budgetConfirmed' : e.target.name;
  if (fieldMap[f]) setError(f, '');
});
dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { current = null; opener?.focus?.(); });

/* =========================== BOOT =========================== */
if (tripId) {
  const trip = getTrip(tripId);
  if (trip) renderDetail(trip);
  else showMissing();
} else {
  // The server already sends /itinerary without a trip to /trips; this covers static hosting.
  location.replace('/trips#group-trips');
}
