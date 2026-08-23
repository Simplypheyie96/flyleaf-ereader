/* ─────────────────────────────────────────────────────────────
   The sheet for a fixed page.

   The reflowable sheet has fifteen controls on three tabs. This one has
   four on none, and the difference is not a reduction — it is the whole
   truth about the format. A PDF's pages are pictures of type: the size,
   the face, the leading, the measure and the margins were all decided
   when the file was made, and nothing here can change one of them.

   So the type controls are ABSENT, not disabled — the same rule the
   reflowable sheet follows for Line width on a phone (Sheet.tsx, rule 3).
   A greyed-out Size slider on a PDF would be fifteen pixels of apology.
   What is left is everything that IS still the reader's: which page tone
   the surround takes, how the sheet is fitted to the pane, how far it is
   zoomed, and how much of the stock is allowed over the paper.

   There is no tablist, because four controls do not need three tabs and a
   tablist of one is not a control.
   ───────────────────────────────────────────────────────────── */

import type { Settings } from '../../types'
import { Row, Opt, Slider, STOCKS } from '../Sheet'

export interface PdfSheetProps {
    settings: Settings
    /** the view's live zoom, 1 = fitted. Shown on the reset chip. */
    zoom: number
    /** −1 out, +1 in, 0 back to the fit */
    onZoom: (dir: -1 | 0 | 1) => void
    onLive: (patch: Partial<Settings>) => void
    onSet: (patch: Partial<Settings>) => void
}

export function PdfSheet({ settings: s, zoom, onZoom, onLive, onSet }: PdfSheetProps) {
    const stock = STOCKS.find(k => k.id === s.stock)
    /* Press is the paper itself: its veil is 0, so the tint slider has
       nothing to move. Disabled with the reason on it rather than hidden,
       because unlike Line width on a phone this one comes back the moment
       the reader picks another stock, and a control that vanishes and
       reappears reads as a bug. */
    const noTint = s.stock === 'press'

    return (
        <section className="sheet" aria-label="Page settings">
            <div className="sheet-body sheet-body--bare">
                <p className="sheet-lead ui-p ui-p--soft">
                    A PDF’s pages are fixed. Its type was set when the file was made,
                    so there is nothing here to reflow — only the page itself.
                </p>

                <Row label="Fit" note={s.pdfFit === 'width'
                    ? 'The sheet fills the pane and scrolls. Readable on a phone.'
                    : 'One whole sheet per screen. Right on a tablet, small on a phone.'}>
                    <Opt on={s.pdfFit === 'width'} onClick={() => onSet({ pdfFit: 'width' })}>Width</Opt>
                    <Opt on={s.pdfFit === 'page'} onClick={() => onSet({ pdfFit: 'page' })}>Whole page</Opt>
                </Row>

                {/* Zoom is the view's, not the settings row's: it is a place
                    in a document, like the scroll position, and persisting it
                    would mean reopening a book at yesterday's magnification.
                    The middle chip is both the readout and the way back. */}
                <Row label="Zoom" note="Pinch the page for the same thing, from where your fingers are.">
                    <Opt on={false} onClick={() => onZoom(-1)}>Out</Opt>
                    <Opt on={Math.abs(zoom - 1) < 0.01} onClick={() => onZoom(0)}>
                        {Math.round(zoom * 100)}%
                    </Opt>
                    <Opt on={false} onClick={() => onZoom(1)}>In</Opt>
                </Row>

                <Row label="Stock" note={`${stock?.label ?? 'Day'} — the surround, and a wash over the sheet.`}>
                    {STOCKS.map(k => (
                        <button
                            key={k.id}
                            type="button"
                            className="sheet-opt sheet-opt--stock"
                            aria-pressed={s.stock === k.id}
                            onClick={() => onSet({ stock: k.id })}
                        >
                            <span className="sheet-sw" data-stock={k.id} aria-hidden="true" />
                            {k.label}
                        </button>
                    ))}
                </Row>

                <Slider
                    label="Page tint" value={s.pdfVeil} min={0} max={1} step={0.05}
                    fmt={v => (v < 0.005 ? 'None' : `${Math.round(v * 100)}%`)}
                    disabled={noTint}
                    note={noTint
                        ? 'Press has no tint to give — the page is already the paper.'
                        : 'How much of the stock washes over the sheet. The stock sets the ceiling, and the ceiling is what keeps the print legible.'}
                    onLive={v => onLive({ pdfVeil: v })}
                    onCommit={v => onSet({ pdfVeil: v })}
                />
            </div>
        </section>
    )
}
