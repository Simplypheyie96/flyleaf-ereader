import { Link } from 'react-router-dom'
import { SEEDS } from '../seed'

/* The two pages Google requires of any app that asks for a Drive scope, and
   that a reader is entitled to whether Google asks or not.

   They live in the app rather than on a marketing site because there is no
   marketing site: read.flyleaf.cc is the app. So they are built out of the
   same page shell as Settings — `main.page` → `.page-inner` → `.app-head` →
   `.panel` — and out of the same `.fine` definition list the small print
   already uses, which is the right shape for this: a named clause, then the
   sentence that explains it, skimmable for the one thing somebody came for.

   Every claim below was checked against the code before it was written, not
   assumed. No analytics anywhere (`main.tsx`), the complete list of hosts the
   app can ever reach is the four in "When this app talks to the internet",
   the Wiktionary row is a user-tapped link that is absent offline
   (`reader/Panel.tsx`), and Drive sync writes only to appDataFolder
   (`sync/drive.ts`). If any of that changes, these pages change with it. */

/** Sentence-cased, so it reads as a date and not as a version string. */
const UPDATED = '23 August 2026'

/** Shared foot: back to where a reader almost certainly came from, plus the
    other document, because somebody reading one usually wants both. */
function Foot({ other, label }: { other: string; label: string }) {
  return (
    <section className="panel">
      <p className="ui-lbl">Elsewhere</p>
      <div className="set-acts">
        <Link className="btn btn--ghost btn--sm" to={other}>{label}</Link>
        <Link className="btn btn--ghost btn--sm" to="/settings">Back to settings</Link>
      </div>
    </section>
  )
}

export function PrivacyPage() {
  return (
    <main className="page">
      <div className="page-inner page-inner--legal">
        <header className="app-head">
          <h1>Privacy</h1>
          <span>Flyleaf eReader</span>
        </header>

        <section className="panel">
          <p className="ui-lbl">The short version</p>
          <p className="ui-p" style={{ marginTop: 8 }}>
            Flyleaf eReader has no account, no server of its own and no analytics
            of any kind. Your books, your highlights, your notes and your place in
            each one are held in this browser's storage on this device. Nothing
            about what you read leaves the device unless you switch on Google
            Drive sync yourself, and you can switch it off again in Settings.
          </p>
          <p className="ui-p ui-p--soft" style={{ marginTop: 12 }}>
            Last updated {UPDATED}.
          </p>
        </section>

        <section className="panel">
          <p className="ui-lbl">What is stored, and where</p>
          <dl className="fine">
            <dt>On this device</dt>
            <dd>
              The book files you open, the covers and metadata read out of them,
              every highlight, note and bookmark you make, your position in each
              book, and your settings. All of it sits in this site's IndexedDB
              storage in this browser. Clearing this site's data, or deleting the
              installed app, deletes all of it — so export a backup from Settings
              first if you would miss it.
            </dd>
            <dt>Nothing is collected</dt>
            <dd>
              There is no telemetry, no crash reporting, no advertising identifier
              and no third-party script watching the page. No page views are
              counted. Nobody, including the person who made this, can see which
              books are in your library or what you have underlined in them.
            </dd>
            <dt>The two included books</dt>
            <dd>
              {SEEDS.map((seed) => seed.label).join(' and ')} ship inside the app
              as ordinary files. Loading them onto your shelf is a local copy, not
              a download, and deleting them is permanent until you restore them
              from Settings.
            </dd>
            <dt>Fonts and the app itself</dt>
            <dd>
              Every typeface is served from this app's own domain and cached for
              offline use. No font, stylesheet or script is fetched from a
              content delivery network, so no third party learns that you opened
              the app.
            </dd>
          </dl>
        </section>

        <section className="panel">
          <p className="ui-lbl">When this app talks to the internet</p>
          <p className="ui-p ui-p--soft" style={{ marginTop: 8 }}>
            Four occasions, all of them optional, and this is the complete list.
          </p>
          <dl className="fine">
            <dt>Google Drive sync — only if you turn it on</dt>
            <dd>
              If you sign in from Settings, the app asks Google for two things:
              the address of the account you signed in with, so it can show you
              which one is connected, and permission to use its own hidden
              application folder in your Drive. Google describes that permission
              as seeing, creating and deleting <em>its own</em> configuration
              data — it cannot see, list or touch any other file in your Drive,
              including files put there by other apps. Into that folder the app
              writes a copy of your shelf, your highlights and notes, your
              positions, and the book files themselves, so a second device can
              pick up where the first left off. Signing out stops it; "Remove the
              copy from Drive" in Settings deletes what is there.
            </dd>
            <dt>A tip — only if you send one</dt>
            <dd>
              The tip jar opens Paystack's own secure form. Card details are
              typed into Paystack, never into this app, and the app never
              receives or stores them. Nothing is charged unless you complete
              the form yourself.
            </dd>
            <dt>A word you looked up — only if you tap it</dt>
            <dd>
              Looking up a word shows the app's own offline definition first. Under
              it is a single link to Wiktionary, which opens in your browser only
              if you tap it, and which is not shown at all when you are offline.
              Nothing is sent to Wiktionary until you choose to go there.
            </dd>
            <dt>The links out of Settings</dt>
            <dd>
              Settings links to the two sibling Flyleaf apps and to the maker's
              portfolio. Those are ordinary links: nothing is sent until you
              follow one, and each is marked as leaving the app.
            </dd>
          </dl>
        </section>

        <section className="panel">
          <p className="ui-lbl">Your choices</p>
          <dl className="fine">
            <dt>Turn sync off</dt>
            <dd>
              Sign out in Settings and the app stops talking to Drive
              immediately. Your library on this device is untouched. You can also
              remove Google's permission entirely from your Google Account's
              third-party access page, which the app cannot do on your behalf.
            </dd>
            <dt>Delete the Drive copy</dt>
            <dd>
              "Remove the copy from Drive" deletes only the files this app put
              in its own hidden folder. It cannot reach anything else in your
              Drive, and it never touches the library on this device.
            </dd>
            <dt>Take your data with you</dt>
            <dd>
              Export a backup from Settings at any time. It is a single file
              containing your books, marks and positions, readable by this app on
              any device, and it is yours.
            </dd>
            <dt>Erase everything</dt>
            <dd>
              "Erase everything" in Settings empties this app's storage on this
              device. Uninstalling the app or clearing the site's data in your
              browser does the same thing.
            </dd>
          </dl>
        </section>

        <section className="panel">
          <p className="ui-lbl">Children, and getting in touch</p>
          <p className="ui-p" style={{ marginTop: 8 }}>
            The app is not directed at children and collects nothing from anyone,
            of any age. There is no profile to build because there is nothing
            collected to build one out of.
          </p>
          <p className="ui-p" style={{ marginTop: 12 }}>
            If something here is unclear or looks wrong, the contact route is the
            maker's site, linked from the bottom of{' '}
            <Link to="/settings">Settings</Link>. This policy applies to Flyleaf
            eReader only — the two sibling apps are separate products with their
            own storage, their own permissions and their own policies.
          </p>
        </section>

        <Foot other="/terms" label="Terms of use" />
      </div>
    </main>
  )
}

export function TermsPage() {
  return (
    <main className="page">
      <div className="page-inner page-inner--legal">
        <header className="app-head">
          <h1>Terms of use</h1>
          <span>Flyleaf eReader</span>
        </header>

        <section className="panel">
          <p className="ui-lbl">The short version</p>
          <p className="ui-p" style={{ marginTop: 8 }}>
            Flyleaf eReader is free, made by one person, and given away as it is.
            It opens book files you already have. It does not sell books, does not
            hold an account for you, and makes no claim on anything you open in
            it or write in it — your books, your highlights and your notes are
            yours. In exchange, it comes with no warranty and no guarantee that
            it will keep working.
          </p>
          <p className="ui-p ui-p--soft" style={{ marginTop: 12 }}>
            Last updated {UPDATED}.
          </p>
        </section>

        <section className="panel">
          <p className="ui-lbl">What you may do</p>
          <dl className="fine">
            <dt>Read your own files</dt>
            <dd>
              Open any book file you have the right to read, on as many devices
              as you like, online or off. Install it to a home screen if you want
              to. No licence key, no seat count, no sign-in.
            </dd>
            <dt>Keep what you make</dt>
            <dd>
              Highlights, notes and bookmarks are yours. Export them whenever you
              want. Nothing you write in this app is claimed, licensed or read by
              anyone else.
            </dd>
            <dt>What you are responsible for</dt>
            <dd>
              That you are allowed to have the files you open. The app has no way
              of knowing where a file came from and does not ask; that side of it
              is yours.
            </dd>
          </dl>
        </section>

        <section className="panel">
          <p className="ui-lbl">What the app will not do</p>
          <dl className="fine">
            <dt>No protected files</dt>
            <dd>
              Files locked with DRM — from Kindle, Kobo, Adobe or Google Play —
              cannot be opened here and never will be. The app says so plainly
              when you hand it one rather than failing quietly. Do not ask it to
              strip protection from a file; it has no such feature and will not
              be given one.
            </dd>
            <dt>No bookshop</dt>
            <dd>
              Nothing is for sale. The only books the app supplies are the two
              public-domain titles it ships with, from Project Gutenberg, which
              you may delete.
            </dd>
            <dt>No AI</dt>
            <dd>
              Nothing you read or write here is sent to a language model. There is
              no summarising, no rewriting and no chat, by decision rather than by
              omission.
            </dd>
          </dl>
        </section>

        <section className="panel">
          <p className="ui-lbl">No warranty, and the limit of liability</p>
          <p className="ui-p" style={{ marginTop: 8 }}>
            The app is provided as it is, without warranty of any kind, express or
            implied, including any warranty of fitness for a particular purpose.
            It may contain faults. It may fail to open a file it looks like it
            should open. A future version may behave differently.
          </p>
          <p className="ui-p" style={{ marginTop: 12 }}>
            Because everything is held in your browser's storage, that storage is
            the single point of failure: a browser that evicts it, a cleared
            site, an uninstalled app or a lost device takes the library with it.
            Export a backup, and keep the original book files. To the fullest
            extent the law allows, the maker is not liable for lost books, lost
            notes or lost reading positions, and nothing here removes a right you
            have under the law of your own country that cannot be signed away.
          </p>
        </section>

        <section className="panel">
          <p className="ui-lbl">The small print of the small print</p>
          <dl className="fine">
            <dt>Not affiliated</dt>
            <dd>
              Flyleaf eReader has nothing to do with Apple, Amazon, Kobo, Google
              or any bookseller, and is endorsed by none of them. Format names and
              trade marks belong to their owners and are used only to say what the
              app can open.
            </dd>
            <dt>Other people's work</dt>
            <dd>
              Reflowable books are parsed by{' '}
              <span className="fine-name">foliate-js</span> (MIT); PDFs by{' '}
              <span className="fine-name">PDF.js</span> (Apache&nbsp;2.0). Every
              typeface is under the SIL Open Font License&nbsp;1.1. Those licences
              govern those parts.
            </dd>
            <dt>If these terms change</dt>
            <dd>
              The date at the top changes with them, and the app updates itself in
              the background. An update never clears your local data. Continuing
              to use the app after a change means the new version applies; if you
              would rather it did not, export a backup and uninstall.
            </dd>
          </dl>
        </section>

        <Foot other="/privacy" label="Privacy" />
      </div>
    </main>
  )
}
