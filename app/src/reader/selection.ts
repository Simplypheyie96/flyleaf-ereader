/* ─────────────────────────────────────────────────────────────
   The owned selection.

   A phone puts its own menu on a selection — Copy, Look Up, Share — and
   nothing a web page can say hides it while the browser still holds the
   range. Not a CSS property, not an event to cancel: the callout is drawn
   by the OS from the fact that words are selected. So the way to have one
   menu on a sentence is the way Apple Books and Kindle have it — the
   browser owns the selection only while the finger is down, and when the
   finger lifts the app takes the range, paints the same words itself,
   and clears the browser's selection so there is nothing left for the OS
   to hang a menu on.

   This is that hand-over. It holds one Range, paints it through the CSS
   Custom Highlight API in the section's own document — the same wash the
   `::selection` rule uses, so nothing visibly changes at the moment of
   the hand-over — and moves either end of it when the reader drags one
   of the app's own handles. Where `CSS.highlights` is absent, `take`
   declines and the browser keeps its selection, which is exactly what
   this reader did before this file existed.

   Everything here is in the SECTION document's coordinates. The frame
   sits inside the stage, so the host converts by the frame's own box —
   see `anchorFor` in Reader.tsx — and this file never hears of the host.
   ───────────────────────────────────────────────────────────── */

/** The name every section stylesheet styles as `::highlight(...)`. */
export const HIGHLIGHT_NAME = 'flyleaf-selection'

/* What `Range` is in another realm: `instanceof` will not cross the iframe
   boundary, so nothing here compares against a constructor. These are the
   two hit-test shapes the platforms disagree on. */
type CaretPos = { offsetNode: Node; offset: number }
type HitDoc = Document & {
    caretPositionFromPoint?: (x: number, y: number) => CaretPos | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
}
type HLWindow = Window & {
    Highlight?: new (...ranges: Range[]) => unknown
    CSS?: typeof CSS & { highlights?: Map<string, unknown> }
}

/** One end of the selection: where its handle sits, in frame coordinates.
    `x` is the caret edge; `top`/`bottom` span the line it is on. */
export interface SelEnd { x: number; top: number; bottom: number }

/** A letter, a digit, or the two apostrophes a word can carry inside it.
    Unicode-aware, so a French or a Greek book snaps to its own words. */
const WORD = /[\p{L}\p{N}’']/u

export class OwnedSelection {
    #doc: Document | null = null
    #range: Range | null = null

    /** Is this document able to paint a highlight of its own? Read off the
        section's window, not the host's: the API has to exist in the realm
        that owns the text. */
    static supported(doc: Document): boolean {
        const w = doc.defaultView as HLWindow | null
        return Boolean(w?.Highlight && w.CSS?.highlights)
    }

    get range(): Range | null { return this.#range }
    get doc(): Document | null { return this.#doc }
    get active(): boolean { return this.#range !== null }

    /** Take a settled browser selection: paint it, and clear the browser's
        own so no platform menu can follow. Returns false — and touches
        nothing — where the document cannot paint, so the caller keeps the
        native path. */
    take(doc: Document, range: Range): boolean {
        if (!OwnedSelection.supported(doc)) return false
        this.drop()
        this.#doc = doc
        this.#range = range.cloneRange()
        this.#paint()
        doc.defaultView?.getSelection()?.removeAllRanges()
        return true
    }

    /** Forget the range and take its paint off the page. Safe to call
        with nothing held, and called that way often. */
    drop() {
        const w = this.#doc?.defaultView as HLWindow | null
        w?.CSS?.highlights?.delete(HIGHLIGHT_NAME)
        this.#doc = null
        this.#range = null
    }

    /** The flat text of what is held, the browser's own reading of it. */
    text(): string {
        return this.#range?.toString() ?? ''
    }

    /** Where each end is, for the handles. The start's line is read off a
        collapsed range at the start; the end's off one at the end — a
        multi-line selection has one rect per line and the ends are on the
        first and the last of them. */
    ends(): { start: SelEnd; end: SelEnd } | null {
        const r = this.#range
        const doc = this.#doc
        if (!r || !doc) return null
        const start = edgeOf(doc, r.startContainer, r.startOffset, r, 'start')
        const end = edgeOf(doc, r.endContainer, r.endOffset, r, 'end')
        if (!start || !end) return null
        return { start, end }
    }

    /** Move one end of the range to the word under (x, y), frame
        coordinates. The other end stays. Dragging one end past the other
        swaps them, the way a handle dragged through its partner does on
        every platform. Returns whether the range changed, so a caller can
        skip a repaint of anything that did not move. */
    moveEnd(which: 'start' | 'end', x: number, y: number): boolean {
        const r = this.#range
        const doc = this.#doc
        if (!r || !doc) return false
        const hit = caretAt(doc as HitDoc, x, y)
        if (!hit) return false
        /* The hit has to be in the book's text and in this document: a point
           on the margin resolves to the body itself, and a snap from there
           would select the chapter. */
        if (hit.node.nodeType !== 3 || hit.node.ownerDocument !== doc) return false
        const word = wordAround(hit.node as Text, hit.offset)

        const next = doc.createRange()
        if (which === 'start') {
            /* Fixed end, new start. If the new start falls after the fixed
               end, the reader has crossed over: the fixed end becomes the
               start and the word under the finger the end. */
            const after = compare(word.node, word.start, r.endContainer, r.endOffset) >= 0
            if (after) {
                next.setStart(r.endContainer, r.endOffset)
                next.setEnd(word.node, word.end)
                /* The fixed end was the end of a word; as a start it should
                   be the start of the word it belongs to. */
                snapStartToWord(next)
            } else {
                next.setStart(word.node, word.start)
                next.setEnd(r.endContainer, r.endOffset)
            }
        } else {
            const before = compare(word.node, word.end, r.startContainer, r.startOffset) <= 0
            if (before) {
                next.setStart(word.node, word.start)
                next.setEnd(r.startContainer, r.startOffset)
                snapEndToWord(next)
            } else {
                next.setStart(r.startContainer, r.startOffset)
                next.setEnd(word.node, word.end)
            }
        }
        if (next.collapsed) return false
        if (sameRange(next, r)) return false
        this.#range = next
        this.#paint()
        return true
    }

    #paint() {
        const doc = this.#doc
        const r = this.#range
        const w = doc?.defaultView as HLWindow | null
        if (!doc || !r || !w?.Highlight || !w.CSS?.highlights) return
        /* Constructed in the section's realm — a Highlight from the host
           window holding a Range from the frame is the cross-realm mistake
           this codebase has already paid for once. */
        w.CSS.highlights.set(HIGHLIGHT_NAME, new w.Highlight(r))
    }
}

/* ── geometry ─────────────────────────────────────────────────────────── */

function edgeOf(doc: Document, node: Node, offset: number, whole: Range, side: 'start' | 'end'): SelEnd | null {
    const probe = doc.createRange()
    probe.setStart(node, offset)
    probe.setEnd(node, offset)
    let rect: DOMRect | undefined = probe.getClientRects()[0]
    /* A collapsed range at an element boundary has no rect of its own; the
       whole selection's first or last line is the truthful fallback. */
    if (!rect || (!rect.width && !rect.height)) {
        const rects = Array.from(whole.getClientRects()).filter(q => q.width || q.height)
        rect = side === 'start' ? rects[0] : rects[rects.length - 1]
        if (!rect) return null
        return side === 'start'
            ? { x: rect.left, top: rect.top, bottom: rect.bottom }
            : { x: rect.right, top: rect.top, bottom: rect.bottom }
    }
    return { x: side === 'start' ? rect.left : rect.right, top: rect.top, bottom: rect.bottom }
}

function caretAt(doc: HitDoc, x: number, y: number): { node: Node; offset: number } | null {
    if (doc.caretPositionFromPoint) {
        const p = doc.caretPositionFromPoint(x, y)
        return p ? { node: p.offsetNode, offset: p.offset } : null
    }
    if (doc.caretRangeFromPoint) {
        const r = doc.caretRangeFromPoint(x, y)
        return r ? { node: r.startContainer, offset: r.startOffset } : null
    }
    return null
}

/* ── words ────────────────────────────────────────────────────────────── */

/** The word the offset is in or touching, as [start, end) offsets in the
    same text node. On whitespace, the nearest word to the right — a finger
    between two words is reaching for the next one — and failing that, the
    one to the left. A run of punctuation with no word beside it is itself. */
function wordAround(node: Text, offset: number): { node: Text; start: number; end: number } {
    const s = node.data
    const n = s.length
    let i = Math.min(Math.max(0, offset), n)
    const isWord = (k: number) => k >= 0 && k < n && WORD.test(s[k])
    if (!isWord(i) && !isWord(i - 1)) {
        /* Not on a word. Look right, then left. */
        let j = i
        while (j < n && !isWord(j)) j++
        if (j < n) i = j
        else {
            j = i - 1
            while (j >= 0 && !isWord(j)) j--
            if (j >= 0) i = j
            else return { node, start: Math.max(0, i - 1), end: Math.min(n, i + 1) }
        }
    }
    let a = isWord(i) ? i : i - 1
    let b = a
    while (a > 0 && isWord(a - 1)) a--
    while (b + 1 < n && isWord(b + 1)) b++
    return { node, start: a, end: b + 1 }
}

/** Grow a range's start back to the beginning of the word it is inside. */
function snapStartToWord(r: Range) {
    const n = r.startContainer
    if (n.nodeType !== 3) return
    const w = wordAround(n as Text, r.startOffset)
    if (w.start < r.startOffset && r.startOffset < w.end) r.setStart(n, w.start)
}

/** Grow a range's end forward to the end of the word it is inside. */
function snapEndToWord(r: Range) {
    const n = r.endContainer
    if (n.nodeType !== 3) return
    const w = wordAround(n as Text, r.endOffset)
    if (w.start < r.endOffset && r.endOffset < w.end) r.setEnd(n, w.end)
}

/* ── comparisons ──────────────────────────────────────────────────────── */

/** Document order of two boundary points: negative when a is first. */
function compare(an: Node, ao: number, bn: Node, bo: number): number {
    const r = an.ownerDocument!.createRange()
    r.setStart(bn, bo)
    r.setEnd(bn, bo)
    return r.comparePoint(an, ao)
}

function sameRange(a: Range, b: Range): boolean {
    return a.startContainer === b.startContainer && a.startOffset === b.startOffset
        && a.endContainer === b.endContainer && a.endOffset === b.endOffset
}
