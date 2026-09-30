/**
 * Home hero scene — RETIRED.
 *
 * The per-hero wireframe ridges (and later the site-wide WebGL background)
 * were too heavy on phones. Every screen now shows the static hero photo
 * (.hero__poster) over the static background in css/bg.css.
 *
 * Any caller of initHero() gets null, meaning "no hero scene",
 * so it keeps its normal non-WebGL hero path and adds no second canvas.
 * This stub deliberately does not import three.js (saves ~700 KB on home).
 */
export function initHero() {
  return null;
}
