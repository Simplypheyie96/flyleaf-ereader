/* Do the three dark stocks hold their contrast against a book that fights them?

   This is the check behind SPEC.md § 2's "ink never pure white on a dark
   ground" and the author-colour reset at readingCss.ts:213. The owner reported
   dark navy text on a dark navy page — twice — so the reset went in; the owner
   then reported it fixed. This driver is the confirmation, not the
   investigation: it puts numbers on record so "fixed" is a measurement rather
   than an impression, and so a future change to readingCss.ts that quietly
   loses one of the six escape routes fails a driver instead of a reader.

   It measures the RENDERED pair, inside the section iframe, per stock:

     · the computed `color` and `-webkit-text-fill-color` of every hostile
       paragraph in audit/fixtures/inked.epub
     · the effective background behind it — the paragraph's own
       `background-color` if the book drew a box, otherwise the stock ground
     · WCAG 2 contrast of that pair, against 4.5:1 for body text
     · `text-shadow`, which has no contrast to measure and must simply be gone

   Every colour is read with getComputedStyle in the iframe, so what is checked
   is what the compositor was handed — not what a stylesheet says.

   Run: node audit/darkstock.mjs        (needs `npx vite preview` on 4173)
   ───────────────────────────────────────────────────────────── */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE || 'http://localhost:4173'
const HERE = dirname(fileURLToPath(import.meta.url))
const findings = []
const m = {}
const bad = (what, detail) => findings.push(`${what}: ${detail}`)

/* The three dark stocks and their grounds, from index.css [data-stock]. Kept
   in sync by hand with audit/tints.mjs — a driver measuring a value the app no
   longer ships is worse than no driver. */
const DARK = [
    { id: 'coal',  label: 'Coal',  bg: '#221E1B', ink: '#F4F2ED' },
    { id: 'dusk',  label: 'Dusk',  bg: '#1B2430', ink: '#D9E4F2' },
    { id: 'pitch', label: 'Pitch', bg: '#000000', ink: '#BFBAB2' },
]

/* Every paragraph in the fixture, and the route each one takes past plain
   inheritance. The label is what a finding names, so it says HOW it escaped. */
const CASES = {
    'p-sheet':  'a stylesheet rule',
    'p-inline': 'an inline style attribute',
    'p-bang':   'an !important declaration in the book',
    'p-fill':   '-webkit-text-fill-color',
    'p-box':    'a light background box',
    'p-halo':   'a text-shadow drawn for a white page',
    'p-plain':  'no author colour at all (the control)',
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
const hex = h => {
    const s = h.replace('#', '')
    return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16))
}
/* getComputedStyle always hands back rgb()/rgba(), never a hex or a keyword,
   so one parser covers every value this driver reads. An alpha below 1 is
   reported rather than composited: a translucent ink over a stock is a
   different measurement, and if one ever appears here it should be seen, not
   averaged away. */
const rgb = s => {
    const n = s.match(/[\d.]+/g)?.map(Number)
    if (!n || n.length < 3) return null
    return { c: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')

const showChrome = async () => {
    const box = await page.locator('.reader-stage').boundingBox()
    const btn = page.getByRole('button', { name: 'Text and page settings' })
    for (let i = 0; i < 3; i++) {
        if (await btn.isVisible().catch(() => false)) return true
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        await page.waitForTimeout(400)
    }
    return btn.isVisible().catch(() => false)
}

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)                                  // splash + seed

await page.goto(BASE + '/open', { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.locator('input[type=file]').setInputFiles(join(HERE, 'fixtures', 'inked.epub'))
await page.waitForURL(/\/book\//, { timeout: 20000 })
    .catch(() => bad('import', 'the fixture never reached a book page'))
await page.waitForTimeout(500)

await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
await page.waitForFunction(() => {
    const v = document.querySelector('foliate-view')
    return !!v && !document.querySelector('.reader-opening')
}, null, { timeout: 25000 })
await page.waitForTimeout(1200)

if (!frame()) {
    bad('open', 'the fixture opened with no section iframe')
} else {
    for (const stock of DARK) {
        if (!await showChrome()) { bad(stock.id, 'the chrome never appeared'); continue }
        /* The settings button is a TOGGLE, so clicking it blind alternates
           open and shut across iterations — which is how this driver measured
           Coal and Pitch and skipped Dusk on its first run. Open only if it is
           not already open. */
        if (!(await page.locator('.sheet').count())) {
            await page.getByRole('button', { name: 'Text and page settings' }).click()
            await page.waitForTimeout(400)
        }
        if (!(await page.locator('.sheet').count())) {
            bad(stock.id, 'the settings sheet did not open')
            continue
        }
        await page.getByRole('tab', { name: 'Page' }).click()
        await page.waitForTimeout(250)
        await page.getByRole('button', { name: stock.label, exact: true }).click()
        await page.waitForTimeout(600)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)

        /* The ground the app actually painted, read off the host — not the
           constant above. If [data-stock] and this driver's table ever
           disagree, that disagreement is itself the finding. */
        const applied = await page.evaluate(() => {
            const r = document.querySelector('.reader')
            return {
                stock: r?.dataset.stock ?? null,
                bg: getComputedStyle(r).getPropertyValue('--stock-bg').trim(),
                ink: getComputedStyle(r).getPropertyValue('--stock-ink').trim(),
            }
        })
        if (applied.stock !== stock.id)
            bad(stock.id, `picking ${stock.label} left data-stock=${applied.stock}`)
        if (applied.bg.toUpperCase() !== stock.bg.toUpperCase())
            bad(stock.id, `--stock-bg is ${applied.bg}, this driver measures ${stock.bg}`)

        const f = frame()
        const read = await f.evaluate(ids => {
            const htmlBg = getComputedStyle(document.documentElement).backgroundColor
            const out = {}
            for (const id of ids) {
                const el = document.getElementById(id)
                if (!el) { out[id] = null; continue }
                const cs = getComputedStyle(el)
                out[id] = {
                    color: cs.color,
                    fill: cs.webkitTextFillColor,
                    bg: cs.backgroundColor,
                    shadow: cs.textShadow,
                    text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40),
                }
            }
            return { htmlBg, out }
        }, Object.keys(CASES))

        const ground = hex(stock.bg)
        const rows = []
        for (const [id, how] of Object.entries(CASES)) {
            const r = read.out[id]
            if (!r) { bad(stock.id, `${id} (${how}) is not in the rendered document`); continue }

            /* The fill colour is what the pixel gets where a book sets it, so
               it is the value measured whenever it differs from `color`. */
            const fg = rgb(r.fill) ?? rgb(r.color)
            const bgp = rgb(r.bg)
            /* A transparent own-background means the stock is behind the
               words. Anything else is a box the book drew and the reset was
               supposed to clear. */
            const boxed = bgp && bgp.a > 0.01
            const behind = boxed ? bgp.c : ground
            if (!fg) { bad(stock.id, `${id} (${how}) has an unreadable computed colour: ${r.color}`); continue }
            if (fg.a < 0.99)
                bad(stock.id, `${id} (${how}) renders at alpha ${fg.a} — a translucent ink is not a measured pair`)

            const cr = ratio(fg.c, behind)
            rows.push({ id, how, fg: fg.c, behind, boxed: !!boxed, cr: +cr.toFixed(2), shadow: r.shadow })

            if (boxed)
                bad(stock.id, `${id} (${how}) still has its own background ${r.bg} — the reset left a box on a dark page`)
            if (cr < 4.5)
                bad(stock.id, `${id} (${how}) measures ${cr.toFixed(2)}:1 — body text needs 4.5:1`)
            if (r.shadow && r.shadow !== 'none')
                bad(stock.id, `${id} (${how}) still carries text-shadow ${r.shadow}`)
        }
        m[stock.id] = { applied, htmlBg: read.htmlBg, rows }

        /* Every hostile paragraph should land on the SAME ink as the control:
           the reset collapses them, it does not merely lighten them. */
        const inks = new Set(rows.map(r => r.fg.join(',')))
        if (inks.size !== 1)
            bad(stock.id, `${inks.size} different inks on one page — the reset lightened rather than collapsed: ${[...inks].join(' | ')}`)
    }
}

if (errors.length) bad('console', errors.join(' | '))

console.log(JSON.stringify(m, null, 2))
for (const s of DARK) {
    const d = m[s.id]
    if (!d) continue
    console.log(`\n${s.label}  ground ${s.bg}  ink ${d.applied.ink}`)
    for (const r of d.rows)
        console.log(`  ${r.cr.toFixed(2).padStart(6)}:1  rgb(${r.fg.join(',')}) on rgb(${r.behind.join(',')})  ${r.how}`)
}
console.log(`\n=== FINDINGS: ${findings.length} ===`)
for (const f of findings) console.log(' - ' + f)
await browser.close()
process.exit(findings.length ? 1 : 0)
