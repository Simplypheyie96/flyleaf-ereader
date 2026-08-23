import { Link, useLocation } from 'react-router-dom'
import { HomeIcon, ShelfIcon, StatsIcon, SettingsIcon, OpenIcon } from './icons'

/* Press's shell, mechanics unchanged: a floating capsule of icon-only tabs
   where the ACTIVE tab grows into an icon + label pill, and the one real
   action stands beside the bar as its own round button.

   Four tabs now, and the fourth is not decoration — it replaced something.

   The bar used to be Library / Reading / Settings, where Reading was one card
   pointing at the book you had open. That tab was doing two jobs badly: it was
   the shortest route back into a book, and it was also the only door to the
   history behind it. So the card moved to Home, where it sits above everything
   else that is about what you are reading now, and the door became a tab of its
   own. Home / Library / Stats / Settings: what you are reading, everything you
   own, what that adds up to, and how it behaves.

   The bar does not render in the reader. App.tsx decides that, not this file:
   whether the nav exists is a question about the route, and the nav should not
   be the thing that knows the answer. */

const TABS = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/library', label: 'Library', Icon: ShelfIcon },
  { to: '/stats', label: 'Stats', Icon: StatsIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
] as const

/** Which tab owns a path. A book's detail sheet belongs to the library's world
    and lights that tab, because arriving at a book from the shelf and finding
    no tab lit reads as having left the app. Home is exact — it is the only
    route that is a bare slash, and treating it as a prefix would light it on
    every screen. */
function owns(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/'
  if (to === '/library') return pathname.startsWith('/library') || pathname.startsWith('/book/')
  return pathname.startsWith(to)
}

export function Nav() {
  const { pathname } = useLocation()

  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tab-pill">
        {TABS.map(({ to, label, Icon }) => {
          const on = owns(to, pathname)
          return (
            <Link key={to} to={to} aria-current={on ? 'page' : undefined} aria-label={label}>
              <Icon />
              <span className="tab-lbl">{label}</span>
            </Link>
          )
        })}
      </div>
      <Link className="tab-add" to="/open" aria-label="Open a book file">
        <OpenIcon />
      </Link>
    </nav>
  )
}
