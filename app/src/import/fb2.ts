import { BlobReader, TextWriter, ZipReader, configure } from '@zip.js/zip.js'
import type { Format } from '../types'
import type { Meta } from './meta'
import { isFile } from './zip'

configure({ useWebWorkers: false })

/* FB2 keeps everything in one XML file, and FBZ is that file in a zip. The
   cover is base64 inside the document itself — a `<binary>` element referenced
   by `<coverpage>` — which is the one format where the cover costs no second
   read and every other format's cover costs one. */

export async function readFb2(file: File, format: Format): Promise<Meta> {
  const text = format === 'fbz' ? await unzipFb2(file) : await file.text()
  if (!text) return {}

  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const info = doc.getElementsByTagName('title-info')[0]
  if (!info) return {}

  const pick = (tag: string) => info.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined

  /* FB2 splits a name across three elements, and every real file fills in a
     different two of them. */
  const authors = Array.from(info.getElementsByTagName('author')).map((a) => {
    const part = (tag: string) => a.getElementsByTagName(tag)[0]?.textContent?.trim() ?? ''
    return [part('first-name'), part('middle-name'), part('last-name')].filter(Boolean).join(' ')
  }).filter(Boolean)

  const meta: Meta = {
    title: pick('book-title'),
    author: authors.join(' and ') || undefined,
    language: pick('lang'),
    published: pick('date'),
    description: info.getElementsByTagName('annotation')[0]?.textContent?.trim() || undefined,
    subjects: Array.from(info.getElementsByTagName('genre'))
      .map((g) => g.textContent?.trim())
      .filter((v): v is string => !!v),
  }
  if (!meta.subjects?.length) delete meta.subjects

  /* <coverpage><image l:href="#id"/></coverpage> → <binary id="id">base64 */
  const href = info.getElementsByTagName('coverpage')[0]
    ?.getElementsByTagName('image')[0]
    ?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
  const id = href?.replace(/^#/, '')
  if (id) {
    const binary = Array.from(doc.getElementsByTagName('binary')).find((b) => b.getAttribute('id') === id)
    const base64 = binary?.textContent?.replace(/\s+/g, '')
    if (base64) {
      try {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        meta.cover = new Blob([bytes], { type: binary?.getAttribute('content-type') ?? 'image/jpeg' })
      } catch {
        /* a truncated base64 cover is a missing cover, not a failed import */
      }
    }
  }
  return meta
}

async function unzipFb2(file: File): Promise<string | null> {
  const reader = new ZipReader(new BlobReader(file))
  try {
    const entry = (await reader.getEntries()).find((e) => /\.fb2$/i.test(e.filename))
    return isFile(entry) ? await entry.getData(new TextWriter()) : null
  } finally {
    await reader.close()
  }
}
