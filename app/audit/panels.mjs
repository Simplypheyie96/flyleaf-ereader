/* Every panel Settings is supposed to show, present and visible.

   This driver exists because of a bug that no other one could have caught. The
   Drive sync panel is gated on a build-time client ID — `SYNC_AVAILABLE` is
   `CLIENT_ID.length > 0`, and `SyncPanel` returns `null` when it is false. The
   ID was unset, so a finished, tested, working feature rendered as nothing at
   all, on every build, for weeks. The owner asked "where is google sync?" three
   times before it was traced.

   Nothing failed. `sync.mjs` passed the whole time and was right to: it tests
   the merge fold in `record.ts` directly, deliberately touching neither the UI
   nor Google. `a11y.mjs` and `states.mjs` passed too — an absent section has no
   contrast to fail and no state to be wrong in. That is the shape of the whole
   class: a component that returns `null` is invisible to every driver that
   measures what is on screen, because measuring nothing measures fine.

   So this one asserts PRESENCE, which is the only thing the others assume. It
   is deliberately dumb: no geometry, no colour, no behaviour — just that each
   panel the page is built to render is in the document and on screen. A panel
   that disappears behind a flag, an early return or a thrown render is a
   finding here, and the finding names it.

   The Drive panel's own gate is checked from the outside rather than trusted:
   the bundle is asked whether it was built with an ID, and the panel is then
   required to be there.

   The first draft of this file got that wrong in the exact way the bug did. It
   required the panel to be present if the bundle had an ID and absent if it did
   not, and called the two agreeing a pass — which means an ID-less build scored
   zero findings with the panel gone, which is the original bug reported as
   health. "Consistent" was never the property worth testing. The property is
   that Drive sync SHIPS: a build with no client ID is itself the finding, named
   as such, because it silently removes a finished feature from the product.  */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = 'http://localhost:4173'
/* The eight static panels, in the order SettingsPage renders them, plus the
   conditional ninth handled separately below. */
const PANELS = [
    'Theme', 'This device', 'Your library', 'Backup',
    'Included books', 'The Flyleaf apps', 'The small print', 'Version',
]
const SYNC = 'Google Drive sync'

const findings = []
const bad = (tag, msg) => { findings.push(`[${tag}] ${msg}`); console.log(`    ✗ [${tag}] ${msg}`) }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', e => bad('crash', `page error: ${e.message}`))

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })

/* Did this build ship a client ID? Read it off the served bundle rather than
   off the environment, so the answer is the one the browser actually got. */
const built = await page.evaluate(async () => {
    const src = [...document.querySelectorAll('script[src]')].map(s => s.src)
    for (const u of src) {
        if (!/\/assets\/index-/.test(u)) continue
        const t = await (await fetch(u)).text()
        return /\.apps\.googleusercontent\.com/.test(t)
    }
    return null
})
if (built === null)
    bad('setup', 'could not find the entry bundle to read the client ID from')
else if (!built)
    bad('unbuilt', 'no Google client ID in the bundle, so SYNC_AVAILABLE is false and the whole '
        + 'Drive panel returns null — a finished feature shipped as nothing. Set '
        + 'VITE_GOOGLE_CLIENT_ID in app/.env.local and in the Vercel project, then rebuild.')
else console.log('ok   the bundle was built with a Google client ID')

const count = await page.locator('section.panel').count()
console.log(`ok   ${count} panels rendered`)

/* SYNC is required unconditionally: see the gate note in the header. */
for (const name of [...PANELS, SYNC]) {
    const sec = page.locator('section.panel', { hasText: name }).first()
    if (!(await sec.count())) { bad('missing', `no panel headed "${name}"`); continue }
    if (!(await sec.isVisible())) { bad('hidden', `the "${name}" panel is in the DOM but not visible`); continue }
    const box = await sec.boundingBox()
    if (!box || box.height < 24) bad('collapsed', `the "${name}" panel measures ${box ? Math.round(box.height) : 0}px tall`)
    else console.log(`ok   ${name}`)
}

/* And the gate itself, for the one combination the loop above cannot explain:
   a panel on screen that the bundle cannot possibly serve. */
const syncSeen = (await page.locator('section.panel', { hasText: SYNC }).count()) > 0
if (built === false && syncSeen)
    bad('gate', 'the Drive panel renders with no client ID in the bundle — Connect would fail on every press')
else if (built === true && syncSeen) console.log('ok   the Drive panel is served by a bundle that can back it')

console.log('\n=== FINDINGS: ' + findings.length + ' ===')
findings.forEach(f => console.log('  ' + f))
await browser.close()
process.exit(findings.length ? 1 : 0)
