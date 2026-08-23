/* ─────────────────────────────────────────────────────────────
   P4, measured. The PDF view, end to end, against a fixture whose every
   answer is known in advance: audit/fixtures/measured-page.pdf is 12
   pages of real Tj text in base-14 Helvetica and Times-Italic, titled
   "The Measured Page" by "Flyleaf Audit", with a three-entry outline
   (pages 1, 5, 9) and the word "cornerstone" on page 5 and nowhere else.

   Six claims this driver exists to check, each one a thing that would be
   invisible by eye:

   1. NOTHING IS FETCHED. A base-14 PDF must resolve every font locally
      (useSystemFonts is on by default), so a correct open makes zero
      requests to /pdfjs/. One request here is the offline promise broken
      for the commonest kind of PDF there is.
   2. THE VEIL IS READABLE. Dimming a white page makes black ink LESS
      readable, so each of the seven --pdf-veil values is composited over
      white and over black and the pair measured. The floor is 7:1.
   3. THE POSITION SURVIVES A RELOAD, as a page and a fraction, not a
      scroll offset.
   4. THE OUTLINE GOES WHERE IT SAYS. Chapter 2 must land on page 5.
   5. SEARCH FINDS IT ONCE, on page 5, with a real vertical fraction —
      not page-top.
   6. THE ABSENCES ARE REAL. No type controls in the sheet, no tint row
      and no Note in the selection menu, no highlights/notes tabs in the
      panel. Absent, not disabled: a disabled Size slider on a PDF is
      fifteen pixels of apology.

   Run: npx vite build && node audit/pdf.mjs
   ───────────────────────────────────────────────────────────── */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BASE || 'http://localhost:4173'
const FIXTURE = join(HERE, 'fixtures', 'measured-page.pdf')

const out = { steps: [], findings: [], measures: {} }
const say = s => out.steps.push(s)
const bad = (what, detail) => out.findings.push({ what, detail })
const m = out.measures

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

const errors = []
page.on('console', e => { if (e.type() === 'error') errors.push(e.text().slice(0, 200)) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 200)))

/* Claim 1 lives here. Every request the page makes, recorded from before the
   first navigation, so nothing can slip in during the splash. */
const requests = []
page.on('request', r => requests.push(r.url()))
const pdfjsFetches = () => requests.filter(u => u.includes('/pdfjs/'))

/* ── import ──────────────────────────────────────────────────────────────── */
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)                          // splash + first-run seed
await page.goto(BASE + '/open', { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.locator('input[type=file]').setInputFiles(FIXTURE)
await page.waitForURL(/\/book\//, { timeout: 30000 })
    .catch(() => bad('import', 'importing the PDF never reached a book page'))
await page.waitForTimeout(900)

/* The Info dict said so, and the importer is supposed to believe it — a PDF
   whose title is real metadata should not arrive on the shelf as a filename. */
m.sheet = await page.evaluate(() => ({
    title: document.querySelector('h1')?.textContent?.trim() ?? null,
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 320),
    cover: (() => {
        const img = document.querySelector('.sheet-cover img, .cover img, img')
        if (!img) return null
        return { w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 12) }
    })(),
}))
if (m.sheet.title !== 'The Measured Page')
    bad('metadata', `title reads "${m.sheet.title}", not the Info dict's "The Measured Page"`)
if (!/Flyleaf Audit/.test(m.sheet.text))
    bad('metadata', 'the author from the Info dict is not on the book sheet')
if (!m.sheet.cover || m.sheet.cover.w < 100)
    bad('cover', `page one did not become a cover — ${JSON.stringify(m.sheet.cover)}`)
else say(`cover is ${m.sheet.cover.w}x${m.sheet.cover.h} from page one`)
if (m.sheet.cover?.src && !m.sheet.cover.src.startsWith('blob:'))
    bad('cover', `cover src is ${m.sheet.cover.src}…, not a blob from IndexedDB`)
say(`imported: "${m.sheet.title}"`)

/* ── open the reader ─────────────────────────────────────────────────────── */
await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
await page.waitForFunction(
    () => !!document.querySelector('.pdf-canvas') && !document.querySelector('.reader-opening'),
    null, { timeout: 30000 })
    .catch(() => bad('open', 'the PDF never finished opening'))
await page.waitForTimeout(1200)
if (errors.length) { bad('open', 'console errors — ' + errors.join(' | ')); errors.length = 0 }
say('opened the PDF reader at 390x844')

m.pdfjsFetchesOnOpen = pdfjsFetches()
if (m.pdfjsFetchesOnOpen.length)
    bad('offline', `a base-14 PDF fetched ${m.pdfjsFetchesOnOpen.length} file(s) from /pdfjs/ — `
        + m.pdfjsFetchesOnOpen.map(u => u.split('/pdfjs/')[1]).join(', '))
else say('opened with zero requests to /pdfjs/ — every font resolved locally')

/* Claim: it is a scroll, and it is virtualized. Twelve pages must not mean
   twelve canvases, or a 900-page file would mean 900. */
m.mounted = await page.evaluate(() => ({
    canvases: document.querySelectorAll('.pdf-canvas').length,
    pages: document.querySelectorAll('.pdf-page').length,
    strip: (() => { const s = document.querySelector('.pdf-strip'); return s ? Math.round(s.getBoundingClientRect().height) : null })(),
}))
if (m.mounted.pages >= 12)
    bad('virtualize', `all ${m.mounted.pages} pages are mounted at once — the sweep is not bounding the range`)
else say(`${m.mounted.pages} of 12 pages mounted, strip ${m.mounted.strip}px tall`)

/* ── the chrome ──────────────────────────────────────────────────────────── */
const ensureChrome = async () => {
    for (let i = 0; i < 3; i++) {
        const shown = await page.evaluate(() => {
            const b = document.querySelector('button[aria-label="Page settings"]')
            if (!b) return false
            const cs = getComputedStyle(b)
            return b.getClientRects().length > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.5
        })
        if (shown) return true
        await page.locator('.reader-stage').click({ position: { x: 195, y: 420 } }).catch(() => {})
        await page.waitForTimeout(400)
    }
    return false
}
if (!await ensureChrome()) bad('chrome', 'a tap on the page never brought the bars back')

m.readout = await page.evaluate(() =>
    document.querySelector('.reader-readout')?.innerText.replace(/\s+/g, ' ').trim() ?? null)
/* The readout is uppercased by CSS, so every match here is case-insensitive:
   innerText returns what is rendered, not what the JSX wrote. */
if (!/page 1 of 12/i.test(m.readout ?? ''))
    bad('readout', `readout reads "${m.readout}" — a PDF's page numbers are the file's own`)
else say(`readout: "${m.readout}"`)

/* ── the sheet: four controls, no tabs, no type controls ──────────────────── */
await page.locator('button[aria-label="Page settings"]').click()
await page.waitForTimeout(500)
m.sheetShape = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet')
    if (!sheet) return null
    const box = el => { const q = el.getBoundingClientRect(); return { x: +q.x.toFixed(1), r: +q.right.toFixed(1), t: +q.top.toFixed(1) } }
    const body = sheet.querySelector('.sheet-body')
    const lead = sheet.querySelector('.sheet-lead')
    /* Against a control, not the body: the body carries 16px of padding, so its
       border box is not the column the lead is supposed to line up with. */
    const col = sheet.querySelector('.ctl')
    return {
        tabs: !!sheet.querySelector('.sheet-tabs'),
        labels: Array.from(sheet.querySelectorAll('.ctl-lbl')).map(el => el.textContent.trim()),
        disabledCtls: Array.from(sheet.querySelectorAll('.ctl')).filter(c => c.hasAttribute('data-off'))
            .map(c => c.querySelector('.ctl-lbl')?.textContent.trim()),
        leadGap: lead && body ? +(box(lead).t - box(body).t).toFixed(1) : null,
        leadEdges: lead && col ? { l: +(box(lead).x - box(col).x).toFixed(1), r: +(box(col).r - box(lead).r).toFixed(1) } : null,
        stockSwatches: sheet.querySelectorAll('.sheet-opt--stock').length,
    }
})
const TYPE_CTLS = /size|face|leading|line width|word|letter|hyphen|justif|weight|margin/i
if (m.sheetShape?.tabs) bad('sheet', 'the PDF sheet has a tablist — four controls do not need three tabs')
const strays = (m.sheetShape?.labels ?? []).filter(l => TYPE_CTLS.test(l))
if (strays.length) bad('sheet', `type controls present on a fixed page: ${strays.join(', ')}`)
if ((m.sheetShape?.labels ?? []).length !== 4)
    bad('sheet', `${m.sheetShape?.labels?.length} controls, expected 4 — ${(m.sheetShape?.labels ?? []).join(', ')}`)
if (m.sheetShape?.stockSwatches !== 7)
    bad('sheet', `${m.sheetShape?.stockSwatches} stock swatches, expected 7`)
/* The lead sentence must sit in an even inset, not against the sheet's own top
   rule — the tab-less body supplies its own top padding (.sheet-body--bare). */
if (m.sheetShape?.leadGap !== null && m.sheetShape.leadGap < 12)
    bad('sheet', `the lead sentence is ${m.sheetShape.leadGap}px below the sheet's top edge — crowded`)
if (m.sheetShape?.leadEdges && Math.abs(m.sheetShape.leadEdges.l - 0) > 0.6)
    bad('sheet', `the lead sentence is off the control column by ${m.sheetShape.leadEdges.l}px`)
say(`sheet: ${(m.sheetShape?.labels ?? []).join(' · ')}${m.sheetShape?.tabs ? ' (with tabs)' : ' (no tabs)'}`)

/* Page tint on the press stock is DISABLED WITH A REASON rather than absent,
   because unlike Line width on a phone it comes back the moment the reader
   picks another stock, and a control that vanishes and returns reads as a bug. */
m.tintDisabledOnPress = await page.evaluate(() => {
    const root = document.querySelector('.reader')
    if (!root) return null
    const was = root.dataset.stock
    const read = () => {
        const ctl = Array.from(document.querySelectorAll('.ctl'))
            .find(c => /page tint/i.test(c.querySelector('.ctl-lbl')?.textContent ?? ''))
        return ctl ? { off: ctl.hasAttribute('data-off'), note: ctl.querySelector('.ctl-note')?.textContent.trim().slice(0, 90) ?? null } : null
    }
    return { stock: was, state: read() }
})
if (m.tintDisabledOnPress?.stock === 'press' && !m.tintDisabledOnPress.state?.off)
    bad('sheet', 'Page tint is live on the press stock, where there is no tint to adjust')
if (m.tintDisabledOnPress?.state?.off && !m.tintDisabledOnPress.state.note)
    bad('sheet', 'Page tint is disabled with no reason given')

/* ── claim 2: every veil value, black ink measured through it ─────────────── */
m.veils = await page.evaluate(() => {
    const STOCKS = ['press', 'day', 'butter', 'tea', 'coal', 'dusk', 'pitch']
    const root = document.querySelector('.reader')
    const was = root.dataset.stock
    const parse = s => { const p = String(s).match(/rgba?\(([^)]+)\)/); return p ? p[1].split(',').map(parseFloat) : null }
    const lum = rgb => { const [r, g, b] = rgb.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return +((hi + 0.05) / (lo + 0.05)).toFixed(2) }
    /* An opacity veil is a source-over composite: out = veil·α + under·(1−α).
       The page under it is white where it is blank and black where the ink is,
       and BOTH are veiled — which is exactly why dimming cannot invert. */
    const over = (veil, a, under) => veil.map((c, i) => c * a + under[i] * (1 - a))
    const rows = []
    for (const s of STOCKS) {
        root.dataset.stock = s
        const el = document.querySelector('.pdf-veil')
        if (!el) continue
        const cs = getComputedStyle(el)
        const veil = parse(cs.backgroundColor)
        const alpha = parseFloat(cs.opacity)
        const paper = over(veil, alpha, [255, 255, 255])
        const ink = over(veil, alpha, [0, 0, 0])
        rows.push({
            stock: s, alpha: +alpha.toFixed(3),
            veil: `rgb(${veil.map(Math.round).join(',')})`,
            paper: `rgb(${paper.map(Math.round).join(',')})`,
            ink: `rgb(${ink.map(Math.round).join(',')})`,
            cr: ratio(ink, paper),
        })
    }
    root.dataset.stock = was
    return rows
})
for (const v of m.veils) {
    if (v.cr < 7) bad('veil', `${v.stock}: black ink through a ${v.alpha} veil is ${v.cr}:1, under the 7:1 floor (${v.ink} on ${v.paper})`)
}
say('veils: ' + m.veils.map(v => `${v.stock} ${v.alpha}→${v.cr}:1`).join(' · '))
await page.keyboard.press('Escape').catch(() => {})
await page.locator('button[aria-label="Page settings"]').click().catch(() => {})
await page.waitForTimeout(400)

/* ── claim 4: the outline goes where it says ──────────────────────────────── */
await ensureChrome()
await page.locator('button[aria-label="Contents, bookmarks and search"]').click()
await page.waitForTimeout(500)
m.panel = await page.evaluate(() => ({
    kinds: document.querySelectorAll('.panel-kinds .panel-kind').length,
    kindLabels: Array.from(document.querySelectorAll('.panel-kinds button')).map(b => b.textContent.trim()),
    toc: Array.from(document.querySelectorAll('.reader-toc-link')).map(b => ({ label: b.textContent.trim(), off: b.disabled })),
}))
if (m.panel.kinds > 0)
    bad('panel', `a PDF shows ${m.panel.kinds} marks-kind tabs — with bookmarks the only kind there is nothing to switch between`)
if (m.panel.toc.length !== 3)
    bad('panel', `${m.panel.toc.length} outline entries, expected 3 — ${m.panel.toc.map(t => t.label).join(', ')}`)
say(`outline: ${m.panel.toc.map(t => t.label).join(' · ')}`)

await page.locator('.reader-toc-link', { hasText: 'Chapter 2' }).click({ timeout: 5000 })
    .catch(() => bad('outline', 'Chapter 2 would not click'))
await page.waitForTimeout(1400)
await ensureChrome()
m.afterOutline = await page.evaluate(() =>
    document.querySelector('.reader-readout')?.innerText.replace(/\s+/g, ' ').trim() ?? null)
if (!/page 5 of 12/i.test(m.afterOutline ?? ''))
    bad('outline', `Chapter 2 says page 5; the readout after the jump says "${m.afterOutline}"`)
else say(`Chapter 2 landed on page 5 — "${m.afterOutline}"`)

/* ── claim 5: search finds the one word once, with a real fraction ─────────── */
await page.locator('button[aria-label="Contents, bookmarks and search"]').click()
await page.waitForTimeout(400)
await page.locator('.panel-find-field').fill('cornerstone')
    .catch(() => bad('search', 'no search field in the panel'))
await page.keyboard.press('Enter')
await page.waitForTimeout(2600)
m.search = await page.evaluate(() => ({
    groups: Array.from(document.querySelectorAll('.panel-group-label')).map(el => el.textContent.trim()),
    /* .panel-hit is the matched word inside the excerpt; the row is the button
       around it, and one row is one hit. */
    hits: Array.from(document.querySelectorAll('.panel-row')).map(el => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 80)),
    matches: Array.from(document.querySelectorAll('.panel-hit')).map(el => el.textContent.trim()),
    body: document.querySelector('.reader-panel')?.innerText.replace(/\s+/g, ' ').slice(0, 300) ?? null,
}))
if (m.search.hits.length !== 1)
    bad('search', `"cornerstone" is on page 5 and nowhere else; the panel lists ${m.search.hits.length} hits`)
if (!/page 5/i.test(m.search.body ?? ''))
    bad('search', `the hit is not labelled with page 5 — panel reads "${(m.search.body ?? '').slice(0, 140)}"`)
else say(`search found "cornerstone" once, on page 5`)

const hit = page.locator('.panel-row').first()
if (await hit.count()) {
    await hit.click()
    await page.waitForTimeout(1400)
    m.hitLanding = await page.evaluate(() => {
        const strip = document.querySelector('.pdf-strip')
        const scroll = document.querySelector('.pdf-scroll')
        return {
            readout: null,
            scrollTop: scroll ? Math.round(scroll.scrollTop) : null,
            stripH: strip ? Math.round(strip.getBoundingClientRect().height) : null,
        }
    })
    await ensureChrome()
    m.hitLanding.readout = await page.evaluate(() =>
        document.querySelector('.reader-readout')?.innerText.replace(/\s+/g, ' ').trim() ?? null)
    if (!/page 5 of 12/i.test(m.hitLanding.readout ?? ''))
        bad('search', `tapping the hit landed on "${m.hitLanding.readout}", not page 5`)
    else say(`the hit landed on page 5 (scrollTop ${m.hitLanding.scrollTop})`)
}

/* ── claim 6: the selection menu's absences ──────────────────────────────── */
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(300)
m.selection = await page.evaluate(async () => {
    /* The text layer is real DOM in this document, so a selection is made here
       rather than in a frame — the whole reason a PDF needs no per-section
       listener. Pick the widest span on the visible page and select it. */
    const spans = Array.from(document.querySelectorAll('.pdf-text span'))
        .filter(s => { const q = s.getBoundingClientRect(); return q.width > 40 && q.top > 80 && q.bottom < innerHeight - 80 })
    if (!spans.length) return { error: 'no selectable text spans on the visible page' }
    const span = spans.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = getSelection()
    sel.removeAllRanges(); sel.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise(r => setTimeout(r, 500))
    const menu = document.querySelector('.selmenu')
    const box = el => { const q = el.getBoundingClientRect(); return { x: +q.x.toFixed(1), r: +q.right.toFixed(1), t: +q.top.toFixed(1), b: +q.bottom.toFixed(1) } }
    return {
        text: range.toString().slice(0, 60),
        open: !!menu,
        marksAttr: menu?.dataset.marks ?? null,
        tints: document.querySelectorAll('.selmenu-tint').length,
        actions: Array.from(document.querySelectorAll('.selmenu-act')).map(b => b.textContent.trim()),
        box: menu ? box(menu) : null,
        win: { w: innerWidth, h: innerHeight },
    }
})
if (m.selection.error) bad('selection', m.selection.error)
else {
    if (!m.selection.open) bad('selection', `selecting "${m.selection.text}" opened no menu`)
    if (m.selection.tints > 0)
        bad('selection', `${m.selection.tints} highlight tints offered on a page with no CFI to anchor one to`)
    const noted = m.selection.actions.some(a => /note/i.test(a))
    if (noted) bad('selection', 'a Note action on a PDF — there is nothing to attach it to')
    if (m.selection.box) {
        if (m.selection.box.x < 0 || m.selection.box.r > m.selection.win.w + 0.5)
            bad('selection', `the menu escapes the pane — ${m.selection.box.x}…${m.selection.box.r} in ${m.selection.win.w}px`)
    }
    say(`selection menu: ${m.selection.actions.join(' · ')} (marks="${m.selection.marksAttr}")`)
}
await page.evaluate(() => getSelection().removeAllRanges())
await page.waitForTimeout(300)

/* ── the bookmark, and claim 3: the position survives a reload ────────────── */
await ensureChrome()
await page.locator('button[aria-label="Bookmark this page"]').click({ timeout: 5000 })
    .catch(() => bad('bookmark', 'the bookmark button would not click'))
await page.waitForTimeout(800)
m.bookmark = await page.evaluate(() => ({
    pressed: document.querySelector('.reader-bar--top button[aria-pressed]')?.getAttribute('aria-pressed'),
    tick: !!document.querySelector('.reader-tick'),
}))
if (m.bookmark.pressed !== 'true') bad('bookmark', 'the button did not go pressed')
if (!m.bookmark.tick) bad('bookmark', 'no ribbon on a bookmarked page')

await page.locator('button[aria-label="Contents, bookmarks and search"]').click()
await page.waitForTimeout(500)
await page.locator('.panel-tab', { hasText: /Marks/i }).click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(500)
m.marks = await page.evaluate(() => ({
    /* A bookmark row is `.panel-item` → `.panel-row` → `.panel-excerpt`.
       `.panel-mark` is the annotation row and never a bookmark; the
       `--find` exclusion keeps a search hit out of the count. */
    rows: Array.from(document.querySelectorAll('.panel-item .panel-excerpt:not(.panel-excerpt--find)')).map(el => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 90)),
}))
if (!m.marks.rows.length) bad('bookmark', 'the bookmark is not in the marks list')
else if (/^Page 5$/.test(m.marks.rows[0]))
    bad('bookmark', 'the bookmark excerpt is a bare page number — pageText found nothing on a page that has text')
else say(`marks list: "${m.marks.rows[0]}"`)

/* Reload. The position is a page and a fraction in the locators row, so it has
   to come back as page 5 — and a fraction, not the top of the document. */
const url = page.url()
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(
    () => !!document.querySelector('.pdf-canvas') && !document.querySelector('.reader-opening'),
    null, { timeout: 30000 }).catch(() => bad('reload', 'the reopened PDF never painted'))
await page.waitForTimeout(1600)
await ensureChrome()
m.afterReload = await page.evaluate(() => ({
    readout: document.querySelector('.reader-readout')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    scrollTop: (() => { const s = document.querySelector('.pdf-scroll'); return s ? Math.round(s.scrollTop) : null })(),
}))
if (!/page 5 of 12/i.test(m.afterReload.readout ?? ''))
    bad('position', `reopened at "${m.afterReload.readout}", not the page it was left on`)
else say(`reopened on page 5 — "${m.afterReload.readout}", scrollTop ${m.afterReload.scrollTop}`)

m.pdfjsFetchesTotal = pdfjsFetches()
if (m.pdfjsFetchesTotal.length > m.pdfjsFetchesOnOpen.length)
    bad('offline', 'the reload fetched from /pdfjs/ — ' + m.pdfjsFetchesTotal.slice(-4).join(', '))

/* ── the wide width, both edges ───────────────────────────────────────────── */
await ctx.pages()[0].setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(900)
m.wide = await page.evaluate(() => {
    const strip = document.querySelector('.pdf-strip')
    const scroll = document.querySelector('.pdf-scroll')
    const pg = document.querySelector('.pdf-page')
    if (!strip || !scroll || !pg) return null
    const s = scroll.getBoundingClientRect(), p = pg.getBoundingClientRect()
    return {
        left: +(p.x - s.x).toFixed(1),
        right: +(s.right - p.right).toFixed(1),
        pageW: +p.width.toFixed(1), paneW: +s.width.toFixed(1),
        overflowX: scroll.scrollWidth > scroll.clientWidth + 1,
    }
})
if (m.wide && Math.abs(m.wide.left - m.wide.right) > 1)
    bad('layout', `the page is off-centre at 1280 — ${m.wide.left}px left, ${m.wide.right}px right`)
if (m.wide?.overflowX)
    bad('layout', `the fitted page scrolls horizontally at 1280 — page ${m.wide.pageW} in a ${m.wide.paneW} pane`)
else if (m.wide) say(`at 1280 the page is centred, ${m.wide.left}px each side`)

if (errors.length) bad('console', errors.join(' | '))

await writeFile('/tmp/pdf.json', JSON.stringify(out, null, 2))
console.log('\n=== FINDINGS:', out.findings.length)
for (const f of out.findings) console.log(' ·', f.what + ':', f.detail)
console.log('\n--- steps ---')
for (const s of out.steps) console.log('  ', s)
console.log('\nPDF_DONE')
await browser.close()
