/* Does the text fill the box it is in?

   The owner's complaint, verbatim: "we have the words wrapping before they
   fill the container issue again. this is such a reoccuring problem". It is
   recurring because it is invisible in the source — every rule reads fine on
   its own, and the break only exists in the relationship between a `max-width`
   on the text and the width of the box that ended up around it. Nothing in
   this repo measured that relationship until now.

   So: every route, at both ends of the supported range, every block of prose.
   For each one, the WIDEST RENDERED LINE, taken with a Range over the text
   nodes rather than from the element's own box — a block is as wide as its
   container by default, so element.getBoundingClientRect() reports the box and
   says nothing about where the words actually stop.

   A block is reported when it WRAPS (more than one line) and its widest line
   still leaves a large share of its container's content width unused. A
   single-line block that is short is just a short sentence. A wrapped block
   that stops well short of the edge is a cap fighting its container, which is
   the bug. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fixturePdf } from './fixture-pdf.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'

/* Serve the BUILT app ourselves unless BASE was pointed somewhere already.
   This driver used to require a preview server the caller had to remember to
   start, which in practice meant it was never run at all -- see the note on
   the measure in index.css. Owning the server is what makes
   `npm run audit:measure` one command with nothing to remember. */
let server = null
if (!process.env.BASE) {
    const { spawn } = await import('node:child_process')
    server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
    for (let i = 0; i < 80; i++) {
        try { await fetch(BASE); break } catch { await new Promise(r => setTimeout(r, 250)) }
    }
}
/* Of the box the words were ALLOWED (see `host` in the probe). A tenth is
   already more than ragged-right accounts for — measured, the widest line of
   ordinary prose lands within 4–7% of its own content box on every page here,
   phone included. */
const SLACK = Number(process.env.SLACK || 0.10)
const findings = []
const rows = []
let centred = 0, layout = 0, covered = 0

const PROBE = `((slack) => {
  const out = []
  /* The last glyph's right edge, not the block's. A Range over the block's
     text gives one rect per line box, so max(rect.right) is where the longest
     line really ends and rects.length is the real line count after wrapping. */
  const lines = (el) => {
    const r = document.createRange()
    r.selectNodeContents(el)
    const rects = [...r.getClientRects()].filter(b => b.width > 0.5 && b.height > 0.5)
    if (!rects.length) return null
    /* Line boxes, merged by their top edge — inline children split one visual
       line into several rects, and counting rects would call a line with a
       <code> in it two lines. */
    const byTop = new Map()
    for (const b of rects) {
      const k = Math.round(b.top)
      const cur = byTop.get(k)
      byTop.set(k, cur ? { left: Math.min(cur.left, b.left), right: Math.max(cur.right, b.right) } : { left: b.left, right: b.right })
    }
    const ls = [...byTop.values()]
    return { count: ls.length, widest: Math.max(...ls.map(l => l.right - l.left)), left: Math.min(...ls.map(l => l.left)) }
  }

  const skipped = { centred: 0, layout: 0 }
  const SEL = 'p, dd, li, .ui-p, .lede, blockquote, figcaption'
  for (const el of document.querySelectorAll(SEL)) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis') continue
    /* Centred prose is exempt, and it is the one honest exemption here: a
       narrower column inside a centred card puts its slack evenly on both
       sides, which is a composition, not the ragged one-sided step-in the
       owner reported. Counted and printed rather than dropped quietly. */
    if (cs.textAlign === 'center') { skipped.centred++; continue }
    const txt = el.textContent.replace(/\\s+/g, ' ').trim()
    if (txt.length < 60) continue                      // too short to wrap meaningfully
    const l = lines(el)
    if (!l || l.count < 2) continue                    // a single line cannot be "wrapping early"

    /* The space the words were ALLOWED: the nearest ancestor that is wider
       than this block's own content box, minus that ancestor's padding. That
       is the box the owner sees the text failing to fill. */
    let host = el.parentElement, hostBox = null
    while (host && host !== document.body) {
      const hs = getComputedStyle(host)
      const hb = host.getBoundingClientRect()
      const inner = hb.width - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight)
      if (inner > l.widest + 2) { hostBox = { w: inner, tag: host.tagName.toLowerCase(), cls: host.className?.toString?.().slice(0, 60) ?? '' }; break }
      host = host.parentElement
    }
    if (!hostBox) continue
    /* The block's OWN content box, and it is what separates the two failures
       that look identical in a screenshot.

       A max-width shrinks the element itself, so the words still fill their
       own box — which is why the denominator for a cap has to be the host and
       not ownW. But an element narrower than its host with NO cap on it is a
       layout fact, not a text fact: a flex sibling beside a 38px mark, a grid
       track, an anchor with an icon column. Those filled 93–100% of their own
       box on every page here and reporting them as "text wrapping early" is
       how this driver cried wolf eight times. */
    const ob = el.getBoundingClientRect()
    const ownW = ob.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    const unused = 1 - l.widest / hostBox.w
    if (unused <= slack) continue
    const fillsOwn = l.widest / ownW >= 0.90
    if (cs.maxWidth === 'none' && fillsOwn) { skipped.layout++; continue }
    out.push({
      sel: el.tagName.toLowerCase() + (el.className?.toString?.() ? '.' + el.className.toString().trim().split(/\\s+/).join('.') : ''),
      lines: l.count,
      widest: +l.widest.toFixed(1),
      host: hostBox.tag + (hostBox.cls ? '.' + hostBox.cls.trim().split(/\\s+/).join('.') : ''),
      hostW: +hostBox.w.toFixed(1),
      unusedPct: Math.round(unused * 100),
      ownW: +ownW.toFixed(1),
      cap: cs.maxWidth,
      text: txt.slice(0, 70),
    })
  }
  return { out, skipped }
})(${SLACK})`

/* SCREENS, not routes.

   This walked eight paths and called it the app, and two of them were not what
   they looked like: /collections is not a route at all (App.tsx redirects it
   home), so a quarter of the desktop findings were Home counted twice, and the
   two screens with the most prose on them — a book's detail page and the
   reader — were never opened. Neither was any sheet, because a sheet is not a
   URL.

   So a screen here is a name and the steps to GET there. Anything that cannot
   be reached in this run (no book on the shelf, no PDF imported) is named in
   the output as not covered rather than passing quietly, because a driver that
   silently measures less than it claims is how the last cap survived. */
const uncovered = []

const SCREENS = [
    { name: '/', go: async p => { await p.goto(BASE + '/', { waitUntil: 'networkidle' }) } },
    { name: '/library', go: async p => { await p.goto(BASE + '/library', { waitUntil: 'networkidle' }) } },
    { name: '/open', go: async p => { await p.goto(BASE + '/open', { waitUntil: 'networkidle' }) } },
    { name: '/stats', go: async p => { await p.goto(BASE + '/stats', { waitUntil: 'networkidle' }) } },
    { name: '/settings', go: async p => { await p.goto(BASE + '/settings', { waitUntil: 'networkidle' }) } },
    { name: '/privacy', go: async p => { await p.goto(BASE + '/privacy', { waitUntil: 'networkidle' }) } },
    { name: '/terms', go: async p => { await p.goto(BASE + '/terms', { waitUntil: 'networkidle' }) } },

    /* The id comes off the shelf rather than being hard-coded, so this keeps
       working when the seed changes. */
    { name: '/book/:id', go: async p => {
        await p.goto(BASE + '/library', { waitUntil: 'networkidle' })
        await p.waitForTimeout(900)
        const href = await p.evaluate(() => document.querySelector('a[href^="/book/"]')?.getAttribute('href') ?? null)
        if (!href) return 'no book on the shelf to open'
        await p.goto(BASE + href, { waitUntil: 'networkidle' })
    } },

    { name: '/read/:id', go: async p => {
        const href = await openReader(p)
        if (!href) return 'no book on the shelf to read'
    } },

    /* The two sheets that carry prose. Both hang off the reader's chrome, which
       is why they were invisible to a walk over URLs. */
    { name: 'reader · contents/marks/search', go: async p => {
        if (!(await openReader(p))) return 'no book on the shelf to read'
        return openChrome(p, 'Contents, marks and search')
    } },
    { name: 'reader · text and page settings', go: async p => {
        if (!(await openReader(p))) return 'no book on the shelf to read'
        return openChrome(p, 'Text and page settings')
    } },

    /* The PDF reader and its two sheets. A PDF is not seeded -- the shelf ships
       two INCLUDED books and that is a product decision, not an audit one -- so
       the fixture is imported through the app's own picker at the start of each
       viewport's run and thrown away at the end. Before this, .sheet-lead was
       measured by hand, which is how it kept a 46ch cap that left 54% of its
       sheet empty. */
    { name: '/read/:id (pdf)', go: async p => {
        const href = await openPdf(p)
        if (!href) return 'the PDF fixture did not import'
    } },
    { name: 'pdf · contents/bookmarks/search', go: async p => {
        if (!(await openPdf(p))) return 'the PDF fixture did not import'
        return openChrome(p, 'Contents, bookmarks and search')
    } },
    { name: 'pdf · page settings', go: async p => {
        if (!(await openPdf(p))) return 'the PDF fixture did not import'
        return openChrome(p, 'Page settings')
    } },
]

/* Imported once per context, then reused: importing the same file again lands
   on the duplicate path, which still ends at the book, but there is no reason
   to pay for the parse three times. */
let pdfHref = null
async function openPdf(p) {
    if (!pdfHref) {
        await p.goto(BASE + '/open', { waitUntil: 'networkidle' })
        await p.locator('input[type=file]').setInputFiles(FIXTURE)
        try { await p.waitForURL(/\/book\//, { timeout: 15000 }) } catch { return null }
        pdfHref = new URL(p.url()).pathname
    }
    await p.goto(BASE + pdfHref.replace('/book/', '/read/'), { waitUntil: 'networkidle' })
    await p.waitForTimeout(2200)                                // pdfjs + first page
    return pdfHref
}

/* The reader hides its chrome until the page is tapped, and the tap has to land
   in the middle third or it turns the page instead. */
async function openReader(p) {
    await p.goto(BASE + '/library', { waitUntil: 'networkidle' })
    await p.waitForTimeout(900)
    const href = await p.evaluate(() => document.querySelector('a[href^="/book/"]')?.getAttribute('href') ?? null)
    if (!href) return null
    await p.goto(BASE + href.replace('/book/', '/read/'), { waitUntil: 'networkidle' })
    await p.waitForTimeout(2200)                                // parse + first paint
    return href
}

async function openChrome(p, label) {
    const vp = p.viewportSize()
    await p.mouse.click(vp.width / 2, vp.height / 2)            // reveal the chrome
    await p.waitForTimeout(600)
    const btn = p.locator(`[aria-label="${label}"]`).first()
    if (!(await btn.count()) || !(await btn.isVisible())) return `the ${label} control never appeared`
    await btn.click()
    await p.waitForTimeout(800)
    return null
}

const FIXTURE = join(mkdtempSync(join(tmpdir(), 'flyleaf-audit-')), 'audit-fixture.pdf')
writeFileSync(FIXTURE, fixturePdf())

const browser = await chromium.launch()
for (const [w, h, name] of [[390, 844, 'phone'], [1280, 900, 'desktop'], [1024, 1366, 'ipad']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    pdfHref = null                                              // one import per context
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2600)                             // splash + seed
    for (const screen of SCREENS) {
        let why = null
        try { why = await screen.go(page) } catch (e) { why = e.message.split('\n')[0] }
        if (why) { uncovered.push(`${name} ${screen.name} — ${why}`); continue }
        await page.waitForTimeout(700)
        const { out: seen, skipped } = await page.evaluate(PROBE)
        covered++
        centred += skipped.centred
        layout += skipped.layout
        for (const s of seen) {
            rows.push({ view: name, route: screen.name, ...s })
            findings.push(`${name} ${screen.name}  ${s.sel} wraps to ${s.lines} lines but its widest is ${s.widest}px in a ${s.hostW}px ${s.host} (own box ${s.ownW}px) — ${s.unusedPct}% of the box unused (max-width: ${s.cap}) — "${s.text}"`)
        }
    }
    await ctx.close()
}
await browser.close()

console.log(JSON.stringify({ slack: SLACK, rows }, null, 2))
console.log(`\nexempt: ${centred} centred (slack sits evenly on both sides), ${layout} uncapped and filling ≥90% of their own box (the element is narrow, not the text)`)
console.log(`\ncovered: ${covered} screen renders across 3 viewports`)
/* One boundary, stated rather than left to be discovered: the reader's own
   page is foliate's iframe, so the BOOK's text is not measured here and should
   not be -- its measure is a reader setting with its own control, not a
   layout fault. What is measured on /read/:id is the app's chrome around it,
   and the two sheets are where that chrome's prose actually lives. */
console.log('note: /read/:id measures the chrome only; the book text is inside foliate\'s iframe and is governed by the measure control, not by this driver')
if (uncovered.length) {
    console.log(`NOT COVERED (${uncovered.length}) — these were not measured, and this driver does not claim they pass:`)
    for (const u of uncovered) console.log('  · ' + u)
}
console.log(`\n=== FINDINGS: ${findings.length}`)
for (const f of findings) console.log('  · ' + f)

rmSync(FIXTURE, { force: true })
server?.kill()
/* Non-zero so this can gate a release rather than merely narrate one. */
process.exit(findings.length ? 1 : 0)
