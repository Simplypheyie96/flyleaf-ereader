/* ─────────────────────────────────────────────────────────────
   Marks → PDF.

   The owner's ask: "for marks, let's have pdf as an export option." The other
   three formats are strings; this one is a file, so it lives in its own module
   and returns bytes.

   Why a hand-written PDF and not a library: the guardrail is that nothing in
   this app may need a network to work, and a PDF writer is the one dependency
   that would have to be added for a single button. A base-14 PDF — no embedded
   font program — is about 200 lines and a few KB on disk, and every PDF reader
   ever shipped already has these six faces. pdfjs-dist is here for the PDF
   READER; it cannot write, but its metrics table is Adobe's own, so the widths
   this file breaks lines with come out of it at build time
   (scripts/make-pdf-widths.mjs → pdfWidths.ts). Nothing here is measured by eye.

   What base-14 costs: WinAnsi (cp1252) only, so Latin alphabets and no more.
   `unmappable()` counts what a given set of marks would lose BEFORE the reader
   presses the button, and the export sheet says so — a silent row of question
   marks in a Greek quotation would be the worst possible outcome.

   The page is Flyleaf's, printed: light-mode ink on paper, one measure of about
   68 characters, the serif for the words and the sans for the labels, and each
   quote carried by a 2px bar in its own highlighter tint — which is the one
   thing the Markdown and text exports cannot say.
   ───────────────────────────────────────────────────────────── */

import type { Annotation, Bookmark, HighlightColor } from '../types'
import { groupByChapter } from './marks'
import type { ExportInput } from './marks'
import {
    W_TIMES_ROMAN, W_TIMES_BOLD, W_TIMES_ITALIC, W_HELVETICA, W_HELVETICA_BOLD,
} from './pdfWidths'

/* ── the page ─────────────────────────────────────────────────────────────
   A4, because that is the sheet this app's readers print on. The measure is
   403pt, which is 68 characters at 11pt Times — inside better-typography's
   60–75 band, and the reason the side margins are 96 and not 64. */
const PW = 595.276, PH = 841.89
const ML = 96, MR = 96, MT = 76, MB = 72
const MEASURE = PW - ML - MR

/* Light-mode chrome, which on paper is simply the truth: --ink on --paper.
   The stocks are a screen thing; a printed page has no dark mode. */
const INK = '#1B1917', SOFT = '#6B655C', RULE = '#E0DBD1'
/* The app's five tints, restated for paper.

   On screen a tint is a WASH sitting behind text, so it is pale by design —
   #D6C19F butter clears its floor at 1.72:1 against white and no more. As a
   2pt bar on a printed sheet that is nearly nothing, and a bar nobody can see
   is worse than none, because the bar is the one thing this export can say
   that Markdown and plain text cannot: which highlighter the reader reached
   for. (The figure used to be 1.18:1, when the screen tints were still Press's
   card grounds. Deepening those did not close the gap — a wash on a lit panel
   and a 2pt bar on paper are far enough apart that the two sets still want
   their own lightness. What they share is the hue, held to within half a
   degree, so the paper set reads as the same four colours.)

   So each bar keeps its tint's OKLCH HUE and is given a printable lightness and
   chroma. Two pairs share a hue on screen — mustard/butter at 80° and
   blue/underline at 247° — and those are separated by chroma and lightness
   instead, in the same order they read in on screen. Measured against a white
   sheet, all five clear the 3:1 that WCAG 1.4.11 asks of a non-text graphic:

     mustard   #9F7101  4.34:1   L .58 C .120 H  80°   strong ochre
     pink      #B76D7C  3.82:1   L .62 C .095 H   7°
     blue      #6790B8  3.36:1   L .64 C .075 H 248°
     butter    #A18C69  3.25:1   L .65 C .055 H  80°   low chroma, not mustard
     underline #035991  7.39:1   L .45 C .115 H 246°   the darkest, as on screen

   `underline` is not a wash on screen either, so on paper it is not a bar: it
   is a rule under the words, which is what the reader actually saw. */
const TINT: Record<HighlightColor, string> = {
    mustard: '#9F7101', pink: '#B76D7C', blue: '#6790B8',
    butter: '#A18C69', underline: '#035991',
}

type FontId = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6'
const WIDTHS: Record<FontId, readonly number[]> = {
    F1: W_TIMES_ROMAN, F2: W_TIMES_BOLD, F3: W_TIMES_ITALIC,
    F4: W_HELVETICA, F5: W_HELVETICA_BOLD,
    /* Courier is monospaced at 600 for every glyph, so it needs no table. */
    F6: Array.from({ length: 256 }, () => 600),
}
const FONT_NAME: Record<FontId, string> = {
    F1: 'Times-Roman', F2: 'Times-Bold', F3: 'Times-Italic',
    F4: 'Helvetica', F5: 'Helvetica-Bold', F6: 'Courier',
}

/* ── encoding ─────────────────────────────────────────────────────────────
   cp1252 is Latin-1 plus a 27-character window at 0x80–0x9F, which is where
   the punctuation a book actually uses lives: the curly quotes, both dashes and
   the ellipsis. They are spelled out rather than computed because that window
   is the one part of the encoding that is NOT its Unicode code point. */
const C1: Record<string, number> = {
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84,
    '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
    '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C,
    'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93,
    '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
    '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B,
    'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
}
/* A handful of characters that are not IN cp1252 but have an unambiguous
   printed equivalent in it. Better a real dash than a question mark. */
const FOLD: Record<string, string> = {
    '‐': '-', '‑': '-', '‒': '-', '―': '—',
    '⁄': '/', '−': '-', ' ': ' ', ' ': ' ',
    ' ': ' ', ' ': ' ', ' ': ' ', '​': '',
    'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi',
    'ﬄ': 'ffl', '″': '"', '′': "'",
}

/** cp1252 codes for a string. Anything the encoding has no glyph for becomes
    0x3F ('?'), which is what `unmappable` counts. */
export function toWinAnsi(s: string): number[] {
    const out: number[] = []
    for (const ch of s) {
        const folded = FOLD[ch] ?? ch
        for (const c of folded) {
            const cp = c.codePointAt(0)!
            if (cp === 0x0a || cp === 0x0d) { out.push(0x20); continue }
            if (cp >= 0x20 && cp <= 0x7e) { out.push(cp); continue }
            const c1 = C1[c]
            if (c1 != null) { out.push(c1); continue }
            if (cp >= 0xa0 && cp <= 0xff) { out.push(cp); continue }
            out.push(0x3f)
        }
    }
    return out
}

/** How many characters in these marks this PDF's fonts cannot print. Called
    by the export sheet before the reader commits to the format. */
export function unmappable(input: ExportInput): number {
    let n = 0
    const scan = (s: string | null | undefined) => {
        if (!s) return
        for (const ch of s) {
            const folded = FOLD[ch] ?? ch
            for (const c of folded) {
                const cp = c.codePointAt(0)!
                const ok = (cp >= 0x20 && cp <= 0x7e) || C1[c] != null || (cp >= 0xa0 && cp <= 0xff)
                    || cp === 0x0a || cp === 0x0d
                if (!ok && c !== '?') n++
            }
        }
    }
    scan(input.title); scan(input.author)
    for (const h of input.highlights) { scan(h.text); scan(h.note); scan(h.chapter) }
    for (const b of input.bookmarks) { scan(b.excerpt); scan(b.chapter) }
    return n
}

/* ── measuring and breaking ─────────────────────────────────────────────── */

function advance(codes: number[], font: FontId, size: number, tc: number): number {
    const w = WIDTHS[font]
    let sum = 0
    for (const c of codes) sum += (w[c] || w[0x3f]) * size / 1000 + tc
    return sum
}

/** Greedy word wrap on the cp1252 codes, so the break is measured in the same
    units the page is drawn in. A single word longer than the measure is broken
    by character rather than allowed to run off the sheet. */
function wrap(codes: number[], font: FontId, size: number, tc: number, width: number): number[][] {
    const lines: number[][] = []
    let line: number[] = []
    let i = 0
    while (i < codes.length) {
        let j = i
        while (j < codes.length && codes[j] !== 0x20) j++
        const word = codes.slice(i, j)
        const candidate = line.length ? [...line, 0x20, ...word] : word
        if (advance(candidate, font, size, tc) <= width) line = candidate
        else if (!line.length) {
            /* one unbreakable word wider than the measure */
            let part: number[] = []
            for (const c of word) {
                if (advance([...part, c], font, size, tc) > width && part.length) {
                    lines.push(part); part = [c]
                } else part.push(c)
            }
            line = part
        } else { lines.push(line); line = word }
        i = j + 1
    }
    if (line.length) lines.push(line)
    return lines.length ? lines : [[]]
}

/* ── the writer ───────────────────────────────────────────────────────────
   One content stream per page, built as text, then serialised with a real
   cross-reference table. No compression: a marks file is kilobytes, and an
   uncompressed stream is one less thing that can be wrong. */

function rgb(hex: string): string {
    const h = hex.replace('#', '')
    const n = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    return n.map(v => v.toFixed(3)).join(' ')
}

/** A PDF literal string: only \ ( ) and non-printables need escaping. */
function lit(codes: number[]): string {
    let s = '('
    for (const c of codes) {
        if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c)
        else if (c < 0x20 || c > 0x7e) s += '\\' + c.toString(8).padStart(3, '0')
        else s += String.fromCharCode(c)
    }
    return s + ')'
}

class Doc {
    private pages: string[] = []
    private ops: string[] = []
    /** Baseline of the next line, from the bottom of the sheet. */
    private y = PH - MT

    private page() {
        if (!this.ops.length) return
        /* The folio, in the mono face — the same role IBM Plex Mono has on
           screen. Centred, because a marks sheet has no spine to bias it. */
        const n = this.pages.length + 1
        const codes = toWinAnsi(String(n))
        const w = advance(codes, 'F6', 8, 0)
        this.ops.push(
            `BT /F6 8 Tf ${rgb(SOFT)} rg 0 Tc 1 0 0 1 ${((PW - w) / 2).toFixed(2)} ${(MB - 26).toFixed(2)} Tm ${lit(codes)} Tj ET`,
        )
        this.pages.push(this.ops.join('\n'))
        this.ops = []
        this.y = PH - MT
    }

    /** Reserve vertical room; starts a new page if the block will not fit. */
    private room(h: number) {
        if (this.y - h < MB) this.page()
    }

    gap(h: number) { if (this.ops.length) this.y -= h }

    /** Break now if `h` will not fit. Used to keep a chapter label with the
        first lines of the quote under it — a heading alone at the foot of a
        page is the classic printed-page mistake. */
    keep(h: number) { if (this.ops.length && this.y - h < MB) this.page() }

    rule(indent = 0, colour = RULE) {
        this.room(1)
        const x = ML + indent
        this.ops.push(`${rgb(colour)} RG 0.6 w ${x.toFixed(2)} ${this.y.toFixed(2)} m ${(PW - MR).toFixed(2)} ${this.y.toFixed(2)} l S`)
        this.y -= 1
    }

    /** One wrapped paragraph. `bar` draws a 2pt rule down its leading edge in
        the given colour, which is how a highlight carries its tint into print. */
    para(
        s: string,
        opts: {
            font: FontId; size: number; leading: number; colour?: string
            indent?: number; tc?: number; upper?: boolean; bar?: string
            /** draw a rule under each line, in this colour */
            under?: string
        },
    ) {
        const { font, size, leading, colour = INK, indent = 0, tc = 0 } = opts
        const codes = toWinAnsi(opts.upper ? s.toUpperCase() : s)
        const x = ML + indent
        const lines = wrap(codes, font, size, tc, MEASURE - indent)
        /* No orphans: a paragraph does not start on a page it can only put one
           line on. Two lines is the printer's usual minimum, and a one-line
           paragraph is exempt because it has nothing to be separated from. */
        if (lines.length > 1 && this.y - leading * 2 < MB) this.page()
        for (let i = 0; i < lines.length; i++) {
            this.room(leading)
            /* A bar is drawn per line so it survives a page break with the
               lines it belongs to, rather than being one tall rect that would
               be orphaned by one. */
            if (opts.bar) {
                this.ops.push(
                    `${rgb(opts.bar)} rg ${(ML).toFixed(2)} ${(this.y - size * 0.22).toFixed(2)} 2 ${leading.toFixed(2)} re f`,
                )
            }
            if (opts.under) {
                /* Under the baseline by a fifth of the size, which clears the
                   descenders of a Times g and y at every size used here. */
                const w = advance(lines[i], font, size, tc)
                const uy = this.y - size * 0.2
                this.ops.push(
                    `${rgb(opts.under)} RG 0.7 w ${x.toFixed(2)} ${uy.toFixed(2)} m ${(x + w).toFixed(2)} ${uy.toFixed(2)} l S`,
                )
            }
            this.ops.push(
                /* Tc is written on EVERY run, never conditionally: character
                   spacing is text STATE, and it survives ET. Emitting it only
                   when non-zero leaked a label's tracking into the body text
                   that followed it — measured, once, and this is the fix. */
                `BT /${font} ${size} Tf ${rgb(colour)} rg ${tc} Tc 1 0 0 1 ${x.toFixed(2)} ${this.y.toFixed(2)} Tm ${lit(lines[i])} Tj ET`,
            )
            this.y -= leading
        }
    }

    bytes(): Uint8Array {
        this.page()
        const n = this.pages.length || 1
        if (!this.pages.length) this.pages.push('')

        /* Object numbering: 1 catalog, 2 pages, then per page a page object and
           a content stream, then the six fonts. */
        const objs: string[] = []
        const pageIds: number[] = []
        const first = 3
        for (let i = 0; i < n; i++) pageIds.push(first + i * 2)
        const fontFirst = first + n * 2
        const fontRefs = (Object.keys(FONT_NAME) as FontId[])
            .map((f, i) => `/${f} ${fontFirst + i} 0 R`).join(' ')

        objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
        objs[2] = `<< /Type /Pages /Count ${n} /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] >>`
        this.pages.forEach((content, i) => {
            const id = pageIds[i]
            objs[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] `
                + `/Resources << /Font << ${fontRefs} >> >> /Contents ${id + 1} 0 R >>`
            objs[id + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
        })
        ;(Object.keys(FONT_NAME) as FontId[]).forEach((f, i) => {
            objs[fontFirst + i] = `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAME[f]} `
                + `/Encoding /WinAnsiEncoding >>`
        })

        let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
        const offsets: number[] = []
        for (let i = 1; i < objs.length; i++) {
            offsets[i] = out.length
            out += `${i} 0 obj\n${objs[i]}\nendobj\n`
        }
        const xref = out.length
        out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
        for (let i = 1; i < objs.length; i++)
            out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
        out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

        const bytes = new Uint8Array(out.length)
        for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff
        return bytes
    }
}

/* ── the document ─────────────────────────────────────────────────────────
   The same shape as the Markdown export, so the two are recognisably one
   export in two forms: title and author, then the marks grouped by chapter in
   reading order, then the bookmarks. SPEC.md § 6.3 — no page numbers on the
   marks themselves, because a reflowable book has none. */

export function exportPdf(input: ExportInput): Uint8Array {
    const { title, author, highlights, bookmarks } = input
    const d = new Doc()

    d.para(title, { font: 'F2', size: 20, leading: 25 })
    if (author) { d.gap(6); d.para(author, { font: 'F3', size: 11.5, leading: 15, colour: SOFT }) }
    d.gap(16)
    d.rule()
    d.gap(13)
    const count = highlights.length + bookmarks.length
    d.para(`${count} ${count === 1 ? 'mark' : 'marks'} · Flyleaf eReader`, {
        font: 'F4', size: 8, leading: 11, colour: SOFT, tc: 1.1, upper: true,
    })
    d.gap(26)

    for (const g of groupByChapter(highlights)) {
        if (g.chapter) {
            d.gap(6)
            /* label + its gap + two lines of the quote beneath it */
            d.keep(12 + 12 + 15.5 * 2)
            d.para(g.chapter, {
                font: 'F5', size: 8.5, leading: 12, colour: SOFT, tc: 1.1, upper: true,
            })
            d.gap(12)
        }
        for (const h of g.items) {
            const tint = TINT[h.color] ?? INK
            d.para(h.text, {
                font: 'F1', size: 11, leading: 15.5, indent: 18,
                ...(h.color === 'underline' ? { under: tint } : { bar: tint }),
            })
            if (h.note) {
                d.gap(5)
                d.para(`— ${h.note}`, {
                    font: 'F3', size: 10, leading: 14, indent: 18, colour: SOFT,
                })
            }
            d.gap(15)
        }
    }

    if (bookmarks.length) {
        d.gap(8)
        d.rule()
        d.gap(15)
        d.para('Bookmarks', {
            font: 'F5', size: 8.5, leading: 12, colour: SOFT, tc: 1.1, upper: true,
        })
        d.gap(13)
        for (const b of bookmarks) {
            const chapter = b.chapter ? ` — ${b.chapter}` : ''
            d.para(`${b.excerpt || 'A place in the book'}${chapter}`, {
                font: 'F1', size: 10.5, leading: 15, indent: 18,
            })
            d.gap(9)
        }
    }

    return d.bytes()
}

/* Kept beside the exporter rather than in marks.ts so the type imports there
   do not have to know about PDFs. */
export type { Annotation, Bookmark }
