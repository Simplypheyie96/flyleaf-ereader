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
/* the repo root, one level above the app — for the standalone mark asset,
   which is not part of the bundle and does not want to be served */
const ASSETS = join(ROOT, '..', 'assets')

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
   are the weights #splash b and #splash small use. IBM Plex Mono was here too,
   for a format list that #splash no longer carries. When index.html's #splash
   moves, this moves — see CSS below, which is that block transcribed. */
const req = createRequire(import.meta.url)
const face = (pkg, file) => fontkit.openSync(join(dirname(req.resolve(pkg + '/package.json')), 'files', file))
const SERIF = face('@fontsource/playfair-display', 'playfair-display-latin-500-normal.woff2')
const SANS = face('@fontsource/archivo', 'archivo-latin-500-normal.woff2')

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

/* The same block the nav draws. Kept in sync with src/components/Mark.tsx by
   hand, since the app imports these as TS constants and this script runs
   outside the bundle. That file carries the reasoning, the disjointness proof
   the evenodd knockout depends on, and the note that MARK is Press's rosette
   character for character; this is only a copy of the strings.

   VB is the viewBox those strings are drawn in. Two things follow from it and
   both matter here: the block fills the box EXACTLY, so there is no
   ink-fraction to convert any more — a requested span is the drawn span — and
   the box centre (x + s/2, y + s/2) = (256, 242) is the rosette's INK centre
   rather than the 512 box's, which is why `ty` below is not symmetric with
   `tx`. Change any of these three and every icon moves. */
const MARK = 'M256 57.6 A74.67 59.73 -90 1 1 256 206.93 A74.67 59.73 -90 1 1 256 57.6 Z M444.69 194.69 A74.67 59.73 -18 1 1 302.66 240.85 A74.67 59.73 -18 1 1 444.69 194.69 Z M372.61 416.51 A74.67 59.73 54 1 1 284.84 295.68 A74.67 59.73 54 1 1 372.61 416.51 Z M139.39 416.51 A74.67 59.73 126 1 1 227.16 295.68 A74.67 59.73 126 1 1 139.39 416.51 Z M67.31 194.69 A74.67 59.73 198 1 1 209.34 240.85 A74.67 59.73 198 1 1 67.31 194.69 Z M217.6 256 A38.4 38.4 0 1 1 294.4 256 A38.4 38.4 0 1 1 217.6 256 Z'
const TILE = 'M97 -49 H415 A132 132 0 0 1 547 83 V401 A132 132 0 0 1 415 533 H97 A132 132 0 0 1 -35 401 V83 A132 132 0 0 1 97 -49 Z'
const VB = { x: -35, y: -49, s: 582 }

/* The launch screen's layout, as the CSS ITSELF rather than as measurements
   of it. Every number below is copied straight from index.html's #splash
   block, in the CSS px it is written in, and the baselines are then solved
   from the same font metrics and the same box model the browser uses. So the
   native launch image and the in-page splash that replaces it agree by
   construction instead of by a table someone remembered to update.

   Two earlier revisions of this got it wrong in opposite directions — one fed
   CSS-over-88 fractions into a span-scaled layout and came out 24% small, the
   other pinned the layout to the mark's ink height, so redrawing the mark
   silently resized the wordmark. Both were tables of derived numbers. This is
   not a table; when #splash changes, change these literals to match and the
   arithmetic follows.

   `box` is #splash svg's width/height, and it is the unit everything else is
   expressed against, because it is the one length the two surfaces must agree
   on exactly: iOS shows the PNG, the page paints over it, and nothing is
   allowed to jump. */
const CSS = {
  box: 80,
  name: { mt: 24, size: 30, lh: 1.1, em: -0.008, font: () => SERIF, text: 'Flyleaf eReader', op: 1 },
  rule: { mt: 22, w: 40, h: 1, op: 0.18 },
  claim: { mt: 20, size: 11, lh: 1.6, em: 0.16, font: () => SANS, text: 'READ WHAT YOU OWN', op: 0.55 },
}

/* Where the browser puts a baseline inside a line box: the leading left over
   after the font's own ascent+descent is split above and below, then the
   baseline sits one ascent down from there.

   The three roundings are not cosmetic and were arrived at by measuring, not
   by reading a spec. Blink rounds each font metric to a whole CSS pixel before
   it does anything with them, floors the half-leading, and quantises the line
   box to 1/64 px (its LayoutUnit). Compute this in ideal reals instead and the
   baselines come out 0.97px and 0.47px low respectively for the two lines
   here — under a pixel each, and still enough to see the wordmark twitch at
   the handoff from the native launch image to the page.

   Measured against the live #splash at 390x844: name baseline 148.0px below
   the block top, claim baseline 208.0px. This function returns exactly those.

   hhea ascent/descent, which is what Blink uses for both of these faces —
   Playfair 1082/-251, Archivo 878/-210 against a 1000 upem. Their winAscent
   pair would put the name a further 1.6px low. */
function baselineIn(spec, lineTop) {
  const f = spec.font()
  const asc = Math.round((f.ascent / f.unitsPerEm) * spec.size)
  const desc = Math.round((-f.descent / f.unitsPerEm) * spec.size)
  return lineTop + Math.floor((lineBoxOf(spec) - (asc + desc)) / 2) + asc
}

/* size x line-height, quantised to Blink's 1/64 px LayoutUnit: 11 x 1.6 is
   17.59375 on screen, not 17.6, and the stack is short enough that the
   difference lands inside the centring. */
const lineBoxOf = (spec) => Math.floor(spec.size * spec.lh * 64) / 64

/* The stack under the mark, laid out in CSS px from the top of the mark's box
   and emitted at `u` user units per CSS px. Returns the block's total height
   in CSS px as well, which is what centres it the way flex centres it there.
   Called twice per launch image — once to measure, once to draw — so the
   measure pass cannot fall out of step with the draw. */
function splashStack(u, cx, boxTop, ink) {
  const out = []
  let y = CSS.box
  const put = (spec) => {
    y += spec.mt
    out.push(line(spec.font(), spec.text, spec.size * u, spec.em * spec.size * u,
      cx, boxTop + baselineIn(spec, y) * u, ink, spec.op))
    y += lineBoxOf(spec)
  }
  put(CSS.name)
  y += CSS.rule.mt
  out.push(`<rect x="${(cx - (CSS.rule.w * u) / 2).toFixed(2)}" y="${(boxTop + y * u).toFixed(2)}" ` +
    `width="${(CSS.rule.w * u).toFixed(2)}" height="${Math.max(1, CSS.rule.h * u).toFixed(2)}" ` +
    `fill="${ink}" fill-opacity="${CSS.rule.op}"/>`)
  y += CSS.rule.h
  put(CSS.claim)
  return { body: out.join('\n  '), height: y }
}

/* `frac` is the share of the canvas the drawn block covers. Because the block
   fills its viewBox exactly, that is also the share of the canvas its box
   covers — the two were different quantities while the mark was an open form
   inside a padded box, and collapsing them is the one simplification this
   presentation buys.
   `words` adds the name and the two lines under it, for the launch images
   only — icons stay wordless. `spanPx` overrides `frac` with an absolute
   drawn size, which is how the launch images stay identical to the web splash:
   that draws the block at a fixed CSS.box px on every screen, so a fraction of
   the canvas can only match it on one of them. */
function svg(w, h, frac, ground = PAPER, ink = INK, words = false, spanPx = null) {
  const span = spanPx ?? Math.min(w, h) * frac
  const k = span / VB.s
  /* The CSS box that span corresponds to — the unit the lockup is written in,
     so the wordmark is pinned to #splash's px sizes. Identical to `span` now
     that the block fills its box; kept as its own name because the lockup
     reads in CSS px and the canvas reads in device px, and conflating them is
     exactly the bug the comment on CSS records. */
  const box = span
  /* user units per CSS px of #splash; comes out as the device pixel ratio */
  const u = box / CSS.box
  /* Where the block's own box starts. Centred as a BLOCK when there are words,
     so the lockup reads centred rather than the mark alone: measure the stack,
     then put the box top half the stack above the middle. Without words the box
     is simply centred on the canvas. This is also the text cursor's origin, so
     the wordmark hangs off the same number the mark does. */
  const top = words ? h / 2 - (splashStack(u, w / 2, 0, ink).height * u) / 2 : h / 2 - box / 2
  /* The viewBox does not start at 0,0 — it starts at (-35,-49), because it is
     centred on the rosette's ink rather than on the 512 box (DESIGN.md -> The
     mark). So both translate components have to subtract the origin, or the
     drawn block sits VB.y*k above where the layout thinks it does: 20 device px
     at dpr 3, which is exactly the parity failure this line once shipped. */
  const tx = w / 2 - (VB.x + VB.s / 2) * k
  const ty = top - VB.y * k
  const text = words ? splashStack(u, w / 2, top, ink).body : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${ground}"/>
  <g transform="translate(${tx} ${ty}) scale(${k})"><path d="${TILE} ${MARK}" fill-rule="evenodd" fill="${ink}"/></g>
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
/* 0.76: the block is a filled tile with its own 0.227 corner radius, so it is
   deliberately NOT full-bleed — iOS rounds the canvas itself, and two radii
   fighting over the same corner is the one thing that makes an icon look
   home-made. 12% of paper on every side is what iOS's own rounding eats, so
   nothing but ground is ever clipped. */
for (const s of [64, 180, 192, 256, 384, 512]) {
  png(join(ICONS, `icon-${s}.png`), s, s, 0.76)
}
/* — maskable — Android crops to a circle of 80% width (radius 0.40 of the
   icon). A rounded square of side s with 0.227s corners reaches
   √2×(s/2 − 0.227s) + 0.227s = 0.613s from the centre at its corner arc, so
   0.62 puts the furthest ink at 0.380 — inside the allowance with room, and
   the arithmetic is here so the next change to the corner radius is checked
   against it rather than eyeballed. */
for (const s of [192, 512]) {
  png(join(ICONS, `maskable-${s}.png`), s, s, 0.62)
}
writeFileSync(join(ICONS, 'icon.svg'), svg(512, 512, 0.76))

/* — iOS launch images — the device pixel sizes Safari matches on, portrait.
   Landscape falls back to the icon-less ground, which is the right thing: a
   stretched mark reads worse than plain paper. */
const DEVICES = [
  [1290, 2796, 3], [1179, 2556, 3], [1284, 2778, 3], [1170, 2532, 3],
  [1125, 2436, 3], [1242, 2688, 3], [828, 1792, 2], [750, 1334, 2], [1242, 2208, 3],
  [1640, 2360, 2], [1668, 2388, 2], [2048, 2732, 2], [1536, 2048, 2], [1620, 2160, 2],
]
/* #splash draws the block in a CSS.box-px box and the block fills it, so that
   IS the span, and in device pixels it is the span the launch image must use
   for the two screens to be indistinguishable — which is the whole job of a
   launch image: iOS shows it, the page paints over it, and nothing is allowed
   to jump. Written against the constant rather than as a literal so it cannot
   drift: svg() then gives u === dpr and box === CSS.box × dpr exactly. */
const SPLASH_SPAN = CSS.box
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

/* — the standalone mark, at the repo root — */
/* assets/flyleaf-mark-source.svg is what anything outside this build takes the
   mark from: a store listing, a favicon service, a print sheet. It is
   GENERATED, and that is the whole point — the file it replaces was a
   hand-typed second copy of the path, which is the drift this script exists to
   prevent, and it carried a blue gradient sky that this project's guardrails
   ban. Full-bleed and transparent: no ground is assumed, because whoever
   consumes it has their own, and `currentColor` is meaningless in a file
   opened outside a stylesheet, so the ink is stated. */
mkdirSync(ASSETS, { recursive: true })
writeFileSync(join(ASSETS, 'flyleaf-mark-source.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="${VB.x} ${VB.y} ${VB.s} ${VB.s}">
  <title>Flyleaf eReader</title>
  <path d="${TILE} ${MARK}" fill-rule="evenodd" fill="${INK}"/>
</svg>
`)

console.log(`Wrote 9 icons, ${DEVICES.length * 2} launch images, public/splash/links.html and assets/flyleaf-mark-source.svg.`)
