import { useCallback, useEffect, useState } from 'react'
import { SYNC_EVENT, optedIn as usedDrive, warmUp } from '../sync/google'
import { SYNC_AVAILABLE, account, optedIn, signOut } from '../sync/cloud'
import {
  bringTogether,
  forgetAccount,
  forgetCopy,
  forgetDrive,
  fromDrive,
  hasUnsharedWork,
  lastSync,
  otherLibrary,
  pauseAutoSync,
  resumeAutoSync,
  storageFull,
  SYNC_PROGRESS,
  syncNow,
  syncProgress,
  tooBig,
} from '../sync/sync'
import { GoogleButton } from './GoogleButton'
import { NativeSignIn } from './NativeSignIn'
import { APP_NAME, SERVICE, nativeApp } from '../native'
import { GATED, locked, unlocked, useUnlocked } from '../unlock'

/* Sync across devices, as one settings panel.

   SIGNED IN ONCE, THEN NOTHING TO PRESS. The Flyleaf account replaced Google
   Drive because Drive's hour-long tokens signed every phone out; the session
   here lasts as long as the device keeps being used. So there is no "Sync now"
   and no "sign in again": the panel says who this device is signed in as, and
   that it keeps up by itself. Journal's panel, in this app's idiom.

   OFF UNTIL SOMEBODY SIGNS IN, and the whole panel hides itself when the app
   was built without a Google client ID — a button that opens onto an error is
   worse than no button.

   ONE QUESTION, ONCE. Signing in a device that is already carrying books the
   account has never seen is the one moment two libraries genuinely meet, and
   it asks before merging — a shelf that silently grows by nine books is a
   thing that happened TO somebody. Every sync after that is silent, because a
   merge is a union and cannot take anything away. */

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 90) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} hour${h === 1 ? '' : 's'} ago`
  return `${Math.round(h / 24)} days ago`
}

/** What came of a sync, in one sentence. Rows, not books — a position and a
    highlight are both rows, and calling four of them "4 books" would be a lie
    somebody could check. */
function tally(r: { gained: number; updated: number; removed: number; files: number; filesLeft: number }): string {
  const parts = [
    r.gained ? `${r.gained} came down` : null,
    r.updated ? `${r.updated} updated` : null,
    r.removed ? `${r.removed} removed` : null,
    r.files ? `${r.files} ${r.files === 1 ? 'book file' : 'book files'} moved` : null,
  ].filter(Boolean)
  const head = parts.length ? `${parts.join(', ')}.` : 'Everything was already up to date.'
  /* NO SILENT CAPS. Ten files move per pass; if more are waiting the panel
     says so, because a reader watching two of forty books arrive would
     otherwise conclude it had failed. */
  return r.filesLeft ? `${head} ${r.filesLeft} more still to move — they go a few at a time while the app is open.` : head
}

export function SyncPanel() {
  const [on, setOn] = useState(optedIn())
  const [who, setWho] = useState(account())
  const [at, setAt] = useState(lastSync())
  const [drive, setDrive] = useState(usedDrive())
  const [full, setFull] = useState(storageFull())
  const [big, setBig] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [asking, setAsking] = useState<{ device: string; at: number } | null>(null)
  /* Which irreversible button has been pressed once. The second press is in
     the inline confirm, where the sentence explaining it lands. */
  const [sure, setSure] = useState<'copy' | 'account' | 'drive' | null>(null)
  /* The file pass, while it is running. Book files are the only part of a
     sync that takes long enough to need reporting. Null between passes. */
  const [moving, setMoving] = useState(syncProgress())
  const open = useUnlocked()

  /* Held in state rather than read at render: setting states to the values
     they already hold makes React bail out, and a background sync must still
     redraw the panel when something did move. */
  const refresh = useCallback(() => {
    setOn(optedIn())
    setWho(account())
    setAt(lastSync())
    setDrive(usedDrive())
    setFull(storageFull())
  }, [])

  useEffect(() => {
    if (!SYNC_AVAILABLE) return
    const tick = () => setMoving(syncProgress())
    window.addEventListener(SYNC_PROGRESS, tick)
    window.addEventListener(SYNC_EVENT, refresh)
    return () => {
      window.removeEventListener(SYNC_PROGRESS, tick)
      window.removeEventListener(SYNC_EVENT, refresh)
    }
  }, [refresh])

  /* Google's Drive script, fetched now rather than inside the press that needs
     it: Safari only lets a popup open from within the gesture that asked. Only
     for a device that used Drive — nobody else will ever open that window. */
  useEffect(() => {
    if (SYNC_AVAILABLE && drive) warmUp()
  }, [drive])

  /* The books that cannot go up, named, so a shelf row with no file on the
     other device is a fact somebody was told rather than a fault. */
  useEffect(() => {
    if (!SYNC_AVAILABLE || !on) return
    let alive = true
    void tooBig().then((titles) => alive && setBig(titles))
    return () => {
      alive = false
    }
  }, [on, at])

  if (!SYNC_AVAILABLE) return null

  const say = (text: string) => {
    setMsg(text)
    setErr('')
  }
  const fail = (e: unknown) => {
    setErr(e instanceof Error ? e.message : `Something went wrong talking to ${SERVICE}.`)
    setMsg('')
  }

  /* Google's button has signed the reader in by the time this runs. Auto-sync
     is held until the question below is answered, so nothing merges
     underneath it. */
  const connected = async () => {
    refresh()
    /* Signed in on a store app that is not unlocked: the panel offers the
       unlock, and nothing syncs until it is bought. */
    if (__STORE__ && GATED && !unlocked()) return
    setBusy('in')
    setErr('')
    setMsg('')
    try {
      pauseAutoSync()
      const other = await otherLibrary()
      if (other && (await hasUnsharedWork())) {
        setAsking(other)
        return
      }
      resumeAutoSync()
      const r = await syncNow()
      refresh()
      say(`Signed in. ${tally(r)}`)
    } catch (e) {
      resumeAutoSync()
      refresh()
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const merge = async () => {
    setAsking(null)
    setBusy('in')
    try {
      const r = await bringTogether()
      refresh()
      say(`Brought together. ${tally(r)}`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  /* No. Signing back out is the honest undo: signed in but never syncing would
     be a panel that says On and does nothing. */
  const apart = async () => {
    setAsking(null)
    setBusy('out')
    await signOut()
    resumeAutoSync()
    refresh()
    say('Left as they are. This device is not syncing, and the library in your account is untouched.')
    setBusy('')
  }

  const leave = async () => {
    setBusy('out')
    await signOut()
    refresh()
    say('Signed out of this device. Your library stays here and in your account.')
    setBusy('')
  }

  /* Signed out as part of the same press: still signed in, this device would
     write the library straight back up within seconds. */
  const dropCopy = async () => {
    setBusy('drop')
    try {
      await forgetCopy()
      await signOut()
      setSure(null)
      refresh()
      say(`Removed from ${SERVICE}. This device is signed out, and every book on it remains here.`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const dropAccount = async () => {
    setBusy('account')
    try {
      await forgetAccount()
      setSure(null)
      refresh()
      say(`Your ${SERVICE} account is deleted. This device is signed out, and every book on it remains here.`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const bringDrive = async () => {
    setBusy('drive')
    setErr('')
    setMsg('')
    try {
      const got = await fromDrive()
      refresh()
      if (!got) say(`That Google Drive holds no ${APP_NAME} library.`)
      else if (!got.rows && !got.files) say('Brought in. Nothing there was new to this device.')
      else
        say(
          `Brought in from Google Drive: ${got.rows} ${got.rows === 1 ? 'row' : 'rows'}` +
            (got.files ? `, ${got.files} ${got.files === 1 ? 'book file' : 'book files'}.` : '.'),
        )
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const dropDrive = async () => {
    setBusy('drive')
    try {
      const n = await forgetDrive()
      setSure(null)
      refresh()
      say(n ? 'Removed the old copy from Google Drive.' : `Google Drive held no ${APP_NAME} library.`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  /* The store apps must let a reader close the account they made there,
     unlocked or not. */
  const deleteRow = (
          <div className="set-row set-row--stack">
            <div className="set-row-txt">
              <div className="ui-lbl">Delete my {SERVICE} account</div>
              <p>
                Closes your account for {APP_NAME}, Flyleaf Journal and Bookprint and signs this device out.
                Every book stays on this device, and a purchase comes back with Restore.
              </p>
            </div>
            {sure === 'account' ? (
              <div className="set-confirm">
                <p className="ui-p">This cannot be undone.</p>
                <div className="set-acts" style={{ marginTop: 14 }}>
                  <button className="btn btn--danger btn--sm" type="button" disabled={!!busy} onClick={() => void dropAccount()}>
                    {busy === 'account' ? 'Deleting…' : 'Yes, delete it'}
                  </button>
                  <button className="btn btn--ghost btn--sm" type="button" disabled={!!busy} onClick={() => setSure(null)}>
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn--danger btn--sm" type="button" disabled={!!busy} onClick={() => setSure('account')}>
                Delete
              </button>
            )}
          </div>
  )

  return (
    /* The id is the destination of the Library head's "Sync" link, and
       SettingsPage does the scrolling. */
    <section className="panel" id="sync">
      <p className="ui-lbl">Sync across devices</p>

      {__STORE__ && GATED && !open ? (
        <>
          <p className="ui-p" style={{ marginTop: 8 }}>
            Sync comes with the unlock: your shelf, highlights and places on every device, with up
            to 1 GB of book files kept on {SERVICE}’s servers, private to your account.
          </p>
          <div className="set-acts">
            <button className="btn btn--sm" type="button" onClick={() => locked()}>
              Unlock or restore
            </button>
          </div>
          {on ? (<>
            <p className="ui-p ui-p--soft" style={{ marginTop: 14 }}>
              Signed in as {who}, which has not unlocked yet.{' '}
              <button className="btn btn--ghost btn--sm" type="button" disabled={!!busy} onClick={() => void leave()}>
                Sign out
              </button>
            </p>
            {nativeApp && deleteRow}
          </>) : (
            <>
              <p className="ui-p ui-p--soft" style={{ marginTop: 14 }}>
                Unlocked on another device? Sign in with the same account to bring it here.
              </p>
              <div style={{ marginTop: 12 }}>
                <NativeSignIn onDone={() => void connected()} onError={fail} />
              </div>
            </>
          )}
        </>
      ) : asking ? (
        /* ASKED IN THE PANEL, not over it. This app has no modal confirm, and
           the inline block is what a restore uses two panels down. */
        <div className="set-confirm">
          <p className="ui-p">
            Your account already holds a library, last changed on {asking.device || 'another device'}
            {asking.at ? ` ${ago(asking.at)}` : ''}.
          </p>
          <p className="ui-p ui-p--soft" style={{ marginTop: 8 }}>
            Bringing them together keeps everything from both sides — every book, every highlight
            and the furthest page in each. Nothing on this device is replaced or removed.
          </p>
          <div className="set-acts" style={{ marginTop: 14 }}>
            <button className="btn btn--sm" type="button" disabled={!!busy} onClick={() => void merge()}>
              {busy === 'in' ? 'Bringing together…' : 'Bring them together'}
            </button>
            <button className="btn btn--ghost btn--sm" type="button" disabled={!!busy} onClick={() => void apart()}>
              {busy === 'out' ? 'Signing out…' : 'Leave them as they are'}
            </button>
          </div>
        </div>
      ) : on ? (
        <>
          <p className="ui-p" style={{ marginTop: 8 }}>
            Signed in as {who}. This device syncs on its own and stays signed in. There is nothing
            to press.
          </p>
          <p className="mono-meta" style={{ marginTop: 8 }}>
            {at ? `Last synced ${ago(at)}` : 'Not synced yet'}
          </p>

          {/* WHAT IS ACTUALLY HAPPENING, while it happens. "Syncing" on its own
              cannot tell a working sync from a stuck one, and the book files
              are minutes of it on a phone. `.bar` is the shelf's own progress
              hairline, so this adds no new component and no new token. */}
          {moving && (
            <div className="sync-move" role="status" aria-live="polite">
              <p className="mono-meta">{`Moving book ${Math.min(moving.done + 1, moving.total)} of ${moving.total}`}</p>
              <span
                className="bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={moving.total}
                aria-valuenow={moving.done}
                aria-label="Book files moving"
              >
                <span className="bar-fill" style={{ width: `${Math.round((moving.done / moving.total) * 100)}%` }} />
              </span>
            </div>
          )}

          {full && (
            <p className="ui-p ui-p--warn" style={{ marginTop: 14 }}>
              Your 1 GB of book files on {SERVICE} is full, so new books stay on the device they were
              added on. Your notes, highlights and places still sync.
            </p>
          )}
          {big.length > 0 && (
            <p className="ui-p ui-p--soft" style={{ marginTop: 14 }}>
              {big.length === 1 ? 'One book is' : `${big.length} books are`} over the 25 MB {SERVICE}
              carries per file, so {big.length === 1 ? 'it stays' : 'they stay'} on this device:{' '}
              {big.join(', ')}. {big.length === 1 ? 'Its highlights and place' : 'Their highlights and places'} still sync.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="ui-p" style={{ marginTop: 8 }}>
            Sign in once and your shelf, highlights and places appear on your other devices and keep
            up with them by themselves. They are kept on {SERVICE}’s servers, private to your account,
            and you can remove them from here at any time. Reading settings stay on each device.
          </p>
          <div style={{ marginTop: 18 }}>
            {busy === 'in' ? (
              <p className="mono-meta" role="status">
                Signing in…
              </p>
            ) : (
              nativeApp ? <NativeSignIn onDone={() => void connected()} onError={fail} /> : <GoogleButton onDone={() => void connected()} onError={fail} />
            )}
          </div>
        </>
      )}

      {(msg || err) && (
        <p className={err ? 'ui-p ui-p--warn' : 'mono-meta'} role="status" style={{ marginTop: 14 }}>
          {err || msg}
        </p>
      )}

      {on && !asking && (
        /* THE TWO WAYS OUT, as rows: the label states the outcome plainly, the
           danger lives on the button alone, and the sentence about what cannot
           be undone waits for the press. */
        <div className="set-rows">
          <div className="set-row set-row--stack">
            <div className="set-row-txt">
              <div className="ui-lbl">Sign out of this device</div>
              <p>Stops syncing here. Your library stays on this device and in your account.</p>
            </div>
            <button className="btn btn--ghost btn--sm" type="button" disabled={!!busy} onClick={() => void leave()}>
              {busy === 'out' ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
          <div className="set-row set-row--stack">
            <div className="set-row-txt">
              <div className="ui-lbl">Remove my library from {SERVICE}</div>
              <p>
                Deletes the copy in your account, book files included, and signs this device out.
                Every book stays on this device, but your other devices will have nothing to sync
                with.
              </p>
            </div>
            {sure === 'copy' ? (
              <div className="set-confirm">
                <p className="ui-p">This cannot be undone.</p>
                <div className="set-acts" style={{ marginTop: 14 }}>
                  <button className="btn btn--danger btn--sm" type="button" disabled={!!busy} onClick={() => void dropCopy()}>
                    {busy === 'drop' ? 'Removing…' : 'Yes, remove it'}
                  </button>
                  <button className="btn btn--ghost btn--sm" type="button" disabled={!!busy} onClick={() => setSure(null)}>
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn--danger btn--sm" type="button" disabled={!!busy} onClick={() => setSure('copy')}>
                Remove
              </button>
            )}
          </div>
          {nativeApp && deleteRow}
        </div>
      )}

      {drive && !asking && (
        /* ONLY FOR A DEVICE THAT SYNCED THROUGH DRIVE BEFORE, and only until
           the old copy is removed. Nothing moves until it is pressed. */
        <div className="set-rows">
          <div className="set-row set-row--stack">
            <div className="set-row-txt">
              <div className="ui-lbl">Your old Google Drive copy</div>
              <p>
                An older {APP_NAME} kept a copy of this library in your Google Drive. Bring it in
                once and it joins the library here{on ? ' and in your account' : ''}. The Drive copy is
                left as it is.
              </p>
            </div>
            <button className="btn btn--ghost btn--sm" type="button" disabled={!!busy} onClick={() => void bringDrive()}>
              {busy === 'drive' && sure !== 'drive' ? 'Bringing it in…' : 'Bring in my Google Drive copy'}
            </button>
          </div>
          <div className="set-row set-row--stack">
            <div className="set-row-txt">
              <div className="ui-lbl">Remove the Google Drive copy</div>
              <p>
                Opens Google to confirm the account, then deletes the old copy from your Drive. Nothing
                here or in your {SERVICE} account is touched.
              </p>
            </div>
            {sure === 'drive' ? (
              <div className="set-confirm">
                <p className="ui-p">This cannot be undone from here or from Drive.</p>
                <div className="set-acts" style={{ marginTop: 14 }}>
                  <button className="btn btn--danger btn--sm" type="button" disabled={!!busy} onClick={() => void dropDrive()}>
                    {busy === 'drive' ? 'Removing…' : 'Yes, remove it from Drive'}
                  </button>
                  <button className="btn btn--ghost btn--sm" type="button" disabled={!!busy} onClick={() => setSure(null)}>
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn--danger btn--sm" type="button" disabled={!!busy} onClick={() => setSure('drive')}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
