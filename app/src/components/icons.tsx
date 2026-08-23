/* Press's icon idiom, unchanged: hand-drawn strokes on a 24 grid, 1.8 weight,
   round caps and joins. Parts that must knock out fill with --tab-bg, which
   the nav CSS flips when a tab becomes the filled one.

   Remix Icon is NOT used here, and that is a deliberate exception to the
   global default. Press's set is hand-drawn, and one Remix glyph beside four
   hand-drawn ones is the mismatch you cannot stop seeing. Same brand, same
   hand. */

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export function ShelfIcon() {
  /* spines on a board — the lean is what separates a shelf from a bar chart.
     Press's own, and the right icon for a library in both apps. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <rect x="3" y="5" width="4.4" height="12.4" rx="1.2" />
        <rect x="9.8" y="6.3" width="4.4" height="11.1" rx="1.2" />
        <rect x="16.6" y="5" width="4.4" height="12.4" rx="1.2" transform="rotate(8 18.8 17.4)" />
        <path d="M2.2 20 L 21.8 20" />
      </g>
    </svg>
  )
}

export function HomeIcon() {
  /* A book standing open on a surface, seen end-on — the tent shape. Drawn
     rather than borrowed for the reason at the top of this file, and drawn as a
     BOOK rather than as a house on purpose: the home of this app is a book you
     are part-way through, and a house icon in an ereader says "web page". The
     ribbon is what separates it from ReadingIcon's flat spread. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M12 7.4 C 10 5.6 6.6 5 4 5.4 L 4 17.6 C 6.6 17.2 10 17.8 12 19.6" />
        <path d="M12 7.4 C 14 5.6 17.4 5 20 5.4 L 20 17.6 C 17.4 17.2 14 17.8 12 19.6" />
        <path d="M12 7.4 L 12 19.6" />
        <path d="M15.4 5.6 L 15.4 12 L 17.3 10.5 L 19.2 12 L 19.2 5.2" />
      </g>
    </svg>
  )
}

export function ReadingIcon() {
  /* an open book: two leaves off a centre fold, with the fold drawn as the one
     vertical. Not a spine gutter — that is banned on the reading page itself;
     at 20px in a nav it is the only line that says "open" rather than "shut". */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M12 6.6 C 10.2 5.4 7.6 4.9 4.4 5.1 C 3.9 5.1 3.5 5.5 3.5 6 L 3.5 17 C 3.5 17.5 3.9 17.9 4.4 17.9 C 7.6 17.7 10.2 18.2 12 19.4" />
        <path d="M12 6.6 C 13.8 5.4 16.4 4.9 19.6 5.1 C 20.1 5.1 20.5 5.5 20.5 6 L 20.5 17 C 20.5 17.5 20.1 17.9 19.6 17.9 C 16.4 17.7 13.8 18.2 12 19.4" />
        <path d="M12 6.6 L 12 19.4" />
      </g>
    </svg>
  )
}

export function SettingsIcon() {
  /* two slider rails; the thumbs knock out to whatever the pill is. Press's
     own — and doubly right here, where the settings ARE sliders. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M4.5 8 L 19.5 8" />
        <circle cx="9.5" cy="8" r="2" fill="var(--tab-bg, var(--card-w))" />
        <path d="M4.5 16 L 19.5 16" />
        <circle cx="14.5" cy="16" r="2" fill="var(--tab-bg, var(--card-w))" />
      </g>
    </svg>
  )
}

export function OpenIcon() {
  /* the one action: put a file in. A sheet with a corner turned, and an arrow
     going into it — not a plus, because a plus in a library means "write a new
     one" and nothing here is authored. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M13.5 3.6 L 6.6 3.6 C 6.1 3.6 5.6 4 5.6 4.6 L 5.6 11" />
        <path d="M18.4 9.4 L 18.4 19.4 C 18.4 20 18 20.4 17.4 20.4 L 6.6 20.4 C 6.1 20.4 5.6 20 5.6 19.4 L 5.6 18" />
        <path d="M13.5 3.6 L 18.4 9.4 L 14.5 9.4 C 14 9.4 13.5 9 13.5 8.4 Z" />
        <path d="M2.4 14.5 L 10.4 14.5" />
        <path d="M7.6 11.6 L 10.5 14.5 L 7.6 17.4" />
      </g>
    </svg>
  )
}

export function GridIcon() {
  /* four cover-shaped blocks, not four squares — the shelf's grid view shows
     objects with a book's proportions, and the icon should say which of the two
     views it switches to. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <rect x="4" y="3.6" width="6.6" height="8" rx="1" />
        <rect x="13.4" y="3.6" width="6.6" height="8" rx="1" />
        <rect x="4" y="13.4" width="6.6" height="8" rx="1" />
        <rect x="13.4" y="13.4" width="6.6" height="8" rx="1" />
      </g>
    </svg>
  )
}

export function ListIcon() {
  /* a spine and a title, three times over. The short leading bar is the cover
     thumbnail the list view actually draws, so the icon is a small elevation of
     the row rather than a generic hamburger. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M3.6 6 L 6 6" />
        <path d="M9 6 L 20.4 6" />
        <path d="M3.6 12 L 6 12" />
        <path d="M9 12 L 20.4 12" />
        <path d="M3.6 18 L 6 18" />
        <path d="M9 18 L 20.4 18" />
      </g>
    </svg>
  )
}

export function BackIcon() {
  /* one chevron and the rule it came from. Back to the shelf, and the shelf is
     the horizontal.

     Redrawn to an inked box of 14.8 × 14.8 so it sits in the same envelope as
     the other three in the reader's chrome — see the note above TypeIcon for
     the measurement that made that necessary. The chevron is deeper than it
     was (7.2 of rise against the old 6.4) because an arrow is the lightest
     drawing in any set and this is the only way to add mass to one without
     changing the stroke weight, which would break the hand. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M18.8 12 L 5.2 12" />
        <path d="M11.8 4.8 L 4.6 12 L 11.8 19.2" />
      </g>
    </svg>
  )
}

export function MoreIcon() {
  /* three dots, drawn as three one-unit strokes rather than circles — round
     caps make a stroke of zero length a dot, so this stays in the same hand as
     everything above it instead of introducing filled geometry. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M12 5.6 L 12 5.7" />
        <path d="M12 11.95 L 12 12.05" />
        <path d="M12 18.3 L 12 18.4" />
      </g>
    </svg>
  )
}

export function TrashIcon() {
  /* a bin with a lid and two staves. Deliberately not a cross or an X: this
     removes a book from a shelf, and the shelf is the thing being drawn. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M4.4 7 L 19.6 7" />
        <path d="M9.6 7 L 9.9 4.6 L 14.1 4.6 L 14.4 7" />
        <path d="M6.4 7 L 7.3 19.4 L 16.7 19.4 L 17.6 7" />
        <path d="M10.4 10.6 L 10.7 15.8" />
        <path d="M13.6 10.6 L 13.3 15.8" />
      </g>
    </svg>
  )
}

export function CheckIcon() {
  /* a tick with an uneven pen — the long arm overshoots slightly, the way a
     hand finishes the stroke */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M4.8 12.6 L 9.6 17.6 L 19.4 6.6" />
      </g>
    </svg>
  )
}

export function ResetIcon() {
  /* an arc back to the start, with the arrowhead at the beginning of the line
     rather than the end. Reset returns you to a place; it does not advance. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M4.6 6.2 L 4.6 11.4 L 9.8 11.4" />
        <path d="M4.9 11 A 7.6 7.6 0 1 1 8.4 18.9" />
      </g>
    </svg>
  )
}

/* ── the reader's own chrome ────────────────────────────────────────────
   Four more in the same hand. Each one is the thing it does drawn as a mark
   on paper, which is the rule the first eleven follow. */

export function ContentsIcon() {
  /* a table of contents: chapter titles with their leaders running out to the
     page numbers. The gap in each rule is the leader, not a dash — it is what
     a printed contents page looks like and what a hamburger does not.

     Narrowed from 15.5 to 15.0 and opened from 11.0 of inked height to 12.8:
     it was the flattest of the four, and three rules on an 11-unit band beside
     a 15-unit ribbon reads as a different icon size rather than a different
     icon. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M4.4 5.8 L 13.2 5.8" />
        <path d="M16.6 5.8 L 19.4 5.8" />
        <path d="M4.4 12 L 11.2 12" />
        <path d="M14.6 12 L 19.4 12" />
        <path d="M4.4 18.2 L 14.3 18.2" />
        <path d="M17.8 18.2 L 19.4 18.2" />
      </g>
    </svg>
  )
}

export function FindIcon() {
  /* a glass over a line of type. The two short rules under the lens are the
     text being searched — without them it is a magnifier for anything, and
     this one only ever searches words. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <circle cx="10.6" cy="10.6" r="6.2" />
        <path d="M15.2 15.2 L 20 20" />
        <path d="M7.6 9.4 L 13.6 9.4" />
        <path d="M7.6 12.4 L 11.6 12.4" />
      </g>
    </svg>
  )
}

export function TypeIcon() {
  /* two A's at different sizes — the size control is the first thing in the
     sheet and this is the mark for it. Drawn as letterforms rather than the
     usual "Aa" glyph so it stays a drawing and not a font sample.

     THIS is the icon that made the owner's second complaint true after the
     size bug was fixed. Measured at 20px, the four glyphs in the reader's
     chrome occupied inked boxes of 14.5, 12.0, 15.5 and — this one — 18.8 of
     the 20px square: 1.2px of air each side where the ribbon had 4. It read as
     the largest thing in the chrome because it WAS, by half again.

     Redrawn on a shared BASELINE at y 16.8, which is what the old pair did not
     have — the small A floated at 14.4 while the large one sat at 18.4, so
     they read as two icons rather than one size control. Inked box now
     15.0 × 11.2. The height is the shortest of the four on purpose: two A's on
     a baseline are a line of type, and a line of type is wide, not tall. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M3.2 16.8 L 6 10.2 L 8.8 16.8" />
        <path d="M4.3 14.2 L 7.7 14.2" />
        <path d="M9.6 16.8 L 14.1 5.6 L 18.6 16.8" />
        <path d="M11.4 12.6 L 16.8 12.6" />
      </g>
    </svg>
  )
}

export function BookmarkIcon({ filled = false }: { filled?: boolean }) {
  /* a ribbon with the notch cut out of its foot. Filled is the placed state:
     the same outline, inked in, so the tick in the corner of the page and the
     button that placed it are visibly one thing.

     Shortened from 15.5 of inked height to 13.2 and widened from 12.0 to 13.4.
     It was both the heaviest of the four in the reader's chrome (1236 inked
     pixels against the arrow's 713) and the narrowest, which is a bad pair: it
     read as a small dense mark beside three open ones. A closed outline will
     always carry more ink than a two-stroke arrow — that is a property of the
     drawing, not a defect — so the width was brought into line with the other
     three and the height traded away to pay for it. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps} fill={filled ? 'currentColor' : 'none'}>
        <path d="M6.2 5.4 L 17.8 5.4 C 18.3 5.4 18.7 5.8 18.7 6.3 L 18.7 18.6 L 12 14.5 L 5.3 18.6 L 5.3 6.3 C 5.3 5.8 5.7 5.4 6.2 5.4 Z" />
      </g>
    </svg>
  )
}

export function StatsIcon() {
  /* Three bars of unequal height and an uneven baseline gap — a chart drawn by
     hand rather than plotted. The bars lean the same 8° as the shelf's third
     spine, which is what keeps this in the same hand as the rest of the set
     instead of reading as a stock analytics glyph. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M3.4 20.2 L 20.8 20.2" />
        <path d="M6.6 20 L 6.6 13.4" />
        <path d="M11.9 20 L 11.9 7.6" />
        <path d="M17.2 20 L 17.2 11" transform="rotate(4 17.2 20)" />
      </g>
    </svg>
  )
}

/* ── P3: the marks ───────────────────────────────────────────────────────── */

export function HighlightIcon() {
  /* a chisel-tip marker at the angle you hold one, with the stroke it just
     laid down under it. The stroke is the wide flat line, not the pen — a
     marker drawn without its mark reads as a pen. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M9.2 14.4 L 5.9 17.7 L 8.1 19.9 L 11.4 16.6" />
        <path d="M9.2 14.4 L 16.9 6.7 C 17.5 6.1 18.4 6.1 19 6.7 L 19.6 7.3 C 20.2 7.9 20.2 8.8 19.6 9.4 L 11.4 16.6 Z" />
        <path d="M4.4 21.4 L 13.4 21.4" strokeWidth={2.4} />
      </g>
    </svg>
  )
}

export function NoteIcon() {
  /* a leaf with a turned corner and two written lines. The turned corner is
     what distinguishes a note from a page: something was folded to mark it. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M5.5 4.2 L 14.4 4.2 L 19 8.8 L 19 19.8 L 5.5 19.8 Z" />
        <path d="M14.2 4.3 L 14.2 9 L 18.9 9" />
        <path d="M8.6 12.9 L 15.6 12.9" />
        <path d="M8.6 16.2 L 13.4 16.2" />
      </g>
    </svg>
  )
}

export function CopyIcon() {
  /* two leaves, the back one offset. Not a clipboard: nothing here is a
     clipboard, and a rectangle behind a rectangle is the older, plainer sign. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <rect x="8.4" y="8.4" width="11.2" height="11.4" rx="1.8" />
        <path d="M15.8 8.2 L 15.8 6.1 C 15.8 5.1 15 4.3 14 4.3 L 6.2 4.3 C 5.2 4.3 4.4 5.1 4.4 6.1 L 4.4 13.9 C 4.4 14.9 5.2 15.7 6.2 15.7 L 8.2 15.7" />
      </g>
    </svg>
  )
}

export function LookUpIcon() {
  /* a book with a lens over it — the concordance, which is a book, searched.
     The lens sits proud of the top edge so both shapes stay legible at 20px. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M4.6 6.6 C 4.6 5.6 5.4 4.8 6.4 4.8 L 12.2 4.8 L 12.2 19.2 L 6.4 19.2 C 5.4 19.2 4.6 18.4 4.6 17.4 Z" />
        <path d="M12.2 4.8 L 15.2 4.8" />
        <circle cx="16.1" cy="12.2" r="3.9" />
        <path d="M18.9 15 L 21.2 17.3" />
      </g>
    </svg>
  )
}

export function MarksIcon() {
  /* three marks stacked, the top one longer: a list of things marked, which is
     exactly what the panel holds. The short middle line keeps it from reading
     as a plain list icon. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M4.4 7.4 L 19.6 7.4" strokeWidth={2.4} />
        <path d="M4.4 12 L 13.2 12" strokeWidth={2.4} />
        <path d="M4.4 16.6 L 17 16.6" strokeWidth={2.4} />
      </g>
    </svg>
  )
}

export function ExportIcon() {
  /* a leaf with an arrow leaving it upward — marks going out of the book, not
     a download coming in. Direction is the whole meaning of this one. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M12 14.6 L 12 4.6" />
        <path d="M8.4 8 L 12 4.4 L 15.6 8" />
        <path d="M5.2 13.6 L 5.2 18.2 C 5.2 19.1 5.9 19.8 6.8 19.8 L 17.2 19.8 C 18.1 19.8 18.8 19.1 18.8 18.2 L 18.8 13.6" />
      </g>
    </svg>
  )
}

export function CloseIcon() {
  /* the plainest cross on the grid. Used to dismiss the search field, where a
     back arrow would suggest leaving the book. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M6.6 6.6 L 17.4 17.4" />
        <path d="M17.4 6.6 L 6.6 17.4" />
      </g>
    </svg>
  )
}

export function CollectionsIcon() {
  /* Two covers behind a third, offset — a stack of books rather than a folder.
     A folder is a filesystem metaphor and this app has deliberately never shown
     the reader a file, so the icon for a group of books is books. The front
     cover is upright and complete; the two behind are clipped by it, which is
     what reads as depth without a shadow. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M7.6 6.6 L 7.6 4.4 L 18.4 4.4 L 18.4 6.6" />
        <path d="M5.8 9.2 L 5.8 7 L 20.2 7 L 20.2 9.2" />
        <rect x="4" y="9.6" width="16" height="10.4" rx="1.4" />
      </g>
    </svg>
  )
}

export function SortIcon() {
  /* Three rules of descending length with an arrow beside them: the length
     ramp is the sort, the arrow is its direction. Not an up/down chevron pair,
     which reads as a stepper. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M3.6 6.4 L 13.4 6.4" />
        <path d="M3.6 12 L 10.6 12" />
        <path d="M3.6 17.6 L 7.8 17.6" />
        <path d="M17.6 5.6 L 17.6 18.4" />
        <path d="M14.8 15.6 L 17.6 18.4 L 20.4 15.6" />
      </g>
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M12 5.2 L 12 18.8" />
        <path d="M5.2 12 L 18.8 12" />
      </g>
    </svg>
  )
}

export function ChevronIcon({ dir = 'down' }: { dir?: 'down' | 'up' | 'end' }) {
  /* One glyph, rotated, so the three directions cannot drift apart. `end` is
     the trailing edge rather than "right": in an RTL build the CSS flips it,
     and a component called RightChevron would be a lie there. */
  const turn = dir === 'up' ? 180 : dir === 'end' ? -90 : 0
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps} transform={`rotate(${turn} 12 12)`}>
        <path d="M6.6 9.6 L 12 15 L 17.4 9.6" />
      </g>
    </svg>
  )
}

export function EditIcon() {
  /* A nib over a rule — the same hand as the rest, and deliberately not a
     pencil-with-eraser, which at 17px is three shapes fighting for six pixels. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M15.4 4.6 L 19.4 8.6 L 9.2 18.8 L 4.6 20 L 5.8 15.4 Z" />
        <path d="M13.4 6.6 L 17.4 10.6" />
      </g>
    </svg>
  )
}

export function LeaveIcon() {
  /* An arrow stepping out of a box — the mark on every row here that leaves
     the app. Hand-drawn to match the rest of this file rather than pulled from
     Remix, for the reason in the header: one sourced glyph beside thirty
     drawn ones is the mismatch you cannot stop seeing.

     The box is deliberately OPEN at the corner the arrow leaves through. A
     closed square with an arrow over it reads as "download" at 16px; the gap
     is what makes it read as "out". */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M13.4 5.4 H 6 A 1.4 1.4 0 0 0 4.6 6.8 V 18 A 1.4 1.4 0 0 0 6 19.4 H 17.2 A 1.4 1.4 0 0 0 18.6 18 V 10.6" />
        <path d="M11.6 12.4 L 19.4 4.6" />
        <path d="M14.6 4.6 H 19.4 V 9.4" />
      </g>
    </svg>
  )
}

export function SearchIcon() {
  /* FindIcon's twin for chrome rather than for the reading bar: same lens, one
     grid step smaller in the handle so it sits in a 40px field without
     crowding the placeholder. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <circle cx="10.8" cy="10.8" r="5.8" />
        <path d="M15.2 15.2 L 19.6 19.6" />
      </g>
    </svg>
  )
}

export function CupIcon() {
  /* A mug with two curls of steam. Drawn rather than sourced, per the note at
     the top of this file: the tip jar's mark has to be in the same hand as the
     other nineteen or it reads as a badge pasted onto the page.

     The body tapers 0.9 of a grid step on each side between the rim and the
     foot, which is what stops it reading as a rectangle with a handle. Steam
     is two curls of different heights, not two of the same: matched curls look
     like a symbol, mismatched ones look like steam. */
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g {...strokeProps}>
        <path d="M9.9 7.4 C 9 6.6 9 5.8 9.9 5 S 10.8 3.4 9.9 2.6" />
        <path d="M13.1 7.4 C 12.4 6.8 12.4 6.2 13.1 5.6 S 13.8 4.4 13.1 3.8" />
        <path d="M5.4 9.6 H 16.8 L 15.9 18 A 2.6 2.6 0 0 1 13.3 20.3 H 8.9 A 2.6 2.6 0 0 1 6.3 18 Z" />
        <path d="M16.6 12 H 18.1 A 2.6 2.6 0 0 1 18.1 17.2 H 16.1" />
      </g>
    </svg>
  )
}
