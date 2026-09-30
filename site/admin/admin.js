/* Owner dashboard. Talks to /api/admin/* (owner login).
 * Tabs: Overview (visitors from the website + sales), Bookings (orders and payments), Trips (site/admin/trips.js:
 * AI trip builder, editor, publish). The tab is kept in the address (#overview, #bookings, #trips). */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var TABS = { overview: 'Overview', bookings: 'Bookings', trips: 'Trips' };
  var TAB_NOTE = { overview: 'Who visits the website and what they book', bookings: 'Every booking, payment and traveller', trips: 'Add, edit and deploy trips to the website' };
  var ICON = {
    overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10m6 10V4m6 16v-7m4 7H3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    bookings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z M14 5v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-dasharray="0"/></svg>',
    trips: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Zm0 0v13m6-10.5v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    site: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6L11 13M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 17l5-5-5-5m5 5H9m3 8H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  };

  // Dark by default (matches the website); the owner can switch to light. Remembered on this device only.
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('od-theme', t); } catch (e) { /* private mode */ }
  }
  (function () { var t = 'dark'; try { t = localStorage.getItem('od-theme') || 'dark'; } catch (e) { /* ignore */ } document.documentElement.dataset.theme = t; })();
  var state = { status: '', pay: '', q: '', stats: null, visits: null, orders: [], info: null, timer: null, tab: 'overview', shell: false };
  var STATUS = { pending: 'Waiting for payment', verifying: 'Check UPI payment', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled', refunded: 'Refunded' };
  var MODE = { demo: 'Demo payments (no real money)', upi: 'UPI to your account', razorpay: 'Razorpay (verified automatically)' };
  var PAY = { created: 'Created', pending: 'Pending', success: 'Success', failed: 'Failed', refunded: 'Refunded' };
  var METHOD = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later', cardless_emi: 'Cardless EMI' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(p) { return Shop.money(p, state.stats && state.stats.currency); }
  async function call(path, opts) {
    opts = opts || {};
    var r = await fetch('/api/admin/' + path, { method: opts.method || 'GET', headers: Object.assign({ 'x-admin': '1' }, opts.body ? { 'content-type': 'application/json' } : {}), body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
    var data = await r.json().catch(function () { return {}; });
    if (r.status === 401) { showLogin(); throw new Error('Please log in.'); }
    if (!r.ok) throw new Error((data.error && data.error.message) || data.error || 'Something went wrong.');
    return data;
  }

  // Group bookings: every named traveller (one seat each), lead booker first.
  function travellersOf(o) {
    var list = [];
    try { list = JSON.parse(o.travellers || '[]'); } catch (e) { list = []; }
    if (!list.length) return '';
    return '<details class="od-trav"><summary>' + list.length + ' traveller' + (list.length === 1 ? '' : 's') + '</summary><ul>' + list.map(function (t) {
      return '<li>' + esc(t.name) + ' · <a href="tel:+91' + esc(t.phone) + '">' + esc(t.phone) + '</a>' + (t.lead ? ' <span class="od-muted">(lead' + (t.college ? ', ' + esc(t.college) : '') + ')</span>' : '') + '</li>';
    }).join('') + '</ul></details>';
  }

  function showLogin(msg) {
    clearInterval(state.timer);
    state.shell = false;
    var off = state.info && !state.info.enabled;
    app.innerHTML = '<section class="od-login"><img class="od-login__logo" src="/assets/images/logo/logo-white.png" alt="Escape Cartel" width="88" height="88"><h1>Owner dashboard</h1><p class="od-muted">Trips, bookings and visitors in one place.</p>' +
      (off ? '<p class="od-warn">The owner login is not set up yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 10 characters) in the site\'s settings, then restart it.</p>'
        : '<form id="login" class="od-form"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="od-btn">Log in</button><p class="od-err" role="alert">' + esc(msg || '') + '</p></form>') +
      '</section>';
    var f = document.getElementById('login');
    if (f) f.onsubmit = async function (e) {
      e.preventDefault();
      f.querySelector('button').disabled = true;
      try {
        var r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.email.value, password: f.password.value }) });
        var d = await r.json().catch(function () { return {}; });
        if (!r.ok) return showLogin((d.error && d.error.message) || d.error || 'Could not log in.');
        load();
      } catch (err) { showLogin(err.message); }
    };
  }

  function chart(days) {
    var max = Math.max.apply(null, days.map(function (d) { return d.revenue; }).concat([1]));
    return '<div class="od-chart" role="img" aria-label="Revenue per day, last 14 days">' + days.map(function (d) {
      var h = Math.round((d.revenue / max) * 100);
      var label = new Date(d.day + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      return '<div class="od-bar" title="' + esc(label) + ': ' + money(d.revenue) + ' · ' + d.orders + ' order(s)"><i style="height:' + Math.max(h, d.revenue ? 4 : 1) + '%"></i><span>' + esc(label.split(' ')[0]) + '</span></div>';
    }).join('') + '</div>';
  }

  // Payment column: status badge, method, and the transaction ids the owner can look up in Razorpay.
  function payCell(o) {
    var p = o.payment;
    if (!p) return '<span class="od-pst pst-created">' + PAY.created + '</span><br><span class="od-muted">No payment started</span>';
    var bits = ['<span class="od-pst pst-' + esc(p.status) + '">' + esc(PAY[p.status] || p.status) + '</span>'];
    var how = [METHOD[p.method] || p.method, p.mode === 'demo' ? 'demo' : p.mode === 'upi' ? 'direct UPI' : p.razorpayQrId ? 'Razorpay QR' : 'Razorpay'].filter(Boolean).join(' · ');
    bits.push('<span class="od-muted">' + esc(how) + (p.attempts > 1 ? ' · ' + p.attempts + ' attempts' : '') + '</span>');
    if (p.razorpayPaymentId) bits.push('<span class="od-mono" title="Payment id">' + esc(p.razorpayPaymentId) + '</span>');
    if (p.razorpayOrderId) bits.push('<span class="od-mono od-muted" title="Razorpay order id">' + esc(p.razorpayOrderId) + '</span>');
    else if (p.razorpayQrId) bits.push('<span class="od-mono od-muted" title="Razorpay QR id">' + esc(p.razorpayQrId) + '</span>');
    if (p.refundId || p.refundStatus) bits.push('<span class="od-muted">Refund ' + esc(p.refundStatus || '') + (p.refundId ? ' <span class="od-mono">' + esc(p.refundId) + '</span>' : '') + '</span>');
    if (p.status === 'failed' && p.error) bits.push('<span class="od-muted od-fail">' + esc(p.error) + '</span>');
    return '<div class="od-pay">' + bits.join('') + '</div>';
  }

  function tabFromHash() { var h = location.hash.replace('#', ''); return TABS[h] ? h : 'overview'; }

  // Sidebar + top bar are drawn once; each tab draws into #panel.
  function shell() {
    var s = state.stats;
    var info = state.info || {};
    var po = s.payments || {};
    var demo = info.payments === 'demo';
    app.innerHTML =
      '<div class="od-app">' +
      '<aside class="od-side"><a class="od-logo" href="#overview" aria-label="Dashboard home"><img src="/assets/images/logo/logo-white.png" alt="" width="48" height="48"><span><strong>Escape Cartel</strong><em>Owner dashboard</em></span></a>' +
        '<nav class="od-tabs" aria-label="Dashboard sections">' + Object.keys(TABS).map(function (k) { return '<a href="#' + k + '" data-tab="' + k + '">' + ICON[k] + '<span>' + TABS[k] + '</span></a>'; }).join('') + '</nav>' +
        '<div class="od-side__foot">' +
          '<p class="od-mode' + (demo ? ' is-demo' : '') + '"><i></i>' + esc(po.testMode ? 'Razorpay test mode' : demo ? 'Demo payments' : MODE[info.payments] || '') + '</p>' +
          '<a class="od-sidelink" href="/" target="_blank" rel="noopener">' + ICON.site + '<span>View website</span></a>' +
          '<button class="od-sidelink" type="button" id="theme">' + ICON.theme + '<span>Light / dark</span></button>' +
          '<button class="od-sidelink" type="button" id="logout">' + ICON.out + '<span>Log out</span></button>' +
        '</div></aside>' +
      '<div class="od-body"><header class="od-head"><div><h1 id="od-title"></h1><p class="od-muted" id="od-note"></p></div>' +
        '<p class="od-today">' + esc(new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })) + '</p></header>' +
        ((info.problems || []).length ? '<p class="od-warn">' + esc(info.problems.join('. ')) + '</p>' : '') +
        ((po.warnings || []).length ? '<p class="od-warn">' + esc(po.warnings.join(' ')) + '</p>' : '') +
        (demo ? '<p class="od-note">Payments are in demo mode: no real money moves. Switch to real payments in the site settings when you are ready.</p>' : '') +
        '<div id="panel" class="od-panel"></div></div></div>';
    document.getElementById('logout').onclick = async function () { await fetch('/api/admin/logout', { method: 'POST' }); showLogin(); };
    document.getElementById('theme').onclick = function () { applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); };
    state.shell = true;
  }

  function markTabs() {
    var t = document.getElementById('od-title');
    if (t) { t.textContent = TABS[state.tab]; document.getElementById('od-note').textContent = TAB_NOTE[state.tab]; }
    document.title = TABS[state.tab] + ' · Owner dashboard';
    app.querySelectorAll('[data-tab]').forEach(function (a) {
      if (a.dataset.tab === state.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function render() {
    if (!state.shell) shell();
    markTabs();
    var panel = document.getElementById('panel');
    if (state.tab === 'trips') {
      if (panel.dataset.tab !== 'trips') { panel.dataset.tab = 'trips'; panel.innerHTML = ''; window.TripStudio.mount(panel, { call: call, money: money }); }
      return;
    }
    panel.dataset.tab = state.tab;
    if (state.tab === 'overview') panel.innerHTML = overview();
    else renderBookings(panel);
  }

  function bars(days, key, fmt, label) {
    var max = Math.max.apply(null, days.map(function (d) { return d[key]; }).concat([1]));
    return '<div class="od-chart" role="img" aria-label="' + esc(label) + '">' + days.map(function (d) {
      var h = Math.round((d[key] / max) * 100);
      var day = new Date(d.day + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      return '<div class="od-bar" title="' + esc(day) + ': ' + esc(fmt(d)) + '"><i style="height:' + Math.max(h, d[key] ? 4 : 1) + '%"></i><span>' + esc(day.split(' ')[0]) + '</span></div>';
    }).join('') + '</div>';
  }

  function rank(title, rows, empty) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.visitors; }).concat([1]));
    return '<div class="od-card"><h2>' + title + '</h2>' + (rows.length ? '<ul class="od-rank">' + rows.map(function (r) {
      return '<li><span class="od-rank__name">' + esc(r.name) + '</span><strong>' + r.visitors + '</strong><i style="width:' + Math.round((r.visitors / max) * 100) + '%"></i></li>';
    }).join('') + '</ul>' : '<p class="od-muted">' + empty + '</p>') + '</div>';
  }

  function overview() {
    var s = state.stats;
    var v = state.visits || { today: {}, week: {}, month: {}, days: [], pages: [], trips: [], sources: [], devices: [], funnel: {}, clicks: {} };
    var f = v.funnel || {};
    var pct = function (a, b) { return b ? Math.round((a / b) * 100) + '%' : '–'; };
    var kpi = function (label, val, sub) { return '<div class="od-kpi"><span>' + label + '</span><strong>' + val + '</strong><em>' + sub + '</em></div>'; };
    var sale = function (label, x) { return kpi(label, money(x.s), x.n + ' paid booking' + (x.n === 1 ? '' : 's')); };
    var n = function (x) { return Number(x || 0).toLocaleString('en-IN'); };
    return '<section class="od-kpis">' +
        '<div class="od-kpi od-live"><span><i class="od-dot" aria-hidden="true"></i>On the site now</span><strong>' + n(v.live) + '</strong><em>visitors in the last 5 minutes</em></div>' +
        kpi('Visitors today', n(v.today.visitors), n(v.today.views) + ' page views') + kpi('Last 7 days', n(v.week.visitors), n(v.week.views) + ' page views') + kpi('Last 30 days', n(v.month.visitors), n(v.month.views) + ' page views') +
      '</section>' +
      '<section class="od-kpis">' + sale('Sales today', s.today) + sale('Last 7 days', s.week) + sale('Last 30 days', s.month) + sale('All time', s.all) + '</section>' +
      '<section class="od-panels">' +
        '<div class="od-card"><h2>Visitors, last 14 days</h2>' + bars(v.days, 'visitors', function (d) { return d.visitors + ' visitors, ' + d.views + ' views, ' + d.bookings + ' booking(s)'; }, 'Visitors per day, last 14 days') + '</div>' +
        '<div class="od-card"><h2>From visit to booking (30 days)</h2><ol class="od-funnel">' +
          '<li><span>Looked at a trip</span><strong>' + n(f.tripVisitors) + '</strong></li>' +
          '<li><span>Opened checkout</span><strong>' + n(f.checkoutVisitors) + '</strong><em>' + pct(f.checkoutVisitors, f.tripVisitors) + '</em></li>' +
          '<li><span>Paid bookings</span><strong>' + n(f.bookings) + '</strong><em>' + pct(f.bookings, f.checkoutVisitors) + '</em></li>' +
          '<li><span>Travellers booked</span><strong>' + n(f.travellers) + '</strong></li>' +
        '</ol><ul class="od-list od-clicks"><li><span>WhatsApp taps</span><strong>' + n(v.clicks.whatsapp) + '</strong></li><li><span>Call taps</span><strong>' + n(v.clicks.call) + '</strong></li><li><span>"Join this trip" clicks</span><strong>' + n(v.clicks.join) + '</strong></li></ul></div>' +
      '</section>' +
      '<section class="od-grid4">' +
        rank('Most viewed trips', v.trips, 'No trip views yet.') + rank('Top pages', v.pages, 'No visits yet.') +
        rank('Where visitors come from', v.sources, 'No visits yet.') + rank('Devices', v.devices.map(function (d) { return { name: d.name.charAt(0).toUpperCase() + d.name.slice(1), visitors: d.visitors }; }), 'No visits yet.') +
      '</section>' +
      '<section class="od-card"><h2>Revenue, last 14 days</h2>' + chart(s.days) + '</section>' +
      '<p class="od-muted od-foot">Visitors are counted without cookies (one visitor per device per day). Updates every 30 seconds.</p>';
  }

  function renderBookings(panel) {
    var s = state.stats;
    var b = s.byStatus || {};
    var rows = state.orders.map(function (o) {
      var actions = [];
      var pay = o.payment;
      if (o.status === 'verifying' || o.status === 'pending') actions.push('<button class="od-mini" data-act="paid" data-id="' + o.id + '">Mark paid</button>');
      if (o.status === 'pending' || o.status === 'verifying' || o.status === 'failed') actions.push('<button class="od-mini ghost" data-act="cancelled" data-id="' + o.id + '">Cancel</button>');
      if (o.status === 'paid' || (pay && pay.status === 'success')) actions.push('<button class="od-mini danger" data-refund="' + esc(o.id) + '" data-mode="' + esc((pay && pay.mode) || o.payment_mode) + '" data-amount="' + o.amount + '">Refund</button>');
      return '<tr><td><span class="od-mono">' + esc(o.id.slice(-10).toUpperCase()) + '</span><br><span class="od-muted">' + esc(new Date(o.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })) + '</span></td>' +
        '<td>' + esc(o.customer_name) + '<br><span class="od-muted">' + esc(o.customer_phone || o.customer_email) + '</span></td>' +
        '<td>' + o.items.map(function (i) { return esc(i.name) + ' × ' + i.qty; }).join('<br>') + (o.booking_date ? '<br><span class="od-muted">for ' + esc(o.booking_date) + '</span>' : '') + travellersOf(o) + '</td>' +
        '<td class="od-num">' + money(o.amount) + '</td>' +
        '<td><span class="od-st st-' + esc(o.status) + '">' + esc(STATUS[o.status] || o.status) + '</span>' + (o.payment_ref && !pay ? '<br><span class="od-muted od-mono" title="Payment reference">' + esc(o.payment_ref) + '</span>' : '') + '</td>' +
        '<td>' + payCell(o) + '</td>' +
        '<td class="od-act">' + actions.join('') + '</td></tr>';
    }).join('');
    panel.innerHTML =
      (b.verifying ? '<p class="od-warn"><strong>' + b.verifying + ' UPI payment' + (b.verifying > 1 ? 's' : '') + ' to check.</strong> Find the UTR in your bank or UPI app, then click "Mark paid".</p>' : '') +
      '<section class="od-panels od-even"><div class="od-card"><h2>Payments</h2><ul class="od-list">' + Object.keys(PAY).map(function (k) { return '<li><span class="od-pst pst-' + k + '">' + PAY[k] + '</span><strong>' + ((s.byPayment || {})[k] || 0) + '</strong></li>'; }).join('') + '</ul></div>' +
      '<div class="od-card"><h2>Orders by status</h2><ul class="od-list">' + Object.keys(STATUS).map(function (k) { return '<li><span class="od-st st-' + k + '">' + STATUS[k] + '</span><strong>' + (b[k] || 0) + '</strong></li>'; }).join('') + '</ul>' +
      (s.topItems.length ? '<h2>Best sellers (30 days)</h2><ul class="od-list">' + s.topItems.map(function (t) { return '<li><span>' + esc(t.name) + '</span><strong>' + t.qty + '</strong></li>'; }).join('') + '</ul>' : '') + '</div></section>' +
      '<section class="od-card"><div class="od-tools"><h2>Bookings</h2><a class="od-mini ghost od-linkbtn" href="/api/admin/orders.csv">Export CSV</a><select id="status" aria-label="Filter by status"><option value="">All</option>' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (state.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>'; }).join('') + '</select>' +
      '<select id="pay" aria-label="Filter by payment status"><option value="">Any payment</option>' + Object.keys(PAY).map(function (k) { return '<option value="' + k + '"' + (state.pay === k ? ' selected' : '') + '>Payment: ' + PAY[k] + '</option>'; }).join('') + '</select>' +
      '<input id="q" type="search" placeholder="Search name, phone, order, payment id" value="' + esc(state.q) + '" aria-label="Search orders"></div>' +
      '<div class="od-table-wrap"><table class="od-table"><thead><tr><th>Order</th><th>Customer</th><th>Trip / items</th><th class="od-num">Amount</th><th>Order status</th><th>Payment</th><th><span class="od-sr">Actions</span></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7" class="od-muted od-empty">' + (state.status || state.pay || state.q ? 'No orders match this filter.' : 'No orders yet.') + '</td></tr>') + '</tbody></table></div></section>' +
      '<p class="od-muted od-foot">Updates every 30 seconds.</p>';
    document.getElementById('status').onchange = function (e) { state.status = e.target.value; loadOrders(); };
    document.getElementById('pay').onchange = function (e) { state.pay = e.target.value; loadOrders(); };
    app.querySelectorAll('[data-refund]').forEach(function (btn) {
      btn.onclick = async function () {
        var mode = btn.dataset.mode;
        var amount = money(Number(btn.dataset.amount));
        var msg = mode === 'razorpay'
          ? 'Refund ' + amount + ' to the customer through Razorpay?\n\nThe money goes back to their card, bank or UPI account. This cannot be undone.'
          : mode === 'upi'
            ? 'Mark ' + amount + ' as refunded?\n\nSend the money back to the customer from your UPI app yourself: this only records it.'
            : 'Refund this demo payment of ' + amount + '? (No real money moves.)';
        if (!confirm(msg)) return;
        btn.disabled = true;
        btn.textContent = 'Refunding…';
        try {
          var r = await call('refund', { method: 'POST', body: { orderId: btn.dataset.refund } });
          if (r.manual) alert('Recorded as refunded. Remember to send the money back from your UPI app.');
          else if (r.refundStatus && r.refundStatus !== 'processed') alert('Refund started with Razorpay (' + r.refundStatus + '). Razorpay usually completes it in 5 to 7 working days.');
          await load();
        } catch (e) { alert(e.message); btn.disabled = false; btn.textContent = 'Refund'; }
      };
    });
    var qi = document.getElementById('q');
    var t;
    qi.oninput = function () { clearTimeout(t); t = setTimeout(function () { state.q = qi.value.trim(); loadOrders(); }, 300); };
    app.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.onclick = async function () {
        var act = btn.dataset.act;
        if (act !== 'paid' && !confirm('Cancel this order?')) return;
        btn.disabled = true;
        try { await call('orders/' + btn.dataset.id + '/status', { method: 'POST', body: { status: act } }); await load(); } catch (e) { alert(e.message); btn.disabled = false; }
      };
    });
  }

  async function loadOrders() {
    var qs = new URLSearchParams({ status: state.status, pay: state.pay, q: state.q, limit: '200' });
    state.orders = await call('orders?' + qs);
    render();
    var qi = document.getElementById('q');
    if (qi && state.q) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  }

  async function load() {
    try {
      state.info = await (await fetch('/api/admin/status')).json();
      if (!state.info.enabled) return showLogin();
      state.tab = tabFromHash();
      state.stats = await call('stats');
      state.visits = await call('visits').catch(function () { return null; });
      await loadOrders();
      clearInterval(state.timer);
      state.timer = setInterval(function () {
        if (document.hidden || state.tab === 'trips') return;
        Promise.all([call('stats'), call('visits')]).then(function (x) { state.stats = x[0]; state.visits = x[1]; return loadOrders(); }).catch(function () {});
      }, 30000);
    } catch (e) {
      if (!/log in/i.test(e.message)) app.innerHTML = '<p class="od-err">' + esc(e.message) + '</p>';
    }
  }
  window.addEventListener('hashchange', function () {
    if (!state.shell) return;
    state.tab = tabFromHash();
    render();
    window.scrollTo(0, 0);
  });
  load();
})();
