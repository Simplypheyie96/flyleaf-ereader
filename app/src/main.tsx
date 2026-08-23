import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installFonts } from './fonts'
import './index.css'
import App from './App'
import { initServiceWorker } from './pwa'
import { startSeeding } from './seed'
import { initOpenQueue } from './openQueue'

/* Before the first paint: the @font-face rules live in a module rather than in
   a stylesheet, so they have to be installed by hand. */
installFonts()

/* Kicked off here rather than from a component, and before the render, so that
   on a true first run the two included books are already arriving while React
   is still mounting. The launch screen below waits on it — see SEEDING. On
   every subsequent start this resolves after two indexed lookups and nothing
   waits on anything. */
const seeding = startSeeding()

/* The OS launch consumer, registered before React mounts. The browser calls it
   once and early: a consumer set when /open renders has already missed the file
   the reader double-clicked to start the app. */
initOpenQueue()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

/* No analytics. Press sends page views; a reader does not, because the paths
   here are books — and a list of what somebody is reading is exactly the sort
   of thing that should not leave the device even in aggregate. */

/* Importing ./pwa is itself load-bearing: the beforeinstallprompt listener
   goes on at module scope, and that event fires once, early. Register the
   worker from here too, so Settings has a registration to check. */
initServiceWorker()

/* Sync, if it was ever turned on. Started after the app has settled, and the
   reason is timing rather than bundle size — Settings imports the panel
   statically, so the module is in the main chunk regardless and this import
   resolves from memory. What the delay buys is that installing six Dexie hooks
   and possibly going straight out to Google do not happen in the same frames as
   the first paint of a book. `startAutoSync` returns immediately for anybody who
   has not connected Drive.

   requestIdleCallback with a timeout, and a plain timer where it does not
   exist — Safari still has neither. A write in the first couple of seconds
   lands before the hooks do; the next write, or the ninety-second beat, carries
   it, so the cost of being late here is measured in seconds and not in data. */
const wake = () => void import('./sync/sync').then((m) => m.startAutoSync())
if ('requestIdleCallback' in window) requestIdleCallback(wake, { timeout: 3000 })
else setTimeout(wake, 2000)

/* Drop the launch screen once there is something behind it. It waits on the
   web fonts so the first thing seen isn't the app in a fallback face, but only
   up to a beat — on a slow connection the app is more use than the right
   serif, and the splash must never be what somebody stares at.

   The floor matters more than the ceiling. On a warm start the fonts are
   cached and document.fonts.ready settles in ~10ms, so the screen is torn down
   a frame after it paints — present in the DOM, never present to the eye,
   which reads as "there is no launch screen at all". HOLD is measured from
   navigation rather than from here, so the bundle's own parse time counts
   toward it and a slow start does not wait twice.

   1.2s rather than Press's 1.8: Press's launch screen introduces a thing you
   are about to write in, and can afford a beat. This one stands between a
   reader and the page they were on, which is the wrong place to be deliberate.
   The 420ms fade sits on top of it. */
const HOLD = 1200
const FONT_WAIT = 1000
/* The ceiling on waiting for the included books. On a first run they are two
   local files to fetch, unzip and read a cover out of — a few hundred
   milliseconds, comfortably inside HOLD, so nobody ever sees this number. It
   exists for the case where they are not: a launch screen that outlives its
   own reason is the worst failure this file can have, and 2.5s is the point at
   which a shorter shelf is better than a longer wait. */
const SEEDING_WAIT = 2500

const splash = document.getElementById('splash')
if (splash) {
  const done = () => {
    splash.classList.add('is-out')
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
    /* transitionend doesn't fire if the element is hidden or the transition is
       optimised away — never leave a full-screen overlay pinned over the app */
    setTimeout(() => splash.remove(), 600)
  }
  const held = new Promise((r) => setTimeout(r, Math.max(0, HOLD - performance.now())))
  const fonts = Promise.race([
    document.fonts.ready,
    new Promise((r) => setTimeout(r, FONT_WAIT)),
  ])
  /* SEEDING. First run only: hold the splash until the shelf has its books, so
     the first frame anybody sees is a shelf with two books on it — never an
     empty state that fills in a moment later. */
  const seeded = Promise.race([seeding, new Promise((r) => setTimeout(r, SEEDING_WAIT))])
  /* A frame, or a beat — whichever comes first. requestAnimationFrame alone is
     not safe to hang a full-screen overlay's removal on: a hidden tab is never
     rendered, so the callback simply never runs and the launch screen stays
     pinned at z-index 9999 with pointer-events on — the whole interface
     unclickable, no error anywhere. The frame is only wanted so the fade
     starts against a painted app, which is worth one frame of patience. */
  Promise.all([held, fonts, seeded]).then(() =>
    Promise.race([
      new Promise((r) => requestAnimationFrame(() => r(null))),
      new Promise((r) => setTimeout(() => r(null), 50)),
    ]).then(done)
  )
}
