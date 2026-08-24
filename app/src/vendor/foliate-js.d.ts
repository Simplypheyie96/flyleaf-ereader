/* Hand-written declarations for the vendored foliate-js.
   ─────────────────────────────────────────────────────
   Upstream is plain JavaScript with no typings of its own and no npm package we
   trust (see vendor/foliate-js/PATCHES.md), so this file is the contract. It is
   deliberately NOT a full transcription of the library: it declares the surface
   this app actually calls, and nothing else. An unused method left undeclared
   is a compile error the day someone reaches for it — which is the moment to
   read the source and declare it properly, rather than the moment to discover a
   guess was wrong at runtime.

   `tsconfig.json` excludes `src/vendor/foliate-js` from checking, so these are
   wildcard ambient declarations: TypeScript resolves `./vendor/foliate-js/view.js`
   to nothing (allowJs is off) and falls through to the pattern below. The
   patterns end in `.js` because that is how the modules are imported — the real
   files, unchanged, the way the browser loads them. */

/** A resolved position. Every navigation target accepted by the library is one
    of these: a CFI string, an href, a section index, or a fraction. */
type FoliateTarget = string | number

interface FoliateTOCItem {
  label: string
  href?: string
  subitems?: FoliateTOCItem[] | null
}

interface FoliateSection {
  id?: unknown
  /** 'no' marks a section outside the linear reading order — front-matter a
      reader should reach from the TOC but not by turning pages into it. */
  linear?: string
  size?: number
  load?: () => Promise<string> | string
  unload?: () => void
  createDocument?: () => Promise<Document>
  mediaOverlay?: unknown
}

interface FoliateBook {
  metadata?: Record<string, unknown> & { language?: string | string[] }
  /** The parser's own content hook (`Loader.eventTarget` in epub.js, `KF8`'s
      and `MOBI`'s field of the same name). It dispatches `load` per manifest
      item — `{ type, isScript, allow }`, where `allow = false` refuses the
      resource — and `data` with a resource's bytes before its blob URL is
      made. reader/harden.ts is the only caller; the paginator uses `data`
      itself to rewrite CSS. Absent on books built by reader/textBook.ts. */
  transformTarget?: EventTarget
  sections: FoliateSection[]
  toc?: FoliateTOCItem[] | null
  pageList?: FoliateTOCItem[] | null
  dir?: string
  rendition?: { layout?: string }
  landmarks?: { type: string[]; href: string }[]
  splitTOCHref?: (href: string) => unknown[]
  getTOCFragment?: (doc: Document, id: string) => Element | null
  getCover?: () => Promise<Blob | null>
  destroy?: () => void
}

/** The shape emitted by `relocate` and held in `view.lastLocation`.
    `fraction` is progress through the whole book, `section` the position in the
    spine, `location` the synthetic page count foliate derives from character
    counts. Note what is NOT here: a page number for the book. There isn't one
    for a reflowable book, and the project forbids inventing it. */
interface FoliateLocation {
  cfi?: string
  range?: Range
  fraction?: number
  section?: { current: number; total: number }
  location?: { current: number; next: number; total: number }
  time?: { section: number; total: number }
  tocItem?: FoliateTOCItem | null
  pageItem?: FoliateTOCItem | null
}

/** The renderer. `foliate-paginator` for reflowable books, `foliate-fxl` for
    pre-paginated ones; `view.renderer` is whichever one the book called for.
    Configured by attribute, not by property — `flow`, `gap`, `margin`,
    `max-inline-size`, `max-block-size`, `max-column-count` — which is why the
    type extends HTMLElement rather than hiding it. */
interface FoliateRenderer extends HTMLElement {
  readonly scrolled: boolean
  /** The spine, assigned straight across from the book on render
      (paginator.js:656). Public, and read by reader/scrollCross.ts to find the
      next section that is actually in the reading order. */
  readonly sections?: FoliateSection[]
  /** The element a page turn transforms — the laid-out column strip inside the
      scroll port. Added by local patch (PATCHES.md 4a), because the paginator's
      shadow root is closed. Optional because `foliate-fxl` has no such element:
      a fixed-layout book is one page per section and never gets a tracked turn. */
  readonly contentLayer?: HTMLElement | null
  readonly size: number
  readonly viewSize: number
  readonly start: number
  readonly end: number
  readonly page: number
  readonly pages: number
  readonly atStart: boolean
  readonly atEnd: boolean
  next(distance?: number): Promise<void>
  prev(distance?: number): Promise<void>
  goTo(target: unknown): Promise<void>
  goToFraction(fraction: number): Promise<void>
  scrollBy(dx: number, dy: number): void
  snap(vx: number, vy: number): void
  scrollToAnchor(anchor: unknown, select?: boolean): Promise<void>
  getContents(): { index: number; doc: Document; overlayer?: unknown }[]
  /** A string, or a `[beforeStyle, style]` pair. The pair exists so the app's
      own rules can be split around the book's: `before` loses to the
      publisher's CSS, `style` wins over it. The type controls need both. */
  setStyles(styles: string | [string, string]): void
  focusView(): void
  destroy(): void
}

declare module '*/foliate-js/view.js' {
  /** A fetch that came back non-OK. */
  export class ResponseError extends Error {}
  /** An empty file, or a path that isn't there. */
  export class NotFoundError extends Error {}
  /** The one this app cares about: a format we do not read. Thrown for CBZ and
      for PDF by local patch (PATCHES.md 1 and 2), and by upstream for anything
      that matches no sniffer at all. The import path turns it into the plain
      refusal the project promises, never a silent failure. */
  export class UnsupportedTypeError extends Error {}

  export function makeBook(file: File | Blob | string): Promise<FoliateBook>

  export class View extends HTMLElement {
    book: FoliateBook
    renderer: FoliateRenderer
    isFixedLayout: boolean
    lastLocation: FoliateLocation | null
    history: {
      readonly canGoBack: boolean
      readonly canGoForward: boolean
      back(): void
      forward(): void
      clear(): void
      addEventListener(type: string, listener: EventListener): void
    }
    open(book: FoliateBook | File | Blob | string): Promise<void>
    close(): void
    init(opts: { lastLocation?: FoliateTarget | null; showTextStart?: boolean }): Promise<void>
    goTo(target: FoliateTarget): Promise<void>
    goToFraction(fraction: number): Promise<void>
    goToTextStart(): Promise<void>
    next(distance?: number): Promise<void>
    prev(distance?: number): Promise<void>
    goLeft(): Promise<void> | undefined
    goRight(): Promise<void> | undefined
    select(target: FoliateTarget): Promise<void>
    deselect(): void
    getCFI(index: number, range: Range): string
    resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => unknown }
    resolveNavigation(target: FoliateTarget): unknown
    getSectionFractions(): number[]
    getProgressOf(index: number, range?: Range): unknown
    getTOCItemOf(target: FoliateTarget): Promise<FoliateTOCItem | null | undefined>
    addAnnotation(annotation: { value: string }, remove?: boolean): Promise<{ index: number; label: string } | undefined>
    deleteAnnotation(annotation: { value: string }): Promise<unknown>
    showAnnotation(annotation: { value: string }): Promise<void>
    search(opts: { scope?: string; query: string; index?: number } & Record<string, unknown>): AsyncGenerator<unknown>
    clearSearch(): void
  }
}

/* Imported for its side effect only — it defines `foliate-paginator`. `view.js`
   imports it dynamically when the book is reflowable, so the app does not
   normally need this; it is declared because the reading page imports it
   eagerly on the reader route, to keep the first turn off the critical path. */
declare module '*/foliate-js/paginator.js' {
  export class Paginator extends HTMLElement {}
}

/* CFIs, because a CFI is the project's position format and comparing two of
   them is not string comparison. `collapse` is what turns a range CFI from a
   highlight back into a single point. */
declare module '*/foliate-js/epubcfi.js' {
  export const isCFI: RegExp
  /** Negative, zero or positive, like any comparator — this is how the marks
      list sorts highlights into reading order rather than creation order. */
  export function compare(a: string, b: string): number
  export function collapse(cfi: string, toEnd?: boolean): string
  export function parse(cfi: string): unknown
  export function fromRange(range: Range, filter?: unknown): string
  export function toRange(doc: Document, parts: unknown, filter?: unknown): Range
}

/* Overlayer draws over the text without touching it — the highlight layer is a
   sibling of the page, not a wrapper around its words. The statics are the draw
   functions themselves, passed by reference to `addAnnotation`, which is why
   they are typed as callables and not as tokens. */
declare module '*/foliate-js/overlayer.js' {
  type FoliateDraw = (rects: DOMRect[], options?: Record<string, unknown>) => Element
  export class Overlayer {
    static highlight: FoliateDraw
    static underline: FoliateDraw
    static squiggly: FoliateDraw
    static strikethrough: FoliateDraw
    static outline: FoliateDraw
    constructor()
    readonly element: Element
    add(key: unknown, range: Range | (() => Range), draw: FoliateDraw, options?: Record<string, unknown>): void
    remove(key: unknown): void
    redraw(): void
    hitTest(point: { x: number; y: number }): unknown[]
  }
}
