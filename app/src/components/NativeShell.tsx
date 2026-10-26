/* What only the store apps have, mounted once inside the router: books opened
   from the phone go to /open like a drop does, and a press on a locked control
   opens the unlock sheet. App.tsx renders it only when `nativeApp`. */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { queueFiles } from '../openQueue'
import { STORE, startNative, type Product } from '../native'
import { onOpenAsked, purchase, restore, useUnlocked } from '../unlock'

export function NativeShell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void startNative((files) => {
      queueFiles(files)
      navigate('/open')
    })
    return onOpenAsked(() => setOpen(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return open ? <UnlockSheet onClose={() => setOpen(false)} /> : null
}

const OFFERS: { id: Product; name: string; note: string }[] = [
  { id: 'unlock', name: 'Unlock', note: 'Page stocks, themes, marks export and sync.' },
  { id: 'supporter', name: 'Supporter', note: 'The same unlock, for those who want to give more.' },
]

function UnlockSheet({ onClose }: { onClose: () => void }) {
  const done = useUnlocked()
  const [price, setPrice] = useState<Partial<Record<Product, string>>>({})
  const [busy, setBusy] = useState<Product | 'restore' | null>(null)
  const [said, setSaid] = useState('')
  const box = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    void import('../native')
      .then((n) => n.prices())
      .then(setPrice, () => setSaid(`Could not reach ${STORE}. Check your connection.`))
  }, [])
  /* A modal dialog: on top of every screen, the page behind it inert, focus
     inside it, Escape to leave, and focus back where it was afterwards. */
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    box.current?.showModal()
    return () => back?.focus?.()
  }, [])

  const run = async (which: Product | 'restore', job: () => Promise<boolean>, none: string) => {
    setBusy(which)
    setSaid(which === 'restore' ? `Checking with ${STORE}…` : `Opening ${STORE}…`)
    try {
      setSaid((await job()) ? '' : none)
    } catch (e) {
      const code = (e as { code?: string }).code
      const cancel = code === 'USER_CANCELLED' || /cancel/i.test(String((e as Error).message))
      setSaid(cancel ? '' : 'The purchase did not go through. Nothing was charged.')
    }
    setBusy(null)
  }

  return (
    <dialog
      ref={box}
      className="unlock-modal"
      aria-labelledby="unlock-head"
      // A store sheet is up while busy: closing now would lose its answer.
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
      // The dialog fills the screen and the sheet sits at its foot, so a tap
      // above the sheet lands on the dialog itself (WebKit gives ::backdrop no taps).
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="unlock-card">
        <h2 className="export-head" id="unlock-head">
          {done ? 'Unlocked' : 'One purchase, yours for good'}
        </h2>
        {done && <p className="unlock-thanks">Thank you. Everything is open on this phone.</p>}
        <div className="export-formats">
          {(done ? OFFERS.filter((o) => o.id === 'supporter') : OFFERS).map((o) => (
            <button
              key={o.id}
              type="button"
              className="export-format"
              disabled={!!busy}
              onClick={() =>
                void run(
                  o.id,
                  () => purchase(o.id),
                  'The purchase is waiting on approval. It opens up once it goes through.',
                )
              }
            >
              <span className="export-format-name">
                {o.name}
                {price[o.id] ? ` · ${price[o.id]}` : ''}
              </span>
              <span className="export-format-note">
                {busy === o.id
                  ? `Opening ${STORE}…`
                  : done
                    ? 'A tip on top of the unlock. It opens nothing more.'
                    : o.note}
              </span>
            </button>
          ))}
        </div>
        <div className="export-acts">
          {!done && (
            <button
              type="button"
              className="export-alt"
              disabled={!!busy}
              onClick={() => void run('restore', restore, `Nothing to restore on this ${STORE} account.`)}
            >
              {busy === 'restore' ? 'Checking…' : 'Restore purchases'}
            </button>
          )}
          <button type="button" className="export-shut" disabled={!!busy} onClick={onClose}>
            {done ? 'Done' : 'Not now'}
          </button>
        </div>
        <p className="export-said" role="status" aria-live="polite">
          {said}
        </p>
        <p className="export-said">
          <Link to="/terms" onClick={onClose}>
            Terms of Use
          </Link>{' '}
          ·{' '}
          <Link to="/privacy" onClick={onClose}>
            Privacy
          </Link>
        </p>
      </div>
    </dialog>
  )
}
