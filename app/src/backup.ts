import { db, DEFAULT_SETTINGS } from './db'
import type { Annotation, Book, Bookmark, Locator, ReadingDay, Settings } from './types'

/* ── The backup file ───────────────────────────────────────────────────────
   The library lives in one browser's IndexedDB and nowhere else. That is the
   product — no account, no upload — but it means a cleared site, a reset phone
   or a dropped laptop takes the books, the positions and every highlight with
   it. This is the one way out, and the one way back in.

   THE FORMAT, and why it is not a JSON file.

   A backup has to carry the book bytes: a restore that brings back "you were
   62% through Middlemarch" without Middlemarch is not a restore. Book bytes in
   JSON means base64 — a third bigger, and both ends have to hold the whole
   library in memory as a string to write it or read it. A 300MB shelf is then a
   400MB string, twice, and the tab dies on a phone.

   So: a JSON header describing every row, followed by the blobs laid end to
   end.

       FLYLEAF-BACKUP-1\n     16 bytes, ASCII, so `file` and `head` can see it
       uint32 LE              byte length of the header that follows
       header JSON, UTF-8     every row, and the blob table
       blob payloads          concatenated, in the header's own order

   Nothing here holds a whole library in memory. Writing it hands `Blob` the
   parts and lets the browser assemble them; reading it uses `File.slice`, which
   is a lazy view, so a 40MB EPUB is passed to Dexie as a slice and never
   decoded on the way through.

   THE VERSION NUMBER is in the magic line, not only in the JSON, because the
   first thing a future reader of a future format needs to do is refuse a file
   it cannot read — and it must be able to do that before parsing anything.

   A RESTORE MERGES; it never deletes. A book on this device that the backup has
   never heard of is left exactly as it is. That is the only safe default: the
   reader who reaches for a backup is usually adding a device, not wiping one,
   and "restore" is not a word anybody expects to lose books to. */

const MAGIC = 'FLYLEAF-BACKUP-1\n'
const HEAD_MAX = 64 * 1024 * 1024

type BlobRef = {
    /** which store the bytes belong to */
    kind: 'cover' | 'file'
    bookId: string
    /** MIME as stored, so a restored File is as honest as the imported one */
    type: string
    bytes: number
}

type Header = {
    format: 'flyleaf-backup'
    version: 1
    app: string
    createdAt: number
    books: Omit<Book, 'cover'>[]
    locators: Locator[]
    annotations: Annotation[]
    bookmarks: Bookmark[]
    readingDays: ReadingDay[]
    settings: Settings | null
    blobs: BlobRef[]
}

export type BackupSummary = {
    books: number
    highlights: number
    bookmarks: number
    days: number
    settings: boolean
    /** the file's own stamp, so a restore can say which backup it is reading */
    createdAt: number
    app: string
}

export class BackupRefused extends Error {}

function u32(n: number): Uint8Array<ArrayBuffer> {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, n, true)
    return b
}

/** A `YYYY-MM-DD` in the reader's own timezone, matching `readingDays`. */
function stamp(ms: number): string {
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function backupName(now: number): string {
    return `flyleaf-library-${stamp(now)}.flyleaf`
}

/* ── writing ──────────────────────────────────────────────────────────────
   One pass over the tables, building the header and the parts list together so
   the blob table and the payload order cannot disagree. */
export async function exportBackup(now: number): Promise<{ blob: Blob; summary: BackupSummary }> {
    const [books, files, locators, annotations, bookmarks, readingDays, settings] = await Promise.all([
        db.books.toArray(),
        db.files.toArray(),
        db.locators.toArray(),
        db.annotations.toArray(),
        db.bookmarks.toArray(),
        db.readingDays.toArray(),
        db.settings.get(1),
    ])

    const blobs: BlobRef[] = []
    const parts: BlobPart[] = []
    const rows: Omit<Book, 'cover'>[] = []

    for (const book of books) {
        const { cover, ...rest } = book
        rows.push(rest)
        if (cover && cover.size) {
            blobs.push({ kind: 'cover', bookId: book.id, type: cover.type, bytes: cover.size })
            parts.push(cover)
        }
    }
    /* Files after covers rather than interleaved: a restore that runs out of
       quota half way through then has every cover and some of the books, which
       leaves a legible shelf, rather than four complete books and eight rows
       with nothing to look at. */
    for (const f of files) {
        if (!f.data?.size) continue
        blobs.push({ kind: 'file', bookId: f.bookId, type: f.type, bytes: f.data.size })
        parts.push(f.data)
    }

    const header: Header = {
        format: 'flyleaf-backup',
        version: 1,
        app: __APP_VERSION__,
        createdAt: now,
        books: rows,
        locators,
        annotations,
        bookmarks,
        readingDays,
        settings: settings ?? null,
        blobs,
    }
    const json = new TextEncoder().encode(JSON.stringify(header))

    return {
        blob: new Blob([MAGIC, u32(json.byteLength), json, ...parts], { type: 'application/octet-stream' }),
        summary: {
            books: books.length,
            highlights: annotations.length,
            bookmarks: bookmarks.length,
            days: readingDays.length,
            settings: !!settings,
            createdAt: now,
            app: __APP_VERSION__,
        },
    }
}

/* ── reading ──────────────────────────────────────────────────────────────
   Two slices before anything is trusted: the magic line, then the header. A
   file that fails either is refused by name — "this is not a Flyleaf backup"
   is a sentence a reader can act on, and a stack trace is not. */
async function readHeader(file: Blob): Promise<{ header: Header; at: number }> {
    const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer())
    if (head.byteLength < MAGIC.length + 4) throw new BackupRefused('That file is too small to be a Flyleaf backup.')
    const magic = new TextDecoder().decode(head.subarray(0, MAGIC.length))
    if (magic !== MAGIC) {
        throw new BackupRefused(
            magic.startsWith('FLYLEAF-BACKUP-')
                ? 'That backup was written by a newer version of Flyleaf than this one. Update the app, then try again.'
                : 'That is not a Flyleaf backup file.',
        )
    }
    const len = new DataView(head.buffer, head.byteOffset + MAGIC.length, 4).getUint32(0, true)
    if (!len || len > HEAD_MAX) throw new BackupRefused('That backup file is damaged — its index is unreadable.')

    const at = MAGIC.length + 4
    let header: Header
    try {
        header = JSON.parse(new TextDecoder().decode(await file.slice(at, at + len).arrayBuffer())) as Header
    } catch {
        throw new BackupRefused('That backup file is damaged — its index is unreadable.')
    }
    if (header?.format !== 'flyleaf-backup' || header.version !== 1)
        throw new BackupRefused('That is not a Flyleaf backup file.')
    return { header, at: at + len }
}

export async function inspectBackup(file: Blob): Promise<BackupSummary> {
    const { header } = await readHeader(file)
    return {
        books: header.books?.length ?? 0,
        highlights: header.annotations?.length ?? 0,
        bookmarks: header.bookmarks?.length ?? 0,
        days: header.readingDays?.length ?? 0,
        settings: !!header.settings,
        createdAt: header.createdAt ?? 0,
        app: header.app ?? '',
    }
}

export type RestoreResult = {
    /** rows written, not rows in the file: a book already here is still a book
        the reader can see, so counting it as restored would be a lie only in
        the direction of flattering the feature. */
    booksAdded: number
    booksUpdated: number
    highlights: number
    bookmarks: number
    days: number
    /** blobs the header promised and the payload did not contain */
    short: number
}

export async function importBackup(file: Blob, opts: { settings: boolean }): Promise<RestoreResult> {
    const { header, at } = await readHeader(file)

    /* Slices, not reads. Every one of these is a lazy view on the file the
       reader picked; the bytes are pulled by IndexedDB when it stores them, and
       this function never holds a book in memory. */
    const covers = new Map<string, Blob>()
    const datas = new Map<string, { data: Blob; type: string }>()
    let cursor = at
    let short = 0
    for (const ref of header.blobs ?? []) {
        const end = cursor + ref.bytes
        if (end > file.size) { short++; cursor = end; continue }
        const slice = file.slice(cursor, end, ref.type || 'application/octet-stream')
        if (ref.kind === 'cover') covers.set(ref.bookId, slice)
        else datas.set(ref.bookId, { data: slice, type: ref.type })
        cursor = end
    }

    const existing = new Set(await db.books.toCollection().primaryKeys())
    const incoming = header.books ?? []
    const booksAdded = incoming.filter(b => !existing.has(b.id)).length
    const booksUpdated = incoming.length - booksAdded

    /* One transaction over every store it touches. A restore that half-lands is
       worse than one that does not land: a books row with no files row is a
       shelf entry that opens to an error. */
    await db.transaction(
        'rw',
        [db.books, db.files, db.locators, db.annotations, db.bookmarks, db.readingDays, db.settings],
        async () => {
            await db.books.bulkPut(incoming.map(b => ({ ...b, cover: covers.get(b.id) ?? null })))
            const files = incoming
                .map(b => { const d = datas.get(b.id); return d ? { bookId: b.id, data: d.data, type: d.type } : null })
                .filter((f): f is { bookId: string; data: Blob; type: string } => !!f)
            if (files.length) await db.files.bulkPut(files)
            if (header.locators?.length) await db.locators.bulkPut(header.locators)
            if (header.annotations?.length) await db.annotations.bulkPut(header.annotations)
            if (header.bookmarks?.length) await db.bookmarks.bulkPut(header.bookmarks)

            /* Reading days merge by the larger `ms`, not by overwrite. The same
               day can exist on both sides — restore a Tuesday backup onto a
               phone you also read on that Tuesday and a plain `put` throws away
               whichever half the file did not see. `ms` only ever grows, so the
               larger row is the more complete one. */
            if (header.readingDays?.length) {
                const mine = new Map(
                    (await db.readingDays.bulkGet(header.readingDays.map(d => d.id)))
                        .filter((d): d is ReadingDay => !!d).map(d => [d.id, d]),
                )
                await db.readingDays.bulkPut(header.readingDays.map(d => {
                    const here = mine.get(d.id)
                    return !here || d.ms >= here.ms ? d : here
                }))
            }

            /* Settings are the reader's own and travel with the books by
               default, but they are also the one part of a backup somebody
               might not want: restoring a phone's 15px Literata onto a desktop
               is a worse desktop. Hence the switch. `id` is forced because a
               hand-edited file must not be able to write a second row. */
            if (opts.settings && header.settings)
                await db.settings.put({ ...DEFAULT_SETTINGS, ...header.settings, id: 1 })
        },
    )

    return {
        booksAdded,
        booksUpdated,
        highlights: header.annotations?.length ?? 0,
        bookmarks: header.bookmarks?.length ?? 0,
        days: header.readingDays?.length ?? 0,
        short,
    }
}
