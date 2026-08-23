/* ─────────────────────────────────────────────────────────────
   P5, part one: the backup, end to end, across a device boundary.

   Every other driver in this folder measures a surface. This one measures a
   promise — that a reader whose phone is wiped can get their library back —
   and the only honest test of a promise like that is a real round trip. So
   this uses TWO browser contexts. Separate origin storage, separate service
   worker, separate IndexedDB: as close to a second device as a headless
   browser gets. Nothing crosses between them but one file on disk.

   FIVE CLAIMS

   1. THE FILE CARRIES THE BOOKS, not a note about them. Device B has never
      seen the fixture PDF. If the bytes are not in the backup, its shelf row
      opens to nothing.
   2. THE POSITIONS SURVIVE, for both kinds of book — a PDF, whose locator is
      a page and a fraction, and a reflowable EPUB, whose locator is a CFI
      that has to be re-derived against a fresh paginator. A backup that
      restores the books and loses where you were has restored a bookshelf.
   3. THE MARKS SURVIVE. A bookmark made on device A is in device B's marks
      list, with its excerpt.
   4. A RESTORE MERGES, NEVER DELETES. Device B has the two included books
      before the restore and the backup carries them too, so the result must
      be exactly one book added and two updated — and every book already on
      that shelf is still there afterwards.
   5. A FILE THAT IS NOT A BACKUP IS REFUSED BY NAME, and the library is
      untouched. "That is not a Flyleaf backup file." is a sentence a reader
      can act on; a stack trace in the console is not.

   Run: npx vite build && node audit/backup.mjs
   ───────────────────────────────────────────────────────────── */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { mkdtempSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BASE || 'http://localhost:4173'
const PDF = join(HERE, 'fixtures', 'measured-page.pdf')
const NOT_A_BACKUP = join(HERE, 'fixtures', 'fixture.txt')
const OUT = join(mkdtempSync(join(tmpdir(), 'flyleaf-backup-')), 'library.flyleaf')

const out = { steps: [], findings: [], measures: {} }
const say = s => out.steps.push(s)
const bad = (what, detail) => out.findings.push({ what, detail })
const m = out.measures

const browser = await chromium.launch()

/* One watcher, reused for both devices: a console error during a restore is
   the difference between "it merged" and "it half-merged and gave up". */
const watch = (page, tag, sink) => {
    page.on('console', e => { if (e.type() === 'error') sink.push(`${tag}: ${e.text().slice(0, 180)}`) })
    page.on('pageerror', e => sink.push(`${tag} pageerror: ${e.message.slice(0, 180)}`))
}
const readout = page => page.evaluate(() =>
    document.querySelector('.reader-readout')?.innerText.replace(/\s+/g, ' ').trim() ?? null)
/* The bars hide themselves while reading; a tap on the page brings them back.
   Lifted from pdf.mjs, and it has to tolerate either reader's labels. */
const ensureChrome = async (page) => {
    for (let i = 0; i < 4; i++) {
        const shown = await page.evaluate(() => {
            const b = document.querySelector('.reader-bar--top button')
            if (!b) return false
            const cs = getComputedStyle(b)
            return b.getClientRects().length > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.5
        })
        if (shown) return true
        await page.locator('.reader-stage').click({ position: { x: 195, y: 430 } }).catch(() => {})
        await page.waitForTimeout(420)
    }
    return false
}
const marksList = async (page, panelLabel) => {
    await ensureChrome(page)
    await page.locator(`button[aria-label="${panelLabel}"]`).click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)
    await page.locator('.panel-tab', { hasText: /Marks/i }).click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(500)
    /* The kind tabs are read but never clicked. On a reflowable book the marks
       list has three of them, and where it opens is part of what is being
       measured: a reader whose only mark is a bookmark should not land on an
       empty Highlights list. Reporting the counts alongside the rows keeps
       "the bookmark is missing" separate from "the panel opened on the wrong
       tab" — two findings that look identical from an empty list. */
    const seen = await page.evaluate(() => ({
        rows: Array.from(document.querySelectorAll('.panel-item .panel-excerpt:not(.panel-excerpt--find)'))
            .map(el => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 70)),
        kinds: Array.from(document.querySelectorAll('.panel-kind')).map(b => ({
            label: b.innerText.replace(/\s+/g, ' ').trim(),
            on: b.getAttribute('aria-selected') === 'true',
        })),
    }))
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
    return seen
}

/* ══ DEVICE A ═══════════════════════════════════════════════════════════════
   A library worth losing: two included books, one imported PDF, a position
   in each of two of them, a bookmark in each. */
const errsA = []
const a = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
const pa = await a.newPage()
watch(pa, 'A', errsA)

await pa.goto(BASE + '/', { waitUntil: 'networkidle' })
await pa.waitForTimeout(3200)                                     // splash + first-run seed
m.deviceA = { seeded: await pa.locator('a.shelf-card').count() }
if (m.deviceA.seeded !== 2)
    bad('seed', `device A came up with ${m.deviceA.seeded} included books, expected 2`)
say(`device A: ${m.deviceA.seeded} included books on the shelf`)

/* ── the reflowable half: a real CFI position and a CFI bookmark ─────────── */
m.deviceA.epubTitle = await pa.locator('.shelf-title').first().innerText()
await pa.locator('a.shelf-card').first().click()
await pa.waitForTimeout(600)
await pa.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
await pa.waitForFunction(() => !!document.querySelector('foliate-view') && !document.querySelector('.reader-opening'),
    null, { timeout: 30000 }).catch(() => bad('open', 'the included book never opened on device A'))
await pa.waitForTimeout(1500)
/* Six turns in, so the saved locator cannot be mistaken for "the start of the
   book" — a restore that silently drops the position would land on page 1 and
   look plausible. */
for (let i = 0; i < 6; i++) { await pa.keyboard.press('ArrowRight'); await pa.waitForTimeout(420) }
await ensureChrome(pa)
await pa.locator('button[aria-label="Bookmark this page"]').click({ timeout: 6000 })
    .catch(() => bad('bookmark', 'the reflowable bookmark button would not click on device A'))
await pa.waitForTimeout(700)
m.deviceA.epubReadout = await readout(pa)
m.deviceA.epubMarks = await marksList(pa, 'Contents, marks and search')
say(`device A, "${m.deviceA.epubTitle}": ${m.deviceA.epubReadout} · marks ${JSON.stringify(m.deviceA.epubMarks)}`)
if (!m.deviceA.epubMarks.rows.length)
    bad('bookmark', 'the reflowable marks list is empty on device A, on the kind it opened on'
        + ` — tabs read ${JSON.stringify(m.deviceA.epubMarks.kinds)}`)

/* ── the PDF half: bytes that only exist on this device ──────────────────── */
await pa.goto(BASE + '/open', { waitUntil: 'networkidle' })
await pa.waitForTimeout(300)
await pa.locator('input[type=file]').setInputFiles(PDF)
await pa.waitForURL(/\/book\//, { timeout: 30000 }).catch(() => bad('import', 'the PDF never imported'))
await pa.waitForTimeout(900)
await pa.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
await pa.waitForFunction(() => !!document.querySelector('.pdf-canvas') && !document.querySelector('.reader-opening'),
    null, { timeout: 30000 }).catch(() => bad('open', 'the PDF never opened on device A'))
await pa.waitForTimeout(1300)
await ensureChrome(pa)
await pa.locator('button[aria-label="Contents, bookmarks and search"]').click()
await pa.waitForTimeout(500)
await pa.locator('.reader-toc-link', { hasText: 'Chapter 2' }).click({ timeout: 6000 })
    .catch(() => bad('outline', 'Chapter 2 would not click on device A'))
await pa.waitForTimeout(1500)
await ensureChrome(pa)
await pa.locator('button[aria-label="Bookmark this page"]').click({ timeout: 6000 })
    .catch(() => bad('bookmark', 'the PDF bookmark button would not click on device A'))
await pa.waitForTimeout(700)
m.deviceA.pdfReadout = await readout(pa)
m.deviceA.pdfMarks = await marksList(pa, 'Contents, bookmarks and search')
if (!/page 5 of 12/i.test(m.deviceA.pdfReadout ?? ''))
    bad('setup', `device A was meant to be left on page 5; the readout says "${m.deviceA.pdfReadout}"`)
say(`device A, the PDF: "${m.deviceA.pdfReadout}" · marks ${JSON.stringify(m.deviceA.pdfMarks)}`)

/* ── claim 5, before the export: a file that is not a backup ─────────────── */
await pa.goto(BASE + '/settings', { waitUntil: 'networkidle' })
await pa.waitForTimeout(700)
const shelfLine = () => pa.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.mono-meta')).find(el => /\bbooks?\b/.test(el.textContent ?? ''))
    return p?.textContent.replace(/\s+/g, ' ').trim() ?? null
})
m.beforeRefusal = await shelfLine()
/* Located by its place, not by an accept attribute: the accept list was
   removed because `.flyleaf` resolves to no Uniform Type Identifier and iOS
   greyed out the reader's own backup file. .set-acts is the restore panel's
   own action row. */
await pa.locator('.set-acts input[type=file]').setInputFiles(NOT_A_BACKUP)
await pa.waitForTimeout(1200)
m.refusal = await pa.evaluate(() => ({
    alert: document.querySelector('[role=alert]')?.textContent?.trim() ?? null,
    confirm: !!document.querySelector('.set-confirm'),
}))
/* Loose on the product name deliberately. The app says "not a Flyleaf eReader
   backup file"; an exact-string assertion here failed the whole driver the
   moment the naming sweep renamed the app, reporting a real refusal as a
   missing one. What is being checked is that the sentence names the problem,
   not how the product spells itself. */
if (!/not a Flyleaf\b[^.]*backup/i.test(m.refusal.alert ?? ''))
    bad('refusal', `a .txt fed to the restore control said "${m.refusal.alert}" — not a sentence naming the problem`)
else say(`refused a .txt: "${m.refusal.alert}"`)
if (m.refusal.confirm)
    bad('refusal', 'a refused file still opened the restore confirmation')
m.afterRefusal = await shelfLine()
if (m.afterRefusal !== m.beforeRefusal)
    bad('refusal', `the library changed on a refused file: "${m.beforeRefusal}" → "${m.afterRefusal}"`)

/* ── the export ─────────────────────────────────────────────────────────── */
const dl = pa.waitForEvent('download', { timeout: 60000 })
await pa.getByRole('button', { name: /Export a backup/ }).click()
const file = await dl
m.export = { suggested: file.suggestedFilename() }
await file.saveAs(OUT)
m.export.bytes = (await stat(OUT)).size
/* The name carries a date because a reader will end up with several of these
   in one folder, and "library.flyleaf" twice is a file they cannot choose
   between. */
if (!/^flyleaf-library-\d{4}-\d{2}-\d{2}\.flyleaf$/.test(m.export.suggested))
    bad('export', `the backup is named "${m.export.suggested}" — not flyleaf-library-YYYY-MM-DD.flyleaf`)
/* Three books, one of them a PDF: anything under a few hundred KB means the
   blobs did not go in. */
if (m.export.bytes < 200_000)
    bad('export', `the backup is only ${m.export.bytes} bytes — the book files are not in it`)
m.export.wrote = await pa.evaluate(() => Array.from(document.querySelectorAll('.mono-meta'))
    .map(el => el.textContent.replace(/\s+/g, ' ').trim()).find(t => /\.flyleaf/.test(t)) ?? null)
say(`exported ${m.export.suggested}, ${(m.export.bytes / 1024 / 1024).toFixed(2)} MB — page says "${m.export.wrote}"`)
if (errsA.length) { bad('device A', 'console errors — ' + errsA.join(' | ')); errsA.length = 0 }
await a.close()

/* ══ DEVICE B ═══════════════════════════════════════════════════════════════
   A phone that has never seen any of this. */
const errsB = []
const b = await browser.newContext({ viewport: { width: 390, height: 844 } })
const pb = await b.newPage()
watch(pb, 'B', errsB)

await pb.goto(BASE + '/', { waitUntil: 'networkidle' })
await pb.waitForTimeout(3200)
m.deviceB = { before: await pb.locator('.shelf-title').allInnerTexts() }
if (m.deviceB.before.length !== 2)
    bad('device B', `a fresh device came up with ${m.deviceB.before.length} books, expected the 2 included ones`)
say(`device B before the restore: ${JSON.stringify(m.deviceB.before)}`)

await pb.goto(BASE + '/settings', { waitUntil: 'networkidle' })
await pb.waitForTimeout(700)
await pb.locator('.set-acts input[type=file]').setInputFiles(OUT)
await pb.waitForTimeout(2500)
m.deviceB.confirm = await pb.evaluate(() => {
    const c = document.querySelector('.set-confirm')
    return c ? c.innerText.replace(/\s+/g, ' ').trim() : null
})
if (!m.deviceB.confirm) bad('restore', 'the backup opened no confirmation step')
else {
    /* The confirm has to name what the file holds before it is allowed to write
       anything: three books, and the marks made on device A. */
    if (!/\b3 books\b/.test(m.deviceB.confirm))
        bad('restore', `the confirmation does not say 3 books — "${m.deviceB.confirm.slice(0, 120)}"`)
    if (!/\b2 bookmarks\b/.test(m.deviceB.confirm))
        bad('restore', `the confirmation does not say 2 bookmarks — "${m.deviceB.confirm.slice(0, 120)}"`)
    if (!/Nothing is deleted/i.test(m.deviceB.confirm))
        bad('restore', 'the confirmation never says what a restore does to what is already here')
    say(`device B confirm: "${m.deviceB.confirm.slice(0, 150)}"`)
}

await pb.getByRole('button', { name: /^Restore$/ }).click({ timeout: 6000 })
    .catch(() => bad('restore', 'the Restore button would not click'))
await pb.waitForTimeout(4000)
m.deviceB.result = await pb.evaluate(() =>
    document.querySelector('[role=status]')?.textContent.replace(/\s+/g, ' ').trim() ?? null)
/* Claim 4, in the app's own words. One book device B has never seen, two it
   already had. */
if (!/1 added to your library/.test(m.deviceB.result ?? ''))
    bad('restore', `the result line reads "${m.deviceB.result}" — expected exactly one book added`)
if (!/2 already here, updated/.test(m.deviceB.result ?? ''))
    bad('restore', `the result line reads "${m.deviceB.result}" — expected the two included books to be updated, not duplicated`)
if (/missing from the backup/.test(m.deviceB.result ?? ''))
    bad('restore', `a book came back with no file — "${m.deviceB.result}"`)
say(`device B restored: "${m.deviceB.result}"`)

await pb.goto(BASE + '/', { waitUntil: 'networkidle' })
await pb.waitForTimeout(1600)
m.deviceB.after = await pb.locator('.shelf-title').allInnerTexts()
if (m.deviceB.after.length !== 3)
    bad('restore', `the shelf holds ${m.deviceB.after.length} books after the restore, expected 3 — ${JSON.stringify(m.deviceB.after)}`)
for (const t of m.deviceB.before)
    if (!m.deviceB.after.includes(t)) bad('restore', `"${t}" was on the shelf before the restore and is gone after it`)
if (!m.deviceB.after.includes('The Measured Page'))
    bad('restore', `the imported PDF is not on device B's shelf — ${JSON.stringify(m.deviceB.after)}`)
say(`device B after the restore: ${JSON.stringify(m.deviceB.after)}`)

/* ── claims 1–3 for the PDF: the bytes, the page, the bookmark ───────────── */
await pb.locator('a.shelf-card', { hasText: 'The Measured Page' }).click({ timeout: 6000 })
    .catch(() => bad('restore', 'the restored PDF has no shelf card to open'))
await pb.waitForTimeout(800)
/* "Continue", not "Start reading": the button's own label is the first
    evidence that a position came across with the book. */
m.deviceB.pdfCta = await pb.evaluate(() => Array.from(document.querySelectorAll('button'))
    .map(x => x.textContent.trim()).find(t => /Start reading|Continue|Read again/.test(t)) ?? null)
if (!/Continue/.test(m.deviceB.pdfCta ?? ''))
    bad('position', `device B offers "${m.deviceB.pdfCta}" on a book it was half way through`)
await pb.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
await pb.waitForFunction(() => !!document.querySelector('.pdf-canvas') && !document.querySelector('.reader-opening'),
    null, { timeout: 30000 }).catch(() => bad('restore', 'the restored PDF never rendered — the file did not come across'))
await pb.waitForTimeout(1600)
await ensureChrome(pb)
m.deviceB.pdfReadout = await readout(pb)
if (!/page 5 of 12/i.test(m.deviceB.pdfReadout ?? ''))
    bad('position', `left on page 5, reopened on device B at "${m.deviceB.pdfReadout}"`)
else say(`device B opened the PDF at "${m.deviceB.pdfReadout}"`)
m.deviceB.pdfMarks = await marksList(pb, 'Contents, bookmarks and search')
if (!m.deviceB.pdfMarks.rows.length)
    bad('marks', 'the PDF bookmark did not survive the restore')
else if (m.deviceB.pdfMarks.rows[0] !== m.deviceA.pdfMarks.rows[0])
    bad('marks', `the bookmark excerpt changed: "${m.deviceA.pdfMarks.rows[0]}" → "${m.deviceB.pdfMarks.rows[0]}"`)
else say(`device B PDF marks: ${JSON.stringify(m.deviceB.pdfMarks)}`)

/* ── claim 2 for the reflowable book: a CFI re-derived on a fresh paginator ─ */
await pb.goto(BASE + '/', { waitUntil: 'networkidle' })
await pb.waitForTimeout(1400)
await pb.locator('a.shelf-card', { hasText: m.deviceA.epubTitle }).click({ timeout: 6000 })
    .catch(() => bad('restore', `"${m.deviceA.epubTitle}" has no shelf card on device B`))
await pb.waitForTimeout(800)
await pb.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
await pb.waitForFunction(() => !!document.querySelector('foliate-view') && !document.querySelector('.reader-opening'),
    null, { timeout: 30000 }).catch(() => bad('restore', 'the restored EPUB never opened'))
await pb.waitForTimeout(1800)
await ensureChrome(pb)
m.deviceB.epubReadout = await readout(pb)
if (m.deviceB.epubReadout !== m.deviceA.epubReadout)
    bad('position', `the EPUB was left at "${m.deviceA.epubReadout}" and reopened on device B at "${m.deviceB.epubReadout}"`)
else say(`device B opened the EPUB at "${m.deviceB.epubReadout}"`)
m.deviceB.epubMarks = await marksList(pb, 'Contents, marks and search')
if (!m.deviceB.epubMarks.rows.length)
    bad('marks', 'the reflowable bookmark did not survive the restore'
        + ` — tabs read ${JSON.stringify(m.deviceB.epubMarks.kinds)}`)
else if (m.deviceB.epubMarks.rows[0] !== m.deviceA.epubMarks.rows[0])
    bad('marks', `the EPUB bookmark excerpt changed: "${m.deviceA.epubMarks.rows[0]}" → "${m.deviceB.epubMarks.rows[0]}"`)
else say(`device B EPUB marks: ${JSON.stringify(m.deviceB.epubMarks)}`)

if (errsB.length) bad('device B', 'console errors — ' + errsB.join(' | '))
await browser.close()

console.log(out.steps.map(s => '  · ' + s).join('\n'))
console.log('\n=== FINDINGS: ' + out.findings.length)
for (const f of out.findings) console.log(`  [${f.what}] ${f.detail}`)
console.log('\n' + JSON.stringify(m, null, 2))
console.log('BACKUP_DONE')
