/* ── the content sandbox, from this side of it ───────────────────────────────

   A book is a file a stranger wrote, and the paginator renders it in an iframe
   with `sandbox="allow-same-origin allow-scripts"` (paginator.js § the sandbox).
   Upstream needs both: `allow-scripts` because WebKit fires no load event
   inside a script-less frame (WebKit bug 218086), and `allow-same-origin`
   because every measurement the paginator makes reads `contentDocument`. Held
   together, though, they mean a script inside a book file would run on THIS
   origin — the origin that owns the library, the highlights and the reading
   positions in IndexedDB. A book gets to lay out text. It does not get to read
   the shelf.

   So the script is stopped before it is ever handed to a frame, on foliate's
   own two hooks — no vendored behaviour changed, nothing overridden:

   · `load`, dispatched per manifest item with `{ type, isScript, allow }`
     (epub.js:766). Setting `allow = false` refuses the resource outright, so a
     referenced .js file is never fetched, never blob'd, never linked.

   · `data`, dispatched with the resource's bytes before the blob URL is made
     (epub.js:719, mobi.js:1091, and mobi.js's two section builders by
     PATCHES.md § 5). A `Content-Security-Policy` meta goes into the head of
     every document, which closes what the resource hook cannot see: inline
     `<script>`, `on*` attributes, and `javascript:` URLs.

   The two are not redundant. The first stops the fetch; the second stops the
   code that arrived inside the markup itself.

   Formats, honestly:
   · EPUB — both hooks, full coverage.
   · MOBI / AZW3 / KF8 — the `data` hook, covering resources (upstream) and
     section documents (the patch). It has no `load` hook and so no per-item
     `isScript`; a JS resource is instead emptied here by media type.
   · FB2 / FBZ — nothing to do. fb2.js rebuilds the document through a strict
     whitelist (`convert()`: `if (!d) return null`), which drops every element
     it does not know and copies only listed attributes, so neither a script
     element nor an `on*` handler can reach the output at all.
   · TXT / Markdown / HTML — never touched by this: those documents are built
     in reader/textBook.ts, which strips scripts, handlers and `javascript:`
     URLs at parse time and carries the same meta in its own template.
   · PDF — a different view entirely, and pdf.js runs the file's JavaScript
     never (`enableScripting` is off by default).
*/

/** The one policy, as a string, because it is inserted into markup. */
const CSP = '<meta http-equiv="Content-Security-Policy"'
    + ' content="script-src \'none\'"/>'

const HTML = 'text/html'
const XHTML = 'application/xhtml+xml'
const IS_JS = /\/(x-)?(java|ecma)script/i

/** Where the head opens, if it does. Case-insensitive; tolerates attributes. */
const HEAD_OPEN = /<head(\s[^>]*)?>/i
const HTML_OPEN = /<html(\s[^>]*)?>/i

/* Textual, not a DOMParser round trip. Re-serialising every section would
   change more than the head — self-closing, entities, the XML declaration —
   and the paginator has to parse the result as the type it was declared as.
   The meta is self-closed so valid XHTML stays valid. */
function withPolicy(str: string, type: string): string {
    if (str.includes('http-equiv="Content-Security-Policy"')) return str
    const head = HEAD_OPEN.exec(str)
    if (head) return str.slice(0, head.index + head[0].length) + CSP
        + str.slice(head.index + head[0].length)
    /* No head. In HTML the parser opens one implicitly and a leading meta lands
       inside it; in XHTML a document without a head is a document without an
       html element, which would not have parsed as XHTML in the first place. */
    const html = HTML_OPEN.exec(str)
    if (html) return str.slice(0, html.index + html[0].length) + '<head>' + CSP
        + '</head>' + str.slice(html.index + html[0].length)
    return type === HTML ? CSP + str : str
}

type Loaded = { type?: string, isScript?: boolean, allow?: boolean }
type Data = { type?: string, data?: unknown }
type Book = { transformTarget?: EventTarget } | null | undefined

/** Attach the policy to a book. Safe to call on a book that has no hooks. */
export function hardenBook(book: Book): void {
    const target = book?.transformTarget
    if (!target) return

    target.addEventListener('load', event => {
        const detail = (event as CustomEvent<Loaded>).detail
        if (detail?.isScript) detail.allow = false
    })

    target.addEventListener('data', event => {
        const detail = (event as CustomEvent<Data>).detail
        const type = detail?.type ?? ''
        /* A script resource that came through the data hook instead of the
           load hook — MOBI has no load hook — is emptied rather than refused:
           `data` has no veto, and an empty file is a script that does nothing. */
        if (IS_JS.test(type)) { detail.data = ''; return }
        if (type !== HTML && type !== XHTML) return
        detail.data = Promise.resolve(detail.data).then(data =>
            typeof data === 'string' ? withPolicy(data, type) : data)
    })
}
