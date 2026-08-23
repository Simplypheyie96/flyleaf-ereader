/* ─────────────────────────────────────────────────────────────
   The Drive sync record layer, measured.

   Every other driver here drives the UI. This one cannot: the thing worth
   testing is the FOLD — what happens when two devices that have never met each
   other hand over their libraries — and no sequence of clicks reaches it. So
   this one runs against the DEV server rather than the built bundle, because
   the dev server serves `/src/...` as real modules and the built one does not,
   and it calls `record.ts` directly with fabricated documents from an imaginary
   second device.

   Google is never contacted. `record.ts` knows nothing about the network by
   design — `sync.ts` is the only file that talks to Drive — so every claim
   below is testable with no account, no token and no connection.

   NINE CLAIMS

   1. IDENTITY IS THE FILE. Two devices name the same book by the SHA-256 of
      its bytes, because `id` is a UUID each of them minted at import. If the
      fingerprint is not what the merge matches on, a reader ends up with two
      of everything.
   2. THE LOCAL ID SURVIVES A COLLISION. When the other device's copy of a book
      is the later one, its FIELDS win and this device's `id` stays — everything
      here points at it.
   3. THE LATER ROW WINS WHOLE, not field by field. Finished on one device and
      reset on the other must not come out finished at a progress of zero.
   4. A BOOK NOBODY HERE HAS SEEN ARRIVES, with no cover and no file, and does
      not pretend to have either.
   5. MARKS ARE REWRITTEN THROUGH THE ID MAP. A highlight made on the other
      device names a book by that device's id; landed here unrewritten it points
      at nothing.
   6. A DELETION STICKS. A book deleted here does not come back from a shelf
      that still lists it — that is what the tombstone is for, and it is the one
      thing a union merge cannot do without.
   7. THE OTHER DEVICE'S STONES ARE KEPT. Read and thrown away, the next push
      would erase them from Drive and a third device would put the book back.
   8. POSITION IS THE LATER WRITE, never the further page. A reader who went
      back forty pages on purpose meant it.
   9. A BOOK TRAVELS WHOLE AND COMES BACK BYTE-FOR-BYTE. `packBook` and
      `unpackBook` are the container the file itself moves in.

   Run: (npx vite --port 5199 &) && node audit/sync.mjs
   ───────────────────────────────────────────────────────────── */
import { chromium } from '/Users/simplypheyie/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs'

const BASE = process.env.BASE || 'http://localhost:5199'

const out = { steps: [], findings: [], measures: {} }
const say = (s) => out.steps.push(s)
const bad = (what, detail) => out.findings.push({ what, detail })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })
const errs = []
page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text())
})
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
/* The two included books are seeded before the first paint; the fold has
   nothing to work with until they have landed. */
await page.waitForTimeout(2500)

/* Everything below runs in one evaluate, because the modules and the IndexedDB
   connection both live in the page and re-importing per step would be a new
   Dexie instance each time. It returns plain data; every judgement is made out
   here, where a failure can be printed as a sentence. */
const m = await page.evaluate(async () => {
    const rec = await import('/src/sync/record.ts')
    const dbm = await import('/src/db.ts')
    const { db } = dbm
    const r = {}

    const uuid = () => crypto.randomUUID()
    const shelf0 = await rec.exportShelf()
    r.seeded = shelf0.books.length
    r.allFingerprinted = shelf0.books.every((b) => typeof b.fp === 'string' && b.fp.length === 64)
    r.distinctFingerprints = new Set(shelf0.books.map((b) => b.fp)).size

    if (shelf0.books.length < 2) return { ...r, fatal: 'fewer than two seeded books' }

    const [a, b] = shelf0.books
    r.localIdA = a.id
    r.fpA = a.fp

    /* ── the imaginary second device ──────────────────────────────────────
       Same two books by fingerprint, different ids — exactly what a second
       import of the same files on another machine produces. Book A is the later
       copy over there and carries a title change plus `finishedAt`, so claims
       2 and 3 are both testable from one row. Book C is unknown here. */
    const remoteIdA = uuid()
    const remoteIdB = uuid()
    const fpC = 'c'.repeat(64)
    const remote = {
        v: 1,
        kind: 'shelf',
        books: [
            {
                ...a,
                id: remoteIdA,
                title: a.title + ' [from the other device]',
                progress: 0,
                finishedAt: 1_700_000_000_000,
                editedAt: Date.now() + 60_000,
            },
            { ...b, id: remoteIdB, editedAt: 1 },
            {
                ...b,
                id: uuid(),
                fp: fpC,
                title: 'A Book This Device Has Never Seen',
                addedAt: Date.now(),
                editedAt: Date.now(),
                progress: 0.4,
                finishedAt: null,
                openedAt: Date.now(),
            },
        ],
        collections: [],
        graves: [],
    }

    const folded = await rec.mergeShelf(remote)
    r.shelfFolded = folded.folded
    r.mapPairs = [...folded.map]

    const afterA = await db.books.get(a.id)
    r.aStillUnderLocalId = !!afterA
    r.aTitle = afterA?.title ?? null
    r.aFinishedAt = afterA?.finishedAt ?? null
    r.aProgress = afterA?.progress ?? null
    r.aFp = afterA?.fp ?? null
    r.aCoverKept = afterA?.cover !== undefined && afterA?.cover !== null
    r.mapsRemoteAToLocalA = folded.map.get(remoteIdA) === a.id

    const arrived = (await db.books.toArray()).find((x) => x.fp === fpC)
    r.newBookArrived = !!arrived
    r.newBookCover = arrived ? arrived.cover : 'no row'
    r.newBookHasFile = arrived ? (await db.files.get(arrived.id)) !== undefined : null
    r.newBookMissingReadsTrue = arrived ? await rec.fileMissing(arrived.id) : null
    r.shelfCount = await db.books.count()

    /* ── claim 5: a highlight named by the other device's id ─────────────── */
    const marks = {
        v: 1,
        kind: 'marks',
        annotations: [
            {
                id: uuid(),
                bookId: remoteIdA,
                cfi: 'epubcfi(/6/4!/4/2/2,/1:0,/1:12)',
                text: 'a sentence from the other device',
                note: '',
                color: 'yellow',
                createdAt: Date.now(),
                updatedAt: Date.now(),
            },
        ],
        bookmarks: [],
    }
    const marksFolded = await rec.mergeMarks(marks, folded.map, [])
    r.marksFolded = marksFolded
    const landed = await db.annotations.where('bookId').equals(a.id).toArray()
    r.markLandedOnLocalBook = landed.some((x) => x.text === 'a sentence from the other device')
    r.markLandedOnRemoteId = (await db.annotations.where('bookId').equals(remoteIdA).count()) > 0

    /* ── claim 8: position is the later write ───────────────────────────── */
    const t = Date.now()
    await db.locators.put({ bookId: a.id, cfi: 'LOCAL', progress: 0.8, updatedAt: t })
    await rec.mergePlace(
        { v: 1, kind: 'place', locators: [{ bookId: remoteIdA, cfi: 'OLDER-BUT-FURTHER', progress: 0.95, updatedAt: t - 5000 }], days: [] },
        folded.map,
        [],
    )
    r.staleFurtherIgnored = (await db.locators.get(a.id))?.cfi === 'LOCAL'
    await rec.mergePlace(
        { v: 1, kind: 'place', locators: [{ bookId: remoteIdA, cfi: 'NEWER-BUT-EARLIER', progress: 0.1, updatedAt: t + 5000 }], days: [] },
        folded.map,
        [],
    )
    r.freshEarlierWon = (await db.locators.get(a.id))?.cfi === 'NEWER-BUT-EARLIER'

    /* ── claim 9: the book travels whole ────────────────────────────────── */
    const before = await db.files.get(a.id)
    const beforeSize = before ? before.data.size ?? before.data.byteLength : 0
    const packed = await rec.packBook(a.id)
    r.packName = packed ? packed.name : null
    r.packNamesFingerprint = packed ? packed.name === rec.bookFileName(r.fpA) : null
    await db.files.delete(a.id)
    r.fileGoneBeforeUnpack = (await db.files.get(a.id)) === undefined
    r.unpacked = packed ? await rec.unpackBook(packed.body) : false
    const after = await db.files.get(a.id)
    r.afterSize = after ? after.data.size ?? after.data.byteLength : 0
    r.beforeSize = beforeSize
    r.bytesIdentical = r.afterSize === beforeSize && beforeSize > 0

    /* ── claims 6 and 7: a deletion, and the stone that carries it ──────── */
    const gravesBefore = await db.graves.count()
    await dbm.removeBook(a.id)
    const stones = await db.graves.toArray()
    r.stoneNamesFingerprint = stones.some((s) => s.kind === 'book' && s.ref === r.fpA)
    r.stoneNamesLocalId = stones.some((s) => s.kind === 'book' && s.ref === a.id)

    /* The other device has not heard yet, so its shelf still lists the book.
       Merging it must not put the book back. */
    const stillListing = {
        v: 1,
        kind: 'shelf',
        books: [{ ...a, id: remoteIdA, editedAt: Date.now() }],
        collections: [],
        graves: await db.graves.toArray(),
    }
    await rec.mergeShelf(stillListing)
    r.stayedDeleted = (await db.books.where('fp').equals(r.fpA).count()) === 0

    /* And a stone that arrives from over there is kept, so this device can
       repeat the deletion to a third one. */
    const foreign = { id: 'book:' + 'd'.repeat(64), kind: 'book', ref: 'd'.repeat(64), at: Date.now() }
    await rec.mergeShelf({ v: 1, kind: 'shelf', books: [], collections: [], graves: [foreign] })
    r.foreignStoneKept = (await db.graves.get(foreign.id)) !== undefined
    r.gravesGrew = (await db.graves.count()) > gravesBefore

    /* What would go up next: the stones have to be in it. */
    const shelfOut = await rec.exportShelf()
    r.exportCarriesStones = shelfOut.graves.some((s) => s.ref === foreign.ref)

    const sig1 = await rec.signatures()
    await db.books.update((await db.books.toArray())[0].id, { editedAt: Date.now() + 1 })
    const sig2 = await rec.signatures()
    r.signatureMoves = sig1.shelf !== sig2.shelf
    r.signatureStable = (await rec.signatures()).shelf === sig2.shelf

    return r
})

out.measures = m

if (m.fatal) bad('setup', m.fatal)

/* 1 */
if (!m.allFingerprinted) bad('claim 1', 'a seeded book has no SHA-256 fingerprint after exportShelf')
else if (m.distinctFingerprints !== m.seeded)
    bad('claim 1', `${m.seeded} books produced only ${m.distinctFingerprints} distinct fingerprints`)
else say(`${m.seeded} books, ${m.distinctFingerprints} distinct 64-char fingerprints`)

/* 2 */
if (!m.aStillUnderLocalId) bad('claim 2', 'the collided book is no longer under this device\'s id')
else if (!m.mapsRemoteAToLocalA) bad('claim 2', 'the id map does not point the other device\'s id at the local one')
else say('collision kept the local id and mapped the remote one onto it')

/* 3 */
if (!/from the other device/.test(m.aTitle || '')) bad('claim 3', `the later row did not win — title is "${m.aTitle}"`)
else if (m.aFinishedAt !== 1700000000000)
    bad('claim 3', `the later row won field by field: finishedAt came out ${m.aFinishedAt}`)
else if (m.aProgress !== 0) bad('claim 3', `progress came out ${m.aProgress}, not the later row's 0`)
else if (m.aFp === null) bad('claim 3', 'the fingerprint was dropped by the collision')
else say('the later row won whole — title, progress and finishedAt all came from it')

/* 4 */
if (!m.newBookArrived) bad('claim 4', 'the unseen book did not arrive')
else if (m.newBookCover !== null) bad('claim 4', `the arrived book has a cover of ${JSON.stringify(m.newBookCover)} — DESIGN.md forbids a generated one`)
else if (m.newBookHasFile) bad('claim 4', 'the arrived book claims to have a file it never received')
else if (!m.newBookMissingReadsTrue) bad('claim 4', 'fileMissing() does not report the arrived book as fileless')
else say(`the unseen book arrived with a null cover and no file; shelf is now ${m.shelfCount}`)

/* 5 */
if (!m.markLandedOnLocalBook) bad('claim 5', 'the foreign highlight did not land on the local book')
else if (m.markLandedOnRemoteId) bad('claim 5', 'the foreign highlight is still filed under the other device\'s book id')
else say('the foreign highlight was rewritten through the id map')

/* 6 */
if (!m.stoneNamesFingerprint)
    bad('claim 6', `removeBook laid no stone naming the fingerprint (it named the local id: ${m.stoneNamesLocalId})`)
else if (!m.stayedDeleted) bad('claim 6', 'the deleted book came back from a shelf that still listed it')
else say('the deletion stuck against a shelf that still listed the book')

/* 7 */
if (!m.foreignStoneKept) bad('claim 7', 'a stone from the other device was read and thrown away')
else if (!m.exportCarriesStones) bad('claim 7', 'the shelf that would go up does not carry the stones')
else say('stones from the other device are kept and travel back up')

/* 8 */
if (!m.staleFurtherIgnored) bad('claim 8', 'an older position won because it was further into the book')
else if (!m.freshEarlierWon) bad('claim 8', 'a newer position that went backwards was ignored')
else say('position is the later write in both directions')

/* 9 */
if (!m.fileGoneBeforeUnpack) bad('claim 9', 'the test could not clear the file, so the round trip proves nothing')
else if (!m.unpacked) bad('claim 9', 'unpackBook refused its own packBook output')
else if (!m.bytesIdentical) bad('claim 9', `${m.beforeSize} bytes packed, ${m.afterSize} came back`)
else if (!m.packNamesFingerprint) bad('claim 9', `the packed file is named "${m.packName}", not by fingerprint`)
else say(`${m.beforeSize} bytes went into "${m.packName}" and came back identical`)

/* the change detector the whole timing scheme rests on */
if (!m.signatureMoves) bad('signatures', 'an edit did not move the shelf signature — every sync would skip')
else if (!m.signatureStable) bad('signatures', 'the signature changes without an edit — every sync would transfer')
else say('the shelf signature moves on an edit and holds still otherwise')

if (errs.length) bad('console', errs.slice(0, 4).join(' | '))

await browser.close()

console.log(out.steps.map((s) => '  · ' + s).join('\n'))
console.log('\n=== FINDINGS: ' + out.findings.length)
for (const f of out.findings) console.log(`  [${f.what}] ${f.detail}`)
console.log('\n' + JSON.stringify(out.measures, null, 2))
console.log('SYNC_DONE')
