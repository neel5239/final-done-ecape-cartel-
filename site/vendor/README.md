# Vendored libraries (no CDN dependency)

| Path | Version | Source | Licence |
| --- | --- | --- | --- |
| `gsap/gsap.min.js` | 3.15.0 | npm `gsap` dist | GSAP standard licence (free, incl. commercial) |
| `gsap/ScrollTrigger.min.js` | 3.15.0 | npm `gsap` dist | same. Project rule: trigger/toggle use only, **no `scrub`** |
| `three/three.module.min.js` | r186 (0.186.1) | npm `three` `build/three.module.js`, bundled with its `three.core.js` and minified by esbuild into one ES module | MIT (`three/LICENSE`) |
| `fonts/bricolage-*.woff2` | Google Fonts v9 | Bricolage Grotesque variable (opsz + wght), latin + latin-ext | SIL OFL 1.1 |
| `fonts/manrope-*.woff2` | Google Fonts v20 | Manrope variable (wght), latin + latin-ext | SIL OFL 1.1 |

Usage

```html
<script src="vendor/gsap/gsap.min.js" defer></script>
<script src="vendor/gsap/ScrollTrigger.min.js" defer></script>
<script type="module">
  import * as THREE from './vendor/three/three.module.min.js';
</script>
```

Fonts are declared in `css/base.css`; nothing else needs to load them.
