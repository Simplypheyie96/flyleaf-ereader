/* The store apps (Capacitor, branch `store`): the same reader in a webview,
   built with VITE_STORE=1. Everything here is behind __STORE__, a build-time
   constant that is false for read.flyleaf.cc, so the web build compiles every
   native path out and never loads a plugin. The second check, the platform,
   keeps a store build opened in a desktop browser behaving like the web.

   Ported from Naija Farm's src/native.ts: the same plugins, the same receipt
   shapes, the same server check (see server-patch/unlock.md). */

type Cap = { isNativePlatform?: () => boolean; getPlatform?: () => string; convertFileSrc?: (url: string) => string }
const cap = (globalThis as { Capacitor?: Cap }).Capacitor

export const nativeApp = __STORE__ && !!cap?.isNativePlatform?.()
export const iosApp = nativeApp && cap?.getPlatform?.() === 'ios'
export const androidApp = nativeApp && cap?.getPlatform?.() === 'android'
export const STORE = androidApp ? 'Google Play' : 'the App Store'
/* The store listing's name; the web keeps Flyleaf eReader. */
export const APP_NAME = __STORE__ ? 'Octavo' : 'Flyleaf eReader'
/** What the shared account and its messages are called in this app. */
export const SERVICE = __STORE__ ? 'Octavo' : 'Flyleaf'

/* ── Opening a book from the phone ─────────────────────────────────────── */

/* A file opened from Files, a download or a share sheet arrives as a URL:
   file:// on iOS (a copy in the app's Inbox), content:// on Android. Capacitor
   serves both to the webview, so a fetch turns it into the same File a drop
   or the web's launchQueue would hand over, and /open takes it from there. */
async function asFile(url: string): Promise<File | null> {
  try {
    const res = await fetch(cap?.convertFileSrc?.(url) ?? url)
    if (!res.ok) return null
    const blob = await res.blob()
    const name = decodeURIComponent(url.split(/[/?#]/).filter(Boolean).pop() ?? 'book')
    return new File([blob], name, { type: blob.type })
  } catch {
    return null
  }
}

export async function startNative(open: (files: File[]) => void) {
  const { App } = await import('@capacitor/app')
  const take = async (url?: string) => {
    if (!url || !/^(file|content):/.test(url)) return
    const file = await asFile(url)
    if (file) open([file])
  }
  await App.addListener('appUrlOpen', ({ url }) => void take(url))
  await take((await App.getLaunchUrl())?.url)
}

/* ── Sign-in ───────────────────────────────────────────────────────────── */

/* Google's web button cannot run in a webview, so the apps sign in natively.
   On iOS guideline 4.8 asks for Sign in with Apple beside it. The web client
   is the server client, so Google's ID token is addressed to the id the API
   already accepts. Google on iOS also needs its own iOS client
   (VITE_GOOGLE_IOS, reversed in Info.plist); without one iOS offers Apple only. */
export type Provider = 'google' | 'apple'
const GOOGLE_WEB = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const GOOGLE_IOS = import.meta.env.VITE_GOOGLE_IOS ?? ''
export const providers: Provider[] = iosApp ? (GOOGLE_IOS ? ['apple', 'google'] : ['apple']) : ['google']

let social: Promise<typeof import('@capgo/capacitor-social-login').SocialLogin> | null = null
function login() {
  return social ??= import('@capgo/capacitor-social-login').then(async ({ SocialLogin }) => {
    await SocialLogin.initialize(iosApp
      ? { apple: {}, ...(GOOGLE_IOS && { google: { iOSClientId: GOOGLE_IOS, iOSServerClientId: GOOGLE_WEB } }) }
      : { google: { webClientId: GOOGLE_WEB } })
    return SocialLogin
  }, (e) => { social = null; throw e })
}

/** The provider's ID token, or null when the reader closed the sheet. */
export async function signIn(p: Provider): Promise<string | null> {
  const s = await login()
  try {
    const r = await s.login(p === 'google' ? { provider: 'google', options: {} } : { provider: 'apple', options: { scopes: ['email', 'name'] } })
    const token = (r.result as { idToken?: string | null }).idToken
    if (!token) throw new Error('Sign-in did not finish. Try again.')
    return token
  } catch (e) {
    if ((e as { code?: string }).code === 'USER_CANCELLED') return null
    throw e instanceof Error ? e : new Error('Sign-in did not finish. Try again.')
  }
}

/** A fresh Apple authorization code, so deleting an Apple account can revoke its sign-in. */
export async function appleCode(): Promise<string> {
  const s = await login()
  const r = await s.login({ provider: 'apple', options: { scopes: [] } }).catch(() => null)
  // The plugin's default (legacy) mode hands the code back as accessToken.token.
  const res = r?.result as { authorizationCode?: string; accessToken?: { token?: string } } | undefined
  const code = res?.authorizationCode || res?.accessToken?.token
  if (!code) throw new Error('Confirm with Apple to delete the account.')
  return code
}

/* ── Purchases ─────────────────────────────────────────────────────────── */

/* Two non-consumables that unlock the same thing; Supporter only pays more.
   Owned purchases stay with the store account, so restore works signed out. */
export const PRODUCTS = { unlock: 'com.feyidesigns.ereader.unlock', supporter: 'com.feyidesigns.ereader.supporter' } as const
export type Product = keyof typeof PRODUCTS
const OURS = Object.values(PRODUCTS) as string[]

/** What the server checks: the App Store's signed transaction, or Google
    Play's purchase token and product. */
export type Receipt = { jws: string } | { token: string; product: string }
type Tx = { jwsRepresentation?: string; purchaseToken?: string; productIdentifier: string; purchaseState?: string }
const receipt = (t: Tx): Receipt | null => androidApp
  ? t.purchaseToken ? { token: t.purchaseToken, product: t.productIdentifier } : null
  : t.jwsRepresentation ? { jws: t.jwsRepresentation } : null

const plugin = () => import('@capgo/native-purchases')

/** Store prices as this storefront shows them. Empty until the store answers. */
export async function prices(): Promise<Partial<Record<Product, string>>> {
  const { NativePurchases } = await plugin()
  const { products } = await NativePurchases.getProducts({ productIdentifiers: OURS })
  const out: Partial<Record<Product, string>> = {}
  for (const p of products) {
    const key = (Object.keys(PRODUCTS) as Product[]).find((k) => PRODUCTS[k] === p.identifier)
    if (key) out[key] = p.priceString
  }
  return out
}

/** Buys one product. The store acknowledges it straight away (a non-consumable
    is never consumed); the receipt goes to the account afterwards if signed in. */
export async function buy(p: Product): Promise<Receipt | null> {
  const { NativePurchases, PURCHASE_TYPE } = await plugin()
  try {
    return receipt(await NativePurchases.purchaseProduct({ productIdentifier: PRODUCTS[p], quantity: 1 }))
  } catch (e) {
    // Already owned, or bought despite the error: the store's own record decides.
    if (!cancelled(e)) {
      const { purchases } = await NativePurchases.getPurchases(androidApp ? { productType: PURCHASE_TYPE.INAPP } : {}).catch(() => ({ purchases: [] as Tx[] }))
      const had = purchases.find((t) => t.productIdentifier === PRODUCTS[p])
      if (had) return receipt(had)
    }
    throw e
  }
}

/** What this store account owns of ours. Refunded purchases drop out. */
export async function owned(): Promise<Receipt[]> {
  const { NativePurchases, PURCHASE_TYPE } = await plugin()
  const { purchases } = await NativePurchases.getPurchases(androidApp ? { productType: PURCHASE_TYPE.INAPP } : {})
  return purchases
    .filter((t) => OURS.includes(t.productIdentifier) && (!androidApp || t.purchaseState === undefined || t.purchaseState === '1'))
    .map(receipt)
    .filter((r) => r !== null)
}

export async function restore(): Promise<Receipt[]> {
  const { NativePurchases } = await plugin()
  // The sync can fail on its own (TestFlight's AppStore.sync throws), but what
  // this phone already holds still reads, so the failure only counts when nothing turns up.
  const failed = await NativePurchases.restorePurchases().then(() => null, (e: unknown) => e)
  const has = await owned()
  if (!has.length && failed) throw failed
  return has
}

const cancelled = (e: unknown) => /cancel/i.test(`${(e as { code?: string })?.code} ${(e as Error)?.message}`)

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** A webview cannot download, so in the store app a file goes to the share
    sheet instead (Save to Files, Drive, mail). Backing out of it is not a failure. */
export async function shareFile(blob: Blob, name: string): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const { uri } = await Filesystem.writeFile({ path: name, data: await base64(blob), directory: Directory.Cache })
  try {
    await Share.share({ files: [uri], title: name })
  } catch (e) {
    if (!cancelled(e)) throw e
  }
}
