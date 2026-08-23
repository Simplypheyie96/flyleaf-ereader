/* Writes the awkward zip shapes — the regression suite for `src/import/sniff.ts`.

   Every one of these is a real thing a reader hands the app, and one of them was
   a bug the reader found before the audit did: an EPUB that has been unzipped
   and zipped again. A general-purpose zipper deflates the `mimetype` entry and
   writes entries in directory-walk order, so the old sniff — which looked for
   the plain string `application/epub+zip` in the first 200 bytes and called
   anything else "a zip file" — refused a book the engine could read perfectly.

   The shapes, and what each one is for:

     rezipped.epub   a valid EPUB, mimetype deflated and not first. MUST import.
     wrapped.zip     a zip holding exactly one EPUB. MUST import, unwrapped.
     twobooks.zip    two EPUBs in one zip. Must refuse, and say how many.
     comic.zip       images only. Must refuse as a comic archive (out of scope).
     junk.zip        no book anywhere. Must refuse as a zip.
     truncated.epub  a conforming EPUB head with no central directory — what a
                     cancelled download leaves behind. Must refuse as unfinished;
                     it used to import as a book titled "truncated".

   Built from the shipped Time Machine so the expected title and author are
   known without a second source of truth.

   Run: node audit/fixtures/make-zip-shapes.mjs */

import { readFileSync, writeFileSync } from 'node:fs'
import { deflateRawSync, crc32, deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..', '..')
const seed = (name) => readFileSync(join(app, 'public', 'seed', name))

const TIME = seed('the-time-machine.epub')
const PRIDE = seed('pride-and-prejudice.epub')

/** A zip written by hand: the point of these fixtures is entry order and
    compression method, and only writing the bytes guarantees both. Directory
    entries are stored, files are deflated. */
function zip(entries) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, data] of entries) {
    const n = Buffer.from(name, 'utf8')
    const deflated = data.length ? deflateRawSync(data) : Buffer.alloc(0)
    const method = data.length ? 8 : 0
    const crc = data.length ? crc32(data) : 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(n.length, 26)
    parts.push(local, n, deflated)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(deflated.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(n.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, n)
    offset += local.length + n.length + deflated.length
  }
  const cdBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cdBytes, end])
}

/* The re-zip: unpack the real EPUB and write it back with every entry deflated
   and META-INF/ first, which is what `zip -r` produces. Uses the system unzip
   for the unpack because the alternative is a full inflate implementation here
   for a fixture nobody reads the contents of. */
const tmp = join(here, '.rezip-tmp')
execFileSync('rm', ['-rf', tmp])
execFileSync('mkdir', ['-p', tmp])
execFileSync('unzip', ['-q', join(app, 'public', 'seed', 'the-time-machine.epub'), '-d', tmp])
execFileSync('zip', ['-qr', '-X', join(here, 'rezipped.epub'), '.'], { cwd: tmp })
execFileSync('rm', ['-rf', tmp])

writeFileSync(join(here, 'wrapped.zip'), zip([['the-time-machine.epub', TIME]]))
writeFileSync(
  join(here, 'twobooks.zip'),
  zip([['the-time-machine.epub', TIME], ['pride-and-prejudice.epub', PRIDE]]),
)

/* A 1x1 PNG per page, which is all "is every entry an image" needs. */
const png = () => {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 0xff, 0xff, 0xff]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
writeFileSync(
  join(here, 'comic.zip'),
  zip([['page01.png', png()], ['page02.png', png()], ['page03.png', png()]]),
)
writeFileSync(
  join(here, 'junk.zip'),
  zip([['notes.txt', Buffer.from('nothing to read here\n')], ['data.csv', Buffer.from('a,b\n1,2\n')]]),
)

/* The first 40KB of a real EPUB: a conforming head, no central directory. */
writeFileSync(join(here, 'truncated.epub'), TIME.subarray(0, 40_000))

console.log('wrote rezipped.epub, wrapped.zip, twobooks.zip, comic.zip, junk.zip, truncated.epub')
