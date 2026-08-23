import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Nav } from './components/Nav'
import { DropTarget } from './components/DropTarget'
import { Home } from './pages/Home'
import { Library } from './pages/Library'
import { Stats } from './pages/Stats'
import { SettingsPage } from './pages/SettingsPage'
import { OpenBook } from './pages/OpenBook'
import { BookDetail } from './pages/BookDetail'
import { ReadRoute } from './pages/ReadRoute'
import { useSettings } from './db'
import type { Settings } from './types'

/* The chrome theme, resolved here so exactly one place decides it. 'system'
   follows the OS and keeps following it — a matchMedia listener rather than a
   read at boot, because a phone that switches at sunset should switch the app
   with it and not at the next cold start.

   This is the CHROME theme only. The page stock is a separate setting with its
   own control, and the two are deliberately independent — see DESIGN.md. */
const THEME_GROUND: Record<Exclude<Settings['theme'], 'system'>, string> = {
  light: '#F4F2ED',
  dark: '#151515',
  sepia: '#EADCC3',
  ink: '#1B2430',
}

function useTheme(pref: Settings['theme'] | null) {
  useEffect(() => {
    if (!pref) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      /* 'system' is the only value that asks a question; the other four are
         answers. Resolving it here rather than branching on `dark` everywhere
         is what let Sepia and Ink be added without touching this logic. */
      const theme = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref
      document.documentElement.dataset.theme = theme
      /* the address bar has to move with it, or the app has a light strip
         above a dark page on Android. One ground per theme, read from the
         same values the stylesheet uses. */
      document
        .querySelector('meta[name="theme-color"]:not([media])')
        ?.setAttribute('content', THEME_GROUND[theme])
    }
    apply()
    if (pref !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [pref])
}

/* The nav is absent in the reader, and the route is what knows that — not the
   nav itself. A page-turn surface with a floating capsule over it is a
   page-turn surface with a hole in it. */
function Shell() {
  const { pathname } = useLocation()
  const reading = pathname.startsWith('/read/')
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/library" element={<Library />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/open" element={<OpenBook />} />
        <Route path="/book/:id" element={<BookDetail />} />
        <Route path="/read/:id" element={<ReadRoute />} />
        {/* /reading was a tab until Home took its job. It is redirected rather
            than deleted because it is the one route a reader could have
            installed to their home screen or bookmarked, and a 404 there would
            look like the app had broken rather than moved. `replace` so the
            back button does not bounce off it. */}
        <Route path="/reading" element={<Navigate to="/" replace />} />
        {/* Anything else is home. A reader who lands on a stale bookmarked URL
            should arrive at their books, not at an error. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!reading && <Nav />}
      {/* The whole window is a drop target — inside the router, because a drop
          hands the file to /open the same way an OS launch does. */}
      <DropTarget />
    </>
  )
}

export default function App() {
  /* The live row, not a copy of it: the theme has to change the moment the
     control does, and the control is four components away. See db.useSettings. */
  const settings = useSettings()
  useTheme(settings?.theme ?? null)

  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}
