import { useEffect, useState } from 'react'

export interface ViewportMode {
  /**
   * A narrow viewport: the console has the screen to itself, so it carries its own
   * chrome (the menu/fullscreen rail beside the chassis) and draws its controls in
   * their compact variants.
   *
   * The console fills the window at every size (see `MixIt`); what changes here is
   * what a *wide* screen has instead — the site header above the console, no rail,
   * and the roomier control spacing the components keep for their desktop variants.
   */
  kiosk: boolean
  /** A phone held upright — the rotate prompt's condition. */
  portraitPhone: boolean
  /**
   * A coarse pointer, i.e. a finger.
   *
   * Only the things that exist because of a touch screen hang off this: the wake
   * lock, and re-arming fullscreen around the file picker. On a mouse-driven desktop
   * both are noise — a fullscreen request there is a browser permission prompt for a
   * key the user can press.
   */
  touch: boolean
}

function read(win: Window): ViewportMode {
  return {
    kiosk: !win.matchMedia('(min-width: 1024px)').matches,
    portraitPhone: win.matchMedia('(orientation: portrait) and (max-width: 639px)').matches,
    touch: win.matchMedia('(pointer: coarse)').matches,
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
    typeof window === 'undefined'
      ? { kiosk: false, portraitPhone: false, touch: false }
      : read(window)
  )

  useEffect(() => {
    const update = () => {
      const next = read(window)
      setMode(prev =>
        prev.kiosk === next.kiosk &&
        prev.portraitPhone === next.portraitPhone &&
        prev.touch === next.touch
          ? prev
          : next
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
