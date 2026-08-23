/* The PDF reading surface: a virtualised continuous scroller with a real text
   layer over every page.

   Why continuous rather than paginated. A PDF page is fixed — it cannot reflow,
   so there is no honest way to make it "a page turn" the way the reflowable
   reader does. Faking one means either scaling a fixed page to a phone screen
   until the type is 5pt, or cropping it. Continuous scroll with pinch zoom is
   what a fixed page actually wants, and it is what every PDF reader worth using
   does. SPEC.md § 11, P4.

   What is expensive here, and where it is spent:

   1. Layout is arithmetic, never measurement. Every page's size was read once
      at open, so `layoutFor` computes the whole strip — scale, offsets, total
      height — as a pure function. Nothing in this file reads a layout property
      of a page.
   2. A live pinch touches `transform` on ONE element (the strip) and nothing
      else. No canvas is resized, no page is re-rendered, no React state is set
      while two fingers are down. The commit happens on release.
   3. Only the pages near the viewport are mounted. The strip carries the full
      known height, so the scrollbar is honest from the first frame and the
      scroll position never moves out from under a thumb.
   4. The focal point of a pinch is preserved exactly, by anchoring to the page
      under the fingers rather than to a scroll ratio — so the word you pinched
      on is still under your fingers when you let go.

   Position is `{page, fraction}`: which page, and how far down it the top of
   the viewport sits. Stored as `pdf:<page>:<fraction>` in the same `locators`
   row a reflowable book uses. It is a content anchor, not a scroll offset: it
   survives a change of zoom, fit, rotation and screen. types.ts. */

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import {
    getPage, renderPage, setLayerScale, textLayerFor,
    type PdfDoc, type PdfPageHandle, type PdfPageSize, type PdfTextLayer,
} from './engine'

export type PdfLocation = { page: number; fraction: number }
export type PdfFit = 'width' | 'page'

export type PdfViewHandle = {
    /** Jump to a page (1-based) and optionally a fraction down it. */
    goTo(page: number, fraction?: number): void
    /** Where the top of the viewport is now. */
    location(): PdfLocation
    /** Multiply the zoom about the centre of the viewport. */
    zoomBy(k: number): void
    /** Back to the fit scale. */
    resetZoom(): void
}

export interface PdfViewProps {
    doc: PdfDoc
    fit: PdfFit
    /** Where to open. Applied once, after the first measure. */
    start: PdfLocation | null
    ref?: RefObject<PdfViewHandle | null>
    onLocate: (loc: PdfLocation) => void
    /** The first page has painted — the "Opening…" line can go. */
    onReady: () => void
    /** A tap that was not a selection and not a drag: toggle the chrome. */
    onTap: () => void
    onZoom?: (zoom: number) => void
}

/* The surround. PAD is the margin the stock shows around the paper; GAP is the
   space between two pages, which is what makes a continuous scroll read as a
   stack of sheets rather than one endless roll. Both in CSS px, not tokens,
   because they are geometry this file does arithmetic on. */
const PAD = 14
const GAP = 12
/* The 1px rule `.pdf-page` draws is part of the paper's footprint, and
   `box-sizing: content-box` keeps the canvas at exactly `w × h` CSS pixels so
   the text layer's scale stays exact. That makes the border box 2px wider than
   the width this file computes — so the geometry has to know about it, or the
   page sits a pixel off-centre at every width. Measured: 14px left, 12px right
   at 1280 before this was accounted for. */
const RULE = 1
const MAX_ZOOM = 5
/* How far past the range a pinch may stretch before it stops following, and
   how hard it resists. A hard stop at the limit reads as a frozen app; this
   reads as "there is nothing more here". apple-design § 9. */
const BAND = 0.35

type Layout = {
    scale: number
    stripW: number
    total: number
    tops: number[]
    lefts: number[]
    ws: number[]
    hs: number[]
}

/** The whole geometry of the strip at a given box and zoom. Pure, so the pinch
    commit can compute the layout it is about to land in and set the scroll
    offsets exactly, in the same frame, instead of guessing at a ratio. */
function layoutFor(sizes: PdfPageSize[], boxW: number, boxH: number, fit: PdfFit, zoom: number): Layout {
    let maxW = 1, maxH = 1
    for (const s of sizes) { if (s.w > maxW) maxW = s.w; if (s.h > maxH) maxH = s.h }
    const availW = Math.max(1, boxW - PAD * 2 - RULE * 2)
    const availH = Math.max(1, boxH - PAD * 2 - RULE * 2)
    /* Every page shares one scale, off the widest and tallest page in the file,
       so a document that mixes portrait and landscape does not jump in size as
       you scroll it. */
    const fitScale = fit === 'width'
        ? availW / maxW
        : Math.min(availW / maxW, availH / maxH)
    const scale = fitScale * zoom
    const ws: number[] = [], hs: number[] = [], tops: number[] = [], lefts: number[] = []
    let y = PAD
    for (const s of sizes) {
        const w = Math.round(s.w * scale), h = Math.round(s.h * scale)
        ws.push(w); hs.push(h); tops.push(y)
        y += h + RULE * 2 + GAP
    }
    const stripW = Math.max(Math.round(maxW * scale) + RULE * 2 + PAD * 2, boxW)
    /* Centred on the border box, not the canvas. */
    for (const w of ws) lefts.push(Math.round((stripW - (w + RULE * 2)) / 2))
    return { scale, stripW, total: Math.max(y - GAP + PAD, boxH), tops, lefts, ws, hs }
}

function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v }

function band(k: number, lo: number, hi: number) {
    if (k < lo) return lo * Math.pow(k / lo, BAND)
    if (k > hi) return hi * Math.pow(k / hi, BAND)
    return k
}

export function PdfView(p: PdfViewProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const stripRef = useRef<HTMLDivElement | null>(null)
    const [box, setBox] = useState({ w: 0, h: 0 })
    const [zoom, setZoom] = useState(1)
    const [range, setRange] = useState({ lo: 1, hi: 1 })

    /* The props the handlers read. They are registered on the element itself
       and run on a pointer or a scroll, so they must not be re-registered on
       every render just because the parent passed a fresh closure. */
    const cb = useRef(p)
    cb.current = p

    const sizes = p.doc.sizes
    const L = useMemo(
        () => layoutFor(sizes, box.w, box.h, p.fit, zoom),
        [sizes, box.w, box.h, p.fit, zoom])
    /* The layout the handlers read. They run outside React's render, on a
       pointer or a scroll, and must never see a stale strip. */
    const Lref = useRef(L)
    Lref.current = L

    /* ── the box ──────────────────────────────────────────────────────────
       One observer, and the only place a layout property of the scroller is
       read. Everything downstream is arithmetic on these two numbers. */
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const ro = new ResizeObserver(() => {
            setBox(b => {
                const w = el.clientWidth, h = el.clientHeight
                return b.w === w && b.h === h ? b : { w, h }
            })
        })
        ro.observe(el)
        setBox({ w: el.clientWidth, h: el.clientHeight })
        return () => { ro.disconnect() }
    }, [])

    /* ── where we are, and what to mount ──────────────────────────────── */
    const locate = useCallback((): PdfLocation => {
        const el = scrollRef.current
        const { tops, hs } = Lref.current
        if (!el || !tops.length) return { page: 1, fraction: 0 }
        const y = el.scrollTop
        let i = 0
        /* Binary search rather than a scan: a 900-page file is the case this
           runs on, once per animation frame of a scroll. */
        let lo = 0, hi = tops.length - 1
        while (lo <= hi) {
            const mid = (lo + hi) >> 1
            if (tops[mid] <= y + 1) { i = mid; lo = mid + 1 } else hi = mid - 1
        }
        return { page: i + 1, fraction: clamp((y - tops[i]) / Math.max(1, hs[i]), 0, 1) }
    }, [])

    const sweep = useCallback(() => {
        const el = scrollRef.current
        const { tops, hs } = Lref.current
        if (!el || !tops.length) return
        const y = el.scrollTop, h = el.clientHeight
        /* One screen of slack each way. A page is drawn before it is needed,
           so a flick lands on paper rather than on a blank. */
        const from = y - h, to = y + h * 2
        let lo = 1, hi = 1, found = false
        for (let i = 0; i < tops.length; i++) {
            if (tops[i] + hs[i] < from) continue
            if (tops[i] > to) break
            if (!found) { lo = i + 1; found = true }
            hi = i + 1
        }
        setRange(r => (r.lo === lo && r.hi === hi ? r : { lo, hi }))
        cb.current.onLocate(locate())
    }, [locate])

    const rafRef = useRef(0)
    const onScroll = useCallback(() => {
        if (rafRef.current) return
        rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; sweep() })
    }, [sweep])
    useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

    /* Re-sweep whenever the geometry changed under us — a resize, a zoom, a
       change of fit. The mounted set is a function of the layout, not only of
       the scroll. */
    useEffect(() => { sweep() }, [L, sweep])

    /* ── going somewhere ──────────────────────────────────────────────── */
    const goTo = useCallback((page: number, fraction = 0) => {
        const el = scrollRef.current
        const { tops, hs } = Lref.current
        if (!el || !tops.length) return
        const i = clamp(Math.round(page) - 1, 0, tops.length - 1)
        el.scrollTop = Math.round(tops[i] + clamp(fraction, 0, 1) * hs[i])
        sweep()
    }, [sweep])

    /* Open where we left off. Once, after the first real measure — before that
       the layout is a 0×0 guess and every offset in it is zero. */
    const opened = useRef(false)
    useEffect(() => {
        if (opened.current || !box.w || !L.tops.length) return
        opened.current = true
        const at = cb.current.start
        if (at) goTo(at.page, at.fraction)
        else sweep()
    }, [box.w, L.tops.length, goTo, sweep])

    /* ── zoom ─────────────────────────────────────────────────────────────
       A commit is: work out the layout we are landing in, work out where the
       focal point should sit in it, set the zoom, then write the scroll offsets
       in the layout effect that follows — after the strip has resized, so the
       browser cannot clamp them. */
    const pending = useRef<{ left: number; top: number } | null>(null)

    const commitZoom = useCallback((next: number, fx: number, fy: number) => {
        const el = scrollRef.current
        if (!el) return
        const now = Lref.current
        const z = clamp(next, 1, MAX_ZOOM)
        if (Math.abs(z - zoom) < 0.0005) return
        const after = layoutFor(sizes, box.w, box.h, p.fit, z)

        /* Anchor to the page under the fingers, not to a scroll ratio. The
           strip's own left padding changes when the pages stop being centred,
           so a ratio drifts exactly when the reader is watching most closely. */
        const cx = el.scrollLeft + fx, cy = el.scrollTop + fy
        let i = 0
        for (let k = 0; k < now.tops.length; k++) { if (now.tops[k] <= cy) i = k; else break }
        const px = (cx - now.lefts[i]) / Math.max(1, now.ws[i])
        const py = (cy - now.tops[i]) / Math.max(1, now.hs[i])

        pending.current = {
            left: Math.round(after.lefts[i] + px * after.ws[i] - fx),
            top: Math.round(after.tops[i] + py * after.hs[i] - fy),
        }
        setZoom(z)
        cb.current.onZoom?.(z)
    }, [zoom, sizes, box.w, box.h, p.fit])

    useLayoutEffect(() => {
        const el = scrollRef.current
        const at = pending.current
        if (!el || !at) return
        pending.current = null
        el.scrollLeft = Math.max(0, at.left)
        el.scrollTop = Math.max(0, at.top)
    }, [L])

    /* ── the pinch ────────────────────────────────────────────────────────
       Two fingers take the surface over from the native scroller. While they
       are down the only thing that changes is one transform on the strip; the
       canvases are untouched until the fingers lift. */
    useEffect(() => {
        const el = scrollRef.current
        const strip = stripRef.current
        if (!el || !strip) return

        const pts = new Map<number, { x: number; y: number }>()
        let pinch: { d0: number; fx: number; fy: number; k: number } | null = null
        /* Where the pointer went down, to tell a tap from a drag. */
        let downAt: { x: number; y: number; t: number } | null = null

        const dist = () => {
            const [a, b] = [...pts.values()]
            return Math.hypot(a.x - b.x, a.y - b.y)
        }

        const start = () => {
            const [a, b] = [...pts.values()]
            const r = el.getBoundingClientRect()
            pinch = {
                d0: Math.max(1, dist()),
                fx: (a.x + b.x) / 2 - r.left,
                fy: (a.y + b.y) / 2 - r.top,
                k: 1,
            }
            strip.style.transformOrigin = `${el.scrollLeft + pinch.fx}px ${el.scrollTop + pinch.fy}px`
            strip.style.willChange = 'transform'
            /* Stop the native scroller fighting the pinch for the same fingers. */
            el.style.touchAction = 'none'
        }

        const end = () => {
            if (!pinch) return
            const { k, fx, fy } = pinch
            pinch = null
            strip.style.transform = ''
            strip.style.willChange = ''
            strip.style.transformOrigin = ''
            el.style.touchAction = ''
            commitZoom(zoom * k, fx, fy)
        }

        const down = (e: PointerEvent) => {
            if (e.pointerType !== 'touch') return
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
            downAt = pts.size === 1 ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null
            if (pts.size === 2) start()
        }

        const move = (e: PointerEvent) => {
            if (!pts.has(e.pointerId)) return
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
            if (!pinch || pts.size < 2) return
            e.preventDefault()
            pinch.k = band(dist() / pinch.d0, 1 / zoom, MAX_ZOOM / zoom)
            strip.style.transform = `scale(${pinch.k})`
        }

        const up = (e: PointerEvent) => {
            const was = pts.get(e.pointerId)
            pts.delete(e.pointerId)
            if (pinch && pts.size < 2) { end(); pts.clear(); downAt = null; return }
            if (pinch) return
            /* A tap: one finger, barely moved, and not the end of a selection.
               A selection has to win, or every attempt to quote a line closes
               the chrome instead. */
            if (!downAt || !was) return
            const moved = Math.hypot(was.x - downAt.x, was.y - downAt.y)
            const held = e.timeStamp - downAt.t
            downAt = null
            if (moved > 8 || held > 500) return
            const sel = document.getSelection()
            if (sel && !sel.isCollapsed) return
            cb.current.onTap()
        }

        el.addEventListener('pointerdown', down)
        el.addEventListener('pointermove', move, { passive: false })
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
        return () => {
            el.removeEventListener('pointerdown', down)
            el.removeEventListener('pointermove', move)
            el.removeEventListener('pointerup', up)
            el.removeEventListener('pointercancel', up)
        }
    }, [zoom, commitZoom])

    /* Desktop: ctrl+wheel, which is also what a trackpad pinch arrives as.
       Coalesced to one commit per frame so a fast scroll gesture does not queue
       thirty re-renders. */
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        let acc = 1, raf = 0, fx = 0, fy = 0
        const wheel = (e: WheelEvent) => {
            if (!e.ctrlKey && !e.metaKey) return
            e.preventDefault()
            const r = el.getBoundingClientRect()
            fx = e.clientX - r.left; fy = e.clientY - r.top
            acc *= clamp(Math.exp(-e.deltaY * 0.01), 0.8, 1.25)
            if (raf) return
            raf = requestAnimationFrame(() => {
                raf = 0
                const k = acc; acc = 1
                commitZoom(zoom * k, fx, fy)
            })
        }
        el.addEventListener('wheel', wheel, { passive: false })
        return () => { el.removeEventListener('wheel', wheel); if (raf) cancelAnimationFrame(raf) }
    }, [zoom, commitZoom])

    /* A mouse click, for the pointer that has no pointerup path above. */
    const onClick = useCallback((e: ReactMouseEvent) => {
        if ((e.nativeEvent as PointerEvent).pointerType === 'touch') return
        const sel = document.getSelection()
        if (sel && !sel.isCollapsed) return
        cb.current.onTap()
    }, [])

    useImperativeHandle(p.ref, () => ({
        goTo,
        location: locate,
        zoomBy: (k: number) => commitZoom(zoom * k, box.w / 2, box.h / 2),
        resetZoom: () => commitZoom(1, box.w / 2, box.h / 2),
    }), [goTo, locate, commitZoom, zoom, box.w, box.h])

    const first = useRef(false)
    const onPaint = useCallback(() => {
        if (first.current) return
        first.current = true
        cb.current.onReady()
    }, [])

    const mounted: number[] = []
    const hi = Math.min(range.hi, L.tops.length)
    for (let n = Math.max(1, range.lo); n <= hi; n++) mounted.push(n)

    return (
        <div
            className="pdf-scroll"
            ref={scrollRef}
            onScroll={onScroll}
            onClick={onClick}
            tabIndex={0}
            role="document"
            aria-label={`${p.doc.pages} page${p.doc.pages === 1 ? '' : 's'}`}
        >
            <div
                className="pdf-strip"
                ref={stripRef}
                style={{ width: L.stripW, height: L.total }}
            >
                {box.w > 0 && mounted.map(n => (
                    <PdfPage
                        key={n}
                        doc={p.doc}
                        num={n}
                        w={L.ws[n - 1]}
                        h={L.hs[n - 1]}
                        left={L.lefts[n - 1]}
                        top={L.tops[n - 1]}
                        onPaint={onPaint}
                    />
                ))}
            </div>
        </div>
    )
}

/* ── one page ─────────────────────────────────────────────────────────────
   A canvas, a stock-coloured veil over it, and the text layer above both. The
   veil is why a scanned white page is readable on the coal stock at night: it
   is a flat fill at an opacity the stock sets, so it costs one composite and
   nothing per frame. The text layer sits above it so selection still works.

   The canvas and the text layer are two effects, not one, because the page
   handle and the scale change independently: scrolling back to a page it has
   already loaded must not re-fetch it, and a zoom must not rebuild the spans
   when it can re-lay them. */
function PdfPage(pp: {
    doc: PdfDoc
    num: number
    w: number
    h: number
    left: number
    top: number
    onPaint: () => void
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const textRef = useRef<HTMLDivElement | null>(null)
    const layerRef = useRef<PdfTextLayer | null>(null)
    const [page, setPage] = useState<PdfPageHandle | null>(null)

    useEffect(() => {
        let alive = true
        void getPage(pp.doc.doc, pp.num).then(pg => { if (alive) setPage(pg) }).catch(() => {})
        return () => { alive = false }
    }, [pp.doc, pp.num])

    useEffect(() => {
        const canvas = canvasRef.current, text = textRef.current
        if (!page || !canvas || !text || !pp.w) return
        let alive = true
        const r = renderPage(page, canvas, pp.w)
        setLayerScale(text, r.viewport.scale)
        void r.done.then(async () => {
            if (!alive) return
            pp.onPaint()
            const held = layerRef.current
            if (held) {
                /* Re-lay the spans against the new scale rather than rebuilding
                   them: it keeps a live selection alive across a zoom, which
                   rebuilding cannot. */
                held.update({ viewport: r.viewport })
                return
            }
            text.replaceChildren()
            const layer = await textLayerFor(page, text, r.viewport)
            if (alive) layerRef.current = layer
            else layer.cancel()
        }).catch(() => {})
        return () => { alive = false; r.cancel() }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, pp.w])

    useEffect(() => () => { layerRef.current = null }, [])

    return (
        <div
            className="pdf-page"
            style={{ left: pp.left, top: pp.top, width: pp.w, height: pp.h }}
            aria-label={`Page ${pp.num}`}
        >
            <canvas className="pdf-canvas" ref={canvasRef} width={pp.w} height={pp.h} />
            <div className="pdf-veil" aria-hidden="true" />
            <div className="pdf-text textLayer" ref={textRef} />
        </div>
    )
}
