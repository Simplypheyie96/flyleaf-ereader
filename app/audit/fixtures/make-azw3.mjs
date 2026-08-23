/* Writes `fixture.azw3` — a minimal, valid KF8 (AZW3), hand-built.

   Why this exists: the shelf advertises AZW3, and nothing on this machine can
   write one. `ebook-convert`, `kindlegen`, `calibre` and Kindle Previewer are
   all absent, `/Applications/calibre.app` does not exist, and python's `mobi`
   module is not installed — so `audit/formats.mjs` carried `azw3/kf8` in its
   `uncovered` list, which is the same thing as advertising a format no test
   has ever opened. The owner's rule is that a listed format must open. This
   file is the proof, or the format comes off the list.

   A KF8 is not a MOBI with a different version number. The text records hold
   one continuous raw stream with no section markers at all; the section
   boundaries live in two INDX indices — SKEL (one entry per XHTML skeleton)
   and FRAG (one entry per body fragment) — and a reader rebuilds each section
   by splicing the fragment into its skeleton at a byte offset. `<mbp:pagebreak>`
   does not appear anywhere. So this shares only the PalmDB and EXTH scaffolding
   with `make-mobi.mjs`; everything above that is different.

   Every structure here is written against the readers in
   `src/vendor/foliate-js/mobi.js` — `KF8_HEADER` (offsets absolute in record
   0), `FDST_HEADER`, `INDX_HEADER`, `TAGX_HEADER`, `getIndexData`, `getVarLen`,
   `KF8.init` and `KF8.loadText`. Big-endian throughout, which is what
   `getUint`'s bare `DataView` reads.

   Run: node audit/fixtures/make-azw3.mjs */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TITLE = 'A KF8 Fixture'
const AUTHOR = 'Flyleaf Audit'
const RECORD_SIZE = 4096

const enc = s => new TextEncoder().encode(s)
const concat = parts => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
    return out
}

/* A variable-length quantity as `getVarLen` reads it: 7-bit groups, most
   significant first, and the high bit set on the LAST byte rather than on
   every continuing one. Zero is a single 0x80. */
const varlen = n => {
    const groups = []
    let v = n
    do { groups.unshift(v & 0x7f); v >>>= 7 } while (v > 0)
    groups[groups.length - 1] |= 0x80
    return Uint8Array.from(groups)
}

/* ── the raw text stream ─────────────────────────────────────────────────── */

const PARA = 'The rest of this paragraph exists so that a section has enough '
    + 'text to lay out over more than one page at a large type size, which is '
    + 'the state a paginator gets wrong. '

/* The three things reader/harden.ts has to stop, shipped in the file rather
   than injected by a driver, and in the FIRST section for the reason spelled
   out in make-mobi.mjs: a flag set by book script lives on that section
   document's own window, and the paginator detaches a section on leaving it. */
const HOSTILE = `<script>window.__kf8Script = true</script>`
    + `<p onclick="window.__kf8Handler = true">A paragraph with a handler.</p>`
    + `<p><a href="javascript:window.__kf8Href = true">A javascript link.</a></p>`

/* Each section is a skeleton plus one fragment. The fragment's first element
   carries an `id` on purpose: `getFragmentSelector` regexes the fragment's
   head for `id`/`name`/`aid` to resolve a `kindle:pos:` link, and a fragment
   that opens with a bare tag resolves to nothing. */
const SECTIONS = [
    { label: 'Title Page', body: `<h1 id="start">${TITLE}</h1>${HOSTILE}<p>${PARA}${PARA}</p>` },
    { label: 'The First Chapter', body: `<h2 id="ch1">The First Chapter</h2><p>${PARA}${PARA}${PARA}</p>` },
    { label: 'The Second Chapter', body: `<h2 id="ch2">The Second Chapter</h2><p>${PARA}${PARA}</p>` },
    { label: 'The Third Chapter', body: `<h2 id="ch3">The Third Chapter</h2><p>${PARA}</p>` },
]

/* Sections are laid down back to back: skeleton, fragment, skeleton, fragment.
   `KF8.loadText` reads `skel.offset .. skel.offset + skel.length + fragLengths`
   as one slice, so a gap anywhere between the two would be read as content. */
const skels = []
const frags = []
let at = 0
for (const [i, section] of SECTIONS.entries()) {
    const skeleton = `<?xml version="1.0" encoding="utf-8"?>`
        + `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>`
        + `${section.label}</title></head><body></body></html>`
    const insertAt = skeleton.indexOf('</body>')
    const skelBytes = enc(skeleton)
    const fragBytes = enc(section.body)
    if (skelBytes.length !== skeleton.length) throw new Error('skeleton is not ASCII')
    if (fragBytes.length !== section.body.length) throw new Error('fragment is not ASCII')

    skels.push({ index: i, name: `SKEL${i}`, offset: at, length: skelBytes.length, bytes: skelBytes })
    frags.push({
        index: i,
        /* The FRAG entry's NAME is the insert offset, as a decimal string, and
           it is absolute in the whole raw stream — `loadText` subtracts
           `skel.offset` from it before splicing. */
        insertOffset: at + insertAt,
        offset: 0,
        length: fragBytes.length,
        bytes: fragBytes,
        selector: `[id="${section.body.match(/id="([^"]+)"/)[1]}"]`,
    })
    at += skelBytes.length + fragBytes.length
}
const rawBytes = concat(skels.flatMap((s, i) => [s.bytes, frags[i].bytes]))
if (rawBytes.length !== at) throw new Error('raw stream length disagrees with the tables')
const numTextRecords = Math.ceil(rawBytes.length / RECORD_SIZE)

/* ── INDX builders ───────────────────────────────────────────────────────── */

const INDX_HEAD = 192   // where TAGX starts in a header record, and where the
                        // entries start in a data record

/* `[tag, numValues, mask, end]`, four bytes each, read in order. An entry with
   `end & 1` is the terminator: `getIndexData` skips it and counts one control
   byte for it, which is why every index here has exactly one control byte. */
const tagx = entries => {
    const buf = new Uint8Array(12 + entries.length * 4)
    const v = new DataView(buf.buffer)
    buf.set(enc('TAGX'), 0)
    v.setUint32(4, buf.length)
    v.setUint32(8, 1)                       // numControlBytes
    entries.forEach((e, i) => buf.set(Uint8Array.from(e), 12 + i * 4))
    return buf
}

const indxHeader = ({ numRecords, total, numCncx, tagxBytes }) => {
    const buf = new Uint8Array(INDX_HEAD + tagxBytes.length)
    const v = new DataView(buf.buffer)
    buf.set(enc('INDX'), 0)
    v.setUint32(4, INDX_HEAD)               // length: where TAGX begins
    v.setUint32(24, numRecords)             // how many DATA records follow
    v.setUint32(28, 65001)                  // utf-8
    v.setUint32(36, total)                  // entries across all data records
    v.setUint32(52, numCncx)
    buf.set(tagxBytes, INDX_HEAD)
    return buf
}

/* One entry body: a length-prefixed name, then the single control byte whose
   set bits say which tags are present, then the values as varlens in TAGX
   order. */
const entry = (name, control, values) => concat([
    Uint8Array.of(enc(name).length), enc(name),
    Uint8Array.of(control), ...values.map(varlen),
])

const indxData = bodies => {
    const offsets = []
    let cursor = INDX_HEAD
    for (const b of bodies) { offsets.push(cursor); cursor += b.length }
    const idxt = cursor
    const idxtBytes = new Uint8Array(4 + bodies.length * 2)
    idxtBytes.set(enc('IDXT'), 0)
    const iv = new DataView(idxtBytes.buffer)
    offsets.forEach((o, i) => iv.setUint16(4 + i * 2, o))

    const buf = new Uint8Array(Math.ceil((idxt + idxtBytes.length) / 4) * 4)
    const v = new DataView(buf.buffer)
    buf.set(enc('INDX'), 0)
    v.setUint32(4, INDX_HEAD)
    v.setUint32(20, idxt)                   // where the offset table sits
    v.setUint32(24, bodies.length)          // entries in THIS record
    v.setUint32(28, 65001)
    bodies.forEach((b, i) => buf.set(b, offsets[i]))
    buf.set(idxtBytes, idxt)
    return buf
}

/* A CNCX record is a run of length-prefixed strings, and the key a tag holds
   is the byte offset of the string's own length prefix within the record. */
const cncx = strings => {
    const parts = []
    const keys = []
    let cursor = 0
    for (const s of strings) {
        const bytes = enc(s)
        const len = varlen(bytes.length)
        keys.push(cursor)
        parts.push(len, bytes)
        cursor += len.length + bytes.length
    }
    return { bytes: concat(parts), keys }
}

/* ── the three indices ───────────────────────────────────────────────────── */

/* SKEL: tag 1 is the fragment count, tag 6 is [offset, length]. */
const SKEL_TAGX = tagx([[1, 1, 0x01, 0], [6, 2, 0x02, 0], [0, 0, 0, 1]])
const skelHeader = indxHeader({ numRecords: 1, total: skels.length, numCncx: 0, tagxBytes: SKEL_TAGX })
const skelData = indxData(skels.map(s => entry(s.name, 0x03, [1, s.offset, s.length])))

/* FRAG: tag 2 is a CNCX key for the selector, 4 the fragment id, 6 [offset,
   length]. The entry NAME carries the insert offset. */
const FRAG_TAGX = tagx([[2, 1, 0x01, 0], [4, 1, 0x02, 0], [6, 2, 0x04, 0], [0, 0, 0, 1]])
const fragCncx = cncx(frags.map(f => f.selector))
const fragHeader = indxHeader({ numRecords: 1, total: frags.length, numCncx: 1, tagxBytes: FRAG_TAGX })
const fragData = indxData(frags.map((f, i) =>
    entry(String(f.insertOffset), 0x07, [fragCncx.keys[i], f.index, f.offset, f.length])))

/* NCX: the contents list. tag 4 must be 0 for an item to surface as top-level,
   and tag 6 is the [fid, off] pair that becomes a `kindle:pos:` href. */
const NCX_TAGX = tagx([
    [1, 1, 0x01, 0], [2, 1, 0x02, 0], [3, 1, 0x04, 0],
    [4, 1, 0x08, 0], [6, 2, 0x10, 0], [0, 0, 0, 1],
])
const ncxCncx = cncx(SECTIONS.map(s => s.label))
const ncxHeader = indxHeader({ numRecords: 1, total: SECTIONS.length, numCncx: 1, tagxBytes: NCX_TAGX })
const ncxData = indxData(SECTIONS.map((_, i) => entry(String(i), 0x1f, [
    skels[i].offset,                        // 1: offset
    skels[i].length + frags[i].length,      // 2: size
    ncxCncx.keys[i],                        // 3: label
    0,                                      // 4: heading level
    frags[i].index, 0,                      // 6: [fid, off]
])))

/* ── FDST: the one flow, which is how KF8 knows the raw stream's length ──── */
const fdst = new Uint8Array(12 + 8)
{
    const v = new DataView(fdst.buffer)
    fdst.set(enc('FDST'), 0)
    v.setUint32(4, 12)                      // header length
    v.setUint32(8, 1)                       // numEntries
    v.setUint32(12, 0)
    v.setUint32(16, rawBytes.length)
}

/* ── record 0 ────────────────────────────────────────────────────────────── */

/* The MOBI header has to span far enough for the KF8 fields to be inside it:
   `KF8_HEADER` reads `guide` at 260..264, so 16 + length must clear 264. */
const MOBI_LEN = 248
const EXTH_AT = 16 + MOBI_LEN               // 264

const exthRecords = [
    [100, AUTHOR],                          // EXTH_AUTHOR
    [503, TITLE],                           // EXTH_TITLE — the untruncated one
    [524, 'en'],                            // EXTH_LANGUAGE
].map(([type, value]) => {
    const payload = enc(value)
    const buf = new Uint8Array(8 + payload.length)
    const view = new DataView(buf.buffer)
    view.setUint32(0, type)
    view.setUint32(4, buf.length)
    buf.set(payload, 8)
    return buf
})
const exthLen = 12 + exthRecords.reduce((n, r) => n + r.length, 0)

const titleBytes = enc(TITLE)
const titleAt = EXTH_AT + exthLen
const rec0 = new Uint8Array(Math.ceil((titleAt + titleBytes.length) / 4) * 4)
const r0 = new DataView(rec0.buffer)

/* Record indices, in the order the file lays them down. `getIndexData` finds a
   data record at `header + 1 + i` and a CNCX record at
   `header + numRecords + i + 1`, so each index is header, data, then CNCX —
   the order is not decorative. */
const FIRST_NON_BOOK = 1 + numTextRecords
const IDX = {
    fdst: FIRST_NON_BOOK,
    skel: FIRST_NON_BOOK + 1,
    frag: FIRST_NON_BOOK + 3,
    ncx: FIRST_NON_BOOK + 6,
}
const NUM_RECORDS = FIRST_NON_BOOK + 9

/* PalmDOC. compression 1 = none, so no codec here and `trailingFlags` stays 0. */
r0.setUint16(0, 1)
r0.setUint32(4, rawBytes.length)
r0.setUint16(8, numTextRecords)
r0.setUint16(10, RECORD_SIZE)
r0.setUint16(12, 0)                         // encryption: 0, or sniff.ts calls DRM

rec0.set(enc('MOBI'), 16)
r0.setUint32(20, MOBI_LEN)
r0.setUint32(24, 2)                         // type: book
r0.setUint32(28, 65001)                     // encoding: utf-8
r0.setUint32(32, 0x4B_46_38_00)             // uid — arbitrary, must be stable
r0.setUint32(36, 8)                         // version 8: KF8, and the whole point
r0.setUint32(80, FIRST_NON_BOOK)
r0.setUint32(84, titleAt)
r0.setUint32(88, titleBytes.length)
r0.setUint8(94, 0)                          // locale region
r0.setUint8(95, 9)                          // locale language: en
/* resourceStart past the last record, so `getResourcesByMagic` has nothing to
   walk — there are no RESC or PAGE records and no images. */
r0.setUint32(108, NUM_RECORDS)
r0.setUint32(112, 0)                        // huffcdic: none
r0.setUint32(116, 0)
r0.setUint32(128, 0x40)                     // exthFlag bit 6: an EXTH follows
r0.setUint32(192, IDX.fdst)
r0.setUint32(196, 1)                        // numFdst
r0.setUint32(240, 0)                        // trailingFlags
r0.setUint32(244, IDX.ncx)                  // indx: the contents list
r0.setUint32(248, IDX.frag)
r0.setUint32(252, IDX.skel)
r0.setUint32(260, 0xffff_ffff)              // guide: none, so no landmarks

rec0.set(enc('EXTH'), EXTH_AT)
r0.setUint32(EXTH_AT + 4, exthLen)
r0.setUint32(EXTH_AT + 8, exthRecords.length)
exthRecords.reduce((cursor, r) => (rec0.set(r, cursor), cursor + r.length), EXTH_AT + 12)
rec0.set(titleBytes, titleAt)

/* ── the PalmDB wrapper ──────────────────────────────────────────────────── */
const records = [rec0]
for (let i = 0; i < numTextRecords; i++) {
    records.push(rawBytes.subarray(i * RECORD_SIZE, (i + 1) * RECORD_SIZE))
}
records.push(fdst, skelHeader, skelData, fragHeader, fragData, fragCncx.bytes,
    ncxHeader, ncxData, ncxCncx.bytes)
if (records.length !== NUM_RECORDS) {
    throw new Error(`record count drifted: ${records.length} vs ${NUM_RECORDS}`)
}

const listAt = 78
const dataAt = listAt + records.length * 8 + 2   // +2: the usual gap before record 0
const file = new Uint8Array(records.reduce((n, r) => n + r.length, dataAt))
const fv = new DataView(file.buffer)
file.set(enc(TITLE.slice(0, 31)), 0)             // PDB name: 32 bytes, NUL-padded
file.set(enc('BOOK'), 60)                        // type + creator = 'BOOKMOBI',
file.set(enc('MOBI'), 64)                        // which is what isMOBI reads
fv.setUint16(76, records.length)
records.reduce((cursor, r, i) => {
    fv.setUint32(listAt + i * 8, cursor)
    fv.setUint32(listAt + i * 8 + 4, i)          // attributes + unique id
    file.set(r, cursor)
    return cursor + r.length
}, dataAt)

const out = fileURLToPath(new URL('fixture.azw3', import.meta.url))
writeFileSync(out, file)
console.log(`fixture.azw3  ${file.length} bytes`
    + `  ${records.length} records (1 + ${numTextRecords} text + 9 index)`
    + `  raw ${rawBytes.length} bytes  ${SECTIONS.length} sections`)
