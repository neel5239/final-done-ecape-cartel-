/* Owner-only trip creator (/owner/create/).
 * 1. Gate: the page unlocks only when the kit's owner session is valid (GET /api/admin/stats = 200).
 *    Login uses the kit's POST /api/admin/login, the same credentials as /admin/.
 *    TODO(owner): this is a UI gate. Trips are still saved to localStorage by store.saveOwnerTrip;
 *    real publishing needs a server route guarded by admin.requireOwner (e.g. POST /api/admin/trips).
 * 2. Photos: file input or drop, canvas-resized to max 1600 px JPEG q0.8, stored as data URLs.
 * 3. Days: add/remove cards on a vertical "route spine"; fields follow the schema in data.js.
 * 4. Validation via store.validateOwnerTrip, inline errors, review list, success panel, own-trip list.
 */
import { GROUP_DESTINATIONS, PICKUP_POINTS, GROUP_SEATS_MIN, GROUP_SEATS_MAX } from './data.js';
import { saveOwnerTrip, getOwnerTrips, deleteOwnerTrip, OWNER_LIMITS, MAX_BUDGET } from './store.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

/* ---- 1. Owner gate ------------------------------------------------------ */
const gate = {
  wrap: $('oc-gate'), checking: $('oc-gate-checking'), login: $('oc-login'), off: $('oc-gate-off'),
  offText: $('oc-gate-off-text'), status: $('oc-login-status'),
};
const show = (node) => [gate.checking, gate.login, gate.off].forEach((n) => { n.hidden = n !== node; });

async function checkOwner() {
  try {
    const r = await fetch('/api/admin/stats', { credentials: 'same-origin', headers: { 'x-admin': '1' } });
    if (r.ok) return unlock();
    if (r.status === 401) {
      const s = await fetch('/api/admin/status', { credentials: 'same-origin' }).then((x) => x.json()).catch(() => ({}));
      if (s.enabled === false) {
        gate.offText.textContent = 'The owner login is not set up on this server yet. Add ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) to .env, then reload.';
        return show(gate.off);
      }
      show(gate.login);
      return $('oc-email').focus();
    }
    throw new Error(String(r.status));
  } catch {
    gate.offText.textContent = 'The trip creator needs the site server running (npm start). Open this page from the live preview.';
    show(gate.off);
  }
}

gate.login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('oc-email').value.trim();
  const password = $('oc-password').value;
  gate.status.dataset.state = 'error';
  if (!email || !password) { gate.status.textContent = 'Enter your email and password.'; return; }
  gate.status.dataset.state = '';
  gate.status.textContent = 'Logging in…';
  try {
    const r = await fetch('/api/admin/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Login failed. Try again.');
    $('oc-password').value = '';
    gate.status.textContent = '';
    checkOwner();
  } catch (err) {
    gate.status.dataset.state = 'error';
    gate.status.textContent = err.message;
  }
});

$('oc-logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin', headers: { 'x-admin': '1' } }).catch(() => {});
  location.reload();
});

let started = false;
function unlock() {
  gate.wrap.hidden = true;
  $('oc-app').hidden = false;
  $('oc-logout').hidden = false;
  if (!started) { started = true; startCreator(); }
}

/* ---- 2. Photo pickers --------------------------------------------------- */
const MAX_FILE = 20 * 1024 * 1024;
const photoTpl = $('oc-photo-tpl');
let uid = 0;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This file could not be opened as a photo.'));
    img.src = url;
  });
}

/** Resize to fit max x max, JPEG quality 0.8. Returns { src, width, height, kb }. */
async function resizePhoto(file, max) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP photo.');
  if (file.size > MAX_FILE) throw new Error('This photo is over 20 MB. Choose a smaller one.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // PNG transparency becomes white, not black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const src = canvas.toDataURL('image/jpeg', 0.8);
    return { src, width, height, kb: Math.round((src.length * 3) / 4 / 1024) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Build a picker inside `host`. host.photo = { src, width, height } | null. */
function mountPhoto(host, { label, onChange }) {
  host.appendChild(photoTpl.content.cloneNode(true));
  const id = `oc-photo-${++uid}`;
  const input = host.querySelector('.oc-photo__input');
  const drop = host.querySelector('.oc-photo__drop');
  const preview = host.querySelector('.oc-photo__preview');
  const img = preview.querySelector('img');
  const meta = host.querySelector('.oc-photo__meta');
  const busy = host.querySelector('.oc-photo__busy');
  const error = host.querySelector('.oc-photo__error');
  input.id = id;
  drop.htmlFor = id;
  input.setAttribute('aria-label', label);
  host.photo = null;

  const setError = (msg) => { error.textContent = msg; error.hidden = !msg; };
  function set(photo) {
    host.photo = photo;
    preview.hidden = !photo;
    drop.hidden = !!photo;
    if (photo) {
      img.src = photo.src;
      img.width = photo.width || 320;
      img.height = photo.height || 180;
      meta.textContent = photo.kb ? `${photo.width} × ${photo.height} px · ${photo.kb} KB` : 'Current photo';
    } else {
      img.removeAttribute('src');
      input.value = '';
    }
    onChange?.();
  }
  async function take(file) {
    if (!file) return;
    setError('');
    busy.hidden = false;
    try { set(await resizePhoto(file, Number(host.dataset.max) || 1600)); } catch (err) { setError(err.message); } finally { busy.hidden = true; }
  }

  input.addEventListener('change', () => take(input.files[0]));
  host.querySelector('[data-photo-replace]').addEventListener('click', () => input.click());
  host.querySelector('[data-photo-remove]').addEventListener('click', () => { set(null); input.focus(); });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); take(e.dataTransfer?.files?.[0]); });
  return { set, setError };
}

/* ---- 3. Creator --------------------------------------------------------- */
function startCreator() {
  const form = $('oc-form');
  const status = $('oc-status');
  const daysList = $('oc-days');
  const dayTpl = $('oc-day-tpl');
  const datesList = $('oc-dates-list');
  const success = $('oc-success');

  /* Destination suggestions + pickup options come from data.js. */
  $('oc-destinations').innerHTML = GROUP_DESTINATIONS.map((d) => `<option value="${d.label.replace(/"/g, '&quot;')}"></option>`).join('');
  $('oc-pickup-opts').innerHTML = PICKUP_POINTS.map((p, i) => `
    <label class="pickup__opt">
      <input type="radio" name="pickupPointId" value="${p.id}"${i === 0 ? ' required' : ''}>
      <span class="pickup__card"><span class="pickup__dot" aria-hidden="true"></span><span>${p.label}</span></span>
    </label>`).join('');
  $('oc-seats').min = GROUP_SEATS_MIN;
  $('oc-seats').max = GROUP_SEATS_MAX;
  $('oc-price').max = MAX_BUDGET;

  const cover = mountPhoto(form.querySelector('[data-photo="cover"]'), { label: 'Cover photo', onChange: () => { clearError('coverImage'); refresh(); } });
  const coverHost = form.querySelector('[data-photo="cover"]');

  /* Dates ---------------------------------------------------------------- */
  function addDate(value = '') {
    if (datesList.children.length >= OWNER_LIMITS.dates) return;
    const li = document.createElement('li');
    const n = datesList.children.length + 1;
    li.className = 'oc-dates__item';
    li.innerHTML = `<label class="sr-only" for="oc-date-${++uid}">Departure date ${n}</label>
      <input id="oc-date-${uid}" type="date" min="${todayIso()}" value="${value}">
      <button type="button" class="oc-icon-btn" aria-label="Remove departure date ${n}">×</button>`;
    li.querySelector('button').addEventListener('click', () => {
      if (datesList.children.length === 1) { li.querySelector('input').value = ''; } else { li.remove(); }
      syncDates();
      refresh();
    });
    datesList.appendChild(li);
    syncDates();
    return li.querySelector('input');
  }
  function syncDates() {
    [...datesList.children].forEach((li, i) => {
      li.querySelector('label').textContent = `Departure date ${i + 1}`;
      li.querySelector('button').setAttribute('aria-label', `Remove departure date ${i + 1}`);
    });
    $('oc-add-date').hidden = datesList.children.length >= OWNER_LIMITS.dates;
  }
  $('oc-add-date').addEventListener('click', () => addDate()?.focus());

  /* Days ----------------------------------------------------------------- */
  const dayCards = () => [...daysList.children];

  function addDay(data = {}, { focus = false } = {}) {
    if (dayCards().length >= OWNER_LIMITS.days) return null;
    const li = dayTpl.content.firstElementChild.cloneNode(true);
    const id = ++uid;
    li.querySelectorAll('[data-k]').forEach((input) => { input.id = `oc-d${id}-${input.dataset.k}`; });
    li.querySelectorAll('label[data-for]').forEach((l) => { l.htmlFor = `oc-d${id}-${l.dataset.for}`; });
    li.querySelectorAll('[data-err]').forEach((p) => {
      p.id = `oc-d${id}-err-${p.dataset.err}`;
      li.querySelector(`[data-k="${p.dataset.err}"]`).setAttribute('aria-describedby', p.id);
    });
    const v = (k) => li.querySelector(`[data-k="${k}"]`);
    v('title').value = data.title || '';
    v('place').value = data.place || '';
    v('description').value = data.description || '';
    v('activities').value = (data.activities || []).join('\n');
    v('imageAlt').value = data.imageAlt || '';
    v('hotelName').value = data.hotel?.name || '';
    v('hotelNote').value = data.hotel?.note || '';

    const photoHost = li.querySelector('[data-photo]');
    li.picker = mountPhoto(photoHost, { label: 'Day photo', onChange: refresh });
    if (data.image) li.picker.set({ src: data.image });

    li.querySelector('[data-remove-day]').addEventListener('click', () => {
      const cards = dayCards();
      const i = cards.indexOf(li);
      li.remove();
      renumberDays();
      refresh();
      const next = dayCards()[Math.min(i, dayCards().length - 1)];
      (next?.querySelector('[data-k="title"]') || $('oc-add-day')).focus();
    });
    li.addEventListener('input', (e) => { const k = e.target.dataset?.k; if (k) clearDayError(li, k); });
    daysList.appendChild(li);
    if (!reduceMotion) li.classList.add('is-new');
    renumberDays();
    if (focus) v('title').focus();
    return li;
  }

  function renumberDays() {
    const cards = dayCards();
    cards.forEach((li, i) => {
      li.querySelector('[data-daynum]').textContent = i + 1;
      li.querySelector('[data-remove-sr]').textContent = ` ${i + 1}`;
      li.querySelector('[data-remove-day]').hidden = cards.length === 1;
      li.setAttribute('aria-label', `Day ${i + 1}`);
    });
    $('oc-next-day').textContent = cards.length + 1;
    $('oc-add-day').hidden = cards.length >= OWNER_LIMITS.days;
  }
  $('oc-add-day').addEventListener('click', () => { addDay({}, { focus: true }); clearError('days'); refresh(); });

  /* Collect -------------------------------------------------------------- */
  function collect() {
    const fd = new FormData(form);
    return {
      id: $('oc-id').value || undefined,
      title: fd.get('title'),
      destination: fd.get('destination'),
      price: fd.get('price'),
      seats: fd.get('seats'),
      pickupPointId: fd.get('pickupPointId') || '',
      dates: [...datesList.querySelectorAll('input')].map((i) => i.value).filter(Boolean),
      coverImage: coverHost.photo?.src || '',
      coverWidth: coverHost.photo?.width,
      coverHeight: coverHost.photo?.height,
      coverAlt: fd.get('coverAlt'),
      summary: fd.get('summary'),
      inclusions: lines(fd.get('inclusions')),
      days: dayCards().map((li) => {
        const v = (k) => li.querySelector(`[data-k="${k}"]`).value;
        return {
          title: v('title'), place: v('place'), description: v('description'),
          activities: lines(v('activities')),
          image: li.querySelector('[data-photo]').photo?.src || '', imageAlt: v('imageAlt'),
          hotel: v('hotelName').trim() ? { name: v('hotelName'), note: v('hotelNote') } : null,
        };
      }),
    };
  }

  /* Errors --------------------------------------------------------------- */
  const errNode = (key) => form.querySelector(`[data-error-for="${key}"]`);
  const FIELD_INPUT = {
    title: 'oc-trip-title', destination: 'oc-destination', price: 'oc-price', seats: 'oc-seats', summary: 'oc-summary',
  };
  function setFieldError(key, msg) {
    const node = errNode(key);
    if (node) { node.textContent = msg; node.hidden = !msg; }
    const input = FIELD_INPUT[key] && $(FIELD_INPUT[key]);
    if (input) input.toggleAttribute('aria-invalid', !!msg);
    if (key === 'pickupPointId') $('oc-pickup').classList.toggle('is-invalid', !!msg);
    if (key === 'coverImage') coverHost.classList.toggle('is-invalid', !!msg);
  }
  const clearError = (key) => setFieldError(key, '');
  function clearDayError(li, k) {
    const p = li.querySelector(`[data-err="${k}"]`);
    if (p) { p.hidden = true; p.textContent = ''; li.querySelector(`[data-k="${k}"]`).removeAttribute('aria-invalid'); }
  }
  function clearAll() {
    form.querySelectorAll('[data-error-for]').forEach((n) => clearError(n.dataset.errorFor));
    dayCards().forEach((li) => ['title', 'place', 'activities'].forEach((k) => clearDayError(li, k)));
    status.dataset.state = '';
    status.textContent = '';
  }

  const ORDER = ['title', 'destination', 'price', 'seats', 'pickupPointId', 'dates', 'coverImage', 'summary', 'days'];
  function showErrors(errors) {
    clearAll();
    const targets = [];
    ORDER.forEach((k) => {
      if (!errors[k]) return;
      setFieldError(k, errors[k]);
      targets.push(k === 'pickupPointId' ? form.querySelector('input[name="pickupPointId"]')
        : k === 'dates' ? datesList.querySelector('input')
          : k === 'coverImage' ? coverHost.querySelector('.oc-photo__input')
            : k === 'days' ? $('oc-add-day') : $(FIELD_INPUT[k]));
    });
    const cards = dayCards();
    Object.entries(errors).forEach(([k, msg]) => {
      const m = /^days\.(\d+)\.(\w+)$/.exec(k);
      if (!m || !cards[m[1]]) return;
      const p = cards[m[1]].querySelector(`[data-err="${m[2]}"]`);
      const input = cards[m[1]].querySelector(`[data-k="${m[2]}"]`);
      if (p) { p.textContent = msg; p.hidden = false; }
      if (input) { input.setAttribute('aria-invalid', 'true'); targets.push(input); }
    });
    const n = Object.keys(errors).length;
    status.dataset.state = 'error';
    status.textContent = errors.storage || `Fix ${n} ${n === 1 ? 'thing' : 'things'} marked above, then publish again.`;
    const first = targets.find(Boolean);
    if (first) { first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); }
  }

  Object.entries(FIELD_INPUT).forEach(([k, id]) => $(id).addEventListener('input', () => clearError(k)));
  form.addEventListener('change', (e) => {
    if (e.target.name === 'pickupPointId') clearError('pickupPointId');
    if (e.target.type === 'date') clearError('dates');
  });

  /* Review + stepper ----------------------------------------------------- */
  const summary = $('oc-summary');
  function refresh() {
    const d = collect();
    $('oc-summary-count').textContent = `${summary.value.length} / ${OWNER_LIMITS.summary}`;
    const dayPhotos = d.days.filter((x) => x.image).length;
    const stays = d.days.filter((x) => x.hotel).length;
    const rows = [
      ['Trip', d.title ? `${d.title}${d.destination ? `, ${d.destination}` : ''}` : ''],
      ['Departures', d.dates.length ? [...d.dates].sort().map(fmtDate).join(' · ') : ''],
      ['Price', Number(d.price) > 0 ? `${rupees(Math.round(d.price))} per person` : ''],
      ['Seats', Number(d.seats) > 0 ? `${d.seats} seats` : ''],
      ['Photos', `${d.coverImage ? 'Cover added' : 'No cover yet'} · ${dayPhotos} of ${d.days.length} days`],
      ['Itinerary', `${d.days.length} ${d.days.length === 1 ? 'day' : 'days'} · ${stays} overnight ${stays === 1 ? 'stay' : 'stays'}`],
    ];
    $('oc-review').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd class="${v ? '' : 'is-empty'}"></dd></div>`).join('');
    [...$('oc-review').querySelectorAll('dd')].forEach((dd, i) => { dd.textContent = rows[i][1] || 'Not filled in yet'; });

    const done = {
      basics: !!(d.title.trim() && d.destination.trim() && Number(d.price) > 0 && Number(d.seats) >= GROUP_SEATS_MIN && d.pickupPointId && d.dates.length),
      cover: !!(d.coverImage && d.summary.trim()),
      days: d.days.length > 0 && d.days.every((x) => x.title.trim() && x.place.trim() && x.activities.length),
    };
    document.querySelectorAll('.oc-rail a[data-step]').forEach((a) => {
      const ok = done[a.dataset.step];
      a.classList.toggle('is-done', !!ok);
      if (a.dataset.step in done) a.setAttribute('aria-label', `${a.textContent.trim()}${ok ? ', complete' : ''}`);
    });
  }
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);

  /* Current step highlight while scrolling. */
  if ('IntersectionObserver' in window) {
    const links = new Map([...document.querySelectorAll('.oc-rail a[data-step]')].map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a, id) => { if (id === en.target.id) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    links.forEach((_, id) => io.observe($(id)));
  }

  /* Reset / load --------------------------------------------------------- */
  function resetForm() {
    form.reset();
    $('oc-id').value = '';
    cover.set(null);
    datesList.innerHTML = '';
    addDate();
    daysList.innerHTML = '';
    addDay();
    clearAll();
    $('oc-submit').querySelector('.btn__label').textContent = 'Publish trip';
    refresh();
  }

  function loadTrip(t) {
    resetForm();
    $('oc-id').value = t.id;
    $('oc-trip-title').value = t.title;
    $('oc-destination').value = t.destination;
    $('oc-price').value = t.price;
    $('oc-seats').value = t.seats;
    const radio = form.querySelector(`input[name="pickupPointId"][value="${t.pickupPointId}"]`);
    if (radio) radio.checked = true;
    datesList.innerHTML = '';
    (t.dates.length ? t.dates : ['']).forEach((d) => addDate(d));
    if (t.coverImage) cover.set({ src: t.coverImage, width: t.imageWidth, height: t.imageHeight });
    $('oc-cover-alt').value = t.coverAlt || '';
    summary.value = t.summary || '';
    $('oc-inclusions').value = (t.inclusions || []).join('\n');
    daysList.innerHTML = '';
    (t.days.length ? t.days : [{}]).forEach((d) => addDay(d));
    [...daysList.children].forEach((li) => li.classList.remove('is-new'));
    $('oc-submit').querySelector('.btn__label').textContent = 'Save changes';
    refresh();
    success.hidden = true;
    form.hidden = false;
    $('step-basics').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    $('oc-trip-title').focus({ preventScroll: true });
  }

  $('oc-reset').addEventListener('click', () => {
    if (confirm('Clear everything in this form? Published trips are not affected.')) { resetForm(); $('oc-trip-title').focus(); }
  });

  /* Own trips list ------------------------------------------------------- */
  function renderMine() {
    const list = $('oc-mine-list');
    const trips = getOwnerTrips().slice().reverse();
    list.innerHTML = '';
    if (!trips.length) {
      list.innerHTML = '<li class="oc-mine__empty">No trips published from this browser yet. Your first one will show here.</li>';
      return;
    }
    trips.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'oc-mine__item';
      li.innerHTML = `<img alt="" width="96" height="64" loading="lazy">
        <div class="oc-mine__text"><strong></strong><span class="muted"></span></div>
        <div class="oc-mine__tools">
          <button type="button" class="oc-photo__btn" data-edit>Edit</button>
          <button type="button" class="oc-photo__btn" data-delete>Delete</button>
        </div>`;
      li.querySelector('img').src = t.coverImage;
      li.querySelector('strong').textContent = t.title;
      li.querySelector('.muted').textContent = `${t.days.length} ${t.days.length === 1 ? 'day' : 'days'} · ${rupees(t.price)} · ${t.dates.map(fmtDate).join(', ')}`;
      li.querySelector('[data-edit]').setAttribute('aria-label', `Edit ${t.title}`);
      li.querySelector('[data-delete]').setAttribute('aria-label', `Delete ${t.title}`);
      li.querySelector('[data-edit]').addEventListener('click', () => loadTrip(t));
      li.querySelector('[data-delete]').addEventListener('click', () => {
        if (!confirm(`Delete "${t.title}"? Students will no longer see it.`)) return;
        deleteOwnerTrip(t.id);
        if ($('oc-id').value === t.id) resetForm();
        renderMine();
        $('oc-mine-title').focus?.();
      });
      list.appendChild(li);
    });
  }

  /* Submit --------------------------------------------------------------- */
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const editing = !!$('oc-id').value;
    const result = saveOwnerTrip(collect());
    if (!result.ok) return showErrors(result.errors || {});
    clearAll();
    const t = result.trip;
    $('oc-success-title').textContent = editing ? 'Changes saved' : 'Trip published';
    $('oc-success-text').textContent = `${t.title}: ${t.days.length} ${t.days.length === 1 ? 'day' : 'days'}, ${rupees(t.price)} per person, ${t.seats} seats, first departure ${fmtDate(t.dates[0])}.`;
    $('oc-success-link').href = `/itinerary?trip=${encodeURIComponent(t.id)}`;
    $('oc-success-link').querySelector('.btn__label').textContent = 'Open its itinerary';
    form.hidden = true;
    success.hidden = false;
    success.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    success.focus({ preventScroll: true });
    renderMine();
  });

  $('oc-another').addEventListener('click', () => {
    resetForm();
    success.hidden = true;
    form.hidden = false;
    $('step-basics').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    $('oc-trip-title').focus({ preventScroll: true });
  });

  resetForm();
  renderMine();
  $('oc-mine-title').tabIndex = -1;
}

checkOwner();
