import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { DEFAULT_SETTINGS, clearDismissedSeeds, db, saveSettings, useSettings } from '../db'
import { checkForUpdate, isIOS, promptInstall, requestPersistence, useInstall } from '../pwa'
import { SEEDS, reseed } from '../seed'
import { bytes, shortDate } from '../lib'
import { ANY_FILE } from '../import'
import { BackupRefused, backupName, exportBackup, importBackup, inspectBackup } from '../backup'
import type { BackupSummary, RestoreResult } from '../backup'
import type { Settings } from '../types'
import { LeaveIcon } from '../components/icons'
import { SyncPanel } from '../components/SyncPanel'
import { Tip } from '../components/Tip'
import { Erase } from '../components/Erase'

/* Everywhere this app points outside itself, in one place.

   THREE apps, not two, and they are not one product under one name. Flyleaf
   came first and is the reading JOURNAL — quotes, notes, voice memos,
   photographs, characters and plot threads on one timeline per book. Flyleaf
   Press came second and is the REVIEW app — long reviews printed as cards,
   and every month and year collaged into what you finished. This is the
   third. An earlier version of this panel said "two apps, one name" and gave
   Press the journal's description, which got both of them wrong at once.

   The tip jar is NOT in here any more. It used to be a fourth entry pointing
   at Press's settings, on the reasoning that Press already runs the Paystack
   function and already holds the secret, so one working jar beat two. The
   reader's experience of that reasoning was tapping a row in this app and
   landing in a different app's settings with no explanation — "why is buy me a
   coffee redirecting to press flyleaf? it should have it's own." It has its
   own now: `components/Tip.tsx`, Paystack Inline on the public key, its own
   panel above this one. The trade-off that choice makes is written down there
   rather than here. */
const OUT = {
  journal: 'https://flyleaf.cc',
  press: 'https://press.flyleaf.cc',
  maker: 'https://simplypheyie.is-a.dev',
} as const

/** One destination outside the app. */
function Leave({ href, label, note }: { href: string; label: string; note: string }) {
  return (
    /* noreferrer as well as noopener: the target is the maker's own site in
       every case, and it has no business being told which page of a private
       reading app somebody was on when they left it. */
    <a className="set-link" href={href} target="_blank" rel="noopener noreferrer">
      <span className="set-link-txt">
        {/* Not .ui-lbl. Every other label on this page is uppercase and
            tracked, which is right for a caption naming a group and wrong for
            a destination inside one: rendered, the panel's own "FLYLEAF" and
            the row's "FLYLEAF PRESS" came out in identical type, so the rows
            read as more section headings rather than places you can go.
            Sentence case at 14px is the only thing in the panel that looks
            like a destination. */}
        <span className="set-link-name">{label}</span>
        <span className="ui-p ui-p--soft">{note}</span>
      </span>
      <span className="set-link-go" aria-hidden="true"><LeaveIcon /></span>
    </a>
  )
}

/* System first because it is the default, then the four in light/dark pairs —
   Light beside Sepia, Dark beside Ink — so the row reads as two grounds in two
   temperatures rather than a list of five unrelated words. */
const THEMES: { id: Settings['theme']; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' },
  { id: 'ink', label: 'Ink' },
]

export function SettingsPage() {
  /* Reads the live row and writes straight to it — no local mirror. The
     control's pressed state comes back through the query, which is what makes
     it impossible for this screen to show one thing while the app does
     another. */
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const install = useInstall()
  const [update, setUpdate] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [used, setUsed] = useState<number | null>(null)
  const [restoring, setRestoring] = useState(false)

  /* The backup panel. `pending` is a file the reader has picked and not yet
     committed: a restore writes to the library, so it says what is in the file
     first and asks. Nothing here is a mirror of the database — the only state
     is about the file in hand. */
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'export' | 'read' | 'restore' | null>(null)
  const [wrote, setWrote] = useState<string | null>(null)
  const [pending, setPending] = useState<{ file: File; sum: BackupSummary } | null>(null)
  const [withSettings, setWithSettings] = useState(true)
  const [restored, setRestored] = useState<RestoreResult | null>(null)
  const [refused, setRefused] = useState<string | null>(null)

  /* How many books are on the shelf, and how many of the included ones are
     not — the second is what makes Restore say something true rather than
     "done". Live, because Restore changes both while this screen is open. */
  const shelf = useLiveQuery(async () => {
    const total = await db.books.count()
    const present = await Promise.all(SEEDS.map((seed) => db.books.get(seed.id)))
    return { total, missing: present.filter((book) => !book).length }
  })

  /* Ask on arrival rather than behind a button. Chrome answers silently for an
     installed app, so a button would be a control that usually does nothing
     visible; and a reader who has come to Settings has already shown enough
     intent for the browser's own heuristics. What the button below does is
     report the answer. */
  useEffect(() => { requestPersistence().then(setPersisted) }, [])

  /* What the library actually costs on this device. An estimate, and named as
     one: the number the browser reports includes the app's own precache, and
     rounding it up into "your books" would be a lie by attribution. */
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsed(e.usage ?? null)).catch(() => undefined)
  }, [shelf?.total])

  const set = (patch: Partial<Settings>) => { void saveSettings(patch) }

  const runExport = async () => {
    setBusy('export'); setWrote(null); setRefused(null)
    try {
      const now = Date.now()
      const { blob, summary } = await exportBackup(now)
      const name = backupName(now)
      /* An anchor and an object URL, revoked on the next frame. `showSaveFilePicker`
         would be the nicer path, but it is Chromium-only and this one is the same
         two lines everywhere — and on iOS, where a backup matters most because the
         storage is the most likely to be evicted, it is the only one there is. */
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.append(a); a.click(); a.remove()
      requestAnimationFrame(() => URL.revokeObjectURL(url))
      setWrote(`${name} · ${summary.books} ${summary.books === 1 ? 'book' : 'books'} · ${bytes(blob.size)}`)
    } catch {
      setRefused('The backup could not be written. If the device is very low on space, freeing some and trying again is the fix.')
    } finally { setBusy(null) }
  }

  const readPicked = async (file: File) => {
    setBusy('read'); setRefused(null); setRestored(null); setPending(null)
    try {
      setPending({ file, sum: await inspectBackup(file) })
    } catch (err) {
      setRefused(err instanceof BackupRefused ? err.message : 'That file could not be read.')
    } finally { setBusy(null) }
  }

  const runRestore = async () => {
    if (!pending) return
    setBusy('restore'); setRefused(null)
    try {
      setRestored(await importBackup(pending.file, { settings: withSettings }))
      setPending(null)
    } catch (err) {
      setRefused(err instanceof BackupRefused ? err.message : 'The restore stopped part way and nothing was changed.')
    } finally { setBusy(null) }
  }

  return (
    <main className="page">
      <div className="page-inner">
        <header className="app-head">
          <h1>Settings</h1>
          <span>Flyleaf eReader</span>
        </header>

        <section className="panel">
          <p className="ui-lbl">Theme</p>
          <p className="ui-p ui-p--soft" style={{ marginTop: 6 }}>
            The app around the book. The page the book is printed on is chosen
            separately, while you read — a dark room and a cream page is a
            combination, not a mistake.
          </p>
          <div className="seg" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="btn btn--ghost btn--sm btn--seg"
                aria-pressed={settings.theme === t.id}
                onClick={() => set({ theme: t.id })}
              >
                {/* The choice is a colour, so the control shows it. Named
                    alone, "Sepia" and "Ink" are guesses. */}
                <span className="seg-swatch" data-sw={t.id} aria-hidden="true" />
                {t.label}
              </button>
            ))}
          </div>
        </section>

        {/* SECOND of nine panels, and it has been moved twice. It started at the
            bottom, went to sixth, and was still "too far below" — so it stops
            being ranked by decorum and gets ranked by whether it can be seen.
            Second is the highest it can go without Settings opening on a
            donation ask: Theme is what somebody came here to change, and this
            sits directly under it, on screen at 390x844 without a scroll.

            Above the apps panel rather than inside it, still: a jar is not a
            destination, and the one place it must not be is a row in a list of
            other places to go. */}
        <Tip />

        <section className="panel">
          <p className="ui-lbl">This device</p>
          <p className="ui-p" style={{ marginTop: 8 }}>
            {install.installed
              ? 'Installed. The app runs from your home screen and works with no connection.'
              : install.canPrompt
                ? 'Install it and the app opens from your home screen, and can be set as the default opener for book files.'
                : isIOS()
                  ? 'To install: tap Share, then Add to Home Screen. iOS has no install button to offer — that menu is the whole mechanism.'
                  : 'Your browser has not offered an install for this app yet.'}
          </p>
          {install.canPrompt && (
            <div className="set-acts">
              <button className="btn btn--sm" type="button" onClick={() => void promptInstall()}>
                Install
              </button>
            </div>
          )}
        </section>

        <section className="panel">
          <p className="ui-lbl">Your library</p>
          <p className="ui-p" style={{ marginTop: 8 }}>
            Books, positions and highlights are stored on this device only. Nothing
            is uploaded, and an update to the app never clears them.
          </p>
          <p className="ui-p ui-p--soft" style={{ marginTop: 8 }}>
            {persisted === null
              ? 'Checking storage…'
              : persisted
                ? 'Storage is marked persistent — the browser has agreed not to evict your library to reclaim space.'
                : 'The browser has not granted persistent storage, so it may clear the library if the device runs very low on space. An exported backup is the answer to that, and it is the next panel down.'}
          </p>
          <p className="mono-meta" style={{ marginTop: 12 }}>
            {[
              shelf ? `${shelf.total} ${shelf.total === 1 ? 'book' : 'books'}` : null,
              used === null ? null : `${bytes(used)} used, app included`,
            ].filter(Boolean).join('  ·  ')}
          </p>
        </section>

        <section className="panel">
          <p className="ui-lbl">Backup</p>
          <p className="ui-p" style={{ marginTop: 8 }}>
            One file with every book, where you are in it, and every highlight, note
            and bookmark. It is written to this device and goes nowhere else — moving
            it somewhere safe is the part only you can do.
          </p>
          <div className="set-acts">
            <button className="btn btn--sm" type="button" disabled={busy !== null} onClick={() => void runExport()}>
              {busy === 'export' ? 'Writing…' : 'Export a backup'}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={busy !== null}
              onClick={() => picker.current?.click()}
            >
              {busy === 'read' ? 'Reading…' : 'Restore from a backup'}
            </button>
            <input
              ref={picker}
              type="file"
              /* `application/octet-stream` first, then the extension. Same
                 two-sided iOS problem as the book picker, and the reasoning is
                 with the constant (`src/import/index.ts` → ANY_FILE): the
                 extension alone is a whitelist, and `.flyleaf` is an extension
                 this app invented, so it is registered by nothing anywhere and
                 a reader's own backup became unpickable on the one platform
                 they are most likely to restore onto. Leaving the attribute off
                 fixed that and made Safari offer the camera instead.

                 `public.data` is also the honest answer here: a `.flyleaf` IS
                 an octet stream — a binary header, a blob table and the
                 payloads (`src/backup.ts`). inspectBackup() reads the file and
                 refuses a non-backup by name before anything is written, so the
                 content stays the authority either way. */
              accept={`${ANY_FILE},.flyleaf`}
              className="sr-only"
              /* Not a tab stop, and not in the accessibility tree: the button
                 beside it is the control, and it already says so. */
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.target.files?.[0]
                /* Cleared so picking the same file twice fires the second change. */
                event.target.value = ''
                if (file) void readPicked(file)
              }}
            />
          </div>

          {wrote && <p className="mono-meta" style={{ marginTop: 12 }}>{wrote}</p>}

          {pending && (
            /* The file, described, before it is allowed to write anything. A
               restore is the one control on this screen that changes books. */
            <div className="set-confirm">
              <p className="ui-p">
                {pending.sum.createdAt
                  ? `A backup from ${shortDate(pending.sum.createdAt)}.`
                  : 'A Flyleaf eReader backup.'}{' '}
                {[
                  `${pending.sum.books} ${pending.sum.books === 1 ? 'book' : 'books'}`,
                  `${pending.sum.highlights} ${pending.sum.highlights === 1 ? 'highlight' : 'highlights'}`,
                  `${pending.sum.bookmarks} ${pending.sum.bookmarks === 1 ? 'bookmark' : 'bookmarks'}`,
                ].join(', ')}.
              </p>
              <p className="ui-p ui-p--soft" style={{ marginTop: 8 }}>
                Restoring adds these to your library and brings back the position in each
                one. A book already here is replaced by the backup's copy of it; a book
                the backup has never heard of is left alone. Nothing is deleted.
              </p>
              <div className="set-switch">
                <span className="ui-p">Restore reading settings too</span>
                <button
                  type="button"
                  role="switch"
                  className="sw"
                  aria-checked={withSettings}
                  aria-label="Restore reading settings too"
                  disabled={busy !== null}
                  onClick={() => setWithSettings((v) => !v)}
                >
                  <span className="sw-knob" aria-hidden="true" />
                </button>
              </div>
              <div className="set-acts" style={{ marginTop: 14 }}>
                <button className="btn btn--sm" type="button" disabled={busy !== null} onClick={() => void runRestore()}>
                  {busy === 'restore' ? 'Restoring…' : 'Restore'}
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setPending(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {restored && (
            <p className="ui-p" style={{ marginTop: 12 }} role="status">
              {[
                restored.booksAdded ? `${restored.booksAdded} added to your library` : null,
                restored.booksUpdated ? `${restored.booksUpdated} already here, updated` : null,
                restored.highlights ? `${restored.highlights} ${restored.highlights === 1 ? 'highlight' : 'highlights'}` : null,
                restored.bookmarks ? `${restored.bookmarks} ${restored.bookmarks === 1 ? 'bookmark' : 'bookmarks'}` : null,
              ].filter(Boolean).join(' · ') || 'The backup was empty — nothing to restore.'}
              {/* Said out loud rather than swallowed: a truncated file restores
                  what it has, and the reader is told exactly what it did not. */}
              {restored.short
                ? ` · ${restored.short} ${restored.short === 1 ? 'file was' : 'files were'} missing from the backup, so ${restored.short === 1 ? 'that book has' : 'those books have'} no file to open.`
                : ''}
            </p>
          )}

          {refused && <p className="ui-p ui-p--warn" style={{ marginTop: 12 }} role="alert">{refused}</p>}
        </section>

        {/* Directly below the hand-carried backup, because the two answer the
            same worry and the honest difference between them is who does the
            carrying. Hides itself entirely when the app was built without a
            Google client ID. */}
        <SyncPanel />

        <section className="panel">
          <p className="ui-lbl">Included books</p>
          <p className="ui-p" style={{ marginTop: 8 }}>
            Flyleaf eReader ships with {SEEDS.length} public-domain books in your library. Delete
            them like any other book — an update will never put them back on its own.
            This is the only thing that does.
          </p>
          <div className="set-acts">
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              disabled={restoring}
              onClick={async () => {
                setRestoring(true)
                /* Clear the dismissals, then seed. Two steps rather than one
                   flag, because seeding is the same function first run uses —
                   there is no second path that could put a book on the shelf a
                   different way. */
                await clearDismissedSeeds()
                await reseed()
                setRestoring(false)
              }}
            >
              {restoring ? 'Restoring…' : 'Restore included books'}
            </button>
          </div>
          <p className="ui-p ui-p--soft" style={{ marginTop: 10 }}>
            {shelf === undefined
              ? ''
              : shelf.missing === 0
                ? 'All of them are in your library.'
                : `${shelf.missing} of ${SEEDS.length} ${shelf.missing === 1 ? 'is' : 'are'} not in your library right now.`}
          </p>
        </section>

        <section className="panel">
          <p className="ui-lbl">The Flyleaf apps</p>
          <p className="ui-p" style={{ marginTop: 8 }}>
            Three of them, built in this order, and none needs the others or an
            account. Flyleaf is the journal you keep while reading. Flyleaf Press is
            where a book becomes a written review afterwards. This one is the reader —
            it opens the file and gets out of the way.
          </p>
          <div className="set-links">
            <Leave
              href={OUT.journal}
              label="Flyleaf"
              note="The reading journal. Quotes, notes, voice memos and photographs on one timeline per book."
            />
            <Leave
              href={OUT.press}
              label="Flyleaf Press"
              note="Long reviews, printed as cards — and every month and year collaged into what you finished."
            />
            <Leave
              href={OUT.maker}
              label="Portfolio"
              note="Design and code, and the rest of the work."
            />
          </div>
        </section>

        <section className="panel">
          <p className="ui-lbl">The small print</p>
          {/* Four things a reader of a local-first app actually needs told, in
              the order they would want to know them: where their books live,
              what this refuses to open, whose books are already in your library,
              and what it is built out of. Plain sentences rather than a licence
              dump — the licences are named, which is what OFL and MIT ask for,
              and nobody has ever been helped by a wall of legal text in a
              settings page. */}
          <dl className="fine">
            <dt>Your books stay here</dt>
            <dd>
              There is no account and no server. Every book, highlight, note and
              position lives in this browser's storage on this device, and nothing
              about your reading is sent anywhere. Deleting the app — or clearing
              this site's data — deletes all of it, so export a backup first if you
              would miss it.
            </dd>
            <dt>No DRM, ever</dt>
            <dd>
              A protected file from Kindle, Kobo, Adobe or Google Play cannot be
              opened here and never will be. The app says so plainly when you hand
              it one rather than failing quietly or rendering nonsense.
            </dd>
            <dt>The included books</dt>
            <dd>
              {SEEDS.map((seed) => seed.label).join(' and ')} are in the public
              domain, from Project Gutenberg. Delete them like any other book.
            </dd>
            <dt>Built on other people's work</dt>
            <dd>
              Reflowable books are parsed and paginated by{' '}
              <span className="fine-name">foliate-js</span>, by John Factotum (MIT).
              PDFs use <span className="fine-name">PDF.js</span>, by Mozilla
              (Apache&nbsp;2.0). Every typeface — the nineteen families in the app
              and in the reader — is under the SIL Open Font License&nbsp;1.1.
            </dd>
            <dt>Not affiliated</dt>
            <dd>
              Flyleaf eReader has nothing to do with Apple, Amazon, Kobo, Google or any
              bookseller, and it is not endorsed by any of them. It comes with no
              warranty: it is one person's app, given away, and you use it at your
              own risk.
            </dd>
          </dl>
        </section>

        <Erase />
        <section className="panel">
          <p className="ui-lbl">Version</p>
          <p className="ui-p" style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 12.5 }}>
            {__APP_VERSION__} · {__APP_COMMIT__}
          </p>
          <div className="set-acts">
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={async () => {
                setUpdate('Looking…')
                const r = await checkForUpdate()
                setUpdate(
                  r === 'updating'
                    ? 'A newer version is installing. The app will reload itself.'
                    : r === 'current'
                      ? 'This is the latest version.'
                      : 'No service worker is registered, so there is nothing to check.'
                )
              }}
            >
              Check for updates
            </button>
          </div>
          {update && <p className="ui-p ui-p--soft" style={{ marginTop: 10 }}>{update}</p>}
        </section>
      </div>
    </main>
  )
}
