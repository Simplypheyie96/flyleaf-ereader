import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, localDay, readingSince } from '../db'
import { percent, remember, shortDate, stored } from '../lib'
import { Cover } from '../components/Cover'
import { InstallStrip } from '../components/InstallStrip'
import { GridIcon, HomeIcon, ListIcon, StatsIcon } from '../components/icons'
import type { Book, Locator } from '../types'

/* ── Home ─────────────────────────────────────────────────────────────────
   The first screen. It answers one question — "what am I reading?" — and then
   two smaller ones under it.

   It replaced a tab called Reading that showed exactly one book: the most
   recently opened. That was wrong in a way a reader noticed immediately, since
   most people have two or three books going and the tab kept forgetting the
   other two. So Continue is a rail of every book with a position in it, in the
   order they were last opened, and the one you were in is first.

   The rail is a scroll-snap container and nothing else — no pager, no JS, no
   transform driven off a pointer. That is not laziness, it is the fastest
   correct answer: native overflow scrolling runs on the compositor, carries the
   platform's own momentum and rubber-band, keeps a scrollbar for a mouse, works
   under a keyboard, and honours reduced motion for free. A hand-rolled carousel
   would be more code and worse at all five.

   Three sections in a fixed order, and the order is the point: what you are
   reading now, what that adds up to, what has just arrived. Recently Added is
   last because a reader who has just imported something is still holding the
   memory of doing it — it is the section that needs the least help.

   Recently Added carries its own grid/list switch, on the owner's instruction.
   It is a SEPARATE preference from the Library's, not a shared one: the two
   lists answer different questions — eight new arrivals against a whole shelf —
   and a reader who wants the covers here and the rows there is not confused,
   they are right. Both remember through the same helper in lib.ts. */

const FRESH_KEY = 'flyleaf.home.fresh'

type Feed = {
  reading: { book: Book; locator: Locator | undefined }[]
  fresh: Book[]
  total: number
  week: number
  streak: number
}

export function Home() {
  const [freshView, setFreshView] = useState<'grid' | 'list'>(() =>
    stored(FRESH_KEY, ['grid', 'list'] as const, 'grid'),
  )

  const feed = useLiveQuery<Feed>(async () => {
    /* One pass over the shelf rather than three queries. A library is tens of
       rows, not thousands, and the alternative is three cursors that each have
       to be reconciled against the other two. */
    const books = await db.books.toArray()

    /* "In progress" is a position, not a percentage: a book opened once and
       read for a page has progress that rounds to 0%, and dropping it from
       Continue is how a reader loses the book they started last night. Finished
       books leave the rail — that is what finishing is. */
    const reading = books
      .filter((b) => b.openedAt !== null && b.finishedAt === null)
      .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
      .slice(0, 12)

    const locators = await Promise.all(reading.map((b) => db.locators.get(b.id)))

    const fresh = books
      .slice()
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 8)

    /* The stats card carries three numbers and no chart. It is a door, and a
       door with a graph on it invites you to read the graph instead of opening
       it — the whole of the history is one tap away and rendered properly
       there. */
    const today = localDay()
    const rows = await readingSince(sundayBefore(today, 400))
    const perDay = new Map<string, number>()
    for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.ms)

    const monday = weekStart(today)
    let week = 0
    let total = 0
    for (const [day, ms] of perDay) {
      total += ms
      if (day >= monday) week += ms
    }

    /* Counted backwards from today, and a day only breaks the run if it has
       under a minute on it — a thirty-second glance is not a reading day, and
       counting it would make the streak flattering rather than true. */
    let streak = 0
    for (let i = 0; ; i += 1) {
      const day = sundayBefore(today, i)
      if ((perDay.get(day) ?? 0) < 60_000) break
      streak += 1
    }

    return { reading: reading.map((book, i) => ({ book, locator: locators[i] })), fresh, total, week, streak }
  })

  if (!feed) return <main className="page" aria-busy="true" />

  const { reading, fresh } = feed

  return (
    <main className="page">
      <div className="page-inner">
        <header className="app-head">
          <h1>Flyleaf eReader</h1>
          <p className="app-sub">{greeting(feed)}</p>
        </header>

        <InstallStrip />

        {reading.length === 0 && fresh.length === 0 ? (
          <div className="empty">
            <HomeIcon />
            <h2>Nothing to read yet</h2>
            <p>
              Nothing here yet. Open a file from this device — EPUB, MOBI, AZW3, FB2, TXT,
              Markdown, HTML or PDF — or put the two books it ships with back in your library.
            </p>
            <div className="empty-do">
              <Link className="btn" to="/open">Open a book</Link>
              <Link className="btn btn--ghost" to="/settings">Restore the included books</Link>
            </div>
          </div>
        ) : (
          <>
            {reading.length > 0 && (
              <section className="home-sec">
                <div className="home-sec-head">
                  <h2>Continue</h2>
                  {reading.length > 1 && (
                    <span className="home-sec-n">{reading.length} on the go</span>
                  )}
                </div>

                {/* aria-label on the rail and nothing on the items: each item is
                    already a link with the book's title in it, so labelling the
                    row again would make a screen reader say "book" twice per
                    card. tabIndex 0 so the rail itself is reachable and can be
                    scrolled with the arrow keys, which is the keyboard
                    equivalent of the swipe. */}
                <ul
                  className="rail"
                  tabIndex={0}
                  role="group"
                  aria-label="Books you have started"
                >
                  {reading.map(({ book, locator }) => (
                    <li key={book.id} className="rail-item">
                      <Link className="cont" to={`/read/${book.id}`}>
                        <span className="cont-cover">
                          <Cover book={book} lean={false} />
                        </span>
                        <span className="cont-body">
                          <span className="cont-title">{book.title}</span>
                          {book.author && <span className="cont-author">{book.author}</span>}
                          <span className="cont-where">
                            {locator?.chapter || 'Where you left off'}
                          </span>
                          <span className="cont-foot">
                            <span className="bar" aria-hidden="true">
                              <span
                                className="bar-fill"
                                style={{ width: `${percent(book.progress)}%` }}
                              />
                            </span>
                            <span className="cont-pct">{percent(book.progress)}%</span>
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Link className="statcard" to="/stats">
              <span className="statcard-head">
                <StatsIcon />
                <span className="statcard-lbl">Your reading</span>
                <span className="statcard-go" aria-hidden="true">›</span>
              </span>
              <span className="statcard-row">
                <span className="statcard-fig">
                  <span className="statcard-n">{hm(feed.week)}</span>
                  <span className="statcard-k">This week</span>
                </span>
                <span className="statcard-fig">
                  <span className="statcard-n">{feed.streak}</span>
                  <span className="statcard-k">{feed.streak === 1 ? 'Day running' : 'Days running'}</span>
                </span>
                <span className="statcard-fig">
                  <span className="statcard-n">{hm(feed.total)}</span>
                  <span className="statcard-k">All time</span>
                </span>
              </span>
            </Link>

            {fresh.length > 0 && (
              <section className="home-sec">
                <div className="home-sec-head">
                  <h2>Recently added</h2>
                  {/* The switch sits where the "All books" link was and the link
                      moves under it, rather than three controls competing on one
                      line at 360px. */}
                  <span className="seg-views seg-views--sm" role="group" aria-label="How recently added books are shown">
                    {([['grid', 'Grid', <GridIcon key="g" />], ['list', 'List', <ListIcon key="l" />]] as const).map(
                      ([id, label, icon]) => (
                        <button
                          key={id}
                          type="button"
                          className="seg-view"
                          aria-pressed={freshView === id}
                          onClick={() => { setFreshView(id); remember(FRESH_KEY, id) }}
                        >
                          {icon}<span className="sr-only">{label}</span>
                        </button>
                      ),
                    )}
                  </span>
                </div>

                {freshView === 'grid' ? (
                  <ul className="shelf-grid shelf-grid--home">
                    {fresh.map((book) => (
                      <li key={book.id}>
                        <Link className="shelf-card" to={`/book/${book.id}`}>
                          <Cover book={book} />
                          <span className="shelf-title">{book.title}</span>
                          <span className="mono-meta">{shortDate(book.addedAt)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="shelf-list">
                    {fresh.map((book) => (
                      <li key={book.id}>
                        <Link className="shelf-row" to={`/book/${book.id}`}>
                          <span className="shelf-row-cover"><Cover book={book} lean={false} /></span>
                          <span className="shelf-row-body">
                            <span className="shelf-row-title">{book.title}</span>
                            {book.author && <span className="shelf-author">{book.author}</span>}
                            <span className="mono-meta">Added {shortDate(book.addedAt)}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="home-sec-foot"><Link to="/library">All books</Link></p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}

/* ── dates ────────────────────────────────────────────────────────────────
   Both helpers go through Date rather than arithmetic on the string, so month
   ends, leap days and DST are the platform's problem. */

/** `YYYY-MM-DD` for the day `n` days before `from`. */
function sundayBefore(from: string, n: number): string {
  const [y, m, d] = from.split('-').map(Number)
  return localDay(new Date(y, m - 1, d - n))
}

/** Monday of the week containing `day`. Monday because a reading week that
    starts on Sunday splits every weekend in half. */
function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const back = (new Date(y, m - 1, d).getDay() + 6) % 7
  return sundayBefore(day, back)
}

/** Hours and minutes, never a bare count of minutes past an hour. */
function hm(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

/** The subtitle. It reports rather than greets: an app that says "Good
    evening" is guessing at both the hour and the mood, and gets one of them
    wrong. What it says instead is the one thing the reader might not know. */
function greeting(feed: Feed): string {
  if (feed.reading.length === 0) return 'Your library, on this device.'
  if (feed.week >= 60_000) return `${hm(feed.week)} read this week.`
  if (feed.reading.length === 1) return 'Pick up where you left off.'
  return `${feed.reading.length} books on the go.`
}
