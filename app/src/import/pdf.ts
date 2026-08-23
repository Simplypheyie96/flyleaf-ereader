/* ─────────────────────────────────────────────────────────────
   What a PDF says about itself, and what its first page looks like.

   Two things worth stating, because both look like they might break a
   rule and neither does.

   First, page one rendered is not a *generated* cover. The guardrail
   bans inventing a cover for a book that has none — a coloured
   rectangle with the title set in it. A PDF's first page IS its cover:
   it is the file's own content, drawn the way the file says to draw it,
   and it is what every reader recognises the document by. Nothing here
   is invented; if the page will not render, the book gets no cover and
   the shelf shows its title, exactly as an EPUB without one does.

   Second, this module imports the PDF engine, and the engine imports
   pdfjs. That is why it is only ever reached through the dynamic import
   in meta.ts: importing an EPUB must not download a PDF engine.
   ───────────────────────────────────────────────────────────── */

import type { Meta } from './meta'
import { getPage, openPdf } from '../reader/pdf/engine'

/** The long edge of the stored thumbnail, in device pixels. The shelf draws
    covers around 160px wide at 3× — 640 leaves headroom for the book sheet's
    larger one without storing a full-resolution page per book. */
const COVER_LONG_EDGE = 640

/** A PDF's Info dict is free text written by whatever produced the file, and
    producers fill it with junk: a path, a template name, "Microsoft Word -
    untitled". A title that is obviously the machine's rather than the book's is
    worse than no title, because the filename it would have replaced is at
    least what the reader called it. */
function usableTitle(raw: string | null): string | undefined {
    const t = raw?.trim()
    if (!t || t.length < 2 || t.length > 300) return undefined
    /* A file path, a bare filename with an extension, or the Word/Acrobat
       "producer - document" shape. Any of these is plumbing. */
    if (/[/\\]/.test(t)) return undefined
    if (/\.(pdf|docx?|indd|tex|pages|odt|rtf|pptx?)$/i.test(t)) return undefined
    if (/^(untitled|document\d*|microsoft word|print job|slide\s*\d+)$/i.test(t)) return undefined
    return t
}

export async function readPdf(file: File): Promise<Meta> {
    const doc = await openPdf(file)
    try {
        const meta: Meta = {}
        const title = usableTitle(doc.info.title)
        if (title) meta.title = title
        const author = doc.info.author?.trim()
        if (author && author.length <= 200) meta.author = author
        const language = doc.info.language?.trim()
        if (language) meta.language = language
        const subject = doc.info.subject?.trim()
        if (subject && subject.length > 20) meta.description = subject
        /* `creator` and `producer` are the tools, not the book, so they are read
           by the engine for the book sheet and deliberately not mapped here. */

        const cover = await firstPage(doc)
        if (cover) meta.cover = cover
        return meta
    } finally {
        /* The import path opens the file to look at it and has no further use
           for the parsed document. A worker left running per imported PDF would
           be a leak the reader pays for on a bulk import of twenty files. */
        doc.close()
    }
}

/** Page one, drawn to a canvas and encoded. Returns null rather than throwing:
    an unrenderable first page — a broken JPEG2000 image, an encrypted stream —
    costs the book its cover and nothing else. */
async function firstPage(doc: Awaited<ReturnType<typeof openPdf>>): Promise<Blob | null> {
    try {
        const page = await getPage(doc.doc, 1)
        const base = page.getViewport({ scale: 1 })
        const scale = COVER_LONG_EDGE / Math.max(base.width, base.height)
        const viewport = page.getViewport({ scale: Math.min(scale, 4) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(viewport.width))
        canvas.height = Math.max(1, Math.round(viewport.height))
        /* White, not the stock: this is stored once at import and the reader can
           change stock afterwards. A cover baked in tea would stay tea-coloured
           on a coal shelf. The page's own ink is drawn over it, and the shelf
           tints the frame, never the image. */
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, viewport }).promise
        return await new Promise<Blob | null>(resolve =>
            canvas.toBlob(b => resolve(b), 'image/jpeg', 0.82))
    } catch {
        return null
    }
}
