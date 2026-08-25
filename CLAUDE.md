# Project: Flyleaf eReader

## What this is

**Flyleaf eReader** — a local-first PWA that opens a book file and reads it well. The **third**
app under the Flyleaf name, and they are three distinct products, not one app with three faces:

1. **Flyleaf** — `flyleaf.cc` · `github.com/Simplypheyie96/flyleaf` — the first, and the reading
   **journal**: quotes, notes, voice memos, photographs, characters, places and plot threads on
   one woven timeline per book. The nook, the lamp, the rabbit.
2. **Flyleaf Press** — `press.flyleaf.cc` · `github.com/Simplypheyie96/flyleaf-press`
   (`../Review app/`) — the **review** app: long reviews shared whole as printed cards, and
   every month and year collaged into what you finished.
3. **Flyleaf eReader** — this one. Where you actually *read* the file.

Never describe them as "two apps, one name", never give one the other's description, and never
put the owner's personal name in app copy. It inherits Press's *aesthetic* by instruction —
same neutral chrome, same printed-paper world, same restraint — which is a design lineage, not a
claim that the two are the same product. **The mark is Press's rosette** — the same mark, the same
path — *presented* differently, because the owner asked for one that does not read as the same app
and that is a presentation brief, not a redraw (`DESIGN.md` → *The mark*).

Success is: hand it a file, and reading is as fluid as Apple Books — instant open, a page turn
that follows your thumb, a position that survives every change of font size, and all of it
offline with no account.

## Authority order for anything visual

1. What the owner says in the prompt right now
2. `DESIGN.md` in this folder — the visual system
3. `SPEC.md` in this folder — the reading surface: every control, its range, its default, and
   what "done" means for it
4. `../Review app/DESIGN.md` — Press, the parent system, for anything the two are silent on
5. Existing code in this repo

Do not import a treatment from another project. Do not fall back on generic defaults when a
source above is silent — ask instead.

## Confirmed decisions

Locked. Do not re-litigate.

- **The aesthetic is Flyleaf Press's**, inherited by instruction. Additions are allowed only for
  roles Press has no token for, and each one is marked **NEW** in `DESIGN.md` with its reason.
- **The mark IS Press's rosette, differentiated by presentation only.** `MARK` in `Mark.tsx` is
  byte-identical to `MARK` in `../Review app/app/src/cards/assets.ts` and must stay that way: one
  family, one mark. What differs is the polarity — Press sets the rosette bare, this app knocks it
  **out of a solid ink block**, which is the one treatment that still separates the two at the 48px
  a home screen shrinks an icon to. **Do not draw a new glyph.** A previous pass read the
  instruction as a redraw, produced a printer's lozenge over five rounds, and it was reverted;
  `DESIGN.md` → *The mark* has the geometry that makes the knockout safe.
- **Reading face: Literata**, default. EB Garamond, Source Serif 4, Newsreader and Atkinson
  Hyperlegible are the alternates, loaded on selection.
- **Formats: reflowable + PDF.** EPUB 2/3, MOBI, AZW3/KF8, FB2, FBZ, TXT, Markdown, HTML, and
  PDF. Comics (CBZ/CBR) and documents (DOCX/RTF) are **out of scope** for now — not "later,
  quietly", out. Do not add one on a hunch.
- **DRM is not supported and never will be.** A DRM'd file is refused with a plain explanation,
  not a silent failure and not a broken render.
- **Standalone, handoff-ready.** No dependency on Press. The record keeps what Press would need
  — title, author, dates, format, highlights — so a handoff is a later feature, not a migration.
- **Paginated by default**, scrolled as a setting.
- **The shelf ships with two public-domain books on it**, labelled `INCLUDED`, removable, and
  restorable from Settings. A deleted one never comes back on its own. The first screen of an
  ereader leads with a book, not with "Open a book". `SPEC.md` § 1.
- **Three turn styles — Slide (default) · Fade · Instant.** There were four. Curl was built as a
  shadowless transform-only fold with a mirrored back face, it **passed** its 60fps gate under
  throttle, and the owner cut it anyway on how it felt beside Apple Books'. So the curl ban is
  back, and now it is unconditional: **no page curl, at any cost, however it measures.** The
  reasoning and the measurements are kept in `SPEC.md` § 5.2 so it is not rebuilt on the theory
  that performance was the thing missing.
- **Seven stocks, no custom stock.** Warm only, AA-measured, ink never pure white on a dark
  ground. `SPEC.md` § 2.
- **Position is a CFI**, never a scroll offset or a percentage.
- **No AI features.** Not a scope call, a product one.
- **Updates never clear local data.**

## Stack

Vite · React 19 · TypeScript · React Router 7 · Dexie (IndexedDB) · `vite-plugin-pwa` (Workbox).
Static deploy on Vercel as `flyleaf-ereader`, project root `app/`, live at
**`https://read.flyleaf.cc`** — DNS in, certificate issued (`SPEC.md` § 16.1). Source at
`github.com/Simplypheyie96/flyleaf-ereader`, private, like both siblings. No server, no database to
provision, and one optional env var: `VITE_GOOGLE_CLIENT_ID`, now **set** locally and in all three
Vercel environments, so the Drive panel is visible. As of 23 Aug 2026 this app has its **own**
Google Cloud project (`flyleaf-ereader`), its own consent screen saying "Flyleaf eReader", and its
own OAuth client with all four origins on it — no longer Press's. `appDataFolder` is per-client, so the two products' hidden folders are now separate and
neither can reach the other's files (`SPEC.md` § 15.1). Do not put this app back on a shared client.
Same shape as Press deliberately — one less thing to hold in your head when moving between them.

### The engine

**foliate-js**, vendored at `app/src/vendor/foliate-js/` — MIT, by John Factotum, the engine
behind Foliate and Readest. Vendored rather than installed: the `foliate-js` package on npm is a
**third-party republish** by an unrelated maintainer, one version, a year stale. Upstream is
`github.com/johnfactotum/foliate-js`.

- The vendored tree is **upstream source, not a fork**. Every local change is recorded in
  `app/src/vendor/foliate-js/PATCHES.md` so an update is re-appliable. Do not edit a vendored
  file without adding its entry.
- **PDF does not go through foliate.** Its PDF adapter is thin and drags in a 13MB vendored
  pdfjs. PDFs get a dedicated view on `pdfjs-dist` from npm — continuous scroll, pinch zoom, a
  real text layer for selection and search.
- Everything else goes through `view.js` / `makeBook`, which dynamically imports one parser per
  format, so a reader who only ever opens EPUBs never downloads the MOBI parser.

### What "smooth as Apple Books" means in code

Not a vibe — five specific things, and they are the acceptance criteria for the reader:

1. **A turn touches only `transform`.** Neighbouring pages are laid out before they are needed.
   If a turn measures, reads a layout property, or runs JS on the main thread while the finger
   is down, it is broken regardless of how it looks on this machine.
2. **The gesture tracks the finger 1:1**, with a rubber-band at the first and last page, and
   commits on a velocity-derived duration (see `DESIGN.md` → Motion).
3. **Position is CFI-anchored**, so changing face, size, leading or margin re-derives the page
   and lands on the same sentence. Verify with the *same paragraph*, not the same percentage.
4. **Open is instant on a reopen.** The book blob, its manifest and the last locator are already
   in IndexedDB; first paint of a reopened book must not wait on a parse of the whole file.
5. **Nothing blocks on the network, ever.** Fonts are self-hosted and precached, per Press.

Test on a real phone, throttled, with a 4MB EPUB. A reader that is smooth on a laptop and janky
on a phone has failed the brief.

## Build order (applies to every screen)

Press's discipline, unchanged:

1. Static layout, light mode, mobile, no motion — approve the look first.
2. Secondary states and variants.
3. Motion, one interaction at a time.
4. Dark chrome, derived as one variable change.
5. iPad and desktop as first-class — side rail, two-column reading, keyboard.

Motion is specified up front and applied at step 3. It is never bolted on.

## Phases

Full detail, and the acceptance criteria for each, in `SPEC.md` § 11.

- **P0** Scaffold, tokens, faces, nav shell, launch screen, PWA — *done; the empty app installs.*
- **P1** Import, format sniffing, metadata + cover extraction, Dexie schema, Library — **plus the
  seed manifest, first-run seeding, dismiss/restore, and the first-run shelf.** Seeding *is*
  import, so it lands here or it becomes a second import path later.
- **P2** The reflowable reader: paginator, gesture layer, the three turns, seven stocks, the full
  three-tab control surface, TOC, progress, position. **The phase that decides whether this
  succeeds.** In order: paginator → Slide → controls → Fade/Instant. *(Curl was built here last,
  as the cuttable one, and was duly cut — see the confirmed decisions above.)*
- **P3** Selection, highlights, notes, bookmarks + tick, the marks list, in-book search, the
  offline concordance lookup, export, and the fifteen dark-stock tint measurements.
- **P4** The PDF view on `pdfjs-dist`. Stock tints the surround only; type controls are absent,
  not disabled.
- **P5** Audit: a11y, offline, update prompt, install guidance, backup export/import, restore
  included books, storage used.

## Skills routing

Before building a screen, name the 1–3 skills and their scope, and wait for a yes. Standing picks:

- `apple-design` — **motion and gesture physics only.** Never its look; the look is Press's.
- `60fps-animation` / `fixing-motion-performance` — the paginator and the turn.
- `better-typography` — the reading face, measure, leading, hyphenation.
- `better-accessibility` + `web-quality-audit` — the gate before anything is called done.

**Never** a look pack (`book-serif-index`, `light-mode-paper-technical`, and the rest). This
project has a look; a pack would paint over it. Say it was skipped and why.

## Before shipping anything: run the measure audit

```bash
cd app && npm run audit:measure
```

**Every time, on every screen, before any deploy.** Not when a layout looks
suspect — always. It builds the app, serves it, and walks all eleven screens at
390 / 1024 / 1280, reporting any block of prose whose widest rendered line
leaves more than 10% of its host box empty. It exits non-zero on a finding, so
it can gate a release.

This exists because text wrapping short of its container is the single most
repeated complaint on this project, and the owner has caught it by eye more than
once. It is caught by eye because a per-paragraph `max-width` reads fine in the
source — the fault only exists in the relationship between that cap and the box
that ended up around it, which nothing but a rendered measurement can see.

The driver was written after one such round and then **never run**: it was in no
npm script while `index.css` claimed it "fails the build". A 46ch cap on the
install strip duly survived in the repo, leaving 48% of the card empty at 1280,
until the owner saw it on screen. It also walked `/collections`, which is not a
route, and never opened a book, the reader, or a sheet — so the screens with the
most prose on them were never measured at all. All of that is fixed; the
standing instruction is what stops it rotting again.

Rules that go with it:

- **The measure lives on the container, never on a paragraph inside it.** No
  `max-width` on a `p` inside `.page-inner` or `.sheet-body`. Narrow the
  container if a narrower measure is wanted. The long form is at the top of
  `app/src/index.css`.
- **Report what was not covered.** The driver names any screen it could not
  reach (no book on the shelf, no PDF imported). Never present a run as a pass
  for screens it skipped.
- **The PDF screens use a fixture, not a seeded book.** The shelf ships two
  `INCLUDED` books and that stays a product decision; `audit/fixture-pdf.mjs`
  generates a real two-page PDF at run time, the driver imports it through the
  app's own picker, and it is deleted after. So the PDF reader and its two
  sheets are measured like everything else — no hand measurement, and nothing
  to add to the shelf to keep it that way.

## Working on this repo

**Straight to `main`. No pull requests.** One person works on this, reviews it, and
ships it, so a PR would be a branch opened and merged by the same pair of hands — a
ceremony with no reviewer at the end of it. Commit to `main`, push, deploy. The gate
that actually catches things here is `npm run audit:measure` above, not a merge button.

## Guardrails (negative prompt, always on)

No glass, no `backdrop-filter`, no shadows. No paper texture over the text, no drawn spine
gutter. **No page curl** — the shadowless fold was tried, measured green, and cut on feel, so
there is no version of this left to try. No generated covers. No rotation on the
reading page. No Kalam outside the reader's own notes. No AI. No feature that needs a network to
work. No custom stock picker, and no cool-grey or blue-shifted page.
