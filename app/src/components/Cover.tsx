import { useEffect, useRef, useState } from 'react'
import type { Book } from '../types'
import { FORMAT_FAMILY, FORMAT_LABEL } from '../lib'

/* A cover, as an object on a shelf.

   Two rules from DESIGN.md, both load-bearing:

   — **Real cover or nothing.** There is no generated placeholder and no
     cover-sized dashed tile. A book with no cover gets a small labelled ghost
     that says what the file is, because that is the only true thing the app
     knows about it. Its FORMAT sets one step of the mono graph ramp, which is
     still that one true thing, said in weight rather than in colour — no
     artwork, no fabricated title page, no author line. A ghost carrying a step
     of the ramp is not a generated cover.
   — **object-fit: contain, aligned to the foot.** Cropping a cover cuts the
     title off the artwork, which is the one thing a cover exists to carry. So
     covers of different proportions are not forced to a common rectangle; they
     stand on a common baseline instead, the way books on a shelf do.

   THE URL IS NOT OWNED BY THE COMPONENT, and that is the whole point of the
   cache below. It used to be: created in an effect, revoked on cleanup. Two
   separate faults came out of that, and together they are the cover that shows
   one minute and is gone the next.

   1. `setUrl` is a state update, so the <img> keeps the OLD src for one render
      after the effect has already revoked it. If the image had not finished
      decoding — the normal case on a phone, where `decoding="async"` means a
      cover is often still in flight — revoking aborts that load and the browser
      fires `error`.
   2. That error used to latch. `dead` was only ever cleared when the effect
      re-ran, and the effect keys on the cover's shape, which for a given book
      never changes. So ONE aborted load replaced a perfectly good cover with
      the "No cover" ghost for the rest of the session, and only a remount —
      navigating away and back — brought it back. Measured: dispatching a single
      `error` at a loaded, valid <img> ghosted it permanently.

   Both faults are the same root cause: a URL whose lifetime was tied to one
   mount of one component, while the same book is on screen in several places at
   once (Home alone renders a book in the continue rail AND the recent shelf,
   which minted two URLs for one blob — measured: 2 imgs, 2 distinct URLs).

   So the URL is now minted once per cover and kept. It is stable across
   mounts, unmounts, remounts and route changes, which means there is no revoke
   for a load to race, no gap for the browser's broken-image glyph, and every
   place a book appears shares one decode. Nothing revokes on unmount at all.

   The memory the old cleanup existed to protect turns out not to be at stake.
   Library reads the shelf with `toArray()`, so every book's cover Blob is
   already held in memory for as long as that query is live; an object URL is a
   handle onto a Blob that is being retained anyway, not a second copy of it.
   What the old cleanup actually bought was the revoke that caused the bug.

   `LIMIT` is therefore a runaway guard and not a memory strategy, and it is set
   far above any real shelf on purpose. A cap tight enough to bite — 40, which
   is what this was first written as — is actively harmful: a reader with 60
   books has 60 covers mounted in Library at once, so evicting the 20
   least-recently-used revokes URLs that are still on screen, and each one
   errors, retries, re-mints and evicts another. That is the reported glitch
   reproduced by the cache meant to fix it. At 512 the entries being dropped
   belong to covers that have not been touched in hundreds of distinct books. */

/* Keyed on the cover's SHAPE, not on the Blob. Dexie hands back a fresh Blob
   instance on every emission, so a key of `book.cover` would miss on every
   unrelated write to the books table — reset position, mark finished, a
   progress tick from the reader. id + size + type is stable across those
   emissions and still changes when the cover genuinely does. */
const LIMIT = 512
const urls = new Map<string, string>()

function coverUrl(shape: string, blob: Blob): string {
  const held = urls.get(shape)
  if (held) {
    /* re-insert so it counts as recently used */
    urls.delete(shape)
    urls.set(shape, held)
    return held
  }
  const url = URL.createObjectURL(blob)
  urls.set(shape, url)
  while (urls.size > LIMIT) {
    const oldest = urls.keys().next().value
    if (oldest === undefined) break
    const dead = urls.get(oldest)
    urls.delete(oldest)
    if (dead) URL.revokeObjectURL(dead)
  }
  return url
}

/* Every mounted Cover, so a copy or a verdict that lands can repaint all of
   them and not merely the one that happened to start it. The same book is on
   screen in more than one place — Home renders it in the continue rail and in
   the recent shelf — and a re-mint that reached only one of those left the
   other pointing at the handle that had already failed. */
const listeners = new Set<() => void>()
const notify = () => { for (const fn of listeners) fn() }

/* THE BYTES ARE COPIED OUT OF INDEXEDDB AT SIGHT, NOT AFTER A FAILURE.

   An object URL is a handle onto a Blob, and a Blob that came out of IndexedDB
   is backed by a file the browser may stop lending. WebKit in particular can
   neuter an IDB-backed Blob some time after the transaction that produced it,
   at which point every URL minted from it fails to load however many times it
   is re-minted. That is the report, exactly: a cover that was there, and later
   is not, on a phone, with no reload in between.

   This used to be handled on the way down — two failed loads, THEN copy the
   bytes into memory and mint from the copy. That cannot work, and the comment
   it replaced said why without noticing: it called for reading the handle
   "while it is still good", but it only ran once the handle had already gone.
   `arrayBuffer()` on a neutered Blob rejects, so the rescue failed in precisely
   the case it existed for, and the old code then took that rejection as proof
   the cover was dead and ghosted it.

   So the copy is made eagerly instead, on the first sight of a shape, out of
   the Blob the live query just handed over — which is the one moment it is
   certain to be readable. From then on the URL is minted from an in-memory
   Blob, which is not file-backed and cannot be neutered. The class of failure
   is removed rather than recovered from.

   It costs no memory worth counting. The URL held by the cache retains its
   Blob either way; minting from the copy simply moves what is retained from a
   file handle to the bytes themselves, and a cover is at most a couple of
   hundred kilobytes. The shelf query holds all of them anyway. */
const memory = new Map<string, Blob>()
const copying = new Set<string>()
const uncopyable = new Set<string>()

function ensureCopy(shape: string, blob: Blob) {
  if (memory.has(shape) || copying.has(shape) || uncopyable.has(shape)) return
  copying.add(shape)
  blob.arrayBuffer().then(
    buf => {
      copying.delete(shape)
      memory.set(shape, new Blob([buf], { type: blob.type }))
      /* Drop the entry so the next render mints from the copy. NOT a revoke:
         the URL being replaced is on screen in every other place this book
         appears, and revoking it aborts their in-flight decodes — one error
         each, for a cover that is about to be fine. The stale handle leaks
         once, on bytes the shelf query retains regardless. */
      urls.delete(shape)
      notify()
    },
    () => {
      copying.delete(shape)
      /* Unreadable at the moment we asked. That is not a verdict about the
         bytes — IndexedDB can be under pressure, or the handle was already
         gone before this mount ever saw it — so the cover is left minting from
         the handle and the loading path below decides. */
      uncopyable.add(shape)
    },
  )
}

/* A cover that genuinely will not decode IS nothing, so it gets the designed
   ghost rather than the browser's broken-image glyph — a truncated blob from an
   interrupted sync, a file whose declared media-type was a lie.

   AN `error` ON AN <img> IS NOT EVIDENCE OF THAT, though, and this is the part
   the old code kept getting wrong in both directions. Corrupt bytes and an
   interrupted load fire the same event with the same fields; nothing on it says
   which happened. Counting to three did not fix the ambiguity, it only made the
   wrong verdict rarer — and a shelf scrolled hard on a slow phone produces
   three aborted loads without any cover being bad.

   So no number of load errors condemns a cover any more. They only ask the
   question, and `createImageBitmap` answers it: it decodes the bytes directly,
   with no element, no src to be moved off and no navigation to abort, so a
   rejection is about the bytes and nothing else. Bytes that decode clear the
   count and are minted again; only bytes that genuinely will not decode get the
   ghost. A good cover can no longer be ghosted at all. */
const failures = new Map<string, number>()
const undecodable = new Set<string>()
const proving = new Set<string>()
/* Bytes already shown to decode. Kept so a shape that keeps failing to LOAD —
   which is a broken handle, not broken bytes — does not pay for a fresh decode
   on every one of those failures. A shape changes when the bytes do, so this
   can never vouch for bytes it has not seen. */
const proven = new Set<string>()

function prove(shape: string, blob: Blob) {
  if (proving.has(shape)) return
  if (proven.has(shape)) {
    /* Asked and answered: the cover is fine and something around it is not. */
    failures.delete(shape)
    urls.delete(shape)
    notify()
    return
  }
  if (typeof createImageBitmap !== 'function') {
    /* No way to ask. Fall back to the old count, which is at least honest
       about being a guess. */
    if ((failures.get(shape) ?? 0) >= 3) { undecodable.add(shape); notify() }
    return
  }
  proving.add(shape)
  createImageBitmap(blob).then(
    bmp => {
      proving.delete(shape)
      proven.add(shape)
      bmp.close?.()
      /* They decode. Whatever went wrong was the element, the network of
         object-URL plumbing around it, or a navigation — not the cover. */
      failures.delete(shape)
      urls.delete(shape)
      notify()
    },
    () => {
      proving.delete(shape)
      undecodable.add(shape)
      notify()
    },
  )
}

/* size, not just presence: a zero-byte Blob is truthy and would render as a
   broken glyph. */
function shapeOf(book: Book): string | null {
  const blob = book.cover
  return blob?.size ? `${book.id}:${blob.size}:${blob.type}` : null
}

type Props = {
  book: Book
  /** kept for the call sites; the printed tilt was removed from the cover, so
      nothing reads it. */
  lean?: boolean
}

export function Cover({ book }: Props) {
  /* Nothing here is state except the request to paint again. The maps above
     are the source of truth and they are module-level; this counter exists
     only to get another render out of the mounts that need one. */
  const [, repaint] = useState(0)

  useEffect(() => {
    const fn = () => repaint(x => x + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  /* A verdict is never allowed to outlive the mount that reached it. It is
     module-level so that the evidence can come from two different copies of
     the same book on one screen — not so that a book stays ghosted for the
     rest of the session. Any fresh mount (a route change, a scroll that
     recycles a row) clears it and asks again, which costs one decode of an
     at-most-120KB image. */
  const first = useRef(true)
  if (first.current) {
    first.current = false
    const s = shapeOf(book)
    if (s) { undecodable.delete(s); failures.delete(s) }
  }

  const blob = book.cover
  const shape = shapeOf(book)
  /* The copy is started here, during render, on the Blob the live query just
     produced — the one moment it is certain to be readable. Idempotent, so a
     double render under StrictMode or six mounts of the same book start one
     copy between them. */
  if (shape && blob) ensureCopy(shape, blob)

  /* Derived during render, not in an effect, so the very first paint has the
     real src. This is what closes the one-render window the old code left
     between revoking a URL and committing the replacement. Minting is
     idempotent and cached, so a double render returns the same URL rather than
     a second one. */
  const bytes = shape ? memory.get(shape) ?? blob : blob
  const url = shape && bytes && !undecodable.has(shape) ? coverUrl(shape, bytes) : null

  return (
    /* data-family, not a colour: which step of the ramp a format wears is a
       design decision and lives in the stylesheet. This only says what kind of
       file it is. */
    <span className="cover" data-family={FORMAT_FAMILY[book.format]}>
      {url ? (
        /* No width/height attributes: the cover's real proportions are the
           point, and the box below reserves the space so there is no shift. */
        /* No loading="lazy": the bytes are already in memory, so deferring the
           fetch saves nothing. */
        <img
          src={url}
          alt=""
          decoding="async"
          /* Proof the bytes decode, so the count of failures starts again from
             zero. Without this the failures that trigger a check need not be
             consecutive: one interrupted load now and another an hour later
             add up to a question about a cover that has decoded correctly a
             hundred times in between. */
          onLoad={() => {
            if (shape) failures.delete(shape)
          }}
          onError={(e) => {
            /* Only if the failure is THIS url. An error arriving for a src the
               element has already moved off is not evidence about the cover in
               front of you. */
            if (!shape || !bytes || e.currentTarget.src !== url) return
            /* And only if the URL is still the live one for this shape: an
               eviction can revoke a URL an <img> still points at, and that
               failure says the cache moved on, not that the bytes are bad. */
            if (urls.get(shape) !== url) return

            const n = (failures.get(shape) ?? 0) + 1
            failures.set(shape, n)
            /* Drop the cache entry so the retry mints a fresh URL — but DO NOT
               revoke. The same book is on screen in more than one place (Home
               renders it in the continue rail and the recent shelf), and those
               copies share this URL; revoking it here aborts THEIR in-flight
               decodes, which is one error each, which is more false evidence.
               The stale handle leaks until the tab closes, once per failure, on
               a blob that is retained by the shelf query anyway. */
            urls.delete(shape)
            /* One failure is re-minted and tried again, because an interrupted
               load simply succeeds the second time and that costs nothing. A
               second one stops guessing and goes and looks at the bytes. */
            if (n >= 2) prove(shape, bytes)
            repaint((x) => x + 1)
          }}
        />
      ) : (
        <span className="cover-ghost">
          <span className="cover-ghost-fmt">{FORMAT_LABEL[book.format] ?? book.format}</span>
          <span className="cover-ghost-note">No cover</span>
        </span>
      )}
    </span>
  )
}
