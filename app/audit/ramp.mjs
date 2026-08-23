/* The graph ramp — what replaced the six binding-cloth hues. Seven derived
   values per theme: --wash / --wash-2 are surfaces, --graph-1..5 are marks, and
   every one of them is the theme's own --ink mixed toward its own --rule or
   --card-w. Derived means they cannot be wrong by hand — and it also means
   nobody has ever LOOKED at what a five-step ramp of one ink actually measures.

   Three things are checked, per theme:

     1. Type on a wash. --ink and --ink-soft sit on --wash and --wash-2 (a stat
        card, the continue card, a section plate). --ink-soft on --wash-2 is the
        worst of the four and the one that has to clear 4.5.
     2. A mark on its ground, which is --rule and not the card. Every graph
        surface in the app — the calendar, the format mix bar, the top-books
        fill — is a --rule track with ramp steps painted into it, and in the
        calendar --rule IS level zero. So the pale end is not SUPPOSED to clear
        3:1 against its ground: --graph-1 means "one session that day", and a
        day with one session must read as barely more than a day with none.
        What is gated is that it reads as MORE than none at all — 1.2 — and
        what carries the meaning is the neighbour separation below plus a named
        key (Less/More on the calendar, format + count on the mix bar, where
        the dot is aria-hidden and the label is text).
     3. Neighbours. A five-step ramp is only readable if step n and step n+1 are
        distinguishable, so each adjacent pair is measured against the other.
        An ordered ramp with an invisible seam is a chart with a missing series.

     node audit/ramp.mjs
*/
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const THEMES = ['light', 'dark', 'sepia', 'ink']
const findings = []
const bad = m => findings.push(m)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.goto(BASE + '/stats')
await page.waitForTimeout(700)

const got = await page.evaluate((themes) => {
    /* Resolved through a canvas, not read off the custom property and not read
       back off a computed style either. getPropertyValue returns a color-mix()
       expression verbatim, and the computed style resolves it to
       `color(srgb 0.94 0.93 0.91)` — floats in an unbounded space, which a
       naive rgb() parser silently reads as 0.94/255. Painting one pixel and
       reading it back is the only form that is unambiguously 8-bit sRGB. */
    const probe = document.createElement('div')
    probe.style.display = 'none'
    document.body.appendChild(probe)
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    const ctx = cv.getContext('2d')
    const resolve = name => {
        probe.style.color = `var(${name})`
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, 1, 1)
        ctx.fillStyle = getComputedStyle(probe).color
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        return `rgb(${r}, ${g}, ${b})`
    }
    const NAMES = ['--paper', '--card-w', '--ink', '--ink-soft', '--rule',
        '--wash', '--wash-2', '--graph-1', '--graph-2', '--graph-3', '--graph-4', '--graph-5']
    const root = document.documentElement
    const prev = root.dataset.theme
    const out = {}
    for (const t of themes) {
        root.dataset.theme = t
        out[t] = Object.fromEntries(NAMES.map(n => [n, resolve(n)]))
    }
    if (prev) root.dataset.theme = prev; else delete root.dataset.theme
    probe.remove()
    return out
}, THEMES)

const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
const lum = c => {
    const [r, g, b] = rgb(c).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const f2 = n => n.toFixed(2)
const hex = s => '#' + rgb(s).map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase()

for (const t of THEMES) {
    const v = got[t]
    const row = []
    /* 1 — type on a wash. 4.5 is the floor: --ink-soft on --wash-2 is a
       metadata line inside a card, which is body text however small. */
    for (const ink of ['--ink', '--ink-soft']) for (const bg of ['--wash', '--wash-2']) {
        const r = ratio(v[ink], v[bg])
        row.push(`${ink.slice(2)}/${bg.slice(2)} ${f2(r)}`)
        if (r < 4.5) bad(`${t}: ${ink} on ${bg} is ${f2(r)}, under 4.5`)
    }
    /* 2 — marks on --rule, their actual track. Only step 1 is gated, and at
       1.2: it is the difference between "a little" and "none". */
    const marks = []
    for (let i = 1; i <= 5; i++) {
        const r = ratio(v[`--graph-${i}`], v['--rule'])
        marks.push(f2(r))
        if (i === 1 && r < 1.2) bad(`${t}: --graph-1 on --rule is ${f2(r)}, under 1.2 — level one reads as level zero`)
    }
    /* 3 — neighbours. Two ramp steps a reader cannot tell apart are one step. */
    const nb = []
    for (let i = 1; i < 5; i++) {
        const r = ratio(v[`--graph-${i}`], v[`--graph-${i + 1}`])
        nb.push(f2(r))
        if (r < 1.2) bad(`${t}: --graph-${i} and --graph-${i + 1} are ${f2(r)} apart, indistinguishable`)
    }
    console.log(`${t.padEnd(6)} wash ${hex(v['--wash'])}/${hex(v['--wash-2'])}  ${row.join('  ')}`)
    console.log(`       marks on rule  ${marks.join(' ')}   neighbours  ${nb.join(' ')}`)
}

console.log('\n=== FINDINGS: ' + findings.length + ' ===')
findings.forEach(f => console.log('  ' + f))
await browser.close()
process.exit(findings.length ? 1 : 0)
