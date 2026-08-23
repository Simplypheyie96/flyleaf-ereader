import { BlobReader, BlobWriter, TextWriter, ZipReader, configure } from '@zip.js/zip.js'
import type { Meta } from './meta'
import { isFile } from './zip'

/* EPUB metadata and cover, read straight out of the archive.

   Same library foliate-js uses for the same job, so vendoring the engine at P2
   adds a parser, not a second zip implementation.

   Web workers off, on purpose: zip.js spawns them from a blob URL, which is
   one more thing to keep working across a service worker, a strict CSP and an
   offline cold start — for a job that happens once per import and reads a few
   hundred KB of a file the reader is already waiting on. The one case that
   would justify a worker is a huge cover in a huge archive, and the fix for
   that is not to decompress it on a thread but to not need it decompressed. */
configure({ useWebWorkers: false })

const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')

/** Resolve an OPF-relative href against the OPF's own directory. Covers live
    beside the manifest, not beside the archive root, and getting this wrong is
    the reason so many readers show "no cover" on a book that has one. */
function resolve(base: string, href: string): string {
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : ''
  const joined = dir + decodeURIComponent(href)
  /* Collapse ../ by hand — URL() would need a fake origin and would re-encode
     the result, and archive entry names are matched byte-for-byte. */
  const out: string[] = []
  for (const part of joined.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return out.join('/')
}

export async function readEpub(file: File): Promise<Meta> {
  const reader = new ZipReader(new BlobReader(file))
  try {
    const entries = await reader.getEntries()
    const find = (path: string) => entries.find((e) => e.filename === path)
    const text = async (path: string) => {
      const entry = find(path)
      if (!isFile(entry)) return null
      return await entry.getData(new TextWriter())
    }

    /* Encryption first. A file we cannot read is not a file to extract a
       hopeful title from. */
    const enc = await text('META-INF/encryption.xml')
    if (enc && isEncrypted(enc)) return { drm: true }

    /* container.xml → the OPF's path. Never assumed to be
       OEBPS/content.opf, which is a convention and not a rule. */
    const container = await text('META-INF/container.xml')
    if (!container) return {}
    const opfPath = xml(container).querySelector('rootfile')?.getAttribute('full-path')
    if (!opfPath) return {}

    const opfText = await text(opfPath)
    if (!opfText) return {}
    const opf = xml(opfText)

    const one = (tag: string) => opf.getElementsByTagName(`dc:${tag}`)[0]?.textContent?.trim() || undefined
    const all = (tag: string) =>
      Array.from(opf.getElementsByTagName(`dc:${tag}`))
        .map((n) => n.textContent?.trim())
        .filter((v): v is string => !!v)

    /* Authors joined as a title page would print them, per types.ts: this is a
       reader, not a catalogue, and "and" is how a book says it. */
    const authors = all('creator')
    const meta: Meta = {
      title: one('title'),
      author: authors.length > 2
        ? `${authors.slice(0, -1).join(', ')} and ${authors[authors.length - 1]}`
        : authors.join(' and ') || undefined,
      language: one('language'),
      publisher: one('publisher'),
      published: one('date'),
      subjects: all('subject').length ? all('subject') : undefined,
      description: one('description'),
    }

    const coverPath = findCover(opf, opfPath)
    if (coverPath) {
      const entry = find(coverPath)
      if (isFile(entry)) {
        const type = opf.querySelector(`item[href$="${coverPath.split('/').pop()}"]`)
          ?.getAttribute('media-type') ?? 'image/jpeg'
        meta.cover = await entry.getData(new BlobWriter(type))
      }
    }
    return meta
  } finally {
    /* The reader holds the blob open. Not closing it keeps the file's bytes
       pinned for the life of the tab, which on a 40MB import is 40MB. */
    await reader.close()
  }
}

/** EPUB 3 declares its cover with a manifest property; EPUB 2 with a `meta`
    pointing at a manifest id. Both are common in the wild — Standard Ebooks
    write both — so both are read, in that order. */
function findCover(opf: Document, opfPath: string): string | null {
  const byProperty = Array.from(opf.querySelectorAll('item')).find((i) =>
    (i.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image'),
  )
  if (byProperty?.getAttribute('href')) return resolve(opfPath, byProperty.getAttribute('href')!)

  const id = Array.from(opf.querySelectorAll('metadata > meta, meta'))
    .find((m) => m.getAttribute('name') === 'cover')
    ?.getAttribute('content')
  if (id) {
    const item = opf.querySelector(`item[id="${CSS.escape(id)}"]`)
    const href = item?.getAttribute('href')
    if (href) return resolve(opfPath, href)
  }

  /* Last resort: a manifest image whose href says what it is. Guessing, and
     labelled as guessing — but a real cover from the file still beats
     DESIGN.md's "nothing", and "nothing" is what the caller gets if this
     misses. */
  const named = Array.from(opf.querySelectorAll('item')).find(
    (i) =>
      (i.getAttribute('media-type') ?? '').startsWith('image/') &&
      /cover/i.test(i.getAttribute('href') ?? ''),
  )
  const href = named?.getAttribute('href')
  return href ? resolve(opfPath, href) : null
}

/** An `encryption.xml` full of obfuscated fonts is a normal EPUB — font
    obfuscation uses the same file and is not DRM. One encrypted *document* is.
    Telling them apart is the difference between refusing a legitimate book and
    silently rendering an unreadable one. */
function isEncrypted(encryptionXml: string): boolean {
  const doc = xml(encryptionXml)
  const refs = Array.from(doc.getElementsByTagName('CipherReference'))
  if (!refs.length) return false
  const OBFUSCATION = [
    'http://www.idpf.org/2008/embedding',
    'http://ns.adobe.com/pdf/enc#RC',
  ]
  return refs.some((ref) => {
    const uri = ref.getAttribute('URI') ?? ''
    const algorithm = ref.closest('EncryptedData')
      ?.querySelector('EncryptionMethod')
      ?.getAttribute('Algorithm') ?? ''
    /* A font being obfuscated is fine. Anything else being encrypted is not,
       and an .xhtml behind any algorithm at all is a chapter we cannot read. */
    if (OBFUSCATION.includes(algorithm)) return false
    return !/\.(ttf|otf|woff2?)$/i.test(uri)
  })
}
