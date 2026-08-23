import { addBook, db } from '../db'
import type { Book, BookFile, Format } from '../types'
import { plainText, readMeta, titleFromName } from './meta'
import { sniff } from './sniff'

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

/** For the drop target and the picker: the extensions worth accepting. Sniffing
    still decides — this only stops the file dialog showing a folder of noise. */
export const ACCEPT: Record<Format, string[]> = {
  epub: ['.epub'],
  mobi: ['.mobi', '.prc'],
  azw3: ['.azw3', '.azw', '.kf8'],
  fb2: ['.fb2'],
  fbz: ['.fbz', '.fb2.zip'],
  txt: ['.txt'],
  markdown: ['.md', '.markdown'],
  html: ['.html', '.htm', '.xhtml'],
  pdf: ['.pdf'],
}

export const ACCEPT_ATTR = Object.values(ACCEPT).flat().join(',')
