import { useCallback, useEffect, useState } from 'react'
import {
  SYNC_AVAILABLE,
  SYNC_EVENT,
  account,
  needsSignIn,
  optedIn,
  signIn,
  signOut,
  warmUp,
} from '../sync/google'
import {
  bringTogether,
  driveRoom,
  filesIncluded,
  forgetDrive,
  hasUnsharedWork,
  includeFiles,
  lastSync,
  otherLibrary,
  pauseAutoSync,
  resumeAutoSync,
  syncNow,
} from '../sync/sync'
import { bytes } from '../lib'

/* Google Drive sync, as one settings panel.

   OFF UNTIL SOMEBODY TURNS IT ON, and the whole panel hides itself when the
   app was built without a Google client ID — a button that opens onto an error
   is worse than no button. The library is local either way; this only decides
   whether a copy also lives in the reader's own Drive.

   ONE QUESTION, ONCE. Connecting a device that is already carrying books Drive
   has never seen is the one moment two libraries genuinely meet, and it asks
   before merging — a shelf that silently grows by nine books is a thing that
   happened TO somebody. Every sync after that is silent, because a merge is a
   union and cannot take anything away.

   PORTED FROM FLYLEAF PRESS, and rebuilt in this app's own idiom: Press has a
   `Confirm` modal and `.set-row`; this has `.panel`, `.set-acts` and an inline
   `.set-confirm`, and the question is asked in the panel rather than over it.
   Two differences of substance, both because this app carries books and Press
   carries text about them: the book files are a separate opt-in with the
   reader's Drive room named beside it, and the position row moves constantly,
   so what the panel reports is the last SYNC and never a per-row state. */

/** What `silentToken` throws when Google will not renew access unasked. The
    panel shows that state as its own row with a button in it, so the same
    words arriving as an error would be a duplicate rather than news. */
const STALE = 'Sign in to Google again to keep syncing.'

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
function tally(r: { gained: number; updated: number; removed: number; files: number; filesLeft: number; unchanged: boolean }): string {
  if (r.unchanged) return 'Already up to date.'
  const parts = [
    r.gained ? `${r.gained} came down` : null,
    r.updated ? `${r.updated} updated` : null,
    r.removed ? `${r.removed} removed` : null,
    r.files ? `${r.files} ${r.files === 1 ? 'book file' : 'book files'} moved` : null,
  ].filter(Boolean)
  const head = parts.length ? `Synced — ${parts.join(', ')}.` : 'Synced.'
  /* NO SILENT CAPS. Three files move per pass; if more are waiting the panel
     says so, because a reader watching two of forty books arrive would
     otherwise conclude it had failed. */
  return r.filesLeft ? `${head} ${r.filesLeft} more still to move — they go a few at a time while the app is open.` : head
}

export function SyncPanel() {
  const [on, setOn] = useState(optedIn())
  const [who, setWho] = useState(account())
  const [at, setAt] = useState(lastSync())
  /* Held in state rather than read at render. `refresh` is what the sync event
     calls, and setting states to the values they already hold makes React bail
     out of the render entirely — so a background sync that shut the quiet path
     announced it to a panel that never redrew. */
  const [stale, setStale] = useState(needsSignIn())
  const [files, setFiles] = useState(filesIncluded())
  const [room, setRoom] = useState<{ used: number; limit: number | null } | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [asking, setAsking] = useState<{ device: string; at: number } | null>(null)
  const [dropping, setDropping] = useState(false)

  const refresh = useCallback(() => {
    setOn(optedIn())
    setWho(account())
    setAt(lastSync())
    setStale(needsSignIn())
    setFiles(filesIncluded())
  }, [])

  useEffect(() => {
    if (!SYNC_AVAILABLE) return
    /* Google's script is fetched now rather than inside the press that needs
       it: Safari only lets a popup open from within the gesture that asked,
       and a network round trip mid-gesture spends that permission. */
    warmUp()
    window.addEventListener(SYNC_EVENT, refresh)
    return () => window.removeEventListener(SYNC_EVENT, refresh)
  }, [refresh])

  /* The Drive allowance, fetched once while connected, because the sentence
     beside the book-files switch is about somebody's own storage and a number
     they can check beats an adjective. Failure is silence: the switch does not
     depend on knowing. */
  useEffect(() => {
    if (!SYNC_AVAILABLE || !on || stale) return
    let alive = true
    void driveRoom()
      .then((r) => {
        if (alive) setRoom(r)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [on, stale])

  if (!SYNC_AVAILABLE) return null

  const say = (text: string) => {
    setMsg(text)
    setErr('')
  }
  const fail = (e: unknown) => {
    setErr(e instanceof Error ? e.message : 'Something went wrong talking to Google.')
    setMsg('')
  }

  const connect = async () => {
    setBusy('connect')
    setErr('')
    setMsg('')
    try {
      /* Held until the question below is answered, so nothing merges
         underneath it. */
      pauseAutoSync()
      await signIn()
      refresh()
      if (await hasUnsharedWork()) {
        const other = await otherLibrary()
        if (other) {
          setAsking(other)
          return
        }
      }
      resumeAutoSync()
      const r = await syncNow()
      refresh()
      say(r.unchanged ? 'Connected. Everything was already up to date.' : `Connected. ${tally(r)}`)
    } catch (e) {
      resumeAutoSync()
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const merge = async () => {
    setAsking(null)
    setBusy('sync')
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

  const now = async () => {
    setBusy('sync')
    try {
      const r = await syncNow()
      refresh()
      say(tally(r))
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  /* THE WAY BACK. Without it the panel is a dead end: the silent path shuts
     for six hours after Google refuses to renew access unasked, and Sync now
     takes that same path — so it throws before a window can open, and the only
     escape was to disconnect and connect again. This is the same press as
     Connect, minus the merge question, which was answered when this device
     first joined. */
  const resume = async () => {
    setBusy('signin')
    setErr('')
    setMsg('')
    try {
      await signIn()
      const r = await syncNow()
      refresh()
      say(r.unchanged ? 'Signed in. Everything was already up to date.' : `Signed in. ${tally(r)}`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const disconnect = async () => {
    setBusy('off')
    try {
      await signOut()
      refresh()
      say('Disconnected. The copy in your Drive was left alone.')
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const drop = async () => {
    setDropping(false)
    setBusy('drop')
    try {
      /* Interactive, because this has to work for somebody who disconnected
         first and then thought better of leaving the copy behind. */
      const n = await forgetDrive(true)
      await signOut()
      refresh()
      say(
        n
          ? 'The copy was removed from your Drive. Your library here is untouched.'
          : 'There was nothing in your Drive to remove.',
      )
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  const toggleFiles = () => {
    const next = !files
    includeFiles(next)
    setFiles(next)
    if (next) say('The book files will go up a few at a time while the app is open.')
    else say('Only the record syncs now. Files already in your Drive stay there until you remove the copy.')
  }

  return (
    <section className="panel">
      <p className="ui-lbl">Google Drive sync</p>

      {/* STATE FIRST, and it opens with a single word, so the answer to "am I
          synced?" is the first thing read: Off / On / Paused. The ways out sit
          below the action, never beside the sentence describing the state. */}
      <p className="ui-p" style={{ marginTop: 8 }}>
        {!on ? (
          <>
            Off. Your library lives on this device only. Turn this on and a copy is kept in a
            hidden folder of your own Google Drive — one this app can see and no other app can — so
            the same shelf, the same highlights and the same page appear on your other devices.
            Nothing is ever sent to us.
          </>
        ) : stale ? (
          <>
            Paused. Signed in as {who || 'your Google account'}
            {at ? `, last synced ${ago(at)}` : ', not synced yet'}. Google won’t renew this device’s
            access without being asked, so nothing has synced since. Nothing is lost — your library
            is here, and the copy in your Drive is where you left it.
          </>
        ) : (
          <>
            On, syncing to {who || 'your Google account'}
            {' · '}
            {at ? `last synced ${ago(at)}` : 'not synced yet'}.
          </>
        )}
      </p>

      {on && !stale && (
        <p className="ui-p ui-p--soft" style={{ marginTop: 8 }}>
          Syncing happens by itself — after you close a book, when you come back to the app, and
          every minute or two while it is open. Reading settings stay on the device that set them: a
          phone’s type size is a poor fit for a laptop.
        </p>
      )}

      {!on && (
        <div className="set-acts">
          <button className="btn btn--sm" type="button" onClick={() => void connect()} disabled={!!busy}>
            {busy === 'connect' ? 'Connecting…' : 'Connect Google Drive'}
          </button>
        </div>
      )}

      {on && (
        <>
          {stale ? (
            /* THE ONLY PRESS THAT WORKS IN THIS STATE, so it is the primary
               one. Sync now takes the silent path and would throw before a
               window could open. */
            <div className="set-acts">
              <button className="btn btn--sm" type="button" onClick={() => void resume()} disabled={!!busy}>
                {busy === 'signin' ? 'Signing in…' : 'Sign in to Google again'}
              </button>
            </div>
          ) : (
            <>
              {/* THE BOOK FILES ARE A SECOND DECISION, and it belongs to the
                  reader rather than to us: the record of a hundred books is
                  well under a megabyte, and the books themselves can be
                  hundreds. But it is on by default now. It was off, and off is
                  indefensible as a starting state: the other device gets a
                  shelf of rows it cannot open and cannot even draw a cover
                  for, because the cover travels inside the file bundle and
                  nowhere else. Turning it off is a decision to make with a
                  working sync in front of you, not a wall to find on a new
                  device. */}
              <div className="set-switch" style={{ marginTop: 18 }}>
                <span className="ui-p">Carry the book files too</span>
                <button
                  type="button"
                  role="switch"
                  className="sw"
                  aria-checked={files}
                  aria-label="Carry the book files too"
                  disabled={!!busy}
                  onClick={toggleFiles}
                >
                  <span className="sw-knob" aria-hidden="true" />
                </button>
              </div>
              <p className="ui-p ui-p--soft" style={{ marginTop: 8 }}>
                {files
                  ? 'A book opened on one device can be opened on the others without finding the file again. It uses your Drive space, and a large book takes a while.'
                  : 'Only the record travels — the shelf, where you are, and every highlight. On another device those books have no cover and will not open until you find the file again.'}
              </p>
              {room && (
                <p className="mono-meta" style={{ marginTop: 12 }}>
                  {room.limit === null
                    ? `${bytes(room.used)} used in your Drive`
                    : `${bytes(room.used)} of ${bytes(room.limit)} used in your Drive`}
                </p>
              )}

              <div className="set-acts">
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => void now()} disabled={!!busy}>
                  {busy === 'sync' ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* The paused sentence is the state paragraph's whole subject, and a
          failed background sync hands back those same words — printed here as
          well, they would appear twice in one panel. */}
      {(msg || err) && !(stale && err === STALE) && (
        <p className={err ? 'ui-p ui-p--warn' : 'mono-meta'} role="status" style={{ marginTop: 14 }}>
          {err || msg}
        </p>
      )}

      {asking && (
        /* ASKED IN THE PANEL, not over it. This app has no modal confirm, and
           the inline block is what a restore uses two panels down — the same
           shape for the same kind of decision. */
        <div className="set-confirm">
          <p className="ui-p">
            There is already a library in this Google account, last changed on{' '}
            {asking.device || 'another device'}
            {asking.at ? ` ${ago(asking.at)}` : ''}.
          </p>
          <p className="ui-p ui-p--soft" style={{ marginTop: 8 }}>
            Bringing them together keeps everything from both sides — every book, every highlight
            and the furthest page in each. Nothing on this device is replaced or removed.
          </p>
          <div className="set-acts" style={{ marginTop: 14 }}>
            <button className="btn btn--sm" type="button" disabled={!!busy} onClick={() => void merge()}>
              {busy === 'sync' ? 'Bringing together…' : 'Bring them together'}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={!!busy}
              onClick={() => {
                setAsking(null)
                resumeAutoSync()
                say('Left as it was. Nothing has been merged — press Sync now when you want to join them.')
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {on && !stale && !asking && (
        /* THE TWO WAYS OUT, adjacent, because the only thing separating them is
           whether the copy in Drive survives. They used to be a button beside
           Sync now and a red plate below it — and the plate, sitting directly
           under a line saying "Synced", read as a report that the sync had
           failed. Rows instead: the label states the outcome plainly, the
           danger lives on the button alone, and the sentence about what cannot
           be undone waits for the press. Press's shape, verbatim. */
        <div className="set-rows">
          <div className="set-row set-row--stack">
            <div className="set-row-txt">
              <div className="ui-lbl">Stop syncing</div>
              <p>
                Ends syncing on this device. The copy already in your Drive is left where it is, so
                connecting again picks it back up.
              </p>
            </div>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={!!busy}
              onClick={() => void disconnect()}
            >
              {busy === 'off' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
          <div className="set-row set-row--stack">
            <div className="set-row-txt">
              <div className="ui-lbl">Remove the copy from Drive</div>
              {/* worth saying where it can be done: the folder is hidden from
                  Drive's own screens, so this button is the only way out */}
              <p>
                Deletes the copy from your Drive — the only place this can be done — and
                disconnects. Your library here is untouched, but any other device that was syncing
                will stop finding it.
              </p>
            </div>
            {dropping ? (
              /* ASKED IN THE ROW, not over it. This app has no modal confirm,
                 and the inline block is what the merge above and the restore two
                 panels down both use. */
              <div className="set-confirm">
                <p className="ui-p">This cannot be undone from here or from Drive.</p>
                <div className="set-acts" style={{ marginTop: 14 }}>
                  <button className="btn btn--danger btn--sm" type="button" disabled={!!busy} onClick={() => void drop()}>
                    {busy === 'drop' ? 'Removing…' : 'Remove the copy'}
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    disabled={!!busy}
                    onClick={() => setDropping(false)}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn--danger btn--sm"
                type="button"
                disabled={!!busy}
                onClick={() => setDropping(true)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
