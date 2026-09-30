/**
 * Escape Cartel — supporting FX layer loader (every page, after core.js).
 *
 *   <link rel="stylesheet" href="css/fx.css">        in <head> (also opts pages
 *                                                     into cross-page view transitions)
 *   <script type="module" src="js/fx.js"></script>   before </body>
 *
 * What it adds (the home hero's own Three.js scene is NOT touched: sections
 * that contain their own <canvas>, or data-fx="none", stay clear):
 *   - "Route dust": one fixed WebGL canvas of particles blended with
 *     mix-blend-mode: difference, so it is white on ink and black on chalk:
 *     never a new colour. The particles reshape per section as you scroll
 *     (globe, water, emblem ring, route line, drift), with bloom, velocity
 *     distortion, a liquid seam where dark and light sections meet and a
 *     short glitch when you cross into a new section.  -> js/fx-field.js
 *   - Page-to-page ink-drop transition via CSS view transitions (css/fx.css).
 *
 * Tiers
 *   gl    WebGL available, motion allowed, not Save-Data -> full field (lazy, after load + idle)
 *   lite  no WebGL / low memory / Save-Data / WebGL fails -> CSS dust layer, still transitions
 *   off   prefers-reduced-motion, ?fx=off, or <html data-fx="off"> -> nothing moves
 *
 * Per section: data-fx="globe|wave|ring|route|drift" opts a section IN (default: off);
 * data-fx-side="left" anchors a globe/ring/route to the left edge instead of the right.
 * Debug: window.EC.fx.pulse() fires the glitch; EC.fx.tier tells which tier runs.
 */
(function boot() {
  const doc = document;
  const html = doc.documentElement;
  const params = new URLSearchParams(location.search);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  window.EC = window.EC || {};
  const api = (window.EC.fx = { tier: 'off', pulse() {}, destroy() {} });

  const conn = navigator.connection || {};
  // Phones/tablets, Save-Data and reduced motion never download three.js.
  const desktop = matchMedia('(min-width: 1024px)').matches;

  if (params.get('fx') === 'off' || html.dataset.fx === 'off' || reduce.matches || !desktop || conn.saveData) {
    html.classList.add('fx-off');
    return;
  }

  const lowEnd = conn.saveData || (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);

  function hasWebGL() {
    try {
      const c = doc.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return false;
      gl.getExtension('WEBGL_lose_context')?.loseContext(); // free the probe context now
      return true;
    } catch {
      return false;
    }
  }

  function lite() {
    api.tier = 'lite';
    html.classList.remove('fx-gl');
    html.classList.add('fx-lite');
    if (!doc.querySelector('.fx-dust')) {
      const dust = doc.createElement('div');
      dust.className = 'fx-dust';
      dust.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(dust);
    }
  }

  // Opt-in only. The layer draws ABOVE content (mix-blend difference), so on
  // text-heavy sections it smeared speckles over copy, cards and the footer.
  // It now runs only when a section explicitly asks for it with
  // data-fx="globe|wave|ring|route|drift". No opt-in: no canvas, no CSS dust.
  // (Page-to-page view transitions in fx.css are unaffected.)
  const optedIn = doc.querySelector('main [data-fx]:not([data-fx="none"])');
  if (!optedIn) { html.classList.add('fx-off'); return; }

  if (lowEnd || !hasWebGL()) { lite(); return; }

  // Full tier: wait for load + an idle slot so the field never competes with
  // the hero, fonts or first input.
  const start = async () => {
    if (reduce.matches) return;
    try {
      const { initField } = await import('./fx-field.js');
      const field = initField({ onFail: lite });
      if (!field) { lite(); return; }
      api.tier = 'gl';
      html.classList.add('fx-gl');
      api.pulse = field.pulse;
      api.destroy = field.destroy;
    } catch (err) {
      lite();
    }
  };
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 250));
  const go = () => idle(start, { timeout: 1500 });
  if (doc.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });

  // Turning reduced motion on mid-session stops everything.
  reduce.addEventListener?.('change', () => {
    if (reduce.matches) { api.destroy(); doc.querySelector('.fx-dust')?.remove(); html.classList.add('fx-off'); }
  });
})();
