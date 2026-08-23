import type { Format } from '../types'

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

const MIME: Record<Format, string> = {
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

async function sniffZip(file: File, head: Uint8Array): Promise<Sniffed> {
  /* An EPUB's first entry must be an uncompressed `mimetype` holding exactly
     one string. Searching the first 200 bytes for it rather than parsing the
     local header handles the files that carry an extra field there — which the
     spec forbids and which exist anyway. */
  if (ascii(head, 0, 200).includes('application/epub+zip')) {
    /* META-INF/encryption.xml is how an EPUB says its contents are encrypted.
       It is also how a legitimately obfuscated font is declared, so the
       filename alone is not the answer — the entry is read in `readEpub`,
       which can tell an obfuscated font from an encrypted chapter. Here we
       only need to know it is worth looking. */
    return { ok: true, format: 'epub', mime: MIME.epub }
  }

  /* Not an EPUB. A zip containing a .fb2 is an FBZ; anything else is a zip we
     have no business opening. Reading the central directory needs the tail of
     the file, so this is the one sniff that touches two ends of it. */
  const tailBytes = new Uint8Array(await file.slice(-Math.min(file.size, 65_557)).arrayBuffer())
  const tail = ascii(tailBytes, 0, tailBytes.length)
  if (/\.fb2\b/i.test(tail)) return { ok: true, format: 'fbz', mime: MIME.fbz }
  if (/\.(cbz|jpe?g|png|webp)\b/i.test(tail)) {
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
