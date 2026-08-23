# Flyleaf eReader

A local-first PWA that opens a book file and reads it well. EPUB, MOBI, AZW3, FB2, TXT,
Markdown, HTML and PDF — paginated, offline, no account.

The app lives in [`app/`](app/). Everything at this level is design material: `DESIGN.md` (the
visual system, inherited from Flyleaf Press) and `CLAUDE.md` (the standing brief).

## Reading engine

[foliate-js](https://github.com/johnfactotum/foliate-js) (MIT, John Factotum) for reflowable
formats, vendored at `app/src/vendor/foliate-js/`; [pdf.js](https://mozilla.github.io/pdf.js/)
for PDF. DRM-protected files are not supported and cannot be.

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

Static site. On Vercel, set the project root to `app/` — `vercel.json` there carries the SPA
rewrite. No environment variables, no server, no database.
