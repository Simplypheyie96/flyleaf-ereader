/* The reading sheet, measured.

   The sheet's whole claim is that it does not cover the text it is setting, so
   the first thing here is the geometry of the four rows: stage, sheet, foot,
   window — every boundary read off the rendered page rather than assumed from
   the CSS. After that: both edges of every control (the trailing one is the
   one that drifts), the contrast of every rendered pair on all three tabs on a
   light AND a dark stock, whether a slider actually restyles the book while it
   is being dragged, whether the fill and the zero tick sit where the thumb
   does, and the three things that are supposed to be ABSENT — Line width
   on a phone, the Turn row in scrolled flow, and the rivers note once it has
   been answered. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { PROBE, check } from './probe.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const findings = []
const steps = []
const m = {}
const bad = (what, detail) => findings.push(`${what}: ${detail}`)

const browser = await chromium.launch()

/* ── open the reader, open the chrome, open the sheet ───────────────────── */
async function openSheet(page) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2800)                                // splash + seed
  await page.goto(BASE + '/book/pride-and-prejudice', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
  await page.waitForFunction(() => {
    const v = document.querySelector('foliate-view')
    return !!v && !document.querySelector('.reader-opening')
  }, null, { timeout: 25000 })
  await page.waitForTimeout(1000)
  const box = await page.locator('.reader-stage').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)   // chrome
  await page.waitForTimeout(350)
  await page.getByRole('button', { name: 'Text and page settings' }).click()
  await page.waitForTimeout(400)
}

const frame = page => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')
const readingSize = async page => {
  const f = frame(page)
  return f ? f.evaluate(() => getComputedStyle(document.documentElement).fontSize) : null
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

await openSheet(page)
steps.push('sheet open on a 390x844 phone')

/* ── 1. four rows, no overlap, nothing off the bottom ───────────────────── */
m.rows = await page.evaluate(() => {
  const r = s => {
    const el = document.querySelector(s)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }
  }
  return {
    win: innerHeight,
    top: r('.reader-bar--top'), stage: r('.reader-stage'),
    sheet: r('.sheet'), foot: r('.reader-bar--bottom'),
    docScrollH: document.documentElement.scrollHeight,
  }
})
{
  const g = m.rows
  if (!g.sheet) bad('sheet', 'the sheet did not open')
  else {
    if (g.stage.bottom > g.sheet.top + 1) bad('sheet', `the sheet overlaps the stage by ${g.stage.bottom - g.sheet.top}px`)
    /* The sheet must not cover the floating bar, which is the comparison the
       other way round from the one this line made for two releases: the bar
       used to be the last row of the grid, BELOW the sheet, so `sheet.bottom >
       foot.top` was the overlap test. Since the chrome floats, the bar sits at
       the bottom of the reading area and the sheet opens beneath it — measured
       390x844, bar 442-506 and sheet 506-844 — so the old form was true of
       every correct layout and reported a 402px overlap that does not exist. */
    if (g.sheet.top < g.foot.bottom - 1) bad('sheet', `the sheet covers the foot bar by ${g.foot.bottom - g.sheet.top}px`)
    if (g.foot.bottom > g.win + 1) bad('sheet', `the foot bar is ${g.foot.bottom - g.win}px below the window`)
    if (g.sheet.h > g.win * 0.46 + 1) bad('sheet', `the sheet is ${g.sheet.h}px of a ${g.win}px window, over the 46dvh cap`)
    if (g.stage.h < g.sheet.h) bad('sheet', `the sheet (${g.sheet.h}px) is taller than the page pane (${g.stage.h}px)`)
    if (g.stage.h < g.win * 0.4) bad('sheet', `the page pane is down to ${g.stage.h}px of ${g.win}px`)
    if (g.docScrollH > g.win + 1) bad('sheet', `the document scrolls: ${g.docScrollH} > ${g.win}`)
    steps.push(`rows: stage ${g.stage.h} · sheet ${g.sheet.h} · foot ${g.foot.h} of ${g.win}`)
  }
}

/* ── 2. the readout is still centred on the window ──────────────────────── */
m.footCentre = await page.evaluate(() => {
  const p = document.querySelector('.reader-readout').getBoundingClientRect()
  return { centre: Math.round(p.left + p.width / 2), win: Math.round(innerWidth / 2) }
})
if (Math.abs(m.footCentre.centre - m.footCentre.win) > 1)
  bad('foot', `the readout's centre is ${m.footCentre.centre}, the window's is ${m.footCentre.win}`)

/* ── 3. both edges of every control, on every tab ───────────────────────── */
const edges = async (tab) => {
  const r = await page.evaluate(() => {
    const body = document.querySelector('.sheet-body')
    const b = body.getBoundingClientRect()
    const cs = getComputedStyle(body)
    const pad = { l: parseFloat(cs.paddingLeft), r: parseFloat(cs.paddingRight) }
    const col = { l: b.left + pad.l, r: b.right - pad.r }
    const rows = [...body.children].map(el => {
      const q = el.getBoundingClientRect()
      return {
        cls: el.className, lead: +(q.left - col.l).toFixed(1), trail: +(col.r - q.right).toFixed(1),
        h: Math.round(q.height),
      }
    })
    return { pad, col: { l: Math.round(col.l), r: Math.round(col.r) }, rows, scrollW: body.scrollWidth, clientW: body.clientWidth }
  })
  m['edges-' + tab] = r
  for (const row of r.rows) {
    if (Math.abs(row.lead) > 0.6 || Math.abs(row.trail) > 0.6)
      bad('edges', `${tab}/${row.cls}: lead ${row.lead} trail ${row.trail} off the control column`)
  }
  if (r.scrollW > r.clientW + 1) bad('edges', `${tab}: the sheet body scrolls horizontally, ${r.scrollW} > ${r.clientW}`)
  return r
}

const probe = async (tag) => {
  const res = await page.evaluate(PROBE)
  steps.push(tag)
  findings.push(...check(tag, res))
  return res
}

/* A tap on the chrome is the chrome's. The turn controller listens on the HOST
   document, so before the bail in turn.ts#down every button in the bars, the
   drawer and the sheet also ran the tap logic: "Contents" sat in the leading
   third and turned a page back as it opened, and the middle sheet tab sat in
   the centre third and closed the chrome that was holding the sheet open. */
const readout = () => page.locator('.reader-readout').innerText()
for (const tab of ['Text', 'Page', 'Turn']) {
  const before = await readout()
  await page.getByRole('tab', { name: tab }).click()
  await page.waitForTimeout(250)
  if (!(await page.locator('.sheet').count()))
    { bad('chrome', `clicking the ${tab} tab closed the sheet`); break }
  const after = await readout()
  if (after !== before) bad('chrome', `clicking the ${tab} tab also turned the page (${before} -> ${after})`)
  await edges(tab.toLowerCase())
  await probe(`day/${tab}`)
}

{
  /* Opening the drawer closes the sheet, so the pane grows and the chapter
     legitimately re-paginates — "page 1 of 12" becoming "page 1 of 6" is the
     paginator working, not a turn. Position is what must not move, so this
     compares the chapter and the percentage and ignores the page count. */
  const place = async () => {
    const t = await readout()
    return [await page.locator('.reader-chapter').innerText(), (t.match(/(\d+)%/) || [])[1],
      (t.match(/PAGE (\d+)/i) || [])[1]].join('/')
  }
  const before = await place()
  await page.getByRole('button', { name: 'Contents' }).click()
  await page.waitForTimeout(400)
  const open = await page.locator('.reader-panel').count()
  const after = await place()
  if (!open) bad('chrome', 'the Contents button did not open the drawer')
  if (after !== before) bad('chrome', `the Contents button also moved the position (${before} -> ${after})`)
  /* Closed from the panel's own control, not from the button that opened it.
     The panel fills the reading area — which since the chrome floats is the
     whole viewport — so it paints over that button: measured, the Contents
     button's own centre resolves to a .reader-toc-link, and Escape is not an
     exit on a phone. A panel with no visible way out is a trap. */
  if (!(await page.locator('.reader-panel .panel-done').count()))
    bad('chrome', 'the panel has no visible way to close it')
  await page.locator('.panel-done').click()
  await page.waitForTimeout(300)
  if (await page.locator('.reader-panel').count()) bad('chrome', 'Done did not close the panel')
  await page.getByRole('button', { name: 'Text and page settings' }).click()
  await page.waitForTimeout(350)
  if (!(await page.locator('.sheet').count())) bad('chrome', 'the sheet did not reopen after the drawer')
  steps.push('contents tap does not turn a page')
}

/* ── 4. what must be ABSENT on a phone ──────────────────────────────────── */
await page.getByRole('tab', { name: 'Page' }).click()
await page.waitForTimeout(200)
m.absent = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.sheet-body .ctl-lbl')].map(e => e.textContent.trim())
  const opts = [...document.querySelectorAll('.sheet-body .sheet-opt')].map(e => e.textContent.trim())
  return { labels, opts }
})
if (m.absent.labels.includes('Line width'))
  bad('absent', 'Line width is shown on a 390px phone, where no option could bite')
if (!m.absent.labels.includes('Stock'))
  bad('page tab', 'Stock does not head the Page tab')
if (m.absent.opts.filter(o => /Press|Day|Butter|Tea|Coal|Dusk|Pitch/.test(o)).length !== 7)
  bad('stocks', `${m.absent.opts.filter(o => /Press|Day|Butter|Tea|Coal|Dusk|Pitch/.test(o)).length} stock chips, expected 7`)

await page.getByRole('tab', { name: 'Turn' }).click()
await page.waitForTimeout(200)
m.turnTab = await page.evaluate(() => {
  /* Scoped to the Turn control's OWN group, not the whole tab body: the Turn
     tab also carries Flow (Paginated / Scrolled), and counting every
     .sheet-opt under it counts five options for a three-option control. */
  const grp = [...document.querySelectorAll('.sheet-body .ctl')].find(
    c => c.querySelector('.ctl-lbl')?.textContent.trim() === 'Turn')
  return {
    labels: [...document.querySelectorAll('.sheet-body .ctl-lbl')].map(e => e.textContent.trim()),
    opts: [...document.querySelectorAll('.sheet-body .sheet-opt')].map(e => e.textContent.trim()),
    styles: grp
      ? [...grp.querySelectorAll('.sheet-opt')].map(e => e.textContent.trim())
      : null,
  }
})
if (!m.turnTab.styles) bad('turn tab', 'no Turn control found in the Turn tab')
else {
  if (!m.turnTab.styles.includes('Slide')) bad('turn tab', 'no Slide option')
  /* THREE styles, and the count is the check. Curl was cut, and a control that
     is removed from a list but not from the union it is typed against leaves a
     dead option that still writes a value nothing reads. */
  if (m.turnTab.styles.includes('Curl')) bad('turn tab', 'Curl is still offered — it was cut')
  if (m.turnTab.styles.length !== 3)
    bad('turn tab', `${m.turnTab.styles.length} turn styles, expected 3: ${m.turnTab.styles.join(', ')}`)
}
/* Picking one has to reach the turn layer: an option that quietly does
   something else is the failure this guards. */
for (const [label, attr] of [['Fade', 'fade'], ['Instant', 'instant'], ['Slide', 'slide']]) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(250)
  const got = await page.evaluate(() =>
    document.querySelector('.reader')?.getAttribute('data-turn'))
  m[`turn:${attr}`] = got
  if (got !== attr) bad('turn tab', `picking ${label} left data-turn=${got}`)
}

/* Scrolled flow HIDES the turn control rather than greying it — SPEC § 5.1. */
await page.getByRole('button', { name: 'Scrolled' }).click()
await page.waitForTimeout(500)
m.scrolled = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('.sheet-body .ctl-lbl')].map(e => e.textContent.trim()),
  flow: document.querySelector('.reader')?.dataset.flow,
  rendererFlow: document.querySelector('foliate-view')?.renderer?.getAttribute('flow'),
}))
if (m.scrolled.labels.includes('Turn')) bad('scrolled', 'the Turn control is still shown in scrolled flow')
if (m.scrolled.rendererFlow !== 'scrolled') bad('scrolled', `the engine is still in ${m.scrolled.rendererFlow} flow`)
await page.getByRole('button', { name: 'Paginated' }).click()
await page.waitForTimeout(600)

/* ── 5. a slider restyles the book live, and the write lands after ──────── */
await page.getByRole('tab', { name: 'Text' }).click()
await page.waitForTimeout(250)
const size0 = await readingSize(page)
const rng = page.locator('.rng').first()
const rb = await rng.boundingBox()
await page.mouse.move(rb.x + rb.width * 0.5, rb.y + rb.height / 2)
await page.mouse.down()
await page.mouse.move(rb.x + rb.width * 0.92, rb.y + rb.height / 2, { steps: 8 })
const sizeMid = await readingSize(page)          // still under the finger
await page.mouse.up()
await page.waitForTimeout(700)                   // past the 320ms commit
const size1 = await readingSize(page)
const stored = await page.evaluate(() => new Promise(res => {
  const rq = indexedDB.open('flyleaf-ereader')
  rq.onsuccess = () => {
    const g = rq.result.transaction('settings').objectStore('settings').get(1)
    g.onsuccess = () => res(g.result?.size ?? null)
    g.onerror = () => res('err')
  }
  rq.onerror = () => res('err')
}))
m.slider = { size0, sizeMid, size1, stored, valueShown: await page.locator('.ctl-val').first().textContent() }
if (sizeMid === size0) bad('slider', `dragging Size did not restyle the book while the finger was down (${size0})`)
if (stored === null || Math.abs(parseFloat(size1) - stored) > 0.01)
  bad('slider', `the book renders at ${size1} but the record says ${stored}`)
steps.push(`slider: ${size0} -> ${sizeMid} live -> stored ${stored}`)

/* ── 6. the fill and the zero tick sit on the thumb's travel ────────────── */
m.tick = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.ctl')]
  const row = rows.find(r => r.querySelector('.rng-zero'))
  if (!row) return null
  const wrap = row.querySelector('.rng-wrap').getBoundingClientRect()
  const tick = row.querySelector('.rng-zero').getBoundingClientRect()
  const input = row.querySelector('.rng')
  const min = +input.min, max = +input.max
  const z = (0 - min) / (max - min)
  return {
    label: row.querySelector('.ctl-lbl').textContent.trim(),
    expected: +(11 + (wrap.width - 22) * z).toFixed(1),
    actual: +(tick.left - wrap.left).toFixed(1),
    value: input.value,
  }
})
if (!m.tick) bad('tick', 'no zero tick on either signed range')
else if (Math.abs(m.tick.expected - m.tick.actual) > 1)
  bad('tick', `${m.tick.label}: zero tick at ${m.tick.actual}px, the thumb's zero is ${m.tick.expected}px`)

/* ── 7. the rivers note: it appears, it fixes, it does not come back ────── */
await page.getByRole('button', { name: 'Justified' }).click()
await page.waitForTimeout(500)
m.rivers = { appeared: await page.locator('.sheet-note').count() }
if (!m.rivers.appeared)
  bad('rivers', 'justified + no hyphens on a phone measure raised no note')
else {
  await page.getByRole('button', { name: 'Hyphenate' }).click()
  await page.waitForTimeout(500)
  m.rivers.afterFix = await page.locator('.sheet-note').count()
  m.rivers.hyphens = await (async () => {
    const f = frame(page)
    return f ? f.evaluate(() => getComputedStyle(document.body).hyphens) : null
  })()
  if (m.rivers.afterFix) bad('rivers', 'the note is still up after hyphenation was turned on')
  if (m.rivers.hyphens !== 'auto') bad('rivers', `the fix did not reach the page: hyphens is "${m.rivers.hyphens}"`)
}
steps.push(`rivers: raised ${m.rivers.appeared}, cleared by the inline fix`)

/* ── 8. the same three tabs on the darkest stock ────────────────────────── */
await page.getByRole('tab', { name: 'Page' }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Pitch' }).click()
await page.waitForTimeout(400)
m.pitch = await page.evaluate(() => ({
  stock: document.querySelector('.reader').dataset.stock,
  sheetBg: getComputedStyle(document.querySelector('.sheet')).backgroundColor,
  swatches: [...document.querySelectorAll('.sheet-sw')].map(s => getComputedStyle(s).backgroundColor),
}))
if (new Set(m.pitch.swatches).size !== 7)
  bad('swatches', `${new Set(m.pitch.swatches).size} distinct swatch grounds, expected 7`)
for (const tab of ['Text', 'Page', 'Turn']) {
  await page.getByRole('tab', { name: tab }).click()
  await page.waitForTimeout(250)
  await probe(`pitch/${tab}`)
}

/* ── 9. and on a desktop, where Line width must APPEAR ─────────────────── */
await page.setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(700)
await page.getByRole('tab', { name: 'Page' }).click()
await page.waitForTimeout(300)
m.desktop = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('.sheet-body .ctl-lbl')].map(e => e.textContent.trim()),
  sheet: Math.round(document.querySelector('.sheet').getBoundingClientRect().height),
  win: innerHeight,
}))
if (!m.desktop.labels.includes('Line width'))
  bad('desktop', 'Line width is still hidden on a 1280px window, where it does bite')
if (m.desktop.sheet > m.desktop.win - 104 - m.desktop.sheet)
  bad('desktop', `the sheet (${m.desktop.sheet}px) takes more of a ${m.desktop.win}px window than the page does`)
await edges('page-1280')
await probe('pitch/Page@1280')

m.errors = errors
if (errors.length) bad('console', errors.slice(0, 4).join(' | '))

await browser.close()
console.log(JSON.stringify({ findings, steps, m }, null, 2))
console.log('\n=== FINDINGS: ' + findings.length + ' ===')
for (const f of findings) console.log(' - ' + f)
