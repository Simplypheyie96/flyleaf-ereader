/* ─────────────────────────────────────────────────────────────
   The CSS that goes inside the book.

   foliate's renderer takes `setStyles([before, style])` and injects two
   stylesheets into the section's document: `before` goes above the
   publisher's CSS and loses every conflict, `style` goes below it and
   wins. That split is the whole design of this file.

     before  = what the reader would like, if the book has no opinion.
     style   = what the reader gets, whatever the book thinks.

   A control the reader can move belongs in `style`. A default that a
   well-set EPUB should be allowed to override belongs in `before` —
   which is why `paragraph`, `align` and the face under
   "publisher font" all sit there when they are set to 'published'.

   Ranges, defaults and the reason for each control: SPEC.md § 3.
   ───────────────────────────────────────────────────────────── */

import type { Settings } from '../types'
import { READING_FACES, STATIC_FACES, faceRules } from '../fonts'
import type { FaceId } from '../fonts'
import type { Palette } from './palette'

/* Scripts where letter-spacing does not mean what it means in Latin.
   In Arabic, Persian and Urdu it breaks the joins between letters and the
   word stops being a word; in the Indic scripts, Thai, Khmer and Myanmar it
   separates a base character from the marks that belong to it. SPEC.md § 3
   names these; Lao is added on identical grounds and is marked as the one
   addition. CJK is deliberately absent — tracking is a real typographic
   control there, so the slider stays live. */
const NO_TRACKING = new Set([
    'ar', 'fa', 'ur', 'ps', 'sd', 'ckb', 'ku',          // Arabic script
    'hi', 'mr', 'ne', 'sa', 'kok', 'mai', 'bho', 'doi', // Devanagari
    'bn', 'as', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'si',
    'th', 'km', 'my',
    'lo',                                                // NEW: same grounds
])

/** The two-letter subtag of a BCP-47 tag, lowercased. `pt-BR` → `pt`. */
function primary(lang: string | null | undefined): string {
    return (lang ?? '').trim().toLowerCase().split(/[-_]/)[0]
}

/** False for the scripts above, and the control is then shown disabled with
    this reason beside it rather than silently doing nothing. */
export function letterSpacingAllowed(lang: string | null | undefined): boolean {
    return !NO_TRACKING.has(primary(lang))
}

/** The reason, for the disabled control's own label. */
export function letterSpacingReason(lang: string | null | undefined): string {
    const l = primary(lang)
    if (['ar', 'fa', 'ur', 'ps', 'sd', 'ckb', 'ku'].includes(l))
        return 'Letter spacing breaks the joins between Arabic letters.'
    return 'Letter spacing separates marks from the letters they belong to.'
}

/** CSS hyphenation needs a language to look up a dictionary. A book that
    declares none gets no hyphens no matter what the switch says, so the
    switch greys out instead of lying. SPEC.md § 3. */
export function hyphenationAvailable(lang: string | null | undefined): boolean {
    return primary(lang).length > 0
}

const MONO = 'ui-monospace, "SF Mono", Menlo, "IBM Plex Mono", monospace'

/** 350 / 400 / 450, and as `font-weight` rather than
    `font-variation-settings: 'wght'`. The axis notation is what SPEC.md § 3
    writes, and it is wrong in one specific way: `font-variation-settings` is
    inherited as a whole, and an inherited axis value outranks a descendant's
    `font-weight`. Set it on <html> and every <strong> and <b> in the book
    stops being bold. `font-weight` is also the property that keeps working
    when a static fallback face renders. */
const WEIGHT: Record<Settings['weight'], number> = {
    light: 350,
    regular: 400,
    medium: 450,
}

/** Faces with no wght axis cannot hit 350/450 — the browser would synthesise
    or snap. Atkinson ships 400 and 700 only, so its three steps collapse to
    two and the control hides its middle. */
const STATIC_WEIGHT: Record<Settings['weight'], number> = {
    light: 400,
    regular: 400,
    medium: 700,
}

function faceCss(id: string): { css: string; variable: boolean } {
    const f = READING_FACES.find(f => f.id === id) ?? READING_FACES[0]
    /* Read from the face list rather than a hardcoded id check, so adding a
       non-variable face is one entry in one file and the weight control stays
       honest about it. */
    return { css: f.css, variable: !STATIC_FACES.has(f.id) }
}

export interface ReadingCssInput {
    settings: Settings
    palette: Palette
    /** the book's declared language, or null. Gates tracking and hyphens. */
    lang: string | null
    /** dark stocks matte images and lighten the selection wash. */
    dark: boolean
}

/**
 * Compose the pair for `renderer.setStyles`.
 *
 * Everything here is per-section work — it runs when a setting changes or a
 * section loads, never while a finger is down. That matters for the two rules
 * below with broad selectors: matching `*` costs a style recalculation once
 * per relayout, which the turn does not touch.
 */
export function readingCss({ settings: s, palette, lang, dark }: ReadingCssInput): [string, string] {
    const { css: family, variable } = faceCss(s.face)
    const weight = variable ? WEIGHT[s.weight] : STATIC_WEIGHT[s.weight]
    const tracking = letterSpacingAllowed(lang) ? s.letterSpacing : 0
    const hyphens = s.hyphenate && hyphenationAvailable(lang)

    /* ── before: defaults the book may overrule ─────────────────────────── */
    const before = `
/* Flyleaf: below the publisher's CSS in priority — a well-set book wins here. */
html {
    color-scheme: ${dark ? 'dark' : 'light'};
    ${s.publisherFont ? `font-family: ${family};` : ''}
}
/* Headings keep a tighter leading than body copy. If the book has set its
   own, the book's is used — that is the point of this layer. */
h1, h2, h3, h4, h5, h6 { line-height: 1.2; }
${s.paragraph === 'published' ? `p { text-indent: 0; }` : ''}
${s.align === 'published' ? `p, li, dd { text-align: start; }` : ''}
`.trim()

    /* ── style: the controls, and they win ──────────────────────────────── */
    const style = `
/* The faces themselves. Without these the family names below are unknown
   inside the book's iframe and every one of them renders as Georgia — see
   faceRules() in fonts.ts for why this cannot be inherited from the host. */
${faceRules(s.face as FaceId)}

/* Flyleaf: above the publisher's CSS — the reader's own controls. */
html {
    /* The size control is authoritative; everything the book sizes in em
       still scales off it. Books that size body copy in pt are overridden
       on purpose: a slider that a stylesheet can veto is not a control. */
    font-size: ${s.size}px !important;
    line-height: ${s.leading} !important;
    font-weight: ${weight} !important;
    font-optical-sizing: auto;
    word-spacing: ${s.wordSpacing}em;
    letter-spacing: ${tracking}em;
    ${hyphens ? 'hyphens: auto; -webkit-hyphens: auto; hyphenate-limit-chars: 6 3 3;' : 'hyphens: manual; -webkit-hyphens: manual;'}
    background: ${palette.ground} !important;
    color: ${palette.ink} !important;
    -webkit-text-size-adjust: none;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}
body {
    font-size: 1rem !important;
    background: transparent !important;
    color: inherit !important;
    /* Long URLs and unbroken IDs must not push a column wider than the pane. */
    overflow-wrap: break-word;
}
/* Leading and weight are set on <html> and inherited — but a publisher rule
   on the block elements would cut the inheritance, so the blocks are pinned
   back to it. Headings are absent from the list: a heading that the book
   wanted at 1.1 keeps it, and one that inherits gets the before-layer's 1.2.
   <strong>, <b>, <em> and <span> are absent too, so emphasis survives. */
:is(body, p, li, dd, dt, blockquote, div, td, th, figcaption) {
    line-height: inherit !important;
    font-weight: inherit !important;
}
${s.publisherFont ? '' : `
/* The reader's face, everywhere. \`*\` is the only selector that reaches
   into markup this app has never seen; the reset below it wins on
   specificity alone (0,0,1 beats 0,0,0), which is what keeps monospaced
   blocks monospaced — a code sample set in Literata stops lining up. */
* { font-family: ${family} !important; }
:is(pre, code, kbd, samp, tt), :is(pre, code, kbd, samp, tt) * {
    font-family: ${MONO} !important;
}`}
/* Tracking and word-spacing are typographic controls for prose and wrong for
   preformatted text, where they break the alignment the author drew. */
:is(pre, code, kbd, samp, tt), :is(pre, code, kbd, samp, tt) * {
    letter-spacing: normal !important;
    word-spacing: normal !important;
    hyphens: manual !important;
}
${s.align === 'published' ? '' : `
:is(p, li, dd, dt, blockquote, div) {
    text-align: ${s.align} !important;
    text-align-last: auto !important;
}`}
${s.paragraph === 'published' ? '' : s.paragraph === 'indent' ? `
p { text-indent: 1.2em !important; margin-block: 0 !important; }
/* The first paragraph of a section has nothing to be set off from, so it is
   not indented — the indent marks a break, and there is no break above it. */
:is(h1, h2, h3, h4, h5, h6) + p, body > p:first-child { text-indent: 0 !important; }` : `
p { text-indent: 0 !important; margin-block: 0.7em !important; }`}
/* An image taller than the column is a blank page followed by a clipped
   image. Capping both axes to the column is the whole fix, and it has to be
   !important because a fixed pixel height in the publisher's CSS is common. */
:is(img, svg, video, canvas) {
    max-inline-size: 100% !important;
    max-block-size: 100% !important;
    block-size: auto !important;
    object-fit: contain;
    break-inside: avoid;
}
${dark ? `
/* AUTHOR COLOURS ARE NORMALISED ON A DARK STOCK, and this is a legibility
   guarantee rather than a taste. Every trade EPUB ships light-mode colours:
   a dedication set in #1a1a2e, a chapter number in a pale grey, a pull-quote
   in the publisher's brand navy. \`html { color }\` above only reaches the
   elements that INHERIT — a publisher rule with a colour of its own outranks
   inheritance entirely, and on Coal, Dusk or Pitch that lands dark ink on a
   dark ground and the sentence is simply gone. There is no way to measure
   every author colour against the stock at render time, so on a dark stock
   they are all collapsed to the stock's own ink, which is the pair DESIGN.md
   measured. This is what Apple Books does in its dark themes, for the same
   reason.

   \`background-color\` goes with it: a light box the author drew for a
   sidebar becomes light ink on a light box, i.e. the same failure inverted.
   \`background-image\` is deliberately left alone — a book that sets its
   cover or a decorative rule as a background image would lose it, and that
   is the author's picture, per the note above.

   \`-webkit-text-fill-color\` is listed because it outranks \`color\` where
   a book sets it, and \`text-shadow\` because a light shadow drawn for a
   light page reads as a halo on a dark one.

   The reset is written twice. The first pass wins over every ordinary
   publisher declaration — an important declaration beats a normal one at any
   specificity. The second pass exists only for the book that writes
   \`!important\` itself: three \`:not(#fl9)\` clauses cost nothing to match
   and carry the same declarations at 3-ID specificity, which no stylesheet
   in the wild outranks. \`html\` is outside both — it is the element holding
   the ink, and \`inherit\` on the root would resolve to the initial black. */
:is(body, body *), :is(body, body *)::before, :is(body, body *)::after {
    color: inherit !important;
    -webkit-text-fill-color: currentColor !important;
    background-color: transparent !important;
    text-shadow: none !important;
    border-color: currentColor;
}
:is(body, body *):not(#fl9):not(#fl9):not(#fl9) {
    color: inherit !important;
    -webkit-text-fill-color: currentColor !important;
    background-color: transparent !important;
}` : ''}
/* Deliberately NOT here: matting or inverting illustrations on a dark stock.
   A black-on-white line drawing does read as a white rectangle on Coal, and
   every automatic fix for it — invert, multiply, luminance-key — wrecks the
   photographs it cannot tell apart from the drawings. A book's pictures are
   the author's, and this app does not repaint them. */
/* Links carry the page's own ink. A blue link on Tea is the one colour on
   the page that did not come from the stock. */
a:any-link {
    color: inherit !important;
    text-decoration: underline;
    text-decoration-thickness: from-font;
    text-underline-position: from-font;
    text-decoration-skip-ink: auto;
    text-decoration-color: color-mix(in oklab, currentColor 45%, transparent);
}
::selection {
    background: ${dark ? palette.select : `color-mix(in oklab, ${palette.select} 42%, transparent)`};
    color: inherit;
}
/* The gesture layer owns horizontal movement in a paginated book, so the
   browser must not claim it for a pan. Vertical stays native in scrolled
   flow, where there is something to scroll. */
:root {
    touch-action: ${s.flow === 'scrolled' ? 'pan-y pinch-zoom' : 'none'};
    -webkit-tap-highlight-color: transparent;
}
`.trim()

    return [before, style]
}
