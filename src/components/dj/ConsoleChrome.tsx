import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '@/lib/nav'
import { LogoMark } from '@/components/LogoMark'

/**
 * The only two controls the DJ console draws outside its chassis: a menu that opens the
 * site's navigation, and a fullscreen toggle.
 *
 * Both sit in the side band the console leaves clear (see `KIOSK_SIDE_BAND` in
 * `MixIt`), vertically centred on the metadata strip's load buttons and the same size as
 * them — 40 design px. That puts them level with a control the user already knows the
 * position of, and keeps them off the rounded corners most phones have, which is where a
 * button in the literal corner of the screen would be clipped by the display.
 *
 * They are drawn in the console's own coordinate space (the caller passes the scale and
 * the offsets), so they shrink with it instead of looming over a fitted chassis.
 */

/** Rail geometry, in the console's design px. The fit maths in `MixIt` uses these too. */
export const RAIL = {
  /** Button edge length; matches the deck load button's artwork square. */
  size: 40,
  /** Gap between a button and the nearest edge of the chassis. */
  gap: 12,
  /** Distance from the top of the chassis to the top of a button: the artwork's own row. */
  top: 20,
} as const

interface ConsoleChromeProps {
  /** Console scale, so the rail shrinks with the chassis. */
  scale: number
  /** CSS px from the box's top edge to the top of a rail button. */
  top: number
  /** CSS px from the box's left edge to the hamburger's left edge. May be negative. */
  menuLeft: number
  /** CSS px from the box's left edge to the fullscreen button's left edge. */
  fullscreenLeft: number
  fullscreen: { supported: boolean; active: boolean; toggle: () => void }
}

const BUTTON_CLASS =
  'pointer-events-auto absolute z-40 flex items-center justify-center rounded-[6px] border border-[#2e2e2e] ' +
  'bg-[#1c1c1c] text-[#9a9a9a] shadow-[0_1px_4px_rgba(0,0,0,0.7)] transition-colors touch-manipulation ' +
  'hover:border-[#4a4a4a] hover:text-white active:bg-white active:text-black ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70'

export function ConsoleChrome({ scale, top, menuLeft, fullscreenLeft, fullscreen }: ConsoleChromeProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  // Esc closes the drawer, like the site's own mobile menu.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const railStyle = (left: number) => ({
    left,
    top,
    width: RAIL.size,
    height: RAIL.size,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
  })

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(open => !open)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        aria-controls="console-nav"
        title="Site menu"
        className={BUTTON_CLASS}
        style={railStyle(menuLeft)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {fullscreen.supported && (
        <button
          type="button"
          onClick={fullscreen.toggle}
          aria-label={fullscreen.active ? 'Leave fullscreen' : 'Enter fullscreen'}
          aria-pressed={fullscreen.active}
          title={fullscreen.active ? 'Leave fullscreen' : 'Fullscreen (hides the address bar)'}
          className={BUTTON_CLASS}
          style={railStyle(fullscreenLeft)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {fullscreen.active ? (
              <path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M9 20v-4a1 1 0 0 0-1-1H4M15 20v-4a1 1 0 0 1 1-1h4" />
            ) : (
              <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
            )}
          </svg>
        </button>
      )}

      {menuOpen && <ConsoleNavDrawer onClose={() => setMenuOpen(false)} />}
    </>
  )
}

/**
 * The site's navigation, as a left sheet over the console.
 *
 * Native CSS pixels rather than console design px on purpose: the chassis is scaled to
 * ~0.7 on a phone, and a menu drawn in that space would give 44 px list rows the
 * tappability of a 30 px one. The console's own controls have to be small to fit; a menu
 * does not.
 */
function ConsoleNavDrawer({ onClose }: { onClose: () => void }) {
  // Review is a moderation queue, not a mixing destination: it is left out of the
  // console menu rather than dragging auth state into this screen.
  const items = NAV_ITEMS.filter(item => !item.reviewOnly)

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Site menu">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70"
      />
      <div
        id="console-nav"
        className="absolute inset-y-0 left-0 flex w-[min(19rem,82vw)] flex-col border-r border-[#2a2a2a] bg-[#141414] shadow-2xl"
        style={{
          paddingTop: 'max(0px, env(safe-area-inset-top))',
          paddingBottom: 'max(0px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#242424] px-4">
          <span className="flex items-center text-sm font-bold">
            <LogoMark className="mr-1.5 h-6 w-6 shrink-0" />
            Key<span className="text-accent">BPM</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9a9a9a] transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
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
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto overscroll-contain p-2">
          <ul className="flex flex-col gap-0.5">
            {items.map(item => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center rounded-lg px-3 text-[15px] transition-colors ${
                      isActive ? 'bg-white/5 font-medium text-accent' : 'text-text hover:bg-white/5'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <p className="shrink-0 border-t border-[#242424] px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-text-dim">
          DJ console · landscape
        </p>
      </div>
    </div>
  )
}
