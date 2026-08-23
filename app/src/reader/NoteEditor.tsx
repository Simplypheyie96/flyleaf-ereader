/* ─────────────────────────────────────────────────────────────
   Writing beside a line.

   SPEC.md § 6.1: the quoted line sits above the note in the reading face at
   13px, and the note itself is Kalam on --card-w. That pairing is the whole
   idea — the book's voice in the book's type, yours in a hand — and it is the
   one place in this app where Kalam is allowed.

   It opens over the page like the control sheet does, from the same edge, and
   it saves as you type rather than behind a button: a note you closed without
   pressing Save is a note you wrote and lost.
   ───────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react'
import type { Annotation } from '../types'
import { CheckIcon, TrashIcon } from '../components/icons'

export interface NoteEditorProps {
    mark: Annotation
    onChange: (note: string) => void
    onRemove: () => void
    onClose: () => void
}

export function NoteEditor({ mark, onChange, onRemove, onClose }: NoteEditorProps) {
    const [text, setText] = useState(mark.note ?? '')
    const area = useRef<HTMLTextAreaElement | null>(null)
    /* The note is saved 400ms after the last keystroke, and again on the way
       out, so closing mid-word never loses the word. Held in a ref because the
       unmount cleanup must see the latest text without re-running on it. */
    const latest = useRef(text)
    latest.current = text

    useEffect(() => {
        const el = area.current
        if (!el) return
        el.focus()
        /* The caret goes to the end of what is already there — an existing note
           is being added to far more often than replaced. */
        el.setSelectionRange(el.value.length, el.value.length)
    }, [])

    useEffect(() => {
        const t = window.setTimeout(() => onChange(latest.current), 400)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text])

    /* Save on unmount, whatever closed it. */
    const save = useRef(onChange)
    save.current = onChange
    useEffect(() => () => { save.current(latest.current) }, [])

    return (
        <div
            className="note"
            role="dialog"
            aria-label="Note on this line"
            onKeyDown={e => {
                if (e.key === 'Escape') { e.stopPropagation(); onClose() }
            }}
        >
            <blockquote className="note-quote">{mark.text}</blockquote>
            <textarea
                ref={area}
                className="note-field"
                value={text}
                rows={4}
                placeholder="Write beside this line"
                aria-label="Your note"
                onChange={e => setText(e.target.value)}
            />
            <div className="note-acts">
                <button
                    type="button"
                    className="note-drop"
                    onClick={onRemove}
                >
                    <TrashIcon />
                    <span>Remove highlight</span>
                </button>
                <button type="button" className="note-done" onClick={onClose}>
                    <CheckIcon />
                    <span>Done</span>
                </button>
            </div>
        </div>
    )
}
