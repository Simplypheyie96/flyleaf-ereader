/* Signing in to Google, and nothing more than that.

   WHY THIS IS THE SHAPE IT IS. Flyleaf eReader has no server and does not want
   one — the library is local, and that is the promise. So sync does not mean
   "our database holds your books": it means the library is written into the
   user's OWN Google Drive, into a hidden folder only this app can see
   (`appDataFolder`). We never hold a copy, we never see it, and the storage it
   uses is theirs. That is the only version of sync this app could honestly
   offer, and it is also the only one that stays free.

   NO CLIENT SECRET, ANYWHERE. This is Google Identity Services' token flow,
   designed for exactly this: a browser app with no backend. The client ID is
   public by design — it is compiled into the JavaScript every visitor
   downloads, and that is fine, because a client ID is not a credential. The
   client SECRET is never used, never stored, and must never appear in this
   repo.

   THE SCOPE IS ONE LINE, AND IT MATTERS. `drive.appdata` grants access to a
   folder this app creates and nothing else: not their documents, not their
   photos, not one other file in their Drive.

   THIS FILE IS PORTED FROM FLYLEAF PRESS, deliberately near-verbatim. The two
   apps ask Google for exactly the same thing in exactly the same situation,
   and every paragraph below is a failure somebody hit once. Rewriting it here
   would mean finding them all again. Only the storage keys differ, so the two
   apps cannot read each other's opt-in flag.

   TOKENS LIVE IN MEMORY ONLY. An access token is good for about an hour and is
   never written to disk. What IS remembered is a flag saying "this device
   opted in", which lets us ask Google for a fresh token silently rather than
   putting a popup in front of somebody who already said yes. */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
/* `drive.appdata` is the only scope that touches a file. `userinfo.email`
   grants one fact and no more: the address of the account that just signed in,
   so Settings can say WHICH Google this device backs up to. Somebody with two
   accounts could not otherwise tell whether the phone and the laptop were even
   talking to the same Drive. */
const DRIVE = 'https://www.googleapis.com/auth/drive.appdata'
const SCOPE = `${DRIVE} https://www.googleapis.com/auth/userinfo.email`
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const WHO = 'https://www.googleapis.com/oauth2/v3/userinfo'

/** Remembers only that this device opted in — never a token. */
const OPTED_IN_KEY = 'flyleaf-ereader-sync-on'
/** The address on the line in Settings. A label, not a credential. */
const ACCOUNT_KEY = 'flyleaf-ereader-google-account'

/** Fired whenever anything a Settings row displays has moved. */
export const SYNC_EVENT = 'flyleaf-ereader-sync'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  /** The permissions Google actually granted, space-separated — which is not
      always the ones we asked for. See the DRIVE check below. */
  scope?: string
  error?: string
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: { type?: string }) => void
          }): TokenClient
          revoke(token: string, done?: () => void): void
        }
      }
    }
  }
}

/** False when no client ID was built in. The whole feature hides itself rather
    than offering a button that opens onto an error. */
export const SYNC_AVAILABLE = CLIENT_ID.length > 0

let token: string | null = null
let expiresAt = 0
let client: TokenClient | null = null
let loading: Promise<void> | null = null
/* One request at a time: Google's callback is a single slot on the client, so
   a second overlapping call would resolve the first. */
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null
/* When the last token request went out, so `error_callback` can tell a
   rejected origin from a person shutting the window. See its comment. */
let askedAt = 0
/* The watchdog for that slot. GIS calls back on success, and on the failures it
   recognises — a closed popup, a blocked popup. It calls back on NEITHER when
   the popup dies on a page of Google's own: the window is still open, so
   nothing was closed, and no token is coming, so nothing succeeded. Without
   this the slot never settles and the button reads "Connecting…" until reload.

   Generous on purpose. This is the last resort after somebody has read a
   consent screen, picked between accounts, possibly typed a password — cutting
   that short would cancel a sign-in that was going perfectly well. A silent
   refresh puts no window on screen and gets a short leash instead. */
let watchdog: ReturnType<typeof setTimeout> | null = null
const PATIENCE = { interactive: 180_000, silent: 30_000 }

/** Empty the single slot, cancelling its watchdog. Every path out of a token
    request goes through here, so the slot can never be left holding a promise
    nobody is going to settle. */
function settle(): typeof pending {
  const waiting = pending
  pending = null
  if (watchdog !== null) {
    clearTimeout(watchdog)
    watchdog = null
  }
  return waiting
}

function announce() {
  window.dispatchEvent(new Event(SYNC_EVENT))
}

export function optedIn(): boolean {
  try {
    return localStorage.getItem(OPTED_IN_KEY) === '1'
  } catch {
    return false
  }
}

/** The signed-in address, or an empty string when it is not known yet. */
export function account(): string {
  try {
    return localStorage.getItem(ACCOUNT_KEY) ?? ''
  } catch {
    return ''
  }
}

/** True while this device holds a live token — so a caller can tell "about to
    sync quietly" from "about to need Google's window" BEFORE it starts doing
    anything asynchronous. Safari only lets a popup open inside the gesture
    that asked for it, so that has to be answerable synchronously. */
export function tokenHeld(): boolean {
  return token !== null && Date.now() < expiresAt
}

/* THE SILENT PATH CAN BE SHUT, AND THEN IT MUST STOP KNOCKING.

   `prompt: 'none'` is a real window — one Google opens and closes again in the
   same breath. When it works nobody sees more than a flicker. When the browser
   will not allow it (Safari blocks a popup no tap asked for, and blocks
   third-party cookies besides) it fails, and without this the app would try
   again on the very next write — a Google window flashing on every edit.

   So a silent refusal closes the silent path for a good while. Sync stops
   trying by itself, Settings says so in words, and the next real tap through
   Google's window opens it again. */
const REST = 6 * 60 * 60 * 1000
let quietUntil = 0

/** True when a background sync would have to interrupt somebody to proceed. */
export function needsSignIn(): boolean {
  return optedIn() && !tokenHeld() && Date.now() < quietUntil
}

function keep(address: string) {
  try {
    if (address) localStorage.setItem(ACCOUNT_KEY, address)
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch {
    /* See remember(): the sync still works, it is only unlabelled. */
  }
  announce()
}

/** Ask Google who this is, once, and never block anything on the answer. */
async function learnAccount(access: string) {
  try {
    const response = await fetch(WHO, { headers: { Authorization: `Bearer ${access}` } })
    if (!response.ok) return
    const who = (await response.json()) as { email?: string }
    if (who.email && who.email !== account()) keep(who.email)
  } catch {
    /* An unnamed account is a smaller failure than a backup that refused to
       run because it could not read a label. */
  }
}

function remember(on: boolean) {
  try {
    if (on) localStorage.setItem(OPTED_IN_KEY, '1')
    else localStorage.removeItem(OPTED_IN_KEY)
  } catch {
    /* Private mode. Sync still works for this visit; it just will not resume
       by itself next time. */
  }
  announce()
}

/* A SCRIPT THAT NEVER ARRIVES ALSO NEVER ERRORS, and that is the failure this
   timeout exists for. `onerror` fires when the request is REFUSED — offline,
   DNS gone, a 404. It does not fire when the request simply hangs, which is
   what a captive portal, a corporate proxy, a blocking extension, or a network
   that drops the connection mid-flight all produce. Nothing settles, so
   `ensureClient` awaits forever and `requestToken` never reaches the watchdog
   below it — that watchdog is armed AFTER this call, so it cannot cover the leg
   that hangs. The button reads "Connecting…" until the page is reloaded, which
   is precisely the symptom the watchdog was written to abolish.

   Observed, not theorised: in a browser with no route to accounts.google.com,
   opening Settings hung for the full 60s of two separate attempts, and the same
   page loaded instantly with the client ID unset and no script requested. The
   timeout's own control flow is covered by a bench test of the four outcomes —
   load, refusal, hang, and the retry after a hang — rather than by a second run
   in that browser.

   Twenty seconds is well past any real load of a 60KB script and well short of
   somebody deciding the app is broken. `loading` is cleared on both failures so
   a later press genuinely retries rather than joining a promise that is already
   dead, and the tag comes out with it — a hung request left in the document
   keeps the connection open and can resolve later into a client nobody is
   waiting for. */
const SCRIPT_PATIENCE = 20_000

function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (loading) return loading

  loading = new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script')
    let timer: ReturnType<typeof setTimeout> | null = null

    const done = (error?: Error) => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (!error) {
        resolve()
        return
      }
      loading = null
      tag.remove()
      reject(error)
    }

    timer = setTimeout(
      () => done(new Error('Google took too long to answer. Check your connection and try again.')),
      SCRIPT_PATIENCE,
    )

    tag.src = GIS_SRC
    tag.async = true
    tag.defer = true
    tag.onload = () => done()
    tag.onerror = () =>
      done(new Error('Could not reach Google. Check your connection and try again.'))
    document.head.append(tag)
  })
  return loading
}

async function ensureClient(): Promise<TokenClient> {
  if (client) return client
  await loadScript()

  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Could not reach Google. Check your connection and try again.')

  client = oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (response) => {
      const waiting = settle()
      if (!waiting) return
      if (response.error || !response.access_token) {
        waiting.reject(new Error('Google did not grant access.'))
        return
      }
      /* THE BOX ON GOOGLE'S SCREEN CAN BE LEFT UNTICKED, and Google hands back
         a perfectly valid token anyway — one that can read the email address
         and cannot touch a single file. Every Drive call then comes back 403,
         several steps and one confusing message after the moment it could have
         been fixed. So the token is checked here, where the fix is still one
         press away, and a token that cannot reach Drive is refused. */
      if (!(response.scope ?? '').split(' ').includes(DRIVE)) {
        waiting.reject(
          new Error(
            'Flyleaf eReader needs permission to use your Google Drive. Try again and leave the box ticked.',
          ),
        )
        return
      }
      token = response.access_token
      /* A minute short of the real expiry, so a request never starts on a
         token that dies mid-flight. */
      expiresAt = Date.now() + ((response.expires_in ?? 3600) - 60) * 1000
      /* A token arrived, so whatever was blocking the quiet path is over. */
      quietUntil = 0
      void learnAccount(response.access_token)
      waiting.resolve(response.access_token)
    },
    error_callback: (error) => {
      const waiting = settle()
      if (!waiting) return
      /* `origin_mismatch` — this origin is not on the OAuth client's list —
         reaches us as `popup_closed`, because Google paints its own error page
         and the SDK only sees the window go. The two are told apart by the
         clock: a real decision to close takes a person at least a second or
         two, while the error page is reported back almost immediately. Saying
         "you closed it" to somebody who closed nothing sends them looking in
         the wrong place, and this is the one failure whose fix is a console
         setting rather than anything the reader can do. */
      const quick = Date.now() - askedAt < 1200
      waiting.reject(
        new Error(
          error?.type !== 'popup_closed'
            ? 'Google could not open its sign-in window.'
            : quick
              ? `Google turned this away: ${location.origin} is not an authorised origin on the sync app's Google credentials.`
              : 'Sign-in was closed before it finished.',
        ),
      )
    },
  })
  return client
}

/** Ask Google for a token. `interactive` shows the account chooser; without it
    the request is silent and fails quietly when there is no Google session in
    this browser — which is what a background refresh wants. */
async function requestToken(interactive: boolean): Promise<string> {
  if (token && Date.now() < expiresAt) return token

  const tokenClient = await ensureClient()
  if (pending) throw new Error('Already talking to Google. Give it a moment.')

  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject }
    watchdog = setTimeout(
      () => {
        settle()?.reject(new Error('Google never answered. Try connecting again.'))
      },
      interactive ? PATIENCE.interactive : PATIENCE.silent,
    )
    /* THE PROMPT IS THE WHOLE DIFFERENCE BETWEEN THE TWO PATHS. `''` means
       "show whatever Google thinks is needed", and Google thinks a window is
       needed every time, because a browser app holds no refresh token — so a
       supposedly silent refresh would put a window on screen at launch and
       after every write. `'none'` is the actual silent flow: no window ever, a
       token if the Google session can still grant one, a plain failure if not.

       Interactive keeps `''` and NOT `'consent'`. Forcing consent is for apps
       collecting a refresh token; here it only makes somebody who already said
       yes say it again. Empty gives a first-timer the full consent screen,
       because they must have it, and sends everyone after that straight
       through. */
    askedAt = Date.now()
    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' })
  })
}

/** Fetch Google's script ahead of the press that needs it.

    Not an optimisation — a correctness fix. Safari lets a popup open only from
    inside the gesture that asked for it, and loading a script over the network
    mid-gesture spends that permission before the popup is ever requested. Any
    screen with a sign-in button should call this when it appears. */
export function warmUp() {
  if (SYNC_AVAILABLE) void ensureClient().catch(() => {})
}

/** The button was pressed. Shows Google's own chooser. */
export async function signIn(): Promise<void> {
  await requestToken(true)
  remember(true)
}

/** A token for a device that already opted in, without any window appearing.
    Throws when there is none to be had, and the caller treats that as "not
    connected right now" rather than an error worth shouting about. */
export async function silentToken(): Promise<string> {
  if (!optedIn()) throw new Error('Not signed in.')
  if (tokenHeld()) return token as string
  if (Date.now() < quietUntil) throw new Error('Sign in to Google again to keep backing up.')
  try {
    return await requestToken(false)
  } catch (error) {
    /* Shut the silent path — see REST above. The sentence handed back is the
       one somebody can act on, not Google's account of what its popup did. */
    quietUntil = Date.now() + REST
    announce()
    throw error instanceof Error && error.message === 'Not signed in.'
      ? error
      : new Error('Sign in to Google again to keep backing up.')
  }
}

/** Hand the token back to Google and forget the whole arrangement. The copy in
    Drive is deliberately left alone: signing out of a device must not delete
    somebody's library from their own Drive. Removing it is their call, made
    from the Remove-backup button beside this one. */
export async function signOut(): Promise<void> {
  const held = token
  token = null
  expiresAt = 0
  quietUntil = 0
  keep('')
  remember(false)
  if (!held) return
  try {
    await loadScript()
    window.google?.accounts.oauth2.revoke(held)
  } catch {
    /* The token expires on its own within the hour either way. */
  }
}
