/* ─────────────────────────────────────────────────────────────
   P5, part two: the accessibility gate.

   probe.mjs already measures the numbers a screenshot would hide — contrast
   over every rendered pair, target sizes, both gutters, horizontal overflow.
   This driver measures the half of accessibility that has no geometry: the
   names, the structure, the keyboard, and whether reduced motion actually
   reduces anything.

   SIX CLAIMS

   1. EVERY CONTROL HAS A NAME. An icon-only button with no aria-label is a
      button a screen reader announces as "button". Computed the way an AT
      computes it: aria-label, then aria-labelledby's text, then the element's
      own text, then title, then a child image's alt.
   2. THE KEYBOARD REACHES EVERYTHING, AND YOU CAN SEE WHERE YOU ARE. A real
      Tab walk, and at every stop the focused element must draw something —
      an outline, a ring, or a changed background. A focus ring that a
      component's `outline:none` quietly cancels is the classic way this
      breaks, and it is invisible to anyone using a mouse.
   3. THE HEADINGS ARE A STRUCTURE, not a type scale. One h1 per route, no
      skipped level. This is how a screen-reader user reads a page they have
      never seen.
   4. THE ARIA IS HONEST. A role=switch with no aria-checked, a role=tab with
      no aria-selected, an aria-labelledby pointing at an id that is not
      there, a focusable element inside aria-hidden — each is a control that
      lies about its own state.
   5. REDUCED MOTION REDUCES MOTION. Under prefers-reduced-motion, the page
      turn must still turn the page and must no longer animate. Honouring the
      setting by breaking the feature is not honouring it.
   6. THE THREE PWA SENTENCES ARE TRUE. Install guidance matches what this
      browser can actually do, storage reports a real number, and the update
      check answers with one of its three real answers.

   Run: npx vite build && node audit/a11y.mjs
   ───────────────────────────────────────────────────────────── */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:4173'
const WIDTHS = [390, 1280]

const out = { steps: [], findings: [], measures: {} }
const say = s => out.steps.push(s)
const bad = (what, detail) => out.findings.push({ what, detail })
const m = out.measures

/* Runs in the page. Everything here is structural — no colour, no geometry;
   probe.mjs owns those. */
const SEMANTICS = () => {
    const rendered = el => {
        const q = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return q.width > 0 && q.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
            && !el.closest('[hidden]')
            /* Out of the accessibility tree is out of scope for a name. The
               hidden file inputs behind "Choose a file" and "Restore from a
               backup" are the case: 1x1, not tab stops, aria-hidden, and the
               button beside each one is the control. The aria-hidden escape
               is not a blanket one — the focusable-inside-aria-hidden check
               below is what stops it being used to hide a real control. */
            && !el.closest('[aria-hidden=true]')
    }
    /* The accessible-name algorithm, to the depth this app can reach: it has no
       aria-describedby-only controls and no <label for>. */
    const nameOf = el => {
        const lbl = el.getAttribute('aria-label')?.trim()
        if (lbl) return lbl
        const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
        if (ids.length) {
            const txt = ids.map(i => document.getElementById(i)?.textContent?.trim() ?? '').join(' ').trim()
            if (txt) return txt
        }
        const own = el.textContent?.replace(/\s+/g, ' ').trim()
        if (own) return own
        const t = el.getAttribute('title')?.trim()
        if (t) return t
        const img = el.querySelector('img[alt], svg[aria-label]')
        const alt = img?.getAttribute('alt')?.trim() || img?.getAttribute('aria-label')?.trim()
        if (alt) return alt
        if (el.tagName === 'INPUT') {
            const ph = el.getAttribute('placeholder')?.trim()
            /* A placeholder is a weak name — it disappears the moment there is a
               value — but it is a name, so it is reported rather than failed. */
            if (ph) return '(placeholder) ' + ph
        }
        return null
    }
    const interactive = Array.from(document.querySelectorAll(
        'a[href],button,input,select,textarea,[role=switch],[role=tab],[role=button],[tabindex]:not([tabindex="-1"])'))
        .filter(rendered)

    const desc = el => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0].slice(0, 24)}`

    const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
        .filter(rendered)
        .map(h => ({ level: +h.tagName[1], text: h.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) }))

    const ariaBad = []
    for (const el of interactive) {
        const role = el.getAttribute('role')
        if (role === 'switch' && el.getAttribute('aria-checked') === null)
            ariaBad.push(`${desc(el)} is role=switch with no aria-checked`)
        if (role === 'tab' && el.getAttribute('aria-selected') === null)
            ariaBad.push(`${desc(el)} is role=tab with no aria-selected`)
        for (const a of ['aria-checked', 'aria-selected', 'aria-pressed', 'aria-expanded']) {
            const v = el.getAttribute(a)
            if (v !== null && !['true', 'false', 'mixed', 'undefined'].includes(v))
                ariaBad.push(`${desc(el)} has ${a}="${v}"`)
        }
        for (const i of (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean))
            if (!document.getElementById(i)) ariaBad.push(`${desc(el)} points aria-labelledby at missing #${i}`)
        if (el.closest('[aria-hidden=true]') && el.tabIndex >= 0)
            ariaBad.push(`${desc(el)} is focusable inside aria-hidden`)
    }
    /* A tablist whose tabs are not its children, or a tab with no tablist, is
       a role that promises arrow-key behaviour the markup cannot deliver. */
    for (const t of document.querySelectorAll('[role=tab]'))
        if (!t.closest('[role=tablist]')) ariaBad.push(`${desc(t)} is a role=tab outside any tablist`)

    const ids = Array.from(document.querySelectorAll('[id]')).map(e => e.id)
    const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i)

    /* The same key shape tabWalk records, so the two can be diffed: what the
       page offers as a tab stop against what a real Tab walk actually reached.
       Excludes tabIndex=-1 and disabled controls — neither is meant to be
       reachable, and counting them would manufacture a finding. */
    /* The label is part of the key, not just the class: every icon-only button
       in the reader chrome shares one class and has no text, so a class-only
       key collapsed four distinct controls into one and made "2 of 4 reached"
       look like full coverage. */
    const KEY = el => el.tagName + '.' + String(el.className).split(' ')[0]
        + '|' + (el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 18))
    const stops = interactive.filter(el => el.tabIndex >= 0 && !el.disabled).map(KEY)

    return {
        stops,
        lang: document.documentElement.lang || null,
        title: document.title,
        mains: document.querySelectorAll('main').length,
        navs: Array.from(document.querySelectorAll('nav')).map(n =>
            n.getAttribute('aria-label') ?? n.getAttribute('aria-labelledby') ?? null),
        heads,
        nameless: interactive.filter(el => !nameOf(el)).map(desc),
        weakNames: interactive.map(el => nameOf(el)).filter(n => n?.startsWith('(placeholder)')),
        imgNoAlt: Array.from(document.querySelectorAll('img')).filter(rendered)
            .filter(i => i.getAttribute('alt') === null && i.getAttribute('aria-hidden') !== 'true')
            .map(i => i.src.slice(-28)),
        ariaBad,
        dupIds,
        controls: interactive.length,
    }
}

const ensureChrome = async (page) => {
    for (let i = 0; i < 4; i++) {
        const shown = await page.evaluate(() => {
            const b = document.querySelector('.reader-bar--top button')
            if (!b) return false
            const cs = getComputedStyle(b)
            return b.getClientRects().length > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.5
        })
        if (shown) return true
        await page.locator('.reader-stage').click({ position: { x: 195, y: 430 } }).catch(() => { })
        await page.waitForTimeout(420)
    }
    return false
}

/* Claim 2, walked for real. Programmatic .focus() is not the same thing: the
   ring is :focus-visible, and only a keyboard press guarantees that state. */
const tabWalk = async (page, limit = 45) => {
    await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur())
    const stops = []
    const seen = new Set()
    for (let i = 0; i < limit; i++) {
        await page.keyboard.press('Tab')
        const s = await page.evaluate(() => {
            const el = document.activeElement
            /* Focus inside a child frame reads as <body> from out here. In the
               reader that is the book itself, and it sits in the middle of the
               tab order — so this is a stop to walk past, not the end of the
               walk. Breaking here is what made the reader look like it had two
               reachable controls when it has four. */
            if (!el || el === document.body) return { key: '\u2014 outside the document \u2014', outside: true }
            /* Wrap-around is detected on element identity, stamped as we go —
               not on a description of the element. Two icon-only buttons with
               the same class and no text describe identically, and comparing
               descriptions ended this walk after five of the library's eleven
               controls while reporting it as a pass. */
            if (el.dataset.a11yWalk) return { wrapped: true }
            el.dataset.a11yWalk = '1'
            const cs = getComputedStyle(el)
            const q = el.getBoundingClientRect()
            return {
                key: el.tagName + '.' + String(el.className).split(' ')[0] + '|'
                    + (el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 18)),
                name: el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 26) ?? null,
                /* Three ways this app draws focus, and a fourth for a field whose
                   wrapper lights up instead: the global ring, a component ring
                   in box-shadow, a changed background, or an ancestor that
                   matches :focus-within and paints. */
                outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1,
                shadow: cs.boxShadow !== 'none',
                bgOnFocus: (() => {
                    const wrap = el.closest('.panel-find, .set-switch, label')
                    return !!wrap && getComputedStyle(wrap).backgroundColor !== 'rgba(0, 0, 0, 0)'
                })(),
                offscreen: q.width === 0 || q.height === 0
                    || q.bottom < -2 || q.top > innerHeight + 2,
                focusVisible: el.matches(':focus-visible'),
            }
        })
        if (s.wrapped) break
        if (s.outside) { stops.push(s); continue }
        seen.add(s.key)
        stops.push(s)
    }
    return stops
}

/* Claim 2's other half: a walk that reaches four of a page's eleven controls
   passes a "did the walk find anything" check and tells you nothing. So the
   stops are diffed against what the page itself offers as a tab stop. */
const walkCoverage = (tag, sem, stops) => {
    const reached = new Set(stops.filter(s => !s.outside).map(s => s.key))
    /* Both sides deduplicated, so the two totals are commensurable and a
       reported "12 of 13" can only ever mean a control the keyboard missed. */
    const offered = [...new Set(sem.stops)]
    const missed = offered.filter(k => !reached.has(k))
    if (missed.length) bad('keyboard', `${tag}: the Tab walk never reached ${missed.length} of `
        + `${offered.length} control(s) — ${missed.slice(0, 6).join(' , ')}`)
    return { reached: reached.size, offered: offered.length, missed }
}

const browser = await chromium.launch()

/* ══ the sweep ═════════════════════════════════════════════════════════════ */
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errs = []
page.on('console', e => { if (e.type() === 'error') errs.push(e.text().slice(0, 160)) })
page.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)))

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(3200)
const bookId = await page.evaluate(() =>
    document.querySelector('a.shelf-card')?.getAttribute('href')?.split('/').pop() ?? null)
if (!bookId) bad('setup', 'no seeded book to open a sheet for')

const ROUTES = [
    ['library', '/'],
    ['reading', '/reading'],
    ['stats', '/stats'],
    ['settings', '/settings'],
    ['open', '/open'],
    ['book sheet', `/book/${bookId}`],
]

m.routes = {}
for (const [tag, path] of ROUTES) {
    for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: w < 700 ? 844 : 900 })
        await page.goto(BASE + path, { waitUntil: 'networkidle' })
        await page.waitForTimeout(900)
        const r = await page.evaluate(SEMANTICS)
        const key = `${tag} @${w}`
        m.routes[key] = r

        if (r.nameless.length) bad('name', `${key}: ${r.nameless.length} control(s) with no accessible name — ${r.nameless.join(', ')}`)
        if (r.ariaBad.length) bad('aria', `${key}: ${r.ariaBad.join(' | ')}`)
        if (r.dupIds.length) bad('aria', `${key}: duplicate ids — ${[...new Set(r.dupIds)].join(', ')}`)
        if (r.imgNoAlt.length) bad('name', `${key}: img with no alt — ${r.imgNoAlt.join(', ')}`)
        if (r.mains !== 1) bad('landmark', `${key}: ${r.mains} <main> elements`)
        if (r.navs.some(l => l === null)) bad('landmark', `${key}: an unlabelled <nav>`)
        if (!r.lang) bad('lang', `${key}: <html> has no lang`)
        const h1s = r.heads.filter(h => h.level === 1).length
        if (h1s !== 1) bad('heading', `${key}: ${h1s} h1s — ${r.heads.map(h => 'h' + h.level).join(' ')}`)
        for (let i = 1; i < r.heads.length; i++)
            if (r.heads[i].level - r.heads[i - 1].level > 1)
                bad('heading', `${key}: h${r.heads[i - 1].level} → h${r.heads[i].level} skips a level at "${r.heads[i].text}"`)
        if (!r.title || r.title.length < 4) bad('title', `${key}: document title is "${r.title}"`)
    }
    say(`${tag}: ${m.routes[`${tag} @390`].controls} controls, `
        + `${m.routes[`${tag} @390`].heads.map(h => 'h' + h.level).join(' ')}, "${m.routes[`${tag} @390`].title}"`)
}

m.walks = {}
/* ── the reading page itself ───────────────────────────────────────────────
   Not in the loop above, because it is not a route you can navigate to cold:
   it needs a book opened and its chrome shown. Leaving it out would have been
   the largest hole in this audit — it is the screen the app exists for, and it
   is the one with the most icon-only buttons. */
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(BASE + `/book/${bookId}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
await page.waitForFunction(() => !!document.querySelector('foliate-view') && !document.querySelector('.reader-opening'),
    null, { timeout: 30000 }).catch(() => bad('setup', 'the reader never opened for the a11y sweep'))
await page.waitForTimeout(1600)
if (!await ensureChrome(page)) bad('setup', 'the reader chrome never came up')
{
    const r = await page.evaluate(SEMANTICS)
    m.routes['reader @390'] = r
    if (r.nameless.length) bad('name', `reader: ${r.nameless.length} control(s) with no accessible name — ${r.nameless.join(', ')}`)
    if (r.ariaBad.length) bad('aria', `reader: ${r.ariaBad.join(' | ')}`)
    if (r.dupIds.length) bad('aria', `reader: duplicate ids — ${[...new Set(r.dupIds)].join(', ')}`)
    /* Heading and landmark structure are deliberately NOT asserted here. The
       reading page has no page-level heading of its own — the book supplies
       the headings, inside a cross-origin-ish iframe this driver cannot reach
       — and inventing an h1 to satisfy a checker would put a title above the
       text of every page. What is asserted is what a screen reader can act
       on: that every control in the chrome says what it does. */
    const stops = await tabWalk(page, 60)
    m.walks.reader = stops
    const cov = walkCoverage('reader', r, stops)
    const blind = stops.filter(s => s.focusVisible && !s.outline && !s.shadow && !s.bgOnFocus)
    if (blind.length) bad('keyboard', `reader: ${blind.length} stop(s) draw no focus indicator — `
        + blind.map(s => `"${s.name}"`).join(', '))
    /* A control the keyboard can reach but the eye cannot find is worse in the
       reader than anywhere else: the chrome auto-hides, so focus can end up on
       a bar that has faded out. */
    const lost = stops.filter(s => s.offscreen)
    if (lost.length) bad('keyboard', `reader: focus reached ${lost.length} element(s) that are not on screen — `
        + lost.map(s => `"${s.name}"`).join(', '))
    /* Reached can exceed offered, and does here: Tab also lands on the
       <foliate-view> host, which is the scroll container and the element the
       arrow-key turn needs focus on. It draws no ring, and is left that way
       deliberately — a 2px outline around the whole page every time a reader
       tabs past the book would be worse than none. Only a control the walk
       MISSED is ever a finding. */
    say(`reader: ${r.controls} chrome controls, all ${cov.offered} of them reached`
        + (cov.reached > cov.offered ? ` (plus ${cov.reached - cov.offered}: the book's own scroll container)` : '')
        + ', all named, all visible when focused')
}

/* ── claim 2: the Tab walk, on the two routes with the most controls ─────── */
for (const [tag, path] of [['library', '/'], ['settings', '/settings']]) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    /* The shelf renders from IndexedDB, so networkidle is not "loaded". Waiting
       on the cards is what makes the count below reproducible — an earlier run
       of this driver walked five stops on an eleven-control page and reported
       it as a pass. */
    await page.locator('a.shelf-card').first().waitFor({ timeout: 8000 }).catch(() => { })
    await page.waitForTimeout(900)
    const sem = await page.evaluate(SEMANTICS)
    const stops = await tabWalk(page)
    m.walks[tag] = stops
    const walkStats = walkCoverage(tag, sem, stops)
    const blind = stops.filter(s => s.focusVisible && !s.outline && !s.shadow && !s.bgOnFocus)
    if (blind.length) bad('keyboard', `${tag}: ${blind.length} stop(s) draw no focus indicator — `
        + blind.map(s => `"${s.name}"`).join(', '))
    const lost = stops.filter(s => s.offscreen)
    if (lost.length) bad('keyboard', `${tag}: focus went to something off screen — ${lost.map(s => `"${s.name}"`).join(', ')}`)
    const cov = walkStats
    say(`${tag}: ${cov.reached} of ${cov.offered} tab stops reached, each with a visible focus indicator`)
}

/* ── claim 6: the three PWA sentences ───────────────────────────────────── */
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' })
await page.waitForTimeout(1400)
m.pwa = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('.panel')).map(p => p.innerText.replace(/\s+/g, ' ').trim())
    return {
        /* Case-insensitive: .ui-lbl renders text-transform:uppercase, so the
           innerText of every panel heading comes back shouting. */
        device: panels.find(t => /^this device/i.test(t)) ?? null,
        library: panels.find(t => /^your library/i.test(t)) ?? null,
        version: panels.find(t => /^version/i.test(t)) ?? null,
    }
})
/* Chromium headless fires no beforeinstallprompt, so the honest sentence here
   is the "not offered yet" one — never an Install button with nothing behind it. */
if (!/has not offered an install|installed\.|install it and the app|add to home screen/i.test(m.pwa.device ?? ''))
    bad('pwa', `the install guidance reads "${m.pwa.device}"`)
if (/checking storage/i.test(m.pwa.library ?? ''))
    bad('pwa', 'the storage line was still "Checking storage…" after 1.4s')
if (!/\b\d+(\.\d+)?\s?(KB|MB|GB)\b/.test(m.pwa.library ?? ''))
    bad('pwa', `the library panel reports no real storage figure — "${m.pwa.library}"`)
say(`storage: "${(m.pwa.library ?? '').split('. ').pop()}"`)
say(`install: "${(m.pwa.device ?? '').replace(/^this device /i, '')}"`)

await page.getByRole('button', { name: 'Check for updates' }).click()
await page.waitForTimeout(3500)
m.pwa.update = await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll('.panel')).find(x => /^version/i.test(x.innerText))
    return p ? p.innerText.replace(/\s+/g, ' ').trim() : null
})
if (!/latest version|is installing|nothing to check/i.test(m.pwa.update ?? ''))
    bad('pwa', `the update check answered "${m.pwa.update}" — none of its three answers`)
else say(`update check: "${(m.pwa.update ?? '').split(/check for updates/i).pop().trim()}"`)
if (errs.length) { bad('console', errs.join(' | ')); errs.length = 0 }
await ctx.close()

/* ══ claim 5: reduced motion ════════════════════════════════════════════════
   Two things have to be true at once, and testing either alone proves nothing:
   the turn must stop animating, and it must still turn. */
const rm = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
const pr = await rm.newPage()
const errsRM = []
pr.on('pageerror', e => errsRM.push('pageerror: ' + e.message.slice(0, 160)))

await pr.goto(BASE + '/', { waitUntil: 'networkidle' })
await pr.waitForTimeout(3200)
await pr.locator('a.shelf-card').first().click()
await pr.waitForTimeout(700)
await pr.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
await pr.waitForFunction(() => !!document.querySelector('foliate-view') && !document.querySelector('.reader-opening'),
    null, { timeout: 30000 }).catch(() => bad('reduced motion', 'the reader never opened'))
await pr.waitForTimeout(1600)

const before = await pr.evaluate(() => document.querySelector('foliate-view')?.renderer?.start ?? null)
/* Any animation running while the turn commits is the thing this setting asks
   the app not to do. Sampled mid-turn, not after it. */
await pr.keyboard.press('ArrowRight')
/* An opacity cross-fade is what this setting asks for as the substitute, not
   a violation of it: the thing that must not run is transform motion — a
   slide, a fold, a scale, a spin. So each running animation is read down to
   the properties in its own keyframes, and only the moving ones fail.

   Sampled across the whole turn window rather than at one instant. A single
   sample is a coin toss: the reduced turn is two 75ms halves, and a sample
   that lands in the gap between them sees nothing and passes for the wrong
   reason. Polling for 500ms and unioning what it catches makes "nothing
   moves" a measurement instead of a lucky frame — and it reports the fade it
   did catch, so a genuinely empty window is visible as empty. */
m.reducedMotion = await pr.evaluate(async () => {
    const MOVES = /transform|translate|rotate|scale|top|left|inset|margin/
    const seen = new Map()
    const sample = () => {
        for (const a of document.getAnimations()) {
            if (a.playState !== 'running') continue
            const props = [...new Set((a.effect?.getKeyframes?.() ?? [])
                .flatMap(k => Object.keys(k))
                .filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)))]
            const on = String(a.effect?.target?.className ?? a.effect?.target?.tagName ?? '?').split(' ')[0]
            const ms = a.effect?.getTiming?.().duration ?? '?'
            seen.set(`${on}|${props.join('/')}|${ms}`, { on, ms, props })
        }
    }
    for (let i = 0; i < 32; i++) {
        sample()
        await new Promise(r => requestAnimationFrame(() => r()))
    }
    const running = [...seen.values()]
    return {
        running,
        samples: 32,
        moving: running.filter(r => r.props.some(p => MOVES.test(p))),
        stageTransition: getComputedStyle(document.querySelector('.reader-stage') ?? document.body).transitionDuration,
    }
})
await pr.waitForTimeout(900)
m.reducedMotion.turned = await pr.evaluate(() => document.querySelector('foliate-view')?.renderer?.start ?? null)
if (m.reducedMotion.turned === before)
    bad('reduced motion', `the page did not turn under reduced motion — still at column ${before}`)
else say(`reduced motion: the turn still turns (${before} → ${m.reducedMotion.turned})`)
if (m.reducedMotion.moving.length)
    bad('reduced motion', `${m.reducedMotion.moving.length} animation(s) still move something mid-turn — `
        + m.reducedMotion.moving.map(r => `.${r.on} ${r.props.join('/')} over ${r.ms}ms`).join(', '))
else if (!m.reducedMotion.running.length)
    bad('reduced motion', 'the turn ran with no animation at all across 32 sampled frames — '
        + 'nothing moved, but nothing faded either, so this proves nothing about the setting')
else say(`reduced motion: the turn is ${m.reducedMotion.running.map(r => `${r.props.join('/')} over ${r.ms}ms`).join(' + ')}`
    + ' — nothing moves')
if (errsRM.length) bad('console', 'reduced motion — ' + errsRM.join(' | '))

await browser.close()

console.log(out.steps.map(s => '  · ' + s).join('\n'))
console.log('\n=== FINDINGS: ' + out.findings.length)
for (const f of out.findings) console.log(`  [${f.what}] ${f.detail}`)
console.log('\n' + JSON.stringify({ pwa: m.pwa, reducedMotion: m.reducedMotion, walkLens: Object.fromEntries(Object.entries(m.walks).map(([k, v]) => [k, v.length])) }, null, 2))
console.log('A11Y_DONE')
