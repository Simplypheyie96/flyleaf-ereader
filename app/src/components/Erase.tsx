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
    <section className="panel">
      <p className="ui-lbl">Erase everything</p>
      <p className="ui-p" style={{ marginTop: 8 }}>
        This will permanently delete all books, reading progress, highlights, and settings from this device. There is no undo.
      </p>
      
      {!open ? (
        <div className="set-acts">
          <button
            className="btn btn--danger btn--sm"
            type="button"
            onClick={() => setOpen(true)}
          >
            Erase library…
          </button>
        </div>
      ) : (
        <div className="erase-field">
          <label className="ui-lbl" htmlFor="erase-word">
            Type <b>{WORD}</b> to confirm
          </label>
          <input
            id="erase-word"
            ref={field}
            type="text"
            value={word}
            placeholder={WORD}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => setWord(e.target.value)}
          />
          <div className="set-acts">
            <button
              type="button"
              className="btn btn--danger-solid btn--sm"
              disabled={!armed}
              onClick={erase}
            >
              {busy ? 'Erasing…' : 'Delete all data'}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setWord('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
