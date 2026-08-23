import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/* Installing the app, and asking whether there's a newer one. Press's module,
   ported: the mechanics are identical and there is nothing to improve.

   Both listeners have to be set up at module scope, before React mounts.
   `beforeinstallprompt` fires once, early, and if nothing is listening at that
   moment the event is gone — Chrome does not re-fire it for a component that
   mounts later. So the listener goes on at import time and parks the event;
   the UI subscribes to what was caught rather than to the event itself. */

/** The bit of BeforeInstallPromptEvent we use. Not in lib.dom — it is a
    Chromium extension to the spec, which is also why iOS never sends one. */
type InstallPrompt = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPrompt | null = null
let installed = false
const listeners = new Set<() => void>()
const announce = () => listeners.forEach((f) => f())

/** Running from the home screen rather than a browser tab. `standalone` on
    navigator is the iOS-only answer to the same question. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/* iOS has no install prompt of any kind — Safari's Share → Add to Home Screen
   is the whole mechanism — so those readers get words instead of a button.
   Every browser on iOS is Safari underneath, so the test is the platform. */
export function isIOS(): boolean {
  const ua = navigator.userAgent
  /* Second clause is iPadOS in desktop mode, which reports itself as a
     Macintosh. Keyed on that UA rather than on the deprecated
     navigator.platform, which several environments leave as 'MacIntel'
     whatever device they claim to be — and a Mac has no touch, so a
     Macintosh with touch points IS an iPad. */
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

window.addEventListener('beforeinstallprompt', (e) => {
  /* preventDefault stops Chrome's own mini-infobar — the trade being that we
     take responsibility for offering the install ourselves, in Settings and on
     the empty Library, rather than letting the browser pick the moment. */
  e.preventDefault()
  deferred = e as InstallPrompt
  announce()
})

window.addEventListener('appinstalled', () => {
  deferred = null
  installed = true
  announce()
})

/** Show the browser's install dialog. Resolves once the reader has answered. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable'
  const e = deferred
  /* The event is single-use whatever the answer — a declined install cannot be
     re-prompted from the same one, and Chrome sends a fresh event later if it
     decides the app is still installable. */
  deferred = null
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') installed = true
  announce()
  return outcome
}

type InstallState = {
  /** there is a real prompt waiting — a button can be offered */
  canPrompt: boolean
  /** already running from the home screen, or installed during this session */
  installed: boolean
  /** installable, but only by hand: iOS's Share → Add to Home Screen */
  manualOnly: boolean
}

export function useInstall(): InstallState {
  const read = (): InstallState => ({
    canPrompt: deferred !== null,
    installed: installed || isStandalone(),
    manualOnly: isIOS() && !isStandalone(),
  })
  const [state, setState] = useState(read)
  useEffect(() => {
    const update = () => setState(read())
    listeners.add(update)
    update()
    return () => { listeners.delete(update) }
  }, [])
  return state
}

/* ── updates ───────────────────────────────────────────────────────────────
   The worker is registered here rather than by the plugin's injected snippet,
   because holding the registration is what makes a "Check for updates" button
   possible at all: without it there is nothing to call .update() on.

   registerType is 'autoUpdate', so a new worker that installs takes over and
   reloads. THAT RELOAD MUST NEVER TOUCH INDEXEDDB — it is a cache swap, and
   the library is not in the cache. Nothing here clears storage, and nothing
   added here ever should; a reader who loses a shelf to an update loses it
   permanently, because there is no server holding a copy. */

let swReg: ServiceWorkerRegistration | undefined
let swSettled = false

/* An installed PWA can go a long time without a navigation — iOS in
   particular keeps the window alive and warm, so the browser's own
   check-on-navigate may not fire for days and the reader sits on a shell that
   is weeks old. That is not hypothetical: it is how an installed copy came to
   be showing an app name that had already been changed in two deploys. So the
   registration is nudged as well as held — once an hour, and whenever the app
   comes back to the foreground, throttled to the same hour so a reader
   switching apps does not fire a request per switch. Both are no-ops when the
   deploy has not changed (the worker script 304s), and neither can touch
   IndexedDB. Offline they fail silently, which is correct: this is the one
   thing in the app that is allowed to need the network, because it is the
   thing that asks whether there is anything new. */
const UPDATE_EVERY = 60 * 60 * 1000
let lastCheck = 0

function nudge(reg: ServiceWorkerRegistration): void {
  const now = Date.now()
  if (now - lastCheck < UPDATE_EVERY) return
  lastCheck = now
  reg.update().catch(() => {})
}

export function initServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      swReg = reg
      swSettled = true
      if (!reg) return
      lastCheck = Date.now()
      setInterval(() => nudge(reg), UPDATE_EVERY)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') nudge(reg)
      })
    },
    onRegisterError() {
      swSettled = true
    },
  })
}

export type UpdateResult = 'updating' | 'current' | 'unsupported'

export async function checkForUpdate(): Promise<UpdateResult> {
  /* Registration is async and the button may be pressed before it lands. Wait
     a beat rather than reporting "unsupported" for a worker half a second
     late. */
  for (let i = 0; i < 30 && !swSettled; i++) {
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!swReg) return 'unsupported'
  await swReg.update()
  /* A worker sitting in installing or waiting IS the new version — with
     skipWaiting on it will claim the page and reload within moments. */
  return swReg.installing || swReg.waiting ? 'updating' : 'current'
}

/* ── persistent storage ────────────────────────────────────────────────────
   A local-first reader with no server has one real failure mode: the browser
   evicting IndexedDB under storage pressure and taking the library with it.
   navigator.storage.persist() asks not to be evicted. Chrome grants it silently
   to an installed app; Safari grants it on its own terms and Firefox may
   prompt. It is a request, not a guarantee, which is why the backup export
   exists as well — but not asking is strictly worse than asking. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
