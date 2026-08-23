/* ── audit/install.mjs ────────────────────────────────────────────────────
   The install ask on Home, in every branch it has.

   Home shows one strip that asks the reader to put the app on their home
   screen, and the whole point of it is that it never appears where the ask is
   not actionable. So the driver's job is mostly to prove the negatives: no
   strip before a prompt exists, none once the app is standalone, none after a
   dismissal, and no Install button on iOS where there is nothing to click.

   Two things about how it is driven, both of them forced:

   - **Chromium never fires `beforeinstallprompt` headlessly.** There is no
     flag for it and no way to earn it; the engagement heuristics do not run.
     So the canPrompt branch is exercised with a synthetic event carrying the
     three things pwa.ts actually consumes — preventDefault, prompt() and
     userChoice — and the count of prompt() calls is read back off the page.
     That is a real exercise of our code and a fake of Chrome's, and it is
     labelled as such rather than reported as a full-stack pass.

   - **The strip's geometry is measured off the padding box, not the border
     box.** The dismiss is absolutely positioned, so its offsets are relative
     to the padding box, and comparing them to `getBoundingClientRect()`
     reports the 1px border as a 1px misalignment. That false finding is why
     the border width is subtracted here explicitly.

   Likewise the copy-clearance check measures the text's own client rects
   through a Range rather than `.instl-txt`'s box: the box carries
   padding-inline-end to hold the words off the dismiss, so its right edge is
   deliberately NOT where the words stop. Measuring the box reported 15px of
   overlap where there are 67px of clearance. */

import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:4173'
const OUT = process.env.FL_SHOTS || '/tmp/fl'
mkdirSync(OUT, { recursive: true })
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const findings = []
const fail = (m) => { findings.push(m); console.log('  FAIL ' + m) }
const ok = (m) => console.log('  ok   ' + m)

const browser = await chromium.launch()

async function open(o = {}) {
  const ctx = await browser.newContext(o)
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 8000 })
  return { ctx, page }
}

/* Chromium never fires beforeinstallprompt headlessly (SPEC § 15), so the
   canPrompt branch is exercised with a synthetic event carrying the same
   shape pwa.ts consumes: preventDefault, prompt(), userChoice. */
const SYNTH = `(() => {
  const e = new Event('beforeinstallprompt')
  window.__promptCalls = 0
  e.prompt = () => { window.__promptCalls++; return Promise.resolve() }
  e.userChoice = Promise.resolve({ outcome: 'accepted' })
  window.dispatchEvent(e)
})()`

const rect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2) }
}, sel)

// ── 1. iOS manual branch ───────────────────────────────────────────────────
console.log('\n[1] iOS manualOnly branch, 390x844')
{
  const { ctx, page } = await open({ userAgent: IOS_UA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
  const n = await page.locator('.instl').count()
  n === 1 ? ok('strip present') : fail(`strip count ${n} on iOS`)
  const lbl = await page.locator('.instl .ui-lbl').textContent()
  lbl === 'Add to home screen' ? ok(`label "${lbl}"`) : fail(`iOS label is "${lbl}"`)
  const body = await page.locator('.instl .ui-p').textContent()
  body.includes('Tap Share, then Add to Home Screen') ? ok('body names the iOS route verbatim') : fail(`iOS body: ${body}`)
  const btn = await page.locator('.instl .btn--sm').count()
  btn === 0 ? ok('no Install button (nothing to click on iOS)') : fail('iOS branch offers a button')
  const x = await page.locator('.instl-x').count()
  x === 1 ? ok('dismiss present') : fail('no dismiss')
  await page.screenshot({ path: `${OUT}/instl-ios-390.png` })
  await ctx.close()
}

// ── 2. canPrompt, coarse pointer (Android phone) ───────────────────────────
console.log('\n[2] canPrompt + coarse pointer, 390x844')
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
  const before = await page.locator('.instl').count()
  before === 0 ? ok('nothing shown before a prompt is held') : fail('strip shown with no prompt and no iOS')
  await page.evaluate(SYNTH)
  await page.waitForSelector('.instl', { timeout: 3000 })
  const lbl = await page.locator('.instl .ui-lbl').textContent()
  lbl === 'Add to home screen' ? ok(`label "${lbl}"`) : fail(`coarse label is "${lbl}"`)
  const body = await page.locator('.instl .ui-p').textContent()
  body.includes('home screen') ? ok('body is the home-screen line') : fail(`coarse body: ${body}`)
  body.toLowerCase().includes('offline') ? fail('body leads on offline') : ok('body does not mention offline')
  const btn = await page.locator('.instl .btn--sm').count()
  btn === 1 ? ok('Install button offered') : fail('no Install button on canPrompt')
  await page.screenshot({ path: `${OUT}/instl-android-390.png` })
  await ctx.close()
}

// ── 3. canPrompt, fine pointer (desktop) ───────────────────────────────────
console.log('\n[3] canPrompt + fine pointer, 1280x900')
{
  const { ctx, page } = await open({ viewport: { width: 1280, height: 900 } })
  await page.evaluate(SYNTH)
  await page.waitForSelector('.instl', { timeout: 3000 })
  const lbl = await page.locator('.instl .ui-lbl').textContent()
  lbl === 'Open books here' ? ok(`label "${lbl}"`) : fail(`fine label is "${lbl}"`)
  const body = await page.locator('.instl .ui-p').textContent()
  body.includes('home screen') ? fail('desktop copy says "home screen"') : ok('desktop copy avoids "home screen"')
  body.includes('book files open straight into the reader') ? ok('desktop copy leads on file handling') : fail(`desktop body: ${body}`)
  await page.screenshot({ path: `${OUT}/instl-desktop-1280.png` })
  await ctx.close()
}

// ── 4. prompt() actually called, and the strip retires on accept ───────────
console.log('\n[4] Install click → prompt() called → strip gone')
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await page.evaluate(SYNTH)
  await page.waitForSelector('.instl .btn--sm')
  await page.locator('.instl .btn--sm').click()
  await page.waitForFunction(() => !document.querySelector('.instl'), null, { timeout: 3000 }).catch(() => {})
  const calls = await page.evaluate(() => window.__promptCalls)
  calls === 1 ? ok('prompt() called exactly once') : fail(`prompt() called ${calls} times`)
  const n = await page.locator('.instl').count()
  n === 0 ? ok('strip retired after accept') : fail('strip still standing after accept')
  const key = await page.evaluate(() => localStorage.getItem('flyleaf.home.install'))
  key === 'off' ? ok('accept remembered as off') : fail(`localStorage is ${key}`)
  await ctx.close()
}

// ── 5. dismissal round-trip ────────────────────────────────────────────────
console.log('\n[5] dismiss → remembered across a reload')
{
  const { ctx, page } = await open({ userAgent: IOS_UA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await page.locator('.instl-x').click()
  const n = await page.locator('.instl').count()
  n === 0 ? ok('gone on click') : fail('still present after dismiss')
  const key = await page.evaluate(() => localStorage.getItem('flyleaf.home.install'))
  key === 'off' ? ok('dismissal written') : fail(`localStorage is ${key}`)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 8000 })
  const n2 = await page.locator('.instl').count()
  n2 === 0 ? ok('still gone after reload') : fail('strip came back on reload')
  await ctx.close()
}

// ── 6. installed / standalone branch renders nothing ───────────────────────
console.log('\n[6] standalone (already installed) → nothing')
{
  const ctx = await browser.newContext({ userAgent: IOS_UA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window)
    window.matchMedia = (q) => (q === '(display-mode: standalone)'
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
      : mm(q))
  })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 8000 })
  const n = await page.locator('.instl').count()
  n === 0 ? ok('nothing rendered when standalone') : fail('strip shown to an installed reader')
  await ctx.close()
}

// ── 7. geometry, both edges, narrowest and widest ──────────────────────────
console.log('\n[7] geometry: both edges at 320 and 1280')
for (const [w, h] of [[320, 720], [1280, 900]]) {
  const { ctx, page } = await open({ viewport: { width: w, height: h }, hasTouch: w < 700, isMobile: w < 700 })
  await page.evaluate(SYNTH)
  await page.waitForSelector('.instl')
  const strip = await rect(page, '.instl')
  const head = await rect(page, '.app-head')
  const txt = await rect(page, '.instl-txt')
  const btn = await rect(page, '.instl .btn--sm')
  const xb = await rect(page, '.instl-x')
  const glyph = await rect(page, '.instl-x svg')
  const first = await rect(page, '.instl + *')

  // leading + trailing edge against the column
  const dl = +(strip.x - head.x).toFixed(2)
  const dr = +(head.right - strip.right).toFixed(2)
  Math.abs(dl) < 0.6 && Math.abs(dr) < 0.6
    ? ok(`${w}: flush with the column (lead ${dl}, trail ${dr})`)
    : fail(`${w}: strip edges off the column — lead ${dl}, trail ${dr}`)

  // glyph lands on the strip's own padding box: 18px in, 16px down.
  // An absolutely positioned child is offset from the PADDING box, so the 1px
  // border has to come off the border-box rect before comparing.
  const bw = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.instl')).borderTopWidth))
  const gr = +(strip.right - bw - glyph.right).toFixed(2)
  const gt = +(glyph.y - (strip.y + bw)).toFixed(2)
  Math.abs(gr - 18) <= 0.6 && Math.abs(gt - 16) <= 0.6
    ? ok(`${w}: dismiss glyph on the padding box (${gr} in, ${gt} down)`)
    : fail(`${w}: dismiss glyph off-grid — ${gr} in, ${gt} down`)

  // 44px target
  xb.w >= 44 && xb.h >= 44 ? ok(`${w}: dismiss target ${xb.w}x${xb.h}`) : fail(`${w}: dismiss target only ${xb.w}x${xb.h}`)

  // copy never runs under the glyph. .instl-txt carries padding-inline-end, so
  // its box right is NOT where the words stop — measure the glyphs themselves,
  // over every line that shares a horizontal band with the dismiss.
  const inkRight = await page.evaluate(({ top, bottom }) => {
    let max = -Infinity
    for (const el of document.querySelectorAll('.instl-txt p')) {
      for (const node of el.childNodes) {
        if (node.nodeType !== 3) continue
        const r = document.createRange()
        r.selectNodeContents(node)
        for (const box of r.getClientRects()) {
          if (box.bottom > top && box.top < bottom) max = Math.max(max, box.right)
        }
      }
    }
    return max === -Infinity ? null : +max.toFixed(2)
  }, { top: glyph.y, bottom: glyph.bottom })
  if (inkRight === null) {
    ok(`${w}: no copy line shares a band with the dismiss`)
  } else {
    const clear = +(glyph.x - inkRight).toFixed(2)
    clear >= 4 ? ok(`${w}: copy clears the glyph by ${clear}px`) : fail(`${w}: copy runs to within ${clear}px of the glyph`)
  }

  // wrap behaviour
  const wrapped = btn.y > txt.bottom - 1
  console.log(`       ${w}: button ${wrapped ? 'wrapped below' : 'beside'} the copy — btn ${btn.w}x${btn.h} at ${btn.x},${btn.y}; strip ${strip.w}x${strip.h}`)
  btn.right <= strip.right + 0.6 ? ok(`${w}: button inside the strip`) : fail(`${w}: button overflows the strip by ${(btn.right - strip.right).toFixed(2)}`)

  // gap to the next block
  const gap = +(first.y - strip.bottom).toFixed(2)
  gap >= 24 ? ok(`${w}: ${gap}px to the next section`) : fail(`${w}: only ${gap}px to the next section`)

  // no horizontal overflow on the page
  const of = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  of <= 0 ? ok(`${w}: no horizontal overflow`) : fail(`${w}: page scrolls horizontally by ${of}px`)

  await page.screenshot({ path: `${OUT}/instl-geom-${w}.png`, fullPage: false })
  await ctx.close()
}

// ── 8. contrast of the strip's own text, both schemes ──────────────────────
console.log('\n[8] contrast, light + dark')
const lum = (c) => {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)

for (const scheme of ['light', 'dark']) {
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: scheme })
  await page.evaluate(SYNTH)
  await page.waitForSelector('.instl')
  const cols = await page.evaluate(() => {
    const g = (s) => getComputedStyle(document.querySelector(s))
    return {
      bg: g('.instl').backgroundColor,
      lbl: g('.instl .ui-lbl').color,
      body: g('.instl .ui-p').color,
      x: g('.instl-x').color,
      btnBg: g('.instl .btn--sm').backgroundColor,
      btnFg: g('.instl .btn--sm').color,
    }
  })
  const bg = parse(cols.bg)
  for (const [name, col, floor] of [['label', cols.lbl, 4.5], ['body', cols.body, 4.5], ['dismiss glyph', cols.x, 3]]) {
    const r = +ratio(parse(col), bg).toFixed(2)
    r >= floor ? ok(`${scheme}: ${name} ${r}:1 (>= ${floor})`) : fail(`${scheme}: ${name} only ${r}:1, needs ${floor}`)
  }
  const rb = +ratio(parse(cols.btnFg), parse(cols.btnBg)).toFixed(2)
  rb >= 4.5 ? ok(`${scheme}: Install button ${rb}:1`) : fail(`${scheme}: Install button only ${rb}:1`)
  await page.screenshot({ path: `${OUT}/instl-${scheme}-390.png` })
  await ctx.close()
}

// ── 9. keyboard + a11y ─────────────────────────────────────────────────────
console.log('\n[9] keyboard reachability and labels')
{
  const { ctx, page } = await open({ viewport: { width: 1280, height: 900 } })
  await page.evaluate(SYNTH)
  await page.waitForSelector('.instl')
  const a = await page.evaluate(() => {
    const x = document.querySelector('.instl-x')
    return { tag: x.tagName, label: x.getAttribute('aria-label'), role: document.querySelector('.instl').tagName }
  })
  a.tag === 'BUTTON' ? ok('dismiss is a real button') : fail(`dismiss is a ${a.tag}`)
  a.label === 'Dismiss' ? ok('dismiss labelled') : fail(`dismiss aria-label is ${a.label}`)
  a.role === 'ASIDE' ? ok('strip is an <aside>') : fail(`strip is a ${a.role}`)
  // tab from the h1 area to the strip's controls
  const reach = await page.evaluate(async () => {
    const btn = document.querySelector('.instl .btn--sm')
    btn.focus()
    const okBtn = document.activeElement === btn
    const x = document.querySelector('.instl-x')
    x.focus()
    return okBtn && document.activeElement === x
  })
  reach ? ok('both controls focusable') : fail('a control cannot take focus')
  await ctx.close()
}

await browser.close()
console.log(`\n=== FINDINGS: ${findings.length}`)
findings.forEach((f) => console.log(' - ' + f))
