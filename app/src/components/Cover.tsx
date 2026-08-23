import { useEffect, useState } from 'react'
import type { Book } from '../types'
import { FORMAT_FAMILY, FORMAT_LABEL, tilt } from '../lib'

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

   The blob URL is created here and revoked here. A shelf of forty covers that
   forgets to revoke is forty decoded bitmaps held for the life of the tab.

   That revoke is why the effect below keys on the cover's SHAPE and not on the
   Blob itself. Dexie hands back a fresh Blob instance on every emission, so a
   live query keyed on `book.cover` re-runs on every unrelated write to the
   books table — reset position, mark finished, a progress tick from the reader.
   Each re-run revoked the URL the <img> was still pointing at and minted a new
   one, and the browser showed its broken-image glyph for the frame in between.
   On a slow phone that frame is the one you see: a cover that goes blank when
   you touch something else entirely. id + size + type is stable across those
   emissions and still changes when the cover genuinely does. */

type Props = {
  book: Book
  /** off for the reading page and anywhere a cover is chrome rather than an
      object. DESIGN.md: the tilt is library and book detail only. */
  lean?: boolean
}

export function Cover({ book, lean = true }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  /* A cover that will not decode IS nothing, so it gets the designed ghost
     rather than the browser's broken-image glyph. Belt to the braces above:
     the shape key stops the URL being pulled out from under the <img>, and
     this catches anything else — a truncated blob from an interrupted sync, a
     file whose declared media-type was a lie. */
  const [dead, setDead] = useState(false)

  /* Not `book.cover` — see the note above. */
  /* size, not just presence: a zero-byte Blob is truthy and would render as a
     broken glyph. */
  const shape = book.cover?.size ? `${book.id}:${book.cover.size}:${book.cover.type}` : null

  useEffect(() => {
    setDead(false)
    const blob = book.cover
    if (!blob?.size) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape])

  const style = undefined

  return (
    /* data-family, not a colour: which step of the ramp a format wears is a
       design decision and lives in the stylesheet. This only says what kind of
       file it is. */
    <span className="cover" style={style} data-family={FORMAT_FAMILY[book.format]}>
      {url && !dead ? (
        /* No width/height attributes: the cover's real proportions are the
           point, and the box below reserves the space so there is no shift. */
        /* No loading="lazy": the bytes are already in memory, so deferring
           the fetch saves nothing and risks the fetch landing after a
           revoke. */
        <img src={url} alt="" decoding="async" onError={() => setDead(true)} />
      ) : (
        <span className="cover-ghost">
          <span className="cover-ghost-fmt">{FORMAT_LABEL[book.format] ?? book.format}</span>
          <span className="cover-ghost-note">No cover</span>
        </span>
      )}
    </span>
  )
}
