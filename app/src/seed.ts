import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, db } from './db'
import { importFile } from './import'

/* The two books the shelf ships with.

   An ereader whose first screen says "Open a book" is a file manager
   introducing itself. This is the fix, and the whole of it: two public-domain
   books, already on the shelf, removable like any other.

   Provenance, licences and byte counts: app/public/seed/MANIFEST.md.
   Why they exist and how they behave: SPEC.md § 1. */

export type Seed = {
  /** Also the book's `id`. Assigned by us and stable forever, which is what
      makes a dismissal durable: a random UUID would change on every restore
      and `dismissedSeeds` would never match anything again. */
  id: string
  file: string
  /** for the failure message only — the real title comes out of the file */
  label: string
  /** what MANIFEST.md recorded. A mismatch means the file changed without the
      record changing, which is the one thing that folder's rules forbid. */
  bytes: number
}

export const SEEDS: Seed[] = [
  { id: 'the-time-machine', file: 'the-time-machine.epub', label: 'The Time Machine', bytes: 535_571 },
  { id: 'pride-and-prejudice', file: 'pride-and-prejudice.epub', label: 'Pride and Prejudice', bytes: 831_946 },
]

/** Put the included books on the shelf, unless they are already there or the
    reader deleted them.

    Idempotent, and called on every boot rather than behind a "have I run
    before" flag — because the flag and the actual contents of the shelf can
    disagree, and when they do the flag wins and someone's shelf stays wrong.
    Two indexed lookups on a warm start is a cheaper answer than a bug that
    only reproduces once.

    Seeding goes through `importFile` like anything else. A seed is not a
    special kind of book; it is a book the app imported instead of a person. If
    this had its own reader, the metadata and cover paths would drift from the
    ones the reader's own files take, and the divergence would show up as "the
    included books look different" long after the cause was forgettable. */
export async function seedIncluded(): Promise<void> {
  const settings = { ...DEFAULT_SETTINGS, ...(await db.settings.get(1)) }
  const dismissed = new Set(settings.dismissedSeeds)

  for (const seed of SEEDS) {
    if (dismissed.has(seed.id)) continue
    if (await db.books.get(seed.id)) continue

    try {
      /* Same-origin, and precached by Workbox — so this works with the network
         off, which is the whole reason the files are in the app rather than
         fetched from a library. The one state that could fail is "no network
         and no precache", and in that state the app itself did not load. */
      const response = await fetch(`${import.meta.env.BASE_URL}seed/${seed.file}`)
      if (!response.ok) throw new Error(`${response.status}`)
      const blob = await response.blob()
      const file = new File([blob], seed.file, { type: 'application/epub+zip' })
      await importFile(file, { id: seed.id, seeded: true })
    } catch {
      /* A seed that will not load is a shelf with one book on it, not a broken
         app. Silent on purpose: there is nothing the reader can do about it,
         and an error toast on first launch about a book they never asked for is
         a worse first impression than a shorter shelf. */
    }
  }
}

/** True when seeding would put something on the shelf — so boot can wait for it
    behind the launch screen instead of letting the shelf paint empty and then
    fill in. That flash is the whole bug the launch screen exists to prevent. */
export async function needsSeeding(): Promise<boolean> {
  const settings = { ...DEFAULT_SETTINGS, ...(await db.settings.get(1)) }
  const dismissed = new Set(settings.dismissedSeeds)
  for (const seed of SEEDS) {
    if (dismissed.has(seed.id)) continue
    if (!(await db.books.get(seed.id))) return true
  }
  return false
}

/** How many included books the reader has deleted. Drives whether Settings
    offers to bring them back, and whether the cleared shelf mentions them. */
export async function dismissedCount(): Promise<number> {
  const settings = { ...DEFAULT_SETTINGS, ...(await db.settings.get(1)) }
  return settings.dismissedSeeds.filter((id) => SEEDS.some((s) => s.id === id)).length
}

/* ------------------------------------------------------ seeding, once, ever --

   Two callers need to know about the same single run: boot, which holds the
   launch screen over it, and the Library, which must not paint "No books yet"
   at a reader whose books are 200ms from arriving. That flash is the exact bug
   the launch screen exists to prevent, and it would reappear here as soon as a
   phone is slower than the splash.

   So the run is module state, not a component's. One promise, kept, that never
   rejects — a seed that fails to load is a shorter shelf, not a stuck app. */

let run: Promise<void> | null = null
let settled = false

export function startSeeding(): Promise<void> {
  run ??= needsSeeding()
    .then((needed) => (needed ? seedIncluded() : undefined))
    .catch(() => undefined)
    .finally(() => {
      settled = true
    })
  return run
}

/** Re-seed after a restore. Deliberately not `startSeeding` — that one is
    "once, ever", and Restore is the one action that means "again". */
export async function reseed(): Promise<void> {
  run = null
  settled = false
  await startSeeding()
}

/** False while the first seeding pass is in flight, so a screen can hold its
    empty state instead of asserting an empty shelf it is not yet entitled to
    assert. */
export function useSeedingSettled(): boolean {
  const [done, setDone] = useState(settled)
  useEffect(() => {
    if (done) return
    let live = true
    void startSeeding().then(() => {
      if (live) setDone(true)
    })
    return () => {
      live = false
    }
  }, [done])
  return done
}
