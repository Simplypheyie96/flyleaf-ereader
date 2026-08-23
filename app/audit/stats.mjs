/* The stats screen, measured rather than looked at.

   Nothing on this page exists until somebody has read something, so the driver
   writes a plausible three months of history straight into IndexedDB first —
   gaps, a dead fortnight, one four-hour Sunday, a book that has since been
   deleted — and then runs the same probe every other screen gets, in all four
   chrome themes, at every supported width.

   The deleted-book row is the point of the fixture, not colour: it is the one
   case where a total on this page cannot be reconciled with the shelf, and it
   has to render as a sentence rather than a missing row. */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { PROBE, check } from './probe.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const WIDTHS = [360, 390, 768, 1024, 1280, 1920]
const THEMES = ['light', 'dark', 'sepia', 'ink']

const SEED_SRC = ((ids) => {
  const day = (n) => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    const p = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  const rows = []
  const push = (n, bookId, min, turns) =>
    rows.push({ id: `${day(n)}|${bookId}`, day: day(n), bookId, ms: min * 60000, turns, from: 0.1, to: 0.4 })
  /* a live streak of five, so the streak figure is not zero */
  for (let n = 0; n < 5; n++) push(n, ids[0], 18 + n * 7, 20 + n * 6)
  /* one long Sunday, to prove the week bars and the top calendar level */
  push(9, ids[0], 245, 300)
  /* an ordinary scatter with real gaps */
  for (const n of [7, 11, 12, 13, 17, 19, 24, 26, 33, 41, 44, 52, 58, 61, 70, 77, 80]) {
    push(n, ids[n % 2], 6 + (n % 40), 10 + (n % 30))
  }
  /* a fortnight with nothing at all: days 84-98 are deliberately absent */
  push(99, ids[0], 30, 40)
  /* and a book that is no longer on the shelf */
  push(21, 'deleted-book-000', 96, 120)
  return rows
}).toString()

const findings = []
const notes = []
const browser = await chromium.launch()

for (const theme of THEMES) {
  const scheme = theme === 'dark' || theme === 'ink' ? 'dark' : 'light'
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2600)                       // splash hold + first-run seeding

  /* Write history and pin the theme in one go, then reload so the app reads
     both from the database exactly as it would on a cold start. */
  const wrote = await page.evaluate(async ({ rows, theme }) => {
    const open = () => new Promise((res, rej) => {
      const rq = indexedDB.open('flyleaf-ereader')
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error)
    })
    const dbh = await open()
    const ids = await new Promise((res) => {
      const rq = dbh.transaction('books').objectStore('books').getAllKeys()
      rq.onsuccess = () => res(rq.result)
    })
    const tx = dbh.transaction(['readingDays', 'settings'], 'readwrite')
    const store = tx.objectStore('readingDays')
    const seed = new Function('return (' + rows + ')')()
    for (const r of seed(ids.length >= 2 ? ids : [ids[0] ?? 'x', ids[0] ?? 'x'])) store.put(r)
    const st = tx.objectStore('settings')
    const cur = await new Promise((res) => { const rq = st.get(1); rq.onsuccess = () => res(rq.result) })
    st.put({ ...cur, id: 1, theme })
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error) })
    /* One book opened and one finished, so the Reading tab has a card and the
       shelf section has a "last finished" row to render. */
    const tx2 = dbh.transaction('books', 'readwrite')
    const bs = tx2.objectStore('books')
    const all = await new Promise((res) => { const rq = bs.getAll(); rq.onsuccess = () => res(rq.result) })
    if (all[0]) bs.put({ ...all[0], openedAt: Date.now(), progress: 0.42 })
    if (all[1]) bs.put({ ...all[1], openedAt: Date.now() - 90000000, progress: 1, finishedAt: Date.now() - 86400000 })
    await new Promise((res, rej) => { tx2.oncomplete = res; tx2.onerror = () => rej(tx2.error) })
    return ids.length
  }, { rows: SEED_SRC, theme }).catch(e => 'ERR ' + e.message)
  notes.push(`${theme}: seed wrote against ${wrote} books`)

  await page.goto(BASE + '/stats', { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)

  const shape = await page.evaluate(() => {
    const t = (s) => document.querySelector(s)?.textContent?.trim() ?? null
    const cs = (s, p) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[p] : null }
    const box = (s) => { const el = document.querySelector(s); if (!el) return null; const q = el.getBoundingClientRect(); return { x: +q.x.toFixed(1), r: +q.right.toFixed(1), w: +q.width.toFixed(1) } }
    const inner = document.querySelector('.page-inner')
    const col = inner ? inner.getBoundingClientRect() : null
    return {
      tiles: Array.from(document.querySelectorAll('.stat')).map(el => ({
        n: el.querySelector('.stat-n')?.textContent,
        lbl: el.querySelector('.stat-lbl')?.textContent,
        bg: getComputedStyle(el).backgroundColor,
        h: +el.getBoundingClientRect().height.toFixed(1),
      })),
      weekBars: Array.from(document.querySelectorAll('.wk-bar')).map(el => +el.getBoundingClientRect().height.toFixed(1)),
      calCells: document.querySelectorAll('.cal-cell').length,
      calLevels: Array.from(document.querySelectorAll('.cal .cal-cell')).reduce((a, el) => {
        const k = el.dataset.future ? 'f' : el.dataset.level; a[k] = (a[k] ?? 0) + 1; return a
      }, {}),
      calCell: box('.cal .cal-cell'),
      tops: Array.from(document.querySelectorAll('.tops li')).map(el => ({
        t: el.querySelector('.top-t')?.textContent, n: el.querySelector('.top-n')?.textContent,
        gone: Boolean(el.querySelector('.top-t--gone')),
      })),
      mix: Array.from(document.querySelectorAll('.mix-seg')).map(el => ({
        f: el.dataset.family, w: +el.getBoundingClientRect().width.toFixed(1), bg: getComputedStyle(el).backgroundColor,
      })),
      facts: Array.from(document.querySelectorAll('.facts dt')).map((dt, i) =>
        `${dt.textContent} = ${document.querySelectorAll('.facts dd')[i]?.textContent}`),
      sub: t('.app-sub'),
      /* both edges of every block, against the column — the trailing edge is
         the one that drifts */
      edges: inner ? Array.from(inner.children).filter(el => !getComputedStyle(el).display.startsWith('inline'))
        .map(el => { const q = el.getBoundingClientRect(); return `${String(el.className).slice(0, 12)} L${+(q.x - col.x).toFixed(1)} R${+(col.right - q.right).toFixed(1)}` }) : [],
      scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      barBg: cs('.wk-bar', 'backgroundColor'),
      calMax: cs('.cal-cell[data-level="4"]', 'backgroundColor'),
    }
  })
  notes.push(JSON.stringify({ theme, shape }, null, 1))

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w >= 1024 ? 800 : 844 })
    await page.waitForTimeout(220)
    findings.push(...check(`${theme} stats @${w}`, await page.evaluate(PROBE)))
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    if (over > 0) findings.push(`${theme} stats @${w}: horizontal scroll ${over}px`)
  }

  /* the Reading tab's strip, which is the only door to this screen */
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(BASE + '/reading', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const strip = await page.evaluate(() => {
    const el = document.querySelector('.strip')
    if (!el) return null
    const q = el.getBoundingClientRect()
    const nav = document.querySelector('.tab-pill a[aria-current]')
    return { t: el.querySelector('.strip-t')?.textContent, h: +q.height.toFixed(1), navLit: nav?.getAttribute('aria-label') }
  })
  notes.push(`${theme}: strip ${JSON.stringify(strip)}`)
  findings.push(...check(`${theme} reading @390`, await page.evaluate(PROBE)))

  if (errors.length) findings.push(`${theme} console: ` + errors.slice(0, 4).join(' | '))
  await ctx.close()
}

await browser.close()
console.log(notes.join('\n'))
console.log('\n=== FINDINGS: ' + findings.length)
for (const f of findings) console.log('  -', f)
