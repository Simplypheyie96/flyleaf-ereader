import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  bookCost,
  bury,
  createCollection,
  db,
  removeBook,
  toggleInCollection,
  touchBook,
} from '../db'
import { Cover } from '../components/Cover'
import { useMenu } from '../components/Menu'
import { BackIcon, CheckIcon, MoreIcon, PlusIcon, ResetIcon, TrashIcon } from '../components/icons'
import { FORMAT_LABEL, bytes, percent, pubDate, shortDate, subjects } from '../lib'

/* One book. SPEC.md § 7 calls it the book sheet; it is a route rather than a
   modal because DESIGN.md gives book detail its own max width (620px) and
   because the nav already keeps the Library tab lit for `/book/…` — both of
   which say "page". A sheet would also lose the back button, and this is the
   screen a reader arrives at from a shelf and leaves back to it.

   THE SHAPE, and why it changed: this screen used to show three panels of
   everything at once — a status panel with three buttons in it, the file's
   blurb, and a permanently-open Remove panel whose outlined red button was the
   largest thing below the fold. A book sheet has exactly one thing a reader
   came for, and it is Read.

   So: one action in the head, beside the cover, where the eye already is.
   Everything secondary — finished, reset, remove — lives behind the ⋯ in the
   header, which is the discreet place for a destructive action that must still
   be reachable in two taps. The space that bought back goes to what the file
   actually carries: the blurb, its subjects, and the publication facts, which
   is what somebody standing in front of an unopened book wants to read.

   Everything destructive still names what it destroys before it does it. */

/** "the file, your place in it, and 14 highlights" — assembled rather than
    templated, because most books have none of the middle two and a confirm that
    lists zeroes is a confirm nobody reads. */
function costLine(parts: { placed: boolean; marks: number; bookmarks: number }): string {
  const items = ['the file']
  if (parts.placed) items.push('your place in it')
  if (parts.marks) items.push(`${parts.marks} highlight${parts.marks === 1 ? '' : 's'}`)
  if (parts.bookmarks) items.push(`${parts.bookmarks} bookmark${parts.bookmarks === 1 ? '' : 's'}`)
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/* The menu itself comes from components/Menu: the popover, its roving focus,
   its Escape handling and its focus return are the same problem everywhere in
   the app, and this screen used to carry a second copy of the solution. */

/* A blurb is one paragraph or it is nine, depending on the publisher. Clamped
   to six lines with a real toggle, and the toggle only exists when the text
   actually overflows — a More button that reveals nothing is worse than no
   button. Measured on the element, so the answer is right for the reader's
   own font size and window, not for the one this was written on. */
function useClamped(text: string | undefined) {
  const el = useRef<HTMLParagraphElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const node = el.current
    if (!node || !text) return
    const measure = () => setOverflows(node.scrollHeight - node.clientHeight > 2)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [text, expanded])

  return { el, overflows, expanded, setExpanded }
}

export function BookDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const book = useLiveQuery(() => db.books.get(id), [id])
  const locator = useLiveQuery(() => db.locators.get(id), [id])
  /* Sorted by name rather than by creation, because this is a list you scan
     for one shelf you already have in mind, not a feed. */
  const collections = useLiveQuery(() => db.collections.orderBy('name').toArray(), [])
  const [cost, setCost] = useState<{ marks: number; bookmarks: number } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [details, setDetails] = useState(false)
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')
  const menu = useMenu()
  const blurb = useClamped(book?.description)
  const confirmRef = useRef<HTMLDivElement>(null)

  /* Counted when the screen opens, not when Remove is pressed: the confirm has
     to be able to say the number in the same breath as the question. */
  useEffect(() => {
    let live = true
    void bookCost(id).then((c) => { if (live) setCost(c) })
    return () => { live = false }
  }, [id])

  /* The confirm is at the foot of the sheet and the control that summoned it is
     at the head, so it has to come to the reader. */
  useEffect(() => {
    if (confirming) confirmRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [confirming])

  if (book === undefined) return <main className="page" />
  if (book === null) {
    /* A stale bookmark, or a book that was removed in another tab. Say so and
       point back, rather than rendering an empty detail page. */
    return (
      <main className="page">
        <div className="page-inner page-inner--detail">
          <Link className="back" to="/library"><BackIcon />Library</Link>
          <section className="panel">
            <p className="ui-p">That book is not on the shelf any more.</p>
          </section>
        </div>
      </main>
    )
  }

  const pct = percent(book.progress)
  const started = Boolean(book.openedAt) || book.progress > 0

  const read = async () => {
    await touchBook(book.id)
    navigate(`/read/${book.id}`)
  }

  const finish = async () => {
    const now = Date.now()
    await db.books.update(book.id, { finishedAt: book.finishedAt ? null : now, editedAt: now })
  }

  const reset = async () => {
    /* The position, not the marks. Starting a book again is not the same
       decision as throwing away what you wrote in it, and one button doing both
       is a button that surprises somebody once. */
    await db.transaction('rw', [db.books, db.locators, db.graves], async () => {
      await db.locators.delete(book.id)
      await db.books.update(book.id, { progress: 0, finishedAt: null, editedAt: Date.now() })
      /* The position is a synced row like any other, so throwing it away has
         to be recorded or the next merge hands it straight back. By fingerprint,
         like every book-shaped stone — see `removeBook`. */
      await bury('locator', book.fp ?? book.id)
    })
  }

  const remove = async () => {
    await removeBook(book.id)
    navigate('/library')
  }

  /* Create-and-add in one press. A reader who types a collection name on a
     book's own page is not asking for an empty collection — they are putting
     THIS book in it, and making them find it again afterwards is a second step
     for nothing. */
  const addToNewCollection = async () => {
    const name = newName.trim()
    if (!name) return
    const cid = await createCollection(name)
    await toggleInCollection(cid, book.id)
    setNewName('')
    setNaming(false)
  }

  /* Whatever the file actually carried, in the order a title page would print
     it. Nothing is templated in: a row absent from the file is a row absent
     from the screen, not a row saying "Unknown". */
  const facts: [string, string][] = [
    ['Format', FORMAT_LABEL[book.format] ?? book.format],
    ['Size', bytes(book.fileSize)],
    ...(book.publisher ? [['Publisher', book.publisher] as [string, string]] : []),
    ...(book.published ? [['Published', pubDate(book.published)] as [string, string]] : []),
    ...(book.language ? [['Language', book.language] as [string, string]] : []),
    ['Added', shortDate(book.addedAt)],
    ...(book.openedAt ? [['Last opened', shortDate(book.openedAt)] as [string, string]] : []),
    ...(book.finishedAt ? [['Finished', shortDate(book.finishedAt)] as [string, string]] : []),
    ['File', book.fileName],
  ]

  const topics = subjects(book.subjects ?? [])

  const menuAct = (fn: () => void | Promise<void>) => () => {
    menu.close(true)
    void fn()
  }

  return (
    <main className="page">
      <div className="page-inner page-inner--detail">
        <div className="detail-bar">
          <Link className="back" to="/library"><BackIcon />Library</Link>

          <div className="menu-wrap" ref={menu.wrap}>
            <button
              ref={menu.trigger}
              className="icon-btn"
              type="button"
              aria-haspopup="menu"
              aria-expanded={menu.open}
              aria-controls="book-menu"
              onClick={() => menu.setOpen(!menu.open)}
            >
              <MoreIcon />
              <span className="sr-only">More for this book</span>
            </button>

            {menu.open && (
              <div
                id="book-menu"
                className="menu"
                role="menu"
                aria-label={book.title}
                onKeyDown={menu.onMenuKey}
              >
                <button className="menu-item" type="button" role="menuitem" onClick={menuAct(finish)}>
                  <CheckIcon />
                  {book.finishedAt ? 'Mark as unfinished' : 'Mark as finished'}
                </button>
                {started && (
                  <button className="menu-item" type="button" role="menuitem" onClick={menuAct(reset)}>
                    <ResetIcon />
                    Reset position
                  </button>
                )}
                <button
                  className="menu-item menu-item--danger"
                  type="button"
                  role="menuitem"
                  onClick={menuAct(() => setConfirming(true))}
                >
                  <TrashIcon />
                  Remove from library
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="detail-head">
          <div className="detail-cover"><Cover book={book} /></div>
          <div className="detail-meta">
            {book.seeded && <span className="tag">Included</span>}
            <h1 className="ui-h">{book.title}</h1>
            {book.author && <p className="detail-author">{book.author}</p>}

            {/* The one action, and the only place on the sheet that carries a
                filled button. What was a panel of three is a button and a
                line of type. */}
            <div className="detail-act">
              <button className="btn" type="button" onClick={() => void read()}>
                {book.finishedAt ? 'Read again' : started ? 'Continue' : 'Start reading'}
              </button>
              {started && !book.finishedAt && (
                <div className="detail-prog">
                  <div className="bar bar--wide" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mono-meta">
                    {pct}% read{locator?.chapter ? `  ·  ${locator.chapter}` : ''}
                  </p>
                </div>
              )}
              {book.finishedAt && (
                <p className="mono-meta detail-prog">Finished {shortDate(book.finishedAt)}</p>
              )}
              {!started && (
                <p className="mono-meta detail-prog">Not opened yet</p>
              )}
            </div>
          </div>
        </div>

        {book.description && (
          <section className="panel">
            <p className="ui-lbl">About this book</p>
            <p
              ref={blurb.el}
              className={`ui-p detail-blurb${blurb.expanded ? '' : ' detail-blurb--clamp'}`}
            >
              {book.description}
            </p>
            {(blurb.overflows || blurb.expanded) && (
              <button
                className="detail-more"
                type="button"
                aria-expanded={blurb.expanded}
                onClick={() => blurb.setExpanded(!blurb.expanded)}
              >
                {blurb.expanded ? 'Less' : 'More'}
              </button>
            )}
            {topics.length > 0 && (
              /* The file's own subject headings. Not links and not filters —
                 there is nothing yet to filter — so they are set as what they
                 are: what the publisher filed this under. Normalised in `lib`,
                 not here: the MARC `--` separator is a property of the data,
                 and a component is the wrong place to learn about it. */
              <ul className="subjects">
                {topics.map((s) => <li key={s}>{s}</li>)}
              </ul>
            )}
          </section>
        )}

        {/* Collections. The Library's own empty-collection copy says to add a
            book "from its own page", so this is the page that has to keep that
            promise — and a collection you can create but never fill is a
            feature that only looks finished.

            This section used to be headed "Shelves" while the Library called
            the identical rows "Collections", over one Dexie table. The owner
            read the two screens and said: "I don't understand shelves. what it
            is used for?" — which is the only review that matters. One name now,
            the Library's, plus a sentence saying what the thing is FOR, because
            a section whose purpose has to be inferred from its verb is a
            section that has not been written yet.

            Toggle chips, not a menu: every collection is a yes/no about this one
            book, the answer is worth seeing without opening anything, and
            aria-pressed is the state a screen reader already knows how to read.

            Reading, Want to read and Finished are deliberately absent. They are
            derived from openedAt and finishedAt every time they are drawn
            (types.ts, Collection), so a control for them would be a control
            that argues with the book's own record. The line says so, because a
            reader who cannot find "Finished" here will otherwise assume it is
            missing rather than automatic. */}
        <section className="panel">
          <p className="ui-lbl">Collections</p>
          <p className="ui-p ui-p--soft collect-intro">
            A collection is a group you name yourself — Poetry, To reread, For the
            flight. Tap one to put this book in it. A book can sit in as many as
            you like, and it stays exactly where it is in your library either way.
          </p>
          <div className="seg">
            {(collections ?? []).map((c) => {
              const on = c.bookIds.includes(book.id)
              return (
                <button
                  key={c.id}
                  className="btn btn--ghost btn--sm"
                  type="button"
                  aria-pressed={on}
                  onClick={() => void toggleInCollection(c.id, book.id)}
                >
                  {on && <CheckIcon />}
                  {c.name}
                </button>
              )
            })}
            {!naming && (
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => setNaming(true)}
              >
                <PlusIcon />
                New collection
              </button>
            )}
          </div>

          {naming && (
            /* A rule and an indent, not a nested card: the field belongs to the
               chips above it, and a second bordered box inside this panel would
               say it was a separate thing — same reasoning as .set-confirm. */
            <form className="collect-new" onSubmit={(e) => { e.preventDefault(); void addToNewCollection() }}>
              <label>
                <span className="ui-lbl">Name the new collection</span>
                <input
                  autoFocus
                  value={newName}
                  maxLength={60}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setNaming(false); setNewName('') } }}
                />
              </label>
              <button className="btn btn--sm" type="submit" disabled={!newName.trim()}>
                Create and add
              </button>
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => { setNaming(false); setNewName('') }}
              >
                Cancel
              </button>
            </form>
          )}

          <p className="ui-p ui-p--soft collect-note">
            Reading, Want to read and Finished look after themselves — they follow
            what you have opened and finished.
          </p>
        </section>

        <section className="panel">
          {/* Closed by default. These are facts you look up, not facts you
              read, and a sheet that opens with a table of them is a sheet
              about a file rather than about a book. */}
          <button
            className="disclose"
            type="button"
            aria-expanded={details}
            aria-controls="book-facts"
            onClick={() => setDetails(!details)}
          >
            <span className="ui-lbl">Details</span>
            <span className="disclose-mark" aria-hidden="true">{details ? '−' : '+'}</span>
          </button>
          {details && (
            <dl className="facts" id="book-facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              {cost && (cost.marks > 0 || cost.bookmarks > 0) && (
                <div>
                  <dt>Your marks</dt>
                  <dd>
                    {cost.marks > 0 && `${cost.marks} highlight${cost.marks === 1 ? '' : 's'}`}
                    {cost.marks > 0 && cost.bookmarks > 0 && '  ·  '}
                    {cost.bookmarks > 0 && `${cost.bookmarks} bookmark${cost.bookmarks === 1 ? '' : 's'}`}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </section>

        {confirming && (
          /* Only ever on screen because somebody asked for it. The panel is
             outlined in the danger colour rather than filled, and the button
             inside it is the only filled danger surface in the app. */
          <section className="panel panel--danger" ref={confirmRef}>
            <p className="ui-lbl">Remove {book.title.length > 28 ? 'this book' : book.title}</p>
            <p className="ui-p detail-confirm">
              This deletes {costLine({ placed: Boolean(locator || book.progress > 0), ...(cost ?? { marks: 0, bookmarks: 0 }) })} from
              this device. Nothing is uploaded, so there is no copy anywhere else.
              {book.seeded && ' It can be brought back from Settings.'}
            </p>
            <div className="set-acts">
              <button className="btn btn--sm btn--danger-solid" type="button" onClick={() => void remove()}>
                Delete {book.title.length > 28 ? 'this book' : book.title}
              </button>
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
