/* The phone test, as far as a driver can take it.

   CLAUDE.md sets the bar: "Test on a real phone, throttled, with a 4MB EPUB. A
   reader that is smooth on a laptop and janky on a phone has failed the brief."
   This file is NOT that test and never claims to be. It is the emulated half:
   an iPhone-shaped viewport with touch, a 4x CPU throttle, and the 4.2MB
   fixture. What it cannot do is put the app on the owner's actual device — no
   simulator is installed on this machine (`xcrun simctl` is absent; the
   toolchain is CommandLineTools, not full Xcode) and the simulator MCP cannot
   drive a physical phone at all. The owner's checklist for the real device is
   in SPEC.md § 11.1; the numbers below are Chromium-under-throttle numbers and
   are only ever evidence that the code is not obviously wrong.

   Why 4x. It is the DevTools "mid-tier mobile" preset, and it is the honest
   setting for this machine: an unthrottled headless Chromium on an M-series Mac
   flatters a paginator so much that the measurement means nothing.

   Four things get measured, one per acceptance criterion in CLAUDE.md's
   "What smooth as Apple Books means in code":

     1:1 tracking      the committed transform on renderer.contentLayer is read
                       every frame during a real touch drag and differenced
                       against the finger. `turn.ts:557` writes
                       translate3d(offset,0,0) and nothing else, so any drift
                       between finger and layer is a number, not an opinion.

     no main-thread    a longtask observer runs across the finger-down window.
     work in the drag  A task there is the failure mode that only shows on a
                       phone: fine at 0x throttle, a stutter at 4x.

     cold vs warm open the same 4.2MB EPUB, imported once and then reopened
                       after a full reload. Criterion 4 is that the reopen does
                       not re-parse the file, so warm must be well under cold.

     offline           the reader opens with the network cut. Criterion 5.

   Touch, not mouse. `turn.ts:342` branches on `pointerType === 'mouse'`, so a
   Playwright mouse drag exercises a different path from the one a reader uses.
   The drag here is CDP Input.dispatchTouchEvent, which Chromium turns into real
   touch-typed pointer events.

   Run: npx vite build && npx vite preview --port 4173 && node audit/phone.mjs
   ───────────────────────────────────────────────────────────── */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:4173'
const HERE = dirname(fileURLToPath(import.meta.url))
const BIG = join(HERE, 'fixtures', 'big.epub')
const OUT = process.env.FL_SHOTS || '/tmp/fl'
const THROTTLE = Number(process.env.CPU || 4)
mkdirSync(OUT, { recursive: true })

/* Budgets. These are EMULATION budgets, deliberately loose: they exist to
   catch a regression of the "it now re-parses on every open" kind, not to
   certify a device. A number close to a budget is a thing to look at, not a
   pass. */
const B = {
    coldMs: 9000,   // import + first paint of a 4.2MB EPUB at 4x throttle
    warmMs: 4000,   // a reopen, which must not re-parse
    warmRatio: 0.7, // and its OPEN must be well under importing the file from scratch
    dropShare: 0.15,// share of drag frames over 32ms (two frame budgets)
    longestMs: 120, // the single worst frame in the drag
    taskMs: 150,    // the worst longtask while the finger is down
    driftPx: 6,     // finger-to-layer disagreement AFTER the claim, peak, in CSS px.
                    // A pixel budget is right here and was not right when the
                    // finger came from the driver's clock: measured in-page,
                    // frame against frame, there is no round-trip jitter to
                    // divide out and 1:1 is a claim about pixels.
    claimPx: 24,    // how far the finger travels before the layer starts at all
    /* The launch screen, on its own clock. main.tsx holds it for HOLD=1200ms
       from navigation and fades it over 420ms, so ~1620ms is the design and
       2200 is that plus slack for a throttled start. It is budgeted APART
       from the open because they are two different costs with two different
       owners, and adding them together is how this driver spent a round
       reporting a deliberate launch screen as a re-parse of the file. */
    splashMs: 2200,
    /* And the escape hatch: the floor is aesthetic, not correctness, so one
       tap must take it down. Measured from the tap. */
    nudgeMs: 700,
}

const out = { env: {}, steps: [], findings: [], measures: {} }
const say = s => out.steps.push(s)
const bad = (what, detail) => out.findings.push({ what, detail })

if (!existsSync(BIG)) {
    console.log(JSON.stringify({ findings: [{ what: 'fixture', detail: 'audit/fixtures/big.epub is missing' }] }, null, 2))
    process.exit(1)
}

const browser = await chromium.launch()
/* An iPhone 12/13/14-class viewport. isMobile + hasTouch are what make the
   pointer events arrive as touch and the layout take the mobile branch; the
   deviceScaleFactor is what makes the raster work realistic. */
const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
const page = await ctx.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
out.env = { viewport: '390x844@3x', touch: true, cpuThrottle: THROTTLE + 'x', fixture: 'big.epub (4.2MB)' }
say(`390x844@3x, touch, CPU throttled ${THROTTLE}x`)

const openedOk = () => page.waitForFunction(() => {
    const v = document.querySelector('foliate-view')
    return !!v && !document.querySelector('.reader-opening')
}, null, { timeout: 60000 }).then(() => true).catch(() => false)

/* ── 1. cold: import the 4.2MB file and read it ──────────────────────────
   Timed from the moment the file is handed over, because that is the moment
   the reader would call "opening it" — the parse, the metadata, the cover,
   the write to IndexedDB and the first laid-out page are all inside it. */
await page.goto(BASE + '/open', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

const t0 = Date.now()
await page.locator('input[type=file]').setInputFiles(BIG)
const reached = await page.waitForURL(/\/book\//, { timeout: 90000 }).then(() => true).catch(() => false)
const importMs = Date.now() - t0
if (!reached) bad('cold', 'the 4.2MB EPUB never reached a book page')

const bookUrl = page.url()
let coldMs = null
let coldOpenMs = null
let preOffline = null
if (reached) {
    /* The click is stamped separately from the import. Two clocks, because
       there are two costs and only one of them is the parse: `importMs` is the
       file becoming a book, `coldOpenMs` is that book becoming a page. Warm
       can only be compared against the second if the second exists on its
       own. */
    const tc = Date.now()
    await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click()
    const ok = await openedOk()
    coldOpenMs = Date.now() - tc
    coldMs = Date.now() - t0
    if (!ok) bad('cold', 'the reader never finished opening the 4.2MB EPUB')
    say(`cold: import ${importMs}ms, open ${coldOpenMs}ms, first page at ${coldMs}ms`)
    if (coldMs > B.coldMs) bad('cold', `${coldMs}ms to a first page, over the ${B.coldMs}ms emulation budget`)
}
out.measures.cold = { importMs, openMs: coldOpenMs, toFirstPageMs: coldMs, budgetMs: B.coldMs }

/* ── 2. the drag, frame by frame ─────────────────────────────────────────
   The recorder is installed before the finger goes down and torn down after
   it lifts, so every number below belongs to the gesture and not to the
   commit animation that follows it. */
/* Where in the section the drag starts decides what it is allowed to measure.
   `turn.ts` damps the drag to SEAM_RESIST on the first and last page of a
   section and commits with a fade instead of a slide, so a drift assertion
   there would fail on behaviour that is correct by design. The seam state is
   read before every drag and the assertion is skipped — and SAID to be
   skipped — rather than quietly loosened. */
const where = () => page.evaluate(() => {
    const r = document.querySelector('foliate-view')?.renderer
    if (!r) return null
    return { page: r.page, pages: r.pages, seamFwd: r.page >= r.pages - 2, seamBack: r.page <= 1 }
})

const drag = async (label, from, to, steps = 24, stepMs = 12) => {
    const at0 = await where()
    await page.evaluate(() => {
        const w = window
        w.__rec = { frames: [], samples: [], tasks: [] }
        w.__on = true
        w.__ptr = null
        /* The finger is read from the pointer events the PAGE receives, not
           from the driver's dispatch clock, and that change is what turned a
           reported tracking failure back into a measurement. The first version
           stamped every touch dispatch with a `performance.now()` fetched over
           CDP, so each stamp carried a process round-trip of jitter; at
           0.5px/ms that noise alone is worth about 8px of apparent drift,
           which was essentially the whole of the "not 1:1" finding. An in-page
           listener has no cross-process clock in it and sees exactly what
           turn.ts sees.

           `screenX` is what is compared, and measuring against clientX
           instead is a mistake this driver made and had to be shown out of.
           These events are delivered to the SECTION document, and that
           document is a paginated container many pages wide that is scrolled
           horizontally to show one of them. Measured: across a 224px drag
           inside it, screenX reported 320→96 exactly as dispatched while
           clientX sat frozen at 1711.59 for every single move. clientX in
           there is the finger's position relative to a viewport that the
           pagination is moving underneath it — which is why turn.ts derives
           travel from screenX and says so at its own line 155, and why a
           driver that "corrected" it to clientX measured a 220px drift on a
           220px drag and called the reader broken. clientX is still recorded,
           as the evidence for why it is not the one being used.

           Bound on the host document AND on the section document, capture
           phase and passive, for the same reason turn.ts binds in both places:
           a pointer event inside the section iframe does not cross the
           boundary, and the iframe sits behind a closed shadow root, so it is
           reached through the renderer's own getContents() rather than by
           querying the DOM for it. */
        const note = e => { if (e.isPrimary !== false) w.__ptr = { t: +e.timeStamp.toFixed(1), cx: e.clientX, sx: e.screenX } }
        w.__scale = document.defaultView?.visualViewport?.scale || 1
        const bind = d => {
            if (!d || d.__flProbe) return
            d.__flProbe = true
            d.addEventListener('pointerdown', note, { capture: true, passive: true })
            d.addEventListener('pointermove', note, { capture: true, passive: true })
        }
        bind(document)
        try {
            for (const c of document.querySelector('foliate-view')?.renderer?.getContents?.() ?? []) bind(c.doc)
        } catch { /* no section document: reported as no samples, not as a pass */ }
        const layer = () => document.querySelector('foliate-view')?.renderer?.contentLayer ?? null
        let last = performance.now()
        const tick = t => {
            if (!w.__on) return
            w.__rec.frames.push(+(t - last).toFixed(2))
            last = t
            const l = layer()
            const m = l && /translate3d\((-?[\d.]+)px/.exec(l.style.transform || '')
            w.__rec.samples.push({ t: +t.toFixed(1), x: m ? +m[1] : null, p: w.__ptr })
            requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        try {
            w.__po = new PerformanceObserver(list => {
                for (const e of list.getEntries()) w.__rec.tasks.push({ start: +e.startTime.toFixed(1), ms: +e.duration.toFixed(1) })
            })
            w.__po.observe({ entryTypes: ['longtask'] })
        } catch { /* no longtask support: reported as null, not as a pass */ }
    })

    const y = 500
    const finger = []
    const stamp = async x => finger.push({ x, t: await page.evaluate(() => +performance.now().toFixed(1)) })

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] })
    await stamp(from)
    for (let i = 1; i <= steps; i++) {
        const x = Math.round(from + (to - from) * (i / steps))
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
        await stamp(x)
        await page.waitForTimeout(stepMs)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

    const { rec, scale } = await page.evaluate(() => {
        window.__on = false
        try { window.__po?.disconnect() } catch { }
        return { rec: window.__rec, scale: window.__scale || 1 }
    })
    await page.waitForTimeout(900)

    /* Frames. The first rAF delta is discarded: it measures the gap between
       installing the recorder and the next frame, not a frame. */
    const f = rec.frames.slice(1)
    const over = f.filter(ms => ms > 32).length
    const longest = f.length ? Math.max(...f) : null
    const dropShare = f.length ? +(over / f.length).toFixed(3) : null

    /* 1:1 tracking. For each sampled frame, the finger position at that
       instant is interpolated from the dispatch stamps, and compared with the
       translate the layer actually carried. A sample before the first move or
       after the gesture is not tracking and is skipped. */
    /* Every frame that carried both a translate and a pointer reading is one
       observation of the same instant, taken inside the page: no
       interpolation, no cross-process clock, no dispatch stamps. The first
       sample after the layer starts moving sets the origin, so the claim
       threshold — turn.ts holds the gesture in `watching` until CLAIM_PX or
       CLAIM_SPEED, which is the hysteresis that stops a tap nudging the page —
       is reported as claimPx on its own budget instead of being counted as
       drift for the whole gesture. What is asserted past the origin is the
       only thing 1:1 can mean: the layer moves the CSS pixels the finger
       moved. */
    const pairs = rec.samples.filter(s => s.x !== null && s.p && s.p.sx !== undefined)
    const o = pairs.length ? pairs[0] : null
    const drifts = o ? pairs.map(s => Math.abs((s.p.sx - o.p.sx) / scale - (s.x - o.x))) : []
    const peakDrift = drifts.length ? +Math.max(...drifts).toFixed(1) : null
    const claimPx = o ? +Math.abs(o.p.sx - from).toFixed(1) : null

    /* Both travels over the same span, reported and not asserted. screenX is
       what the drift is measured against; clientX is here because a frozen
       clientX is the signature of the paginated-container effect described
       above, and if it ever starts moving in step with screenX, the note in
       this driver about why screenX is used needs rechecking. */
    const last = pairs.length > 1 ? pairs[pairs.length - 1] : null
    const spanCx = last ? +(last.p.cx - o.p.cx).toFixed(1) : null
    const spanSx = last ? +((last.p.sx - o.p.sx) / scale).toFixed(1) : null
    const speedPxMs = last && last.p.t > o.p.t ? Math.abs(spanSx) / (last.p.t - o.p.t) : null
    const driftMs = peakDrift !== null && speedPxMs ? +(peakDrift / speedPxMs).toFixed(1) : null
    const worstTask = rec.tasks.length ? Math.max(...rec.tasks.map(t => t.ms)) : null

    /* Forward drags are damped on the forward seam, backward drags on the
       backward one — not both on either. */
    const damped = to < from ? !!at0?.seamFwd : !!at0?.seamBack
    const row = {
        frames: f.length, over32: over, dropShare, longestMs: longest,
        trackedSamples: drifts.length, peakDriftPx: peakDrift, driftMs,
        speedPxMs: speedPxMs ? +speedPxMs.toFixed(3) : null, claimPx,
        clientTravelPx: spanCx, screenTravelPx: spanSx,
        longtasks: rec.tasks.length, worstTaskMs: worstTask,
        startedAt: at0, damped,
    }
    out.measures[label] = row

    if (dropShare !== null && dropShare > B.dropShare) bad(label, `${(dropShare * 100).toFixed(0)}% of drag frames over 32ms, over the ${B.dropShare * 100}% budget`)
    if (longest !== null && longest > B.longestMs) bad(label, `worst drag frame ${longest}ms, over the ${B.longestMs}ms budget`)
    if (worstTask !== null && worstTask > B.taskMs) bad(label, `a ${worstTask}ms longtask ran while the finger was down`)
    if (damped) say(`${label}: drift not asserted — the drag started on a damped seam page (${at0.page + 1} of ${at0.pages})`)
    else if (peakDrift !== null && peakDrift > B.driftPx) bad(label, `the layer trailed the finger by ${peakDrift}px after the claim (${driftMs}ms at ${speedPxMs ? speedPxMs.toFixed(2) : '?'}px/ms) — tracking is not 1:1`)
    if (claimPx !== null && claimPx > B.claimPx) bad(label, `the finger travelled ${claimPx}px before the layer moved at all — the claim threshold is too far to feel direct`)
    if (!drifts.length) bad(label, 'no frame carried both a translate and a pointer reading — the drag never moved the layer, or the probe never saw the finger')
    if (spanSx !== null && Math.abs(spanSx) < Math.abs(to - from) * 0.8) bad(label, `the finger was dispatched ${Math.abs(to - from)}px but the page only saw ${Math.abs(spanSx)}px of it — the gesture is not reaching the reader`)
    say(`${label}: ${f.length} frames, ${over} over 32ms, worst ${longest}ms, claim at ${claimPx}px, peak drift ${peakDrift}px over ${drifts.length} paired frames (${driftMs}ms at ${speedPxMs ? speedPxMs.toFixed(2) : '?'}px/ms), ${rec.tasks.length} longtasks`)
}

if (reached) {
    /* Four pages in first, so the measured drags start mid-section rather than
       on the seam page the reader always opens on. */
    await page.evaluate(async () => {
        const r = document.querySelector('foliate-view')?.renderer
        for (let i = 0; i < 4 && r; i++) await r.next()
    })
    await page.waitForTimeout(700)
    await drag('dragFwd', 320, 90)
    await drag('dragBack', 90, 320)
    /* Half the dispatch speed, same distance. Its job is the control: it holds
       driftMs while dropping driftPx if the lag is sampling latency, and holds
       driftPx if it is the layer actually trailing. */
    await drag('dragSlow', 320, 90, 24, 26)
}

/* ── 3. warm: the same book, after a full reload ─────────────────────────
   Criterion 4 says the reopen must not wait on a parse of the whole file. The
   blob, manifest and locator are already in IndexedDB by now, so this is the
   path a reader actually uses every day. */
if (reached) {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    /* Three clocks, and the reason is that the first version of this driver
       had one and drew a false conclusion from it. It timed warm from the
       `goto` and cold from the file picker on a page that was already loaded,
       so warm carried an entire app boot — shell, React, Dexie open, service
       worker — that cold never paid for, and then reported the difference as
       "the file is being re-parsed". Boot is a PWA-shell cost and is reported
       on its own, uncompared. What criterion 4 is actually about is the OPEN:
       a reopen must not cost more than getting there from the file did the
       first time, because everything it needs is already in IndexedDB. */
    const t1 = Date.now()
    await page.goto(bookUrl, { waitUntil: 'domcontentloaded' })
    const btn = page.getByRole('button', { name: /Start reading|Continue|Read again/ })
    const there = await btn.waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
    const bootMs = Date.now() - t1
    if (!there) bad('warm', 'no read button on the reopened book')

    /* FOURTH clock, and the one the earlier rounds were unknowingly charging
       to the book. #splash is fixed, inset 0, z-index 9999 and hit-testable
       for the whole of main.tsx's HOLD, so every actionability check on the
       button behind it waits the floor out before a single event is
       dispatched. Measured before this was split out: 1.35s of a 1.5s "warm
       open" was the curtain, and the 160ms behind it was the book. Waiting
       for it explicitly, on its own budget, is what makes the open number
       mean the open. */
    const splashGone = (ms = 10000) => page.waitForFunction(() => {
        const el = document.getElementById('splash')
        return !el || el.classList.contains('is-out')
    }, null, { timeout: ms }).then(() => true).catch(() => false)
    const cleared = await splashGone()
    const splashMs = Date.now() - t1
    if (!cleared) bad('warm', 'the launch screen never came down — a full-screen overlay at z-index 9999 with pointer-events on is the whole interface, unclickable')
    else if (splashMs > B.splashMs) bad('warm', `the launch screen held the interface for ${splashMs}ms, over the ${B.splashMs}ms budget — nothing behind it can be tapped while it is up`)

    const tw = Date.now()
    await btn.click({ timeout: 30000 }).catch(() => { })
    const ok = await openedOk()
    const warmOpenMs = Date.now() - tw
    const warmMs = Date.now() - t1
    const coldPath = importMs !== null && coldOpenMs !== null ? importMs + coldOpenMs : null
    out.measures.warm = {
        bootMs, splashMs, openMs: warmOpenMs, toFirstPageMs: warmMs, budgetMs: B.warmMs,
        coldFilePathMs: coldPath, openRatio: coldPath ? +(warmOpenMs / coldPath).toFixed(2) : null,
    }
    if (!ok) bad('warm', 'the reopened book never finished opening')
    if (warmMs > B.warmMs) bad('warm', `${warmMs}ms to reopen, over the ${B.warmMs}ms budget`)
    if (coldPath && warmOpenMs > coldPath * B.warmRatio) bad('warm', `a reopen opens in ${warmOpenMs}ms against ${coldPath}ms to import and open the file — the reopen is not meaningfully cheaper, so the file is being re-parsed`)
    say(`warm: boot ${bootMs}ms, launch screen ${splashMs}ms, open ${warmOpenMs}ms, first page at ${warmMs}ms (open is ${coldPath ? (warmOpenMs / coldPath * 100).toFixed(0) + '% of the file path' : 'uncompared'})`)
    await page.screenshot({ path: join(OUT, 'phone-warm.png') })

    /* And the escape hatch, which is the half of this that is about feel
       rather than about milliseconds. The floor is deliberate and is not
       being argued with here; what is asserted is that a reader who taps
       during it is answered rather than ignored. Dispatched raw, because
       Playwright's own click would wait the curtain out and never send the
       event that takes it down. */
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    await page.goto(bookUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!document.getElementById('splash'), null, { timeout: 10000 }).catch(() => { })
    const tn = Date.now()
    await page.mouse.move(195, 500)
    await page.mouse.down()
    await page.mouse.up()
    const nudged = await splashGone(5000)
    const nudgeMs = Date.now() - tn
    out.measures.nudge = { ms: nudgeMs, budgetMs: B.nudgeMs, cleared: nudged, unnudgedMs: splashMs }
    if (!nudged) bad('warm', 'a tap during the launch screen did not take it down — the tap is swallowed and the reader has to wait the floor out')
    else if (nudgeMs > B.nudgeMs) bad('warm', `a tap during the launch screen took ${nudgeMs}ms to clear it, over the ${B.nudgeMs}ms budget`)
    else say(`nudge: a tap cleared the launch screen in ${nudgeMs}ms, against ${splashMs}ms when nobody touches it`)
}

/* ── 4. offline ──────────────────────────────────────────────────────────
   Not "does the service worker exist" — does the reader open a book with the
   network cut. Anything that blocks on a fetch shows up here as a timeout. */
if (reached) {
    preOffline = errors.length
    await ctx.setOffline(true)
    const t2 = Date.now()
    await page.goto(bookUrl, { waitUntil: 'domcontentloaded' }).catch(() => bad('offline', 'the book page would not even load offline'))
    await page.getByRole('button', { name: /Start reading|Continue|Read again/ }).click({ timeout: 30000 }).catch(() => bad('offline', 'no read button offline'))
    const ok = await openedOk()
    const offMs = Date.now() - t2
    out.measures.offline = { toFirstPageMs: offMs, opened: ok }
    if (!ok) bad('offline', 'the reader did not open with the network cut')
    else say(`offline: opened in ${offMs}ms`)
    await page.screenshot({ path: join(OUT, 'phone-offline.png') })
    await ctx.setOffline(false)
}

/* Console errors are a finding here and not a footnote: a throttled phone is
   where a race that never loses on a laptop starts losing. */
const real = errors.filter((e, i) => {
    if (/favicon|gsi\/client|accounts\.google/.test(e)) return false
    /* The offline step severs the network on purpose, so the failed fetches it
       produces are the driver's own doing and reporting them as app faults is
       reporting the test. Excluded only from the cut onward, and only when they
       ARE severance errors — anything else thrown after the cut is still real,
       and whether the book opened regardless has its own assertion above. */
    if (preOffline !== null && i >= preOffline && /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_)/.test(e)) return false
    return true
})
if (real.length) bad('console', real.slice(0, 4).join(' | '))

await browser.close()
out.errors = real
console.log(JSON.stringify(out, null, 2))
console.log('=== FINDINGS: ' + out.findings.length)
