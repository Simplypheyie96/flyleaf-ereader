import Dexie, { type Table } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { plainText } from './import/meta'
import type {
  Annotation,
  Book,
  BookFile,
  Bookmark,
  Collection,
  Grave,
  Locator,
  ReadingDay,
  RetiredTurn,
  Settings,
  Turn,
} from './types'

/* IndexedDB, and nothing else. There is no server, no account and no sync —
   which means this database IS the library, and the two rules that follow from
   that are not negotiable:

   1. A schema change is additive. Dexie versions upgrade in place; a version
      that drops or retypes a store is a version that loses somebody's books.
   2. A service-worker update never touches it. Workbox owns the cache; the
      cache is disposable and this is not.

   Tables are split by read pattern rather than by subject. `files` holds the
   book bytes on its own because listing a shelf must not read them: a 40MB
   EPUB in the same row as its title turns "draw twelve titles" into half a
   gigabyte of reads. */

export const DEFAULT_SETTINGS: Settings = {
  id: 1,
  face: 'literata',
  /* 18/1.6 is the starting point, not a limit — DESIGN.md. Both are
     continuous ranges, so this is where the sliders sit on first run. */
  size: 18,
  leading: 1.6,
  weight: 'regular',
  wordSpacing: 0,
  letterSpacing: 0,
  publisherFont: false,
  /* 'published' on all three of these: the book had an opinion before the app
     did, and overriding a well-set EPUB by default is how a reader announces
     that it did not read the file. */
  paragraph: 'published',
  align: 'published',
  hyphenate: false,
  stock: 'day',
  margin: 8,
  measure: 34,
  columns: 'auto',
  flow: 'paginated',
  turn: 'slide',
  /* Width, not whole-page. A phone fitting a whole A4 sheet on screen renders
     body type at about 5pt; filling the width and scrolling is the only one of
     the two that is readable without a pinch on the device most reading
     happens on. */
  pdfFit: 'width',
  pdfVeil: 1,
  tapToTurn: true,
  sheetTab: 'text',
  theme: 'system',
  dismissedSeeds: [],
}

export class FlyleafDB extends Dexie {
  books!: Table<Book, string>
  files!: Table<BookFile, string>
  locators!: Table<Locator, string>
  annotations!: Table<Annotation, string>
  bookmarks!: Table<Bookmark, string>
  readingDays!: Table<ReadingDay, string>
  collections!: Table<Collection, string>
  graves!: Table<Grave, string>
  settings!: Table<Settings, number>

  constructor() {
    super('flyleaf-ereader')
    this.version(1).stores({
      /* openedAt is indexed because "Continue reading" is the first thing on
         the first screen, and it is an ordered query over every book. addedAt
         and finishedAt likewise back a shelf sort each. */
      books: 'id, addedAt, openedAt, finishedAt, title, author, format',
      files: 'bookId',
      locators: 'bookId, updatedAt',
      /* the compound index is what makes "this book's highlights, in reading
         order" one cursor rather than a filter over every annotation */
      annotations: 'id, bookId, [bookId+cfi], createdAt',
      bookmarks: 'id, bookId, [bookId+cfi], createdAt',
      settings: 'id',
    })

    /* v2 — the reading surface in SPEC.md. Additive, as rule 1 above requires:
       one index added, no store dropped, no field retyped in place.

       `seeded` is indexed because two different questions are asked of it on
       two different screens — "label this row INCLUDED" and "which of the
       included books are still here" — and the second one runs on every cold
       start, before the shelf paints.

       The upgrade body is the only place in this app that transforms a stored
       value rather than defaulting a missing one. `justify: boolean` became
       `align: 'published' | 'left' | 'justify'`, and the two are not the same
       question: false used to mean "not justified", which is *left*, but the
       new default is 'published' — honour the book. Reading the old boolean
       once and writing the new field is the difference between a reader who
       kept their setting and a reader whose text quietly re-aligned itself. */
    this.version(2)
      .stores({ books: 'id, addedAt, openedAt, finishedAt, title, author, format, seeded' })
      .upgrade(async (tx) => {
        const row = (await tx.table('settings').get(1)) as (Settings & { justify?: boolean }) | undefined
        if (!row) return
        const { justify, ...rest } = row
        await tx.table('settings').put({
          ...DEFAULT_SETTINGS,
          ...rest,
          align: justify === true ? 'justify' : justify === false ? 'left' : DEFAULT_SETTINGS.align,
          id: 1,
        })
      })

    /* v3 — the same cleaning `importFile` now does, applied to rows written
       before it did it. `dc:description` routinely carries escaped HTML, and
       until this pass those angle brackets were rendered as text on the book
       sheet.

       Re-importing the file would fix it too, and would be less code. It is
       not an option: the reader's own books are not re-derivable, and rule 2
       above says an update never touches what they have. So the stored strings
       are rewritten in place and nothing else about the row is read.

       Only rows that actually change are written back. An upgrade body runs
       inside the version transaction with the whole shelf blocked behind it,
       and a `put` per book on a large library is a cold start the reader
       watches. */
    this.version(3).upgrade(async (tx) => {
      const books = (await tx.table('books').toArray()) as Book[]
      const fixed = books
        .map((book) => {
          const next: Book = {
            ...book,
            title: plainText(book.title) || book.title,
            author: plainText(book.author) ?? '',
            publisher: plainText(book.publisher),
            description: plainText(book.description),
          }
          const same =
            next.title === book.title &&
            next.author === book.author &&
            next.publisher === book.publisher &&
            next.description === book.description
          return same ? null : next
        })
        .filter((book): book is Book => book !== null)
      if (fixed.length) await tx.table('books').bulkPut(fixed)
    })

    /* v4 — reading history, for the stats screen. One store added and nothing
       else touched, which is the whole point of rule 1: a reader upgrading
       into this version gets an empty history and a shelf that is byte for
       byte what it was.

       `day` is indexed on its own because every number on that screen is a
       range over dates — this week, the last twelve weeks, this year — and
       `[bookId+day]` because "which days did I read THIS book" is the one
       question asked per book rather than per day. */
    this.version(4).stores({
      readingDays: 'id, day, bookId, [bookId+day]',
    })

    /* v5 — collections. One store added, nothing touched, and no upgrade body:
       a reader coming from v4 has no collections, which is exactly right, and
       the three they see on the shelf are derived rather than seeded (see
       `Collection` in types.ts for why).

       `name` is indexed for the alphabetical listing; `createdAt` because the
       tile grid is ordered oldest-first, so a new collection lands at the end
       rather than shuffling the ones already there. */
    this.version(5).stores({
      collections: 'id, name, createdAt',
    })

    /* v6 — what Drive sync needs, and nothing it does not. Additive twice
       over: one store added, two indexes added, no store dropped, no field
       retyped, and no upgrade body.

       `graves` is the deletion record — see `Grave` in types.ts for why a
       union-merge without it can never delete anything. `at` is indexed
       because the only query other than "all of them" is pruning the old ones.

       `fp` on books is the content fingerprint. Indexed because a merge asks
       "do I already have this book" once per incoming book, and a scan of the
       whole shelf per book is quadratic on the one operation a reader with a
       large library would notice.

       No upgrade body, and both new fields on `Book` are optional, so a reader
       arriving from v5 has a shelf that is byte for byte what it was. A
       missing `editedAt` reads as `addedAt`; a missing `fp` is computed the
       first time a sync needs it. */
    this.version(6).stores({
      books: 'id, addedAt, openedAt, finishedAt, title, author, format, seeded, fp',
      graves: 'id, at',
    })

    /* v7 — two indexes, and they exist so that sync can tell a changed shelf
       from an unchanged one. Additive: two indexes added, nothing dropped,
       nothing retyped, no upgrade body.

       `signatures()` compares a cheap string against the last one it pushed,
       and every sync where the strings match is skipped entirely. That makes
       the signature's blind spots into silent data loss rather than a slow
       sync: an edit the signature cannot see is an edit that never leaves the
       device. Both fields already existed and were already written on every
       edit — `editedAt` by every writer in the app, `updatedAt` by every
       collection rename — but neither was indexed, so the max over them could
       not be read without loading the whole table on a timer.

       Rows written before this version have no `editedAt` key and are simply
       absent from that index, which is correct for a maximum: the signature
       also carries the row count and the newest `addedAt`, so a shelf where
       nothing has ever been edited still has a signature that moves when a
       book is added or removed. */
    this.version(7).stores({
      books: 'id, addedAt, openedAt, finishedAt, title, author, format, seeded, fp, editedAt',
      collections: 'id, name, createdAt, updatedAt',
    })
  }
}

export const db = new FlyleafDB()

/** Read the settings row, creating it on first run. Every caller gets a whole
    Settings — a partial one would mean every screen defaulting its own fields,
    and five screens disagreeing about the default size. */
/** Fold away anything a stored row holds that this build no longer ships.

    `turn: 'curl'` is the only one: the fold was built, measured, and cut on
    how it felt, so a device that had chosen it holds a value with no control
    behind it. Read-side and read-side only — the row is NOT rewritten. A
    reader who upgrades, finds Slide, and never opens the Turn tab keeps a
    harmless stale field; one who does pick a style overwrites it. The
    alternative, a write on first read, is a mutation on the boot path of every
    launch, and "updates never clear local data" is a promise that gets easier
    to keep the fewer boot-time writes there are.

    Takes and returns a whole Settings, so it can only ever be applied after
    the defaults merge — a partial row here would defeat the merge. */
function retire(s: Settings): Settings {
  return (s.turn as Turn | RetiredTurn) === 'curl'
    ? { ...s, turn: DEFAULT_SETTINGS.turn }
    : s
}

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get(1)
  if (row) {
    /* Merge over the defaults rather than returning the row: a settings row
       written by an older build is missing whatever was added since, and a
       missing `leading` is NaN in a stylesheet, which renders as a blank page.
       This is the one place that guarantees a whole object. */
    return retire({ ...DEFAULT_SETTINGS, ...row, id: 1 })
  }
  await db.settings.put(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...(await loadSettings()), ...patch, id: 1 as const }
  await db.settings.put(next)
}

/** The live settings row — ONE source, for every screen that reads it.

    This is a hook in the data layer on purpose. Two components each holding
    their own useState copy of this row is not a style preference, it is a bug:
    the Settings screen writes the theme, its own copy updates, and the shell
    that actually applies the theme goes on holding the value it read at boot —
    so the change persists and stays invisible until the next cold start. A
    liveQuery has no second copy to disagree with, and it carries the change
    across tabs as well.

    Deliberately does not write: a liveQuery that creates its own row re-runs
    itself. First-run creation belongs to loadSettings, via the first save.

    `null` means in flight, and callers must treat it as such rather than
    substituting a default — the theme resolved from a default and then
    corrected is a visible flash of the wrong chrome. */
export function useSettings(): Settings | null {
  const settings = useLiveQuery(async () => {
    const row = await db.settings.get(1)
    return retire({ ...DEFAULT_SETTINGS, ...(row ?? {}), id: 1 as const })
  })
  return settings ?? null
}

/* ------------------------------------------------------------------ books --

   Every write to the shelf goes through one of these. Two rules they exist to
   enforce, both of which are easy to break by hand and expensive to discover
   later:

   1. A book and its bytes are written and deleted **together, in one
      transaction.** A `books` row with no `files` row is a title that opens to
      nothing; a `files` row with no `books` row is invisible megabytes.
   2. Deleting a book deletes everything anchored to it. A CFI outlives the
      file it points into, so orphaned annotations do not error — they
      accumulate silently, and reappear against the next book to be imported
      with the same id. */

/** Write a book and its bytes. One transaction over both tables. */
export async function addBook(book: Book, file: BookFile): Promise<string> {
  await db.transaction('rw', db.books, db.files, async () => {
    await db.books.put({ ...book, editedAt: book.editedAt ?? book.addedAt })
    await db.files.put(file)
  })
  return book.id
}

/** Delete a book, its bytes, its place in it, and every mark in it.

    An included book additionally records its id in `dismissedSeeds`, which is
    what makes "an update never puts back a book you deleted" true rather than
    aspirational — first-run seeding reads that list. Restore is the only thing
    that clears it. */
export async function removeBook(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.books, db.files, db.locators, db.annotations, db.bookmarks, db.graves, db.settings],
    async () => {
      const book = await db.books.get(id)
      await Promise.all([
        db.books.delete(id),
        db.files.delete(id),
        db.locators.delete(id),
        db.annotations.where('bookId').equals(id).delete(),
        db.bookmarks.where('bookId').equals(id).delete(),
      ])
      /* One stone for the book, and none for its marks. The book's stone is
         what stops the whole thing coming back from Drive, and a merge that
         drops a book drops everything pointing at it — so a stone per
         highlight would be a hundred rows saying what one already says.

         THE STONE NAMES THE FINGERPRINT, NOT THE ID. The id was minted by this
         device at import and means nothing on the phone that is about to hear
         about this deletion; the fingerprint is the only name the two devices
         both know the book by. A book deleted before it was ever synced has no
         fingerprint, and its id is the honest fallback — nothing anywhere else
         has heard of it either, so the stone has nothing to match and no work
         to do. */
      await bury('book', book?.fp ?? id)
      /* AN INCLUDED BOOK GETS A SECOND STONE, under its own stable id.

         The fingerprint stone above is what the shelf merge matches on, and it
         does its job there. It cannot do this one: seeding runs at boot, before
         any sync, and asks only "is this seed on the shelf and not in
         `dismissedSeeds`" — both device-local. So a new phone put the included
         books back and then argued for them, because a row created seconds ago
         looks newer than a stone laid yesterday.

         `dismissedSeeds` cannot travel: it holds ids, and a seed's id is the
         one thing about it that IS the same everywhere, but the list is a
         settings field and settings stay on the device that set them by
         design. A stone travels in the shelf, so the stone is where this
         belongs. `seed.ts` reads it before it seeds. */
      if (book?.seeded) await bury('book', id)
      if (book?.seeded) {
        const settings = { ...DEFAULT_SETTINGS, ...(await db.settings.get(1)), id: 1 as const }
        if (!settings.dismissedSeeds.includes(id)) {
          await db.settings.put({ ...settings, dismissedSeeds: [...settings.dismissedSeeds, id] })
        }
      }
    },
  )
}

/* ── Deletions, remembered ────────────────────────────────────────────────
   Every delete in this app funnels through one of five calls, and each of them
   lays a stone. That is the whole contract with sync: see `Grave` in types.ts.

   Writing a stone must never be able to fail a delete. A reader who pressed
   Delete and got an error because the app could not record that they pressed
   Delete would be right to conclude the app is broken, and the worst case of a
   swallowed failure is a row that comes back once from another device. */

export async function bury(kind: Grave['kind'], ref: string): Promise<void> {
  try {
    await db.graves.put({ id: `${kind}:${ref}`, kind, ref, at: Date.now() })
  } catch {
    /* See above. */
  }
}

/** Forget stones older than this. A stone's only job is to outlive the gap
    between two devices syncing; a year is far past any real gap, and keeping
    them forever means a reader who has cleared out a lot of books carries a
    growing list of what they cleared for the rest of the app's life. */
const GRAVE_LIFE = 365 * 24 * 60 * 60 * 1000

export async function pruneGraves(): Promise<void> {
  await db.graves.where('at').below(Date.now() - GRAVE_LIFE).delete()
}

/** Count of marks and bytes about to go, so the confirm can name them.

    A confirm that says "this cannot be undone" without saying what *this* is
    asks the reader to remember how much they annotated. */
export async function bookCost(id: string): Promise<{ marks: number; bookmarks: number }> {
  const [marks, bookmarks] = await Promise.all([
    db.annotations.where('bookId').equals(id).count(),
    db.bookmarks.where('bookId').equals(id).count(),
  ])
  return { marks, bookmarks }
}

/** Stamp `openedAt`. Called when a book is opened, not when it is listed —
    it is what orders the Continue row, so a shelf render must not touch it. */
export async function touchBook(id: string): Promise<void> {
  const now = Date.now()
  await db.books.update(id, { openedAt: now, editedAt: now })
}

/** Forget every dismissal, so the next seeding pass puts the included books
    back. Does not seed by itself: seeding is one function with one caller, and
    two paths into it is how a book gets added twice. */
export async function clearDismissedSeeds(): Promise<void> {
  await saveSettings({ dismissedSeeds: [] })
  /* The stones the dismissal laid are lifted by `reseed` in seed.ts, which
     knows which ids are seeds. Doing it there also keeps this file from
     importing that one, which imports this one. */
}

/* ── Reading history ──────────────────────────────────────────────────────
   The reader calls `logReading` on a timer; nothing else writes here.

   Deliberately NOT cleared by `removeBook`. Time you spent reading is yours,
   and a year total that drops because you tidied a finished book off the shelf
   is a number nobody can trust again. The rows outlive the book: the stats
   screen counts them toward time, days and streak, and simply cannot name the
   title in the per-book list, which it says out loud rather than hiding. */

/** Today, in the reader's own timezone, as `YYYY-MM-DD`.

    Built from the local getters rather than `toISOString`, which is UTC and
    would put an 11pm session in Lagos on tomorrow's date — a streak that
    breaks for a reason invisible from inside the app. */
export function localDay(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Add to today's bucket for one book. Idempotent in shape, additive in value.

    One `put` inside one transaction, keyed on `${day}|${bookId}`, because this
    runs every thirty seconds for as long as somebody is reading and a
    read-then-write without a transaction loses an increment the moment two
    tabs have the same book open. */
export async function logReading(
  bookId: string,
  ms: number,
  turns: number,
  fraction: number,
): Promise<void> {
  if (ms <= 0 && turns <= 0) return
  const day = localDay()
  const id = `${day}|${bookId}`
  await db.transaction('rw', db.readingDays, async () => {
    const row = await db.readingDays.get(id)
    await db.readingDays.put(
      row
        ? { ...row, ms: row.ms + ms, turns: row.turns + turns, to: fraction }
        : { id, day, bookId, ms, turns, from: fraction, to: fraction },
    )
  })
}

/** Every day row from `since` (inclusive) onward, oldest first.

    A string compare is the right one here: `YYYY-MM-DD` sorts
    lexicographically in date order, which is the reason the format was chosen
    over a timestamp that would need a timezone to bucket. */
export async function readingSince(since: string): Promise<ReadingDay[]> {
  return db.readingDays.where('day').aboveOrEqual(since).sortBy('day')
}

/* ------------------------------------------------------------ collections --

   Five small writes and one read helper. Every one of them stamps `updatedAt`,
   because a later sync merges two devices' collections by that field and a
   collection whose membership changed without its timestamp moving is a change
   that loses the merge.

   Nothing here validates that a bookId exists. A collection naming a deleted
   book is expected — `removeBook` deliberately does not walk the collections,
   so deleting a book stays one transaction over the tables that own its data —
   and the listing prunes on read. Which also means a book removed and
   re-imported does NOT come back to its collections: the id is new. That is the
   honest behaviour; the alternative is matching on title, which would put a
   different edition of the same book into a shelf the reader never chose. */

export async function createCollection(name: string): Promise<string> {
  const now = Date.now()
  const row: Collection = {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 60) || 'Untitled',
    bookIds: [],
    createdAt: now,
    updatedAt: now,
  }
  await db.collections.put(row)
  return row.id
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 60)
  if (!clean) return
  await db.collections.update(id, { name: clean, updatedAt: Date.now() })
}

/** Delete the shelf, never the books on it. Worth being explicit about,
    because the confirm has to say so and a reader will not believe it
    otherwise. */
export async function deleteCollection(id: string): Promise<void> {
  await db.transaction('rw', [db.collections, db.graves], async () => {
    await db.collections.delete(id)
    await bury('collection', id)
  })
}

/** Add or remove, in one call, from whichever side the book is currently on.
    A single toggle rather than a pair, because every caller is a checkbox and a
    pair means every caller reads the row first to decide which to call. */
export async function toggleInCollection(id: string, bookId: string): Promise<void> {
  await db.transaction('rw', db.collections, async () => {
    const row = await db.collections.get(id)
    if (!row) return
    const has = row.bookIds.includes(bookId)
    await db.collections.put({
      ...row,
      bookIds: has ? row.bookIds.filter((b) => b !== bookId) : [...row.bookIds, bookId],
      updatedAt: Date.now(),
    })
  })
}
