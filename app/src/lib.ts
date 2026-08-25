/* Small shared formatters. Here rather than in each screen because two screens
   printing the same date two ways is the kind of inconsistency nobody files a
   bug about and everybody notices. */

/** Bytes, as a shelf says them. One decimal below 10, none above — "1.3 MB" is
    information and "1.34 MB" is noise on a line about a novel. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1000) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** A date, printed. Uppercased at the CSS layer, not here, so the string stays
    readable to a screen reader that says it aloud. */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** A publisher's date string, printed the way a colophon would. EPUB's
    `dc:date` is legally any of `2014`, `2014-05`, `2014-05-25` or a full
    `2014-05-25T00:00:00Z`, and Standard Ebooks emits the last one — so the
    facts table was showing a reader "2014-05-25T00:00:00Z". Parsed by shape
    rather than handed to `new Date()`, because `new Date('2014-05-25')` is UTC
    midnight and prints as the 24th anywhere west of Greenwich. Anything that
    is not one of the four shapes is passed through untouched: a date this
    function does not understand is still the publisher's own text. */
export function pubDate(raw: string): string {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(raw.trim())
  if (!m) return raw
  const [, y, mo, d] = m
  if (!mo) return y
  const date = new Date(Number(y), Number(mo) - 1, Number(d ?? 1))
  return date.toLocaleDateString(undefined, d
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { month: 'long', year: 'numeric' })
}

/** Subject headings, tidied but not rewritten. Library-of-Congress headings
    arrive as `England -- Fiction` — a real hierarchy, printed with the MARC
    subfield separator still in it, which on screen reads as an em dash somebody
    forgot. The separator becomes a middot; the words are the publisher's.
    Deduped case-insensitively (files do repeat headings) and capped, because
    the point of this row is to say what kind of book this is in one glance, and
    a fourth line of chips stops being a glance — which six of them measured as
    on a 390px screen, so the cap is five. */
export function subjects(list: string[], cap = 5): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const s = raw.replace(/\s*--\s*/g, '  ·  ').replace(/\s+/g, ' ').trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length === cap) break
  }
  return out
}

/** 0–1 to a whole percent, with the two ends protected: a book one paragraph
    in is not "0% read", and a book one paragraph from the end is not "100%".
    Rounding to either end is a claim about a state the reader is not in. */
export function percent(fraction: number): number {
  if (fraction <= 0) return 0
  if (fraction >= 1) return 100
  return Math.min(99, Math.max(1, Math.round(fraction * 100)))
}

/** Minutes remaining, phrased the way a person would say it. Under a minute
    is "less than a minute" rather than "0 min", because a chapter you are
    still reading never has none left; an hour or more breaks into hours and
    minutes, because "94 min" is arithmetic the reader has to do themselves. */
export function minutes(mins: number): string {
  const m = Math.max(0, Math.round(mins))
  if (m < 1) return 'less than a minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} hr ${rest} min` : `${h} hr`
}

/** The printed tilt, per DESIGN.md: −1.4° to +1.6°, derived from the record id
    and never random — a cover that leans a different way on every render is a
    twitch, not a print. Library and book detail only; the reading page is
    upright.

    Deliberately a cheap string hash rather than a hash of the UUID's bytes: the
    ids are UUIDs *and* seed slugs, and the only property needed is that the
    same id always lands on the same angle. */
export function tilt(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const t = (Math.abs(h) % 1000) / 1000
  return Number((-1.4 + t * 3).toFixed(2))
}

/** The format, as the mono labels print it. */
export const FORMAT_LABEL: Record<string, string> = {
  epub: 'EPUB',
  mobi: 'MOBI',
  azw3: 'AZW3',
  fb2: 'FB2',
  fbz: 'FBZ',
  txt: 'TXT',
  markdown: 'Markdown',
  html: 'HTML',
  pdf: 'PDF',
}

/* ── Which step of the ramp a format wears ─────────────────────────────────
   DESIGN.md § The graph ramp. A format family gets a STEP, not a hue: nine mono
   labels are unreadable at a glance, but the six hues this used to carry were a
   second colour system next to the themes, and the owner cut them — "just make
   it mono, like on flyleaf press".

   So the families are ordered rather than coloured, --graph-5 down to
   --graph-1, and the order is the one a reader would guess: the format the app
   is built around first, PDF (the one that does not reflow) last. The families
   themselves are still grouped the way a person would group them — two Kindle
   formats are one thing, whatever the container does — not the way the parsers
   are. The mapping from a family to its step lives in the stylesheet. */
export const FORMAT_FAMILY: Record<string, string> = {
  epub: 'epub',
  mobi: 'kindle',
  azw3: 'kindle',
  fb2: 'fb2',
  fbz: 'fb2',
  txt: 'text',
  markdown: 'text',
  html: 'text',
  pdf: 'pdf',
}


/* ── remembered view preferences ───────────────────────────────────────────
   Two screens now keep a grid/list choice — the Library's shelf and Home's
   Recently Added — so the read and the write live here rather than being copied
   into the second one. A preference, not data: it is never synced, and losing it
   costs the reader one tap. */

/** Read a remembered choice, falling back if the stored value is not one this
    build still offers. The `allowed` check is what makes a removed view mode
    safe to remove: an old value simply fails the test. */
export function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key) as T | null
    return raw && allowed.includes(raw) ? raw : fallback
  } catch {
    /* Safari in private mode throws on access, not on write. A shelf is not
       worth failing to render over. */
    return fallback
  }
}

export function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* nothing to do and nothing to say: the preference holds for this session
       and is forgotten, which is better than a dialog about storage. */
  }
}
