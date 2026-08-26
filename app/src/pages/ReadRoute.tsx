/* ─────────────────────────────────────────────────────────────
   One URL, two readers.

   /read/:id is the same address whatever the book is, because a reader
   thinks in books, not in engines. Which engine answers is decided here,
   from the format already recorded at import.

   The split is a code-split for a reason worth stating: pdfjs and its
   worker are about 1.7MB, and a reader who only ever opens EPUBs should
   never download a byte of it. So PdfReader is behind React.lazy and the
   reflowable reader is not — it is the common case, and paying a chunk
   round-trip on the way into a book the reader just tapped would cost
   the "open is instant" promise the brief makes.
   ───────────────────────────────────────────────────────────── */

import { lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Reader } from './Reader'
import { SpinnerIcon } from '../components/icons'

const PdfReader = lazy(() =>
    import('./PdfReader').then(m => ({ default: m.PdfReader })))

/** The same word the readers themselves show while a book opens, so the
    handover between this and the reader it chose is invisible. */
function Opening() {
    return (
        <main className="reader">
            <div className="reader-stage reader-loading">
                <SpinnerIcon aria-hidden="true" style={{ marginTop: '-40px' }} />
                <p className="reader-opening ui-p ui-p--soft">Opening…</p>
            </div>
        </main>
    )
}

export function ReadRoute() {
    const { id } = useParams<{ id: string }>()
    /* `undefined` means the lookup has not answered yet; `null` means it
       answered and there is no such book. Only the second is a decision. */
    const book = useLiveQuery(
        async () => (id ? (await db.books.get(id)) ?? null : null), [id])

    if (book === undefined) return <Opening />
    if (book?.format === 'pdf') return (
        <Suspense fallback={<Opening />}><PdfReader /></Suspense>
    )
    /* A missing book falls through to the reflowable reader, which already
       says "That book is not in this library any more" in the same chrome.
       Two places saying it would be two wordings to keep in step. */
    return <Reader />
}
