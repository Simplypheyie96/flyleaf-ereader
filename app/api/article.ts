import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

/* The article extractor. The only server-side code in this project.
   ─────────────────────────────────────────────────────────────────
   Everything else here is static, and that is deliberate. This one function
   exists because a browser cannot fetch a third-party page: CORS is enforced by
   the browser on the *response*, and almost no publisher sends a permissive
   header, so a URL box in a pure static PWA can never work. Something has to
   fetch on the reader's behalf.

   What it is NOT is a general proxy. It takes a URL, fetches the page, runs
   Readability over it, inlines the images, and hands back clean HTML. It does
   not log, does not store, does not authenticate, and holds no secret to leak.
   The whole of its state is the request it is currently serving.

   Once the article is back, the app writes it to IndexedDB like any other
   import and never speaks to this function again. That is what keeps the
   project rule intact: importing a link needs a network, the same way Drive
   sync does, but *reading* what came back does not. Which is also why the
   images are inlined rather than left as remote `<img src>` — an article that
   goes blank on a plane is not offline, it is merely stored. */

const UA =
  'Mozilla/5.0 (compatible; FlyleafReader/1.0; +https://read.flyleaf.cc) Readability'

/* Generous enough for a long feature with a slow origin, well inside the
   platform's own ceiling. */
const FETCH_TIMEOUT_MS = 15_000
const IMAGE_TIMEOUT_MS = 8_000

/* A page bigger than this is not an article. The cap is on what we read, not
   on what the origin claims in Content-Length — a lying header is exactly the
   case a cap exists for. */
const MAX_PAGE_BYTES = 6 * 1024 * 1024

/* Images are inlined as data URIs, so they land in IndexedDB at ~4/3 their
   byte size, forever, on a phone. The budget is what stops one photo essay
   costing more than the rest of the shelf. Over budget, the image is dropped
   rather than left pointing at the network. */
const MAX_IMAGE_BYTES = 1_500_000
const MAX_IMAGES_TOTAL_BYTES = 4 * 1024 * 1024
const MAX_IMAGES = 24

const MAX_REDIRECTS = 5

/* ------------------------------------------------------------------- SSRF --

   This function will fetch any URL it is given, which makes it a request
   forwarder sitting inside Vercel's network. The guard is a literal-address
   blocklist checked on the original URL *and on every redirect hop*, because a
   public host that 302s to 169.254.169.254 defeats a check done only once.

   This does not defeat DNS rebinding — a hostname that resolves to a private
   address cannot be caught without resolving it ourselves, which the runtime's
   fetch does not expose. The residual risk is accepted and bounded: the
   function holds no credentials, returns only extracted article text, and the
   platform's metadata service is not reachable by IP literal from here. It is
   written down rather than left implicit so the next person weighing a change
   knows what the guard does and does not cover. */
const BLOCKED_HOSTS =
    /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal|instance-data.*)$/i

function isPrivateAddress(host: string): boolean {
    /* IPv6, including the ::ffff:10.0.0.1 form that smuggles a v4 address. */
    if (host.startsWith('[') || host.includes(':')) {
        const bare = host.replace(/^\[|\]$/g, '').toLowerCase()
        if (bare === '::1' || bare === '::' || bare.startsWith('fe80') || bare.startsWith('fc') || bare.startsWith('fd')) {
            return true
        }
        const mapped = bare.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
        if (mapped) return isPrivateAddress(mapped[1])
        return false
    }
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (!v4) return false
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        a >= 224
    )
}

function safeUrl(raw: string): URL | null {
    let url: URL
    try {
        url = new URL(raw)
    } catch {
        return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (BLOCKED_HOSTS.test(url.hostname)) return null
    if (isPrivateAddress(url.hostname)) return null
    return url
}

/* ------------------------------------------------------------------ fetch --

   Redirects are followed by hand rather than by `redirect: 'follow'` so that
   every hop goes back through `safeUrl`. */
async function fetchGuarded(start: URL, accept: string, timeoutMs: number): Promise<Response> {
    let url = start
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const stop = AbortSignal.timeout(timeoutMs)
        const res = await fetch(url.toString(), {
            redirect: 'manual',
            signal: stop,
            headers: { 'user-agent': UA, accept, 'accept-language': 'en,*;q=0.5' },
        })
        if (res.status >= 300 && res.status < 400) {
            const next = res.headers.get('location')
            if (!next) return res
            const resolved = safeUrl(new URL(next, url).toString())
            if (!resolved) throw new HttpError(400, 'That link redirects somewhere this cannot follow.')
            url = resolved
            continue
        }
        Object.defineProperty(res, 'url', { value: url.toString(), configurable: true })
        return res
    }
    throw new HttpError(400, 'That link redirects too many times.')
}

class HttpError extends Error {
    constructor(readonly status: number, message: string) {
        super(message)
    }
}

/** Read at most `limit` bytes, whatever the origin claims. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array> {
    const reader = res.body?.getReader()
    if (!reader) return new Uint8Array()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > limit) {
            await reader.cancel()
            throw new HttpError(413, 'That page is too large to read.')
        }
        chunks.push(value)
    }
    const out = new Uint8Array(size)
    let at = 0
    for (const c of chunks) {
        out.set(c, at)
        at += c.length
    }
    return out
}

/* Honour the page's declared encoding. A Windows-1252 or Shift_JIS article
   decoded as UTF-8 is mojibake from the first accented character, and the
   charset is in the header or the meta tag, so there is no need to guess. */
function decode(bytes: Uint8Array, contentType: string | null): string {
    const fromHeader = contentType?.match(/charset=["']?([^"';,\s]+)/i)?.[1]
    const head = new TextDecoder('utf-8').decode(bytes.slice(0, 2048))
    const fromMeta =
        head.match(/<meta[^>]+charset=["']?([^"'>\s;]+)/i)?.[1] ??
        head.match(/<meta[^>]+content=["'][^"']*charset=([^"';\s]+)/i)?.[1]
    const label = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase()
    try {
        return new TextDecoder(label).decode(bytes)
    } catch {
        return new TextDecoder('utf-8').decode(bytes)
    }
}

/* -------------------------------------------------------------- sanitising --

   Written out by hand rather than handed to DOMPurify, because DOMPurify does
   not work on linkedom's DOM: `createDOMPurify(window).isSupported` is
   undefined there and `sanitize()` returns its input verbatim — measured, with
   a `<script>` tag surviving intact. A sanitiser that silently no-ops is worse
   than none, because it is trusted.

   So: an allowlist, and anything not on it is dropped or unwrapped. Readability
   has already removed most of this; this pass is the one that is actually
   responsible for it. */
const KEEP_TAGS = new Set([
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'code', 'em', 'strong', 'i', 'b', 'u', 's',
    'sub', 'sup', 'mark', 'small', 'cite', 'q', 'abbr', 'time',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'figure', 'figcaption', 'img', 'a', 'span', 'div', 'section', 'article',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
])

/** Removed with everything inside them. The rest of the unknown tags are
    unwrapped instead, so a `<custom-element>` wrapping three paragraphs costs
    the wrapper and not the paragraphs. */
const DROP_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template',
    'form', 'input', 'button', 'select', 'textarea', 'option', 'label',
    'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track',
    'link', 'meta', 'base', 'applet', 'frame', 'frameset', 'portal', 'dialog',
])

const KEEP_ATTRS: Record<string, Set<string>> = {
    a: new Set(['href', 'title']),
    img: new Set(['src', 'alt', 'title', 'width', 'height']),
    td: new Set(['colspan', 'rowspan']),
    th: new Set(['colspan', 'rowspan', 'scope']),
    time: new Set(['datetime']),
    col: new Set(['span']),
    colgroup: new Set(['span']),
}
const GLOBAL_ATTRS = new Set(['lang', 'dir'])

function sanitise(root: Element, doc: Document): void {
    /* Depth-first over a static list: the tree is mutated as we go, so a live
       walker would skip nodes as siblings are unwrapped underneath it. */
    const all = Array.from(root.querySelectorAll('*')) as Element[]
    for (const el of all) {
        if (!el.parentNode) continue /* already removed with an ancestor */
        const tag = el.tagName.toLowerCase()

        if (DROP_TAGS.has(tag)) {
            el.remove()
            continue
        }

        if (!KEEP_TAGS.has(tag)) {
            /* Unwrap: the element goes, its children stay in its place. */
            const parent = el.parentNode
            while (el.firstChild) parent.insertBefore(el.firstChild, el)
            el.remove()
            continue
        }

        const allowed = KEEP_ATTRS[tag]
        for (const attr of Array.from(el.attributes) as Attr[]) {
            const name = attr.name.toLowerCase()
            const ok = GLOBAL_ATTRS.has(name) || (allowed?.has(name) ?? false)
            if (!ok) {
                el.removeAttribute(attr.name)
                continue
            }
            /* `href` is the one attribute whose *value* can still execute:
               javascript: and data: URLs both run in the document that opens
               them. Only the three schemes a reader can meaningfully follow
               survive. */
            if (name === 'href') {
                const v = attr.value.trim()
                if (!/^(https?:|mailto:|#)/i.test(v)) el.removeAttribute(attr.name)
            }
            /* By this point every kept `src` has been rewritten to a data URI
               by the inliner. Anything still remote never made it in, so it
               goes rather than becoming a load the reader cannot make offline
               — and a tracking pixel that phones home on open. */
            if (name === 'src' && !attr.value.startsWith('data:')) {
                el.removeAttribute(attr.name)
            }
        }

        /* An <img> with no src left is a gap with alt text in it. */
        if (tag === 'img' && !el.getAttribute('src')) el.remove()

        /* Links open away from the reader's book, so they get the safe rel.
           `target` is not set: that is the reading app's call, not ours. */
        if (tag === 'a' && el.getAttribute('href')) {
            el.setAttribute('rel', 'noopener noreferrer nofollow')
        }
    }
    void doc
}

/* -------------------------------------------------------------- inlining --- */

const IMAGE_TYPES = /^image\/(jpeg|png|gif|webp|avif|svg\+xml)$/i

async function inlineImages(root: Element, base: URL): Promise<{ used: number; dropped: number }> {
    const imgs = (Array.from(root.querySelectorAll('img')) as Element[]).slice(0, MAX_IMAGES)
    const rest = Array.from(root.querySelectorAll('img')).slice(MAX_IMAGES) as Element[]
    for (const extra of rest) extra.remove()

    let used = 0
    let dropped = rest.length

    /* Serial. A phone-sized article has a handful of images and the origin is
       one host; twenty parallel requests to it is how a fetcher gets rate
       limited or read as an attack. */
    for (const img of imgs) {
        /* Lazy-loaded articles keep the real URL in data-src or srcset and
           leave `src` as a placeholder pixel. Take the best thing available. */
        const candidate =
            img.getAttribute('data-src') ??
            img.getAttribute('data-original') ??
            bestFromSrcset(img.getAttribute('srcset') ?? img.getAttribute('data-srcset')) ??
            img.getAttribute('src')

        img.removeAttribute('srcset')
        img.removeAttribute('data-srcset')

        if (!candidate) {
            img.remove()
            dropped++
            continue
        }

        const target = safeUrl(new URL(candidate, base).toString())
        if (!target) {
            img.remove()
            dropped++
            continue
        }

        try {
            const res = await fetchGuarded(target, 'image/*', IMAGE_TIMEOUT_MS)
            const type = (res.headers.get('content-type') ?? '').split(';')[0].trim()
            if (!res.ok || !IMAGE_TYPES.test(type)) throw new Error('not an image')
            const bytes = await readCapped(res, MAX_IMAGE_BYTES)
            if (used + bytes.length > MAX_IMAGES_TOTAL_BYTES) throw new Error('over budget')
            img.setAttribute('src', `data:${type};base64,${base64(bytes)}`)
            used += bytes.length
        } catch {
            /* One image is never worth losing the article over. */
            img.remove()
            dropped++
        }
    }
    return { used, dropped }
}

/** The largest candidate in a srcset, by declared width. */
function bestFromSrcset(srcset: string | null): string | null {
    if (!srcset) return null
    let best: { url: string; w: number } | null = null
    for (const part of srcset.split(',')) {
        const [url, size] = part.trim().split(/\s+/)
        if (!url) continue
        const w = size?.endsWith('w') ? Number(size.slice(0, -1)) : 0
        if (!best || w > best.w) best = { url, w: Number.isFinite(w) ? w : 0 }
    }
    return best?.url ?? null
}

function base64(bytes: Uint8Array): string {
    let s = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return btoa(s)
}

/* ----------------------------------------------------------------- output -- */

/* "Announcing Rust 1.81.0 | Rust Blog" is not what the shelf should say.

   Readability drops the site suffix only when it can match the <title>
   against an <h1> on the page, and plenty of sites do not give it one. So
   this strips a trailing separator-and-tail when the tail IS the publication
   — which we already know independently, from og:site_name or the hostname —
   and leaves anything else alone. A title that genuinely contains a dash keeps
   it, because its tail will not match the site. */
function trimSiteSuffix(title: string, siteName: string): string {
    const site = siteName.toLowerCase().replace(/^www\./, '').trim()
    if (!site) return title
    const m = title.match(/^(.*\S)\s*[|\u2013\u2014\u00b7\u2022\u00ab\u00bb:-]\s*([^|\u2013\u2014\u00b7\u2022\u00ab\u00bb:-]+)$/)
    if (!m) return title
    const head = m[1].trim()
    const tail = m[2].toLowerCase().replace(/^www\./, '').trim()
    if (head.length < 15 || !tail) return title
    /* Either direction: "overreacted" against a hostname of overreacted.io,
       or "Rust Blog" against an og:site_name of exactly that. */
    const same =
        tail === site ||
        site.startsWith(`${tail}.`) ||
        tail.startsWith(`${site}.`) ||
        site.includes(tail) ||
        tail.includes(site)
    return same ? head : title
}

function esc(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/* Pages that ship the article as data, not as markup.

   Readability reads the DOM, so a page that renders its body in JavaScript
   from an embedded payload looks empty to it \u2014 on a Substack post it finds
   the footer, "Substack is the home for great culture", and calls that the
   article. The words are in the page; they are just not in the markup.

   Two shapes, and no more. Both are declared formats rather than guesses at a
   site's private structure: schema.org's `articleBody`, which many publishers
   emit for search engines, and Substack's `window._preloads`, which is one
   named site but a large fraction of what anyone actually saves to read later.
   Anything else that renders client-side still gets the honest 422 \u2014 better
   than a scraper that half-works on sites nobody tested. */
function embeddedBody(document: Document): string | null {
    /* schema.org. `articleBody` is plain text in the wild far more often than
       markup, so paragraphs are rebuilt from its blank lines; a body that is
       already markup is passed through and meets the sanitiser like any other. */
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
        let data: unknown
        try {
            data = JSON.parse(node.textContent ?? '')
        } catch {
            continue
        }
        const queue = Array.isArray(data) ? [...data] : [data]
        while (queue.length) {
            const item = queue.shift()
            if (!item || typeof item !== 'object') continue
            const record = item as Record<string, unknown>
            if (Array.isArray(record['@graph'])) queue.push(...record['@graph'])
            const body = record['articleBody']
            if (typeof body === 'string' && body.trim().length > 400) {
                if (/<(p|div|h[1-6])[\s>]/i.test(body)) return body
                return body
                    .split(/\n{2,}/)
                    .map((para) => para.trim())
                    .filter(Boolean)
                    .map((para) => `<p>${esc(para)}</p>`)
                    .join('\n')
            }
        }
    }

    /* Substack. The payload is a JSON string inside a JSON.parse() call, so it
       is read out of the script's own text rather than by executing anything. */
    for (const node of document.querySelectorAll('script')) {
        const text = node.textContent ?? ''
        if (!text.includes('window._preloads')) continue
        const match = /window\._preloads\s*=\s*JSON\.parse\((".*?")\)/s.exec(text)
        if (!match) continue
        try {
            const payload = JSON.parse(JSON.parse(match[1]) as string) as {
                post?: { body_html?: unknown }
            }
            const body = payload.post?.body_html
            if (typeof body === 'string' && body.trim().length > 400) return body
        } catch {
            /* A payload shape that has moved on. Fall through to the 422. */
        }
    }

    return null
}

export default {
    async fetch(request: Request): Promise<Response> {
        const json = (body: unknown, status = 200) =>
            new Response(JSON.stringify(body), {
                status,
                headers: {
                    'content-type': 'application/json; charset=utf-8',
                    /* Never cached anywhere. What somebody reads is their
                       business, and a shared cache in front of this would make
                       it the CDN's too. */
                    'cache-control': 'no-store',
                    'referrer-policy': 'no-referrer',
                    'x-content-type-options': 'nosniff',
                },
            })

        if (request.method !== 'POST') {
            return json({ error: 'Send a POST with { url }.' }, 405)
        }

        let raw: string
        try {
            const body = (await request.json()) as { url?: unknown }
            if (typeof body.url !== 'string') throw new Error('no url')
            raw = body.url.trim()
        } catch {
            return json({ error: 'Send a POST with { url }.' }, 400)
        }

        /* A reader pastes "theatlantic.com/…", not "https://theatlantic.com/…". */
        const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
        const url = safeUrl(withScheme)
        if (!url) {
            return json({ error: 'That does not look like a web address this can open.' }, 400)
        }

        try {
            const res = await fetchGuarded(url, 'text/html,application/xhtml+xml', FETCH_TIMEOUT_MS)
            if (!res.ok) {
                return json(
                    {
                        error:
                            res.status === 401 || res.status === 403
                                ? 'That page would not let this read it — it may be paywalled or need a sign-in.'
                                : `That page returned ${res.status}.`,
                    },
                    502,
                )
            }
            const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
            if (type && !/^(text\/html|application\/xhtml\+xml|text\/plain)$/.test(type)) {
                return json({ error: `That link is ${type}, not an article. Save it and import the file instead.` }, 415)
            }

            const bytes = await readCapped(res, MAX_PAGE_BYTES)
            const finalUrl = new URL(res.url || url.toString())
            const html = decode(bytes, res.headers.get('content-type'))

            /* Readability wants a document that knows where it came from, so
               that its own relative-URL resolution works. */
            const { document } = parseHTML(html)
            const baseEl = document.createElement('base')
            baseEl.setAttribute('href', finalUrl.toString())
            document.head?.appendChild(baseEl)

            const siteName =
                document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ??
                finalUrl.hostname.replace(/^www\./, '')
            const docLang = document.documentElement?.getAttribute('lang')?.slice(0, 35) ?? null
            /* The publisher's own statement of the headline, without the
               masthead the <title> tag carries for the browser tab's benefit.
               Used only when it is a prefix of what Readability found, which
               is what makes it a de-suffixing of the same title rather than a
               different one. */
            const ogTitle =
                document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ?? ''

            const parsed = new Readability(document as never, { charThreshold: 250 }).parse()

            /* What Readability found, measured as words rather than as markup:
               a page that renders client-side still hands back a wrapper div
               and a stray line of chrome, which is truthy and worthless. Below
               this, the embedded payload is tried before giving up. */
            const foundText = (parsed?.textContent ?? '').trim()
            const embedded = foundText.length < 600 ? embeddedBody(document as unknown as Document) : null

            if (!embedded && !parsed?.content) {
                return json(
                    { error: 'There was no article on that page — it may be a front page, a feed, or built entirely in JavaScript.' },
                    422,
                )
            }

            /* Readability hands back a string. Re-parse it so the sanitiser and
               the image inliner work on a tree rather than on a regex. */
            const { document: out } = parseHTML(`<div id="a">${embedded ?? parsed!.content}</div>`)
            const root = out.getElementById('a') as unknown as Element
            const images = await inlineImages(root, finalUrl)
            sanitise(root, out as unknown as Document)

            const found = (parsed?.title || ogTitle || finalUrl.hostname).trim()
            /* Strictly shorter, or it is not a de-suffixing — plenty of sites
               set og:title to the identical tab title, and taking it there
               would only skip the trim below. */
            const headline =
                ogTitle.length >= 8 &&
                ogTitle.length < found.length &&
                found.toLowerCase().startsWith(ogTitle.toLowerCase())
                    ? ogTitle
                    : found
            const title = trimSiteSuffix(headline, siteName)
            const byline = parsed?.byline?.trim() || ''
            const published = parsed?.publishedTime?.trim() || ''

            /* A whole document, not a fragment: this is about to be written to
               disk as an .html file and opened by the same engine that opens
               EPUBs. It carries its own <title> and language so the reader's
               metadata and hyphenation are right without a second guess.

               The masthead is three lines and a rule — where it came from, who
               wrote it, when. It is part of the text rather than app chrome
               because it has to survive being exported, and because a saved
               article with no attribution on it is how a quote loses its
               source. */
            const doc = `<!doctype html>
<html${docLang ? ` lang="${esc(docLang)}"` : ''}>
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
${byline ? `<meta name="author" content="${esc(byline)}">\n` : ''}<meta name="source" content="${esc(finalUrl.toString())}">
</head>
<body>
<article>
<h1>${esc(title)}</h1>
<p class="flyleaf-source">${esc(siteName)}${byline ? ` · ${esc(byline)}` : ''}${published ? ` · ${esc(published)}` : ''}<br>
<a href="${esc(finalUrl.toString())}" rel="noopener noreferrer nofollow">${esc(finalUrl.toString())}</a></p>
<hr>
${root.innerHTML}
</article>
</body>
</html>`

            return json({
                url: finalUrl.toString(),
                title,
                byline,
                siteName,
                published,
                lang: docLang,
                excerpt: parsed?.excerpt?.trim() ?? '',
                imageBytes: images.used,
                imagesDropped: images.dropped,
                html: doc,
            })
        } catch (err) {
            if (err instanceof HttpError) return json({ error: err.message }, err.status)
            /* A timeout, a DNS failure, a TLS error. The reader does not need
               the distinction and the message must not leak our internals. */
            return json({ error: 'That page could not be reached.' }, 502)
        }
    },
}
