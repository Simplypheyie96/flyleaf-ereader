/* Does the reading face ACTUALLY change?

   This driver exists because of a real, reported bug: "Literata, EB Garamond
   and Source Serif all just remain the same and the font doesn't change." The
   cause was that installFonts() declares @font-face in the HOST document, and a
   book section is a blob: URL iframe — a separate document, which had never
   heard of any of these families and silently fell back to Georgia. Four serif
   choices that all looked identical, because they were all Georgia.

   So a fix here cannot be verified by reading the code. It has to be verified
   from INSIDE the book document, and the two facts that matter are:

     1. document.fonts.check() says the family is available and loaded there.
     2. The same string measures a DIFFERENT WIDTH in each family. This is the
        proof that survives everything: two faces that render identically
        measure identically, whatever the stylesheet claims.

   Georgia is measured too, as the control. Any face whose width matches
   Georgia's to the pixel is a face that fell back.

   One driver mechanic worth knowing before reading a run: the setting is
   written straight into IndexedDB, and Dexie's liveQuery does NOT observe a
   raw IDB write — it only sees mutations made through Dexie itself. So a write
   alone leaves the running app on whatever face it already had, and every
   other face reads back as "no rule, fell back", which looks exactly like the
   bug this driver exists to catch. The loop therefore reloads /read/:id after
   each write, so the app boots with the face already in the row. The real,
   no-reload path is checked separately at the end by clicking a chip. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const findings = []
const bad = (what, detail) => findings.push({ what, detail })

/* Kept in sync with READING_FACES by hand, on purpose: a driver that imports
   the list it is testing cannot catch a face that was added to the type but
   never given an @font-face rule. */
const FACES = [
  ['literata', 'Literata'], ['garamond', 'EB Garamond'], ['source-serif', 'Source Serif 4'],
  ['newsreader', 'Newsreader'], ['lora', 'Lora'],
  ['inter', 'Inter'], ['source-sans', 'Source Sans 3'], ['nunito', 'Nunito Sans'],
  ['mulish', 'Mulish'], ['plex-sans', 'IBM Plex Sans'], ['franklin', 'Libre Franklin'],
  ['dm-sans', 'DM Sans'], ['figtree', 'Figtree'], ['work-sans', 'Work Sans'],
  ['atkinson', 'Atkinson Hyperlegible'],
]

const SPECIMEN = 'Handgloves quick brown fox 0123456789'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
const href = await page.locator('a[href^="/book/"]').first().getAttribute('href')
const id = href.split('/').pop()

const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')

/** Open the reader from cold and wait until a section is really laid out. */
async function openReader() {
  await page.goto(`${BASE}/read/${id}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const v = document.querySelector('foliate-view')
    return !!v && !document.querySelector('.reader-opening')
  }, null, { timeout: 25000 }).catch(() => bad('open', 'the book never finished opening'))
  /* The section document cannot be waited for from inside the page: foliate
     puts its iframes in a CLOSED shadow root, so the host document's own
     querySelectorAll('iframe') never sees them. Playwright's frame list does,
     regardless of shadow encapsulation, so the wait is done from Node. */
  for (let i = 0; i < 60; i++) {
    const f = frame()
    if (f && await f.evaluate(() => !!document.body?.textContent?.trim()).catch(() => false)) break
    if (i === 59) bad('open', 'no section document appeared')
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(500)
}

/** Write the face into the settings row. Dexie will not notice — see header. */
async function writeFace(face) {
  await page.evaluate(async (face) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('flyleaf-ereader')
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
    })
    const tx = db.transaction('settings', 'readwrite')
    const store = tx.objectStore('settings')
    const row = await new Promise((res) => { const g = store.get(1); g.onsuccess = () => res(g.result) })
    store.put({ ...row, id: 1, face })
    await new Promise((res) => { tx.oncomplete = res })
    db.close()
  }, face)
}

/** Measure one family from inside the section document. */
const measure = (f, family) => f.evaluate(({ family, text }) => {
  const c = document.createElement('canvas').getContext('2d')
  c.font = `20px "${family}"`
  const width = Math.round(c.measureText(text).width * 100) / 100
  const p = document.querySelector('p, div, body')
  return {
    width,
    available: document.fonts.check(`20px "${family}"`),
    declared: [...document.fonts].map(ff => ff.family).filter(x => x === family).length,
    applied: getComputedStyle(p).fontFamily,
  }
}, { family, text: SPECIMEN })

await openReader()

/* The control. Measured in the book document, in the fallback the bug used
   to leave everything in. */
const control = await frame().evaluate((text) => {
  const c = document.createElement('canvas').getContext('2d')
  c.font = '20px Georgia, serif'
  return Math.round(c.measureText(text).width * 100) / 100
}, SPECIMEN)

const rows = []
for (const [id_, family] of FACES) {
  await writeFace(id_)
  await openReader()

  const f = frame()
  if (!f) { bad('frame', `${id_}: no section iframe`); continue }

  const r = await measure(f, family)
  rows.push({ id: id_, family, ...r })

  if (!r.declared) bad('rule', `${id_}: no @font-face for "${family}" inside the book document`)
  if (!r.available) bad('load', `${id_}: "${family}" declared but not loaded in the book document`)
  if (!r.applied.includes(family)) bad('apply', `${id_}: the page is set in ${r.applied}, not ${family}`)
  if (Math.abs(r.width - control) < 0.5) {
    /* Gelasio used to be exempted here: it is metric-compatible with Georgia by
       design, so identical advance widths were its purpose rather than a
       fallback, and it was checked by drawing the specimen twice and comparing
       pixels instead. It has since been removed from the list, so this branch
       is unconditional again — no face left in the picker is supposed to
       measure the same as the fallback. */
    bad('fallback', `${id_}: measures ${r.width} against Georgia's ${control} — it is rendering as the fallback`)
  }
}

/* Distinctness. Two faces measuring the same width is the exact symptom the
   reader reported, so it is checked as a pair-wise fact and not inferred. */
const byWidth = new Map()
for (const r of rows) {
  const key = r.width.toFixed(2)
  byWidth.set(key, [...(byWidth.get(key) ?? []), r.id])
}
for (const [w, ids] of byWidth) {
  if (ids.length > 1) bad('identical', `${ids.join(' and ')} both measure ${w} — they render the same`)
}
/* No exemption here any more. Gelasio was the one face allowed to collide,
   because it is metric-compatible with Georgia by design; it is off the list,
   so any collision from here on is the reported bug and not a property of the
   typeface. */

/* The live path. Everything above boots with the face already set, which
   proves the RULES reach the section document but not that CHANGING the face
   mid-read does. That is what the reader actually reported, so it is clicked:
   open the sheet, press a chip for a face the book is not currently in, and
   measure again without a reload. */
let live = null
{
  await writeFace('literata')
  await openReader()
  const before = await measure(frame(), 'Literata')
  /* The bars auto-hide while reading, so the chrome is summoned first — a tap
     in the middle of the page, which is what a reader does. Retried rather
     than tapped once: the first tap after a fresh open can land before the
     gesture layer is listening, and a single-shot reveal reads as "the sheet
     will not open", which is a false accusation against the app. */
  const openSheet = page.getByRole('button', { name: 'Text and page settings' })
  for (let i = 0; i < 5; i++) {
    if (await openSheet.isVisible().catch(() => false)) break
    await page.mouse.click(195, 422)
    await page.waitForTimeout(500)
  }
  await openSheet.click({ timeout: 4000 }).catch(() => bad('live', 'could not open the reading sheet'))
  await page.waitForTimeout(400)
  const chip = page.locator('.sheet-opt--face', { hasText: /^Lora$/ }).first()
  await chip.click().catch(() => bad('live', 'could not find the Lora chip in the sheet'))
  await page.waitForTimeout(1200)
  const after = await measure(frame(), 'Lora')
  live = { before: before.width, after: after.width, applied: after.applied }
  if (!after.declared) bad('live', 'after clicking Lora, no @font-face for it reached the section document')
  if (!after.applied.includes('Lora')) bad('live', `after clicking Lora the page is still set in ${after.applied}`)
}

console.log(`Georgia control: ${control}\n`)
for (const r of rows) {
  console.log(
    `  ${r.id.padEnd(13)} ${String(r.width).padStart(7)}  ` +
    `${r.available ? 'loaded ' : 'MISSING'}  rules:${r.declared}  ${r.applied.split(',')[0]}`
  )
}
if (live) console.log(`\n  live chip click: Literata ${live.before} -> Lora ${live.after}  (${live.applied.split(',')[0]})`)
console.log(`\n=== FINDINGS: ${findings.length} ===`)
for (const f of findings) console.log(`  [${f.what}] ${f.detail}`)

await browser.close()
