/* The record. Everything the app knows lives in these shapes, and the reason
   they are written down before any screen is that two of them are promises:

   — `Book` carries every field Flyleaf Press would need to open a review of
     this book (title, author, format, the dates, and the highlights via
     `Annotation`). The handoff is a later feature; recording the fields is not
     later, because a field not captured while reading cannot be recovered
     afterwards.
   — `Locator` is a CFI and never a scroll offset or a percentage. `fraction`
     beside it is for the progress readout only. Deriving position from a
     percentage is what makes a reader lose your page when you change the font
     size, and it is not a bug you can fix afterwards — the information is
     simply gone. */

/** What the file is. Sniffed from bytes, not from the extension — an .epub
    that is really a zip of images is not an EPUB, and a .txt with an EPUB's
    magic number is. */
export type Format =
  | 'epub'
  | 'mobi'
  | 'azw3'
  | 'fb2'
  | 'fbz'
  | 'txt'
  | 'markdown'
  | 'html'
  | 'pdf'

export type Book = {
  /** crypto.randomUUID. Stable for the life of the record; never derived from
      the file, because the same book re-imported from a different file is
      still, to the reader, the same book they were halfway through. */
  id: string
  title: string
  /** one string, as printed. Multiple authors are joined here rather than
      normalised — this is a reader, not a catalogue, and "and" is how a title
      page says it. */
  author: string
  format: Format

  /** milliseconds. Named for what they are, so a null is readable: `openedAt`
      null means never opened, not opened at the epoch. */
  addedAt: number
  /** Last time anything on THIS row was written — set by every writer, so a
      merge can tell which of two copies of the same book is the later one.
      Absent on a row written before sync existed, where `addedAt` is the
      honest floor: nothing has been edited since, or the edit is older than
      any sync and losing it costs the reader a re-tick of "finished". */
  editedAt?: number
  openedAt: number | null
  /** set when the last page is reached, or by hand. Press wants this one. */
  finishedAt: number | null

  /** 0–1, for the shelf's progress hairline. NOT a position — see Locator. */
  progress: number

  /** The real cover, extracted at import, or null. There is no generated
      fallback: DESIGN.md, and Press before it, says a cover is the real thing
      or it is nothing. */
  cover: Blob | null

  /** as the file was named on disk, for the reader's own recognition */
  fileName: string
  fileSize: number

  /** true for the two books the app ships with. Indexed, because two separate
      questions are asked of it: "label this row INCLUDED" and "which seeds are
      still here". Absent rather than false on an imported book — the field
      means "this came from us", and a book that came from the reader has no
      opinion on the matter. */
  seeded?: boolean

  /** SHA-256 of the file's bytes, hex, computed on first sync and then kept.
      It is the only thing that can say "the copy on the phone and the copy on
      the laptop are the same book": `id` cannot, because each device made its
      own at import, and title cannot, because two editions share one.

      Absent until a sync needs it — hashing every book at import would cost a
      reader who never connects Drive nothing but battery. */
  fp?: string

  /** whatever the file's metadata actually carried. All optional, because most
      files carry some of it and a few carry none. */
  language?: string
  publisher?: string
  published?: string
  subjects?: string[]
  description?: string
}

/** The book's bytes, in their own table so that listing a library never reads
    them. A 40MB EPUB in the same row as its title means the shelf query pulls
    40MB to draw a line of text. */
export type BookFile = {
  bookId: string
  data: Blob
  /** the sniffed MIME, kept so the File handed to the parser is honest */
  type: string
}

/** Where the reader is. One per book. */
export type Locator = {
  bookId: string
  /** an EPUB CFI. The whole point: it survives a change of face, size,
      leading, margin, flow and screen, because it addresses the text rather
      than the layout.

      A PDF has no CFI, so it stores `pdf:<page>:<fraction>` — which page, and
      how far down it the top of the viewport sits. Same principle, not a
      compromise on it: a fixed page cannot reflow, so the page number IS the
      content anchor, and the pair survives a change of zoom, fit and screen
      exactly as a CFI survives a change of face. A raw scroll offset would
      not, which is why it is not stored. */
  cfi: string
  /** 0–1 through the whole book, for the readout only. Derived, never stored
      as the source of position. */
  fraction: number
  /** the TOC entry this CFI falls inside, for "12 min left in chapter" */
  chapter: string | null
  updatedAt: number
}

/* ── What the stats page is made of ────────────────────────────────────────
   One row per book per LOCAL calendar day, accumulated in place, rather than
   one row per reading session.

   Sessions would be the obvious shape and they are the wrong one here. A
   session needs an end, and a tab that is closed by the OS, a phone that
   sleeps, or a browser that is killed never sends one — so a session table
   grows rows that are open forever and every total is a guess. A day bucket
   that is incremented every half minute is at worst half a minute stale, and
   it is stale in the only direction that is honest: it under-counts.

   Local, not UTC. Somebody reading at 11pm in Lagos is reading on that day,
   and a streak that breaks because midnight UTC fell in the middle of a
   chapter is a bug the reader cannot even see the cause of. */
export type ReadingDay = {
  /** `${day}|${bookId}` — composed so an increment is one `put`, not a query
      followed by a write. */
  id: string
  /** `YYYY-MM-DD`, in the reader's own timezone */
  day: string
  bookId: string
  /** milliseconds of ACTIVE reading. Not wall-clock: the clock stops when the
      tab is hidden and when nothing has been touched for five minutes. */
  ms: number
  /** page turns committed, however they were committed */
  turns: number
  /** the book's `fraction` at the first and last flush of that day, so
      "how far you got" is derivable without storing a second position. */
  from: number
  to: number
}

export type HighlightColor = 'mustard' | 'pink' | 'blue' | 'butter' | 'underline'

export type Annotation = {
  id: string
  bookId: string
  /** a range CFI — start and end, so the highlight survives reflow too */
  cfi: string
  /** the highlighted words, stored flat. Redundant with the CFI on purpose:
      it is what an export contains, what a search matches, and what survives
      if the file is ever re-imported and the CFI no longer resolves. */
  text: string
  /** the reader's own words, in Kalam. Empty string, not null, for a plain
      highlight — so "has a note" is one truthy check. */
  note: string
  color: HighlightColor
  /** The chapter label at the moment the mark was made. Denormalised on
      purpose: the marks list groups by chapter, and deriving the label from
      the CFI means resolving every mark through the engine — which needs the
      book open, and the marks list is also read from the shelf. Absent on a
      mark made in a book with no contents list, which is not the same as an
      empty string and is why it is nullable rather than defaulted. */
  chapter?: string | null
  createdAt: number
  updatedAt: number
}

export type Bookmark = {
  id: string
  bookId: string
  cfi: string
  /** the first line at that place, so a bookmark list reads as text */
  excerpt: string
  /** as on Annotation, and for the same reason. */
  chapter?: string | null
  createdAt: number
}

/** The page stocks, per DESIGN.md and SPEC.md § 2. Independent of the chrome
    theme, warm only, every ink pair computed to AA before it was written down.
    Seven, and there is no custom stock: a colour picker answers none of the
    seven questions these answer and turns a reader into a theme editor. */
export type Stock = 'press' | 'day' | 'butter' | 'tea' | 'coal' | 'dusk' | 'pitch'

/** How a page becomes the next page. SPEC.md § 5.

    Three, and there were four: `curl` was a real hinged fold with a mirrored
    back face, it held its frame budget under throttle, and it was cut anyway
    because it did not feel like the fold it was measured against. A stored
    `'curl'` therefore still exists on devices that chose it, and is folded
    back to `'slide'` by the settings merge in db.ts — never by a migration,
    because a migration that rewrites a settings row is a migration that can
    lose one. SPEC.md § 5.2 keeps the reasoning. */
export type Turn = 'slide' | 'fade' | 'instant'

/** What a settings row written by an older build may still hold in `turn`.
    Read-only: nothing in the app writes it, and the merge maps it away. */
export type RetiredTurn = 'curl'

/** Reading settings. One row, global — not per book. A reader who has settled
    on 19px Literata has settled on it, and asking them again for every book is
    a preference the app forgot rather than a feature.

    Every field is defaulted through the merge in `loadSettings`, which is what
    lets this grow without a migration: a row written by an older build is
    missing whatever was added since, and a missing `leading` is NaN in a
    stylesheet, which renders as a blank page.

    Ranges are documented here and enforced at the control. SPEC.md §§ 3–5. */
export type Settings = {
  id: 1

  /* ---- the face ---- */
  face: string
  /** px. 14–28, continuous. */
  size: number
  /** unitless line-height. 1.2–2.2, continuous. */
  leading: number
  /** 'light' | 'regular' | 'medium' → wght 350 / 400 / 450. Free on a variable
      face; faces with only static weights map to 400/600 and hide the middle
      tier rather than lie about it. */
  weight: 'light' | 'regular' | 'medium'
  /** em. −0.04 … 0.24. Negative is included and clamped tight: it is how you
      rescue a justified narrow measure. */
  wordSpacing: number
  /** em. −0.02 … 0.10. Disabled — not silently ignored — for connected and
      complex scripts, where tracking breaks shaping. */
  letterSpacing: number
  /** honour the book's own @font-face rules. Off by default: the reader's face
      wins everywhere unless they ask for the publisher's. */
  publisherFont: boolean

  /* ---- the paragraph ---- */
  /** 'indent' is 1.2em and no gap; 'spaced' is no indent and 0.7em. Never
      both — a paragraph that is indented *and* spaced is two answers to one
      question. */
  paragraph: 'published' | 'indent' | 'spaced'
  align: 'published' | 'left' | 'justify'
  /** needs a declared lang; the control says so when the book has none */
  hyphenate: boolean

  /* ---- the page ---- */
  stock: Stock
  /** % of the pane per side. 4–12. */
  margin: number
  /** em cap on the measure. Only bites on panes wider than it, so it is hidden
      on a phone rather than shown doing nothing. */
  measure: 30 | 34 | 40
  /** 'auto' is two columns above 1180px */
  columns: 'auto' | 1 | 2

  /* ---- the turn ---- */
  /** paginated by default; scrolled is a setting, not the other way round */
  flow: 'paginated' | 'scrolled'
  turn: Turn
  /** left/right thirds turn the page. Off leaves the whole pane a chrome
      toggle. */
  tapToTurn: boolean

  /* ---- the fixed page (PDF only) ---- */
  /** 'width' fills the pane's width and scrolls; 'page' fits the whole sheet
      so one page is one screen. Not a type control — a PDF has no type to
      control — which is why it lives here and not with `measure`. */
  pdfFit: 'width' | 'page'
  /** One sheet at a time, or two side by side the way a bound book falls open
      — the cover alone, then verso facing recto. Honoured only where the pane
      is wide enough to give both pages a readable size; on a phone the reader
      still gets a single column, because two A4 pages inside 390px are not a
      spread, they are a picture of one. */
  pdfSpread: 'single' | 'double'
  /** 0–1 multiplier on the stock's own `--pdf-veil`, so a reader who wants the
      authored page exactly as printed can turn the tint off without leaving
      their stock. Capped by the stock, never above it: the ceiling is what
      keeps black ink on a veiled page above 7:1. */
  pdfVeil: number

  /** which tab the reading sheet opens on. A preference, not a setting: the
      sheet opens where it was last left because twelve of its fifteen controls
      are set once and the three that are not live on different tabs.
      SPEC.md § 8. */
  sheetTab: 'text' | 'page' | 'turn'

  /* ---- the app ---- */
  /** chrome theme, resolved separately from the page stock */
  theme: 'system' | 'light' | 'dark' | 'sepia' | 'ink'
  /** ids of included books the reader deleted. First-run seeding skips
      anything listed here, which is how "an update never puts back a book you
      deleted" is actually enforced. Cleared by Restore in Settings. */
  dismissedSeeds: string[]
}

/** A deletion, remembered.

    WITHOUT THIS, SYNC CANNOT DELETE ANYTHING. A merge that only ever takes the
    union of two sides will put back every book, highlight and bookmark the
    reader removed, the moment the other device is heard from — and it will do
    it again after every reconnection, which reads as an app that refuses to
    forget. So a delete writes a small stone recording that it happened, and
    the merge treats a stone as a fact about the row it names.

    A stone loses to a LATER edit of the same row on purpose: editing a note on
    the laptop after deleting it on the phone means the reader wanted the note.
    It also loses to a re-import, because a re-imported book has a new `id` and
    the stone names the old one — which is the same honest behaviour
    `toggleInCollection` already has.

    Kept small deliberately: an id, a kind, and when. Nothing about what was in
    the row, because a tombstone that carries the text of a deleted highlight is
    a deletion that did not happen. */
export type Grave = {
  /** `${kind}:${ref}` — one stone per thing, so deleting twice is one row. */
  id: string
  kind: 'book' | 'annotation' | 'bookmark' | 'collection' | 'locator'
  /** the id of the row that went. A book id for `book` and `locator`. */
  ref: string
  at: number
}

/** A shelf the reader made. SPEC.md § 1 gained a third view for these.

    Membership is an ordered array of ids on the collection rather than a join
    table, and the reason is the read pattern rather than laziness: the two
    questions asked are "what is in this collection" (one row) and "which
    collections is this book in" (a scan of every collection, which is a list of
    at most a few dozen tiny rows). A join table would make the second one an
    index lookup and the first one a query plus a sort, and would need its own
    ordering column to answer "in the order I put them there" — which the array
    answers by being an array.

    The three collections a reader starts with are NOT rows in here. Reading,
    Want to read and Finished are derived from `openedAt` and `finishedAt` every
    time they are drawn, so they cannot go stale, cannot disagree with the book's
    own record, and cannot be half-populated by a book added before the feature
    existed. A stored "Finished" collection would need a hook on every finish
    and would still be wrong for every book finished before it shipped. */
export type Collection = {
  id: string
  name: string
  /** book ids, in the order the reader added them. May name a book that has
      since been deleted — pruned on read rather than on delete, so removing a
      book stays one transaction over the tables that own its data. */
  bookIds: string[]
  createdAt: number
  updatedAt: number
}
