import { Link } from 'react-router-dom'
import { SEEDS } from '../seed'

/* The two pages Google requires of any app that signs people in with it, and
   that a reader is entitled to whether Google asks or not.

   They live in the app rather than on a marketing site because there is no
   marketing site: read.flyleaf.cc is the app. So they are built out of the
   same page shell as Settings — `main.page` → `.page-inner` → `.app-head` →
   `.panel` — and out of the same `.fine` definition list the small print
   already uses, which is the right shape for this: a named clause, then the
   sentence that explains it, skimmable for the one thing somebody came for.

   Every claim below was checked against the code before it was written, not
   assumed. The only measurement is Vercel's page-view count, with both id
   routes collapsed to their pattern before send (`main.tsx`), the complete list of hosts the
   app can ever reach is the list in "When this app talks to the internet",
   the Wiktionary row is a user-tapped link that is absent offline
   (`reader/Panel.tsx`), sync goes only to Flyleaf's own server at
   api.flyleaf.cc (`sync/cloud.ts`), and the old Drive sync is reduced to a
   one-time bring-in that reads and deletes only appDataFolder
   (`sync/drive.ts`). If any of that changes, these pages change with it. */

/** Sentence-cased, so it reads as a date and not as a version string. */
const UPDATED = '22 October 2026'

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
            Flyleaf eReader needs no account. Your books, your highlights, your
            notes and your place in each one are held in this browser's storage
            on this device. Nothing about <em>what</em> you read leaves the device
            unless you sign in to sync it, and you can sign out, or remove what
            was synced, from Settings at any time. The one thing
            that is counted is how many people open the app, and that count can
            never say which book.
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
            <dt>What is counted, and what is not</dt>
            <dd>
              Vercel, which hosts this app, counts page views: a visit, the page
              shape, a rough country, and where the visit came from. It sets no
              cookie and builds no profile of you. Before anything is sent, the
              two addresses that carry a book's identity are rewritten to
              <code>/read/:id</code> and <code>/book/:id</code> — so the count can
              say a book was opened, and never which one. There is no crash
              reporting, no advertising identifier and no other third-party
              script on the page, and nothing about your library is ever part
              of the count.
            </dd>
            <dt>If you sign in to sync</dt>
            <dd>
              Your shelf, your highlights, notes and bookmarks, your place in each
              book, and the book files themselves are kept on Flyleaf's servers,
              which run on Cloudflare. They are stored against your account,
              encrypted in transit and at rest, and handed only to devices signed
              in to that account. They are not read, and not used for anything
              but giving them back to you. A book file larger than 25 MB is not
              uploaded and stays on the device it was added on. When two devices
              sync they merge on the devices, so neither overwrites the other.
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
              content delivery network. Apart from the page-view count above,
              no third party is involved in serving you this app.
            </dd>
          </dl>
        </section>

        <section className="panel">
          <p className="ui-lbl">When this app talks to the internet</p>
          <p className="ui-p ui-p--soft" style={{ marginTop: 8 }}>
            Six occasions, and this is the complete list. Five of them are
            optional; the page-view count is the one that is not.
          </p>
          <dl className="fine">
            <dt>The page-view count — always on</dt>
            <dd>
              Each page you open sends Vercel one measurement, described in full
              under "What is counted, and what is not" above. It is the only part
              of this list you cannot turn off inside the app; a content blocker
              or your browser's Do Not Track setting will stop it, and the app
              works exactly the same either way, offline included.
            </dd>
            <dt>Syncing — only if you sign in</dt>
            <dd>
              Google signs you in, under{' '}
              <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
                its privacy policy
              </a>
              , and tells the app only your name and email address. From then on
              the app talks to Flyleaf's own server at api.flyleaf.cc, run on{' '}
              <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">
                Cloudflare
              </a>
              , which records ordinary request information as any host does.
              Signing out stops it.
            </dd>
            <dt>The old Google Drive copy — only if you press it</dt>
            <dd>
              An older version synced through a hidden folder in your own Google
              Drive. If you used it, Settings offers to bring that copy in and to
              remove it from Drive; either asks Google for permission to that one
              hidden folder only, and only when you press it.
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
              Sign out in Settings and this device stops syncing immediately. Your
              library on this device, and the copy in your account, are untouched.
            </dd>
            <dt>Delete what was synced</dt>
            <dd>
              "Remove my library from Flyleaf" in Settings deletes your library
              and every book file from Flyleaf's servers, and signs the device
              out. It never touches the library on this device. "Remove the
              Google Drive copy", shown only if you used the older Drive sync,
              deletes only the files that version put in its hidden folder.
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
            The app is not directed at children and builds no profile of anyone,
            of any age. What sync keeps is your own library, kept for you and
            nothing else.
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
            It opens book files you already have. It does not sell books, needs no
            account unless you choose to sync, and makes no claim on anything you open in
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
              to. No licence key, no seat count, and no sign-in unless you want
              your library on more than one device.
            </dd>
            <dt>Sync, if you sign in</dt>
            <dd>
              Signing in with Google keeps your library on Flyleaf's servers so it
              follows you between devices. It is free and offered as it is: a book
              file over 25 MB stays on the device it was added on, and book files
              across the Flyleaf apps share 1 GB per account. Keep a backup of
              anything you would miss.
            </dd>
            <dt>Keep what you make</dt>
            <dd>
              Highlights, notes and bookmarks are yours. Export them whenever you
              want. Nothing you write in this app is claimed, licensed or read by
              anyone else, synced or not.
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
