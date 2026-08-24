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
    /** Whether this surface can hold a mark at all. False on a PDF, where a
        fixed page has no CFI to anchor one to — so the tints and the note are
        ABSENT rather than present and inert, and what is left (copy, look up,
        find) is exactly what a page of fixed text can honestly offer.
        SPEC.md § 11, P4. */
    marks?: boolean
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

    /* Measured before the first paint the reader sees, so the menu never
       appears in the wrong place and then jumps. One read, one write. */
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const r = el.getBoundingClientRect()
        setBox({ w: r.width, h: r.height })
    }, [p.tint, p.hasNote, p.marks])

    /* Escape dismisses, and so does a scroll of the page underneath — a menu
       anchored to a line that has moved is pointing at nothing. */
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onDismiss() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [p])

    const w = box?.w ?? 0
    const h = box?.h ?? 0
    /* Above by preference: a menu below the selection covers the next line,
       which is the line you are about to read. Below only when there is no
       room above. */
    const isTouch = window.matchMedia('(pointer: coarse)').matches
    const preferBelow = isTouch
    const above = preferBelow 
        ? !(p.anchor.bottom + GAP + h <= p.bounds.height - EDGE) 
        : (p.anchor.top - GAP - h >= EDGE)

    const top = above
        ? Math.max(EDGE, p.anchor.top - GAP - h)
        : Math.min(p.bounds.height - h - EDGE, p.anchor.bottom + GAP)
    const left = clamp(p.anchor.x - w / 2, EDGE, Math.max(EDGE, p.bounds.width - w - EDGE))

    return (
        <div
            ref={ref}
            className="selmenu"
            role="dialog"
            aria-label={p.tint ? 'This highlight' : 'Selected text'}
            data-marks={p.marks === false ? 'no' : 'yes'}
            style={{
                top: `${Math.round(top)}px`,
                left: `${Math.round(left)}px`,
                /* Hidden for exactly one frame — the one before it is measured. */
                visibility: box ? 'visible' : 'hidden',
            }}
        >
            {p.marks !== false && (
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
            )}
            <div className="selmenu-acts">
                {p.marks !== false && (
                <button type="button" className="selmenu-act" onClick={p.onNote}>
                    <NoteIcon />
                    <span>{p.hasNote ? 'Edit note' : 'Note'}</span>
                </button>
                )}
                <button type="button" className="selmenu-act" onClick={p.onCopy}>
                    <CopyIcon />
                    <span>Copy</span>
                </button>
                <button type="button" className="selmenu-act" onClick={p.onLookUp}>
                    <LookUpIcon />
                    <span>Look up</span>
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
