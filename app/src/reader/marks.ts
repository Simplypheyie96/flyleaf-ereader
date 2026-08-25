/* ─────────────────────────────────────────────────────────────
   Marks: highlights, notes, bookmarks — and how they are painted.

   The engine draws an annotation by handing the app a `draw(func, opts)`
   callback (view.js:398) and letting it choose the function. That callback is
   the whole extension point, so everything about how a mark LOOKS lives in
   this file, and the reading page only decides when to call it.

   The one thing worth reading before changing anything here:

     foliate's Overlayer is an SVG that sits ABOVE the text — absolute, inside
     the paginator's shadow root, appended after the section iframe
     (overlayer.js:8, paginator.js:420). So a fill is never literally behind
     the words, and DESIGN.md's "drawn behind the words, the letters keep their
     own colour" has to be produced by a blend mode instead:

       light stocks   multiply. Ink × pastel is still ink; page × pastel is the
                      pastel. Identical in effect to a marker under the text.
       dark stocks    multiply would turn a dark page to mud, so the treatment
                      is DESIGN.md's own: a low-alpha NORMAL wash plus a 2px bar
                      in the page's left margin, text left at the stock's ink.

     Which of the two applies is not decided here either — index.css sets
     `--hl-blend` and the per-stock `--hl-fill-*` values, and this file reads
     them off the mounted reader root the way reader/palette.ts reads the stock.
     Both alphas and the blend mode are measured by audit/tints.mjs, which
     checks two bars on every one of the twenty-eight fills: 4.5:1 for the ink
     read through the mark, and 1.7:1 for the mark against the bare page. The
     second bar is the one the first shipped set had no floor on at all, and
     the reason the tints here are Press's HUES rather than Press's values.
   ───────────────────────────────────────────────────────────── */

import { bury, db } from '../db'
import type { Annotation, Bookmark, HighlightColor } from '../types'

/* ── the five tints ───────────────────────────────────────────────────────
   Order is the order they appear in the selection menu, and it is the order
   DESIGN.md lists them in. `underline` is last because it is the odd one out:
   a 2px terracotta rule, never a fill. */
export const TINTS: { id: HighlightColor; label: string }[] = [
    { id: 'mustard', label: 'Mustard' },
    { id: 'pink', label: 'Pink' },
    { id: 'blue', label: 'Blue' },
    { id: 'butter', label: 'Butter' },
    { id: 'underline', label: 'Underline' },
]

export interface MarkPaint {
    /** The solid tint, for the 10px dots in the marks list and the menu chips.
        Never redefined per stock — a dot sits on chrome, not on the page. */
    solid: Record<HighlightColor, string>
    /** What the overlay actually paints: the solid hex on a light stock, a
        measured rgba wash on a dark one. */
    fill: Record<HighlightColor, string>
    /** 'multiply' on a light stock, 'normal' on a dark one. */
    blend: 'multiply' | 'normal'
    /** true on a dark stock: the wash is joined by a bar in the margin. */
    bar: boolean
}

const FALLBACK_SOLID: Record<HighlightColor, string> = {
    mustard: '#DCA94C', pink: '#F0B3BE', blue: '#AFC9E3',
    butter: '#D6C19F', underline: '#1C5480',
}

/** Read the tints off the mounted reader root. index.css stays the single
    table; a value tuned there needs nothing here. One layout read per stock
    change, never inside a turn. */
export function readPaint(el: Element | null): MarkPaint {
    if (!el) return { solid: FALLBACK_SOLID, fill: FALLBACK_SOLID, blend: 'multiply', bar: false }
    const cs = getComputedStyle(el)
    const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
    const solid = {} as Record<HighlightColor, string>
    const fill = {} as Record<HighlightColor, string>
    for (const { id } of TINTS) {
        solid[id] = read(`--hl-${id}`, FALLBACK_SOLID[id])
        fill[id] = read(`--hl-fill-${id}`, solid[id])
    }
    const blend = read('--hl-blend', 'multiply') === 'normal' ? 'normal' : 'multiply'
    return { solid, fill, blend, bar: read('--hl-bar', 'off') === 'on' }
}

/* ── drawing ──────────────────────────────────────────────────────────────
   One draw function for the four fills and one for the underline, both in the
   shape foliate wants: (rects, options) → Element. The options object is kept
   by the Overlayer and handed back on every redraw (overlayer.js:31–39), which
   is what makes the geometry getter below work: a resize re-derives the rects
   AND re-reads the page size, so the margin bar cannot go stale. */

const SVG = 'http://www.w3.org/2000/svg'
const svg = (tag: string) => document.createElementNS(SVG, tag)

export interface DrawOptions extends Record<string, unknown> {
    color: string
    blend: 'multiply' | 'normal'
    /** Draw the margin bar too — dark stocks only. */
    bar: string | null
    /** Fresh page geometry at draw time, in the overlay's own coordinates.
        A getter rather than two numbers because redraw() reuses this object. */
    geom: () => { pageSize: number; gutter: number }
    /** Set once, by the code that just applied the mark. The 140ms wipe in
        SPEC.md § 6.1 is "on apply, never on render", and this is what tells
        the two apart — the flag is cleared here, so the redraw after a resize
        repaints the mark without re-animating it. */
    wipe?: boolean
    /** How tall the rule is, for the underline draw. 2 for a reader's own
        underline; 4 for the one search hit they asked for, which has to be
        told apart at reading distance from the 2px rules under every other hit
        on the page -- twice the weight, not a shade more of it. */
    thickness?: number
}

/** The four fills. */
export function fillDraw(rects: DOMRect[], options: DrawOptions): Element {
    const g = svg('g')
    g.setAttribute('fill', options.color)
    /* Overlayer.highlight hardcodes `opacity: var(--overlayer-highlight-opacity,
       .3)`, which would put a second, unmeasured alpha on top of the measured
       one. This draws its own group so the only alpha in play is the one
       audit/tints.mjs signed off. */
    ;(g as SVGElement).style.mixBlendMode = options.blend
    const boxes = Array.from(rects)
    for (const r of boxes) {
        const el = svg('rect')
        el.setAttribute('x', String(r.left))
        el.setAttribute('y', String(r.top))
        el.setAttribute('width', String(r.width))
        el.setAttribute('height', String(r.height))
        g.append(el)
    }
    if (options.bar) appendBars(g, boxes, options)
    if (options.wipe) { options.wipe = false; wipe(g, boxes.length) }
    return g
}

/** Terracotta: a 2px rule under the words. `--accent` is card-internal in
    Press, and this is the one place a reading page may carry it — because a
    rule under a line is a printed mark and a wash of the brand colour across a
    paragraph is not. DESIGN.md → Highlighter tints. */
export function underlineDraw(rects: DOMRect[], options: DrawOptions): Element {
    const g = svg('g')
    g.setAttribute('fill', options.color)
    const t = options.thickness ?? 2
    const boxes = Array.from(rects)
    for (const r of boxes) {
        const el = svg('rect')
        el.setAttribute('x', String(r.left))
        el.setAttribute('y', String(r.bottom - t))
        el.setAttribute('width', String(r.width))
        el.setAttribute('height', String(t))
        g.append(el)
    }
    if (options.wipe) { options.wipe = false; wipe(g, boxes.length) }
    return g
}

/** The dark-stock companion: one 2px bar per page column the mark touches,
    in that column's left margin, spanning the marked lines. Grouped by column
    because a mark that crosses a page break is two marks to the eye. */
function appendBars(g: Element, rects: DOMRect[], options: DrawOptions) {
    const { pageSize, gutter } = options.geom()
    if (!(pageSize > 0)) return
    const byColumn = new Map<number, { top: number; bottom: number }>()
    for (const r of rects) {
        const col = Math.floor((r.left + 1) / pageSize)
        const seen = byColumn.get(col)
        if (seen) {
            seen.top = Math.min(seen.top, r.top)
            seen.bottom = Math.max(seen.bottom, r.bottom)
        } else byColumn.set(col, { top: r.top, bottom: r.bottom })
    }
    /* 10px clear of the text edge, and never off the leading edge of the page
       on a phone where the whole gutter is 16px. */
    const inset = Math.max(2, gutter - 10)
    for (const [col, span] of byColumn) {
        const el = svg('rect')
        el.setAttribute('x', String(col * pageSize + inset))
        el.setAttribute('y', String(span.top))
        el.setAttribute('width', '2')
        el.setAttribute('height', String(Math.max(2, span.bottom - span.top)))
        el.setAttribute('fill', options.bar as string)
        g.append(el)
    }
}

/** SPEC.md § 6.1: a 140ms left-to-right wipe, once, on apply — a mark being
    made. Each line's fill grows from its own leading edge, and the lines
    OVERLAP: the whole mark still finishes at 140ms, but no single line is
    given less than SWEEP_MIN to travel.

    Dividing the 140 by the line count instead — which is what this did — gave
    a three-line mark 47ms a line and a four-line mark 35ms, measured. At two
    frames each, with the next line waiting for the one before to finish, a
    mark did not sweep on: it arrived in three or four pops. Overlapping keeps
    the sweep continuous at any line count. Pure `transform` on a handful of
    rects: no layout, no paint. */
const SWEEP = 140
const SWEEP_MIN = 90
function wipe(g: Element, lines: number) {
    if (typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const kids = Array.from(g.children) as SVGElement[]
    const n = Math.max(1, lines)
    const each = Math.max(SWEEP_MIN, SWEEP / n)
    const step = n > 1 ? Math.max(0, SWEEP - each) / (n - 1) : 0
    kids.forEach((el, i) => {
        /* The bars appended after the fills are not part of the sweep. */
        if (i >= lines) return
        el.style.transformBox = 'fill-box'
        el.style.transformOrigin = 'left center'
        el.animate?.(
            [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
            { duration: each, delay: i * step, easing: 'cubic-bezier(.2,0,0,1)', fill: 'backwards' },
        )
    })
}

/** The one hit the reader tapped, told apart from every other hit on the page.

    A search draws a 2px currentColor rule under every match it finds, so
    landing on a page with five of them answers "somewhere here" and not "this
    one" -- which is the whole reason a result was tapped. This draws the
    tapped one at 4px in `--hl-underline`, the accent DESIGN.md already permits
    on a reading page for exactly this shape of thing: a rule under a line is a
    printed mark. It is measured per polarity and defined for all seven stocks,
    so no new token and nothing new to measure.

    A rule rather than a band on purpose. A band has to know whether the paper
    is light or dark to stay off the words, and would need its own alpha per
    stock; a rule sits under them and cannot swallow them either way. */
export function drawForFound(paint: MarkPaint, geom: DrawOptions['geom']) {
    const opts: DrawOptions = {
        color: paint.solid.underline, blend: paint.blend, bar: null, geom, thickness: 4,
    }
    return { fn: underlineDraw, opts }
}

/** Which draw function a tint uses, and the options to draw it with. */
export function drawFor(color: HighlightColor, paint: MarkPaint, geom: DrawOptions['geom'], wipeIt: boolean) {
    const fn = color === 'underline' ? underlineDraw : fillDraw
    const opts: DrawOptions = {
        color: color === 'underline' ? paint.solid.underline : paint.fill[color],
        blend: paint.blend,
        bar: color === 'underline' ? null : (paint.bar ? paint.solid[color] : null),
        geom,
        wipe: wipeIt,
    }
    return { fn, opts }
}

/* ── the record ───────────────────────────────────────────────────────────
   Dexie already indexes `[bookId+cfi]`, which is the compound the marks list
   reads in reading order. Nothing here queries; the screens use liveQuery. */

export async function addHighlight(
    bookId: string, cfi: string, text: string, color: HighlightColor,
    chapter: string | null, note = '',
): Promise<Annotation> {
    const now = Date.now()
    const row: Annotation = {
        id: crypto.randomUUID(), bookId, cfi, text: flatten(text), note, color,
        chapter, createdAt: now, updatedAt: now,
    }
    await db.annotations.put(row)
    return row
}

export async function setTint(id: string, color: HighlightColor) {
    await db.annotations.update(id, { color, updatedAt: Date.now() })
}

export async function setNote(id: string, note: string) {
    await db.annotations.update(id, { note, updatedAt: Date.now() })
}

export async function removeAnnotation(id: string) {
    await db.transaction('rw', [db.annotations, db.graves], async () => {
        await db.annotations.delete(id)
        await bury('annotation', id)
    })
}

export async function addBookmark(
    bookId: string, cfi: string, excerpt: string, chapter: string | null,
): Promise<Bookmark> {
    const row: Bookmark = {
        id: crypto.randomUUID(), bookId, cfi,
        excerpt: flatten(excerpt).slice(0, 140), chapter, createdAt: Date.now(),
    }
    await db.bookmarks.put(row)
    return row
}

export async function removeBookmark(id: string) {
    await db.transaction('rw', [db.bookmarks, db.graves], async () => {
        await db.bookmarks.delete(id)
        await bury('bookmark', id)
    })
}

/** The stored `text` is what an export contains and what survives a re-import
    the CFI does not, so it is stored as one line of words — a highlight that
    crossed a paragraph break should not export as a blank line. */
export function flatten(s: string): string {
    return s.replace(/\s+/g, ' ').trim()
}

/* ── reading order ────────────────────────────────────────────────────────
   The marks list is grouped by chapter in reading order, which is CFI order
   and not creation order. Comparing two CFIs is not string comparison, so the
   comparator comes from the engine; it is imported dynamically because the
   marks list is not on the critical path of opening a book. */

export type Sortable = { cfi: string }

/** `pdf:<page>:<fraction>` — the fixed-page locator. A PDF has no CFI to
    anchor to, so a page number and how far down it stand in for one; see
    types.ts on `Locator.cfi`. Returns null for anything that is not one, which
    is how every caller tells the two kinds of book apart. */
/* A stored locator is `pdf:<page>:<fraction>`. A search hit is the same string
   with two more numbers on the end -- where across the page the words start
   and how wide they are -- because the panel's hit type is one string for both
   kinds of book and there is nowhere else to put them. Nothing writes the long
   form to Dexie: it exists for the length of one tap. The optional tail is why
   parsePdfLocator can be handed either and a bookmark still parses. */
const PDF_LOC = /^pdf:(\d+):([0-9]*\.?[0-9]+)(?::([0-9]*\.?[0-9]+):([0-9]*\.?[0-9]+))?$/

export function parsePdfLocator(cfi: string): { page: number; fraction: number } | null {
    const m = PDF_LOC.exec(cfi)
    if (!m) return null
    const page = Number(m[1]), fraction = Number(m[2])
    if (!Number.isFinite(page) || page < 1 || !Number.isFinite(fraction)) return null
    return { page, fraction }
}

/** The long form, for the one search hit the reader tapped. Null for a
    locator that carries no run -- a bookmark, or a hit from an older store. */
export function parsePdfFound(
    cfi: string,
): { page: number; fraction: number; x: number; w: number } | null {
    const m = PDF_LOC.exec(cfi)
    if (!m || m[3] === undefined) return null
    const where = parsePdfLocator(cfi)
    if (!where) return null
    const x = Number(m[3]), w = Number(m[4])
    if (!Number.isFinite(x) || !Number.isFinite(w) || w <= 0) return null
    return { ...where, x, w }
}

export async function sortByPosition<T extends Sortable>(rows: T[]): Promise<T[]> {
    /* A PDF's locators are not CFIs, and epubcfi's comparator would throw on
       every pair of them — caught below, which would silently leave the whole
       list in creation order. Two numbers sort as two numbers, and no book is
       ever a mix of the two kinds. */
    const pdf = rows.map(r => parsePdfLocator(r.cfi))
    if (rows.length && pdf.every(Boolean)) {
        return rows
            .map((row, i) => ({ row, at: pdf[i]! }))
            .sort((a, b) => a.at.page - b.at.page || a.at.fraction - b.at.fraction)
            .map(x => x.row)
    }
    const { compare } = await import('../vendor/foliate-js/epubcfi.js')
    return rows.slice().sort((a, b) => {
        try { return compare(a.cfi, b.cfi) } catch { return 0 }
    })
}

/** Is this CFI inside the page the reader is looking at? The relocate event
    carries a RANGE cfi for the visible page, so its two collapsed ends are the
    page's bounds — which is how the bookmark tick knows to show. */
export async function withinPage(cfi: string, pageCFI: string): Promise<boolean> {
    const { compare, collapse } = await import('../vendor/foliate-js/epubcfi.js')
    try {
        const point = collapse(cfi)
        return compare(point, collapse(pageCFI)) >= 0
            && compare(point, collapse(pageCFI, true)) <= 0
    } catch { return false }
}

export async function collapseCFI(cfi: string): Promise<string> {
    const { collapse } = await import('../vendor/foliate-js/epubcfi.js')
    try { return collapse(cfi) } catch { return cfi }
}

/** Runs of marks that share a chapter, in the order they are given — which
    is reading order, because the caller sorted them. A Map keyed by label
    would merge two runs of the same chapter title into one group, and two
    chapters CAN share a title ("Chapter I" in a two-volume edition). */
export function groupByChapter<T extends { chapter?: string | null }>(rows: T[]) {
    const groups: { chapter: string | null; items: T[] }[] = []
    for (const row of rows) {
        const label = row.chapter ?? null
        const last = groups[groups.length - 1]
        if (last && last.chapter === label) last.items.push(row)
        else groups.push({ chapter: label, items: [row] })
    }
    return groups
}

/* ── export ───────────────────────────────────────────────────────────────
   SPEC.md § 6.3: title and author as a header, then each mark as a blockquote
   with its chapter, the note beneath in italics, in reading order. No page
   numbers — this book does not have any. */

/* PDF is deliberately NOT in this union. The three text formats are strings —
   copyable, concatenable, cheap. A PDF is bytes, and the type system is the
   right place to keep that distinction rather than a runtime check inside
   exportMarks. `exportPdf` in ./pdfExport is the other half. */
export type TextExportFormat = 'markdown' | 'text' | 'json'
export type ExportFormat = TextExportFormat | 'pdf'

export interface ExportInput {
    title: string
    /** null where the book carries none — a missing author is a fact,
        not an empty string to print. */
    author: string | null
    /** already in reading order */
    highlights: Annotation[]
    bookmarks: Bookmark[]
}

export function exportMarks(input: ExportInput, format: TextExportFormat): string {
    if (format === 'json') return exportJSON(input)
    return format === 'text' ? exportText(input) : exportMarkdown(input)
}

function exportMarkdown({ title, author, highlights, bookmarks }: ExportInput): string {
    const out: string[] = [`# ${title}`]
    if (author) out.push(`*${author}*`)
    out.push('')
    for (const g of groupByChapter(highlights)) {
        /* No heading at all for a book with no contents list — an invented
           "Untitled" heading above every mark is worse than no heading. */
        if (g.chapter) out.push(`## ${g.chapter}`, '')
        for (const h of g.items) {
            out.push(`> ${h.text}`, '')
            if (h.note) out.push(`*${h.note}*`, '')
        }
    }
    if (bookmarks.length) {
        out.push('## Bookmarks', '')
        for (const b of bookmarks)
            out.push(`- ${b.excerpt || 'A place in the book'}${b.chapter ? ` — ${b.chapter}` : ''}`)
        out.push('')
    }
    return out.join('\n')
}

function exportText({ title, author, highlights, bookmarks }: ExportInput): string {
    const out: string[] = [title]
    if (author) out.push(author)
    out.push('')
    for (const g of groupByChapter(highlights)) {
        if (g.chapter) out.push(g.chapter.toUpperCase(), '')
        for (const h of g.items) {
            out.push(h.text, '')
            if (h.note) out.push(`  — ${h.note}`, '')
        }
    }
    if (bookmarks.length) {
        out.push('BOOKMARKS', '')
        for (const b of bookmarks)
            out.push(`${b.excerpt || 'A place in the book'}${b.chapter ? ` — ${b.chapter}` : ''}`)
        out.push('')
    }
    return out.join('\n')
}

/** The one format that is not for a person to read: every field, including the
    CFIs, so a reader who exports their marks can put them back. */
function exportJSON({ title, author, highlights, bookmarks }: ExportInput): string {
    return JSON.stringify({
        flyleaf: 'marks/1',
        book: { title, author },
        highlights: highlights.map(h => ({
            cfi: h.cfi, text: h.text, note: h.note, color: h.color,
            chapter: h.chapter, createdAt: h.createdAt,
        })),
        bookmarks: bookmarks.map(b => ({
            cfi: b.cfi, excerpt: b.excerpt, chapter: b.chapter, createdAt: b.createdAt,
        })),
    }, null, 2)
}

export const EXPORT_META: Record<ExportFormat, { label: string; ext: string; mime: string }> = {
    markdown: { label: 'Markdown', ext: 'md', mime: 'text/markdown' },
    text: { label: 'Plain text', ext: 'txt', mime: 'text/plain' },
    json: { label: 'JSON', ext: 'json', mime: 'application/json' },
    pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
}

/** A filename a reader can recognise a year later, with everything a file
    system objects to taken out. */
export function exportName(title: string, format: ExportFormat): string {
    const stem = flatten(title).replace(/[^\p{L}\p{N} -]/gu, '').slice(0, 60).trim() || 'Marks'
    return `${stem} — marks.${EXPORT_META[format].ext}`
}
