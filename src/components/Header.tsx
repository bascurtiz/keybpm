import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { stats } from '@/lib/data'
import { formatCount } from '@/lib/format'
import { DATA_CHANGED } from '@/lib/contributions'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LogoMark } from '@/components/LogoMark'
import { useAuth } from '@/lib/AuthContext'
import { canReview } from '@/lib/api'
import { useMediaQuery } from '@/lib/useMediaQuery'

/** Primary nav, in one place so the desktop bar and mobile drawer never drift. */
interface NavItem {
  to: string
  label: string
  /** Only rendered for moderators/trusted users. */
  reviewOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/browse', label: 'Browse' },
  { to: '/contribute', label: 'Contribute' },
  { to: '/mix', label: 'Mix Finder' },
  { to: '/key', label: 'Key Wheel' },
  { to: '/tool', label: 'Key Tool' },
  { to: '/review', label: 'Review', reviewOnly: true },
  { to: '/about', label: 'About' },
]

/**
 * Persistent header: brand, primary nav, live search.
 * Desktop shows the nav inline; mobile collapses it into a hamburger drawer so
 * the top bar stays a single scannable row on a 360px-wide phone (Galaxy S23).
 * "/" focuses search (standard DJ-software muscle memory).
 * Typing navigates to /browse and updates `q` — filtering is instant there.
 */
export function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const { user, loading: authLoading, login, logout } = useAuth()
  // The single-row header (brand + full nav + search + account) needs ~950px,
  // so the inline nav only appears at lg — below that everything collapses
  // into the hamburger instead of squeezing the search box to nothing.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [menuOpen, setMenuOpen] = useState(false)

  const items = NAV_ITEMS.filter(i => !i.reviewOnly || canReview(user?.role))

  // Expose the header height so sticky table headers can sit right below it.
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The drawer only exists below md — drop it when the viewport grows.
  useEffect(() => {
    if (isDesktop) setMenuOpen(false)
  }, [isDesktop])

  // Navigating always closes the drawer.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Esc closes; the page behind the drawer doesn't scroll while it's open.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [menuOpen])

  const params = new URLSearchParams(location.search)
  const urlQuery = location.pathname === '/browse' ? (params.get('q') ?? '') : ''
  const [text, setText] = useState(urlQuery)

  // Keep input in sync when URL changes (back/forward, link clicks).
  useEffect(() => {
    setText(urlQuery)
  }, [urlQuery])

  // Debounced navigation while typing — from any page, typing jumps to Browse.
  useEffect(() => {
    if (location.pathname !== '/browse') {
      if (!text) return // don't navigate on empty input from other pages
      const t = setTimeout(() => {
        const p = new URLSearchParams()
        p.set('q', text)
        navigate(`/browse?${p.toString()}`)
      }, 350)
      return () => clearTimeout(t)
    }
    const current = new URLSearchParams(location.search).get('q') ?? ''
    if (text === current) return
    const t = setTimeout(() => {
      const p = new URLSearchParams(location.search)
      if (text) p.set('q', text)
      else p.delete('q')
      navigate(`/browse?${p.toString()}`, { replace: true })
    }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  // "/" focuses search unless already typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const el = document.activeElement
        const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        if (!typing) {
          e.preventDefault()
          setMenuOpen(false)
          inputRef.current?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMenuOpen(false)
    const p = new URLSearchParams()
    if (text) p.set('q', text)
    navigate(`/browse?${p.toString()}`)
  }

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link text-sm transition-colors duration-150 ${
      isActive ? 'text-text font-medium' : 'text-text-muted hover:text-accent'
    }`

  const drawerClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-[48px] items-center rounded-lg px-3 text-[15px] transition-colors ${
      isActive ? 'bg-bg-hover font-medium text-accent' : 'text-text hover:bg-bg-hover'
    }`

  // Re-render the header track count when contributions change without navigation.
  const [, setDataTick] = useState(0)
  useEffect(() => {
    const bump = () => setDataTick(n => n + 1)
    window.addEventListener(DATA_CHANGED, bump)
    return () => window.removeEventListener(DATA_CHANGED, bump)
  }, [])

  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 lg:flex-nowrap lg:py-3 lg:px-6">
        <Link to="/" className="flex items-center text-lg font-bold">
          <LogoMark className="mr-2.5 h-7 w-7 shrink-0 md:mr-3" />
          Key<span className="text-accent">BPM</span>
        </Link>

        {/* Desktop nav — mobile collapses into the hamburger drawer below. */}
        <nav aria-label="Primary" className="hidden items-center gap-4 lg:flex xl:gap-5">
          {items.map(item => (
            <NavLink key={item.to} to={item.to} className={navClass} data-label={item.label}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <form
          onSubmit={onSubmit}
          className="order-last w-full min-w-0 lg:order-none lg:ml-auto lg:w-auto lg:max-w-xs lg:flex-1"
          role="search"
        >
          <input
            ref={inputRef}
            type="search"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Search artists, tracks, BPM, key…"
            aria-label="Search tracks"
            className="input w-full bg-bg-card"
          />
        </form>

        <span className="hidden font-mono text-xs tabular-nums text-text-dim xl:inline" title="Tracks in the dataset">
          {formatCount(stats.tracks)} tracks
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
          {!authLoading && (
            <div className="hidden items-center gap-2 lg:flex">
              {user ? (
                <>
                  {user.avatarUrl && (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      width={24}
                      height={24}
                      className="h-6 w-6 rounded-full"
                    />
                  )}
                  <span className="hidden max-w-[8rem] truncate text-xs text-text-muted sm:inline" title={user.username}>
                    {user.username}
                  </span>
                  <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => logout()}>
                    Log out
                  </button>
                </>
              ) : (
                <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={login}>
                  Discord
                </button>
              )}
            </div>
          )}
          <ThemeToggle />

          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen(o => !o)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-card text-text-muted transition-colors hover:border-line-hover hover:text-text lg:hidden"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              {menuOpen ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <path d="M3 6h18M3 12h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer: sits directly under the sticky bar, dims the page behind it. */}
      {menuOpen && !isDesktop && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-black/60 lg:hidden"
          />
          <div
            id="mobile-nav"
            className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-var(--header-h,64px))] overflow-y-auto overscroll-contain border-b border-line bg-bg-card shadow-2xl lg:hidden"
          >
            <nav aria-label="Primary mobile" className="px-3 py-3">
              <ul className="flex flex-col gap-0.5">
                {items.map(item => (
                  <li key={item.to}>
                    <NavLink to={item.to} className={drawerClass}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2.5">
                <span className="font-mono text-xs text-text-dim">
                  {formatCount(stats.tracks)} tracks
                </span>
                {!authLoading &&
                  (user ? (
                    <span className="flex min-w-0 items-center gap-2">
                      {user.avatarUrl && (
                        <img src={user.avatarUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-full" />
                      )}
                      <span className="min-w-0 truncate text-xs text-text-muted">{user.username}</span>
                      <button type="button" className="btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={() => logout()}>
                        Log out
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => login()}>
                      Sign in with Discord
                    </button>
                  ))}
              </div>
            </nav>
          </div>
        </>
      )}
    </header>
  )
}
