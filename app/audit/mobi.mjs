/* MOBI 6, end to end — the format that had no coverage at all.

   Why it earns its own driver rather than a row in `text.mjs`: a Kindle book
   takes a different path through the engine at every step. It is sniffed from a
   PalmDB record rather than a zip, its metadata comes from EXTH rather than an
   OPF, its sections are split on `<mbp:pagebreak>` rather than being separate
   files, and its contents list is built from `filepos` *byte offsets* rather
   than an NCX or a heading walk. None of that shares code with EPUB or with
   reader/textBook.ts.

   And FLYLEAF PATCH 6 lives here: `MOBI6.loadSection` and `KF8.loadSection`
   dispatch the `data` event for the section document, which is the seam
   reader/harden.ts uses to put `script-src 'none'` on the page. Before the
   patch a MOBI section reached the iframe with no policy on it at all, so the
   fixture's inline script, its `onclick` and its `javascript:` href would each
   have run on the origin that owns the library.

   The fixture is generated — audit/fixtures/make-mobi.mjs, which explains why a
   hand-built one was the only option on this machine. */
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

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

const errors = []
const warns = []
page.on('console', msg => {
    /* A CSP violation report IS the pass here, so it is collected separately
       rather than counted as a console error the way every other driver does.
       Warnings are collected because `MOBI6.init` catches a failure to build
       the contents list and console.warns it — a driver that only watches
       errors reports "0 entries" without the reason. */
    const t = msg.text()
    if (msg.type() === 'error') (/Content Security Policy/i.test(t) ? csp : errors).push(t)
    else if (msg.type() === 'warning') warns.push(t)
})
const csp = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

const requests = []
page.on('request', r => requests.push(r.url()))

const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')

const at = async () => {
    const host = await page.evaluate(() => {
        const v = document.querySelector('foliate-view')
        const l = v?.renderer?.contentLayer
        return {
            page: v?.renderer?.page ?? null,
            scrollLeft: l?.parentElement?.scrollLeft ?? null,
        }
    })
    /* `chars` comes from the content frame, not the host: an end-of-book check
       that only reads the host cannot tell "held the last page" from "blanked
       the stage". */
    const chars = await frame()?.evaluate(() => document.body?.innerText?.trim().length ?? 0)
        .catch(() => null) ?? null
    return { ...host, chars, section: frame()?.url() ?? null }
}

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

/* ── import ─────────────────────────────────────────────────────────────── */
await page.goto(BASE + '/open', { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
await page.locator('input[type=file]').setInputFiles(join(HERE, 'fixtures', 'fixture.mobi'))
await page.waitForURL(/\/book\//, { timeout: 20000 })
    .catch(() => bad('import', 'importing fixture.mobi never reached a book page'))
await page.waitForTimeout(600)

m.sheet = await page.evaluate(() => ({
    title: document.querySelector('h1')?.textContent?.trim() ?? null,
    body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
}))
/* EXTH 503 and EXTH 100. If either is missing the importer read the PDB name
   and nothing else, which is the failure the 32-byte name field invites. */
if (!/A Kindle Fixture/i.test(m.sheet.title ?? ''))
    bad('metadata', `the sheet title reads "${m.sheet.title}", not the EXTH title`)
if (!/Flyleaf Audit/i.test(m.sheet.body))
    bad('metadata', 'the EXTH author is not on the book sheet')
/* The format badge, because a MOBI sniffed as something else would still open
   and would still be wrong. */
if (!/MOBI/i.test(m.sheet.body))
    bad('metadata', 'the sheet does not name the format as MOBI')
say(`imported: "${m.sheet.title}"`)

/* ── open ───────────────────────────────────────────────────────────────── */
await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
await page.waitForFunction(() => {
    const v = document.querySelector('foliate-view')
    return !!v && !document.querySelector('.reader-opening')
}, null, { timeout: 25000 })
await page.waitForTimeout(1400)

const f = frame()
if (!f) {
    bad('open', 'the book opened with no section iframe')
} else {
    m.page = await f.evaluate(() => ({
        chars: document.body.innerText.replace(/\s+/g, ' ').trim().length,
        paras: document.querySelectorAll('p').length,
        heads: document.querySelectorAll('h1,h2,h3').length,
        /* The policy itself — injected by reader/harden.ts through the `data`
           event that PATCH 6 added to MOBI6.loadSection. */
        policy: document.querySelector('meta[http-equiv="Content-Security-Policy"]')
            ?.getAttribute('content') ?? null,
        origin: location.origin,
        /* That the threat was real: book content shares the origin that owns
           the library, so a policy is the only thing between them. */
        sameOriginDb: (() => { try { return !!indexedDB && location.origin === window.parent.location.origin } catch { return false } })(),
    }))
    if (m.page.chars < 300)
        bad('open', `only ${m.page.chars} characters rendered — the text records did not decode`)
    if (!m.page.paras) bad('open', 'no paragraphs in the rendered section')
    if (m.page.policy !== "script-src 'none'")
        bad('sandbox', `the section carries no script policy (meta reads ${JSON.stringify(m.page.policy)})`)

    /* ── nothing the file carried ran ───────────────────────────────────── */
    /* Read inside the frame: the fixture's script, handler and href each write
       to their own `window`, which is the content document's, not the host's. */
    m.ran = await f.evaluate(() => {
        const out = {
            script: window.__mobiScript ?? false,
            handler: window.__mobiHandler ?? false,
            href: window.__mobiHref ?? false,
            /* What the document still CARRIES. Without these three, "nothing
               ran" would also be the reading if the parser had quietly dropped
               the hostile markup on the way in — a pass that proves nothing.
               The policy's job is to make script inert, not absent. */
            scriptEls: document.querySelectorAll('script').length,
            handlerAttrs: [...document.querySelectorAll('*')]
                .filter(el => [...el.attributes].some(x => x.name.toLowerCase().startsWith('on'))).length,
            jsHrefs: [...document.querySelectorAll('[href]')]
                .filter(a => /^javascript:/i.test(a.getAttribute('href') ?? '')).length,
        }
        /* And that the policy is live rather than merely present: a script
           element added to the loaded document must not run either. This one is
           world-independent — the script belongs to the document, so the
           document's policy decides, which is not true of `eval` called from a
           driver (see the comment where that check used to be). */
        const s = document.createElement('script')
        s.textContent = 'window.__mobiInjected = true'
        document.body.append(s)
        out.injected = window.__mobiInjected ?? false
        const p = document.querySelector('p[onclick]')
        if (p) { p.click(); out.handlerAfterClick = window.__mobiHandler ?? false }
        return out
    })
    /* No `eval`/`new Function` probe here, deliberately. Playwright's
       `evaluate` may run in an isolated world, which is exempt from the page's
       CSP — so the same probe reported "threw" against an EPUB section and
       "ran" against this one, measuring the harness rather than the app. It is
       also not load-bearing: `eval` needs script already running, and nothing
       can start. */
    for (const [key, label] of [
        ['script', 'the inline <script> the file carried'],
        ['handler', 'an onclick attribute the file carried'],
        ['href', 'a javascript: href the file carried'],
        ['injected', 'a script injected into the loaded section'],
    ]) if (m.ran[key] === true) bad('sandbox', `${label} executed`)
    if (m.ran.handlerAfterClick === true)
        bad('sandbox', 'an onclick attribute the file carried ran when clicked')
    /* The fixture is only a test while the document still holds all three. */
    if (!m.ran.scriptEls) bad('fixture', 'no <script> reached the section — the sandbox test is vacuous')
    if (!m.ran.handlerAttrs) bad('fixture', 'no inline handler reached the section — the sandbox test is vacuous')
    if (!m.ran.jsHrefs) bad('fixture', 'no javascript: href reached the section — the sandbox test is vacuous')
    say(`sandbox: policy ${JSON.stringify(m.page.policy)}, `
        + `${csp.length} violation report(s), nothing ran`)

    /* ── a turn turns ───────────────────────────────────────────────────── */
    /* Before the contents jump, deliberately. The jump lands on the last
       chapter, which is a single page — so a forward turn there has nowhere to
       go, and reading that as "the page did not turn" measures the driver's
       ordering rather than the app. The end of the book gets its own check
       below, where refusing to advance is the correct answer. */
    const beforeTurn = await at()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(800)
    const afterTurn = await at()
    m.turn = { beforeTurn, afterTurn }
    if (beforeTurn.page === afterTurn.page
        && beforeTurn.section === afterTurn.section
        && beforeTurn.scrollLeft === afterTurn.scrollLeft)
        bad('turn', `the page did not turn — still page ${afterTurn.page}`)

    /* ── the contents list, built from filepos ──────────────────────────── */
    if (!await showChrome()) bad('chrome', 'the chrome never appeared on a tap')
    else {
        await page.getByRole('button', { name: 'Contents' }).click()
        await page.waitForTimeout(400)
        const entries = page.locator('.reader-toc-link')
        m.toc = await entries.count()
        m.tocLabels = await entries.allTextContents()
        if (m.toc < 2)
            bad('toc', `the contents list has ${m.toc} entries; the guide points at two chapters`)
        else {
            const before = await at()
            const entry = entries.nth(1)
            const label = (await entry.textContent())?.trim() ?? null
            await entry.click()
            await page.waitForTimeout(1000)
            const after = await at()
            m.tocJump = { label, before, after }
            if (before.section === after.section && before.page === after.page
                && before.scrollLeft === after.scrollLeft)
                bad('toc', `a filepos entry did not move the page — still page ${after.page}`)

            /* The jump landed on the last chapter. Two forward turns from here
               must run out of book and STAY there — an ereader that loops back
               to the start, or blanks the stage, fails a reader who taps once
               past the end. */
            await page.keyboard.press('Escape').catch(() => {})
            await page.waitForTimeout(250)
            const atEnd = await at()
            await page.keyboard.press('ArrowRight')
            await page.waitForTimeout(600)
            await page.keyboard.press('ArrowRight')
            await page.waitForTimeout(600)
            const pastEnd = await at()
            m.pastEnd = { atEnd, pastEnd }
            if (pastEnd.section !== atEnd.section)
                bad('end', 'turning past the last page left the final section')
            if (!pastEnd.chars) bad('end', 'turning past the last page emptied the stage')
        }
        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(250)
    }

}

m.offOrigin = requests.filter(u => !u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:'))
if (m.offOrigin.length)
    bad('offline', `the page made ${m.offOrigin.length} off-origin request(s) — ${m.offOrigin.slice(0, 4).join(', ')}`)
if (errors.length) bad('console', errors.slice(0, 3).join(' | '))

m.cspReports = csp.length
m.errors = errors
m.warns = warns
console.log(JSON.stringify({ steps, findings, measures: m }, null, 2))
console.log(`\n=== FINDINGS: ${findings.length} ===`)
for (const x of findings) console.log(' - ' + x)
await browser.close()
process.exit(findings.length ? 1 : 0)
