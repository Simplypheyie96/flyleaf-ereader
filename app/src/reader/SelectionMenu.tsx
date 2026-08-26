/* ─────────────────────────────────────────────────────────────
   The selection menu.

   The engine's own is the platform's — a long-press menu with Copy, Look Up,
   Share and nothing that knows what a highlight is. This one replaces it, and
   the reason it is drawn by the app rather than left to the OS is that four of
   its six actions are this reader's: five tints, a note, the concordance, and
   in-book search.

   It floats over the page, which on this project is a constraint and not a
   licence: no shadow, no blur, no translucency. So it is the reading ground
   itself with a 1px rule around it — the same way every card in Press earns
   its edge. Solid because it sits over words: a menu you can read the text
   through is a menu you cannot read.
   ───────────────────────────────────────────────────────────── */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HighlightColor } from '../types'
import { TINTS } from './marks'
import { lookUp, normalise } from './dict'
import type { Entry } from './dict'
import { CopyIcon, FindIcon, LookUpIcon, NoteIcon, TrashIcon } from '../components/icons'

/** Where the selection is, in the coordinates of the reading pane. */
export interface SelAnchor {
    /** centre of the selection, horizontally */
    x: number
    /** top of the first line */
    top: number
    /** bottom of the last line */
    bottom: number
}

export interface SelectionMenuProps {
    anchor: SelAnchor
    /** The pane the menu is clamped inside. */
    bounds: { width: number; height: number }
    /** Set when the selection is an existing mark rather than fresh text. */
    tint: HighlightColor | null
    hasNote: boolean
    /** The selected words. A selection of exactly one word gets its meaning
        printed at the top of the menu, with nothing to press: SPEC.md § 6.5. */
    text: string
    onTint: (c: HighlightColor) => void
    onNote: () => void
    onCopy: () => void
    onLookUp: () => void
    onFind: () => void
    /** absent on a fresh selection: there is nothing yet to remove. */
    onRemove?: () => void
    onDismiss: () => void
}

/** Clear of the finger and of the line, both. 10px is the gap; the menu's own
    height is measured rather than assumed, because two rows of chips is not a
    number this file should be repeating. */
const GAP = 10
const EDGE = 8

export function SelectionMenu(p: SelectionMenuProps) {
    const ref = useRef<HTMLDivElement | null>(null)
    const [box, setBox] = useState<{ w: number; h: number } | null>(null)

    /* The definition. One word selected means one question — what does this
       mean — so it is answered before it is asked; anything longer is a
       passage, and a passage has no single meaning to print. `looking` exists
       so the menu reserves its height on the first frame instead of growing
       under the finger once the shard lands. */
    const word = normalise(p.text)
    const single = Boolean(word) && !/[^a-z']/.test(word)
    const [entry, setEntry] = useState<Entry | null>(null)
    const [looking, setLooking] = useState(single)
    useEffect(() => {
        if (!single) { setEntry(null); setLooking(false); return }
        let live = true
        setLooking(true)
        void lookUp(word).then(e => { if (live) { setEntry(e); setLooking(false) } })
        return () => { live = false }
    }, [word, single])

    /* Measured before the first paint the reader sees, so the menu never
       appears in the wrong place and then jumps. One read, one write. */
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const r = el.getBoundingClientRect()
        setBox({ w: r.width, h: r.height })
    }, [p.tint, p.hasNote, entry, looking])

    /* Escape dismisses, and so does a scroll of the page underneath — a menu
       anchored to a line that has moved is pointing at nothing. */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onDismiss() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [p])

    const w = box?.w ?? 0
    const h = box?.h ?? 0
    
    let top: number
    let left: number

    const isTouch = window.matchMedia('(pointer: coarse)').matches
    // On touch devices, the native OS menu pops up right next to the text.
    // It's usually about 45-50px tall. We use a 60px gap to float our menu
    // just past the OS menu so they stack neatly!
    const effectiveGap = isTouch ? 60 : GAP
    
    const canGoAbove = p.anchor.top - effectiveGap - h >= EDGE
    const above = canGoAbove
    
    top = above
        ? Math.max(EDGE, p.anchor.top - effectiveGap - h)
        : Math.min(p.bounds.height - h - EDGE, p.anchor.bottom + effectiveGap)
    
    left = clamp(p.anchor.x - w / 2, EDGE, Math.max(EDGE, p.bounds.width - w - EDGE))

    return (
        <div
            ref={ref}
            className="selmenu"
            role="dialog"
            aria-label={p.tint ? 'This highlight' : 'Selected text'}
            style={{
                top: `${Math.round(top)}px`,
                left: `${Math.round(left)}px`,
                /* Hidden for exactly one frame — the one before it is measured. */
                visibility: box ? 'visible' : 'hidden',
            }}
        >
            {single && (looking || entry) && (
                <div className="selmenu-def">
                    {entry ? (
                        <>
                            <p className="selmenu-word">
                                {entry.word}
                                {entry.word !== word && <span className="selmenu-from"> · {word}</span>}
                            </p>
                            {entry.senses.map((s, i) => (
                                <p key={i} className="selmenu-sense">
                                    <span className="selmenu-pos">{s.pos}</span> {s.gloss}
                                </p>
                            ))}
                        </>
                    ) : (
                        <p className="selmenu-sense selmenu-sense--wait">Looking up {word}…</p>
                    )}
                </div>
            )}
            {single && !looking && !entry && (
                <div className="selmenu-def">
                    <p className="selmenu-sense selmenu-sense--wait">No entry for “{word}”.</p>
                </div>
            )}
            <div className="selmenu-tints" role="group" aria-label="Highlight">
                {TINTS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        className="selmenu-tint"
                        data-tint={t.id}
                        aria-label={t.label}
                        aria-pressed={p.tint === t.id}
                        onClick={() => p.onTint(t.id)}
                    />
                ))}
                {p.tint && (
                    <button
                        type="button"
                        className="selmenu-act selmenu-act--drop"
                        aria-label="Remove this highlight"
                        onClick={p.onRemove}
                    >
                        <TrashIcon />
                    </button>
                )}
            </div>
            <div className="selmenu-acts">
                <button type="button" className="selmenu-act" onClick={p.onNote}>
                    <NoteIcon />
                    <span>{p.hasNote ? 'Edit note' : 'Note'}</span>
                </button>
                <button type="button" className="selmenu-act" onClick={p.onCopy}>
                    <CopyIcon />
                    <span>Copy</span>
                </button>
                <button type="button" className="selmenu-act" onClick={p.onLookUp}>
                    <LookUpIcon />
                    {/* Not "Look up" any more. The looking up is the block
                        above; this opens the concordance, which answers a
                        different question — where else this word falls in
                        this book — and it should say so. */}
                    <span>In this book</span>
                </button>
                <button type="button" className="selmenu-act" onClick={p.onFind}>
                    <FindIcon />
                    <span>Find</span>
                </button>
            </div>
        </div>
    )
}

/* Kept here rather than in lib.ts: it is two lines, and the only other caller
   would be a different clamp with different edges. */
function clamp(v: number, lo: number, hi: number) {
    return Math.min(hi, Math.max(lo, v))
}
