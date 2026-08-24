/* ─────────────────────────────────────────────────────────────
   Reading days, and the streak.

   These lived twice — once in Home for the stats card, once in Stats for
   the page behind it — and the two copies drifted apart. The card started
   its count at today and the page forgave a blank today, so at breakfast
   the card said 0 days running and the page, one tap away, said 3. A
   number the reader can see twice has to be computed once.
   ───────────────────────────────────────────────────────────── */

import { localDay } from './db'

/** `YYYY-MM-DD` for the day `n` days before `from`. Goes through Date rather
    than subtracting from a string so month ends, leap days and DST are the
    platform's problem, not ours. */
export function dayBefore(from: string, n: number): string {
    const [y, m, d] = from.split('-').map(Number)
    return localDay(new Date(y, m - 1, d - n))
}

/** Monday of the week containing `day`. Monday because a reading week that
    starts on Sunday splits every weekend in half. */
export function weekStart(day: string): string {
    const [y, m, d] = day.split('-').map(Number)
    /* getDay is 0=Sunday, so Sunday is six days into its week, not none. */
    const back = (new Date(y, m - 1, d).getDay() + 6) % 7
    return dayBefore(day, back)
}

/** A day counts toward the run only with at least a minute on it. A
    thirty-second glance is not a reading day, and counting it would make the
    streak flattering rather than true. */
export const DAY_MS = 60_000

/** Consecutive reading days ending today — or ending yesterday if today is
    still blank, because a streak should not read as broken at breakfast. */
export function streakOf(minutes: Map<string, number>, today: string): number {
    const read = (day: string) => (minutes.get(day) ?? 0) >= DAY_MS
    let cursor = read(today) ? today : dayBefore(today, 1)
    let n = 0
    while (read(cursor)) {
        n += 1
        cursor = dayBefore(cursor, 1)
    }
    return n
}
