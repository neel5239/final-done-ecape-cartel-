/**
 * Escape Cartel — liquid button behaviour (pairs with css/buttons.css).
 *
 * Plain script, no dependencies, safe to load with `defer` on every page.
 * Everything is progressive enhancement: without this file every button
 * still works and looks finished (solid pill, underlined link, filled chip).
 *
 * What it does
 *   - press hold      .is-pressed on pointer-down/Enter/Space, held >= 250ms so taps are visible
 *   - 01 gooey        injects the SVG goo filter + droplets, replays the splash on hover/tap
 *   - 03 magnetic     pointer pull + elastic spring settle (fine pointers only)
 *   - 04 ripple       ink ripple from the exact touch/click point
 *   - 05 submit       EC.buttons.setState(btn, 'loading'|'success'|'error'|'idle')
 *   - 06 trace        injects the SVG ring used by .badge--trace / .btn--trace
 *   - 07 link swap    splits link text into letters for the staggered roll
 *   - 09 blob cursor  one follower for [data-cursor="Label"] areas (fine pointers only)
 *   - 10 chips        moves the liquid bead in .chips--liquid radio groups
 *   - heart           toggles aria-pressed, bursts, emits `heart:toggle` {id, pressed}
 *
 * New markup added later (header partial, rendered trip cards) is enhanced
 * automatically through a MutationObserver, or call EC.buttons.enhance(el).
 * Respects prefers-reduced-motion live (switching it off/on mid-session).
 */
(function () {
  'use strict';

  var doc = document;
  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var mqFine = window.matchMedia('(hover: hover) and (pointer: fine)');
  var reduced = function () { return mqReduce.matches; };
  var PRESS_MIN = 250; // ms a tap stays visibly "pressed"

  /* ---------- helpers ---------------------------------------------------- */
  function qsa(root, sel) {
    var list = root.querySelectorAll ? Array.prototype.slice.call(root.querySelectorAll(sel)) : [];
    if (root.matches && root.matches(sel)) list.unshift(root);
    return list;
  }
  function once(el, key) {
    if (el.dataset[key]) return false;
    el.dataset[key] = '1';
    return true;
  }
  function restartClass(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the CSS animation plays again
    el.classList.add(cls);
  }
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---------- 01 gooey: shared SVG filter -------------------------------- */
  // Blur melts shapes together; the alpha matrix (x18, -7) snaps the blurred
  // edge back to a crisp line, which reads as surface tension.
  function ensureGooFilter() {
    if (doc.getElementById('ec-goo')) return;
    var svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML =
      '<defs><filter id="ec-goo" x="-50%" y="-100%" width="200%" height="300%" color-interpolation-filters="sRGB">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur"/>' +
      '<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo"/>' +
      '<feComposite in="SourceGraphic" in2="goo" operator="atop"/>' +
      '</filter></defs>';
    doc.body.appendChild(svg);
  }

  function enhanceGooey(root) {
    qsa(root, '.btn--gooey').forEach(function (btn) {
      if (!once(btn, 'ecGoo')) return;
      ensureGooFilter();
      var goo = doc.createElement('span');
      goo.className = 'btn__goo';
      goo.setAttribute('aria-hidden', 'true');
      goo.innerHTML = '<i></i><i></i><i></i><i></i>';
      btn.insertBefore(goo, btn.firstChild);
      btn.classList.add('is-goo');
      var splash = function () { if (!reduced()) restartClass(btn, 'is-splash'); };
      btn.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') splash(); });
      btn.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') splash(); });
      goo.lastChild.addEventListener('animationend', function () { btn.classList.remove('is-splash'); });
    });
  }

  /* ---------- 06 trace ring ---------------------------------------------- */
  function enhanceTrace(root) {
    qsa(root, '.badge--trace, .btn--trace').forEach(function (el) {
      if (!once(el, 'ecTrace')) return;
      var svg = doc.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'trace-ring');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.appendChild(doc.createElementNS(SVG_NS, 'rect'));
      el.appendChild(svg);
    });
  }

  /* ---------- 07 link swap ------------------------------------------------ */
  function enhanceLinkSwap(root) {
    qsa(root, '.link-swap').forEach(function (link) {
      if (!once(link, 'ecSplit')) return;
      // First non-empty text node carries the label; icons are left untouched.
      var node = null;
      for (var i = 0; i < link.childNodes.length; i++) {
        var n = link.childNodes[i];
        if (n.nodeType === 3 && n.textContent.trim()) { node = n; break; }
      }
      if (!node) return;
      var text = node.textContent.trim();
      var sr = doc.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = text;
      var wrap = doc.createElement('span');
      wrap.className = 'link-swap__text';
      wrap.setAttribute('aria-hidden', 'true');
      Array.prototype.forEach.call(text, function (ch, idx) {
        var letter = doc.createElement('span');
        var track = doc.createElement('span');
        var original = doc.createElement('span');
        var clone = doc.createElement('span');
        letter.className = 'link-swap__letter';
        track.className = 'link-swap__track';
        original.textContent = clone.textContent = ch;
        track.style.setProperty('--i', String(idx));
        track.append(original, clone);
        letter.appendChild(track);
        wrap.appendChild(letter);
      });
      link.replaceChild(wrap, node);
      link.insertBefore(sr, wrap);
      link.classList.add('is-split');
    });
  }

  /* ---------- 05 submit morph -------------------------------------------- */
  function enhanceSubmit(root) {
    qsa(root, '.btn--submit').forEach(function (btn) {
      if (!once(btn, 'ecSubmit')) return;
      if (!btn.querySelector('.btn__label')) {
        var label = doc.createElement('span');
        label.className = 'btn__label';
        while (btn.firstChild) label.appendChild(btn.firstChild);
        btn.appendChild(label);
      }
      var dots = doc.createElement('span');
      dots.className = 'btn__dots';
      dots.setAttribute('aria-hidden', 'true');
      dots.innerHTML = '<span><i></i><i></i><i></i></span>';
      var tick = doc.createElement('span');
      tick.className = 'btn__tick';
      tick.setAttribute('aria-hidden', 'true');
      tick.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      btn.appendChild(dots);
      btn.appendChild(tick);
      // Polite live region beside the button so the state change is announced.
      var live = doc.createElement('span');
      live.className = 'sr-only';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      btn.insertAdjacentElement('afterend', live);
      btn._ecLive = live;
    });
  }

  var STATE_TEXT = { loading: 'Sending…', success: 'Sent', error: 'Something went wrong. Please try again.', idle: '' };
  function setState(btn, state) {
    if (!btn) return;
    enhanceSubmit(btn);
    state = state || 'idle';
    if (state === 'idle') btn.removeAttribute('data-state');
    else btn.setAttribute('data-state', state);
    btn.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    if (btn._ecLive) {
      btn._ecLive.textContent = btn.getAttribute('data-' + state + '-text') || STATE_TEXT[state] || '';
    }
    clearTimeout(btn._ecReset);
    if (state === 'error') {
      btn._ecReset = setTimeout(function () { setState(btn, 'idle'); }, 700);
    } else if (state === 'success' && btn.hasAttribute('data-reset')) {
      btn._ecReset = setTimeout(function () { setState(btn, 'idle'); }, Number(btn.getAttribute('data-reset')) || 2400);
    }
  }

  /* ---------- 10 liquid chips -------------------------------------------- */
  function placeBead(group, animate) {
    var bead = group._ecBead;
    if (!bead) return;
    var input = group.querySelector('input:checked');
    var W = group.scrollWidth, H = group.scrollHeight;
    bead.style.width = W + 'px';
    bead.style.height = H + 'px';
    var target;
    if (input) {
      var chip = input.closest('.chip') || input.parentElement;
      target = { l: chip.offsetLeft, r: W - chip.offsetLeft - chip.offsetWidth, t: chip.offsetTop, b: H - chip.offsetTop - chip.offsetHeight };
    } else {
      target = { l: 0, r: W, t: 0, b: H };
    }
    var apply = function (box, dur) {
      bead.style.setProperty('--bead-dur', dur + 'ms');
      bead.style.setProperty('--bl', box.l + 'px');
      bead.style.setProperty('--br', box.r + 'px');
      bead.style.setProperty('--bt', box.t + 'px');
      bead.style.setProperty('--bb', box.b + 'px');
    };
    clearTimeout(group._ecBeadT);
    var prev = group._ecBox;
    if (!animate || !prev || !input || reduced()) {
      apply(target, 0);
    } else {
      // Stretch: first span both chips (the drop reaches out), then let the
      // trailing edge catch up. Two short steps read as one viscous motion.
      apply({ l: Math.min(prev.l, target.l), r: Math.min(prev.r, target.r), t: Math.min(prev.t, target.t), b: Math.min(prev.b, target.b) }, 200);
      group._ecBeadT = setTimeout(function () { apply(target, 420); }, 170);
      // keep the chosen chip in view inside a sideways-scrolling row
      var c = input.closest('.chip');
      if (c && group.scrollWidth > group.clientWidth) {
        var left = c.offsetLeft - (group.clientWidth - c.offsetWidth) / 2;
        group.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
      }
    }
    group._ecBox = target;
  }

  var chipResize = 'ResizeObserver' in window
    ? new ResizeObserver(function (entries) { entries.forEach(function (e) { placeBead(e.target, false); }); })
    : null;

  function enhanceChips(root) {
    qsa(root, '.chips--liquid').forEach(function (group) {
      if (!once(group, 'ecChips')) return;
      var bead = doc.createElement('span');
      bead.className = 'chips__bead';
      bead.setAttribute('aria-hidden', 'true');
      group.insertBefore(bead, group.firstChild);
      group._ecBead = bead;
      group.addEventListener('change', function () { placeBead(group, true); });
      placeBead(group, false);
      group.classList.add('is-live');
      if (chipResize) chipResize.observe(group);
      // fonts change chip widths once they swap in
      if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { placeBead(group, false); });
    });
  }

  /* ---------- 03 magnetic ------------------------------------------------- */
  // A tiny damped spring instead of a tween: following feels sticky, and on
  // leave it overshoots once and settles (the "elastic fluid" of buttons.md).
  function enhanceMagnetic(root) {
    qsa(root, '.btn--magnetic').forEach(function (btn) {
      if (!once(btn, 'ecMagnet')) return;
      var s = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, k: 0.2, d: 0.7, raf: 0 };
      var label = btn.querySelector('.btn__label');
      var strength = Number(btn.getAttribute('data-magnet')) || 0.35;

      function frame() {
        s.vx = (s.vx + (s.tx - s.x) * s.k) * s.d;
        s.vy = (s.vy + (s.ty - s.y) * s.k) * s.d;
        s.x += s.vx; s.y += s.vy;
        btn.style.translate = s.x.toFixed(2) + 'px ' + s.y.toFixed(2) + 'px';
        if (label) {
          label.style.setProperty('--mx', (s.x * 0.45).toFixed(2) + 'px');
          label.style.setProperty('--my', (s.y * 0.45).toFixed(2) + 'px');
        }
        var moving = Math.abs(s.vx) + Math.abs(s.vy) + Math.abs(s.tx - s.x) + Math.abs(s.ty - s.y) > 0.05;
        s.raf = moving ? requestAnimationFrame(frame) : 0;
        if (!moving && s.tx === 0 && s.ty === 0) btn.style.translate = '';
      }
      function kick() { if (!s.raf) s.raf = requestAnimationFrame(frame); }

      btn.addEventListener('pointermove', function (e) {
        if (e.pointerType !== 'mouse' || reduced() || !mqFine.matches) return;
        var r = btn.getBoundingClientRect();
        // subtract our own offset so the pull is measured from the resting spot
        s.tx = (e.clientX - (r.left - s.x + r.width / 2)) * strength;
        s.ty = (e.clientY - (r.top - s.y + r.height / 2)) * strength;
        s.k = 0.2; s.d = 0.7;
        kick();
      });
      btn.addEventListener('pointerleave', function () {
        s.tx = 0; s.ty = 0;
        s.k = 0.12; s.d = 0.82; // looser spring on release = one soft overshoot
        kick();
      });
    });
  }

  /* ---------- 09 blob cursor ---------------------------------------------- */
  var blob = null;
  function initCursor() {
    if (blob || !mqFine.matches || reduced() || !doc.querySelector('[data-cursor]')) return;
    blob = doc.createElement('div');
    blob.className = 'cursor-blob';
    blob.setAttribute('aria-hidden', 'true');
    blob.innerHTML = '<span class="cursor-blob__label"></span>';
    doc.body.appendChild(blob);
    var label = blob.firstChild;
    var p = { x: -100, y: -100, tx: -100, ty: -100, s: 0.2, ts: 0.2, raf: 0 };

    function frame() {
      // lerp: 0.18 gives the jelly lag without feeling detached
      p.x += (p.tx - p.x) * 0.18;
      p.y += (p.ty - p.y) * 0.18;
      p.s += (p.ts - p.s) * 0.16;
      blob.style.transform = 'translate3d(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px,0) scale(' + p.s.toFixed(3) + ')';
      var busy = Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) + Math.abs(p.ts - p.s) > 0.1;
      p.raf = busy ? requestAnimationFrame(frame) : 0;
    }
    doc.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      p.tx = e.clientX; p.ty = e.clientY;
      var target = e.target.closest && e.target.closest('[data-cursor]');
      if (target && !reduced()) {
        label.textContent = target.getAttribute('data-cursor');
        p.ts = 1;
        if (!blob.classList.contains('is-on')) { p.x = p.tx; p.y = p.ty; blob.classList.add('is-on'); }
      } else {
        p.ts = 0.2;
        blob.classList.remove('is-on');
      }
      if (!p.raf) p.raf = requestAnimationFrame(frame);
    }, { passive: true });
    doc.addEventListener('pointerleave', function () { blob.classList.remove('is-on'); });
  }

  /* ---------- delegated: press hold, ripple, heart ------------------------ */
  var PRESSABLE = '.btn, .link-swap, .chip, .btn-heart';

  function press(el) {
    el._ecPressAt = Date.now();
    el.classList.add('is-pressed');
  }
  function release(el) {
    if (!el || !el.classList.contains('is-pressed')) return;
    var wait = Math.max(0, PRESS_MIN - (Date.now() - (el._ecPressAt || 0)));
    setTimeout(function () { el.classList.remove('is-pressed'); }, wait);
  }

  function ripple(btn, x, y) {
    if (reduced()) return;
    var r = btn.getBoundingClientRect();
    var px = x - r.left, py = y - r.top;
    var size = 2 * Math.hypot(Math.max(px, r.width - px), Math.max(py, r.height - py));
    var dot = doc.createElement('span');
    dot.className = 'btn__ripple';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.setProperty('--rx', px + 'px');
    dot.style.setProperty('--ry', py + 'px');
    dot.style.setProperty('--rs', size + 'px');
    btn.appendChild(dot);
    dot.addEventListener('animationend', function () { dot.remove(); });
    setTimeout(function () { if (dot.isConnected) dot.remove(); }, 1200); // safety
  }

  var pressed = null;
  doc.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    var el = e.target.closest && e.target.closest(PRESSABLE);
    if (!el) return;
    pressed = el;
    press(el);
    if (el.classList.contains('btn--ripple')) ripple(el, e.clientX, e.clientY);
  }, { passive: true });
  ['pointerup', 'pointercancel', 'dragstart'].forEach(function (type) {
    doc.addEventListener(type, function () { release(pressed); pressed = null; }, { passive: true });
  });

  // Keyboard users get the same press + ripple (from the centre).
  doc.addEventListener('keydown', function (e) {
    if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    var el = e.target.closest && e.target.closest('.btn, .link-swap, .btn-heart');
    if (!el) return;
    press(el);
    if (el.classList.contains('btn--ripple')) {
      var r = el.getBoundingClientRect();
      ripple(el, r.left + r.width / 2, r.top + r.height / 2);
    }
  });
  doc.addEventListener('keyup', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest && e.target.closest('.btn, .link-swap, .btn-heart');
    release(el);
  });

  // Heart: aria-pressed is the single source of truth. Pages listen for
  // `heart:toggle` (e.g. to call store.toggleWishlist). Add data-heart-manual
  // to take over state yourself; the pop still plays via EC.buttons.heart().
  function heart(btn, on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on && !reduced()) {
      restartClass(btn, 'is-burst');
      setTimeout(function () { btn.classList.remove('is-burst'); }, 600);
    }
  }
  doc.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.btn-heart');
    if (!btn || btn.hasAttribute('data-heart-manual')) return;
    var on = btn.getAttribute('aria-pressed') !== 'true';
    heart(btn, on);
    btn.dispatchEvent(new CustomEvent('heart:toggle', {
      bubbles: true,
      detail: { id: btn.getAttribute('data-wishlist-id') || '', pressed: on }
    }));
  });

  /* ---------- enhance + observe ------------------------------------------- */
  function enhance(root) {
    root = root || doc;
    enhanceGooey(root);
    enhanceTrace(root);
    enhanceLinkSwap(root);
    enhanceSubmit(root);
    enhanceChips(root);
    enhanceMagnetic(root);
    initCursor();
  }

  var queued = [];
  var scheduled = false;
  var mo = new MutationObserver(function (records) {
    records.forEach(function (r) {
      r.addedNodes.forEach(function (n) { if (n.nodeType === 1) queued.push(n); });
    });
    if (queued.length && !scheduled) {
      scheduled = true;
      requestAnimationFrame(function () {
        var nodes = queued; queued = []; scheduled = false;
        nodes.forEach(function (n) { if (n.isConnected) enhance(n); });
      });
    }
  });

  function start() {
    enhance(doc);
    mo.observe(doc.body, { childList: true, subtree: true });
  }

  window.EC = window.EC || {};
  window.EC.buttons = { enhance: enhance, setState: setState, heart: heart };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})();
