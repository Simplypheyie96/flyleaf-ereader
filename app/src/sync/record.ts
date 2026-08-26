/* What goes up, what comes down, and how two copies of a library are folded
   into one. The transport is `drive.ts`; this file is the meaning.

   THE RULE IS MERGE, NEVER PICK-ONE. A sync must not be able to lose somebody
   a book, a highlight, or a page they were on. So nothing here asks "which
   side wins": it takes the union, resolves a genuine collision by the later
   timestamp, and lets `sync.ts` write the merged whole back up so both sides
   end holding the same thing. That is what makes overwriting a Drive file
   safe — nothing is ever replaced by less than itself.

   THE HARD PART IS IDENTITY. `Book.id` is a UUID minted at import, so the same
   novel imported on a phone and on a laptop has two different ids, and a naive
   merge would leave the reader with two of everything and a position that never
   crosses over. Titles cannot decide it either: two editions share a title, and
   a re-typeset EPUB of the same edition is a different file with the same one.

   So identity is the FILE. `Book.fp` is the SHA-256 of the bytes, and it is the
   only thing in the record that both devices can compute and agree on without
   ever having spoken. A merge builds a map from the incoming ids to the local
   ones through it, and every row that points at a book — locator, highlight,
   bookmark, reading day, collection membership — is rewritten through that map
   before it lands. Two readers who bought the same file get one book; two who
   bought different files get two, which is honest, because the CFIs from one
   would not resolve in the other.

   DELETIONS TRAVEL AS TOMBSTONES, and a book's tombstone names its fingerprint
   rather than its id — the id it had here means nothing on the other device.
   See `Grave` in types.ts. */

import { db } from '../db'
import { APP } from './drive'
import type { Annotation, Book, Bookmark, Collection, Grave, Locator, ReadingDay } from '../types'

/** Bumped only if a shape changes in a way an older build could not read. */
const V = 1

/* ── the three documents ──────────────────────────────────────────────────
   Split by how often each moves, so a page turn re-uploads the smallest of
   them. `drive.ts` explains why at length. */

export const SHELF = 'shelf.json'
export const MARKS = 'marks.json'
export const PLACE = 'place.json'

/** A book as it travels: everything on the row except the cover, which is
    bytes and rides with the file instead. `fp` is promoted to required —
    a book without one cannot be matched, so it is computed before export
    rather than allowed up unnamed. */
export type BookDoc = Omit<Book, 'cover' | 'fp'> & { fp: string }

export interface ShelfDoc {
  v: number
  kind: 'shelf'
  books: BookDoc[]
  collections: Collection[]
  graves: Grave[]
}

export interface MarksDoc {
  v: number
  kind: 'marks'
  annotations: Annotation[]
  bookmarks: Bookmark[]
}

export interface PlaceDoc {
  v: number
  kind: 'place'
  locators: Locator[]
  days: ReadingDay[]
}

export interface Folded {
  gained: number
  updated: number
  removed: number
}

const NOTHING: Folded = { gained: 0, updated: 0, removed: 0 }

function add(a: Folded, b: Folded): Folded {
  return {
    gained: a.gained + b.gained,
    updated: a.updated + b.updated,
    removed: a.removed + b.removed,
  }
}

/** When a book row was last written. A row from before sync existed has no
    `editedAt`, and `addedAt` is the honest floor — see types.ts. */
function edited(book: { editedAt?: number; addedAt: number }): number {
  return book.editedAt ?? book.addedAt
}

/* ── identity ─────────────────────────────────────────────────────────────── */

/** SHA-256 of a book's bytes, hex, computed once and kept on the row.

    Whole file, not a prefix. A prefix is faster and wrong: an EPUB is a zip,
    and two zips of the same book built by different tools share their first
    kilobytes and differ later — which would collide two genuinely different
    files into one book and merge one reader's highlights into the other's
    text. A 4MB file hashes in about twenty milliseconds. */
export async function fingerprint(bookId: string): Promise<string | null> {
  const book = await db.books.get(bookId)
  if (!book) return null
  if (book.fp) return book.fp
  const file = await db.files.get(bookId)
  if (!file) return null
  const digest = await crypto.subtle.digest('SHA-256', await file.data.arrayBuffer())
  const fp = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  await db.books.update(bookId, { fp })
  return fp
}

/** Fingerprint every book that has bytes and no hash yet.

    Runs before the first export of a shelf and then almost never again, since
    the value is kept. Sequential rather than parallel on purpose: hashing is
    synchronous work inside the crypto implementation, and forty at once on a
    phone is forty megabytes of ArrayBuffers alive at the same moment. */
export async function fingerprintAll(): Promise<void> {
  const books = await db.books.toArray()
  for (const book of books) if (!book.fp) await fingerprint(book.id)
}

/** Incoming book id → the id that book has on this device. Identity for
    anything already agreed; different only where the same file was imported
    separately on each side. */
export type IdMap = Map<string, string>

function through(map: IdMap, id: string): string {
  return map.get(id) ?? id
}

/* ── tombstones ───────────────────────────────────────────────────────────── */

/** The set of things the OTHER side says are gone, as a lookup per kind.

    A stone loses to a later edit of the same row, which is checked at the point
    of use rather than here: the comparison needs the row's own timestamp, and
    only the caller has it. */
function stones(graves: Grave[]): Map<string, number> {
  const found = new Map<string, number>()
  for (const g of graves) {
    const held = found.get(g.id)
    if (held === undefined || held < g.at) found.set(g.id, g.at)
  }
  return found
}

function buried(all: Map<string, number>, kind: Grave['kind'], ref: string, at: number): boolean {
  const stone = all.get(`${kind}:${ref}`)
  return stone !== undefined && stone >= at
}

/* ── shelf ────────────────────────────────────────────────────────────────── */

export async function exportShelf(): Promise<ShelfDoc> {
  await fingerprintAll()
  const [books, collections, graves] = await Promise.all([
    db.books.toArray(),
    db.collections.toArray(),
    db.graves.toArray(),
  ])
  return {
    v: V,
    kind: 'shelf',
    /* A book with no fingerprint has no bytes on this device — it arrived from
       another one and its file was never fetched. It still travels, so the row
       is not lost, and it travels under the fingerprint it arrived with. */
    books: books
      .filter((b): b is Book & { fp: string } => typeof b.fp === 'string')
      .map(({ cover: _cover, ...rest }) => rest),
    collections,
    graves,
  }
}

/** Fold an incoming shelf into this one, and return the id map every other
    document is rewritten through.

    ORDER MATTERS HERE AND ONLY HERE. The books have to land before the marks
    and the positions, because until they have, the map does not exist. */
export async function mergeShelf(doc: ShelfDoc): Promise<{ folded: Folded; map: IdMap }> {
  await fingerprintAll()
  const map: IdMap = new Map()
  let gained = 0
  let updated = 0
  let removed = 0

  const mine = await db.books.toArray()
  const byFp = new Map<string, Book>()
  for (const book of mine) if (book.fp) byFp.set(book.fp, book)

  const localGraves = await db.graves.toArray()
  const graves = stones([...doc.graves, ...localGraves])
  const write: Book[] = []
  const drop: string[] = []

  for (const incoming of doc.books) {
    const local = byFp.get(incoming.fp)

    /* Deleted on the other device, and a deletion is the most deliberate
       thing anybody does to a shelf, so it wins.

       IT USED TO BE COMPARED AGAINST `edited(local)`, and that is the bug that
       made deletions feel optional. `editedAt` moves on every page turn —
       Reader.tsx stamps it with the progress tick — so a book deleted on the
       phone and then merely OPENED on the laptop had a local timestamp newer
       than the stone, survived, and was pushed back up. Reading a book is not
       an argument for keeping it; nobody who taps a title is voting on a
       deletion they made yesterday on another device.

       `addedAt` is the honest comparison, and it still answers the case the
       old rule was written for: deliberately importing the file again mints a
       new row with a new `addedAt`, which is somebody actually saying they
       want it back, and that beats the stone.

       A SEEDED BOOK IS EXEMPT FROM EVEN THAT. Its `addedAt` is when this
       device first booted, not when anyone chose it — a new phone seeds the
       two included books before it has ever synced, so their `addedAt` is
       newer than any stone that could exist and they would be immortal. */
    if (local && buried(graves, 'book', incoming.fp, local.seeded ? 0 : local.addedAt)) {
      drop.push(local.id)
      removed += 1
      continue
    }
    if (!local) {
      if (buried(graves, 'book', incoming.fp, incoming.seeded ? 0 : incoming.addedAt)) continue
      /* A book this device has never seen. It keeps the id it arrived with, so
         every mark and position pointing at it needs no rewriting, and its
         cover is null until the file is fetched — DESIGN.md forbids a generated
         one, so a row with no cover shows its title, which is the truth. */
      write.push({ ...incoming, cover: null })
      gained += 1
      continue
    }

    map.set(incoming.id, local.id)
    let merged = { ...local }
    let changed = false

    if (edited(incoming) > edited(local)) {
      /* The later row wins for metadata. */
      merged = {
        ...merged,
        title: incoming.title,
        author: incoming.author,
        format: incoming.format,
        fileName: incoming.fileName,
        fileSize: incoming.fileSize,
        language: incoming.language,
        publisher: incoming.publisher,
        published: incoming.published,
        subjects: incoming.subjects,
        description: incoming.description,
        editedAt: incoming.editedAt,
        addedAt: incoming.addedAt,
      }
      changed = true
    }

    const incomingRead = Math.max(incoming.openedAt ?? 0, incoming.finishedAt ?? 0)
    const localRead = Math.max(local.openedAt ?? 0, local.finishedAt ?? 0)

    if (incomingRead > localRead) {
      merged.progress = incoming.progress
      merged.openedAt = incoming.openedAt
      merged.finishedAt = incoming.finishedAt
      changed = true
    }

    if (changed) {
      write.push(merged)
      updated += 1
    }
  }

  /* Sweep local books against the stones. If the other device deleted a book,
     it is not in `doc.books` at all, so the loop above never saw it. */
  for (const local of mine) {
    if (!local.fp) continue
    if (buried(graves, 'book', local.fp, local.seeded ? 0 : local.addedAt)) {
      if (!drop.includes(local.id)) {
        drop.push(local.id)
        removed += 1
      }
    }
  }

  /* Deleted HERE and still on the other side is nothing to do: this device's
     own stone travels up in the same sync and the other device drops it. */

  const collections = await foldCollections(doc.collections, graves, map)

  await db.transaction(
    'rw',
    [db.books, db.files, db.locators, db.annotations, db.bookmarks, db.collections, db.graves],
    async () => {
    /* THE OTHER DEVICE'S STONES ARE KEPT, and this is not bookkeeping — it is
       what stops a deletion coming undone. The next thing this device does is
       push the merged shelf back up, and it exports the stones it holds; a
       stone that was read and thrown away would be erased from Drive by that
       push. Two devices would recover, because the one that laid it still has
       it. THREE WOULD NOT: the third device still holds the book, sees no stone
       in the shelf that came back, and pushes the book up again. Keeping them
       makes every device that has heard about a deletion able to repeat it. */
    if (doc.graves.length) await db.graves.bulkPut(doc.graves)
    if (write.length) await db.books.bulkPut(write)
    for (const id of drop) {
      await Promise.all([
        db.books.delete(id),
        db.files.delete(id),
        db.locators.delete(id),
        db.annotations.where('bookId').equals(id).delete(),
        db.bookmarks.where('bookId').equals(id).delete(),
      ])
    }
    if (collections.write.length) await db.collections.bulkPut(collections.write)
    if (collections.drop.length) await db.collections.bulkDelete(collections.drop)
    },
  )

  return {
    folded: {
      gained,
      updated,
      removed: removed + collections.folded.removed,
    },
    map,
  }
}

async function foldCollections(
  incoming: Collection[],
  graves: Map<string, number>,
  map: IdMap,
): Promise<{ write: Collection[]; drop: string[]; folded: Folded }> {
  const mine = new Map((await db.collections.toArray()).map((c) => [c.id, c]))
  const write: Collection[] = []
  const drop: string[] = []
  let removed = 0

  for (const row of incoming) {
    const local = mine.get(row.id)
    if (local && buried(graves, 'collection', row.id, local.updatedAt)) {
      drop.push(row.id)
      removed += 1
      continue
    }
    if (!local && buried(graves, 'collection', row.id, row.updatedAt)) continue
    if (local && local.updatedAt >= row.updatedAt) continue
    /* LAST WRITER WINS ON THE WHOLE ROW, membership included, and it is a real
       trade rather than an oversight. Unioning the two lists of book ids would
       keep a book added on each device at once — but it would also make every
       REMOVAL undo itself the moment the other device was heard from, which is
       the more confusing of the two failures by a distance. Collections are
       edited on one device at a time; a book added twice in the same minute on
       two devices is not. */
    write.push({ ...row, bookIds: row.bookIds.map((id) => through(map, id)) })
  }

  for (const local of mine.values()) {
    if (buried(graves, 'collection', local.id, local.updatedAt)) {
      if (!drop.includes(local.id)) {
        drop.push(local.id)
        removed += 1
      }
    }
  }

  return { write, drop, folded: { ...NOTHING, removed } }
}

/* ── marks ────────────────────────────────────────────────────────────────── */

export async function exportMarks(): Promise<MarksDoc> {
  const [annotations, bookmarks] = await Promise.all([
    db.annotations.toArray(),
    db.bookmarks.toArray(),
  ])
  return { v: V, kind: 'marks', annotations, bookmarks }
}

export async function mergeMarks(doc: MarksDoc, map: IdMap, _incomingGraves: Grave[]): Promise<Folded> {
  const graves = await db.graves.toArray()
  const stone = stones(graves)
  const [mineA, mineB] = await Promise.all([
    db.annotations.toArray(),
    db.bookmarks.toArray(),
  ])
  const books = new Set((await db.books.toArray()).map((b) => b.id))

  const haveA = new Map(mineA.map((a) => [a.id, a]))
  const haveB = new Map(mineB.map((b) => [b.id, b]))
  const writeA: Annotation[] = []
  const writeB: Bookmark[] = []
  const dropA: string[] = []
  const dropB: string[] = []
  let gained = 0
  let updated = 0
  let removed = 0

  for (const row of doc.annotations) {
    const mark: Annotation = { ...row, bookId: through(map, row.bookId) }
    if (!books.has(mark.bookId)) continue
    const local = haveA.get(mark.id)
    if (buried(stone, 'annotation', mark.id, local?.updatedAt ?? mark.updatedAt)) {
      if (local) {
        dropA.push(mark.id)
        removed += 1
      }
      continue
    }
    if (!local) {
      writeA.push(mark)
      gained += 1
    } else if (mark.updatedAt > local.updatedAt) {
      writeA.push(mark)
      updated += 1
    }
  }

  for (const row of doc.bookmarks) {
    const mark: Bookmark = { ...row, bookId: through(map, row.bookId) }
    if (!books.has(mark.bookId)) continue
    const local = haveB.get(mark.id)
    if (buried(stone, 'bookmark', mark.id, local?.createdAt ?? mark.createdAt)) {
      if (local) {
        dropB.push(mark.id)
        removed += 1
      }
      continue
    }
    /* A bookmark is immutable — a place, and nothing else on the row can
       change — so there is no later copy of one to prefer. */
    if (!local) {
      writeB.push(mark)
      gained += 1
    }
  }

  for (const local of mineA) {
    if (buried(stone, 'annotation', local.id, local.updatedAt)) {
      if (!dropA.includes(local.id)) {
        dropA.push(local.id)
        removed += 1
      }
    }
  }

  for (const local of mineB) {
    if (buried(stone, 'bookmark', local.id, local.createdAt)) {
      if (!dropB.includes(local.id)) {
        dropB.push(local.id)
        removed += 1
      }
    }
  }

  await db.transaction('rw', [db.annotations, db.bookmarks], async () => {
    if (writeA.length) await db.annotations.bulkPut(writeA)
    if (writeB.length) await db.bookmarks.bulkPut(writeB)
    if (dropA.length) await db.annotations.bulkDelete(dropA)
    if (dropB.length) await db.bookmarks.bulkDelete(dropB)
  })
  return { gained, updated, removed }
}

/* ── place ────────────────────────────────────────────────────────────────── */

export async function exportPlace(): Promise<PlaceDoc> {
  const [locators, days] = await Promise.all([db.locators.toArray(), db.readingDays.toArray()])
  return { v: V, kind: 'place', locators, days }
}

export async function mergePlace(doc: PlaceDoc, map: IdMap, _incomingGraves: Grave[]): Promise<Folded> {
  const graves = await db.graves.toArray()
  const stone = stones(graves)
  const books = await db.books.toArray()
  const here = new Set(books.map((b) => b.id))
  const fpOf = new Map(books.map((b) => [b.id, b.fp ?? '']))

  const mine = new Map((await db.locators.toArray()).map((l) => [l.bookId, l]))
  const writeL: Locator[] = []
  const dropL: string[] = []
  let gained = 0
  let updated = 0
  let removed = 0

  for (const row of doc.locators) {
    const loc: Locator = { ...row, bookId: through(map, row.bookId) }
    if (!here.has(loc.bookId)) continue
    const local = mine.get(loc.bookId)
    /* A locator's stone names the book's fingerprint, not its id — the id it
       had on the device that reset it means nothing here. */
    if (buried(stone, 'locator', fpOf.get(loc.bookId) ?? '', local?.updatedAt ?? loc.updatedAt)) {
      if (local) {
        dropL.push(loc.bookId)
        removed += 1
      }
      continue
    }
    if (!local) {
      writeL.push(loc)
      gained += 1
    } else if (loc.updatedAt > local.updatedAt) {
      /* THE LATER READ WINS, and it wins on `updatedAt` rather than on how far
         through the book it is. Somebody who goes back to re-read chapter two
         has moved backwards on purpose, and a merge that preferred the further
         position would drag them forwards every time their other device woke
         up. */
      writeL.push(loc)
      updated += 1
    }
  }

  for (const local of mine.values()) {
    if (buried(stone, 'locator', fpOf.get(local.bookId) ?? '', local.updatedAt)) {
      if (!dropL.includes(local.bookId)) {
        dropL.push(local.bookId)
        removed += 1
      }
    }
  }

  const days = await foldDays(doc.days, map, here)

  await db.transaction('rw', [db.locators, db.readingDays], async () => {
    if (writeL.length) await db.locators.bulkPut(writeL)
    if (dropL.length) await db.locators.bulkDelete(dropL)
    if (days.write.length) await db.readingDays.bulkPut(days.write)
  })
  return { gained: gained + days.gained, updated: updated + days.updated, removed }
}

/** Reading history, folded by the larger `ms`.

    NOT SUMMED, and that is deliberate — the same rule `backup.ts` already uses
    for a hand-carried file, so a history that arrives from Drive and one that
    arrives from a download cannot drift apart. Adding the two would double
    every day that had already synced once, and a reading streak that inflates
    itself on every sync is worse than one that under-counts a day spent
    reading the same book on both a phone and a laptop. */
async function foldDays(
  incoming: ReadingDay[],
  map: IdMap,
  here: Set<string>,
): Promise<{ write: ReadingDay[]; gained: number; updated: number }> {
  const mine = new Map((await db.readingDays.toArray()).map((d) => [d.id, d]))
  const write: ReadingDay[] = []
  let gained = 0
  let updated = 0
  for (const row of incoming) {
    const bookId = through(map, row.bookId)
    if (!here.has(bookId)) continue
    /* The id is composed from the book id, so remapping the one without the
       other would write a row keyed to a book that is not there. */
    const day: ReadingDay = { ...row, bookId, id: `${row.day}|${bookId}` }
    const local = mine.get(day.id)
    if (!local) {
      write.push(day)
      gained += 1
    } else if (day.ms > local.ms) {
      write.push(day)
      updated += 1
    }
  }
  return { write, gained, updated }
}

/* ── the book files ───────────────────────────────────────────────────────
   Opt-in, and the opt-in is not squeamishness: an `appDataFolder` counts
   against the READER's own Drive quota, and a library of forty EPUBs is a few
   hundred megabytes of the fifteen gigabytes a free Google account has. The
   record above is a few hundred kilobytes and always syncs; the bytes are a
   decision somebody makes with the number in front of them.

   Written once and never rewritten. A book's bytes cannot change — if they
   did it would be a different fingerprint and therefore a different book. */

const MAGIC = 'FLYLEAF-BOOK-1\n'

const BOOK_PREFIX = 'book-'

export function bookFileName(fp: string): string {
  return `${BOOK_PREFIX}${fp}`
}

/** Is this file ours to delete?

    The folder is this app's alone since it got its own OAuth client on 23 Aug
    2026 (SPEC.md § 15.1), so today this answers yes to everything in it. It
    stays because it did not used to: the folder is per-CLIENT, the client was
    shared with Flyleaf Press, and "remove my backup" had to tell our files
    from a sibling's. Sharing a client is one decision away — the Flyleaf
    journal is a third product — so the two tests stay, and both are needed:

      · THE TAG is the durable one. Every file written from this app now carries
        `appProperties.app = 'ereader'`, so a document renamed in some later
        version is still recognisably ours and a file tagged as another app's is
        never touched, whatever it is called.

      · THE NAMES are the bridge. A backup made before the tag existed carries
        no tag at all, and it is still ours and should still go. Our four shapes
        are the three record documents and one `book-<fingerprint>` per book.

    Anything that is neither — a sibling's `library.json`, or a name from an app
    that does not exist yet — is left where it is. Stranding a stranger's file
    costs a few kilobytes of somebody's Drive quota. Deleting it costs them
    their backup. */
export function ours(file: { name: string; app?: string }): boolean {
  if (file.app) return file.app === APP
  return (
    file.name === SHELF ||
    file.name === MARKS ||
    file.name === PLACE ||
    file.name.startsWith(BOOK_PREFIX)
  )
}

interface BookHead {
  fp: string
  type: string
  fileName: string
  title: string
  author: string
  /** byte lengths, in this order, following the header */
  file: number
  cover: number
}

/** One book as one Drive file: a text header naming what follows, then the
    book's bytes, then the cover's.

    The same container shape as `backup.ts`, for the same reason — the parts are
    assembled as `Blob` pieces and read back as lazy `Blob.slice` views, so a
    40MB EPUB is never held in memory as a base64 string. A JSON document with
    the file inline would be that string, at four thirds the size. */
export async function packBook(bookId: string): Promise<{ name: string; body: Blob } | null> {
  const [book, file] = await Promise.all([db.books.get(bookId), db.files.get(bookId)])
  if (!book || !file) return null
  const fp = book.fp ?? (await fingerprint(bookId))
  if (!fp) return null
  const cover = book.cover ?? new Blob([])
  const head: BookHead = {
    fp,
    type: file.type,
    fileName: book.fileName,
    title: book.title,
    author: book.author,
    file: file.data.size,
    cover: cover.size,
  }
  const json = new TextEncoder().encode(JSON.stringify(head))
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, json.length, true)
  return { name: bookFileName(fp), body: new Blob([MAGIC, len, json, file.data, cover]) }
}

/** Read one back and store it against a book already on the shelf. Returns
    false when the container is not one of ours or the book is not here — both
    of which are "leave it alone", not "throw". */
export async function unpackBook(body: Blob): Promise<boolean> {
  if (body.size < MAGIC.length + 4) return false
  if ((await body.slice(0, MAGIC.length).text()) !== MAGIC) return false
  const lenBytes = new Uint8Array(await body.slice(MAGIC.length, MAGIC.length + 4).arrayBuffer())
  const jsonLen = new DataView(lenBytes.buffer).getUint32(0, true)
  const start = MAGIC.length + 4
  if (jsonLen === 0 || jsonLen > 64 * 1024 || start + jsonLen > body.size) return false

  let head: BookHead
  try {
    head = JSON.parse(await body.slice(start, start + jsonLen).text()) as BookHead
  } catch {
    return false
  }
  const book = await db.books.where('fp').equals(head.fp).first()
  if (!book) return false

  const fileStart = start + jsonLen
  const coverStart = fileStart + head.file
  if (coverStart + head.cover > body.size) return false

  await db.transaction('rw', [db.books, db.files], async () => {
    await db.files.put({ bookId: book.id, data: body.slice(fileStart, coverStart), type: head.type })
    if (head.cover > 0 && !book.cover) {
      await db.books.update(book.id, { cover: body.slice(coverStart, coverStart + head.cover) })
    }
  })
  return true
}

/** Books on this device whose bytes are missing — the rows that arrived from
    another device and have never had their file fetched. */
export async function booksWithoutFiles(): Promise<Book[]> {
  const books = await db.books.toArray()
  const have = new Set(await db.files.toCollection().primaryKeys())
  return books.filter((b) => !have.has(b.id))
}

/** True when this book's bytes are not on this device, so a shelf row can say
    so instead of opening onto an error. */
export async function fileMissing(bookId: string): Promise<boolean> {
  return (await db.files.get(bookId)) === undefined
}

/* ── has anything moved ───────────────────────────────────────────────────
   A cheap stand-in for "is this device different from the last time it
   synced", per document, so an idle pair costs one listing call and no
   transfer. Every read comes off an index or a count rather than a scan: the
   book bytes are in their own table, but a `toArray` of forty rows with covers
   is still megabytes to compute a string with. */

export async function signatures(): Promise<{ shelf: string; marks: string; place: string }> {
  const [books, graves, collections, annotations, bookmarks, locators, days] = await Promise.all([
    db.books.count(),
    db.graves.count(),
    db.collections.count(),
    db.annotations.count(),
    db.bookmarks.count(),
    db.locators.count(),
    db.readingDays.count(),
  ])
  const [newestBook, newestMark, newestBookmark, newestPlace, lastDay] = await Promise.all([
    db.books.orderBy('addedAt').last(),
    db.annotations.orderBy('createdAt').last(),
    db.bookmarks.orderBy('createdAt').last(),
    db.locators.orderBy('updatedAt').last(),
    db.readingDays.orderBy('day').last(),
  ])
  /* THE NEWEST EDIT, and it is the value the whole timing scheme rests on: a
     sync where the signature matches the last one pushed is skipped without a
     single request, so anything this string cannot see is an edit that never
     leaves the device. Ticking a book finished, renaming it, moving it into a
     collection and resetting its progress all move no count and no `addedAt`
     — they move `editedAt`, which every writer in the app sets and which v7
     indexes for exactly this read.

     `keys()` on an index is the cheap form: it never loads a row, so it never
     loads a cover. The last key of an ascending index is the maximum. Rows
     older than v7 have no key and are absent, which is why the count and the
     newest `addedAt` are in the string as well.

     A collection is read the same way and for the same reason: `orderBy(
     'createdAt').last().updatedAt` — what this used to do — is the newest
     collection's edit time, so renaming any OLDER collection moved nothing. */
  const [edits, opens, collEdits] = await Promise.all([
    db.books.orderBy('editedAt').keys(),
    db.books.orderBy('openedAt').keys(),
    db.collections.orderBy('updatedAt').keys(),
  ])
  const top = (keys: unknown[]) => (keys.length ? String(keys[keys.length - 1]) : '')

  return {
    shelf: [
      books,
      graves,
      collections,
      newestBook?.addedAt ?? 0,
      top(collEdits),
      top(edits),
      top(opens),
    ].join('.'),
    marks: [annotations, bookmarks, newestMark?.updatedAt ?? 0, newestBookmark?.createdAt ?? 0].join(
      '.',
    ),
    place: [locators, newestPlace?.updatedAt ?? 0, days, lastDay?.ms ?? 0].join('.'),
  }
}

/* ONE THING THIS FILE DELIBERATELY DOES NOT DO: settings.

   They are not in any of the three documents, for the same reason `backup.ts`
   makes them opt-in on a hand-carried restore — a phone's 15px Literata at a
   34em measure is a worse desktop, and a stock chosen for reading in bed is a
   worse train. `dismissedSeeds` lives in the same row and is device-specific
   for a sharper reason still: it is the record of what THIS device deleted, and
   syncing it would let one device's deletion of an included book silently
   uninstall it from another. */
