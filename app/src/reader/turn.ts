/* ─────────────────────────────────────────────────────────────
   The page turn.

   This replaces foliate's own touch handling wholesale — see
   vendor/foliate-js/PATCHES.md § 4b for why, and for the `no-touch`
   attribute that switches upstream's off.

   The one rule everything here serves: while the finger is down, the
   only thing that changes is a `transform` on one element. No layout
   read, no style write that invalidates layout, no work on the main
   thread that the compositor could not have done alone. A turn that
   measures anything mid-drag is broken whether or not it looks broken
   on the machine it was written on.

   The physics is Apple's, not invented here:
     · 1:1 tracking from the point the gesture was claimed, never from
       the element's centre
     · velocity read from a short position history, not from the last
       two events
     · the resting point PROJECTED from release velocity — an exponential
       decay, not v²/2a — and the commit decided from the projection
     · progressive resistance at a boundary rather than a hard stop
     · interruptible at any instant: a new touch during the commit reads
       the live on-screen offset and carries on from there

   Durations and thresholds are DESIGN.md → Motion and SPEC.md § 5.3.
   ───────────────────────────────────────────────────────────── */

import type { Turn } from '../types'
/* FoliateRenderer is ambient — vendor/foliate-js.d.ts declares it globally
   alongside the wildcard module declarations, so there is nothing to import. */

/* ── the numbers, all of them, in one place ───────────────────────────── */

/** Horizontal travel that claims the gesture. No time limit on it: an
    earlier build only claimed inside a 200ms window, so a slow deliberate
    drag — the one a reader makes when they mean to look at the next page
    rather than flick past it — travelled its 8px, missed the window, and the
    page stayed put. That is what "the slide is resisting" was. A horizontal
    drag on a paginated book is a turn however long the reader takes over it. */
const CLAIM_PX = 8
/** The same by mouse. Higher, because a pointing device is precise enough
    that a short drag from a word is far more likely to be the start of a
    selection than a page turn. Past this, with nothing selected, it is a
    turn — see #move. */
const CLAIM_MOUSE_PX = 24
/** Vertical travel that gives the gesture away to something else. */
const YIELD_PX = 12

/** Beyond the first and last page of the book there is nothing, so the page
    follows the finger at a decreasing rate and springs back. Apple's
    rubber-band constant. */
const BAND = 0.55
/** iOS scroll deceleration. Used only to project a resting point. */
const DECEL = 0.998

/* How far the projected reach has to carry before a drag counts as a turn,
   as a fraction of the page. Half a page — 176px on a 375px phone — was the
   first pass, and it is what the owner felt as "a lot of resistance for some
   pages": a deliberate 120px drag over 700ms projects to 103px and springs
   back, having looked for all the world like a page turn. Just over a
   quarter is a clearly intentional drag and still nowhere near a graze. */
const COMMIT = 0.28

/* A flick commits on its own, whatever it travelled, as long as it is still
   moving the way the drag was going. This is the other half of the same
   complaint — "and sometimes it isn't there" is the same threshold being met
   by momentum on a fast gesture and missed on a slow one. px/ms. */
const FLICK = 0.25

const COMMIT_MIN = 260
const COMMIT_MAX = 420
/** A turn a key or a tap asked for has no velocity to read. */
const FLAT = 300
const SPRING_BACK = 220
const FADE = 120
const REDUCED = 150
/** A section crossing slides like any other turn; only the arriving section
    fades, because it is not laid out until the slide is over. Measured: the
    load itself costs 34-37ms of the 137ms a crossing takes, the rest being
    the paginator's own fixed wait — so this covers about two frames of real
    work, not a stall. */
const CROSS_IN = 140

const EASE_TURN = 'cubic-bezier(.16,1,.3,1)'

/* ── the fold, and why there is not one ───────────────────────────────────
   A fourth style, Curl, was built here and then cut.

   It was a real fold rather than a page warp: the sheet hinged at the crease,
   its back face a second warm render of the section the reader was in,
   reflected about that crease and clipped to exactly the band the wedge
   covered. That back face lived in reader/foldMirror.ts, now deleted.

   It measured green on the gate it was given — Layout 0, Paint 0 and a 1.4ms
   longest main-thread task over ten tracked frames at 4x CPU throttle — and it
   was cut anyway, on the owner's judgement of how it FELT beside the fold in
   Apple Books. Recorded here and in SPEC.md § 5.2 so that nobody rebuilds it
   believing the missing piece was performance. Three styles remain: Slide,
   Fade and Instant. */

/** Apple's projection function, from the Designing Fluid Interfaces sample
    code. NOT the textbook v²/(2a): the difference is visible, and this is
    the one that matches every native scroll on the platform.
    @param v px/ms, signed. @returns signed px. */
function project(v: number): number {
    return v * DECEL / (1 - DECEL)
}

/** Follows the finger less and less the further past the edge it goes. */
function band(overshoot: number, dim: number): number {
    return (overshoot * dim * BAND) / (dim + BAND * Math.abs(overshoot))
}

const clamp = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v))

/* ── what the controller needs from the page ──────────────────────────── */

export interface TurnConfig {
    /** live, because every one of these can change under a running gesture. */
    turn: Turn
    /** right-to-left book: swipe and tap zones both mirror. */
    rtl: boolean
    /** left and right thirds turn; off makes the whole pane a chrome toggle. */
    tapToTurn: boolean
    /** paginated only. In scrolled flow there is no turn to track. */
    paginated: boolean
    reducedMotion: boolean
}

export interface TurnHooks {
    renderer(): FoliateRenderer | null
    /** the element the fade rides — the stage, not the shadow-root content,
        so it is reachable at all. */
    stage(): HTMLElement | null
    /** the 1px rule drawn on the outgoing page's leading edge. Its own
        element, and its own transform on the same clock as the content's:
        animating a custom property would work only where that property has
        been registered, and a hairline a frame behind the edge it is drawing
        is worse than no hairline. */
    /** middle-third tap. */
    toggleChrome(): void
}

type Phase = 'idle' | 'watching' | 'dragging' | 'committing'

export class TurnController {
    #cfg: TurnConfig
    #hooks: TurnHooks
    #docs = new Set<Document>()

    #phase: Phase = 'idle'
    #pointerId = -1
    /* Touch-down, in SCREEN pixels. Not clientX: a pointer event inside a
       section iframe reports clientX through every transform between that
       iframe and the screen, and the turn is a transform on that very
       iframe's parent — so the coordinate the gesture is measured in is
       distorted by the animation the gesture is driving.

       Measured, six dispatched 40px steps of one finger, in-frame:
         screenX  -40  -80 -120 -160 -200 -240   (the truth, both styles)
         clientX  -40  -40  -80  -80 -120 -120   under SLIDE
         clientX  -40  -15  -99  -53 -163 -123   under CURL, since removed

       Slide lands on exactly half: the layer translates by the offset, the
       offset is read back from a delta the translation has already eaten, so
       it converges on finger/2 — every slide turn tracked the thumb at 1:2.
       Curl — the fold, since cut — was worse than wrong, it was
       non-monotonic: the rotation compressed the mapping unevenly, so the
       measured delta could shrink or invert while the finger kept going. That
       was the zig-zag the leaf did under the thumb, and an inverted delta is a
       backward drag that turns forward. The style is gone; the rule it proved
       is not, and every offset here is still screen-measured.

       screenX is untouched by page transforms, and it is CSS pixels, not
       device pixels — verified identical at deviceScaleFactor 1 and 3. */
    #x0 = 0
    #y0 = 0
    /* Pinch scale at touch-down. screenX travel is screen CSS pixels; the
       page's own pixels — which #size and every offset are in — are 1/scale
       of that. Read once, at touch-down, never during a move. */
    #scale = 1
    #t0 = 0
    /** last few samples, for velocity at release. */
    #hist: { x: number; t: number }[] = []
    /** offset already on the layer when this gesture started — non-zero only
        when the gesture interrupted a commit. */
    #base = 0
    /** The pane's leading inset inside the stage, in stage coordinates, read
        once at claim. The hairline is a child of the STAGE and the reading
        pane is inset within it — foliate's own margin — so without this every
        x it is given is short by that inset. Measured: a 358.8px pane sitting
        at 15.6 in a stage starting at 0, and a hairline asked for the page's
        trailing edge landing 15.6px to the left of it. */
    /* Set when a touch-down landed on a turn that was still flying, so the
       paths that end a gesture know the leaf is holding a position it was
       not given by this gesture. */
    #caught = false
    #offset = 0
    #size = 1
    /** decided once, at claim, from a layout read that happens then and not
        again: whether the page after this one is in another section. */
    /** the neighbouring page lives in another section, so the turn has to
        cross a file boundary rather than just scroll the column */
    #pending: Promise<unknown> = Promise.resolve()
    #turning = 0
    #crossFwd = false
    #crossBack = false
    #edgeFwd = false
    #edgeBack = false
    #anim: Animation | null = null
    /** the stage's opacity animation, when the style is one that fades. Held
        separately because it fills forwards across an await and so has to be
        cancelled by hand later — see #clearLayer. */
    #fade: Animation | null = null
    #target: Element | null = null
    /** true while a pointing device is down. Such a gesture is watched for a
        tap but never claimed as a drag — see #down. */
    #mouse = false

    constructor(cfg: TurnConfig, hooks: TurnHooks) {
        this.#cfg = cfg
        this.#hooks = hooks
    }

    update(cfg: TurnConfig) {
        this.#cfg = cfg
    }

    /** Attach to a document — the host page for the margins, and each loaded
        section, because a pointer event inside an iframe does not cross the
        boundary and the host would never see a touch that starts on a word. */
    attach(doc: Document) {
        if (this.#docs.has(doc)) return
        this.#docs.add(doc)
        doc.addEventListener('pointerdown', this.#down)
        doc.addEventListener('pointermove', this.#move)
        doc.addEventListener('pointerup', this.#up)
        doc.addEventListener('pointercancel', this.#cancel)
    }

    detach(doc: Document) {
        if (!this.#docs.delete(doc)) return
        doc.removeEventListener('pointerdown', this.#down)
        doc.removeEventListener('pointermove', this.#move)
        doc.removeEventListener('pointerup', this.#up)
        doc.removeEventListener('pointercancel', this.#cancel)
    }

    destroy() {
        for (const doc of [...this.#docs]) this.detach(doc)
        this.#anim?.cancel()
        this.#anim = null
        this.#clearLayer()
    }

    /* ── the layer ────────────────────────────────────────────────────── */

    #layer(): HTMLElement | null {
        return this.#hooks.renderer()?.contentLayer ?? null
    }

    #clearLayer() {
        const l = this.#layer()
        if (!l) return
        /* Cancelling is not tidying up: a commit animation fills forwards, so
           the transform it ends on outlives it, and clearing the inline style
           does not remove an animation's effect. Measured before this line
           existed: the layer kept a -358.8px translate after every turn, one
           whole page, so the pane showed the page AFTER the one the locator
           was recording. Every position the reader saved was a page behind
           what the reader was looking at.

           It has to happen in the same task as the page change, or the
           pre-turn page paints once more on the way past. */
        l.getAnimations().forEach(a => a.cancel())
        const eff = this.#anim?.effect
        if (eff instanceof KeyframeEffect && eff.target === l) this.#anim = null
        l.style.transform = ''
        l.style.willChange = ''
    }

    /* ── a turn with no gesture behind it: keys, tap zones, chrome ─────── */

    /** dir 1 = forward in reading order, -1 = back. Visual, not logical:
        callers that mean "the page on the left" convert first. */
    turnBy(dir: 1 | -1) {
        if (this.#phase === 'dragging') return
        this.#anim?.cancel()
        const r = this.#hooks.renderer()
        if (!r) return
        if (!this.#cfg.paginated) {
            void (dir === 1 ? r.next() : r.prev())
            return
        }
        this.#size = r.size || 1
        this.#readEdges(r)
        if (dir === 1 ? this.#edgeFwd : this.#edgeBack) return
        this.#base = 0
        this.#offset = 0
        void this.#commit(dir, FLAT)
    }

    /* ── pointer ──────────────────────────────────────────────────────── */

    /** Does this pointer target belong to the PAGE, or to chrome drawn over
        it? A target inside a section iframe is the book's and always the
        page. A target in the host document is the page only if it is the
        stage itself, the engine's element, or one of the two `aria-hidden`
        decorations painted in the stage — a positive list, so the next thing
        mounted there is inert to the gesture layer by default.

        Both the bars outside the stage and the selection menu inside it are
        caught by this. Measured, not theorised: without it, "Contents" opened
        the drawer AND turned a page back, and a tint chip — which sits in the
        leading third — called `renderer.prev()` on every click, so tinting a
        highlight moved the reader off the sentence being tinted. */
    #onPage(target: EventTarget | null): boolean {
        if (!(target instanceof Element)) return true
        const host = this.#hooks.stage()
        if (!host || target.ownerDocument !== host.ownerDocument) return true
        return target === host
            || target.closest('foliate-view, .reader-tick') !== null
    }

    #down = (e: PointerEvent) => {
        if (!e.isPrimary) return
        /* The host document also carries the app's own chrome — the two bars,
           the contents drawer, the control sheet — and a pointer that lands on
           a button belongs to that button, not to the page. Without this bail,
           tapping "Contents" opened the drawer AND turned a page back (its x
           sits in the leading third), and tapping the middle tab of the sheet
           landed in the centre third and closed the chrome that was holding
           the sheet open. Both measured, not theorised.

           A pointer that started inside a section iframe has a different
           ownerDocument and is always the book's, so it never takes this
           path. */
        if (!this.#onPage(e.target)) {
            this.#phase = 'idle'
            this.#pointerId = -1
            return
        }
        /* Mouse drags share the page with text selection. SPEC.md § 5.3 gives
           selection the drag that begins on a word, so #move holds a mouse to
           a longer threshold and stands down if a selection has actually
           formed. It used to stand down unconditionally, which meant slide
           simply did not respond to a drag on a desktop at all. */
        this.#mouse = e.pointerType === 'mouse'

        /* Interrupting a commit: continue from where it actually is on
           screen, not from where it was heading. Reading the live transform
           is a style read, and it happens once, at touch-down, before
           anything is moving under the finger. */
        this.#caught = false
        if (this.#anim) {
            this.#base = this.#liveOffset()
            this.#caught = true
            this.#anim.cancel()
            this.#anim = null
            /* Cancelling removes the animation's effect, and it was filling
               forwards, so the layer drops back to the inline transform the
               last drag frame wrote — a visible snap BACKWARDS at the very
               moment the finger lands, and it holds there until the first
               move claims. Measured catching a commit: 80.3 degrees on screen,
               66 in the inline style. So write the position we just read.
               One write, no measurement, and nothing is moving yet. */
            this.#offset = this.#base
            this.#paint(this.#base)
        } else this.#base = 0

        this.#phase = 'watching'
        this.#pointerId = e.pointerId
        this.#scale = this.#hooks.stage()?.ownerDocument.defaultView
            ?.visualViewport?.scale || 1
        this.#x0 = e.screenX
        this.#y0 = e.screenY
        this.#t0 = e.timeStamp
        this.#hist = [{ x: e.screenX / this.#scale, t: e.timeStamp }]
        this.#offset = this.#base
        this.#target = e.target instanceof Element ? e.target : e.view?.document.documentElement ?? null
    }

    #move = (e: PointerEvent) => {
        if (e.pointerId !== this.#pointerId) return
        if (this.#phase === 'idle') return

        this.#hist.push({ x: e.screenX / this.#scale, t: e.timeStamp })
        if (this.#hist.length > 6) this.#hist.shift()

        if (this.#phase === 'watching') {
            const dx = this.#travel(e)
            const dy = (e.screenY - this.#y0) / this.#scale

            if (Math.abs(dy) > YIELD_PX && Math.abs(dy) > Math.abs(dx)) {
                this.#phase = 'idle'
                return
            }
            if (Math.abs(dx) < (this.#mouse ? CLAIM_MOUSE_PX : CLAIM_PX)) return
            if (Math.abs(dx) <= Math.abs(dy)) return
            /* A mouse drag that is actually selecting has a live selection
               behind it, and that is a fact rather than a guess about intent
               — so it is the test, instead of refusing every mouse drag the
               way this used to. Drag from the margin, or from a word without
               catching any text, and the page turns. */
            if (this.#mouse && this.#selecting()) return
            if (!this.#cfg.paginated) { this.#phase = 'idle'; return }

            /* Claimed. Every layout read the drag needs happens here, once. */
            const r = this.#hooks.renderer()
            if (!r) { this.#phase = 'idle'; return }
            this.#size = r.size || 1
            /* NOT re-read on a catch, and this is not an optimisation.

               `page` and `pages` are read off the scroll container, and a
               caught gesture arrives mid-flight — so what they describe is the
               animation in progress, not the page under the finger. Measured
               under an early rotateY fold, since removed, where the
               foreshortening made it florid: on a 17-page chapter, one grab,
               pages came back 5 at 70 degrees and 3 higher up the flight. `page >= pages - 2`
               is then trivially true, so #crossFwd latches and the commit takes
               the crossing path — a fade-in of a section that was never
               crossed, mid-chapter. Same class of defect
               as measuring travel in clientX: reading the world through the
               transform being animated. (When this read WAS wired to the
               damping, the same latch dragged the caught leaf at 0.349 to 1,
               fitted across two 10px steps.)

               A gesture that CAUGHT a flight inherits these fields from
               whoever started it — a drag's claim, or turnBy — which read them
               while the layer was flat, and the commit was cancelled before it
               paged, so they still describe the page under the finger. */
            if (!this.#caught) this.#readEdges(r)
            this.#phase = 'dragging'
            this.#target?.setPointerCapture?.(e.pointerId)
            const l = this.#layer()
            if (l) l.style.willChange = 'transform'
        }

        e.preventDefault()

        const raw = this.#base + this.#travel(e)
        this.#offset = this.#resist(raw)
        this.#paint(this.#offset)
    }

    #up = (e: PointerEvent) => {
        if (e.pointerId !== this.#pointerId) return
        const wasDragging = this.#phase === 'dragging'
        this.#pointerId = -1

        if (!wasDragging) {
            const idle = this.#phase !== 'idle'
            this.#phase = 'idle'
            const turned = idle ? this.#tap(e) : false
            /* A touch that caught a flying leaf and then did nothing with it —
               a tap in the middle third, a tap on a link, a press and release —
               has to put the leaf back, or it hangs half-turned until the
               next gesture. Released where it was grabbed, no travel and no
               velocity: that means home. */
            const caught = this.#caught
            this.#caught = false
            if (caught && !turned) void this.#springBack()
            return
        }
        this.#caught = false

        this.#phase = 'committing'
        const v = this.#velocity(e.timeStamp)
        const projected = this.#offset + project(v)
        const reach = Math.abs(projected)
        const dir: 1 | -1 = (this.#cfg.rtl ? -this.#offset : this.#offset) < 0 ? 1 : -1
        const blocked = dir === 1 ? this.#edgeFwd : this.#edgeBack

        /* Still travelling the way the finger was: a throw, and a throw
           turns the page however short it was. */
        const flick = Math.abs(v) >= FLICK && Math.sign(v) === Math.sign(this.#offset)

        if (blocked || (!flick && reach < this.#size * COMMIT)) {
            void this.#springBack()
            return
        }
        void this.#commit(dir, this.#duration(v))
    }

    #cancel = (e: PointerEvent) => {
        if (e.pointerId !== this.#pointerId) return
        this.#pointerId = -1
        const wasDragging = this.#phase === 'dragging'
        this.#phase = 'idle'
        if (wasDragging) void this.#springBack()
        else this.#settle()
    }

    /* ── decisions ────────────────────────────────────────────────────── */

    /** The two layout reads the whole gesture depends on, taken together at
        claim: whether either end of the book is one page away, and whether
        either neighbour page lives in another section. `page` and `pages`
        read scrollLeft and clientWidth, so this is the last measurement
        until the finger comes up. */
    #readEdges(r: FoliateRenderer) {
        const page = r.page ?? 0
        const pages = r.pages ?? 0
        this.#edgeFwd = Boolean(r.atEnd)
        this.#edgeBack = Boolean(r.atStart)
        /* pages counts the two blank slack pages expand() adds, one at each
           end, so the last page of text is pages - 2 and the first is 1. */
        this.#crossFwd = !this.#edgeFwd && page >= pages - 2
        this.#crossBack = !this.#edgeBack && page <= 1
    }

    /** The page follows the finger 1:1. The rubber-band is the book's own
        first and last page and nothing else: a chapter boundary is a page like
        any other to the thumb, and damping it made a turn every six pages feel
        like the book had jammed. SPEC.md § 5.3. */
    #resist(raw: number): number {
        const hard = raw < 0 ? this.#edgeFwd : this.#edgeBack
        return hard ? band(raw, this.#size) : raw
    }

    /** px/ms over the tail of the gesture. A single event pair is noise —
        the last one before release is often a near-duplicate. */
    /** How far the finger has moved since touch-down, in the page's own CSS
        pixels. The only measure of travel the gesture uses. */
    #travel(e: PointerEvent): number {
        return (e.screenX - this.#x0) / this.#scale
    }

    #velocity(now: number): number {
        const cut = now - 100
        const recent = this.#hist.filter(s => s.t >= cut)
        /* An empty window means the finger stopped before it lifted, and a
           resting thumb has no momentum to hand over. Falling back to the
           gesture's FIRST sample instead reported its average speed over its
           whole life: measured, a page dragged 20% and then held still for
           220ms was still credited ~300px of projection and turned itself.
           Two samples, because a lone one cannot describe a rate. */
        if (recent.length < 2) return 0
        const a = recent[0]
        const b = recent[recent.length - 1]
        const dt = b.t - a.t
        return dt > 8 ? (b.x - a.x) / dt : 0
    }

    /** Fast release settles sooner. The join between the drag and the
        animation is only invisible if the animation starts at the speed the
        finger left at, and duration is how a timed animation says that. */
    #duration(v: number): number {
        const remaining = Math.max(1, this.#size - Math.abs(this.#offset))
        const speed = Math.max(Math.abs(v), 0.6)
        return clamp(COMMIT_MIN, COMMIT_MAX, (remaining / speed) * 1.35)
    }

    /* ── painting ─────────────────────────────────────────────────────── */

    #paint(offset: number) {
        const style = this.#cfg.reducedMotion ? 'reduced' : this.#cfg.turn
        const stage = this.#hooks.stage()
        if (style === 'fade') {
            /* Tracked as opacity: the page dims towards the turn and lifts
               back if the finger comes home. */
            if (stage) stage.style.opacity = String(1 - clamp(0, 0.85, Math.abs(offset) / this.#size * 0.85))
            return
        }
        if (style === 'instant' || style === 'reduced') return
        const l = this.#layer()
        if (l) l.style.transform = `translate3d(${offset}px,0,0)`
    }

    #liveOffset(): number {
        const l = this.#layer()
        if (!l) return 0
        const t = getComputedStyle(l).transform
        if (!t || t === 'none') return 0
        /* One matrix read, and it is the offset itself: every style that
           tracks a finger translates the layer by exactly the offset. */
        return new DOMMatrixReadOnly(t).m41
    }

    /** Resolves TRUE when the animation ran to its end, FALSE when something
        cancelled it — which in practice means a finger landed on the moving
        leaf. Every caller has to know the difference. `finished` REJECTS on
        cancel, and the old `.then(() => { }, () => { })` swallowed that
        rejection into a plain resolve, so an interrupted commit carried on
        through the lines after its await: it cleared the layer, called
        `r.next()` and settled. Measured: catching a flight at 73.2 degrees
        snapped the leaf to 0, turned the page the reader had just grabbed to
        stop, and set #phase to idle under the gesture that was still down. */
    #animate(to: number, duration: number, easing: string): Promise<boolean> {
        const style = this.#cfg.reducedMotion ? 'reduced' : this.#cfg.turn
        const stage = this.#hooks.stage()

        if (style === 'instant') return Promise.resolve(true)

        if (style === 'fade' || style === 'reduced') {
            if (!stage) return Promise.resolve(true)
            const from = Number(stage.style.opacity || '1')
            const target = to === 0 ? 1 : 0
            const anim = stage.animate(
                [{ opacity: from }, { opacity: target }],
                { duration, easing: 'linear', fill: 'forwards' })
            this.#anim = anim
            this.#fade = anim
            return anim.finished.then(() => true, () => false)
        }

        const l = this.#layer()
        if (!l) return Promise.resolve(true)
        const anim = l.animate(
            [
                { transform: `translate3d(${this.#offset}px,0,0)` },
                { transform: `translate3d(${to}px,0,0)` },
            ],
            { duration, easing, fill: 'forwards' })
        this.#anim = anim
        return anim.finished.then(() => true, () => false)
    }

    /** Every prev/next goes through here. foliate's #turnPage takes a lock,
        holds it across the scroll AND a further 100ms — `await wait(100)`,
        unconditional for us because we deliberately do not set `animated`
        (PATCHES.md § 4) — and a turn that arrives while it is held returns
        SILENTLY. The page just does not move.

        That is the "I slide left or right and it makes no difference" fault.
        It is worst going into a new chapter, because there the lock is held
        across the file load as well as the 100ms, so the window in which a
        gesture is swallowed is several times longer — which is exactly where
        the owner reported it. And a tap issued later, after the lock cleared,
        worked, which is what made it look like slide specifically was broken.

        So a turn is queued rather than dropped: one that lands during the
        lock waits for it and then runs. */
    #page(r: FoliateRenderer, dir: 1 | -1): Promise<unknown> {
        /* One in flight and one waiting is the ceiling. Queueing without a
           ceiling trades a swallowed turn for a worse fault: a reader who
           swipes three or four times at a page that seems stuck gets the
           whole burst at once the moment the lock clears, and lands pages
           further on than they asked for. Measured — one 250px drag over a
           queue built up this way ran 1 -> 8. Past the ceiling the extra
           turn is dropped, which is the old behaviour and the right one for
           a gesture the reader has already repeated. */
        if (this.#turning >= 2) return this.#pending
        this.#turning++
        const run = this.#pending.then(() => (dir === 1 ? r.next() : r.prev()))
        const done = () => { this.#turning-- }
        this.#pending = run.then(done, done)
        return run
    }

    async #springBack() {
        const dur = this.#cfg.reducedMotion ? REDUCED : SPRING_BACK
        /* Interrupted: the new gesture owns the leaf now, and settling here
           would zero the base it is dragging from. */
        if (await this.#animate(0, dur, 'cubic-bezier(.2,0,0,1)')) this.#settle()
    }

    async #commit(dir: 1 | -1, duration: number) {
        const r = this.#hooks.renderer()
        if (!r) { this.#settle(); return
        }
        const style = this.#cfg.reducedMotion ? 'reduced' : this.#cfg.turn
        const cross = dir === 1 ? this.#crossFwd : this.#crossBack
        const stage = this.#hooks.stage()
        const dur = style === 'fade' ? FADE : style === 'reduced' ? REDUCED : duration

        if (style === 'fade' || style === 'reduced' || style === 'instant') {
            if (stage && style !== 'instant') {
                /* Held on #anim so a finger landing during the fade cancels
                   it, the same as it cancels a transform turn — and so the
                   `if` below can tell that that is what happened. */
                const out = stage.animate(
                    [{ opacity: Number(stage.style.opacity || '1') }, { opacity: 0 }],
                    { duration: dur / 2, easing: 'linear', fill: 'forwards' })
                this.#anim = out
                this.#fade = out
                if (!await out.finished.then(() => true, () => false)) return
            }
            this.#offset = 0
            this.#clearLayer()
            await this.#page(r, dir)
            if (stage && style !== 'instant') {
                /* On #fade for the same reason the fade-OUT is, and the reason
                   is in #settle's comment: this fills forwards at 1, and a
                   forwards fill outranks a later inline style.opacity write.
                   Left uncancelled it silently disabled the dim on every
                   subsequent drag — measured after one committed fade, a 25%
                   drag tracked correctly and painted opacity 0.79 into the
                   inline style while the computed value stayed at 1.000. It
                   also leaked one live animation per turn. */
                const back = stage.animate([{ opacity: 0 }, { opacity: 1 }],
                    { duration: dur / 2, easing: 'linear', fill: 'forwards' })
                this.#fade = back
                await back.finished.then(() => { }, () => { })
            }
            if (stage) stage.style.opacity = ''
            this.#anim = null
            this.#settle()
            return
        }

        const to = dir === 1 ? -this.#size : this.#size
        /* Grabbed mid-flight: leave the page where it is. The gesture that
           grabbed it decides what happens next — that is the whole point of
           being able to grab it. */
        if (!await this.#animate(to, dur, EASE_TURN)) return
        this.#anim = null

        /* A crossing is the one turn a transform cannot finish. foliate
           scrolls to the trailing blank slack page and only THEN loads and
           paginates the next file, so there is nothing on the other side of
           the slide to slide in — the page the finger just pushed off screen
           was the last one laid out.

           So the slide itself is exactly the slide of any other turn, which is
           the half the thumb can feel, and only the arrival fades. What the
           slide reveals is that blank slack page: already the paper colour,
           already the right size, so the stage can be dropped to zero over it
           without anything visibly going out. The transform is NOT cleared
           first — r.next() is asynchronous here, and clearing early snaps the
           spent page back into view for the ~37ms the load takes. */
        if (cross) {
            if (stage) stage.style.opacity = '0'
            this.#offset = 0
            this.#clearLayer()
            await this.#page(r, dir)
            if (stage) {
                /* On #fade for the reason #settle gives: a forwards fill
                   outranks a later inline opacity write, so this one has to be
                   cancellable or it disables the dim on every later drag. */
                const back = stage.animate([{ opacity: 0 }, { opacity: 1 }],
                    { duration: CROSS_IN, easing: 'linear', fill: 'forwards' })
                this.#fade = back
                await back.finished.then(() => { }, () => { })
                stage.style.opacity = ''
            }
            this.#settle()
            return
        }

        /* One task, two writes: clear the transform, then page. With the
           `animated` attribute absent, the paginator's prev/next are a
           synchronous scrollLeft assignment, so both land in the same frame
           and the pre-turn page is never painted again. PATCHES.md § 4. */
        const run = this.#page(r, dir)
        /* Idle, which is the ordinary case: #page's next() is one microtask
           away, so it still lands in this frame alongside the clear and the
           spent page is never painted again.

           Queued behind someone else's lock: hold the leaf where the finger
           left it — off screen — until the turn actually runs, instead of
           snapping it back for the length of the lock and then moving. */
        if (this.#turning > 1) await run
        this.#offset = 0
        this.#clearLayer()
        this.#settle()
    }

    #settle() {
        this.#anim = null
        this.#offset = 0
        this.#base = 0
        this.#phase = 'idle'
        const stage = this.#hooks.stage()
        /* Same reason as in #clearLayer, on the other property: the fade
           fills forwards, so clearing the inline opacity is not enough to
           get the page back. Measured on a spring-back, where the leftover
           animation held the layer at its own value and the NEXT drag's
           writes lost to it — a drag that did not reach half a page left the
           one after it unable to move at all. */
        this.#fade?.cancel()
        this.#fade = null
        if (stage) stage.style.opacity = ''
        this.#clearLayer()
    }

    /* ── tap ──────────────────────────────────────────────────────────── */

    /** Is the browser mid-selection in the document the gesture started in?
        Checked in the section's own document, because a selection made inside
        an iframe does not show up in the host's. */
    #selecting(): boolean {
        const sel = this.#target?.ownerDocument?.defaultView?.getSelection()
        return !!sel && !sel.isCollapsed
    }

    /** TRUE only when the tap itself started a turn, so #up can tell a tap
        that took over a caught leaf from one that left it hanging. */
    #tap(e: PointerEvent): boolean {
        /* A tap that travelled is a cancelled drag, not a tap. */
        if (Math.abs(this.#travel(e)) > CLAIM_PX) return false
        if (Math.abs((e.screenY - this.#y0) / this.#scale) > CLAIM_PX) return false

        const doc = (e.target as Element | null)?.ownerDocument
        /* A footnote or a chapter link is the book's, and foliate already
           handles it. */
        if (e.target instanceof Element && e.target.closest('a[href], [epub\\:type~="noteref"]')) return false
        /* A tap that dismisses a selection is doing that and nothing else. */
        const sel = doc?.getSelection?.()
        if (sel && !sel.isCollapsed) { sel.removeAllRanges(); return false }

        /* Chrome drawn OVER the page is not the page. The selection menu, and
           anything else mounted inside the stage, is in the HOST document, so
           its clicks arrive here looking exactly like a tap on the paper — and
           a tint chip sits in the leading third, so tinting a highlight turned
           the page backwards. Measured, not theorised: `renderer.prev()` was
           called from this handler on every chip click.

           Only the page and the host's own tap margins may turn: the stage
           itself, the engine's element, and the two decorations that are
           `aria-hidden` paint. A positive list rather than a blocklist, so the
           next thing mounted in the stage is inert here by default. */
        if (!this.#onPage(e.target)) return false

        /* The thirds are measured on the VISIBLE PAGE, in the host document's
           coordinates — never on the section iframe's own viewport. That
           iframe is as wide as the whole multi-column strip (2293px for one
           chapter of Pride and Prejudice on a 390px phone), so a clientX
           divided by its innerWidth puts every tap on the page in the leading
           third and every tap turns backwards. Measured, not guessed.

           `frameElement.getBoundingClientRect()` is in the host viewport and
           already accounts for the strip's scroll and any live transform, so
           adding the in-frame clientX to its left edge gives the host x. Two
           layout reads on a tap, which is not a frame budget — the drag path
           reads nothing.

           clientX is right HERE, where screenX would be wrong: this needs a
           position within the page, not a distance travelled, and the page is
           at rest by the time a tap is resolved. The one exception is a tap
           that caught a flying leaf, where the page is still carrying a
           transform and these thirds are read through it; the zone can be off
           by a few percent in that one case, and it decides between two
           adjacent thirds, not between turning and not. */
        const stage = this.#hooks.stage()
        const box = stage?.getBoundingClientRect()
        if (!box?.width) return false
        const frame = (e.view as (Window & { frameElement?: Element | null }) | null)?.frameElement
        const frameLeft = frame?.getBoundingClientRect().left ?? 0
        const third = (frameLeft + e.clientX - box.left) / box.width

        if (!this.#cfg.tapToTurn || (third > 1 / 3 && third < 2 / 3)) {
            this.#hooks.toggleChrome()
            return false
        }
        const leading = third <= 1 / 3
        /* In an RTL book the leading edge is the right one, so the tap zones
           swap with it — the left third still means "the way you came". */
        const back = this.#cfg.rtl ? !leading : leading
        this.turnBy(back ? -1 : 1)
        return true
    }
}
