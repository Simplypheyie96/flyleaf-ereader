# The measured audit

Seventeen drivers over one probe. Run them against a **production preview**, not the dev
server — the service worker, the split parser chunks and the real font files only
exist in a build, and several of the checks are about exactly those.

```
npm run build
npx vite preview --port 4173 --strictPort
```

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

One driver per format that does not go through the EPUB path:

```
node audit/text.mjs        # TXT, Markdown and a lone HTML file, end to end
node audit/mobi.mjs        # MOBI 6, incl. the script sandbox — needs the fixture below
node audit/pdf.mjs         # the pdfjs view against a fixture whose answers are known
```

The gate:

```
node audit/a11y.mjs        # the half of accessibility that has no geometry
node audit/backup.mjs      # the backup round trip, across two browser contexts
```

`audit/fixtures/` holds the files the format drivers open. Four are checked in
(`fixture.txt`, `fixture.md`, `fixture.html`, `measured-page.pdf`); two are generated,
because no MOBI writer and no EPUB writer exist on this machine:

```
node audit/fixtures/make-mobi.mjs        # fixture.mobi — PalmDB + PalmDOC + MOBI 6 + EXTH
node audit/fixtures/make-inked-book.mjs  # inked.epub — an EPUB that fights the stock
```

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
