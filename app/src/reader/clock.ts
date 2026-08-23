import { logReading } from '../db'

/* ── The reading clock ────────────────────────────────────────────────────
   The one thing that writes reading history, and the only reason the stats
   screen has anything on it.

   Counting time read is easy to do badly. A `start`/`end` pair per session
   over-counts by hours the first time a phone locks mid-chapter, and a naive
   `setInterval` that just adds its own period keeps counting through a laptop
   that slept overnight. So this measures elapsed wall-clock between accruals
   and then CLIPS that span by two rules, both of which can only ever remove
   time:

     1. Nothing accrues while the tab is hidden. Backgrounded is not reading.
     2. Nothing accrues more than IDLE past the last sign of life. A book left
        open on a table stops counting five minutes in, wherever the timer
        happened to be.

   Rule 2 is why IDLE is generous. Reading is mostly *not* touching anything:
   somebody on a dense page does nothing for a minute at a time, and a
   thirty-second idle cut-off would under-report a careful reader by half. Five
   minutes is longer than a page and much shorter than a coffee.

   Every number this produces is therefore a floor, not an estimate. That is
   the right direction for a figure a reader is going to feel proud of. */

/** No sign of life for this long and the clock stops, retroactively. */
const IDLE = 5 * 60_000
/** How often elapsed time is folded in. Also the resolution of the clip. */
const TICK = 15_000
/** How often the fold is written to IndexedDB. A crash costs at most this. */
const FLUSH = 30_000

export class ReadingClock {
    private readonly bookId: string
    /** last accrual point */
    private at = Date.now()
    /** last sign of life — a turn, a tap, a key */
    private live = Date.now()
    private hidden = document.visibilityState === 'hidden'
    private ms = 0
    private turns = 0
    private sinceFlush = 0
    private fraction = 0
    private timer: number | null = null
    private stopped = false

    constructor(bookId: string) {
        this.bookId = bookId
        document.addEventListener('visibilitychange', this.onVisibility)
        /* pagehide, not unload: iOS Safari does not reliably fire unload, and
           a reader who swipes the app away is exactly the reader whose last
           twenty minutes would otherwise be lost. */
        window.addEventListener('pagehide', this.onLeave)
        this.timer = window.setInterval(this.accrue, TICK)
    }

    /** A turn landed, or the reader touched something. `turn` is false for
        plain interaction — a tap that did not commit still proves somebody is
        there, but it is not a page. */
    bump(fraction: number, turn = true): void {
        if (this.stopped) return
        this.accrue()
        this.live = Date.now()
        this.fraction = fraction
        if (turn) this.turns += 1
    }

    /** Flush and detach. Safe to call twice. */
    stop(): void {
        if (this.stopped) return
        this.accrue()
        this.stopped = true
        if (this.timer !== null) clearInterval(this.timer)
        this.timer = null
        document.removeEventListener('visibilitychange', this.onVisibility)
        window.removeEventListener('pagehide', this.onLeave)
        void this.flush()
    }

    private accrue = (): void => {
        if (this.stopped) return
        const now = Date.now()
        if (!this.hidden) {
            /* Both clips in one expression: the span ends at whichever comes
               first, now or five minutes after the last sign of life. A
               negative result means the idle cut-off is already behind us. */
            const until = Math.min(now, this.live + IDLE)
            const span = until - this.at
            if (span > 0) {
                this.ms += span
                this.sinceFlush += span
            }
        }
        this.at = now
        if (this.sinceFlush >= FLUSH) void this.flush()
    }

    private flush = async (): Promise<void> => {
        const ms = this.ms
        const turns = this.turns
        if (ms <= 0 && turns <= 0) return
        /* Zeroed BEFORE the await, not after. An await here is a window in
           which `accrue` can run again, and subtracting afterwards is how the
           same thirty seconds gets written twice. */
        this.ms = 0
        this.turns = 0
        this.sinceFlush = 0
        try {
            await logReading(this.bookId, ms, turns, this.fraction)
        } catch {
            /* Put it back and try on the next tick. Losing half a minute of
               history is not worth an error surfaced over somebody's book. */
            this.ms += ms
            this.turns += turns
        }
    }

    private onVisibility = (): void => {
        const hidden = document.visibilityState === 'hidden'
        if (hidden === this.hidden) return
        this.accrue()
        this.hidden = hidden
        /* Coming back is a sign of life on its own: you did not switch to this
           tab in order to not read. Without this the clock would still be
           inside the idle window it entered while backgrounded. */
        if (!hidden) this.live = Date.now()
        else void this.flush()
    }

    private onLeave = (): void => {
        this.accrue()
        void this.flush()
    }
}
