import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

import { createReadStream, cpSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { execSync } from 'node:child_process'

import pkg from './package.json'

/* Which build this is. package.json's version is bumped by hand and so says
   nothing about most deploys; the commit changes every time. Vercel puts it in
   the environment, locally we ask git, and a tarball with neither gets an
   honest 'local'. Same as Press — Settings shows it, and a reader reporting a
   bug can say which build they are on. */
const COMMIT =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  (() => {
    try {
      return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim()
    } catch {
      return 'local'
    }
  })()

/* ── pdfjs's helper assets ────────────────────────────────────────────────
   pdfjs-dist ships four directories of data its worker fetches on demand:
   `standard_fonts` (the base-14 faces, for a PDF that names one without
   embedding it), `cmaps` (predefined CJK encodings), `wasm` (the JBIG2,
   JPEG-2000 and ICC codecs) and `iccs`. They are data, not code, so they are
   not importable and no bundler will find them — they have to be copied and
   served at a URL the worker is told about.

   Copied at build time from the installed package rather than committed, so
   `npm update pdfjs-dist` cannot leave a stale codec behind that silently
   renders a scan wrong. The URL prefix is repeated in
   src/reader/pdf/engine.ts, which is the one file allowed to know it. */
function pdfjsAssets(): Plugin {
  const req = createRequire(import.meta.url)
  const root = dirname(req.resolve('pdfjs-dist/package.json'))
  /* quickjs-eval is the form-scripting sandbox and openjpeg/jbig2's
     `*_nowasm_fallback.js` are the pre-wasm shims. Neither is reachable:
     engine.ts passes `enableScripting: false`, and every browser this app
     runs in has WebAssembly. 1.1MB of the 1.5MB `wasm` directory, skipped. */
  const skip = /(nowasm_fallback\.js|quickjs-eval\.(js|wasm))$/
  const dirs = ['standard_fonts', 'cmaps', 'wasm', 'iccs']
  const copy = (out: string) => {
    for (const d of dirs) {
      const from = join(root, d)
      if (!existsSync(from)) continue
      mkdirSync(join(out, d), { recursive: true })
      cpSync(from, join(out, d), {
        recursive: true,
        filter: src => !skip.test(src),
      })
    }
  }
  return {
    name: 'flyleaf-pdfjs-assets',
    /* Emitted straight into the output tree rather than through emitFile, so
       the filenames stay exactly what the worker asks for — these are fetched
       by name at runtime and a content hash would break every one of them. */
    writeBundle() { copy(resolve('dist/pdfjs')) },
    /* Dev has no dist. Serving them from the public directory would put them
       in every production precache too, so instead the dev server answers the
       prefix from a copy made once into node_modules/.vite. */
    configureServer(server) {
      const out = resolve('node_modules/.vite/pdfjs')
      copy(out)
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
        const file = resolve(out, rel)
        /* startsWith on the resolved path is the traversal check: a request
           for `../../.env` resolves outside `out` and falls through to 404. */
        if (!rel || !file.startsWith(out + '/') || !existsSync(file)) return next()
        res.setHeader('Content-Type',
          file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(COMMIT),
  },
  plugins: [
    react(),
    pdfjsAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      /* src/pwa.ts registers the worker instead of the plugin's injected
         snippet — holding the registration is the only way to offer a
         "Check for updates" button, since without it there is nothing to
         call .update() on. */
      injectRegister: null,
      manifest: {
        id: '/',
        name: 'Flyleaf eReader',
        short_name: 'Flyleaf Read',
        description: 'Read what you own. EPUB, MOBI, AZW3, FB2, PDF — paginated, offline, no account.',
        lang: 'en',
        dir: 'ltr',
        categories: ['books', 'education', 'productivity'],
        theme_color: '#F4F2ED',
        background_color: '#F4F2ED',
        display: 'standalone',
        /* No orientation lock. Press is portrait because a review card is a
           portrait object; a book is read in both, and a reader that refuses
           landscape on a tablet is a reader nobody uses on a tablet. */
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          /* the mark sits small in these two so Android's circle crop can't
             clip a petal off */
          { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Open a book', short_name: 'Open', url: '/open' },
          { name: 'Library', short_name: 'Library', url: '/' },
        ],
        /* Double-clicking an .epub opens it here. src/openQueue.ts consumes
           window.launchQueue; /open handles the file and redirects into the
           reader, so a launch is the same code path as a drag-and-drop.

           Book containers only, deliberately. The app also reads .txt, .md
           and .html, but claiming the OS default for those would make an
           ereader the thing that opens every text file on the machine — a
           land-grab, and one nobody asked for. Those arrive by picker or by
           drop. PDF is absent until the PDF view exists (P4): a handler for
           a format the app cannot render yet is a broken promise made by the
           manifest. */
        file_handlers: [
          {
            action: '/open',
            accept: {
              'application/epub+zip': ['.epub'],
              'application/x-mobipocket-ebook': ['.mobi', '.prc'],
              'application/vnd.amazon.ebook': ['.azw', '.azw3'],
              'application/x-fictionbook+xml': ['.fb2'],
              'application/x-zip-compressed-fb2': ['.fbz'],
              /* Registered in the same handler, not a second one: /open sniffs
                 the file itself and routes it, so the OS only needs to know
                 this app will take a PDF. Plain text, Markdown and HTML are
                 deliberately absent — claiming .txt and .html system-wide
                 would put an ereader in the "open with" list for every log
                 file and saved web page on the machine. */
              'application/pdf': ['.pdf'],
            },
          },
        ],
        /* Opening a second book reuses the window that is already running,
           rather than stacking app instances — and, more to the point, rather
           than opening a second client on the same IndexedDB. */
        launch_handler: { client_mode: 'navigate-existing' },
      },
      workbox: {
        /* epub is in this list for one reason: the two included books in
           public/seed. SPEC.md § 1.2 says they are offline-safe *by
           construction* because they are fetched from this origin and
           precached — and without the extension here the fetch would be a
           network call, which is exactly the thing this app is not allowed to
           need. Both files are under Workbox's 2 MiB per-file default. */
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,epub}'],
        /* the iOS launch images are a megabyte the app never reads — Safari
           fetches them itself at install time, so they stay out of precache.
           og.png is fetched by other people's link-preview servers, never by
           the app. */
        globIgnores: ['**/splash/**', '**/og-*.png'],
        /* A book parser is a large chunk and there are several of them. 6MB is
           Press's ceiling and too tight here: the reading engine's biggest
           bundle has to be precached or the first offline open of a MOBI fails
           on a file the reader already has on disk. */
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        /* Almost nothing is runtime-cached, because almost nothing is
           fetched at runtime. The faces are served from this origin and swept
           up by globPatterns; book files live in IndexedDB. A reader with no
           network should not be able to tell.

           The one exception is pdfjs's data files, and the split is deliberate.
           Its *code* — the API chunk and the worker — lands in assets/ as .js
           and is precached like any other parser, so opening a PDF offline
           works. Its *data* is 2.4MB of standard fonts, CMaps, ICC profiles and
           WASM decoders that a given PDF almost certainly does not need:
           precaching all of it would cost every reader a 2.4MB install for a
           format many of them will never open. So it is CacheFirst instead —
           fetched at most once, kept forever after.

           The honest gap this leaves, recorded in SPEC.md § 10: a PDF whose
           fonts are neither embedded nor available on the system, or which uses
           JBIG2, JPEG 2000, an ICC profile or a predefined CJK CMap, needs one
           network fetch the first time it is opened. Every other PDF — anything
           with embedded or base-14 fonts, which is the overwhelming majority —
           needs none, because pdfjs asks for these files only when a page
           actually references one. */
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/pdfjs/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdfjs-data',
              /* Immutable, versioned with the app, and small individually. No
                 expiration: a reader who has opened a CJK PDF once should not
                 lose the CMap for it because a month passed. */
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
