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
let centred = 0, layout = 0

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

const ROUTES = ['/', '/library', '/open', '/stats', '/collections', '/settings', '/privacy', '/terms']

const browser = await chromium.launch()
for (const [w, h, name] of [[390, 844, 'phone'], [1280, 900, 'desktop'], [1024, 1366, 'ipad']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await ctx.newPage()
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2600)                             // splash + seed
    for (const route of ROUTES) {
        await page.goto(BASE + route, { waitUntil: 'networkidle' })
        await page.waitForTimeout(700)
        const { out: seen, skipped } = await page.evaluate(PROBE)
        centred += skipped.centred
        layout += skipped.layout
        for (const s of seen) {
            rows.push({ view: name, route, ...s })
            findings.push(`${name} ${route}  ${s.sel} wraps to ${s.lines} lines but its widest is ${s.widest}px in a ${s.hostW}px ${s.host} (own box ${s.ownW}px) — ${s.unusedPct}% of the box unused (max-width: ${s.cap}) — "${s.text}"`)
        }
    }
    await ctx.close()
}
await browser.close()

console.log(JSON.stringify({ slack: SLACK, rows }, null, 2))
console.log(`\nexempt: ${centred} centred (slack sits evenly on both sides), ${layout} uncapped and filling ≥90% of their own box (the element is narrow, not the text)`)
console.log(`\n=== FINDINGS: ${findings.length}`)
for (const f of findings) console.log('  · ' + f)

server?.kill()
/* Non-zero so this can gate a release rather than merely narrate one. */
process.exit(findings.length ? 1 : 0)
