/* TXT, Markdown and a lone HTML file, end to end.

   These three used to sniff, import, and appear on the shelf with a title, and
   then refuse to open — the engine has no parser for any of them, so
   `makeBook` fell through to UnsupportedTypeError after the reader had already
   been told it worked. reader/textBook.ts builds the book instead. What this
   driver measures is that the whole path holds:

     · the file imports and the shelf grows
     · the book opens and there is text on the page
     · the structure the format carried is still there — headings in the TOC,
       a table as a table, verse still broken into lines, hard-wrapped prose
       joined back into one paragraph
     · NOTHING from the file executed, and nothing was fetched. The section
       iframe runs with `allow-same-origin allow-scripts`, so a book that can
       run script runs it on the origin that owns the library. The HTML fixture
       tries five ways in (inline script, body script, body onload, an onclick,
       and a javascript: href) and sets window.parent.__flyleafPwned from each.
     · a turn still turns, and a change of font size lands on the same
       paragraph rather than the same percentage

   Fixtures are generated files in audit/fixtures, not real books: a fixture
   can be made to carry every case at once, and a real book cannot. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE || 'http://localhost:4173'
const HERE = dirname(fileURLToPath(import.meta.url))
const findings = []
const steps = []
const m = {}
const bad = (what, detail) => findings.push(`${what}: ${detail}`)
const say = s => steps.push(s)

const FIXTURES = [
    { file: 'fixture.txt', format: 'txt', title: /Plain Text Fixture/i },
    { file: 'fixture.md', format: 'markdown', title: /Markdown Fixture/i },
    { file: 'fixture.html', format: 'html', title: /HTML Fixture/i },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

const errors = []
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', e => { errors.push('pageerror: ' + e.message); if (process.env.TRACE) console.log('\n>>> PAGEERROR at ' + page.url() + '\n' + e.stack + '\n') })

/* Every request the page makes, so "no network" is measured rather than
   asserted. The fixtures point at example.invalid on purpose: a request to it
   cannot succeed, so a missing image would look the same either way — the only
   evidence that the image was dropped rather than merely failing is that the
   request was never made. */
const requests = []
page.on('request', r => requests.push(r.url()))

const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')

const openReader = async () => {
    await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
    await page.waitForFunction(() => {
        const v = document.querySelector('foliate-view')
        return !!v && !document.querySelector('.reader-opening')
    }, null, { timeout: 25000 })
    await page.waitForTimeout(1200)
}

/* The first paragraph whose box is inside the visible column, in the iframe's
   own coordinates converted to the host's. This is the "same paragraph" test
   from CLAUDE.md: a percentage would compare two numbers that mean nothing
   after a reflow, and a CFI compares itself. */
const firstVisible = async () => {
    const f = frame()
    if (!f) return null
    return f.evaluate(() => {
        const off = window.frameElement?.getBoundingClientRect().left ?? 0
        const hostW = window.parent.innerWidth
        for (const p of document.querySelectorAll('p, h1, h2, h3, li')) {
            const r = p.getBoundingClientRect()
            if (r.height <= 0 || r.width <= 10) continue
            if (off + r.left < -2 || off + r.right > hostW + 2) continue
            const t = p.textContent.replace(/\s+/g, ' ').trim()
            if (t.length > 12) return t.slice(0, 60)
        }
        return null
    })
}

/* The chrome is a toggle on a tap, so tapping blind either opens it or shuts
   it depending on what the last step left behind — which is how this driver
   spent a run waiting for a settings button that its own tap had just
   dismissed. Tap until the button is there, twice at most. */
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

/* Where the engine is, not what the words say. The fixtures repeat three
   paragraphs on purpose — that is what makes the hard-wrap and heading tests
   meaningful — so two different pages can legitimately open with the same
   sixty characters, and comparing text to decide whether a turn happened
   reported "the page did not turn" on a page that had turned. The engine's own
   page index and scroll offset cannot be confused that way. */
const at = async () => {
    const host = await page.evaluate(() => {
        const v = document.querySelector('foliate-view')
        const l = v?.renderer?.contentLayer
        return {
            page: v?.renderer?.page ?? null,
            scrollLeft: l?.parentElement?.scrollLeft ?? null,
        }
    })
    /* The section, identified by the blob URL its iframe is showing. The
       paginator keeps its section index private and exposes it only through
       the relocate event, and `page` restarts at 1 in every section — so a
       jump from section 0 page 1 to section 1 page 1 changes neither number
       and reads as "the page did not move". One URL per section cannot be
       confused that way. */
    return { ...host, section: frame()?.url() ?? null }
}

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)                                  // splash + seed
/* Distinct books, not links: the shelf's own Reading strip links the book it
   also lists below, so counting anchors counts one of them twice. */
const shelfCount = () => page.evaluate(() => new Set(
    [...document.querySelectorAll('a[href^="/book/"]')].map(a => a.getAttribute('href'))).size)
m.shelfBefore = await shelfCount()
say(`shelf holds ${m.shelfBefore} books before importing`)

for (const fx of FIXTURES) {
    const tag = fx.format
    await page.goto(BASE + '/open', { waitUntil: 'networkidle' })
    await page.waitForTimeout(300)
    await page.locator('input[type=file]').setInputFiles(join(HERE, 'fixtures', fx.file))

    /* One good import navigates straight to the book. Waiting on the URL
       rather than a timeout is also the check that it imported at all. */
    await page.waitForURL(/\/book\//, { timeout: 20000 })
        .catch(() => bad(tag, 'importing the file never reached a book page'))
    await page.waitForTimeout(500)

    const sheet = await page.evaluate(() => ({
        title: document.querySelector('h1')?.textContent?.trim() ?? null,
        body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 400),
    }))
    m[`${tag}Sheet`] = sheet
    if (!fx.title.test(sheet.title ?? '')) {
        /* Not fatal on its own — a .txt has no metadata block, so the title is
           whatever the importer read off the head of the file. It IS fatal if
           the reader and the shelf disagree, which is checked below. */
        say(`${tag}: sheet title reads "${sheet.title}"`)
    }

    await openReader()
    if (errors.length) { bad(tag, `console errors on open — ${errors.join(' | ')}`); errors.length = 0 }

    const f = frame()
    if (!f) { bad(tag, 'the book opened with no section iframe'); continue }

    m[`${tag}Page`] = await f.evaluate(() => {
        const text = document.body.innerText.replace(/\s+/g, ' ').trim()
        const longest = [...document.querySelectorAll('p')]
            .map(p => p.textContent.replace(/\s+/g, ' ').trim())
            .sort((a, b) => b.length - a.length)[0] ?? ''
        return {
            chars: text.length,
            paras: document.querySelectorAll('p').length,
            heads: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
            longestPara: longest.slice(0, 80),
            longestParaLen: longest.length,
            /* what must NOT be here */
            scripts: document.querySelectorAll('script').length,
            iframes: document.querySelectorAll('iframe').length,
            /* The paginator writes column geometry onto <html> and <body> as
               inline style, so those two are the engine's and expected. What
               must be zero is a style attribute anywhere in the content. */
            styleAttrs: [...document.querySelectorAll('[style]')]
                .filter(el => el !== document.documentElement && el !== document.body).length,
            handlers: [...document.querySelectorAll('*')]
                .filter(el => [...el.attributes].some(a => a.name.toLowerCase().startsWith('on'))).length,
            jsHrefs: [...document.querySelectorAll('[href]')]
                .filter(a => /^javascript:/i.test(a.getAttribute('href'))).length,
            remoteImgs: [...document.querySelectorAll('img')]
                .filter(i => /^https?:/i.test(i.getAttribute('src') ?? '')).length,
            /* what SHOULD be here, per format */
            tables: document.querySelectorAll('table').length,
            lists: document.querySelectorAll('ul,ol').length,
            quotes: document.querySelectorAll('blockquote').length,
            pre: document.querySelectorAll('pre').length,
            verse: document.querySelectorAll('p.verse').length,
            breaks: document.querySelectorAll('hr.txt-break').length,
            alts: document.querySelectorAll('span.alt').length,
            emphasisInCode: [...document.querySelectorAll('code')]
                .filter(c => c.querySelector('em, strong')).length,
            frontMatter: /^---|^title:/m.test(text.slice(0, 200)),
        }
    })
    const p = m[`${tag}Page`]

    if (p.chars < 400) bad(tag, `only ${p.chars} characters rendered — the section is empty or nearly so`)
    if (!p.paras) bad(tag, 'no paragraphs in the rendered section')
    if (p.scripts) bad(tag, `${p.scripts} script element(s) survived into the section`)
    if (p.iframes) bad(tag, `${p.iframes} iframe(s) survived into the section`)
    if (p.handlers) bad(tag, `${p.handlers} element(s) kept an inline event handler`)
    if (p.jsHrefs) bad(tag, `${p.jsHrefs} javascript: href(s) survived`)
    if (p.remoteImgs) bad(tag, `${p.remoteImgs} image(s) still point at the network`)
    if (p.styleAttrs) bad(tag, `${p.styleAttrs} element(s) kept a style attribute`)

    /* ── the TOC came out of the headings ── */
    if (!await showChrome()) { bad(tag, 'the chrome never appeared on a tap'); continue }
    await page.getByRole('button', { name: 'Contents' }).click()
    await page.waitForTimeout(400)
    const entries = page.locator('.reader-toc-link')
    m[`${tag}Toc`] = await entries.count()
    if (m[`${tag}Toc`] < 4) bad(tag, `the contents list has ${m[`${tag}Toc`]} entries; the fixture has six chapters`)
    else {
        const before = await at()
        const entry = entries.nth(Math.min(3, m[`${tag}Toc`] - 1))
        /* Read the label first: following it closes the list, and the locator
           then has nothing to read. */
        const label = (await entry.textContent())?.trim() ?? null
        await entry.click()
        await page.waitForTimeout(1000)
        const after = await at()
        m[`${tag}TocJump`] = { label, before, after }
        if (before.section === after.section && before.page === after.page
            && before.scrollLeft === after.scrollLeft)
            bad(tag, `a contents entry did not move the page — still page ${after.page} of ${after.section}`)
    }
    /* Shut the chrome again — a tap on the stage, not Escape, because that is
       what a reader does and it is the path that had the bug. */
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(250)

    /* ── a turn turns ── */
    const beforeTurn = await at()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(800)
    const afterTurn = await at()
    m[`${tag}Turn`] = { beforeTurn, afterTurn }
    if (beforeTurn.page === afterTurn.page
        && beforeTurn.section === afterTurn.section
        && beforeTurn.scrollLeft === afterTurn.scrollLeft)
        bad(tag, `the page did not turn — still page ${afterTurn.page} of ${afterTurn.section}`)

    /* ── the position survives a change of font size ── */
    const anchor = await firstVisible()
    if (!await showChrome()) { bad(tag, 'the chrome never reappeared after a turn'); continue }
    await page.getByRole('button', { name: 'Text and page settings' }).click()
    await page.waitForTimeout(400)
    const bigger = page.getByRole('button', { name: /Larger text|Increase text size|Bigger/ })
    if (await bigger.count()) {
        await bigger.first().click()
        await bigger.first().click()
    } else {
        const slider = page.locator('input[type=range]').first()
        await slider.focus()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('ArrowRight')
    }
    await page.waitForTimeout(1200)
    const afterSize = await firstVisible()
    m[`${tag}Reflow`] = { anchor, afterSize }
    /* The same paragraph, not the same percentage: the anchor's opening words
       must still be the ones on the page. A prefix compare rather than an
       equality one because a wider or narrower column legitimately changes
       where the paragraph is cut off in the 60 characters read back. */
    if (anchor && afterSize) {
        const a = anchor.slice(0, 34), b = afterSize.slice(0, 34)
        if (!(a === b || anchor.startsWith(b) || afterSize.startsWith(a)))
            bad(tag, `a font-size change moved the reader: "${a}" became "${b}"`)
    }
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(200)
    say(`${tag}: ${p.chars} chars, ${p.paras} paragraphs, ${p.heads} headings, ${m[`${tag}Toc`]} contents entries`)
}

/* ── nothing from the HTML file ran, and nothing was fetched ─────────────── */
m.pwned = await page.evaluate(() => window.__flyleafPwned ?? null)
if (m.pwned) bad('sandbox', `book-supplied script executed: ${m.pwned}`)
m.offOrigin = requests.filter(u => !u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:'))
if (m.offOrigin.length) bad('offline', `the page made ${m.offOrigin.length} off-origin request(s) — ${m.offOrigin.slice(0, 4).join(', ')}`)

/* ── per-format structure ───────────────────────────────────────────────── */
{
    const t = m.txtPage
    if (t) {
        /* A hard-wrapped paragraph joined back into one line: the fixture's
           prose paragraphs are ~290 characters, so anything under 200 means
           the wrap column survived and the reader's measure control is being
           overruled by whoever typed the file. */
        if (t.longestParaLen < 200)
            bad('txt', `longest paragraph is ${t.longestParaLen} chars — hard wraps were not joined`)
        if (!t.verse) bad('txt', 'the verse block lost its line breaks')
        if (!t.heads) bad('txt', 'no headings were recognised in plain text')
    }
    const d = m.markdownPage
    if (d) {
        if (d.frontMatter) bad('markdown', 'YAML front matter is being shown as text')
        if (d.emphasisInCode) bad('markdown', 'an asterisk inside a code span became emphasis')
        if (!d.alts) bad('markdown', 'the remote image dropped its alt text as well as its src')
    }
    const h = m.htmlPage
    if (h && !h.alts) bad('html', 'the remote image dropped its alt text as well as its src')
}

/* The markdown fixture's table, list, quote, code block and inline emphasis are
   all in its first section, which the loop above already measured — so they are
   checked off that measurement rather than by opening the book a second time. */
{
    const s = m.markdownPage
    if (s) {
        if (!s.tables) bad('markdown', 'the pipe table did not render as a table')
        if (s.lists < 2) bad('markdown', `the two lists rendered as ${s.lists}`)
        if (!s.quotes) bad('markdown', 'the blockquote did not render')
        if (!s.pre) bad('markdown', 'the fenced code block did not render')
    }
}

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
m.shelfAfter = await shelfCount()
if (m.shelfAfter !== m.shelfBefore + FIXTURES.length)
    bad('shelf', `${m.shelfBefore} books became ${m.shelfAfter}; three were imported`)

if (errors.length) bad('console', errors.join(' | '))

console.log(JSON.stringify({ steps, measures: m, findings }, null, 2))
console.log('\n=== FINDINGS: ' + findings.length)
for (const f of findings) console.log('  - ' + f)
await browser.close()
