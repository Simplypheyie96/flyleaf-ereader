// @ts-ignore
import { unzlibSync } from '../vendor/foliate-js/vendor/fflate.js'
// @ts-ignore
import { MOBI } from '../vendor/foliate-js/mobi.js'
import type { Meta } from './meta'

/* MOBI and AZW3 metadata, from the PalmDB record 0.

   Title and author only, and the reason is worth writing down rather than
   leaving as a gap someone fills in badly later: a MOBI cover is an image
   *record* addressed by an EXTH offset that is relative to a record index that
   only means anything once the whole record table has been walked — and at P2
   foliate-js's `mobi.js` walks it properly, for the reader. Reimplementing
   half of that here to get a thumbnail two phases early would be a second
   MOBI parser to keep correct.

   So a Kindle book imports with its real title and its real author and no
   cover, which DESIGN.md already has a word for: "real cover or nothing." */

const latin1 = new TextDecoder('latin1')

/* EXTH record types. There are ~100; these are the ones that carry a name. */
const EXTH_AUTHOR = 100
const EXTH_PUBLISHER = 101
const EXTH_DESCRIPTION = 103
const EXTH_SUBJECT = 105
const EXTH_PUBLISHED = 106
const EXTH_TITLE = 503
const EXTH_LANGUAGE = 524

export async function readMobi(file: File): Promise<Meta> {
  /* Record 0's offset is the first entry of the record list at byte 78. */
  const header = new DataView(await file.slice(0, 82).arrayBuffer())
  const rec0Start = header.getUint32(78)

  /* Record 0 is the PalmDOC header (16 bytes), the MOBI header, then EXTH.
     16KB covers every real file's record 0 with room to spare. */
  const bytes = new Uint8Array(await file.slice(rec0Start, rec0Start + 16_384).arrayBuffer())
  const view = new DataView(bytes.buffer)
  if (latin1.decode(bytes.subarray(16, 20)) !== 'MOBI') return {}

  const mobiHeaderLength = view.getUint32(20)
  const textEncoding = view.getUint32(28) === 65001 ? 'utf-8' : 'latin1'
  const decode = (b: Uint8Array) => new TextDecoder(textEncoding, { fatal: false }).decode(b)

  const meta: Meta = {}

  /* The PDB name at +84 of the MOBI header is the fallback title. It is capped
     at 32 bytes in the file header, so long titles arrive truncated there —
     which is exactly why EXTH 503 exists and is preferred below. */
  const titleOffset = view.getUint32(84)
  const titleLength = view.getUint32(88)
  if (titleLength > 0 && titleLength < 1024 && titleOffset + titleLength <= bytes.length) {
    meta.title = decode(bytes.subarray(titleOffset, titleOffset + titleLength)).trim() || undefined
  }

  /* EXTH follows the MOBI header, if bit 6 of the exth flags is set. */
  const exthFlags = view.getUint32(128)
  if (!(exthFlags & 0x40)) return meta

  const exthStart = 16 + mobiHeaderLength
  if (latin1.decode(bytes.subarray(exthStart, exthStart + 4)) !== 'EXTH') return meta

  const count = view.getUint32(exthStart + 8)
  const authors: string[] = []
  const subjects: string[] = []
  let cursor = exthStart + 12

  for (let i = 0; i < count && cursor + 8 <= bytes.length; i++) {
    const type = view.getUint32(cursor)
    const length = view.getUint32(cursor + 4)
    /* A zero or absurd length is a corrupt table, and walking it further reads
       garbage as metadata. Stopping is the honest response. */
    if (length < 8 || cursor + length > bytes.length) break
    const value = () => decode(bytes.subarray(cursor + 8, cursor + length)).trim()

    switch (type) {
      case EXTH_AUTHOR: authors.push(value()); break
      case EXTH_SUBJECT: subjects.push(value()); break
      case EXTH_PUBLISHER: meta.publisher = value(); break
      case EXTH_DESCRIPTION: meta.description = value(); break
      case EXTH_PUBLISHED: meta.published = value(); break
      case EXTH_LANGUAGE: meta.language = value(); break
      /* EXTH 503 is the full, untruncated title. It wins over the PDB name. */
      case EXTH_TITLE: meta.title = value() || meta.title; break
    }
    cursor += length
  }

  /* Kindle files list one author per record, surname-first about half the
     time. Left exactly as written: guessing at "Austen, Jane" → "Jane Austen"
     gets Chinese and Hungarian names wrong, and a reader recognises the string
     their file actually carries. */
  if (authors.length) meta.author = authors.join(' and ')
  if (subjects.length) meta.subjects = subjects

  try {
    const mobi = new MOBI({ unzlib: unzlibSync })
    await mobi.open(file)
    const cover = await mobi.getCover()
    if (cover) meta.cover = cover
  } catch (err) {
    // cover extraction failed, which is fine
  }

  return meta
}
