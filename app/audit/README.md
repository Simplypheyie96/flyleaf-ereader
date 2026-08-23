# The measured audit

Twenty-nine drivers over one probe, and one runner. Run them against a **production preview**, not the dev
server — the service worker, the split parser chunks and the real font files only
exist in a build, and several of the checks are about exactly those.

```
npm run build
npx vite preview --port 4173 --strictPort
```

Then either run one driver, or run the sweep:

```
node audit/sweep.mjs              # the gate: chrome, reader, formats, a11y
node audit/sweep.mjs reader ghost # only these
node audit/sweep.mjs --all        # every driver, phone and formats included
```

`sweep.mjs` exists because a one-liner lied. The sweep used to be a `for` loop piping each
driver into `grep -oE "FINDINGS: [0-9]+"`, and it printed a clean column of zeroes for ten
drivers and **nothing** for four — `routes`, `states`, `sheet` and `reader`, which end in a
JSON object carrying a `findings` array and never print that line. A blank cell read as
clean; it meant unmeasured. The `|| echo NO-OUTPUT` that was supposed to catch it could
never fire, because `grep | tail` exits through `tail`, which always succeeds. So the
runner gives every driver exactly three outcomes — a count, a list, or `UNREADABLE` — and
silence is not one of them. It also fails a driver that prints a count *and* an array that
disagree with it, because then one of the two is stale.

The chrome, at every width and in both themes:

```
node audit/routes.mjs      # 2 themes x 4 routes x 6 widths = 48 checks
node audit/states.mjs      # the states a URL cannot reach, with the network off
node audit/sheet.mjs       # the book sheet in every state it has
node audit/stats.mjs       # the stats screen
```

The reading surface:

```
node audit/reader.mjs      # paginator, position, contents, progress
node audit/controls.mjs    # the three-tab control surface, every range and default
node audit/tints.mjs       # the fifteen dark-stock tint measurements SPEC.md § 2 asks for
node audit/darkstock.mjs   # author colours vs the three dark grounds, 21 rendered pairs
node audit/swatches.mjs    # Settings' theme dots vs each theme's live tokens
node audit/ramp.mjs        # the graph ramp: type on a wash, marks on their track, neighbour steps
node audit/marks.mjs       # selection, highlights, notes, bookmarks, search
```

Formats. `formats.mjs` is the breadth check — one of every declared format imported
through the real file input and opened in the real reader, plus the four archive shapes
that must stay refused. The other three go deep on a format that takes its own path
through the engine:

```
node audit/formats.mjs     # the matrix: 11 files, 9 formats, 4 refusals, one pass
node audit/text.mjs        # TXT, Markdown and a lone HTML file, end to end
node audit/mobi.mjs        # MOBI 6, incl. the script sandbox — needs the fixture below
node audit/pdf.mjs         # the pdfjs view against a fixture whose answers are known
```

`formats.mjs` exists because a valid EPUB was refused in the reader's hands with
"Flyleaf does not read a zip file" — `sniffZip` looked for the plain string
`application/epub+zip` in the first 200 bytes, which any re-zipped EPUB fails, while the
engine behind it opens an EPUB by reading `META-INF/container.xml` and never looks at the
mimetype entry at all. One format's sniff can be wrong for months without a driver that
opens one of each and says so.

**Nothing is uncovered.** AZW3/KF8 was, and it was printed under `UNCOVERED` on every
run rather than left silent — a declared format with no fixture, because no MOBI/KF8
writer exists on this machine (`ebook-convert`, `kindlegen`, `calibre` and Kindle
Previewer are all absent). Advertising a format whose "it works" rests on the vendored
parser's history is not good enough, so `fixtures/make-azw3.mjs` now builds one by hand:
real FDST, SKEL and FRAG indices, and four sections a reader has to reassemble by
splicing a fragment into a skeleton at a byte offset. `UNCOVERED` prints empty now, and
the day it does not is the day a format went on the shelf without a file behind it.

The gate:

```
node audit/a11y.mjs        # the half of accessibility that has no geometry
node audit/panels.mjs      # every panel Settings ships is on screen, the Drive gate included
node audit/measure.mjs     # every cap on prose against the box it actually sits in
node audit/ghost.mjs       # the coverless ghost, at all five sizes it is drawn at
node audit/appdata.mjs     # whose file is it — the shared Drive folder, and what may be deleted
node audit/backup.mjs      # the backup round trip, across two browser contexts
node audit/install.mjs     # the install ask on Home, in all four of its branches
node audit/tip.mjs         # the tip jar, up to but never through a charge
node audit/origin.mjs      # does Google accept this origin — up to the sign-in page, never through
node audit/phone.mjs       # the phone test, emulated: 4x CPU, touch, the 4MB EPUB
```

`measure.mjs` exists because "the words wrap before they fill the container" kept coming
back, and it kept coming back because it is invisible in the source: every `max-width` on
prose reads fine on its own, and the break only exists in the *relationship* between that
cap and whatever box ended up around it. Nothing measured that relationship until this. It
walks each block of prose with a `Range`, merges the client rects by line box — an inline
`<code>` splits one visual line into several rects and would otherwise count as two lines —
finds the nearest ancestor wider than the widest line, and fails past 28% slack. Run it at
`SLACK=0.20` to see the near misses; the survivors there are natural rag and deliberately
centred ledes, and `DESIGN.md` → *The chrome measure* says which.

`ghost.mjs` measures the one component that is drawn at 22, 44, 64, 104, 132 and 166px **at
a single viewport width**, which is why the ghost is sized in container queries and why no
media query could have caught the bug it found: `Markdown` overflowing a 44px cover by 10px,
clipped silently by the cover's own `overflow:hidden`. It resolves every colour by painting
it to a 1×1 canvas first, because the whole palette is authored in `color-mix(in oklab, …)`
and `getComputedStyle` hands back `oklab()`, whose three channels are nothing like r,g,b —
reading them as RGB is how an earlier pass reported every label at 1.2:1.

`appdata.mjs` is the only driver here with no browser in it, and the reason is the bug it
was written for. The hidden Drive folder is scoped to the OAuth client, this app shares its
client with Flyleaf Press on purpose, so both products' documents live in one folder — and
`dropAll` used to delete *everything in it*. One press of "remove the copy from my Drive" in
a reading app took Press's entire cloud backup with it, silently, and the sentence printed
afterwards ("Your library here is untouched") was true of this app and false of the other.
Reading and writing were never at risk: the names are distinct and every access is an exact
lookup. Only the delete was, and nothing in the source looked wrong — the comment on
`dropAll` argued *for* taking everything, which is correct reasoning about a folder you own
alone. So the driver builds the shared folder as it really is — our four shapes, our
pre-tag files, a retried duplicate, Press's `library.json` both tagged and not, and a name
from an app that does not exist yet — and asserts the verdict on all sixteen. It bundles the
real `record.ts` and `record.ts`'s real `APP`, with only Dexie stubbed, so the tag under
test is the same string the writer stamps rather than one retyped in a driver. There is no
click to make: signing in to a real Drive is the one thing an audit run must not do.

`install.mjs`, `tip.mjs`, `origin.mjs` and `phone.mjs` are the drivers that cannot test the
whole path, and all four say so rather than implying they did.

`origin.mjs` stops at Google's sign-in page and signs in to nothing — reaching that page *is*
the proof, and going through it would grant a real account's consent, which is not a thing an
audit run does. It reads the **popup's URL** rather than the panel's message, because the
panel's message is the thing that used to lie: `origin_mismatch` reaches the GSI SDK as
`popup_closed`, so the app blamed the reader for closing a window Google had in fact
rejected. A failure in the first few minutes after a Console change means *wait*, not
*retype* — Google allows five minutes to a few hours to propagate.

`install.mjs` dispatches a **synthetic** `beforeinstallprompt`, because Chromium never
fires a real one headlessly — there is no flag for it and the engagement heuristics do
not run. Our branch, our button and our `prompt()` call are genuinely exercised;
Chrome's decision to offer the install is faked. Its negatives are the valuable half:
nothing shown before a prompt is held, nothing when `display-mode: standalone`, nothing
after a dismissal survives a reload, and no button at all on iOS, where there is nothing
a button could do.

`tip.mjs` stops at "the sheet would open". The Paystack key is live, so the driver
proves the SDK loaded and a popup handler exists and goes no further; a charge is not a
test result.

`phone.mjs` is not the phone test. CLAUDE.md asks for a real device, throttled, with a
4MB EPUB; this machine has no simulator (`xcrun simctl` is absent — the toolchain is
CommandLineTools, not full Xcode) and the simulator MCP cannot drive a physical phone at
all. So the driver does the emulated half honestly: a 390x844 viewport at 3x with touch,
a 4x CPU throttle, and `big.epub`. It reports cold open, the launch screen, warm reopen,
the per-frame cost of three real touch drags, and whether a book opens with the network
cut — and every budget in it is labelled an emulation budget, because a Chromium number
on a laptop is evidence and not a certificate. The owner's real-device checklist is
`SPEC.md` § 11.1.

Its most useful measurement is the cheapest: warm-versus-cold. A reopen that costs most
of a cold open means the 4MB file is being re-parsed, which is the one failure the
throttle makes unmissable and an unthrottled run hides completely.

**Read it before you believe it.** Four of this driver's first findings were the driver
and not the app, and the shape of it is now baked into the file's comments so nobody
"corrects" them back:

- the finger comes from the pointer events the *page* receives, and from `screenX` —
  `clientX` is frozen inside a paginated section iframe (measured: 1711.59 for every move
  of a 224px drag), which is exactly why `turn.ts:147-155` is screen-measured;
- drift is anchored at the claim, because `turn.ts`'s hysteresis is required behaviour and
  reads as a tracking failure when measured from touchstart;
- `dragSlow` is a permanent control that separates sampling latency from a trailing layer;
- and the open has four clocks — import, cold open, boot, launch screen, warm open —
  because one clock charged a deliberate 1.2s launch screen to the book and called it a
  re-parse. `SPEC.md` § 11.2 has that one in full, including the tap it used to eat.

`audit/fixtures/` holds the files the format drivers open. Four are checked in
(`fixture.txt`, `fixture.md`, `fixture.html`, `measured-page.pdf`); two are generated,
because no MOBI writer and no EPUB writer exist on this machine:

```
node audit/fixtures/make-mobi.mjs        # fixture.mobi — PalmDB + PalmDOC + MOBI 6 + EXTH
node audit/fixtures/make-azw3.mjs        # fixture.azw3 — KF8, spliced from SKEL and FRAG
node audit/fixtures/make-inked-book.mjs  # inked.epub — an EPUB that fights the stock
node audit/fixtures/make-fb2.mjs         # fixture.fb2 + fixture.fbz — FictionBook 2
node audit/fixtures/make-zip-shapes.mjs  # the six awkward archives formats.mjs opens
node audit/fixtures/make-big.mjs         # big.epub — the 4MB book, grown from the seed
```

`make-big.mjs` is why there is no 4MB binary in git. It duplicates the seed book's
chapters into extra spine sections until the zip clears 4MB — many ordinary sections
rather than one huge file, because the paginator's cost is per section and a single 4MB
chapter would measure the wrong thing.

`make-zip-shapes.mjs` is the regression suite for `src/import/sniff.ts`, and it is built
from the shipped Time Machine so the expected title needs no second source of truth:
`rezipped.epub` (deflated mimetype, not first — the shape that was refused),
`wrapped.zip` (one book in a bag), `twobooks.zip`, `comic.zip`, `junk.zip`, and
`truncated.epub` — a conforming 40KB head with no central directory, which is what a
cancelled download leaves behind and which used to import as a book titled "truncated".

`make-fb2.mjs` writes the `.fbz` with its `.fb2` deflated and second in the directory,
deliberately: that is the entry order that broke EPUB, and FBZ is sniffed by the same
function.

`inked.epub` is what `darkstock.mjs` measures, and it exists because TXT, Markdown and
HTML all have their `style` and `class` attributes stripped by `reader/textBook.ts` —
so none of them can carry an author colour, and only a real EPUB can. Its seven
paragraphs take seven different routes past plain inheritance (a stylesheet rule, an
inline style, the book's own `!important`, `-webkit-text-fill-color`, a light
background box, a light-page `text-shadow`, and one uncoloured control), because no real
book carries all of them at once.

Its text stream carries an inline `<script>`, an `onclick` attribute and a `javascript:`
href in the **first** section on purpose: a flag set by book script lives on that
section document's own `window`, and the paginator detaches a section once the reader
leaves it, so the first section is the only one whose flags can still be read.

Every driver prints its measurements and its findings, and exits 0. **A finding is a
bug**; the run is only clean at zero.

`probe.mjs` holds the checks so both drivers judge the same numbers the same way:
horizontal overflow, blocks that leave the content column, WCAG AA contrast over the
real rendered colour pairs, targets under 24x24, and the desktop rail's clearance and
gutter symmetry.

Three things about the probe that are load-bearing, and were each learned from a
false positive:

- It **drains `document.getAnimations()` before sampling colour.** A pair read during
  the 180ms theme transition is a pair that never renders — that is where a phantom
  2.89:1 "failure" on the nav came from.
- Targets skip anything `display:inline*` (WCAG 2.5.8's inline-text exception) and
  anything that cannot be focused. A link inside a sentence is exempt; a link that is
  a **flex item is not**, because a flex parent blockifies its children.
- The rail comparison is gated on `flex-direction:column`. Below 1024 the same element
  is the bottom pill, and comparing against it reported -295px of "clearance" on every
  phone width.

`states.mjs` additionally covers what the route sweep structurally cannot: the shelf's
list view (a localStorage preference, not a route), the cleared shelf, and — with
`setOffline(true)` after the service worker installs — Remove -> confirm -> the
dismissal surviving a reload -> Restore. Restore offline is the real test of
"no feature needs a network": the seed EPUBs have to come from the precache.
