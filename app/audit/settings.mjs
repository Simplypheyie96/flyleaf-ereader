/* ─────────────────────────────────────────────────────────────
   Does every reading control actually do anything?

   The complaint this driver answers is "a lot of the reading setting is not
   even working", and it cannot be answered by reading readingCss.ts: that
   file composes a string, and whether the string reaches the book depends on
   foliate injecting it into a blob-URL iframe inside a CLOSED shadow root.
   So each control is set and then MEASURED where the reader sees it — the
   computed style of the section document, or the renderer's own attribute for
   the two controls that are host-side geometry rather than text style.

   Two mechanics, both learned the hard way in faces.mjs:

   1. The setting is written straight into IndexedDB, and Dexie's liveQuery
      does NOT observe a raw IDB write — it only sees mutations made through
      Dexie. A write alone leaves the running app on its previous value, and
      every subsequent reading looks like a dead control. So the loop reloads
      /read/:id after each write, and the app boots with the value in the row.
   2. The section document cannot be reached from inside the page. foliate's
      iframes live in a closed shadow root, so the host's own
      querySelectorAll('iframe') never sees them. Playwright's frame list
      does, so every measurement is taken from Node.

   A control counts as working when the measured value CHANGES with the
   setting and matches what the setting asked for. A control that is merely
   present is not checked as working.
   ───────────────────────────────────────────────────────────── */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = 'http://localhost:4173'
const findings = []
const bad = (tag, msg) => { findings.push(`[${tag}] ${msg}`); console.log(`    ✗ [${tag}] ${msg}`) }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', e => bad('crash', `page error: ${e.message}`))

await page.goto(`${BASE}/library`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)
const id = await page.evaluate(() => new Promise(res => {
    const r = indexedDB.open('flyleaf-ereader')
    r.onsuccess = () => {
        const q = r.result.transaction('books').objectStore('books').getAll()
        q.onsuccess = () => res(q.result[0]?.id)
    }
}))
if (!id) { bad('setup', 'no book in the library to read'); await browser.close(); process.exit(0) }
console.log('book:', id, '\n')

const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url() !== 'about:blank')

/** Merge one patch into the settings row, then reload so the app boots with it. */
async function apply(patch) {
    await page.evaluate(p => new Promise((res, rej) => {
        const r = indexedDB.open('flyleaf-ereader')
        r.onsuccess = () => {
            const tx = r.result.transaction('settings', 'readwrite')
            const st = tx.objectStore('settings')
            const g = st.get(1)
            g.onsuccess = () => { st.put({ ...(g.result ?? { id: 1 }), ...p, id: 1 }); }
            tx.oncomplete = () => res()
            tx.onerror = () => rej(tx.error)
        }
        r.onerror = () => rej(r.error)
    }), patch)

    await page.goto(`${BASE}/read/${id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
        () => !!document.querySelector('foliate-view') && !document.querySelector('.reader-opening'),
        null, { timeout: 25000 },
    ).catch(() => bad('open', `the book never opened for ${JSON.stringify(patch)}`))
    for (let i = 0; i < 60; i++) {
        const f = frame()
        if (f && await f.evaluate(() => !!document.body?.textContent?.trim()).catch(() => false)) break
        if (i === 59) bad('open', `no section document for ${JSON.stringify(patch)}`)
        await page.waitForTimeout(250)
    }
    await page.waitForTimeout(450)
}

/** Computed style of the section document, plus a paragraph in it. */
const read = () => {
    const f = frame()
    if (!f) return null
    return f.evaluate(() => {
        const h = getComputedStyle(document.documentElement)
        const p = document.querySelector('p') || document.body
        const cp = getComputedStyle(p)
        const px = v => Math.round(parseFloat(v) * 100) / 100
        return {
            size: px(h.fontSize),
            leading: h.lineHeight,
            weight: h.fontWeight,
            word: h.wordSpacing,
            track: h.letterSpacing,
            hyphens: h.hyphens || h.webkitHyphens,
            ground: h.backgroundColor,
            ink: h.color,
            touch: h.touchAction,
            family: cp.fontFamily,
            /* The one reading that separates publisherFont's two states on ANY
               book. Off, the reader's face is applied as `* { ... !important }`,
               which beats even an inline declaration; on, that rule is dropped
               and html's family sits in the BEFORE layer, which anything the
               book declares overrules. So a span carrying its own family answers
               the question directly — and it has to be injected, because the
               seed EPUB declares no family of its own, which is why the two
               states used to read identically and this control was reported as
               dead when it was only untestable. Inline is deliberately the
               STRONGEST form of the thing being overridden: survive that and a
               publisher stylesheet rule is a foregone conclusion. */
            declared: (() => {
                const probe = document.createElement('span')
                probe.style.fontFamily = 'Georgia'
                probe.textContent = 'x'
                document.body.appendChild(probe)
                const first = getComputedStyle(probe).fontFamily.split(',')[0].replace(/["']/g, '').trim()
                probe.remove()
                return first
            })(),
            align: cp.textAlign,
            indent: cp.textIndent,
            /* The SECOND paragraph, because the first one is exempt by design:
               the indent marks a break and there is no break above the opening
               paragraph, so measuring `p` reports 0px in both modes and the
               indent control rides entirely on the margin difference. Falls
               back to the first p on a one-paragraph section rather than
               reading null and looking like a dead control. */
            indent2: getComputedStyle(document.querySelectorAll('p')[1] || p).textIndent,
            mtop: cp.marginTop,
            pweight: cp.fontWeight,
            pleading: cp.lineHeight,
        }
    })
}

/** The two controls that are host geometry, read off the renderer element
    itself — a JS property, so the closed shadow root is not in the way. */
const geom = () => page.evaluate(() => {
    const r = document.querySelector('foliate-view')?.renderer
    if (!r) return null
    return {
        gap: r.getAttribute('gap'),
        maxInline: r.getAttribute('max-inline-size'),
        flow: r.getAttribute('flow'),
        columns: r.getAttribute('max-column-count'),
    }
})

/* Every control, the values to try, and the measurement that decides it.
   `want` returns the expected reading, or null to only require that the
   value differs from the other settings in the group. */
const CASES = [
    { name: 'size', field: 'size', values: [14, 20, 28], pick: r => r.size, want: v => v },
    { name: 'leading', field: 'leading', values: [1.2, 1.6, 2.2],
      /* line-height computes to px, so it is checked as a ratio of the size. */
      pick: r => Math.round((parseFloat(r.leading) / r.size) * 100) / 100, want: v => v },
    { name: 'weight', field: 'weight', values: ['light', 'regular', 'medium'],
      pick: r => r.weight, want: v => ({ light: '350', regular: '400', medium: '450' })[v] },
    { name: 'wordSpacing', field: 'wordSpacing', values: [0, 0.08, 0.16],
      /* set in em against a 20px root in these runs */
      pick: r => r.word, want: null },
    { name: 'letterSpacing', field: 'letterSpacing', values: [0, 0.03, 0.06],
      pick: r => r.track, want: null },
    { name: 'align', field: 'align', values: ['left', 'justify'],
      pick: r => r.align, want: v => v },
    { name: 'paragraph', field: 'paragraph', values: ['indent', 'spaced'],
      pick: r => `indent ${r.indent2} / margin ${r.mtop}`,
      /* Both halves asserted, not just "the readings differ": indent mode is
         a real indent and no leading, spaced mode is leading and no indent.
         24px is 1.2em of the 20px baseline set above. */
      want: v => (v === 'indent' ? 'indent 24px / margin 0px' : 'indent 0px / margin 14px') },
    { name: 'hyphenate', field: 'hyphenate', values: [false, true],
      pick: r => r.hyphens, want: v => (v ? 'auto' : 'manual') },
    { name: 'publisherFont', field: 'publisherFont', values: [false, true],
      /* Not r.family: on a book that declares no family of its own, both
         states inherit the reader's face and the readings are identical —
         a pass and a dead control look the same. r.declared asks the question
         the setting actually answers; see its comment in read(). */
      pick: r => r.declared, want: v => (v ? 'Georgia' : 'Literata') },
    { name: 'stock', field: 'stock', values: ['cream', 'tea', 'coal'],
      pick: r => `${r.ground} on ${r.ink}`, want: null },
    { name: 'flow', field: 'flow', values: ['paginated', 'scrolled'],
      pick: r => r.touch, want: v => (v === 'scrolled' ? 'pan-y pinch-zoom' : 'none') },
]

/* A known-good baseline, so one case cannot inherit another's leftovers. */
const BASE_SET = {
    face: 'literata', size: 20, leading: 1.6, weight: 'regular',
    wordSpacing: 0, letterSpacing: 0, publisherFont: false,
    paragraph: 'spaced', align: 'left', hyphenate: false,
    stock: 'cream', margin: 8, measure: 34, flow: 'paginated',
}

for (const c of CASES) {
    console.log(`  ${c.name}`)
    const seen = []
    for (const v of c.values) {
        await apply({ ...BASE_SET, [c.field]: v })
        const r = await read()
        if (!r) { bad(c.name, `could not read the section document at ${v}`); continue }
        const got = c.pick(r)
        seen.push({ v, got })
        const exp = c.want ? c.want(v) : null
        const ok = exp === null ? true : String(got) === String(exp)
        console.log(`     ${String(v).padEnd(10)} → ${String(got).padEnd(34)} ${exp === null ? '' : ok ? '✓' : `want ${exp}`}`)
        if (!ok) bad(c.name, `set to ${v} but the book reads ${got} (expected ${exp})`)
    }
    /* The control must MOVE. Three settings that all measure the same mean a
       dead control even when each individual reading looks plausible. */
    const distinct = new Set(seen.map(s => String(s.got)))
    if (seen.length > 1 && distinct.size === 1)
        bad(c.name, `every value measures ${seen[0].got} — the control does nothing`)
    else if (seen.length > 2 && distinct.size < seen.length)
        bad(c.name, `${seen.length} values collapse to ${distinct.size} readings: ${[...distinct].join(' | ')}`)
}

/* margin and measure are geometry, not text style: they reach the renderer as
   attributes and show up as the page's own inset and column cap. */
console.log('\n  margin (gap %)')
{
    const seen = []
    for (const v of [4, 8, 12]) {
        await apply({ ...BASE_SET, margin: v })
        const g = await geom()
        seen.push(g?.gap)
        console.log(`     ${String(v).padEnd(10)} → gap ${g?.gap}`)
        if (g?.gap !== `${v}%`) bad('margin', `set to ${v} but the renderer's gap is ${g?.gap}`)
    }
    if (new Set(seen).size === 1) bad('margin', 'every value leaves the same gap — the control does nothing')
}
console.log('\n  measure (max-inline-size)')
{
    const seen = []
    for (const v of [30, 34, 40]) {
        await apply({ ...BASE_SET, measure: v })
        const g = await geom()
        seen.push(g?.maxInline)
        /* max-inline-size is measure × size, and size is 20 in the baseline. */
        const want = `${v * 20}px`
        console.log(`     ${String(v).padEnd(10)} → ${g?.maxInline}   ${g?.maxInline === want ? '✓' : `want ${want}`}`)
        if (g?.maxInline !== want) bad('measure', `set to ${v}em at 20px but max-inline-size is ${g?.maxInline} (expected ${want})`)
    }
    if (new Set(seen).size === 1) bad('measure', 'every value leaves the same cap — the control does nothing')
}

/* Leaving the row on the defaults, so a driver run does not hand the next one
   a book set to Coal at 28px. */
await apply(BASE_SET)

console.log(`\n=== FINDINGS: ${findings.length} ===`)
findings.forEach(f => console.log(' ', f))
await browser.close()
