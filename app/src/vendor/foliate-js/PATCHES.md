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
