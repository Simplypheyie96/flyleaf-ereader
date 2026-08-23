# Flyleaf eReader

**[read.flyleaf.cc](https://read.flyleaf.cc)**

A local-first PWA that opens a book file and reads it well. EPUB 2/3, MOBI, AZW3/KF8, FB2, FBZ,
TXT, Markdown, HTML and PDF — paginated by default, no account, nothing to sign up for. The
library lives on the device: books, positions, highlights and notes are all in IndexedDB, and an
update never clears them.

The third app under the Flyleaf name, and the three are distinct products rather than one app
with three faces:

| | | |
| --- | --- | --- |
| **Flyleaf** | [flyleaf.cc](https://flyleaf.cc) | the reading journal — quotes, notes, voice memos, characters and plot threads on one timeline per book |
| **Flyleaf Press** | [press.flyleaf.cc](https://press.flyleaf.cc) | the review app — long reviews shared whole as printed cards |
| **Flyleaf eReader** | [read.flyleaf.cc](https://read.flyleaf.cc) | this one, where you read the file |

The app lives in [`app/`](app/). Everything at this level is design material: `DESIGN.md` (the
visual system, inherited from Flyleaf Press), `SPEC.md` (the reading surface — every control, its
range, its default, and what "done" means for it) and `CLAUDE.md` (the standing brief).

## Reading engine

[foliate-js](https://github.com/johnfactotum/foliate-js) (MIT, John Factotum) for reflowable
formats, vendored at `app/src/vendor/foliate-js/` — upstream source, not a fork, with every local
change recorded in `PATCHES.md` beside it. [pdf.js](https://mozilla.github.io/pdf.js/) for PDF,
which takes its own path and does not go through foliate.

DRM-protected files are not supported and cannot be. A DRM'd file is refused with a plain
explanation rather than a broken render.

## Develop

```bash
cd app
npm install
npm run dev
```

## Build

```bash
cd app
npm run build
```

Static site, no server and no database. On Vercel, set the project root to `app/` — the
`vercel.json` there carries the SPA rewrite.

Two optional environment variables, both public by design, and the app works without either:

| | |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | shows the Google Drive backup panel in Settings. Unset, the panel is hidden and everything else is unaffected. |
| `VITE_PAYSTACK_KEY` | the tip jar's public key. Falls back to the committed one. |

## The audit

Twenty-four Playwright drivers, run against a production preview rather than the dev server —
the service worker, the split parser chunks and the real font files only exist in a build, and
several of the checks are about exactly those. A finding is a bug; a run is clean only at zero.

```bash
cd app
npm run build
npx vite preview --port 4173 --strictPort
node audit/routes.mjs
```

`audit/README.md` lists all of them and is honest about the two that cannot cover the whole path.
