/* ─────────────────────────────────────────────────────────────
   THE FORMAT MATRIX. Every format this app declares, imported through the real
   file input and opened in the real reader, in one pass.

   Why it exists: an EPUB that had been unzipped and zipped again was refused
   with "Flyleaf does not read a zip file". The bug was in `sniffZip`, which
   looked for the plain string `application/epub+zip` in the first 200 bytes and
   called anything else a zip — while the engine behind it opens an EPUB by
   reading META-INF/container.xml and never looks at the mimetype entry at all.
   The sniff was stricter than the parser.

   The reasonable question that followed was "how will I know the others work if
   a simple EPUB won't". The honest answer is not reassurance, it is a driver
   that opens one of each and says so. The deep per-format checks live in their
   own drivers — mobi.mjs, text.mjs, pdf.mjs, reader.mjs — and this one
   deliberately does not repeat them. It asks the four questions that a whole
   format being broken would fail:

     1. it imports, and lands on a book sheet
     2. the sheet carries the metadata the file declared, not the filename
     3. it opens, with real text on the page (or a rendered page, for PDF)
     4. a turn turns

   And then the refusals, which matter just as much: the four archive shapes
   that must STAY refused, each with the reason a reader can act on. A sniff
   that accepts everything is not a fixed sniff.

   UNCOVERED, and stated rather than skipped: AZW3/KF8. It is a declared format
   with no fixture, because there is no MOBI/KF8 writer on this machine —
   `ebook-convert`, `kindlegen` and `calibre` are all absent (see
   fixtures/make-mobi.mjs, which is why the MOBI fixture is hand-built). The
   KF8 path through the engine is exercised by nothing here. It is the one
   format whose "it works" rests on the vendored parser's own history rather
   than on a measurement taken in this repo.

   Run: npx vite build && npx vite preview --port 4173 && node audit/formats.mjs
   ───────────────────────────────────────────────────────────── */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:4173'
const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, 'fixtures')
const SEED = join(HERE, '..', 'public', 'seed')

const findings = []
const steps = []
const m = { opened: [], refused: [], uncovered: ['azw3/kf8'] }
const bad = (what, detail) => findings.push(`${what}: ${detail}`)
const say = s => steps.push(s)

/* What must open. `title` is the metadata the FILE declares — matching it is
   how "the importer read the filename and stopped" is caught, which is the
   quiet failure that looks like success on a shelf. */
const OPENS = [
    { file: join(SEED, 'the-time-machine.epub'), format: 'epub', title: /Time Machine/i,
      why: 'a conforming EPUB, mimetype stored and first' },
    { file: join(FIX, 'rezipped.epub'), format: 'epub', title: /Time Machine/i,
      why: 'the same EPUB unzipped and re-zipped — the shape that was refused' },
    { file: join(FIX, 'wrapped.zip'), format: 'epub', title: /Time Machine/i,
      why: 'one EPUB inside a zip — unwrapped on import' },
    { file: join(FIX, 'big.epub'), format: 'epub', title: /./,
      why: 'a 4MB book, the size the brief names', optional: true },
    { file: join(FIX, 'fixture.mobi'), format: 'mobi', title: /Kindle Fixture/i,
      why: 'MOBI 6 — PalmDB, EXTH metadata, pagebreak sections' },
    { file: join(FIX, 'fixture.fb2'), format: 'fb2', title: /Measured Fixture/i,
      why: 'FictionBook 2, a bare XML book' },
    { file: join(FIX, 'fixture.fbz'), format: 'fbz', title: /Measured Fixture/i,
      why: 'the same book zipped, with the .fb2 second and deflated' },
    { file: join(FIX, 'fixture.txt'), format: 'txt', title: /Plain Text Fixture/i,
      why: 'plain text, paragraphs rebuilt from hard wraps' },
    { file: join(FIX, 'fixture.md'), format: 'markdown', title: /Markdown Fixture/i,
      why: 'Markdown' },
    { file: join(FIX, 'fixture.html'), format: 'html', title: /HTML Fixture/i,
      why: 'a lone HTML file' },
    { file: join(FIX, 'measured-page.pdf'), format: 'pdf', title: /Measured Page/i,
      why: 'PDF — its own view on pdfjs, not foliate', pdf: true },
]

/* What must stay refused, and with which words. The reason is the deliverable
   here: "a damaged or unfinished download" tells somebody to fetch it again and
   "a zip file" tells them not to bother, and they are not the same advice. */
const REFUSES = [
    { file: join(FIX, 'truncated.epub'), says: /damaged or unfinished/i,
      why: 'a cancelled download — used to import as a book with no metadata' },
    { file: join(FIX, 'twobooks.zip'), says: /2 books/i,
      why: 'two books in one zip: unwrapping would be a guess' },
    { file: join(FIX, 'comic.zip'), says: /comic archive/i,
      why: 'images only — out of scope by decision, not by omission' },
    { file: join(FIX, 'junk.zip'), says: /zip file/i,
      why: 'no book anywhere in it' },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

const errors = []
const csp = []
/* A CSP violation report is the PASS for fixture.html, which carries five ways
   in on purpose, so it is collected separately rather than counted as a console
   error. text.mjs is the driver that checks nothing ran; here the only claim is
   that a blocked script did not stop the book from opening. */
page.on('console', msg => {
    if (msg.type() !== 'error') return
    const t = msg.text().slice(0, 200)
    ;(/Content Security Policy/i.test(t) ? csp : errors).push(t)
})
page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)))

const requests = []
page.on('request', r => requests.push(r.url()))

/* page.frames(), not document.querySelector('iframe'): the section iframe lives
   inside <foliate-view>'s shadow root, and a raw DOM query does not pierce it.
   The first version of this check reported "0 frames, 0 characters" for a book
   that was rendering perfectly. */
const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')

/* Where we are, in whichever reader is mounted. A reflowable book answers with
   a page index inside a section; the PDF view answers with a scroll offset and
   a page label, and neither one can stand in for the other. */
const at = async (pdf) => {
    if (pdf) return page.evaluate(() => {
        const s = document.querySelector('.pdf-scroll') ?? document.scrollingElement
        return {
            scrollTop: Math.round(s?.scrollTop ?? -1),
            canvases: document.querySelectorAll('.pdf-page canvas, canvas').length,
            painted: [...document.querySelectorAll('canvas')].some(c => c.width > 50 && c.height > 50),
            label: document.querySelector('.reader-prog, .pdf-prog')?.textContent?.trim() ?? null,
        }
    })
    const host = await page.evaluate(() => {
        const v = document.querySelector('foliate-view')
        const l = v?.renderer?.contentLayer
        return { page: v?.renderer?.page ?? null, scrollLeft: l?.parentElement?.scrollLeft ?? null }
    })
    const f = frame()
    const chars = f ? await f.evaluate(() => document.body?.innerText?.trim().length ?? 0).catch(() => null) : null
    return { ...host, chars, section: f?.url() ?? null }
}

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)                                  // splash + first-run seed

/* ── the refusals first ──────────────────────────────────────────────────── */
/* Before the accepts, deliberately: a refusal leaves the library untouched, so
   running them first means the shelf is still empty when it happens and a
   refusal that quietly imported something would show up as a stray book. */
await page.goto(BASE + '/open', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const shelfBefore = await page.evaluate(async () => (await indexedDB.databases()).length)

for (const c of REFUSES) {
    const name = c.file.split('/').pop()
    if (!existsSync(c.file)) { bad('fixture', `${name} is missing — run audit/fixtures/make-zip-shapes.mjs`); continue }
    await page.locator('input[type=file]').setInputFiles(c.file)
    await page.waitForTimeout(1200)
    if (/\/book\//.test(page.url())) {
        bad('sniff', `${name} was ACCEPTED — it reached a book page (${c.why})`)
        await page.goto(BASE + '/open', { waitUntil: 'networkidle' })
        await page.waitForTimeout(300)
        continue
    }
    /* The row for THIS file, found by its name. The results list keeps every
       previous attempt and prepends the newest, so "the last matching row" read
       the OLDEST refusal every time and reported truncated.epub's sentence
       under all four headings — a driver bug that would have hidden a real
       wrong reason behind a right one. */
    const said = await page.evaluate((wanted) => {
        const row = [...document.querySelectorAll('.results li')]
            .map(el => el.textContent?.replace(/\s+/g, ' ').trim() ?? '')
            .find(t => t.startsWith(wanted))
        return row ?? document.body.innerText.replace(/\s+/g, ' ').slice(0, 300)
    }, name)
    m.refused.push({ file: name, said })
    if (!c.says.test(said)) bad('refusal', `${name} was refused, but the reason reads "${said}" — expected ${c.says}`)
    else say(`refused ${name}: ${said.slice(0, 90)}`)
}

/* ── the accepts ────────────────────────────────────────────────────────── */
for (const c of OPENS) {
    const name = c.file.split('/').pop()
    if (!existsSync(c.file)) {
        if (c.optional) { m.uncovered.push(`${name} (fixture absent)`); say(`skipped ${name} — not in the tree`) }
        else bad('fixture', `${name} is missing`)
        continue
    }
    const row = { file: name, format: c.format, why: c.why }

    await page.goto(BASE + '/open', { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    await page.locator('input[type=file]').setInputFiles(c.file)
    const reached = await page.waitForURL(/\/book\//, { timeout: 40000 }).then(() => true).catch(() => false)
    if (!reached) {
        row.imported = false
        row.duplicate = await page.evaluate(() => /Already in your library/i.test(document.body.innerText))
        row.said = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 240))
        bad('import', `${name} (${c.why}) never reached a book page — the page says "${row.said.slice(0, 140)}"`)
        m.opened.push(row)
        continue
    }
    await page.waitForTimeout(800)
    row.imported = true

    /* The facts sit behind the sheet's Details disclosure, which is closed on
       arrival by design — the screen has one thing a reader came for and it is
       Read. So open it before reading the Format row, rather than concluding
       from a collapsed panel that the app does not name the format. */
    await page.getByRole('button', { name: /Details/i }).click()
        .catch(() => bad('sheet', `${name}: no Details disclosure on the book sheet`))
    await page.waitForTimeout(300)

    const sheet = await page.evaluate(() => ({
        title: document.querySelector('h1')?.textContent?.trim() ?? null,
        /* The whole sheet, not a slice of it: the Format row lives in the facts
           table near the bottom, so a 400-character window reported "the sheet
           does not name the format" for four books that name it correctly. */
        text: document.body.innerText.replace(/\s+/g, ' '),
        body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
        /* naturalWidth, not the presence of an <img>: a broken cover renders as
           an element with a src and no pixels, which is exactly the failure a
           reader photographed. */
        cover: (() => {
            const i = document.querySelector('img')
            return i ? { w: i.naturalWidth, h: i.naturalHeight } : null
        })(),
    }))
    row.title = sheet.title
    row.cover = sheet.cover && sheet.cover.w > 0 ? `${sheet.cover.w}x${sheet.cover.h}` : null
    if (!c.title.test(sheet.title ?? ''))
        bad('metadata', `${name}: the sheet title reads "${sheet.title}", not the title the file declares (${c.title})`)
    if (sheet.cover && sheet.cover.w === 0)
        bad('cover', `${name}: the sheet has a cover element with no pixels in it`)
    /* The badge, because a file sniffed as the wrong format still opens and is
       still wrong — and the format is what decides which parser, which controls
       and which view a reader gets. */
    const badge = new RegExp(`Format ${c.format}\\b`, 'i')
    if (!badge.test(sheet.text))
        bad('format', `${name}: the Format row does not read ${c.format.toUpperCase()}`)

    /* ── open ───────────────────────────────────────────────────────────── */
    await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
    const mounted = await page.waitForFunction((isPdf) => {
        if (document.querySelector('.reader-opening')) return false
        return isPdf ? !!document.querySelector('canvas') : !!document.querySelector('foliate-view')
    }, c.pdf ?? false, { timeout: 40000 }).then(() => true).catch(() => false)
    await page.waitForTimeout(c.pdf ? 2000 : 1500)
    if (!mounted) { bad('open', `${name} (${c.why}) never mounted a reader`); m.opened.push(row); continue }

    const before = await at(c.pdf)
    row.opened = true
    if (c.pdf) {
        row.painted = before.painted
        if (!before.painted) bad('open', `${name}: the PDF view mounted with nothing painted on the canvas`)
    } else {
        row.chars = before.chars
        if (!(before.chars > 120))
            bad('open', `${name} (${c.why}): only ${before.chars} characters on the first page — the parser produced no text`)
    }

    /* ── a turn turns ───────────────────────────────────────────────────── */
    if (c.pdf) {
        await page.mouse.move(195, 500)
        await page.mouse.wheel(0, 900)
        await page.waitForTimeout(700)
    } else {
        await page.keyboard.press('ArrowRight')
        await page.waitForTimeout(800)
    }
    const after = await at(c.pdf)
    row.turned = c.pdf
        ? after.scrollTop !== before.scrollTop
        : (after.page !== before.page || after.section !== before.section
            || after.scrollLeft !== before.scrollLeft)
    if (!row.turned) bad('turn', `${name} (${c.why}): the page did not turn`)
    say(`opened ${name} — ${c.format}, "${row.title}"`
        + (row.chars != null ? `, ${row.chars} chars` : '')
        + `, cover ${row.cover ?? 'none'}, turn ${row.turned ? 'yes' : 'NO'}`)
    m.opened.push(row)
}

const shelfAfter = await page.evaluate(async () => (await indexedDB.databases()).length)
m.db = { shelfBefore, shelfAfter }

const off = requests.filter(u => !u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:'))
if (off.length) bad('network', `${off.length} off-origin request(s) — ${off.slice(0, 3).join(', ')}`)
if (errors.length) bad('console', errors.slice(0, 3).join(' | '))
m.errors = errors
m.cspReports = csp.length

console.log(JSON.stringify({ steps, findings, measures: m }, null, 2))
console.log(`\n=== FORMATS: ${m.opened.filter(r => r.turned).length}/${OPENS.length} opened and turned`)
console.log(`=== REFUSALS: ${m.refused.length}/${REFUSES.length} refused with the right reason`)
console.log(`=== UNCOVERED: ${m.uncovered.join(', ')}`)
console.log(`=== FINDINGS: ${findings.length} ===`)
for (const x of findings) console.log(' - ' + x)
await browser.close()
process.exit(findings.length ? 1 : 0)
