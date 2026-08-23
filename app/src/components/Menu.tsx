import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronIcon } from './icons'

/* The app's one popover. It exists because a native <select> cannot be themed:
   the closed control can, but the open list is drawn by the OS, so on the Ink
   and Dark chrome a reader taps a dark button and gets a white system sheet
   with system-blue highlights and system type. Nothing else in this app looks
   like that, and it is the single loudest reminder that it is a web page.

   So the same hairline `.menu` card the book sheet already uses, driven from a
   real role="menu" with roving focus. A control that opens with a keyboard has
   to be operable with one: Escape and a click outside close it, and closing
   returns focus to the trigger — dropping focus to the document body is how a
   keyboard user ends up back at the top of the page for no reason they can see.

   What is given up by leaving the native control: on a phone, iOS would have
   rendered a wheel picker with its own momentum, and Android a full-screen
   list. Both are better than a small popover for a list of forty. Every list
   here is four to eight items, which is the range a popover wins in. */

export function useMenu() {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true) }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  /* Layout effect, not effect: the focused item has to be focused in the same
     frame it is painted, or a screen reader announces the menu and then the
     focus move as two separate events. The CHECKED item is preferred over the
     first, so opening a sort menu lands on the sort you are already using. */
  useLayoutEffect(() => {
    if (!open) return
    const box = wrap.current
    const checked = box?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
    ;(checked ?? box?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus()
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length].focus() }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Tab') setOpen(false)   // tabbing away is leaving
  }

  return { open, setOpen, close, wrap, trigger, onMenuKey }
}

export type PickerOption<T extends string> = { id: T; label: string }

type PickerProps<T extends string> = {
  /** the accessible name. Shown only to assistive tech — the closed button
      shows the VALUE, because a picker labelled "Sort" that does not say what
      it is sorted by makes the reader open it to find out. */
  label: string
  value: T
  options: readonly PickerOption<T>[]
  onChange: (next: T) => void
  /** a glyph in the closed button, for a picker whose value is not
      self-explanatory out of context. */
  icon?: React.ReactNode
  /** hide the value text below this width, leaving the icon. For a picker in a
      crowded bar on a phone. */
  compact?: boolean
}

export function Picker<T extends string>({ label, value, options, onChange, icon, compact }: PickerProps<T>) {
  const menu = useMenu()
  const id = `picker-${label.replace(/\W+/g, '-').toLowerCase()}`
  const current = options.find((o) => o.id === value)

  return (
    <div className="menu-wrap" ref={menu.wrap}>
      <button
        ref={menu.trigger}
        type="button"
        className={`picker${compact ? ' picker--compact' : ''}`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={id}
        /* Name it "Sort: Recently read", in that order. The visible text is the
           VALUE, so the name has to contain the value or it fails WCAG 2.5.3 —
           and it has to name the control too, or a screen reader announces
           "Recently read, menu button" with no clue what it controls. An
           aria-label rather than a visually-hidden span because the value is
           display:none under 480px, which drops it out of the computed name
           exactly where the button is icon-only and needs it most. */
        aria-label={current ? `${label}: ${current.label}` : label}
        onClick={() => menu.setOpen(!menu.open)}
      >
        {icon}
        <span className="picker-val">{current?.label ?? label}</span>
        <span className="picker-caret" aria-hidden="true"><ChevronIcon dir={menu.open ? 'up' : 'down'} /></span>
      </button>

      {menu.open && (
        <div id={id} className="menu" role="menu" aria-label={label} onKeyDown={menu.onMenuKey}>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="menu-item menu-item--radio"
              role="menuitemradio"
              aria-checked={o.id === value}
              onClick={() => { menu.close(true); if (o.id !== value) onChange(o.id) }}
            >
              {/* The tick occupies its row whether or not it is drawn, so the
                  labels do not shift by 27px between the checked and unchecked
                  state — which is what makes a list of options readable as a
                  column of text rather than a ragged edge. */}
              <span className="menu-tick" aria-hidden="true">{o.id === value && <CheckIcon />}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
