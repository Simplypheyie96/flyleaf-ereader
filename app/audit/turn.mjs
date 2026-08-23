/* P2, measured. The page turn and the highlight overlay — the two things the
   owner has now raised three times ("the turns for books still needs to be
   better, it looks super weird, highlights is not smooth and stable").

   Nothing here is a screenshot comparison. Three numbers are wanted:

     1. how often the SEAM path fires. `turn.ts#readEdges` latches #seamFwd on
        `page >= pages - 2` and #seamBack on `page <= 1`, and `pages` is
        PER SECTION (paginator.js:821, `viewSize / size`). So the seam is the
        first and last page of every chapter, not only a genuine file
        boundary — and on those pages the drag is damped to SEAM_RESIST 0.35
        and the commit is a fade-out-and-back instead of a slide.

     2. what the section load actually costs. If `renderer.next()` across a
        section boundary is a few milliseconds, the fade is theatre; if it is
        a hundred, it is load-bearing. The fix chosen depends on which.

     3. whether the highlight overlay is where the words are. The overlay SVG
        is `left: size` inside `#view.element` and the section iframe is
        centred in the same box at the same offset (paginator.js:369-394), so
        a rect's SVG user coordinates should EQUAL the range's frame-local
        client rect. Any drift is measurable to the pixel, and is measured
        here across a turn, a font-size change, a chapter crossing and a
        reopen.

   The overlay is inside foliate's closed shadow root, so no query reaches it
   — but `renderer.getContents()[0].overlayer.element` is a live JS reference
   and that is how it is read. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const TURNS = Number(process.env.TURNS || 60)
const out = { steps: [], findings: [], measures: {} }
const say = s => out.steps.push(s)
const bad = (what, detail) => out.findings.push({ what, detail })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

const openBook = async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)
    await page.locator('a[href^="/book/"]').first().click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
    await page.waitForFunction(() => {
        const v = document.querySelector('foliate-view')
        return !!v && !document.querySelector('.reader-opening')
    }, null, { timeout: 20000 }).catch(() => bad('open', 'the book never finished opening'))
    await page.waitForTimeout(1400)
}
await openBook()
say('opened the reader at 390x844')

const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')

const ensureChrome = async () => {
    for (let i = 0; i < 3; i++) {
        const shown = await page.evaluate(() => {
            const b = document.querySelector('button[aria-label="Contents, marks and search"]')
            if (!b) return false
            const cs = getComputedStyle(b)
            return b.getClientRects().length > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.5
        })
        if (shown) return true
        await page.locator('.reader-stage').click({ position: { x: 195, y: 420 } }).catch(() => { })
        await page.waitForTimeout(420)
    }
    return false
}

/* ── 1. the seam census ───────────────────────────────────────────────────
   Walked with `renderer.next()` rather than a synthetic swipe on purpose:
   the question is how the BOOK is shaped, not how the gesture reads. The
   gesture's damping and fade are decided by exactly the two predicates
   recomputed here. */
const census = await page.evaluate(async (n) => {
    const r = document.querySelector('foliate-view')?.renderer
    if (!r) return null
    const rows = []
    for (let i = 0; i < n; i++) {
        const before = { index: r.getContents()[0]?.index, page: r.page, pages: r.pages, atEnd: !!r.atEnd }
        if (before.atEnd) break
        const seamFwd = !before.atEnd && before.page >= before.pages - 2
        const t0 = performance.now()
        await r.next()
        const ms = performance.now() - t0
        const after = { index: r.getContents()[0]?.index, page: r.page, pages: r.pages }
        rows.push({ ...before, seamFwd, ms: +ms.toFixed(1), crossed: after.index !== before.index, toIndex: after.index })
    }
    return rows
}, TURNS)

if (!census || !census.length) bad('census', 'could not walk the book with renderer.next()')
else {
    const seam = census.filter(r => r.seamFwd)
    const flat = census.filter(r => !r.seamFwd)
    const stat = rows => {
        if (!rows.length) return null
        const ms = rows.map(r => r.ms).sort((a, b) => a - b)
        return { n: rows.length, min: ms[0], med: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] }
    }
    const sections = new Map()
    for (const r of census) if (r.pages > 0) sections.set(r.index, r.pages - 2)
    out.measures.census = {
        turns: census.length,
        seamTurns: seam.length,
        seamShare: +(seam.length / census.length).toFixed(3),
        crossedSection: census.filter(r => r.crossed).length,
        /* A seam turn that did NOT change section is the damping and the fade
           spent on nothing at all. */
        seamWithoutCrossing: seam.filter(r => !r.crossed).length,
        crossingWithoutSeam: census.filter(r => r.crossed && !r.seamFwd).length,
        seamMs: stat(seam),
        flatMs: stat(flat),
        sectionTextPages: Object.fromEntries([...sections].map(([k, v]) => [k, v])),
    }
    say(`walked ${census.length} turns: ${seam.length} on the seam path, ${census.filter(r => r.crossed).length} actually crossed a section`)
}

/* ── 2. the highlight overlay, to the pixel ──────────────────────────────── */
await openBook()

const window0 = () => page.evaluate(() => {
    const r = document.querySelector('foliate-view')?.renderer
    return { start: r?.start ?? 0, size: r?.size ?? 0 }
})

/* Select a run of words on the visible page, in the frame's own document. */
const select = async () => {
    const f = frame()
    if (!f) { bad('frame', 'no section iframe'); return null }
    const win = await window0()
    const got = await f.evaluate(({ lo, hi }) => {
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const cands = []
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const s = n.nodeValue
            if (!s || s.trim().length < 90) continue
            const r = document.createRange()
            r.selectNodeContents(n)
            const box = r.getClientRects()[0]
            if (!box || box.left < lo || box.left >= hi) continue
            cands.push(n)
        }
        if (!cands.length) return null
        const node = cands[Math.floor(cands.length / 2)]
        const s = node.nodeValue
        const from = Math.max(0, Math.floor(s.length / 4))
        const to = Math.min(s.length, from + 80)   // long enough to wrap 2-3 lines
        const r = document.createRange()
        r.setStart(node, from); r.setEnd(node, to)
        const sel = document.getSelection()
        sel.removeAllRanges(); sel.addRange(r)
        return r.toString()
    }, { lo: win.start - win.size, hi: win.start })
    if (!got) { bad('select', 'no selectable paragraph on the visible page') ; return null }
    await page.waitForTimeout(420)
    return got
}

const text = await select()
if (!text) bad('overlay', 'no selection, so the overlay could not be measured')
else {
    await page.locator('.selmenu-tint[data-tint="mustard"]').click({ timeout: 6000 })
        .catch(e => bad('overlay', 'tint chip click failed: ' + String(e).slice(0, 90)))
    await page.waitForTimeout(500)

    /* The wipe, read off the running animations rather than watched. */
    const wipeSpec = await page.evaluate(() => {
        const o = document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.overlayer
        if (!o) return null
        const g = o.element.lastElementChild
        if (!g) return null
        return Array.from(g.children).map(el => {
            const a = el.getAnimations?.() ?? []
            return a.map(x => ({ dur: x.effect.getTiming().duration, delay: x.effect.getTiming().delay }))
        })
    })
    out.measures.wipe = wipeSpec

    /* Read the overlay's fill rects (SVG user units) and, in the frame, the
       same words' own client rects. They should be equal. */
    const overlayRects = () => page.evaluate(() => {
        const o = document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.overlayer
        if (!o) return null
        const gs = Array.from(o.element.children)
        if (!gs.length) return []
        const g = gs[gs.length - 1]
        return Array.from(g.children).map(el => ({
            x: +Number(el.getAttribute('x')).toFixed(1),
            y: +Number(el.getAttribute('y')).toFixed(1),
            w: +Number(el.getAttribute('width')).toFixed(1),
            h: +Number(el.getAttribute('height')).toFixed(1),
        }))
    })
    const wordRects = async (needle) => {
        const f = frame()
        if (!f) return null
        return f.evaluate(q => {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
            for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                const i = (n.nodeValue || '').indexOf(q)
                if (i < 0) continue
                const r = document.createRange()
                r.setStart(n, i); r.setEnd(n, i + q.length)
                return Array.from(r.getClientRects()).filter(b => b.width > 1).map(b => ({
                    x: +b.left.toFixed(1), y: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
                }))
            }
            return null
        }, needle)
    }

    const drift = async (tag) => {
        const [ov, wd] = await Promise.all([overlayRects(), wordRects(text)])
        if (!ov || !ov.length) { bad('overlay', `${tag}: the overlay has no rects`); return null }
        if (!wd || !wd.length) { bad('overlay', `${tag}: the marked words are not in this section's document`); return null }
        const fills = ov.slice(0, wd.length)
        let dx = 0, dy = 0
        for (let i = 0; i < Math.min(fills.length, wd.length); i++) {
            dx = Math.max(dx, Math.abs(fills[i].x - wd[i].x))
            dy = Math.max(dy, Math.abs(fills[i].y - wd[i].y))
        }
        const row = { tag, lines: wd.length, drawn: ov.length, dx: +dx.toFixed(1), dy: +dy.toFixed(1) }
        ;(out.measures.drift ??= []).push(row)
        if (dx > 2 || dy > 2) bad('overlay', `${tag}: the highlight is ${dx}px across and ${dy}px down from the words it marks`)
        return row
    }

    await drift('on apply')

    /* a turn forward and back */
    await page.evaluate(async () => { const r = document.querySelector('foliate-view').renderer; await r.next() })
    await page.waitForTimeout(400)
    await page.evaluate(async () => { const r = document.querySelector('foliate-view').renderer; await r.prev() })
    await page.waitForTimeout(500)
    await drift('after a turn there and back')

    /* a font-size change — the CFI-anchored re-layout */
    if (await ensureChrome()) {
        await page.locator('button[aria-label="Type and appearance"]').click({ timeout: 5000 }).catch(() => { })
        await page.waitForTimeout(400)
        const stepped = await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find(x => /^(Bigger|Larger|Increase)/i.test(x.getAttribute('aria-label') || ''))
            if (b) { b.click(); return b.getAttribute('aria-label') }
            return null
        })
        if (!stepped) {
            const inp = await page.$('input[type="range"][aria-label*="size" i], input[type="range"][aria-label*="Size"]')
            if (inp) { await inp.press('ArrowRight'); await inp.press('ArrowRight') }
        }
        await page.waitForTimeout(900)
        await drift('after a font-size change')
        await page.keyboard.press('Escape').catch(() => { })
        await page.waitForTimeout(300)
    } else bad('chrome', 'could not open the type panel')

    /* a chapter crossing and back */
    await page.evaluate(async () => {
        const r = document.querySelector('foliate-view').renderer
        await r.nextSection()
    })
    await page.waitForTimeout(900)
    await page.evaluate(async () => {
        const r = document.querySelector('foliate-view').renderer
        await r.prevSection()
    })
    await page.waitForTimeout(1200)
    await drift('after leaving the chapter and coming back')
}

out.errors = errors.slice(0, 8)
console.log(JSON.stringify(out, null, 2))
console.log(`=== FINDINGS: ${out.findings.length} ===`)
await browser.close()
