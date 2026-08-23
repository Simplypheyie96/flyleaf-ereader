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

   Either way the reader ends up looking at two composited colours — ink-under-
   the-mark against ground-under-the-mark — and that is the pair this file
   measures. For the dark stocks it searches for the largest alpha that still
   clears 4.5:1 and reports what the wash looks like against the bare page at
   that alpha, because a wash nobody can see is not a highlight.

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

/* The four fills and the one underline, DESIGN.md → Highlighter tints. */
const TINTS = {
    mustard: '#DCA94C',
    pink:    '#F3D9DD',
    blue:    '#DAE4EE',
    butter:  '#F6EBD9',
}
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
            note({
                stock: stockName, tint: tintName, mode: 'multiply', alpha: 1,
                cr, vs: round2(ratio(multiply(tint, bg), bg)),
                pass: cr >= 4.5,
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
        note({
            stock: stockName, tint: tintName, mode: 'normal', alpha: best,
            cr, vs: round2(ratio(over(tint, bg, best), bg)),
            pass: best > 0 && cr >= 4.5,
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
console.log('FILLS — composited ink vs composited ground under the mark')
console.log(w('stock', 8) + w('tint', 9) + w('mode', 10) + w('alpha', 7) + w('ink:gnd', 9) + w('wash:page', 11) + 'AA 4.5')
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
        console.log(`  --hl-${tintName}:rgba(${rr},${gg},${bb},${String(r.alpha).replace(/^0/, '')});`)
    }
    console.log(`  --hl-underline:${UNDERLINE_DARK};`)
    console.log('}')
}
