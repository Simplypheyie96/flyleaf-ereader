/* Settings' theme picker paints four dots and one split dot. Each dot has to
   hard-code its hex, because it shows a theme that is NOT the active one — so
   var(--paper) would paint all five alike. Hard-coded means it can drift, and
   Ink's did: it went on painting the retired warm brown #2E2823 / #E4D9C6 for a
   release after the theme itself was re-hued blue, so the picker offered a brown
   dot for a blue theme. This driver reads each dot's computed background against
   the theme's own live tokens, so the next drift is a finding rather than
   something the owner has to spot.

     node audit/swatches.mjs
*/
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const findings = []
const bad = (w, m) => findings.push(`${w}: ${m}`)

const hex = s => {
    const m = s.match(/\d+/g)
    return m ? '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase() : s
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.goto(BASE + '/settings')
await page.waitForTimeout(900)

const seen = await page.evaluate(() => {
    const dots = [...document.querySelectorAll('.seg-swatch')].map(el => {
        const cs = getComputedStyle(el)
        return {
            sw: el.dataset.sw,
            bg: cs.backgroundColor,
            image: cs.backgroundImage,
            ink: cs.getPropertyValue('--sw-ink').trim(),
        }
    })
    /* The live tokens, read by driving :root's data-theme through each value —
       the same switch the picker performs, so this compares the dot against what
       choosing it actually does. */
    const live = {}
    const root = document.documentElement
    const prev = root.dataset.theme
    for (const t of ['light', 'sepia', 'ink', 'dark']) {
        root.dataset.theme = t
        const cs = getComputedStyle(root)
        live[t] = { paper: cs.getPropertyValue('--paper').trim(), ink: cs.getPropertyValue('--ink').trim() }
    }
    if (prev) root.dataset.theme = prev
    else delete root.dataset.theme
    return { dots, live }
})

if (seen.dots.length !== 5) bad('picker', `${seen.dots.length} swatches, expected 5`)

for (const d of seen.dots) {
    /* System is the one dot with no theme of its own: it is a hard split of the
       light and dark grounds, so it is checked against both rather than one. */
    if (d.sw === 'system') {
        /* Computed, the gradient comes back as rgb() stops however it was
           authored, so the stops are hexed before they are compared. */
        const stops = new Set((d.image.match(/rgba?\([^)]*\)/g) || []).map(hex))
        for (const t of ['light', 'dark']) {
            const want = seen.live[t].paper.toUpperCase()
            if (!stops.has(want))
                bad('system swatch', `does not carry the ${t} ground ${want}: ${[...stops].join(' ') || d.image}`)
        }
        continue
    }
    const want = seen.live[d.sw]
    if (!want) { bad(`${d.sw} swatch`, 'no theme of that name') ; continue }
    const gotBg = hex(d.bg), wantBg = want.paper.toUpperCase()
    const gotInk = d.ink.toUpperCase(), wantInk = want.ink.toUpperCase()
    if (gotBg !== wantBg) bad(`${d.sw} swatch`, `ground ${gotBg}, theme is ${wantBg}`)
    if (gotInk !== wantInk) bad(`${d.sw} swatch`, `ink ${gotInk || '(unset)'}, theme is ${wantInk}`)
    if (gotBg === wantBg && gotInk === wantInk)
        console.log(`ok   ${d.sw.padEnd(6)} ${gotBg} / ${gotInk}`)
}
if (!findings.some(f => f.startsWith('system'))) console.log('ok   system split carries both grounds')

console.log('\n=== FINDINGS: ' + findings.length + ' ===')
findings.forEach(f => console.log('  ' + f))
await browser.close()
process.exit(findings.length ? 1 : 0)
