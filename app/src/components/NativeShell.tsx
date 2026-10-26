/* What only the store apps have, mounted once inside the router: books opened
   from the phone go to /open like a drop does, and a press on a locked control
   opens the unlock sheet. App.tsx renders it only when `nativeApp`. */

import { useEffect, useState } from 'react'
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
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')

  useEffect(() => {
    void import('../native').then((n) => n.prices()).then(setPrice, () => setSaid(`Could not reach ${STORE}. Check your connection.`))
  }, [])

  const run = async (job: () => Promise<boolean>, none: string) => {
    setBusy(true)
    setSaid('')
    try {
      if (!(await job())) setSaid(none)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code !== 'USER_CANCELLED' && !/cancel/i.test(String((e as Error).message))) setSaid('The purchase did not go through. Nothing was charged.')
    }
    setBusy(false)
  }

  return (
    <div
      className="sheet export unlock"
      role="dialog"
      aria-label="Unlock"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <p className="export-head">{done ? 'Unlocked' : 'One purchase, yours for good'}</p>
      {done ? (
        <p className="export-said">Thank you. Everything is open on this phone.</p>
      ) : (
        <div className="export-formats">
          {OFFERS.map((o) => (
            <button key={o.id} type="button" className="export-format" disabled={busy} onClick={() => void run(() => purchase(o.id), '')}>
              <span className="export-format-name">{o.name}{price[o.id] ? ` · ${price[o.id]}` : ''}</span>
              <span className="export-format-note">{o.note}</span>
            </button>
          ))}
        </div>
      )}
      <div className="export-acts">
        {!done && (
          <button type="button" className="export-alt" disabled={busy} onClick={() => void run(restore, `Nothing to restore on this ${STORE} account.`)}>
            Restore purchases
          </button>
        )}
        <button type="button" className="export-shut" onClick={onClose}>
          {done ? 'Done' : 'Not now'}
        </button>
      </div>
      <p className="export-said" role="status">{said || ' '}</p>
      <p className="export-said"><Link to="/terms" onClick={onClose}>Terms of Use</Link> · <Link to="/privacy" onClick={onClose}>Privacy</Link></p>
    </div>
  )
}
