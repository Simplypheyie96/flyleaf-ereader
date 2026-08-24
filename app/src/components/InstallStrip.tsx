import { useState } from 'react'
import { promptInstall, useInstall } from '../pwa'
import { remember, stored } from '../lib'
import { CloseIcon } from './icons'

/* ── InstallStrip ─────────────────────────────────────────────────────────
   Home's one piece of chrome that asks the reader for something: put this on
   your home screen.

   It only ever appears where the ask is actionable. Three branches, and each
   one says something true about the platform it is on:

     manualOnly  iOS/iPadOS, where there is no programmatic install at all —
                 so the strip explains the Share → Add to Home Screen route
                 and carries NO button, because there is nothing to click.
     canPrompt   a real beforeinstallprompt is held, so an Install button can
                 do the thing the sentence promises.
     neither     the browser's own route, in words. A browser that has not
                 offered a prompt cannot be made to — but silence there meant
                 the ask was invisible on desktop Safari and Firefox, and on
                 any Chrome that has already seen this app installed and so
                 stops firing the event. So this branch names the menu item
                 instead of apologising, and carries no button, because there
                 is still nothing to click.

   Two copies for canPrompt, split on pointer, because "home screen" is not a
   thing on a laptop. The desktop line leads on file handling rather than on
   working offline — offline is true of the whole app and is deliberately not
   the headline anywhere in this product.

   Dismissal is permanent and remembered, the same discipline as the included
   books: a reader who has said no is not asked again by the app deciding
   enough time has passed. Settings is where they change their mind. */

const KEY = 'flyleaf.home.install'

type Copy = { label: string; body: string; button: boolean }

function coarse(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches
  } catch {
    /* matchMedia is everywhere this app runs, but a throw here would take the
       whole of Home with it, and the wrong copy is a far cheaper failure. */
    return false
  }
}

function copyFor(canPrompt: boolean, manualOnly: boolean): Copy | null {
  if (manualOnly) {
    return {
      label: 'Add to home screen',
      /* Named exactly as iOS names them, because a reader hunting for a
         paraphrase in the Share sheet will not find it. */
      body: 'Tap Share, then Add to Home Screen. It opens full screen, without the browser bars eating the page.',
      button: false,
    }
  }
  if (!canPrompt) {
    /* No programmatic prompt and not iOS, so the only honest thing left is the
       route through the browser's own menu. Named per engine, because a reader
       hunting for "Install" in a menu that says "Add to Home screen" gives up. */
    const ua = navigator.userAgent
    const chromium = /Chrome|Chromium|Edg\//.test(ua) && !/Firefox/.test(ua)
    const where = coarse()
      ? chromium
        ? 'Open the browser menu and choose Add to Home screen.'
        : 'Open the browser menu and choose Add to Home Screen.'
      : chromium
        ? 'Look for the install icon at the end of the address bar, or open the browser menu and choose Install.'
        : 'Open the browser menu and look for Install, or Add to Dock.'
    return {
      label: coarse() ? 'Add to home screen' : 'Open books here',
      body: `${where} It opens in its own window and keeps your place.`,
      button: false,
    }
  }
  return coarse()
    ? {
        label: 'Add to home screen',
        body: 'Keep it on your home screen and it opens straight back to the page you were on.',
        button: true,
      }
    : {
        /* Not "Install": the button already says that, and an eyebrow that
           repeats its own button is a wasted line. This one says what the
           install buys instead. */
        label: 'Open books here',
        body: 'Install it and book files open straight into the reader, in their own window.',
        button: true,
      }
}

export function InstallStrip() {
  const install = useInstall()
  const [off, setOff] = useState(() => stored(KEY, ['on', 'off'] as const, 'on') === 'off')

  const copy = copyFor(install.canPrompt, install.manualOnly)
  if (off || install.installed || !copy) return null

  const dismiss = () => {
    remember(KEY, 'off')
    setOff(true)
  }

  const run = async () => {
    const outcome = await promptInstall()
    /* An accepted install flips `installed` through pwa.ts's appinstalled
       listener, but not every engine fires it — so retire the strip here too
       rather than leave it standing over an app that is already installed. */
    if (outcome === 'accepted') dismiss()
  }

  return (
    <aside className="instl">
      <div className="instl-txt">
        <p className="ui-lbl">{copy.label}</p>
        <p className="ui-p">{copy.body}</p>
      </div>
      {copy.button && (
        <button className="btn btn--sm" onClick={() => void run()}>
          Install
        </button>
      )}
      <button className="instl-x" onClick={dismiss} aria-label="Dismiss">
        <CloseIcon />
      </button>
    </aside>
  )
}
