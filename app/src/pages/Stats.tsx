import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, localDay, readingSince } from '../db'
import { FORMAT_FAMILY, FORMAT_LABEL } from '../lib'
import { StatsIcon, BackIcon } from '../components/icons'
import { Cover } from '../components/Cover'
import type { Book, ReadingDay } from '../types'

/* ── Your reading ─────────────────────────────────────────────────────────
   The screen readers ask every ereader for and few get honestly.

   Two rules govern what is allowed on it.

   FIRST: every number here is measured, not modelled. Time comes from the
   reading clock, which stops when the tab is hidden and stops five minutes
   after the last sign of life, so every figure is a floor. There is no
   "estimated words read", no reading speed and no time-to-finish, because this
   app does not know how many words a book has — and a made-up number on a page
   whose whole appeal is that it is about you is worse than a missing one.

   SECOND: every mark on this page is one ink in ordered steps. There is no
   colour here at all — DESIGN.md § The graph ramp: a chart is one series in one
   ink with a named key, because six hues next to four themes was a second
   colour system, and the ramp reads the same on all four grounds. The steps sit
   on --rule, not on the card, which is why level zero on the calendar IS
   --rule.

   History outlives the book. A day row whose book has been removed still
   counts toward time, days and streak — deleting a file does not un-read it —
   and the per-book list says so rather than quietly dropping the hours. */

/** Weeks in the calendar grid. 26 — half a year — for a reason that is
    measured rather than editorial: at twelve weeks each cell comes out 26px
    across on a 390px phone, which is a row of tiles rather than a graph you
    read the shape of. At twenty-six they are 11px, the block is 74px tall, and
    a habit is visible in it. */
const WEEKS = 26

type Stats = {
    days: ReadingDay[]
    books: Book[]
    marks: number
    notes: number
    bookmarks: number
    /** the book to offer a way back into, or null. See `back` in the render. */
    open: Book | null
}

/** `YYYY-MM-DD` for the day `n` days before `from`. Goes through Date rather
    than subtracting from a string so month ends and leap days are the
    platform's problem, not ours. */
function dayBefore(from: string, n: number): string {
    const [y, m, d] = from.split('-').map(Number)
    return localDay(new Date(y, m - 1, d - n))
}

/** Monday of the week containing `day`. Monday because a reading week that
    starts on Sunday splits every weekend in half. */
function weekStart(day: string): string {
    const [y, m, d] = day.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    /* getDay is 0=Sunday, so Sunday is six days into its week, not none. */
    const back = (date.getDay() + 6) % 7
    return dayBefore(day, back)
}

function hm(ms: number): string {
    const min = Math.round(ms / 60_000)
    if (min < 1) return ms > 0 ? 'under a minute' : '—'
    if (min < 60) return `${min}m`
    const h = Math.floor(min / 60)
    const rest = min - h * 60
    /* `53h`, not `53h 0m`. The stray zero is the tell that a number was printed
       by a formatter rather than written by somebody. */
    return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

/** Consecutive days ending today, or ending yesterday if today is still
    blank — a streak should not read as broken at breakfast. */
function streakOf(minutes: Map<string, number>, today: string): number {
    let cursor = minutes.has(today) ? today : dayBefore(today, 1)
    let n = 0
    while (minutes.has(cursor)) {
        n += 1
        cursor = dayBefore(cursor, 1)
    }
    return n
}

function longestOf(sorted: string[]): number {
    let best = 0
    let run = 0
    let prev: string | null = null
    for (const day of sorted) {
        run = prev !== null && dayBefore(day, 1) === prev ? run + 1 : 1
        prev = day
        if (run > best) best = run
    }
    return best
}

export function Stats() {
    const data = useLiveQuery<Stats>(async () => {
        /* A year and a bit: the calendar needs twelve weeks, the totals want
           the year, and one range query is cheaper than three. */
        const since = dayBefore(localDay(), 400)
        const [days, books, marks, notes, bookmarks] = await Promise.all([
            readingSince(since),
            db.books.toArray(),
            db.annotations.count(),
            db.annotations.filter((a) => Boolean(a.note?.trim())).count(),
            db.bookmarks.count(),
        ])
        /* The way back into the book.

           This screen used to be reachable from inside the reader with no route
           out of it: the nav bar is deliberately absent on the reading page, so
           a reader who tapped through to their stats arrived somewhere with a
           back button that went to the reader's own chrome and nothing that
           said "your book". That was a trap, and it is fixed twice over —
           Stats is a real tab now, so the bar is always under it, and this
           strip puts the book itself one tap away rather than three.

           Most recently opened and not finished, which is the same rule Home's
           rail is sorted by, so the two screens never disagree about which book
           "your book" means. */
        const open =
            books
                .filter((b) => b.openedAt !== null && b.finishedAt === null)
                .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))[0] ?? null

        return { days, books, marks, notes, bookmarks, open }
    })

    if (!data) {
        return (
            <main className="page">
                <div className="page-inner">
                    <header className="app-head"><h1>Your reading</h1></header>
                </div>
            </main>
        )
    }

    const today = localDay()
    const { days, books, marks, notes, bookmarks, open } = data

    /* ── fold the rows once ───────────────────────────────────────────────
       Three shapes come out of one pass: per day (the calendar and the week),
       per book (the leaderboard), and the totals. Doing it three times over
       four hundred rows would still be fast; doing it once is simply what the
       data is for. */
    const perDay = new Map<string, number>()
    const perBook = new Map<string, { ms: number; turns: number }>()
    /* Which books were read on which day, biggest share first. This is what the
       week grid is drawn from — a day is not one number there, it is the set of
       books that got time. Sorted by ms so that when the stack has to be
       clipped it is the book you gave five minutes to that falls off the back,
       not the one you gave an hour. */
    const dayBooks = new Map<string, { bookId: string; ms: number }[]>()
    let totalMs = 0
    let totalTurns = 0
    for (const row of days) {
        if (row.ms > 0) perDay.set(row.day, (perDay.get(row.day) ?? 0) + row.ms)
        const b = perBook.get(row.bookId) ?? { ms: 0, turns: 0 }
        perBook.set(row.bookId, { ms: b.ms + row.ms, turns: b.turns + row.turns })
        if (row.ms >= 60_000) {
            const list = dayBooks.get(row.day) ?? []
            list.push({ bookId: row.bookId, ms: row.ms })
            dayBooks.set(row.day, list)
        }
        totalMs += row.ms
        totalTurns += row.turns
    }
    for (const list of dayBooks.values()) list.sort((a, b) => b.ms - a.ms)
    const readDays = [...perDay.keys()].sort()
    const streak = streakOf(perDay, today)
    const longest = longestOf(readDays)
    const best = readDays.reduce(
        (acc, d) => ((perDay.get(d) ?? 0) > acc.ms ? { day: d, ms: perDay.get(d) ?? 0 } : acc),
        { day: '', ms: 0 },
    )

    /* ── the calendar ─────────────────────────────────────────────────────
       Columns are weeks and rows are weekdays, so a reader who only reads at
       weekends sees two solid stripes rather than noise. It is built forward
       from the Monday twelve weeks back, which means the last column is the
       current week and is partly in the future — those cells are rendered as
       absent, not as zero, because "you have not got there yet" and "you did
       not read" are different facts. */
    const gridStart = dayBefore(weekStart(today), (WEEKS - 1) * 7)
    const grid: { day: string; ms: number; future: boolean }[] = []
    for (let i = 0; i < WEEKS * 7; i += 1) {
        const day = localDay(
            new Date(
                Number(gridStart.slice(0, 4)),
                Number(gridStart.slice(5, 7)) - 1,
                Number(gridStart.slice(8, 10)) + i,
            ),
        )
        grid.push({ day, ms: perDay.get(day) ?? 0, future: day > today })
    }
    /* Four steps, by minutes. Thresholds are a reading session, not a linear
       scale of the maximum: a week with one four-hour Sunday should not make
       every ordinary evening look like nothing. */
    const level = (ms: number) => {
        const min = ms / 60_000
        if (min < 1) return 0
        if (min < 15) return 1
        if (min < 40) return 2
        if (min < 75) return 3
        return 4
    }

    /* ── this week ────────────────────────────────────────────────────────*/
    const monday = weekStart(today)
    const week = Array.from({ length: 7 }, (_, i) => {
        const day = localDay(
            new Date(
                Number(monday.slice(0, 4)),
                Number(monday.slice(5, 7)) - 1,
                Number(monday.slice(8, 10)) + i,
            ),
        )
        return {
            day,
            ms: perDay.get(day) ?? 0,
            future: day > today,
            today: day === today,
            books: dayBooks.get(day) ?? [],
        }
    })
    const weekMs = week.reduce((n, d) => n + d.ms, 0)
    const weekPeak = Math.max(...week.map((d) => d.ms), 1)

    /* ── the last thirty days, for pace ───────────────────────────────────*/
    const from30 = dayBefore(today, 29)
    const ms30 = readDays.filter((d) => d >= from30).reduce((n, d) => n + (perDay.get(d) ?? 0), 0)
    const days30 = readDays.filter((d) => d >= from30).length

    /* ── the shelf ────────────────────────────────────────────────────────*/
    const byId = new Map(books.map((b) => [b.id, b]))
    const finished = books.filter((b) => b.finishedAt !== null)
    const started = books.filter((b) => b.finishedAt === null && b.progress > 0)
    const unread = books.filter((b) => b.finishedAt === null && b.progress === 0)
    const bytes = books.reduce((n, b) => n + b.fileSize, 0)

    const families = new Map<string, { n: number; label: string }>()
    for (const b of books) {
        const key = FORMAT_FAMILY[b.format] ?? 'text'
        const row = families.get(key) ?? { n: 0, label: FORMAT_LABEL[b.format] ?? b.format }
        families.set(key, { n: row.n + 1, label: row.label })
    }
    const familyRows = [...families.entries()].sort((a, b) => b[1].n - a[1].n)

    const top = [...perBook.entries()]
        .map(([id, v]) => ({ id, ...v, book: byId.get(id) }))
        .filter((r) => r.ms >= 60_000)
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)

    const nothingYet = totalMs < 60_000 && books.length === 0

    return (
        <main className="page">
            <div className="page-inner">
                <header className="app-head">
                    <h1>Your reading</h1>
                    <p className="app-sub">
                        Measured on this device, kept on this device. Nothing here has ever left it.
                    </p>
                </header>

                {open && (
                    <Link className="resume" to={`/read/${open.id}`}>
                        <BackIcon />
                        <span className="resume-body">
                            <span className="ui-lbl">Back to</span>
                            <span className="resume-t">{open.title}</span>
                        </span>
                    </Link>
                )}

                {nothingYet ? (
                    <div className="empty">
                        <StatsIcon />
                        <h2>Nothing to count yet</h2>
                        <p>Open a book and read for a minute. Everything on this page comes from
                            time actually spent on a page, so it starts at nothing and it is yours.</p>
                        <Link className="btn" to="/library">Go to the library</Link>
                    </div>
                ) : (
                    <>
                        {/* Four figures, no fills. These are the ones a reader
                            checks first, so they are the only things above the
                            fold — and they earn that by size and position, not
                            by a tint, because a tinted figure would read as a
                            chart with one bar. */}
                        <div className="stat-grid">
                            <div className="stat">
                                <span className="stat-n">{hm(totalMs)}</span>
                                <span className="stat-lbl">Time read</span>
                            </div>
                            <div className="stat">
                                <span className="stat-n">{streak}</span>
                                <span className="stat-lbl">{streak === 1 ? 'Day running' : 'Days running'}</span>
                            </div>
                            <div className="stat">
                                <span className="stat-n">{finished.length}</span>
                                <span className="stat-lbl">Finished</span>
                            </div>
                            <div className="stat">
                                <span className="stat-n">{marks}</span>
                                <span className="stat-lbl">Highlights</span>
                            </div>
                        </div>

                        <section className="stat-sec">
                            <h2>This week</h2>
                            <p className="stat-sec-sub">
                                {hm(weekMs)} since Monday
                                {weekMs > 0 ? ` · ${hm(weekMs / week.filter((d) => !d.future).length)} a day` : ''}
                            </p>
                            {/* Covers, not bars.

                                A bar chart of seven numbers answers "how long"
                                and loses the only thing that made the week
                                worth looking at, which is WHAT. A reader
                                remembers Tuesday as the night they were deep in
                                one book, and the covers say that at a glance in
                                a way 47m never will.

                                More than one book in a day stacks, overlapping
                                and offset — the same gesture as books left on a
                                table. The stack is capped at three because a
                                fourth in a 40px column stops being a cover and
                                becomes a sliver; the count of what is hidden is
                                shown rather than dropped.

                                The minutes have not gone: they are the height
                                of the column's fill behind the stack, so the
                                shape of the week is still readable and the
                                covers sit on top of it rather than instead of
                                it. */}
                            <ol className="wk" aria-label="What you read on each day this week">
                                {week.map((d) => {
                                    const shown = d.books.slice(0, 3)
                                    const over = d.books.length - shown.length
                                    return (
                                        <li
                                            key={d.day}
                                            className="wk-col"
                                            data-today={d.today || undefined}
                                            data-future={d.future || undefined}
                                        >
                                            <span className="wk-track" aria-hidden="true">
                                                <span
                                                    className="wk-bar"
                                                    style={{ height: d.future ? 0 : `${Math.max(d.ms > 0 ? 4 : 0, (d.ms / weekPeak) * 100)}%` }}
                                                />
                                                {/* reverse so the first (longest-read)
                                                    book ends up painted last and sits
                                                    on top of the pile */}
                                                <span className="wk-stack" data-n={shown.length || undefined}>
                                                    {shown
                                                        .map((r, i) => {
                                                            const book = byId.get(r.bookId)
                                                            return book ? (
                                                                <span key={r.bookId} className="wk-cover" style={{ zIndex: shown.length - i }}>
                                                                    <Cover book={book} lean={false} />
                                                                </span>
                                                            ) : null
                                                        })
                                                        .reverse()}
                                                </span>
                                                {over > 0 && <span className="wk-more">+{over}</span>}
                                            </span>
                                            <span className="wk-day">
                                                {['M', 'T', 'W', 'T', 'F', 'S', 'S'][
                                                    (new Date(
                                                        Number(d.day.slice(0, 4)),
                                                        Number(d.day.slice(5, 7)) - 1,
                                                        Number(d.day.slice(8, 10)),
                                                    ).getDay() + 6) % 7
                                                ]}
                                            </span>
                                            <span className="sr-only">
                                                {d.day}: {d.future ? 'still to come' : hm(d.ms)}
                                                {d.books.length > 0
                                                    ? `, ${d.books
                                                          .map((r) => byId.get(r.bookId)?.title)
                                                          .filter(Boolean)
                                                          .join(', ')}`
                                                    : ''}
                                            </span>
                                        </li>
                                    )
                                })}
                            </ol>
                        </section>

                        <section className="stat-sec">
                            <h2>The last six months</h2>
                            <p className="stat-sec-sub">
                                {readDays.length} {readDays.length === 1 ? 'day' : 'days'} with a book
                                {longest > 1 ? ` · longest run ${longest} days` : ''}
                            </p>
                            <div className="cal" aria-hidden="true">
                                {grid.map((cell) => (
                                    <span
                                        key={cell.day}
                                        className="cal-cell"
                                        data-level={cell.future ? undefined : level(cell.ms)}
                                        data-future={cell.future || undefined}
                                    />
                                ))}
                            </div>
                            <p className="cal-key" aria-hidden="true">
                                <span>Less</span>
                                {[0, 1, 2, 3, 4].map((l) => (
                                    <span key={l} className="cal-cell" data-level={l} />
                                ))}
                                <span>More</span>
                            </p>
                        </section>

                        {top.length > 0 && (
                            <section className="stat-sec">
                                <h2>Where the time went</h2>
                                <ol className="tops">
                                    {top.map((r) => (
                                        <li key={r.id}>
                                            {r.book ? (
                                                <Link to={`/book/${r.id}`} className="top-t">{r.book.title}</Link>
                                            ) : (
                                                /* Said out loud rather than hidden: the hours are
                                                   still in the total above, and a total that does
                                                   not add up is the fastest way to lose a reader's
                                                   trust in the whole page. */
                                                <span className="top-t top-t--gone">A book you have since removed</span>
                                            )}
                                            {/* Number before bar in the DOM, not after it: the bar
                                                spans both columns, and CSS auto-placement seats any
                                                sibling that follows a spanning item on the NEXT row
                                                — which put the time on a third line under the bar
                                                instead of beside the title. */}
                                            <span className="top-n">{hm(r.ms)}</span>
                                            <span className="top-bar" aria-hidden="true">
                                                <span
                                                    className="top-fill"
                                                    /* Share of ALL the time, not of the leader's. Scaled
                                                       to the leader the top bar is always full width, and a
                                                       full-width 4px rule under a serif title reads as an
                                                       underline rather than a chart. A share also answers
                                                       the question the heading actually asks. */
                                                    style={{ width: `${Math.max(2, (r.ms / totalMs) * 100)}%` }}
                                                />
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                        )}

                        <section className="stat-sec">
                            <h2>Pace</h2>
                            <dl className="facts">
                                <div><dt>Last 30 days</dt><dd>{hm(ms30)} over {days30} {days30 === 1 ? 'day' : 'days'}</dd></div>
                                <div><dt>Typical day</dt><dd>{readDays.length ? hm(totalMs / readDays.length) : '—'}</dd></div>
                                <div><dt>Best day</dt><dd>{best.day ? `${hm(best.ms)} on ${nice(best.day)}` : '—'}</dd></div>
                                <div><dt>Longest run</dt><dd>{longest} {longest === 1 ? 'day' : 'days'}</dd></div>
                                <div><dt>Pages turned</dt><dd>{totalTurns.toLocaleString()}</dd></div>
                            </dl>
                        </section>

                        <section className="stat-sec">
                            <h2>Your library</h2>
                            <p className="stat-sec-sub">
                                {books.length} {books.length === 1 ? 'book' : 'books'} · {mb(bytes)} on this device
                            </p>
                            {books.length > 0 && (
                                <>
                                    {/* A single-format shelf gets no bar. A bar at 100% of one
                                        colour states nothing the line under it does not, and it
                                        would be the largest block of colour on the page for it. */}
                                    {familyRows.length > 1 && (
                                    <div className="mix" aria-hidden="true">
                                        {familyRows.map(([family, row]) => (
                                            <span
                                                key={family}
                                                className="mix-seg"
                                                data-family={family}
                                                style={{ width: `${(row.n / books.length) * 100}%` }}
                                            />
                                        ))}
                                    </div>
                                    )}
                                    <ul className="mix-key">
                                        {familyRows.map(([family, row]) => (
                                            <li key={family}>
                                                <span className="mix-dot" data-family={family} aria-hidden="true" />
                                                {row.label}
                                                <span className="mix-n">{row.n}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                            <dl className="facts">
                                <div><dt>Reading</dt><dd>{started.length}</dd></div>
                                <div><dt>Finished</dt><dd>{finished.length}</dd></div>
                                <div><dt>Not started</dt><dd>{unread.length}</dd></div>
                                <div><dt>Marks</dt><dd>{marks} {marks === 1 ? 'highlight' : 'highlights'}{notes > 0 ? `, ${notes} with a note` : ''}</dd></div>
                                <div><dt>Bookmarks</dt><dd>{bookmarks}</dd></div>
                                {finished.length > 0 && (
                                    <div>
                                        <dt>Last finished</dt>
                                        <dd>
                                            {(() => {
                                                const last = finished.reduce((a, b) =>
                                                    (b.finishedAt ?? 0) > (a.finishedAt ?? 0) ? b : a)
                                                return `${last.title} · ${nice(localDay(last.finishedAt ?? 0))}`
                                            })()}
                                        </dd>
                                    </div>
                                )}
                            </dl>
                        </section>
                    </>
                )}
            </div>
        </main>
    )
}

/** `2026-08-21` → `21 August`, and with the year once it is not this one. */
function nice(day: string): string {
    const [y, m, d] = day.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: y === new Date().getFullYear() ? undefined : 'numeric',
    })
}

/** Bytes as a reader would say them. Deliberately coarse: nobody wants three
    decimal places of their own library. */
function mb(bytes: number): string {
    if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`
    const m = bytes / 1_000_000
    return m < 100 ? `${m.toFixed(1)} MB` : `${Math.round(m)} MB`
}
