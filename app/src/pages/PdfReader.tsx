/* ─────────────────────────────────────────────────────────────
   The reading page for a fixed document.

   The same chrome as Reader.tsx — the same bars, the same readout, the
   same panel, the same sheet row that shrinks the pane rather than
   covering it — over a different surface. That is deliberate: a reader
   who opens a PDF after an EPUB should not have to learn a second app.

   What is genuinely different is stated where a reader can see it rather
   than hidden behind a disabled control:

     · no type controls at all (PdfSheet.tsx says why),
     · no highlights and no notes — a fixed page has no CFI to anchor one
       to, so the tints and the Note action are absent from the selection
       menu and the marks list holds bookmarks only,
     · a continuous scroll instead of a turn, because a page that cannot
       reflow cannot be re-broken into a page that fits the screen.

   The position is `pdf:<page>:<fraction>` in the same locators row a
   CFI would use. It is the same principle, not a compromise on it: the
   page number IS the content anchor on a document whose pages cannot
   move, and the pair survives a change of zoom, of fit and of screen.
   ───────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, saveSettings, touchBook, useSettings } from '../db'
import { fetchBookFile } from '../sync/sync'
import type { Bookmark, Settings } from '../types'
import { percent } from '../lib'
import { BackIcon, BookmarkIcon, ContentsIcon, TypeIcon } from '../components/icons'
import { readPaint } from '../reader/marks'
import {
    addBookmark, flatten, parsePdfFound, parsePdfLocator, removeBookmark, sortByPosition,
} from '../reader/marks'
import { ReadingClock } from '../reader/clock'
import { Panel } from '../reader/Panel'
import type { PanelRequest, SearchYield } from '../reader/Panel'
import { SelectionMenu } from '../reader/SelectionMenu'
import type { SelAnchor } from '../reader/SelectionMenu'
import { ExportSheet } from '../reader/ExportSheet'
import { PdfSheet } from '../reader/pdf/PdfSheet'
import { PdfView } from '../reader/pdf/PdfView'
import type { PdfFound, PdfLocation, PdfViewHandle } from '../reader/pdf/PdfView'
import { getPage, openPdf, pageText, PdfRefused, searchPage } from '../reader/pdf/engine'
import type { PdfDoc, PdfOutlineItem } from '../reader/pdf/engine'

/** The outline, flattened once with its depth, because the contents list wants
    a flat list of rows and a PDF outline can nest four deep. */
type Line = { label: string; page: number | null; depth: number }

function flattenOutline(items: PdfOutlineItem[], depth = 0, out: Line[] = []): Line[] {
    for (const it of items) {
        out.push({ label: it.label, page: it.page, depth })
        if (it.items.length) flattenOutline(it.items, depth + 1, out)
    }
    return out
}

/** Which outline entry the reader is inside. The nearest entry at or before
    this page — the same question the chapter half of the readout answers on a
    reflowable book, asked of a document that numbers its pages instead. */
function chapterAt(lines: Line[], page: number): string | null {
    let best: string | null = null
    for (const l of lines) {
        if (l.page !== null && l.page <= page) best = l.label
        else if (l.page !== null && l.page > page) break
    }
    return best
}

/* TWO DIFFERENT FAILURES, and telling them apart is the whole point. No row
   means the book was deleted — nothing to do about that. A row with no bytes
   means the book came from another device and its file has not been carried
   across yet.

   That second one is not shown until it has been earned: opening a book whose
   bytes are missing fetches that one file from Drive first, ahead of the
   background queue, because the reader is looking at the book they just
   tapped rather than at a shelf. This sentence is what is left when that
   fetch itself fails. */
const missing = (row: boolean) =>
    row
        ? 'This book came from another device, and its file has not reached this one yet. Flyleaf just tried to fetch it and could not — check the connection, or that “Carry the book files too” is still on in Settings. Opening the file here again also works.'
        : 'That book is not in this library any more.'

export function PdfReader() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const settings = useSettings()
    const book = useLiveQuery(() => (id ? db.books.get(id) : undefined), [id])
    const cfg: Settings = settings ?? DEFAULT_SETTINGS

    const stageRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<PdfViewHandle | null>(null)
    const docRef = useRef<PdfDoc | null>(null)
    const clockRef = useRef<ReadingClock | null>(null)

    const [doc, setDoc] = useState<PdfDoc | null>(null)
    const [start, setStart] = useState<PdfLocation | null>(null)
    const [failed, setFailed] = useState<string | null>(null)
    const [ready, setReady] = useState(false)

    const [chrome, setChrome] = useState(false)
    const [sheetOpen, setSheetOpen] = useState(false)
    const [panelOpen, setPanelOpen] = useState(false)
    const [panelTab, setPanelTab] = useState<'contents' | 'marks'>('contents')
    const [panelReq, setPanelReq] = useState<PanelRequest | null>(null)
    const [sel, setSel] = useState<SelAnchor | null>(null)
    const [exportOpen, setExportOpen] = useState(false)
    const [at, setAt] = useState<PdfLocation>({ page: 1, fraction: 0 })
    /* The one search hit the reader tapped. It belongs to the search and dies
       with it, the same as the reflowable reader's found rule. */
    const [found, setFound] = useState<PdfFound | null>(null)
    const [zoom, setZoom] = useState(1)
    const [paneW, setPaneW] = useState(0)

    /* Read inside handlers registered once. */
    const atRef = useRef(at)
    atRef.current = at
    const chromeRef = useRef(false)

    const bookmarks = useLiveQuery(async () => {
        if (!id) return [] as Bookmark[]
        return sortByPosition(await db.bookmarks.where('bookId').equals(id).toArray())
    }, [id]) ?? []

    const lines = doc ? flattenOutline(doc.outline) : []
    const chapter = chapterAt(lines, at.page)
    const ticked = bookmarks.some(b => parsePdfLocator(b.cfi)?.page === at.page)

    /* ── open ─────────────────────────────────────────────────────────────
       Once per book id. Everything the scroller needs to lay the whole
       document out — the page count and every page's size — is read here, so
       no scroll ever waits on a measurement. */
    useEffect(() => {
        if (!id) return
        let live = true
        let opened: PdfDoc | null = null
        void (async () => {
            let [rec, meta, locator] = await Promise.all([
                db.files.get(id), db.books.get(id), db.locators.get(id),
            ])
            if (!live) return
            /* The row is here and the bytes are not — see Reader.tsx. */
            if (!rec && meta) {
                if (await fetchBookFile(id)) rec = await db.files.get(id)
                if (!live) return
            }
            if (!rec || !meta) { setFailed(missing(!!meta)); return }
            try {
                opened = await openPdf(new Blob([rec.data], { type: rec.type }))
                if (!live) { opened.close(); return }
                const where = locator ? parsePdfLocator(locator.cfi) : null
                setStart(where
                    ? { page: Math.min(where.page, opened.pages), fraction: where.fraction }
                    : { page: 1, fraction: 0 })
                docRef.current = opened
                setDoc(opened)
                void touchBook(id)
            } catch (err) {
                if (!live) return
                /* A refusal is a sentence written to a person — an encrypted
                   file is not a broken one, and saying "malformed" about it
                   would send the reader looking for a fault that is not there. */
                setFailed(err instanceof PdfRefused
                    ? err.message
                    : (err instanceof Error ? err.message : 'This file could not be opened.'))
            }
        })()
        return () => {
            live = false
            docRef.current = null
            setDoc(null)
            setReady(false)
            opened?.close()
        }
    }, [id])

    useEffect(() => {
        if (!id) return
        const clock = new ReadingClock(id)
        clockRef.current = clock
        return () => { clock.stop(); clockRef.current = null }
    }, [id])

    /* The pane the selection menu is clamped inside. One observer, and the only
       place a layout property of the stage is read. */
    useEffect(() => {
        const stage = stageRef.current
        if (!stage) return
        const ro = new ResizeObserver(() => setPaneW(stage.clientWidth))
        ro.observe(stage)
        setPaneW(stage.clientWidth)
        return () => ro.disconnect()
    }, [doc])

    const toggleChrome = useCallback(() => {
        stopSearch()
        chromeRef.current = !chromeRef.current
        setChrome(chromeRef.current)
        if (!chromeRef.current) { setPanelOpen(false); setSheetOpen(false); setExportOpen(false) }
    }, [])

    /* ── where we are ─────────────────────────────────────────────────────
       The scroller reports on every frame it settles; the write is debounced,
       because a flick through forty pages is forty positions and one place the
       reader ended up. Same 600ms as the reflowable reader. */
    const writeTimer = useRef<number | null>(null)
    const onLocate = useCallback((where: PdfLocation) => {
        setAt(where)
        if (!id) return
        const pages = docRef.current?.pages ?? 1
        const fraction = Math.min(1, (where.page - 1 + where.fraction) / pages)
        clockRef.current?.bump(fraction, true)
        if (writeTimer.current) clearTimeout(writeTimer.current)
        writeTimer.current = window.setTimeout(() => {
            void db.locators.put({
                bookId: id,
                cfi: `pdf:${where.page}:${where.fraction.toFixed(4)}`,
                fraction,
                chapter: null,
                updatedAt: Date.now(),
            })
            const now = Date.now()
            void db.books.update(id, { progress: fraction, openedAt: now, editedAt: now })
        }, 600)
    }, [id])
    useEffect(() => () => { if (writeTimer.current) clearTimeout(writeTimer.current) }, [])

    /* ── selection ────────────────────────────────────────────────────────
       The text layer is real DOM in this document, not an iframe, so one
       listener on `document` covers it. Debounced for the same reason as the
       reflowable reader: dragging a selection handle fires on every pixel, and
       a menu that re-anchors on every pixel is never where the finger let go. */
    const selTimer = useRef<number | null>(null)
    useEffect(() => {
        if (!doc) return
        const settle = () => {
            const s = document.getSelection()
            const stage = stageRef.current
            if (!s || s.isCollapsed || s.rangeCount === 0 || !stage) { setSel(null); return }
            const range = s.getRangeAt(0)
            const host = range.commonAncestorContainer
            const el = host.nodeType === 1 ? host as Element : host.parentElement
            if (!el?.closest('.pdf-text')) { setSel(null); return }
            const rects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1)
            if (!rects.length) { setSel(null); return }
            const box = stage.getBoundingClientRect()
            let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
            for (const r of rects) {
                left = Math.min(left, r.left); right = Math.max(right, r.right)
                top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom)
            }
            setSel({
                x: (left + right) / 2 - box.left,
                top: top - box.top,
                bottom: bottom - box.top,
            })
        }
        const onChange = () => {
            if (selTimer.current) clearTimeout(selTimer.current)
            selTimer.current = window.setTimeout(settle, 220)
        }
        document.addEventListener('selectionchange', onChange)
        return () => {
            document.removeEventListener('selectionchange', onChange)
            if (selTimer.current) clearTimeout(selTimer.current)
        }
    }, [doc])

    const selText = () => flatten(document.getSelection()?.toString() ?? '')
    const dropSel = () => { document.getSelection()?.removeAllRanges(); setSel(null) }

    const nonce = useRef(0)
    const ask = useCallback((kind: 'find' | 'lookup', text: string) => {
        setPanelReq({ kind, text, nonce: ++nonce.current })
        setPanelOpen(true)
        setSheetOpen(false)
        setSel(null)
        chromeRef.current = true
        setChrome(true)
    }, [])

    const openPanel = useCallback((tab: 'contents' | 'marks') => {
        setPanelTab(tab)
        setPanelOpen(true)
        setSheetOpen(false)
        setSel(null)
        chromeRef.current = true
        setChrome(true)
    }, [])

    /* ── the ribbon ───────────────────────────────────────────────────────
       A bookmark on a PDF is a page, which is what a bookmark always meant.
       The excerpt is the opening words of that page's own text — enough to
       recognise it by in a list, and honest about being a place rather than a
       quotation. A page of pure scan has no text and gets none. */
    const toggleTick = useCallback(async () => {
        const d = docRef.current
        if (!d || !id) return
        const page = atRef.current.page
        const had = bookmarks.find(b => parsePdfLocator(b.cfi)?.page === page)
        if (had) { await removeBookmark(had.id); return }
        let excerpt = ''
        try { excerpt = flatten(await pageText(await getPage(d.doc, page))).slice(0, 180) } catch { /* a scan */ }
        await addBookmark(id, `pdf:${page}:${atRef.current.fraction.toFixed(4)}`,
            excerpt || `Page ${page}`, chapterAt(flattenOutline(d.outline), page))
    }, [id, bookmarks])

    /* ── search ───────────────────────────────────────────────────────────
       The panel owns the query and the list; this owns the walk. A page at a
       time, yielding a group as soon as it has one, so a long document paints
       results while it is still being read. The token is the cancel: the panel
       drops late yields on its side, but the walk itself has to stop or a
       nine-hundred-page file keeps a worker busy after the panel is closed. */
    const searchToken = useRef(0)
    const runSearch = useCallback((query: string, wholeWords: boolean) => {
        const d = docRef.current
        const mine = ++searchToken.current
        async function* walk(): AsyncGenerator<SearchYield> {
            if (!d) return
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const re = new RegExp(wholeWords ? `\\b${escaped}\\b` : escaped, 'giu')
            for (let n = 1; n <= d.pages; n++) {
                if (searchToken.current !== mine) return
                let hits
                try { hits = await searchPage(await getPage(d.doc, n), re) } catch { continue }
                if (!hits.length) continue
                yield {
                    label: `Page ${n}`,
                    subitems: hits.map(h => ({
                        cfi: `pdf:${n}:${h.fraction.toFixed(4)}:${h.x.toFixed(4)}:${h.w.toFixed(4)}`,
                        excerpt: { pre: h.pre, match: h.match, post: h.post },
                    })),
                }
            }
            yield 'done'
        }
        return walk() as AsyncIterable<SearchYield>
    }, [])
    const stopSearch = useCallback(() => { searchToken.current++; setFound(null) }, [])

    const goTo = useCallback((cfi: string) => {
        const where = parsePdfLocator(cfi)
        if (where) viewRef.current?.goTo(where.page, where.fraction)
    }, [])

    /* Tapping a result. The rule goes under the words, and the scroll puts
       them a third of the way down rather than flush against the top edge,
       where the chrome sits and where a reader reads "it did not go". */
    const goToFound = useCallback((cfi: string) => {
        const run = parsePdfFound(cfi)
        if (!run) { goTo(cfi); return }
        setFound(run)
        viewRef.current?.goTo(run.page, run.fraction, true)
    }, [goTo])

    const onLive = useCallback((patch: Partial<Settings>) => {
        /* Nothing here restyles a document — the only live setting is the
           veil, and it is a custom property on the root. So "live" and "set"
           differ in exactly one thing: whether Dexie hears about it. */
        void patch
    }, [])
    const onSet = useCallback((patch: Partial<Settings>) => { void saveSettings(patch) }, [])

    if (failed) return (
        <main className="reader reader--message" data-stock={cfg.stock}>
            <div className="reader-message">
                <h1 className="ui-h">This book would not open</h1>
                <p className="ui-p ui-p--soft">{failed}</p>
                <Link className="btn" to={id ? `/book/${id}` : '/'}>Back to the book</Link>
            </div>
        </main>
    )

    return (
        <main
            className="reader reader--pdf"
            data-stock={cfg.stock}
            data-chrome={chrome ? 'open' : 'shut'}
            style={{ ['--pdf-veil-mul' as string]: String(cfg.pdfVeil) }}
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
                {!doc && !failed && <p className="reader-opening ui-p ui-p--soft">Opening…</p>}
                {ticked && <span className="reader-tick" aria-hidden="true" />}
                {doc && start && (
                    <PdfView
                        doc={doc}
                        fit={cfg.pdfFit}
                        start={start}
                        ref={viewRef}
                        onLocate={onLocate}
                        onReady={() => setReady(true)}
                        onTap={toggleChrome}
                        onZoom={setZoom}
                        found={found}
                    />
                )}
                {sel && (
                    <SelectionMenu
                        anchor={sel}
                        bounds={{ width: paneW, height: stageRef.current?.clientHeight ?? 0 }}
                        tint={null}
                        hasNote={false}
                        marks={false}
                        onTint={() => {}}
                        onNote={() => {}}
                        onCopy={() => {
                            const text = selText()
                            if (text) void navigator.clipboard?.writeText(text).catch(() => {})
                            dropSel()
                        }}
                        onLookUp={() => { const t = selText(); dropSel(); if (t) ask('lookup', t) }}
                        onFind={() => { const t = selText(); dropSel(); if (t) ask('find', t) }}
                        onDismiss={dropSel}
                    />
                )}
            </div>

            {chrome && sheetOpen && (
                <PdfSheet
                    settings={cfg}
                    zoom={zoom}
                    onZoom={dir => {
                        if (dir === 0) viewRef.current?.resetZoom()
                        else viewRef.current?.zoomBy(dir > 0 ? 1.25 : 1 / 1.25)
                    }}
                    onLive={onLive}
                    onSet={onSet}
                />
            )}

            {chrome && (
                <footer className="reader-bar reader-bar--bottom">
                    <button
                        type="button"
                        className="reader-btn"
                        aria-label="Contents, bookmarks and search"
                        aria-expanded={panelOpen}
                        onClick={() => {
                            if (panelOpen) { setPanelOpen(false); return }
                            openPanel(panelTab)
                        }}
                    >
                        <ContentsIcon />
                    </button>
                    {/* A PDF is the one book where a page number is a real page
                        number — the file's own, the same one the printed copy
                        has. So it is stated plainly, with no "of the pages your
                        settings happen to make" caveat behind it. */}
                    <p className="reader-readout">
                        {ready && doc ? (
                            <>
                                <span>Page {at.page} of {doc.pages}</span>
                                {chapter && <span className="reader-readout-sep">·</span>}
                                {chapter && <span className="reader-chapter">{chapter}</span>}
                                <span className="reader-readout-sep">·</span>
                                <span>{percent(Math.min(1, (at.page - 1 + at.fraction) / doc.pages))}%</span>
                            </>
                        ) : <span>&nbsp;</span>}
                    </p>
                    <button
                        type="button"
                        className="reader-btn"
                        aria-label="Page settings"
                        aria-expanded={sheetOpen}
                        onClick={() => { setSheetOpen(o => !o); setPanelOpen(false) }}
                    >
                        <TypeIcon />
                    </button>
                </footer>
            )}

            {panelOpen && (
                <Panel
                    tocNode={
                        <ol className="reader-toc-list">
                            {lines.length === 0 && (
                                <li className="reader-toc-empty ui-p ui-p--soft">
                                    This document carries no outline.
                                </li>
                            )}
                            {lines.map((l, i) => (
                                <li
                                    key={`${l.label}-${i}`}
                                    className="reader-toc-item"
                                    data-depth={Math.min(l.depth, 3)}
                                >
                                    <button
                                        type="button"
                                        className="reader-toc-link"
                                        disabled={l.page === null}
                                        onClick={() => {
                                            if (l.page === null) return
                                            setPanelOpen(false)
                                            viewRef.current?.goTo(l.page, 0)
                                        }}
                                    >
                                        {l.label.trim() || 'Untitled'}
                                    </button>
                                </li>
                            ))}
                        </ol>
                    }
                    annotations={[]}
                    bookmarks={bookmarks}
                    tints={readPaint(null).solid}
                    kinds={['bookmarks']}
                    request={panelReq}
                    initialTab={panelTab}
                    search={runSearch}
                    clearSearch={stopSearch}
                    onGoCFI={cfi => {
                        setPanelOpen(false)
                        goTo(cfi)
                    }}
                    onGoFound={cfi => {
                        setPanelOpen(false)
                        goToFound(cfi)
                    }}
                    onEditNote={() => {}}
                    onRemoveAnnotation={() => {}}
                    onRemoveBookmark={b => void removeBookmark(b.id)}
                    onExport={() => { setPanelOpen(false); setExportOpen(true) }}
                    onClose={() => { setPanelOpen(false); stopSearch() }}
                />
            )}

            {exportOpen && (
                <ExportSheet
                    input={{
                        title: book?.title ?? 'Book',
                        author: book?.author ?? null,
                        highlights: [],
                        bookmarks,
                    }}
                    onClose={() => setExportOpen(false)}
                />
            )}
        </main>
    )
}
