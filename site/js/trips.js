/**
 * Trips listing page (trips.html) + the shared trip card renderer.
 * trip.js imports renderCard / bindCardEvents / FOCUS for its related-trips row;
 * the listing only boots when #trip-grid exists.
 *
 * Filters sync to the URL (?dest=Rajasthan&budget=12000&dur=short&month=12&diff=easy&sort=price-asc&saved=1)
 * so a filtered view can be shared on WhatsApp.
 */
import { TRIPS, DIFFICULTY, REGIONS } from './data.js';
import { filterTrips, sortTrips, displayPrice, displayInventory, DURATION_BUCKETS, formatINR } from './planner.js';
import { getWishlist, isWishlisted, toggleWishlist, isComparing, toggleCompare, onStoreChange, COMPARE_MAX, getTrips } from './store.js';
import { attachCompareTray, renderCompareTable } from './compare.js';

/* Crop focus per trip (object-position inside the arch). */
export const FOCUS = {
  t01: '50% 50%', t02: '35% 60%', t03: '50% 70%', t04: '50% 55%',
  t05: '45% 50%', t06: '84% 50%', t07: '55% 60%', t08: '62% 38%',
  t09: '50% 54%', t10: '38% 55%', t11: '50% 52%', t12: '50% 60%',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Sample departures from data.js are shown (tagged "Placeholder" on cards)
// rather than hidden, so travellers can compare trips.
export function upcoming(trip) {
  return (trip.departures || []).filter((d) => d >= today);
}

const ICON = {
  cal: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  peak: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 19 6.5-11 4 6.5 2.5-4L21 19H3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3s-7.8-4.6-7.8-10.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.8 2.7c0 5.8-7.8 10.4-7.8 10.4Z" stroke-linejoin="round"/></svg>',
  tick: '<svg class="chip__tick" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13m-5-5 5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
export { ICON };

export function datesLine(trip) {
  const up = upcoming(trip);
  if (!up.length) return 'New dates on request';
  const more = up.length > 1 ? ` · +${up.length - 1} more` : '';
  return `${fmtDate(up[0])}${more}`;
}

/** One card. `i` staggers the entrance. */
export function renderCard(trip, i = 0) {
  const price = displayPrice(trip);
  const inv = displayInventory(trip);
  const filled = inv.filled;
  const low = trip.spotsLeft <= 5;
  const saved = isWishlisted(trip.id);
  const comparing = isComparing(trip.id);
  const href = `trip.html?slug=${encodeURIComponent(trip.slug)}`;
  const up = upcoming(trip);
  return `
  <li class="trip-card" style="--i:${i}" data-trip-id="${trip.id}">
    <!-- Image reason: ${esc(trip.imageReason)} -->
    <div class="trip-card__media" data-cursor="View" data-image-reason="Rounded rectangle at the photo's own proportions; ${esc(trip.imageReason)}">
      <img src="${esc(trip.image)}" alt="${esc(trip.imageAlt)}" width="${trip.imageWidth}" height="${trip.imageHeight}" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async" style="--focus:${esc(trip.imageFocus || FOCUS[trip.id] || '50% 50%')}">
      <div class="trip-card__over">
        <span class="trip-card__loc">${esc(trip.region)} · ${esc(trip.destination)}</span>
        <h3 class="trip-card__title"><a href="${href}">${esc(trip.name)}</a></h3>
      </div>
      <button class="btn-heart" type="button" aria-pressed="${saved}" aria-label="Save ${esc(trip.name)} to wishlist" data-wishlist-id="${trip.id}">${ICON.heart}</button>
      <label class="chip chip--toggle trip-card__compare"><input type="checkbox" data-compare-id="${trip.id}"${comparing ? ' checked' : ''} aria-label="Compare ${esc(trip.name)}">${ICON.tick}<span>Compare</span></label>
    </div>
    <div class="trip-card__body">
      <p class="trip-card__tagline">${esc(trip.tagline)}</p>
      <div class="trip-card__meta">
        <span class="tag">${ICON.cal}${up.length ? `<time datetime="${up[0]}">${esc(datesLine(trip))}</time>` : esc(datesLine(trip))}</span>
        <span class="tag">${ICON.clock}${trip.days} days</span>
        <span class="tag">${ICON.peak}${esc(DIFFICULTY[trip.difficulty]?.label || trip.difficulty)}</span>
      </div>
      ${inv.group ? `<p class="trip-card__group">Group ${esc(inv.group)} travellers</p>` : ''}
      ${inv.isPlaceholder ? '' : `<div class="spots${low ? ' spots--low' : ''}">
        <div class="spots__row"><span>${trip.spotsLeft} spots left</span><span>${filled}% filled</span></div>
        <div class="spots__bar" role="presentation"><i style="--filled:${filled / 100}"></i></div>
      </div>`}
      <div class="trip-card__foot">
        <p class="price">${esc(price.text)}<span class="price-note">${esc(price.note)}</span></p>
        <div class="trip-card__actions">
          <a class="btn btn--primary btn--sm trip-card__cta" href="${href}#itin-title" aria-label="View itinerary: ${esc(trip.name)}"><span class="btn__label">View itinerary</span></a>
        </div>
      </div>
    </div>
  </li>`;
}

/* ---------- ready group trips (store.getTrips, schema at the top of data.js) ---------- */
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const itineraryUrl = (id) => `/itinerary?trip=${encodeURIComponent(id)}`;
const GROUP_ICON = {
  pin: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.2" stroke="currentColor" stroke-width="1.8"/></svg>',
};

/** Card for a ready group trip. The only action is the itinerary: joining happens after the day-by-day plan. */
export function renderGroupCard(t, i = 0) {
  const low = !t.isFull && t.seatsLeft <= 3;
  const seatsText = t.isFull ? 'Full' : `${t.seatsLeft} ${t.seatsLeft === 1 ? 'seat' : 'seats'} left`;
  const state = t.isFull ? ' it-seats--full' : low ? ' it-seats--low' : '';
  const href = itineraryUrl(t.id);
  const first = (t.dates && t.dates[0]) || t.date;
  const more = (t.dates || []).length > 1 ? ` +${t.dates.length - 1} more` : '';
  const days = (t.days || []).length;
  return `
  <li class="it-card" style="--i:${i}" data-trip-id="${esc(t.id)}">
    <div class="it-card__media">
      <img src="${esc(t.coverImage || t.image)}" alt="${esc(t.coverAlt || t.imageAlt)}" width="${t.imageWidth || 1600}" height="${t.imageHeight || 1067}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async">
      <span class="it-badge${state}">${esc(seatsText)}</span>
      <div class="it-card__over">
        <span class="it-card__loc">${esc(t.destination)}${t.durationLabel ? ` · ${esc(t.durationLabel)}` : ''}</span>
        <h3 class="it-card__title"><a href="${href}">${esc(t.title)}</a></h3>
      </div>
    </div>
    <div class="it-card__body">
      <p class="it-card__blurb">${esc(t.summary || t.blurb)}</p>
      <ul class="it-facts">
        ${first ? `<li>${ICON.cal}<span><time datetime="${esc(first)}">${esc(fmtDay(first))}</time>${esc(more)}</span></li>` : ''}
        ${days ? `<li>${ICON.clock}<span>${days}-day plan with stays and activities</span></li>` : ''}
        ${t.pickupLabel ? `<li>${GROUP_ICON.pin}<span>Pickup: ${esc(t.pickupLabel)}</span></li>` : ''}
      </ul>
      <div class="it-seats${state}">
        <div class="it-seats__row">
          <span class="it-seats__left">${esc(seatsText)}</span>
          <span>${t.membersJoined} of ${t.seatsTotal} joined</span>
        </div>
        <div class="it-seats__bar" role="presentation"><i style="--filled:${t.filledPercent / 100}"></i></div>
      </div>
      <div class="it-card__foot">
        <p class="it-price"><strong>${inr(t.price ?? t.budgetPerPerson)}</strong><span>per person</span></p>
        <a class="btn btn--primary btn--sm it-card__cta" href="${href}" aria-label="View itinerary: ${esc(t.title)}"><span class="btn__label">View itinerary</span></a>
      </div>
    </div>
  </li>`;
}

/* ---------- toast ---------- */
let toastEl, toastT;
export function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
}

/* ---------- card events (wishlist, compare, 3D tilt) ---------- */
export function bindCardEvents(root, { onWishlist } = {}) {
  root.addEventListener('heart:toggle', (e) => {
    const id = e.detail.id;
    if (!id) return;
    if (e.detail.pressed !== isWishlisted(id)) toggleWishlist(id);
    toast(e.detail.pressed ? 'Saved to your wishlist' : 'Removed from your wishlist');
    if (onWishlist) onWishlist();
  });

  root.addEventListener('change', (e) => {
    const input = e.target.closest('[data-compare-id]');
    if (!input) return;
    const id = input.getAttribute('data-compare-id');
    const res = toggleCompare(id);
    if (!res.ok && res.reason === 'full') {
      input.checked = false;
      toast(`You can compare up to ${COMPARE_MAX} trips. Remove one first.`);
    } else {
      input.checked = res.on;
    }
  });

  // Subtle 3D tilt on the arch (fine pointers only, not reduced motion).
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  root.addEventListener('pointermove', (e) => {
    if (!fine.matches || reduce.matches) return;
    const m = e.target.closest?.('.trip-card__media');
    if (!m) return;
    const r = m.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    m.style.setProperty('--rx', `${(x * 6).toFixed(2)}deg`);
    m.style.setProperty('--ry', `${(-y * 6).toFixed(2)}deg`);
  });
  root.addEventListener('pointerout', (e) => {
    const m = e.target.closest?.('.trip-card__media');
    if (m && !m.contains(e.relatedTarget)) { m.style.removeProperty('--rx'); m.style.removeProperty('--ry'); }
  });
}

/** Keep hearts + compare boxes in sync with storage (other tabs, tray removals). */
export function syncCards(root) {
  root.querySelectorAll('[data-wishlist-id]').forEach((b) => b.setAttribute('aria-pressed', String(isWishlisted(b.dataset.wishlistId))));
  root.querySelectorAll('[data-compare-id]').forEach((c) => { c.checked = isComparing(c.dataset.compareId); });
}

/* ---------- compare tray + dialog (used by listing and detail) ---------- */
export function setupCompare() {
  const tray = document.getElementById('compare-tray');
  const dialog = document.getElementById('compare-dialog');
  if (!tray || !dialog) return;
  const body = dialog.querySelector('[data-compare-body]');

  const measure = () => {
    const on = !tray.hidden;
    document.body.classList.toggle('has-tray', on);
    document.body.style.setProperty('--tray-h', on ? `${tray.offsetHeight}px` : '0px');
  };

  attachCompareTray(tray, {
    onCompare: (ids) => {
      const wrap = document.createElement('div');
      wrap.className = 'compare-scroll';
      wrap.appendChild(renderCompareTable(ids));
      const legend = document.createElement('p');
      legend.className = 'compare-legend';
      legend.textContent = 'Rows in bold are where these trip ideas differ. Ask us for confirmed prices and availability.';
      body.replaceChildren(wrap, legend);
      dialog.showModal();
    },
  });
  // compare.js renders buttons without our liquid classes: add them after each render.
  const decorate = () => {
    const go = tray.querySelector('.compare-tray__go');
    const clear = tray.querySelector('.compare-tray__clear');
    // Liquid layers sit above bare text, so labels go in .btn__label (z-index 2).
    [[go, ['btn', 'btn--gooey', 'btn--sm']], [clear, ['btn', 'btn--liquid-fill', 'btn--sm']]].forEach(([b, cls]) => {
      if (!b || b.querySelector('.btn__label')) return;
      b.classList.add(...cls);
      const label = document.createElement('span');
      label.className = 'btn__label';
      label.textContent = b.textContent;
      b.replaceChildren(label);
    });
    if (go && !go.parentElement.classList.contains('compare-tray__actions')) {
      const actions = document.createElement('div');
      actions.className = 'compare-tray__actions';
      tray.insertBefore(actions, go);
      actions.append(clear, go);
    }
    measure();
  };
  new MutationObserver(decorate).observe(tray, { childList: true });
  decorate();
  addEventListener('resize', measure);

  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

/* ================= Listing page ================= */
function initListing() {
  const grid = document.getElementById('trip-grid');
  const form = document.getElementById('filters');
  const countEl = document.getElementById('result-count');
  const empty = document.getElementById('empty');
  const budget = document.getElementById('f-budget');
  const budgetOut = document.getElementById('f-budget-out');
  const panel = document.getElementById('filters-panel');
  const toggle = document.getElementById('filters-toggle');
  const activeCount = document.getElementById('filters-active');
  const savedCount = document.getElementById('saved-count');

  // Build region chips from data.
  const destGroup = document.getElementById('f-dest');
  const regions = REGIONS.filter((r) => TRIPS.some((t) => t.region === r));
  destGroup.insertAdjacentHTML('beforeend', regions.map((r) =>
    `<label class="chip"><input type="radio" name="dest" value="${esc(r)}"><span>${esc(r)}</span></label>`).join(''));

  const BUDGET_MAX = Number(budget.max);

  function readState() {
    const fd = new FormData(form);
    return {
      dest: fd.get('dest') || '',
      budget: Number(fd.get('budget')) || BUDGET_MAX,
      dur: fd.get('dur') || '',
      month: fd.get('month') || '',
      diff: fd.get('diff') || '',
      sort: fd.get('sort') || 'recommended',
      saved: fd.get('saved') === '1',
    };
  }

  function writeState(s) {
    const set = (name, v) => {
      const el = form.querySelector(`[name="${name}"][value="${CSS.escape(String(v))}"]`);
      if (el) el.checked = true;
    };
    set('dest', s.dest || '');
    set('dur', s.dur || '');
    set('diff', s.diff || '');
    if (s.month) form.month.value = s.month;
    if (s.sort) form.sort.value = s.sort;
    if (s.budget) budget.value = s.budget;
    form.saved.checked = !!s.saved;
  }

  function fromURL() {
    const p = new URLSearchParams(location.search);
    const dest = p.get('dest') || p.get('destination') || '';
    // Accept a destination or trip name from other pages and map it to a region chip.
    const match = TRIPS.find((t) => [t.region, t.destination, t.slug].some((x) => x.toLowerCase() === dest.toLowerCase()));
    return {
      dest: match ? match.region : '',
      budget: Number(p.get('budget')) || BUDGET_MAX,
      dur: DURATION_BUCKETS[p.get('dur')] ? p.get('dur') : '',
      month: p.get('month') || '',
      diff: DIFFICULTY[p.get('diff')] ? p.get('diff') : '',
      sort: p.get('sort') || 'recommended',
      saved: p.get('saved') === '1',
    };
  }

  function toURL(s) {
    const p = new URLSearchParams();
    if (s.dest) p.set('dest', s.dest);
    if (s.budget < BUDGET_MAX) p.set('budget', s.budget);
    if (s.dur) p.set('dur', s.dur);
    if (s.month) p.set('month', s.month);
    if (s.diff) p.set('diff', s.diff);
    if (s.sort !== 'recommended') p.set('sort', s.sort);
    if (s.saved) p.set('saved', '1');
    const q = p.toString();
    history.replaceState(null, '', q ? `?${q}` : location.pathname);
  }

  function updateBudgetOut() {
    const v = Number(budget.value);
    budgetOut.textContent = v >= BUDGET_MAX ? 'Any budget' : `Up to ${formatINR(v)}`;
    const pct = ((v - Number(budget.min)) / (BUDGET_MAX - Number(budget.min))) * 100;
    budget.style.setProperty('--fill', `${pct}%`);
  }

  let lastKey = '';
  function render() {
    const s = readState();
    updateBudgetOut();
    let list = filterTrips(TRIPS, {
      destination: s.dest || undefined,
      budget: s.budget < BUDGET_MAX ? s.budget : undefined,
      duration: s.dur || undefined,
      month: s.month ? Number(s.month) : undefined,
      difficulty: s.diff || undefined,
    });
    if (s.saved) {
      const w = getWishlist();
      list = list.filter((t) => w.includes(t.id));
    }
    list = sortTrips(list, s.sort);

    const key = list.map((t) => t.id).join();
    if (key !== lastKey) {
      grid.innerHTML = list.map((t, i) => renderCard(t, i)).join('');
      lastKey = key;
    }
    empty.hidden = list.length > 0;
    grid.hidden = list.length === 0;
    countEl.innerHTML = `${list.length} ${list.length === 1 ? 'trip idea' : 'trip ideas'} <span>of ${TRIPS.length}</span>`;

    const active = [s.dest, s.budget < BUDGET_MAX, s.dur, s.month, s.diff, s.saved].filter(Boolean).length;
    activeCount.textContent = active ? ` (${active})` : '';
    savedCount.textContent = String(getWishlist().length);
    toURL(s);
  }

  function reset() {
    form.reset();
    budget.value = BUDGET_MAX;
    render();
    // liquid chips re-position their bead on change events
    form.querySelectorAll('.chips--liquid').forEach((g) => g.dispatchEvent(new Event('change')));
  }

  writeState(fromURL());
  render();

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', (e) => e.preventDefault());
  document.querySelectorAll('[data-reset-filters]').forEach((b) => b.addEventListener('click', reset));

  // Keep the destination, budget, duration and month controls visible on phones.
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
  });

  bindCardEvents(grid, { onWishlist: () => { if (readState().saved) { lastKey = ''; render(); } else savedCount.textContent = String(getWishlist().length); } });
  onStoreChange(({ key }) => {
    if (key === 'wishlist' || key === 'compare') syncCards(grid);
    if (key === 'wishlist') savedCount.textContent = String(getWishlist().length);
  });
  setupCompare();
}

/* Ready group trips on trips.html: soonest first, each card leads to its itinerary. */
function initGroupTrips() {
  const grid = document.getElementById('group-grid');
  const draw = () => {
    const list = getTrips().slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    grid.innerHTML = list.map((t, i) => renderGroupCard(t, i)).join('');
    const empty = document.getElementById('group-empty');
    if (empty) empty.hidden = list.length > 0;
    grid.hidden = list.length === 0;
  };
  draw();
  // Same-tab changes arrive as 'groupTrips'; other tabs report the storage key name.
  onStoreChange(({ key }) => { if (['groupTrips', 'groupJoins', 'ownerTrips'].includes(key)) draw(); });
}

if (document.getElementById('group-grid')) initGroupTrips();
if (document.getElementById('trip-grid')) initListing();
