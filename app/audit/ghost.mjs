/* The coverless ghost, measured.

   The owner's complaint was "txt files do not show cover". A .txt file
   contains no cover image — there is nothing in the file to show — and
   "No generated covers" is a hard guardrail, so the honest answer is the
   labelled ghost. That only holds up if the ghost is actually a designed
   object at every size it is drawn at, which is what this measures.

   Four questions, per format, at both widths:

     · the ghost renders at all, filling its cover box edge to edge
     · its ramp mark is painted, at its format family's step, and the five
       families really do land on five different strengths (DESIGN.md → the
       graph ramp; Cover.tsx claimed this for months with no CSS behind it)
     · nothing inside it overflows its own box — the 44px shelf row is the
       size that breaks, and "Markdown" is the longest label
     · the label contrasts against the wash it sits on

   Formats with no cover extractor at all: txt, markdown, html, mobi, azw3,
   fb2, fbz. EPUB and PDF carry real covers, so their ghost only appears when
   the file has none — which the fixtures do not exercise, and is stated here
   rather than skipped. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE || 'http://localhost:4173'
const HERE = dirname(fileURLToPath(import.meta.url))
const findings = []
const steps = []
const m = {}
const bad = (w, d) => findings.push(`${w}: ${d}`)
const say = s => steps.push(s)

const FIXTURES = [
    { file: 'fixture.txt', tag: 'txt', label: 'TXT', family: 'text' },
    { file: 'fixture.md', tag: 'markdown', label: 'Markdown', family: 'text' },
    { file: 'fixture.mobi', tag: 'mobi', label: 'MOBI', family: 'kindle' },
    { file: 'fixture.azw3', tag: 'azw3', label: 'AZW3', family: 'kindle' },
    { file: 'fixture.fb2', tag: 'fb2', label: 'FB2', family: 'fb2' },
]

/* Read the rendered ghost, not the rule that was meant to produce it. Both
   edges of every box, per CLAUDE.md — the trailing edge is the one that
   drifts, and an overflow inside a box with overflow:hidden is invisible by
   construction, so it has to be measured rather than looked at. */
const MEASURE = `(() => {
  /* Every colour on this page is authored as color-mix(in oklab, ...), so
     getComputedStyle hands back oklab() — whose three channels are nothing
     like r,g,b. Painting it and reading the pixel is the only conversion that
     cannot be got wrong, and it also resolves currentColor and alpha over the
     ground the driver is actually comparing against. */
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d')
  const srgb = (c) => {
    if (!c) return null
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, 1, 1)
    cx.fillStyle = c
    cx.fillRect(0, 0, 1, 1)
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data
    return \`rgb(\${r}, \${g}, \${b})\`
  }
  const out = []
  for (const cover of document.querySelectorAll('.cover')) {
    const ghost = cover.querySelector('.cover-ghost')
    if (!ghost) continue
    const cb = cover.getBoundingClientRect()
    const gb = ghost.getBoundingClientRect()
    const cs = getComputedStyle(ghost)
    const mark = getComputedStyle(ghost, '::before')
    const fmt = ghost.querySelector('.cover-ghost-fmt')
    const note = ghost.querySelector('.cover-ghost-note')
    const box = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { w: +r.width.toFixed(1), h: +r.height.toFixed(1),
               left: +(r.left - gb.left).toFixed(1),
               right: +(gb.right - r.right).toFixed(1),
               text: el.textContent.trim() }
    }
    /* scrollWidth against clientWidth is the only way an overflow inside an
       overflow:hidden ancestor shows up at all. */
    out.push({
      where: cover.closest('.continue') ? 'continue'
           : cover.closest('.shelf-row') ? 'row'
           : cover.closest('.detail-cover') || cover.closest('.sheet-head') ? 'detail'
           : cover.closest('.rail-item') ? 'rail' : 'grid',
      family: cover.dataset.family ?? null,
      coverW: +cb.width.toFixed(1), coverH: +cb.height.toFixed(1),
      ghostW: +gb.width.toFixed(1), ghostH: +gb.height.toFixed(1),
      inset: { l: +(gb.left - cb.left).toFixed(1), r: +(cb.right - gb.right).toFixed(1),
               t: +(gb.top - cb.top).toFixed(1), b: +(cb.bottom - gb.bottom).toFixed(1) },
      bg: srgb(cs.backgroundColor),
      pad: cs.padding, gap: cs.rowGap,
      overflowX: ghost.scrollWidth - ghost.clientWidth,
      overflowY: ghost.scrollHeight - ghost.clientHeight,
      mark: { w: +parseFloat(mark.width || 0).toFixed(1), h: +parseFloat(mark.height || 0).toFixed(1),
              bg: srgb(mark.backgroundColor), content: mark.content },
      fmt: box(fmt), note: box(note),
      fmtDisplay: fmt ? getComputedStyle(fmt).display : null,
      fmtSize: fmt ? getComputedStyle(fmt).fontSize : null,
      fmtColor: fmt ? srgb(getComputedStyle(fmt).color) : null,
    })
  }
  return out
})()`

/* sRGB relative luminance, so the label's contrast on the wash it actually
   renders on is a number rather than an impression. */
const contrast = (a, b) => {
    const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number)
    const lum = c => {
        const [r, g, bl] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl
    }
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return +((x + 0.05) / (y + 0.05)).toFixed(2)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)                                   // splash + seed

for (const fx of FIXTURES) {
    await page.goto(BASE + '/open', { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    await page.locator('input[type=file]').setInputFiles(join(HERE, 'fixtures', fx.file))
    await page.waitForURL(/\/book\//, { timeout: 20000 })
        .catch(() => bad(fx.tag, 'the file never imported'))
    await page.waitForTimeout(400)
    const sheet = await page.evaluate(MEASURE)
    m[`${fx.tag}Detail`] = sheet[0] ?? null
    if (!sheet.length) {
        /* FB2 embeds its cover as base64 in the file itself, so this fixture
           legitimately has one and legitimately has no ghost. What has to be
           true is that a REAL cover was drawn — a sheet with neither is the
           bug this branch used to report as one. */
        const real = await page.evaluate(() => !!document.querySelector('.cover img'))
        if (real) say(`${fx.tag}: carries a real cover, so no ghost — correct, and the ghost path is covered by the other four`)
        else bad(fx.tag, 'the book sheet drew neither a cover nor a ghost')
        continue
    }
    const g = sheet[0]
    if (g.family !== fx.family) bad(fx.tag, `data-family reads "${g.family}", expected "${fx.family}"`)
    if (g.mark.h < 1) bad(fx.tag, `the ramp mark has no height (${g.mark.h}px) — the ::before is not painting`)
    if (/rgba\([^)]*, 0\)|transparent/.test(g.mark.bg)) bad(fx.tag, `the ramp mark is transparent (${g.mark.bg})`)
    say(`${fx.tag}: ghost ${g.ghostW}x${g.ghostH} on a ${g.coverW}px cover, mark ${g.mark.w}x${g.mark.h} ${g.mark.bg}`)
}

/* The five steps must be five different strengths, or the ramp says nothing.
   Read straight off the tokens rather than off five imported files, so a
   family with no fixture is still covered. */
m.ramp = await page.evaluate(() => {
    const probe = document.createElement('span')
    document.body.append(probe)
    const out = {}
    for (const n of [1, 2, 3, 4, 5]) {
        probe.style.color = `var(--graph-${n})`
        const cv = document.createElement('canvas'); cv.width = cv.height = 1
        const cx = cv.getContext('2d')
        cx.fillStyle = getComputedStyle(probe).color
        cx.fillRect(0, 0, 1, 1)
        const [r, g, b] = cx.getImageData(0, 0, 1, 1).data
        out[`graph-${n}`] = `rgb(${r}, ${g}, ${b})`
    }
    probe.remove()
    return out
})
const strengths = new Set(Object.values(m.ramp))
if (strengths.size !== 5) bad('ramp', `the five steps resolve to ${strengths.size} distinct colours: ${JSON.stringify(m.ramp)}`)

/* Every place a cover is drawn, at both ends of the supported range. The
   44px shelf row is the size that breaks, and it is only reachable in list
   view — so switch to it rather than hoping the default shows one. */
for (const [w, h, name] of [[390, 844, 'phone'], [1280, 900, 'desktop']]) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(BASE + '/library', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    /* The library's three real views. "Shelf" was a name this driver invented,
       so the locator matched nothing and it measured the grid three times and
       reported it as three views — which is exactly how it missed that on a
       phone these buttons had no accessible name at all. The view is read back
       from aria-pressed now rather than assumed from the click. */
    for (const view of ['Grid', 'List', 'Collections']) {
        const btn = page.getByRole('button', { name: new RegExp(`^${view}$`, 'i') })
        if (!await btn.count()) { bad(`${name}/${view}`, 'the view switch has no button with this accessible name'); continue }
        await btn.first().click()
        await page.waitForTimeout(400)
        const on = await page.evaluate(() => document.querySelector('.seg-view[aria-pressed="true"]')?.getAttribute('aria-label') ?? null)
        if (on !== view) bad(`${name}/${view}`, `clicking it left "${on}" selected`)
        const seen = await page.evaluate(MEASURE)
        m[`${name}-${view}`] = seen
        for (const g of seen) {
            const tight = 0.6
            if (Math.abs(g.inset.l - g.inset.r) > tight)
                bad(`${name}/${view}`, `ghost insets differ side to side: ${g.inset.l} vs ${g.inset.r}`)
            if (g.overflowX > 0.5) bad(`${name}/${view}`, `"${g.fmt?.text}" overflows its ${g.coverW}px ghost by ${g.overflowX}px`)
            if (g.overflowY > 0.5) bad(`${name}/${view}`, `the ghost's own content is ${g.overflowY}px taller than the ${g.coverH}px cover`)
            if (g.fmtDisplay !== 'none' && g.fmt && g.fmt.left < -0.5)
                bad(`${name}/${view}`, `the label starts ${g.fmt.left}px outside the ghost`)
            /* Below 60px the label is hidden on purpose and the mark carries
               the format alone; above it the label must be there and legible. */
            if (g.coverW > 60 && g.fmtDisplay === 'none')
                bad(`${name}/${view}`, `the ${g.coverW}px ghost has no format label`)
            if (g.fmtDisplay !== 'none' && parseFloat(g.fmtSize) < 9)
                bad(`${name}/${view}`, `the format label is ${g.fmtSize} on a ${g.coverW}px cover, under the 9px floor`)
            if (g.mark.h < 1) bad(`${name}/${view}`, `the ramp mark is missing on the ${g.where} cover`)
            if (g.mark.w > g.ghostW) bad(`${name}/${view}`, `the ramp mark (${g.mark.w}px) is wider than the ghost (${g.ghostW}px)`)
            if (g.fmtColor && g.bg && g.fmtDisplay !== 'none') {
                const c = contrast(g.fmtColor, g.bg)
                if (c < 4.5) bad(`${name}/${view}`, `the format label is ${c}:1 on the ghost's wash, under 4.5`)
            }
        }
        if (seen.length) say(`${name}/${view}: ${seen.length} ghost${seen.length > 1 ? 's' : ''} — ${[...new Set(seen.map(g => `${g.where} ${g.coverW}px ${g.family} mark ${g.mark.w}x${g.mark.h}`))].join(', ')}`)
    }
}

/* Dark chrome is one variable change, so the ghost has to survive it without
   its own rule. */
await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(500)
const dark = page.getByRole('button', { name: /^Dark$/ })
if (await dark.count()) {
    await dark.first().click()
    await page.waitForTimeout(300)
    await page.goto(BASE + '/library', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    /* Grid, deliberately: the label only exists above 60px, and the last view
       the loop above left behind was the 44px row — so this check used to
       report "n/a, mark-only" and prove nothing about dark contrast. */
    const grid = page.getByRole('button', { name: /^Grid$/i })
    if (await grid.count()) { await grid.first().click(); await page.waitForTimeout(400) }
    const seen = await page.evaluate(MEASURE)
    m.dark = seen
    for (const g of seen) {
        if (g.fmtColor && g.bg && g.fmtDisplay !== 'none') {
            const c = contrast(g.fmtColor, g.bg)
            if (c < 4.5) bad('dark', `the format label is ${c}:1 on the dark ghost, under 4.5`)
        }
        if (g.mark.h < 1) bad('dark', 'the ramp mark vanished in dark chrome')
    }
    say(`dark: ${seen.length} ghosts, label contrast ${[...new Set(seen.filter(g => g.fmtDisplay !== 'none').map(g => contrast(g.fmtColor, g.bg)))].join(', ') || 'n/a — mark-only at this size'}:1`)
}

if (errors.length) bad('console', errors.join(' | '))
await browser.close()

console.log(JSON.stringify({ steps, measurements: m, findings }, null, 2))
console.log(`\n=== FINDINGS: ${findings.length}`)
for (const f of findings) console.log('  · ' + f)
