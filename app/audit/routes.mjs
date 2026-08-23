import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const WIDTHS = [360, 390, 768, 1024, 1280, 1920]
const ROUTES = ['/', '/open', '/settings', '/book/pride-and-prejudice']

/* Five appearances, not two. `system` is driven by the emulated colorScheme;
   the four explicit ones are set the way a reader sets them — by clicking the
   swatch on /settings — so the sweep exercises the persistence path too, not
   just the CSS. Every theme is swept over every route at every width, because
   Sepia and Ink each introduce one card surface the others do not have, and a
   contrast pair that only exists on a card is only measurable on a card. */
const THEMES = [
  { name: 'system-light', set: null, scheme: 'light', expect: 'light' },
  { name: 'system-dark',  set: null, scheme: 'dark',  expect: 'dark'  },
  { name: 'light', set: 'Light', scheme: 'dark',  expect: 'light' },
  { name: 'sepia', set: 'Sepia', scheme: 'dark',  expect: 'sepia' },
  { name: 'dark',  set: 'Dark',  scheme: 'light', expect: 'dark'  },
  { name: 'ink',   set: 'Ink',   scheme: 'light', expect: 'ink'   },
]

import { PROBE, check } from './probe.mjs'

const browser = await chromium.launch()
const findings = []
const log = []

for (const t of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: t.scheme })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2600)                        // splash hold + seeding

  if (t.set) {
    await page.goto(BASE + '/settings', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: t.set, exact: true }).click()
    await page.waitForTimeout(250)
  }
  /* The emulated scheme is deliberately the OPPOSITE of the chosen theme above,
     so a theme that silently failed to persist would show up here as the wrong
     ground rather than passing by luck. */
  const got = await page.evaluate(() => document.documentElement.dataset.theme)
  if (got !== t.expect) findings.push(`${t.name}: data-theme is "${got}", expected "${t.expect}"`)

  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 })
      await page.waitForTimeout(200)
      const res = await page.evaluate(PROBE)
      const tag = `${t.name} ${route} @${w}`
      log.push({ tag, ...res })
      findings.push(...check(tag, res))
    }
  }
  if (errors.length) findings.push(`${t.name}: console errors — ${[...new Set(errors)].join(' | ')}`)
  await ctx.close()
}

await browser.close()
const worst = log.map(l => l.contrastWorst).filter(Boolean).sort((a, b) => a.cr - b.cr)[0]
console.log(JSON.stringify({ findings, checks: log.length, worstPairOverall: worst }, null, 2))
