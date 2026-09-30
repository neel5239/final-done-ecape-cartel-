/* Owner dashboard > Trips: list of trips with views and bookings, and the trip builder.
 * Builder = fixed slots: 1. trip basics, 2. pick the number of days (that many day slots appear),
 * 3. fill each day (title, what we do, stay, photos) while a live preview shows the website timeline,
 * 4. "Deploy to website" publishes it at once (server/trips.js). Nothing else is needed: no AI, no code.
 * Mounted by admin.js: TripStudio.mount(panelElement, { call, money }).
 */
(function () {
  'use strict';

  var PICKUPS = [['college-gate', 'College gate (Manipal University Jaipur)'], ['sundar-one', 'Sundar One hostel gate']];
  var MAX_DAYS = 15;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lines(v) { return String(v || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function fmtDate(iso) { return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function inr(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function cut(x, n) { x = String(x || ''); return x.length <= n ? x : x.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; }
  function blankDay() { return { title: '', place: '', description: '', activities: [], photos: [], hotel: null }; }
  function blankTrip() { return { title: '', destination: '', summary: '', price: '', dates: [], seats: 20, pickupPointId: 'college-gate', coverImage: '', coverAlt: '', inclusions: [], days: [blankDay(), blankDay(), blankDay()] }; }
  function dayFilled(d) { return !!(d.title || d.place || d.description || (d.activities || []).length || (d.photos || []).length || (d.hotel && d.hotel.name)); }

  /* ---- photos: resized in the browser (big 1600 px + small 480 px), then uploaded ---- */
  function toJpeg(file, max, quality) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        var k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k);
        c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('"' + file.name + '" could not be read. Use a JPG or PNG photo.')); };
      im.src = url;
    });
  }

  function mount(root, api) {
    var call = api.call;
    var S = { view: 'list', data: null, ed: null };

    async function upload(file, alt) {
      var big = await toJpeg(file, 1600, 0.82);
      var small = await toJpeg(file, 480, 0.74);
      var a = await call('uploads', { method: 'POST', body: { image: big } });
      var b = await call('uploads', { method: 'POST', body: { image: small, thumb: true } });
      return { src: a.src, thumb: b.src, alt: alt };
    }

    /* ======================= LIST ======================= */
    async function showList() {
      S.view = 'list';
      root.innerHTML = '<p class="od-muted">Loading trips…</p>';
      try { S.data = await call('trips'); } catch (e) { root.innerHTML = '<p class="od-err">' + esc(e.message) + '</p>'; return; }
      var d = S.data;
      var row = function (t) {
        var next = t.dates.filter(function (x) { return x >= new Date().toISOString().slice(0, 10); })[0] || t.dates[t.dates.length - 1];
        var status = t.kind === 'sample' ? '<span class="od-st">Sample</span>' : t.published ? '<span class="od-st st-paid">Live</span>' : '<span class="od-st st-pending">Draft</span>';
        var acts = t.kind === 'sample'
          ? '<a class="od-mini ghost od-linkbtn" href="/itinerary?trip=' + encodeURIComponent(t.id) + '" target="_blank" rel="noopener">View</a><button class="od-mini ghost" data-copy="' + esc(t.id) + '">Copy as new trip</button>'
          : '<button class="od-mini" data-edit="' + esc(t.id) + '">Edit</button><a class="od-mini ghost od-linkbtn" href="/itinerary?trip=' + encodeURIComponent(t.id) + '" target="_blank" rel="noopener">' + (t.published ? 'View' : 'Preview') + '</a>' +
            (t.published ? '<button class="od-mini ghost" data-unpub="' + esc(t.id) + '">Take offline</button>' : '<button class="od-mini ghost" data-pub="' + esc(t.id) + '">Deploy</button>') +
            '<button class="od-mini danger" data-del="' + esc(t.id) + '">Delete</button>';
        return '<tr><td><div class="tr-name">' + (t.coverImage ? '<img src="' + esc(t.coverImage) + '" alt="" width="64" height="44" loading="lazy">' : '<span class="tr-noimg"></span>') +
          '<div><strong>' + esc(t.title || 'Untitled trip') + '</strong><br><span class="od-muted">' + esc(t.destination || '') + (t.days ? ' · ' + t.days + ' day' + (t.days === 1 ? '' : 's') : '') + '</span></div></div></td>' +
          '<td>' + status + '</td><td>' + esc(fmtDate(next) || '–') + '</td><td class="od-num">' + (t.price ? inr(t.price) : '–') + '</td>' +
          '<td class="od-num">' + t.views30 + '</td><td class="od-num">' + t.seatsBooked + ' / ' + (t.seats || '–') + '</td><td class="od-num">' + api.money(t.revenue) + '</td>' +
          '<td class="od-act">' + acts + '</td></tr>';
      };
      var head = '<thead><tr><th>Trip</th><th>Status</th><th>Next date</th><th class="od-num">Price</th><th class="od-num">Visitors (30d)</th><th class="od-num">Seats booked</th><th class="od-num">Revenue</th><th><span class="od-sr">Actions</span></th></tr></thead>';
      root.innerHTML =
        '<section class="od-card tr-hero"><div><h2>Add a new trip in minutes</h2><p class="od-muted">Choose how many days, fill in what happens each day, add photos, and press "Deploy to website". The trip goes live straight away with its own day-by-day page.</p></div>' +
        '<div class="tr-hero__act"><button class="od-btn" id="tr-new">+ New trip</button></div></section>' +
        '<section class="od-card"><div class="od-tools"><h2>Your trips</h2></div><div class="od-table-wrap"><table class="od-table">' + head + '<tbody>' +
        (d.trips.length ? d.trips.map(row).join('') : '<tr><td colspan="8" class="od-muted od-empty">No trips of your own yet. Click "New trip" to make the first one.</td></tr>') + '</tbody></table></div></section>' +
        '<section class="od-card"><div class="od-tools"><h2>Sample trips already on the website</h2></div><p class="od-muted">These came with the website. Copy one to change it and deploy it as your own.</p><div class="od-table-wrap"><table class="od-table">' + head + '<tbody>' + d.samples.map(row).join('') + '</tbody></table></div></section>';
      root.querySelector('#tr-new').onclick = function () { openEditor(null, blankTrip(), false); };
      root.querySelectorAll('[data-edit]').forEach(function (b) {
        b.onclick = async function () { b.disabled = true; try { var r = await call('trips/' + b.dataset.edit); openEditor(r.id, r.trip, r.published); } catch (e) { alert(e.message); b.disabled = false; } };
      });
      root.querySelectorAll('[data-copy]').forEach(function (b) {
        b.onclick = async function () { b.disabled = true; try { var r = await call('trips/sample/' + b.dataset.copy); openEditor(null, r.trip, false); } catch (e) { alert(e.message); b.disabled = false; } };
      });
      var action = function (attr, path, confirmText) {
        root.querySelectorAll('[' + attr + ']').forEach(function (b) {
          b.onclick = async function () {
            if (confirmText && !confirm(confirmText)) return;
            b.disabled = true;
            try { await call('trips/' + b.getAttribute(attr) + '/' + path, { method: 'POST', body: {} }); showList(); } catch (e) { alert(e.message); b.disabled = false; }
          };
        });
      };
      action('data-pub', 'publish');
      action('data-unpub', 'unpublish', 'Take this trip off the website? Existing bookings stay on record.');
      action('data-del', 'delete', 'Delete this trip for good? This cannot be undone.');
    }

    /* ======================= EDITOR (fixed slots) ======================= */
    function openEditor(id, trip, published) {
      var t = Object.assign(blankTrip(), trip || {});
      t.days = (trip && trip.days ? trip.days : t.days).map(function (d) { return Object.assign(blankDay(), d, { photos: d.photos || [] }); });
      if (!t.days.length) t.days = [blankDay()];
      S.view = 'edit';
      S.ed = { id: id, published: !!published, trip: t, errors: {}, dirty: false };
      drawEditor();
      window.scrollTo(0, 0);
    }

    function field(label, path, value, opts) {
      opts = opts || {};
      var err = '<span class="tr-err" data-err="' + path + '"></span>';
      var hint = opts.hint ? '<small class="od-muted">' + opts.hint + '</small>' : '';
      var input = opts.area
        ? '<textarea data-f="' + path + '"' + (opts.list ? ' data-list' : '') + ' rows="' + (opts.rows || 3) + '" placeholder="' + esc(opts.ph || '') + '">' + esc(opts.list ? (value || []).join('\n') : value) + '</textarea>'
        : '<input data-f="' + path + '" type="' + (opts.type || 'text') + '" value="' + esc(value) + '"' + (opts.min != null ? ' min="' + opts.min + '"' : '') + (opts.max ? ' maxlength="' + opts.max + '"' : '') + ' placeholder="' + esc(opts.ph || '') + '">';
      return '<label class="tr-field' + (opts.wide ? ' tr-field--wide' : '') + '"><span>' + label + '</span>' + input + hint + err + '</label>';
    }

    function photoStrip(photos, path, max) {
      return '<div class="tr-photos">' + photos.map(function (p, i) {
        return '<figure><img src="' + esc(p.thumb || p.src) + '" alt="' + esc(p.alt) + '"><button type="button" class="tr-x" data-rmphoto="' + path + '.' + i + '" aria-label="Remove photo">×</button>' + (i === 0 && max > 1 ? '<figcaption>Main</figcaption>' : '') + '</figure>';
      }).join('') + (photos.length < max ? '<label class="tr-add-photo"><input type="file" accept="image/jpeg,image/png,image/webp" ' + (max > 1 ? 'multiple ' : '') + 'data-upload="' + path + '"><span>+ Add photo' + (max > 1 ? 's' : '') + '</span></label>' : '') + '</div>';
    }

    function daySlot(d, i) {
      var p = 'days.' + i;
      return '<article class="tr-day" id="tr-day-' + i + '"><header><span class="tr-daynum">Day ' + (i + 1) + '</span>' +
        '<div class="tr-day__tools"><button type="button" class="od-mini ghost" data-move="' + i + ':-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move day ' + (i + 1) + ' up">↑</button>' +
        '<button type="button" class="od-mini ghost" data-move="' + i + ':1"' + (i === S.ed.trip.days.length - 1 ? ' disabled' : '') + ' aria-label="Move day ' + (i + 1) + ' down">↓</button></div></header>' +
        '<div class="tr-grid">' +
          field('Day title', p + '.title', d.title, { ph: ['Lake Pichola', 'Old city', 'Fateh Sagar'][i % 3], max: 40, hint: 'Short: shown big on the timeline.' }) +
          field('Place', p + '.place', d.place, { ph: 'Udaipur', max: 60 }) +
          field('What we do (one per line)', p + '.activities', d.activities, { area: true, list: true, rows: 4, wide: true, ph: 'Boat ride on Lake Pichola\nSunset at Ambrai Ghat\nRooftop dinner', hint: 'The first 3 lines show on the website timeline; all of them show in the day details.' }) +
          field('More about this day (optional)', p + '.description', d.description, { area: true, rows: 2, wide: true, ph: 'Timings, what to carry, anything students should know.' }) +
          field('Stay tonight', p + '.hotel.name', d.hotel ? d.hotel.name : '', { ph: 'Lake-view hotel, twin/triple sharing (leave empty if no stay)' }) +
          field('Stay note', p + '.hotel.note', d.hotel ? d.hotel.note : '', { ph: 'Optional' }) +
          '<div class="tr-field tr-field--wide"><span>Photos (up to 3, the first is the main one)</span>' + photoStrip(d.photos, p + '.photos', 3) + '</div>' +
        '</div></article>';
    }

    function drawEditor() {
      var ed = S.ed;
      var t = ed.trip;
      var dates = t.dates.concat(['']).slice(0, 6);
      var n = t.days.length;
      root.innerHTML =
        '<div class="tr-top"><button type="button" class="od-btn ghost" id="tr-back">← All trips</button><h2>' + esc(t.title || (ed.id ? 'Edit trip' : 'New trip')) + '</h2>' +
          (ed.id ? '<span class="od-st ' + (ed.published ? 'st-paid">Live on the website' : 'st-pending">Draft') + '</span>' : '') + '</div>' +
        '<div class="tr-layout"><div class="tr-main">' +
        '<section class="od-card"><h2><span class="tr-step">1</span>Trip basics</h2><div class="tr-grid">' +
          field('Trip name', 'title', t.title, { ph: 'Udaipur lakes weekend', max: 80, wide: true }) +
          field('Destination', 'destination', t.destination, { ph: 'Udaipur', max: 60 }) +
          field('Price per person (₹)', 'price', t.price, { type: 'number', min: 1, ph: '3999' }) +
          field('Selling line (1–2 sentences)', 'summary', t.summary, { area: true, rows: 2, wide: true, ph: 'Lake Pichola boat ride, City Palace, old-city lanes and rooftop sunsets.' }) +
          field('Seats', 'seats', t.seats, { type: 'number', min: 2 }) +
          '<label class="tr-field"><span>Pickup point</span><select data-f="pickupPointId">' + PICKUPS.map(function (p) { return '<option value="' + p[0] + '"' + (t.pickupPointId === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></label>' +
          '<div class="tr-field tr-field--wide"><span>Departure dates</span><div class="tr-dates">' + dates.map(function (d, i) { return '<input type="date" data-date="' + i + '" value="' + esc(d) + '" aria-label="Departure date ' + (i + 1) + '">'; }).join('') + '</div><span class="tr-err" data-err="dates"></span></div>' +
          field('What the price covers (one per line)', 'inclusions', t.inclusions, { area: true, list: true, rows: 3, wide: true, ph: 'Return AC travel from your pickup point\nStay on twin/triple sharing\nTrip captain throughout' }) +
          '<div class="tr-field tr-field--wide"><span>Cover photo (first thing visitors see)</span>' + photoStrip(t.coverImage ? [{ src: t.coverImage, thumb: t.coverImage, alt: t.coverAlt }] : [], 'cover', 1) + '<span class="tr-err" data-err="coverImage"></span></div>' +
        '</div></section>' +
        '<section class="od-card"><h2><span class="tr-step">2</span>How many days?</h2>' +
          '<div class="tr-count"><button type="button" class="od-btn ghost" data-count="-1"' + (n <= 1 ? ' disabled' : '') + ' aria-label="One day less">−</button>' +
          '<output id="tr-ndays" aria-live="polite">' + n + ' day' + (n === 1 ? '' : 's') + '</output>' +
          '<button type="button" class="od-btn ghost" data-count="1"' + (n >= MAX_DAYS ? ' disabled' : '') + ' aria-label="One day more">+</button>' +
          '<div class="tr-count__quick">' + [1, 2, 3, 4, 5, 6, 7].map(function (k) { return '<button type="button" class="od-mini ' + (k === n ? '' : 'ghost') + '" data-setcount="' + k + '">' + k + '</button>'; }).join('') + '</div></div>' +
          '<p class="od-muted">Each day gets its own slot below.</p><span class="tr-err" data-err="days"></span></section>' +
        '<section class="tr-slots"><h2 class="tr-slots__h"><span class="tr-step">3</span>Fill in each day</h2>' + t.days.map(daySlot).join('') + '</section>' +
        '</div>' +
        '<aside class="tr-side"><section class="od-card tr-prev"><h2>Live preview</h2><p class="od-muted">This is how the days look on the website.</p><div id="tr-preview-box"></div></section></aside></div>' +
        '<div class="tr-bar"><p class="tr-status" id="tr-save-status" role="status"></p>' +
          '<button type="button" class="od-btn ghost" id="tr-save">Save draft</button>' +
          '<button type="button" class="od-btn ghost" id="tr-preview">Open preview</button>' +
          '<button type="button" class="od-btn tr-deploy" id="tr-publish">' + (ed.published ? 'Update live trip' : 'Deploy to website') + '</button></div>';
      bindEditor();
      showErrors();
      renderPreview();
    }

    // Mirrors the website timeline (Day N, big title, 3 short lines, small photos).
    function renderPreview() {
      var box = root.querySelector('#tr-preview-box');
      if (!box) return;
      var t = S.ed.trip;
      box.innerHTML = '<div class="tr-pv">' + (t.coverImage ? '<img class="tr-pv__cover" src="' + esc(t.coverImage) + '" alt="">' : '') +
        '<p class="tr-pv__name">' + esc(t.title || 'Your trip name') + '</p>' +
        '<p class="tr-pv__meta">' + esc([t.destination, t.days.length + ' day' + (t.days.length === 1 ? '' : 's'), t.price ? inr(t.price) + ' per person' : ''].filter(Boolean).join(' · ')) + '</p>' +
        '<ol class="tr-pv__days">' + t.days.map(function (d, i) {
          var pts = (d.activities || []).slice(0, 3);
          return '<li><span class="tr-pv__dot"></span><p class="tr-pv__num">Day ' + (i + 1) + '</p><p class="tr-pv__title">' + esc(cut(d.title, 28) || 'Day title') + '</p>' +
            (pts.length ? '<ul>' + pts.map(function (x) { return '<li>' + esc(cut(x, 40)) + '</li>'; }).join('') + '</ul>' : '<ul><li class="tr-pv__empty">What we do…</li></ul>') +
            (d.photos.length ? '<div class="tr-pv__pics">' + d.photos.map(function (p) { return '<img src="' + esc(p.thumb || p.src) + '" alt="">'; }).join('') + '</div>' : '') + '</li>';
        }).join('') + '</ol></div>';
    }

    function setPath(obj, path, val) {
      var keys = path.split('.');
      var o = obj;
      for (var i = 0; i < keys.length - 1; i++) {
        var k = keys[i];
        if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
        o = o[k];
      }
      o[keys[keys.length - 1]] = val;
    }

    function readForm() {
      var t = S.ed.trip;
      root.querySelectorAll('[data-f]').forEach(function (el) {
        setPath(t, el.dataset.f, el.hasAttribute('data-list') ? lines(el.value) : el.value);
      });
      t.dates = [].slice.call(root.querySelectorAll('[data-date]')).map(function (el) { return el.value; }).filter(Boolean);
      t.days.forEach(function (d) {
        // The slot form owns these: the timeline name and key moments follow the title and activities.
        d.short = ''; d.points = [];
        if (d.hotel && !String(d.hotel.name || '').trim()) d.hotel = null;
      });
    }

    function showErrors() {
      var errs = S.ed.errors || {};
      root.querySelectorAll('[data-err]').forEach(function (el) { el.textContent = errs[el.dataset.err] || ''; });
      root.querySelectorAll('.tr-err--extra').forEach(function (el) { el.remove(); });
      Object.keys(errs).forEach(function (k) {
        if (root.querySelector('[data-err="' + k + '"]')) return;
        var m = k.match(/^days\.(\d+)\./);
        var head = m && root.querySelector('#tr-day-' + m[1] + ' header');
        if (head) head.insertAdjacentHTML('beforeend', '<span class="tr-err tr-err--extra">' + esc(errs[k]) + '</span>');
      });
    }

    function status(text, kind) {
      var el = root.querySelector('#tr-save-status');
      if (el) { el.textContent = text; el.dataset.kind = kind || ''; }
    }

    function setCount(n) {
      var days = S.ed.trip.days;
      n = Math.max(1, Math.min(MAX_DAYS, n));
      if (n < days.length) {
        var lost = days.slice(n).filter(dayFilled).length;
        if (lost && !confirm('Remove the last ' + (days.length - n) + ' day(s)? What you wrote there will be deleted.')) return;
        days.length = n;
      }
      while (days.length < n) days.push(blankDay());
      markDirty();
      drawEditor();
      if (n > 0) { var el = root.querySelector('#tr-day-' + (n - 1)); if (el && n > 1) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }

    function bindEditor() {
      var ed = S.ed;
      root.querySelector('#tr-back').onclick = function () {
        if (ed.dirty && !confirm('Leave without saving? Your changes to this trip will be lost.')) return;
        showList();
      };
      root.querySelectorAll('[data-count]').forEach(function (b) { b.onclick = function () { readForm(); setCount(ed.trip.days.length + Number(b.dataset.count)); }; });
      root.querySelectorAll('[data-setcount]').forEach(function (b) { b.onclick = function () { readForm(); setCount(Number(b.dataset.setcount)); }; });
      root.querySelectorAll('[data-move]').forEach(function (b) {
        b.onclick = function () {
          var m = b.dataset.move.split(':').map(Number);
          readForm();
          var days = ed.trip.days;
          var j = m[0] + m[1];
          var x = days[m[0]]; days[m[0]] = days[j]; days[j] = x;
          markDirty(); drawEditor();
          var el = root.querySelector('#tr-day-' + j);
          if (el) el.scrollIntoView({ block: 'center' });
        };
      });
      root.querySelectorAll('[data-rmphoto]').forEach(function (b) {
        b.onclick = function () {
          readForm();
          var path = b.dataset.rmphoto;
          if (path.indexOf('cover') === 0) { ed.trip.coverImage = ''; ed.trip.coverAlt = ''; }
          else { var m = path.match(/^days\.(\d+)\.photos\.(\d+)$/); ed.trip.days[Number(m[1])].photos.splice(Number(m[2]), 1); }
          markDirty(); drawEditor();
        };
      });
      root.querySelectorAll('[data-upload]').forEach(function (input) {
        input.onchange = async function () {
          var files = [].slice.call(input.files || []);
          if (!files.length) return;
          readForm();
          var path = input.dataset.upload;
          input.nextElementSibling.textContent = 'Uploading…';
          input.disabled = true;
          try {
            if (path === 'cover') {
              var alt = (ed.trip.title || ed.trip.destination || 'Trip') + ' cover photo';
              var p = await upload(files[0], alt);
              ed.trip.coverImage = p.src; ed.trip.coverAlt = alt;
            } else {
              var i = Number(path.split('.')[1]);
              var day = ed.trip.days[i];
              for (var k = 0; k < files.length && day.photos.length < 3; k++) {
                day.photos.push(await upload(files[k], (day.place || day.title || ed.trip.destination || 'Trip') + ', day ' + (i + 1)));
              }
            }
            markDirty();
          } catch (e) { alert(e.message); }
          var y = window.scrollY;
          drawEditor();
          window.scrollTo(0, y);
        };
      });
      root.querySelector('#tr-save').onclick = function () { save(false); };
      root.querySelector('#tr-publish').onclick = function () { save(true); };
      root.querySelector('#tr-preview').onclick = async function () {
        var w = window.open('about:blank', '_blank');
        var id = await save(false);
        if (id && w) w.location = '/itinerary?trip=' + encodeURIComponent(id);
        else if (w) w.close();
      };
    }

    function markDirty() { if (S.ed) S.ed.dirty = true; }

    async function save(deploy) {
      var ed = S.ed;
      readForm();
      // A live trip stays live (and fully checked) when saved; a draft goes live only with "Deploy".
      var publish = deploy || ed.published;
      status(deploy ? 'Deploying to the website…' : 'Saving…', 'busy');
      root.querySelectorAll('.tr-bar button').forEach(function (b) { b.disabled = true; });
      try {
        var r = await fetch('/api/admin/trips', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-admin': '1' }, body: JSON.stringify({ id: ed.id, trip: ed.trip, publish: publish }) });
        var data = await r.json().catch(function () { return {}; });
        if (r.status === 401) throw new Error('Your login has expired. Log in again in another tab, then save.');
        if (!r.ok) {
          ed.errors = data.errors || {};
          showErrors();
          var first = root.querySelector('.tr-err:not(:empty)');
          if (first) first.closest('.tr-field, .tr-day, section').scrollIntoView({ behavior: 'smooth', block: 'center' });
          throw new Error((data.error && data.error.message) || data.error || 'Could not save.');
        }
        ed.id = data.id;
        ed.published = data.published;
        ed.dirty = false;
        ed.errors = {};
        if (deploy) {
          drawEditor();
          root.querySelector('.tr-bar').insertAdjacentHTML('afterbegin', '<p class="tr-live">Deployed. The trip is live on the website now. <a href="/itinerary?trip=' + encodeURIComponent(data.id) + '" target="_blank" rel="noopener">Open its page</a> · <a href="/trips#group-trips" target="_blank" rel="noopener">See it in the trips list</a></p>');
        } else {
          showErrors();
          status(data.published ? 'Saved. The live trip is updated.' : 'Draft saved. Only you can see it until you deploy.', 'ok');
          if (!root.querySelector('.tr-top .od-st')) root.querySelector('.tr-top').insertAdjacentHTML('beforeend', '<span class="od-st ' + (data.published ? 'st-paid">Live on the website' : 'st-pending">Draft') + '</span>');
        }
        return data.id;
      } catch (e) {
        status(e.message, 'error');
        return null;
      } finally { root.querySelectorAll('.tr-bar button').forEach(function (b) { b.disabled = false; }); }
    }

    // Typing marks the trip as changed and updates the live preview.
    var pv;
    root.addEventListener('input', function () {
      if (S.view !== 'edit') return;
      markDirty();
      clearTimeout(pv);
      pv = setTimeout(function () { readForm(); renderPreview(); }, 120);
    });
    window.addEventListener('beforeunload', function (e) { if (S.view === 'edit' && S.ed && S.ed.dirty) { e.preventDefault(); e.returnValue = ''; } });
    showList();
  }

  window.TripStudio = { mount: mount };
})();
