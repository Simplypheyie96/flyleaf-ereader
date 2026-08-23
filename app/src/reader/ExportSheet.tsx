/* ─────────────────────────────────────────────────────────────
   Taking the marks out.

   Four formats, two ways out, and no page numbers — SPEC.md § 6.3. Markdown
   is the default because it is the one that pastes into somewhere useful and
   still reads as plain text if it doesn't. JSON is the only one that carries
   the CFIs, and is labelled as the one to keep rather than the one to read.
   PDF is the one to send to somebody who does not care what a CFI is.

   Download is offered but not assumed: on iOS a download is a fight, and Copy
   is what most readers actually want. So Copy sits first and reports back —
   except for the PDF, which is a file and not text, so Copy is not shown at
   all rather than shown broken.
   ───────────────────────────────────────────────────────────── */

import { useState } from 'react'
import { CheckIcon, CopyIcon, ExportIcon } from '../components/icons'
import { EXPORT_META, exportMarks, exportName } from './marks'
import type { ExportFormat, ExportInput, TextExportFormat } from './marks'
import { exportPdf, unmappable } from './pdfExport'

const FORMATS: { id: ExportFormat; note: string }[] = [
    { id: 'markdown', note: 'Headings and blockquotes' },
    { id: 'text', note: 'No markup at all' },
    { id: 'json', note: 'Keeps the positions' },
    { id: 'pdf', note: 'A page to print or send' },
]

export function ExportSheet({ input, onClose }: { input: ExportInput; onClose: () => void }) {
    const [format, setFormat] = useState<ExportFormat>('markdown')
    const [said, setSaid] = useState<string | null>(null)

    const isPdf = format === 'pdf'
    /* Only built for the text formats; the PDF is built at the moment of the
       download instead, because it is bytes and there is nothing to copy. */
    const body = isPdf ? '' : exportMarks(input, format as TextExportFormat)
    const meta = EXPORT_META[format]
    const count = input.highlights.length + input.bookmarks.length
    /* Said BEFORE the reader commits, not after: the PDF's fonts are the
       base-14 set, so a Greek or Cyrillic quotation would come out as question
       marks. Counting it is cheap, and a surprise is not. */
    const lost = isPdf ? unmappable(input) : 0

    async function copy() {
        try {
            await navigator.clipboard.writeText(body)
            setSaid('Copied.')
        } catch {
            /* Denied clipboard permission is the usual cause, and it is the
               reader's own setting — so say what happened rather than failing
               silently, and leave the download as the way out. */
            setSaid('This browser would not let the app copy. Try Download.')
        }
    }

    function download() {
        const blob = isPdf
            ? new Blob([exportPdf(input) as BlobPart], { type: meta.mime })
            : new Blob([body], { type: meta.mime })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = exportName(input.title, format)
        a.click()
        /* Revoked on the next turn of the loop rather than immediately: the
           click is synchronous but the fetch of the blob is not. */
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setSaid(
            lost
                ? `Saved. ${lost} ${lost === 1 ? 'character' : 'characters'} the PDF's fonts cannot print came out as a question mark.`
                : 'Saved.',
        )
    }

    return (
        <div
            className="sheet export"
            role="dialog"
            aria-label="Export marks"
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
        >
            <p className="export-head">
                <span className="mono">{count}</span>
                {count === 1 ? ' mark' : ' marks'} from {input.title}
            </p>

            <div className="export-formats" role="radiogroup" aria-label="Format">
                {FORMATS.map(f => (
                    <button
                        key={f.id}
                        type="button"
                        role="radio"
                        className="export-format"
                        aria-checked={format === f.id}
                        onClick={() => { setFormat(f.id); setSaid(null) }}
                    >
                        <span className="export-format-name">{EXPORT_META[f.id].label}</span>
                        <span className="export-format-note">{f.note}</span>
                    </button>
                ))}
            </div>

            <div className="export-acts">
                {/* Copy is the primary for the three text formats and absent
                    for the PDF, which promotes Download into its place —
                    a disabled button the reader cannot use is worse than a
                    button that isn't there. */}
                {!isPdf && (
                    <button type="button" className="export-do" onClick={() => void copy()}>
                        <CopyIcon />
                        <span>Copy</span>
                    </button>
                )}
                <button
                    type="button"
                    className={isPdf ? 'export-do' : 'export-alt'}
                    onClick={download}
                >
                    <ExportIcon />
                    <span>Download</span>
                </button>
                <button type="button" className="export-shut" onClick={onClose}>
                    <CheckIcon />
                    <span>Done</span>
                </button>
            </div>

            {/* One live region, so a screen reader hears the outcome without
                the button label changing under the pointer. */}
            <p className="export-said" role="status">
                {said
                    ?? (lost
                        ? `${lost} ${lost === 1 ? 'character' : 'characters'} in these marks cannot be printed by a PDF's built-in fonts.`
                        : ' ')}
            </p>
        </div>
    )
}
