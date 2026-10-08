import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { stats } from '@/lib/data'
import { formatCount } from '@/lib/format'
import { DATA_CHANGED } from '@/lib/contributions'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LogoMark } from '@/components/LogoMark'
import { useAuth } from '@/lib/AuthContext'
import { canReview } from '@/lib/api'

/**
 * Persistent header: brand, primary nav, live search.
 * "/" focuses search (standard DJ-software muscle memory).
 * Typing navigates to /browse and updates `q` — filtering is instant there.
 */
export function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const { user, loading: authLoading, login, logout } = useAuth()

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
          inputRef.current?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (text) p.set('q', text)
    navigate(`/browse?${p.toString()}`)
  }

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link text-sm transition-colors duration-150 ${
      isActive ? 'text-text font-medium' : 'text-text-muted hover:text-accent'
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
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:flex-nowrap md:py-3 lg:px-6">
        <Link to="/" className="flex items-center text-lg font-bold">
          <LogoMark className="mr-3 h-7 w-7 shrink-0" />
          Key<span className="text-accent">BPM</span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-5">
          <NavLink to="/browse" className={navClass} data-label="Browse">Browse</NavLink>
          <NavLink to="/contribute" className={navClass} data-label="Contribute">Contribute</NavLink>
          <NavLink to="/mix" className={navClass} data-label="Mix Finder">Mix Finder</NavLink>
          <NavLink to="/key" className={navClass} data-label="Key Wheel">Key Wheel</NavLink>
          <NavLink to="/tool" className={navClass} data-label="Key Tool">Key Tool</NavLink>
          {canReview(user?.role) && (
            <NavLink to="/review" className={navClass} data-label="Review">Review</NavLink>
          )}
          <NavLink to="/about" className={navClass} data-label="About">About</NavLink>
        </nav>

        <form onSubmit={onSubmit} className="order-last w-full min-w-0 md:order-none md:ml-auto md:w-auto md:max-w-xs md:flex-1" role="search">
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

        <span className="hidden font-mono text-xs tabular-nums text-text-dim lg:inline" title="Tracks in the dataset">
          {formatCount(stats.tracks)} tracks
        </span>

        <div className="flex shrink-0 items-center gap-2">
          {!authLoading && (
            user ? (
              <div className="flex items-center gap-2">
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
              </div>
            ) : (
              <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={login}>
                Discord
              </button>
            )
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
