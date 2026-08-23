/* The states the route sweep cannot reach.

   audit.mjs only ever loads a URL, so it always sees the shelf in covers view
   with both included books on it. The list view is a localStorage preference
   and the cleared shelf is the result of two deletions — neither is a route,
   so neither has ever been measured. This driver walks the app into those
   states and runs the same probe on them, and does it with the network off,
   which is also the only honest way to test Restore: the seed EPUBs are
   precached, and "no feature needs a network" is a project rule, not a hope. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { PROBE, check } from './probe.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const WIDTHS = [360, 390, 768, 1024, 1280, 1920]

const findings = []
const steps = []
const browser = await chromium.launch()

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  const say = (s) => steps.push(`${theme}: ${s}`)

  const sweep = async (label) => {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 })
      await page.waitForTimeout(200)
      findings.push(...check(`${theme} ${label} @${w}`, await page.evaluate(PROBE)))
    }
    await page.setViewportSize({ width: 390, height: 844 })
  }

  /* First load online, so the service worker installs and precaches. Every
     step after this one runs offline. */
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2600)                                  // splash hold + seeding
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
  say(`seeded ${await page.locator('a.shelf-card').count()} books, SW controlling`)

  await ctx.setOffline(true)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(1800)
  const offlineCards = await page.locator('a.shelf-card').count()
  if (offlineCards !== 2) findings.push(`${theme}: offline reload shows ${offlineCards} books, expected 2`)
  say(`offline reload: ${offlineCards} books`)

  // ---- list view -------------------------------------------------------
  /* The view switcher labels its buttons visibly now, not with aria-label. */
  await page.locator('.seg-views button', { hasText: 'List' }).click()
  await page.waitForTimeout(400)
  const rows = await page.locator('a.shelf-row').count()
  if (rows !== 2) findings.push(`${theme}: list view shows ${rows} rows, expected 2`)
  say(`list view: ${rows} rows`)
  await sweep('shelf/list')

  /* Does the choice survive a reload, or does someone who picked the list get
     a grid on every cold start? */
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(1800)
  const kept = await page.locator('a.shelf-row').count()
  if (kept !== 2) findings.push(`${theme}: list view not remembered across a reload — ${kept} rows`)
  say(`list view after reload: ${kept} rows`)

  // ---- remove both, offline -------------------------------------------
  for (const id of ['pride-and-prejudice', 'the-time-machine']) {
    await page.goto(BASE + `/book/${id}`, { waitUntil: 'load' })
    await page.waitForTimeout(900)
    const title = (await page.locator('h1').first().textContent() || '').trim()
    /* Two taps now, not one: the destructive action moved out of the default
       view and into the ⋯ menu. That is the point of the change, so the driver
       walks the same path a reader does rather than reaching past the menu. */
    await page.getByRole('button', { name: /more for this book/i }).click()
    await page.waitForTimeout(200)
    await page.getByRole('menuitem', { name: /remove from library/i }).click()
    await page.waitForTimeout(350)
    const confirm = page.locator('button.btn--danger-solid')
    say(`${id}: confirm reads "${(await confirm.textContent() || '').trim()}" for "${title}"`)
    await confirm.click()
    await page.waitForTimeout(1200)
    say(`${id}: after delete, at ${new URL(page.url()).pathname}`)
  }
  await page.waitForTimeout(400)
  const empty = await page.locator('.empty h2').textContent().catch(() => null)
  const secondary = await page.locator('.empty-second').count()
  if (!empty) findings.push(`${theme}: both books deleted but no empty state rendered`)
  if (secondary !== 1) findings.push(`${theme}: cleared shelf shows ${secondary} "bring back" links, expected 1`)
  say(`cleared shelf: "${empty}", restore link x${secondary}`)
  await sweep('shelf/empty')

  /* A dismissal has to be durable — a reload that re-seeds is the whole bug
     this state exists to prevent. */
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(2200)
  const stillEmpty = await page.locator('.empty h2').count()
  const crept = await page.locator('a.shelf-card, a.shelf-row').count()
  if (!stillEmpty || crept) findings.push(`${theme}: deleted books came back on reload — ${crept} on the shelf`)
  say(`after reload: empty=${!!stillEmpty}, books=${crept}`)

  // ---- restore, still offline -----------------------------------------
  await page.goto(BASE + '/settings', { waitUntil: 'load' })
  await page.waitForTimeout(900)
  /* Included books lives behind a fold now — three of the eight Settings
     panels are put away by default, so the driver opens the one it needs
     rather than assuming every control is on screen. */
  const fold = page.locator('.fold-hd', { hasText: 'Included books' })
  if (await fold.getAttribute('aria-expanded') === 'false') await fold.click()
  await page.waitForTimeout(200)
  await page.locator('button', { hasText: 'Restore included books' }).click()
  await page.waitForTimeout(3000)
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(2000)
  const back = await page.locator('a.shelf-card, a.shelf-row').count()
  if (back !== 2) findings.push(`${theme}: restore offline put ${back} books back, expected 2`)
  say(`restored offline: ${back} books`)

  const real = [...new Set(errors)].filter(e => !/Failed to fetch|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(e))
  if (real.length) findings.push(`${theme}: console errors — ${real.join(' | ')}`)
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify({ steps, findings }, null, 2))
