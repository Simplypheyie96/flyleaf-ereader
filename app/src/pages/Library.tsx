import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { createCollection, db, deleteCollection, renameCollection, useSettings } from '../db'
import { Mark } from '../components/Mark'
import { Cover } from '../components/Cover'
import { Picker } from '../components/Menu'
import {
  BackIcon, CheckIcon, CloseIcon, CollectionsIcon, EditIcon, GridIcon,
  ListIcon, PlusIcon, SearchIcon, SortIcon, TrashIcon,
} from '../components/icons'
import { FORMAT_LABEL, bytes, percent, remember, shortDate, stored } from '../lib'
import type { Book, Collection } from '../types'

/* The Library — the shelf, and nothing but the shelf.

   WHAT CHANGED AND WHY. This screen used to open with a Continue card, then a
   row of three filter chips, then a native sort dropdown and two view buttons,
   then a search field that only existed above twelve books. Five controls in
   two rows above the first cover, one of them invisible most of the time.

   Home owns Continue now, so the card is gone rather than duplicated. The three
   filter chips are gone too, but not deleted: "reading / want to read /
   finished" is exactly what a collection is, so they became the three built-in
   collections in the third view, which is where a reader looks for a subset of
   their shelf. That leaves one row of controls — a view switch and a sort — and
   a search field that is always there, because a library search that appears at
   the thirteenth book is a feature the reader concluded did not exist.

   THE THREE VIEWS. Grid and list are the same books, drawn differently.
   Collections is a different question: it shows shelves, and opening one puts
   its books back into whichever of grid/list the reader last used. Which is why
   `view` and `layout` are two pieces of state and not one — the switch is
   three-way, but "how a book is drawn" only has two answers, and forgetting
   that is how a reader who prefers the list gets a grid every time they come
   back out of a collection. */

/* One item per entry rather than one string of middots: the line wraps at
   every width this is read at, and a separator glyph that lands at a break
   dangles at the end of the line. The CSS spaces them — which is also why
   AZW3/KF8 is unspaced: with the middots gone, the gap is the separator, and a
   space inside an item would read as one. */
const FORMATS = ['EPUB', 'MOBI', 'AZW3/KF8', 'FB2', 'FBZ', 'TXT', 'Markdown', 'HTML', 'PDF']

type View = 'grid' | 'list' | 'collections'
type Layout = 'grid' | 'list'
type Sort = 'read' | 'added' | 'title' | 'author'

const SORTS = [
  { id: 'read', label: 'Recently read' },
  { id: 'added', label: 'Recently added' },
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
] as const satisfies readonly { id: Sort; label: string }[]

/* The three the reader starts with. Derived from the book's own record every
   time they are drawn rather than stored, so they cannot go stale and cannot
   disagree with the book sheet — see `Collection` in types.ts.

   "Want to read" is "never opened", which is a guess about intent, and it is
   the right guess: a book you imported and have not opened is one you mean to
   read. The alternative is a fourth state on every book that the reader has to
   maintain by hand, for a shelf they can make themselves in two taps. */
const BUILT_IN = [
  { id: 'reading', name: 'Reading', of: (b: Book) => Boolean(b.openedAt) && !b.finishedAt },
  { id: 'unread', name: 'Want to read', of: (b: Book) => !b.openedAt },
  { id: 'finished', name: 'Finished', of: (b: Book) => Boolean(b.finishedAt) },
] as const

/* The shelf's own preferences live in localStorage rather than in the settings
   row, for one reason that is not tidiness: they decide the layout of the first
   frame. A Dexie liveQuery resolves a tick after paint, so a reader who chose
   the list would watch a grid flip to a list on every cold start. localStorage
   is synchronous, and this is the case that is for.

   `Settings` stays what it says it is — how the book is typeset — and does not
   accumulate view state. */
const VIEW_KEY = 'flyleaf.shelf.view'
const SORT_KEY = 'flyleaf.shelf.sort'

/** The mono meta line under a shelf row. `format · size`, and the date only
    where there is room for it — the grid caption is 150px wide. */
function metaLine(book: Book, withDate: boolean): string {
  const parts = [FORMAT_LABEL[book.format] ?? book.format, bytes(book.fileSize)]
  if (withDate) parts.push(shortDate(book.addedAt))
  return parts.join('  ·  ')
}

function countLabel(n: number): string {
  return `${n} ${n === 1 ? 'book' : 'books'}`
}

export function Library() {
  /* undefined while the query is in flight, [] when there is genuinely
     nothing. The two are different screens and conflating them is what makes a
     library flash its empty state on every cold start. */
  const books = useLiveQuery(() => db.books.orderBy('addedAt').reverse().toArray())
  const made = useLiveQuery(() => db.collections.orderBy('createdAt').toArray())
  const settings = useSettings()

  const [view, setView] = useState<View>(() =>
    stored(VIEW_KEY, ['grid', 'list', 'collections'] as const, 'grid'),
  )
  const [layout, setLayout] = useState<Layout>(() =>
    stored(VIEW_KEY, ['grid', 'list'] as const, 'grid'),
  )
  const [sort, setSort] = useState<Sort>(() =>
    stored(SORT_KEY, ['read', 'added', 'title', 'author'] as const, 'read'),
  )
  const [query, setQuery] = useState('')
  /** which shelf is open, or null for the tile index. A built-in id or a
      collection's uuid — one field, because only one can be open. */
  const [inside, setInside] = useState<string | null>(null)
  const [naming, setNaming] = useState<null | { id: string | null; value: string }>(null)

  const setViewAnd = (next: View) => {
    setView(next)
    remember(VIEW_KEY, next)
    if (next !== 'collections') {
      setLayout(next)
      setInside(null)
    }
  }
  const setSortAnd = (next: Sort) => {
    setSort(next)
    remember(SORT_KEY, next)
  }

  /* Every collection, built-in and made, with its books resolved and its
     membership pruned to books that still exist. Pruned here rather than on
     delete: see `removeBook`. */
  const shelves = useMemo(() => {
    const all = books ?? []
    const byId = new Map(all.map((b) => [b.id, b]))
    const built = BUILT_IN.map((c) => ({
      id: c.id as string,
      name: c.name,
      books: all.filter(c.of),
      own: null as Collection | null,
    }))
    const mine = (made ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      books: c.bookIds.map((id) => byId.get(id)).filter((b): b is Book => Boolean(b)),
      own: c,
    }))
    return [...built, ...mine]
  }, [books, made])

  const open = inside ? shelves.find((s) => s.id === inside) ?? null : null

  const shown = useMemo(() => {
    let rows = open ? open.books : books ?? []

    const q = query.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q),
      )
    }

    const by = [...rows]
    /* localeCompare, not <: "Émile" sorts before "Emma" in every language this
       app is read in, and a byte comparison puts it after "Zola". */
    const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    if (sort === 'title') by.sort((a, b) => text(a.title, b.title))
    else if (sort === 'author') by.sort((a, b) => text(a.author || '￿', b.author || '￿'))
    else if (sort === 'added') by.sort((a, b) => b.addedAt - a.addedAt)
    else by.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0) || b.addedAt - a.addedAt)
    return by
  }, [books, open, query, sort])

  const dismissed = settings?.dismissedSeeds.length ?? 0
  /* Searching is a shelf-wide question, so typing in the field leaves an open
     collection rather than searching inside it. The tile index is the exception:
     there is nothing there to search, so a query switches to the books. */
  const listing = view !== 'collections' || open !== null || query.trim() !== ''

  const submitName = async () => {
    if (!naming) return
    const name = naming.value.trim()
    if (name) {
      if (naming.id) await renameCollection(naming.id, name)
      else await createCollection(name)
    }
    setNaming(null)
  }

  return (
    <main className="page">
      {/* --wide is the hook for letting the shelf take the window on a desktop
          — a grid of covers is not prose and does not want a reading measure.
          It carries no width today: DESIGN.md § Space fixes the library at
          680px, and that is the owner's number to change, not this file's. */}
      <div className="page-inner page-inner--wide">
        <header className="app-head">
          <h1><Mark size={22} />Library</h1>
          <span>{books?.length ? countLabel(books.length) : 'Library'}</span>
        </header>

        {books === undefined ? (
          /* Deliberately blank. The launch screen is still fading over this,
             and a skeleton underneath it is a second loading state nobody
             sees — it only ever shows up as a flicker on a warm start. */
          null
        ) : books.length === 0 ? (
          <div className="empty">
            <Mark size={56} />
            <h2>No books yet</h2>
            <p>
              Open a book file and it stays here — on this device, in this browser,
              with no account and nothing uploaded.
            </p>
            <Link className="btn" to="/open">Open a book</Link>
            {dismissed > 0 && (
              <Link className="empty-second" to="/settings">Bring back the included books</Link>
            )}
            <p className="empty-formats">
              {FORMATS.map((f) => <span key={f}>{f}</span>)}
            </p>
          </div>
        ) : (
          <>
            <div className="shelf-bar">
              <div className="find">
                <SearchIcon />
                <input
                  type="search"
                  value={query}
                  placeholder="Search your library"
                  aria-label="Search the library by title or author"
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query !== '' && (
                  <button type="button" className="find-clear" onClick={() => setQuery('')}>
                    <CloseIcon />
                    <span className="sr-only">Clear the search</span>
                  </button>
                )}
              </div>

              <div className="shelf-ctl">
                <div className="seg-views" role="group" aria-label="How the library is shown">
                  {([
                    ['grid', 'Grid', <GridIcon key="g" />],
                    ['list', 'List', <ListIcon key="l" />],
                    ['collections', 'Collections', <CollectionsIcon key="c" />],
                  ] as const).map(([id, label, icon]) => (
                    <button
                      key={id}
                      type="button"
                      className="seg-view"
                      /* Always labelled, not only when the label is drawn.
                         Below 480px .seg-view-lbl is display:none and the icon
                         is aria-hidden, which left all three of these buttons
                         with NO accessible name on every phone — measured:
                         empty text, no aria-label, no title. A screen reader
                         announced "button, pressed" three times, and a driver
                         looking for the List view could never find it. */
                      aria-label={label}
                      aria-pressed={view === id}
                      onClick={() => setViewAnd(id)}
                    >
                      {icon}
                      <span className="seg-view-lbl">{label}</span>
                    </button>
                  ))}
                </div>

                {listing && (
                  <Picker
                    label="Sort"
                    value={sort}
                    options={SORTS}
                    onChange={setSortAnd}
                    icon={<SortIcon />}
                    compact
                  />
                )}
              </div>
            </div>

            {open && (
              <div className="inside">
                {/* Row one is controls only, row two is the heading — the same
                    shape as a book's .detail-bar, so the collection's own name
                    is the largest thing on the page instead of sharing a
                    baseline with an 11.5px back link. */}
                <div className="inside-bar">
                  <button type="button" className="back" onClick={() => setInside(null)}>
                    <BackIcon />Collections
                  </button>
                  {open.own && (
                    <span className="inside-tools">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setNaming({ id: open.own!.id, value: open.name })}
                      >
                        <EditIcon /><span className="sr-only">Rename this collection</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={async () => {
                          await deleteCollection(open.own!.id)
                          setInside(null)
                        }}
                      >
                        <TrashIcon /><span className="sr-only">Delete this collection — the books stay</span>
                      </button>
                    </span>
                  )}
                </div>
                <div className="inside-head">
                  <h2 className="inside-name" title={open.name}>{open.name}</h2>
                  <span className="inside-n">{countLabel(open.books.length)}</span>
                </div>
              </div>
            )}

            {!listing ? (
              <ul className="coll-grid">
                {shelves.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="coll" onClick={() => setInside(s.id)}>
                      {/* Three covers at most, fanned around the front one. A
                          shelf with no books shows the ruled ghost rather than
                          an empty plate, so it still reads as a place books go.
                          The front cover is drawn first so it takes the top of
                          the stack without a z-index per child in the JSX. */}
                      <span className="coll-plate">
                        <span className="coll-stack">
                          {s.books.slice(0, 3).map((b) => (
                            <span className="coll-spine" key={b.id}><Cover book={b} lean={false} /></span>
                          ))}
                          {s.books.length === 0 && <span className="coll-ghost" aria-hidden="true" />}
                        </span>
                        <span className="coll-count" aria-hidden="true">{s.books.length}</span>
                      </span>
                      <span className="coll-name">{s.name}</span>
                      <span className="sr-only">{countLabel(s.books.length)}</span>
                    </button>
                  </li>
                ))}

                <li>
                  {naming && naming.id === null ? (
                    <form
                      className="coll coll--new"
                      onSubmit={(e) => { e.preventDefault(); void submitName() }}
                    >
                      <input
                        autoFocus
                        value={naming.value}
                        maxLength={60}
                        placeholder="Collection name"
                        aria-label="Name for the new collection"
                        onChange={(e) => setNaming({ id: null, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null) }}
                      />
                      <span className="coll-new-do">
                        <button type="submit" className="icon-btn" disabled={!naming.value.trim()}>
                          <CheckIcon /><span className="sr-only">Create it</span>
                        </button>
                        <button type="button" className="icon-btn" onClick={() => setNaming(null)}>
                          <CloseIcon /><span className="sr-only">Cancel</span>
                        </button>
                      </span>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="coll coll--add"
                      onClick={() => setNaming({ id: null, value: '' })}
                    >
                      <span className="coll-plate">
                        <span className="coll-stack">
                          <span className="coll-ghost" aria-hidden="true"><PlusIcon /></span>
                        </span>
                      </span>
                      <span className="coll-name">New collection</span>
                    </button>
                  )}
                </li>
              </ul>
            ) : shown.length === 0 ? (
              <p className="shelf-none">
                {query
                  ? `Nothing here matches “${query.trim()}”.`
                  : open
                    ? 'Nothing in this collection yet — add a book to it from its own page.'
                    : 'Nothing in this group yet.'}
              </p>
            ) : layout === 'grid' ? (
              <ul className="shelf-grid">
                {shown.map((b) => (
                  <li key={b.id}>
                    <Link className="shelf-card" to={`/book/${b.id}`}>
                      <Cover book={b} />
                      {b.progress > 0 && (
                        <span className="bar" aria-hidden="true">
                          <span className="bar-fill" style={{ width: `${percent(b.progress)}%` }} />
                        </span>
                      )}
                      <span className="shelf-title">{b.title}</span>
                      {b.author && <span className="shelf-author">{b.author}</span>}
                      {b.seeded && <span className="tag">Included</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="shelf-list">
                {shown.map((b) => (
                  <li key={b.id}>
                    <Link className="shelf-row" to={`/book/${b.id}`}>
                      <span className="shelf-row-cover"><Cover book={b} lean={false} /></span>
                      <span className="shelf-row-body">
                        <span className="shelf-row-title">{b.title}</span>
                        {b.author && <span className="shelf-author">{b.author}</span>}
                        <span className="mono-meta">{metaLine(b, true)}</span>
                        {b.progress > 0 && (
                          <span className="bar" aria-hidden="true">
                            <span className="bar-fill" style={{ width: `${percent(b.progress)}%` }} />
                          </span>
                        )}
                      </span>
                      {b.seeded && <span className="tag">Included</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {/* A rename lands here, above the fold, rather than in the tile:
                the tile is 150px wide and a text field in it is four characters
                of visible name. */}
            {naming?.id && (
              <form className="rename" onSubmit={(e) => { e.preventDefault(); void submitName() }}>
                <label>
                  <span className="ui-lbl">Rename collection</span>
                  <input
                    autoFocus
                    value={naming.value}
                    maxLength={60}
                    onChange={(e) => setNaming({ id: naming.id, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null) }}
                  />
                </label>
                <button type="submit" className="btn btn--sm" disabled={!naming.value.trim()}>Save</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setNaming(null)}>Cancel</button>
              </form>
            )}

            {/* Import is the quiet second thing on this screen, not the loud
                first thing — SPEC.md § 1.5. The round ink button in the nav
                already does this; the line is for discovery. */}
            <p className="shelf-foot">
              <Link to="/open">Your own books</Link>
              {FORMATS.map((f) => <span key={f}>{f}</span>)}
            </p>
          </>
        )}
      </div>
    </main>
  )
}
