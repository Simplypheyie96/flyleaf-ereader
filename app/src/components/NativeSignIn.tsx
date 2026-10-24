/* Sign-in for the store apps, in place of Google's web button (which cannot run
   in a webview). Sign in with Apple first on iOS, as Apple's guidelines ask. The
   marks are Remix Icon's (Logos). */

import { useState } from 'react'
import { providers, signIn, type Provider } from '../native'
import { exchange } from '../sync/cloud'
import { refresh } from '../unlock'

const MARK: Record<Provider, string> = {
  apple: 'M11.6734 7.22198C10.7974 7.22198 9.44138 6.22598 8.01338 6.26198C6.12938 6.28598 4.40138 7.35397 3.42938 9.04597C1.47338 12.442 2.92538 17.458 4.83338 20.218C5.76938 21.562 6.87338 23.074 8.33738 23.026C9.74138 22.966 10.2694 22.114 11.9734 22.114C13.6654 22.114 14.1454 23.026 15.6334 22.99C17.1454 22.966 18.1054 21.622 19.0294 20.266C20.0974 18.706 20.5414 17.194 20.5654 17.11C20.5294 17.098 17.6254 15.982 17.5894 12.622C17.5654 9.81397 19.8814 8.46998 19.9894 8.40998C18.6694 6.47798 16.6414 6.26198 15.9334 6.21398C14.0854 6.06998 12.5374 7.22198 11.6734 7.22198ZM14.7934 4.38998C15.5734 3.45398 16.0894 2.14598 15.9454 0.849976C14.8294 0.897976 13.4854 1.59398 12.6814 2.52998C11.9614 3.35798 11.3374 4.68998 11.5054 5.96198C12.7414 6.05798 14.0134 5.32598 14.7934 4.38998Z',
  google: 'M3.06364 7.50914C4.70909 4.24092 8.09084 2 12 2C14.6954 2 16.959 2.99095 18.6909 4.60455L15.8227 7.47274C14.7864 6.48185 13.4681 5.97727 12 5.97727C9.39542 5.97727 7.19084 7.73637 6.40455 10.1C6.2045 10.7 6.09086 11.3409 6.09086 12C6.09086 12.6591 6.2045 13.3 6.40455 13.9C7.19084 16.2636 9.39542 18.0227 12 18.0227C13.3454 18.0227 14.4909 17.6682 15.3864 17.0682C16.4454 16.3591 17.15 15.3 17.3818 14.05H12V10.1818H21.4181C21.5364 10.8363 21.6 11.5182 21.6 12.2273C21.6 15.2727 20.5091 17.8363 18.6181 19.5773C16.9636 21.1046 14.7 22 12 22C8.09084 22 4.70909 19.7591 3.06364 16.4909C2.38638 15.1409 2 13.6136 2 12C2 10.3864 2.38638 8.85911 3.06364 7.50914Z',
}
const LABEL: Record<Provider, string> = { apple: 'Sign in with Apple', google: 'Continue with Google' }

interface Props {
  onDone: (email: string) => void
  onError: (message: string) => void
}

export function NativeSignIn({ onDone, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const go = async (p: Provider) => {
    setBusy(true)
    try {
      const token = await signIn(p)
      if (token) {
        const email = await exchange(token, p)
        /* Ties this phone's purchase to the account, or brings over one made
           on another phone, before sync is asked to run. */
        await refresh()
        onDone(email)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Sign-in did not finish. Try again.')
    }
    setBusy(false)
  }
  return (
    <div className="export-acts" style={{ flexDirection: 'column', alignItems: 'stretch', maxWidth: 400 }}>
      {providers.map((p) => (
        <button key={p} type="button" className={p === 'apple' ? 'export-do' : 'export-alt'} disabled={busy} onClick={() => void go(p)}>
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d={MARK[p]} /></svg>
          <span>{LABEL[p]}</span>
        </button>
      ))}
    </div>
  )
}
