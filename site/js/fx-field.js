/**
 * "Route dust": the supporting WebGL layer (loaded lazily by js/fx.js).
 *
 * One fixed, pointer-transparent canvas above the content with
 * mix-blend-mode: difference. It renders white on pure black, so black is
 * "no change" and white inverts whatever is beneath: the particles read as
 * chalk on ink sections and as ink on chalk sections. No hue ever appears.
 *
 * Pipeline per frame (all custom shaders, only three.module is needed):
 *   1. particles -> rtScene            (additive points, morphing formations)
 *   2. rtScene -> rtA -> rtB            (quarter-res separable blur = bloom)
 *   3. composite -> screen              (bloom add, scroll-velocity ripple,
 *                                        liquid seams at dark/light section
 *                                        boundaries, row-slice glitch, grain)
 *
 * Scroll drives the 3D: each <main> section owns a formation; through the last
 * third of a section the particles fly (staggered, curved paths) into the next
 * section's formation, and the whole cloud turns with scroll. This is
 * scroll-LINKED motion, not a scrubbed video: everything stays live and
 * time-animated, scroll only steers it.
 *
 * Performance: DPR capped (1.5 desktop / 1 phone), particle count by device,
 * bloom at quarter resolution, 30 fps when nothing is moving, loop stopped when
 * the tab is hidden or only "none" sections (the home hero) are on screen, and
 * an adaptive governor drops resolution, then bloom, if frames run long.
 */
import * as THREE from '../vendor/three/three.module.min.js';

/* ---------- seeded random ---------------------------------------------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { return (r() + r() + r() - 1.5) / 1.5; } // cheap ~normal in -1..1

/* ---------- formations (local space, roughly radius 2) ------------------
   Each returns Float32Array(n*3). The travel metaphor: dust of the route
   gathers into a globe (where), water (backwaters, coast), the emblem ring
   (who: Escape Cartel) and a route line with stops (how). */
const FORMS = {
  drift(n, r) {
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (r() - 0.5) * 9;
      p[i * 3 + 1] = (r() - 0.5) * 6;
      p[i * 3 + 2] = (r() - 0.5) * 5 - 1;
    }
    return p;
  },
  globe(n, r) {
    const p = new Float32Array(n * 3);
    const R = 1.55;
    const shell = Math.floor(n * 0.62);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      let x, y, z;
      if (i < shell) { // fibonacci sphere
        y = 1 - (i / (shell - 1)) * 2;
        const rad = Math.sqrt(1 - y * y);
        const th = golden * i;
        x = Math.cos(th) * rad; z = Math.sin(th) * rad;
      } else if (i % 2) { // parallels
        const lat = (Math.floor(r() * 5) - 2) * 0.45;
        const th = r() * Math.PI * 2;
        x = Math.cos(th) * Math.cos(lat); z = Math.sin(th) * Math.cos(lat); y = Math.sin(lat);
      } else { // meridians
        const lon = Math.floor(r() * 6) * (Math.PI / 6);
        const ph = r() * Math.PI * 2;
        x = Math.cos(lon) * Math.cos(ph); z = Math.sin(lon) * Math.cos(ph); y = Math.sin(ph);
      }
      const k = R * (1 + gauss(r) * 0.012);
      p[i * 3] = x * k; p[i * 3 + 1] = y * k; p[i * 3 + 2] = z * k;
    }
    return p;
  },
  wave(n, r) {
    const p = new Float32Array(n * 3);
    const cols = Math.ceil(Math.sqrt(n * 1.8));
    const rows = Math.ceil(n / cols);
    const tilt = 1.25;
    for (let i = 0; i < n; i++) {
      const cx = (i % cols) / (cols - 1) - 0.5;
      const cz = Math.floor(i / cols) / (rows - 1) - 0.5;
      const x = cx * 9 + (r() - 0.5) * 0.02;
      const z = cz * 3.2;
      // tilt the sheet towards the camera so it reads as a surface
      p[i * 3] = x;
      p[i * 3 + 1] = -Math.sin(tilt) * z;
      p[i * 3 + 2] = Math.cos(tilt) * z;
    }
    return p;
  },
  ring(n, r) {
    // echoes the round emblem: a crisp ring, a thinner inner ring, a halo
    const p = new Float32Array(n * 3);
    const tilt = 1.12;
    for (let i = 0; i < n; i++) {
      const th = r() * Math.PI * 2;
      const pick = r();
      let rad, thick;
      if (pick < 0.55) { rad = 1.75; thick = 0.035; }
      else if (pick < 0.78) { rad = 1.32; thick = 0.02; }
      else { rad = 1.75 + gauss(r) * 0.55; thick = 0.25; }
      const x = Math.cos(th) * rad + gauss(r) * thick;
      const y = Math.sin(th) * rad + gauss(r) * thick;
      const z = gauss(r) * thick;
      p[i * 3] = x;
      p[i * 3 + 1] = y * Math.cos(tilt) - z * Math.sin(tilt);
      p[i * 3 + 2] = y * Math.sin(tilt) + z * Math.cos(tilt);
    }
    return p;
  },
  route(n, r) {
    const pts = [[-2.4, -1.1, 0.2], [-1.4, 0.2, -0.6], [-0.4, -0.5, 0.5], [0.5, 0.7, -0.2], [1.3, -0.2, 0.6], [2.2, 0.9, -0.3], [2.6, 1.6, 0.4]]
      .map((a) => new THREE.Vector3(...a));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const p = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      if (r() < 0.86) { // the line itself, dense and thin
        curve.getPoint(r(), v);
        v.x += gauss(r) * 0.012; v.y += gauss(r) * 0.012; v.z += gauss(r) * 0.012;
      } else { // stops: small clusters at the waypoints
        v.copy(pts[1 + Math.floor(r() * 5)]);
        const th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1), rr = 0.11 + gauss(r) * 0.006; // hollow stop rings
        v.x += rr * Math.sin(ph) * Math.cos(th); v.y += rr * Math.cos(ph); v.z += rr * Math.sin(ph) * Math.sin(th);
      }
      p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z;
    }
    return p;
  },
};
FORMS.none = FORMS.drift;

// alpha: visibility; wave: water motion; side: anchored half off a viewport
// edge (rises from the edge, keeps the reading column clear); sparse: share of
// particles hidden (0 = all shown); low: sits as a horizon band at the bottom.
const FORM_CFG = {
  none: { alpha: 0, wave: 0, side: false, scale: 1, sparse: 1 },
  drift: { alpha: 0.4, wave: 0, side: false, scale: 1, sparse: 0.78 },
  globe: { alpha: 0.85, wave: 0, side: true, scale: 1.3, sparse: 0 },
  wave: { alpha: 0.6, wave: 1, side: false, scale: 1, sparse: 0.25, low: true },
  ring: { alpha: 0.9, wave: 0, side: true, scale: 1.3, sparse: 0 },
  route: { alpha: 0.85, wave: 0, side: true, scale: 1.15, sparse: 0 },
};
const CYCLE = ['drift', 'globe', 'wave', 'ring', 'route'];

/* ---------- shaders ------------------------------------------------------ */
const PARTICLE_VS = /* glsl */ `
  attribute vec3 aTo;
  attribute vec4 aRand;
  uniform float uMix, uTime, uVel, uDpr, uSize, uAspect;
  uniform float uWaveFrom, uWaveTo, uAlphaFrom, uAlphaTo, uScaleFrom, uScaleTo, uSparseFrom, uSparseTo;
  uniform vec3 uOffFrom, uOffTo;
  uniform float uAngle, uTilt;
  uniform vec2 uPointer;
  varying float vAlpha;

  vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
  vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }

  void main() {
    // staggered morph: each particle leaves at its own moment
    float m = clamp(uMix * 1.45 - aRand.x * 0.45, 0.0, 1.0);
    m = m * m * (3.0 - 2.0 * m);
    float flight = sin(m * 3.14159);

    vec3 a = position * uScaleFrom;
    vec3 b = aTo * uScaleTo;
    vec3 p = mix(a, b, m);
    // curved flight path between formations
    p += (aRand.yzw - 0.5) * vec3(2.6, 2.0, 2.6) * flight;

    // water surface for the wave formation
    float w = mix(uWaveFrom, uWaveTo, m);
    p.y += w * (sin(p.x * 1.4 + uTime * 1.1) * 0.22 + sin(p.z * 2.1 - uTime * 0.8 + p.x * 0.5) * 0.14);

    // idle shimmer + scroll-velocity scatter
    p += (aRand.wxy - 0.5) * 0.05 * sin(uTime * (0.6 + aRand.z) + aRand.x * 6.28);
    p += normalize(aRand.xyz - 0.5 + 0.001) * min(abs(uVel), 1.5) * 0.35 * (0.4 + aRand.y);

    p = rotX(rotY(p, uAngle * (1.0 - w)), uTilt * (1.0 - w * 0.7)); // water stays level
    p += mix(uOffFrom, uOffTo, m);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // pointer pushes the dust aside (screen space)
    vec2 ndc = gl_Position.xy / gl_Position.w;
    vec2 d = ndc - uPointer; d.x *= uAspect;
    float r = length(d);
    float push = (1.0 - smoothstep(0.0, 0.28, r)) * 0.09;
    vec2 dir = r > 0.0001 ? d / r : vec2(0.0);
    gl_Position.xy += vec2(dir.x / uAspect, dir.y) * push * gl_Position.w;

    gl_PointSize = uSize * (0.55 + aRand.w * 1.1) * uDpr * (9.0 / -mv.z);
    float twinkle = 0.65 + 0.35 * sin(uTime * (1.3 + aRand.y * 2.0) + aRand.z * 12.0);
    float keep = mix(step(uSparseFrom, aRand.z), step(uSparseTo, aRand.z), m);
    vAlpha = keep * mix(uAlphaFrom, uAlphaTo, m) * twinkle * (0.35 + 0.65 * aRand.y) * (1.0 + flight * 0.6);
  }
`;
const PARTICLE_FS = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(1.0), a * a * vAlpha);
  }
`;
const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const BLUR_FS = /* glsl */ `
  uniform sampler2D tMap; uniform vec2 uDir; varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tMap, vUv) * 0.2270270270;
    c += texture2D(tMap, vUv + uDir * 1.3846153846) * 0.3162162162;
    c += texture2D(tMap, vUv - uDir * 1.3846153846) * 0.3162162162;
    c += texture2D(tMap, vUv + uDir * 3.2307692308) * 0.0702702703;
    c += texture2D(tMap, vUv - uDir * 3.2307692308) * 0.0702702703;
    gl_FragColor = c;
  }
`;
const COMPOSITE_FS = /* glsl */ `
  uniform sampler2D tScene, tBloom;
  uniform vec2 uRes, uSeam;
  uniform float uTime, uVel, uGlitch, uBloom, uGrain;
  varying vec2 vUv;

  float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  float seam(inout vec2 uv, float s, float k) {
    if (s < 0.0) return 0.0;
    float dy = (uv.y - s) * uRes.y;                 // pixels from the boundary
    float band = exp(-dy * dy / 1800.0);            // ~40px liquid band
    uv.x += sin(uv.x * 26.0 - uTime * 2.2 + k) * band * 0.0035;
    uv.y += sin(uv.x * 14.0 + uTime * 1.6 + k) * band * 0.0025;
    float dash = step(0.45, fract(uv.x * uRes.x / 16.0 - uTime * 0.6 + k));
    return exp(-dy * dy / 1.6) * dash * 0.55;       // animated dashed hairline
  }

  void main() {
    vec2 uv = vUv;
    // scroll velocity: the whole layer ripples like heat over a road
    uv.x += sin(uv.y * 16.0 + uTime * 4.0) * uVel * 0.006;
    uv.y += sin(uv.x * 9.0 - uTime * 3.0) * uVel * 0.003;

    float line = seam(uv, uSeam.x, 0.0) + seam(uv, uSeam.y, 1.7);

    // glitch: row slices jump sideways; rare slabs flip (difference = page inverts there)
    float row = floor(uv.y * 30.0);
    float tq = floor(uTime * 24.0);
    float g = h(vec2(row, tq));
    float slab = 0.0;
    if (g < uGlitch * 0.55) {
      uv.x += (h(vec2(tq, row)) - 0.5) * 0.14 * uGlitch;
      if (uGlitch > 0.55 && g < 0.05) slab = 0.85 * uGlitch;
    }

    float c = texture2D(tScene, uv).r + texture2D(tBloom, uv).r * uBloom;
    c += line + slab;
    c += (h(vUv * uRes + fract(uTime * 7.0) * 91.0) - 0.5) * uGrain;
    gl_FragColor = vec4(vec3(clamp(c, 0.0, 1.0)), 1.0);
  }
`;

/* ---------- main --------------------------------------------------------- */
export function initField({ onFail } = {}) {
  const doc = document;
  const phone = matchMedia('(max-width: 47.99em)').matches || matchMedia('(pointer: coarse)').matches;
  const COUNT = phone ? 3200 : (navigator.hardwareConcurrency || 4) >= 8 ? 9000 : 6000;
  const DPR_MAX = phone ? 1 : 1.5;

  const canvas = doc.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power', stencil: false, depth: false, preserveDrawingBuffer: false });
  } catch {
    return null;
  }
  doc.body.appendChild(canvas);
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = true;

  /* sections -> formations */
  const main = doc.querySelector('main') || doc.body;
  const sections = [...main.querySelectorAll(':scope > section, :scope > div > section')].filter((s) => s.offsetParent !== null || s.getClientRects().length);
  let cycle = 0;
  const plan = sections.map((s) => {
    let form = s.dataset.fx;
    // a section with its own WebGL/canvas scene (the home hero) stays clear
    if (!form && s.querySelector('canvas')) form = 'none';
    // untagged sections stay clear: particles never cross reading content
    if (!form) form = 'none';
    if (form !== 'none' && !FORMS[form]) form = CYCLE[cycle++ % CYCLE.length];
    return { el: s, form, theme: s.getAttribute('data-theme') || '', top: 0, height: 1 };
  });
  if (!plan.length) { renderer.dispose(); canvas.remove(); return null; }
  // right edge by default (reading columns are left-aligned); data-fx-side="left" flips
  plan.forEach((p) => { p.sideSign = p.el.dataset.fxSide === 'left' ? -1 : 1; });

  /* geometry: one position buffer per formation, swapped into position/aTo */
  const r = rng(20260925);
  const cache = {};
  const formData = (name) => (cache[name] ||= FORMS[name](COUNT, rng(name.length * 977 + 13)));
  const geo = new THREE.BufferGeometry();
  const posA = new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3);
  const posB = new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3);
  const rand = new Float32Array(COUNT * 4);
  for (let i = 0; i < rand.length; i++) rand[i] = r();
  geo.setAttribute('position', posA);
  geo.setAttribute('aTo', posB);
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50); // never frustum-culled

  const U = {
    uMix: { value: 0 }, uTime: { value: 0 }, uVel: { value: 0 }, uDpr: { value: 1 }, uSize: { value: phone ? 2.4 : 2.1 },
    uAspect: { value: 1 }, uWaveFrom: { value: 0 }, uWaveTo: { value: 0 }, uAlphaFrom: { value: 0 }, uAlphaTo: { value: 0 },
    uScaleFrom: { value: 1 }, uScaleTo: { value: 1 }, uSparseFrom: { value: 0 }, uSparseTo: { value: 0 }, uOffFrom: { value: new THREE.Vector3() }, uOffTo: { value: new THREE.Vector3() },
    uAngle: { value: 0 }, uTilt: { value: 0 }, uPointer: { value: new THREE.Vector2(9, 9) },
  };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: U, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const scene = new THREE.Scene();
  scene.add(points);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  camera.position.set(0, 0, 9);

  /* post-processing chain */
  const rtOpts = { depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const rtScene = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const rtA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const rtB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const blurMat = new THREE.ShaderMaterial({ uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: QUAD_VS, fragmentShader: BLUR_FS, depthTest: false, depthWrite: false });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: rtScene.texture }, tBloom: { value: rtB.texture }, uRes: { value: new THREE.Vector2(1, 1) },
      uSeam: { value: new THREE.Vector2(-1, -1) }, uTime: { value: 0 }, uVel: { value: 0 }, uGlitch: { value: 0 },
      uBloom: { value: 1.35 }, uGrain: { value: phone ? 0.018 : 0.024 },
    },
    vertexShader: QUAD_VS, fragmentShader: COMPOSITE_FS, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(quadGeo, blurMat);
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  let bloomOn = true;

  /* sizing + adaptive quality */
  let W = 1, H = 1, dpr = Math.min(devicePixelRatio || 1, DPR_MAX), visW = 1, visH = 1;
  function resize() {
    W = innerWidth; H = innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    const pw = Math.max(1, Math.floor(W * dpr)), ph = Math.max(1, Math.floor(H * dpr));
    rtScene.setSize(pw, ph);
    rtA.setSize(Math.max(1, pw >> 2), Math.max(1, ph >> 2));
    rtB.setSize(Math.max(1, pw >> 2), Math.max(1, ph >> 2));
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    visH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    visW = visH * camera.aspect;
    U.uDpr.value = dpr;
    U.uAspect.value = camera.aspect;
    compMat.uniforms.uRes.value.set(W, H);
    measure();
    dirty = true;
    // re-place formations for the new aspect (prev = -1, so no glitch)
    if (pairIndex >= 0) { const k = pairIndex; pairIndex = -1; setPair(k); }
  }

  function measure() {
    const y = scrollY;
    plan.forEach((p) => {
      const b = p.el.getBoundingClientRect();
      p.top = b.top + y;
      p.height = Math.max(1, b.height);
    });
  }

  function offsetFor(p) {
    const cfg = FORM_CFG[p.form];
    const narrow = camera.aspect < 0.9;
    if (cfg.low) return [0, -visH * 0.3, 0];
    if (!cfg.side) return [0, 0, 0];
    // centre sits near the viewport edge: the shape rises from it
    return [p.sideSign * visW * (narrow ? 0.5 : 0.42), narrow ? visH * 0.08 : 0, 0];
  }
  function scaleFor(p) {
    const narrow = camera.aspect < 0.9;
    return FORM_CFG[p.form].scale * (narrow ? 0.72 : 1);
  }

  let pairIndex = -1;
  function setPair(i) {
    if (i === pairIndex) return;
    const prev = pairIndex;
    pairIndex = i;
    const a = plan[i], b = plan[Math.min(i + 1, plan.length - 1)];
    posA.array.set(formData(a.form)); posA.needsUpdate = true;
    posB.array.set(formData(b.form)); posB.needsUpdate = true;
    const ca = FORM_CFG[a.form], cb = FORM_CFG[b.form];
    // phones: text fills the width, so ambient forms nearly vanish and shapes dim
    const dim = (c) => (camera.aspect >= 0.9 ? 1 : c.side ? 0.6 : 0.25);
    U.uAlphaFrom.value = ca.alpha * dim(ca); U.uAlphaTo.value = cb.alpha * dim(cb);
    U.uWaveFrom.value = ca.wave; U.uWaveTo.value = cb.wave;
    U.uSparseFrom.value = ca.sparse; U.uSparseTo.value = cb.sparse;
    U.uScaleFrom.value = scaleFor(a); U.uScaleTo.value = scaleFor(b);
    U.uOffFrom.value.set(...offsetFor(a)); U.uOffTo.value.set(...offsetFor(b));
    // crossing into a new section: short glitch (not on first paint)
    if (prev !== -1) pulse(Math.abs(i - prev) > 1 ? 0.9 : 0.55);
  }

  /* state */
  let glitch = 0, vel = 0, lastY = scrollY, lastT = performance.now();
  let pointerT = new THREE.Vector2(9, 9), pointerIdle = 0;
  let dirty = true, running = false, raf = 0, frameSkip = false;
  const slow = { sum: 0, n: 0, strikes: 0 };

  function pulse(amount = 0.8) { glitch = Math.max(glitch, amount); wake(); }

  function update(now, dt) {
    const y = scrollY;
    const dy = y - lastY;
    lastY = y;
    const inst = dt > 0 ? dy / dt : 0; // px per ms
    vel += (inst - vel) * 0.12;
    if (Math.abs(vel) < 0.001) vel = 0;

    // which section holds the viewport centre, and how far through it we are
    const c = y + H * 0.5;
    let i = plan.length - 1;
    for (let k = 0; k < plan.length; k++) { if (c < plan[k].top + plan[k].height) { i = k; break; } }
    if (c < plan[0].top) i = 0;
    const p = plan[i];
    const t = Math.min(1, Math.max(0, (c - p.top) / p.height));
    setPair(i);
    const m = i === plan.length - 1 ? 0 : THREE.MathUtils.smoothstep(t, 0.62, 1);
    U.uMix.value = m;

    // seams: boundaries where the theme flips, while on screen (GL uv y is bottom-up)
    const seams = [-1, -1];
    let s = 0;
    for (let k = 1; k < plan.length && s < 2; k++) {
      if (plan[k].theme === plan[k - 1].theme) continue;
      const by = plan[k].top - y;
      if (by > 0 && by < H) seams[s++] = 1 - by / H;
    }
    compMat.uniforms.uSeam.value.set(seams[0], seams[1]);

    // scroll turns the cloud; pointer tilts it
    const time = now / 1000;
    U.uTime.value = time;
    compMat.uniforms.uTime.value = time;
    U.uAngle.value = y * 0.0007 + time * 0.045;
    U.uPointer.value.lerp(pointerT, 0.08);
    U.uTilt.value += ((pointerT.y < 5 ? pointerT.y * 0.12 : 0) + 0.12 - U.uTilt.value) * 0.05;
    const v = THREE.MathUtils.clamp(vel * 0.6, -1.5, 1.5);
    U.uVel.value = v;
    compMat.uniforms.uVel.value = v;
    glitch *= Math.pow(0.02, dt / 1000 * 2.4); // ~400ms decay
    if (glitch < 0.01) glitch = 0;
    compMat.uniforms.uGlitch.value = glitch;

    // is anything visible? (home hero: 'none' on both ends -> sleep)
    const alphaNow = U.uAlphaFrom.value * (1 - m) + U.uAlphaTo.value * m;
    const visible = alphaNow > 0.01 || glitch > 0 || seams[0] >= 0;
    const moving = Math.abs(vel) > 0.002 || glitch > 0 || pointerIdle < 60 || (m > 0 && m < 1);
    pointerIdle++;
    return { visible, moving };
  }

  function draw() {
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);
    if (bloomOn) {
      quad.material = blurMat;
      blurMat.uniforms.tMap.value = rtScene.texture;
      blurMat.uniforms.uDir.value.set(1 / rtA.width, 0);
      renderer.setRenderTarget(rtA); renderer.render(quadScene, quadCam);
      blurMat.uniforms.tMap.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(0, 1 / rtB.height);
      renderer.setRenderTarget(rtB); renderer.render(quadScene, quadCam);
    }
    compMat.uniforms.uBloom.value = bloomOn ? 1.35 : 0;
    quad.material = compMat;
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  }

  function govern(dt) {
    // after warm-up, 90-frame windows averaging > 24ms step quality down
    slow.sum += dt; slow.n++;
    if (slow.n < 90) return;
    const avg = slow.sum / slow.n;
    slow.sum = 0; slow.n = 0;
    if (avg > 24) {
      slow.strikes++;
      if (dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.25); resize(); }
      else if (bloomOn) bloomOn = false;
      else if (slow.strikes > 4) U.uSize.value *= 0.9;
    }
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(100, now - lastT);
    lastT = now;
    if (dirty) { measure(); dirty = false; }
    const { visible, moving } = update(now, dt);
    canvas.classList.toggle('is-on', visible);
    if (!visible) { running = false; return; } // sleep until scroll/resize/pulse
    // 30 fps when nothing moves: skip every other frame
    frameSkip = !moving && !frameSkip;
    if (!frameSkip) { draw(); if (moving) govern(dt); }
    raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (running || doc.hidden || destroyed) return;
    running = true;
    lastT = performance.now();
    raf = requestAnimationFrame(frame);
  }

  /* events */
  const onScroll = () => wake();
  const onResize = () => { resize(); wake(); };
  const onPointer = (e) => {
    if (e.pointerType !== 'mouse') return; // touch: no repel, saves work
    pointerT.set((e.clientX / W) * 2 - 1, -(e.clientY / H) * 2 + 1);
    pointerIdle = 0;
    wake();
  };
  const onLeave = () => pointerT.set(9, 9);
  const onVis = () => { if (doc.hidden) { cancelAnimationFrame(raf); raf = 0; running = false; } else wake(); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize);
  addEventListener('pointermove', onPointer, { passive: true });
  doc.documentElement.addEventListener('mouseleave', onLeave);
  doc.addEventListener('visibilitychange', onVis);
  // content height changes (filters, accordions, images) move the section tops
  const ro = new ResizeObserver(() => { dirty = true; wake(); });
  ro.observe(main);
  // internal links: a glitch burst as the page hands over to the view transition
  const onClick = (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin && url.pathname !== location.pathname) pulse(1);
  };
  doc.addEventListener('click', onClick);

  let destroyed = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    destroy();
    onFail?.();
  });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onResize);
    removeEventListener('pointermove', onPointer);
    doc.documentElement.removeEventListener('mouseleave', onLeave);
    doc.removeEventListener('visibilitychange', onVis);
    doc.removeEventListener('click', onClick);
    ro.disconnect();
    [geo, quadGeo].forEach((g) => g.dispose());
    [points.material, blurMat, compMat].forEach((m) => m.dispose());
    [rtScene, rtA, rtB].forEach((t) => t.dispose());
    renderer.dispose();
    canvas.remove();
  }

  resize();
  // one draw before the fade-in so the first visible frame is complete
  lastT = performance.now();
  wake();
  return { pulse, destroy, get quality() { return { dpr, bloom: bloomOn, count: COUNT }; } };
}
