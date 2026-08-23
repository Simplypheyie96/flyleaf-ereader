/* P3, measured. Selection menu, highlight paint, the panel, search, notes,
   export, and the bookmark tick — every claim below is a number read off the
   rendered page rather than a look at it.

   Two things make this driver different from reader.mjs. The words being marked
   live inside the section iframe, so a selection has to be made in the frame's
   own document and then measured in HOST coordinates. And the panel is a full
   surface at 390 and a 400px column at 1280, so every box is measured at both
   widths, both edges. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'

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

/* ── contrast, the same arithmetic every other driver uses ── */
const CONTRAST = `(() => {
  const lum = rgb => { const [r,g,b] = rgb.map(v => { const s = v/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4) }); return 0.2126*r + 0.7152*g + 0.0722*b }
  const parse = s => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(parseFloat); return { rgb: p.slice(0,3), a: p.length > 3 ? p[3] : 1 } }
  const ratio = (a,b) => { const l1 = lum(a), l2 = lum(b); const [hi,lo] = l1 > l2 ? [l1,l2] : [l2,l1]; return +((hi+0.05)/(lo+0.05)).toFixed(2) }
  const bgOf = el => { let n = el; while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.98) return c.rgb; n = n.parentElement } return [255,255,255] }
  return { parse, ratio, bgOf }
})()`

const pairs = (sel) => page.evaluate(({ sel, src }) => {
    const { parse, ratio, bgOf } = eval(src)
    return Array.from(document.querySelectorAll(sel))
        .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
        .filter(el => Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim()))
        .map(el => {
            const cs = getComputedStyle(el)
            const fg = parse(cs.color)
            const bg = bgOf(el)
            const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400
            const large = size >= 24 || (size >= 18.66 && weight >= 700)
            const need = large ? 3 : 4.5
            const cr = fg ? ratio(fg.rgb, bg) : 21
            return { cls: String(el.className).slice(0, 34), txt: el.textContent.trim().slice(0, 26), size, weight, cr, need, pass: cr >= need, fg: cs.color, bg: `rgb(${bg.join(',')})` }
        })
}, { sel, src: CONTRAST })

const failing = async (sel, tag) => {
    const p = await pairs(sel)
    const f = p.filter(x => !x.pass)
    if (f.length) bad('contrast', `${tag}: ` + f.map(x => `${x.cr}:1 needs ${x.need} (${x.size}px "${x.txt}") ${x.fg} on ${x.bg}`).join(' | '))
    return p
}

/* ── targets under 24px, the WCAG 2.5.8 floor ── */
const smallTargets = (root) => page.evaluate(root => {
    const host = document.querySelector(root)
    if (!host) return null
    return Array.from(host.querySelectorAll('a,button,input,[tabindex]'))
        .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
        .map(el => { const q = el.getBoundingClientRect(); return { cls: String(el.className).slice(0, 30), txt: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 22), w: +q.width.toFixed(1), h: +q.height.toFixed(1) } })
        .filter(t => t.w < 24 || t.h < 24)
}, root)

/* ── open a book ── */
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
say('opened the reader at 390x844')

const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')

/* The chrome hides itself, and a tap in the middle of the page is what brings
   it back — so anything that clicks a bar has to ask first. Without this the
   driver waits thirty seconds for a button that is on screen but transparent. */
const ensureChrome = async () => {
    for (let i = 0; i < 3; i++) {
        const shown = await page.evaluate(() => {
            const b = document.querySelector('button[aria-label="Contents, marks and search"]')
            if (!b) return false
            const cs = getComputedStyle(b)
            return b.getClientRects().length > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.5
        })
        if (shown) return true
        await page.locator('.reader-stage').click({ position: { x: 195, y: 420 } }).catch(() => {})
        await page.waitForTimeout(420)
    }
    return false
}
const openPanel = async (tab) => {
    if (!await ensureChrome()) { bad('chrome', 'could not get the bars back on screen'); return false }
    await page.locator('button[aria-label="Contents, marks and search"]').click({ timeout: 5000 }).catch(e => bad('panel', 'panel button click failed: ' + String(e).slice(0, 90)))
    await page.waitForTimeout(500)
    if (tab) { await page.locator('.panel-tab', { hasText: tab }).click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(400) }
    return !!(await page.$('.reader-panel'))
}

/* Where the visible page sits inside the frame's own coordinate space. Pages
   are laid out side by side, and `expand()` pads the strip with one blank page
   of slack at each end — so the column on screen is [start - size, start). */
const window0 = () => page.evaluate(() => {
    const r = document.querySelector('foliate-view')?.renderer
    return { start: r?.start ?? 0, size: r?.size ?? 0 }
})

/* ── select words on the visible page ──────────────────────────────────────
   `where` picks which end of the column to grab from, because the menu's edge
   clamping is only exercised by a selection that starts near an edge. */
const select = async (where = 'mid') => {
    const f = frame()
    if (!f) { bad('frame', 'no section iframe'); return null }
    const win = await window0()
    const text = await f.evaluate(({ lo, hi, where }) => {
        const doc = document
        const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        const cands = []
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            const s = n.nodeValue
            if (!s || s.trim().length < 60) continue
            const r = doc.createRange()
            r.selectNodeContents(n)
            const box = r.getClientRects()[0]
            if (!box) continue
            if (box.left < lo || box.left >= hi) continue
            cands.push({ node: n, top: box.top, left: box.left })
        }
        if (!cands.length) return null
        cands.sort((a, b) => a.top - b.top)
        const pick = where === 'top' ? cands[0]
            : where === 'bottom' ? cands[cands.length - 1]
            : cands[Math.floor(cands.length / 2)]
        const s = pick.node.nodeValue
        /* Start at a word boundary so the excerpt reads like a quotation. */
        const from = where === 'lead' ? 0 : Math.max(0, Math.floor(s.length / 3))
        const to = Math.min(s.length, from + 42)
        const r = doc.createRange()
        r.setStart(pick.node, from)
        r.setEnd(pick.node, to)
        const sel = doc.getSelection()
        sel.removeAllRanges()
        sel.addRange(r)
        /* The widest line fragment of the selection, in the frame's own
           coordinates, plus the frame's viewport. Both are needed to put the
           words on the host's screen. */
        const rs = Array.from(r.getClientRects()).filter(x => x.width > 4)
        rs.sort((x, y) => y.width - x.width)
        const w0 = rs[0]
        return {
            text: r.toString(),
            sel: w0 ? { x: w0.left, y: w0.top, w: w0.width, h: w0.height } : null,
            frame: { w: innerWidth, h: innerHeight },
        }
    }, { lo: win.start - win.size, hi: win.start, where })
    if (!text) { bad('select', `no selectable paragraph on the visible page (${where})`); return null }
    await page.waitForTimeout(420)                              // the 220ms debounce
    /* ── frame space → host space ──────────────────────────────────────────
       Playwright is no help here: the section iframe lives inside foliate's
       closed shadow root, so it cannot find the frame's own position and
       `boundingBox()` hands back FRAME-LOCAL coordinates — x = 748 on a 390px
       viewport. The translation has to be derived, and it is a pure one:
         · the visible column is [start - size, start), not [start, start+size).
           `expand()` (paginator.js) pads the strip with one blank page of
           slack at each end, so a scrollLeft of one page-width is the FIRST
           real column. Reading it the other way put every measurement one
           page ahead of the screen — which is what made two swatches taken at
           one rect come back on different sentences.
         · the column is centred in the stage, and the frame is centred
           vertically in it.
       Verified by clipping the first and last line of the visible page and
       reading the images back: both landed on the words exactly. */
    const stage = await page.evaluate(() => {
        const r = document.querySelector('.reader-stage').getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
    let rect = null
    if (text.sel) {
        const dx = stage.x + (stage.w - win.size) / 2 - (win.start - win.size)
        const dy = stage.y + (stage.h - text.frame.h) / 2
        rect = { x: +(text.sel.x + dx).toFixed(1), y: +(text.sel.y + dy).toFixed(1), w: +text.sel.w.toFixed(1), h: +text.sel.h.toFixed(1) }
    }
    lastRect = rect
    return text.text
}
let lastRect = null

/* ── what the reader's eye actually gets ────────────────────────────────────
   The overlay the engine draws is inside foliate's CLOSED shadow root
   (paginator.js:437, view.js:220), so `element.shadowRoot` is null and no
   amount of walking reaches it from the host. Counting SVG rects is therefore
   not available to any driver — and the thing worth asserting was never the
   rect count anyway. So the mark is measured as pixels: screenshot the words,
   hand the PNG back to the browser to decode, and read the mean and the
   darkest pixel out of a canvas. */
const swatch = async (rect, tag) => {
    if (!rect || rect.w < 4 || rect.h < 4) return null
    /* Intersected with the viewport rather than trusted: a paragraph that
       straddles two columns reports a box wider than the screen, and a clip
       that leaves the image is a crash rather than a finding. */
    const vp = page.viewportSize()
    const x0 = Math.max(0, Math.min(rect.x, vp.width - 4))
    const y0 = Math.max(0, Math.min(rect.y, vp.height - 4))
    const clip = {
        x: x0, y: y0,
        width: Math.max(4, Math.min(rect.w, vp.width - x0)),
        height: Math.max(4, Math.min(rect.h, vp.height - y0, 60)),
    }
    const shot = await page.screenshot({ clip })
    /* MARKS_DUMP=<dir> writes each swatch out as a PNG, so the numbers below
       can be checked against the actual pixels rather than argued about. */
    if (process.env.MARKS_DUMP && tag)
        await writeFile(`${process.env.MARKS_DUMP}/swatch-${tag}.png`, shot)
    const b64 = shot.toString('base64')
    return page.evaluate(async (d) => {
        const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + d)).blob())
        const cv = document.createElement('canvas')
        cv.width = img.width; cv.height = img.height
        const cx = cv.getContext('2d')
        cx.drawImage(img, 0, 0)
        const px = cx.getImageData(0, 0, cv.width, cv.height).data
        let r = 0, g = 0, b = 0, n = 0, minL = 999
        for (let i = 0; i < px.length; i += 4) {
            r += px[i]; g += px[i + 1]; b += px[i + 2]; n++
            const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
            if (l < minL) minL = l
        }
        return { mean: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], darkest: Math.round(minL), px: n }
    }, b64)
}

/* ── 1. the selection menu ── */
const selText = await select('mid')
const menuBox = async () => page.evaluate(() => {
    const m = document.querySelector('.selmenu')
    if (!m) return null
    const q = m.getBoundingClientRect()
    const st = document.querySelector('.reader-stage').getBoundingClientRect()
    const cs = getComputedStyle(m)
    return {
        menu: { x: +q.x.toFixed(1), r: +q.right.toFixed(1), t: +q.top.toFixed(1), b: +q.bottom.toFixed(1), w: +q.width.toFixed(1), h: +q.height.toFixed(1) },
        stage: { x: +st.x.toFixed(1), r: +st.right.toFixed(1), t: +st.top.toFixed(1), b: +st.bottom.toFixed(1) },
        vis: cs.visibility, bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopColor,
        shadow: cs.boxShadow, blur: cs.backdropFilter,
        chips: Array.from(m.querySelectorAll('.selmenu-tint')).map(c => { const b = c.getBoundingClientRect(); return { tint: c.dataset.tint, w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }),
        acts: Array.from(m.querySelectorAll('.selmenu-act')).map(c => { const b = c.getBoundingClientRect(); return { txt: (c.textContent || c.getAttribute('aria-label')).trim(), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }),
    }
})
out.measures.menuMid = await menuBox()
{
    const m = out.measures.menuMid
    if (!m) bad('selmenu', 'no menu appeared after a selection')
    else {
        if (m.vis !== 'visible') bad('selmenu', `still hidden after measurement (visibility ${m.vis})`)
        if (m.menu.x < m.stage.x - 0.5 || m.menu.r > m.stage.r + 0.5) bad('selmenu', `escapes the stage horizontally: ${m.menu.x}..${m.menu.r} in ${m.stage.x}..${m.stage.r}`)
        if (m.menu.t < m.stage.t - 0.5 || m.menu.b > m.stage.b + 0.5) bad('selmenu', `escapes the stage vertically: ${m.menu.t}..${m.menu.b} in ${m.stage.t}..${m.stage.b}`)
        if (m.shadow !== 'none') bad('guardrail', `selection menu has a shadow: ${m.shadow}`)
        if (m.blur && m.blur !== 'none') bad('guardrail', `selection menu has a backdrop-filter: ${m.blur}`)
        if (m.chips.length !== 5) bad('selmenu', `${m.chips.length} tint chips, expected 5`)
        for (const c of m.chips) if (c.w < 24 || c.h < 24) bad('selmenu', `tint chip ${c.tint} is ${c.w}x${c.h}, under the 24px floor`)
        for (const a of m.acts) if (a.h < 24) bad('selmenu', `action "${a.txt}" is ${a.w}x${a.h}, under the 24px floor`)
    }
}
await failing('.selmenu *', 'selection menu')
say(`selected ${selText ? selText.length : 0} chars; menu measured`)

/* ── 2. the flip: a selection at the top of the page must open BELOW it ── */
{
    await page.keyboard.press('Escape').catch(() => {})
    await select('top')
    const top = await menuBox()
    out.measures.menuTop = top
    if (top) {
        const above = top.menu.b <= top.stage.t + 4
        if (top.menu.t < top.stage.t - 0.5) bad('selmenu', `top-of-page selection put the menu off the stage top (${top.menu.t} < ${top.stage.t})`)
        out.measures.menuTop.flippedBelow = !above
    }
    await select('bottom')
    const bot = await menuBox()
    out.measures.menuBottom = bot
    if (bot && bot.menu.b > bot.stage.b + 0.5) bad('selmenu', `bottom-of-page selection put the menu off the stage bottom (${bot.menu.b} > ${bot.stage.b})`)
}

/* ── 3. applying a tint actually paints something ── */
/* Three swatches, not two. The obvious pair — before the chip click and after
   it — measures the wrong thing: the "before" still carries the browser's own
   selection highlight, so the delta comes out as a uniform +14 on all three
   channels when the selection clears, and a tint that painted nothing at all
   would pass. So the page is photographed CLEAN first, then re-selected,
   tinted, and photographed again. */
/* Not a tap: a tap in the reading area is also a page turn, and the first
   version of this driver dismissed its own selection straight onto the next
   page, then measured a patch of different words. Escape closes the menu
   (SelectionMenu.tsx:71) and clearing the frame's own selection removes the
   browser's blue wash, which is the part that would otherwise pollute the
   swatch. */
const dismiss = async () => {
    await page.keyboard.press('Escape')
    await frame()?.evaluate(() => document.getSelection().removeAllRanges()).catch(() => {})
    await page.waitForTimeout(380)
}
const mark1 = await select('mid')
const markRect = lastRect
if (!markRect) bad('highlight', 'could not locate the selected words on the host screen')
const startA = (await window0()).start
await dismiss()
const before = await swatch(markRect, 'a-clean')
if (before && before.darkest > 140)
    bad('highlight', `the measured patch holds no type (darkest ${before.darkest}) — the swatch is not on the words`)
const mark2 = await select('mid')
/* On the words, not merely near them. Comparing x was the earlier check and it
   passed while the two swatches sat on different sentences — the paginator had
   moved to another column and a paragraph there happened to start within two
   pixels of the first. The text is the only thing that settles it. */
if (mark1 && mark2 && mark1 !== mark2)
    bad('highlight', `the page moved between the two swatches: "${mark1.slice(0, 34)}" then "${mark2.slice(0, 34)}"`)
const startB = (await window0()).start
if (startA !== startB)
    bad('highlight', `dismissing a selection moved the page (column ${startA} -> ${startB})`)
out.measures.paint = { startA, startB, mark1, mark2 }
await page.locator('.selmenu-tint[data-tint="mustard"]').click({ timeout: 6000 }).catch(e => bad('highlight', 'tint chip click failed: ' + String(e).slice(0, 90)))
await page.waitForTimeout(700)
await dismiss()
/* Creating a mark must not move the reader. Measured here rather than assumed:
   the two swatches came back on different sentences while the column was
   identical both times it was read before the chip click, which puts the move
   inside the annotation itself. */
const startC = (await window0()).start
if (startC !== startB)
    bad('highlight', `creating a highlight moved the page (column ${startB} -> ${startC})`)
const after = await swatch(markRect, 'b-marked')
Object.assign(out.measures.paint, { rect: markRect, before, after, startC })
if (before && after) {
    const d = Math.abs(after.mean[0] - before.mean[0]) + Math.abs(after.mean[1] - before.mean[1]) + Math.abs(after.mean[2] - before.mean[2])
    out.measures.paint.delta = d
    if (d < 6) bad('highlight', `the words did not change colour after a mustard tint (mean ${before.mean} -> ${after.mean}, ${d}/765)`)
    /* Mustard is warm and it is a wash, so blue must fall further than red —
       a fill that moved the three channels together would be a grey. */
    const dr = after.mean[0] - before.mean[0], db = after.mean[2] - before.mean[2]
    out.measures.paint.channels = { dr, dg: after.mean[1] - before.mean[1], db }
    if (dr - db < 3) bad('highlight', `the mustard tint has no hue: red ${dr}, blue ${db} — that is a grey wash`)
    /* And the words must survive it. A fill that lifts the darkest pixel in
       the line is painting over the ink, which DESIGN.md forbids outright. */
    if (after.darkest > before.darkest + 26) bad('highlight', `the fill washed out the ink under it: darkest ${before.darkest} -> ${after.darkest}`)
}
say(`mustard highlight: clean ${before ? before.mean.join(',') : '-'} -> marked ${after ? after.mean.join(',') : '-'} (${out.measures.paint.delta ?? '-'}/765, channels ${JSON.stringify(out.measures.paint.channels ?? null)}), darkest ${before?.darkest} -> ${after?.darkest}`)

/* ── 4. clicking the mark reopens the menu on it, with Remove ── */
{
    /* The centre of the words themselves — computed from the selection, never
       from "the first svg on the page", which in an earlier run turned out to
       be the back button and walked the driver out of the reader. */
    const hit = markRect ? { x: Math.round(markRect.x + markRect.w / 2), y: Math.round(markRect.y + markRect.h / 2) } : null
    if (hit) {
        await page.mouse.click(hit.x, hit.y)
        await page.waitForTimeout(500)
        out.measures.markMenu = await page.evaluate(() => {
            const m = document.querySelector('.selmenu')
            if (!m) return null
            return {
                pressed: Array.from(m.querySelectorAll('.selmenu-tint')).filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.dataset.tint),
                acts: Array.from(m.querySelectorAll('.selmenu-act')).map(c => (c.textContent || c.getAttribute('aria-label')).trim()),
            }
        })
        const mm = out.measures.markMenu
        if (!mm) bad('highlight', 'clicking an existing highlight opened no menu')
        else {
            if (!mm.pressed.includes('mustard')) bad('highlight', `the reopened menu does not show mustard as the current tint (${JSON.stringify(mm.pressed)})`)
            if (!mm.acts.some(a => /Remove/i.test(a))) bad('highlight', `no Remove on an existing mark (${JSON.stringify(mm.acts)})`)
        }
    } else bad('highlight', 'could not find the painted words to click')
    /* A centre tap is how a reader dismisses a selection — and it is also how
       the chrome toggles, so this leaves the bars in an unknown state on
       purpose and everything after it goes through ensureChrome. */
    await dismiss()
}

/* ── 5. the bookmark tick ── */
await page.keyboard.press('Escape').catch(() => {})
/* A centre tap is how a reader dismisses a selection — and it is also how the
   chrome toggles, so this leaves the bars in an unknown state on purpose and
   everything after it goes through ensureChrome. */
await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } }).catch(() => {})
await page.waitForTimeout(400)
await page.keyboard.press('b')
await page.waitForTimeout(500)
out.measures.tick = await page.evaluate(() => {
    const t = document.querySelector('.reader-tick')
    if (!t) return null
    const q = t.getBoundingClientRect()
    const st = document.querySelector('.reader-stage').getBoundingClientRect()
    const cs = getComputedStyle(t)
    return { w: +q.width.toFixed(1), h: +q.height.toFixed(1), fromTop: +(q.top - st.top).toFixed(1), fromTrail: +(st.right - q.right).toFixed(1), bg: cs.backgroundColor, accent: getComputedStyle(document.querySelector('.reader')).getPropertyValue('--accent').trim() }
})
if (!out.measures.tick) bad('bookmark', 'pressing b drew no tick')
else {
    const t = out.measures.tick
    if (t.fromTop > 1) bad('bookmark', `tick sits ${t.fromTop}px below the page top`)
    if (t.h < 12) bad('bookmark', `tick is only ${t.h}px tall`)
}
await page.keyboard.press('b')
await page.waitForTimeout(500)
out.measures.tickCleared = await page.evaluate(() => !document.querySelector('.reader-tick'))
if (!out.measures.tickCleared) bad('bookmark', 'pressing b a second time did not remove the bookmark')
/* Put it back, so the marks list has one of each to show. */
await page.keyboard.press('b')
await page.waitForTimeout(400)
say('bookmark tick added, removed and re-added')

/* ── 6. the panel at 390 ── */
const panelShot = () => page.evaluate(() => {
    const p = document.querySelector('.reader-panel')
    if (!p) return null
    const q = p.getBoundingClientRect()
    const box = el => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), r: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }
    const find = p.querySelector('.panel-find')
    const field = p.querySelector('.panel-find-field')
    const rows = Array.from(p.querySelectorAll('.panel-row')).slice(0, 8).map(box)
    const itemRows = Array.from(p.querySelectorAll('.panel-item-row')).slice(0, 8).map(box)
    const tocRows = Array.from(p.querySelectorAll('.reader-toc-row')).slice(0, 8).map(box)
    const heads = Array.from(p.querySelectorAll('.panel-group-head')).slice(0, 4).map(box)
    return {
        panel: { ...box(p), t: +q.top.toFixed(1), b: +q.bottom.toFixed(1) },
        win: { w: innerWidth, h: innerHeight },
        find: find ? { ...box(find), lead: +(box(find).x - box(p).x).toFixed(1), trail: +(box(p).r - box(find).r).toFixed(1) } : null,
        fieldSize: field ? parseFloat(getComputedStyle(field).fontSize) : null,
        rows, itemRows, tocRows, heads,
        bodyScrolls: (() => { const b = p.querySelector('.panel-body'); return b ? { clientH: b.clientHeight, scrollH: b.scrollHeight, overflow: getComputedStyle(b).overflowY } : null })(),
        tabs: Array.from(p.querySelectorAll('.panel-tab,.panel-kind')).map(t => { const b = t.getBoundingClientRect(); return { txt: t.textContent.trim().slice(0, 18), w: +b.width.toFixed(1), h: +b.height.toFixed(1), sel: t.getAttribute('aria-selected') } }),
        counts: { marks: p.querySelectorAll('.panel-item').length, empty: !!p.querySelector('.panel-empty') },
        shadow: getComputedStyle(p).boxShadow,
    }
})

await openPanel()
out.measures.panel390 = await panelShot()
{
    const p = out.measures.panel390
    if (!p) bad('panel', 'the panel did not open')
    else {
        if (Math.abs(p.panel.w - p.win.w) > 1) bad('panel', `at 390 the panel is ${p.panel.w} wide, not the full ${p.win.w}`)
        if (p.shadow !== 'none') bad('guardrail', `the panel has a shadow: ${p.shadow}`)
        if (p.fieldSize !== null && p.fieldSize < 16) bad('panel', `find field is ${p.fieldSize}px — iOS Safari zooms the page below 16px`)
        if (p.find && Math.abs(p.find.lead - p.find.trail) > 1) bad('panel', `find field is off-centre: ${p.find.lead}px leading vs ${p.find.trail}px trailing`)
        /* `.panel-row` deliberately gives up its trailing padding to the
           `.panel-more` beside it, so the box whose edges must match is the
           `.panel-item-row` that holds both. */
        for (const r of p.itemRows) {
            const lead = +(r.x - p.panel.x).toFixed(1)
            const trail = +(p.panel.r - r.r).toFixed(1)
            if (Math.abs(lead - trail) > 1.5) bad('panel', `row block edges asymmetric: ${lead} leading vs ${trail} trailing`)
        }
        if (p.bodyScrolls && p.bodyScrolls.overflow === 'visible') bad('panel', 'the panel body is not the scroller')
    }
}
const smallPanel = await smallTargets('.reader-panel')
if (smallPanel?.length) bad('panel', 'targets under 24px — ' + smallPanel.map(t => `${t.cls} "${t.txt}" ${t.w}x${t.h}`).join(' | '))
await failing('.reader-panel *', 'panel (contents)')

/* Marks tab: the list of what was just made. */
await page.locator('.panel-tab', { hasText: /Marks/i }).click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(400)
out.measures.panelMarks = await panelShot()
if (out.measures.panelMarks && out.measures.panelMarks.counts.marks === 0)
    bad('marks', 'the marks tab is empty after a highlight and a bookmark were made')
await failing('.reader-panel *', 'panel (marks)')

/* The long-press actions, opened by the explicit control rather than the press. */
await page.locator('.panel-more').first().click({ timeout: 6000 }).catch(() => bad('marks', 'no .panel-more control on a mark row'))
await page.waitForTimeout(350)
out.measures.markActs = await page.evaluate(() => {
    const acts = Array.from(document.querySelectorAll('.panel-acts .panel-act'))
    const open = document.querySelector('.panel-item[data-open]')
    return { open: !!open, acts: acts.map(a => { const b = a.getBoundingClientRect(); return { txt: a.textContent.trim().slice(0, 16), w: +b.width.toFixed(1), h: +b.height.toFixed(1) } }) }
})
if (!out.measures.markActs.open) bad('marks', 'the actions row did not open')
for (const a of out.measures.markActs.acts) if (a.h < 24) bad('marks', `action "${a.txt}" is ${a.w}x${a.h}`)

/* ── 7. search ── */
await page.locator('.panel-find-field').fill('the', { timeout: 6000 }).catch(e => bad('search', 'could not type in the find field: ' + String(e).slice(0, 90)))
/* Enter, not just typing: Panel.tsx runs the walk on submit, so a driver that
   only types measures an idle panel and calls it a broken search. */
await page.locator('.panel-find-field').press('Enter').catch(() => {})
await page.waitForTimeout(3500)
out.measures.search = await page.evaluate(() => {
    const p = document.querySelector('.reader-panel')
    const count = p?.querySelector('.panel-count')?.textContent?.trim() ?? null
    const hits = p?.querySelectorAll('.panel-hit').length ?? 0
    const rows = p?.querySelectorAll('.panel-excerpt--find').length ?? 0
    const out0 = p?.querySelector('.panel-out')
    return {
        count, hits, rows,
        wiktionary: out0 ? out0.getAttribute('href') : null,
        /* The cap and its disclosure. A list that quietly stops at 300 while
           the head says 7857 is the failure being tested for. */
        nodes: p?.querySelector('.panel-body')?.querySelectorAll('*').length ?? 0,
        tail: p?.querySelector('.panel-tail-note')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        more: p?.querySelector('.panel-tail .panel-export')?.textContent?.trim() ?? null,
    }
})
if (out.measures.search.rows === 0) bad('search', 'searching "the" produced no results')
if (out.measures.search.hits === 0) bad('search', 'no result marked its own hit')
{
    const s0 = out.measures.search
    const total = Number((s0.count || '').replace(/[^0-9]/g, '')) || 0
    if (s0.rows > 300) bad('search', `${s0.rows} rows rendered — the 300 cap is not holding`)
    if (total > s0.rows) {
        if (!s0.tail) bad('search', `${s0.rows} of ${total} rendered with nothing on screen saying so`)
        else {
            const nums = (s0.tail.match(/[\d,]+/g) || []).map(n => Number(n.replace(/,/g, '')))
            if (!nums.includes(s0.rows) || !nums.includes(total))
                bad('search', `the tail says "${s0.tail}" but ${s0.rows} of ${total} are showing`)
        }
        if (!s0.more) bad('search', 'a capped list with no way to see the rest')
    }
}
await failing('.reader-panel *', 'panel (search)')
say(`search returned ${out.measures.search.rows} rows of ${out.measures.search.count}, `
    + `${out.measures.search.nodes} nodes, tail "${out.measures.search.tail}"`)

/* Show more: the next batch has to actually arrive, and the note has to move
   with it. */
if (out.measures.search.more) {
    await page.locator('.panel-tail .panel-export').click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(500)
    out.measures.searchMore = await page.evaluate(() => {
        const p = document.querySelector('.reader-panel')
        return {
            rows: p?.querySelectorAll('.panel-excerpt--find').length ?? 0,
            tail: p?.querySelector('.panel-tail-note')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
        }
    })
    if (out.measures.searchMore.rows <= out.measures.search.rows)
        bad('search', `"Show more" left the list at ${out.measures.searchMore.rows} rows`)
    else say(`show more grew the list ${out.measures.search.rows} -> ${out.measures.searchMore.rows}`)
}

/* ── 8. the panel and the marks list at 1280 ── */
await page.setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(900)
out.measures.panel1280 = await panelShot()
{
    const p = out.measures.panel1280
    if (!p) bad('panel', 'the panel vanished at 1280')
    else {
        if (p.panel.w > 480) bad('panel', `at 1280 the panel is ${p.panel.w} wide — it should be a column, not the screen`)
        if (p.find && Math.abs(p.find.lead - p.find.trail) > 1) bad('panel', `at 1280 the find field is off-centre: ${p.find.lead} vs ${p.find.trail}`)
        for (const r of p.itemRows) {
            const lead = +(r.x - p.panel.x).toFixed(1)
            const trail = +(p.panel.r - r.r).toFixed(1)
            if (Math.abs(lead - trail) > 1.5) bad('panel', `at 1280 row block edges asymmetric: ${lead} vs ${trail}`)
        }
    }
}
await failing('.reader-panel *', 'panel at 1280')

/* ── 9. export ── */
await page.locator('.panel-find-clear').click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(400)
await page.locator('.panel-tab', { hasText: /Marks/i }).click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(300)
await page.locator('.panel-export').click({ timeout: 6000 }).catch(() => bad('export', 'no export control at the foot of the marks list'))
await page.waitForTimeout(500)
out.measures.export = await page.evaluate(() => {
    const s = document.querySelector('.sheet.export')
    if (!s) return null
    const q = s.getBoundingClientRect()
    const fmts = Array.from(s.querySelectorAll('.export-format')).map(f => { const b = f.getBoundingClientRect(); return { txt: f.textContent.trim().slice(0, 40), w: +b.width.toFixed(1), h: +b.height.toFixed(1), checked: f.getAttribute('aria-checked') } })
    const said = s.querySelector('.export-said')
    return {
        box: { x: +q.x.toFixed(1), r: +q.right.toFixed(1), w: +q.width.toFixed(1) },
        win: innerWidth,
        fmts,
        live: said ? { role: said.getAttribute('aria-live'), minH: getComputedStyle(said).minHeight } : null,
        shadow: getComputedStyle(s).boxShadow,
    }
})
{
    const e = out.measures.export
    if (!e) bad('export', 'the export sheet did not open')
    else {
        if (e.fmts.length !== 4) bad('export', `${e.fmts.length} formats, expected 4`)
        if (!e.fmts.some(f => /PDF/.test(f.txt))) bad('export', 'no PDF row in the format list')
        if (!e.fmts.some(f => f.checked === 'true')) bad('export', 'no format is selected by default')
        for (const f of e.fmts) if (f.h < 44) bad('export', `format "${f.txt}" is only ${f.h}px tall`)
        if (e.shadow !== 'none') bad('guardrail', `export sheet has a shadow: ${e.shadow}`)
        const lead = +(e.box.x).toFixed(1), trail = +(e.win - e.box.r).toFixed(1)
        if (Math.abs(lead - trail) > 1) bad('export', `sheet off-centre: ${lead} vs ${trail}`)
    }
}
await failing('.sheet.export *', 'export sheet')

/* PDF is the one format that is bytes rather than text, so Copy has to go and
   Download has to take its place — measured, not assumed. */
await page.locator('.export-format', { hasText: /PDF/ }).click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(250)
out.measures.exportPdf = await page.evaluate(() => {
    const s = document.querySelector('.sheet.export')
    if (!s) return null
    const acts = Array.from(s.querySelectorAll('.export-acts button')).map(b => ({
        cls: b.className, txt: b.textContent.trim(),
        w: +b.getBoundingClientRect().width.toFixed(1),
        disabled: b.disabled,
    }))
    return { acts, said: s.querySelector('.export-said')?.textContent.trim() ?? null }
})
{
    const e = out.measures.exportPdf
    if (!e) bad('export', 'the sheet vanished when PDF was chosen')
    else {
        if (e.acts.some(a => /Copy/.test(a.txt))) bad('export', 'Copy is still offered for a PDF, which is not text')
        const dl = e.acts.find(a => /Download/.test(a.txt))
        if (!dl) bad('export', 'no Download button for the PDF')
        else if (!/export-do/.test(dl.cls)) bad('export', `Download is not the primary for a PDF: ${dl.cls}`)
        if (e.acts.some(a => a.disabled)) bad('export', 'a disabled button is offered instead of being omitted')
    }
}
await page.locator('.export-shut').click({ timeout: 4000 }).catch(() => {})
await page.waitForTimeout(300)

/* ── 10. the note editor ── */
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(700)
await page.locator('.panel-tab, .panel-kind').first().click({ timeout: 4000 }).catch(() => {})
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await select('mid')
await page.locator('.selmenu-act', { hasText: /^Note$/ }).click({ timeout: 6000 }).catch(() => bad('note', 'no Note action on a fresh selection'))
await page.waitForTimeout(700)
out.measures.note = await page.evaluate(() => {
    const n = document.querySelector('.note')
    if (!n) return null
    const q = n.getBoundingClientRect()
    const st = document.querySelector('.reader-stage').getBoundingClientRect()
    const f = n.querySelector('.note-field')
    const cs = f ? getComputedStyle(f) : null
    return {
        box: { x: +q.x.toFixed(1), r: +q.right.toFixed(1), t: +q.top.toFixed(1), b: +q.bottom.toFixed(1) },
        stage: { x: +st.x.toFixed(1), r: +st.right.toFixed(1), t: +st.top.toFixed(1), b: +st.bottom.toFixed(1) },
        win: { w: innerWidth, h: innerHeight },
        field: cs ? { family: cs.fontFamily, size: parseFloat(cs.fontSize), h: +f.getBoundingClientRect().height.toFixed(1) } : null,
        acts: Array.from(n.querySelectorAll('button')).map(b => { const r = b.getBoundingClientRect(); return { txt: (b.textContent || b.getAttribute('aria-label')).trim().slice(0, 18), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }),
        shadow: getComputedStyle(n).boxShadow,
    }
})
{
    const n = out.measures.note
    if (!n) bad('note', 'the note editor did not open')
    else {
        if (n.box.t < 0 || n.box.b > n.win.h + 0.5) bad('note', `the note escapes the window vertically: ${n.box.t}..${n.box.b} in 0..${n.win.h}`)
        if (n.field && n.field.size < 16) bad('note', `note field is ${n.field.size}px — iOS zooms below 16`)
        if (n.field && !/Kalam/i.test(n.field.family)) bad('note', `note field is not the hand: ${n.field.family}`)
        if (n.shadow !== 'none') bad('guardrail', `the note editor has a shadow: ${n.shadow}`)
        for (const a of n.acts) if (a.h < 24) bad('note', `action "${a.txt}" is ${a.w}x${a.h}`)
    }
}
await failing('.note *', 'note editor')
if (out.measures.note) {
    await page.locator('.note-field').fill('a measured note', { timeout: 6000 }).catch(() => bad('note', 'could not type in the note field'))
    await page.waitForTimeout(700)
    await page.locator('.note-done').click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(600)
    await openPanel(/Marks/i)
    out.measures.notePersisted = await page.evaluate(() => {
        const n = Array.from(document.querySelectorAll('.panel-note')).map(x => x.textContent.trim())
        return { notes: n, family: document.querySelector('.panel-note') ? getComputedStyle(document.querySelector('.panel-note')).fontFamily : null }
    })
    if (!out.measures.notePersisted.notes.some(t => /a measured note/.test(t)))
        bad('note', `the note did not appear in the marks list (${JSON.stringify(out.measures.notePersisted.notes)})`)
}

/* The last two sections drive the reader's own root, so before they run the
   driver checks it is still mounted. A route change or an unmounted tree used
   to surface three sections later as a null dereference inside a canvas
   measurement, which says nothing about what actually went wrong. */
out.measures.stillReading = await page.evaluate(() => ({
    path: location.pathname + location.hash,
    reader: !!document.querySelector('.reader'),
    stage: !!document.querySelector('.reader-stage'),
    view: !!document.querySelector('foliate-view'),
    body: document.body.firstElementChild ? document.body.firstElementChild.className : null,
    roots: Array.from(document.querySelectorAll('#root > *')).map(e => e.className || e.tagName),
}))
if (!out.measures.stillReading.reader)
    bad('route', `the reader is no longer mounted before the stock sweep: ${JSON.stringify(out.measures.stillReading)}`)

/* ── 11. the panel's tab/kind selected pair, on every stock ──────────────
   The inverted-ink state is the same idiom on eight different grounds, and
   only one of them is the default. */
const STOCKS = ['press', 'day', 'butter', 'tea', 'coal', 'dusk', 'pitch']
out.measures.stocks = {}
for (const stock of out.measures.stillReading.reader ? STOCKS : []) {
    await page.evaluate(s => {
        document.querySelector('.reader')?.setAttribute('data-stock', s)
    }, stock)
    await page.waitForTimeout(220)
    const p = await pairs('.panel-tab, .panel-kind, .panel-excerpt, .panel-note, .panel-count, .panel-export')
    const worst = p.slice().sort((a, b) => a.cr - b.cr)[0] ?? null
    out.measures.stocks[stock] = { pairs: p.length, worst }
    const f = p.filter(x => !x.pass)
    if (f.length) bad('contrast', `panel on ${stock}: ` + f.map(x => `${x.cr}:1 needs ${x.need} (${x.size}px "${x.txt}") ${x.fg} on ${x.bg}`).join(' | '))
}
say(`panel contrast measured on ${STOCKS.length} stocks`)

/* ── 12. the lift token resolves on every stock, and stays warm ── */
out.measures.lift = !out.measures.stillReading.reader ? null : await page.evaluate(stocks => {
    const el = document.querySelector('.reader')
    const orig = el.getAttribute('data-stock')
    const probe = document.createElement('div')
    el.appendChild(probe)
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    const cx = cv.getContext('2d')
    const px = (color) => {
        cx.clearRect(0, 0, 1, 1)
        cx.fillStyle = color
        cx.fillRect(0, 0, 1, 1)
        const d = cx.getImageData(0, 0, 1, 1).data
        return [d[0], d[1], d[2]]
    }
    const res = {}
    for (const s of stocks) {
        el.setAttribute('data-stock', s)
        /* color-mix() resolves to oklab() in getComputedStyle, which cannot be
           compared channel-for-channel against an rgb() page. Painting each
           one into a canvas is what turns both into the sRGB the reader
           actually sees. */
        probe.style.background = 'var(--lift)'
        const lift = px(getComputedStyle(probe).backgroundColor)
        probe.style.background = 'var(--stock-bg)'
        const bg = px(getComputedStyle(probe).backgroundColor)
        probe.style.background = 'var(--lift-hi)'
        const hi = px(getComputedStyle(probe).backgroundColor)
        res[s] = { lift, bg, hi }
    }
    probe.remove()
    el.setAttribute('data-stock', orig)
    return res
}, STOCKS)
for (const [s, v] of Object.entries(out.measures.lift ?? {})) {
    const [lr, lg, lb] = v.lift, [br, bg2, bb] = v.bg
    const d = Math.abs(lr - br) + Math.abs(lg - bg2) + Math.abs(lb - bb)
    if (d < 4) bad('lift', `--lift is within ${d}/765 of the page on ${s} — nothing would read as lifted`)
    if (d > 90) bad('lift', `--lift is ${d}/765 from the page on ${s} — that is a card, not a lift`)
    /* Warm means red is not below blue. A cool lift on a warm page is exactly
       the failure the derivation exists to prevent, so it is asserted rather
       than trusted.

       Dusk is the one exception, by the owner's instruction — it is deliberately
       the blue stock. Skipping the check there would leave it unguarded, so it
       gets the stricter form instead: the lift may not be MORE blue-shifted than
       the page it sits on. A derivation that drifts off its own page's hue is
       still a bug, on a blue page as much as on a warm one. */
    if (s === 'dusk') {
        if ((lb - lr) > (bb - br) + 2)
            bad('lift', `--lift is bluer than the dusk page itself: lift +${lb - lr} vs page +${bb - br}`)
    } else if (lb > lr + 1) {
        bad('lift', `--lift is blue-shifted on ${s}: rgb(${v.lift.join(',')})`)
    }
    const dh = Math.abs(v.hi[0] - br) + Math.abs(v.hi[1] - bg2) + Math.abs(v.hi[2] - bb)
    if (dh <= d) bad('lift', `--lift-hi is no further from the page than --lift on ${s} (${dh} vs ${d}) — focus would not read`)
}

if (errors.length) bad('console', errors.slice(0, 6).join(' | '))
await browser.close()
console.log(JSON.stringify(out, null, 2))
console.log(`\n=== FINDINGS: ${out.findings.length} ===`)
for (const f of out.findings) console.log(`  [${f.what}] ${f.detail}`)
