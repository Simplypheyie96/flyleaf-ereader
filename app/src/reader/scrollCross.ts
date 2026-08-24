/* ─────────────────────────────────────────────────────────────
   Crossing a chapter in scrolled flow.

   foliate only ever leaves a section through next()/prev(): its own
   scroll handler calls #afterScroll, which relocates INSIDE the section
   and never crosses (paginator.js: 567-573, 1096-1139). In paginated
   flow that costs nothing, because every turn already goes through
   next(). In scrolled flow it means native scrolling stops dead at the
   bottom of every chapter and the only way on is the arrow keys, which
   a phone does not have.

   So the end of a section is not a wall: keep pushing and it crosses.
   ARRIVING at the end is not the trigger — a reader who scrolls to the
   last paragraph and stops is reading it, not asking for what comes
   next — the trigger is a deliberate continued pull past it, which is
   the same gesture they were already making. Symmetric backwards.

   This lives outside the vendored tree on purpose. Everything it needs
   is public API — `scrolled`, `start`, `end`, `viewSize`, `sections`,
   `next`, `prev` — so foliate stays upstream source with nothing to
   re-apply on an update.
   ───────────────────────────────────────────────────────────── */

/* FoliateRenderer is ambient — vendor/foliate-js.d.ts declares it globally. */

/** Continued pull past the end, by finger. Enough that the rubber-band at
    the bottom of a section cannot spend it on its own, short enough that it
    reads as "keep scrolling" rather than as a second, separate gesture. */
const TOUCH_PX = 72
/** The same by wheel. Higher because one trackpad flick is worth far more
    pixels than one thumb-length of screen. */
const WHEEL_PX = 140
/** A pause at the end spends the pull. Resting at the last paragraph and
    then scrolling again is a fresh intent, not a continuation of the one
    that brought you there. */
const IDLE_MS = 500
/** After a crossing, ignore what is left of the gesture that caused it —
    otherwise one long swipe walks through two chapters. */
const COOLDOWN_MS = 700

export interface ScrollCrossHooks {
    renderer(): FoliateRenderer | null
    /** The section the reader is in, from the last relocate. */
    index(): number
}

export class ScrollCross {
    #hooks: ScrollCrossHooks
    #docs = new Set<Document>()

    /** Signed: forward is positive. One accumulator, because a pull that
        changes its mind mid-gesture should cancel itself out rather than
        bank both directions. */
    #pull = 0
    #lastY = 0
    #at = 0
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
        doc.addEventListener('touchend', this.#end, { passive: true })
    }

    detach(doc: Document) {
        if (!this.#docs.delete(doc)) return
        doc.removeEventListener('wheel', this.#wheel)
        doc.removeEventListener('touchstart', this.#start)
        doc.removeEventListener('touchmove', this.#move)
        doc.removeEventListener('touchend', this.#end)
    }

    destroy() {
        for (const doc of [...this.#docs]) this.detach(doc)
        this.#pull = 0
    }

    /* ── where the section ends ───────────────────────────────────────── */

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

    /* ── the gesture ──────────────────────────────────────────────────── */

    #push(delta: number, threshold: number) {
        const r = this.#hooks.renderer()
        if (!r?.scrolled) return
        const now = Date.now()
        if (now < this.#until) return
        /* A gap resets. So does arriving from the middle of the section:
           the pull only counts once there is nothing left to scroll. */
        if (now - this.#at > IDLE_MS) this.#pull = 0
        this.#at = now

        const edge = this.#edge(r)
        if (edge === 0 || Math.sign(delta) !== edge) { this.#pull = 0; return }
        this.#pull += delta
        if (Math.abs(this.#pull) < threshold) return

        const dir = edge
        /* Guarded here rather than left to upstream: in scrolled flow
           #scrollNext reports "go on" at the end of every section including
           the last, and #turnPage then calls #goTo with an undefined index
           — past the guard that goTo() applies and #turnPage does not. */
        if (this.#adjacent(r, dir) === null) { this.#pull = 0; return }
        this.#pull = 0
        this.#until = now + COOLDOWN_MS
        void (dir === 1 ? r.next() : r.prev())
    }

    #wheel = (e: Event) => {
        const w = e as WheelEvent
        if (!w.deltaY) return
        this.#push(w.deltaY, WHEEL_PX)
    }

    #start = (e: Event) => {
        const t = (e as TouchEvent).touches[0]
        if (!t) return
        this.#lastY = t.clientY
        this.#pull = 0
    }

    #move = (e: Event) => {
        const t = (e as TouchEvent).touches[0]
        if (!t) return
        /* Finger up moves the content forward, so forward is a DECREASING
           clientY — the same sign convention as wheel deltaY. */
        const dy = this.#lastY - t.clientY
        this.#lastY = t.clientY
        this.#push(dy, TOUCH_PX)
    }

    #end = () => { this.#pull = 0 }
}
