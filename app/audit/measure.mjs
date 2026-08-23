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
   still leaves a большой share of its container's content width unused. A
   single-line block that is short is just a short sentence. A wrapped block
   that stops well short of the edge is a cap fighting its container, which is
   the bug. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
/* Under a fifth of the box left empty is measure discipline; over a third is
   the bug the owner is pointing at. */
const SLACK = Number(process.env.SLACK || 0.28)
const findings = []
const rows = []

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

  const SEL = 'p, dd, li, .ui-p, .lede, blockquote, figcaption'
  for (const el of document.querySelectorAll(SEL)) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis') continue
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
    const unused = 1 - l.widest / hostBox.w
    if (unused <= slack) continue
    out.push({
      sel: el.tagName.toLowerCase() + (el.className?.toString?.() ? '.' + el.className.toString().trim().split(/\\s+/).join('.') : ''),
      lines: l.count,
      widest: +l.widest.toFixed(1),
      host: hostBox.tag + (hostBox.cls ? '.' + hostBox.cls.trim().split(/\\s+/).join('.') : ''),
      hostW: +hostBox.w.toFixed(1),
      unusedPct: Math.round(unused * 100),
      cap: cs.maxWidth,
      text: txt.slice(0, 70),
    })
  }
  return out
})(${SLACK})`

const ROUTES = ['/', '/library', '/open', '/stats', '/collections', '/settings']

const browser = await chromium.launch()
for (const [w, h, name] of [[390, 844, 'phone'], [1280, 900, 'desktop'], [1024, 1366, 'ipad']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2600)                             // splash + seed
    for (const route of ROUTES) {
        await page.goto(BASE + route, { waitUntil: 'networkidle' })
        await page.waitForTimeout(700)
        const seen = await page.evaluate(PROBE)
        for (const s of seen) {
            rows.push({ view: name, route, ...s })
            findings.push(`${name} ${route}  ${s.sel} wraps to ${s.lines} lines but its widest is ${s.widest}px in a ${s.hostW}px ${s.host} — ${s.unusedPct}% of the box unused (max-width: ${s.cap}) — "${s.text}"`)
        }
    }
    await ctx.close()
}
await browser.close()

console.log(JSON.stringify({ slack: SLACK, rows }, null, 2))
console.log(`\n=== FINDINGS: ${findings.length}`)
for (const f of findings) console.log('  · ' + f)
