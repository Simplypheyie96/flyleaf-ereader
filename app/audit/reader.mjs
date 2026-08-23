/* The reader, measured rather than eyeballed.

   Everything in here is a number read off the rendered page: the two side
   margins of the text column (both of them, because the trailing one is the
   one that drifts), whether the foot bar is inside the window, whether a turn
   moved the text and only the transform, and whether a change of font size
   lands on the SAME PARAGRAPH rather than the same percentage. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const out = { steps: [], findings: [], measures: {} }
const say = s => out.steps.push(s)
const bad = (what, detail) => out.findings.push({ what, detail })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)                              // splash + seeding
await page.getByRole('link').filter({ hasText: /Pride/i }).first().click()
    .catch(async () => { await page.locator('a[href^="/book/"]').first().click() })
await page.waitForTimeout(500)
await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
say('navigated into the reader')

/* The book has to actually render before anything is measured. */
await page.waitForFunction(() => {
    const v = document.querySelector('foliate-view')
    return !!v && !document.querySelector('.reader-opening')
}, null, { timeout: 20000 }).catch(() => bad('open', 'the book never finished opening'))
await page.waitForTimeout(1200)

const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')

/* ── 1. the pane fills the window and nothing overflows it ── */
out.measures.geometry = await page.evaluate(() => {
    const r = document.querySelector('.reader').getBoundingClientRect()
    const s = document.querySelector('.reader-stage').getBoundingClientRect()
    return {
        window: { w: innerWidth, h: innerHeight },
        reader: { w: Math.round(r.width), h: Math.round(r.height) },
        stage: { w: Math.round(s.width), h: Math.round(s.height), top: Math.round(s.top) },
        docScrollW: document.documentElement.scrollWidth,
        docScrollH: document.documentElement.scrollHeight,
    }
})
{
    const g = out.measures.geometry
    if (g.docScrollW > g.window.w) bad('overflow', `document scrolls horizontally: ${g.docScrollW} > ${g.window.w}`)
    if (g.docScrollH > g.window.h) bad('overflow', `document scrolls vertically: ${g.docScrollH} > ${g.window.h}`)
    if (Math.abs(g.reader.h - g.window.h) > 1) bad('geometry', `.reader ${g.reader.h} != window ${g.window.h}`)
}

/* ── 2. both side margins of the text column, chrome shut ── */
const margins = async (label) => {
    const f = frame()
    if (!f) { bad('frame', 'no section iframe'); return null }
    const m = await f.evaluate(() => {
        /* The section iframe is as wide as the entire multi-column strip, so
           its own clientX space is useless for "what is on screen". Everything
           here is converted to HOST viewport coordinates through the iframe
           element's offset, which is where the reader's eye actually is. */
        const off = window.frameElement?.getBoundingClientRect().left ?? 0
        const hostW = window.parent.innerWidth
        const ps = [...document.querySelectorAll('p')]
            .map(p => ({ el: p, r: p.getBoundingClientRect() }))
            .filter(x => x.r.width > 40 && x.r.height > 0 &&
                off + x.r.left > -2 && off + x.r.right < hostW + 2)
        if (!ps.length) return null
        const left = Math.round(off + Math.min(...ps.map(x => x.r.left)))
        const right = Math.round(off + Math.max(...ps.map(x => x.r.right)))
        const cs = getComputedStyle(document.documentElement)
        return {
            hostViewport: hostW, stripWidth: innerWidth,
            textLeft: left, textRight: right,
            gapLeft: left, gapRight: hostW - right,
            fontSize: cs.fontSize, lineHeight: cs.lineHeight,
            family: cs.fontFamily.split(',')[0],
            weight: cs.fontWeight,
            ch: Math.round((right - left) / (parseFloat(cs.fontSize) * 0.5)),
        }
    })
    if (!m) { bad('measure', `${label}: no laid-out paragraph found`); return null }
    /* A phone cannot give 60ch at a readable size; a desktop must. The floor
       here is "not painfully narrow", which is where a 4-12% margin lands. */
    if (m.ch < 28) bad('measure', `${label}: ${m.ch} characters per line is too narrow`)
    out.measures[label] = m
    if (Math.abs(m.gapLeft - m.gapRight) > 3)
        bad('margins', `${label}: leading gap ${m.gapLeft} vs trailing gap ${m.gapRight}`)
    return m
}
await margins('margins-closed')

/* ── 3. a turn: does the text change, and is the transform the only thing? ── */
const firstWords = async () => {
    const f = frame()
    return f ? f.evaluate(() => {
        const off = window.frameElement?.getBoundingClientRect().left ?? 0
        const hostW = window.parent.innerWidth
        const p = [...document.querySelectorAll('p')].find(p => {
            const r = p.getBoundingClientRect()
            return r.width > 40 && off + r.left > -2 && off + r.left < hostW - 20
        })
        return p ? p.textContent.trim().slice(0, 60) : null
    }) : null
}
const before = await firstWords()
await page.mouse.click(340, 400)                              // trailing third → forward
await page.waitForTimeout(700)
const after = await firstWords()
out.measures.turn = { before, after, moved: before !== after }
if (before && before === after) bad('turn', 'a tap in the trailing third did not change the page')
say(`turn: ${before ? before.slice(0, 30) : '?'} -> ${after ? after.slice(0, 30) : '?'}`)

/* ── 4. chrome FLOATS: the stage must not move, and the row must be inert ──
   This asserted the opposite for two releases — that the bars were rows and
   the stage shrank to make space. The chrome floats now, which is the whole
   reason a reveal costs nothing: nothing in the flow moves, so there is no
   reflow and no re-pagination, and the page under the chrome keeps turning
   because the row itself is pointer-events:none with only its children live.
   Those are the three properties worth holding, so those are the three
   measured here. The old form reported a 64px overlap and a stage that
   "barely shrank" on every correct layout. */
await page.mouse.click(195, 400)                              // middle third → chrome
await page.waitForTimeout(400)
out.measures.chrome = await page.evaluate(() => {
    const s = document.querySelector('.reader-stage').getBoundingClientRect()
    const top = document.querySelector('.reader-bar--top')?.getBoundingClientRect()
    const foot = document.querySelector('.reader-bar--bottom')?.getBoundingClientRect()
    return {
        stage: { top: Math.round(s.top), bottom: Math.round(s.bottom), h: Math.round(s.height) },
        top: top && { top: Math.round(top.top), bottom: Math.round(top.bottom) },
        foot: foot && { top: Math.round(foot.top), bottom: Math.round(foot.bottom) },
        windowH: innerHeight,
        readout: document.querySelector('.reader-readout')?.textContent.trim(),
        /* the row is inert and unpainted; its children answer taps */
        rowPE: [top, foot].filter(Boolean).map(() => 0).length
            ? [document.querySelector('.reader-bar--top'), document.querySelector('.reader-bar--bottom')]
                .filter(Boolean).map(el => {
                    const cs = getComputedStyle(el)
                    const kid = Array.from(el.children).find(k => k.getBoundingClientRect().width)
                    return {
                        pe: cs.pointerEvents, bg: cs.backgroundColor,
                        kidPE: kid ? getComputedStyle(kid).pointerEvents : null,
                    }
                })
            : [],
    }
})
{
    const c = out.measures.chrome
    if (!c.top || !c.foot) bad('chrome', 'a bar did not appear on the middle tap')
    else {
        if (c.foot.bottom > c.windowH + 1) bad('chrome', `foot bar is ${c.foot.bottom - c.windowH}px below the window`)
        for (const r of c.rowPE) {
            if (r.pe !== 'none') bad('chrome', `a floating bar is pointer-events:${r.pe} — it eats taps meant for the turn`)
            if (r.kidPE && r.kidPE !== 'auto') bad('chrome', `a bar's controls are pointer-events:${r.kidPE}`)
            /* transparent, so the lines it floats over stay readable */
            if (!/rgba\(0, 0, 0, 0\)|transparent/.test(r.bg)) bad('chrome', `a floating bar paints ${r.bg} over the text`)
        }
    }
    /* The point of floating: revealing the chrome must not reflow the book. */
    if (Math.abs(out.measures.geometry.stage.h - c.stage.h) > 1)
        bad('chrome', `the reveal resized the stage: ${out.measures.geometry.stage.h} -> ${c.stage.h}`)
    say(`chrome: stage ${out.measures.geometry.stage.h} -> ${c.stage.h}, readout "${c.readout}"`)
}
await margins('margins-open')

/* ── 5. contents ── */
await page.getByRole('button', { name: 'Contents' }).click()
await page.waitForTimeout(300)
out.measures.toc = await page.evaluate(() => {
    const t = document.querySelector('.reader-panel')
    if (!t) return null
    const r = t.getBoundingClientRect()
    const s = document.querySelector('.reader-stage').getBoundingClientRect()
    const bar = document.querySelector('.reader-bar--top').getBoundingClientRect()
    const rows = [...t.querySelectorAll('.reader-toc-link')]
    return {
        rows: rows.length,
        first: rows[0]?.textContent.trim(),
        coversStageExactly: Math.abs(r.top - s.top) < 1 && Math.abs(r.bottom - s.bottom) < 1,
        clearsTopBar: r.top >= bar.bottom - 1,
        minRowH: Math.min(...rows.map(x => Math.round(x.getBoundingClientRect().height))),
    }
})
if (!out.measures.toc?.rows) bad('toc', 'the contents list is empty')
else {
    if (!out.measures.toc.coversStageExactly) bad('toc', 'the contents list does not line up with the stage')
    if (out.measures.toc.minRowH < 44) bad('toc', `a contents row is ${out.measures.toc.minRowH}px tall, under the 44px target`)
    say(`toc: ${out.measures.toc.rows} rows, first "${out.measures.toc.first}"`)
}
/* Jump to a chapter, then use it as the anchor for the CFI test. */
await page.locator('.reader-toc-link').nth(2).click()
await page.waitForTimeout(1000)

/* ── 6. the CFI test: the SAME PARAGRAPH after a font-size change ── */
const anchor = await firstWords()
/* The honest criterion is "the sentence you were reading is still on the page",
   not "it is still the first thing on it": re-laying out at a larger size makes
   the page start earlier or later by design, and a CFI lands the page that
   CONTAINS the anchor. Anything looser than this would pass for a percentage. */
const visibleText = async () => {
    const f = frame()
    return f ? f.evaluate(() => {
        const off = window.frameElement?.getBoundingClientRect().left ?? 0
        const hostW = window.parent.innerWidth
        return [...document.body.querySelectorAll('p, h1, h2, h3, li, blockquote')]
            .filter(el => {
                const r = el.getBoundingClientRect()
                return r.width > 20 && off + r.left > -2 && off + r.left < hostW - 10
            })
            .map(el => el.textContent.trim()).join(' \u2022 ')
    }) : null
}
const anchorPage = await visibleText()
for (let i = 0; i < 4; i++) { await page.keyboard.press('+'); await page.waitForTimeout(350) }
await page.waitForTimeout(900)
const afterSize = await firstWords()
const afterPage = await visibleText()
out.measures.cfi = {
    anchor, afterSize,
    stillOnPage: !!anchor && !!afterPage && afterPage.includes(anchor.slice(0, 30)),
    same: !!anchor && !!afterSize &&
        (afterSize.startsWith(anchor.slice(0, 24)) || anchor.startsWith(afterSize.slice(0, 24))),
    size: await page.evaluate(async () => {
        const f = document.querySelector('foliate-view')
        return f?.renderer?.getAttribute('max-inline-size')
    }),
}
if (!out.measures.cfi.stillOnPage)
    bad('cfi', `four font-size steps left the anchor paragraph off the page: "${anchor}" -> page now "${(afterPage || '').slice(0, 160)}"`)
else if (!out.measures.cfi.same)
    say(`cfi: the anchor is still on the page but no longer at its head — expected, the page start re-derives`)
const grown = await margins('margins-larger-type')
if (grown && out.measures['margins-closed'] && grown.fontSize === out.measures['margins-closed'].fontSize)
    bad('type', 'the + key did not change the reading size')

/* ── 7. the seven stocks, and the ink measured against each ground ── */
await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(400)
out.measures.errors = errors
await browser.close()
console.log(JSON.stringify(out, null, 2))
