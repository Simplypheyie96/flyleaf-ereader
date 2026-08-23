/* Writes `fixture.fb2` and `fixture.fbz` — FictionBook 2, plain and zipped.

   Why this exists: FB2 and FBZ were the two declared formats with no fixture at
   all, so nothing had ever opened one. That gap is how a sniff can be wrong
   about a whole format for months (see the EPUB central-directory bug in
   `src/import/sniff.ts`), and the fix for that class of bug is a file, not a
   closer reading.

   FB2 is a single XML document, so this is authored rather than assembled: a
   `<description>` with a title, an author split across first/middle/last (which
   is how FB2 stores a name, and where a reader that concatenates naively gets
   double spaces), a binary cover referenced by `l:href="#cover.png"`, and four
   `<section>`s so the paginator has more than one screen to lay out.

   The FBZ is the same bytes in a zip — and deliberately zipped with the entry
   NOT first and deflated, which is the shape that broke EPUB.

   Run: node audit/fixtures/make-fb2.mjs */

import { writeFileSync } from 'node:fs'
import { deflateRawSync, crc32 } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/* A 1x1 PNG, base64. Small enough to inline, real enough to decode — the cover
   path in `src/import/fb2.ts` runs createImageBitmap on it. */
const COVER =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/gGnkY7iAAAAAElFTkSuQmCC'

const para = (n) =>
  `<p>Section ${n}. ` +
  'The paginator needs more than one screen of text to have anything to do, so this '.repeat(6) +
  `paragraph is longer than it looks. It is section ${n} of four.</p>`

const body = [1, 2, 3, 4]
  .map((n) => `<section><title><p>Chapter ${n}</p></title>${para(n)}${para(n + 10)}</section>`)
  .join('\n')

const fb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
 <description>
  <title-info>
   <genre>sf</genre>
   <author><first-name>Ada</first-name><middle-name>Byron</middle-name><last-name>Lovelace</last-name></author>
   <book-title>A Measured Fixture</book-title>
   <annotation><p>Four sections, one cover, one author with three name parts.</p></annotation>
   <lang>en</lang>
   <coverpage><image l:href="#cover.png"/></coverpage>
  </title-info>
  <document-info><date value="1843-10-01">1843</date></document-info>
 </description>
 <body>
${body}
 </body>
 <binary id="cover.png" content-type="image/png">${COVER}</binary>
</FictionBook>
`

writeFileSync(join(here, 'fixture.fb2'), fb2)

/* A one-entry zip, written by hand rather than shelling out to `zip`: the point
   of this fixture is the awkward shape (deflated, and preceded by a directory
   entry so it is not the first thing in the file), and a hand-written archive
   is the only way to guarantee it. */
function zip(entries) {
  const chunks = []
  const central = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const body = data.length ? deflateRawSync(data) : Buffer.alloc(0)
    const crc = data.length ? crc32(data) : 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)          // version needed
    local.writeUInt16LE(data.length ? 8 : 0, 8) // deflate, or stored for the dir
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    chunks.push(local, nameBytes, body)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(data.length ? 8 : 0, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(body.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBytes.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBytes)
    offset += local.length + nameBytes.length + body.length
  }
  const cdBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cdBytes, end])
}

writeFileSync(
  join(here, 'fixture.fbz'),
  zip([
    ['meta/', Buffer.alloc(0)],
    ['book/fixture.fb2', Buffer.from(fb2, 'utf8')],
  ]),
)

console.log('wrote fixture.fb2 and fixture.fbz')
