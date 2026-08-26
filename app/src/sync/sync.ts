/* Sync, in the only shape that keeps the promise this app has made.

   MERGE, NEVER PICK-ONE. `record.ts` holds the fold; this file is the
   transport and the timing. It pulls what is in Drive, merges it into this
   device, and writes the merged whole back up, so both sides end holding the
   union. A book imported on a phone with no signal and a chapter read on a
   laptop the same afternoon both survive, in either order, however long the
   gap.

   LOCAL STAYS LOCAL. Nothing here runs for somebody who has not asked for it.
   There is no sign-in wall, no nag, and a reader who never connects Drive is
   not merely unsynced — they are unknown to us, with nothing of theirs
   anywhere but their own device. Connecting later changes where the library is
   COPIED to, and does not change that.

   THREE DOCUMENTS, NOT ONE, because one of them moves every few seconds while
   the other two barely move at all. `drive.ts` explains it at length; the
   consequence here is that a page turn sends a few kilobytes rather than the
   whole shelf. */

import { db, pruneGraves } from '../db'
import type { Grave } from '../types'
import { deviceName } from './device'
import { dropAll, listFolder, quota, readBlob, readText, remove, write as writeFile } from './drive'
import type { DriveFile } from './drive'
import { SYNC_EVENT, optedIn, signIn, silentToken, tokenHeld } from './google'
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
import type { IdMap, MarksDoc, PlaceDoc, ShelfDoc } from './record'

const SYNCED_AT_KEY = 'flyleaf-ereader-synced-at'
/** What each document looked like on both sides the last time a sync finished,
    so an unchanged device on an unchanged Drive can skip the whole transfer. */
const MARK_KEY = 'flyleaf-ereader-sync-mark'
/** The incoming-id → local-id map from the last shelf merge, kept against the
    shelf's Drive timestamp. The map only changes when the remote shelf does,
    and without it every pull of a position would have to download the shelf as
    well just to know which book the position is about. */
const MAP_KEY = 'flyleaf-ereader-sync-map'
/** Set the moment anything is written while this device is NOT connected, and
    cleared by the first sync that succeeds after it. It is the single input to
    the one question this file ever asks — connecting a device carrying work
    Drive has never seen is the one case where two libraries genuinely diverged
    without anybody being able to watch it happen. */
const OFFLINE_KEY = 'flyleaf-ereader-wrote-offline'
/** Whether the book files travel as well as the record. ON unless the reader
    has turned it off, because a sync that carries the shelf but not the books
    is not a sync: the other device shows a row it cannot open and a cover it
    cannot draw, since the cover rides inside the file bundle and nowhere else.
    The bytes do come out of the reader's own Drive allowance, which is why the
    switch exists at all — but that is a choice to make against a working sync,
    not a wall to discover on a new device.

    THREE VALUES, NOT TWO. '1' on, '0' off, absent never-decided. The old shape
    wrote '' for off, which read the same as absent, so the default could not be
    changed without silently re-enabling somebody's explicit opt-out. An opt-out
    made before this change does read as absent and does turn back on; that is
    the one-time cost of the old shape, and it is a copy of their own books into
    their own Drive rather than anything leaving their hands. */
const FILES_KEY = 'flyleaf-ereader-sync-files'

/** How many book files move in one pass, each way.

    A cap, and a loud one — `SyncResult.filesLeft` carries what did not go, and
    Settings says so in words. Uncapped, connecting a phone with a forty-book
    library would start forty concurrent multi-megabyte uploads on somebody's
    mobile data, and the first thing they would know about it is the bill. Ten a
    pass with a sync every ninety seconds clears forty books in about six
    minutes of the app being open, and stops the moment it is closed.

    A book somebody has actually tapped does not wait for its turn here —
    `fetchBookFile` below pulls that one file straight away. */
const FILES_PER_PASS = 10

/* WHAT IS TAKING SO LONG, AND HOW MUCH IS LEFT.

   The record is a few kilobytes and lands in one breath; the BOOK FILES are
   megabytes each and are the whole of the wait. Ten of them a pass on a phone
   is minutes, and until now the only thing on screen for all of it was the
   word "Syncing", which cannot tell a stalled sync from a working one. So the
   file loop counts itself out loud.

   FILES, NOT BYTES. Drive gives a size per file, but the two directions do not
   cost the same per byte and a part-uploaded file reports nothing back, so a
   byte bar would be a smooth lie. "Book 3 of 7" is a number this code actually
   knows, and it is the number a reader is waiting on anyway.

   COUNTED BY ATTEMPT, not by success. A file that is skipped -- gone from
   Drive, unreadable here -- still advances the bar, because a bar that stops
   at 6 of 7 and then vanishes reads as a failure when the pass in fact
   finished. What actually moved is already reported by `SyncResult.files`. */
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

const NOTHING: SyncResult = {
  gained: 0,
  updated: 0,
  removed: 0,
  files: 0,
  filesLeft: 0,
  unchanged: true,
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

/** Are the book files themselves being carried, or only the record? */
export function filesIncluded(): boolean {
  return read(FILES_KEY) !== '0'
}

export function includeFiles(on: boolean) {
  put(FILES_KEY, on ? '1' : '0')
  window.dispatchEvent(new Event(SYNC_EVENT))
}

/** Did anything get written on this device while it was not connected? */
export function wroteWhileOffline(): boolean {
  return read(OFFLINE_KEY) !== ''
}

/** Is this device carrying work Drive has never been shown? Two ways that
    happens: something was written while disconnected, or this device has
    simply never completed a sync — which is the same situation seen from a
    device that predates the flag, and the honest fallback for every library
    already on a phone when this shipped. */
export async function hasUnsharedWork(): Promise<boolean> {
  if ((await db.books.count()) === 0) return false
  return wroteWhileOffline() || lastSync() === null
}

/** What is already in this account's Drive, and where it was last written.
    A question about "your Drive" is a question about a place nobody has ever
    been; "your iPhone, three hours ago" is one they can actually answer. */
export async function otherLibrary(): Promise<{ device: string; at: number } | null> {
  const folder = await listFolder(await silentToken())
  const shelf = folder.get(SHELF)
  if (!shelf) return null
  return { device: shelf.device ?? '', at: Date.parse(shelf.modifiedTime) || 0 }
}

/** The reader's Drive allowance, for the sentence beside the book-files
    switch. Null when Google did not say. */
export async function driveRoom(): Promise<{ used: number; limit: number | null } | null> {
  return quota(await silentToken())
}

/* ── marks, so an idle pair costs one listing call ─────────────────────── */

interface Marks {
  shelf?: string
  marks?: string
  place?: string
}

function marks(): Marks {
  try {
    return JSON.parse(read(MARK_KEY) || '{}') as Marks
  } catch {
    return {}
  }
}

function stamp(remote: DriveFile | undefined, local: string): string {
  return `${remote?.modifiedTime ?? ''} ${local}`
}

function loadMap(shelf: DriveFile | undefined): IdMap | null {
  if (!shelf) return null
  try {
    const held = JSON.parse(read(MAP_KEY) || 'null') as { at: string; pairs: [string, string][] } | null
    if (!held || held.at !== shelf.modifiedTime) return null
    return new Map(held.pairs)
  } catch {
    return null
  }
}

function saveMap(shelf: DriveFile | undefined, map: IdMap) {
  if (!shelf) return
  put(MAP_KEY, JSON.stringify({ at: shelf.modifiedTime, pairs: [...map] }))
}

/* ── one full sync ─────────────────────────────────────────────────────── */

/** Pull, merge, push. Throws with a sentence fit to show. The caller supplies
    the token so an expired one can be renewed and the whole thing retried
    without this function knowing anything about auth. */
async function run(token: string): Promise<SyncResult> {
  const folder = await listFolder(token)
  const held = marks()
  const here = await signatures()
  const device = deviceName()

  const want = {
    shelf: stamp(folder.get(SHELF), here.shelf),
    marks: stamp(folder.get(MARKS), here.marks),
    place: stamp(folder.get(PLACE), here.place),
  }

  /* Every document unchanged on both sides, and the map still good: one
     listing call and nothing else. This is the common case by a wide margin —
     an app sitting open on a table hits it every ninety seconds. */
  const still =
    held.shelf === want.shelf &&
    held.marks === want.marks &&
    held.place === want.place &&
    folder.size > 0
  const fileWork = filesIncluded() ? await filesToMove(folder) : { up: [], down: [] }
  if (still && !fileWork.up.length && !fileWork.down.length) {
    put(SYNCED_AT_KEY, String(Date.now()))
    return NOTHING
  }

  let gained = 0
  let updated = 0
  let removed = 0

  /* THE SHELF GOES FIRST AND ALONE. Until the books have landed there is no
     map from the other device's ids to this one's, and a highlight merged
     without it lands on the wrong book or on no book at all. */
  const shelfFile = folder.get(SHELF)

  /* Downloaded at most once per sync, and only if something actually wants it.
     Three callers do — the shelf merge, and the two merges that need the
     tombstones the shelf carries — and on a sync where only a position moved
     none of them fires. */
  let shelfDoc: ShelfDoc | null = null
  const shelf = async (): Promise<ShelfDoc | null> => {
    if (!shelfFile) return null
    if (!shelfDoc) shelfDoc = JSON.parse(await readText(token, shelfFile.id)) as ShelfDoc
    return shelfDoc
  }

  let map: IdMap | null = held.shelf === want.shelf ? loadMap(shelfFile) : null
  if (!map) {
    const doc = await shelf()
    if (doc) {
      const folded = await mergeShelf(doc)
      gained += folded.folded.gained
      updated += folded.folded.updated
      removed += folded.folded.removed
      map = folded.map
      saveMap(shelfFile, map)
    } else {
      /* Nothing up there yet — this device is the first. Fingerprint the shelf
         so what goes up can be recognised by the second one. */
      await fingerprintAll()
      map = new Map()
    }
  }

  /* The other side's tombstones. Deletions of a highlight, a bookmark and a
     book all travel in the one list the shelf carries, because a merge is not
     the place to go looking for a second source of them. */
  const graves = async (): Promise<Grave[]> => (await shelf())?.graves ?? []

  if (held.marks !== want.marks) {
    const file = folder.get(MARKS)
    if (file) {
      const doc = JSON.parse(await readText(token, file.id)) as MarksDoc
      const folded = await mergeMarks(doc, map, await graves())
      gained += folded.gained
      updated += folded.updated
      removed += folded.removed
    }
  }

  if (held.place !== want.place) {
    const file = folder.get(PLACE)
    if (file) {
      const doc = JSON.parse(await readText(token, file.id)) as PlaceDoc
      const folded = await mergePlace(doc, map, await graves())
      gained += folded.gained
      updated += folded.updated
      removed += folded.removed
    }
  }

  /* Exported AFTER every merge, so what goes up is the union rather than this
     device's side of it. This is the line that makes overwriting safe. */
  const wrote: Marks = {}
  const push = async (name: string, doc: unknown, existing?: DriveFile) => {
    const body = new Blob([JSON.stringify(doc)], { type: 'application/json' })
    const saved = await writeFile(token, name, body, device, existing?.id)
    return saved
  }

  if (held.shelf !== want.shelf || !folder.has(SHELF)) {
    const saved = await push(SHELF, await exportShelf(), folder.get(SHELF))
    wrote.shelf = saved.modifiedTime
    /* The shelf that just went up is the one the map was built against. */
    saveMap(saved, map)
  }
  if (held.marks !== want.marks || !folder.has(MARKS)) {
    wrote.marks = (await push(MARKS, await exportMarks(), folder.get(MARKS))).modifiedTime
  }
  if (held.place !== want.place || !folder.has(PLACE)) {
    wrote.place = (await push(PLACE, await exportPlace(), folder.get(PLACE))).modifiedTime
  }

  const moved = filesIncluded() ? await moveFiles(token, folder, fileWork, device) : { files: 0, left: 0 }

  /* Runs whether or not the files are being carried: turning the switch off
     does not mean the copies already up there should stay for books that no
     longer exist. Failures are ignored one by one — a file that will not delete
     is a few megabytes of quota, and it will be tried again on the next sync,
     which is not worth failing a sync that otherwise worked. */
  for (const id of buriedFiles(folder, await db.graves.toArray())) {
    try {
      await remove(token, id)
    } catch {
      /* next pass */
    }
  }

  const after = await signatures()
  put(
    MARK_KEY,
    JSON.stringify({
      shelf: `${wrote.shelf ?? folder.get(SHELF)?.modifiedTime ?? ''} ${after.shelf}`,
      marks: `${wrote.marks ?? folder.get(MARKS)?.modifiedTime ?? ''} ${after.marks}`,
      place: `${wrote.place ?? folder.get(PLACE)?.modifiedTime ?? ''} ${after.place}`,
    }),
  )
  put(SYNCED_AT_KEY, String(Date.now()))
  /* Whatever was written while disconnected has now been up and merged, so it
     is no longer a reason to stop and ask anybody anything. */
  put(OFFLINE_KEY, '')
  void pruneGraves()
  window.dispatchEvent(new Event(SYNC_EVENT))
  return {
    gained,
    updated,
    removed,
    files: moved.files,
    filesLeft: moved.left,
    unchanged: false,
  }
}

/* ── the book files ────────────────────────────────────────────────────── */

/** Which books need their bytes sent up, and which need them fetched down.
    Both lists are computed before anything is transferred, so the cap can be
    applied to a known total and the remainder reported rather than forgotten. */
async function filesToMove(folder: Map<string, DriveFile>): Promise<{ up: string[]; down: string[] }> {
  const books = await db.books.toArray()
  const have = new Set(await db.files.toCollection().primaryKeys())
  const up: string[] = []
  const down: string[] = []
  for (const book of books) {
    if (!book.fp) continue
    const there = folder.has(bookFileName(book.fp))
    const mine = have.has(book.id)
    if (mine && !there) up.push(book.id)
    else if (!mine && there) down.push(book.fp)
  }
  return { up, down }
}

/** Book files in Drive whose book has been deleted, on any device.

    Nothing used to clear these. `filesToMove` only ever looks at books that
    exist HERE, so a deleted book's bytes simply stopped being mentioned and sat
    in the reader's Drive for good — megabytes each, against their own quota,
    for books they had told the app to forget. "Delete" has to mean the copy
    too, or it is a word about one device.

    The stones are the authority, and they are the whole shelf's worth: this
    device keeps every stone it has heard about (see `mergeShelf`), so a book
    deleted on the phone is cleared out of Drive by the laptop as readily as by
    the phone itself. */
function buriedFiles(folder: Map<string, DriveFile>, graves: Grave[]): string[] {
  const stoned = new Set(graves.filter((g) => g.kind === 'book').map((g) => bookFileName(g.ref)))
  const dead: string[] = []
  for (const [name, file] of folder) if (stoned.has(name) && ours(file)) dead.push(file.id)
  return dead
}

async function moveFiles(
  token: string,
  folder: Map<string, DriveFile>,
  work: { up: string[]; down: string[] },
  device: string,
): Promise<{ files: number; left: number }> {
  let files = 0
  const down = work.down.slice(0, FILES_PER_PASS)
  const up = work.up.slice(0, FILES_PER_PASS)
  const total = down.length + up.length
  let done = 0
  /* Nothing to move is not a pass worth drawing. The record still synced, and
     a bar that flashes 0 of 0 is noise on every ninety-second idle sync. */
  if (total > 0) report({ done, total })
  try {
    /* Down before up. A reader who has just installed the app on a new device
       wants a book to open, and is not waiting on their other device's copy of
       one they already have. */
    for (const fp of down) {
      const file = folder.get(bookFileName(fp))
      if (file && (await unpackBook(await readBlob(token, file.id)))) files += 1
      done += 1
      report({ done, total })
    }
    for (const id of up) {
      const packed = await packBook(id)
      if (packed) {
        await writeFile(token, packed.name, packed.body, device)
        files += 1
      }
      done += 1
      report({ done, total })
    }
  } finally {
    /* Cleared however this ends. A bar left on screen by a thrown sync is a
       sync that looks like it is still running forever. */
    if (total > 0) report(null)
  }
  const left = Math.max(0, work.down.length - FILES_PER_PASS) + Math.max(0, work.up.length - FILES_PER_PASS)
  return { files, left }
}

/** ONE BOOK, NOW. The pass above moves files a batch at a time in the
    background, which is right for a shelf and wrong for the book somebody has
    just tapped: they are looking at a blank page while their own file sits in
    Drive. So opening a book whose bytes are missing fetches that one file
    ahead of the queue, and the reader waits on a spinner instead of on an
    instruction.

    Returns false rather than throwing for every ordinary reason it cannot —
    not connected, offline, files turned off, the file genuinely not up there.
    The caller shows the same explanation in all of those cases. */
export async function fetchBookFile(bookId: string): Promise<boolean> {
  if (!optedIn() || !filesIncluded()) return false
  const book = await db.books.get(bookId)
  if (!book?.fp) return false
  try {
    const token = await silentToken()
    const file = (await listFolder(token)).get(bookFileName(book.fp))
    if (!file) return false
    return await unpackBook(await readBlob(token, file.id))
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

  running = (async () => {
    try {
      return await run(await silentToken())
    } catch (error) {
      /* One retry, and only for the hour being up. Everything else is a real
         failure and says so. */
      if (!(error instanceof Error) || error.message !== 'expired') throw error
      return run(await silentToken())
    }
  })().finally(() => {
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

/** Take the library out of Drive, and stop this device putting it back.

    Both halves, or it is theatre: deleting the files while this device is still
    connected means the next page turn recreates them within seconds, and
    somebody would have pressed a button that did nothing they could see. So
    syncing pauses first, the copy goes, and the caller signs out.

    Nothing on the device is touched. Every book stays where it is — this
    removes the copy, not the library. */
export async function forgetDrive(interactive = false): Promise<number> {
  pauseAutoSync()
  try {
    if (!tokenHeld() && interactive) await signIn()
    /* `ours` and not everything in the folder. The folder is this app's alone
       now, so the two agree — but they did not when the client was shared with
       Flyleaf Press, and a sibling's backup is never this app's to delete. See
       the note on `dropAll`. */
    const count = await dropAll(await silentToken(), ours)
    /* The marks described files that no longer exist. Left behind, a later
       reconnection could match one and skip the transfer that would have put
       the library back up. */
    put(MARK_KEY, '')
    put(MAP_KEY, '')
    put(SYNCED_AT_KEY, '')
    /* Everything here is now unshared by definition, so connecting again is a
       first meeting and should ask like one. */
    put(OFFLINE_KEY, '1')
    return count
  } finally {
    resumeAutoSync()
  }
}

/* ── Keeping up, without being asked ────────────────────────────────────────

   NOBODY SHOULD EVER HAVE TO PRESS "SYNC NOW". Connecting once is the only
   thing anybody should have to do. Three triggers, because two devices staying
   level needs both halves:

   PUSH, after a write — Dexie hooks on the six tables that hold the record
   schedule a sync, debounced by SETTLE.

   PULL, on a timer, while the app is in front. The other device writing
   something is not an event this device can hear, so it has to go and look.
   Only while visible: a backgrounded tab costs battery and finds nothing.

   AND ON ARRIVAL — at launch and whenever the app comes back to the front,
   which is the moment the other device is most likely to have moved.

   Each is cheap when nothing has changed: `run` compares three Drive
   timestamps against three stored marks and returns without moving bytes, so a
   poll on an idle pair is one listing call. */

/** How long a reading hand must be still before its work is sent up.

    FOUR TIMES PRESS'S, and the reason is the difference between the two apps.
    Press debounces a typing hand: four seconds after the last keystroke is the
    end of a sentence. This debounces a READING hand, and the write it is
    debouncing lands on every page turn — a reader turning a page every twenty
    seconds at a four-second settle would upload three times a minute for the
    length of a novel. Fifteen seconds costs at most fifteen seconds of
    staleness on a device nobody is looking at, and it is flushed the instant
    the app goes to the background, which is the moment it matters. */
const SETTLE = 15_000
/** How often an app in the foreground goes to look for the other device. */
const BEAT = 90_000
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
   itself for the moment the floor lifts, rather than being dropped — otherwise
   a book added just after a sync waits for the ninety-second beat, if the app
   is even still in front when it comes round. One timer, not one per caller:
   three triggers inside the same window still produce one sync, which is what
   the floor was for. */
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
       train with no signal must not be handed an error about it. The Settings
       row still shows how old the last real sync is, which is the honest
       version of the same fact. */
  })
}

/* A write happened. Wait for the hand to stop, then send. `running` is checked
   at the far end rather than here because the writes a sync makes are
   themselves merges arriving from Drive — they would otherwise schedule a sync
   of the thing just synced, forever. */
function touched() {
  if (!optedIn()) {
    /* Nowhere to send this — but it is exactly the work that will need
       reconciling if Drive is connected later, and remembering it now is the
       only way to know it happened. */
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
     checks — somebody who connects Drive halfway through a session would
     otherwise get no automatic sync until they next reloaded the app. */
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

  setInterval(() => {
    if (document.visibilityState === 'visible') attempt()
  }, BEAT)

  attempt()
}
