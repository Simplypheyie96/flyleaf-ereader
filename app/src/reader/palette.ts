/* ─────────────────────────────────────────────────────────────
   The stock, read rather than restated.

   The reading text lives in an iframe, which is a separate document:
   it does not inherit --stock-ink or anything else from index.css.
   The only way in is renderer.setStyles(), which takes a string.

   So the stock's four values have to exist in TypeScript. The obvious
   way is a table here — and that is the wrong way, because index.css
   already has one, and two tables of the same seven colours drift the
   first time someone tunes a value in the file that looks like the
   authority.

   Instead this reads them back off the mounted reader root with
   getComputedStyle. index.css stays the single source; a stock added
   there needs nothing here. It is a layout read, so it happens once
   per settings change — never inside a turn.
   ───────────────────────────────────────────────────────────── */

export interface Palette {
    /** --stock-bg — the paper. */
    ground: string
    /** --stock-ink — body text. */
    ink: string
    /** --stock-soft — secondary: footnote markers, the readout. */
    soft: string
    /** --stock-rule — hairlines, and the outgoing page's leading edge. */
    rule: string
    /** --hl-fill-mustard — the default highlighter, used here for ::selection.
        The FILL and not the solid, because a selection is a wash over words
        and that is the variable that already knows what a wash means on this
        stock: the solid pastel on a light page, the measured low-alpha one on
        a dark page. */
    select: string
}

/* Day's values, used only if a read comes back empty — which happens if
   this is called before the stylesheet has applied. Not a second copy of
   the table: one stock, as a floor, so a failed read renders readable
   text rather than a blank page. */
const FALLBACK: Palette = {
    ground: '#F4F2ED',
    ink: '#1B1917',
    soft: '#6B655C',
    rule: '#E0DBD1',
    select: '#DCA94C',
}

export function readPalette(el: Element | null): Palette {
    if (!el) return FALLBACK
    const cs = getComputedStyle(el)
    const read = (name: string, fallback: string) =>
        cs.getPropertyValue(name).trim() || fallback
    return {
        ground: read('--stock-bg', FALLBACK.ground),
        ink: read('--stock-ink', FALLBACK.ink),
        soft: read('--stock-soft', FALLBACK.soft),
        rule: read('--stock-rule', FALLBACK.rule),
        select: read('--hl-fill-mustard', FALLBACK.select),
    }
}

/** True for the three stocks whose ground is darker than their ink. Used for
    the things that flip on a dark page — image matting, selection alpha —
    and derived from the values rather than a list of stock ids, so a stock
    added to index.css is classified correctly without being named twice. */
export function isDarkStock(p: Palette): boolean {
    return luminance(p.ground) < luminance(p.ink)
}

function luminance(hex: string): number {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)
    if (!m) return 1
    const n = parseInt(m[1], 16)
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
