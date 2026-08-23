import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { PROBE, check } from './probe.mjs'

/* The book sheet, in every state it has. The default view is what routes.mjs
   already sweeps; this driver opens the things that are closed — the ⋯ menu,
   the blurb, the facts, the confirm — because a panel nobody opened is a panel
   nobody measured, and three of the four only exist after a click.

   It also asserts the inner alignment the route sweep structurally cannot see:
   `check()` compares a page-inner child's edges to the column, but the subjects
   list is a grandchild inside a panel. A `list-style:none` that left the UA's
   40px padding-inline-start behind put that row 40px off the blurb it belongs
   to, and every route check still passed. Hence the explicit edge assertions. */

const BASE = process.env.BASE || 'http://localhost:4173'
const THEMES = ['light', 'sepia', 'dark', 'ink']
const findings = []
const steps = []

const browser = await chromium.launch()

for (const theme of THEMES) {
  /* Emulated scheme opposite the chosen one, as in routes.mjs, so a theme that
     did not stick reads as the wrong ground rather than passing by luck. */
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: theme === 'dark' || theme === 'ink' ? 'light' : 'dark',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  const at = (s) => `${theme}/${s}`
  const probe = async (s) => { const r = await page.evaluate(PROBE); steps.push(at(s)); findings.push(...check(at(s), r)); return r }

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2600)
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: theme[0].toUpperCase() + theme.slice(1), exact: true }).click()
  await page.waitForTimeout(250)

  await page.goto(BASE + '/book/pride-and-prejudice', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)

  /* ── one primary action, and it is the only filled control on the screen ── */
  /* "Filled" means carrying the accent fill, not merely having a background:
     the ⋯ is a hairline circle on the card surface, and a first pass that
     counted any non-transparent background called it a second primary action.
     The test is emphasis, so it has to be the accent ground specifically —
     --accent, not --ink: the primary action took the accent when colour was
     added to the chrome, and this check was still probing the old ground. */
  const solids = await page.evaluate(() => {
    const inner = document.querySelector('.page-inner')
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    inner.appendChild(probe)
    const ink = getComputedStyle(probe).color
    probe.remove()
    return Array.from(inner.querySelectorAll('button,a'))
      .filter(el => el.getClientRects().length && !el.closest('.tabbar'))
      .map(el => ({ txt: el.textContent.trim().slice(0, 22), bg: getComputedStyle(el).backgroundColor }))
      .filter(b => b.bg === ink)
  })
  if (solids.length !== 1) findings.push(at('default') + `: ${solids.length} filled controls, expected 1 — ` + solids.map(s => `"${s.txt}" ${s.bg}`).join(' | '))
  else if (!/START READING|CONTINUE|READ AGAIN/i.test(solids[0].txt)) findings.push(at('default') + `: the one filled control is "${solids[0].txt}", not the read action`)

  /* the destructive action must NOT be in the default view */
  const removeVisible = await page.getByRole('button', { name: /remove/i }).count()
  if (removeVisible) findings.push(at('default') + `: a Remove control is visible before the menu is opened`)

  await probe('default')

  /* ── inner edges: everything in a panel shares the panel's text column ──── */
  const edges = await page.evaluate(() => {
    const p = document.querySelector('.detail-blurb')?.closest('.panel')
    if (!p) return null
    const L = (el) => +el.getBoundingClientRect().x.toFixed(1)
    const R = (el) => +el.getBoundingClientRect().right.toFixed(1)
    const cs = getComputedStyle(p), box = p.getBoundingClientRect()
    const col = { x: +(box.x + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)).toFixed(1),
                  r: +(box.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)).toFixed(1) }
    const pick = (sel) => { const el = p.querySelector(sel); return el ? { sel, x: L(el), r: R(el) } : null }
    return { col, items: [pick('.ui-lbl'), pick('.detail-blurb'), pick('.detail-more'), pick('.subjects')].filter(Boolean) }
  })
  if (edges) for (const it of edges.items) {
    if (Math.abs(it.x - edges.col.x) > 0.5) findings.push(at('default') + `: ${it.sel} leading edge ${it.x} vs panel column ${edges.col.x}`)
    /* Trailing edge only for full-width blocks; MORE is a shrink-to-fit button
       and the chip row wraps, so neither is expected to reach the far edge. */
    if (/ui-lbl|blurb/.test(it.sel) && it.r > edges.col.r + 0.5) findings.push(at('default') + `: ${it.sel} overruns the panel column by ${(it.r - edges.col.r).toFixed(1)}px`)
  }

  /* raw data must not reach the screen */
  const raw = await page.evaluate(() => {
    const t = document.querySelector('.page-inner').textContent
    const bad = []
    if (/\s--\s/.test(t)) bad.push('MARC "--" separator')
    if (/T\d\d:\d\d:\d\dZ/.test(t)) bad.push('ISO timestamp')
    if (/<\/?[a-z]+>/i.test(t)) bad.push('HTML markup')
    return bad
  })
  if (raw.length) findings.push(at('default') + ': unprocessed data on screen — ' + raw.join(', '))

  /* ── the ⋯ menu: opens, stays on screen, roves, and returns focus ──────── */
  await page.getByRole('button', { name: /more for this book|options/i }).click()
  await page.waitForTimeout(220)
  const menu = await page.evaluate(() => {
    const m = document.querySelector('[role="menu"]')
    if (!m) return null
    const q = m.getBoundingClientRect()
    return { x: +q.x.toFixed(1), r: +q.right.toFixed(1), t: +q.top.toFixed(1), b: +q.bottom.toFixed(1),
             items: Array.from(m.querySelectorAll('[role="menuitem"]')).map(el => {
               const k = el.getBoundingClientRect()
               return { txt: el.textContent.trim(), w: +k.width.toFixed(1), h: +k.height.toFixed(1) } }),
             focused: document.activeElement?.textContent?.trim() }
  })
  if (!menu) findings.push(at('menu') + ': no [role="menu"] after opening')
  else {
    if (menu.x < 0 || menu.r > 390 || menu.t < 0) findings.push(at('menu') + `: off screen — x ${menu.x} r ${menu.r} t ${menu.t}`)
    for (const i of menu.items) if (i.h < 24) findings.push(at('menu') + `: item "${i.txt}" only ${i.h}px tall`)
    if (menu.focused !== menu.items[0]?.txt) findings.push(at('menu') + `: focus went to "${menu.focused}", not the first item`)
  }
  await probe('menu')

  await page.keyboard.press('ArrowDown')
  const roved = await page.evaluate(() => document.activeElement?.textContent?.trim())
  if (roved !== menu?.items[1]?.txt) findings.push(at('menu') + `: ArrowDown landed on "${roved}", not "${menu?.items[1]?.txt}"`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(160)
  /* The trigger's name is visually-hidden text inside it, not an aria-label —
     reading only the attribute reported "BUTTON" and failed a check that in
     fact passed. textContent is what a screen reader would announce here. */
  const returned = await page.evaluate(() => ({
    open: !!document.querySelector('[role="menu"]'),
    focus: (document.activeElement?.textContent || '').trim() || document.activeElement?.tagName,
  }))
  if (returned.open) findings.push(at('menu') + ': Escape did not close it')
  if (!/more|option/i.test(returned.focus || '')) findings.push(at('menu') + `: Escape left focus on "${returned.focus}", not the trigger`)

  /* ── blurb expanded, facts expanded ───────────────────────────────────── */
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.waitForTimeout(200)
  await probe('blurb-open')
  await page.getByRole('button', { name: 'Details' }).click()
  await page.waitForTimeout(200)
  const facts = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.facts > div'))
    return rows.map(r => {
      const dt = r.querySelector('dt'), dd = r.querySelector('dd')
      return { k: dt.textContent.trim(), v: dd.textContent.trim(),
               dtx: +dt.getBoundingClientRect().x.toFixed(1), ddx: +dd.getBoundingClientRect().x.toFixed(1),
               ddr: +dd.getBoundingClientRect().right.toFixed(1) }
    })
  })
  /* Every value on one shared edge — a two-column table whose second column
     starts in a different place per row is a list, not a table. */
  const vx = new Set(facts.map(f => f.ddx))
  if (vx.size > 1) findings.push(at('facts') + `: value column starts at ${[...vx].join('/')} across rows`)
  await probe('facts-open')

  /* ── the confirm: named, scrolled to, and the only filled danger ───────── */
  await page.getByRole('button', { name: /more for this book|options/i }).click()
  await page.waitForTimeout(200)
  await page.getByRole('menuitem', { name: /remove/i }).click()
  await page.waitForTimeout(320)
  const conf = await page.evaluate(() => {
    const p = document.querySelector('.panel--danger')
    if (!p) return null
    const q = p.getBoundingClientRect()
    return { names: /Pride and Prejudice/.test(p.textContent), inView: q.top >= 0 && q.top < innerHeight,
             text: p.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) }
  })
  if (!conf) findings.push(at('confirm') + ': no confirm panel')
  else {
    if (!conf.names) findings.push(at('confirm') + ": does not name the book it would delete")
    if (!conf.inView) findings.push(at('confirm') + ': rendered off screen')
  }
  await probe('confirm')
  if (theme === 'light') console.error('confirm reads: ' + conf?.text)

  if (errors.length) findings.push(at('errors') + ': ' + [...new Set(errors)].join(' | '))
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify({ findings, steps: steps.length }, null, 2))
