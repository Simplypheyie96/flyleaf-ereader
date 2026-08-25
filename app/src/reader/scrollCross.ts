/* ─────────────────────────────────────────────────────────────
   Crossing a chapter in scrolled flow.

   foliate only ever leaves a section through next()/prev(): its own
   scroll handler relocates INSIDE the section and never crosses
   (paginator.js: 567-573, 1096-1139). In paginated flow that costs
   nothing, because every turn already goes through next(). In scrolled
   flow it means native scrolling stops dead at the bottom of every
   chapter and the only way on is the arrow keys, which a phone does
   not have.

   Every other reader scrolls one chapter into the next with nothing in
   between, so that is the target: when the column runs out and the
   scroll is still going, cross. No threshold to overcome, no pause to
   wait out, no second gesture — the boundary should not be somewhere
   the reader has to push through, it should be somewhere they do not
   notice.

   A first pass gated this behind 72px of extra pull and a 500ms idle
   reset, on the theory that resting at the last paragraph should not
   carry you onward. In the hand it read as the book jamming at every
   chapter, which is worse than the thing it was guarding against —
   resting does nothing here either way, because resting produces no
   scroll events at all.

   This lives outside the vendored tree on purpose. Everything it needs
   is public API — `scrolled`, `start`, `end`, `viewSize`, `sections`,
   `next`, `prev` — so foliate stays upstream source with nothing to
   re-apply on an update.
   ───────────────────────────────────────────────────────────── */

/* FoliateRenderer is ambient — vendor/foliate-js.d.ts declares it globally. */

/** After a crossing, ignore the rest of the gesture that caused it. A flick
    carries momentum for a good while after the finger is gone, and without
    this one flick walks through three chapters. Long enough to outlast the
    load and the settle, short enough that a reader who wants two chapters
    can have them. */
const COOLDOWN_MS = 450

export interface ScrollCrossHooks {
    renderer(): FoliateRenderer | null
    /** The section the reader is in, from the last section load. */
    index(): number
}

export class ScrollCross {
    #hooks: ScrollCrossHooks
    #docs = new Set<Document>()
    #lastY = 0
    #until = 0

    constructor(hooks: ScrollCrossHooks) {
        this.#hooks = hooks
    }

    /** The host document for the margins, and every section as it loads: a
        touch that starts on a word happens inside the iframe and the host
        never sees it. Same reason the turn attaches per-document. */
    attach(doc: Document) {
        if (this.#docs.has(doc)) return
        this.#docs.add(doc)
        doc.addEventListener('wheel', this.#wheel, { passive: true })
        doc.addEventListener('touchstart', this.#start, { passive: true })
        doc.addEventListener('touchmove', this.#move, { passive: true })
    }

    detach(doc: Document) {
        if (!this.#docs.delete(doc)) return
        doc.removeEventListener('wheel', this.#wheel)
        doc.removeEventListener('touchstart', this.#start)
        doc.removeEventListener('touchmove', this.#move)
    }

    destroy() {
        for (const doc of [...this.#docs]) this.detach(doc)
    }

    /** Upstream's own test for "there is nothing left to scroll", to the
        pixel: #scrollNext gives up at `viewSize - end > 2` (paginator.js:
        1110). Matching it exactly means this fires precisely where native
        scrolling stops, with no dead band in between and no overlap. */
    #edge(r: FoliateRenderer): 0 | 1 | -1 {
        if (r.viewSize - r.end <= 2) return 1
        if (r.start <= 0) return -1
        return 0
    }

    /** The next section that is actually in the reading order, mirroring
        upstream's #adjacentIndex. A non-linear section — notes, a colophon
        the spine carries but does not read — is skipped, not landed on. */
    #adjacent(r: FoliateRenderer, dir: 1 | -1): number | null {
        const secs = r.sections ?? []
        for (let i = this.#hooks.index() + dir; i >= 0 && i < secs.length; i += dir)
            if (secs[i]?.linear !== 'no') return i
        return null
    }

    /** One scroll event, in the direction the column has run out in, is the
        whole trigger. */
    #push(delta: number) {
        const r = this.#hooks.renderer()
        if (!r?.scrolled || !delta) return
        const now = Date.now()
        if (now < this.#until) return

        const edge = this.#edge(r)
        if (edge === 0 || Math.sign(delta) !== edge) return
        /* Guarded here rather than left to upstream: in scrolled flow
           #scrollNext reports "go on" at the end of every section including
           the last, and #turnPage then calls #goTo with an undefined index
           — past the guard that goTo() applies and #turnPage does not. */
        if (this.#adjacent(r, edge) === null) return
        this.#until = now + COOLDOWN_MS
        void (edge === 1 ? r.next() : r.prev())
    }

    #wheel = (e: Event) => this.#push((e as WheelEvent).deltaY)

    #start = (e: Event) => {
        const t = (e as TouchEvent).touches[0]
        if (t) this.#lastY = t.clientY
    }

    #move = (e: Event) => {
        const t = (e as TouchEvent).touches[0]
        if (!t) return
        /* Finger up moves the content forward, so forward is a DECREASING
           clientY — the same sign convention as wheel deltaY. */
        const dy = this.#lastY - t.clientY
        this.#lastY = t.clientY
        this.#push(dy)
    }
}
