/* ─────────────────────────────────────────────────────────────
   The selection's two handles.

   Once the app owns a selection (selection.ts) the platform's grab handles
   are gone with the platform's menu, so the app draws its own: a hairline
   of ink the height of the line at each end, with a knob — above the start,
   below the end, which is the convention every phone taught its readers.
   The knob is 10px; the thing the finger actually has to hit is a 44px
   square around it, the platform minimum, drawn as nothing.

   They live in the host document, inside the stage, in the stage's own
   coordinates — the same place and the same frame of reference as the
   menu. That puts them on the gesture layer's positive list of things that
   are NOT the page (turn.ts `#onPage`), so a drag on a handle can never be
   read as a turn.

   A drag is reported in HOST client coordinates; the reader converts to the
   section's, because only the reader knows where the frame is.
   ───────────────────────────────────────────────────────────── */

import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** One end, in stage coordinates. */
export interface HandleEnd { x: number; top: number; bottom: number }

export interface SelectionHandlesProps {
    start: HandleEnd
    end: HandleEnd
    onDragStart: (which: 'start' | 'end') => void
    onDrag: (which: 'start' | 'end', clientX: number, clientY: number) => void
    onDragEnd: (which: 'start' | 'end') => void
}

export function SelectionHandles(p: SelectionHandlesProps) {
    const { start, end, ...hooks } = p
    return (
        <>
            <Handle which="start" at={start} {...hooks} />
            <Handle which="end" at={end} {...hooks} />
        </>
    )
}

type HandleProps = Omit<SelectionHandlesProps, 'start' | 'end'> & { which: 'start' | 'end'; at: HandleEnd }

function Handle({ which, at, onDragStart, onDrag, onDragEnd }: HandleProps) {
    const held = useRef(false)

    const down = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!e.isPrimary) return
        held.current = true
        /* Capture, so the finger can leave the knob — it will, every time,
           because a finger is bigger than a knob — and the moves keep coming
           here rather than to whatever is under it. */
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
        onDragStart(which)
    }
    const move = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!held.current) return
        onDrag(which, e.clientX, e.clientY)
    }
    const up = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!held.current) return
        held.current = false
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        onDragEnd(which)
    }

    return (
        <div
            className={`selhandle selhandle--${which}`}
            style={{ left: at.x, top: at.top, height: Math.max(1, at.bottom - at.top) }}
            role="presentation"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
        />
    )
}
