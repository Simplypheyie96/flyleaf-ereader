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
import { Row, Opt, Slider, STOCKS, TURNS } from '../Sheet'

export interface PdfSheetProps {
    settings: Settings
    /** the view's live zoom, 1 = fitted. Shown on the reset chip. */
    zoom: number
    /** −1 out, +1 in, 0 back to the fit */
    onZoom: (dir: -1 | 0 | 1) => void
    /** Is the pane wide enough for a real spread? The control is offered
        either way — a reader who sets it on a phone wants it on the tablet
        they open the same book on next — but it says which it is doing. */
    spreadOk: boolean
    onLive: (patch: Partial<Settings>) => void
    onSet: (patch: Partial<Settings>) => void
}

/* The reflowable sheet's own notes describe a paginator this format does not
   have -- there is no hairline between two columns of a PDF -- so the same
   three turns are described here for what they actually do to a sheet. A
   drag is never any of these: it always tracks the thumb. */
const PDF_TURN: Record<Settings['turn'], string> = {
    slide: 'The next sheet slides up under your thumb, and a tap glides to it.',
    fade: 'The sheet is replaced behind a brief dip, with nothing travelling.',
    instant: 'No motion at all — the next sheet is simply there.',
}

export function PdfSheet({ settings: s, zoom, spreadOk, onZoom, onLive, onSet }: PdfSheetProps) {
    const stock = STOCKS.find(k => k.id === s.stock)
    /* Press is the paper itself: its veil is 0, so the tint slider has
       nothing to move. Disabled with the reason on it rather than hidden,
       because unlike Line width on a phone this one comes back the moment
       the reader picks another stock, and a control that vanishes and
       reappears reads as a bug. */
    const pages = s.pdfMode === 'pages'
    /* Original stands the wash down entirely, so the slider has nothing to
       move for the same reason Press has nothing to give. Same treatment,
       same reason: disabled with the reason on it, because it comes straight
       back the moment the reader turns Original off. */
    const noTint = s.stock === 'press' || s.pdfOriginal

    return (
        <section className="sheet" aria-label="Page settings">
            <div className="sheet-body sheet-body--bare">
                <p className="sheet-lead ui-p ui-p--soft">
                    A PDF’s pages are fixed. Its type was set when the file was made,
                    so there is nothing here to reflow — only the page itself.
                </p>

                <Row label="Reading" note={pages
                    ? 'One sheet — or one spread — per screen, turned. The whole page is fitted, so there is no Fit to choose.'
                    : 'One continuous strip of sheets, scrolled. What a fixed page is, so it is the default.'}>
                    <Opt on={!pages} onClick={() => onSet({ pdfMode: 'scroll' })}>Scroll</Opt>
                    <Opt on={pages} onClick={() => onSet({ pdfMode: 'pages' })}>Pages</Opt>
                </Row>

                {/* Absent in Pages, not disabled: pages mode fits the whole
                    sheet by definition, so there is no choice left to grey
                    out. Same rule as Line width on a phone. */}
                {!pages && (
                <Row label="Fit" note={s.pdfFit === 'width'
                    ? 'The sheet fills the pane and scrolls. Readable on a phone.'
                    : 'One whole sheet per screen. Right on a tablet, small on a phone.'}>
                    <Opt on={s.pdfFit === 'width'} onClick={() => onSet({ pdfFit: 'width' })}>Width</Opt>
                    <Opt on={s.pdfFit === 'page'} onClick={() => onSet({ pdfFit: 'page' })}>Whole page</Opt>
                </Row>
                )}

                {/* Only in Pages, for the same reason the reflowable sheet
                    hides it in scrolled flow: there is no turn to style. */}
                {pages && (
                    <Row label="Turn" note={PDF_TURN[s.turn] ?? ''}>
                        {TURNS.map(t => (
                            <Opt key={t.id} on={s.turn === t.id} onClick={() => onSet({ turn: t.id })}>
                                {t.label}
                            </Opt>
                        ))}
                    </Row>
                )}

                <Row label="Spread" note={s.pdfSpread === 'single'
                    ? 'One sheet at a time.'
                    : spreadOk
                        ? 'Two sheets side by side — the cover alone, then facing pages, as the book was bound.'
                        : 'Two sheets side by side. This screen is too narrow for it, so you are reading one at a time until you open the book somewhere wider.'}>
                    <Opt on={s.pdfSpread === 'single'} onClick={() => onSet({ pdfSpread: 'single' })}>One</Opt>
                    <Opt on={s.pdfSpread === 'double'} onClick={() => onSet({ pdfSpread: 'double' })}>Two</Opt>
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

                <Row label="Paper" note={s.pdfOriginal
                    ? 'Exactly as it was made — no wash over the paper. The stock still colours the surround, which was never part of the file.'
                    : 'The stock washes over the sheet, by as much as the tint below allows.'}>
                    <Opt on={!s.pdfOriginal} onClick={() => onSet({ pdfOriginal: false })}>Stocked</Opt>
                    <Opt on={s.pdfOriginal} onClick={() => onSet({ pdfOriginal: true })}>Original</Opt>
                </Row>

                <Slider
                    label="Page tint" value={s.pdfVeil} min={0} max={1} step={0.05}
                    fmt={v => (v < 0.005 ? 'None' : `${Math.round(v * 100)}%`)}
                    disabled={noTint}
                    note={s.pdfOriginal
                        ? 'Original leaves the sheet alone, so there is no tint to set. Choose Stocked above to bring it back.'
                        : noTint
                        ? 'Press has no tint to give — the page is already the paper.'
                        : 'How much of the stock washes over the sheet. The stock sets the ceiling, and the ceiling is what keeps the print legible.'}
                    onLive={v => onLive({ pdfVeil: v })}
                    onCommit={v => onSet({ pdfVeil: v })}
                />
            </div>
        </section>
    )
}
