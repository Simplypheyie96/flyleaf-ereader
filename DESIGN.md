# Design System — Flyleaf eReader

> The authority for how this project looks. If code and this file disagree, this file wins.
>
> **Inherited, by instruction, from Flyleaf Press** (`../Review app/DESIGN.md`). Every colour,
> face, radius, border and motion value below either comes from Press unchanged or is a
> **stated addition** for a role Press does not have. Nothing is carried from Flyleaf (the
> journal app) — no glass, no textured sky, none of its faces.
>
> Additions are marked **NEW** and each one says why Press could not supply it. If you are
> tempted to add a sixth colour or a fourth face, that mark is the bar: name the role Press
> has no token for, or use what is here.

**Name: Flyleaf eReader** — a sibling to Flyleaf Press under Flyleaf. **Press's rosette, the same
mark**, presented differently — see *The mark* below. Rendered in `--ink` in chrome, same as Press's is in
Press's. Same neutral chrome rule: **mostly ink on paper**. Where Press's pastels are *card grounds*, here they are **page stocks
and highlighter tints** — the same printed-paper logic applied to a different printed object.

## Direction

**Feels like:** a well-made trade paperback with a quiet, archival case around it. The library
is a printer's shelf — mono micro-labels, hairline rules, covers as objects. The reading page is
a **page**: nothing on it that a book would not have.

**The one rule that governs everything else:** *chrome is where the design lives; the reading
page is where it gets out of the way.* Press's restraint — no shadow, no glass, no blur,
hairline borders, near-square corners — is not a limitation to work around here, it is exactly
what a reading surface needs. Every decoration Press allows itself (rotation, paperclips,
polaroid plates, washi tape) stops at the reader's door and lives only in the library and on
book detail.

**Explicitly not:**
- Not Flyleaf the journal. No `backdrop-filter`, no textured sky, no Instrument Serif / Patrick Hand.
- Not a page *curl*. See **Motion**.
- Not a scroll-only reader. Paginated is the default; scrolled is a setting.
- Not skinning the book. An author's own CSS is respected unless the reader overrides it.

---

## Colour

Every token below is Press's, at Press's value, unless a heading says otherwise.

### Chrome — light

| Token | Value | Job |
|---|---|---|
| `--paper` | `#F4F2ED` | Page ground behind the app |
| `--card-w` | `#FAF8F3` | Panels, rows, nav pill, inputs, sheets |
| `--ink` | `#1B1917` | Body, titles |
| `--ink-soft` | `#6B655C` | Metadata, mono labels, secondary |
| `--rule` | `#E0DBD1` | Hairlines, dividers, field borders |
| `--danger` | `#B42318` | Destructive only |
| `--accent` | `var(--ink)` | Not a colour. Press's terracotta is gone — see *`--accent` is an alias* |
| `--accent-fg` | `var(--paper)` | The type on a filled control |

### Chrome — dark

Neutral grey, never warm. Every value R=G=B, per Press.
`--paper:#151515` · `--card-w:#1E1E1E` · `--ink:#E9E9E9` · `--ink-soft:#969696` ·
`--rule:#343434` · `--danger:#F08379`

### Chrome — sepia and ink **NEW (role, not values)**

Two more chrome appearances, by the owner's instruction, so the app around the book
can be warm without the book's own page changing. **Neither introduces a colour.**
Sepia's ground and ink are the **Tea** stock's; Ink's are **Dusk**'s. What is new in
each is one card surface, because a stock has one ground and chrome needs two — a
panel has to separate from the page behind it.

`sepia` — `--paper:#EADCC3` · `--card-w:#F2E7D2` · `--ink:#2A231C` ·
`--ink-soft:#655A4A` · `--rule:#D8C6A6` · `--danger:#8F1D14`
`ink` — `--paper:#1B2430` · `--card-w:#232E3C` · `--ink:#D9E4F2` ·
`--ink-soft:#96A6BB` · `--rule:#33414F` · `--danger:#F08379`

Measured, both grounds, WCAG 2 AA:

| | ink on paper | ink on card | soft on paper | soft on card | danger on paper | danger on card |
|---|---|---|---|---|---|---|
| sepia | 11.45 | 12.64 | 4.98 | 5.50 | 8.19 | 9.04 |
| ink | 12.17 | 10.69 | 6.31 | 5.54 | 6.13 | 5.39 |

`ink` was a warm brown — `#2E2823` paper, `#E4D9C6` ink, the row above reading
10.42 / 9.33 / 5.46 / 4.90 / 5.70 / 5.11 — until the owner asked for the blue. It was
re-hued, not re-lit: same lightness targets, a cool hue, and every pair re-measured.
It is the one deliberately cool surface in the app, and the guardrail against
blue-shifted grounds still holds for the *reading* stocks.

One value is deliberately **not** its stock's:

- **`--danger` in sepia** is `#8F1D14`, deepened from light mode's `#B42318`. The
  original *passes* here at 6.60 — it was changed because against a tan ground it
  reads orange, which on this palette is the accent's job. Deepened, not re-hued.

Ink is a dark **ground**, not "the dark theme": the grain overlay's blend mode is
keyed on both dark-ground themes, not on the one named `dark`.

### Page stocks **NEW (role, and three new values)**

Press has five card grounds and calls them *paper stocks, not themes* — "coal is a paper stock,
not a dark mode." A reader needs the reader to choose the stock, which Press never did, so this
is a new **role**. Press's four values are unchanged; **Tea, Dusk and Pitch are new**, because
Press's set has no deep sepia and only one dark, and a reading app is used in rooms a review app
never is.

| Stock | Ground | Text | Notes |
|---|---|---|---|
| **Press** | `#FFFFFF` (`--card`) | `#1B1917` | Press's own card white. Maximum contrast; bright rooms. |
| **Day** *(default)* | `#F4F2ED` (`--paper`) | `#1B1917` | The app's own paper. |
| **Butter** | `#F6EBD9` (`--butter`) | `#1B1917` | Light sepia. Evening. |
| **Tea** **NEW** | `#EADCC3` | `#2A231C` | Deep brown paper, warm ink rather than black on tan. |
| **Coal** | `#221E1B` (`--coal`) | `#F4F2ED` (`--cream`) | Night. Black *paper*, per Press — not an inverted theme. |
| **Dusk** **NEW** | `#1B2430` | `#D9E4F2` | The blue night stock — cool by instruction, 12.17 measured. See `SPEC.md` § 2. |
| **Pitch** **NEW** | `#000000` | `#BFBAB2` | True black for OLED. Ink deliberately not white. |

Seven, and no custom stock — a picker turns a reader into a theme editor. Warm only: no cool-grey
or blue-shifted page, ever. Ink is never pure white on a dark ground. Every pair above, and every
ink-soft beside it, is **computed to WCAG AA before it enters this table** — the numbers, the
per-stock softs and the dark-stock highlight alphas live in `SPEC.md` § 2.

**The stock is independent of the chrome theme, and deliberately so.** Someone reads on Coal at
noon and on Press at midnight; tying the two together is a guess about a person's eyes. The
chrome follows System / Light / Dark; the stock is its own setting, and the app never changes it
on the reader's behalf.

### Lift — a surface on the page **NEW (role, derived, no new values)**

Every stock has exactly two grounds: the page and the hairline. Three things on the reading
surface need a third — a search field, a note card and the floating selection menu all have to
read as sitting *on* the page, and shadows are banned, so an edge and a slightly different ground
are the only things left to say it with.

```css
--lift:    color-mix(in oklab, var(--stock-bg) 92%, var(--stock-ink));
--lift-hi: color-mix(in oklab, var(--stock-bg) 86%, var(--stock-ink));
```

**Derived, not tabulated — which is the whole reason it is allowed.** It is the page moved 8%
(14% when focused) toward that page's own ink, so it cannot drift out of step with a stock, it
cannot come out cool on a warm page, and an eighth stock would need no line here. Declared once
on `.reader`; there are no per-stock values to measure and none to keep in sync.

**One stock is the exception, and it is Pitch.** A perceptual mix moves *lightness*: 8% of the way
from Pitch's L 0 to its ink's L 0.79 is L 0.063, and L 0.063 in sRGB is `rgb(1,1,1)`. Measured on
the built page: the panel came out 3/765 from the ground, so on the darkest stock nothing read as
lifted at all. Every other stock has room below its ground; Pitch sits on the sRGB floor and has
none. So Pitch alone gets the step tabulated, at the size the other dark stocks reach by formula
— Coal lifts 14/255 per channel, Dusk 13, both 25 for the focused state — and warm, in the ink's
own 191:186:178 ratio, so a lifted surface on black is not the one cool grey in the app.

```css
.reader[data-stock="pitch"]{ --lift:#0F0E0D; --lift-hi:#1A1918; }
```

Measured after the override: `rgb(15,14,13)` on `rgb(0,0,0)`, a 42/765 separation — the same
separation Coal gets from the formula.

Lift is not a card. It carries a 1px `--rule` edge and never a shadow, it never nests inside
another lift, and it never appears outside the reading surface — the app's own chrome has Press's
cards for this and does not need it.

### Page veil — a stock on a fixed page **NEW (role, and one value per stock)**

A PDF's paper is baked into the file. The stock can tint the surround, but it cannot repaint the
page, so a scanned white page on the Pitch stock at night is a torch in a dark room. The veil is
a flat fill over the canvas at a per-stock opacity — one composite, nothing per frame, and the
text layer sits above it so selection still works.

```css
--pdf-veil: 0;      /* press  */   --pdf-veil: 0.28;   /* tea   */
--pdf-veil: 0.16;   /* day    */   --pdf-veil: 0.42;   /* coal  */
--pdf-veil: 0.22;   /* butter */   --pdf-veil: 0.42;   /* dusk  */
                                   --pdf-veil: 0.40;   /* pitch */
```

**Why these are tabulated and not derived.** Lift can be derived because it moves a ground toward
its own ink. A veil moves *someone else's* page toward this stock's ground, and an opacity veil
can only darken — it cannot invert. So the ceiling on each value is a contrast measurement, not a
formula: black ink on the veiled white page, on the composited result.

| Stock | `--pdf-veil` | Black ink on veiled white |
|---|---|---|
| Press | 0 | 21:1 |
| Day | 0.16 | 14.73:1 |
| Butter | 0.22 | 12.02:1 |
| Tea | 0.28 | 9.86:1 |
| Coal | 0.42 | 7.51:1 |
| Dusk | 0.42 | 7.66:1 |
| Pitch | 0.40 | 7.37:1 |

The floor is 7.37:1 — AAA for body text, on the darkest stock. Pitch takes *less* veil than Coal
and Dusk deliberately: it is the stock a reader picks for a dark room, and past 0.40 the ink stops
clearing AAA without the page ever reading as black. The Page tint control multiplies this value
across `0 → 1`, so a reader can only ever ask for *less* veil than the stock's own figure — which
is why the measurement above is a guaranteed floor and not a best case.

The veil is only ever on a fixed page. A reflowable book has real text on a real stock and needs
nothing over it — a fill over live type is the banned paper texture by another name.

### Highlighter tints **NEW (role, and — for three of them — values)**

Press's remaining grounds, used as the marks a reader makes. Four fills and one underline is
the whole set — enough to mean something, few enough to stay nameable.

This began as *role, not values*: Press's four card grounds, reused unchanged. That was wrong,
and the reader found it before the audit did — *"the highlight colors don't show well."* A card
ground has to be barely-off-white so type can sit **on** it. A fill has to separate from the page
it is lying **on**. One hex cannot do both jobs, and these had only ever been checked for the
first: the ink read through the mark cleared 4.5:1 everywhere, while the mark itself against the
bare page had **no floor at all**, and butter landed at 1.17:1 on Press — a cream mark on a cream
page.

So pink, blue and butter now carry their own values. Press's **hue is held exactly** (within half
a degree), the new floor is met by giving up as little lightness as it takes, and what is left of
the budget goes to chroma — because a near-white that only sheds lightness comes back grey, and a
taupe is not butter. Mustard is Press's value, untouched: at 2.02:1 it was the one of the four
that already cleared the floor.

| Name | Value | Press's ground | Rendering |
|---|---|---|---|
| Mustard | `#DCA94C` | `#DCA94C` — unchanged | Fill |
| Pink | `#F0B3BE` | `#F3D9DD` | Fill |
| Blue | `#AFC9E3` | `#DAE4EE` | Fill |
| Butter | `#D6C19F` | `#F6EBD9` | Fill |
| Underline | `#1C5480` | — | **Underline, 2px** — never a fill |

The underline was terracotta `#C2410C` until the owner's *"no orange"*, and this table went on
naming the orange after the app had stopped drawing it. It is the ink blue now, `#7FB6EC` on a
dark stock.

**Rules**
- A highlight is drawn **behind** the words, never over them; the letters keep their own colour
  and go on showing through. A fill that dims the text it marks is a bug.
- **Two floors, both measured, both enforced.** `audit/tints.mjs` fails the run if either is
  missed on any of the twenty-eight fills: **4.5:1** on the ink read through the mark, and
  **1.7:1** on the mark against the bare page beside it. 1.7 is deliberately not a WCAG number —
  1.4.11's 3:1 governs the boundary of a *control*, and a 3:1 fill behind body text is a block,
  not a highlight. 1.7 is where a band is unmistakable at reading distance while the sentence
  still reads as text with a mark on it. The two never conflict: at the 1.7 floor the ink measures
  6.4–10.9.
- The underline is the exception that keeps Press's rule intact: a strong colour may appear here,
  but as a **rule under the text**, which is a printed mark, not as a wash of it across a
  paragraph.
- **On a dark stock, fills invert their job.** A pale wash behind cream text on a `#221E1B`
  ground destroys the text, and multiply is no help either — a pastel times a near-black page is
  mud. So on Coal, Dusk and Pitch a highlight is the same hue at low alpha *plus* a 2px bar in the
  left margin, and the text stays at the stock's own ink. The twelve alphas are the largest that
  hold **4.8:1** on that ink, not 4.5 — the headroom is there because the browser composites in
  its own colour space, and maximising against 4.5 put every pair inside a rounding error of it.
  No tint is approved by eye.
- **The bar goes in the margin, and the margin is half the setting.** Upstream inverts the side
  margin percentage to `g/(1−g)` so the outer padding and the inner column gap match, then pads
  the column by half of that — so the text edge sits at `size·g / 2(1−g)`, about 4.35% a side at
  the 8% default, not 8%. Deriving the bar's inset from the setting read literally put it 12px
  *inside* the column on a 612px pane, drawing a rule straight through the first character of
  every marked line. Measured: text starts at 26.59px on a 612px pane and 15.59px on a 358.8px
  one, and the bar now sits 8px clear of it at both.
- Highlighter tints never appear on chrome. In the annotations list they are 10px dots.

### The graph ramp **NEW (role, derived, no new hues)**

**There were six hues here, and they are gone.** The role was called *binding cloth* — the
coloured board a book is bound in — and it was six flat low-chroma fills on a neutral ground, one
per format family plus one for "in progress", borrowed as a *mechanic* from
[Buffer](https://buffer.com/) and [trycardinal.com](https://www.trycardinal.com/) on the owner's
note: *"not the green specifically, but how both use different colors. on neutral."*

It was cut, twice over. First: *"remove colors and let's retain flyleaf themeing."* Then, on
seeing what the half-removal left: *"just make it mono, like on flyleaf press, to avoid things like
this"* — *this* being a blue import button one row under a black active tab pill, two colours
claiming one role on one screen. Six hues × four themes is twenty-four values that have to stay
in step with four grounds, and the drift shows up as exactly that kind of disagreement.

What replaced it introduces **no colour at all.** Every value is the theme's own `--ink` mixed
toward its own `--rule` or `--card-w`, so a chart, a tile and a coverless ghost are the ink at a
*strength* rather than a hue. There is nothing to keep in step: a theme that redefines `--ink`
redefines all seven with it.

| Token | Derivation | Job |
|---|---|---|
| `--wash` | `--ink` 5% into `--card-w` | A surface one step off the card — a stat card, the continue card, a section plate |
| `--wash-2` | `--ink` 8% into `--card-w` | The same surface, pressed |
| `--graph-1` | `--ink` 16% into `--rule` | The faintest mark |
| `--graph-2` | `--ink` 32% into `--rule` | |
| `--graph-3` | `--ink` 50% into `--rule` | |
| `--graph-4` | `--ink` 70% into `--rule` | |
| `--graph-5` | `--ink` | The strongest mark |

`--wash` and `--wash-2` are **surfaces**. `--graph-1..5` are **marks**. Neither is ever type: text
on a wash is `--ink` or `--ink-soft`. And `--accent` is deliberately **not** a ramp step — accent
means *the thing to do*, and a bar chart is not a thing to do.

**Two things were lost, and are stated rather than glossed.**

1. **A format can no longer be read off a colour.** It is read off the mono label that was always
   printed on the coverless ghost anyway, and off the key under the chart. The colour was never
   the only channel; it was the redundant one.
2. **A chart is one series in one ink.** Where a chart genuinely has parts, the parts are *ordered*
   ramp steps — largest ink first, not assigned per format at random — plus a **named key**. On the
   calendar that key is `Less … More`; on the shelf's format mix it is the format name and its
   count, where the dot is `aria-hidden` and the label is text. The chart is readable with no
   colour vision at all, which the six hues only claimed to be.

#### Measured

Every graph surface in the app is a `--rule` track with ramp steps painted into it — the reading
calendar, the format mix bar, the top-books fill — and on the calendar **`--rule` *is* level
zero.** So the pale end is not supposed to clear 3:1 against its ground: `--graph-1` means "one
session that day", and a day with one session must read as barely more than a day with none.

| Theme | `--ink` on `--wash` / `-2` | `--ink-soft` on `--wash` / `-2` | steps 1–5 on `--rule` | neighbours 1↔2 … 4↔5 |
|---|---|---|---|---|
| Light | 14.71 / 13.80 | 4.84 / 4.54 | 1.43 2.13 3.46 6.19 12.71 | 1.49 1.62 1.79 2.05 |
| Dark | 12.46 / 11.66 | 5.12 / 4.79 | 1.50 2.27 3.56 5.61 10.25 | 1.52 1.57 1.58 1.83 |
| Sepia | 11.41 / 10.67 | 4.97 / 4.64 | 1.37 1.93 2.94 4.79 9.26 | 1.41 1.52 1.63 1.93 |
| Ink | 9.53 / 8.86 | 4.94 / 4.60 | 1.45 2.10 3.13 4.73 8.13 | 1.44 1.49 1.51 1.72 |

**What is gated** is the two things that carry meaning: `--ink-soft` on `--wash-2` clears **4.5**
in all four themes, and every adjacent pair of steps clears **1.2** so no two steps collapse into
one. The steps-on-`--rule` column is **recorded, not gated** — it is a non-text mark whose whole
job at the pale end is to be nearly the ground. `--graph-1` is gated at 1.2 against `--rule` only,
which is the difference between "a little" and "none".

`--wash-2` was **9%** and shipped that way. At 9% the `--ink-soft` line inside a pressed continue
card measured **4.41** in light — the one theme it failed in, and by 2%. 8% clears 4.5 everywhere
and keeps the press visible as a 1.067 step above `--wash` against 1.097 before. Verified by
`audit/ramp.mjs`, which is checked in so the next derivation change is a finding.

#### Format families keep an order, not a palette

The step is a *position*, so a stacked bar of a shelf's formats is still legible. Ordered by how
much of a shelf each family typically is, strongest ink first:

| Family | Step | Formats |
|---|---|---|
| `epub` | `--graph-5` | EPUB 2, EPUB 3 |
| `kindle` | `--graph-4` | MOBI, AZW3, KF8 |
| `fb2` | `--graph-3` | FB2, FBZ |
| `text` | `--graph-2` | TXT, Markdown, HTML |
| `pdf` | `--graph-1` | PDF |

The mapping lives in the stylesheet, not in the component: `data-family` is data, and which step
a family wears is a design decision. The old cloth mapping had a seventh meaning — Sage, "in
progress" — which had no format and therefore has no step; progress is a filled bar and a
percentage, which is what it always should have been.

#### Mono chrome

The rule the ramp exists to protect, stated once. **Every mark in the chrome is the surface's own
ink at a strength.** Not a hue, not a second accent, not a brand colour. There are exactly three
exceptions in the whole app and each is a *different kind of thing*:

- **`--danger`** — its own colour (`#B42318` on `#FDF7F5`), because a warning painted in the
  interface's own emphasis stops reading as a warning.
- **The five highlighter tints** — the reader's own marks on a printed surface, not chrome.
- **The stocks** — the reading page is paper, and paper has a colour.

Everywhere else, a coloured fill in the chrome is a bug.


### `--accent` is an alias, not a colour

It was briefly a colour. `--accent` was promoted out of Press's *"printed surfaces only"* to mean
**"this is the thing to do"** in the chrome, painted terracotta — and the result was a black active
tab pill one row above a blue circular import button, both of them claiming the same role. Two
colours for one role is not an accent; it is a bug with a palette. Press has no chrome accent at
all: its emphasis is ink on paper. This app is Press's.

So **`--accent` is now an alias for the surface's own body pair** — `--accent: var(--ink)` and
`--accent-fg: var(--paper)`. Every use site keeps working and they all agree, in one place, in
every theme: a theme that redefines `--ink` redefines the accent with it and cannot drift out of
step again. Contrast is therefore the theme's own highest pair — **15.67:1 light · 14.30:1 dark ·
11.45:1 sepia · 12.17:1 ink** — and `[data-stock]` re-pins both inside the reader, so a filled
control on a Coal page is cream on near-black, not cream on cream.

`--danger` keeps a colour of its own (`#B42318` on `#FDF7F5`). A warning painted in the interface's
own emphasis stops reading as a warning, and mono chrome that swallowed the one destructive signal
would be a worse bug than the one this fixed.

**Rules**
- **One filled emphasis per screen.** Two primary buttons in one view means neither is primary.
  Everything else is neutral — a bordered `--card-w` control, or text.
- **Emphasis and the ramp do not overlap in meaning.** Emphasis is an *action*; a ramp step is a
  *quantity or a kind*. A filled format chip would say "press me" about a file extension, which
  is why `--accent` is not a ramp step and `--graph-5` is not a button.
- **A filled control is flat.** One fill, one radius, optionally one hairline. No gradient, no
  shadow, no glass — the ban below is unchanged.
- **Never a filled emphasis on the reading page.** The stock owns that surface. `[data-stock]`
  re-pins `--accent` there so the reader's own controls stay legible, but the page itself shows
  highlighter tints and nothing else.
- **A theme swatch is the one place a hex is hard-coded.** A dot in the theme picker shows a theme
  that is *not* the active one, so `var(--paper)` would paint all five alike. That is also the one
  place these values can drift, and Ink's did — it went on painting the retired warm brown for a
  release after the theme was re-hued blue. `audit/swatches.mjs` reads each dot against its
  theme's live tokens so the next drift is a finding, not something the owner has to spot.

---

## Type

Press's four families keep their exact jobs. One family is added, for a role Press does not have.

| Role | Family | Notes |
|---|---|---|
| **Book text** | **Literata** **NEW** | See below |
| Book text, alternates | Fourteen more, **NEW**, same role — see *The fifteen reading faces* below |
| Names — book titles, authors, chapter names, page headers | Playfair Display | Press's masthead voice, unchanged |
| Chrome — labels, buttons, fields, prose | Archivo | Press's chrome face, unchanged |
| Micro-labels and metadata on printed surfaces | IBM Plex Mono | Press's card voice, unchanged |
| **The reader's own hand** — notes on a highlight | Kalam | Press's rule, unchanged |

**Why a fifth family.** Press has no body-serif role, because Press's body copy is
*handwriting*. Playfair is a display face — at 17px over 300 pages its thin strokes go to
nothing — and Kalam is a hand, which is the one thing a book's own text is not. So the role is
genuinely absent, and Literata fills it: drawn for e-readers, variable (one file covers the
weight and optical-size range), and warm enough to sit under Playfair without arguing.

**Rules**
- **Kalam carries the reader's notes and nothing else** — Press's rule, and it lands even better
  here: a note in a hand beside printed text is exactly what a margin note is. Never a label,
  never a button, never a book's text.
- **The alternates are the reader's choice, not the app's.** They load on selection, never at
  boot — fifteen reading faces precached is fourteen faces nobody asked for.
- **Nothing in chrome goes below 11.5px**, and chrome prose sits at 12–13px. Press's floor.
- Reading text starts at **18px / 1.6** and is the reader's to change: 14–28px, leading
  1.2–2.2, both continuous, not stepped.
- **The measure is capped in the reader and only in the reader** — 34em, or two columns above
  1180px. Press bans a measure cap on its card body because the card's own width *is* the
  measure; a reading pane is 1400px wide on a laptop and an uncapped line there is unreadable.
  Opposite surfaces, opposite rules, same reason: the line length must be right.

### The fifteen reading faces

**Five serif, ten sans.** The split, not the count, is what the control is built on: the picker
groups by it, and a reader who wants "not a serif" wants a *list*, not one grudging alternative.

It got here in two corrections, both the owner's. First: *"add more serif fonts, like in apple
books, like avenir next, and other pretty ones"* — Avenir Next is a **sans**, which is the note
inside the note. Then, after three of the first sans picks turned out not to be sans at all:
*"charis is not great, gelasio is not a sans serif and volkorn is not san serif, i want sans serif
like avenir next, remove those 3 and add other sans serif options."* Charis, Gelasio and Vollkorn
are gone. What replaced them is a real sans list with two faces aimed squarely at Avenir.

| Face | Kind | What it is for |
|---|---|---|
| **Literata** | serif | The default. Drawn for screens, at every size. |
| EB Garamond | serif | Old-style, light on the page. Set it a size up. |
| Source Serif | serif | Even and quiet. Holds up small. |
| Newsreader | serif | Sharper, with more contrast. Good in a large size. |
| Lora | serif | Brushed curves and more contrast. The pretty one. |
| Inter | sans | Neutral and screen-native. Optically sized, like Literata. |
| Source Sans | sans | Humanist, open. The sans that reads like a book. |
| Nunito Sans | sans | Rounded and warm. Softer than the rest. |
| **Mulish** | sans | Geometric and near-circular. **The closest open face to Avenir.** |
| Plex Sans | sans | A text family, not a UI one. Shares its hand with the app's mono. |
| Franklin | sans | A news gothic. Narrower, so a phone line holds more words. |
| **DM Sans** | sans | Geometric with flat terminals. **The closest here to Avenir Next.** |
| Figtree | sans | A tall x-height, so it holds its shape at a small size. |
| Work Sans | sans | Drawn for text on screens at reading sizes, not for labels. |
| Atkinson | sans | Drawn for low vision. Letters that cannot be confused. |

**Rules for adding a sixteenth.**
- **It must be a text face, not a UI face.** Work Sans and Plex Sans are in because they were
  drawn for running text; a face drawn for labels falls apart over three hundred pages.
- **It must be variable, or it does not go in.** One file covers the weight and optical-size range;
  four static weights per face across fifteen faces is a font directory nobody can precache.
- **Every face carries one line of its own.** The note under the name in the picker is what makes
  a list of fifteen usable — a reader picks by "warm", "narrow", "holds up small", never by name.
- **Nothing is added for range.** Fifteen is already more than Apple Books ships; a sixteenth has
  to do something none of these do.

---

## Space

Press's scale, unchanged. Base **4px**; every gap is a multiple.

- Page gutter 32px desktop, 20px mobile — **symmetric, verified by measurement.**
- Library max width 680px. Book detail 620px.
- **Reading page margins are the reader's setting**, 4–12% of the pane per side, default 8%,
  symmetric to the pixel. The foot rule sits 28px below the last line.
- Must hold **360px** with no horizontal overflow.
- **An empty state fills its screen.** It centres in what is left between the header rule and
  the nav's clearance, not flush under the rule with a third of the page blank below it. The
  lift above true centre is measured against the nav pill, not against the padding box — the
  page reserves 128px at the foot and the pill only occupies 70 of it, so the lift is small
  (8px). Verified: 143px above / 189px below at 375×812.

Generous and balanced is the default. Cramped or edge-to-edge is a bug.

### The chrome measure — `--measure: 74ch` **NEW (role, one value)**

Press has no token for this, and the reason is structural rather than an oversight: Press's
prose lives on printed cards of a **fixed** width, so the card *is* the measure and a cap would
be redundant — `../Review app/DESIGN.md` says as much when it bans a measure cap on the card
body. Here the same paragraph is set in a 634px settings panel, a 680px page column and a 320px
reader sheet, so the cap and the box are two independent numbers and nothing was keeping them in
a sensible relationship.

Fourteen hand-picked caps had accumulated — 34ch, 46ch, 52ch, 56ch, 62ch — each defensible in
its own rule and none of them related to the box it ended up inside. Measured on the built app
at 1280 and 1024:

| Where | Cap | Widest line | Box | Unused |
|---|---|---|---|---|
| `.fine dd` | 62ch | 452.3px | 634px | **29%** |
| `.tip-head .ui-p` | 46ch | 340.1px | 582px | **46%** |
| `.app-sub` | 52ch | 383.4px | 680px | **44%** |

At that much slack a measure stops reading as a measure and starts reading as a bug — which is
exactly how it was reported: *"the words wrapping before they fill the container."*

**74ch** is the top of the comfortable 60–75 range, so this is still a measure and not "fill the
box": at 13px it lands near 551px, which is 87% of the settings panel and 81% of the page column.

- **Wide chrome takes the token.** Settings panels, the tip card, page subtitles, collection
  notes, the reader's control notes.
- **Genuinely narrow contexts keep their own tighter caps** and are not a regression to fix: a
  centred refusal (34ch), an empty-state line (34ch), the PDF sheet's lede (46ch), and the drop
  zone's centred lede (34em) are narrow *by design*, and widening them would be a change nothing
  measured asked for.
- **`audit/measure.mjs` is the check**, on every route at 390 / 1024 / 1280. It walks each block
  of prose with a `Range`, merges its client rects by line box, finds the nearest ancestor wider
  than the widest line, and fails on more than 28% slack. The relationship between a cap and its
  box is invisible in the source — every rule reads fine alone — so it has to be measured or it
  silently comes back.

---

## Surface & depth

Press's, unchanged.

- **Radii:** 2px printed cards · 4px controls, chips, cover thumbnails · 12px sheets and modals ·
  999px pill nav only. **0 on the reading page** — a page has corners.
- **Borders:** 1px `--rule` on fields, chips, panels, rows, the nav pill. Printed cards have none.
- **Shadow: none, anywhere.** Elevation is hairline rules. Inset 1px rings are borders and stay.
- **Blur / glass: not used, anywhere.** The hard line against Flyleaf, and it holds here.
- **Rotation:** −1.4° to +1.6°, derived from the record id, never random. **Library and book
  detail only.** A tilted reading page is a joke that stops being funny on page two.

### Grain **NEW (role, on one condition)**

Press has no texture token, and this one exists because the owner asked for one: *"Add paper
texture to the app overall."* It is granted on exactly the condition the guardrail sets — **the
chrome is grained; the reading surface is not.** No texture ever sits over the book's own text,
and there is no drawn spine gutter.

One `feTurbulence` as a data URI, generated once and inlined, not fetched:
`baseFrequency='.62' numOctaves='4'`, desaturated to grey, `opacity='.20'`.

- **Frequency is what makes it read as grain**, not opacity. The first attempt was a low
  frequency at a higher opacity, which is cloud, not fibre — the owner's note was *"the texture
  shouldn't be too grainy. subtle but visible"*, and the fix was to raise the frequency and drop
  the alpha, so the noise lands at roughly one grain per pixel and averages out at reading
  distance.
- **It composites, it does not overlay.** `background-blend-mode: var(--grain-blend)` —
  **`multiply`** on the light theme, **`screen`** on both dark grounds. Multiply on a near-black
  page has nothing to darken against and simply disappears, so the dark themes invert the
  operation rather than raise the opacity.
- **Which means it must live on an element that owns its own background.** A blend mode composites
  with the layers underneath *in the same stacking context*; on a transparent element it has
  nothing to blend with. This is the one implementation detail that is not optional.
- **No second texture, no vignette, no edge darkening.** One grain, one blend, everywhere in the
  chrome.

---

## Motion

Press's values, plus one addition the reader cannot do without.

- Default **180ms**, `cubic-bezier(.2,0,0,1)`. Sheets 240ms. No springs.
- **NEW — the page turn.** A tracked swipe has no duration: it follows the finger. On release it
  commits over **260–420ms**, derived from the release velocity, on `cubic-bezier(.16,1,.3,1)`.
  Keyboard and tap turns use a flat 300ms on the same curve. This is the only place in either
  app where a duration is computed rather than declared, and it is why: a turn that takes the
  same time whether it was flicked or nudged is the single clearest tell of a web reader.
- **Slide is the default turn, and no turn carries a shadow.** The outgoing page separates by a
  **1px `--rule` hairline on its leading edge** — cleaner than a curl, and honest to the system.
- **Three turn styles, by the reader's choice: Slide · Fade · Instant.** Fade is a 120ms
  cross-fade; Instant is a cut. Full per-style motion, the commit durations and the gesture
  thresholds are in `SPEC.md` § 5.
- **There is no Curl, and there was.** A shadowless transform-only fold shipped into this list
  for one build: a real hinge at the crease, its back face a second warm render of the section
  reflected about that crease rather than a flat tint. It measured Layout 0, Paint 0 and a 1.4ms
  longest main-thread task over ten tracked frames at 4× CPU throttle — it **passed** — and the
  owner cut it on how it felt against the fold in Apple Books. The ban is therefore back and
  unconditional: the reason is the feel, not the frame budget, so a faster one is not a
  different answer. `SPEC.md` § 5.2 keeps the geometry and the numbers.
- **What animates:** the turn, sheet entry/exit, chrome show/hide, chip and button press,
  highlight application, the selection menu.
- **What never animates:** the book's text, the reading position, the stock change (a repaint,
  not a fade), the progress readout, anything during a turn that is not the transform.
- **A turn touches only `transform`.** No layout, no paint, no JS on the main thread while the
  finger is down. Neighbouring pages are laid out before they are needed, so a turn is a
  composite of work already done. If a turn ever measures anything, it is broken.
- **1:1 on every page, including the last page of a chapter.** The rubber-band belongs to the
  book's own two ends and nowhere else. A chapter boundary genuinely costs more — the next
  section is not laid out until the outgoing page has scrolled off — but that cost measured at
  **34–37ms, two frames**, so it buys a **140ms fade-in of the arriving page** and nothing more:
  no damping on the way, no lowered threshold, no fade-out of the page being turned. Damping it
  made one turn in six feel like the book had jammed, which is the failure this replaces.
- **A finger that stops has stopped.** Release velocity is read over the last **100ms** of the
  gesture only. An empty window is zero — never the gesture's average, which threw pages that
  had been resting under the thumb.
- **The highlight wipe overlaps.** 140ms total across the whole mark, but no single line gets
  less than 90ms to travel, so a four-line mark sweeps instead of arriving in four pops.
- `prefers-reduced-motion` replaces the turn with a **150ms cross-fade** and stops the tracked
  swipe from translating — the gesture still pages, it just does not slide.

### The gesture is measured in `screenX`, never `clientX`

This is the single correction that made the turn feel right, and it is invisible in a code review.

A pointer event raised inside a section's iframe reports `clientX` **through every transform
between that iframe and the screen** — and the turn *is* a transform on that iframe's parent. So
the moment the page starts moving, the coordinate the paginator is reading is being scaled by the
very motion it is driving. Dispatched over six even 40px steps of a real finger:

| Step | `screenX` Δ (the truth) | `clientX` Δ under Slide | `clientX` Δ under the old fold |
|---|---|---|---|
| 1 | −40 | −40 | −40 |
| 2 | −80 | −40 | −15 |
| 3 | −120 | −80 | −99 |
| 4 | −160 | −80 | −53 |
| 5 | −200 | −120 | −163 |
| 6 | −240 | −120 | −123 |

Under Slide it converges on **half the finger** — every slide turn tracked the thumb at 1:2, which
is precisely the "1:1 tracking" the brief calls non-negotiable, failed silently. Under the fold it
was **non-monotonic**: a delta could shrink or invert while the finger kept going, which is the
zig-zag the leaf did, and why a backward drag could commit a forward turn.

`screenX` is outside every page transform by definition. It is in CSS pixels, verified identical at
`deviceScaleFactor` 1 and 3, so pinch scale is read **once at touch-down** and held for the
gesture rather than sampled per move.

---

## Components

| Component | Spec |
|---|---|
| **Nav** | Press's mechanics exactly: floating capsule bottom-centre (`--card-w`, `--rule` border) of icon-only tabs, where the active tab grows into an ink-filled icon+label pill. The one real action, **add a book**, is its own 50px round ink button beside the bar, never inside it. **Four tabs — Home · Library · Stats · Settings** — see *The nav* below. Absent entirely in the reader, and `App.tsx` decides that, not the nav. |
| **Icons** | Press's: hand-drawn strokes on a 24 grid, weight 1.8, round caps, `currentColor`. Matched deliberately — Press's existing set is the committed one, so Remix Icon is **not** used here. |
| **Reading chrome** | Hidden by default; a tap in the middle third brings it back, another dismisses it. Top: back, book name in Playfair, TOC, search. Bottom: the progress readout and the type/stock button. Both slide out to their own edges, 180ms. **Floating, not barred** — see *The reader's floating chrome* below. |
| **Progress readout** | Mono, `--ink-soft`. `PAGE 4 OF 19 · 12 MIN LEFT IN CHAPTER · 34%`. Page counts are per **chapter**, because a reflowable book has no fixed pages and printing a whole-book page number the reader's own font size invented is a lie. Minutes come from a rolling measure of that reader's own speed, not a constant. Absent, not zero, until there is enough data. |
| **Position** | Stored as an **EPUB CFI**, so it survives every change of face, size, leading and margin. Restoring to the wrong paragraph after a font change is the failure this prevents. |
| **Cover** | Press's rule, unchanged: **real cover or nothing.** Extracted from the file; no generated placeholder. "No cover" is a small labelled ghost, never a cover-sized dashed tile. |
| **Selection menu** | Native selection, app-drawn menu positioned from the selection's own rects. Highlight (five tints) · Note · Copy · Look up · Search in book. One row, no wrap; a second row appears rather than shrinking the first. |
| **Note** | Kalam on `--card-w`, the highlighted line quoted above it in the reading face at 13px. |
| **TOC** | Full-height sheet, hairline rows, nesting by indent and never by a chevron the depth does not need. The current chapter is the one filled row. |
| **Search** | In-book, whole-book, with a mono count and the match in context. Hits are marked in the margin bar for the current chapter. |
| **Type sheet** | Three tabs — **Text · Page · Turn** — carrying the full control surface in `SPEC.md` §§ 3–5, and opening on whichever tab was last used. Every control shows its effect **live behind the sheet** — a type panel that hides the text it is setting is a form, not a control. |
| **Library** | Press's card language: covers-or-list toggle (persisted), mono micro-labels, hairline groups. Groups by **Reading · Finished · All**, with a Continue row at the top carrying the last book and its progress bar. **Ships with two books on it** — labelled `INCLUDED` in mono, removable, restorable; `SPEC.md` § 1. The first screen leads with a book, never with a button. |
| **Import** | File picker, drag-and-drop anywhere, and the installed app registered as a **file handler** so a `.epub` opens straight into it. Import is never a modal wizard — a dropped file lands in the library and starts opening. |
| **Collections** | Two per row on a phone, each a **plate** — a 4:5 surface holding up to three covers fanned symmetrically around a centred front one, with the count as a corner badge. See *The collections plate* below. The word is **Collections**, never Shelves. |
| **Launch screen** | The mark, the **name**, a hairline rule, and one line saying what this is. No spinner and no version. Waits on the web fonts up to 1s and holds a 1.2s floor from navigation, then paints regardless. The native iOS launch image is the same lockup in the same units — see *The launch lockup* below. |
| **Marks on paper** | Highlights and notes export as Markdown, plain text, JSON — and **PDF**, hand-written, base-14, no embedded font. See *Marks on paper* below. |

### The nav

Press's capsule, this app's tabs. It shipped as **Library · Reading · Settings** and the middle
one was doing two jobs badly: it was the shortest route back into a book, *and* it was the only
door to the history behind it. The owner's call — *"maybe we should separate home from library and
not even have reading at all, and convert reading to stats?"* — split them.

| Tab | Route | Owns |
|---|---|---|
| Home | `/` | The continue card, recently added, the way through to Stats. Exact match only. |
| Library | `/library` | Grid, list, collections — **and `/book/:id`**, because a book's sheet is a place in the library, not a fourth tab. |
| Stats | `/stats` | The calendar, the format mix, where the time went. |
| Settings | `/settings` | Themes, faces, storage, backup, the included books. |

`/reading` still resolves — it redirects to `/` — because a reader who bookmarked the old tab
should land somewhere, not on a blank route. `*` redirects there too.

**The bar does not render in the reader**, and that decision lives in `App.tsx` rather than in the
nav: a page-turn surface with a floating capsule over its bottom third is a page-turn surface with
a dead bottom third.

### The reader's floating chrome

On the owner's instruction: *"I also want floating icons on top common to ios apps, on the reading
page too."*

The bars used to be two 52px grid tracks, which took **104px** off the page and made revealing the
chrome cost a reflow of the book. They are now two rows pinned inside the read area, sharing it
with the page:

- **The paper reaches all four edges of the window** — which is the whole visual difference between
  this and a web page with a toolbar.
- **Revealing the chrome costs no relayout at all**, because nothing in the flow changes.
- **The text still never runs under a control.** The clear band the controls sit in is the
  paginator's own block margin, raised to `CHROME_INSET`, so a paginated page keeps its gutter.
- **No fill and no rule of their own.** Every mark on screen belongs to a control, so there is no
  strip of chrome to look at when the chrome is what you are not using.
- **No shadow, on any of the seven stocks.** `--lift` is the page moved 8% toward its own ink and a
  hairline closes it. A shadow would be the lazy way to say the same thing, badly, seven times.
- **`pointer-events` is the load-bearing line.** The row is inert; only its children are live. Get
  this wrong and the top and bottom thirds of the book stop turning whenever the chrome is open.

### The collections plate

Rebuilt on the owner's note: *"collections needs to be well built. they look so small."* They were
— three 58px spines with no ground under them, which at 150px reads as a thumbnail, not a shelf.

A tile is now a **plate**: a real 4:5 surface holding up to three covers, with the count as a
corner badge. Two per row on a phone, which is what makes it big — measured at 360px, a **152×190
plate with an 81px front cover**, against the old 58px spine. It holds at the floor as well:
132×165 with a 70px cover at 320px.

- **The fan is symmetric** — one cover behind on each side, not a stack trailing off to the left. A
  one-sided fan puts the visual mass off-centre inside a box that is itself centred, and then
  every tile in the grid looks nudged.
- **No rotation and no shadow.** Stacked covers are separated by a hairline ring in the plate's own
  fill, which is the device the reader's rail already uses.
- **Presence, measured.** The plate was `--wash` on `--paper`, a step of 1.06 in light and — because
  sepia's `--wash` and `--paper` land on the same luminance — exactly **1.00** in sepia. A surface
  you cannot see is not a surface, so the tile read as small however big the box was. It is now its
  own local pair: `--plate` at `--ink` 10% into `--card-w`, `--plate-edge` at 50% into `--rule`.
- **50%, not less.** At 44% the badge ring and the empty-shelf ghost measured **2.82** on sepia and
  **2.85** on ink — the two themes whose page and plate sit closest — and a boundary under 3:1 is
  one you have to look for.
- **An empty collection still gets a plate**, with a ghost outline where the covers would be, so it
  reads as a place books go rather than as a failure.
- **The row is fixed-height.** One collection having one book must not make its row shorter than
  its neighbours; that is the thing that makes a tile grid look broken.

**They are called Collections.** They shipped as *Shelves*, and the owner's question was the
verdict: *"I don't understand shelves. what it is used for?"* A shelf is furniture — it says where
a book sits, which is exactly what the app already decides for you. A collection says what the
reader grouped and why. Renamed throughout: the label, the empty state, the route and the record.

### The mark

**It is Press's rosette — the same mark, character for character.** Five petals and a centre
disc, `MARK` in `app/src/components/Mark.tsx` byte-identical to `MARK` in
`../Review app/app/src/cards/assets.ts`:

```
M256 57.6 A74.67 59.73 -90 1 1 256 206.93 A74.67 59.73 -90 1 1 256 57.6 Z  …five petals and a disc
```

The owner's instruction was *"find a way to present it differently from the Flyleaf Press"* — and
that is a **presentation** brief, not a redraw. One family, one mark; three products, three
presentations. An earlier pass here read it as a redraw and drew a new glyph. It was wrong, it is
reverted, and the sixteen rejected candidates that pass produced are not recorded because none of
them should ever be revisited: the question they were answering was not the question.

**What differs is the polarity.** Press sets the rosette bare — ink on paper, one
`fill="currentColor"`, nothing around it. Here it is **knocked out of a solid ink block**, so the
ground shows through the petals. A printer's block, which is the right object for an app whose
whole world is printed paper, and the one treatment that still separates the two at the 48px a
home screen shrinks an icon to: same silhouette, opposite ink. A hairline frame or a ruled circle
was the obvious quieter alternative and was rejected for exactly that reason — both read fine in
the nav and vanish in the icon, and the icon is the surface where being mistaken for Press
actually costs something.

**Three constants, three consumers.** `Mark.tsx` exports `MARK`, `TILE` and `VIEWBOX`;
`app/scripts/make-icons.mjs` and `app/index.html`'s inline splash carry the same strings, because
both run outside the bundle. `Mark.tsx` is the source.

**`fill-rule="evenodd"` is what makes the hole, and it is only safe because the rosette's six
subpaths are mutually disjoint.** Each petal is a whole ellipse — the two arcs share the major
axis as their chord — `149.33` long by `119.46` wide, centred `123.735` out from the middle. Its
greatest angular half-width is **31.2°** against the **36°** that 72° spacing allows, so no two
petals meet; its inner vertex stops at **r=49.07** against the centre disc's **38.4**, so no petal
meets the disc. Nothing is crossed twice by the rosette alone, so evenodd cancels exactly once —
against the tile. **Grow a petal and that sum has to be redone before the hole can be trusted.**
This also replaces the reversed-winding trick a previous mark depended on: with evenodd nothing
cares which way a subpath runs, so the shared path can stay byte-identical to Press's.

**The block is centred on the rosette's ink, not on the 512 box.** The ink spans `64.94–447.06`
horizontally, centred on `256`, but `57.60–425.97` vertically, centred on **`241.78`** — the
rosette has a point up and two feet down, so it is not vertically symmetric. Hence
`viewBox="-35 -49 582 582"`: a `582` square with `132` corners (`0.227` of the side, the ratio the
home-screen tile has always used) whose centre is `(256, 242)`. That is the whole reason the
viewBox is stated rather than left at `0 0 512 512`, and it is why the generator's `ty` is not
symmetric with its `tx`. `100` of clear ink either side of the rosette and `106.8` above and
below: a knockout needs more surround than a positive mark does, or the petal tips read as nicks
in the edge rather than as a flower.

**Because the block fills its viewBox exactly, there is no ink fraction left to convert.** A
requested span *is* the drawn span, and `MARK_FRAC` — which existed only to bridge an open form
and its padded box — is gone from the generator. The fractions that remain, and the measurements
that confirm them on the output:

| Surface | Fraction | Measured |
|---|---|---|
| install icons | `0.76` — deliberately not full-bleed, so iOS's own corner rounding never fights the block's `0.227` radius and only clips paper | `391/512 = 0.764`, centred to within a pixel |
| maskable | `0.62` — a rounded square of side `s` with `0.227s` corners reaches `√2(s/2 − 0.227s) + 0.227s = 0.613s` from its centre | `319/512 = 0.623`, furthest ink at radius **`0.382`** against Android's **`0.40`** |
| splash / launch | `80px`, down from the bare rosette's `88` | knockout verified pixel-wise: centre disc and petals read `#F4F2ED`, the inter-petal slivers and the tile read `#1B1917` |

**A filled block goes smaller than an open mark, not larger** — that is the one thing this
presentation gets wrong if it is scaled by habit. `72` and `80` were rendered side by side in the
launch lockup: `72` read as a chip under a big name, `88` is heavier than the `30px` wordmark can
hold, `80` is the anchor. The ramp was checked at `112/72/56/28/22/18/14px` on both grounds beside
Press's bare rosette; the petals stay separate down to `22px` and the flower still reads at `14`.

**The standalone source SVG is generated.** `assets/flyleaf-mark-source.svg` is written by
`make-icons.mjs` from the same three constants — full-bleed, transparent, ink stated because
`currentColor` means nothing in a file opened outside a stylesheet. It is what anything outside
the build takes the mark from. The file it replaces was a hand-typed second copy of the path, on
a blue gradient sky this project's guardrails ban, whose own comment pointed at four files that do
not exist in this repo. A second hand-typed copy of a path is the drift this section exists to
prevent.

### The launch lockup

Two screens have to be indistinguishable: the native iOS launch image, which appears instantly and
which the app cannot draw, and the in-page `#splash`, which paints over it. Anything that differs
between them shows up as a jump at the handoff — which is the one failure a launch image has.

So they are the **same layout in the same units** — and how that is guaranteed is the substantive
part. The generator does not hold a table of numbers *derived from* the CSS; it holds **the CSS
itself** and solves the layout from it. `make-icons.mjs` has a `CSS` object transcribing
`#splash`'s literals — box `80`, then each line's `margin-top`, `font-size`, `line-height`,
`letter-spacing` and opacity — and a baseline solver that walks the stack the way the browser does.

| Element | CSS | Baseline solved as |
|---|---|---|
| mark | `80px` box, filled edge to edge by the block | box top is the cursor origin |
| `Flyleaf eReader` | Playfair 500, `30px/1.1`, `-.008em`, `margin-top:24` | `lineTop + ⌊(box − (asc+desc))/2⌋ + asc` |
| the rule | `40 × 1px`, `currentColor` at `.18`, `margin-top:22` | drawn as a rect at the cursor |
| `READ WHAT YOU OWN` | Archivo 500, `11px/1.6`, `.16em`, `.55`, `margin-top:20` | same solver |

**The solver reproduces Blink's arithmetic, which was measured rather than read off a spec.**
Ideal-real arithmetic put the two baselines **0.97px and 0.47px low**. Blink actually (a) rounds
each font metric to a whole CSS pixel, (b) **floors** the half-leading, and (c) quantises the line
box to **1/64px** — `11 × 1.6` is `17.59375` on screen, not `17.6`. With hhea metrics (Playfair
`1082/−251`, Archivo `878/−210` per 1000 upem) that reproduces the measured baselines exactly. Use
hhea, not winAscent, which puts the name a further 1.6px low.

**Why it is structured that way, and not as a table of spans.** The old form expressed every
measurement in *spans* — multiples of the drawn mark height — and the class of bug that produces
has now bitten twice, in opposite directions. Once by feeding CSS-over-88 fractions into a
span-scaled layout, which came out **24% small**. Once by pinning the whole layout to the mark's
ink height, so **redrawing the mark silently resized the wordmark**. Neither is reachable now:
`SPLASH_SPAN = CSS.box` — no fraction, because the block fills its box — so `k = box/582` and
`u = dpr` exactly, and an ink fraction survives only where it is a real design choice (icons,
where `span = min(w,h) × frac`).

**Verified by pixel comparison, not by eye.** `main.tsx` removes the `#splash` div but leaves its
inline CSS in `<head>`, so the check loads the built app, waits on `document.fonts.ready`, removes
any surviving `#splash`, re-appends a fresh one with the same markup — which gives the real cascade
with the real faces — then measures and screenshots it. At 390×844 dpr 3: svg box `80 × 80`, block
height `197.59` against the generator's `197.59375`, name box at `423.2`, rule at `482.2`, claim at
`505.2`. Diffing the generated `launch-1170x2532.png` against that screenshot puts the ink extents
at `969–1546` and `969–1547` — **one device pixel** over a 578px block, with the **0.25%**
differing pixels confined to the ink rows and columns, i.e. glyph rasterisation, not layout.

**That diff is also what caught the third instance of the span bug**, and it is worth naming because
it is the one the two earlier fixes did not cover. The knockout's `viewBox` starts at `(-35, -49)`,
not at `0 0`, so a `translate(tx, ty)` that centres correctly in *x* — because `tx` subtracts
`VB.x·k` — silently drew the block `VB.y·k` high in *y*: **20 device pixels at dpr 3**, which is
precisely the `949` against `969` the first run measured. Both components subtract the origin now,
and `top` (the box top, shared with the text cursor) is a separate name from `ty` (the transform),
so the two cannot drift again.

**Why the words are there at all.** It read *"Flyleaf"* over a line about the device, which named
the family and the privacy promise and never once said the thing you were waiting for was an
ereader — a cold start looked like Press loading slowly. The owner: *"the splash screen also
doesn't register that this is an ebook reader."* The name carries it now, and settles it
before the app has painted a page.

**The middle line is a claim, not an instruction.** It read *"OPEN A BOOK FILE AND READ IT"*, which
is a description of the mechanic — and worse, a command issued to somebody who has already opened
the app. The owner: *"the splash screen is painful, what do you mean open a book and read it as a
tagline."* It is **`READ WHAT YOU OWN`** now: the same three words the product is actually built on
— local files, no store, no account, and a DRM'd file refused rather than rented. The line above it
says what this is, so this one is free to say *why*. It measures **151.1px** against the 281.8px
available inside the lockup at the 320px floor, so it does not come near wrapping.

**The format list is gone, and a hairline rule took its place.** It read `EPUB · MOBI · AZW3 · FB2
· PDF` in mono under the tagline, sized so that five extensions cleared the 320px floor where six
measured 261px against 256px available. It is out. Three stacked text lines under a mark is a
**manifest, not a welcome**, and the extension list was the weakest of the three: it answered a
question nobody has got to yet, on the one screen where a reader is not choosing anything.
Everything it was defending against — *"is this Press loading slowly?"* — the word **eReader** in
the name already settles. Dropping it also retires a whole third typeface from the critical path
(IBM Plex Mono) and the no-wrap constraint that pinned the lockup's width to what a list of
extensions measured at 320px. What replaced it is **1px**: a 40px rule at `currentColor` `.18`. It
separates the identity from the statement about it — the one hierarchy this screen has — and
derives from the ground, so it needs no token of its own on either scheme. If the format list comes
back it belongs on **Home**, beside the import control, where a reader is actually choosing a file.

**And the mark's box shrank, 88px → 80px.** Not a restyle: the block is filled where the bare
rosette was open, so at equal box height it reads appreciably heavier. `72` and `80` were rendered
side by side — `72` read as a chip under a `30px` name rather than the anchor of the lockup, and
`88` outweighed it — so `80` is the box, and it is `CSS.box` in the generator as well.

**Local font stacks only.** The web fonts are still in flight at this point, and a swap mid-fade
is worse than the fallback. The exit is **420ms**, under the 600ms hard removal in `main.tsx` that
guarantees a full-screen overlay never sticks.

**And a floor, not just a ceiling.** On a warm start the fonts are cached and `document.fonts.ready`
settles in ~10ms, so without a floor the screen is torn down a frame after it paints — present in
the DOM, never present to the eye, which reads as "there is no launch screen at all". The 1.2s
floor is measured **from navigation**, so the bundle's own parse time counts toward it and a slow
start does not wait twice. 1.2s rather than Press's 1.8: Press's launch screen introduces a thing
you are about to write in and can afford a beat; this one stands between a reader and the page they
were on, which is the wrong place to be deliberate.

### Marks on paper

The owner's ask: *"for marks, let's have pdf as an export option."* The other three formats are
strings. This one is a file, so it is bytes, and it is **hand-written** — a base-14 PDF, no
embedded font program, about 200 lines and a few KB on disk. A PDF writer is the one dependency
that would have to be added for a single button, and the guardrail is that nothing here may need a
network. `pdfjs-dist` is present for the *reader* and cannot write, but its metrics table is
Adobe's own, so the widths the line-breaker uses come out of it at build time. Nothing is measured
by eye.

**What base-14 costs, stated up front:** WinAnsi only, so Latin alphabets and no more. The export
sheet counts what a given set of marks *would* lose before the reader presses the button — a
silent row of question marks in a Greek quotation would be the worst possible outcome.

The sheet is Flyleaf's, printed. A4. Light-mode chrome, because a printed page has no dark mode
and the stocks are a screen thing. **403pt measure — 68 characters at 11pt Times**, which is inside
the 60–75 band and the reason the side margins are 96 and not 64.

**The five tints, restated for paper.** On screen a tint is a wash *behind* text, so it is pale by
design — butter is 1.18:1 against white. As a 2pt bar on a printed sheet that is invisible, and an
invisible bar is worse than none, because the bar is the one thing this export can say that
Markdown and plain text cannot: which highlighter the reader reached for. So each bar keeps its
tint's **OKLCH hue** and is given a printable lightness and chroma. Two pairs share a hue on screen
— mustard/butter at 80°, blue/underline at 247° — and those are separated by chroma and lightness
instead, in the order they read in on screen.

| Tint | Printed | On white | L | C | H |
|---|---|---|---|---|---|
| mustard | `#9F7101` | 4.34:1 | .58 | .120 | 80° |
| pink | `#B76D7C` | 3.82:1 | .62 | .095 | 7° |
| blue | `#6790B8` | 3.36:1 | .64 | .075 | 248° |
| butter | `#A18C69` | 3.25:1 | .65 | .055 | 80° |
| underline | `#035991` | 7.39:1 | .45 | .115 | 246° |

All five clear the **3:1** WCAG 1.4.11 asks of a non-text graphic. `underline` is not a wash on
screen either, so on paper it is not a bar: it is a rule under the words, which is what the reader
actually saw.

### The inline prose link **NEW (role, derived, no new values)**

Press has no token for this because Press has no inline link. Every link in Press, and every link
in this app up to now, is a **row, a button or a chip** — a whole box you press. `/privacy` and
`/terms` are the first pages here with a link *inside a sentence*, and an unstyled `<a>` in prose
falls straight through to the browser's own blue: off-palette, and the only saturated thing on
either page.

No new value was needed. The idiom already existed on `.shelf-foot` — **ink for the word, `--rule`
for the underline, ink on hover** — so it is lifted verbatim and scoped to `.page-inner--legal`,
which is the only place prose links exist:

```css
color: var(--ink);
text-decoration: underline;
text-decoration-color: var(--rule);
text-decoration-thickness: 1px;
text-underline-offset: 3px;
```

- **The underline is the non-colour cue.** Ink-on-paper against ink-on-paper carries no hue
  difference at all, so the underline is not decoration here — it is the entire affordance, and it
  is why the link is still findable for a reader who cannot separate the two colours.
- **Deliberately not padded to 24px.** WCAG 2.5.8 exempts a link inline in a sentence, and padding
  a word inside a line of prose pushes the line box around it. The row-shaped links in the same
  page's `Elsewhere` panel are buttons and do take the full target size.
- **Scoped, not global.** `.page-inner--legal` is the guard. A bare `a` rule would have quietly
  restyled every row, chip and button in the app that happens to be an anchor.

---

## Banned

Press's list, inherited whole, plus three of this app's own.

- `backdrop-filter`, frosted glass, translucent chrome of any kind.
- Drop shadows of any kind — elevation is hairline rules only.
- A generated or placeholder book cover. Real, uploaded, or absent.
- Kalam anywhere except the reader's own notes.
- Gradient text, gradient buttons, gradient grounds.
- Emoji as interface decoration.
- Neumorphic bevels, pillow buttons, cool grey surfaces.
- Rotation on the reading page.
- **A paper-texture overlay, or a spine gutter drawn down the middle of the text.** Skeuomorphism
  on the reading surface is the thing every bad web reader does.
- **A page curl.** It left this list once, by the owner's instruction, was built as a shadowless
  transform-only fold, passed its frame gate, and was cut on feel — so it is back here, and now
  without the escape hatch it left through. See **Motion** and `SPEC.md` § 5.2.
- **A whole-book page number on a reflowable book.** Chapter pages and a percentage are true;
  "page 412" is not.
- **Any AI feature.** Summaries, "ask the book", generated covers. This app opens files and
  shows words.
