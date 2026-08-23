import { BlobReader, BlobWriter, ZipReader, configure } from '@zip.js/zip.js'
import type { Entry, FileEntry } from '@zip.js/zip.js'
import type { Format } from '../types'
import { isFile } from './zip'

/* What is this file, really.

   Sniffed from bytes, never from the extension. Not pedantry: the single
   commonest thing a reader does is rename a file, and the second commonest is
   receive one that was named by something that guessed. An `.epub` that is
   really a zip of JPEGs is not an EPUB, and a `.txt` carrying an EPUB's
   magic number is.

   The extension gets exactly one job, at the bottom of this file, and it is the
   one job it can do: telling Markdown from plain text, which have no magic
   number to tell them apart because they are the same bytes. */

/** A file we can read, or a reason we cannot.

    DRM is its own outcome rather than an error, because it is not a failure —
    the file is intact and we understood it perfectly. It is a refusal, and the
    reader is owed the difference. */
export type Sniffed =
  | { ok: true; format: Format; mime: string }
  | { ok: false; reason: 'drm'; what: string }
  | { ok: false; reason: 'unsupported'; what: string }
  /* A zip with exactly one book inside it -- what a browser hands back when a
     download was wrapped, which is most of them. Not an error and not a format:
     the book is right there, so `importFile` unwraps it and imports that
     instead. Telling somebody "this is a zip" when we can already see the EPUB
     in it is a refusal dressed up as a diagnosis. */
  | { ok: false; reason: 'wrapped'; what: string; inner: File }

/* One media type per format, exported because the file dialog needs the same
   pairing this sniff does — see ACCEPT in ./index.ts. Two hand-kept copies of
   this map is how the picker came to offer a narrower set of formats than the
   parser could read. */
export const MIME: Record<Format, string> = {
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  fb2: 'application/x-fictionbook+xml',
  fbz: 'application/x-zip-compressed-fb2',
  txt: 'text/plain',
  markdown: 'text/markdown',
  html: 'text/html',
  pdf: 'application/pdf',
}

/* latin1 rather than String.fromCharCode(...bytes): the spread form throws on
   a 64KB slice, which is exactly the size of the central-directory scan below,
   and it fails as a stack overflow rather than as anything readable. latin1
   maps every byte to a codepoint, so a signature comparison is safe on it. */
/* Same reason as import/epub.ts: zip.js spawns workers from a blob URL, and a
   sniff is a few hundred bytes of central directory, not a decompression. */
configure({ useWebWorkers: false })

const latin1 = new TextDecoder('latin1')
const ascii = (b: Uint8Array, from: number, len: number) =>
  latin1.decode(b.subarray(from, from + len))

/* 4KB is enough for every check below and small enough to read from a 400MB
   file without thinking about it. The zip checks that need more than a header
   open the archive properly rather than reading further into this buffer. */
const HEAD = 4096

export async function sniff(file: File): Promise<Sniffed> {
  const head = new Uint8Array(await file.slice(0, HEAD).arrayBuffer())

  /* ---- PDF ---------------------------------------------------------------
     The signature is allowed to sit up to 1KB in, per the spec, and real files
     from real scanners do exactly that. */
  const headText = ascii(head, 0, Math.min(head.length, 1024))
  if (headText.includes('%PDF-')) return { ok: true, format: 'pdf', mime: MIME.pdf }

  /* ---- zip: EPUB, FBZ, or neither ---------------------------------------- */
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return sniffZip(file, head)
  }

  /* ---- PalmDB: MOBI, AZW, AZW3 ------------------------------------------
     The type/creator pair lives at offset 60 of the 78-byte PalmDB header. */
  if (file.size > 68 && ascii(head, 60, 8) === 'BOOKMOBI') return sniffMobi(file, head)

  /* ---- text-ish ---------------------------------------------------------
     Everything left is decoded as UTF-8 and read. A binary file that reaches
     here decodes to replacement characters and falls out the bottom. */
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head)
  if (text.includes('�')) return { ok: false, reason: 'unsupported', what: 'a binary file' }

  /* FB2 is XML with one unmistakable root element. */
  if (/<FictionBook[\s>]/i.test(text)) return { ok: true, format: 'fb2', mime: MIME.fb2 }
  if (/^\s*(<!doctype\s+html|<html[\s>]|<head[\s>])/i.test(text)) {
    return { ok: true, format: 'html', mime: MIME.html }
  }

  /* Markdown and plain text ARE the same bytes. This is the one place the
     extension is the best evidence available, and using it here is not a
     fallback — it is the only signal that exists. */
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'md' || ext === 'markdown' || ext === 'mdown') {
    return { ok: true, format: 'markdown', mime: MIME.markdown }
  }
  if (/^\s*(#{1,6}\s|\S.*\n=+\s*$)/m.test(text)) {
    /* An ATX heading or a setext underline in the first 4KB. Weaker evidence
       than an extension and only consulted when there is none. */
    return { ok: true, format: 'markdown', mime: MIME.markdown }
  }
  return { ok: true, format: 'txt', mime: MIME.txt }
}

/* Entry names that mean "a book, in a bag". Deliberately narrower than ACCEPT
   in import/index.ts: this list decides whether to UNWRAP an archive, and
   unwrapping a .txt out of a zip full of them would be a guess, not a rescue. */
const BOOKISH = /\.(epub|mobi|prc|azw3?|kf8|fb2|fbz|pdf)$/i
const IMAGEY = /\.(jpe?g|png|webp|gif|avif|bmp|cbz|cbr)$/i

/** The archive's directory, or null if it cannot be walked at all.

    getEntries() reads the end-of-central-directory record and the directory
    itself -- a few hundred bytes past the tail of the file -- and decompresses
    nothing. On a 40MB EPUB that is two range reads, which is why this is
    affordable inside a sniff. */
async function readDirectory(file: File): Promise<Entry[] | null> {
  try {
    const reader = new ZipReader(new BlobReader(file))
    const entries = await reader.getEntries()
    await reader.close()
    return entries
  } catch {
    return null
  }
}

async function sniffZip(file: File, head: Uint8Array): Promise<Sniffed> {
  /* This function used to be four lines: look for the plain string
     `application/epub+zip` in the first 200 bytes, call it an EPUB if it is
     there, scan the tail for a `.fb2`, and call everything else "a zip file".

     Which rejected ordinary EPUBs, and that is the worst kind of wrong. An
     EPUB's first entry is *supposed* to be an uncompressed `mimetype`, so on a
     file straight from a publisher the string is right there at the front. But
     any EPUB that has been unzipped and zipped again has a deflated mimetype
     written in whatever order the zipper walked the directory -- `zip -r` does
     exactly that, and so does every repack script and every "I fixed the
     metadata" pass. The string is not in the first 200 bytes and the entry is
     not first, so the sniff refused the file.

     None of those files are broken, and we could already read every one of
     them: foliate-js opens an EPUB by reading META-INF/container.xml and never
     looks at the mimetype entry at all (vendor/foliate-js/epub.js). The sniff
     was stricter than the engine behind it, and the reader was told "Flyleaf
     does not read a zip file" about a book that would have opened perfectly.

     Reproduced before the fix by unzipping the shipped Time Machine and
     re-zipping it with `zip -qr -X`: the entry order became META-INF/, then
     container.xml, then a deflated mimetype, and the old sniff called it a zip.

     So: read the directory. Every time, including for a file whose head looks
     conforming -- the head-string shortcut was tried and deliberately removed,
     because a truncated download keeps its first 512 bytes and loses its
     directory, and the shortcut let one onto the shelf as a book with no
     metadata that then failed to open. Verified: a 40KB head of the Time
     Machine used to import as a book titled "truncated" and now refuses as an
     unfinished download. Two range reads is the whole cost, and readMeta opens
     the same archive a moment later regardless. */
  const entries = await readDirectory(file)
  if (!entries) {
    /* Worth its own sentence. "Damaged" tells the reader to download it again;
       "unsupported" tells them not to bother, and they are not the same
       advice. */
    return { ok: false, reason: 'unsupported', what: 'a damaged or unfinished download' }
  }
  const names = entries.map((e) => e.filename)
  const has = (re: RegExp) => names.some((n) => re.test(n))

  /* What foliate itself requires, and therefore the only test that matters. The
     case-insensitive second look is for the handful of archives that store it
     as META-INF/Container.xml, which is invalid and readable. */
  if (has(/^META-INF\/container\.xml$/i)) {
    return { ok: true, format: 'epub', mime: MIME.epub }
  }

  /* The declared mimetype, now used for what it is actually good for: telling
     a damaged EPUB from a zip that was never a book. */
  const declared = ascii(head, 0, Math.min(head.length, 512)).includes('application/epub+zip')
  if (has(/\.fb2$/i)) return { ok: true, format: 'fbz', mime: MIME.fbz }

  /* One book in a bag -- a download that arrived wrapped, which is most of
     them. The book is right there in the directory listing, so hand it back
     rather than describing the bag. */
  /* Typed predicate rather than a bare isFile(): the narrowing has to survive
     the filter, or getData below is only reachable behind a non-null assertion
     that would also silence a real mistake. */
  const books = entries.filter(
    (e): e is FileEntry => isFile(e) && BOOKISH.test(e.filename),
  )
  if (books.length === 1) {
    const entry = books[0]
    try {
      const blob = await entry.getData(new BlobWriter())
      const name = entry.filename.split('/').pop() || entry.filename
      return {
        ok: false,
        reason: 'wrapped',
        what: `a zip holding ${name}`,
        inner: new File([blob], name, { lastModified: file.lastModified }),
      }
    } catch {
      /* Encrypted (a password-protected zip) or corrupt. Either way the book is
         visible and unreachable, which is worth saying precisely. */
      return { ok: false, reason: 'unsupported', what: 'a zip whose contents could not be read' }
    }
  }
  if (books.length > 1) {
    return { ok: false, reason: 'unsupported', what: `a zip holding ${books.length} books` }
  }

  /* An OPF with no container.xml. Not an EPUB by any reader's definition, but
     it is nearly one, and "this EPUB is missing META-INF/container.xml" is a
     thing somebody can act on. */
  if (declared || has(/\.opf$/i)) {
    return { ok: false, reason: 'unsupported', what: 'an EPUB with no META-INF/container.xml' }
  }

  /* Images and nothing readable: a comic archive, which is out of scope by
     decision rather than by omission. */
  const files = entries.filter((e) => isFile(e))
  if (files.length > 0 && files.every((e) => IMAGEY.test(e.filename))) {
    return { ok: false, reason: 'unsupported', what: 'a comic archive' }
  }

  return { ok: false, reason: 'unsupported', what: 'a zip file' }
}

async function sniffMobi(file: File, head: Uint8Array): Promise<Sniffed> {
  const view = new DataView(head.buffer)

  /* Record 0 holds the PalmDOC header, then the MOBI header. The record list
     starts at offset 78; each entry is 8 bytes and begins with the offset. */
  const rec0 = view.getUint32(78)
  const rec0Head = new Uint8Array(await file.slice(rec0, rec0 + 256).arrayBuffer())
  const rec0View = new DataView(rec0Head.buffer)

  /* PalmDOC's encryption field: 0 none, 1 old Mobipocket, 2 Amazon DRM. Both
     nonzero values mean the text is not ours to decode, and neither is a
     failure to report as one. */
  const encryption = rec0View.getUint16(12)
  if (encryption !== 0) return { ok: false, reason: 'drm', what: 'a Kindle book' }

  /* MOBI header magic at +16, its declared version at +36. Version 8 is KF8 —
     AZW3. Everything below it is MOBI, whatever the file is called. */
  if (ascii(rec0Head, 16, 4) === 'MOBI') {
    const version = rec0View.getUint32(36)
    return version >= 8
      ? { ok: true, format: 'azw3', mime: MIME.azw3 }
      : { ok: true, format: 'mobi', mime: MIME.mobi }
  }
  return { ok: true, format: 'mobi', mime: MIME.mobi }
}
