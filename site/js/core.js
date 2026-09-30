/**
 * Escape Cartel — site shell (load on every page with `defer`, before page scripts).
 *
 *   <div data-include="header"></div>   first thing in <body>
 *   <main id="main"> ... </main>
 *   <div data-include="footer"></div>   after </main>
 *   <script src="js/core.js" defer></script>
 *   <script src="js/buttons.js" defer></script>
 *
 * 1. Partials: fetches partials/header.html + footer.html (single source of
 *    truth). If fetch is blocked (file://, offline) it falls back to the
 *    templates at the bottom of this file, which are copies of those files.
 *    Pages may also paste the partial markup directly (static fallback);
 *    this script then just enhances what is there.
 * 2. Header: always dark translucent glass (never flips to white); marks
 *    .is-scrolled once the page leaves the top (IntersectionObserver).
 * 3. Mobile nav drawer: aria-expanded, Esc to close, focus kept inside,
 *    focus returned to the toggle.
 * 4. Mobile bottom bar ("Plan my trip" + call) appears after the first
 *    screen. WhatsApp sits in the header below 1400px and floats only in
 *    the free right gutter above that (css/base.css 6e).
 * 5. WhatsApp links get a prefilled message naming the current page; the
 *    current nav link gets aria-current="page"; footer year stays current.
 *
 * Fires `shell:ready` on document when header + footer are in place.
 */
(function () {
  'use strict';

  var doc = document;
  var PHONE = '919825744110';
  var scriptSrc = (doc.currentScript && doc.currentScript.src) || '';
  var ROOT = scriptSrc ? new URL('../', scriptSrc).href : '';

  window.EC = window.EC || {};
  window.EC.contact = {
    phone: '+91 98257 44110',
    tel: 'tel:+' + PHONE,
    whatsapp: function (message) {
      return 'https://wa.me/' + PHONE + (message ? '?text=' + encodeURIComponent(message) : '');
    }
  };

  /* ---------- 1. Partials ------------------------------------------------- */
  function templateFor(name) {
    return name === 'header' ? HEADER : name === 'footer' ? FOOTER : '';
  }

  function inject(el, html) {
    var tpl = doc.createElement('template');
    tpl.innerHTML = html;
    // drop the explanatory comments that head each partial file
    Array.prototype.slice.call(tpl.content.childNodes).forEach(function (n) {
      if (n.nodeType === 8) n.remove();
    });
    el.replaceWith(tpl.content);
  }

  function loadPartial(el) {
    var name = el.getAttribute('data-include');
    var fallback = templateFor(name);
    if (!ROOT || location.protocol === 'file:' || !window.fetch) {
      inject(el, fallback);
      return Promise.resolve();
    }
    return fetch(ROOT + 'partials/' + name + '.html', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) { inject(el, html); })
      .catch(function () { inject(el, fallback); });
  }

  /* ---------- 2. Header --------------------------------------------------- */
  function initHeader() {
    var header = doc.getElementById('site-header');
    if (!header) return;

    // (a) solid bar after leaving the very top: a 1px sentinel at y=8.
    var top = doc.createElement('div');
    top.setAttribute('aria-hidden', 'true');
    top.style.cssText = 'position:absolute;top:8px;left:0;width:1px;height:1px;pointer-events:none';
    doc.body.prepend(top);
    new IntersectionObserver(function (entries) {
      header.classList.toggle('is-scrolled', !entries[0].isIntersecting);
    }).observe(top);

    // (b) The header is always the dark glass variant. It used to invert to
    //     white over light sections; every band is now dark glass over the
    //     WebGL scene, so the flip is gone and data-theme is pinned.
    header.setAttribute('data-theme', 'dark');
  }

  /* ---------- 3. Mobile nav ---------------------------------------------- */
  function initNav() {
    var toggle = doc.querySelector('.nav-toggle');
    var drawer = doc.getElementById('nav-drawer');
    var header = doc.getElementById('site-header');
    if (!toggle || !drawer) return;

    function focusables() {
      return [toggle].concat(Array.prototype.slice.call(drawer.querySelectorAll('a[href], button:not([disabled])')));
    }
    function setOpen(open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      drawer.classList.toggle('is-open', open);
      doc.body.classList.toggle('nav-open', open);
      if (open) {
        var first = drawer.querySelector('a[href]');
        if (first) setTimeout(function () { first.focus(); }, 60);
      }
    }
    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    drawer.addEventListener('click', function (e) {
      if (e.target.closest('a[href]')) setOpen(false);
    });
    doc.addEventListener('keydown', function (e) {
      if (!drawer.classList.contains('is-open')) return;
      if (e.key === 'Escape') { setOpen(false); toggle.focus(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      var i = f.indexOf(doc.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    // Rotating to desktop width closes the drawer so it never gets stuck open.
    var mq = window.matchMedia('(min-width: 64em)');
    var onMq = function () { if (mq.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
  }

  /* ---------- 4. Bottom bar + WhatsApp ------------------------------------ */
  function initBottomBar() {
    var bar = doc.getElementById('bottom-bar');
    if (!bar) return;
    var footer = doc.querySelector('.site-footer');
    if (footer) new IntersectionObserver(function (e) {
      doc.body.classList.toggle('footer-in-view', e[0].isIntersecting);
    }, { rootMargin: '0px 0px -10% 0px' }).observe(footer);
    // Pages that are themselves the planner can opt out: <body data-no-bottombar>
    if (doc.body.hasAttribute('data-no-bottombar')) { bar.remove(); return; }
    var probe = doc.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:70vh;pointer-events:none';
    doc.body.prepend(probe);
    var pastHero = false, atFooter = false;
    function update() {
      var show = pastHero && !atFooter;
      bar.classList.toggle('is-visible', show);
      doc.body.classList.toggle('has-bottombar', show);
    }
    new IntersectionObserver(function (e) { pastHero = !e[0].isIntersecting; update(); }).observe(probe);
    // Footer carries the same actions; hide the bar there so they don't double up.
    if (footer) new IntersectionObserver(function (e) { atFooter = e[0].isIntersecting; update(); }, { rootMargin: '0px 0px -30% 0px' }).observe(footer);
  }

  function initWhatsApp() {
    var title = (doc.querySelector('h1') || {}).textContent || doc.title || '';
    title = title.replace(/\s+/g, ' ').trim().slice(0, 80);
    var msg = 'Hi Escape Cartel! I would like help planning a trip.' + (title ? ' (Seen on: ' + title + ')' : '');
    Array.prototype.forEach.call(doc.querySelectorAll('a[data-wa]'), function (a) {
      var custom = a.getAttribute('data-wa');
      a.href = window.EC.contact.whatsapp(custom || msg);
    });
  }

  /* ---------- 5. Small things -------------------------------------------- */
  function markCurrent() {
    // The server uses clean URLs (/trips) while nav links may say trips.html: compare page names.
    function pageName(path) { return (path.split('/').pop() || 'index').replace(/\.html$/, '') || 'index'; }
    var here = pageName(location.pathname);
    // Trip detail, itinerary and checkout belong to the Trips section of the nav.
    if (/^(trip|itinerary|checkout)$/.test(here)) here = 'trips';
    Array.prototype.forEach.call(doc.querySelectorAll('.site-nav a, .nav-drawer a, .site-footer__list a'), function (a) {
      var target = (a.getAttribute('href') || '').split(/[?#]/)[0];
      if (!target || /^[a-z]+:/i.test(target)) return; // tel:, https://wa.me, …
      if (pageName(target) === here) a.setAttribute('aria-current', 'page');
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-year]'), function (el) {
      el.textContent = String(new Date().getFullYear());
    });
    // Skip link needs a target; tolerate pages that forgot the id.
    var main = doc.querySelector('main');
    if (main && !doc.getElementById('main')) main.id = 'main';
    if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  }

  /* ---------- boot -------------------------------------------------------- */
  function boot() {
    var slots = Array.prototype.slice.call(doc.querySelectorAll('[data-include]'));
    Promise.all(slots.map(loadPartial)).then(function () {
      markCurrent();
      initHeader();
      initNav();
      initBottomBar();
      initWhatsApp();
      doc.documentElement.classList.add('shell-ready');
      doc.dispatchEvent(new CustomEvent('shell:ready'));
    });
    initStats();
  }

  /* ---------- visit statistics for the owner dashboard -------------------- */
  // One anonymous page view per page, plus WhatsApp / call / join clicks. No cookies, nothing personal:
  // the server counts a visitor by a daily hash (server/trips.js). Skipped for Do Not Track and file://.
  function initStats() {
    if (location.protocol.indexOf('http') !== 0 || navigator.doNotTrack === '1' || !navigator.sendBeacon) return;
    var send = function (type) {
      try {
        navigator.sendBeacon('/api/track', new Blob([JSON.stringify({ p: location.pathname + location.search, e: type, r: doc.referrer })], { type: 'application/json' }));
      } catch (e) { /* statistics must never break the page */ }
    };
    send('view');
    doc.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href], button');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (a.hasAttribute('data-wa') || /wa\.me\//.test(href)) send('whatsapp');
      else if (href.indexOf('tel:') === 0) send('call');
      else if (/\/checkout\?trip=/.test(href)) send('join');
    }, true);
  }

  /* ---------- fallback templates (generated copies of partials/*.html) ---- */
  var HEADER = /*@HEADER@*/"<!-- Shared header. Loaded by js/core.js into <div data-include=\"header\"></div>.\n     Static fallback: paste this markup directly at the top of <body> instead of\n     the placeholder; core.js enhances it the same way. Keep in sync with the\n     HEADER template inside js/core.js (used when fetch is unavailable, e.g. file://). -->\n<a class=\"skip-link\" href=\"#main\">Skip to content</a>\n<header class=\"site-header\" id=\"site-header\" data-theme=\"dark\">\n  <div class=\"container site-header__inner\">\n    <a class=\"brand\" href=\"index.html\" aria-label=\"Escape Cartel, home\">\n      <img class=\"brand__logo\" src=\"assets/images/logo/logo-white.png\" alt=\"Escape Cartel logo\" width=\"64\" height=\"64\" decoding=\"async\">\n    </a>\n    <nav class=\"site-nav\" aria-label=\"Main\">\n      <ul class=\"site-nav__list\" role=\"list\">\n        <li><a class=\"link-swap\" href=\"index.html\">Home</a></li>\n        <li><a class=\"link-swap\" href=\"trips.html\">Trips</a></li>\n        <li><a class=\"link-swap\" href=\"plan.html\">Plan my trip</a></li>\n        <li><a class=\"link-swap\" href=\"about.html\">About</a></li>\n        <li><a class=\"link-swap\" href=\"contact.html\">Contact</a></li>\n      </ul>\n    </nav>\n    <div class=\"site-header__actions\">\n      <!-- WhatsApp lives here below 1400px; the floating disc only shows where a free gutter exists (base.css 6e). -->\n      <a class=\"btn btn--icon btn--ghost btn--ripple header-wa\" data-wa href=\"https://wa.me/919825744110\" target=\"_blank\" rel=\"noopener\" aria-label=\"Chat with Escape Cartel on WhatsApp, 98257 44110\">\n        <svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M16 3.2A12.7 12.7 0 0 0 5.1 22.4L3.3 28.8l6.6-1.7A12.7 12.7 0 1 0 16 3.2Zm0 23.1c-1.9 0-3.8-.5-5.4-1.5l-.4-.2-3.9 1 1-3.8-.3-.4A10.5 10.5 0 1 1 16 26.3Zm5.8-7.9c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.6 8.6 0 0 1-4.3-3.7c-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.2 4.6 1.9.8 2.7.9 3.6.7.6-.1 1.9-.8 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.3Z\"/></svg>\n      </a>\n      <a class=\"btn btn--ghost btn--sm btn--ripple btn--icon-mobile\" href=\"tel:+919825744110\" aria-label=\"Call Escape Cartel on 98257 44110\">\n        <svg class=\"btn__icon\" viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\"><path d=\"M6.6 3.5h2.6l1.4 4-2 1.3a11 11 0 0 0 6.6 6.6l1.3-2 4 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/></svg>\n        <span class=\"header-call__label\">98257 44110</span>\n      </a>\n      <a class=\"btn btn--primary btn--sm btn--magnetic header-cta\" href=\"trips.html\"><span class=\"btn__label\">Browse trips</span></a>\n      <button class=\"nav-toggle\" type=\"button\" aria-expanded=\"false\" aria-controls=\"nav-drawer\" aria-label=\"Open menu\">\n        <span class=\"nav-toggle__bars\" aria-hidden=\"true\"></span>\n      </button>\n    </div>\n  </div>\n</header>\n<div class=\"nav-drawer\" id=\"nav-drawer\" data-theme=\"dark\">\n  <nav aria-label=\"Mobile\">\n    <ul class=\"nav-drawer__list\" role=\"list\">\n      <li><a href=\"index.html\">Home</a></li>\n      <li><a href=\"trips.html\">Trips</a></li>\n      <li><a href=\"plan.html\">Plan my trip</a></li>\n      <li><a href=\"about.html\">About</a></li>\n      <li><a href=\"contact.html\">Contact</a></li>\n    </ul>\n  </nav>\n  <div class=\"nav-drawer__foot\">\n    <a class=\"btn btn--liquid-fill btn--lg\" href=\"tel:+919825744110\"><span class=\"btn__label\">Call 98257 44110</span></a>\n    <a class=\"btn btn--primary btn--lg btn--ripple\" data-wa href=\"https://wa.me/919825744110\" target=\"_blank\" rel=\"noopener\"><span class=\"btn__label\">Chat on WhatsApp</span></a>\n  </div>\n</div>\n";
  var FOOTER = /*@FOOTER@*/"<!-- Shared footer + mobile bottom bar + floating WhatsApp.\n     Loaded by js/core.js into <div data-include=\"footer\"></div> (place it after </main>).\n     Static fallback: paste this markup there instead. Keep in sync with the\n     FOOTER template inside js/core.js. -->\n<footer class=\"site-footer\" data-theme=\"dark\">\n  <div class=\"container\">\n    <div class=\"site-footer__grid\">\n      <div class=\"site-footer__brand\">\n        <img src=\"assets/images/logo/logo-white.png\" alt=\"Escape Cartel\" width=\"120\" height=\"120\" loading=\"lazy\" decoding=\"async\">\n        <p>Student group trips from Manipal University Jaipur. Browse ready-made trips or plan a private trip for your group.</p>\n      </div>\n      <div>\n        <h2 class=\"site-footer__title\">Explore</h2>\n        <ul class=\"site-footer__list\" role=\"list\">\n          <li><a class=\"link-swap\" href=\"trips.html\">All trips</a></li>\n          <li><a class=\"link-swap\" href=\"plan.html\">Plan my trip</a></li>\n          <li><a class=\"link-swap\" href=\"about.html\">About us</a></li>\n          <li><a class=\"link-swap\" href=\"contact.html\">Contact</a></li>\n        </ul>\n      </div>\n      <div>\n        <h2 class=\"site-footer__title\">Talk to us</h2>\n        <ul class=\"site-footer__list\" role=\"list\">\n          <li><a class=\"link-swap\" href=\"tel:+919825744110\">Call 98257 44110</a></li>\n          <li><a class=\"link-swap\" data-wa href=\"https://wa.me/919825744110\" target=\"_blank\" rel=\"noopener\">WhatsApp 98257 44110</a></li>\n          <li><a class=\"link-swap\" href=\"privacy.html\">Privacy policy</a></li>\n          <li><a class=\"link-swap\" href=\"terms.html\">Terms &amp; cancellations</a></li>\n        </ul>\n        <!-- TODO(owner): add verified office details and social links when available. -->\n        <p class=\"site-footer__location\">Serving students at Manipal University Jaipur.</p>\n      </div>\n    </div>\n    <div class=\"site-footer__base\">\n      <p>© <span data-year>2026</span> Escape Cartel. All rights reserved.</p>\n      <p><a href=\"privacy.html\">Privacy policy</a> · <a href=\"terms.html\">Terms &amp; cancellations</a> · <a href=\"/admin/\">Owner login</a></p>\n      <p class=\"site-footer__demo\">Demo: trip dates, budgets, seats and payments are illustrative.</p>\n    </div>\n  </div>\n</footer>\n\n<div class=\"bottom-bar\" id=\"bottom-bar\" data-theme=\"dark\" role=\"region\" aria-label=\"Quick actions\">\n  <a class=\"btn btn--ghost btn--ripple bottom-bar__wa\" data-wa href=\"https://wa.me/919825744110\" target=\"_blank\" rel=\"noopener\" aria-label=\"Chat on WhatsApp, 98257 44110\">\n    <svg class=\"btn__icon\" viewBox=\"0 0 32 32\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M16 3.2A12.7 12.7 0 0 0 5.1 22.4L3.3 28.8l6.6-1.7A12.7 12.7 0 1 0 16 3.2Zm0 23.1c-1.9 0-3.8-.5-5.4-1.5l-.4-.2-3.9 1 1-3.8-.3-.4A10.5 10.5 0 1 1 16 26.3Zm5.8-7.9c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.6 8.6 0 0 1-4.3-3.7c-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.2 4.6 1.9.8 2.7.9 3.6.7.6-.1 1.9-.8 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.3Z\"/></svg>\n    <span class=\"btn__label\">WhatsApp</span>\n  </a>\n  <a class=\"btn btn--gooey\" href=\"/trips\"><span class=\"btn__label\">Browse trips</span></a>\n</div>\n\n<div class=\"wa-fab\">\n  <a class=\"btn btn--icon btn--fab btn--magnetic btn--ripple\" data-wa href=\"https://wa.me/919825744110\" target=\"_blank\" rel=\"noopener\" aria-label=\"Chat with Escape Cartel on WhatsApp\">\n    <span class=\"btn__label\">\n      <svg viewBox=\"0 0 32 32\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M16 3.2A12.7 12.7 0 0 0 5.1 22.4L3.3 28.8l6.6-1.7A12.7 12.7 0 1 0 16 3.2Zm0 23.1c-1.9 0-3.8-.5-5.4-1.5l-.4-.2-3.9 1 1-3.8-.3-.4A10.5 10.5 0 1 1 16 26.3Zm5.8-7.9c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.6 8.6 0 0 1-4.3-3.7c-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.3 5.2 4.6 1.9.8 2.7.9 3.6.7.6-.1 1.9-.8 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.3Z\"/></svg>\n    </span>\n  </a>\n</div>\n";

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
