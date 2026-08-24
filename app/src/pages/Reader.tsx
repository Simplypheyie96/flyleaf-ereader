/* ─────────────────────────────────────────────────────────────
   The reading page.

   Three things, kept apart on purpose:

     1. the ENGINE — foliate's <foliate-view>, mounted once per book and
        driven entirely through attributes and setStyles. Nothing in this
        file reaches into its shadow root except through the one getter
        added by local patch (PATCHES.md § 4a).
     2. the TURN — reader/turn.ts, which replaces foliate's touch handling
        wholesale. It owns the finger; React never re-renders during a drag.
     3. the CHROME — this component's own state. It shrinks the reading
        pane rather than covering it, which is why the bars are grid rows
        and not overlays. SPEC.md § 8.

   The position is a CFI and only ever a CFI. Everything a reader can
   change — face, size, leading, margin, stock, flow — changes where the
   page breaks fall, and a percentage or a scroll offset would land them
   somewhere near the sentence they were reading instead of on it.
   ───────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, saveSettings, touchBook, useSettings } from '../db'
import type { Annotation, Bookmark, HighlightColor, Settings } from '../types'
import { percent } from '../lib'
import { BackIcon, BookmarkIcon, ContentsIcon, TypeIcon } from '../components/icons'
import { readPalette, isDarkStock } from '../reader/palette'
import { readingCss } from '../reader/readingCss'
import { hardenBook } from '../reader/harden'
import { Sheet } from '../reader/Sheet'
import { TurnController } from '../reader/turn'
import { ReadingClock } from '../reader/clock'
import { Panel } from '../reader/Panel'
import type { PanelRequest, SearchYield } from '../reader/Panel'
import { SelectionMenu } from '../reader/SelectionMenu'
import type { SelAnchor } from '../reader/SelectionMenu'
import { NoteEditor } from '../reader/NoteEditor'
import { ExportSheet } from '../reader/ExportSheet'
import { Overlayer } from '../vendor/foliate-js/overlayer.js'
import {
    addBookmark, addHighlight, drawFor, flatten, readPaint, removeAnnotation,
    removeBookmark, setNote, setTint, sortByPosition, withinPage,
} from '../reader/marks'
import type { MarkPaint } from '../reader/marks'

/** Two columns above this, one below it — SPEC.md § 4. A phone is never two
    columns and a desktop always is; the number is where a single column stops
    being the better answer, not a device. */
const TWO_COLUMN = '(min-width: 1180px)'

/** The three formats the engine has no parser for. Built by
    reader/textBook.ts and handed to the view already parsed. */
const TEXT_FORMATS = new Set(['txt', 'markdown', 'html'])

type Readout = {
    page: number
    pages: number
    chapter: string | null
    fraction: number
}

/* The clear band at each end of the paginated page, and the reason the floating
   controls do not sit on a sentence.

   It is the paginator's own block margin (`--_margin`, paginator.js:476, the
   two `minmax(var(--_margin), 1fr)` rows), not padding on the stage — the
   stage has to stay full-bleed for the paper to reach the window edges.

   10 of bar padding + 44 of button + 10 = 64. It went up from 24, and the page
   still gained: the two 52px bars used to come off the stage as well, so the
   text column is 716px of an 844px window where it was 692px. The notch is
   handled by padding on .reader rather than by adding it here, because foliate
   takes ONE number for both ends and cannot express an inset at one end only.

   In scrolled flow the paginator gives #container the whole grid and this band
   does not apply, so there a line can pass behind a capsule. That is why the
   capsules are opaque --lift rather than transparent, and it is what iOS does
   on a scrolling page too. */
const CHROME_INSET = 64

/* TWO DIFFERENT FAILURES, and telling them apart is the whole point. No row
   means the book was deleted — nothing to do about that. A row with no bytes
   means the book came from another device and its file has not been carried
   across, which is a normal state of a synced shelf rather than an error the
   reader caused, and it has an answer they can act on. */
const missing = (row: boolean) =>
    row
        ? 'This book came from another device, and its file is not on this one yet. Turn on “Carry the book files too” in Settings and it will arrive on its own — or open the file here again.'
        : 'That book is not in this library any more.'

export function Reader() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const settings = useSettings()
    const book = useLiveQuery(() => (id ? db.books.get(id) : undefined), [id])

    const stageRef = useRef<HTMLDivElement | null>(null)
    const seamRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<FoliateViewElement | null>(null)
    const turnRef = useRef<TurnController | null>(null)
    /* Chrome state is read inside event handlers that are registered once, so
       it is mirrored into a ref. Re-registering listeners on every toggle
       would tear the gesture layer down and rebuild it mid-read. */
    const chromeRef = useRef(false)

    const [chrome, setChrome] = useState(false)
    const [toc, setToc] = useState<FoliateTOCItem[]>([])
    const [sheetOpen, setSheetOpen] = useState(false)
    const [readout, setReadout] = useState<Readout | null>(null)
    const [gotoOpen, setGotoOpen] = useState(false)
    const [failed, setFailed] = useState<string | null>(null)
    const [ready, setReady] = useState(false)

    /* ── the marks ────────────────────────────────────────────────────────
       P3. Four pieces of chrome and one map.

       The map is the bridge between Dexie and the engine: foliate identifies an
       annotation by its CFI string and hands that string back on every
       draw-annotation, so the row it belongs to has to be findable by CFI
       alone. It lives in a ref because `draw-annotation` fires inside the
       engine's own await, long after the render that knew about the mark. */
    const [panelOpen, setPanelOpen] = useState(false)
    const [panelTab, setPanelTab] = useState<'contents' | 'marks'>('contents')
    const [panelReq, setPanelReq] = useState<PanelRequest | null>(null)
    const [sel, setSel] = useState<{ anchor: SelAnchor; mark: Annotation | null } | null>(null)
    const [noteFor, setNoteFor] = useState<Annotation | null>(null)
    const [exportOpen, setExportOpen] = useState(false)
    const [ticked, setTicked] = useState(false)

    const marksRef = useRef(new Map<string, Annotation>())
    /* Marks owed the 140ms wipe: put in on apply, taken out by the draw. A set
       rather than a flag on the row, because SPEC.md § 6.1 says the wipe runs
       on apply and never on render, and a row that is redrawn on a resize is
       the same row. */
    const wipeRef = useRef(new Set<string>())
    /* Two copies of the same reading, deliberately. The draw callback needs it
       synchronously inside the engine's await, which a ref gives; the marks
       list needs it to re-render its dots when the stock changes, which only
       state gives. One write site keeps them honest. */
    const paintRef = useRef<MarkPaint | null>(null)
    const [paint, setPaint] = useState<MarkPaint>(() => readPaint(null))
    /* Which spine section each loaded document is. `view.getCFI` needs the
       index and a selection only knows its document. */
    const docIndex = useRef(new Map<Document, number>())
    /* The section document on screen. It cannot be found from the host DOM:
       foliate attaches its shadow roots with `mode: 'closed'`, so
       `stage.querySelector('iframe')` is null and always will be. The only
       handle on a section's document is the one its own load event hands over,
       so it is kept. */
    const liveDoc = useRef<Document | null>(null)
    const selRange = useRef<Range | null>(null)
    const selIndex = useRef(0)
    const selTimer = useRef<number | null>(null)
    /* Read inside listeners registered once per book. */
    const marginRef = useRef(8)
    const chapterRef = useRef<string | null>(null)
    const pageCFIRef = useRef<string | null>(null)

    const annotations = useLiveQuery(async () => {
        if (!id) return [] as Annotation[]
        return sortByPosition(await db.annotations.where('bookId').equals(id).toArray())
    }, [id]) ?? []
    const bookmarks = useLiveQuery(async () => {
        if (!id) return [] as Bookmark[]
        return sortByPosition(await db.bookmarks.where('bookId').equals(id).toArray())
    }, [id]) ?? []

    /* ── the reading clock ────────────────────────────────────────────────
       One per book id, torn down with the view. It lives in a ref rather than
       state because starting it must not paint, and because `onRelocate` — a
       callback that runs on every single page — has to reach it without being
       re-created every time the clock changes anything. */
    const clockRef = useRef<ReadingClock | null>(null)
    useEffect(() => {
        if (!id) return
        const clock = new ReadingClock(id)
        clockRef.current = clock
        return () => {
            clock.stop()
            clockRef.current = null
        }
    }, [id])

    const toggleChrome = useCallback(() => {
        stopSearch()
        chromeRef.current = !chromeRef.current
        setChrome(chromeRef.current)
        if (!chromeRef.current) {
            setPanelOpen(false)
            setSheetOpen(false)
            setExportOpen(false)
        }
    }, [])

    /* ── the engine ───────────────────────────────────────────────────────
       Mounted once per book id. Settings are applied by the effect below
       instead of here, so changing a setting never reopens the file. */
    useEffect(() => {
        if (!id) return
        const stage = stageRef.current
        if (!stage) return
        let live = true
        let view: FoliateViewElement | null = null

        void (async () => {
            const [rec, meta] = await Promise.all([db.files.get(id), db.books.get(id)])
            if (!live) return
            if (!rec || !meta) {
                setFailed(missing(!!meta))
                return
            }
            /* makeBook sniffs on name and type as well as on bytes, so the
               blob is handed over as the file it was imported as. */
            const file = new File([rec.data], meta.fileName, { type: rec.type })
            const locator = await db.locators.get(id)
            if (!live) return

            try {
                const mod = await import('../vendor/foliate-js/view.js')
                if (!live) return
                view = document.createElement('foliate-view') as FoliateViewElement
                void mod
                /* TXT, Markdown and a lone HTML file have no parser in the
                   engine — `makeBook` sniffs zip, PDF, MOBI and FB2 and throws
                   on everything else — so they are built here instead. This is
                   not a patch to the vendored tree: `view.open` takes either a
                   file to sniff or a book object, and a book object is what
                   reader/textBook.ts returns. The metadata comes from the
                   record so the reader and the shelf agree on the title. */
                if (TEXT_FORMATS.has(meta.format)) {
                    const { makeTextBook } = await import('../reader/textBook')
                    if (!live) return
                    const book = await makeTextBook(
                        rec.data, meta.format as 'txt' | 'markdown' | 'html',
                        { title: meta.title, author: meta.author, language: meta.language })
                    if (!live) return
                    await view.open(book)
                } else await view.open(file)
                if (!live) { view.close?.(); return }

                /* Before `init`, which is what loads the first section: the
                   book is parsed but no content document exists yet, so the
                   policy is in place for every one of them. reader/harden.ts
                   for what it stops and, per format, what it cannot. */
                hardenBook(view.book)

                view.addEventListener('relocate', onRelocate as EventListener)
                view.addEventListener('load', onSectionLoad as EventListener)
                view.addEventListener('draw-annotation', onDrawAnnotation as EventListener)
                view.addEventListener('show-annotation', onShowAnnotation as EventListener)
                view.addEventListener('create-overlay', onCreateOverlay as EventListener)
                stage.append(view)
                viewRef.current = view
                setToc(view.book?.toc ?? [])

                /* Upstream's touch handling off, before the first frame the
                   reader could touch. PATCHES.md § 4b. */
                view.renderer?.setAttribute('no-touch', '')
                /* `animated` deliberately absent: with it, prev/next animate
                   their own scroll and the turn would be fighting them. */

                const turn = new TurnController(turnConfig(), {
                    renderer: () => viewRef.current?.renderer ?? null,
                    stage: () => stageRef.current,
                    seam: () => seamRef.current,
                    toggleChrome,
                })
                turnRef.current = turn
                turn.attach(document)

                await view.init({ lastLocation: locator?.cfi ?? null, showTextStart: true })
                if (!live) return
                setReady(true)
                void touchBook(id)
            } catch (err) {
                if (!live) return
                setFailed(message(err))
            }
        })()

        return () => {
            live = false
            turnRef.current?.destroy()
            turnRef.current = null
            const v = viewRef.current
            viewRef.current = null
            if (v) {
                v.removeEventListener('relocate', onRelocate as EventListener)
                v.removeEventListener('load', onSectionLoad as EventListener)
                v.removeEventListener('draw-annotation', onDrawAnnotation as EventListener)
                v.removeEventListener('show-annotation', onShowAnnotation as EventListener)
                v.removeEventListener('create-overlay', onCreateOverlay as EventListener)
                v.close?.()
                v.remove()
            }
        }
        /* Mount-per-book. Settings deliberately absent from the deps: they are
           applied by attribute, and reopening the file to change a font size
           is the thing this design exists to avoid. */
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    /* ── the turn's own document listeners ────────────────────────────────
       A pointer event inside an iframe does not cross the boundary, so every
       loaded section is attached to as it arrives. The same is true of a
       selection: `selectionchange` fires on the document that owns the words,
       which is the section's, never the host's. */
    const onSectionLoad = useCallback((e: CustomEvent<{ doc: Document; index: number }>) => {
        const doc = e.detail?.doc
        if (!doc) return
        turnRef.current?.attach(doc)
        docIndex.current.set(doc, e.detail.index ?? 0)
        liveDoc.current = doc
        doc.addEventListener('selectionchange', onSelectionChange)
        doc.addEventListener('keydown', onDocKey)
    }, [])

    /* The keyboard does not cross the iframe boundary either, and this one cost
       a measured audit to find: tapping the page — the most ordinary thing a
       reader does — moves focus into the section's document, and from then on
       every shortcut in this app is dead, because the host window never sees the
       keydown. So each section gets the same handler as it loads, reached
       through a ref so a changed handler never means re-attaching a section. */
    const keyRef = useRef<((e: KeyboardEvent) => void) | null>(null)
    const onDocKey = useCallback((e: Event) => { keyRef.current?.(e as KeyboardEvent) }, [])

    /* ── selection ────────────────────────────────────────────────────────
       Debounced, and the reason is the platform: dragging a selection handle
       fires selectionchange on every pixel, and a menu that re-anchors on every
       pixel is a menu that is never where the reader let go. 220ms of quiet is
       what "let go" looks like from here. */
    /* Whether the open menu is about an existing mark rather than a fresh
       selection. Not derivable from the `sel` state inside a debounced timer
       without making the handler depend on it, and re-creating this handler
       would mean re-attaching it to every loaded section. */
    const selIsMark = useRef(false)
    const onSelectionChange = useCallback((e: Event) => {
        const doc = e.target as Document | null
        if (!doc) return
        if (selTimer.current) clearTimeout(selTimer.current)
        selTimer.current = window.setTimeout(() => {
            const s = doc.getSelection?.()
            if (!s || s.isCollapsed || s.rangeCount === 0 || !s.toString().trim()) {
                /* A tap on a highlight does two things at once: the engine
                   hit-tests the overlay and the menu opens on the mark, and the
                   browser places a caret in the text under the finger. 220ms
                   later this fires with that collapsed caret and would close
                   the menu the same tap had just opened — measured: the menu
                   was on screen at t+150ms and gone at t+250ms, so tapping a
                   highlight looked like a flicker.

                   A caret inside the mark the menu is about IS that tap, so it
                   is not a dismissal. A caret anywhere else is one, and closes
                   the menu as before — which is what keeps a tap on another
                   paragraph from leaving a stale menu behind. */
                if (selIsMark.current && inRange(selRange.current, s)) return
                selRange.current = null
                selIsMark.current = false
                setSel(null)
                return
            }
            const range = s.getRangeAt(0)
            const anchor = anchorFor(range, doc, stageRef.current, pageSize())
            if (!anchor) return
            selRange.current = range.cloneRange()
            selIndex.current = docIndex.current.get(doc) ?? 0
            selIsMark.current = false
            setSel({ anchor, mark: null })
        }, 220)
    }, [])

    /* A click that landed on an existing highlight. The engine hit-tests the
       overlay for us and gives back the CFI it was stored under, so the menu
       opens on the mark rather than on a fresh selection — same menu, but the
       tint row shows what it already is and Remove appears. */
    const onShowAnnotation = useCallback((e: CustomEvent<{ value: string; index: number; range: Range }>) => {
        const mark = marksRef.current.get(e.detail.value)
        if (!mark) return
        const doc = e.detail.range?.startContainer?.ownerDocument ?? null
        const anchor = doc
            ? anchorFor(e.detail.range, doc, stageRef.current, pageSize())
            : null
        if (!anchor) return
        selRange.current = e.detail.range.cloneRange()
        selIndex.current = e.detail.index
        selIsMark.current = true
        setSel({ anchor, mark })
    }, [])

    /* ── painting a mark ──────────────────────────────────────────────────
       The engine resolves the CFI, clears any previous drawing of it, and then
       asks this. Everything about HOW a mark looks lives in reader/marks.ts;
       this only decides which row is being drawn and whether it is owed a
       wipe. */
    const onDrawAnnotation = useCallback((e: CustomEvent<{
        draw: (fn: (rects: DOMRect[], opts: never) => Element, opts: unknown) => void
        annotation: { value: string }
    }>) => {
        const mark = marksRef.current.get(e.detail.annotation.value)
        if (!mark) return
        const paint = paintRef.current ?? readPaint(stageRef.current?.closest('.reader') ?? null)
        const wipeIt = wipeRef.current.delete(mark.cfi)
        const { fn, opts } = drawFor(mark.color, paint, geom, wipeIt)
        e.detail.draw(fn as never, opts)
    }, [])

    /* A section that has just been laid out has an empty overlay, and
       view.js re-adds its own SEARCH annotations there but not the reader's
       (view.js:421–422). So this does. `addAnnotation` is a no-op for a mark
       whose section is not this one, which is why the whole set can be handed
       over without working out which belong here. */
    const onCreateOverlay = useCallback(() => {
        const view = viewRef.current
        if (!view) return
        for (const cfi of marksRef.current.keys()) void view.addAnnotation({ value: cfi })
    }, [])

    /* The page geometry the margin bar needs, in the overlay's own
       coordinates. Read at draw time, never cached: a rotation changes both
       numbers and the overlay redraws itself with the same options object.

       `gutter` is the padding upstream actually applies inside a page column,
       which is NOT the `gap` percentage the setting is named after. Upstream
       inverts the percentage to f⁻¹(g) = g/(1−g) so the outer padding and the
       inner column gap come out equal (paginator.js:704–722), then lays the
       column out with `padding: 0 gap/2` (paginator.js:329). So the text edge
       sits at size·g / 2(1−g), a little over half of size·g.

       Returning size·g — the setting read literally — was the bug: at 8% on a
       612px pane it put the gutter at 49px when the text starts at 27px, so
       the 2px bar landed 12px INSIDE the column and was drawn straight
       through the first character of every marked line. Visible in a Coal
       screenshot as a mustard rule between the “I” and the “t” of “It is a
       truth universally acknowledged”.

       A measure cap can inset the text further still (the grid at
       paginator.js:487–491 centres a capped column), which only ever moves
       the text right — so a bar placed off the padding edge stays clear. */
    const geom = useCallback(() => {
        const size = viewRef.current?.renderer?.size ?? 0
        const g = Math.min(0.45, Math.max(0, marginRef.current / 100))
        return { pageSize: size, gutter: (size * g) / (2 * (1 - g)) }
    }, [])
    function pageSize() {
        return viewRef.current?.renderer?.size ?? 0
    }

    /* ── position ─────────────────────────────────────────────────────────
       relocate fires on every page, so the write is debounced. The readout
       is not: it has to be right the instant the page lands.

       Not every relocate is a move. Placing a caret — which is what tapping a
       word does — makes the browser scroll the caret into view inside the
       paginated container, and the paginator emits relocate for it. Measured:
       one click on a highlighted word produced THREE relocates in 6ms, all
       reporting the same fraction, the same `renderer.start` and the same
       `renderer.page`. Treated as moves they cost two visible things: the
       selection menu was opened by the click and closed by the relocate 3ms
       later, so tapping a highlight looked like nothing happened at all; and
       each one counted a page turned, so a reader who taps a word has "turned"
       three pages. So the position is compared before anything acts on it.

       The comparison is on the PAGE, not on the CFI. A CFI is derived from
       whatever the visible range happens to be, and a caret-placement relocate
       resolves a different range than the landing did — measured: three
       relocates on one unmoved page, all carrying
       `epubcfi(/6/6!/4/2[chapter-1],/2,/12/3:56)`, none of them equal to the
       CFI the page had landed on. Comparing CFI strings called that a move and
       closed the menu anyway. Section index plus scroll offset is the page's
       real identity: a turn always changes one of them, and a caret scroll
       that the paginator snapped back changes neither. */
    const writeTimer = useRef<number | null>(null)
    /* Where the page is, as `section:scrollOffset`. See the note above for why
       this and not the CFI. */
    const pagePosRef = useRef<string | null>(null)
    const onRelocate = useCallback((e: CustomEvent<FoliateLocation>) => {
        const loc = e.detail
        const r = viewRef.current?.renderer
        /* page and pages read layout, and this runs after a turn has settled
           — never while one is in flight. The two blank pages expand() adds
           are subtracted, so this counts pages of TEXT in this chapter. */
        const pages = Math.max(1, (r?.pages ?? 3) - 2)
        const page = Math.min(pages, Math.max(1, r?.page ?? 1))
        const chapter = loc?.tocItem?.label?.trim() || null
        const cfi = loc?.cfi ?? null
        const at = `${loc?.section?.current ?? -1}:${Math.round(r?.start ?? -1)}`
        const moved = at !== pagePosRef.current
        chapterRef.current = chapter
        pageCFIRef.current = cfi
        pagePosRef.current = at
        setReadout({ page, pages, chapter, fraction: loc?.fraction ?? 0 })
        /* A menu anchored to a line that has left the page is pointing at
           nothing, so a turn closes it — but only a turn. */
        if (moved) setSel(null)

        if (!id || !loc?.cfi) return
        /* Every landed page is both a turn and a sign of life. Counted here
           rather than in the gesture layer on purpose: this fires for a swipe,
           a tap, a keypress, a TOC jump and a progress scrub alike, and a
           "pages turned" that only counted swipes would be a lie about which
           way somebody reads. A relocate that did not move is still a sign of
           life — somebody is here, touching the page — so it accrues time
           without counting a turn. */
        clockRef.current?.bump(loc.fraction ?? 0, moved)
        /* Nothing moved, so the stored locator already says this. */
        if (!moved) return
        if (writeTimer.current) clearTimeout(writeTimer.current)
        writeTimer.current = window.setTimeout(() => {
            void db.locators.put({
                bookId: id,
                cfi: loc.cfi as string,
                fraction: loc.fraction ?? 0,
                chapter: loc.tocItem?.label ?? null,
                updatedAt: Date.now(),
            })
            const now = Date.now()
            void db.books.update(id, { progress: loc.fraction ?? 0, openedAt: now, editedAt: now })
        }, 600)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    useEffect(() => () => { if (writeTimer.current) clearTimeout(writeTimer.current) }, [])

    /* ── settings → attributes and styles ─────────────────────────────────
       Everything a control moves lands here, and only here. */
    const [twoUp, setTwoUp] = useState(() =>
        typeof matchMedia === 'function' ? matchMedia(TWO_COLUMN).matches : false)
    useEffect(() => {
        if (typeof matchMedia !== 'function') return
        const mq = matchMedia(TWO_COLUMN)
        const on = () => setTwoUp(mq.matches)
        mq.addEventListener('change', on)
        return () => mq.removeEventListener('change', on)
    }, [])

    const [reduced, setReduced] = useState(() =>
        typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false)
    useEffect(() => {
        if (typeof matchMedia !== 'function') return
        const mq = matchMedia('(prefers-reduced-motion: reduce)')
        const on = () => setReduced(mq.matches)
        mq.addEventListener('change', on)
        return () => mq.removeEventListener('change', on)
    }, [])

    /* ── how wide the text column actually is ──────────────────────────────
       Only the CHROME consults this: whether a line-width cap can bite on this
       pane, and what measure in em the reader is currently getting. The book is
       laid out by the engine and never asks. Measured rather than inferred from
       a breakpoint, because the text column is the window minus the bars minus
       the margins, and only one of those three is a media query. */
    const [paneW, setPaneW] = useState(0)
    useEffect(() => {
        const el = stageRef.current
        if (!el || typeof ResizeObserver !== 'function') return
        const ro = new ResizeObserver(entries => {
            const w = entries[0]?.contentRect.width
            if (typeof w === 'number') setPaneW(w)
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    const rtl = Boolean(viewRef.current?.book?.dir === 'rtl')
    const turnConfigRef = useRef<() => TurnConfigShape>(() => ({
        turn: 'slide', rtl: false, tapToTurn: true, paginated: true, reducedMotion: false,
    }))
    function turnConfig(): TurnConfigShape {
        return turnConfigRef.current()
    }
    turnConfigRef.current = () => ({
        turn: settings?.turn ?? 'slide',
        rtl,
        tapToTurn: settings?.tapToTurn ?? true,
        paginated: (settings?.flow ?? 'paginated') === 'paginated',
        reducedMotion: reduced,
    })

    useEffect(() => {
        turnRef.current?.update(turnConfigRef.current())
    }, [settings, reduced, rtl])

    /* Lifted out of the effect below so the sheet can call it directly on every
       input event of a drag. That is the whole live-preview mechanism: `apply`
       restyles the book and touches no database, and the Dexie write follows
       320ms after the finger stops. Persisting per input event would put an
       IndexedDB transaction and a liveQuery round-trip inside the drag. */
    const apply = useCallback((s: Settings) => {
        const r = viewRef.current?.renderer
        const root = stageRef.current?.closest('.reader')
        if (!r || !root) return

        /* `gap` is not a margin, and upstream spends it differently in the two
           flows — which is why the same slider used to put the text edge in
           two different places depending on Flow.

           Upstream computes gap = f⁻¹(g)·size = g/(1−g)·size (paginator.js:
           704–722). In PAGINATED flow that buys the inset twice: `columnize`
           lays the document out with `padding: 0 gap/2` (paginator.js:329) and
           the #top grid adds another half through its `--_half-gap` columns
           (paginator.js:475–491). The two halves sum to the whole, so the text
           edge lands at the percentage the slider says — measured at 390px:
           4% → 4.10%, 8% → 7.95%, 12% → 12.05%, and at 1280px: 4.14 / 7.97 /
           12.03. Symmetric to 1px, and exactly what SPEC.md § 2 asks for.

           (An earlier note here claimed 4.35% a side and called the range a
           look decision. It had measured only the document padding — one of
           the two halves — and missed the grid's. The numbers above come from
           both edges of a laid-out paragraph in HOST coordinates.)

           In SCROLLED flow there is no grid inset and no column, so `scrolled`
           applies the FULL gap as padding (paginator.js:304) and the delivered
           inset is g/(1−g) — over the asking price: 8% rendered 8.72% and 12%
           rendered 13.59%, so switching Flow moved the text edge 3px. Solving
           g/(1−g) = m for g gives m/(100+m), which is what goes on the wire
           there. Both flows now land on the same edge for the same setting.

           `margin` is a different thing entirely: the head and foot strip
           inside the pane. */
        marginRef.current = s.margin
        r.setAttribute('gap', s.flow === 'scrolled'
            ? `${(100 * s.margin) / (100 + s.margin)}%`
            : `${s.margin}%`)
        r.setAttribute('margin', `${CHROME_INSET}px`)
        r.setAttribute('flow', s.flow)
        r.setAttribute('max-inline-size', `${Math.round(s.measure * s.size)}px`)
        const columns = s.columns === 'auto' ? (twoUp ? 2 : 1) : s.columns
        r.setAttribute('max-column-count', String(columns))

        const palette = readPalette(root)
        r.setStyles?.(readingCss({
            settings: s,
            palette,
            lang: firstLang(viewRef.current?.book?.metadata?.language),
            dark: isDarkStock(palette),
        }))
    }, [twoUp])

    useEffect(() => {
        if (!settings || !ready) return
        apply(settings)
    }, [settings, ready, apply])

    /* ── keeping the page and the database in step ────────────────────────
       One effect, one diff. A mark that is new gets drawn AND gets the wipe; a
       mark whose tint changed is redrawn without one; a mark that is gone is
       removed from the overlay. Diffing rather than clearing and redrawing
       everything, because "redraw all" would re-wipe every mark on the page
       every time any one of them changed. */
    useEffect(() => {
        const prev = marksRef.current
        const next = new Map(annotations.map(a => [a.cfi, a]))
        marksRef.current = next
        const view = viewRef.current
        if (!view || !ready) return
        for (const cfi of prev.keys())
            if (!next.has(cfi)) void view.deleteAnnotation({ value: cfi })
        for (const [cfi, a] of next) {
            const before = prev.get(cfi)
            if (!before) {
                wipeRef.current.add(cfi)
                void view.addAnnotation({ value: cfi })
            } else if (before.color !== a.color) void view.addAnnotation({ value: cfi })
        }
    }, [annotations, ready])

    /* A stock change swaps multiply for the measured wash and turns the margin
       bar on or off, so every mark is repainted — without a wipe, because
       nothing was applied. index.css is the table; this only re-reads it. */
    useEffect(() => {
        if (!ready) return
        const next = readPaint(stageRef.current?.closest('.reader') ?? null)
        paintRef.current = next
        setPaint(next)
        const view = viewRef.current
        if (!view) return
        for (const cfi of marksRef.current.keys()) void view.addAnnotation({ value: cfi })
    }, [settings?.stock, ready])

    /* The ribbon's own state. Derived from the page rather than stored,
       because "is this page bookmarked" changes with the font size — the same
       bookmark falls on a different page at 22px than at 16px, and a stored
       boolean would be wrong the moment the reader moved a slider. */
    useEffect(() => {
        let live = true
        const page = pageCFIRef.current
        if (!page || bookmarks.length === 0) { setTicked(false); return }
        void (async () => {
            for (const b of bookmarks) {
                if (await withinPage(b.cfi, page)) { if (live) setTicked(true); return }
            }
            if (live) setTicked(false)
        })()
        return () => { live = false }
    }, [readout, bookmarks])

    /* ── what the reader does with a mark ─────────────────────────────────
       Every one of these writes to Dexie and stops. The page catches up
       through the liveQuery and the diffing effect above, which is what keeps
       one description of a mark: the row in the database. Nothing here paints. */

    const openPanel = useCallback((tab: 'contents' | 'marks') => {
        setPanelTab(tab)
        setPanelOpen(true)
        setSheetOpen(false)
        setSel(null)
        chromeRef.current = true
        setChrome(true)
    }, [])

    /* Tint. Applied to an existing mark, or turning a selection into one.
       `wipeRef` is what earns the 140ms sweep — and only here, because this is
       the apply. */
    const onTint = useCallback((color: HighlightColor) => {
        const view = viewRef.current
        const range = selRange.current
        const existing = sel?.mark
        if (existing) {
            void setTint(existing.id, color)
            wipeRef.current.add(existing.cfi)
            setSel(null)
            return
        }
        if (!view || !range || !id) return
        const cfi = view.getCFI(selIndex.current, range)
        const text = flatten(range.toString())
        if (!text) return
        void addHighlight(id, cfi, text, color, chapterRef.current)
        view.deselect?.()
        setSel(null)
    }, [id, sel])

    /* Note. On a selection that is not yet a highlight, the mark has to exist
       before it can be written beside — so the tint is applied first, in the
       default. SPEC.md § 6.1: a note always has a highlight under it. */
    const onNote = useCallback(async () => {
        const existing = sel?.mark
        if (existing) { setSel(null); setNoteFor(existing); return }
        const view = viewRef.current
        const range = selRange.current
        if (!view || !range || !id) return
        const cfi = view.getCFI(selIndex.current, range)
        const text = flatten(range.toString())
        if (!text) return
        const row = await addHighlight(id, cfi, text, 'mustard', chapterRef.current)
        view.deselect?.()
        setSel(null)
        setNoteFor(row)
    }, [id, sel])

    const onCopy = useCallback(() => {
        const text = sel?.mark?.text ?? flatten(selRange.current?.toString() ?? '')
        if (text) void navigator.clipboard?.writeText(text).catch(() => {})
        viewRef.current?.deselect?.()
        setSel(null)
    }, [sel])

    const onRemoveSel = useCallback(() => {
        const mark = sel?.mark
        setSel(null)
        if (mark) void removeAnnotation(mark.id)
    }, [sel])

    /* "Look up" and "Find" are the same search with a different question
       attached, so they are the same request with a different kind. The nonce
       is what makes looking up the same word twice re-run it rather than
       looking like nothing happened. */
    const nonce = useRef(0)
    const findText = useCallback((text: string) => {
        setPanelReq({ kind: 'find', text, nonce: ++nonce.current })
        setPanelOpen(true)
        setSheetOpen(false)
        setSel(null)
        chromeRef.current = true
        setChrome(true)
    }, [])
    const lookUp = useCallback((text: string) => {
        setPanelReq({ kind: 'lookup', text, nonce: ++nonce.current })
        setPanelOpen(true)
        setSheetOpen(false)
        setSel(null)
        chromeRef.current = true
        setChrome(true)
    }, [])

    /* The ribbon. Adding uses the page's own CFI, so a bookmark means "this
       page" rather than "this word" — and removing finds the one that falls on
       this page, whichever page size found it. */
    const toggleTick = useCallback(async () => {
        const page = pageCFIRef.current
        if (!page || !id) return
        for (const b of bookmarks) {
            if (await withinPage(b.cfi, page)) { await removeBookmark(b.id); return }
        }
        const r = viewRef.current?.renderer
        const excerpt = flatten(firstWords(liveDoc.current, r?.start ?? 0, r?.size ?? 0))
        await addBookmark(id, page, excerpt, chapterRef.current)
    }, [id, bookmarks])

    /* ── search, handed to the panel ──────────────────────────────────────
       The panel owns the query and the list; the engine owns the walk. This is
       the whole seam between them, and it is deliberately thin: an async
       generator in, an async generator out. */
    const runSearch = useCallback((query: string, wholeWords: boolean) => {
        const view = viewRef.current
        if (!view) return (async function* () {})() as AsyncIterable<SearchYield>
        return view.search({
            query, matchCase: false, matchDiacritics: false, matchWholeWords: wholeWords,
            draw: Overlayer.underline,
            drawOptions: { color: 'currentColor', width: 2 }
        }) as AsyncIterable<SearchYield>
    }, [])
    const stopSearch = useCallback(() => { viewRef.current?.clearSearch() }, [])

    /* ── keyboard ─────────────────────────────────────────────────────────
       Arrow keys stay VISUAL in an RTL book — the right arrow means the page
       on the right, whichever way the book reads. Space stays logical, because
       it means "onwards" and always has. SPEC.md § 5.3. */
    useEffect(() => {
        if (!ready) return
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
            /* A focused chip in the sheet is a button, so the test above lets
               it through — and Left/Right on a tablist means "the next tab",
               not "the next page". */
            if (t?.closest('.sheet') || t?.closest('.reader-panel')) return
            const turn = turnRef.current
            const view = viewRef.current
            if (!turn || !view) return
            const fwd = rtl ? -1 : 1
            switch (e.key) {
                case 'ArrowRight': case 'PageDown': turn.turnBy(fwd as 1 | -1); break
                case 'ArrowLeft': case 'PageUp': turn.turnBy(-fwd as 1 | -1); break
                case ' ': turn.turnBy(e.shiftKey ? -1 : 1); break
                case 'Home': void view.goToFraction(0); break
                case 'End': void view.goToFraction(1); break
                case '+': case '=':
                    void saveSettings({ size: Math.min(28, (settings?.size ?? 18) + 1) }); break
                case '-': case '_':
                    void saveSettings({ size: Math.max(14, (settings?.size ?? 18) - 1) }); break
                /* Three letters, and each one is the first letter of what it
                   does. Not modified, because the reading page has no text
                   field to compete with — the panel's own is excluded above. */
                case 'b': case 'B': void toggleTick(); break
                case 'c': case 'C': openPanel('contents'); break
                case 'm': case 'M': openPanel('marks'); break
                case 'f': case 'F': findText(''); break
                case 'Escape':
                    if (panelOpen) setPanelOpen(false)
                    else if (sheetOpen) setSheetOpen(false)
                    else if (gotoOpen) setGotoOpen(false)
                    else return
                    break
                default: return
            }
            e.preventDefault()
        }
        window.addEventListener('keydown', onKey)
        keyRef.current = onKey
        return () => {
            window.removeEventListener('keydown', onKey)
            keyRef.current = null
        }
    }, [ready, rtl, settings?.size, panelOpen, sheetOpen, gotoOpen, toggleTick, openPanel, findText])

    /* One alias for the whole render. `settings` is undefined for the first
       frame of a cold start, and a reader who reaches the sheet in that frame
       should see the defaults rather than a blank panel. */
    const cfg: Settings = settings ?? DEFAULT_SETTINGS
    const stock = cfg.stock

    /* The measure the reader is GETTING, not the one they asked for: on a phone
       the pane is narrower than the narrowest cap, so the cap is not what sets
       the line. The rivers note in SPEC.md § 3 turns on the real number. */
    const textW = paneW * (1 - (cfg.margin * 2) / 100)
    const emMeasure = textW > 0 ? Math.min(cfg.measure, textW / cfg.size) : cfg.measure
    /* A cap only means something on a pane wider than the narrowest one. */
    const measureBites = textW > 30 * cfg.size

    /* Live: restyle now, write nothing. Set: restyle now AND persist — applied
       here as well as by the effect so a chip does not wait on a round-trip. */
    const onLive = useCallback((patch: Partial<Settings>) => {
        apply({ ...cfg, ...patch })
    }, [apply, cfg])
    const onSet = useCallback((patch: Partial<Settings>) => {
        apply({ ...cfg, ...patch })
        void saveSettings(patch)
    }, [apply, cfg])

    if (failed) return (
        <main className="reader reader--message" data-stock={stock}>
            <div className="reader-message">
                <h1 className="ui-h">This book would not open</h1>
                <p className="ui-p ui-p--soft">{failed}</p>
                <Link className="btn" to={id ? `/book/${id}` : '/'}>Back to the book</Link>
            </div>
        </main>
    )

    return (
        <main
            className="reader"
            data-stock={stock}
            data-flow={cfg.flow}
            data-turn={cfg.turn}
            data-chrome={chrome ? 'open' : 'shut'}
        >
            {chrome && (
                <header className="reader-bar reader-bar--top">
                    <button
                        type="button"
                        className="reader-btn"
                        aria-label="Back to the book"
                        onClick={() => navigate(id ? `/book/${id}` : '/')}
                    >
                        <BackIcon />
                    </button>
                    <h1 className="reader-title" title={book?.title ?? ''}>{book?.title ?? ''}</h1>
                    {/* The ribbon. A toggle, not a menu — SPEC.md § 6.3 gives
                        the top bar the place-keeping and the bottom bar the
                        finding, so a reader marking a page never opens a list
                        to do it. */}
                    <button
                        type="button"
                        className={`reader-btn${ticked ? ' is-on' : ''}`}
                        aria-label={ticked ? 'Remove the bookmark on this page' : 'Bookmark this page'}
                        aria-pressed={ticked}
                        onClick={() => void toggleTick()}
                    >
                        <BookmarkIcon filled={ticked} />
                    </button>
                </header>
            )}

            <div className="reader-stage" ref={stageRef}>
                {/* The 1px rule on the outgoing page's leading edge. One
                    element, one transform, on the turn's own clock. */}
                <div className="reader-seam" ref={seamRef} aria-hidden="true" />
                {!ready && !failed && (
                    <p className="reader-opening ui-p ui-p--soft">Opening…</p>
                )}
                {/* The tick itself: 2px of accent on the page's trailing edge,
                    visible with the chrome hidden, which is the point of it —
                    the reader can see the page is kept while reading it. */}
                {ticked && <span className="reader-tick" aria-hidden="true" />}
                {sel && (
                    <SelectionMenu
                        anchor={sel.anchor}
                        bounds={{ width: paneW, height: stageRef.current?.clientHeight ?? 0 }}
                        tint={sel.mark?.color ?? null}
                        hasNote={Boolean(sel.mark?.note)}
                        onTint={onTint}
                        onNote={() => void onNote()}
                        onCopy={onCopy}
                        onLookUp={() => lookUp(sel.mark?.text ?? flatten(selRange.current?.toString() ?? ''))}
                        onFind={() => findText(sel.mark?.text ?? flatten(selRange.current?.toString() ?? ''))}
                        onRemove={sel.mark ? onRemoveSel : undefined}
                        onDismiss={() => { setSel(null); viewRef.current?.deselect?.() }}
                    />
                )}
            </div>

            {chrome && sheetOpen && (
                <Sheet
                    settings={cfg}
                    lang={firstLang(viewRef.current?.book?.metadata?.language)}
                    measureBites={measureBites}
                    emMeasure={emMeasure}
                    onLive={onLive}
                    onSet={onSet}
                />
            )}

            {chrome && gotoOpen && (
                <section className="sheet" aria-label="Go to a place in the book">
                    <GoTo
                        at={readout?.fraction ?? 0}
                        onGo={f => {
                            setGotoOpen(false)
                            void viewRef.current?.goToFraction(f)
                        }}
                    />
                </section>
            )}

            {chrome && (
                <footer className="reader-bar reader-bar--bottom">
                    {/* The readout is centred on the window, so the button on
                        the trailing edge is balanced by its own width on the
                        leading one — the same arrangement that centres the
                        title between two buttons in the head. */}
                    <button
                        type="button"
                        className="reader-btn"
                        aria-label="Contents, marks and search"
                        aria-expanded={panelOpen}
                        onClick={() => {
                            setGotoOpen(false)
                            if (panelOpen) { setPanelOpen(false); return }
                            openPanel(panelTab)
                        }}
                    >
                        <ContentsIcon />
                    </button>
                    {/* The readout is the obvious place to reach for when you
                        want to be somewhere else in the book — it is the thing
                        that tells you where you are — so it is the control that
                        opens the jump, not a line of text beside one. */}
                    <button
                        type="button"
                        className="reader-readout"
                        aria-label="Where you are — press to go somewhere else in the book"
                        aria-expanded={gotoOpen}
                        onClick={() => {
                            setGotoOpen(o => !o)
                            setSheetOpen(false)
                            setPanelOpen(false)
                        }}
                    >
                        {readout ? (
                            <>
                                <span>Page {readout.page} of {readout.pages}</span>
                                {readout.chapter && <span className="reader-readout-sep">·</span>}
                                {readout.chapter && <span className="reader-chapter">{readout.chapter}</span>}
                                <span className="reader-readout-sep">·</span>
                                <span>{percent(readout.fraction)}%</span>
                            </>
                        ) : <span>&nbsp;</span>}
                    </button>
                    <button
                        type="button"
                        className="reader-btn"
                        aria-label="Text and page settings"
                        aria-expanded={sheetOpen}
                        onClick={() => { setSheetOpen(o => !o); setPanelOpen(false); setGotoOpen(false) }}
                    >
                        <TypeIcon />
                    </button>
                </footer>
            )}

            {panelOpen && (
                <Panel
                    tocNode={
                        toc.length === 0 ? (
                            <GoTo
                                at={readout?.fraction ?? 0}
                                note="This book carries no contents list, so there are no chapters to jump between. Move through it by proportion instead."
                                onGo={f => {
                                    setPanelOpen(false)
                                    void viewRef.current?.goToFraction(f)
                                }}
                            />
                        ) : (
                            <ol className="reader-toc-list">
                                {toc.map((item, i) => (
                                    <TocRow
                                        key={`${item.href ?? i}-${i}`}
                                        item={item}
                                        depth={0}
                                        onGo={href => {
                                            setPanelOpen(false)
                                            void viewRef.current?.goTo(href)
                                        }}
                                    />
                                ))}
                            </ol>
                        )
                    }
                    annotations={annotations}
                    bookmarks={bookmarks}
                    tints={paint.solid}
                    request={panelReq}
                    initialTab={panelTab}
                    search={runSearch}
                    clearSearch={stopSearch}
                    onGoCFI={cfi => {
                        setPanelOpen(false)
                        void viewRef.current?.goTo(cfi)
                    }}
                    onEditNote={a => { setPanelOpen(false); setNoteFor(a) }}
                    onRemoveAnnotation={a => void removeAnnotation(a.id)}
                    onRemoveBookmark={b => void removeBookmark(b.id)}
                    onExport={() => { setPanelOpen(false); setExportOpen(true) }}
                    onClose={() => { setPanelOpen(false); stopSearch() }}
                />
            )}

            {noteFor && (
                <NoteEditor
                    mark={noteFor}
                    onChange={note => void setNote(noteFor.id, note)}
                    onRemove={() => { const m = noteFor; setNoteFor(null); void removeAnnotation(m.id) }}
                    onClose={() => setNoteFor(null)}
                />
            )}

            {exportOpen && (
                <ExportSheet
                    input={{
                        title: book?.title ?? 'Book',
                        author: book?.author ?? null,
                        highlights: annotations,
                        bookmarks,
                    }}
                    onClose={() => setExportOpen(false)}
                />
            )}
        </main>
    )
}

/* What stands where the contents list would be, for a book that carries none.

   Plenty of files have no navigation document at all — a plain .txt, a
   Markdown export, a hand-made EPUB — and until now the Contents tab said so
   and stopped there, which left the end of the book reachable only by turning
   every page to it.

   PROPORTION, NOT PAGINATION. What this offers is a place to jump TO, and it
   is deliberately not a page number: a reflowable book has no stable page
   count, and DESIGN.md forbids pretending otherwise. Nothing here is ever
   stored either — the jump lands, the engine reports a locator, and the
   position written to the record is that locator's CFI, exactly as it is after
   a page turn. The percentage is a control, not a representation of where the
   reader is kept.

   The slider seeds from the current position and then stops listening to it,
   because the only thing that would move it while it is on screen is the
   reader's own arrival — and a control that jumps under a thumb that is
   dragging it is worse than one that is briefly stale. It is mounted with the
   panel, so opening the panel again re-seeds it. */
function GoTo({ at, onGo, note }: {
    at: number
    onGo: (fraction: number) => void
    note?: string
}) {
    const [pc, setPc] = useState(() => Math.round(clamp01(at) * 100))
    /* Until the reader touches the control it follows the book: the sheet can
       be left open while pages turn, and a slider showing where you WERE while
       the readout above it shows where you ARE is worse than no slider. Once
       they have moved it, it is theirs, and the book no longer overwrites it. */
    const touched = useRef(false)
    const seeded = Math.round(clamp01(at) * 100)
    useEffect(() => {
        if (touched.current) return
        setPc(seeded)
    }, [seeded])
    /* The typed field keeps its own string so a half-typed or empty value is
       allowed to exist — bound straight to the number, clearing the field would
       rewrite it as "0" under the caret. The NUMBER still updates on every
       keystroke that parses, so the control never waits for Enter to agree with
       what is on screen: measured on a real keypress, Return never reached this
       component, and a field that only commits on a key the page eats is a
       field that does nothing. */
    const [typed, setTyped] = useState<string | null>(null)

    function onType(raw: string) {
        setTyped(raw)
        const n = Number(raw)
        if (raw.trim() === '' || !Number.isFinite(n)) return
        touched.current = true
        setPc(Math.min(100, Math.max(0, Math.round(n))))
    }

    function commitTyped(raw: string) {
        touched.current = true
        const n = Math.round(Number(raw))
        setTyped(null)
        if (!Number.isFinite(n)) return
        setPc(Math.min(100, Math.max(0, n)))
    }

    return (
        <div className="reader-goto">
            {note && <p className="ui-p ui-p--soft">{note}</p>}
            <div className="ctl">
                <p className="ctl-head">
                    <label className="ctl-lbl" htmlFor="goto-pc">Position</label>
                    <span className="reader-goto-num">
                        <input
                            id="goto-pc"
                            className="reader-goto-field"
                            type="number"
                            inputMode="numeric"
                            min={0} max={100} step={1}
                            value={typed ?? String(pc)}
                            aria-label="Position in the book, in percent"
                            onChange={e => onType(e.currentTarget.value)}
                            onBlur={e => commitTyped(e.currentTarget.value)}
                            onKeyDown={e => {
                                if (e.key !== 'Enter') return
                                e.preventDefault()
                                commitTyped(e.currentTarget.value)
                            }}
                        />
                        <span aria-hidden="true">%</span>
                    </span>
                </p>
                <div className="rng-wrap">
                    <input
                        type="range"
                        className="rng"
                        min={0} max={100} step={1} value={pc}
                        aria-label="Position in the book"
                        aria-valuetext={`${pc} percent`}
                        style={{ ['--p' as string]: String(pc / 100) }}
                        onChange={e => {
                            touched.current = true
                            setTyped(null)
                            setPc(Number(e.currentTarget.value))
                        }}
                    />
                </div>
                {/* Commit on a press, never on the drag. Every intermediate
                    value of a drag is a whole re-layout of the book at a new
                    place in it, and the reader did not ask to go to any of
                    them. */}
                <div className="reader-goto-acts">
                    <button type="button" className="btn" onClick={() => onGo(clamp01(pc / 100))}>
                        Go to {pc}%
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => onGo(0)}>
                        Beginning
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => onGo(1)}>
                        End
                    </button>
                </div>
            </div>
        </div>
    )
}
function clamp01(n: number): number {
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

function TocRow({ item, depth, onGo }: {
    item: FoliateTOCItem
    depth: number
    onGo: (href: string) => void
}) {
    return (
        <li className="reader-toc-item" data-depth={Math.min(depth, 3)}>
            <button
                type="button"
                className="reader-toc-link"
                disabled={!item.href}
                onClick={() => item.href && onGo(item.href)}
            >
                {item.label?.trim() || 'Untitled'}
            </button>
            {item.subitems?.length ? (
                <ol className="reader-toc-list">
                    {item.subitems.map((sub, i) => (
                        <TocRow key={`${sub.href ?? i}-${i}`} item={sub} depth={depth + 1} onGo={onGo} />
                    ))}
                </ol>
            ) : null}
        </li>
    )
}

/* The engine's element, typed at the one place it is created. `foliate-view`
   is a custom element, so `createElement` returns HTMLElement and the cast is
   unavoidable; naming the shape here keeps the cast honest. */
type FoliateViewElement = HTMLElement & {
    book?: FoliateBook
    renderer?: FoliateRenderer
    /* Either a file to sniff, or an already-built book object — the engine
       accepts both, which is how the three text formats get in without a
       patch to the vendored tree. `object` rather than a named shape because
       the only caller passes exactly what reader/textBook.ts returns. */
    open(file: File | Blob | string | object): Promise<void>
    close?(): void
    init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
    goTo(target: unknown): Promise<void>
    goToFraction(fraction: number): Promise<void>
    /* P3. `getCFI` is how a selection becomes a position; the annotation pair
       is how a stored mark becomes paint on the page. `search` is an async
       generator over the whole book, and `clearSearch` drops every match the
       last one drew. */
    getCFI(index: number, range: Range): string
    addAnnotation(a: { value: string }, remove?: boolean): Promise<unknown>
    deleteAnnotation(a: { value: string }): Promise<unknown>
    search(opts: Record<string, unknown>): AsyncIterable<unknown>
    clearSearch(): void
    deselect?(): void
}

type TurnConfigShape = {
    turn: 'slide' | 'fade' | 'instant'
    rtl: boolean
    tapToTurn: boolean
    paginated: boolean
    reducedMotion: boolean
}

/** An EPUB may declare several languages. The first is the primary one, and it
    is the one hyphenation and tracking are gated on. */
/* ── where a menu goes ────────────────────────────────────────────────────
   A selection lives inside an iframe, so its rects are in the iframe's
   viewport. The menu lives in the host, over the stage. `frameElement` is what
   bridges the two, and it is reachable because paginator.js:244 keeps the
   frame same-origin.

   The filter is the part worth explaining: a selection that crosses a column
   break has rects on two pages, and unioning all of them puts the menu in the
   gutter between them, pointing at neither. Keeping only the rects on the page
   the selection STARTED on is what makes the menu appear beside the words the
   reader actually dragged over. */
/** Is the caret this selection collapsed to sitting inside `range`?
    `comparePoint` returns 0 for a point within the range, and throws when the
    point is in another document — which is exactly the case where the answer is
    no, so the throw is the answer. */
function inRange(range: Range | null, sel: Selection | null | undefined): boolean {
    if (!range || !sel || sel.rangeCount === 0) return false
    const caret = sel.getRangeAt(0)
    try {
        return range.comparePoint(caret.startContainer, caret.startOffset) === 0
    } catch {
        return false
    }
}

function anchorFor(range: Range, doc: Document, stage: HTMLElement | null, pageSize: number): SelAnchor | null {
    const rects = Array.from(range.getClientRects()).filter(r => r.width || r.height)
    if (rects.length === 0 || !stage) return null
    const win = doc.defaultView as (Window & { frameElement?: Element | null }) | null
    const frame = win?.frameElement?.getBoundingClientRect()
    const box = stage.getBoundingClientRect()
    if (!frame) return null
    const dx = frame.left - box.left
    const dy = frame.top - box.top
    const home = pageSize > 0 ? Math.floor((rects[0].left + 1) / pageSize) : 0
    const here = pageSize > 0
        ? rects.filter(r => Math.floor((r.left + 1) / pageSize) === home)
        : rects
    const on = here.length > 0 ? here : rects
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
    for (const r of on) {
        left = Math.min(left, r.left); right = Math.max(right, r.right)
        top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom)
    }
    return { x: (left + right) / 2 + dx, top: top + dy, bottom: bottom + dy }
}

/* The excerpt a bookmark carries. A bookmark is a place, not a quotation, so
   the opening words of the page are enough to recognise it by in a list.

   The whole section's text would be wrong — that is the first words of the
   CHAPTER, which for a bookmark thirty pages in reads as an obvious lie. So the
   text nodes are walked and the first one whose box falls inside the visible
   column wins.

   Two things about that column, both measured rather than assumed, and both
   wrong here until an audit caught them:

   · The document has to be handed in. foliate's shadow roots are CLOSED
     (`view.js`, `paginator.js`, `fixed-layout.js` all pass `mode: 'closed'`),
     so the frame cannot be reached from the host at all and the old
     `stage.querySelector('iframe')` returned null on every call — every
     bookmark carried an empty excerpt.

   · The visible column is [start - size, start), NOT [start, start + size).
     `expand()` pads the strip with one blank page of slack at EACH end, so a
     scrollLeft of one page-width is the first real column. Read the other way
     the excerpt came off the page after the one being bookmarked.

   Client rects inside the frame are already strip coordinates: the frame is as
   wide as the whole multi-column strip and never scrolls — the container does. */
function firstWords(doc: Document | null, start: number, size: number): string {
    if (!doc?.body) return ''
    if (size <= 0) return (doc.body.textContent ?? '').trim().slice(0, 180)
    const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    const out: string[] = []
    let seen = 0
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = n.nodeValue?.trim()
        if (!text) continue
        if (out.length === 0) {
            const range = doc.createRange()
            range.selectNodeContents(n)
            const r = range.getClientRects()[0]
            /* Skip everything that ends before this page begins. The +1 mirrors
               the nudge the overlay uses, so a glyph sitting exactly on the
               boundary is counted on the page it is drawn on. */
            if (!r || r.right + 1 < start - size || r.left + 1 >= start) continue
        }
        out.push(text)
        seen += text.length
        if (seen >= 180) break
    }
    return out.join(' ').slice(0, 180)
}

function firstLang(lang: string | string[] | null | undefined): string | null {
    if (Array.isArray(lang)) return lang[0] ?? null
    return lang ?? null
}

function message(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err)
    if (/unsupported/i.test(raw)) return 'This app does not read that format.'
    if (/not found/i.test(raw)) return 'The file is empty or missing.'
    /* The parser's own words are more use than a shrug, and a reader who
       reports a broken book can quote them. */
    return raw || 'The file could not be parsed.'
}
