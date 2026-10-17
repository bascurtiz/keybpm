import { useEffect, useState } from 'react'

export interface ViewportMode {
  /** Below the desktop breakpoint: the console owns the page instead of sitting in it. */
  kiosk: boolean
  /** A phone held upright — the rotate prompt's condition. */
  portraitPhone: boolean
}

function read(win: Window): ViewportMode {
  return {
    kiosk: !win.matchMedia('(min-width: 1024px)').matches,
    portraitPhone: win.matchMedia('(orientation: portrait) and (max-width: 639px)').matches,
  }
}

/**
 * Viewport shape for the console, read from actual size changes rather than from a
 * media query's `change` event.
 *
 * The difference matters on a page that fills the viewport. A console that scales
 * itself to `100dvh` has to react to *every* geometry event — a rotation, a window
 * drag, and (on a phone) the address bar sliding away, which changes the height
 * without changing any breakpoint. `matchMedia().addEventListener('change')` covers
 * the breakpoints only: a browser that resizes without re-evaluating its queries
 * leaves the console laid out for the old viewport until something else re-renders
 * it. Listening to `resize`, `orientationchange` and `visualViewport` (which fires
 * for browser-UI changes specifically) closes that gap, and re-reading the queries
 * on each event keeps the breakpoints in one place.
 *
 * State is only replaced when a value actually changed, so a resize that does not
 * cross a boundary does not re-render the console.
 */
export function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>(() =>
    typeof window === 'undefined' ? { kiosk: false, portraitPhone: false } : read(window)
  )

  useEffect(() => {
    const update = () => {
      const next = read(window)
      setMode(prev =>
        prev.kiosk === next.kiosk && prev.portraitPhone === next.portraitPhone ? prev : next
      )
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  return mode
}
