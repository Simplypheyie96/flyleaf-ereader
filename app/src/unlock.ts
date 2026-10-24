/* The one purchase in the store apps. Reading any DRM-free book, places and
   highlights are free everywhere; the unlock adds marks export, page stocks
   and themes past the defaults, and sync. On the web nothing is gated: GATED
   is false at build time and every check below folds away.

   The unlock is held two ways, so neither a sign-in nor a network is needed
   to keep it: what the store says this phone's store account owns, and what
   the Flyleaf account says (bought on another phone, or on the other store).
   The answer is cached so a cold start offline opens unlocked. */

import { useSyncExternalStore } from 'react'
import { nativeApp } from './native'

export const GATED = nativeApp

const KEY = 'flyleaf-ereader-unlocked'
const EVENT = 'flyleaf-unlock'
const OPEN = 'flyleaf-unlock-open'

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

let held = GATED ? read() : true

function set(on: boolean) {
  if (on === held) return
  held = on
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* Private storage: unlocked for this run, asked again next time. */
  }
  window.dispatchEvent(new Event(EVENT))
}

export const unlocked = () => held

function useHeld(): boolean {
  return useSyncExternalStore(
    (f) => {
      window.addEventListener(EVENT, f)
      return () => window.removeEventListener(EVENT, f)
    },
    unlocked,
  )
}
/* A constant on the web build, so nothing of this module ships there. */
export const useUnlocked: () => boolean = __STORE__ ? useHeld : () => true

/** For a locked control's press: true (and the unlock sheet opens) when the
    feature is locked, so the caller returns instead of acting. */
export function locked(): boolean {
  if (!GATED || held) return false
  window.dispatchEvent(new Event(OPEN))
  return true
}

export function onOpenAsked(f: () => void) {
  window.addEventListener(OPEN, f)
  return () => window.removeEventListener(OPEN, f)
}

/* ── Keeping it in step ────────────────────────────────────────────────── */

type Receipt = import('./native').Receipt

/** Ties receipts to the signed-in Flyleaf account, then asks the account.
    'out' when signed out; null when the account could not be asked. */
async function account(receipts: Receipt[]): Promise<boolean | 'out' | null> {
  const { call, optedIn } = await import('./sync/cloud')
  if (!optedIn()) return 'out'
  try {
    for (const r of receipts) {
      await call('/iap/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: 'reader', ...r }),
      })
    }
    const res = await call('/unlock/reader')
    if (!res.ok) return null
    return ((await res.json()) as { unlocked?: boolean }).unlocked === true
  } catch {
    return null
  }
}

/** What the store and the account say now. Called at launch, after a sign-in
    and after restore. A store that cannot be reached keeps the cached answer. */
export async function refresh(receipts?: Receipt[]) {
  if (!GATED) return
  const { owned } = await import('./native')
  let mine: Receipt[] | null = receipts ?? null
  if (!mine) mine = await owned().catch(() => null)
  const theirs = await account(mine ?? [])
  if ((mine?.length ?? 0) > 0 || theirs === true) set(true)
  /* Locked only on two definite answers: the store owns nothing, and the
     account (if any) has nothing. Offline either way keeps what was cached. */
  else if (mine !== null && (theirs === false || theirs === 'out')) set(false)
}

export async function purchase(p: import('./native').Product): Promise<boolean> {
  const { buy } = await import('./native')
  const r = await buy(p)
  if (!r) return false
  set(true)
  void account([r])
  return true
}

export async function restore(): Promise<boolean> {
  const native = await import('./native')
  await refresh(await native.restore())
  return held
}
