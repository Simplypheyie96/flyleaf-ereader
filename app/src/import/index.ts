import { addBook, db } from '../db'
import type { Book, BookFile, Format } from '../types'
import { plainText, readMeta, titleFromName } from './meta'
import { MIME, sniff } from './sniff'
import { warmPdfData } from '../reader/pdf/warm'

/* Import. One function, one path, every entry point.

   The picker, the drop target, the file handler and first-run seeding all come
   through here. That is not tidiness — it is the difference between one import
   and four that disagree about what a duplicate is. */

export type ImportResult =
  | { ok: true; book: Book; duplicate: boolean }
  | { ok: false; reason: 'drm'; name: string }
  | { ok: false; reason: 'unsupported'; name: string; what: string }

export type ImportOptions = {
  /** a fixed id, for the included books. Everything else gets a UUID. */
  id?: string
  seeded?: boolean
  /** How many zips we have already opened to get here. See the unwrap below. */
  depth?: number
}

export async function importFile(file: File, options: ImportOptions = {}): Promise<ImportResult> {
  const sniffed = await sniff(file)
  if (!sniffed.ok) {
    /* A zip with one book in it. The sniff has already pulled the book out, so
       import that instead of telling somebody about the bag it came in --
       archived downloads are the normal case, not a mistake to be corrected.

       Once, and once only. A zip inside a zip inside a zip is either a mistake
       or somebody testing us, and either way one level is the whole of the
       helpful behaviour; past that the honest answer is that this is a zip. */
    if (sniffed.reason === 'wrapped') {
      return (options.depth ?? 0) === 0
        ? await importFile(sniffed.inner, { ...options, depth: 1 })
        : { ok: false, reason: 'unsupported', name: file.name, what: 'a zip inside a zip' }
    }
    return sniffed.reason === 'drm'
      ? { ok: false, reason: 'drm', name: file.name }
      : { ok: false, reason: 'unsupported', name: file.name, what: sniffed.what }
  }

  /* Already here? The same file imported twice is one book. Matched on name
     and byte count rather than a content hash: hashing 40MB to answer a
     question the reader already knows the answer to costs more than it saves,
     and two different books with the same name AND the same byte count is not
     a case worth engineering for.

     What this deliberately does NOT do is dedupe across *different* files of
     the same book — types.ts is explicit that a re-import from another source
     is still the book you were halfway through, and merging them would mean
     guessing which position to keep. */
  const existing = await db.books
    .filter((b) => b.fileName === file.name && b.fileSize === file.size)
    .first()
  if (existing) return { ok: true, book: existing, duplicate: true }

  const meta = await readMeta(file, sniffed.format)
  /* An EPUB whose encryption.xml turned out to hold an encrypted chapter
     rather than an obfuscated font. Only findable by opening the archive, so it
     surfaces here rather than in the sniff. */
  if (meta.drm) return { ok: false, reason: 'drm', name: file.name }

  const book: Book = {
    id: options.id ?? crypto.randomUUID(),
    title: plainText(meta.title) || titleFromName(file.name),
    /* Empty string, not 'Unknown'. A row that says "Unknown" three times is
       noisier than three rows that say nothing, and the shelf can lay out an
       absent author. */
    author: plainText(meta.author) ?? '',
    format: sniffed.format,
    addedAt: Date.now(),
    openedAt: null,
    finishedAt: null,
    progress: 0,
    cover: meta.cover ? await shrinkCover(meta.cover) : null,
    fileName: file.name,
    fileSize: file.size,
    language: meta.language,
    publisher: plainText(meta.publisher),
    published: meta.published,
    subjects: meta.subjects,
    description: plainText(meta.description),
    ...(options.seeded ? { seeded: true as const } : {}),
  }

  const bytes: BookFile = { bookId: book.id, data: file.slice(), type: sniffed.mime }
  await addBook(book, bytes)
  /* This reader opens PDFs, so the pdfjs data files are worth having offline.
     Deliberately not awaited: the import is done, and the warm-up is slow,
     silent and entirely optional. */
  if (sniffed.format === 'pdf') void warmPdfData()
  return { ok: true, book, duplicate: false }
}

/** Several files at once — a multi-select, or a drop of a whole folder's worth.
    Sequential on purpose: four archives decompressing at once on a phone is
    four times the memory for the same total wait, and the wait is what the
    reader sees either way. */
export async function importFiles(files: File[]): Promise<ImportResult[]> {
  const out: ImportResult[] = []
  for (const file of files) out.push(await importFile(file))
  return out
}

/* ------------------------------------------------------------------ covers --

   Publishers ship 1600px covers; the shelf draws them at 56px and the book
   sheet at about 200. Storing the original means every shelf paint decodes a
   full-size JPEG per row, and IndexedDB carries a megabyte of pixels nothing
   ever shows. 800px on the long edge is generous for a 3× phone at detail size
   and roughly a tenth of the bytes.

   The original is not kept. Nothing in the app displays a cover larger than the
   book sheet, and a "maybe later" copy of every cover is exactly the kind of
   quiet growth that makes a local-first app run out of quota. */
const COVER_MAX = 800

async function shrinkCover(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, COVER_MAX / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && blob.size < 120_000) {
      bitmap.close()
      return blob
    }
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
    const context = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null
    if (!context) {
      bitmap.close()
      return blob
    }
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const out = canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
      : await new Promise<Blob | null>((resolve) =>
          (canvas as HTMLCanvasElement).toBlob(resolve, 'image/webp', 0.82),
        )
    /* Smaller only. A tiny cover re-encoded to webp can come out bigger, and
       shipping the larger of the two would be a resize that added bytes. */
    return out && out.size < blob.size ? out : blob
  } catch {
    /* An SVG cover, a CMYK JPEG, a decoder that gave up. The original is a
       perfectly good cover; it is just a big one. */
    return blob
  }
}

/** For the picker's filter dropdown: the extensions each format answers to.
    Sniffing still decides what a file actually is — this only names the filter.

    `.fb2.zip` used to sit under fbz and is gone. It is not one extension, and
    an `accept` token with two dots in it is a token no dialog can match; the
    file it was meant to catch is a zip, and a zip holding one book is unwrapped
    by `sniffZip` regardless of what it is called. */
export const ACCEPT: Record<Format, string[]> = {
  epub: ['.epub'],
  mobi: ['.mobi', '.prc'],
  azw3: ['.azw3', '.azw', '.kf8'],
  fb2: ['.fb2'],
  fbz: ['.fbz'],
  txt: ['.txt'],
  markdown: ['.md', '.markdown'],
  html: ['.html', '.htm', '.xhtml'],
  pdf: ['.pdf'],
}

/** The File System Access dialog's one filter group, derived rather than typed.

    It was typed out by hand next to the picker call, and a hand-kept second
    copy of a list is a list that drifts. Built from ACCEPT and MIME so the
    dialog cannot offer a narrower set of formats than the sniff can read. */
export const PICKER_ACCEPT: Record<string, string[]> = Object.fromEntries(
  (Object.keys(ACCEPT) as Format[]).map((format) => [MIME[format], ACCEPT[format]]),
)

/** `application/octet-stream`, and the reason a file input needs it.

    iOS builds the picker's action sheet from the accept list. Include anything
    that conforms to `public.image` or `public.movie` — or leave the attribute
    OFF, which allows everything — and Safari offers Photo Library and Take
    Photo or Video above the file browser. An ereader asking for the camera is
    the sheet saying this app is something other than what it is.

    Dropping the attribute was the fix for the opposite bug and caused this one:
    an accept list of extensions is a whitelist on iOS, `.mobi`, `.azw3`, `.fb2`
    and `.fbz` are registered by nothing on a stock iPhone, so they resolved to
    no Uniform Type Identifier and could not be picked at all.

    This token is what satisfies both. Safari resolves it to `public.data`,
    conformance across the accept list is a union, and EVERY file conforms to
    `public.data` — so nothing is greyed out, including the four extensions the
    system has never heard of. It is not an image or a movie type, so the camera
    and the photo library are not offered.

    Exported because the backup picker in SettingsPage.tsx needs the same token
    for the same reason, and this reasoning should exist once. */
export const ANY_FILE = 'application/octet-stream'

/** What the book input's `accept` says: ANY_FILE, then every extension this
    app reads.

    BE CLEAR ABOUT WHAT THE EXTENSIONS DO HERE, WHICH IS NOT FILTERING. Accept
    is a union, ANY_FILE admits everything, so no dialog on any platform is
    narrowed by the fifteen tokens after it. They are here to say in the DOM
    what this app reads — the one place a reader with a devtools window can
    check the claim the shelf makes — and so that a future platform which does
    not need ANY_FILE has something to fall back to rather than an empty
    attribute.

    A real filter is not available: it costs `.mobi`, `.azw3`, `.fb2` and
    `.fbz` on iOS, which is not a trade worth making for a tidier dialog.
    Desktop Chrome and Edge get a genuine Books filter anyway, through
    `showOpenFilePicker` and PICKER_ACCEPT above, where matching is not a UTI
    lookup.

    Sniffing is the authority everywhere and always was: `src/import/sniff.ts`
    reads the bytes, so a non-book gets a sentence naming what it is instead of
    a broken render. */
export const INPUT_ACCEPT = [
  ANY_FILE,
  ...(Object.keys(ACCEPT) as Format[]).flatMap((format) => ACCEPT[format]),
].join(',')
