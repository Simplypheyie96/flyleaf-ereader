/* Warming the pdfjs data cache.
   ─────────────────────────────
   pdfjs asks for a CMap, a base-14 font, an ICC profile or a WASM module only
   when a particular PDF happens to need one, by exact unhashed filename. That
   is why they are not in the precache: 3.1MB of CJK CMaps on every install,
   for a reader who may never open a PDF at all, is the wrong trade — and it is
   the trade this app deliberately did not make.

   So the gap is closed from the other end. The first time a PDF is imported,
   we know this reader opens PDFs, and only then do we fetch the lot in the
   background. The existing `/pdfjs/` CacheFirst rule in the service worker
   catches every response, so a later open finds them locally with the network
   off. Nothing here blocks the import, and a failure is silent — the files are
   still fetchable on demand exactly as before. */

const KEY = 'flyleaf.pdfjs.warm'

let running = false

export async function warmPdfData(): Promise<void> {
    if (running) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    running = true
    try {
        const res = await fetch('/pdfjs/manifest.json')
        if (!res.ok) return
        const m = (await res.json()) as { version: string; files: string[] }
        /* Keyed by version, so a pdfjs upgrade — which renames nothing but can
           add files — warms again rather than trusting a stale run. */
        if (localStorage.getItem(KEY) === m.version) return
        /* Serial, not parallel: this is background work behind a reader who is
           about to open a book, and forty concurrent requests would compete
           with the render for the same connection. */
        for (const f of m.files) {
            try {
                await fetch(`/pdfjs/${f}`, { cache: 'force-cache' })
            } catch {
                /* One missing file must not abandon the other hundred and
                   sixty; the worker would refetch it on demand anyway. */
            }
        }
        localStorage.setItem(KEY, m.version)
    } catch {
        /* No manifest in dev before a copy, or offline mid-run. Try again on
           the next PDF import. */
    } finally {
        running = false
    }
}
