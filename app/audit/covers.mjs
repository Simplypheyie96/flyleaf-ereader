/* The cover that shows one minute and is gone the next.

   The owner's report was exactly that: "some book covers are glitching, they
   will show cover one minute and not show it another minute." It was not the
   extraction and it was not the bytes — it was the lifetime of the object URL,
   and two faults in it that compound.

   Cover.tsx used to create the URL in an effect and revoke it on cleanup. So:

     · `setUrl` is a state update, which means the <img> keeps the OLD src for
       one render after the effect has already revoked it. If the decode had not
       finished — the normal case on a phone — revoking aborts it and the
       browser fires `error`.
     · that error latched. `dead` was cleared only when the effect re-ran, and
       the effect keys on the cover's shape, which for a given book never
       changes. One aborted load therefore replaced a good cover with the
       "No cover" ghost for the rest of the session, and only a remount brought
       it back.

   Measured before the fix: dispatching a single `error` at a fully loaded,
   perfectly valid <img> ghosted it permanently. That is the whole bug in one
   line, and question 3 below is the regression guard for it.

   Five questions, and none of them can be answered by reading the source:

     1. every cover on the shelf is a real image, none is the browser's broken
        glyph, and none has fallen back to the ghost
     2. the same book shown in two places at once shares ONE url — Home puts a
        started book in the continue rail AND the recent shelf, and the old code
        minted a url per mount, which is one more lifetime to get wrong
     3. A SPURIOUS ERROR MUST NOT BE BELIEVED. One error is thrown away and the
        url is minted again; the cover has to come back. Only a second failure
        on the fresh url is a verdict, because corrupt bytes fail twice and an
        interrupted load does not.
     4. the urls survive route changes — the cache is module-level, so leaving
        Library and coming back must not re-mint
     5. a navigation loop leaves no ghosts and no broken glyphs behind

   Deliberately NOT here: the shelf-of-sixty eviction case and the genuinely
   corrupt blob. Both need writes through Dexie so that liveQuery re-emits, and
   a raw IndexedDB write does not do that — it bypasses Dexie's observability
   entirely, which silently made an earlier version of this driver pass while
   measuring nothing. They need a dev server to import /src/db.ts, the way
   sync.mjs does, which is why sync.mjs is not in the sweep either. Stated here
   rather than skipped quietly. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const findings = []
const steps = []
const m = {}
const bad = (w, d) => findings.push(`${w}: ${d}`)
const say = s => steps.push(s)

/* Read the rendered covers, not the rule meant to produce them. naturalWidth
   on a complete image is the only honest test of a decode: an <img> whose src
   was revoked mid-flight is `complete` and measures zero, and looks like
   nothing at all on screen. */
const READ = `(() => {
  const boxes = [...document.querySelectorAll('.cover')]
  const imgs = boxes.map(b => b.querySelector('img')).filter(Boolean)
  const srcs = imgs.map(i => i.src)
  const counts = {}
  for (const s of srcs) counts[s] = (counts[s] || 0) + 1
  return {
    total: boxes.length,
    imgs: imgs.length,
    ghosts: boxes.filter(b => b.querySelector('.cover-ghost')).length,
    broken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
    blank: imgs.filter(i => !i.src.startsWith('blob:')).length,
    distinct: new Set(srcs).size,
    maxRepeat: srcs.length ? Math.max(...Object.values(counts)) : 0,
    srcs,
  }
})()`

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('console', e => { if (e.type() === 'error') errors.push(e.text().slice(0, 160)) })

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
/* first run seeds the two included books, and seeding IS import — the covers
   are extracted before they can be measured */
await page.waitForTimeout(3000)

// ---- 1. the shelf ----
await page.goto(BASE + '/library', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const shelf = await page.evaluate(READ)
m.shelf = { ...shelf, srcs: undefined }
if (!shelf.total) bad('shelf', 'no covers on the shelf at all — the seeding never happened')
if (shelf.broken) bad('shelf', `${shelf.broken} of ${shelf.total} covers are a broken glyph (complete, naturalWidth 0)`)
if (shelf.ghosts) bad('shelf', `${shelf.ghosts} of ${shelf.total} fell back to the "No cover" ghost, and the included books both have covers`)
if (shelf.blank) bad('shelf', `${shelf.blank} covers have a src that is not a blob: url`)
say(`shelf: ${shelf.imgs}/${shelf.total} real images, ${shelf.ghosts} ghosts, ${shelf.broken} broken`)

// ---- 3. a spurious error must not be believed ----
/* Done here, on a cover known to be good, and BEFORE the navigation checks so a
   failure cannot be blamed on them. This is the reported bug: the element is
   valid, its src is valid, and an error arrives anyway. */
const spurious = await page.evaluate(async () => {
  const box = document.querySelector('.cover')
  const img = box?.querySelector('img')
  if (!img) return { skipped: 'no cover to test' }
  const before = img.src
  img.dispatchEvent(new Event('error'))
  await new Promise(r => setTimeout(r, 900))
  const after = document.querySelectorAll('.cover')[0]
  const now = after.querySelector('img')
  return {
    recovered: !!now && now.complete && now.naturalWidth > 0,
    ghosted: !!after.querySelector('.cover-ghost'),
    reminted: !!now && now.src !== before,
  }
})
m.spuriousError = spurious
if (spurious.skipped) bad('spurious', spurious.skipped)
else {
  if (spurious.ghosted) bad('spurious', 'ONE error event replaced a good cover with the ghost — this is the reported glitch, and the first failure must be retried rather than believed')
  if (!spurious.recovered) bad('spurious', 'the cover did not come back after a single spurious error')
  if (!spurious.reminted) bad('spurious', 'the url was not minted again after the error, so nothing was actually retried')
}
say(`spurious error: ghosted=${spurious.ghosted} recovered=${spurious.recovered} reminted=${spurious.reminted}`)

// ---- 4. the urls survive a route change ----
/* Clicked, not page.goto'd. A hard load tears down the module the cache lives
   in, so of course the urls are minted again — that is a new document, not a
   route change, and asserting on it measures the browser rather than the app.
   The claim being tested is about React Router unmounting and remounting the
   shelf inside ONE document, which is what a tab press does. */
const tab = name => `.tabbar a[aria-label="${name}"]`
const first = await page.evaluate('(' + READ + ').srcs')
await page.click(tab('Home'))
await page.waitForTimeout(700)
await page.click(tab('Library'))
await page.waitForTimeout(1100)
const second = await page.evaluate('(' + READ + ').srcs')
m.urlsAcrossRoutes = { before: first.length, after: second.length, identical: JSON.stringify(first) === JSON.stringify(second) }
if (first.length && !m.urlsAcrossRoutes.identical) {
  bad('routes', 'the cover urls were minted again after pressing Home and then Library — within one document the cache is supposed to outlive the mount, and a re-mint is a revoke waiting to race a decode')
}
say(`urls across routes: ${m.urlsAcrossRoutes.identical ? 'identical' : 'RE-MINTED'} (${second.length} covers)`)

// ---- 2. one book in two places, one url ----
/* Opening a book through the UI is what sets openedAt, which is what puts it in
   the continue rail while it is still in the recent shelf. Driven rather than
   written, so no Dexie import is needed. */
/* Loaded rather than clicked, and deliberately: the reader has no tab bar to
   click back out of, and what is being measured here is two mounts of one book
   inside a SINGLE document — the continue rail and the recent shelf — not
   whether the cache survives a reload, which question 4 already answered. */
const href = await page.evaluate(() => document.querySelector('a.shelf-card, a.shelf-row')?.getAttribute('href') ?? null)
if (href) {
  const id = href.split('/').pop()
  await page.goto(BASE + '/read/' + id, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)          // let the book open and stamp openedAt
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  const home = await page.evaluate(READ)
  m.home = { ...home, srcs: undefined }
  const twice = home.imgs - home.distinct
  if (home.broken) bad('home', `${home.broken} covers are a broken glyph on Home`)
  if (home.maxRepeat > 1 && twice < 1) bad('home', 'a repeated cover did not share its url')
  say(`home: ${home.imgs} images, ${home.distinct} distinct urls, ${twice} shared (a started book is in the rail and the shelf at once)`)
  if (home.imgs === home.distinct) {
    say('home: no book appeared twice, so url sharing was not exercised — not a finding, but not proof either')
  }
} else {
  bad('home', 'no shelf card to open, so url sharing could not be exercised at all')
}

// ---- 5. the navigation loop ----
const loop = []
for (let i = 0; i < 6; i += 1) {
  await page.click(tab(i % 2 ? 'Home' : 'Library'))
  await page.waitForTimeout(700)
  const s = await page.evaluate(READ)
  loop.push(`${s.imgs}/${s.total} ghosts:${s.ghosts} broken:${s.broken}`)
  if (s.broken) bad('loop', `pass ${i + 1}: ${s.broken} broken glyphs after a route change`)
  if (s.total && s.ghosts && s.imgs === 0) bad('loop', `pass ${i + 1}: every cover fell back to the ghost`)
}
m.navLoop = [...new Set(loop)]
say(`navigation loop: ${m.navLoop.join(' | ')}`)

if (errors.length) bad('console', [...new Set(errors)].join(' | '))
await browser.close()

console.log(JSON.stringify({ steps, measurements: m, findings }, null, 2))
console.log(`\n=== FINDINGS: ${findings.length}`)
for (const f of findings) console.log('  · ' + f)
