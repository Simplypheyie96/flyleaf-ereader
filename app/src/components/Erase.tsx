import { useState, useRef } from 'react'
import { db } from '../db'

export function Erase() {
  const [open, setOpen] = useState(false)
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  const WORD = 'erase'
  const armed = word.trim().toLowerCase() === WORD && !busy

  async function erase() {
    setBusy(true)
    try {
      await db.transaction('rw', [db.books, db.files, db.locators, db.annotations, db.bookmarks, db.readingDays, db.collections, db.graves], async () => {
        await db.books.clear()
        await db.files.clear()
        await db.locators.clear()
        await db.annotations.clear()
        await db.bookmarks.clear()
        await db.readingDays.clear()
        await db.collections.clear()
        await db.graves.clear()
      })
      window.location.replace('/')
    } catch {
      setBusy(false)
    }
  }

  return (
    <details className="set-group" open={open} onToggle={(e) => {
      const next = (e.currentTarget as HTMLDetailsElement).open
      setOpen(next)
      if (!next) setWord('')
    }}>
      <summary className="set-row set-row--fold">
        <div className="set-row-text">
          <span className="ui-lbl">ERASE EVERYTHING</span>
          <span className="ui-p ui-p--soft">Delete all books and data from this device</span>
        </div>
      </summary>
      <div className="set-fold" style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
        <p className="ui-p" style={{ marginBottom: 'var(--sp-4)' }}>
          This will permanently delete all books, reading progress, highlights, and settings from this device. There is no undo.
        </p>
        <label className="ui-lbl" htmlFor="erase-word" style={{ display: 'block', marginBottom: 'var(--sp-2)' }}>
          Type <b>{WORD}</b> to confirm
        </label>
        <input
          id="erase-word"
          ref={field}
          type="text"
          className="ui-fld"
          value={word}
          placeholder={WORD}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => setWord(e.target.value)}
          style={{ marginBottom: 'var(--sp-4)', width: '100%' }}
        />
        <button
          type="button"
          className="btn btn--no"
          disabled={!armed}
          onClick={erase}
        >
          {busy ? 'Erasing…' : 'Erase everything'}
        </button>
      </div>
    </details>
  )
}
