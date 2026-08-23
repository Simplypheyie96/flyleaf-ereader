/* Plain text, Markdown and a single HTML file, turned into something the
   paginator can read.

   These three are in scope (`CLAUDE.md` -> Formats) but foliate has no parser
   for any of them: `makeBook` sniffs zip, PDF, MOBI and FB2, and everything
   else falls through to `UnsupportedTypeError`. Until this file existed a .txt
   imported cleanly, sat on the shelf with its title read out of the first 8KB,
   and then refused to open — the worst of the three possible failures, because
   it fails after the reader has already been told it worked.

   What comes out is a foliate book object: `sections` the paginator can load,
   a `toc`, and the four href helpers `view.js` needs to track position. The
   shape is fb2.js's — one blob URL per section, `createDocument` for the parts
   of foliate that want the DOM without an iframe — because that is the shape
   the engine already knows how to drive.

   Three decisions worth stating, because none is forced:

   · **A book's own CSS is dropped.** An EPUB is authored as a book and keeps
     its stylesheet; a loose .html file is usually a web page, with a fixed
     width and a colour scheme of its own, and letting it win would mean the
     stock control silently stops working on exactly the files where the reader
     cannot tell why. The seven stocks and the type controls are the reading
     surface here, per `SPEC.md` §§ 2-4.
   · **Remote images are dropped, alt text kept.** A book that reaches the
     network is a book that does not work offline — the guardrail — and an
     image request tells a server what someone is reading. Data URIs are kept:
     they are already in the file.
   · **Scripts, event handlers and javascript: URLs are removed.** Not
     housekeeping. `paginator.js` gives the section iframe
     `sandbox="allow-same-origin allow-scripts"`, so script inside a section
     runs on this origin, where the whole library lives in IndexedDB. A book is
     text; nothing in these three formats needs to execute. */

export type TextFormat = 'txt' | 'markdown' | 'html'

/** One top-level flow element, ready to be dropped into a section. A block is
    never split across sections: a paragraph broken over a section boundary
    would break the CFI it anchors and, more plainly, the sentence. */
interface Block {
    html: string
    /** set on headings, so the TOC has something to point at */
    id?: string
    title?: string
    /** 1-6, heading only */
    level?: number
}

/* A section is roughly this many characters of markup. Small enough that the
   first paint of a reopened book does not wait on a whole novel being laid
   out, large enough that a turn near a boundary is rare. */
const SECTION_TARGET = 120_000
/* A heading only forces a new section once the current one has some weight, or
   a run of chapter headings on a contents page would each take a section of
   their own and the progress bar would read as nonsense. */
const SECTION_MIN = 8_000

const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* ── the bytes ─────────────────────────────────────────────────────────── */

/** Decode without guessing more than the bytes support. A great many .txt
    books on disk are Latin-1 — Gutenberg shipped that way for years — and
    decoding one as UTF-8 replaces every accented character with a lozenge. So:
    honour a BOM, try UTF-8 strictly, and fall back to windows-1252, which is
    the superset of Latin-1 that browsers are required to have. */
async function decode(file: Blob): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes[0] === 0xff && bytes[1] === 0xfe)
        return new TextDecoder('utf-16le').decode(bytes.subarray(2))
    if (bytes[0] === 0xfe && bytes[1] === 0xff)
        return new TextDecoder('utf-16be').decode(bytes.subarray(2))
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
        return new TextDecoder('utf-8').decode(bytes.subarray(3))
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return new TextDecoder('windows-1252').decode(bytes)
    }
}

/* ── plain text ────────────────────────────────────────────────────────── */

const ROMAN = /^[ivxlcdm]+\.?$/i
const HEADING_WORD = /^(chapter|part|book|volume|canto|act|scene|letter|epilogue|prologue|introduction|preface|appendix|afterword|foreword)\b/i
const TOP_WORD = /^(part|book|volume)\b/i

/** Is this one-line paragraph a heading? Plain text has no markup, so the only
    evidence is how the line is written, and the cost of a wrong answer is
    asymmetric: a missed heading is one TOC entry short, a false one puts a line
    of prose in the contents. So every test here is conservative — short,
    unpunctuated, and either a chapter word, a numeral, or shouted. */
function txtHeading(line: string): number | null {
    const t = line.trim()
    if (!t || t.length > 64) return null
    if (/[!?,;:"]$/.test(t)) return null
    if (/\.$/.test(t) && t !== t.toUpperCase() && !ROMAN.test(t)) return null
    if (/\s{2,}/.test(t)) return null                    // a centred table row
    if (t.split(/\s+/).length > 9) return null
    if (HEADING_WORD.test(t)) return TOP_WORD.test(t) ? 1 : 2
    if (ROMAN.test(t) || /^\d+\.?$/.test(t)) return 2
    if (t === t.toUpperCase() && /[A-Z]/.test(t)) return 2
    return null
}

/** A hard-wrapped paragraph has to be un-wrapped or it reflows into a ragged
    column of 70-character lines that ignores every measure and font-size
    control in the sheet. Verse must not be: its line breaks are the poem. The
    test is the shape of the paragraph — three or more lines, none of them near
    a wrap column — which is what verse looks like and what prose does not. */
function isVerse(lines: string[]): boolean {
    if (lines.length < 3) return false
    return Math.max(...lines.map(l => l.trim().length)) <= 50
}

function txtBlocks(text: string): Block[] {
    const out: Block[] = []
    let n = 0
    /* Three or more blank lines in a row is a section break in a typescript,
       and besides the blank line itself it is the only structural signal plain
       text has. Kept as a rule so it does not read as a wide paragraph gap. */
    for (const chunk of text.replace(/\r\n?/g, '\n').split(/\n{3,}/)) {
        if (out.length) out.push({ html: '<hr class="txt-break"/>' })
        for (const para of chunk.split(/\n\s*\n/)) {
            const lines = para.split('\n').filter(l => l.trim())
            if (!lines.length) continue
            if (lines.length === 1) {
                const level = txtHeading(lines[0])
                if (level) {
                    const id = `h${++n}`
                    const title = lines[0].trim()
                    out.push({
                        html: `<h${level} id="${id}">${esc(title)}</h${level}>`,
                        id, title, level,
                    })
                    continue
                }
            }
            out.push(isVerse(lines)
                ? { html: `<p class="verse">${lines.map(l => esc(l.trim())).join('<br/>')}</p>` }
                : { html: `<p>${esc(lines.map(l => l.trim()).join(' '))}</p>` })
        }
    }
    /* A leading rule is a rule above the first word of the book. */
    while (out.length && out[0].html.startsWith('<hr')) out.shift()
    while (out.length && out[out.length - 1].html.startsWith('<hr')) out.pop()
    return out
}

/* ── markdown ──────────────────────────────────────────────────────────── */

/* Code spans are lifted out of the line before anything else runs, so no
   asterisk inside `a * b` becomes emphasis. The marker has to be something
   that cannot survive escaping and cannot appear in prose: a private-use
   character, put back at the end. */
const CODE_MARK = ''

/** Inline markup, in the one order that works: escape first, so no source text
    can inject a tag; lift code spans out; then the rest; then put code back. */
function inline(src: string): string {
    const code: string[] = []
    let s = esc(src).replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t, body) => {
        code.push(String(body).trim())
        return CODE_MARK + (code.length - 1) + CODE_MARK
    })
    s = s
        /* Images before links — the syntax differs by one leading character,
           and a link rule would eat an image's alt text as its label. Remote
           src is dropped right here, where the alt text is, because the alt
           text is the only part of a remote image worth keeping offline. */
        .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, href) =>
            /^data:image\//i.test(href)
                ? `<img src="${href}" alt="${alt}"/>`
                : alt ? `<span class="alt">${alt}</span>` : '')
        .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, t, href) =>
            /^(javascript|vbscript):/i.test(href) ? t : `<a href="${href}">${t}</a>`)
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
        .replace(/(^|[\s(])([*_])(?=\S)([^*_]*?\S)\2(?=[\s.,;:!?)]|$)/g, '$1<em>$3</em>')
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
        .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>')
        /* Two trailing spaces is a hard break, and it is load-bearing in
           anything with an address or a verse in it. */
        .replace(/ {2,}$/gm, '<br/>')
        .replace(/\n/g, ' ')
    return s.replace(new RegExp(CODE_MARK + '(\\d+)' + CODE_MARK, 'g'),
        (_m, i) => `<code>${code[Number(i)]}</code>`)
}

function mdBlocks(text: string): Block[] {
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    const out: Block[] = []
    let n = 0
    const heading = (level: number, raw: string) => {
        const id = `h${++n}`
        const title = raw.replace(/\s+#+\s*$/, '').trim()
        out.push({
            html: `<h${level} id="${id}">${inline(title)}</h${level}>`,
            id, title: title.replace(/[*_`]/g, ''), level,
        })
    }

    /* Front matter is metadata, and the importer has already read it. Showing
       it as the first page of the book would be showing the reader the file. */
    let i = 0
    if (lines[0]?.trim() === '---') {
        const close = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)$/.test(l.trim()))
        if (close > 0) i = close + 1
    }

    for (; i < lines.length; i++) {
        const line = lines[i]
        const t = line.trim()
        if (!t) continue

        const fence = t.match(/^(`{3,}|~{3,})(.*)$/)
        if (fence) {
            const body: string[] = []
            const close = fence[1].slice(0, 3)
            for (i++; i < lines.length; i++) {
                if (lines[i].trim().startsWith(close)) break
                body.push(lines[i])
            }
            const lang = fence[2].trim().split(/\s+/)[0]
            out.push({
                html: `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>`
                    + esc(body.join('\n')) + '</code></pre>',
            })
            continue
        }

        const atx = t.match(/^(#{1,6})\s+(.*)$/)
        if (atx) { heading(atx[1].length, atx[2]); continue }

        if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(t)) {
            out.push({ html: '<hr/>' })
            continue
        }

        /* Setext: the underline is on the next line, so this is only a heading
           if there is a next line and this one is not a list item. */
        const under = lines[i + 1]?.trim()
        const listish = /^([-*+]|\d+[.)])\s/.test(t)
        if (under && /^=+$/.test(under) && !listish) { heading(1, t); i++; continue }
        if (under && /^-{2,}$/.test(under) && !listish) { heading(2, t); i++; continue }

        if (t.startsWith('>')) {
            const body: string[] = []
            for (; i < lines.length && lines[i].trim(); i++)
                body.push(lines[i].replace(/^\s*>\s?/, ''))
            i--
            out.push({ html: `<blockquote><p>${inline(body.join('\n').trim())}</p></blockquote>` })
            continue
        }

        /* A pipe table needs its separator row, which is what distinguishes a
           table from a paragraph that happens to contain a bar. */
        if (t.includes('|') && /^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
            const cells = (row: string) => row.trim().replace(/^\||\|$/g, '')
                .split('|').map(c => inline(c.trim()))
            const head = cells(t)
            const rows: string[][] = []
            for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]))
            i--
            out.push({
                html: '<table><thead><tr>' + head.map(c => `<th>${c}</th>`).join('')
                    + '</tr></thead><tbody>'
                    + rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('')
                    + '</tbody></table>',
            })
            continue
        }

        const item = t.match(/^([-*+]|\d+[.)])\s+(.*)$/)
        if (item) {
            const ordered = /\d/.test(item[1])
            const items: string[] = []
            for (; i < lines.length; i++) {
                const li = lines[i].trim()
                if (!li) break
                const m = li.match(/^([-*+]|\d+[.)])\s+(.*)$/)
                if (m) items.push(m[2])
                /* A continuation line belongs to the item above it. */
                else if (items.length) items[items.length - 1] += ' ' + li
                else break
            }
            i--
            const tag = ordered ? 'ol' : 'ul'
            out.push({ html: `<${tag}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${tag}>` })
            continue
        }

        /* An indented code block — four spaces, still in the wild in older
           files. Only when it does not directly follow a paragraph, where four
           spaces is far more likely to be a stray indent than code. */
        if (/^ {4,}\S/.test(line) && !out.length) {
            const body: string[] = []
            for (; i < lines.length && (/^ {4,}/.test(lines[i]) || !lines[i].trim()); i++)
                body.push(lines[i].replace(/^ {4}/, ''))
            i--
            out.push({ html: `<pre><code>${esc(body.join('\n').replace(/\n+$/, ''))}</code></pre>` })
            continue
        }

        const para: string[] = []
        for (; i < lines.length; i++) {
            const p = lines[i].trim()
            if (!p) break
            if (/^(#{1,6}\s|>|`{3,}|~{3,})/.test(p)) break
            if (/^([-*+]|\d+[.)])\s/.test(p)) break
            para.push(lines[i].replace(/\s+$/, lines[i].endsWith('  ') ? '  ' : ''))
        }
        i--
        if (para.length) out.push({ html: `<p>${inline(para.join('\n'))}</p>` })
    }
    return out
}

/* ── a single HTML file ────────────────────────────────────────────────── */

const DROP = 'script,style,link,meta,base,noscript,iframe,frame,frameset,object,'
    + 'embed,applet,form,input,button,select,textarea,video,audio,canvas,template'

/* Dropped from every element. `on*` is the obvious one; the rest are the
   attributes a web page uses to hold a layout that a reading pane has to be
   allowed to reflow. */
const DROP_ATTR = new Set(['style', 'class', 'width', 'height', 'bgcolor',
    'align', 'valign', 'color', 'face', 'size', 'border', 'cellpadding',
    'cellspacing', 'background'])

function isHeading(el: Element): number {
    return /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0
}

function htmlBlocks(text: string): Block[] {
    const doc = new DOMParser().parseFromString(text, 'text/html')
    for (const el of doc.querySelectorAll(DROP)) el.remove()

    for (const el of doc.querySelectorAll('*')) {
        for (const a of [...el.attributes]) {
            const name = a.name.toLowerCase()
            if (name.startsWith('on') || DROP_ATTR.has(name)) {
                el.removeAttribute(a.name)
                continue
            }
            if ((name === 'href' || name === 'src' || name === 'xlink:href')
                && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value))
                el.removeAttribute(a.name)
        }
    }

    /* An image the reader could not see offline, replaced by the words that
       were written for exactly that case. */
    for (const img of doc.querySelectorAll('img,picture,source,svg')) {
        if (/^data:image\//i.test(img.getAttribute('src') ?? '')) continue
        const alt = img.getAttribute('alt')?.trim()
        if (alt) {
            const span = doc.createElement('span')
            span.className = 'alt'
            span.textContent = alt
            img.replaceWith(span)
        } else img.remove()
    }

    let n = 0
    const nextId = () => `h${++n}`
    const flatten = (root: Element): Block[] => {
        const out: Block[] = []
        for (const el of [...root.children]) {
            if (!el.textContent?.trim() && !el.querySelector('img')) continue
            const level = isHeading(el)
            if (level) {
                const id = el.id || nextId()
                el.id = id
                out.push({ html: el.outerHTML, id, title: el.textContent!.trim(), level })
                continue
            }
            /* A wrapper div holding the whole book is the usual shape of a
               single-file HTML book, and taking it as one block would make one
               400KB section with no boundary to break at. Its children are the
               real blocks. */
            const wrapper = /^(DIV|SECTION|ARTICLE|MAIN|BODY)$/.test(el.tagName)
                && el.children.length > 1
                && (el.textContent?.length ?? 0) > SECTION_MIN
            if (wrapper) out.push(...flatten(el))
            else out.push({ html: el.outerHTML })
        }
        return out
    }
    return doc.body ? flatten(doc.body) : []
}

/* ── sections ──────────────────────────────────────────────────────────── */

/* The only stylesheet these three formats get, and it is this app's, not the
   file's. Three classes, all of them invented by the block builders above, so
   nothing here can collide with a book's own markup. `!important` because
   readingCss.ts sets text-indent, text-align and margins on every `p` with it
   — a verse whose lines were justified and first-line-indented is no longer
   the poem that was written. Nothing is dimmed: a paler grey would fail the
   contrast floor on the light stocks, and italic already reads as an aside. */
const PAGE_CSS = `
hr.txt-break {
    border: 0 !important;
    block-size: 0 !important;
    border-block-start: 1px solid color-mix(in oklab, currentColor 22%, transparent) !important;
    inline-size: 22% !important;
    margin: 1.8em auto !important;
}
p.verse {
    text-indent: 0 !important;
    text-align: start !important;
    hyphens: manual !important;
    -webkit-hyphens: manual !important;
    margin-block: 0.9em !important;
    margin-inline-start: 1.1em !important;
}
span.alt {
    display: block;
    font-style: italic;
    text-align: center;
    margin-block: 0.9em;
}
`.trim()

/* The CSP is belt to htmlBlocks()'s braces: the DROP list and the attribute
   sweep below already take scripts, handlers and `javascript:` URLs out of an
   imported HTML file, and this says so to the browser as well. reader/harden.ts
   carries the same line for the parsed formats, and the reason for both. */
const page = (body: string, lang: string | null) =>
    '<!DOCTYPE html><html' + (lang ? ` lang="${esc(lang)}"` : '')
    + '><head><meta charset="utf-8"/>'
    + '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'"/>'
    + '<title></title><style>'
    + PAGE_CSS + '</style></head><body>'
    + body + '</body></html>'

interface TocItem {
    label: string
    href: string
    subitems: TocItem[] | null
}

interface Built {
    sections: {
        id: number
        load: () => string
        createDocument: () => Document
        size: number
    }[]
    toc: TocItem[]
    /** anchor id -> the section it ended up in, for an internal link */
    anchors: Map<string, number>
    revoke: () => void
}

function build(blocks: Block[], lang: string | null): Built {
    /* Group first, so a section boundary is always a block boundary and —
       wherever the book gives the chance — a chapter boundary too. */
    const groups: Block[][] = []
    let cur: Block[] = []
    let size = 0
    for (const b of blocks) {
        const chapter = !!b.level && b.level <= 2 && size >= SECTION_MIN
        if (cur.length && (chapter || size + b.html.length > SECTION_TARGET)) {
            groups.push(cur)
            cur = []
            size = 0
        }
        cur.push(b)
        size += b.html.length
    }
    if (cur.length) groups.push(cur)
    if (!groups.length) groups.push([{ html: '<p></p>' }])

    const urls: string[] = []
    const toc: TocItem[] = []
    const anchors = new Map<string, number>()

    const sections = groups.map((group, index) => {
        const str = page(group.map(b => b.html).join('\n'), lang)
        const blob = new Blob([str], { type: 'text/html' })
        const url = URL.createObjectURL(blob)
        urls.push(url)

        /* One TOC entry per heading, nested one deep: a heading at the top
           level of its own section is an entry, and headings under it are its
           subitems. Deeper than that is an outline, not a table of contents,
           and a reader looking for chapter nine has to scroll past it. */
        const heads = group.filter(b => b.id && b.title)
        const top = heads.length ? Math.min(...heads.map(b => b.level ?? 6)) : 6
        for (const h of heads) {
            anchors.set(h.id!, index)
            const item: TocItem = { label: h.title!, href: `${index}#${h.id}`, subitems: null }
            const parent = toc[toc.length - 1]
            if ((h.level ?? 6) === top || !parent) toc.push(item)
            else parent.subitems = [...(parent.subitems ?? []), item]
        }
        for (const b of group) if (b.id) anchors.set(b.id, index)

        return {
            id: index,
            load: () => url,
            createDocument: () => new DOMParser().parseFromString(str, 'text/html'),
            size: blob.size,
        }
    })
    return { sections, toc, anchors, revoke: () => urls.forEach(u => URL.revokeObjectURL(u)) }
}

/* ── the book ──────────────────────────────────────────────────────────── */

export interface TextBookMeta {
    title?: string
    author?: string
    language?: string
}

/** A foliate book for a file that carries only text. The metadata argument is
    what the importer already read out of the head of the file — passing it in
    rather than re-deriving it keeps one answer for the shelf and the reader. */
export async function makeTextBook(file: Blob, format: TextFormat, meta: TextBookMeta = {}) {
    const text = await decode(file)
    const blocks = format === 'html' ? htmlBlocks(text)
        : format === 'markdown' ? mdBlocks(text)
            : txtBlocks(text)
    const lang = meta.language ?? null
    const { sections, toc, anchors, revoke } = build(blocks, lang)

    return {
        metadata: {
            title: meta.title,
            author: meta.author ? [{ name: meta.author }] : [],
            language: meta.language,
        },
        /* No generated covers — the guardrail. A text file has no cover, and
           inventing one is worse than the shelf's own typographic card. */
        getCover: () => null,
        sections,
        toc,
        resolveHref(href: string) {
            const [a, b] = href.split('#')
            const index = a !== '' ? Number(a) : (b ? anchors.get(b) ?? 0 : 0)
            return {
                index: Number.isFinite(index) ? index : 0,
                anchor: b ? (doc: Document) => doc.getElementById(b) : () => 0,
            }
        },
        splitTOCHref(href: string) {
            const [a, b] = href?.split('#') ?? []
            return [Number(a), b]
        },
        getTOCFragment(doc: Document, id: string) {
            return doc.getElementById(id)
        },
        isExternal: (uri: string) => /^\w+:/i.test(uri),
        destroy: revoke,
    }
}
