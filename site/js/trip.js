/**
 * Trip detail page (trip.html?slug=...).
 * Renders one trip from data.js: hero, quick facts, itinerary accordion,
 * inclusions, gallery + lightbox, flexibility box, FAQ, booking card,
 * enquiry form (leads.js) and the bookable group trips (real prices, same as home and checkout).
 */
import { TRIPS, IMAGES, DIFFICULTY, FLEX_POLICY, getTripBySlug } from './data.js';
import { priceLabel, filledPercent, monthNames, displayPrice, displayInventory } from './planner.js';
import { isWishlisted, isComparing, onStoreChange, getTrips } from './store.js';
import { attachLeadForm } from './leads.js';
import { renderGroupCard, bindCardEvents, syncCards, setupCompare, upcoming, datesLine, itineraryUrl, FOCUS } from './trips.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtLong = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const params = new URLSearchParams(location.search);
const requestedTrip = params.get('slug') || params.get('trip') || params.get('id');
// A direct visit to /trip starts with a real itinerary; explicit bad links still show the not-found state.
const trip = requestedTrip
  ? getTripBySlug(requestedTrip) || TRIPS.find((t) => t.id === requestedTrip)
  : TRIPS[0];

// Bookable group trips (same prices as the home page and checkout), soonest first.
const openGroupTrips = () => getTrips().filter((g) => !g.isFull).sort((a, b) => String(a.date).localeCompare(String(b.date)));
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const sameDest = (t, g) => [g.destination, g.title].some((s) => String(s || '').toLowerCase().includes(t.destination.toLowerCase()));

// Related row: ready group trips with their real per-person price, so every price a visitor sees
// on this page matches the home page and what checkout charges.
function renderRelatedGroups(t) {
  const list = openGroupTrips();
  const ranked = t ? [...list.filter((g) => sameDest(t, g)), ...list.filter((g) => !sameDest(t, g))] : list;
  $('related').innerHTML = ranked.slice(0, 3).map((g, i) => renderGroupCard(g, i)).join('');
  $('related-title').textContent = 'Group trips open to join';
}

function setMeta(name, value, attr = 'name') {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el); }
  el.setAttribute('content', value);
}

function notFound() {
  document.title = 'Trip not found | Escape Cartel';
  $('trip-loc').textContent = 'Trip not found';
  $('trip-name').textContent = 'That trip has moved.';
  $('trip-tagline').textContent = 'The link may be old. Browse all trips, or tell us where you want to go and we will plan it.';
  $('hero-img').remove();
  $('hero-actions').innerHTML = '<a class="btn btn--primary btn--lg" href="trips.html"><span class="btn__label">See all trips</span></a><a class="btn btn--liquid-fill" href="plan.html"><span class="btn__label">Plan my trip</span></a>';
  $('trip-body').remove();
  $('trip-bar').remove();
  renderRelatedGroups(null);
}

function render() {
  const t = trip;
  // Sample values from data.js, visibly tagged "Placeholder" until confirmed.
  const price = displayPrice(t);
  const inv = displayInventory(t);
  const up = upcoming(t);
  const filled = filledPercent(t);
  const diff = DIFFICULTY[t.difficulty];

  /* ---- SEO ---- */
  const desc = `${t.days}-day small-group trip to ${t.destination}, ${t.region}. ${t.tagline} Day-by-day itinerary, inclusions and flexible dates.`;
  document.title = `${t.name}: ${t.days}-day ${t.region} trip | Escape Cartel`;
  setMeta('description', desc);
  setMeta('og:title', `${t.name} | Escape Cartel`, 'property');
  setMeta('og:description', desc, 'property');
  setMeta('og:image', t.image, 'property');
  setMeta('og:image:width', String(t.imageWidth), 'property');
  setMeta('og:image:height', String(t.imageHeight), 'property');
  setMeta('og:image:alt', t.imageAlt, 'property');
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: t.name,
    description: desc,
    touristType: 'Small group',
    itinerary: { '@type': 'ItemList', itemListElement: t.itinerary.map((d, i) => ({ '@type': 'ListItem', position: i + 1, name: `Day ${d.day}: ${d.title}` })) },
  });
  document.head.appendChild(ld);

  /* ---- Hero ---- */
  const img = $('hero-img');
  img.src = t.image;
  img.alt = t.imageAlt;
  img.width = t.imageWidth;
  img.height = t.imageHeight;
  img.style.setProperty('--focus', t.imageFocus || FOCUS[t.id] || '50% 50%');
  $('hero').dataset.imageReason = `Full-bleed for scale. ${t.imageReason}`;
  $('trip-loc').textContent = `${t.region} · ${t.destination}`;
  $('trip-name').textContent = t.name;
  $('trip-tagline').textContent = t.tagline;
  $('trip-badges').innerHTML = [
    `${t.days} days`, diff?.label, inv.isPlaceholder ? '' : `${t.spotsLeft} spots left`,
  ].filter(Boolean).map((b) => `<span class="badge badge--trace">${esc(b)}</span>`).join('');
  $('customise-link').href = `plan.html?trip=${encodeURIComponent(t.slug)}`;
  const heart = $('hero-heart');
  heart.dataset.wishlistId = t.id;
  heart.setAttribute('aria-pressed', String(isWishlisted(t.id)));
  heart.setAttribute('aria-label', `Save ${t.name} to wishlist`);
  const cmp = $('hero-compare');
  cmp.dataset.compareId = t.id;
  cmp.checked = isComparing(t.id);

  /* ---- Facts ---- */
  const facts = [
    ['Duration', `${t.days} days · ${t.nights} nights`],
    ['Difficulty', diff ? `${diff.label}. ${diff.note}` : t.difficulty],
    ['Best months', monthNames(t.months).join(', ')],
    ['Group size', `${t.groupMin}–${t.groupMax} travellers${inv.isPlaceholder ? ' (sample)' : ''}`],
    ['Starts from', t.startPoint],
    ['Next batch', up.length ? `${fmtLong(up[0])}${inv.isPlaceholder ? ' (sample date)' : ''}` : 'New dates soon'],
  ];
  $('facts').innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

  /* ---- Itinerary accordion ---- */
  $('itinerary').innerHTML = t.itinerary.map((d, i) => `
    <li class="itin${i === 0 ? ' is-open' : ''}">
      <button class="itin__btn" type="button" id="day-${d.day}-btn" aria-expanded="${i === 0}" aria-controls="day-${d.day}">
        <span class="itin__day" aria-hidden="true">D${d.day}</span>
        <span class="itin__title"><span class="sr-only">Day ${d.day}: </span>${esc(d.title)}</span>
        <span class="itin__plus" aria-hidden="true"></span>
      </button>
      <div class="itin__panel" id="day-${d.day}" role="region" aria-labelledby="day-${d.day}-btn">
        <div><p>${esc(d.detail)}</p></div>
      </div>
    </li>`).join('');
  const setItin = (li, open) => {
    li.classList.toggle('is-open', open);
    li.querySelector('.itin__btn').setAttribute('aria-expanded', String(open));
  };
  const allBtn = $('itin-all');
  const syncAll = () => {
    const allOpen = [...document.querySelectorAll('.itin')].every((li) => li.classList.contains('is-open'));
    allBtn.textContent = allOpen ? 'Close all days' : 'Open all days';
    delete allBtn.dataset.ecSplit; allBtn.classList.remove('is-split'); // let buttons.js re-split the new text
    window.EC?.buttons?.enhance(allBtn);
  };
  $('itinerary').addEventListener('click', (e) => {
    const btn = e.target.closest('.itin__btn');
    if (!btn) return;
    const li = btn.closest('.itin');
    setItin(li, !li.classList.contains('is-open'));
    syncAll();
  });
  allBtn.addEventListener('click', () => {
    const items = [...document.querySelectorAll('.itin')];
    const open = !items.every((li) => li.classList.contains('is-open'));
    items.forEach((li) => setItin(li, open));
    syncAll();
  });
  // "View itinerary" (hero or a card link with #itin-title) lands on every day opened.
  const openAll = () => { document.querySelectorAll('.itin').forEach((li) => setItin(li, true)); syncAll(); };
  if (location.hash === '#itin-title') openAll();
  document.querySelector('#hero-actions a[href="#itin-title"]')?.addEventListener('click', openAll);

  /* ---- Inclusions ---- */
  const yes = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const no = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  $('incl-in').innerHTML = t.inclusions.map((x) => `<li>${yes}<span>${esc(x)}</span></li>`).join('');
  $('incl-out').innerHTML = t.exclusions.map((x) => `<li>${no}<span>${esc(x)}</span></li>`).join('');

  /* ---- Gallery ---- */
  renderGallery(t);

  /* ---- Flexibility ---- */
  const flex = [
    [FLEX_POLICY.dateChange.title, FLEX_POLICY.dateChange.display],
    [FLEX_POLICY.paymentTiming.title, FLEX_POLICY.paymentTiming.display],
    ['Private group option', `Want ${t.destination} just for your friends? We can run this route privately on your dates. Ask us on WhatsApp.`],
    [FLEX_POLICY.transfer.title, FLEX_POLICY.transfer.display],
  ];
  $('flex-list').innerHTML = flex.map(([h, p]) => `<li><h3>${esc(h)}</h3><p>${esc(p)}</p></li>`).join('');

  /* ---- FAQ ---- */
  $('faq').innerHTML = t.faqs.map((f) => `
    <details><summary>${esc(f.q)}<span class="itin__plus" aria-hidden="true"></span></summary><p>${esc(f.a)}</p></details>`).join('');

  /* ---- Booking card + mobile bar ---- */
  const waMsg = `Hi Escape Cartel! I'm interested in ${t.name}${up.length ? ` (batch from ${datesLine(t)})` : ''}. Can you share the confirmed price and availability?`;
  // A ready group departure to the same place has a fixed price and pays online at checkout.
  const group = openGroupTrips().find((g) => sameDest(t, g));
  const groupBox = group ? `
    <div class="book-card__group">
      <span class="eyebrow">Group departure open</span>
      <p class="book-card__group-title">${esc(group.title)}</p>
      <p class="price">${esc(inr(group.price ?? group.budgetPerPerson))}<span class="price-note">per person · ${esc(group.seatsLeft)} seats left · pay online by UPI, GPay, net banking or card</span></p>
      <a class="btn btn--primary btn--block" href="${esc(itineraryUrl(group.id))}"><span class="btn__label">See plan and book seats</span></a>
    </div>` : '';
  $('book-card').innerHTML = `
    <div>
      <span class="eyebrow">${esc(t.days)} days · ${esc(t.region)}</span>
      <p class="price">${esc(price.text)}<span class="price-note">${esc(price.note)}</span></p>
    </div>
    <ul class="book-card__list" role="list">
      <li><span>Next batch</span><span>${esc(up.length ? datesLine(t) : 'New dates soon')}</span></li>
      <li><span>Group</span><span>${esc(inv.group || 'Ask us')}</span></li>
      <li><span>Starts from</span><span>${esc(t.startPoint)}</span></li>
    </ul>
    ${inv.isPlaceholder ? '' : `<div class="spots${t.spotsLeft <= 5 ? ' spots--low' : ''}">
      <div class="spots__row"><span>${t.spotsLeft} spots left</span><span>${filled}% filled</span></div>
      <div class="spots__bar" role="presentation"><i style="--filled:${filled / 100}"></i></div>
    </div>`}
    <div class="book-card__cta">
      <a class="btn btn--gooey btn--block" href="#enquiry"><span class="btn__label">Enquire now</span></a>
      <a class="btn btn--ghost btn--magnetic btn--ripple btn--block" data-wa="${esc(waMsg)}" href="https://wa.me/919825744110" target="_blank" rel="noopener"><span class="btn__label">Chat on WhatsApp</span></a>
    </div>
    ${groupBox}
    <div class="cluster">
      <span class="badge badge--trace">Flexible dates</span>
      <span class="badge badge--trace">Budget shown before payment</span>
    </div>`;
  const waLink = $('book-card').querySelector('[data-wa]');
  waLink.href = `https://wa.me/919825744110?text=${encodeURIComponent(waMsg)}`;
  $('bar-price').innerHTML = `${esc(price.text)}<span class="price-note">${esc(price.note)}</span>`;

  /* ---- Enquiry form ---- */
  $('f-trip').value = t.name;
  $('e-dates').innerHTML = up.map((d) => `<option value="${esc(fmtLong(d))}">${esc(fmtLong(d))}</option>`).join('') +
    '<option value="Flexible / other dates">Flexible / other dates</option>';
  $('e-group').innerHTML = Array.from({ length: 20 }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${n === 2 ? ' selected' : ''}>${n}${n === 20 ? '+' : ''} ${n === 1 ? 'traveller' : 'travellers'}</option>`).join('');
  const form = $('enquiry-form');
  attachLeadForm(form, { getContext: () => ({ trip: `${t.name} (${t.days} days)` }) });
  wireSubmitMorph(form);

  /* ---- Related: bookable group trips (real prices) ---- */
  renderRelatedGroups(t);

  // Hero heart + compare use the same handlers as cards.
  bindCardEvents($('hero'));
  onStoreChange(({ key }) => {
    if (key === 'wishlist' || key === 'compare') syncCards($('hero'));
    if (['groupTrips', 'groupJoins', 'ownerTrips'].includes(key)) renderRelatedGroups(t);
  });

  mobileBar();
}

/* Gallery: the lead photo, two close "detail" crops of it (corner-inset idea:
   a detail at small size), other real photos from the same region, and one
   labelled placeholder until the owner sends real trip photos. */
function renderGallery(t) {
  const shots = [{ src: t.image, alt: t.imageAlt, cap: t.destination }];
  const seen = new Set([t.imageKey]);
  TRIPS.filter((x) => x.region === t.region && !seen.has(x.imageKey)).forEach((x) => {
    if (seen.has(x.imageKey) || shots.length >= 3) return;
    seen.add(x.imageKey);
    shots.push({ src: x.image, alt: x.imageAlt, cap: `Also in ${x.region}: ${x.destination}` });
  });

  const tiles = [];
  tiles.push(tile(shots[0], 0, 'Lead photo, full frame'));
  const origins = ['30% 35%', '70% 65%'];
  origins.forEach((o, i) => tiles.push(`
    <figure class="gallery__item" data-image-reason="Detail crop of the lead photo">
      <button class="gallery__btn" type="button" data-cursor="Zoom" data-lb="0" aria-label="Open photo: detail of ${esc(t.destination)}">
        <img src="${esc(t.image)}" alt="" loading="lazy" decoding="async" width="400" height="400" style="transform:scale(1.9);transform-origin:${o}">
      </button>
      <figcaption>Detail ${i + 1}</figcaption>
    </figure>`));
  shots.slice(1).forEach((s, i) => tiles.push(tile(s, i + 1, 'Same region, real photo')));
  // TODO(owner): replace with real photos from past batches of this trip.
  tiles.push('<figure class="gallery__item"><div class="photo-soon">Trip photos<br>coming soon</div></figure>');
  const gal = $('gallery');
  gal.innerHTML = tiles.slice(0, 5).join('');

  /* Lightbox */
  const lb = $('lightbox');
  const lbImg = $('lb-img');
  let idx = 0;
  const show = (i) => {
    idx = (i + shots.length) % shots.length;
    lbImg.src = shots[idx].src;
    lbImg.alt = shots[idx].alt;
    $('lb-cap').textContent = shots[idx].cap;
    $('lb-count').textContent = `${idx + 1} / ${shots.length}`;
    $('lb-prev').disabled = $('lb-next').disabled = shots.length < 2;
  };
  gal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lb]');
    if (!b) return;
    show(Number(b.dataset.lb));
    lb.showModal();
  });
  $('lb-prev').addEventListener('click', () => show(idx - 1));
  $('lb-next').addEventListener('click', () => show(idx + 1));
  lb.querySelector('[data-close]').addEventListener('click', () => lb.close());
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });
  let x0 = null;
  $('lb-stage').addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  $('lb-stage').addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) show(idx + (dx < 0 ? 1 : -1));
    else if (e.target === $('lb-stage')) lb.close();
  });
}

function tile(s, i, reason) {
  return `
    <figure class="gallery__item" data-image-reason="${esc(reason)}">
      <button class="gallery__btn" type="button" data-cursor="Zoom" data-lb="${i}" aria-label="Open photo: ${esc(s.cap)}">
        <img src="${esc(s.src)}" alt="${esc(s.alt)}" loading="lazy" decoding="async" width="800" height="600">
      </button>
      <figcaption>${esc(s.cap)}</figcaption>
    </figure>`;
}

/* Pill-to-circle submit mirrors the lead form's result (leads.js runs first). */
export function wireSubmitMorph(form) {
  const btn = form.querySelector('.btn--submit');
  const status = form.querySelector('[data-form-status]');
  form.addEventListener('submit', () => {
    const ok = status?.dataset.state === 'success';
    const B = window.EC?.buttons;
    if (!B || !btn) return;
    if (ok) {
      B.setState(btn, 'loading');
      setTimeout(() => B.setState(btn, 'success'), 450);
      setTimeout(() => B.setState(btn, 'idle'), 3200);
    } else {
      B.setState(btn, 'error');
    }
  });
}

/* Mobile booking bar: appears once the hero is gone, hides at the form. */
function mobileBar() {
  const bar = $('trip-bar');
  const mq = matchMedia('(max-width: 63.99em)');
  let pastHero = false, atForm = false;
  const update = () => {
    const show = mq.matches && pastHero && !atForm;
    bar.classList.toggle('is-visible', show);
    document.body.classList.toggle('has-bottombar', show);
  };
  new IntersectionObserver((e) => { pastHero = !e[0].isIntersecting; update(); }, { rootMargin: '0px 0px -40% 0px' }).observe($('hero'));
  new IntersectionObserver((e) => { atForm = e[0].isIntersecting; update(); }).observe($('enquiry'));
  mq.addEventListener?.('change', update);
}

if (trip) render();
// A ready group trip id (/trip?id=g02) has its own day-by-day page with booking.
else if (getTrips().some((g) => g.id === requestedTrip)) location.replace(itineraryUrl(requestedTrip));
else notFound();
setupCompare();
