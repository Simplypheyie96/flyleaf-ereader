# Reading Spec — Flyleaf eReader

Everything the reader can change, everything they can mark, and what the app puts on the shelf
before they have opened anything. `DESIGN.md` stays the authority on the look; this is the
authority on the **surface** — what controls exist, what they range over, what each one does to
the page, and what "done" means for each.

Written before the reader is built, because a control surface bolted onto a finished paginator is
how readers end up with a font-size stepper and nothing else.

---

## What this document changes

Three things move, and all three were decisions somebody had made. Each is recorded here rather
than edited away quietly.

**1. The first screen leads with a book, not with a button.** *(new)*
"Open a book" as the first thing an ereader says is a file manager introducing itself. The shelf
ships with books on it.

**2. The page curl was un-banned, built, and then cut.** *(a locked decision overridden, and
then restored)* `DESIGN.md` → Motion said *"the turn is a slide, never a curl"*, and Banned listed
*"a page curl"*. The owner asked for curl explicitly, so it was built — transform-only,
shadow-free, its back face a second render of the section rather than a flat tint. It **passed**
its frame gate. The owner then cut it on how it felt beside the fold in Apple Books, which is the
one verdict no measurement can appeal. So the ban is back, and now unconditional: three styles
ship, and the reasoning plus every number the curl was measured against is kept in § 5.2.1 so it
is not rebuilt on the theory that performance was the missing piece.

**3. Grain was asked for, and it landed outside the text.** *(declined, then granted on the
owner's word, on the terms the refusal named)* This section first refused a paper texture and said
what would change the answer: *"if real grain is wanted, say so and it goes outside the text column
only — in the margin band, never behind a letter."* The owner said so — *"add paper texture to the
app overall"*, then *"the texture shouldn't be too grainy. subtle but visible"* — so it shipped on
exactly that condition.

It is one `feTurbulence` tile as a data URI (`--grain`), and the thing that made it read as grain
rather than as dirt was **frequency**, not opacity: `baseFrequency` .62 over four octaves,
desaturated, at .20. It composites through `background-blend-mode: var(--grain-blend)` —
`multiply` on a light ground, `screen` on the two dark ones, because multiply has nothing to darken
against near-black. The blend mode is why it must sit on an element that owns its own background:
blending against a transparent parent is blending against nothing.

**The reading surface is not grained.** The chrome is: the shell, the cards, the sheet plates. A
book's page stays flat, because grain under a paragraph read for an hour is a texture whatever its
opacity — which is the half of the original ban that still holds.

---

## 1. The shelf, before there is anything on it

### 1.1 Two books, included

The app ships with two public-domain books already on the shelf, from
[Standard Ebooks](https://standardebooks.org) — public-domain dedication, no trademark
boilerplate to strip, and typeset properly, which matters when the whole point of the app is
typesetting. Project Gutenberg files carry a licence header that has to be removed before
redistribution; Standard Ebooks do not.

The pair is chosen to exercise the engine, not just to fill space:

| Slot | What it has to be | Shipped |
|---|---|---|
| **A short one** | Finishable in a sitting, so the *first* book someone opens can actually be finished. Small file, instant open. | *The Time Machine* — H. G. Wells · 18 sections · 536 KB |
| **A long one with parts** | Real chapter tree and a real cover. Proves the TOC, cover extraction and per-chapter progress on something with 60 sections. | *Pride and Prejudice* — Jane Austen · 65 sections · 832 KB |

**Budget: 2.5MB for both, combined**, precached. **Actual: 1.30 MiB**, both files under Workbox's
2 MiB per-file default, so the precache limit does not have to be raised.

*Alice's Adventures in Wonderland* held the long slot until the file was measured: the
Tenniel-illustrated edition is **18.4 MB**, 7× the budget. The rule above is that the book
changes and the budget does not, so the book changed. Austen's 65 sections are the better test
anyway.

Editions, exact filenames, byte sizes, cover sizes and each book's licence line are recorded in
`app/public/seed/MANIFEST.md`. A seed file whose provenance is not written down does not ship.

### 1.2 How they arrive without a network

`app/public/seed/*.epub` plus a `seed.ts` manifest of `{ id, file, title, author, format, bytes }`.
On first run — the same signal that writes the default settings row — each seed is fetched from
**the app's own origin** and imported through the ordinary import path. No special-cased reader,
no second code path: a seed book is a book that was imported by the app instead of by a person.

That fetch is same-origin and precached, so it is offline-safe by construction. The one state
that could fail — no network *and* no precache — cannot happen, because in it the app itself
would not have loaded. The guardrail holds: nothing here needs a network to work.

### 1.3 Deleting them, and getting them back

- `Book.seeded = true`. The shelf labels these **INCLUDED** in mono, so nobody wonders where
  they came from.
- Remove is the ordinary remove, with the ordinary confirm. No "are you sure, these are free!"
- The removed seed's id goes into `Settings.dismissedSeeds`. First-run seeding skips anything
  listed there, so **an update never puts back a book someone deleted.** That is the same promise
  as "updates never clear local data", pointed the other way.
- Settings → Your library gains **Restore included books**, which clears the list and re-seeds.
  Present always, not only when something has been dismissed — a control that appears and
  disappears is a control nobody finds twice.

### 1.4 The empty state, now that it is rare

Deleting everything is the only way to reach it, so it stops being a launch screen and becomes
what it actually is: an empty library.

- Mark, then **"No books yet"**. This read "Shelf's clear" until the owner said "I don't
  understand shelves" of the Shelves/Collections split; the same word was doing the same
  damage in a heading, where there is no room to define it. "Shelf" now appears in no
  user-facing label, heading or sentence anywhere in the app — the Home empty state, the
  Stats section head, the Settings restore copy, the Open-book duplicate notice and the
  collection definition were all changed with it, so the word is gone as a synonym for
  "library" rather than merely gone from one screen. The Home empty state keeps its own
  heading, "Nothing to read yet", because it is a different question from an empty library.
- One line of copy, the format list (unchanged, per the P0 audit).
- Two actions, in this order: **Open a book** (primary) and, when anything was dismissed,
  **Bring back the included books** (text, hairline, secondary).
- Centring, gutters and rhythm are already specified and measured — `DESIGN.md` → Space.

### 1.5 The first-run shelf itself

No hero. It is the ordinary Library screen with two rows already on it, which is the entire
point: the app is in the state it will be in forever after, on the first frame.

- No Continue row — nothing has been opened, and a Continue row pointing at a book you have
  never read is a lie the shelf tells about itself.
- Under the last row, one hairline and one line of mono: **YOUR OWN BOOKS · EPUB · MOBI · …**,
  the formats as text, with the words *your own books* as the link to `/open`. Import is the
  quiet second thing on this screen, not the loud first thing.
- The round ink add button in the nav is already there and already does this. The line above is
  for discovery, not for parity.

---

## 2. Stocks — the reading themes

Four becomes seven. Press's four are untouched; three are added, each for a reading condition
the four do not cover, and each measured before it went in this table.

| Stock | Ground | Ink | Ink-soft | Ratio | For |
|---|---|---|---|---|---|
| **Press** | `#FFFFFF` | `#1B1917` | `#6B655C` | 17.53 / 5.77 | Bright rooms, maximum contrast |
| **Day** *(default)* | `#F4F2ED` | `#1B1917` | `#6B655C` | 15.67 / 5.16 | The app's own paper |
| **Butter** | `#F6EBD9` | `#1B1917` | `#6B655C` | 14.86 / 4.89 | Light sepia. Evening |
| **Tea** **NEW** | `#EADCC3` | `#2A231C` | `#5E5346` | 11.45 / 5.54 | The deep brown-paper one. Warm ink, not black on tan |
| **Coal** | `#221E1B` | `#F4F2ED` | `#A39B92` | 14.79 / 6.03 | Night. Black *paper* |
| **Dusk** **NEW** | `#1B2430` | `#D9E4F2` | `#96A6BB` | 12.17 / 6.31 | The blue night stock. Cool by instruction — see the rules below |
| **Pitch** **NEW** | `#000000` | `#BFBAB2` | `#8A857E` | 10.88 / 5.74 | True black for OLED and dark rooms. Ink deliberately *not* white |

Ratios are ink-on-ground and ink-soft-on-ground, computed (WCAG relative luminance), not
estimated. Every pair clears AA for body text at every size in the range; the softs clear 4.5:1
too, because the progress readout is normal-size text and 3:1 is a large-text allowance this app
never uses.

**Why three and not thirty.** Seven stocks each answer a different room. A colour picker answers
none of them and turns a reading app into a theme editor. There is no custom stock, and that is
a decision, not a gap.

**Rules**
- Warm only, **with exactly one exception.** `DESIGN.md` bans cool-grey surfaces and a
  blue-shifted page, and Dusk shipped warm (`#2E2823` on `#E4D9C6`, 10.42) to honour that. The
  owner then found it too close to Coal and asked for "the blue ink thing here", so Dusk is now
  `#1B2430` / `#D9E4F2` — the Ink chrome theme's own two values, borrowed rather than a new
  colour invented, and measured at **12.17:1**, a *higher* pair than the warm one it replaced.
  The guardrail stands for every other stock; this is the one place a live instruction overrode
  it, and the highlight washes were re-measured against the new ground (`index.css`, the note
  above `[data-stock="dusk"]`).
- Ink is never pure white on a dark stock. `#FFFFFF` on `#000000` at 18px over 300 pages is a
  headache; Pitch's `#BFBAB2` is the considered version of the same idea.
- The stock is independent of the chrome theme, unchanged, and the app never changes it on the
  reader's behalf. No auto-switch at sunset, no ambient-light guessing.
- A stock change is a **repaint, never a fade** — `DESIGN.md` → Motion, unchanged.
- Highlight tints get a per-dark-stock alpha, **measured to 4.5:1 against that stock's ink before
  it ships**. Three dark stocks × five tints is fifteen measurements at P3, and no tint is
  approved by eye. Where a tint cannot clear it, the treatment falls back to the margin bar
  already specified for Coal.
- **An author colour never reaches a dark stock.** Every trade EPUB ships light-mode colours, and
  on Coal, Dusk or Pitch a `#1A1A2E` dedication is simply gone. So on a dark stock every author
  colour, text fill, background box and text-shadow is collapsed to the stock's own ink —
  `reader/readingCss.ts`, the comment block at the dark branch — which is what Apple Books does
  in its dark themes, for the same reason. Measured rather than asserted: `audit/darkstock.mjs`
  opens an EPUB that fights the stock seven different ways and reads the *rendered* pair inside
  the section iframe.

  | Route the colour takes | Coal | Dusk | Pitch |
  |---|---|---|---|
  | a stylesheet rule | 14.79 | 12.17 | 10.88 |
  | an inline `style` attribute | 14.79 | 12.17 | 10.88 |
  | the book's own `!important` | 14.79 | 12.17 | 10.88 |
  | `-webkit-text-fill-color` | 14.79 | 12.17 | 10.88 |
  | a light `background-color` box | 14.79 | 12.17 | 10.88 |
  | a light-page `text-shadow` | 14.79 | 12.17 | 10.88 |
  | no author colour at all *(control)* | 14.79 | 12.17 | 10.88 |

  Twenty-one rendered pairs, every one identical to that stock's own ink-on-ground row in the
  table above — which is the actual assertion. The reset **collapses**, it does not merely
  lighten: a page showing three different near-inks would mean three rules each got part of the
  way, and the driver fails on more than one distinct ink per page. No box survived, and no
  shadow. `background-image` is deliberately left alone: a book's pictures are the author's.
- No brightness or warmth filter over the text. `filter` on the reading pane is a paint on every
  frame and would break the turn's transform-only rule for a job the stock already does.

---

## 3. Type controls

| Control | Range | Default | CSS | Notes |
|---|---|---|---|---|
| **Face** | Literata · EB Garamond · Source Serif 4 · Newsreader · Atkinson Hyperlegible | Literata | `font-family` | Alternates load on selection, never at boot |
| **Publisher's font** | off · on | **off** | keep/strip the book's `@font-face` | Off means the reader's face wins everywhere. On honours the book — which matters for poetry and technical setting, and ruins a badly-made EPUB. The reader's call, defaulting to ours |
| **Size** | 14–28px, continuous | 18px | `font-size` | Continuous, not stepped — `DESIGN.md` |
| **Weight** | Light · Regular · Medium | Regular | `font-variation-settings: 'wght'` 350 / 400 / 450 | Literata is variable, so this is free and it is the honest version of every reader's "bold text" toggle. Faces with only static weights map to 400/600 and the middle tier is hidden — a control that lies about what it does is worse than one that is absent |
| **Leading** | 1.2–2.2, continuous | 1.6 | `line-height` | |
| **Word spacing** | −0.04em … +0.24em | 0 | `word-spacing` | Negative is included and clamped tight: it is how you rescue a justified narrow measure |
| **Letter spacing** | −0.02em … +0.10em | 0 | `letter-spacing` | **Disabled, with a one-line reason shown, for connected and complex scripts** — Arabic/Persian/Urdu, Devanagari and the Indic family, Thai, Khmer, Myanmar — where tracking breaks shaping. Permitted for CJK. Keyed on the book's declared language |
| **Paragraphs** | As published · Indented · Spaced | As published | `text-indent` / `margin-block` | Indented = 1.2em, no gap. Spaced = no indent, 0.7em gap. Never both — a paragraph that is indented *and* spaced is two answers to one question |
| **Alignment** | As published · Left · Justified | As published | `text-align` | |
| **Hyphenation** | off · on | off | `hyphens: auto` | Needs a `lang`. When the book declares none, the control greys out and says so rather than pretending to work |

**One interaction rule, because it is the commonest way reading gets worse:** turning Justified
on while hyphenation is off, on a measure under 30em, puts a single hairline note under the
control — *"Justified narrow text without hyphens leaves rivers. Hyphenate?"* — with the toggle
inline. A note, not a modal, and it does not appear twice for the same setting.

---

## 4. Layout controls

| Control | Range | Default | Notes |
|---|---|---|---|
| **Side margins** | 4–12% of the pane per side | 8% | Symmetric to the pixel. Unchanged from `DESIGN.md` |
| **Line width** | Narrow 30em · Comfortable 34em · Wide 40em | Comfortable | Only bites on panes wider than the measure, so it is a desktop and iPad control that does nothing on a phone — and is therefore hidden on a phone rather than shown doing nothing |
| **Columns** | Auto · One · Two | Auto | Auto = two above 1180px. Two is available below it and will look wrong; that is the reader's business |
| Vertical | — | — | **Not a control.** 24px above the first line, foot rule 28px below the last. Two more sliders for a thing nobody tunes |

---

## 5. Flow, and the turn

### 5.1 Flow

| Flow | Behaviour |
|---|---|
| **Paginated** *(default)* | Discrete pages. The turn styles below apply |
| **Scrolled** | One continuous column per section. Native momentum, **no scroll-snap** — snap on a reflowable book fights the finger. A hairline and the chapter name in Playfair mark each section break. The progress readout drops "page n of m" and reads `34% · 12 MIN LEFT IN CHAPTER`, because there are no pages to count. Tap zones do nothing but toggle chrome |

Choosing Scrolled hides the turn control rather than greying it — there is no turn to style.

#### Crossing a chapter in Scrolled flow

foliate only ever leaves a section through `next()`/`prev()`; its own scroll handler relocates
*inside* the section and never crosses. In Paginated flow that costs nothing, because every turn
already goes through `next()`. In Scrolled flow it means native scrolling stops dead at the bottom
of every chapter and the only way on is the arrow keys, which a phone does not have.

So the end of a section is not a wall and it is not a gate either — **the scroll simply carries
on into the next chapter**, the way it does in every other reader. When the column has nothing
left and the scroll is still going that way, it crosses. There is no distance to overcome, no
pause to wait out, no second gesture: a chapter boundary is not somewhere the reader should have
to push through, it is somewhere they should not notice.

A first pass gated this behind 72px of extra pull and a 500ms idle reset, reasoning that resting
at the last paragraph should not carry you onward. In the hand it read as the book jamming at
every chapter, which is worse than the thing it guarded against — and resting is safe anyway,
because resting produces no scroll events at all.

| | Value | Why |
|---|---|---|
| Threshold to cross | none | One scroll event past the end, in that direction |
| Cooldown after a crossing | 450ms | A flick keeps firing after the finger is gone; without this one flick walks three chapters. Long enough to outlast the load, short enough that a reader who wants two chapters can have them |

Forward lands at the **top** of the next chapter; backward lands at the **bottom** of the previous
one, so a reader going back arrives where they left. Non-linear sections are skipped, and the last
and first sections are guarded here rather than left to upstream, which reports "go on" at the end
of every section including the last.

This lives at `app/src/reader/scrollCross.ts`, outside the vendored tree, against public API only —
so foliate stays upstream source with nothing to re-apply on an update.

**Done means:** scrolling off the bottom of a chapter continues into the next with nothing in the
way; the same backwards; the first and last chapters do not cross; and one flick never advances
twice.

### 5.2 The three turn styles

All three track the finger, 1:1, on every page of the book — the thumb must never be able to
feel where a chapter ends. What differs is what the finger is dragging.

| Style | What moves | Tracked | Commit | Layers | Cost |
|---|---|---|---|---|---|
| **Slide** *(default)* | `translateX` on the incoming and outgoing pages, 1:1 | position | **260–420ms**, velocity-derived, `cubic-bezier(.16,1,.3,1)` | 2 | The cheapest thing that reads as a page |
| **Fade** | `opacity` only, no translate | opacity | **120ms** flat, `linear` | 2 | Free on anything. "Fast fade" |
| **Instant** | Nothing. The page changes | threshold only | **0ms** | 1 | The e-ink cut. For readers who dislike motion and devices that cannot afford it |

**Slide**: the outgoing page slides, and nothing is drawn between it and the incoming one. An
earlier build put a 1px `--rule` hairline on the leading edge, as a page separating from a page.
On screen it read as a glitch — a line parked over the text — and it was removed outright rather
than repositioned. No hairline, no shadow, nothing in the gap.

**Crossing a chapter**, which is the one turn a transform cannot finish on its own: the engine
does not lay the next section out until the outgoing page has already scrolled off. So the turn
is the same slide, at the same duration, on the same curve — what it reveals is blank paper of
the page colour, which is what is there anyway — and only the **arrival fades in, 140ms linear**.
The gesture is not damped and the commit threshold is not moved: a crossing is a page turn like
any other to the hand. Under **Fade**,
**Instant** and reduced motion the crossing is simply that style's own transition.

#### 5.2.1 The Curl, and why there is not one

A fourth style shipped into this list for one build and was cut. This subsection is the whole
record of it, kept for one reason: **it was not cut for being slow.** It measured green on the
gate that was written for it, and the owner cut it anyway, on how it felt beside the fold in
Apple Books. Anyone reading this later and thinking "a faster one would have survived" is reading
it wrong. The ban in `DESIGN.md` is back and now has no escape clause.

**What it was.** Not a warp. A fold: three nested `overflow:hidden` boxes and one `scaleX(-1)`,
no `rotateY`, no `perspective`, no mesh, and — the part of the original ban that always bound —
**no shadow**. For page width `W` and finger travel `d` the crease sat at `f = W − d/2`, the fold
covered `[W − d, f]`, and the next page was already at `[f, W]`: the same single translate the
slide uses, because page N and N+1 are two windows onto one multi-column strip. Its back face was
a second render of the section the reader was in, `importNode`d from the **live** iframe *after*
foliate had columnised it — so it inherited foliate's `!important` column geometry and broke the
chapter at the same words the reader was looking at. On the fixture's largest section the mirror
held 5486 nodes to the live section's 5486, with byte-identical column-edge sets. The copy was
taken between turns on `requestIdleCallback`, never under a finger, and any section over 1500
elements was refused, falling back to a flat-toned wedge.

**What it measured**, at 4× CPU throttle, nothing measuring inside the gesture window:

| Window | Layout | Paint | Longest task |
|---|---|---|---|
| Ten tracked frames, 5486-element section (wedge) | **0** | **0** | **1.9ms** |
| Ten tracked frames, 713-element section (mirrored), 67,000px into the strip | **0** | **0** | **1.4ms** |
| Commit window, mirrored section | — | — | **no task over 50ms** |
| Commit window, refused section | — | — | **62ms** — foliate's own relocate; Slide with no fold at all measures 66ms on the same gesture |

The 1500-element cap was derived rather than guessed, from `importNode` plus the reflow its
columns force — 713 elements → 73.9ms, 1026 → 68.3ms, 5486 → 424.0ms, so roughly 0.08ms per
element under that throttle, none of it interruptible. Against that, the two included books run
11–178 elements per section, medians 61 and 24.

**Two findings from that work outlived the style**, and both are load-bearing elsewhere in this
document. A CDP tracing session inflates long tasks substantially — the same commit window read
~200ms traced and 62–69ms untraced — so anything gated on a *duration* uses a `PerformanceObserver`
longtask observer and never a trace over the same gesture; event *counts* are unaffected. And
gesture travel is read in `screenX`, not `clientX`, because under the fold `clientX` went
non-monotonic (`-40 -15 -99 -53 -163 -123` against a true `-40 -80 -120 -160 -200 -240`). The
style is gone; that rule is not. § 5.4 keeps it.

**What was removed.** `app/src/reader/foldMirror.ts`, every curl branch in
`app/src/reader/turn.ts`, the `--fold-back` token in both its definitions, the
`[data-turn="curl"]` seam rule, the control in the sheet, and the drivers `audit/fold.mjs`,
`audit/fold-cost.mjs` and `audit/fixtures/make-long-book.mjs`. `audit/controls.mjs` now *asserts*
that exactly three styles are offered and that Curl is not one of them. `Turn` narrowed to
`'slide' | 'fade' | 'instant'`, and a stored `turn: 'curl'` from the build that shipped it is
mapped to Slide by the settings merge in `db.ts` — read-side, never a migration, because a
migration that rewrites a settings row is a migration that can lose one.

Two things the removal *fixed*, worth recording because they were masked by it. A tap- or
key-driven turn never called `#measurePane()` — the call sat inside the curl guard — so a **slide**
turn drew its hairline a whole pane inset to the left of the edge it belongs on (15.6px measured on
a 390px phone). And `#liveOffset` had to double the matrix translate, because the curl moved the
content layer by half the offset; with one style family left, the layer's translate *is* the
offset again.

**Every style, every device:** `prefers-reduced-motion` overrides the setting with the 150ms
cross-fade already specified, and stops the tracked drag from transforming. The gesture still
pages; it just does not move.

### 5.3 What starts a turn

| Input | Behaviour |
|---|---|
| **Swipe** | Tracked 1:1. Requires **8px of horizontal travel** before it claims the gesture — below that, the touch belongs to text selection. There is deliberately **no time window** on it: an earlier build only claimed inside 200ms, so a slow deliberate drag travelled its 8px, missed the window and left the page sitting still, which is what "the slide is resisting" was. A horizontal drag turns the page however long the reader takes over it. By **mouse** the threshold is **24px** and the turn stands down if a selection has actually formed — a measured fact rather than a guess at intent, and the reason a desktop drag now turns at all |
| **Tap zones** | Left third back, right third forward, middle third toggles chrome. Setting: **Tap to turn**, default on. Off leaves the whole pane as a chrome toggle |
| **Keyboard** | `→` `Space` `PgDn` forward · `←` `⇧Space` `PgUp` back · `Home` `End` book ends · `T` contents · `F` find · `B` bookmark · `+` `−` size. Flat 300ms on the commit curve |
| **Edges** | At **the book's own first and last page** — not at a chapter boundary — a drag meets rubber-band resistance (Apple's constant, 0.55) and springs back over 220ms. It never turns and it never feels stuck |
| **Commit** | Distance **plus projected momentum** (iOS deceleration, 0.998) past half a page, on every page alike. A short drag placed and held springs back; the same distance thrown carries. A finger that stops before it lifts has stopped: velocity is read over the last **100ms** only, and an empty window is zero, never the gesture's average |
| **RTL** | A book declaring `page-progression-direction="rtl"` mirrors swipe direction and tap zones. Arrow keys stay *visual* — `→` is always the page on the right, which is what every platform does and what hands expect |

---

## 6. Marks

### 6.1 Highlights and notes

Five tints, per `DESIGN.md`, drawn behind the words. Applying one animates a **140ms
left-to-right wipe** of the fill, once, on apply — a mark being made. Never on render.

A note is Kalam on `--card-w` with the highlighted line quoted above it in the reading face at
13px. Unchanged.

### 6.2 Bookmarks

- A ribbon toggle at the top-right of the reading chrome, and `B`.
- A bookmarked page shows a **2px × 18px `--accent` tick** at the top-right **inside the margin**
  — never over a letter. It is the one place the accent appears on a reading page besides the
  terracotta underline, and both are printed marks.
- Bookmarks are CFI-anchored like everything else, so they survive a font change.

### 6.3 The book's marks list

Three segmented tabs — **Highlights · Notes · Bookmarks** — grouped by chapter in reading order,
which is what the `[bookId+cfi]` compound index already exists for. Tap jumps. Long-press edits
or deletes. A count in mono at the head of each group.

**Export**: Markdown *(default)*, plain text, or JSON. Title and author as a header, then each
mark as a blockquote with its chapter, the note beneath in italics, in reading order. Copy to
clipboard or download. No page numbers — this book does not have any (`DESIGN.md`).

### 6.4 Search

In-book, whole-book. The index is built lazily per section on first search and kept in memory,
not in IndexedDB — it is derivable, and a stale search index in a database is worse than no
search index. Mono count, match in context, hits ticked in the margin bar for the current
chapter.

### 6.5 Look up

The offline answer first: **"Look up" shows every other place that word appears in this book** —
a concordance, which is genuinely more useful inside a novel than a dictionary definition, and
which is really just search with a nicer face. Always available.

Beneath it, when and only when `navigator.onLine`, one labelled row that opens **Wiktionary** in
a new tab. Labelled as leaving the app, absent when offline. It is an enhancement that degrades,
never a feature that needs a network.

### 6.6 Going to a place in the book

**The readout is the control.** `PAGE 4 OF 14 · XLIII · 63%` is the thing on screen that says
where you are, so it is the thing you press to be somewhere else — a jump reached from a line of
text sitting *beside* the readout is a jump nobody finds. It is a button, it inverts to ink while
open like every other reader control, and it opens the **Go to** block in the sheet row, so the
page shrinks and reflows once and the reader can see the book behind the control they are setting.
It closes the settings sheet and the panel, and they close it.

The same block also stands in for the contents list on a book that has none — a plain `.txt`, a
Markdown export, a hand-made EPUB — where the Contents tab used to say *"This book carries no
contents list"* and stop. There it keeps that sentence as a lead-in; from the readout it needs no
explanation and carries none.

**One control, one field and three buttons:**

| | |
|---|---|
| **Position** | A slider, 0–100, step 1, seeded from where the reader currently is. |
| the % field | The same number, typed. Its own string while being edited, so an empty or half-typed field is allowed to exist; every keystroke that parses moves the slider. **It does not wait for Enter** — measured on a real keypress, Return never reaches the field, and a field that only commits on a key the page eats is a field that does nothing. |
| **Go to N%** | Commits. Filled — the one filled control in the block. |
| **Beginning** | `goToFraction(0)`. |
| **End** | `goToFraction(1)`. |

Rules it is built to, all three of which it would be easy to break:

- **It commits on a press, never on the drag.** Every intermediate value of a drag is a whole
  re-layout of the book at a new place in it, and the reader did not ask to go to any of them.
- **A percentage is a control here, not a position.** Nothing stores it. The jump lands, the
  engine reports a locator, and what is written to the record is that locator's **CFI**, exactly
  as after a page turn — `CLAUDE.md`'s "position is a CFI" is untouched.
- **It is proportion, not pagination.** No page number is invented for a reflowable book; the
  slider says how far through, which is the only true thing available.

**It follows the book until it is touched.** The block can be left open while pages turn, and a
slider showing where you *were* under a readout showing where you *are* is worse than no slider.
So it re-seeds on every relocate — until the reader moves the slider or types in the field, after
which it is theirs and the book stops overwriting it.

**Done means:** pressing the readout opens the block and inverts the capsule; typing a number
moves the slider without Enter; **Go to** lands there and closes the block; Beginning and End land
at 0% and 100%; the readout agrees; a book with a contents list still shows its chapters, and one
without shows this block with its lead-in; and the position that survives a reload is a CFI.

### 6.7 Where you are in the contents

A contents list that does not say which entry you are reading is a list of places you have to
recognise. On a book that numbers its chapters in roman — sixty-five entries reading I, II, III —
recognising is not possible at all, so the list has to say it.

Three signals, all hung off `aria-current="location"` on the current entry, because a weight or a
colour says nothing to a screen reader:

| | |
|---|---|
| **The rest dim** | Every entry sits at `--ink-soft`; only the current one is full ink. This is the signal that does the work — bolding one line among sixty-five does almost nothing while the other sixty-four are already at full ink, and least of all on roman numerals, which are too short to carry a weight change. Measured AA on all seven stocks (4.62:1 on `tea`, the narrowest; 6.31:1 on `dusk`). |
| **Weight** | 700 on a top-level entry, 600 on a sub-entry, so depth still reads. |
| **An edge bar** | The `.note-quote` device two steps heavier — 4px rather than 2px, near the row's full height, on `--accent`, which inside the reader is that stock's own ink. Drawn as a pseudo-element, not a border, so the label does not step sideways when the reader moves into a chapter. Weight alone is a comparison and only works if the neighbours are on screen; the bar is absolute. |

Matched on **href**, never on label: a book that numbers its parts I, II, III and its chapters
I, II, III again has labels that repeat and hrefs that do not.

And the entry **scrolls itself into view** on mount, centred, instantly. Marking chapter XVIII is
worthless when it sits 1100px down a panel 812px tall — measured, not guessed. Instant rather than
smooth: a panel opening is not a motion moment, and a list that visibly races to a position is
worse than one that is simply already there.

**Done means:** exactly one entry carries `aria-current` at any time; it matches the chapter in the
readout; it is on screen the moment the panel opens; the label does not shift horizontally as the
current entry changes; and a nested entry marks itself on the same test as a top-level one.

---

## 7. The library

- **Continue** row at the top: last-opened book, its progress hairline, and the chapter name.
  Absent, not empty, until something has been opened.
- Groups **Reading · Finished · All**. Covers-or-list toggle, persisted.
- **Sort**: Recently read · Recently added · Title · Author.
- **Shelf search** over title and author. It appears once there are more than 12 books — a search
  field above four books is furniture.
- **Book sheet**: cover, title in Playfair, author, one mono row of `FORMAT · SIZE · ADDED`,
  progress, marks count. Actions: Read · Mark as finished · Reset position · Remove.
- **Remove** confirms by naming exactly what goes — *"the file, your place in it, and 14
  highlights"* — and for an included book adds that it can be brought back from Settings.

### 7.1 Who owns a cover's object URL

The rule, because getting it wrong produced the one bug a reader actually reported — *"some book
covers are glitching, they will show cover one minute and not show it another minute"*:

- **The URL is minted by a module-level cache in `Cover.tsx`, keyed on `id:size:type`, and derived
  during render.** Not in an effect, and not owned by the mount. Every place a book appears —
  Home's continue rail and its recent shelf at the same time, the shelf, the sheet — shares one
  decode of one Blob.
- **No revoke on unmount.** The old code created the URL in an effect and revoked it on cleanup,
  which put a revoke one render ahead of the `<img>`'s `src`: `setUrl` is a state update, so the
  element still pointed at the revoked URL for a render, and with `decoding="async"` and a cover
  still in flight — the normal case on a phone — the aborted load fired `error`.
- **The memory that revoke protected is not at stake.** `Library.tsx` reads the shelf with
  `toArray()`, so every cover Blob is already retained for as long as that query is live; an object
  URL is a handle onto a Blob being held anyway, not a second copy. Covers are bounded near 120KB
  by `shrinkCover`. The cache's `LIMIT` of 512 is a runaway guard, not a memory strategy, and it
  must not be tightened: a cap small enough to bite evicts URLs whose `<img>` is still on screen,
  which reproduces the reported glitch inside the cache meant to fix it.
- **One error is not evidence.** A spurious error and a genuine decode failure are the same event
  with the same fields, so the first failure is retried — the URL is dropped and minted again.
  Corrupt bytes fail twice and get the designed "No cover" ghost; an interrupted load simply
  succeeds. Nothing ever latches on a single event: the old `dead` flag cleared only when the
  cover's shape changed, and a book's shape never changes, so one aborted load ghosted a good
  cover for the rest of the session and came back only on a remount.

- **A successful load resets the count.** The two failures that ghost a cover have to be
  consecutive. Without `onLoad` clearing the count they need not be — one interrupted load now and
  another an hour later add up to a verdict about a cover that has decoded correctly a hundred
  times in between, which is the second reported form of this bug: a cover that was there, then
  was the format ghost, and stayed the ghost until a reload.
- **An error never revokes.** It drops the cache entry so the retry mints a fresh URL, and leaves
  the old handle alone. The same book is on screen in more than one place and those copies share
  the URL; revoking it aborts *their* in-flight decodes, which is one error each, which is the
  second failure, which is the ghost — the cascade the cache exists to prevent. The stale handle
  leaks once per failure, on a Blob the shelf query retains anyway.
- **A verdict does not outlive the mount that reached it.** `undecodable` is module-level so that
  the two failures can come from two copies of one book on one screen, not so a book stays ghosted
  for the session. Any fresh mount clears it and tries the bytes again, at the cost of one decode
  of an at-most-120KB image.

`audit/covers.mjs` is the gate. Its third question is the direct regression guard — a single
`error` dispatched at a loaded, valid cover must recover to an image, not to the ghost — and
question 3b is the guard for the non-consecutive form: two errors with a **successful load between
them** must also recover.

---

## 8. Where the controls live

One sheet, three tabs, in this order. Every control shows its effect **live behind the sheet**,
per `DESIGN.md`.

| Tab | Holds |
|---|---|
| **Text** | Face · Publisher's font · Size · Weight · Leading · Word spacing · Letter spacing · Paragraphs · Alignment · Hyphenation |
| **Page** | Stock (7) · Side margins · Line width · Columns |
| **Turn** | Flow · Turn style · Tap to turn |

Size, stock and turn style are the three anyone touches twice, so **Size** heads Text, **Stock**
heads Page, and the tabs open on whichever was last used. The other twelve are set once and
forgotten, which is exactly where a second tab is for.

None of this is duplicated into the Settings screen. Reading settings belong to the reading
surface; Settings keeps chrome theme, this device, your library, and version. One control, one
home.

---

## 9. Data model — Dexie v7, additive throughout

`Settings` gains, each defaulted through the existing merge in `loadSettings` so an older row
upgrades without a migration:

```
weight:        'light' | 'regular' | 'medium'          = 'regular'
wordSpacing:   number  (em, −0.04…0.24)                = 0
letterSpacing: number  (em, −0.02…0.10)                = 0
paragraph:     'published' | 'indent' | 'spaced'       = 'published'
align:         'published' | 'left' | 'justify'        = 'published'
publisherFont: boolean                                 = false
measure:       30 | 34 | 40                            = 34
columns:       'auto' | 1 | 2                          = 'auto'
turn:          'slide' | 'fade' | 'instant'            = 'slide'
tapToTurn:     boolean                                 = true
dismissedSeeds: string[]                               = []
```

`Stock` widens to `'press' | 'day' | 'butter' | 'tea' | 'coal' | 'dusk' | 'pitch'`.
`justify: boolean` is **replaced by** `align`, and the v2 upgrade reads the old boolean once and
writes the new field — the one place a value is transformed rather than defaulted.

`Book` gains `seeded?: boolean`, indexed, because "skip what was dismissed" and "label the
included ones" are both queries over it.

Version 2 adds `seeded` to the `books` index list and changes nothing else. No store is dropped
and no field is retyped in place.

### 9.1 The versions since, and what each one is for

Seven now, and the rule held every time: **additive only.** One store dropped or one field retyped
in place is a reader losing a library on an update, and *"updates never clear local data"* is a
locked decision, not a preference. Six of the seven have no upgrade body at all, which is the
tell — a version that only adds an index needs no migration to be safe.

| v | Adds | Upgrade body |
|---|---|---|
| **1** | `books` `files` `locators` `annotations` `bookmarks` `settings` | — |
| **2** | `seeded` on `books` | yes — reads the old `justify` boolean once and writes `align`. The one value in the whole schema that is *transformed* rather than defaulted |
| **3** | nothing | yes — re-plain-texts `title` / `author` / `publisher` / `description` on rows imported before the entity-stripping landed, and writes back only the rows that actually changed |
| **4** | `readingDays` | — |
| **5** | `collections` | — |
| **6** | `graves`; `fp` on `books` | — |
| **7** | `editedAt` on `books`, `updatedAt` on `collections` | — |

v6 and v7 exist for sync and nothing else. `graves` is the tombstone store — a union-merge with no
record of a deletion can never delete anything, so a book removed on the phone would walk back in
from the laptop on the next pass (§ 15.3). `fp` is the content fingerprint that gives a book one
identity across two devices (§ 15.2). And the two v7 indexes exist so a sync can tell a changed
shelf from an unchanged one cheaply: `signatures()` compares a short string against the last one it
pushed and skips the pass entirely when they match, which makes a blind spot in that string into
**silent data loss** rather than a slow sync. An edit `editedAt` and `updatedAt` cannot see is an
edit that never leaves the device.

---

## 10. Acceptance criteria

Measured, not judged.

**First run** — a cold install with an empty IndexedDB paints a shelf with two books and no
"open a book" hero. Deleting both and reloading does not bring them back. Restore brings them
back. All four verified with the network **off**.

**Stocks** — every one of the seven, ink and ink-soft, computed against its ground and recorded.
Fifteen dark-stock tint alphas likewise. A change of stock produces no fade and no reflow.

**Type controls** — each of the ten, moved from one end of its range to the other, lands on the
**same sentence** it started on. Not the same percentage — the same sentence. Letter spacing is
disabled on an Arabic-language book and enabled on a Japanese one. Hyphenation greys out on a
book with no declared `lang`.

**The turn** — for each of the four styles, on a real phone, throttled, with a 4MB EPUB: no
layout or paint in the frames while the finger is down, and no dropped frame across the commit.
A slow horizontal drag beginning on a word starts a selection, not a turn. RTL mirrors all three
inputs. Reduced motion replaces every style with the cross-fade.

**Marks** — a highlight, a note and a bookmark each survive a change of face, size, leading,
margin, measure and flow, and each resolves to the same words. Export round-trips.

**Everything** — 360px with no horizontal overflow, AA contrast on every stock, keyboard-reachable
controls with visible focus, and the whole surface working with the network off.

**Backup** — a backup written on one device and restored on a second **browser context** brings
back the book bytes, and both a PDF page-and-fraction and a reflowable CFI re-derive to the same
sentence on a fresh paginator. The restore merges: every title already on the shelf is still there
afterwards. A file that is not a backup is refused by name, with no confirm and no change to the
library. Verified in `app/audit/backup.mjs`; the run is recorded in § 14.

**Accessibility** — every rendered control has an accessible name; a real `Tab` walk reaches every
control the page offers as a tab stop, on the library, on Settings and in the reader chrome, each
with a visible focus indicator; one `h1` per route with no skipped level; and under reduced motion
the turn animates `opacity` only — no transform in 32 sampled frames — while still turning the
page. Verified in `app/audit/a11y.mjs`; the run is recorded in § 14.

**The PDF view** — opening a PDF whose fonts are the base-14 makes **zero** requests to
`/pdfjs/`; every one of the seven veils holds **≥7:1** for black ink on white paper, measured on
the composited result; the position comes back as the same page *and* the same fraction after a
reload; and the sheet contains **no type control at all** — absent, not disabled. Verified in
`app/audit/pdf.mjs`; the run is recorded in § 13.

---

## 11. Phases, revised

| Phase | Was | Now |
|---|---|---|
| **P1** | Import, sniffing, metadata, Dexie, Library | **+ the seed manifest, first-run seeding, `seeded`, dismiss/restore, the new first-run shelf and the reworded empty state.** Seeding *is* import, so it belongs here or it becomes a second import path later |
| **P2** | Paginator, gesture, turn, stocks, type controls, TOC, progress, position | **+ all seven stocks, all ten type controls, all four layout controls, all three turn styles, the three-tab sheet.** Split internally: paginator → Slide → the control surface → Fade and Instant. Curl was built here last, as the cuttable one, and was cut — § 5.2.1 |
| **P3** | Selection, highlights, notes, bookmarks, search, lookup, export | **+ the bookmark tick and ribbon, the marks list, the concordance lookup, the fifteen tint measurements** |
| **P4** | PDF on `pdfjs-dist` | Unchanged, plus: on a PDF the **stock tints the surround only**, and the type controls are **absent, not disabled**. A fixed page has no reflow to control, and pretending otherwise is a worse answer than an honest gap |
| **P5** | Audit, offline, update, install, backup | **+ Restore included books, storage used** |

### 11.1 The phone test, and the part of it a driver cannot do

`CLAUDE.md` sets one gate above all the others: *"Test on a real phone, throttled, with a
4MB EPUB. A reader that is smooth on a laptop and janky on a phone has failed the brief."*
That gate has two halves, and only one of them can be automated here.

**What is automated.** `audit/phone.mjs` runs a 390x844 viewport at 3x with touch and
`isMobile`, throttles the CPU 4x through CDP, and uses `audit/fixtures/big.epub` — 4.2MB,
grown from the seed book by `make-big.mjs`. It measures, one per acceptance criterion:

| Criterion | What the driver measures | Measured |
|---|---|---|
| A turn touches only `transform` | Every rAF frame during a real touch drag: how many exceed 32ms, the worst one, and any longtask that ran while the finger was down | 0 frames over 32ms, worst 16.7ms, 0 longtasks |
| The gesture tracks the finger 1:1 | The committed `translate3d` on `renderer.contentLayer`, differenced against the finger as the *page* read it, frame by frame — a peak drift in pixels | 0px peak drift over 202 paired frames, on all three drags; claim at 10px |
| Open is instant on a reopen | The reopen's own clock, apart from boot and apart from the launch screen, against what importing and opening the file cost the first time | open 215ms against 770ms for the file path — 28% |
| Nothing blocks on the network | The book is opened again with the context offline | opened, 1672ms |

The gesture is dispatched as CDP touch, not as a Playwright mouse drag, because
`turn.ts:342` branches on `pointerType === 'mouse'` and a mouse drag exercises a
different path from the one a reader uses.

**How those numbers were arrived at is part of the result.** Four of this driver's first
findings turned out to be the driver and not the app, and saying so here is cheaper than
finding out twice:

- **The finger is read from the events the page receives, not from the dispatch clock**,
  and it is read from `screenX`. Inside a paginated section iframe `clientX` is unusable:
  measured across a 224px drag, `screenX` reported 320 → 96 exactly as dispatched while
  `clientX` sat frozen at 1711.59 for every move, because the section document is a
  container many pages wide that pagination scrolls horizontally under the finger. This is
  what `turn.ts:147-155` already says. A driver that "corrected" it to `clientX` measured
  220px of drift on a 220px drag and called the reader broken.
- **Drift is anchored at the claim, not at touchstart.** `turn.ts`'s hysteresis
  (`CLAIM_PX = 8`, `CLAIM_MOUSE_PX = 24`) is what stops a tap nudging the
  page and lets a vertical scroll win; measured from touchstart it reads as a tracking
  failure that no amount of good tracking can fix. The threshold is reported separately as
  `claimPx`, on its own budget.
- **`dragSlow` is a permanent control**, half the dispatch speed over the same distance.
  It exists to tell sampling latency from a layer that is genuinely trailing: latency holds
  in milliseconds and halves in pixels, trailing holds in pixels. A hypothesis that the
  drift was one frame of rAF latency died on exactly this control.
- **Five clocks for one open, because one clock drew a false conclusion.** `importMs`
  (file → book), `coldOpenMs` (click → first page on a loaded page), `bootMs` (goto → read
  button, a PWA-shell cost, reported uncompared), `splashMs` (the launch screen, § 11.2)
  and `warmOpenMs` (click → first page after a full reload). The first version timed warm
  from the `goto` and cold from the file picker, charging warm an entire app boot cold
  never paid, and then reported the difference as a re-parse.
- **A driver that cuts the network must not report its own cut.** The offline step's
  severance errors are excluded from the console check only from the cut onward, and only
  when they *are* severance errors.

**What is not.** This machine has no iOS Simulator — `xcrun simctl` is absent, and
`xcode-select -p` reports `/Library/Developer/CommandLineTools` rather than a full Xcode.
Installing Xcode and running `sudo xcode-select -s` needs the owner's password. The
simulator MCP is simulator-only in any case and cannot drive a physical device. So there
is no route from here to a real phone, and the emulated numbers are **evidence, not a
pass**. A 4x Chromium throttle on an M-series Mac is not an iPhone; it is a way of making
a regression visible.

**The owner's half, on the actual device.** Open `https://read.flyleaf.cc`, add it to the
home screen, and then:

1. **Open a 4MB book from cold.** Import a large EPUB. Time from tapping the file to the
   first page of text. Anything that feels like a wait rather than a beat is a finding.
2. **Reopen it.** Close the app entirely, reopen from the home screen icon, tap the book.
   This must be immediate — it is reading a blob and a locator out of IndexedDB, not
   parsing a file. The launch screen's beat (§ 11.2) is the only wait that belongs here.
3. **Tap during the launch screen.** It should go, at once. The floor is deliberate; a tap
   being eaten by it is not.
4. **Drag a page slowly and hold.** The page must stay under the thumb the whole way, with
   no catching up when the finger stops. Reverse mid-drag without lifting; it must follow.
5. **Flick, hard.** The turn should commit at a speed that came from the flick.
6. **Hit the ends.** First page and last page should resist and spring back, not stop dead.
7. **Change the type size mid-chapter.** The sentence you were reading must still be on
   screen afterwards — the same *sentence*, not the same percentage.
8. **Turn on Airplane Mode and read.** Every part of it must still work.
9. **Leave it for a day, come back.** It should open on the page you left.

Any "no" there outranks every number in this file.

### 11.2 The launch screen, and the tap it used to eat

`#splash` lives in `index.html` and comes down in `main.tsx`. It is `position: fixed`,
`inset: 0`, `z-index: 9999`, and until it fades it is hit-testable — so for as long as it
is up it *is* the interface.

Three waits gate it, and they are not the same kind of wait:

| Wait | Value | Kind |
|---|---|---|
| `HOLD` | 1200ms **from navigation** | aesthetic floor — a launch screen that flashes for 40ms is worse than none |
| `FONT_WAIT` | 1000ms ceiling on `document.fonts.ready` | correctness — the first frame should not be the app in a fallback face |
| `SEEDING_WAIT` | 2500ms ceiling on the first-run seeding | correctness — the first frame should be a shelf with two books on it, never an empty state that fills in |

`HOLD` counts from navigation so a slow bundle parse does not wait twice. The consequence,
measured on the throttled phone profile: a warm start reaches `main.tsx` at ~100ms and then
holds for the other ~1100ms. On the path a reader actually uses, the floor *is* the launch
screen's whole duration — and the comment in `main.tsx` used to claim the opposite ("torn
down a frame after it paints"), which is only true when the parse itself already took
1200ms.

**What that cost.** Measured: on a reopened book, the read button was un-hittable for
1.15s after the load — `document.elementFromPoint` at its centre returned `#splash`, not
the button. A tap in that window was swallowed by a curtain in front of a ready app. It
also cost this driver a whole round of wrong diagnosis: 1.35s of a 1.5s "warm open" was the
curtain and 160ms of it was the book, and with one clock for both the reader looked like it
was re-parsing the file.

**The fix is an escape hatch, not a shorter floor.** The floor is a decision (1.2s rather
than Press's 1.8s, because this screen stands between a reader and the page they were on)
and it stands. What changed is that the floor now yields to the first `pointerdown` or
`keydown` — one tap and it resolves immediately. Only the floor: `FONT_WAIT` and
`SEEDING_WAIT` are correctness waits and a tap does not skip them.

Measured after: launch screen 1212ms when nobody touches it, **38ms** when somebody does.
`phone.mjs` asserts both, on separate budgets (2200ms and 700ms), and the reopen's own
clock — 215ms against 770ms to import and open the same file — is now measured apart from
all of it.

---

## 12. Settled

The open questions, decided. Reopening one is a decision, not a correction.

1. **The included books** — *The Time Machine* and *Pride and Prejudice*, both Standard Ebooks,
   CC0, 1.30 MiB together. § 1.1 and `app/public/seed/MANIFEST.md`.
2. **Paper grain — no.** Not as a default and not behind an option. It is on the banned list
   because it makes text worse, and a stock, a measure and a leading do the job it pretends to
   do. If it is ever wanted it goes in the margin band, never behind a letter.
3. **Curl — cut, and it passed its test.** The condition written here was the phone test, and
   the cut came from somewhere else: the owner tried it and it did not feel like the fold it was
   measured against. That is a legitimate reason and it is the harder one to write down, so it is
   written down — § 5.2.1, with the numbers it passed. Three styles is still two more than every
   reader that ships only a slide.
4. **Comics and Word documents — out, and here is why.** The decision was in `CLAUDE.md` with no
   reasoning anywhere, so it kept getting asked. § 12.1.

### 12.1 Why comics (CBZ/CBR) and documents (DOCX/RTF) are out

**Comics are not text, so the whole app goes quiet on them.**

- Position is a CFI, which points at a piece of text. A page that is one image has no text to
  point at.
- The reading surface has nothing to do: no reflow, no font, size, leading or measure, no seven
  stocks (a full-bleed image covers the page anyway), no selection, no highlights, no in-book
  search, no concordance. Three tabs of controls would open empty.
- What a comic actually needs is a different app: two-page spreads, panel-by-panel guided view,
  fit-width and fit-height zoom, right-to-left paging for manga, and memory management for tens
  of megabytes of decoded images. That is the same reason PDF needed its own view instead of
  going through foliate (§ 13) — and PDF at least has text in it.
- CBR is RAR. Supporting it means shipping a wasm RAR decompressor into a local-first PWA, and
  RAR5 support in the JS options is patchy.
- foliate-js has no comic parser, so there is nothing to extend. It would all be new.

**DOCX and RTF are files you edit, not books you read.**

- Converting them to clean reflowable HTML is lossy and has no floor: tables, footnotes, tracked
  changes, list numbering, section breaks, embedded objects.
- The one that settles it: the converted structure depends on the converter's version. Update the
  converter and every saved CFI quietly moves, so a reader loses their place in a book they were
  halfway through. That breaks the promise the whole app is built on — position survives
  everything.
- No cover and no dependable metadata, so every one of them lands on the shelf as a ghost card,
  against "a real cover or nothing".

**And the rule underneath both:** a format that is listed but does not really open is worse than a
format that is not listed. Half-supporting either of these would be exactly that.

**What the code does with them.** `import/sniff.ts` recognises a comic archive on purpose — an
archive of nothing but images is refused as `'a comic archive'` rather than the useless
`'a zip file'`, so the `cbz|cbr` in its `IMAGEY` pattern is a *refusal*, not leftover support.
The vendored `foliate-js/view.js` knows `application/vnd.comicbook+zip`, but the sniffer refuses
the file long before `makeBook` is reached, so that branch is unreachable here and is left alone
as upstream source.

---

## 13. The PDF view, as built (P4)

A PDF is a different object from a book. Its pages cannot move, so there is nothing for a type
control to control and nothing for a page turn to turn. What follows is what the view does
instead, and what was measured.

### 13.1 What it is

Continuous vertical scroll on `pdfjs-dist` from npm — **not** through foliate, per `CLAUDE.md`.
One strip carries the full known height from the first frame, so the scrollbar is honest and the
scroll position never moves under a thumb. Only the pages near the viewport are mounted: on a
390×844 phone with a 12-page file, **4 of 12** were live and the strip was **5776px** tall.

A pinch touches `transform` on the strip and nothing else — no canvas is resized and no page is
re-rendered while two fingers are down. The commit happens on release, anchored to the page under
the fingers rather than to a scroll ratio, so the word you pinched on is still under your fingers.

### 13.2 Position

`pdf:<page>:<fraction>` in the same `locators` row a reflowable book uses. This is not a
compromised CFI: on a document whose pages cannot reflow, **the page number is the content
anchor**. It survives zoom, fit, rotation and screen. Measured: left on page 5 at 36%, reopened
on page 5 at 36%, same `scrollTop` of 2101.

### 13.3 The sheet — four controls

**Fit · Zoom · Stock · Page tint.** No tabs: four controls do not need three tabs. No Size, face,
leading, measure, word spacing, letter spacing, hyphenation, justification, margin or flow — a
disabled Size slider on a fixed page is fifteen pixels of apology. A one-sentence lead says why,
once, at the top of the sheet.

### 13.4 The veil — how a stock reaches a fixed page

The paper of a PDF is baked into the file. The stock therefore tints **the surround**, and a flat
fill at a per-stock opacity sits over the canvas so a scanned white page is readable on a dark
stock at night. It is one composite and nothing per frame; the text layer sits above it so
selection still works.

An opacity veil cannot invert a page — it can only darken it. So every value is capped at a
**measured** contrast for black ink, and the ink on a veiled page is never claimed to be lighter
than it is. Measured on the composited result:

| Stock | `--pdf-veil` | Black ink on veiled white |
|---|---|---|
| Press | 0 | 21:1 |
| Day | 0.16 | 14.73:1 |
| Butter | 0.22 | 12.02:1 |
| Tea | 0.28 | 9.86:1 |
| Coal | 0.42 | 7.51:1 |
| Dusk | 0.42 | 7.66:1 |
| Pitch | 0.40 | 7.37:1 |

The floor is 7.37:1 — AAA for body text, on the darkest stock. `DESIGN.md` → Page veil.

### 13.5 What still works

Selection (the text layer is real DOM in the host page, so one `selectionchange` listener does
it), **Copy · Look up · Find** — and not highlight or note, because a highlight is anchored to a
CFI and a PDF has none. Bookmarks do work: they anchor to the page, tick the top bar and appear
in the marks list with the page's own first words as the excerpt. The outline goes where it says
— Chapter 2 landed on page 5. Search runs page by page and yields a group per page with a real
per-hit vertical fraction, not the top of the page: the outline jump to page 5 landed at 33%, the
search hit on the same page at 36%.

Cover and metadata come from the file itself: page one rendered at 495×640, the title read from
the Info dictionary. That is not a *generated* cover — a PDF's first page **is** its cover.

### 13.6 The honest gap

pdfjs *code* is precached (worker 1.19MB + API chunk 483kB, inside Press's 6MB ceiling). pdfjs
*data* — 2.4MB of standard fonts, CMaps, ICC profiles and WASM — is `CacheFirst`, fetched only if
a file asks for it. So: a PDF whose fonts are neither embedded nor available on the system, or
which uses JBIG2, JPEG 2000, an ICC profile or a predefined CJK CMap, **needs one network fetch
the first time it is opened**. Everything else, including every base-14 PDF, opens with the
network off. Measured: zero requests to `/pdfjs/` on the fixture.

`.pdf` is registered in `file_handlers` alongside the book formats — one handler, because `/open`
sniffs the file itself. `.txt`, `.md` and `.html` are deliberately **not** claimed: an ereader has
no business in the "open with" list for every log file on the machine.

---

## 14. The audit, as run (P5)

P5 is not a feature. It is the phase where every claim the earlier phases made gets measured, and
the measuring is checked in: `app/audit/`, one driver per surface, each one a script that opens
the built app in a real browser and reports findings or reports none. A driver that finds nothing
is only worth having if it *could* have found something — so every claim below says what it
measured and what the number was, and where a check turned out to be weaker than it looked, that
is recorded too.

### 14.1 The backup file

Format and reasoning live at the top of `src/backup.ts`; the short version is a 17-byte ASCII
magic line carrying the format version, a `uint32` header length, a UTF-8 JSON header with every
row and a blob table, then the blob payloads concatenated in the header's own order.

Not JSON with base64 book bytes, for one reason: **neither end may hold a library in memory.**
Writing hands `Blob` its parts and lets the browser assemble them; reading uses `File.slice`,
which is a lazy view, so a 40MB EPUB reaches Dexie as a slice and is never decoded on the way
through. The version is in the magic line as well as the JSON because the first thing a future
reader of a future format must do is *refuse* a file it cannot read, and it has to be able to do
that before parsing anything.

**A restore merges. It never deletes.** A book on this device that the backup has never heard of
is left exactly as it is. The reader reaching for a backup is usually adding a device, not wiping
one, and "restore" is not a word anyone expects to lose books to.

### 14.2 The round trip, measured

`app/audit/backup.mjs`, across **two browser contexts** — separate origin storage, separate
service worker, separate IndexedDB. That is the only honest test: a second device, not a cleared
one. (Wiping IndexedDB in place does not work — Dexie holds an open connection and
`deleteDatabase` blocks.)

Device A imported a PDF, read six pages into *Pride and Prejudice*, bookmarked, opened the PDF to
page 5 and bookmarked there. Six turns before the bookmark deliberately: a restore that silently
dropped the position would land on page 1 and look plausible.

| | Device A, before | Device B, after restore |
| --- | --- | --- |
| *Pride and Prejudice* | `PAGE 2 OF 6 · II · 1%` | byte-identical |
| Bookmark excerpt | `Mrs. Long has promised to introduce him.” “I do not believe Mrs. Long ` | byte-identical |
| *The Measured Page* (PDF) | `PAGE 5 OF 12 · Chapter 2 · 33%` | byte-identical |
| Bookmark excerpt | `Chapter 2 Page 5 of 12 The paginator is a strip of columns and a scrol` | byte-identical |

The file: `flyleaf-library-2026-08-22.flyleaf`, **1,570,214 bytes**, the page reporting
`· 3 books · 1.5 MB`. Three books including a PDF — anything under a few hundred KB would have
meant the blobs never went in, and the driver fails below 200KB for exactly that reason.

Device B's confirm read *"A backup from Aug 22, 2026. 3 books, 0 highlights, 2 bookmarks. …
Nothing is deleted."*; the result line *"1 added to the shelf · 2 already here, updated ·
2 bookmarks"*; the shelf went from `["Pride and Prejudice", "The Time Machine"]` to
`["The Measured Page", "Pride and Prejudice", "The Time Machine"]` — nothing lost. The reflowable
CFI was re-derived against a **fresh paginator on a different device** and landed on the same
sentence, which is the whole point of § 4's position rule.

A `.txt` fed to the restore picker was refused by name — *"That is not a Flyleaf backup file."* —
no confirm opened, and the library line stayed `3 books · 9.4 MB used, app included`.

**One real defect, found here, fixed in the app.** The bookmark appeared to vanish on both
devices. It had not: the confirm and the result both counted two bookmarks. The reflowable marks
panel was opening on **Highlights**, which was empty, so the reader's own bookmark was hidden by
the app. `src/reader/Panel.tsx` now opens on the first kind that has something in it — the panel
remounts on every open, so the choice is stable within a session and never moves under a thumb
mid-read. Teaching the driver to click the Bookmarks tab would have made the run pass and left
the defect in.

### 14.3 Accessibility

`app/audit/a11y.mjs`. `probe.mjs` already owns the numbers with geometry — contrast over every
rendered pair, 24px targets, both gutters, horizontal overflow — so this driver takes the half
with none: names, structure, keyboard, and whether reduced motion reduces anything.

Six routes at 390 and 1280, **plus the reading page itself**, which is not a route you can
navigate to cold and would otherwise have been the largest hole in the audit — it is the screen
the app exists for and the one with the most icon-only buttons.

- **Names.** Every rendered interactive control resolves to an accessible name, computed the way
  an AT computes it. Two exceptions found and fixed: the hidden file inputs behind *"Choose a
  file"* and *"Restore from a backup"* announced as nameless file uploads. They are now
  `aria-hidden` — 1×1, not tab stops, and the button beside each one is the control and already
  says so. The driver still fails any *focusable* element inside `aria-hidden`, so the escape
  cannot be used to hide a real control.
- **Keyboard.** A real `Tab` walk, and the stops are diffed against what the page itself offers
  as a tab stop: **13 of 13** on the library, **13 of 13** on Settings, **4 of 4** in the reader
  chrome. Every stop that matched `:focus-visible` drew the one ring (`index.css`, `outline:2px
  solid var(--ink)`); none landed off screen. Tab also reaches the `<foliate-view>` host — the
  scroll container, and the element the arrow-key turn needs focus on. It draws no ring
  deliberately: a 2px outline around the whole page every time a reader tabs past the book would
  be worse than none.
- **Structure.** Exactly one `h1` per route, no skipped level, one `main`, every `nav` labelled,
  `lang` on `<html>`, no duplicate ids, and no `role="switch"` or `role="tab"` without its state
  attribute. The reading page asserts names but **not** headings: the book supplies the headings,
  and inventing an `h1` to satisfy a checker would put a title above the text of every page.
- **Reduced motion.** Under `prefers-reduced-motion`, the turn is `opacity` over 75ms on the
  stage — **and no transform, translate, scale or rotate**,
  across 32 sampled frames — while the page still turns (column 359 → 718). Honouring the setting
  by breaking the feature is not honouring it, so both halves are asserted.

Two of these checks were weaker than they looked before they were fixed, and both fixes belong in
the record. The reduced-motion check sampled one instant 70ms after the key press: the reduced
turn is two 75ms halves, and a sample landing in the gap saw nothing and passed for the wrong
reason. And the `Tab` walk detected wrap-around by *describing* the focused element — two
icon-only buttons with one class and no text describe identically, which ended the library walk
after five of eleven controls and reported it as a pass. Wrap-around is now detected on element
identity, and the walk steps *through* the frame boundary at the book instead of stopping there.

### 14.4 The three device sentences

Each says something true, checked in a real browser: install guidance resolves to the branch that
matches what this browser can actually do (`Your browser has not offered an install for this app
yet.` under headless Chromium, which fires no `beforeinstallprompt` — never an Install button with
nothing behind it); the library panel reports a real figure (`2 books · 9.0 MB used, app
included`) and is never still reading `Checking storage…`; and *Check for updates* answers with
one of its three real answers (`This is the latest version.`), never a fourth. `checkForUpdate()`
waits up to 3s for the registration to settle rather than reporting "unsupported" for a service
worker that was merely late. The takeover reload is a cache swap and **must never touch
IndexedDB** — the comment saying so is in `src/pwa.ts` because that is where somebody would
otherwise add it.

### 14.5 The class-name collision the sweep caught

Two clusters of findings — 48 on the route sweep, 20 on the book-sheet states — turned out to be
one root cause with two faces. The reader's contents/marks/search surface was called `.panel`, the
same single-class name the chrome uses for a white card, declared later in the stylesheet at equal
specificity. So every panel on **Settings** and the **book sheet** was quietly inheriting the
reader's rules:

| declaration | intended for | what it did to a chrome panel |
| --- | --- | --- |
| `display:flex; flex-direction:column` | a full-height reader surface | made every child a stretched flex item |
| `background:var(--stock-bg)` | a stock-tinted reading surface | **transparent** — `--stock-bg` is only declared on `[data-stock]`, so the white card had no fill at all |
| `grid-area:read` | the reader's grid | inert, but wrong |
| `max-width:400px` (≥820px) | a column against the leading edge | capped a 680px card at 400px — the desktop misalignment, 18 findings on `/settings` and 18 on `/book/:id` across six themes |

The second face was the book sheet's **More/Less** disclosure. Stretched to a flex item it measured
`304×20`, under the WCAG 2.5.8 24px floor, in every theme and every sheet state.

The fix is a rename, not an override: the reader surface is `.reader-panel`, its children keep the
already-unique `panel-` prefix, and `Reader.tsx`'s keyboard guard and the `marks`/`pdf` drivers
follow the new name. `.detail-more` separately went to `7px` of vertical padding (`26px` tall,
`41×26` measured) with the margin dropped to `6px` so the optical gap above is unchanged — the
underline is drawn on the text, not the box, so the larger target is invisible.

Measured after the fix, all at `/settings@1280`: panels `x 360 → 1040`, exactly the content
column's `680px`, `display:block`, filled `rgb(250,248,243)` = `--card-w`. Drivers re-run clean:
`routes` 0 of 144 checks, `sheet` 0 of 20 states, `states` 0, `marks` 0, `pdf` 0, `a11y` 0 with
13 of 13 tab stops on both library and settings. `marks` and `pdf` are the coverage that proves the
rename did not break the reader panel itself — they drive it at 390 and 1280.

Two lessons worth keeping. A duplicate bare single-class rule is a silent, cross-screen bug, and
the whole stylesheet now has none: `grep -oE '^\.[a-z0-9-]+\{' src/index.css | sort | uniq -c`
leaves only `.reader{}` and `.sheet-note-no{}`, both deliberate same-component augmentations. And
the sweep only found this because it was re-run with **full output** — a filter that matched no
lines had been reading as a pass.

### 14.6 The dead class the full-output re-run caught

The same lesson, one turn later. Re-running the five reader drivers with nothing filtered surfaced
two findings that read as reader regressions — `controls: the Contents button did not open the
drawer` and `reader: the contents list is empty` — and were neither. `.reader-toc` had stopped
being an element the day contents gained the marks and search tabs: the surface became
`.reader-panel` with a `.panel-body` scroller, and nothing has carried the bare class since. Two
drivers were still asserting on it, and a container rule for it was still in the stylesheet
(`grid-area:read`, its own stock ground, its own scroller, and a `padding-inline` centring line in
the ≥1024px block) governing nothing at all.

Fixed as three deletions and two selector updates: `audit/reader.mjs` and `audit/controls.mjs` now
measure `.reader-panel`, and both dead CSS rules are gone with a comment in their place saying
where scrolling and the safe-area pad actually live. Re-run: `controls` 0, `reader` 0 with `toc: 65
rows, first "Titlepage", coversStageExactly true, clearsTopBar true, minRowH 48`.

A finding that names a selector is a claim about **two** things — the app and the driver. Check
which one moved before touching either.

### 14.7 Book content cannot run script

A file from the internet is opened on this app's own origin, and that origin owns the library in
IndexedDB. The paginator's iframes carry `sandbox="allow-same-origin allow-scripts"` — both flags
together, which is what pagination needs (the host measures the document) and is also exactly the
combination that lets a document reach out of its own sandbox. Measured, before the fix, inside a
live content frame: `origin http://localhost:4173`, `sameOriginDb true`. Book script would have run
with the library in reach.

Closed at the seam where a document becomes a document, not after it has parsed — `onSectionLoad`
is too late by definition, the inline script has already run. foliate's parsers dispatch two events
on `book.transformTarget`, both **before** the blob URL is made:

| hook | detail | what `src/reader/harden.ts` does |
| --- | --- | --- |
| `load`, per manifest item | `{ type, isScript, allow }` | sets `allow = false` on any script resource, so it is never fetched |
| `data`, per resource and section | `{ data, type }`, replaceable with a promise | empties a JS media type; injects `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` into the head of every HTML/XHTML document |

The two are not redundant. `load` refuses a linked script; the CSP covers everything `load` cannot
see — inline `<script>`, an `onclick` attribute, a `javascript:` href, `eval`. `hardenBook` is
called in `src/pages/Reader.tsx` between `view.open` and `view.init`, because `init` is what loads
the first section.

Coverage, per format, including what is not covered:

| format | how it is closed | tested |
| --- | --- | --- |
| EPUB 2/3 | both hooks | yes — `csp.mjs`, in the live frame |
| MOBI 6 | `data` only — the MOBI parsers have no `isScript`, so a JS media type is emptied instead of refused. Neither `loadSection` dispatched `data` for the section document and `MOBI6` had no `transformTarget` at all; both added as **FLYLEAF PATCH 6** in `PATCHES.md` | yes — `mobi` driver, against a generated fixture |
| KF8 / AZW3 | the same patch, the same `data` hook | **no** — see below |
| FB2, FBZ | nothing needed: upstream's converter is a whitelist. `convert()` returns `null` for an unlisted element and copies only listed attributes | — |
| TXT, Markdown, HTML | `src/reader/textBook.ts` already drops script elements, handler attributes and `javascript:` URLs; its page template now carries the same CSP line | yes — `text` driver |
| PDF | a separate `pdfjs-dist` view with scripting off; it never goes through foliate | yes — `pdf` driver |

Measured after the fix, in the content frame of a seeded EPUB: `policy "script-src 'none'"`,
`inlineScriptRan false`, `handlerRan false`, `javascriptUrlRan false`, two CSP violation reports on
the console, 0 findings.

**One probe that does not measure the app.** An earlier version of this section cited
`evalRan "threw"` as evidence. It is not evidence either way. Playwright's `frame.evaluate` may run
in an isolated world, and an isolated world is exempt from the page's CSP — so the same `eval`
probe reported `"threw"` against an EPUB section and `"ran"` against a MOBI one, measuring which
world the harness happened to get rather than anything about the policy. Every claim above is
world-independent instead: markup that ships **inside the book file** (an inline `<script>`, an
`onclick` attribute, a `javascript:` href), plus a `<script>` element appended to the loaded
document — that one belongs to the document, so the document's policy decides — plus the count of
CSP violation reports the page itself emitted. `eval` is also not load-bearing here: it needs
script already running, and nothing can start.

**MOBI 6 is now measured, not reasoned.** There is no MOBI writer on this machine
(`ebook-convert`, `kindlegen`, `calibre` all absent), so `audit/fixtures/make-mobi.mjs` writes one
by hand: a PalmDB wrapper, an uncompressed PalmDOC record 0, a MOBI 6 header, an EXTH block
carrying the title, author and language, and a text stream whose `filepos` byte offsets are
resolved in a second pass so they stay true. The three things patch 6 has to stop ship **inside the
file** — an inline `<script>`, an `onclick` attribute and a `javascript:` href — and they live in
the first section deliberately, because a flag set by book script lives on that section document's
own `window` and the paginator detaches a section when the reader leaves it.

`audit/mobi.mjs` opens it and measures: the EXTH title and author on the sheet, a `MOBI` badge,
`policy "script-src 'none'"` in the content frame, three CSP violation reports, `script`, `handler`,
`href`, `injected` and `handlerAfterClick` all `false` — while `scriptEls`, `handlerAttrs` and
`jsHrefs` all still read `1`, so the document *carries* the hostile markup and the policy is what
makes it inert rather than the parser having quietly dropped it. Then two entries of contents built
from `filepos`, a jump that moves the section, a turn that moves the section, and two turns past the
last page that hold the final section with its text intact. 0 findings.

**The unclosed gap.** KF8/AZW3 still has no fixture and no driver. Authoring one means writing
skeleton and fragment indices, which is a different job from the MOBI 6 generator above. Patch 6
covers it by the same code path and the same hook, but that is reasoning, not a measurement, and
this sentence is here instead of a green tick.

### 14.8 Measuring nothing measures fine

Twenty drivers were green while a finished feature shipped as nothing at all. The Drive panel is
gated on a build-time ID, the ID was unset, `SyncPanel` returned `null`, and the whole section was
absent from every build for weeks. Not one driver noticed, and each was right not to: `sync.mjs`
tests the merge fold in `record.ts` directly and touches neither the UI nor Google, while
`a11y.mjs`, `states.mjs` and `swatches.mjs` all measure what is on screen — and **an absent section
has no contrast to fail, no state to be wrong in and no swatch to drift.** A component that returns
`null` is invisible to every check that measures rendered output, because measuring nothing measures
fine.

`panels.mjs` closes it by asserting the one thing all the others assume: presence. It is
deliberately dumb — no geometry, no colour, no behaviour, just that each panel the page is built to
render is in the document, visible, and taller than 24px.

**Its own first draft repeated the bug.** It read the client ID off the served bundle and then
required the panel present if the ID was there and absent if it was not — calling the two agreeing a
pass. Which scores an ID-less build at zero findings with the panel gone: the original bug, reported
as health. *Consistency was never the property worth testing.* The property is that Drive sync
**ships**, so a build with no client ID is itself a finding, named as such. Verified by rebuilding
without the ID: two findings, both accurate, and both naming the fix.

### 14.9 The empty contents list was one unquoted attribute

The first MOBI fixture opened, rendered and hardened correctly, and its contents list was empty —
where its `<guide>` pointed at two chapters. The finding named the app; the cause was the fixture,
and the shape of the mistake is worth keeping.

The guide entry was written self-closing with an unquoted value:

```
<reference type="toc" title="Contents" filepos=00000673/>
```

In HTML an unquoted attribute value ends at whitespace or `>`. A `/` before the `>` is **part of
the value** — so `filepos` parsed as `"00000673/"`, `Number()` gave `NaN`,
`MOBI6.resolveHref` ran `#sections.findIndex(s => s.end > NaN)` and got `-1`, and
`this.sections[-1].createDocument()` threw. `MOBI6.init` builds the contents list inside a `try`
and swallows a failure into `console.warn`, so the visible symptom was a book with no contents and
no error. The anchors in the body were fine throughout: `<a filepos=00000821>` is not self-closing,
so nothing followed the digits.

Two things came out of it, and both are kept:

- **The fixture quotes the value**, with the reason written next to it, so a later edit does not
  reintroduce it.
- **`audit/mobi.mjs` now collects `console.warn` as well as `console.error`.** Every other driver
  watches errors only. This one has to watch warnings because the engine's own failure mode for
  contents is a warning — a driver that reports `toc: 0` without the reason sends you looking at
  the wrong half of the system, which is exactly what happened here for one whole run.

The § 14.6 lesson again, from the other direction: a finding that names a selector is a claim about
the app *and* the driver. A finding about a fixture-backed format is a claim about the app, the
driver, *and* the fixture. Check which one moved.

### 14.10 The install ask on Home

Settings has always carried the honest, permanent version of this — § 14.4's first device
sentence. What it did not have was anybody reading it. So Home carries an ask too: one strip
under the header, above Continue, and it is the only place in the app that asks the reader for
anything.

Its rule is that it never appears where the ask cannot be acted on — but "acted on" once meant
"a button can be offered", and that made the ask **invisible** on desktop Safari, on Firefox, and
on any Chrome that has already seen this app installed and so stops firing the event. A reader
who never gets the browser's own bar was simply never asked. So the last branch is no longer
silence: it names the route through the browser's own menu, per engine, and still carries no
button, because there is still nothing to click.

| state | strip | button |
| --- | --- | --- |
| `installed` — running standalone, or installed this session | none | — |
| iOS/iPadOS (`manualOnly`) | `Add to home screen`, naming Share → Add to Home Screen exactly as iOS names them | **none** — there is no programmatic install to offer |
| a real `beforeinstallprompt` is held, coarse pointer | `Add to home screen`, on opening back to the page you were on | Install |
| the same, fine pointer | `Open books here`, on book files opening into the reader | Install |
| no prompt held, not iOS, coarse pointer | `Add to home screen`, naming the browser menu item — `Add to Home screen` on Chromium, `Add to Home Screen` elsewhere | **none** |
| no prompt held, not iOS, fine pointer | `Open books here`, pointing at the address-bar install icon on Chromium, the browser menu otherwise | **none** |

Two copies for the same capability, split on `pointer: coarse`, because "home screen" is not a
thing on a laptop; and the desktop line leads on **file handling**, not on working offline —
offline is true of the whole app and is deliberately not the headline anywhere in it. The eyebrow
on the desktop branch is not "Install", because the button beside it already says that.

**A dismissal is permanent.** It is written to `flyleaf.home.install` and the strip does not come
back because the app decided enough time has passed — the same discipline as a deleted included
book (§ 1.3). Settings is where a reader changes their mind.

`audit/install.mjs` covers all of it, and is explicit that Chromium fires no real
`beforeinstallprompt` headlessly: the prompt is synthetic, our branch and our `prompt()` call are
real, and Chrome's own decision to offer the install is the part no driver here can exercise.

---

## 15. Google Drive sync (built, visible, and confirmed working on 22 Aug 2026)

The one networked feature in the app, and it is built so that the sentence *"no feature that needs
a network to work"* stays true: the reader who never connects is not an unsynced reader, they are
a reader we have no record of at all. Nothing signs in on their behalf, nothing nags, and there is
no wall. Connecting changes **where the library is copied to**. It does not change what the app is.

### 15.1 Its own client, in its own project

`SYNC_AVAILABLE` in `src/sync/google.ts` is `CLIENT_ID.length > 0`, and `SyncPanel` returns `null`
when it is false. For a long while it was false everywhere: the ID was commented out in
`app/.env.example`, unset locally and unset on the deploy, so the panel hid itself and the owner
asked *"where is google sync?"* three times running. Hiding a shipped feature is not an answer to
that question, so the ID is set in `app/.env.local` and in the Vercel project across all three
environments, and the panel renders — measured on the live site at `read.flyleaf.cc/settings`.

**And it is now this app's own ID, on this app's own client, in this app's own Google Cloud
project.** It used to be Flyleaf Press's, shared. That was a defensible call, it was wrong for two
specific reasons, and both are recorded below rather than summarised away, because the reasoning is
the only thing that stops it being re-shared later.

```
project            Flyleaf eReader        (id: flyleaf-ereader, no organisation)
client             Flyleaf eReader web    (type: Web application)
client id          1093925806507-geheiusfcb8belpi6bdpl6p8afi74g99.apps.googleusercontent.com
created            23 Aug 2026 16:30 GMT+1 · status Enabled
consent screen     "Flyleaf eReader" · External · In production · published 23 Aug 2026
scopes             .../auth/drive.appdata · .../auth/userinfo.email — both non-sensitive
```

The ID is **public by design** and safe in a repo, a bundle and an env var; there is nothing in it
to rotate or leak. Google's browser token flow has no client secret, so the only thing standing
between that ID and any other site is the OAuth client's **Authorized JavaScript origins** list.
Google did display a client secret when the client was created; the app has no use for it, it was
not recorded anywhere, and it must not be.

**All four origins were registered when the client was created**, so this app has never had the
missing-origin failure on its own credentials:

| # | Origin | For |
|---|---|---|
| 1 | `https://read.flyleaf.cc` | production |
| 2 | `https://flyleaf-ereader.vercel.app` | the Vercel origin |
| 3 | `http://localhost:4173` | `vite preview`, which is what the audit drivers run against |
| 4 | `http://localhost:5173` | `vite dev` |

**Authorised redirect URIs is empty**, deliberately: the token flow is origin-checked, not
redirect-checked, so a redirect URI there would do nothing.

Google classified **both scopes as non-sensitive** — read off the consent screen's own tables, with
the sensitive and restricted tables empty. An earlier version of this document assumed
`drive.appdata` was sensitive and that a published app would therefore need Google's verification
review. It is not, and the assumption is corrected here rather than quietly deleted.

The consent screen is **In production**, audience **External**. It was in Testing with
`ajayifey@gmail.com` as its one test user until 23 Aug 2026, and the owner's reason for changing
that is worth keeping verbatim: *"i am not a tester but a user, so i want this to work normally."*
Testing works for a listed address, but it puts Google's *"Google hasn't verified this app"*
interstitial in front of every sign-in, and it makes the reader an entry in an allowlist. Neither
belongs in front of someone opening their own books.

**Publishing was not a Google review.** An earlier version of this document assumed it was. It is
not, on three specific conditions that this app meets and that the confirmation dialog itself
states: *"If your app's configuration has more than 10 domains, has a logo or requests sensitive or
restricted scopes, you will need to submit for verification."* This app has **2** authorised
domains, **no logo**, and both its scopes are in the **non-sensitive** table with sensitive and
restricted empty. So publishing was a switch after all — but only because of those three facts, and
each of them is now a thing that must not change casually:

- **Never upload a logo.** The Branding page says so in as many words: uploading one means
  submitting for verification unless the app stays in Testing. The launch lockup lives in the app;
  it does not need to live on Google's consent screen.
- **Never add a sensitive or restricted scope** without accepting that a review comes with it.
  `drive.appdata` is deliberately the narrowest Drive scope there is.
- **Keep the authorised-domain list short.** Two is the whole list, and both are real.

**What publishing did require was the two documents Google gates it on** — an application privacy
policy link and a Terms of Service link. Those were the Console's one standing warning, reported as
*"Your app's OAuth configuration is incomplete… Please visit the Branding page."* Nothing on that
form was required-and-empty; those two optional-looking fields were the block. They are now real
pages in this app rather than a hosted afterthought:

| Branding field | Value |
|---|---|
| Application home page | `https://read.flyleaf.cc` |
| Application privacy policy link | `https://read.flyleaf.cc/privacy` |
| Application Terms of Service link | `https://read.flyleaf.cc/terms` |

They are **routes in the app** (`app/src/pages/Legal.tsx`, linked from Settings) because
`read.flyleaf.cc` *is* the app, and a policy on a separate host would be one more thing to keep
true. Every claim on both pages was checked against the code before it was written — the four hosts
the app can ever reach, no analytics, appDataFolder only — so if any of that changes, those pages
change with it. Verified after the branding save persisted across a hard reload, and after the
publish: status **In production**, the *Test users* section gone, *Publish app* replaced by *Back to
testing*.

**Flyleaf Press reads In production too**, audience External, 0 users of a 100 cap — so the two now
behave alike where they did not before. Press's own home page and privacy policy fields are still
empty; it was published before Google asked for them, and nothing in this repo touches Press's
project.

**One thing publishing does not change: the two apps still cannot see each other's files.**
`appDataFolder` is scoped to the OAuth *client*, and these are two different clients in two
different projects. Publishing changes who may grant access, not what the grant reaches.

#### How the failure used to lie

Before the origins existed, pressing Connect failed, and the failure **lied about why**.
`origin_mismatch` reaches the SDK as `popup_closed`, because Google paints its error page in the
popup and all the SDK sees is the window going away. So the panel said *"Sign-in was closed before
it finished"* — blaming the reader for a console setting. The two are now told apart by the clock: a
person deciding to close a window takes at least a second or two, while the error page is reported
back almost immediately, so under **1200ms** the message instead names the cause and the exact
origin — *"Google turned this away: https://read.flyleaf.cc is not an authorised origin on the sync
app's Google credentials."* Kept, because it is the message that makes a mistyped origin a one-pass
fix instead of a four-pass guess.

#### What sharing a client actually shared

Called a "per-app folder" everywhere including, until this was understood, this document. It is not.
**`appDataFolder` is scoped to the OAuth client**, and sharing the client therefore shares the
folder. One client, one hidden folder, and both products' documents sitting in it:

| File | Written by |
|---|---|
| `library.json` | Flyleaf Press |
| `shelf.json` · `marks.json` · `place.json` | this app |
| `book-<fingerprint>`, one per backed-up book | this app |

**Reading and writing were never at risk**, and it is worth saying why rather than being relieved
about it. Every name is distinct, and neither app ever enumerates the folder looking for something
that might be its own: Press asks Drive for one name (`q=name = 'library.json'`), and this app lists
the folder but only ever reads it through an exact `folder.get(SHELF | MARKS | PLACE | book-<fp>)`.
Nothing generic, nothing by pattern, nothing "whatever is newest". So no document of one product can
be parsed, overwritten, or counted as the other's.

**Deleting was.** `dropAll` took *every file in the folder*, and the comment above it argued for
exactly that — an old name or a half-written upload cannot be left behind claiming to be a backup if
nothing is left behind at all. Sound reasoning about a folder you own alone, and that was not one.
The consequence was that **"remove the copy from my Drive" in the reading app deleted Flyleaf Press's
entire cloud backup**, in one press, with no warning, and the sentence shown afterwards — *"The copy
was removed from your Drive. Your library here is untouched."* — was true of this app and false of
the other one.

Nothing about it looked wrong in the source, which is the part worth keeping. Both functions read
correctly, both were well argued, and the bug lived entirely in an assumption about Google's
scoping that neither file stated. It was found by the owner asking whether sharing one client could
let two products touch each other's contents.

**The fix is ownership.** `ours` in `record.ts` decides, and `dropAll` takes it as an argument
rather than deleting on its own authority:

- **The tag.** Every file written from this app carries `appProperties.app = 'ereader'`. A file
  tagged as another app's is never ours to delete *whatever it is called*, so renaming a document in
  some later version cannot bring the bug back.
- **The names.** A backup made before the tag existed carries no tag, and it is still ours and should
  still go — so an untagged file matching one of our four shapes is deleted too.

Anything else is left where it is. Stranding a stranger's file costs a few kilobytes of somebody's
quota; deleting it costs them their backup, and those are not the same mistake.

A second bug in the same function, found while fixing the first: `dropAll` was listing through
`listFolder`, which collapses duplicate names and keeps the newest. So the one case its own comment
named — *a half-written upload that was retried* — was the one case it could not clean, because the
listing handed back one of the two files and silently stranded the other. The paged listing is now
split out as `everything()`, undeduped; `listFolder` still dedupes for readers, and the delete no
longer does.

Proven by `audit/appdata.mjs`, in the permanent gate. Sixteen rows, built to look like the real
shared folder — our files tagged and untagged, a retried duplicate, a document renamed in a future
version, Press's backup both as it is today (untagged) and as it would be if Press tags too, and a
file from an app that does not exist yet. It bundles the real predicate and the real `APP` constant
with only Dexie stubbed, so a rename in `drive.ts` fails the driver instead of quietly passing it.
There is no browser in it and no click to make: signing in to a real Drive is the one thing an audit
run must not do, so the folder is synthetic and the predicate is real.

**With a client of its own, none of that is load-bearing any more, and all of it stays.** A separate
client means a separate folder, so `ours` now matches everything in it and the tag is insurance
against ever sharing again. The undeduped-listing fix was a real bug regardless of who else was in
the folder.

**Press's half is now hygiene rather than urgency.** `dropLibraries` in
`../Review app/app/src/sync/drive.ts` still deletes everything in *its* folder, and that folder no
longer contains anything of this app's, so it can no longer take this app's shelf, marks, position
or books with it. It still wants the mirror of the change above — its own `APP = 'press'` tag and a
`name = 'library.json'` bridge — because the Flyleaf journal is a third product that could one day
share a client. It is a different product with its own deploy, so it is not shipped here on this
app's say-so.

#### Why its own client, and why now rather than later

What sharing bought was real: one consent screen, so a reader who has already granted Drive access
in Press gets a token here with no second prompt; one origins list; and one review, if a review is
ever needed.

What it cost is more:

- **One hidden folder for two products, permanently.** The delete bug is the shape of that, and
  every further app that joins the client inherits the hazard rather than being protected from it.
- **Revocation is joint.** A reader who disconnects Press in their Google account settings
  disconnects this app in the same act. There is no way to keep one and drop the other.
- **The consent screen carries one name.** Branding is configured **per project**, not per client,
  which is why a distinct name needed a whole new project and not just a new client. Three distinct
  products, one name, on the one surface where a reader decides whether to trust this app.
- **No per-app usage figure, ever** — see the note on `quota()`.

**Against that, separating had exactly one cost, and it is the whole reason it was done now rather
than in six months.** `appDataFolder` is per-client, so a new client sees a new, *empty* folder.
Anything already backed up under the shared client does not merely disappear from view: it becomes
unreachable **even to delete**, because only the client that wrote it can see it. Those bytes would
sit in the reader's quota permanently with no interface anywhere able to remove them.

**That cost was zero here, established rather than assumed.** The set of documents this app had ever
put in the shared folder was empty: the Drive panel was invisible until `VITE_GOOGLE_CLIENT_ID` was
set on 22–23 Aug 2026, and Connect could not have written anything even then, because it was still
meeting `origin_mismatch` until origins went on the client. The owner confirms the same from the
other direction — nothing was ever synced, because it never worked. Two independent lines agreeing.
**Separating now cost nothing; separating later would have been silent data loss.**

#### The order it was done in, and the only order it can be done in

1. **Sign in to the Drive panel under the *old* client and press "remove the copy from my Drive".**
   That is the only moment those files are reachable. Skip it and they are orphaned in the reader's
   quota forever. **Not applicable this time — there was nothing to clear**, for the reason above.
   Kept, because it applies to any future change of client.
2. Create the new project, consent screen and client. Done — the block at the top of this section.
3. Swap `VITE_GOOGLE_CLIENT_ID` locally and in all three Vercel environments, **then redeploy** — it
   is a build-time `import.meta.env` value, so an env change alone does nothing. Done: the old value
   was removed from production, preview and development, the new one set in each, and the result
   confirmed by reading it back with `vercel env pull` (the pulled file was then deleted). The deploy
   is verified from the outside, not assumed: `read.flyleaf.cc` now serves `index-Bw-_-Zio.js`, which
   contains commit `458c380` and the new client ID, and **does not contain** the old
   `997776608568-…` one anywhere.
4. Reconnect in the panel. The folder is new and empty; the first sync repopulates it from local,
   which is the direction that cannot lose anything. **This one is the owner's** — it needs a real
   Google sign-in, which is the one thing this tooling does not do.

#### What can be automated, corrected

This section used to say the Console could not be reached from here at all, and gave two reasons.
One of them still holds and the other does not, so both are set down straight:

- **Still true.** There is no `gcloud` on this machine, and installing it would not help:
  `gcloud auth login` is an authentication flow, which this tooling does not perform. The Resource
  Manager REST API needs a `cloud-platform` token, obtainable only the same way. And Playwright
  cannot drive the owner's real Chrome profile: Chrome 136+ refuses automation against the default
  user-data-dir — *"DevTools remote debugging requires a non-default data directory"* — and
  Playwright always passes `--use-mock-keychain`, so sign-in tokens fail to decrypt even when it
  does launch. The only way round both is copying somebody's whole Google session store to a scratch
  profile, which is not a thing to do to an account.
- **No longer true.** *"So the Console clicks are the owner's."* They were not. The **Playwright MCP
  extension** drives the already-signed-in session in the owner's own browser, and the whole of step
  2 — project, consent screen, audience, test user, scopes, client, four origins, and later the
  branding URLs and the publish itself — was done that way on 23 Aug 2026 at the owner's explicit
  and repeated request. **Signing in** is still not
  something this tooling does; **using a session the owner has already signed in to** is a different
  act, and the earlier text conflated them.

Two working notes for whoever drives that Console again, because both cost time to find:

- `browser_click` never resolves on Console pages — Angular Material animates continuously, so
  Playwright's "visible, enabled and stable" check never settles. Click through `browser_evaluate`
  with a direct DOM `.click()`, matching buttons on their normalised `innerText`.
- `browser_type` is unreliable in Console fields. Set values with the native
  `HTMLInputElement.prototype.value` setter and dispatch `input` and `change`; chip fields need a
  synthetic `keydown`/`keyup` with `key: 'Enter'` on top. And the Application-type control is
  Google's own `<cfc-select>`, not a `mat-select` — find it by `[role=combobox]`.

#### Billing: no card, and none needed

The Console account is on the **free trial** ($300, expiring Sep 2026) and there is no budget to
upgrade. That turns out not to matter, and the reasoning is worth keeping so nobody pays for this
later out of vague anxiety.

Nothing any Flyleaf app uses is billable. Projects, OAuth consent screens, OAuth clients and the
Drive API for `drive.appdata` are free, and none of them requires a billing account to be *attached*
in the first place. The exposure is therefore not a bill; it is that a project tied to a billing
account which lapses can be carried into a suspended state along with it — and those projects hold
the clients the apps authenticate against.

**So the posture is detached billing, not an upgrade.** A project with no billing account attached is
the permanently-free state: no card, no trial clock, nothing to expire. Google's "free tier" is not
an account type that can be chosen — it is a set of always-free limits on a normal account, and
reaching a normal account means attaching a payment method. Detaching billing gets the same outcome
here without one.

Concretely, and **the owner's, not this tooling's**, because billing sits behind a payment method:
detach billing from `flyleaf-press` and `flyleaf-505004`, and check that the new `flyleaf-ereader`
project did not auto-attach to the trial account — new projects sometimes do. Verify first that
nothing else in those projects uses a paid API; for Flyleaf it is OAuth and Drive only.

#### The steps, kept because a client can be recreated or an origin can move

Done once already, and written out so it needs no rediscovering.

1. Open **console.cloud.google.com** signed in as the account that owns the project —
   `ajayifey@gmail.com`.
2. Create a project. The name is what a reader sees on the consent screen, so it is
   **Flyleaf eReader**, not a slug.
3. **APIs & Services → OAuth consent screen.** App name *Flyleaf eReader*, support email and
   developer contact `ajayifey@gmail.com`, audience **External**. This step agrees to Google's API
   Services User Data Policy; it is an inherent part of registering, and it was declared before it
   was ticked.
4. **Audience.** A new External app starts in *Testing*, where only listed test users can connect
   and every sign-in carries Google's *"hasn't verified this app"* interstitial. Add the owner's
   address as a test user to get moving, then **Publish app → Confirm** once the Branding page has
   an application home page, a privacy policy link and a Terms of Service link — see the three
   conditions above that keep publishing a switch rather than a review. Publishing before those
   three URLs exist is not possible; the Console's *"OAuth configuration is incomplete"* warning
   is that gate, not a broken client.
5. **Data access → Add or remove scopes.** `.../auth/drive.appdata` — a hidden folder, *not* the
   reader's Drive, which we cannot see outside of — and `.../auth/userinfo.email`, only so the panel
   can name the account. Nothing else.
6. **Clients → Create client**, type *Web application*. Add all four **Authorized JavaScript
   origins** from the table above — one per row, scheme included, **no trailing slash**, and `http`
   (not `https`) for the two localhosts. Leave **Authorized redirect URIs** empty. Save.
7. Copy the client ID into `app/.env.local` and into all three Vercel environments, then **deploy**.
   Google's own note says an origins change can take five minutes, and in practice sometimes longer.
8. Then check it, rather than assuming — and check it **twice over**. First reload the client page
   and read the rows back: a form that navigated away on Save is not proof it saved, and this one
   did navigate away. Then open `https://read.flyleaf.cc/settings`, press **Connect**, and expect
   Google's account chooser. If the panel says *"Google turned this away"* with an origin in it,
   that origin is the row that is still missing or mistyped — the message names it deliberately so
   this loop needs one pass, not four. An `origin_mismatch` in the first few minutes means *wait*,
   not *retype*.

One thing worth knowing before touching any of those screens: **the consent screen belongs to this
project alone now**, so editing the app name, logo or scopes here cannot touch Press. That is the
whole point of the split.

### 15.2 Three documents, not one

Press writes its whole library up as a single `library.json`, because a review changes when
somebody writes one. **A book's record changes when somebody turns a page** — every few seconds,
all evening. One undifferentiated file would re-upload every title, author, description and
highlight in the library to record that the reader is now on page 74. So the record is split by how
often each part moves, each part a separate Drive file with its own modified time:

| File | Holds | Changes when |
|---|---|---|
| `shelf.json` | books, collections, tombstones | a book is added, finished, edited or deleted |
| `marks.json` | highlights, notes, bookmarks | somebody marks something |
| `place.json` | positions and reading days | **every page turn** — and it is the smallest of the three by an order of magnitude |
| `book-<fp>` | the book bytes | written once, never rewritten. **Opt-in** |

The book files are opt-in because an appdata folder counts against the *reader's* Drive quota, not
ours. `FILES_PER_PASS = 3` caps how many move each way in one pass, and the cap is **loud**:
`SyncResult.filesLeft` carries what did not go and Settings says so in words. Uncapped, connecting
a phone with a forty-book library would open forty concurrent multi-megabyte uploads on somebody's
mobile data, and the bill would be the first they heard of it. Three a pass at a ninety-second beat
clears forty books in about twenty minutes of the app being open, and stops when it is closed.

### 15.3 Identity is the file, and deletions are tombstones

`Book.id` is a UUID minted at import, so the same novel imported on a phone and on a laptop has two
different ids — a naive merge leaves the reader with two of everything and a position that never
crosses over. Titles cannot decide it either: two editions share a title, and a re-typeset EPUB of
one edition is a different file with the same one.

So identity is the **file**. `Book.fp` is the SHA-256 of the bytes — the only thing two devices can
compute and agree on without ever having spoken. A merge builds a map from incoming ids to local
ones through it, and every row that points at a book (locator, highlight, bookmark, reading day,
collection membership) is rewritten through that map before it lands. Two readers with the same file
get one book; two with different files get two, which is **honest**, because a CFI from one would
not resolve in the other.

The rule is **merge, never pick-one.** Nothing asks which side wins: it takes the union, resolves a
genuine collision by the later timestamp, and writes the merged whole back up so both sides end
holding the same thing. That is what makes overwriting a Drive file safe — nothing is ever replaced
by less than itself. Which in turn means a deletion cannot be an absence, or a book removed on the
phone walks back in from the laptop. Deletions travel as **tombstones** (`graves`, Dexie v6), and a
book's tombstone names its *fingerprint*, not its id — the id it had on one device means nothing on
the other.

### 15.4 Nobody should ever press "Sync now"

Connecting once is the only thing anybody should have to do. Three triggers, because two devices
staying level needs both halves:

- **Push, after a write.** Dexie hooks on the six tables that hold the record schedule a sync,
  debounced by `SETTLE = 15_000`.
- **Pull, on a timer, while the app is in front.** `BEAT = 90_000`. The other device writing is not
  an event this one can hear, so it has to go and look. Only while visible — a backgrounded tab
  costs battery and finds nothing.
- **On arrival** — at launch, and whenever the app returns to the foreground, which is the moment
  the other device is most likely to have moved.

`QUIET = 20_000` is a floor under all three so no combination can loop, and it **delays** a sync,
never cancels one: a blocked attempt books itself for the moment the floor lifts. Otherwise a book
added just after a sync waits out the full beat — if the app is even still open when it comes round.

`SETTLE` is **four times Press's four seconds**, and the difference is what is being debounced.
Press debounces a typing hand, where four seconds after the last keystroke is the end of a
sentence. This debounces a *reading* hand, and the write lands on every page turn: at four seconds
a reader turning a page every twenty seconds would upload three times a minute for the length of a
novel. Fifteen seconds costs at most fifteen seconds of staleness on a device nobody is looking at,
and it is flushed the instant the app backgrounds — which is the moment it matters.

Each trigger is cheap when nothing has changed. `run` compares three Drive timestamps against three
stored marks and returns without moving bytes, so a poll on an idle pair is a single listing call.

### 15.5 The one question it ever asks

`flyleaf-ereader-wrote-offline` is set the moment anything is written while this device is *not*
connected, and cleared by the first sync that succeeds after it. It is the single input to the only
question sync ever puts on screen — connecting a device carrying work Drive has never seen is the
one case where two libraries genuinely diverged with nobody able to watch it happen. Automatic syncs
are held while that question is up; an explicit `syncNow` still runs, because it is only ever called
by something somebody pressed.

### 15.6 What is verified, and what still is not

- **The round trip works.** The owner connected on their phone on 22 Aug 2026 and the panel read
  *On, syncing to their account · last synced just now* / *Connected. Synced.* That is the first
  real grant this app has had, and it settles the questions a driver cannot reach: the consent
  screen, the token, the hidden folder, the write.
- **`app/audit/sync.mjs` covers the record layer** — identity by file, tombstones, a deleted book
  staying deleted, a foreign device's stones kept, and the signature moving and then holding
  steady. It needs a dev server (`npx vite --port 5199`), which is why it is not in `sweep.mjs`.
- **Still unverified:** two devices diverging *while both are offline* and then meeting, which is
  the case § 15.5 exists for; and the OAuth popup inside an **installed** iOS PWA, where
  `display: standalone` may swallow the window. The first connect on a phone should be made in
  Safari for that reason.

### 15.7 The panel says "synced", so nothing beside it may say "wrong"

The connected panel used to end in a plate outlined in `--danger`, headed *Remove the copy from
Drive*. It was drawn that way because it is the only control in the app that deletes something in
somebody else's account — and it was wrong, for a reason no amount of correct copy could fix: it
sat directly under the line reading *Connected. Synced.*, and a red-outlined block under a success
message reads as the report of a failure. The owner's words on seeing it were that it *"gives the
impression that the sync was not successful."*

It is now **two rows and no plate**, Press's shape verbatim (`DESIGN.md` → *The settings row*):

| | Row | Button | What survives |
|---|---|---|---|
| 1 | **Stop syncing** | `Disconnect`, ghost | The copy in Drive. Connecting again picks it back up |
| 2 | **Remove the copy from Drive** | `Remove`, danger | Only the library on this device |

Both were already reachable — Disconnect was a button beside *Sync now* with its explanation in a
paragraph below, which put the two exits at opposite ends of the panel when the only thing
separating them is whether the copy in Drive survives. Adjacent, that difference is the whole
comparison. And the sentence *this cannot be undone from here or from Drive* now appears **on the
press**, in the inline confirm, rather than sitting on screen warning about something nobody has
done yet.

### 15.8 Four of the eight Settings panels fold

Settings reached eight panels and roughly four phone screens, most of it read once: what the app
refuses to open, which two books came included, what it is built out of. **Backup**, **Included
books**, **The Flyleaf apps** and **The small print** are now `Fold`s. Backup opens by default
because it carries live state and a status line; the other three are closed. The affordance is
Press's `.disclose` — a `<button aria-expanded>` around the label with a chevron on the trailing
edge — drawn with this app's own `ChevronIcon`. `app/audit/states.mjs` opens *Included books*
before pressing *Restore included books*, because that control now lives behind a press.

---

## 16. The deploy

Same shape as Press, deliberately: a static build, no server, nothing to provision, and one
optional env var (`VITE_GOOGLE_CLIENT_ID`) that only decides whether the Drive panel appears.

| | |
|---|---|
| Vercel project | `flyleaf-ereader`, team `simplypheyie96s-projects` |
| Root directory | `app` — so the link lives at the **repo root** and the build runs one level down, exactly as Press does |
| Framework | Vite. No build or output command set; the defaults are correct |
| Domain | **`read.flyleaf.cc`** — attached, verified, and aliased |
| Protection | `ssoProtection: all_except_custom_domains`. The `*.vercel.app` URLs ask for a Vercel login; `read.flyleaf.cc` is public. Press has protection off entirely; this is the tighter of the two and there is no reason to loosen it |

`vercel.json` carries three things and each earns its place: a catch-all rewrite to `/index.html`,
because a client-routed SPA 404s on a deep link otherwise; `max-age=0, must-revalidate` on `sw.js`,
`registerSW.js` and `manifest.webmanifest`, because a cached service worker is an app that can
never update itself; and a year of `immutable` on `/assets/*`, which is safe precisely because Vite
content-hashes those filenames.

### 16.1 Done — the record is in and the certificate issued

**`https://read.flyleaf.cc` is live.** The owner added the record, and it was added correctly:
`read` → `8cb29bd68555802f.vercel-dns-017.com.`, grey cloud, with the A records resolving to
Vercel's own `216.198.79.1` / `64.29.17.1` rather than into Cloudflare's space, which is how you
can tell from the outside that it is not proxied. Vercel reports the domain `verified`,
`misconfigured: false`, `configuredBy: CNAME`.

There was a gap of some minutes where **HTTP served the app and HTTPS returned nothing** — TCP
connected and the TLS handshake failed with `SSL_ERROR_SYSCALL`, which is what "no certificate at
the edge yet" looks like rather than a misconfiguration. `vercel certs issue read.flyleaf.cc`
settled it in 13 seconds. Worth keeping: a correct record plus a failing handshake is a waiting
game, not a bug, and the fix is to ask for the certificate rather than to re-edit DNS.

The record, for the record:

```
Type    CNAME
Name    read
Target  8cb29bd68555802f.vercel-dns-017.com
Proxy   DNS only  (grey cloud — NOT proxied)
```

**DNS only** matters. Proxying it puts Cloudflare's TLS in front of Vercel's, which breaks
certificate issuance and gives a redirect loop.

#### What it took, kept for the next subdomain

`flyleaf.cc` runs on Cloudflare nameservers, so Vercel could not write the record itself. The domain
was already attached and verified on the Vercel side — the apex was verified long ago by the `flyleaf`
project, which is why the subdomain needed no TXT challenge. What is missing is one DNS record, in
the Cloudflare dashboard:

`press.flyleaf.cc` is set up exactly this way and resolves straight through to its own
`vercel-dns-017` target — copy that record's settings and change the two values.

One trap on the Vercel side: `vercel domains inspect` lists the nameservers as Cloudflare's, with ✘
marks against Vercel's intended ones. That is **expected** for a CNAME-configured subdomain, not an
error to chase. And the project identifiers live in the **repo root** `.vercel/project.json`, not
in `app/.vercel/` — the linked directory is the root, and guessing the team ID instead of reading it
returns a flat `Not authorized`.

### 16.2 Where the address is written down

A live domain is only half of it. Until the app itself knows its own address, a shared link has no
title card, a search engine has two URLs for one page, and the repo gives a visitor nowhere to go.
So the address is now recorded in exactly five places, and each is there for a different reason.

| Where | What | Why it needs the absolute URL |
|---|---|---|
| `app/index.html` | `<link rel="canonical" href="https://read.flyleaf.cc/">` | A preview build and production serve the same page; canonical says which one is the page |
| `app/index.html` | `og:url` | A share card has to link somewhere, and a relative path resolves against the wrong host |
| `app/index.html` | `og:image` → `/icons/icon-512.png`, plus `og:image:width/height` and `twitter:card=summary` | Open Graph images cannot be relative — they are fetched by somebody else's server. `summary`, not `summary_large_image`, because the mark is square |
| `app/package.json` | `homepage`, `repository` | Where the thing lives and where its source lives, for anything reading the manifest |
| GitHub | repo homepage field + the URL on the first line of `README.md` | The repo is private, so this is the only signpost a collaborator gets |

Two deliberate omissions:

- **The manifest has no `start_url` change.** It stays relative, because the manifest is read by the
  installed app from whatever origin installed it — hard-coding production there would break a
  preview install.
- **Settings' outbound links do not include this app.** `OUT` in `SettingsPage.tsx` lists
  `flyleaf.cc`, `press.flyleaf.cc` and the maker's site — destinations *outside* the app. Linking
  `read.flyleaf.cc` from inside `read.flyleaf.cc` is a link to where you already are.
