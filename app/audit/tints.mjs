/* ─────────────────────────────────────────────────────────────
   The fifteen measurements SPEC.md § 2 asks for at P3.

   A highlight in this app is an SVG rect in foliate's Overlayer, which sits
   ABOVE the text (overlayer.js:8–12 — absolute, pointer-events none, appended
   after the page). So a fill is never literally behind the words, and
   DESIGN.md's "drawn behind the words, the letters keep their own colour" has
   to be produced by the blend mode instead:

     light stocks  multiply at opacity 1. Ink × pastel is still ink; ground ×
                   pastel is the pastel. Visually identical to a marker under
                   the text, and it is why a fill does not grey the sentence.
     dark stocks   multiply would darken a dark page into mud, so the treatment
                   is DESIGN.md's: a low-alpha NORMAL wash plus a 2px bar in the
                   margin, with the text left at the stock's own ink.

   Either way the reader ends up looking at two composited colours, and there
   are TWO pairs to measure, not one:

     ink:gnd    the sentence read through the mark. Body text, so 4.5:1.
     mark:page  the mark itself against the bare page beside it. This is the
                one the first shipped set had no floor on at all, and it is
                why the owner reported that the highlights "don't show well":
                butter landed at 1.17:1 on Press, a cream mark on a cream
                page. The floor is now 1.7:1 and it is enforced below.

   1.7 is not a WCAG number and does not pretend to be. 1.4.11's 3:1 is for
   the boundary of a CONTROL; a 3:1 fill sitting behind body text is a block,
   not a highlight, and it costs the pastel its identity (the solver's 3:1
   answers were #FF3B7B and a grey-green butter). 1.7 is where a band is
   unmistakable at reading distance while the sentence still reads as text
   with a mark on it. Ink-through-mark is unaffected: it measures 6.4–10.9 at
   this floor, so the two requirements never come into tension.

   Run: node audit/tints.mjs
   ───────────────────────────────────────────────────────────── */

const STOCKS = {
    press:  { bg: '#FFFFFF', ink: '#1B1917', dark: false },
    day:    { bg: '#F4F2ED', ink: '#1B1917', dark: false },
    butter: { bg: '#F6EBD9', ink: '#1B1917', dark: false },
    tea:    { bg: '#EADCC3', ink: '#2A231C', dark: false },
    coal:   { bg: '#221E1B', ink: '#F4F2ED', dark: true },
    /* Dusk is the blue stock now, by the owner's instruction — it borrows the
       Ink chrome theme's own four values rather than introducing a new colour. */
    dusk:   { bg: '#1B2430', ink: '#D9E4F2', dark: true },
    pitch:  { bg: '#000000', ink: '#BFBAB2', dark: true },
}

/* The four fills and the one underline, DESIGN.md → Highlighter tints.

   These are NOT Press's four card grounds any more. They were, and that was
   the bug: a card ground has to be barely-off-white so type can sit on it,
   which is the exact opposite of what a fill lying ON a page needs. Same hex
   cannot do both jobs. Pink, blue and butter were re-solved in OKLCH — hue
   held to Press's exactly, as little lightness given up as the 1.7:1 floor
   allows, and the rest of the budget spent on chroma so what comes back is
   still a pink rather than a taupe. Mustard is untouched: at 2.02:1 it was
   already the one of the four that cleared the floor on its own. */
const TINTS = {
    mustard: '#DCA94C',
    pink:    '#F0B3BE',
    blue:    '#AFC9E3',
    butter:  '#D6C19F',
}
/* Floor on mark:page, light stocks. See the note at the top of the file. */
const MARK_FLOOR = 1.7
/* The underline highlighter's shipped values, read off index.css — :root and
   the dark-stock override. These were terracotta (#C2410C / #E8865A) until the
   owner's "no orange"; this driver went on measuring the orange after index.css
   had stopped using it, which made its underline column a measurement of
   nothing. Kept in sync by hand, and the sync is the point: a driver that
   measures a value the app does not ship is worse than no driver. */
const UNDERLINE = '#1C5480'
const UNDERLINE_DARK = '#7FB6EC'

const hex = h => {
    const s = h.replace('#', '')
    return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16))
}
const chan = c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const lum = ([r, g, b]) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
}
const round2 = n => Math.round(n * 100) / 100

/** multiply, per compositing-1: Cr = Cs × Cb, both in 0–1. */
const multiply = (src, back) => src.map((s, i) => (s * back[i]) / 255)
/** normal source-over at alpha a. */
const over = (src, back, a) => src.map((s, i) => s * a + back[i] * (1 - a))

const rows = []
let worst = null
const note = r => {
    rows.push(r)
    if (!worst || r.cr < worst.cr) worst = r
}

/* ── the four fills ─────────────────────────────────────────────────────── */
for (const [stockName, stock] of Object.entries(STOCKS)) {
    const bg = hex(stock.bg), ink = hex(stock.ink)
    for (const [tintName, tintHex] of Object.entries(TINTS)) {
        const tint = hex(tintHex)
        if (!stock.dark) {
            const cr = round2(ratio(multiply(tint, ink), multiply(tint, bg)))
            const vs = round2(ratio(multiply(tint, bg), bg))
            note({
                stock: stockName, tint: tintName, mode: 'multiply', alpha: 1,
                cr, vs,
                pass: cr >= 4.5 && vs >= MARK_FLOOR,
            })
            continue
        }
        /* Largest alpha in 0.01 steps that still clears TARGET on the ink.
           TARGET is 4.8 and not 4.5 deliberately: maximising against 4.5 puts
           every one of the twelve dark pairs between 4.51 and 4.63, which is
           the requirement passing by a rounding error. The browser composites
           in its own colour space and an sRGB-space calculation here is a model
           of that, not a transcript of it, so the alphas are chosen with about
           7% of headroom and then reported against the real 4.5 bar. Costs a
           few points of wash visibility; buys a mark that cannot fail on a
           panel that renders slightly differently. */
        const TARGET = 4.8
        let best = 0
        for (let a = 0.60; a >= 0.01; a -= 0.01) {
            if (ratio(over(tint, ink, a), over(tint, bg, a)) >= TARGET) { best = round2(a); break }
        }
        const cr = round2(ratio(over(tint, ink, best), over(tint, bg, best)))
        const vs = round2(ratio(over(tint, bg, best), bg))
        note({
            stock: stockName, tint: tintName, mode: 'normal', alpha: best,
            cr, vs,
            pass: best > 0 && cr >= 4.5 && vs >= MARK_FLOOR,
        })
    }
}

/* ── the underline ──────────────────────────────────────────────────────────
   Not a fill and not text: a 2px printed rule under the words, so the bar it
   has to clear is 3:1 against the page (WCAG 1.4.11, non-text contrast) and
   the ink under it is untouched. */
const underlineRows = Object.entries(STOCKS).map(([name, s]) => {
    const line = hex(s.dark ? UNDERLINE_DARK : UNDERLINE)
    const cr = round2(ratio(line, hex(s.bg)))
    return { stock: name, value: s.dark ? UNDERLINE_DARK : UNDERLINE, cr, pass: cr >= 3 }
})

const w = (s, n) => String(s).padEnd(n)
console.log(`FILLS — ink:gnd needs 4.5, mark:page needs ${MARK_FLOOR}`)
console.log(w('stock', 8) + w('tint', 9) + w('mode', 10) + w('alpha', 7) + w('ink:gnd', 9) + w('mark:page', 11) + 'verdict')
for (const r of rows)
    console.log(w(r.stock, 8) + w(r.tint, 9) + w(r.mode, 10) + w(r.alpha, 7)
        + w(r.cr.toFixed(2), 9) + w(r.vs.toFixed(2), 11) + (r.pass ? 'pass' : 'FAIL'))

console.log('\nUNDERLINE — 2px rule vs page, needs 3:1 (non-text)')
console.log(w('stock', 8) + w('value', 10) + w('rule:page', 11) + 'AA 3.0')
for (const r of underlineRows)
    console.log(w(r.stock, 8) + w(r.value, 10) + w(r.cr.toFixed(2), 11) + (r.pass ? 'pass' : 'FAIL'))

const fails = rows.filter(r => !r.pass).concat(underlineRows.filter(r => !r.pass))
console.log(`\nmeasurements: ${rows.length} fills + ${underlineRows.length} underlines`)
console.log(`worst fill pair: ${worst.stock}/${worst.tint} at ${worst.cr.toFixed(2)}:1`)
console.log(`FINDINGS: ${fails.length}`)

/* The CSS the dark stocks need, generated from what was just measured rather
   than transcribed by hand. Paste target: index.css → highlighter tints. */
console.log('\n/* generated by audit/tints.mjs */')
for (const [name, s] of Object.entries(STOCKS)) {
    if (!s.dark) continue
    console.log(`[data-stock="${name}"]{`)
    for (const [tintName, tintHex] of Object.entries(TINTS)) {
        const r = rows.find(x => x.stock === name && x.tint === tintName)
        const [rr, gg, bb] = hex(tintHex)
        console.log(`  --hl-fill-${tintName}:rgba(${rr},${gg},${bb},${String(r.alpha).replace(/^0/, '')});`)
    }
    console.log(`  --hl-underline:${UNDERLINE_DARK};`)
    console.log('}')
}
