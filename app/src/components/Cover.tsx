import { useState } from 'react'
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

/* A cover that genuinely will not decode IS nothing, so it gets the designed
   ghost rather than the browser's broken-image glyph — a truncated blob from an
   interrupted sync, a file whose declared media-type was a lie.

   ONE ERROR IS NOT EVIDENCE, though, and this is the part worth being careful
   about. An `error` from a genuinely corrupt blob and an `error` from a load
   that was interrupted are the same event with the same fields; nothing on it
   says which happened. So the first failure is not believed. The URL is thrown
   away and minted again, which retries the decode: corrupt bytes fail the
   second time too and get the ghost, while an interrupted load simply succeeds.

   That asymmetry is the whole reason the old code went wrong in the opposite
   direction — it believed the first error, and a cover that was fine sat as
   "No cover" until something forced a remount. Counting to two costs one
   decode of an at-most-120KB image, once, and only when something already
   went wrong. */
const failures = new Map<string, number>()
const undecodable = new Set<string>()

type Props = {
  book: Book
  /** kept for the call sites; the printed tilt was removed from the cover, so
      nothing reads it. */
  lean?: boolean
}

export function Cover({ book }: Props) {
  /* Nothing here is state except the request to paint again. `undecodable` is
     the source of truth and it is module-level, so this counter exists only to
     get one more render out of the mount that saw the failure. */
  const [, repaint] = useState(0)

  /* size, not just presence: a zero-byte Blob is truthy and would render as a
     broken glyph. */
  const blob = book.cover
  const shape = blob?.size ? `${book.id}:${blob.size}:${blob.type}` : null
  /* Derived during render, not in an effect, so the very first paint has the
     real src. This is what closes the one-render window the old code left
     between revoking a URL and committing the replacement. Minting is
     idempotent and cached, so a double render under StrictMode or a concurrent
     re-render returns the same URL rather than a second one. */
  const url = shape && blob && !undecodable.has(shape) ? coverUrl(shape, blob) : null

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
          onError={(e) => {
            /* Only if the failure is THIS url. An error arriving for a src the
               element has already moved off is not evidence about the cover in
               front of you. */
            if (!shape || e.currentTarget.src !== url) return
            /* And only if the URL is still the live one for this shape: an
               eviction can revoke a URL an <img> still points at, and that
               failure says the cache moved on, not that the bytes are bad. */
            if (urls.get(shape) !== url) return

            const n = (failures.get(shape) ?? 0) + 1
            failures.set(shape, n)
            /* Drop the URL either way, so a retry gets a fresh one and a
               verdict of undecodable is not still holding a blob alive. */
            urls.delete(shape)
            URL.revokeObjectURL(url)
            if (n >= 2) undecodable.add(shape)
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
