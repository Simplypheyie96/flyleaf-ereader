# foliate-js — vendored upstream source

Not a fork. This tree is **upstream source at a pinned commit**, plus the six
patches recorded below. Anything you change here you record here, or the next
person updating it silently loses your change.

| | |
|---|---|
| Upstream | <https://github.com/johnfactotum/foliate-js> |
| Branch | `main` (**not** `master` — a `master` tarball request 404s) |
| Commit | `78914aef4466eb960965702401634c2cb348e9b1` |
| Date | 2026-05-01 |
| Subject | Use original hrefs for external links and add isExternal in fb2.js (#129) |
| Licence | MIT — `LICENSE` is copied verbatim and must stay |

**Vendored, not installed.** The `foliate-js` package on npm is a third-party
republish by an unrelated maintainer: one version, a year stale, no relationship
to John Factotum. There is no official package, so source is the only honest way
to take a dependency on it.

## Updating

```
gh api repos/johnfactotum/foliate-js/commits/main --jq .sha
curl -sL https://codeload.github.com/johnfactotum/foliate-js/tar.gz/<sha> | tar xz -C /tmp
```

Copy the keep-list below over this directory, re-apply the six patches, bump
the commit in the table above, then run `npm run build` — every dynamic import
in `view.js` must resolve inside this tree, and a build failure is how you find
out that upstream added one that doesn't.

## What is here, and what is not

Kept — the modules that a reflowable reader actually reaches:

```
view.js paginator.js epub.js epubcfi.js mobi.js fb2.js
progress.js overlayer.js text-walker.js search.js fixed-layout.js
vendor/zip.js vendor/fflate.js LICENSE
```

`vendor/zip.js` is needed by every zip-based format; `vendor/fflate.js` only by
MOBI. Both are dynamically imported, so a reader who opens a plain `.fb2` never
downloads either.

Omitted, with the reason:

| Omitted | Why |
|---|---|
| `vendor/pdfjs/` | **13MB — the entire reason this tree is 272K instead of 13MB.** Banned outright by the project: PDF gets its own view on `pdfjs-dist` from npm. |
| `pdf.js` | Upstream's PDF adapter, the only importer of `vendor/pdfjs/`. Thin, and it is not the PDF experience this project specified. |
| `comic-book.js` | CBZ/CBR are explicitly out of scope, not "later, quietly". |
| `tts.js` | Speech is not a feature here. See patch 3. |
| `reader.html` `reader.js` `ui/` | Upstream's own demo reader and its widgets. We have a UI; this one carries a look that is not Press's. |
| `opds.js` `uri-template.js` | An OPDS catalogue browser — a network feature, in an app whose brief is that nothing blocks on the network. `uri-template.js` has exactly one importer and it is `opds.js`. |
| `dict.js` `quote-image.js` | Dictionary lookup over the network, and a share-image generator. Neither is in the spec; the offline concordance in P3 is our own. |
| `footnotes.js` | No importer among the modules we keep. |
| `rollup/` `rollup.config.js` `eslint.config.js` `package*.json` `tests/` `README.md` | Upstream's build, lint, and test setup. Vite builds this; upstream's toolchain would only fight it. |

## Patches

Each patch is marked in the file itself with a `FLYLEAF PATCH n` comment, so a
diff against upstream and a read of the file both find it.

### 1 — `view.js`, `makeBook()`: CBZ refused instead of parsed

`comic-book.js` is gone, so its dynamic import had to go. The `isCBZ(file)` test
is **kept** and throws `UnsupportedTypeError` explicitly. Deleting the branch
outright would have been shorter and wrong: a CBZ is a zip, so it would fall
through to the EPUB branch and fail as a corrupt EPUB — a confusing error for a
file we simply do not support, instead of the plain one the project promises.

### 2 — `view.js`, `makeBook()`: PDF refused instead of parsed

Same shape, different reason. PDFs never reach `makeBook` at all — the import
path routes them to our `pdfjs-dist` view first — so this branch is unreachable
in practice and exists to fail loudly if that routing ever breaks. The
alternative was keeping `pdf.js`, which imports the 13MB `vendor/pdfjs/`.

### 3 — `view.js`: `initTTS()` removed

`tts.js` is not vendored. The method was **removed rather than left in place**
with a dead import: a dynamic import that is never called still emits its own
chunk, and Workbox precaches every chunk in `dist`. The cost of leaving it would
have been paid by every reader's install, not just by the one who called it.

`textWalker`, which `initTTS` used, is still imported — `search.js` needs it.

### 4 — `paginator.js`: the turn's two hooks

The reading surface's page turn is the reason this project exists, and upstream's
paginator cannot deliver the one specified in `DESIGN.md` → Motion and `SPEC.md`
§ 5. Two additions, both additive; nothing upstream was rewritten.

**4a — `get contentLayer()`.** The paginator's shadow root is `mode: 'closed'`,
so nothing inside it is reachable from the app. A transform-only turn needs one
element: the one holding the laid-out column strip. This getter returns
`#view.element` and nothing else — `size`, `page`, `pages`, `atStart` and
`atEnd` are already public, so one getter is the whole of the turn's surface
area.

Why that element and not `#container`: `#container` is the scroll port and clips
to its own box, so translating it slides the window along with the content and no
page change is visible. `#view.element` is the content inside that port, and
upstream's `expand()` already sizes it to `pageCount * size + size * 2` — one
blank page of slack at each end. So a translate of up to one page width can never
shrink the scrollable overflow region below the current `scrollLeft`, and the
browser never clamps the scroll position mid-drag. That property is upstream's,
not ours, and it is what makes the transform safe on every page including the
last.

**4b — the `no-touch` attribute.** Upstream's `#onTouchStart/Move/End` are gated
on it. They had to go, not be tuned:

- `#onTouchMove` calls `preventDefault()` on *every* single-finger move with no
  movement threshold. That kills touch text selection outright, and `SPEC.md`
  § 5.3 requires 8px of horizontal travel inside 200ms (or >0.15px/ms) before the
  gesture is claimed, precisely so a slow drag beginning on a word selects
  instead of paging.
- It drives `container.scrollLeft`. A scroll is not a transform, and `CLAUDE.md`
  makes transform-only a hard acceptance criterion for the turn.
- It commits on a flat `300ms` `easeOutQuad` with no rubber-band. The spec is a
  velocity-derived **260–420ms** on `cubic-bezier(.16,1,.3,1)`, and 0.35×
  resistance springing back over 220ms at the book's ends.

The listeners are gated rather than deleted so this stays a three-line diff
against upstream and the behaviour is reversible at runtime by dropping the
attribute.

**What upstream still does for us.** With the `animated` attribute *absent*,
`prev()` / `next()` are instant `scrollLeft` writes and handle crossing into the
adjacent section. So the turn is: track with a transform, then on commit clear
the transform and call `next()`/`prev()` in the same frame. Upstream keeps
owning position, sections and CFIs; we own only the frames while the finger is
down.

### 5 — `paginator.js`: a render that arrives before the body does

`Paginator.render()`, `View.render()` and `View.destroy()` now return early
unless the section document has a `body`. Three lines, all three guards,
nothing rewritten.

The `Paginator`'s own `ResizeObserver` calls `render()` whenever its container
resizes, and that can land while the section iframe is between documents. A
document has a `documentElement` from its first byte but no `body` until the
parser reaches the body start tag — and `columnize()` passes both straight to
`setStylesImportant`, which destructures `el.style`. The result was
`TypeError: Cannot destructure property 'style' of 'o' as it is null`, thrown
from a ResizeObserver callback on open.

Found by `audit/text.mjs` on the TXT and HTML fixtures, where the section
bodies are blob URLs this app builds itself and so load on a different beat
than a zip entry — but nothing about the race is specific to those formats, and
an EPUB opened on a slow enough device hits the same window.

The `Paginator.render()` guard is the one that matters: with only the `View`
guard in place the same race surfaced one frame further along as
`Failed to execute 'createTreeWalker' on 'Document'` — `#scrollToAnchor` runs
after the view has rendered and walks `doc.body` to find the visible range.
Guarding the entry point covers both.

Skipping is lossless: `load()` calls `render(layout)` itself once the document
is in, so the layout that was skipped is applied a moment later by the handler
that was always going to apply it.

### 6 — `mobi.js`: the section document goes through the `data` hook too

Both MOBI classes already dispatch a `data` event for **resources**
(`KF8.loadResourceBlob`), so a listener can rewrite bytes before the blob URL is
made — the mechanism `paginator.js` itself uses to fix up CSS, and the one
`reader/harden.ts` uses to put a `script-src 'none'` policy into every content
document. Neither class dispatched it for the **section document**, which is the
one document in a MOBI that can carry markup the author wrote: `MOBI6.loadSection`
and `KF8.loadSection` both went straight from `serializeToString` to
`URL.createObjectURL`.

Three additions, all additive:

- `MOBI6` gains `transformTarget = new EventTarget()`. `KF8` already had one;
  MOBI6 had no content hook of any kind, so a book in the older format was
  simply unreachable.
- each `loadSection` dispatches `data` with `{ data, type }` and awaits
  `detail.data` / `detail.type` before the blob, which is `loadResourceBlob`'s
  own five lines, in the same order, with the same names.

Not copied from `loadResourceBlob`: its `new Blob([newData], { newType })` — an
upstream slip that passes a property called `newType` instead of `type`, so the
blob gets the default type. These two sites pass `{ type: newType }`. Left
alone where it is; fixing upstream's bug in an unrelated method is a second
patch to carry, and for a resource the media type is also declared by the
element referencing it.

Why not app-side: there is no other seam. The section blob URL is what
`paginator.js` assigns to `iframe.src`, and by the time the app can see the
document the parser has already run any inline script in it. A wrapper around
`section.load()` would work but has to fetch the blob back out, re-parse it, and
then own the revocation of a second URL for every section of every book — more
moving parts, in the hot path of the thing this project is judged on.

`fb2.js` needs nothing equivalent: its converter is a whitelist
(`convert()` returns `null` for any element it does not know, and copies only
listed attributes), so a script element or an `on*` handler cannot survive the
conversion in the first place.


### 7 — `paginator.js`: the style elements go in even when the section has no `<head>`

`#display`'s `afterLoad` hook makes the two `<style>` elements the reader writes
all of its CSS into — the `$styleBefore` that author rules may override and the
`$style` that overrides them — and it was guarded by `if (doc.head)`. When the
guard failed, nothing was created, nothing was recorded in `#styleMap`, and
`setStyles()` (which reads that map and returns early when it is empty) had
nowhere to write for the life of that section.

The guard fails on a real shape, not a hypothetical one. **Measured** in the app's
own browser: `DOMParser` given `<body xmlns="…xhtml">…</body>` as
`application/xhtml+xml` — an EPUB body-only section — returns a document whose
`documentElement` is `body` and whose `doc.head` is `null`. The same string
parsed as `text/html` gets a synthesised `<html><head>`, which is why this only
ever bit XHTML sections.

The result is a page that is *nearly* right, which is why it is worth a patch
rather than a shrug. The stock ground and ink survive: those come from the
`setStylesImportant` calls on `documentElement` and `body` inside `View`, which
never touched the head. Everything in `reader/readingCss.ts` does not — the
reading face, the measure, the leading, the margins, `::selection`, and
`a:any-link { color: inherit }`. So the section renders on the right paper in the
browser's default face at the browser's default measure, with links in UA blue:
on a dark stock, the one colour on the page that came from nowhere. That is the
exact symptom reported from a screenshot of Dusk.

The fix is one line, and it puts the pair on `documentElement` when there is no
head to put them in:

```js
const $head = doc.head ?? doc.documentElement
if ($head) { /* …upstream's four lines, against `$head`… */ }
```

Three things checked rather than assumed, all in the app's browser against a
body-rooted XHTML fragment that carries its own author `<style>`:

- **The sheet applies.** `createElement('style')` on such a document returns an
  element in the HTML namespace (`http://www.w3.org/1999/xhtml`), and its rules
  take effect — a `<style>` applies wherever in the document it sits, head or
  not. `createElementNS` is therefore unnecessary; `createElement` is right
  because per DOM it uses the HTML namespace both for an HTML document and for
  an `application/xhtml+xml` one, which is every document that reaches this hook.
- **The cascade the pair exists for is preserved.** With `prepend`/`append` on
  the `body` root, the order is ours → author's → ours: the author's `p` rule
  beat `$styleBefore` (40px won over 12px) and `$style`'s
  `a:any-link { color: inherit }` beat the author's own link colour.
- **`doc.head` still does not resolve, and deliberately.** That getter wants a
  head child of a root `<html>`, so no element added under a `<body>` root can
  satisfy it. The first draft of this patch synthesised a `<head>` to make it
  resolve; measurement showed it does not, so the synthetic element was dropped
  rather than left in the tree as a lie that buys nothing.

Not app-side: `#styleMap` is private and this hook is its only writer. An
app-side fix would have to inject a third style element from the `load` event and
re-apply the whole sheet on every settings change, duplicating `setStyles` and
racing it.

**Scope, stated rather than implied.** Neither seeded book reproduces the bug:
every section of *Pride and Prejudice* (65) and *The Time Machine* (18) parses
with a `<head>`, and the audit sweep measured no offending link on either. This
patch closes the code path and the DOM behaviour behind it is measured; it is
not verified end-to-end against a book that walks it, because no fixture in the
repo does.

---

## `view.js`, `paginator.js`, `fixed-layout.js` — guard the custom-element defines

**Files:** `view.js` (was line 601), `paginator.js` (was 1199), `fixed-layout.js` (was 319)

Each file ended with a bare `customElements.define(...)`. Every one is now
`if (!customElements.get(tag)) customElements.define(tag, Class)`.

**Why.** A bare define throws `NotSupportedError` — *"the name 'foliate-view' has
already been used with this registry"* — if the module is ever evaluated twice,
and evaluated twice is not the same as imported twice. The app imports `view.js`
from exactly one place (`src/pages/Reader.tsx`), the built bundle contains the
literal `define("foliate-view"` exactly once, and the throw still happened: a
module fetched under two URLs gets two module records. Two ways that occurs
here:

- **Vite's dev server.** Every HMR pass re-requests changed modules with a fresh
  `?t=<timestamp>`, so `view.js?t=1` and `view.js?t=2` are two records. Editing
  any app file with a book open and then reopening a book throws. This is what
  produced the reported failure.
- **A stale precached chunk.** Workbox can serve an old hashed `view-*.js`
  alongside the new one across an update, which is the same shape of bug in
  production.

Neither is fixable app-side: the throw happens during module evaluation, before
any app code runs, so there is nothing to wrap.

**Why first-wins is correct rather than merely quiet.** The app never touches the
class these modules export — `Reader.tsx` does `void mod` and then
`document.createElement('foliate-view')`, so it gets whichever class won the
registry. Both copies are the same source, and the losing copy's class is simply
unused. Were the app to hold a reference to the exported class *and* compare it
against an element's constructor, this guard would hide a real mismatch; it does
not.

**Scope.** Measured in dev: with the guard, re-evaluating `view.js` after an HMR
pass no longer throws and a book opens. The stale-chunk path is reasoned from
Workbox's behaviour, not reproduced — no update boundary in this repo has been
made to serve two hashes of the same chunk.

---

## 6. `paginator.js` — scrolled flow is a continuous column

**Files:** `paginator.js`
**Marked in source as:** `FLYLEAF PATCH 6`

### The upstream behaviour

`#createView()` destroys the current view before appending the new one, so exactly **one
section** is ever in the DOM. In paginated flow that is invisible — every page turn already
goes through `next()`. In scrolled flow it means a chapter boundary is necessarily a discrete
event: the column dead-ends, something calls `next()`, the iframe is replaced and the reader
lands at the top of a different document. No amount of app-side work makes that continuous,
because there is never a second section to be continuous *with*.

Apple Books and Kindle both put the end of a chapter, the whitespace, and the next chapter's
heading in one scroller. `SPEC.md` § 5.1 requires the same.

### The change

Scrolled flow holds a **sliding window** of views stacked in `#container` in ascending spine
order. Paginated flow is untouched and still holds exactly one.

- `#views` (`[{index, view}]`, index-ordered) and `#loadingIndex` are new state.
- `#createView(index)` branches: paginated clears first and appends one, as upstream; scrolled
  splices the entry into `#views` and `insertBefore`s its element at the right position. Its
  `onExpand` only re-anchors when `entry.index === this.#index`, so a neighbour finishing
  layout cannot yank the column.
- `#fillForward()` loads the next linear section and stacks it below once less than two screens
  of column remain. It re-checks that the tail view is still the one it started from after the
  await, then dispatches `create-overlayer`, applies `setStyles`, and dispatches `load` — the
  same three things `#display` does, so a stitched-in section is indistinguishable from a
  displayed one.
- `#syncCurrent()` picks the last view whose `offsetTop` has passed the reading margin and
  updates `#index`/`#view`. `#trimWindow()` keeps `{current, ±1}` and destroys/unloads the rest,
  compensating `scrollTop` by the removed height when the removal was above the viewport.
- A `scroll` listener drives both. It is unthrottled and passive, because it has to be right at
  the moment the reader crosses: three `offsetTop` reads and one comparison, no layout writes.
  The expensive half — `relocate`, which derives a CFI — stays on the existing 250ms debounce.
- Per-section arithmetic is now relative to the current view rather than the container:
  `#viewTop` is subtracted in the `fraction` calculation and added when scrolling to a
  fractional anchor, so progress and CFI resolution stay per-section (`SPEC.md` § 5.1) instead
  of silently becoming per-column. `#scrollNext`'s scrolled branch uses `#columnSize`
  (`container.scrollHeight`), which is the thing it was actually asking for.
- `#goTo` no longer unloads the outgoing section in scrolled flow — it may still be in the
  window. `#display` gained a fast path that scrolls to a resident view instead of reloading it,
  and clears the window on a jump outside it.
- The inline `afterLoad` closure in `#display` is extracted to `#afterLoad(doc, index, onLoad)`
  so `#fillForward` can use the same head-injection path. Its body, including the `<head>`-less
  XHTML comment, is carried over verbatim.

- `#scrollToRect` and `#getVisibleRange` are the two places where the two coordinate systems
  meet, and both needed `#viewTop`. A rect always comes from the *current view's own document*,
  so the mapper's output is view-relative while `start`/`end` are now column-relative. Upstream
  they were the same number because the only view began at container offset 0. `#scrollToRect`
  adds `#viewTop` on the way out; `#getVisibleRange` subtracts it on the way in. Measured
  before the fix: at chapter XII the CFI resolved to `epubcfi(/6/28!/4)` — the section root,
  with no offset into the text, so a reopen would have lost the sentence. After:
  `epubcfi(/6/28!/4/2[chapter-12],/2,/6/1:248)`, and a `goTo` on it lands on the same
  scrollTop it was taken at.
- `#trimWindow` runs on every scroll rather than only on a section change, and again at the end
  of `#fillForward`. Gating it on a change left a fourth view resident until the next scroll
  event, because the fill appends after the trim in the same handler — measured as ids
  `[13,14,15,16]` with 14 current. It is a set lookup per resident view and returns immediately
  at three or fewer.

### The current section is probed at the middle of the window

`#syncCurrent` originally took the last view whose top had passed the reading margin, which is
the strictly correct reading of "the section the top of the screen is in" and the wrong answer
for a reader. A chapter heading sits plainly on screen — often halfway up it — for most of a
screen's worth of scrolling before its top reaches the margin, and the whole time the readout
names the chapter before it. Reported as a stale chapter label. The probe is now
`scrollTop + clientHeight / 2`: the name changes when the new chapter takes the larger half of
the screen.

Verified at 375x812, stepping 120px at a time through the 15/16 join: the label held at XIV
while section 16's top was at 611 and 491, and changed to XV at 371 — `clientHeight / 2` is 406.

### Backward fill

`#fillBackward` mirrors `#fillForward`, gated on one screen of lead instead of two, and
prepends via the same `#createView` path. The difficulty is entirely in holding the reader's
position while a section of unknown height is inserted above them.

The incremental approach — observe each growth, add the same number of pixels to `scrollTop` —
was built first and is wrong. `#scrollToAnchor` repositions absolutely during the same
expansion off an anchor that is up to 250ms stale, so the two mechanisms double-count. Measured
in the pane: a single prepend moved the reader's paragraph **3505px** up the screen while the
arithmetic claimed exact compensation.

`#holdPosition` / `#restoreHold` / `#releaseHold` replace it with an absolute hold. Before the
prepend, the current view's **element** and the reader's offset into it are captured; every
subsequent expand restores `scrollTop = element.offsetTop + delta` and returns early instead of
re-anchoring. Restoring is idempotent, which is what makes it safe to run on every expand of
every view. The hold outlives the `await` — it is released on `document.fonts.ready`, because
fonts land after load and grow the section again.

### setStyles applies to every resident document

Upstream wrote the two style elements of `this.#view.document` only, because there was never
another document. With a window of three, a stitched-in section had its style elements created
and left **empty**, so it rendered in the publisher's own CSS — black headings and blue links on
a dark stock. That is the reading surface failing contrast outright, not a cosmetic difference.
`#residentDocuments` returns every view's document in scrolled flow (the single view otherwise),
and `setStyles` writes to all of them.

Verified with three sections resident on the dark stock: ink `rgb(244, 242, 237)` on
`rgb(34, 30, 27)` in every resident document — **14.79:1**, identical across all three.

Verified in the pane at 375x812 on the seeded *Pride and Prejudice*, scrolled flow:

- Forward across a boundary is continuous — `scrollTop` steps of 50px through the join at 6372
  tracked exactly, no jump, and the running chapter flipped from XI to XII at the right offset.
- Fourteen 100px steps *upwards* from a TOC jump to chapter 16 moved a reference paragraph
  exactly 100px on every step, including the step on which section 14 was prepended.
- A forty-step creep across three chapters ended with the window at exactly three views
  (`[16,17,18]`, current 17) and the scroll offset inside the current view's own extent.
- CFI round-trip across a boundary: `goTo` on a CFI taken at 4598 landed back at 4598 with the
  same range text.
- Backward within the window resolves correctly — at 1000 the CFI read
  `epubcfi(/6/26!/4/2[chapter-11],…)` with a text offset.
- `relocate.fraction` is book-level and comes from `view.js`'s `sectionProgress`, not from the
  paginator's `detail.fraction`; the per-section number the reading UI shows is the one this
  patch corrects with `#viewTop`.

Not verified here: a real thumb on a real phone, which is the user's test.

### Re-applying upstream

This is the largest patch in the tree and it touches `#createView`, `#display`, `#goTo`,
`#scrollNext` and the constructor. On an upstream update, re-apply by rule rather than by diff:
keep upstream's single-view path intact for `!this.scrolled`, and re-add the window as the
`scrolled` branch of the same functions.

### App-side consequence

`app/src/reader/scrollCross.ts` implemented the discrete crossing this replaces — a
`next()` on the first scroll event past the end, behind a 450ms cooldown. It is **deleted**, and
its five call sites in `app/src/pages/Reader.tsx` are removed.

## PATCH 7 — `paginator.js` `#turnPage`: a turn past the last section froze every later turn

**File:** `paginator.js`, `#turnPage`.

At the first or last linear section `#adjacentIndex(dir)` falls off the loop and returns
`undefined`. `#turnPage` passed that straight to `#goTo`, which took the `index !== this.#index`
branch and evaluated `this.sections[undefined].load()` — a synchronous `TypeError` thrown *before*
the `.catch()` it was meant to land in. The rejection propagated out of the `await` in
`#turnPage`, so `this.#locked = false` was never reached and **`#locked` stayed `true` for the
life of the paginator**: every subsequent `next()` / `prev()` returned immediately and the book
appeared frozen.

The patch refuses the move when there is no adjacent section, and moves the unlock into a
`finally` so a section that genuinely fails to load also releases the lock.

Upstream shape is otherwise unchanged; re-apply by wrapping the same body.

## PATCH 8 — `paginator.js`, `setImageSize()`: no block cap in scrolled flow

`setImageSize` writes `max-height: ${height - margin * 2}px !important` inline on
every `img`, `svg` and `video`, where `height` comes from `#layout`. In paginated
flow that is the page column and the cap is right. In scrolled flow the section
iframe is sized to its own content, so `height` is the *content* height, and the
cap becomes a feedback loop: a full-page image shortens the frame, the shorter
frame tightens the cap, the image shrinks again.

Measured on `The_Incandescent_-_Emily_Tesh.epub` at 390×844, scrolled, before the
patch: the section frame settled at `innerHeight` **257px**, the inline cap at
**250.406px**, and the Calibre cover wrapper — `width="100%" height="100%"
viewBox="0 0 1456 2200" preserveAspectRatio="none"` — was forced to
**327.6 × 250.4** and stretched the artwork to fill it. `renderer.viewSize` came
out **385px** against a **602px** viewport, so the section had nothing to scroll:
"scrolling not working except for text content".

The change: bind the cap to `this.#column`, which is `false` in scrolled flow, and
pass `''` there, which removes the inline property rather than setting one.
Scrolled flow has no page to fit an image into; the cross-axis cap belongs to the
app's own stylesheet, which is generated outside the frame and knows the stage's
real height (`readingCss.ts`, `viewport`).

The inline-axis cap and `object-fit`, `break-inside` and `box-sizing` are
untouched in both flows.

---

## PATCH 9 — `paginator.js` — the continuous column stops dead-ending on short sections

`#display` gained `void this.#topUp()` at both of its exits, `#topUp()` is new, and
`#trimWindow`'s keep rule became geometric.

**The bug, as reported:** "i can only navigate to the content using th table of
content", "scrolling not working except for text content", and then, after the
image fixes landed, "local host still getting stuch here … instead of scrolling
all content like kindle or apple books would" — with a screenshot of the Tor
front-matter page.

**Cause one — nothing calls the filler.** `#fillForward` is invoked only from the
container's `scroll` listener. A section shorter than the viewport produces no
scrollbar, so no scroll event ever fires, so nothing is stitched in below, so
there is still nothing to scroll. Measured on `The_Incandescent_-_Emily_Tesh.epub`
at a 986px viewport, section 4 is the dedication: `viewSize` **250.297**,
`start` **0**, and `start` stayed 0 across **35** `scrollBy` attempts. Inside the
frame: `bodyScrollHeight` **22px**, `textLength` **18** — "For A. K. Larkwood",
no images. The section is genuinely that small. The only way onward was the TOC,
exactly as reported.

`#topUp` tops the column up when a section is *displayed* as well as when it is
scrolled, and loops, because the section after a short one is usually short too —
three pages of front matter in a row is the ordinary shape of a trade EPUB. It
stops as soon as there is a screen of runway for the scroll handler to take over
from, or when there is nothing left to append. Its 20-pass cap is a backstop
against a book of hundreds of tiny sections, not a tuning knob: each pass appends
exactly one section and re-measures.

**Cause two — the window was counted in views.** `#trimWindow` kept `#index` and
its two spine neighbours. Adjacency stands in for nearness only while sections are
chapter-sized; three views of front matter is about 60px. So everything `#topUp`
had just stitched in below was dropped as "far", `#topUp` put it back, and the two
cycled: measured, sections 5, 6, 7 and 8 loading **20 times** in a 30-step scroll
while the reader sat on the dedication.

The keep rule is now pixels. A view survives if it overlaps the band from one
screen above the viewport to two screens below it, whatever its index; `#index`
and its neighbours are still kept unconditionally. The count guard
(`#views.length <= 3`) and the compensated-removal-above logic are untouched.

**After, same book, same viewport:** from section 4, four loads total — 5, 6, 7, 8,
each once, no repeats — and the reader scrolls through the front matter into
"chapter one RISK ASSESSMENT". From section 0 it walks cover → "Begin Reading /
Table of Contents" → the Tor page continuously. Paginated is unaffected: `scrolled`
`false`, `v.next()` ×4 from section 8 moves "chapter one" → "chapter two",
`size` **1223.99**, `start` **1224**.
