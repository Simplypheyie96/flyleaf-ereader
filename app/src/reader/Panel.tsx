/* ─────────────────────────────────────────────────────────────
   The reader's one panel: contents, marks, and search.

   Three things in one surface rather than three buttons in the chrome, and
   the reason is arithmetic. SPEC.md § 8 gives the reading page two controls
   per bar; contents, marks, search and the type sheet is four. So the head of
   this panel carries the search field and a two-tab segmented control, and the
   chrome keeps its two-and-two: Back · Ribbon above, Panel · Type below.

   Search is not a tab. When a query is live the tablist is replaced by the
   count — one strip, one job at a time — and clearing the field puts the tabs
   back. A tab that sometimes means "contents" and sometimes means "results"
   is the thing that makes a reader tap twice to find out where they are.
   ───────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Annotation, Bookmark, HighlightColor } from '../types'
import { groupByChapter, sortByPosition } from './marks'
import { CloseIcon, ExportIcon, FindIcon, MoreIcon, TrashIcon } from '../components/icons'

/* ── search plumbing ─────────────────────────────────────────────────────
   The generator is the engine's; this file only consumes it. Typed here
   rather than in foliate-js.d.ts because the shape of a yielded value is a
   contract between this panel and view.search, not part of the engine's
   public surface. */
export type SearchYield =
    | { progress: number }
    | { label: string; subitems: SearchHit[] }
    | { cfi: string; excerpt: Excerpt }
    | 'done'

export interface Excerpt { pre: string; match: string; post: string }
export interface SearchHit { cfi: string; excerpt: Excerpt }

/** What the reader asked for from outside the panel: "Find" or "Look up" on a
    selection. `nonce` is what makes the same word twice re-run the search. */
export interface PanelRequest {
    kind: 'find' | 'lookup'
    text: string
    nonce: number
}

export interface PanelProps {
    tocNode: ReactNode
    annotations: Annotation[]
    bookmarks: Bookmark[]
    /** Solid tint per colour id, read off the reader root — see marks.ts. */
    tints: Record<HighlightColor, string>
    request: PanelRequest | null
    /** Which tab to open on. Reset by the reader when it opens the panel. */
    initialTab?: 'contents' | 'marks'
    /** Which kinds of mark this surface can hold. A PDF passes
        `['bookmarks']`: a fixed page has no CFI to anchor a highlight to, so
        the highlights and notes tabs would be two permanently empty lists
        promising a feature that is not there. With one kind the tablist itself
        is absent — a tablist of one is not a control. */
    kinds?: Kind[]
    search: (query: string, wholeWords: boolean) => AsyncIterable<SearchYield>
    clearSearch: () => void
    onGoCFI: (cfi: string) => void
    onEditNote: (a: Annotation) => void
    onRemoveAnnotation: (a: Annotation) => void
    onRemoveBookmark: (b: Bookmark) => void
    onExport: () => void
    onClose: () => void
}

/* How many hits are on screen at once, and why there is a limit at all.
   Measured on the built app, 6× CPU throttle, "the" in Pride and Prejudice:
   7857 hits rendered 31,749 DOM nodes, took 13.7s to settle, and dropped three
   frames on a scroll with a 35ms worst frame. The same search capped renders a
   few hundred nodes. A one-word query nobody would type on purpose must not be
   able to lock up a phone, and every yield re-renders the whole list as the
   walk proceeds, so an uncapped list pays that cost once per chapter.

   Not a silent cap: the head already carries the true total, and the tail of
   the list says how many of them are showing and offers the next batch. */
const PAGE_OF_HITS = 300

type Group = { label: string; subitems: SearchHit[] }
type Kind = 'highlights' | 'notes' | 'bookmarks'
const ALL_KINDS: Kind[] = ['highlights', 'notes', 'bookmarks']

export function Panel(p: PanelProps) {
    const kinds = p.kinds ?? ALL_KINDS
    const [tab, setTab] = useState<'contents' | 'marks'>(p.initialTab ?? 'contents')
    /* Open on the kind that has something in it. The panel remounts on every
       open, so this runs once per open and never moves under the reader's
       thumb mid-session — but it does mean a reader whose only marks are
       bookmarks stops landing on an empty Highlights list, which is the app
       hiding the thing they just made. `kinds[0]` when everything is empty:
       with nothing to show, the leftmost tab is the honest default. */
    const [kind, setKind] = useState<Kind>(() => {
        const has = (k: Kind) => k === 'bookmarks' ? p.bookmarks.length > 0
            : k === 'notes' ? p.annotations.some(a => a.note)
                : p.annotations.length > 0
        return kinds.find(has) ?? kinds[0]
    })

    const [query, setQuery] = useState('')
    /* The query the results on screen belong to, so a half-typed field never
       looks like it found nothing. */
    const [ran, setRan] = useState('')
    const [lookup, setLookup] = useState(false)
    const [groups, setGroups] = useState<Group[]>([])
    const [busy, setBusy] = useState(false)
    const [limit, setLimit] = useState(PAGE_OF_HITS)
    const fieldRef = useRef<HTMLInputElement | null>(null)

    /* ── a request from the selection menu ────────────────────────────────
       "Find" seeds the field and searches as typed. "Look up" is the
       concordance: the same search, whole words only, and a head that says
       what it is. SPEC.md § 6.5. */
    useEffect(() => {
        if (!p.request) return
        setQuery(p.request.text)
        setLookup(p.request.kind === 'lookup')
        void run(p.request.text, p.request.kind === 'lookup')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [p.request?.nonce])

    /* One search at a time. A second one cancels the first by bumping the
       token: the generator keeps going for one more section and its yields are
       then dropped, which is cheaper than trying to abort it and cannot leave
       a half-drawn set of margin ticks behind. */
    const token = useRef(0)
    async function run(q: string, whole: boolean) {
        const mine = ++token.current
        const trimmed = q.trim()
        setGroups([])
        setLimit(PAGE_OF_HITS)
        setRan(trimmed)
        if (!trimmed) { p.clearSearch(); setBusy(false); return }
        setBusy(true)
        const found: Group[] = []
        try {
            for await (const r of p.search(trimmed, whole)) {
                if (token.current !== mine) return
                if (r === 'done') break
                if ('subitems' in r) {
                    found.push({ label: r.label, subitems: r.subitems })
                    /* A new array each time: the list has to paint as the
                       search walks the book, or a long book looks frozen. */
                    setGroups(found.slice())
                }
            }
        } finally {
            if (token.current === mine) setBusy(false)
        }
    }

    function clearQuery() {
        token.current++
        setQuery('')
        setRan('')
        setLookup(false)
        setGroups([])
        setLimit(PAGE_OF_HITS)
        setBusy(false)
        p.clearSearch()
        fieldRef.current?.focus()
    }

    const hits = groups.reduce((n, g) => n + g.subitems.length, 0)
    const searching = ran.length > 0

    return (
        <aside className="reader-panel" aria-label="Contents, marks and search">
            <div className="panel-head">
                {/* The only way out. The panel fills the reading area, and
                    since the chrome started floating that area is the whole
                    viewport — so the panel paints over the very button that
                    opened it (z-index 6 against the bar's 4) and a tap inside
                    the panel is deliberately ignored by the chrome toggle.
                    Escape closed it, which is no help at all on a phone:
                    measured, the Contents button's own centre resolved to a
                    .reader-toc-link, so the reader's only exit was to pick a
                    chapter they did not want. */}
                <div className="panel-bar">
                    <button type="button" className="panel-done" onClick={p.onClose}>
                        Done
                    </button>
                </div>
                <div className="panel-find">
                    <span className="panel-find-icon" aria-hidden="true"><FindIcon /></span>
                    <input
                        ref={fieldRef}
                        className="panel-find-field"
                        type="search"
                        value={query}
                        placeholder="Find in this book"
                        aria-label="Find in this book"
                        enterKeyHint="search"
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); void run(query, lookup) }
                            if (e.key === 'Escape' && query) { e.preventDefault(); clearQuery() }
                        }}
                    />
                    {query && (
                        <button
                            type="button"
                            className="panel-find-clear"
                            aria-label="Clear the search"
                            onClick={clearQuery}
                        >
                            <CloseIcon />
                        </button>
                    )}
                </div>

                {searching ? (
                    <p className="panel-count">
                        <span className="mono">{busy ? '…' : hits}</span>
                        {' '}
                        {lookup
                            ? <>{hits === 1 ? 'place' : 'places'} “{ran}” appears</>
                            : <>{hits === 1 ? 'match' : 'matches'}</>}
                        {lookup && !busy && navigator.onLine && (
                            /* The only row in this app that leaves it, labelled
                               as leaving it, and absent entirely offline.
                               SPEC.md § 6.5. */
                            <a
                                className="panel-out"
                                href={`https://en.wiktionary.org/wiki/${encodeURIComponent(ran.toLowerCase())}`}
                                target="_blank"
                                rel="noreferrer noopener"
                            >
                                Wiktionary ↗
                            </a>
                        )}
                    </p>
                ) : (
                    <div className="panel-tabs" role="tablist" aria-label="Panel">
                        <button
                            type="button" role="tab" className="panel-tab"
                            aria-selected={tab === 'contents'}
                            onClick={() => setTab('contents')}
                        >Contents</button>
                        <button
                            type="button" role="tab" className="panel-tab"
                            aria-selected={tab === 'marks'}
                            onClick={() => setTab('marks')}
                        >Marks</button>
                    </div>
                )}
            </div>

            <div className="panel-body">
                {searching
                    ? <Results
                        groups={groups} busy={busy} hits={hits}
                        limit={limit} onMore={() => setLimit(n => n + PAGE_OF_HITS)}
                        onGo={p.onGoCFI}
                    />
                    : tab === 'contents'
                        ? p.tocNode
                        : (
                            <Marks
                                kind={kind} setKind={setKind} kinds={kinds}
                                annotations={p.annotations} bookmarks={p.bookmarks}
                                tints={p.tints}
                                onGo={p.onGoCFI}
                                onEditNote={p.onEditNote}
                                onRemoveAnnotation={p.onRemoveAnnotation}
                                onRemoveBookmark={p.onRemoveBookmark}
                                onExport={p.onExport}
                            />
                        )}
            </div>
        </aside>
    )
}

/* ── search results ─────────────────────────────────────────────────────── */

function Results({ groups, busy, hits, limit, onMore, onGo }: {
    groups: Group[]
    busy: boolean
    hits: number
    limit: number
    onMore: () => void
    onGo: (cfi: string) => void
}) {
    /* The first `limit` hits, in book order, with their chapter heads intact —
       so the cap cuts the tail of the list and never the middle of a chapter's
       run. A group that falls entirely past the cap is not rendered at all,
       which is what keeps the node count flat rather than the row count. */
    const shown = useMemo(() => {
        let left = limit
        const out: Group[] = []
        for (const g of groups) {
            if (left <= 0) break
            const subitems = g.subitems.length <= left ? g.subitems : g.subitems.slice(0, left)
            left -= subitems.length
            out.push({ label: g.label, subitems })
        }
        return out
    }, [groups, limit])

    if (!groups.length) return (
        <p className="panel-empty ui-p ui-p--soft">
            {busy ? 'Reading the book…' : 'Nothing in this book matches that.'}
        </p>
    )
    return (
        <ol className="panel-list">
            {shown.map((g, gi) => (
                <li key={`${g.label}-${gi}`} className="panel-group">
                    <p className="panel-group-head">
                        <span className="panel-group-label">{g.label || 'Elsewhere'}</span>
                        <span className="mono panel-group-count">{g.subitems.length}</span>
                    </p>
                    <ol className="panel-list">
                        {g.subitems.map(hit => (
                            <li key={hit.cfi}>
                                <button type="button" className="panel-row" onClick={() => onGo(hit.cfi)}>
                                    <span className="panel-excerpt panel-excerpt--find">
                                        {hit.excerpt.pre}
                                        <span className="panel-hit">{hit.excerpt.match}</span>
                                        {hit.excerpt.post}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ol>
                </li>
            ))}
            {hits > limit && (
                <li className="panel-tail">
                    <p className="panel-tail-note">
                        <span className="mono">{limit.toLocaleString()}</span>
                        {' of '}
                        <span className="mono">{hits.toLocaleString()}</span>
                        {' showing'}
                    </p>
                    <button type="button" className="panel-export" onClick={onMore}>
                        Show {Math.min(PAGE_OF_HITS, hits - limit).toLocaleString()} more
                    </button>
                </li>
            )}
        </ol>
    )
}

/* ── marks ──────────────────────────────────────────────────────────────── */

function Marks(m: {
    kind: Kind
    setKind: (k: Kind) => void
    kinds: Kind[]
    annotations: Annotation[]
    bookmarks: Bookmark[]
    tints: Record<HighlightColor, string>
    onGo: (cfi: string) => void
    onEditNote: (a: Annotation) => void
    onRemoveAnnotation: (a: Annotation) => void
    onRemoveBookmark: (b: Bookmark) => void
    onExport: () => void
}) {
    const notes = useMemo(() => m.annotations.filter(a => a.note), [m.annotations])
    const counts = {
        highlights: m.annotations.length,
        notes: notes.length,
        bookmarks: m.bookmarks.length,
    }
    /* Two lists, not one of a union type. A bookmark has an excerpt and no
       tint; a highlight has text, a tint and maybe a note. Narrowing a mixed
       array back apart at render time is how a row ends up asking a bookmark
       for its colour. */
    const marks = useMemo(
        () => groupByChapter(m.kind === 'notes' ? notes : m.annotations),
        [m.kind, notes, m.annotations])
    const places = useMemo(() => groupByChapter(m.bookmarks), [m.bookmarks])
    const empty = m.kind === 'bookmarks' ? m.bookmarks.length === 0
        : m.kind === 'notes' ? notes.length === 0
            : m.annotations.length === 0

    return (
        <>
            {m.kinds.length > 1 && (
            <div className="panel-kinds" role="tablist" aria-label="Marks">
                {m.kinds.map(k => (
                    <button
                        key={k} type="button" role="tab" className="panel-kind"
                        aria-selected={m.kind === k}
                        onClick={() => m.setKind(k)}
                    >
                        <span>{k[0].toUpperCase()}{k.slice(1)}</span>
                        <span className="mono panel-kind-count">{counts[k]}</span>
                    </button>
                ))}
            </div>
            )}

            {empty ? (
                <p className="panel-empty ui-p ui-p--soft">
                    {m.kind === 'bookmarks'
                        ? 'No bookmarks yet. The ribbon at the top of the page keeps a place.'
                        : m.kind === 'notes'
                            ? 'No notes yet. Highlight a line, then write beside it.'
                            : 'No highlights yet. Select a line to mark it.'}
                </p>
            ) : m.kind === 'bookmarks' ? (
                <ol className="panel-list">
                    {places.map((g, gi) => (
                        <li key={`${g.chapter ?? ''}-${gi}`} className="panel-group">
                            <GroupHead chapter={g.chapter} count={g.items.length} />
                            <ol className="panel-list">
                                {g.items.map(b => (
                                    <MarkRow
                                        key={b.id}
                                        onGo={() => m.onGo(b.cfi)}
                                        onRemove={() => m.onRemoveBookmark(b)}
                                    >
                                        <span className="panel-excerpt">
                                            {b.excerpt || 'A place in the book'}
                                        </span>
                                    </MarkRow>
                                ))}
                            </ol>
                        </li>
                    ))}
                </ol>
            ) : (
                <ol className="panel-list">
                    {marks.map((g, gi) => (
                        <li key={`${g.chapter ?? ''}-${gi}`} className="panel-group">
                            <GroupHead chapter={g.chapter} count={g.items.length} />
                            <ol className="panel-list">
                                {g.items.map(a => (
                                    <MarkRow
                                        key={a.id}
                                        onGo={() => m.onGo(a.cfi)}
                                        onEdit={() => m.onEditNote(a)}
                                        onRemove={() => m.onRemoveAnnotation(a)}
                                    >
                                        <span
                                            className="panel-dot"
                                            aria-hidden="true"
                                            data-underline={a.color === 'underline' || undefined}
                                            style={{ background: m.tints[a.color] }}
                                        />
                                        <span className="panel-mark">
                                            <span className="panel-excerpt">{a.text}</span>
                                            {a.note && <span className="panel-note">{a.note}</span>}
                                        </span>
                                    </MarkRow>
                                ))}
                            </ol>
                        </li>
                    ))}
                </ol>
            )}

            {(m.annotations.length > 0 || m.bookmarks.length > 0) && (
                <div className="panel-foot">
                    <button type="button" className="panel-export" onClick={m.onExport}>
                        <ExportIcon />
                        <span>Export marks</span>
                    </button>
                </div>
            )}
        </>
    )
}

/** A chapter heading with its own count. Absent when the mark carries no
    chapter — a book with no contents list gets a flat list rather than an
    invented "Untitled" heading. */
function GroupHead({ chapter, count }: { chapter: string | null; count: number }) {
    if (!chapter) return null
    return (
        <p className="panel-group-head">
            <span className="panel-group-label">{chapter}</span>
            <span className="mono panel-group-count">{count}</span>
        </p>
    )
}

/** A row that jumps on tap, and carries its own edit/remove behind one
    discreet control. Long-press opens the same actions — the gesture readers
    expect — but the control is always there, because long-press alone is
    unreachable by keyboard and invisible to anyone who has not been told. */
function MarkRow({ children, onGo, onEdit, onRemove }: {
    children: ReactNode
    onGo: () => void
    onEdit?: () => void
    onRemove: () => void
}) {
    const [open, setOpen] = useState(false)
    const held = useRef(false)
    const timer = useRef<number | null>(null)

    const start = () => {
        held.current = false
        timer.current = window.setTimeout(() => { held.current = true; setOpen(true) }, 480)
    }
    const end = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

    return (
        <li className="panel-item" data-open={open || undefined}>
            <div className="panel-item-row">
                <button
                    type="button"
                    className="panel-row"
                    onPointerDown={start}
                    onPointerUp={end}
                    onPointerCancel={end}
                    onPointerLeave={end}
                    onContextMenu={e => { e.preventDefault(); setOpen(true) }}
                    /* The long-press already opened the actions; letting the
                       click through as well would jump the reader out of the
                       panel they just opened a menu in. */
                    onClick={() => { if (held.current) { held.current = false; return } onGo() }}
                >
                    {children}
                </button>
                <button
                    type="button"
                    className="panel-more"
                    aria-label={open ? 'Hide actions' : 'Actions for this mark'}
                    aria-expanded={open}
                    onClick={() => setOpen(o => !o)}
                >
                    <MoreIcon />
                </button>
            </div>
            {open && (
                <div className="panel-acts">
                    {onEdit && (
                        <button type="button" className="panel-act" onClick={() => { setOpen(false); onEdit() }}>
                            Edit note
                        </button>
                    )}
                    <button
                        type="button"
                        className="panel-act panel-act--drop"
                        onClick={() => { setOpen(false); onRemove() }}
                    >
                        <TrashIcon />
                        <span>Remove</span>
                    </button>
                </div>
            )}
        </li>
    )
}

/** Re-exported so the reader can sort without importing two modules for one
    list. */
export { sortByPosition }
