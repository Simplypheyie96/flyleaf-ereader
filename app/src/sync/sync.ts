/* Sync, through the Flyleaf account.

   MERGE, NEVER PICK-ONE. `record.ts` holds the fold; this file is the
   transport and the timing. It pulls the library the account holds, merges it
   into this device, and writes the merged whole back up, so both sides end
   holding the union. A book imported on a phone with no signal and a chapter
   read on a laptop the same afternoon both survive, in either order, however
   long the gap.

   LOCAL STAYS LOCAL until somebody signs in. There is no sign-in wall and no
   nag; a reader who never signs in has nothing of theirs anywhere but their
   own device. Signing in changes where the library is COPIED to, and does not
   change that.

   ONE DOCUMENT, NOT THREE. Drive charged per file and per listing, so the
   shelf, the marks and the place went up separately. The Flyleaf server keeps
   one document per app and answers "still the revision you hold" with a
   204 and no body, so an idle pair costs one tiny request and a page turn
   sends the record, which is kilobytes. The book files go beside it as media,
   addressed by their hash, and the document says which hash is which book. */

import { db, pruneGraves } from '../db'
import { deviceName } from './device'
import { dropAll, listFolder, readBlob, readText } from './drive'
import type { DriveFile } from './drive'
import { SYNC_EVENT, signIn, signOut as driveSignOut, silentToken } from './google'
import { SIGNED_OUT, drop, fetchMedia, missing, optedIn, peek, pull, push, putMedia } from './cloud'
import {
  MARKS,
  PLACE,
  SHELF,
  bookFileName,
  exportMarks,
  exportPlace,
  exportShelf,
  fingerprintAll,
  mergeMarks,
  mergePlace,
  mergeShelf,
  ours,
  packBook,
  signatures,
  unpackBook,
} from './record'
import type { Folded, MarksDoc, PlaceDoc, ShelfDoc } from './record'

const SYNCED_AT_KEY = 'flyleaf-ereader-synced-at'
/** `<rev> <signature>`: the account revision this device last matched, and
    what this device looked like at that moment. Equal on both halves means
    there is nothing to send and nothing to fetch. */
const MARK_KEY = 'flyleaf-ereader-cloud-mark'
/** The document's book-file map at that same revision, so a pull answered with
    204 can still tell which books have bytes waiting in the account. */
const FILES_KEY = 'flyleaf-ereader-cloud-files'
/** Set when the account's 1 GB was full, with the time. Uploads wait a day
    rather than sending megabytes every half minute to be turned away. */
const FULL_KEY = 'flyleaf-ereader-cloud-full'
/** Set the moment anything is written while this device is NOT signed in, and
    cleared by the first sync that succeeds after it. It is the single input to
    the one question this file ever asks — signing in a device carrying work
    the account has never seen is the one case where two libraries genuinely
    diverged without anybody being able to watch it happen. */
const OFFLINE_KEY = 'flyleaf-ereader-wrote-offline'

/** What the server takes per file. A book whose packed file is larger stays on
    the device it was imported on, and Settings names it. */
const MEDIA_MAX = 25 * 1024 * 1024
const FULL_WAIT = 24 * 60 * 60 * 1000

interface LibraryDoc {
  v: 1
  shelf: ShelfDoc
  marks: MarksDoc
  place: PlaceDoc
  /** book fingerprint → media hash of its packed file */
  files: Record<string, string>
}

/** How many book files move in one pass, each way.

    A cap, and a loud one — `SyncResult.filesLeft` carries what did not go, and
    Settings says so in words. Uncapped, signing in a phone with a forty-book
    library would start forty multi-megabyte uploads on somebody's mobile data,
    and the first thing they would know about it is the bill.

    A book somebody has actually tapped does not wait for its turn here —
    `fetchBookFile` below pulls that one file straight away. */
const FILES_PER_PASS = 10

/* WHAT IS TAKING SO LONG, AND HOW MUCH IS LEFT.

   The record is a few kilobytes and lands in one breath; the BOOK FILES are
   megabytes each and are the whole of the wait. So the file loop counts itself
   out loud: "Book 3 of 7" is a number this code actually knows, and it is the
   number a reader is waiting on anyway.

   COUNTED BY ATTEMPT, not by success. A file that is skipped still advances
   the bar, because a bar that stops at 6 of 7 and then vanishes reads as a
   failure when the pass in fact finished. */
export const SYNC_PROGRESS = 'flyleaf-ereader-sync-progress'

let progress: { done: number; total: number } | null = null

/** The pass in flight, or null between passes. Read once on mount; after that
    `SYNC_PROGRESS` says when it changed. */
export function syncProgress(): { done: number; total: number } | null {
  return progress
}

function report(next: { done: number; total: number } | null) {
  progress = next
  window.dispatchEvent(new Event(SYNC_PROGRESS))
}

export interface SyncResult {
  /** rows that came down from another device */
  gained: number
  /** rows replaced here by a newer copy from the other device */
  updated: number
  /** rows removed here because the other device had deleted them */
  removed: number
  /** book files that moved, either way */
  files: number
  /** book files still to move, after the cap */
  filesLeft: number
  /** true when nothing had changed on either side and no bytes moved */
  unchanged: boolean
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function put(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Private mode. The sync still ran; it just cannot remember that it did,
       so the next one does the full transfer instead of skipping it. */
  }
}

export function lastSync(): number | null {
  const at = Number(read(SYNCED_AT_KEY))
  return at > 0 ? at : null
}

/** Did anything get written on this device while it was not signed in? */
export function wroteWhileOffline(): boolean {
  return read(OFFLINE_KEY) !== ''
}

/** Is this device carrying work the account has never been shown? Two ways
    that happens: something was written while signed out, or this device has
    simply never completed a sync. */
export async function hasUnsharedWork(): Promise<boolean> {
  if ((await db.books.count()) === 0) return false
  return wroteWhileOffline() || lastSync() === null
}

/** What the account already holds, and where it was last written. "Your
    iPhone, three hours ago" is a question somebody can actually answer. */
export async function otherLibrary(): Promise<{ device: string; at: number } | null> {
  const there = await peek()
  return there ? { device: there.device, at: there.at } : null
}

/** True when the account's 1 GB was full the last time a book tried to go up. */
export function storageFull(): boolean {
  return read(FULL_KEY) !== ''
}

/** Books whose file is over what the server takes, so they stay on this
    device. Measured the way `packBook` builds them: file, cover, a small head. */
export async function tooBig(): Promise<string[]> {
  const [books, files] = await Promise.all([db.books.toArray(), db.files.toArray()])
  const size = new Map(files.map((f) => [f.bookId, f.data.size]))
  return books
    .filter((b) => (size.get(b.id) ?? 0) + (b.cover?.size ?? 0) + 4096 > MEDIA_MAX)
    .map((b) => b.title)
}

/* ── the stored state ──────────────────────────────────────────────────── */

function held(): { rev: number; sig: string } {
  const raw = read(MARK_KEY)
  const space = raw.indexOf(' ')
  if (space < 0) return { rev: 0, sig: '' }
  return { rev: Number(raw.slice(0, space)) || 0, sig: raw.slice(space + 1) }
}

async function signature(): Promise<string> {
  const s = await signatures()
  return `${s.shelf}|${s.marks}|${s.place}`
}

function knownFiles(): Record<string, string> {
  try {
    return JSON.parse(read(FILES_KEY) || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

async function hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function add(into: Folded, more: Folded) {
  into.gained += more.gained
  into.updated += more.updated
  into.removed += more.removed
}

/* ── one full sync ─────────────────────────────────────────────────────── */

/** Pull, merge, send the book files, push. Throws with a sentence fit to show. */
async function run(): Promise<SyncResult> {
  const device = deviceName()
  const mark = held()
  /* Whether this device has moved since it last matched the account. Taken
     BEFORE anything is merged, because a merge moves the signature too, and a
     device that only received must not then push what it received straight
     back up — that is two devices answering each other forever. */
  const mine = (await signature()) !== mark.sig
  const folded: Folded = { gained: 0, updated: 0, removed: 0 }
  let known = mark.rev
  let files = knownFiles()
  /* Uploaded this run, kept apart so a 409 that brings a newer map down does
     not forget them. */
  const sent: Record<string, string> = {}
  let moved = 0
  let left = 0

  for (let tries = 0; ; tries += 1) {
    const remote = await pull(known)
    if (remote?.text) {
      const doc = JSON.parse(remote.text) as LibraryDoc
      /* THE SHELF GOES FIRST AND ALONE. Until the books have landed there is
         no map from the other device's ids to this one's, and a highlight
         merged without it lands on the wrong book or on no book at all. */
      const shelf = await mergeShelf(doc.shelf)
      add(folded, shelf.folded)
      add(folded, await mergeMarks(doc.marks, shelf.map, []))
      add(folded, await mergePlace(doc.place, shelf.map, []))
      files = doc.files ?? {}
    } else if (!remote) {
      /* Nothing in the account yet — this device is the first. */
      files = {}
    }
    Object.assign(files, sent)

    /* Only on the first time round: a retry after a 409 has nothing new to
       move, and each file is megabytes. */
    if (tries === 0) {
      const down = await fetchFiles(files)
      const up = await sendFiles(files)
      Object.assign(sent, up.sent)
      Object.assign(files, up.sent)
      moved = down.moved + up.moved
      left = down.left + up.left
    }

    if (remote && !mine && !Object.keys(sent).length) {
      await settle(remote.rev, files)
      put(SYNCED_AT_KEY, String(Date.now()))
      put(OFFLINE_KEY, '')
      window.dispatchEvent(new Event(SYNC_EVENT))
      return { ...folded, files: moved, filesLeft: left, unchanged: !remote.text && !moved && !folded.gained }
    }

    /* Exported AFTER every merge, so what goes up is the union rather than
       this device's side of it. This is the line that makes overwriting safe. */
    const graves = new Set((await db.graves.toArray()).filter((g) => g.kind === 'book').map((g) => g.ref))
    const doc: LibraryDoc = {
      v: 1,
      shelf: await exportShelf(),
      marks: await exportMarks(),
      place: await exportPlace(),
      files: Object.fromEntries(Object.entries(files).filter(([fp]) => !graves.has(fp))),
    }
    const rev = await push(new Blob([JSON.stringify(doc)], { type: 'application/json' }), remote?.rev ?? 0, device)
    if (rev !== null) {
      await settle(rev, doc.files)
      put(SYNCED_AT_KEY, String(Date.now()))
      /* Whatever was written while signed out has now been up and merged, so
         it is no longer a reason to stop and ask anybody anything. */
      put(OFFLINE_KEY, '')
      void pruneGraves()
      window.dispatchEvent(new Event(SYNC_EVENT))
      return { ...folded, files: moved, filesLeft: left, unchanged: false }
    }
    /* Another device wrote in between. Take its whole document and go again. */
    if (tries >= 2) throw new Error('Another device kept syncing at the same moment. Flyleaf will try again by itself.')
    known = 0
  }
}

async function settle(rev: number, files: Record<string, string>) {
  put(FILES_KEY, JSON.stringify(files))
  put(MARK_KEY, `${rev} ${await signature()}`)
}

/* ── the book files ────────────────────────────────────────────────────── */

/** Books here with no bytes, whose bytes the account holds. Down before up: a
    reader who has just signed in on a new device wants a book to open. */
async function fetchFiles(files: Record<string, string>): Promise<{ moved: number; left: number }> {
  const have = new Set(await db.files.toCollection().primaryKeys())
  const want = (await db.books.toArray()).filter((b) => b.fp && files[b.fp] && !have.has(b.id))
  const now = want.slice(0, FILES_PER_PASS)
  let moved = 0
  await counted(now.length, async (step) => {
    for (const book of now) {
      try {
        const blob = await fetchMedia(files[book.fp!])
        if (blob && (await unpackBook(blob))) moved += 1
      } catch (error) {
        if (error instanceof Error && error.message === SIGNED_OUT) throw error
        /* One file that will not come is not a failed sync. Next pass. */
      }
      step()
    }
  })
  return { moved, left: want.length - now.length }
}

/** Books here with bytes the account has never been given. */
async function sendFiles(files: Record<string, string>): Promise<{ sent: Record<string, string>; moved: number; left: number }> {
  const sent: Record<string, string> = {}
  const fullAt = Number(read(FULL_KEY))
  if (fullAt && Date.now() - fullAt < FULL_WAIT) return { sent, moved: 0, left: 0 }

  await fingerprintAll()
  const [books, rows] = await Promise.all([db.books.toArray(), db.files.toArray()])
  const size = new Map(rows.map((f) => [f.bookId, f.data.size]))
  const want = books.filter(
    (b) => b.fp && !files[b.fp] && size.has(b.id) && size.get(b.id)! + (b.cover?.size ?? 0) + 4096 <= MEDIA_MAX,
  )
  const now = want.slice(0, FILES_PER_PASS)
  let moved = 0
  await counted(now.length, async (step) => {
    const packed = new Map<string, { fp: string; body: Blob }>()
    for (const book of now) {
      const p = await packBook(book.id)
      if (p && p.body.size <= MEDIA_MAX) packed.set(await hex(p.body), { fp: book.fp!, body: p.body })
    }
    /* Another device may already have sent the same book; then it is only a
       line in the document, not megabytes. */
    const absent = await missing([...packed.keys()])
    for (const [hash, { fp, body }] of packed) {
      if (absent.has(hash)) {
        const answer = await putMedia(hash, body)
        if (answer === 'full') {
          put(FULL_KEY, String(Date.now()))
          break
        }
        if (answer === 'big') {
          step()
          continue
        }
        moved += 1
      }
      sent[fp] = hash
      step()
    }
  })
  if (Object.keys(sent).length) put(FULL_KEY, '')
  return { sent, moved, left: want.length - now.length }
}

async function counted(total: number, work: (step: () => void) => Promise<void>) {
  /* Nothing to move is not a pass worth drawing: a bar that flashes 0 of 0 is
     noise on every idle sync. */
  if (!total) return
  let done = 0
  report({ done, total })
  try {
    await work(() => report({ done: ++done, total }))
  } finally {
    /* Cleared however this ends. A bar left on screen by a thrown sync is a
       sync that looks like it is still running forever. */
    report(null)
  }
}

/** ONE BOOK, NOW. The pass above moves files a batch at a time, which is right
    for a shelf and wrong for the book somebody has just tapped. So opening a
    book whose bytes are missing fetches that one file ahead of the queue.

    Returns false rather than throwing for every ordinary reason it cannot —
    signed out, offline, the file genuinely not up there. The caller shows the
    same explanation in all of those cases. */
export async function fetchBookFile(bookId: string): Promise<boolean> {
  if (!optedIn()) return false
  const book = await db.books.get(bookId)
  if (!book?.fp) return false
  try {
    let hash = knownFiles()[book.fp]
    if (!hash) {
      await syncNow()
      hash = knownFiles()[book.fp]
    }
    if (!hash) return false
    const blob = await fetchMedia(hash)
    return blob ? await unpackBook(blob) : false
  } catch {
    return false
  }
}

/* ── the one entry point ───────────────────────────────────────────────── */

let running: Promise<SyncResult> | null = null

/** Sync now. Safe to call from anywhere — overlapping calls share one run,
    because two syncs at once would each merge the other's half-written state. */
export function syncNow(): Promise<SyncResult> {
  if (running) return running
  running = run().finally(() => {
    running = null
  })
  return running
}

/** "Bring them together" — the answer to the one question this file asks. It
    is simply what every sync does, so saying yes is saying carry on. */
export async function bringTogether(): Promise<SyncResult> {
  put(OFFLINE_KEY, '')
  resumeAutoSync()
  return syncNow()
}

/** Take the library out of the account. The caller signs out in the same
    press: still signed in, this device would put it straight back. Nothing on
    the device is touched — this removes the copy, not the library. */
export async function forgetCopy(): Promise<void> {
  pauseAutoSync()
  try {
    await drop()
    put(MARK_KEY, '')
    put(FILES_KEY, '')
    put(FULL_KEY, '')
    put(SYNCED_AT_KEY, '')
    /* Everything here is now unshared by definition, so signing in again is a
       first meeting and should ask like one. */
    put(OFFLINE_KEY, '1')
  } finally {
    resumeAutoSync()
  }
}

/* ── the old Google Drive copy ─────────────────────────────────────────── */

/** Bring in the library an older Flyleaf eReader kept in the reader's Google
    Drive. Once, by hand, and read-only: Google's window asks for Drive, the
    three documents and any book files this device lacks are merged in, and the
    merged whole goes up to the account on the sync that follows. The Drive
    copy is left alone; removing it is `forgetDrive`.

    Returns what came in, or null when that Drive held no library. */
export async function fromDrive(): Promise<{ rows: number; files: number } | null> {
  await signIn()
  const token = await silentToken()
  const folder = await listFolder(token)
  const doc = async <T,>(name: string): Promise<T | null> => {
    const file = folder.get(name)
    return file ? (JSON.parse(await readText(token, file.id)) as T) : null
  }
  const shelfDoc = await doc<ShelfDoc>(SHELF)
  if (!shelfDoc) return null

  const folded: Folded = { gained: 0, updated: 0, removed: 0 }
  const shelf = await mergeShelf(shelfDoc)
  add(folded, shelf.folded)
  const marksDoc = await doc<MarksDoc>(MARKS)
  if (marksDoc) add(folded, await mergeMarks(marksDoc, shelf.map, []))
  const placeDoc = await doc<PlaceDoc>(PLACE)
  if (placeDoc) add(folded, await mergePlace(placeDoc, shelf.map, []))

  const have = new Set(await db.files.toCollection().primaryKeys())
  const want: DriveFile[] = []
  for (const book of await db.books.toArray()) {
    const file = book.fp && !have.has(book.id) ? folder.get(bookFileName(book.fp)) : undefined
    if (file) want.push(file)
  }
  let files = 0
  await counted(want.length, async (step) => {
    for (const file of want) {
      try {
        if (await unpackBook(await readBlob(token, file.id))) files += 1
      } catch {
        /* One that will not come leaves the book where it was: on the shelf,
           waiting for its file. */
      }
      step()
    }
  })

  if (optedIn()) await syncNow().catch(() => undefined)
  return { rows: folded.gained + folded.updated, files }
}

/** Delete the old copy from Google Drive and forget that Drive was ever used
    here, so the offer to bring it in goes away. `ours` and not everything in
    the folder: a sibling app's backup is never this app's to delete. */
export async function forgetDrive(): Promise<number> {
  await signIn()
  const count = await dropAll(await silentToken(), ours)
  await driveSignOut()
  return count
}

/* ── Keeping up, without being asked ────────────────────────────────────────

   NOBODY SHOULD EVER HAVE TO PRESS "SYNC NOW". Signing in once is the only
   thing anybody should have to do. Three triggers, because two devices staying
   level needs both halves:

   PUSH, after a write — Dexie hooks on the six tables that hold the record
   schedule a sync, debounced by SETTLE.

   PULL, on a timer, while the app is in front. The other device writing
   something is not an event this device can hear, so it has to go and look.

   AND ON ARRIVAL — at launch, and whenever the app comes back to the front or
   back online, which is when the other device is most likely to have moved.

   Each is cheap when nothing has changed: the server answers a revision this
   device already holds with a 204 and no body. */

/** How long a reading hand must be still before its work is sent up.

    Longer than the Journal's, because the write it is debouncing lands on every
    page turn — a reader turning a page every twenty seconds would otherwise
    upload three times a minute for the length of a novel. It is flushed the
    instant the app goes to the background, which is the moment it matters. */
const SETTLE = 15_000
/** How often an app in the foreground goes to look for the other device. */
const BEAT = 30_000
/** A floor under everything, so no combination of triggers can loop. */
const QUIET = 20_000

let paused = false
let lastRun = 0
let settling: ReturnType<typeof setTimeout> | null = null
let holding: ReturnType<typeof setTimeout> | null = null
let started = false

/** Hold every automatic sync while a question is on screen. Explicit syncs
    still run — `syncNow` is only ever called by something somebody pressed. */
export function pauseAutoSync() {
  paused = true
}

export function resumeAutoSync() {
  paused = false
}

export function autoSyncPaused(): boolean {
  return paused
}

/* THE FLOOR DELAYS A SYNC; IT MUST NEVER CANCEL ONE. A blocked attempt books
   itself for the moment the floor lifts, rather than being dropped. One timer,
   not one per caller: three triggers inside the same window still produce one
   sync, which is what the floor was for. */
function attempt() {
  if (!optedIn() || paused) return

  const waited = Date.now() - lastRun
  if (waited < QUIET) {
    if (!holding) {
      holding = setTimeout(() => {
        holding = null
        attempt()
      }, QUIET - waited)
    }
    return
  }

  if (holding) {
    clearTimeout(holding)
    holding = null
  }
  lastRun = Date.now()
  void syncNow().catch(() => {
    /* Silence is right here. This one was not asked for: somebody reading on a
       train with no signal must not be handed an error about it. */
  })
}

/* A write happened. Wait for the hand to stop, then send. `running` is checked
   at the far end rather than here because the writes a sync makes are
   themselves merges arriving from the account — they would otherwise schedule
   a sync of the thing just synced, forever. */
function touched() {
  if (!optedIn()) {
    /* Nowhere to send this — but it is exactly the work that will need
       reconciling if this device signs in later. */
    put(OFFLINE_KEY, '1')
    return
  }
  if (settling) clearTimeout(settling)
  settling = setTimeout(() => {
    settling = null
    if (!running) attempt()
  }, SETTLE)
}

/** Send whatever is waiting, now. Called when the app goes away, which is the
    one moment a fifteen-second debounce would otherwise lose a page. */
function flush() {
  if (!settling) return
  clearTimeout(settling)
  settling = null
  if (!running) attempt()
}

export function startAutoSync() {
  if (started) return
  started = true
  /* The listeners go on unconditionally and `attempt` is the thing that
     checks — somebody who signs in halfway through a session would otherwise
     get no automatic sync until they next reloaded the app. */
  for (const table of [db.books, db.locators, db.annotations, db.bookmarks, db.collections, db.readingDays]) {
    table.hook('creating', touched)
    table.hook('updating', touched)
    table.hook('deleting', touched)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') attempt()
    else flush()
  })
  /* `pagehide` and not `beforeunload`: on iOS a tab is frozen rather than
     unloaded, and `beforeunload` frequently never fires there at all. */
  window.addEventListener('pagehide', flush)
  window.addEventListener('focus', attempt)
  window.addEventListener('online', attempt)

  setInterval(() => {
    if (document.visibilityState === 'visible') attempt()
  }, BEAT)

  attempt()
}
