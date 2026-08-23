/* ─────────────────────────────────────────────────────────────
   The PDF engine. One thin layer over pdfjs-dist, and the only
   file in the app that imports it.

   Why it is not foliate's job: CLAUDE.md, and the reason is size and
   fidelity both. foliate's PDF adapter is a thin shim over a vendored
   13MB pdfjs and gives a PDF the reflowable paginator's model — pages
   of a chapter, a CFI, a text column. A PDF has none of those. It has
   a fixed page of a fixed size, and the honest surface for it is a
   continuous scroller with a real text layer, which is what
   PdfView.tsx builds on top of this.

   Two rules this file exists to hold:

     1. NOTHING here touches the DOM or React. It opens a document,
        reports its shape, and renders a page into a canvas somebody
        else owns. That is what makes it testable from node — and
        audit/pdf.mjs does exactly that.
     2. The worker is started ONCE per app, lazily. A reader who never
        opens a PDF never loads it, because this module is only ever
        reached through a dynamic import from the PDF route.
   ───────────────────────────────────────────────────────────── */

import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import {
    getDocument, GlobalWorkerOptions, TextLayer,
    type PDFDocumentProxy, type PDFPageProxy, type PageViewport,
} from 'pdfjs-dist'

/* Where the helper assets are served from. A small plugin in vite.config.ts
   copies pdfjs-dist's four asset directories here; Workbox runtime-caches the
   whole prefix CacheFirst rather than precaching it.

   The reason that split is honest rather than lazy: with `useSystemFonts` on —
   pdfjs's own default in a browser — a PDF whose fonts are the base-14 set
   gets a `local()` @font-face and fetches NOTHING from here, and a PDF with
   embedded fonts carries its own. These files are for the narrow cases: a
   non-embedded font the system does not have, a JBIG2 or JPEG-2000 image, an
   ICC profile, a predefined CJK CMap. Precaching 4MB of them on every install
   to cover a case most PDFs never hit is a worse trade than one fetch, once,
   the first time a PDF actually needs one. Measured in audit/pdf.mjs: opening
   a base-14 PDF makes zero requests to this prefix. */
const ASSETS = '/pdfjs/'

let started = false
function startWorker() {
    if (started) return
    started = true
    /* workerPort, not workerSrc: Vite's `?worker` import hands back a
       constructor for a worker it has already fingerprinted and emitted, so
       there is no URL to hand over and no second copy of a 1.2MB file. */
    GlobalWorkerOptions.workerPort = new PdfWorker()
}

/** A node of the PDF's own outline, flattened to what the contents list needs.
    `page` is 1-based and null when the destination cannot be resolved — a
    broken outline entry is shown greyed rather than dropped, because a reader
    looking for chapter 4 should see that the file says chapter 4 exists. */
export type PdfOutlineItem = {
    label: string
    page: number | null
    items: PdfOutlineItem[]
}

export type PdfInfo = {
    title: string | null
    author: string | null
    subject: string | null
    creator: string | null
    producer: string | null
    language: string | null
}

/** A page's size in PDF points, with the page's own /Rotate already applied —
    so a landscape scan of a portrait book reports the size it will be drawn
    at, not the size it was authored at. */
export type PdfPageSize = { w: number; h: number }

export type PdfDoc = {
    doc: PDFDocumentProxy
    pages: number
    /** index 0 is page 1 */
    sizes: PdfPageSize[]
    outline: PdfOutlineItem[]
    info: PdfInfo
    /** true when the file declares an encryption dict this build cannot open */
    close(): void
}

/** Thrown for a file the app refuses rather than fails on. The reader gets the
    `.message` verbatim, so it is written as a sentence to a person. */
export class PdfRefused extends Error {}

/** Open a PDF and report its shape. Everything the chrome needs to lay out the
    whole document — page count, every page's size, the outline, the metadata —
    is read here, once, so scrolling never awaits a measurement.

    Page sizes are the one thing this costs: `getPage` on every page of a
    900-page scan is 900 round-trips to the worker. It is still the right call,
    because the alternative is a scroller whose total height changes as you
    scroll it, which moves the page out from under the reader's thumb. The
    round-trips are issued in parallel and the pages are released immediately;
    measured on the 12-page fixture at 4ms, and a 900-page file is the case the
    virtualiser in PdfView is built for, not this. */
export async function openPdf(blob: Blob): Promise<PdfDoc> {
    startWorker()
    const data = new Uint8Array(await blob.arrayBuffer())
    const task = getDocument({
        data,
        cMapUrl: `${ASSETS}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${ASSETS}standard_fonts/`,
        wasmUrl: `${ASSETS}wasm/`,
        iccUrl: `${ASSETS}iccs/`,
        /* No embedded JavaScript and no XFA. A PDF that wants to run code is
           a PDF that wants to run code, and this is a reader. Scripting is off
           unless a viewer opts in — this app never does, and the sandbox's own
           wasm is not even copied into the build (see vite.config.ts). `enableXfa`
           is spelled out because its default is the one worth being explicit
           about: an XFA form is not a book. */
        enableXfa: false,
    })

    let doc: PDFDocumentProxy
    try {
        doc = await task.promise
    } catch (err) {
        /* DRM. CLAUDE.md: refused with a plain explanation, never a silent
           failure and never a broken render. pdfjs reports a password-
           protected file as a PasswordException with a `name`, which is the
           only reliable handle — the message is for developers. */
        const name = (err as { name?: string } | null)?.name
        if (name === 'PasswordException') {
            throw new PdfRefused(
                'This PDF is locked with a password. Flyleaf does not open protected files.')
        }
        if (name === 'InvalidPDFException') {
            throw new PdfRefused('This file is not a readable PDF.')
        }
        throw err
    }

    const pages = doc.numPages
    const sizes = await Promise.all(
        Array.from({ length: pages }, async (_, i) => {
            const page = await doc.getPage(i + 1)
            const { width, height } = page.getViewport({ scale: 1 })
            page.cleanup()
            return { w: width, h: height }
        }))

    const [info, outline] = await Promise.all([readInfo(doc), readOutline(doc)])

    return {
        doc, pages, sizes, outline, info,
        /* The loading task, not the document: PDFDocumentProxy has no
           `destroy` — tearing down the transport and its worker channel is the
           task's job, and calling it is what stops a closed book's render
           tasks from holding a 40MB buffer alive. */
        close() { void task.destroy() },
    }
}

async function readInfo(doc: PDFDocumentProxy): Promise<PdfInfo> {
    const str = (v: unknown) => {
        const s = typeof v === 'string' ? v.trim() : ''
        return s ? s : null
    }
    try {
        const { info } = await doc.getMetadata() as unknown as {
            info?: Record<string, unknown>
        }
        return {
            title: str(info?.Title),
            author: str(info?.Author),
            subject: str(info?.Subject),
            creator: str(info?.Creator),
            producer: str(info?.Producer),
            language: str(info?.Language),
        }
    } catch {
        /* A malformed Info dict is not a reason to refuse a file that renders
           perfectly well. The filename is the fallback, as it is at import. */
        return { title: null, author: null, subject: null, creator: null, producer: null, language: null }
    }
}

/* An outline entry's destination is one of three things, and only one of them
   is directly a page: a named destination (a string, which has to be looked
   up), an explicit array whose first element is a page reference, or nothing.
   Resolving them here rather than on click is deliberate — a contents list
   whose rows are enabled only after you tap them is a contents list that lies
   about what it can do. */
async function readOutline(doc: PDFDocumentProxy): Promise<PdfOutlineItem[]> {
    type Raw = {
        title: string
        dest: string | unknown[] | null
        items: Raw[]
    }
    let raw: Raw[] | null = null
    try {
        raw = (await doc.getOutline()) as Raw[] | null
    } catch {
        return []
    }
    if (!raw?.length) return []

    /* Two levels of memo, because a well-made PDF's outline points many
       entries at the same few pages and each miss is a worker round-trip. */
    const byName = new Map<string, number | null>()
    const byRef = new Map<string, number | null>()

    const pageOf = async (dest: Raw['dest']): Promise<number | null> => {
        try {
            let explicit: unknown[] | null = null
            if (typeof dest === 'string') {
                if (byName.has(dest)) return byName.get(dest) ?? null
                explicit = await doc.getDestination(dest)
                if (!explicit) { byName.set(dest, null); return null }
                const n = await pageFromExplicit(explicit)
                byName.set(dest, n)
                return n
            }
            if (Array.isArray(dest)) explicit = dest
            if (!explicit) return null
            return await pageFromExplicit(explicit)
        } catch {
            return null
        }
    }

    const pageFromExplicit = async (explicit: unknown[]): Promise<number | null> => {
        const ref = explicit[0]
        /* An explicit destination's first element is either a page reference
           object or, in a linearised file, a plain 0-based page number. */
        if (typeof ref === 'number') {
            return ref >= 0 && ref < doc.numPages ? ref + 1 : null
        }
        if (!ref || typeof ref !== 'object') return null
        const key = JSON.stringify(ref)
        if (byRef.has(key)) return byRef.get(key) ?? null
        try {
            const index = await doc.getPageIndex(ref as never)
            const n = index + 1
            byRef.set(key, n)
            return n
        } catch {
            byRef.set(key, null)
            return null
        }
    }

    const walk = async (nodes: Raw[], depth: number): Promise<PdfOutlineItem[]> => {
        /* Three levels is what a contents list can indent legibly at 360px,
            and it is the same cap the reflowable TOC uses. Deeper entries are
            not dropped — they are flattened onto the third level, so a
            five-level academic PDF still lists every section. */
        const out: PdfOutlineItem[] = []
        for (const node of nodes) {
            const label = (node.title ?? '').replace(/\s+/g, ' ').trim()
            const kids = Array.isArray(node.items) ? node.items : []
            const item: PdfOutlineItem = {
                label: label || 'Untitled',
                page: await pageOf(node.dest),
                items: depth < 2 ? await walk(kids, depth + 1) : [],
            }
            out.push(item)
            if (depth >= 2 && kids.length) out.push(...await walk(kids, depth))
        }
        return out
    }

    return walk(raw, 0)
}

/* ── rendering ─────────────────────────────────────────────────────────────
   Two calls, both of which the view makes and nothing else does. They are
   here rather than in the component because a render is cancellable and a
   component that owns cancellation tokens alongside its layout is a component
   nobody can read. */

/** The backing-store cap. A retina phone at dpr 3 rendering an A4 page at
    fit-width is a 2400×3400 canvas — 32MB of texture for one page, and a
    virtualiser holding three of them is 96MB on a device with a 384MB budget.
    2 is where the extra pixels stop being visible on any screen this app runs
    on, and it is what every native PDF reader settles on. */
/* ── page handles ─────────────────────────────────────────────────────────
   A page proxy is the handle everything else needs: render it, read its text,
   measure it. Two reasons it is cached here rather than fetched per mount:
   scrolling back one page must not pay a worker round-trip, and a page that is
   still being rendered when it scrolls away must be the SAME object the next
   mount gets, or the cancel below cancels a render nobody is watching.

   The cache is bounded and least-recently-used, because the alternative on a
   900-page scan is holding 900 pages' operator lists in memory. `cleanup()` on
   eviction is what actually frees them. */
export type PdfPageHandle = PDFPageProxy
export type PdfTextLayer = TextLayer
export type PdfViewport = PageViewport

const PAGE_CACHE = 24
const pageCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PDFPageProxy>>>()

export function getPage(doc: PDFDocumentProxy, num: number): Promise<PdfPageHandle> {
    let held = pageCache.get(doc)
    if (!held) pageCache.set(doc, held = new Map())
    const hit = held.get(num)
    if (hit) {
        /* Re-insert so the Map's own insertion order is the LRU order. */
        held.delete(num)
        held.set(num, hit)
        return hit
    }
    const p = doc.getPage(num)
    held.set(num, p)
    while (held.size > PAGE_CACHE) {
        const oldest = held.keys().next().value
        if (oldest === undefined) break
        const gone = held.get(oldest)
        held.delete(oldest)
        void gone?.then(pg => { pg.cleanup() }).catch(() => {})
    }
    return p
}

export const MAX_DPR = 2

export function backingScale(): number {
    return Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, MAX_DPR)
}

export type RenderHandle = { cancel(): void }

/** Draw one page into a canvas at a given CSS width, and return the handle so
    the caller can cancel it when the page scrolls away mid-render. The canvas
    is sized here — both its backing store and its CSS box — because the two
    have to agree to the pixel and splitting that across two files is how a
    PDF ends up half a pixel blurry on one device. */
export function renderPage(
    page: PDFPageProxy,
    canvas: HTMLCanvasElement,
    cssWidth: number,
): { done: Promise<void>; viewport: PageViewport } & RenderHandle {
    const base = page.getViewport({ scale: 1 })
    const scale = cssWidth / base.width
    const viewport = page.getViewport({ scale })
    const dpr = backingScale()

    canvas.width = Math.round(viewport.width * dpr)
    canvas.height = Math.round(viewport.height * dpr)
    canvas.style.width = `${Math.round(viewport.width)}px`
    canvas.style.height = `${Math.round(viewport.height)}px`

    const task = page.render({
        canvas,
        viewport,
        /* The device-pixel step. Handed to pdfjs as a transform rather than
           set on the context, because pdfjs resets the context itself. */
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
    })
    return {
        viewport,
        done: task.promise.catch((err: unknown) => {
            /* A cancelled render is the normal case, not an error: it means the
               reader scrolled faster than the page drew, which is the whole
               point of cancelling it. */
            if ((err as { name?: string } | null)?.name === 'RenderingCancelledException') return
            throw err
        }),
        cancel() { task.cancel() },
    }
}

/** The selectable text over a rendered page. This is the reason a PDF in this
    app can be searched, quoted and looked up at all, and the reason the view
    does not simply paint canvases: pdfjs positions one absolutely-placed span
    per text run, in the page's own coordinates, and the browser's own
    selection then works on real text.

    Returned so the caller can cancel it and, on a zoom, `update()` it — which
    re-lays the existing spans against a new viewport instead of rebuilding
    them, and is the difference between a pinch that ends smoothly and one that
    ends in a 40ms stall. */
export async function textLayerFor(
    page: PDFPageProxy,
    container: HTMLElement,
    viewport: PageViewport,
): Promise<TextLayer> {
    const layer = new TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container,
        viewport,
    })
    await layer.render()
    return layer
}

/** The scale pdfjs's own text-layer CSS reads. It positions every span as a
    percentage of the page and then scales the font by this, so the layer is
    correct at any size as long as this property agrees with the canvas. */
export function setLayerScale(el: HTMLElement, scale: number) {
    el.style.setProperty('--scale-factor', String(scale))
    el.style.setProperty('--total-scale-factor', String(scale))
}

/** The whole text of one page, for search and for the excerpt a bookmark
    keeps. Separate from the text layer because search reads pages the reader
    has never scrolled to, and building a DOM for them would be absurd. */
export async function pageText(page: PDFPageProxy): Promise<string> {
    const content = await page.getTextContent()
    let out = ''
    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== 'string') continue
        out += item.str
        if (item.hasEOL) out += '\n'
    }
    return out.replace(/[ \t]+/g, ' ')
}

/* ── search ───────────────────────────────────────────────────────────────
   A reflowable book is searched by the engine, which walks the spine and hands
   back CFIs. A PDF has no engine to ask, so the walk is here: one page at a
   time, on the text content the worker already knows how to produce.

   The one thing worth the extra code is the vertical position. A hit that only
   knows its page number sends the reader to the top of a sheet and leaves them
   to find the word themselves, which on an A4 page of ten-point type is most of
   the work. Every text item carries its own PDF-space origin, so the item the
   match starts in gives a real fraction down the page — the same `fraction`
   half of the `pdf:<page>:<fraction>` locator a bookmark stores. */

export type PdfHit = { fraction: number; pre: string; match: string; post: string }

/** How much of the line either side of a hit the list shows. Long enough to
    tell two uses of the same word apart, short enough that a row stays one
    line on a phone. */
const HIT_CONTEXT = 44

export async function searchPage(page: PDFPageProxy, re: RegExp): Promise<PdfHit[]> {
    const content = await page.getTextContent()
    /* One string, and a parallel list of where each item started in it, so a
       match index can be turned back into the item it fell in with a binary
       search rather than a scan per hit. */
    let text = ''
    const starts: number[] = []
    const ys: number[] = []
    for (const item of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
        if (typeof item.str !== 'string') continue
        starts.push(text.length)
        ys.push(item.transform?.[5] ?? 0)
        text += item.str
        if (item.hasEOL) text += '\n'
    }
    if (!text) return []

    const viewport = page.getViewport({ scale: 1 })
    const height = viewport.height || 1
    const hits: PdfHit[] = []
    /* A fresh regex per call would be the caller's job; resetting here means a
       /g regex handed in twice cannot skip the first half of the second page. */
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
        if (!m[0]) { re.lastIndex++; continue }
        let lo = 0, hi = starts.length - 1, at = 0
        while (lo <= hi) {
            const mid = (lo + hi) >> 1
            if (starts[mid] <= m.index) { at = mid; lo = mid + 1 } else hi = mid - 1
        }
        const vy = viewport.convertToViewportPoint(0, ys[at])[1] as number
        hits.push({
            fraction: Math.min(1, Math.max(0, vy / height)),
            pre: text.slice(Math.max(0, m.index - HIT_CONTEXT), m.index).replace(/\s+/g, ' '),
            match: m[0].replace(/\s+/g, ' '),
            post: text.slice(m.index + m[0].length, m.index + m[0].length + HIT_CONTEXT).replace(/\s+/g, ' '),
        })
        if (hits.length >= 200) break
    }
    return hits
}
