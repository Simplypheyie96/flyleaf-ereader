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
   forgets to revoke is forty decoded bitmaps held for the life of the tab. */

type Props = {
  book: Book
  /** off for the reading page and anywhere a cover is chrome rather than an
      object. DESIGN.md: the tilt is library and book detail only. */
  lean?: boolean
}

export function Cover({ book, lean = true }: Props) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!book.cover) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(book.cover)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [book.cover])

  const style = lean ? { ['--lean' as string]: `${tilt(book.id)}deg` } : undefined

  return (
    /* data-family, not a colour: which step of the ramp a format wears is a
       design decision and lives in the stylesheet. This only says what kind of
       file it is. */
    <span className="cover" style={style} data-family={FORMAT_FAMILY[book.format]}>
      {url ? (
        /* No width/height attributes: the cover's real proportions are the
           point, and the box below reserves the space so there is no shift. */
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="cover-ghost">
          <span className="cover-ghost-fmt">{FORMAT_LABEL[book.format] ?? book.format}</span>
          <span className="cover-ghost-note">No cover</span>
        </span>
      )}
    </span>
  )
}
