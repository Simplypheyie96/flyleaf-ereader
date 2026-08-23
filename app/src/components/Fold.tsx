import { useId, useState } from 'react'
import { ChevronIcon } from './icons'

/* A panel that can be put away. Settings grew to eight panels, three of which
   are long enough that the ones under them are two screens down — Backup, the
   included books and the small print are all reference rather than daily, and
   a reader who came here to change the theme should not have to scroll past
   them. The chevron-that-flips is already this app's disclosure idiom (Menu's
   picker-caret), so nothing new is introduced: only the label becomes pressable.
   A real <button> rather than <details>, because the caret and the label have to
   match the picker's, and because the section still wants to be a <section>. */
export function Fold({
  label,
  open: initial = false,
  children,
}: {
  label: string
  open?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(initial)
  const id = useId()
  return (
    <section className="panel">
      <button
        type="button"
        className="fold-hd"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ui-lbl">{label}</span>
        <span className="fold-caret" aria-hidden="true">
          <ChevronIcon dir={open ? 'up' : 'down'} />
        </span>
      </button>
      {open && (
        <div className="fold-bd" id={id}>
          {children}
        </div>
      )}
    </section>
  )
}
