/* Generates every PWA image from the one rosette path — install icons at all
   the sizes Android and iOS ask for, a maskable pair with the mark pulled well
   inside the safe circle, the favicon, and the iOS launch images.
   Run with `npm run icons`. Needs ImageMagick (`magick`) on PATH; it is a
   build-time tool, not a dependency of the app.

   Ported from Flyleaf Press. Same mark, same method, this app's wordmark. */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import * as fontkit from 'fontkit'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICONS = join(ROOT, 'public/icons')
const SPLASH = join(ROOT, 'public/splash')

const PAPER = '#F4F2ED'
const INK = '#1B1917'

/* The launch images are lettered by converting the text to outlines here,
   rather than by asking the renderer for a font. ImageMagick's own SVG
   renderer needs FreeType fonts registered in type.xml and a Homebrew install
   has none — `magick -list font` returns nothing, so every <text> silently
   produces a wordless image. Outlines settle it: the SVG carries only <path>,
   exactly like the rosette, and renders identically on any host.

   The faces are the real ones, read straight out of the fontsource packages so
   they match what the app loads: Playfair Display 500 and Archivo 500, which
   are the weights #splash b and #splash small use. When index.html's #splash
   moves, this moves. */
const req = createRequire(import.meta.url)
const face = (pkg, file) => fontkit.openSync(join(dirname(req.resolve(pkg + '/package.json')), 'files', file))
const SERIF = face('@fontsource/playfair-display', 'playfair-display-latin-500-normal.woff2')
const SANS = face('@fontsource/archivo', 'archivo-latin-500-normal.woff2')
/* The chrome's mono, for the format list — #splash sets that line at 400, not
   500 like the two above it. */
const MONO = face('@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2')

/* One line of text as <path>s, centred on cx and sitting on baseline y.
   `track` is letter-spacing in user units, added between glyphs and — the part
   that is easy to get wrong — NOT after the last one. Include it and the run
   measures a full space wider than it draws, so a centred line sits half a
   space left of true centre. */
function line(font, str, size, track, cx, y, ink, opacity = 1) {
  const k = size / font.unitsPerEm
  const glyphs = font.layout(str).glyphs
  const width = glyphs.reduce((n, g) => n + g.advanceWidth * k + track, 0) - track
  let x = cx - width / 2
  const paths = glyphs.map((g) => {
    const d = g.path.toSVG()
    const at = x
    x += g.advanceWidth * k + track
    /* glyph outlines are y-up from the baseline; the negative y scale flips
       them into SVG's y-down space */
    return d ? `<path d="${d}" transform="translate(${at.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(5)} ${(-k).toFixed(5)})" fill="${ink}" fill-opacity="${opacity}"/>` : ''
  })
  return paths.join('\n  ')
}

/* The same rosette the nav draws. Kept in sync with src/components/Mark.tsx by
   hand, since the app imports it as a TS constant and this script runs outside
   the bundle. */
const MARK =
  'M256 57.6 A74.67 59.73 -90 1 1 256 206.93 A74.67 59.73 -90 1 1 256 57.6 Z M444.69 194.69 A74.67 59.73 -18 1 1 302.66 240.85 A74.67 59.73 -18 1 1 444.69 194.69 Z M372.61 416.51 A74.67 59.73 54 1 1 284.84 295.68 A74.67 59.73 54 1 1 372.61 416.51 Z M139.39 416.51 A74.67 59.73 126 1 1 227.16 295.68 A74.67 59.73 126 1 1 139.39 416.51 Z M67.31 194.69 A74.67 59.73 198 1 1 209.34 240.85 A74.67 59.73 198 1 1 67.31 194.69 Z M217.6 256 A38.4 38.4 0 1 1 294.4 256 A38.4 38.4 0 1 1 217.6 256 Z'

/* The launch screen's layout, MEASURED off the rendered #splash rather than
   guessed at, and expressed in the two units this function already works in:
   `span`, the drawn rosette's height, and `base`, the bottom of the 512-unit
   box it sits in.

   The old numbers were derived as "the CSS size over 88", 88 being the box
   the web splash draws the mark in. But `span` is the DRAWN path, which fills
   only 0.7575 of that box — so every line came out 24% small and every gap
   24% tight, and the native launch image and the in-page splash that replaces
   it visibly disagreed at the handoff. These are the same layout in the same
   units, so they do not.

   To re-derive after changing #splash: /tmp/fl/geom.mjs reads the baselines
   off the live overlay with a zero-width inline-block probe. */
const L = {
  /* size, tracking, and baseline offset from `base`, all in spans */
  name: { size: 0.3750, track: 0, base: 0.6901 },
  sent: { size: 0.1800, track: 0.0180, base: 1.1176 },
  fmt: { size: 0.1650, track: 0.0099, base: 1.6155 },
  /* The block, box top to the last line's line-box bottom, is 3.00 spans in
     the web layout (200px against a 66.66px span), which is what centres it
     here the way flex centres it there. */
  height: 3.0,
}

/* the path itself spans about 78% of its 512 box, so `frac` is the share of
   the canvas the DRAWN mark covers, not the share the box covers.
   `words` adds the name and the two lines under it, for the launch images
   only — icons stay wordless. `spanPx` overrides `frac` with an absolute
   drawn-mark height, which is how the launch images stay identical to the web
   splash: that draws the mark at a fixed 88 CSS px on every screen, so a
   fraction of the canvas can only match it on one of them. */
function svg(w, h, frac, ground = PAPER, ink = INK, words = false, spanPx = null) {
  const span = spanPx ?? Math.min(w, h) * frac
  const k = span / (512 * 0.7575)
  const tx = w / 2 - 256 * k
  /* Centred as a BLOCK when there are words, so the lockup reads centred
     rather than the mark alone: the box top goes half the block's height
     above the middle. Without words the 512 box is simply centred. */
  const ty = words ? h / 2 - span * (L.height / 2) : h / 2 - 256 * k
  const base = ty + 512 * k
  const text = words
    ? [
        line(SERIF, 'Flyleaf eReader', span * L.name.size, span * L.name.track, w / 2, base + span * L.name.base, ink),
        line(SANS, 'READ WHAT YOU OWN', span * L.sent.size, span * L.sent.track, w / 2, base + span * L.sent.base, ink, 0.62),
        /* The interpunct is U+00B7, which all three of these faces have; a
           bullet would not sit on the same optical line as the caps above. */
        line(MONO, 'EPUB \u00B7 MOBI \u00B7 AZW3 \u00B7 FB2 \u00B7 PDF', span * L.fmt.size, span * L.fmt.track, w / 2, base + span * L.fmt.base, ink, 0.42),
      ].join('\n  ')
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${ground}"/>
  <g transform="translate(${tx} ${ty}) scale(${k})"><path d="${MARK}" fill="${ink}"/></g>
  ${text}
</svg>`
}

function png(out, w, h, frac, ground, ink, words, spanPx) {
  const tmp = join(ROOT, '.icon-tmp.svg')
  writeFileSync(tmp, svg(w, h, frac, ground, ink, words, spanPx))
  execFileSync('magick', ['-background', 'none', tmp, '-strip', out])
  rmSync(tmp)
}

mkdirSync(ICONS, { recursive: true })
mkdirSync(SPLASH, { recursive: true })

/* — install icons — full-bleed; iOS rounds the corners itself */
for (const s of [64, 180, 192, 256, 384, 512]) {
  png(join(ICONS, `icon-${s}.png`), s, s, 0.48)
}
/* — maskable — Android crops to a circle of 80% width, so the mark sits small */
for (const s of [192, 512]) {
  png(join(ICONS, `maskable-${s}.png`), s, s, 0.36)
}
writeFileSync(join(ICONS, 'icon.svg'), svg(512, 512, 0.48))

/* — iOS launch images — the device pixel sizes Safari matches on, portrait.
   Landscape falls back to the icon-less ground, which is the right thing: a
   stretched mark reads worse than plain paper. */
const DEVICES = [
  [1290, 2796, 3], [1179, 2556, 3], [1284, 2778, 3], [1170, 2532, 3],
  [1125, 2436, 3], [1242, 2688, 3], [828, 1792, 2], [750, 1334, 2], [1242, 2208, 3],
  [1640, 2360, 2], [1668, 2388, 2], [2048, 2732, 2], [1536, 2048, 2], [1620, 2160, 2],
]
/* #splash draws the mark in an 88px box, and the path fills 0.7575 of it. In
   device pixels that is the span the launch image must use for the two screens
   to be indistinguishable — which is the whole job of a launch image: iOS shows
   it, the page paints over it, and nothing is allowed to jump. */
const SPLASH_SPAN = 88 * 0.7575
const links = []
for (const [w, h, dpr] of DEVICES) {
  /* the name and both lines go here too, so the native launch image and the
     in-page splash that replaces it show the same thing */
  png(join(SPLASH, `launch-${w}x${h}.png`), w, h, 0, PAPER, INK, true, SPLASH_SPAN * dpr)
  png(join(SPLASH, `launch-${w}x${h}-dark.png`), w, h, 0, '#151515', '#E9E9E9', true, SPLASH_SPAN * dpr)
  const q = `(device-width:${w / dpr}px) and (device-height:${h / dpr}px) and (-webkit-device-pixel-ratio:${dpr}) and (orientation:portrait)`
  links.push(`    <link rel="apple-touch-startup-image" media="${q} and (prefers-color-scheme:dark)" href="/splash/launch-${w}x${h}-dark.png" />`)
  links.push(`    <link rel="apple-touch-startup-image" media="${q}" href="/splash/launch-${w}x${h}.png" />`)
}
/* the <link> tags belong in index.html; written out here so they are never
   hand-typed and never drift from the files that actually exist */
writeFileSync(join(SPLASH, 'links.html'), links.join('\n') + '\n')

console.log(`Wrote 9 icons, ${DEVICES.length * 2} launch images, and public/splash/links.html.`)
