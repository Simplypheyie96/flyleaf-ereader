const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const debounce = (f, wait, immediate) => {
    let timeout
    return (...args) => {
        const later = () => {
            timeout = null
            if (!immediate) f(...args)
        }
        const callNow = immediate && !timeout
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(later, wait)
        if (callNow) f(...args)
    }
}

const lerp = (min, max, x) => x * (max - min) + min
const easeOutQuad = x => 1 - (1 - x) * (1 - x)
const animate = (a, b, duration, ease, render) => new Promise(resolve => {
    let start
    const step = now => {
        if (document.hidden) {
            render(lerp(a, b, 1))
            return resolve()
        }
        start ??= now
        const fraction = Math.min(1, (now - start) / duration)
        render(lerp(a, b, ease(fraction)))
        if (fraction < 1) requestAnimationFrame(step)
        else resolve()
    }
    if (document.hidden) {
        render(lerp(a, b, 1))
        return resolve()
    }
    requestAnimationFrame(step)
})

// collapsed range doesn't return client rects sometimes (or always?)
// try make get a non-collapsed range or element
const uncollapse = range => {
    if (!range?.collapsed) return range
    const { endOffset, endContainer } = range
    if (endContainer.nodeType === 1) {
        const node = endContainer.childNodes[endOffset]
        if (node?.nodeType === 1) return node
        return endContainer
    }
    if (endOffset + 1 < endContainer.length) range.setEnd(endContainer, endOffset + 1)
    else if (endOffset > 1) range.setStart(endContainer, endOffset - 1)
    else return endContainer.parentNode
    return range
}

const makeRange = (doc, node, start, end = start) => {
    const range = doc.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    return range
}

// use binary search to find an offset value in a text node
const bisectNode = (doc, node, cb, start = 0, end = node.nodeValue.length) => {
    if (end - start === 1) {
        const result = cb(makeRange(doc, node, start), makeRange(doc, node, end))
        return result < 0 ? start : end
    }
    const mid = Math.floor(start + (end - start) / 2)
    const result = cb(makeRange(doc, node, start, mid), makeRange(doc, node, mid, end))
    return result < 0 ? bisectNode(doc, node, cb, start, mid)
        : result > 0 ? bisectNode(doc, node, cb, mid, end) : mid
}

const { SHOW_ELEMENT, SHOW_TEXT, SHOW_CDATA_SECTION,
    FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP } = NodeFilter

const filter = SHOW_ELEMENT | SHOW_TEXT | SHOW_CDATA_SECTION

// needed cause there seems to be a bug in `getBoundingClientRect()` in Firefox
// where it fails to include rects that have zero width and non-zero height
// (CSSOM spec says "rectangles [...] of which the height or width is not zero")
// which makes the visible range include an extra space at column boundaries
const getBoundingClientRect = target => {
    let top = Infinity, right = -Infinity, left = Infinity, bottom = -Infinity
    for (const rect of target.getClientRects()) {
        left = Math.min(left, rect.left)
        top = Math.min(top, rect.top)
        right = Math.max(right, rect.right)
        bottom = Math.max(bottom, rect.bottom)
    }
    return new DOMRect(left, top, right - left, bottom - top)
}

const getVisibleRange = (doc, start, end, mapRect) => {
    // first get all visible nodes
    const acceptNode = node => {
        const name = node.localName?.toLowerCase()
        // ignore all scripts, styles, and their children
        if (name === 'script' || name === 'style') return FILTER_REJECT
        if (node.nodeType === 1) {
            const { left, right } = mapRect(node.getBoundingClientRect())
            // no need to check child nodes if it's completely out of view
            if (right < start || left > end) return FILTER_REJECT
            // elements must be completely in view to be considered visible
            // because you can't specify offsets for elements
            if (left >= start && right <= end) return FILTER_ACCEPT
            // TODO: it should probably allow elements that do not contain text
            // because they can exceed the whole viewport in both directions
            // especially in scrolled mode
        } else {
            // ignore empty text nodes
            if (!node.nodeValue?.trim()) return FILTER_SKIP
            // create range to get rect
            const range = doc.createRange()
            range.selectNodeContents(node)
            const { left, right } = mapRect(range.getBoundingClientRect())
            // it's visible if any part of it is in view
            if (right >= start && left <= end) return FILTER_ACCEPT
        }
        return FILTER_SKIP
    }
    const walker = doc.createTreeWalker(doc.body, filter, { acceptNode })
    const nodes = []
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        nodes.push(node)

    // we're only interested in the first and last visible nodes
    const from = nodes[0] ?? doc.body
    const to = nodes[nodes.length - 1] ?? from

    // find the offset at which visibility changes
    const startOffset = from.nodeType === 1 ? 0
        : bisectNode(doc, from, (a, b) => {
            const p = mapRect(getBoundingClientRect(a))
            const q = mapRect(getBoundingClientRect(b))
            if (p.right < start && q.left > start) return 0
            return q.left > start ? -1 : 1
        })
    const endOffset = to.nodeType === 1 ? 0
        : bisectNode(doc, to, (a, b) => {
            const p = mapRect(getBoundingClientRect(a))
            const q = mapRect(getBoundingClientRect(b))
            if (p.right < end && q.left > end) return 0
            return q.left > end ? -1 : 1
        })

    const range = doc.createRange()
    range.setStart(from, startOffset)
    range.setEnd(to, endOffset)
    return range
}

const selectionIsBackward = sel => {
    const range = document.createRange()
    range.setStart(sel.anchorNode, sel.anchorOffset)
    range.setEnd(sel.focusNode, sel.focusOffset)
    return range.collapsed
}

const setSelectionTo = (target, collapse) => {
    let range
    if (target.startContainer) range = target.cloneRange()
    else if (target.nodeType) {
        range = document.createRange()
        range.selectNode(target)
    }
    if (range) {
        const sel = range.startContainer.ownerDocument.defaultView.getSelection()
        if (sel) {
            sel.removeAllRanges()
            if (collapse === -1) range.collapse(true)
            else if (collapse === 1) range.collapse()
            sel.addRange(range)
        }
    }
}

const getDirection = doc => {
    const { defaultView } = doc
    const { writingMode, direction } = defaultView.getComputedStyle(doc.body)
    const vertical = writingMode === 'vertical-rl'
        || writingMode === 'vertical-lr'
    const rtl = doc.body.dir === 'rtl'
        || direction === 'rtl'
        || doc.documentElement.dir === 'rtl'
    return { vertical, rtl }
}

const getBackground = doc => {
    const bodyStyle = doc.defaultView.getComputedStyle(doc.body)
    return bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
        && bodyStyle.backgroundImage === 'none'
        ? doc.defaultView.getComputedStyle(doc.documentElement).background
        : bodyStyle.background
}

const makeMarginals = (length, part) => Array.from({ length }, () => {
    const div = document.createElement('div')
    const child = document.createElement('div')
    div.append(child)
    child.setAttribute('part', part)
    return div
})

const setStylesImportant = (el, styles) => {
    const { style } = el
    for (const [k, v] of Object.entries(styles)) style.setProperty(k, v, 'important')
}

class View {
    #observer = new ResizeObserver(() => this.expand())
    #element = document.createElement('div')
    #iframe = document.createElement('iframe')
    #contentRange = document.createRange()
    #overlayer
    #vertical = false
    #rtl = false
    #column = true
    #size
    #layout = {}
    constructor({ container, onExpand }) {
        this.container = container
        this.onExpand = onExpand
        this.#iframe.setAttribute('part', 'filter')
        this.#element.append(this.#iframe)
        Object.assign(this.#element.style, {
            boxSizing: 'content-box',
            position: 'relative',
            overflow: 'hidden',
            flex: '0 0 auto',
            width: '100%', height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
        })
        Object.assign(this.#iframe.style, {
            overflow: 'hidden',
            border: '0',
            display: 'none',
            width: '100%', height: '100%',
        })
        // `allow-scripts` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        this.#iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        this.#iframe.setAttribute('scrolling', 'no')
    }
    get element() {
        return this.#element
    }
    get document() {
        return this.#iframe.contentDocument
    }
    async load(src, afterLoad, beforeRender) {
        if (typeof src !== 'string') throw new Error(`${src} is not string`)
        return new Promise(resolve => {
            this.#iframe.addEventListener('load', () => {
                const doc = this.document
                afterLoad?.(doc)

                // it needs to be visible for Firefox to get computed style
                this.#iframe.style.display = 'block'
                const { vertical, rtl } = getDirection(doc)
                const background = getBackground(doc)
                this.#iframe.style.display = 'none'

                this.#vertical = vertical
                this.#rtl = rtl

                this.#contentRange.selectNodeContents(doc.body)
                const layout = beforeRender?.({ vertical, rtl, background })
                this.#iframe.style.display = 'block'
                this.render(layout)
                this.#observer.observe(doc.body)

                // the resize observer above doesn't work in Firefox
                // (see https://bugzilla.mozilla.org/show_bug.cgi?id=1832939)
                // until the bug is fixed we can at least account for font load
                doc.fonts.ready.then(() => this.expand())

                resolve()
            }, { once: true })
            this.#iframe.src = src
        })
    }
    render(layout) {
        if (!layout) return
        // FLYLEAF PATCH 5 — do not lay out a document that has no body yet.
        // The Paginator's ResizeObserver can fire while the iframe is between
        // documents: `documentElement` exists from the first byte, but `body`
        // is null until the parser reaches the body start tag, and columnize()
        // hands both straight to setStylesImportant. The load handler calls
        // render() again with the same layout, so skipping is lossless.
        if (!this.document?.body) return
        this.#column = layout.flow !== 'scrolled'
        this.#layout = layout
        if (this.#column) this.columnize(layout)
        else this.scrolled(layout)
    }
    scrolled({ gap, columnWidth }) {
        const vertical = this.#vertical
        const doc = this.document
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'padding': vertical ? `${gap}px 0` : `0 ${gap}px`,
            'column-width': 'auto',
            'height': 'auto',
            'width': 'auto',
        })
        setStylesImportant(doc.body, {
            [vertical ? 'max-height' : 'max-width']: `${columnWidth}px`,
            'margin': 'auto',
        })
        this.setImageSize()
        this.expand()
    }
    columnize({ width, height, gap, columnWidth }) {
        const vertical = this.#vertical
        this.#size = vertical ? height : width

        const doc = this.document
        setStylesImportant(doc.documentElement, {
            'box-sizing': 'border-box',
            'column-width': `${Math.trunc(columnWidth)}px`,
            'column-gap': `${gap}px`,
            'column-fill': 'auto',
            ...(vertical
                ? { 'width': `${width}px` }
                : { 'height': `${height}px` }),
            'padding': vertical ? `${gap / 2}px 0` : `0 ${gap / 2}px`,
            'overflow': 'hidden',
            // force wrap long words
            'overflow-wrap': 'break-word',
            // reset some potentially problematic props
            'position': 'static', 'border': '0', 'margin': '0',
            'max-height': 'none', 'max-width': 'none',
            'min-height': 'none', 'min-width': 'none',
            // fix glyph clipping in WebKit
            '-webkit-line-box-contain': 'block glyphs replaced',
        })
        setStylesImportant(doc.body, {
            'max-height': 'none',
            'max-width': 'none',
            'margin': '0',
        })
        this.setImageSize()
        this.expand()
    }
    setImageSize() {
        const { width, height, margin } = this.#layout
        const vertical = this.#vertical
        const doc = this.document
        /* FLYLEAF PATCH 8. In scrolled flow the section iframe is sized to its
           own content, so `height` here is the content height, not the
           viewport. Capping an image to it is a feedback loop: a short frame
           caps the image, the smaller image shortens the frame again. A full
           page cover or map settles into a squat strip -- and, with a
           `preserveAspectRatio="none"` wrapper, a stretched one -- and the
           section ends up shorter than the viewport, so it does not scroll.
           Scrolled flow has no page to fit an image into: the cross-axis cap
           belongs to the app's stylesheet, which knows the real viewport. */
        const columnBound = this.#column
        for (const el of doc.body.querySelectorAll('img, svg, video')) {
            // preserve max size if they are already set
            const { maxHeight, maxWidth } = doc.defaultView.getComputedStyle(el)
            setStylesImportant(el, {
                'max-height': vertical
                    ? (maxHeight !== 'none' && maxHeight !== '0px' ? maxHeight : '100%')
                    : columnBound ? `${height - margin * 2}px` : '',
                'max-width': vertical
                    ? `${width - margin * 2}px`
                    : (maxWidth !== 'none' && maxWidth !== '0px' ? maxWidth : '100%'),
                'object-fit': 'contain',
                'page-break-inside': 'avoid',
                'break-inside': 'avoid',
                'box-sizing': 'border-box',
            })
        }
    }
    expand() {
        const { documentElement } = this.document
        if (this.#column) {
            const side = this.#vertical ? 'height' : 'width'
            const otherSide = this.#vertical ? 'width' : 'height'
            const contentRect = this.#contentRange.getBoundingClientRect()
            const rootRect = documentElement.getBoundingClientRect()
            // offset caused by column break at the start of the page
            // which seem to be supported only by WebKit and only for horizontal writing
            const contentStart = this.#vertical ? 0
                : this.#rtl ? rootRect.right - contentRect.right : contentRect.left - rootRect.left
            const contentSize = contentStart + contentRect[side]
            const pageCount = Math.ceil(contentSize / this.#size)
            const expandedSize = pageCount * this.#size
            this.#element.style.padding = '0'
            this.#iframe.style[side] = `${expandedSize}px`
            this.#element.style[side] = `${expandedSize + this.#size * 2}px`
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            documentElement.style[side] = `${this.#size}px`
            if (this.#overlayer) {
                this.#overlayer.element.style.margin = '0'
                this.#overlayer.element.style.left = this.#vertical ? '0' : `${this.#size}px`
                this.#overlayer.element.style.top = this.#vertical ? `${this.#size}px` : '0'
                this.#overlayer.element.style[side] = `${expandedSize}px`
                this.#overlayer.redraw()
            }
        } else {
            const side = this.#vertical ? 'width' : 'height'
            const otherSide = this.#vertical ? 'height' : 'width'
            const contentSize = documentElement.getBoundingClientRect()[side]
            const expandedSize = contentSize
            const { margin } = this.#layout
            const padding = this.#vertical ? `0 ${margin}px` : `${margin}px 0`
            this.#element.style.padding = padding
            this.#iframe.style[side] = `${expandedSize}px`
            this.#element.style[side] = `${expandedSize}px`
            this.#iframe.style[otherSide] = '100%'
            this.#element.style[otherSide] = '100%'
            if (this.#overlayer) {
                this.#overlayer.element.style.margin = padding
                this.#overlayer.element.style.left = '0'
                this.#overlayer.element.style.top = '0'
                this.#overlayer.element.style[side] = `${expandedSize}px`
                this.#overlayer.redraw()
            }
        }
        this.onExpand()
    }
    set overlayer(overlayer) {
        this.#overlayer = overlayer
        this.#element.append(overlayer.element)
    }
    get overlayer() {
        return this.#overlayer
    }
    destroy() {
        // FLYLEAF PATCH 5 — same null body, same reason.
        if (this.document?.body) this.#observer.unobserve(this.document.body)
    }
}

// NOTE: everything here assumes the so-called "negative scroll type" for RTL
export class Paginator extends HTMLElement {
    static observedAttributes = [
        'flow', 'gap', 'margin',
        'max-inline-size', 'max-block-size', 'max-column-count',
    ]
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(() => this.render())
    #top
    #background
    #container
    #header
    #footer
    #view
    #vertical = false
    #rtl = false
    #margin = 0
    /* FLYLEAF PATCH 6 — scrolled flow is a continuous column.
       Upstream keeps exactly ONE view: #createView destroys the old iframe
       before appending the new one, so a chapter boundary in scrolled mode is
       necessarily a discrete jump — there is nothing below the end of the
       section because no other section exists in the DOM. Kindle and Apple
       Books both present one column: the chapter ends, whitespace, the next
       chapter's heading, no event. To do that, scrolled mode holds a WINDOW
       of loaded views stacked in #container, ascending by index.
       Paginated mode is untouched and still holds exactly one.
       See PATCHES.md § 6. */
    #views = []
    /* FLYLEAF PATCH 11. One slot element per section, created when the book
       opens, in spine order, each standing at an estimated height until its
       section is loaded into it. See the note on #buildSlots. */
    #slots = []
    /* True only while #display is building the view it was asked to jump to.
       A view the reader simply scrolled into must never re-anchor: measured on
       the cover of The Incandescent, a freshly loaded section 0 anchored on
       every expand and pinned the top of the book at 129, 274, 208, 116, 370
       against a steady upward scroll. */
    #displaying = false
    #loadingIndex = new Set()
    #index = -1
    #anchor = 0 // anchor view to a fraction (0-1), Range, or Element
    #justAnchored = false
    #locked = false // while true, prevent any further navigation
    #styles
    #styleMap = new WeakMap()
    #mediaQuery = matchMedia('(prefers-color-scheme: dark)')
    #mediaQueryListener
    #scrollBounds
    #touchState
    #touchScrolled
    #lastVisibleRange
    constructor() {
        super()
        this.#root.innerHTML = `<style>
        :host {
            display: block;
            container-type: size;
        }
        :host, #top {
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }
        #top {
            --_gap: 7%;
            --_margin: 48px;
            --_max-inline-size: 720px;
            --_max-block-size: 1440px;
            --_max-column-count: 2;
            --_max-column-count-portrait: 1;
            --_max-column-count-spread: var(--_max-column-count);
            --_half-gap: calc(var(--_gap) / 2);
            --_max-width: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            --_max-height: var(--_max-block-size);
            display: grid;
            grid-template-columns:
                minmax(var(--_half-gap), 1fr)
                var(--_half-gap)
                minmax(0, calc(var(--_max-width) - var(--_gap)))
                var(--_half-gap)
                minmax(var(--_half-gap), 1fr);
            grid-template-rows:
                minmax(var(--_margin), 1fr)
                minmax(0, var(--_max-height))
                minmax(var(--_margin), 1fr);
            &.vertical {
                --_max-column-count-spread: var(--_max-column-count-portrait);
                --_max-width: var(--_max-block-size);
                --_max-height: calc(var(--_max-inline-size) * var(--_max-column-count-spread));
            }
            @container (orientation: portrait) {
                & {
                    --_max-column-count-spread: var(--_max-column-count-portrait);
                }
                &.vertical {
                    --_max-column-count-spread: var(--_max-column-count);
                }
            }
        }
        #background {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
        }
        #container {
            grid-column: 2 / 5;
            grid-row: 2;
            overflow: hidden;
        }
        :host([flow="scrolled"]) #container {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
            overflow: auto;
        }
        #header {
            grid-column: 3 / 4;
            grid-row: 1;
        }
        #footer {
            grid-column: 3 / 4;
            grid-row: 3;
            align-self: end;
        }
        #header, #footer {
            display: grid;
            height: var(--_margin);
        }
        :is(#header, #footer) > * {
            display: flex;
            align-items: center;
            min-width: 0;
        }
        :is(#header, #footer) > * > * {
            width: 100%;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            text-align: center;
            font-size: .75em;
            opacity: .6;
        }
        </style>
        <div id="top">
            <div id="background" part="filter"></div>
            <div id="header"></div>
            <div id="container"></div>
            <div id="footer"></div>
        </div>
        `

        this.#top = this.#root.getElementById('top')
        this.#background = this.#root.getElementById('background')
        this.#container = this.#root.getElementById('container')
        this.#header = this.#root.getElementById('header')
        this.#footer = this.#root.getElementById('footer')

        this.#observer.observe(this.#container)
        this.#container.addEventListener('scroll', () => this.dispatchEvent(new Event('scroll')))
        /* PATCH 6. Cheap and unthrottled, because it has to be right at the
           moment the reader crosses: three offsetTop reads and one arithmetic
           comparison, no layout writes. The expensive half — relocate, which
           derives a CFI — stays on the 250ms debounce below. */
        this.#container.addEventListener('scroll', () => {
            if (!this.scrolled) return
            this.#syncCurrent()
            this.#trimWindow()
            void this.#fillVisible()
        }, { passive: true })
        this.#container.addEventListener('scroll', debounce(() => {
            if (this.scrolled) {
                if (this.#justAnchored) this.#justAnchored = false
                else this.#afterScroll('scroll')
            }
        }, 250))

        const opts = { passive: false }
        this.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
        this.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
        this.addEventListener('touchend', this.#onTouchEnd.bind(this))
        this.addEventListener('load', ({ detail: { doc } }) => {
            doc.addEventListener('touchstart', this.#onTouchStart.bind(this), opts)
            doc.addEventListener('touchmove', this.#onTouchMove.bind(this), opts)
            doc.addEventListener('touchend', this.#onTouchEnd.bind(this))
        })

        this.addEventListener('relocate', ({ detail }) => {
            if (detail.reason === 'selection') setSelectionTo(this.#anchor, 0)
            else if (detail.reason === 'navigation') {
                if (this.#anchor === 1) setSelectionTo(detail.range, 1)
                else if (typeof this.#anchor === 'number')
                    setSelectionTo(detail.range, -1)
                else setSelectionTo(this.#anchor, -1)
            }
        })
        const checkPointerSelection = debounce((range, sel) => {
            if (!sel.rangeCount) return
            const selRange = sel.getRangeAt(0)
            const backward = selectionIsBackward(sel)
            if (backward && selRange.compareBoundaryPoints(Range.START_TO_START, range) < 0)
                this.prev()
            else if (!backward && selRange.compareBoundaryPoints(Range.END_TO_END, range) > 0)
                this.next()
        }, 700)
        this.addEventListener('load', ({ detail: { doc } }) => {
            let isPointerSelecting = false
            doc.addEventListener('pointerdown', () => isPointerSelecting = true)
            doc.addEventListener('pointerup', () => isPointerSelecting = false)
            let isKeyboardSelecting = false
            doc.addEventListener('keydown', () => isKeyboardSelecting = true)
            doc.addEventListener('keyup', () => isKeyboardSelecting = false)
            doc.addEventListener('selectionchange', () => {
                if (this.scrolled) return
                const range = this.#lastVisibleRange
                if (!range) return
                const sel = doc.getSelection()
                if (!sel.rangeCount) return
                if (isPointerSelecting && sel.type === 'Range')
                    checkPointerSelection(range, sel)
                else if (isKeyboardSelecting) {
                    const selRange = sel.getRangeAt(0).cloneRange()
                    const backward = selectionIsBackward(sel)
                    if (!backward) selRange.collapse()
                    this.#scrollToAnchor(selRange)
                }
            })
            doc.addEventListener('focusin', e => this.scrolled ? null :
                // NOTE: `requestAnimationFrame` is needed in WebKit
                requestAnimationFrame(() => this.#scrollToAnchor(e.target)))
        })

        this.#mediaQueryListener = () => {
            if (!this.#view) return
            this.#background.style.background = getBackground(this.#view.document)
        }
        this.#mediaQuery.addEventListener('change', this.#mediaQueryListener)
    }
    attributeChangedCallback(name, _, value) {
        switch (name) {
            case 'flow':
                /* FLYLEAF PATCH 11. The paginator boots paginated and the app
                   switches it afterwards, so the slot column cannot be built
                   from #createView alone -- by the time flow says scrolled the
                   one view is already a direct child of the container and
                   nothing asks for a slot again. Measured: the container held
                   one child instead of fifty-three, scrollHeight 1060 against a
                   986px viewport, so the whole book had 74px of travel in it.
                   Crossing into scrolled flow rebuilds the column and puts the
                   reader back where they were. */
                if (this.scrolled && this.sections?.length
                    && this.#slots.length !== this.sections.length) {
                    const index = this.#index
                    const anchor = this.#anchor
                    this.#buildSlots()
                    if (index >= 0) void this.#display(
                        Promise.resolve({ index, src: true, anchor }))
                    break
                }
                this.render()
                break
            case 'gap':
            case 'margin':
            case 'max-block-size':
            case 'max-column-count':
                this.#top.style.setProperty('--_' + name, value)
                break
            case 'max-inline-size':
                // needs explicit `render()` as it doesn't necessarily resize
                this.#top.style.setProperty('--_' + name, value)
                this.render()
                break
        }
    }
    open(book) {
        this.bookDir = book.dir
        this.sections = book.sections
        /* PATCH 11. A different book is a different column. */
        this.#slots = []
        book.transformTarget?.addEventListener('data', ({ detail }) => {
            if (detail.type !== 'text/css') return
            const w = innerWidth
            const h = innerHeight
            detail.data = Promise.resolve(detail.data).then(data => data
                // unprefix as most of the props are (only) supported unprefixed
                .replace(/(?<=[{\s;])-epub-/gi, '')
                // replace vw and vh as they cause problems with layout
                .replace(/(\d*\.?\d+)vw/gi, (_, d) => parseFloat(d) * w / 100 + 'px')
                .replace(/(\d*\.?\d+)vh/gi, (_, d) => parseFloat(d) * h / 100 + 'px')
                // `page-break-*` unsupported in columns; replace with `column-break-*`
                .replace(/page-break-(after|before|inside)\s*:/gi, (_, x) =>
                    `-webkit-column-break-${x}:`)
                .replace(/break-(after|before|inside)\s*:\s*(avoid-)?page/gi, (_, x, y) =>
                    `break-${x}: ${y ?? ''}column`))
        })
    }
    /* PATCH 6. Paginated is upstream's behaviour verbatim: destroy, replace.
       Scrolled inserts into the window in index order and destroys nothing. */
    #createView(index = this.#index) {
        if (!this.scrolled) {
            /* PATCH 11. Back to paginated: the slot column is scrolled flow's
               geometry and has no business under a paged view. */
            if (this.#slots.length) {
                this.#slots = []
                this.#clearViews()
                this.#container.replaceChildren()
            }
            this.#clearViews()
            const view = new View({
                container: this,
                onExpand: () => this.#scrollToAnchor(this.#anchor),
            })
            this.#views.push({ index, view })
            this.#container.append(view.element)
            this.#view = view
            return view
        }
        const entry = { index, view: null, anchoring: this.#displaying }
        entry.view = new View({
            container: this,
            onExpand: () => {
                /* Only the section the reader is actually in re-anchors. A
                   neighbour finishing its layout must not yank the column.
                   Compensation for a section growing above the reader is not
                   done here any more — it is the slot observer's job, which
                   sees the real pixel delta. See #buildSlots. */
                /* Nothing. In scrolled flow scrollTop IS the reader's position,
               so a section finishing its layout has nothing to say about it.
               Every re-anchor here was a write fighting the reader's thumb. */
            },
        })
        let at = this.#views.findIndex(v => v.index > index)
        if (at < 0) at = this.#views.length
        this.#views.splice(at, 0, entry)
        this.#slotFor(index).append(entry.view.element)
        return entry.view
    }
    /** FLYLEAF PATCH 11 — the column has a shape before it has content.

        PATCH 6 built scrolled flow as a sliding window: a few sections
        resident, more stitched in above and below as the reader moved. That
        is the design the shaking came from, and it could not be tuned out of
        it. Inserting a section ABOVE the reading line changes the offset of
        everything below it, so the reader's position has to be corrected in
        the same breath; every correction is a frame in which the page jumps,
        and there is a correction for every section, every font that lands
        late, and every view that grows after layout. Measured scrolling back
        to the cover of The Incandescent: position walked 1060 -> 360 -> 74 and
        then sat at 74 for fifty-seven consecutive upward scrolls, unable to
        reach the top of the cover at all, while the reader was thrown back to
        the prepend point each time a font resolved.

        So nothing is inserted any more. Every section in the spine gets an
        empty slot the moment the book opens, in order, standing at an
        estimated height. The column's full extent therefore exists from the
        first frame and its shape never changes: loading a section fills a box
        that is already sitting in the flow, and unloading one leaves the box
        behind, frozen at the height it actually measured. A slot only ever
        changes height once — when its estimate is replaced by the real thing.

        Nothing compensates for that one change, and nothing re-anchors after
        it. Every attempt to correct scrollTop while sections settled was a
        write fighting the reader's thumb: measured on the first pass up
        through this book, twenty-seven scrolls landed somewhere other than
        where they were aimed, all of them inside the cover, while a second
        pass over the same sections — already loaded, nothing left to correct —
        was flawless. So the corrections are gone. In scrolled flow scrollTop
        is the reader's position, full stop.

        Fifty-three slots for The Incandescent, one div each, no iframe until
        the section is near. The iframes stay windowed; it is only the geometry
        that is complete. */
    #buildSlots() {
        const el = this.#container
        this.#clearViews()
        el.replaceChildren()
        const estimate = el.clientHeight || 800
        this.#slots = (this.sections ?? []).map(() => {
            const slot = document.createElement('div')
            slot.style.minHeight = estimate + 'px'
            slot.__h = estimate
            el.append(slot)
            return slot
        })
    }
    #slotFor(index) {
        if (this.#slots.length !== (this.sections?.length ?? 0)) this.#buildSlots()
        return this.#slots[index]
    }
    /** A slot keeps the height its section actually measured, so unloading an
        iframe costs the column nothing. */
    #dropView(entry) {
        const slot = this.#slots[entry.index]
        if (slot) {
            slot.style.minHeight = slot.offsetHeight + 'px'
            slot.__h = slot.offsetHeight
        }
        this.#views.splice(this.#views.indexOf(entry), 1)
        entry.view.destroy()
        entry.view.element.remove()
        this.sections[entry.index]?.unload?.()
    }
    #clearViews() {
        for (const { view } of this.#views) {
            view.destroy()
            view.element.remove()
        }
        this.#views = []
    }
    /** Every document currently in the DOM: the window when scrolled, the one
        view otherwise. Used by anything that has to treat the whole column as
        one reading surface rather than one section at a time. */
    get #residentDocuments() {
        const docs = this.scrolled && this.#views.length
            ? this.#views.map(v => v.view.document)
            : [this.#view?.document]
        return docs.filter(Boolean)
    }
    #viewAt(index) {
        return this.#views.find(v => v.index === index)
    }
    /** Offset of the current section within the column. Always 0 when the
        column holds one view, which is every paginated case. */
    get #viewTop() {
        return this.scrolled ? (this.#view?.element?.offsetTop ?? 0) : 0
    }
    /** The whole scrollable column, as against `viewSize`, which stays the
        CURRENT SECTION's own extent — progress and CFI are per-section and
        must not become per-window. */
    get #columnSize() {
        return this.#container.scrollHeight
    }
    #adjacentFrom(from, dir) {
        for (let index = from + dir; this.#canGoToIndex(index); index += dir)
            if (this.sections[index]?.linear !== 'no') return index
        return null
    }
    #beforeRender({ vertical, rtl, background }) {
        this.#vertical = vertical
        this.#rtl = rtl
        this.#top.classList.toggle('vertical', vertical)

        // set background to `doc` background
        // this is needed because the iframe does not fill the whole element
        this.#background.style.background = background

        const { width, height } = this.#container.getBoundingClientRect()
        const size = vertical ? height : width

        const style = getComputedStyle(this.#top)
        const maxInlineSize = parseFloat(style.getPropertyValue('--_max-inline-size'))
        const maxColumnCount = parseInt(style.getPropertyValue('--_max-column-count-spread'))
        const margin = parseFloat(style.getPropertyValue('--_margin'))
        this.#margin = margin

        const g = parseFloat(style.getPropertyValue('--_gap')) / 100
        // The gap will be a percentage of the #container, not the whole view.
        // This means the outer padding will be bigger than the column gap. Let
        // `a` be the gap percentage. The actual percentage for the column gap
        // will be (1 - a) * a. Let us call this `b`.
        //
        // To make them the same, we start by shrinking the outer padding
        // setting to `b`, but keep the column gap setting the same at `a`. Then
        // the actual size for the column gap will be (1 - b) * a. Repeating the
        // process again and again, we get the sequence
        //     x₁ = (1 - b) * a
        //     x₂ = (1 - x₁) * a
        //     ...
        // which converges to x = (1 - x) * a. Solving for x, x = a / (1 + a).
        // So to make the spacing even, we must shrink the outer padding with
        //     f(x) = x / (1 + x).
        // But we want to keep the outer padding, and make the inner gap bigger.
        // So we apply the inverse, f⁻¹ = -x / (x - 1) to the column gap.
        const gap = -g / (g - 1) * size

        const flow = this.getAttribute('flow')
        if (flow === 'scrolled') {
            // FIXME: vertical-rl only, not -lr
            this.setAttribute('dir', vertical ? 'rtl' : 'ltr')
            this.#top.style.padding = '0'
            const columnWidth = maxInlineSize

            this.heads = null
            this.feet = null
            this.#header.replaceChildren()
            this.#footer.replaceChildren()

            return { flow, margin, gap, columnWidth }
        }

        const divisor = Math.min(maxColumnCount, Math.ceil(size / maxInlineSize))
        const columnWidth = (size / divisor) - gap
        this.setAttribute('dir', rtl ? 'rtl' : 'ltr')

        const marginalDivisor = vertical
            ? Math.min(2, Math.ceil(width / maxInlineSize))
            : divisor
        const marginalStyle = {
            gridTemplateColumns: `repeat(${marginalDivisor}, 1fr)`,
            gap: `${gap}px`,
            direction: this.bookDir === 'rtl' ? 'rtl' : 'ltr',
        }
        Object.assign(this.#header.style, marginalStyle)
        Object.assign(this.#footer.style, marginalStyle)
        const heads = makeMarginals(marginalDivisor, 'head')
        const feet = makeMarginals(marginalDivisor, 'foot')
        this.heads = heads.map(el => el.children[0])
        this.feet = feet.map(el => el.children[0])
        this.#header.replaceChildren(...heads)
        this.#footer.replaceChildren(...feet)

        return { height, width, margin, gap, columnWidth }
    }
    render() {
        if (!this.#view) return
        // FLYLEAF PATCH 5 — and not while the section iframe is between
        // documents. #scrollToAnchor below walks the document to find the
        // visible range and hands `doc.body` to createTreeWalker, so a render
        // that arrives mid-parse throws there instead of laying anything out.
        if (!this.#view.document?.body) return
        this.#view.render(this.#beforeRender({
            vertical: this.#vertical,
            rtl: this.#rtl,
        }))
        this.#scrollToAnchor(this.#anchor)
    }
    get scrolled() {
        return this.getAttribute('flow') === 'scrolled'
    }
    get scrollProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'scrollLeft' : 'scrollTop')
            : scrolled ? 'scrollTop' : 'scrollLeft'
    }
    get sideProp() {
        const { scrolled } = this
        return this.#vertical ? (scrolled ? 'width' : 'height')
            : scrolled ? 'height' : 'width'
    }
    // FLYLEAF PATCH 4a: expose the layer a page turn transforms. The shadow
    // root is `mode: 'closed'`, so without this the element that holds the
    // laid-out column strip is unreachable and a transform-only turn is
    // impossible from outside. Read-only, and deliberately the only thing
    // exposed: `size`, `page`, `pages`, `atStart` and `atEnd` are already
    // public, so this one getter is the whole of what the turn needs.
    //
    // Why this element and not #container: #container is the scroll port and
    // clips to its own box, so translating it slides the window as well as the
    // content and no page change is visible. #view.element is the content
    // inside that port, and `expand()` sizes it to
    // `pageCount * size + size * 2` — one blank page of slack at each end —
    // so a translate of up to one page never shrinks the scrollable overflow
    // region below the current scrollLeft, and the browser never clamps
    // mid-drag.
    get contentLayer() {
        return this.#view?.element ?? null
    }
    get size() {
        return this.#container.getBoundingClientRect()[this.sideProp]
    }
    get viewSize() {
        return this.#view.element.getBoundingClientRect()[this.sideProp]
    }
    get start() {
        return Math.abs(this.#container[this.scrollProp])
    }
    get end() {
        return this.start + this.size
    }
    get page() {
        return Math.floor(((this.start + this.end) / 2) / this.size)
    }
    get pages() {
        return Math.round(this.viewSize / this.size)
    }
    scrollBy(dx, dy) {
        const delta = this.#vertical ? dy : dx
        const element = this.#container
        const { scrollProp } = this
        const [offset, a, b] = this.#scrollBounds
        const rtl = this.#rtl
        const min = rtl ? offset - b : offset - a
        const max = rtl ? offset + a : offset + b
        element[scrollProp] = Math.max(min, Math.min(max,
            element[scrollProp] + delta))
    }
    snap(vx, vy) {
        const velocity = this.#vertical ? vy : vx
        const [offset, a, b] = this.#scrollBounds
        const { start, end, pages, size } = this
        const min = Math.abs(offset) - a
        const max = Math.abs(offset) + b
        const d = velocity * (this.#rtl ? -size : size)
        const page = Math.floor(
            Math.max(min, Math.min(max, (start + end) / 2
                + (isNaN(d) ? 0 : d))) / size)

        this.#scrollToPage(page, 'snap').then(() => {
            const dir = page <= 0 ? -1 : page >= pages - 1 ? 1 : null
            if (dir) return this.#goTo({
                index: this.#adjacentIndex(dir),
                anchor: dir < 0 ? () => 1 : () => 0,
            })
        })
    }
    // FLYLEAF PATCH 4b: the `no-touch` attribute opts out of upstream's touch
    // handling. Upstream #onTouchMove calls preventDefault() on every
    // single-finger move with no movement threshold, which kills touch text
    // selection outright; it drives container.scrollLeft, which is a scroll and
    // not a transform; and it commits on a flat 300ms easeOutQuad. This app
    // needs an 8px/200ms claim threshold before the gesture is taken (SPEC
    // § 5.3), a transform-only drag, and a velocity-derived 260-420ms commit
    // (DESIGN.md -> Motion). That is a replacement, not an adjustment. The
    // listeners are left attached and gated rather than deleted so this stays a
    // three-line diff against upstream and `no-touch` is reversible at runtime.
    #onTouchStart(e) {
        if (this.hasAttribute('no-touch')) return
        const touch = e.changedTouches[0]
        this.#touchState = {
            x: touch?.screenX, y: touch?.screenY,
            t: e.timeStamp,
            vx: 0, xy: 0,
        }
    }
    #onTouchMove(e) {
        if (this.hasAttribute('no-touch')) return
        const state = this.#touchState
        if (state.pinched) return
        state.pinched = globalThis.visualViewport.scale > 1
        if (this.scrolled || state.pinched) return
        if (e.touches.length > 1) {
            if (this.#touchScrolled) e.preventDefault()
            return
        }
        e.preventDefault()
        const touch = e.changedTouches[0]
        const x = touch.screenX, y = touch.screenY
        const dx = state.x - x, dy = state.y - y
        const dt = e.timeStamp - state.t
        state.x = x
        state.y = y
        state.t = e.timeStamp
        state.vx = dx / dt
        state.vy = dy / dt
        this.#touchScrolled = true
        this.scrollBy(dx, dy)
    }
    #onTouchEnd() {
        if (this.hasAttribute('no-touch')) return
        this.#touchScrolled = false
        if (this.scrolled) return

        // XXX: Firefox seems to report scale as 1... sometimes...?
        // at this point I'm basically throwing `requestAnimationFrame` at
        // anything that doesn't work
        requestAnimationFrame(() => {
            if (globalThis.visualViewport.scale === 1)
                this.snap(this.#touchState.vx, this.#touchState.vy)
        })
    }
    // allows one to process rects as if they were LTR and horizontal
    #getRectMapper() {
        if (this.scrolled) {
            const size = this.viewSize
            const margin = this.#margin
            return this.#vertical
                ? ({ left, right }) =>
                    ({ left: size - right - margin, right: size - left - margin })
                : ({ top, bottom }) => ({ left: top + margin, right: bottom + margin })
        }
        const pxSize = this.pages * this.size
        return this.#rtl
            ? ({ left, right }) =>
                ({ left: pxSize - right, right: pxSize - left })
            : this.#vertical
                ? ({ top, bottom }) => ({ left: top, right: bottom })
                : f => f
    }
    async #scrollToRect(rect, reason) {
        if (this.scrolled) {
            /* PATCH 6. The rect comes from the current view's own document, so
               the mapper returns an offset within that view. The column may
               hold sections above it, so it has to be lifted into container
               coordinates before it can be a scrollTop. Zero when paginated,
               and zero when this view is the first in the window, which is why
               it was invisible upstream. */
            const offset = this.#getRectMapper()(rect).left - this.#margin
            return this.#scrollTo(this.#viewTop + offset, reason)
        }
        const offset = this.#getRectMapper()(rect).left
        return this.#scrollToPage(Math.floor(offset / this.size) + (this.#rtl ? -1 : 1), reason)
    }
    async #scrollTo(offset, reason, smooth) {
        const element = this.#container
        const { scrollProp, size } = this
        if (element[scrollProp] === offset) {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
            return
        }
        // FIXME: vertical-rl only, not -lr
        if (this.scrolled && this.#vertical) offset = -offset
        if ((reason === 'snap' || smooth) && this.hasAttribute('animated')) return animate(
            element[scrollProp], offset, 300, easeOutQuad,
            x => element[scrollProp] = x,
        ).then(() => {
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
        })
        else {
            element[scrollProp] = offset
            this.#scrollBounds = [offset, this.atStart ? 0 : size, this.atEnd ? 0 : size]
            this.#afterScroll(reason)
        }
    }
    async #scrollToPage(page, reason, smooth) {
        const offset = this.size * (this.#rtl ? -page : page)
        return this.#scrollTo(offset, reason, smooth)
    }
    async scrollToAnchor(anchor, select) {
        return this.#scrollToAnchor(anchor, select ? 'selection' : 'navigation')
    }
    async #scrollToAnchor(anchor, reason = 'anchor') {
        this.#anchor = anchor
        const rects = uncollapse(anchor)?.getClientRects?.()
        // if anchor is an element or a range
        if (rects) {
            // when the start of the range is immediately after a hyphen in the
            // previous column, there is an extra zero width rect in that column
            const rect = Array.from(rects)
                .find(r => r.width > 0 && r.height > 0) || rects[0]
            if (!rect) return
            await this.#scrollToRect(rect, reason)
            return
        }
        // if anchor is a fraction
        if (this.scrolled) {
            await this.#scrollTo(this.#viewTop + anchor * this.viewSize, reason)
            return
        }
        const { pages } = this
        if (!pages) return
        const textPages = pages - 2
        const newPage = Math.round(anchor * (textPages - 1))
        await this.#scrollToPage(newPage + 1, reason)
    }
    #getVisibleRange() {
        if (this.scrolled) {
            /* PATCH 6. Same coordinate mismatch as #scrollToRect, the other way
               round: the walker compares against rects from the current view's
               document, so the window has to be brought down into that view's
               space. Without this the visible range of every section after the
               first resolves to the section root and the CFI loses the
               sentence. */
            const top = this.start - this.#viewTop
            return getVisibleRange(this.#view.document,
                top + this.#margin, top + this.size - this.#margin,
                this.#getRectMapper())
        }
        const size = this.#rtl ? -this.size : this.size
        return getVisibleRange(this.#view.document,
            this.start - size, this.end - size, this.#getRectMapper())
    }
    #afterScroll(reason) {
        const range = this.#getVisibleRange()
        this.#lastVisibleRange = range
        // don't set new anchor if relocation was to scroll to anchor
        if (reason !== 'selection' && reason !== 'navigation' && reason !== 'anchor')
            this.#anchor = range
        else this.#justAnchored = true

        const index = this.#index
        const detail = { reason, range, index }
        /* PATCH 6. start is a column offset now and viewSize is still the
           current SECTION's extent, so the section's own top has to come off
           the top of the fraction or progress reads as the whole window. */
        if (this.scrolled) detail.fraction =
            Math.min(1, Math.max(0, (this.start - this.#viewTop) / this.viewSize))
        else if (this.pages > 0) {
            const { page, pages } = this
            this.#header.style.visibility = page > 1 ? 'visible' : 'hidden'
            detail.fraction = (page - 1) / (pages - 2)
            detail.size = 1 / (pages - 2)
        }
        this.dispatchEvent(new CustomEvent('relocate', { detail }))
    }
    /* ── PATCH 6: the continuous column ──────────────────────────────── */

    /** Load the section after the last one resident and stack it below, so
        the reader scrolls out of one chapter and into the next without any
        crossing event: the end of the text, its trailing whitespace, then the
        next chapter's heading, one column. Runs when the bottom of the column
        comes within two screens, which on a phone is far enough ahead that
        the load and layout are finished long before the text is wanted, and
        near enough that opening a book does not parse the whole file. */
    /** FLYLEAF PATCH 11. One filler, in place of #topUp, #fillForward and
        #fillBackward. Direction stopped mattering the moment the slots made
        the column's shape fixed: loading a section above the reader is now
        exactly as cheap and exactly as invisible as loading one below, because
        both are filling a box that was already there.

        It also removes the deadlock PATCH 9 was written for. The old forward
        filler ran only from the scroll handler, so a section shorter than the
        viewport produced no scrollbar, fired no scroll event, and stitched
        nothing below itself -- eighteen words of dedication and no way on
        except the table of contents. Here the slots are what is scrollable, so
        there is always runway, and the filler is driven by which slots are on
        screen rather than by how much room is left. */
    async #fillVisible() {
        if (!this.scrolled) return
        const el = this.#container
        if (!this.#slots.length) return
        const lo = el.scrollTop - el.clientHeight
        const hi = el.scrollTop + el.clientHeight * 2
        const wanted = []
        for (let i = 0; i < this.#slots.length; i++) {
            if (this.sections[i]?.linear === 'no') continue
            if (this.#viewAt(i) || this.#loadingIndex.has(i)) continue
            const slot = this.#slots[i]
            if (slot.offsetTop + slot.offsetHeight < lo || slot.offsetTop > hi) continue
            wanted.push(i)
        }
        /* Nearest to the reading line first, so the section they are about to
           see arrives before the one two screens away. */
        wanted.sort((a, b) => Math.abs(this.#slots[a].offsetTop - el.scrollTop)
            - Math.abs(this.#slots[b].offsetTop - el.scrollTop))
        for (const index of wanted) await this.#loadInto(index)
    }
    async #loadInto(index, onLoad) {
        if (this.#viewAt(index) || this.#loadingIndex.has(index)) return null
        this.#loadingIndex.add(index)
        try {
            const src = await this.sections[index].load()
            if (typeof src !== 'string') return null
            /* Re-checked after the await: switching flow or opening another
               book while the file was in flight rebuilds the slots, and this
               section no longer has a box to go in. */
            if (!this.#slots[index]?.isConnected) return null
            if (this.#viewAt(index)) return null
            const view = this.#createView(index)
            await view.load(src,
                doc => this.#afterLoad(doc, index, onLoad),
                this.#beforeRender.bind(this))
            this.dispatchEvent(new CustomEvent('create-overlayer', {
                detail: {
                    doc: view.document, index,
                    attach: overlayer => view.overlayer = overlayer,
                },
            }))
            this.setStyles(this.#styles)
            this.dispatchEvent(new CustomEvent('load', {
                detail: { doc: view.document, index },
            }))
            /* The slot now stands at its section's real height and must keep
               it, so a later unload does not collapse the column. */
            const slot = this.#slots[index]
            if (slot) {
                slot.style.minHeight = ''
                slot.__h = slot.offsetHeight
            }
            return view
        } catch (e) {
            console.warn(e)
            console.warn(new Error(`Failed to load section ${index}`))
            return null
        } finally {
            this.#loadingIndex.delete(index)
        }
    }

    /** Which resident section is the reader actually in? The column no longer
        answers that by construction, so it is read from the scroll offset:
        the last view whose top is at or above the reading line. Everything
        downstream — CFI, progress, the running head, the TOC highlight — goes
        on using #index and #view and needs no knowledge of the window. */
    #syncCurrent() {
        if (!this.scrolled || this.#views.length < 2) return false
        /* PATCH 6. Probed at the MIDDLE of the viewport, not at the reading
           margin. Against the margin, a chapter heading sits plainly on screen
           — often halfway up it — while the readout still names the chapter
           before it, which reads as a stale label rather than as a rule about
           top edges. Against the middle, the name changes when the new chapter
           takes the larger half of the screen, which is the moment a reader
           would say they are in it. */
        const el = this.#container
        const probe = el.scrollTop + el.clientHeight / 2
        let cur = this.#views[0]
        for (const v of this.#views)
            if (v.view.element.offsetTop <= probe) cur = v
        if (cur.index === this.#index) return false
        this.#index = cur.index
        this.#view = cur.view
        return true
    }

    /** Sections outside the window are dropped so a long session does not
        accumulate an iframe per chapter. FLYLEAF PATCH 11: no compensation is
        needed any more, in either direction. The slot stays where it is at the
        height its section measured, and only the iframe inside it goes, so
        removing a view above the reader moves nothing at all. */
    #trimWindow() {
        if (!this.scrolled || this.#views.length <= 3) return
        const el = this.#container
        const lo = el.scrollTop - el.clientHeight * 2
        const hi = el.scrollTop + el.clientHeight * 3
        for (const entry of [...this.#views]) {
            if (entry.index === this.#index) continue
            const slot = this.#slots[entry.index]
            if (!slot) continue
            if (slot.offsetTop + slot.offsetHeight >= lo && slot.offsetTop <= hi) continue
            this.#dropView(entry)
        }
    }

    #afterLoad(doc, index, onLoad) {
        const $head = doc.head ?? doc.documentElement
        if ($head) {
            const $styleBefore = doc.createElement('style')
            $head.prepend($styleBefore)
            const $style = doc.createElement('style')
            $head.append($style)
            this.#styleMap.set(doc, [$styleBefore, $style])
        }
        onLoad?.({ doc, index })
    }
    async #display(promise) {
        const { index, src, anchor, onLoad, select } = await promise
        this.#index = index
        const hasFocus = this.#view?.document?.hasFocus()
        /* PATCH 6. The window already holds this section — the reader scrolled
           into it, or came back to it — so there is nothing to load and
           nothing to tear down. Navigating to it is a scroll. */
        const resident = this.scrolled ? this.#viewAt(index) : null
        if (resident) {
            this.#view = resident.view
            await this.scrollToAnchor((typeof anchor === 'function'
                ? anchor(resident.view.document) : anchor) ?? 0, select)
            if (hasFocus) this.focusView()
            void this.#fillVisible()
            return
        }
        /* FLYLEAF PATCH 11. A jump to a section that is not loaded — the TOC,
           a link, a restored position — no longer throws the column away. The
           slot for that section is already in the flow at its place in the
           book, so the jump is a scroll to it and a load into it, and
           everything the reader scrolled past on the way in is still there to
           scroll back through. This is what stops a book opening on its table
           of contents with no way up to the cover. */
        if (this.scrolled && src) {
            const slot = this.#slotFor(index)
            if (slot) {
                this.#container.scrollTop = slot.offsetTop
                this.#displaying = true
                let view
                try { view = await this.#loadInto(index, onLoad) }
                finally { this.#displaying = false }
                if (view) {
                    this.#view = view
                    this.#container.scrollTop = slot.offsetTop
                    await this.scrollToAnchor((typeof anchor === 'function'
                        ? anchor(view.document) : anchor) ?? 0, select)
                    if (hasFocus) this.focusView()
                    void this.#fillVisible()
                    return
                }
            }
        }
        if (src) {
            const view = this.#createView(index)
            const afterLoad = doc => this.#afterLoad(doc, index, onLoad)
            const beforeRender = this.#beforeRender.bind(this)
            await view.load(src, afterLoad, beforeRender)
            this.dispatchEvent(new CustomEvent('create-overlayer', {
                detail: {
                    doc: view.document, index,
                    attach: overlayer => view.overlayer = overlayer,
                },
            }))
            this.#view = view
        }
        await this.scrollToAnchor((typeof anchor === 'function'
            ? anchor(this.#view.document) : anchor) ?? 0, select)
        if (hasFocus) this.focusView()
        void this.#fillVisible()
    }
    #canGoToIndex(index) {
        return index >= 0 && index <= this.sections.length - 1
    }
    async #goTo({ index, anchor, select}) {
        if (index === this.#index) await this.#display({ index, anchor, select })
        else {
            const oldIndex = this.#index
            const onLoad = detail => {
                /* PATCH 6. In a continuous column the previous section may
                   still be on screen above the reader; #trimWindow owns its
                   lifetime instead. */
                if (!this.scrolled) this.sections[oldIndex]?.unload?.()
                this.setStyles(this.#styles)
                this.dispatchEvent(new CustomEvent('load', { detail }))
            }
            await this.#display(Promise.resolve(this.sections[index].load())
                .then(src => ({ index, src, anchor, onLoad, select }))
                .catch(e => {
                    console.warn(e)
                    console.warn(new Error(`Failed to load section ${index}`))
                    return {}
                }))
        }
    }
    async goTo(target) {
        if (this.#locked) return
        const resolved = await target
        if (this.#canGoToIndex(resolved.index)) return this.#goTo(resolved)
    }
    #scrollPrev(distance) {
        if (!this.#view) return true
        if (this.scrolled) {
            if (this.start > 0) return this.#scrollTo(
                Math.max(0, this.start - (distance ?? this.size)), null, true)
            return true
        }
        if (this.atStart) return
        const page = this.page - 1
        return this.#scrollToPage(page, 'page', true).then(() => page <= 0)
    }
    #scrollNext(distance) {
        if (!this.#view) return true
        if (this.scrolled) {
            const size = this.#columnSize
            if (size - this.end > 2) return this.#scrollTo(
                Math.min(size, distance ? this.start + distance : this.end), null, true)
            return true
        }
        if (this.atEnd) return
        const page = this.page + 1
        const pages = this.pages
        return this.#scrollToPage(page, 'page', true).then(() => page >= pages - 1)
    }
    get atStart() {
        return this.#adjacentIndex(-1) == null && this.page <= 1
    }
    get atEnd() {
        return this.#adjacentIndex(1) == null && this.page >= this.pages - 2
    }
    #adjacentIndex(dir) {
        for (let index = this.#index + dir; this.#canGoToIndex(index); index += dir)
            if (this.sections[index]?.linear !== 'no') return index
    }
    async #turnPage(dir, distance) {
        if (this.#locked) return
        this.#locked = true
        try {
            const prev = dir === -1
            const shouldGo = await (prev ? this.#scrollPrev(distance) : this.#scrollNext(distance))
            /* PATCH 7. At the first or last linear section #adjacentIndex
               returns undefined, and #goTo would then read .load() off
               undefined and throw -- leaving #locked true forever, so every
               later turn was silently swallowed. Refuse the move instead, and
               release the lock even if the section itself fails to load. */
            const index = this.#adjacentIndex(dir)
            const go = shouldGo && index != null
            if (go) await this.#goTo({ index, anchor: prev ? () => 1 : () => 0 })
            if (go || !this.hasAttribute('animated')) await wait(100)
        } finally {
            this.#locked = false
        }
    }
    prev(distance) {
        return this.#turnPage(-1, distance)
    }
    next(distance) {
        return this.#turnPage(1, distance)
    }
    prevSection() {
        return this.goTo({ index: this.#adjacentIndex(-1) })
    }
    nextSection() {
        return this.goTo({ index: this.#adjacentIndex(1) })
    }
    firstSection() {
        const index = this.sections.findIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    lastSection() {
        const index = this.sections.findLastIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    getContents() {
        if (this.#view) return [{
            index: this.#index,
            overlayer: this.#view.overlayer,
            doc: this.#view.document,
        }]
        return []
    }
    setStyles(styles) {
        this.#styles = styles
        /* PATCH 6. Upstream wrote into the current view's document only,
           because there was never another one. A stitched-in section got its
           two style elements created and left EMPTY, so it rendered in the
           publisher's own CSS — black headings and blue links on a dark
           stock, which is the reading surface failing contrast outright, not
           a cosmetic difference. Every resident document gets the styles. */
        let applied = false
        for (const doc of this.#residentDocuments) {
            const $$styles = this.#styleMap.get(doc)
            if (!$$styles) continue
            const [$beforeStyle, $style] = $$styles
            if (Array.isArray(styles)) {
                const [beforeStyle, style] = styles
                $beforeStyle.textContent = beforeStyle
                $style.textContent = style
            } else $style.textContent = styles
            applied = true
        }
        if (!applied) return

        // NOTE: needs `requestAnimationFrame` in Chromium
        requestAnimationFrame(() =>
            this.#background.style.background = getBackground(this.#view.document))

        // needed because the resize observer doesn't work in Firefox
        this.#view?.document?.fonts?.ready?.then(() => this.#view.expand())
    }
    focusView() {
        this.#view.document.defaultView.focus()
    }
    destroy() {
        this.#observer.unobserve(this)
        this.#view.destroy()
        this.#view = null
        this.sections[this.#index]?.unload?.()
        this.#mediaQuery.removeEventListener('change', this.#mediaQueryListener)
    }
}

/* Patched: a define is fatal if the module is evaluated twice, and a
   module can be evaluated twice without being imported twice — Vite's
   dev server re-requests it under a fresh ?t= on every HMR pass, and a
   service worker can serve a stale hashed chunk beside a new one. The
   first registration wins; the app only ever uses the element, never
   the exported class, so a later copy losing the race is harmless. */
if (!customElements.get('foliate-paginator')) customElements.define('foliate-paginator', Paginator)
