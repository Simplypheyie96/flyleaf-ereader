/* An EPUB that fights the stock, so audit/darkstock.mjs has something to measure.

   The three dark stocks (Coal, Dusk, Pitch) are the reason readingCss.ts
   collapses every author colour to the stock's own ink — SPEC.md § 2 and the
   comment block at readingCss.ts:213. A trade EPUB ships light-mode colours: a
   dedication in #1a1a2e, a chapter number in pale grey, a pull-quote in the
   publisher's brand navy. On a dark ground those are invisible.

   No real book carries every one of those cases at once, so this fixture does.
   It is deliberately hostile in six distinct ways, one per paragraph, and each
   one is a route a colour can take PAST plain inheritance:

     1. a stylesheet rule           — outranks `html { color }` by cascade
     2. an inline `style`           — outranks the stylesheet
     3. `!important` in the book    — needs the second, 3-ID reset pass
     4. `-webkit-text-fill-color`   — outranks `color` itself
     5. a light `background-color`  — the same failure inverted: dark box, dark ink
     6. `text-shadow`               — a light-page shadow reads as a halo

   Written as a STORED zip (no deflate), which is a valid EPUB and keeps this
   generator dependency-free.

   Run: node audit/fixtures/make-inked-book.mjs   → fixtures/inked.epub */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { crc32 } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))

/* The colours are the point: every one of them is dark, or on a light box, and
   would be unreadable on Coal / Dusk / Pitch if it survived. */
const CH = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title>
<style type="text/css">
  .navy { color: #1A1A2E; }
  .grey { color: #6B6B6B; }
  .bang { color: #101020 !important; }
  .fill { -webkit-text-fill-color: #12121F; color: #12121F; }
  .box  { background-color: #F4F2ED; color: #1B1917; }
  .halo { color: #191933; text-shadow: 0 1px 0 #FFFFFF; }
</style></head><body>
<h1 class="navy">Chapter One</h1>
<p class="navy" id="p-sheet">A stylesheet rule in the publisher's brand navy, which outranks inheritance and would vanish on a dark ground.</p>
<p style="color:#1A1A2E" id="p-inline">An inline style attribute, which outranks the stylesheet that outranks inheritance.</p>
<p class="bang" id="p-bang">An important declaration written by the book itself, which only a higher-specificity important reset can beat.</p>
<p class="fill" id="p-fill">A webkit text fill colour, which outranks the colour property it sits beside.</p>
<p class="box" id="p-box">A light background box drawn for a light page, which turns light ink on a light box into the same failure inverted.</p>
<p class="halo" id="p-halo">A text shadow drawn as a highlight for a white page, which reads as a halo on a dark one.</p>
<p id="p-plain">A paragraph with no colour of its own at all, which is the control: it inherits, so it was never in danger.</p>
</body></html>`

const FILES = [
  ['mimetype', 'application/epub+zip'],
  ['META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
  ['OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bid">flyleaf-audit-inked</dc:identifier>
<dc:title>The Inked Fixture</dc:title>
<dc:creator>Flyleaf Audit</dc:creator>
<dc:language>en</dc:language>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="ch1"/></spine></package>`],
  ['OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">Chapter One</a></li></ol></nav></body></html>`],
  ['OEBPS/ch1.xhtml', CH],
]

/* A stored-entry zip, written by hand. Local headers, then the central
   directory, then the end record — the three things a reader needs. */
const parts = []
const central = []
let offset = 0
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

for (const [name, text] of FILES) {
  const nm = Buffer.from(name, 'utf8')
  const data = Buffer.from(text, 'utf8')
  const crc = crc32(data)
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length), u16(nm.length), u16(0), nm,
  ])
  central.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length),
    u16(nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nm,
  ]))
  parts.push(local, data)
  offset += local.length + data.length
}
const dir = Buffer.concat(central)
const out = Buffer.concat([
  ...parts, dir,
  Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(FILES.length), u16(FILES.length),
    u32(dir.length), u32(offset), u16(0)]),
])
const path = join(HERE, 'inked.epub')
writeFileSync(path, out)
console.log(`wrote ${path} — ${out.length} bytes, ${FILES.length} entries`)
