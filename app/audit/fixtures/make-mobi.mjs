/* Writes `fixture.mobi` — a minimal, valid MOBI 6 (PalmDB, uncompressed).

   Why this exists: MOBI and AZW3 are the only supported formats with no real
   file to test against. There is no MOBI writer on a Mac by default
   (`ebook-convert`, `kindlegen`, `calibre` all absent), and FLYLEAF PATCH 6 in
   `src/vendor/foliate-js/mobi.js` touches exactly the MOBI section-load path —
   so the choice was a hand-built fixture or an untested patch.

   It is deliberately the *smallest* file that exercises what the app does with
   a Kindle book: EXTH title and author (so `src/import/mobi.ts` has something
   to read), four `<mbp:pagebreak>` sections (so the paginator has more than one
   to load), a `<guide>` reference and `filepos` links (so the contents list is
   built the MOBI way, from byte offsets rather than an NCX), and one section
   carrying an inline `<script>`, an `onclick` attribute and a `javascript:`
   href (so `src/reader/harden.ts` can be measured on this path, not just on
   EPUB).

   Field offsets are from the header maps at the top of `mobi.js`; everything
   is big-endian, which is what `getUint`'s bare `DataView` reads.

   Run: node audit/fixtures/make-mobi.mjs */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TITLE = 'A Kindle Fixture'
const AUTHOR = 'Flyleaf Audit'
const RECORD_SIZE = 4096

/* `filepos` is a byte offset into the whole text stream, written into the
   markup that the offset is measured against — so the value cannot be known
   until the markup is final. These tokens are each exactly as wide as the
   8-digit number that replaces them, which is what keeps the offsets true. */
const T = { toc: '%%%%TOC%', ch1: '%%%%CH1%', ch2: '%%%%CH2%' }

const PARA = 'The rest of this paragraph exists so that a section has enough '
    + 'text to lay out over more than one page at a large type size, which is '
    + 'the state a paginator gets wrong. '

/* The three things reader/harden.ts has to stop, written into the file rather
   than injected by the driver, because a real hostile file would ship them.
   They live in the FIRST section deliberately: a flag set by book script lives
   on that section document's own `window`, and the paginator detaches a section
   when the reader leaves it — so the only section whose flags can still be read
   at the end of a run is the one the book opens on. */
const HOSTILE = `<script>window.__mobiScript = true</script>`
    + `<p onclick="window.__mobiHandler = true">A paragraph with a handler.</p>`
    + `<p><a href="javascript:window.__mobiHref = true">A javascript link.</a></p>`

const html = `<html><head><guide>`
    /* The filepos value is QUOTED here, and the anchors below are not
       self-closing. Both matter: in an unquoted HTML attribute value a
       trailing `/` before the `>` is part of the VALUE, so
       `filepos=00000671/>` parses as "00000671/", `Number()` gives NaN, and
       `MOBI6.resolveHref` findIndexes its way to -1 — which is how the first
       version of this fixture produced a book with an empty contents list. */
    + `<reference type="toc" title="Contents" filepos="${T.toc}"/>`
    + `</guide></head><body>`
    + `<h1>${TITLE}</h1>${HOSTILE}<p>${PARA}${PARA}</p>`
    + `<mbp:pagebreak/>`
    + `<a name="toc"></a><h2>Contents</h2>`
    + `<p><a filepos=${T.ch1}>The First Chapter</a></p>`
    + `<p><a filepos=${T.ch2}>The Second Chapter</a></p>`
    + `<mbp:pagebreak/>`
    + `<a name="ch1"></a><h2>The First Chapter</h2><p>${PARA}${PARA}${PARA}</p>`
    + `<mbp:pagebreak/>`
    + `<a name="ch2"></a><h2>The Second Chapter</h2><p>${PARA}${PARA}</p>`
    + `</body></html>`

/* Second pass: each anchor's own byte offset, zero-padded to the token width. */
const pad = n => String(n).padStart(8, '0')
const text = Object.entries(T).reduce((str, [key, token]) => {
    const at = str.indexOf(`<a name="${key === 'toc' ? 'toc' : key}"></a>`)
    if (at < 0) throw new Error(`no anchor for ${key}`)
    return str.replaceAll(token, pad(at))
}, html)
if (text.includes('%%')) throw new Error('a filepos token survived the substitution')

const textBytes = new TextEncoder().encode(text)
const numTextRecords = Math.ceil(textBytes.length / RECORD_SIZE)

/* ── record 0: PalmDOC header, MOBI header, EXTH, then the title ─────────── */
const MOBI_LEN = 232          // MOBI header spans 16..248; `indx` at 244 fits
const EXTH_AT = 16 + MOBI_LEN

const exthRecords = [
    [100, AUTHOR],            // EXTH_AUTHOR
    [503, TITLE],             // EXTH_TITLE — the untruncated one
    [524, 'en'],              // EXTH_LANGUAGE
].map(([type, value]) => {
    const payload = new TextEncoder().encode(value)
    const buf = new Uint8Array(8 + payload.length)
    const view = new DataView(buf.buffer)
    view.setUint32(0, type)
    view.setUint32(4, buf.length)
    buf.set(payload, 8)
    return buf
})
const exthBody = exthRecords.reduce((n, r) => n + r.length, 0)
const exthLen = 12 + exthBody

const titleBytes = new TextEncoder().encode(TITLE)
const titleAt = EXTH_AT + exthLen
const rec0Len = Math.ceil((titleAt + titleBytes.length) / 4) * 4
const rec0 = new Uint8Array(rec0Len)
const r0 = new DataView(rec0.buffer)

/* PalmDOC. compression 1 = none, which is why there is no PalmDOC codec here
   and why `trailingFlags` stays 0 (no trailing entries to strip). */
r0.setUint16(0, 1)
r0.setUint32(4, textBytes.length)
r0.setUint16(8, numTextRecords)
r0.setUint16(10, RECORD_SIZE)
r0.setUint16(12, 0)                      // encryption: 0, or sniff.ts calls DRM

rec0.set(new TextEncoder().encode('MOBI'), 16)
r0.setUint32(20, MOBI_LEN)
r0.setUint32(24, 2)                      // type: book
r0.setUint32(28, 65001)                  // encoding: utf-8
r0.setUint32(32, 0x464C_594C)            // uid — arbitrary, must be stable
r0.setUint32(36, 6)                      // version 6: MOBI, not KF8
r0.setUint32(80, 1 + numTextRecords)     // firstNonBookIndex
r0.setUint32(84, titleAt)
r0.setUint32(88, titleBytes.length)
r0.setUint8(94, 0)                       // locale region
r0.setUint8(95, 9)                       // locale language: en
r0.setUint32(108, 1 + numTextRecords)    // resourceStart — no image records
r0.setUint32(112, 0)                     // huffcdic: none
r0.setUint32(116, 0)
r0.setUint32(128, 0x40)                  // exthFlag bit 6: an EXTH follows
r0.setUint32(240, 0)                     // trailingFlags
r0.setUint32(244, 0xffff_ffff)           // indx: no NCX; the guide carries the toc

rec0.set(new TextEncoder().encode('EXTH'), EXTH_AT)
r0.setUint32(EXTH_AT + 4, exthLen)
r0.setUint32(EXTH_AT + 8, exthRecords.length)
exthRecords.reduce((at, r) => { rec0.set(r, at); return at + r.length }, EXTH_AT + 12)
rec0.set(titleBytes, titleAt)

/* ── the PalmDB wrapper ──────────────────────────────────────────────────── */
const records = [rec0]
for (let i = 0; i < numTextRecords; i++) {
    records.push(textBytes.subarray(i * RECORD_SIZE, (i + 1) * RECORD_SIZE))
}
const listAt = 78
const dataAt = listAt + records.length * 8 + 2   // +2: the usual gap before record 0
const total = records.reduce((n, r) => n + r.length, dataAt)

const file = new Uint8Array(total)
const fv = new DataView(file.buffer)
/* The PDB name is 32 bytes, NUL-padded — the truncated title, and the reason
   EXTH 503 exists. */
file.set(new TextEncoder().encode(TITLE.slice(0, 31)), 0)
file.set(new TextEncoder().encode('BOOK'), 60)   // type + creator = 'BOOKMOBI',
file.set(new TextEncoder().encode('MOBI'), 64)   // which is what isMOBI reads
fv.setUint16(76, records.length)
records.reduce((at, r, i) => {
    fv.setUint32(listAt + i * 8, at)
    fv.setUint32(listAt + i * 8 + 4, i)          // attributes + unique id
    file.set(r, at)
    return at + r.length
}, dataAt)

const out = fileURLToPath(new URL('fixture.mobi', import.meta.url))
writeFileSync(out, file)
console.log(`fixture.mobi  ${file.length} bytes`
    + `  ${records.length} records (1 + ${numTextRecords} text)`
    + `  text ${textBytes.length} bytes`)
