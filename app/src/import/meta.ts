import type { Format } from '../types'

/* What the file says about itself.

   Every extractor here returns the same shape and none of them throw: a book
   whose metadata cannot be read is still a book, and refusing to import it
   because its OPF is malformed would be the app deciding that a file it can
   *display* is a file the reader cannot *have*. Every field is optional and the
   title falls back to the filename, which is what the reader called it anyway.

   Cover extraction is deliberately in the same pass. Opening a 40MB archive
   twice — once for the title, once for the image — is a second multi-second
   wait for something we already had the file open for. */

export type Meta = {
  title?: string
  author?: string
  language?: string
  publisher?: string
  published?: string
  subjects?: string[]
  description?: string
  cover?: Blob
  /** an EPUB that turned out to be encrypted rather than merely obfuscated */
  drm?: true
}

/** Title from the filename, for the formats that carry no metadata and as the
    fallback for the ones that do. Strips the extension and turns the two
    separators every download in the world uses back into spaces. */
export function titleFromName(name: string): string {
  const base = name.replace(/\.[a-z0-9]{1,9}$/i, '')
  return base.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim() || name
}

export async function readMeta(file: File, format: Format): Promise<Meta> {
  try {
    switch (format) {
      case 'epub':
        return await (await import('./epub')).readEpub(file)
      case 'fb2':
      case 'fbz':
        return await (await import('./fb2')).readFb2(file, format)
      case 'mobi':
      case 'azw3':
        return await (await import('./mobi')).readMobi(file)
      case 'html':
      case 'markdown':
      case 'txt':
        return await (await import('./text')).readText(file, format)
      case 'pdf':
        /* Dynamic, like every other branch here, and for a sharper reason: the
           PDF extractor pulls in pdfjs and its worker. Importing an EPUB must
           not download a PDF engine, and this keeps that true. */
        return await (await import('./pdf')).readPdf(file)
    }
  } catch {
    /* A malformed file is still a file. The reader gets the filename as a
       title and a book they can open, rather than an error about an OPF. */
    return {}
  }
}

/* ------------------------------------------------------------------- prose --

   Metadata that arrives as markup. `dc:description` is declared as text but
   publishers routinely put a whole blurb of escaped HTML in it — Standard
   Ebooks does, which is how a `<p><i>Pride and Prejudice</i>` landed on the
   book sheet as literal angle brackets. MOBI's EXTH description and FB2's
   `<annotation>` do the same. Titles and authors rarely carry tags but often
   carry entities: `&amp;` in a publisher name is common enough to matter.

   Parsed with DOMParser rather than assigned to `innerHTML`. A DOMParser
   document is inert — no scripts, no image loads — so an `onerror` payload in
   someone's OPF is text here, not a fetch. Two passes because the value is
   often escaped twice: once by the OPF and once by whatever wrote it.

   Whitespace is collapsed at the end. The source has paragraph breaks and
   indentation we are about to render as a single blurb, and a stray run of
   newlines inside a `<p>` is the file's formatting, not the author's. */
export function plainText(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let text = raw
  for (let pass = 0; pass < 2 && /[<&]/.test(text); pass++) {
    const doc = new DOMParser().parseFromString(text, 'text/html')
    const next = doc.body.textContent ?? ''
    if (next === text) break
    text = next
  }
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean || undefined
}
