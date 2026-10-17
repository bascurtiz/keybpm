import { useEffect, useRef, useState } from 'react'

/**
 * Element fullscreen, the only reliable way to get rid of mobile browser chrome.
 *
 * A phone's address bar hides itself when the *document* scrolls — that is why the
 * rest of the site gains a few pixels on every downward swipe. The mixer cannot use
 * that: it is a fixed, viewport-sized console whose panels re-fit around the space
 * they are given, and its faders and waveforms claim the vertical gestures that would
 * scroll a normal page. So there is nothing to scroll, and therefore no address bar
 * behaviour to inherit.
 *
 * Fullscreen is the honest answer to the same request: one tap and the address bar,
 * the tab strip and the Android status bar are all gone, and `100dvh` grows by the
 * space they were using. It has to be a tap — browsers only grant it during a user
 * gesture — and it is allowed to fail, so every call here swallows a refusal and
 * leaves the console exactly as it was.
 *
 * `navigationUI: 'hide'` is what hides the browser UI along with the address bar in
 * Chromium. Safari on iPhone does not implement element fullscreen at all; there
 * `supported` is false and the button that uses this never renders.
 */

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.documentElement as FullscreenElement
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'
}

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false
  const doc = document as FullscreenDocument
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement)
}

export async function enterFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return
  const el = document.documentElement as FullscreenElement
  try {
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen({ navigationUI: 'hide' })
    } else {
      await el.webkitRequestFullscreen?.()
    }
  } catch {
    // Denied, or not allowed outside a gesture: the console is still usable.
  }
}

export async function exitFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return
  const doc = document as FullscreenDocument
  try {
    if (typeof doc.exitFullscreen === 'function') await doc.exitFullscreen()
    else await doc.webkitExitFullscreen?.()
  } catch {
    // Nothing to exit, or the browser refused; either way there is no UI to restore.
  }
}

/**
 * Holds the console in fullscreen while one of its own overlays is up.
 *
 * The browser, not the page, decides when fullscreen ends, and on Android it ends for
 * things the console does all the time: opening the file picker (the picker is a
 * separate activity, so the tab loses fullscreen and the address bar comes back), and
 * the on-screen keyboard taking over the bottom of the screen. Neither is something the
 * page can refuse — the most it can do is ask again, and asking is only allowed inside a
 * user gesture.
 *
 * So while `wanted` is true, losing fullscreen re-arms a single one-shot request on the
 * next tap or key press, and one is also made immediately in case the exit is still
 * inside the activation of the tap that caused it (opening the load dialog does exactly
 * that).
 *
 * `wanted` is scoped to an open overlay, plus a short afterglow once it closes: loading
 * a file goes picker (fullscreen lost, no gesture-ask possible) → analysis dialog → back
 * to the console, and the first tap after that is usually PLAY. Without the afterglow
 * that tap would land one beat too late and the address bar would stay. The window is
 * short on purpose: after it, leaving fullscreen with Android's system popup or a back
 * gesture stays left alone instead of being undone on the next tap.
 *
 * Everything is best-effort — a refusal is swallowed and the console keeps working.
 */

/** How long the guard stays armed after the last overlay closes, in ms. */
const FULLSCREEN_AFTERGLOW_MS = 3000

export function useFullscreenKeeper(wanted: boolean): void {
  // `held` is `wanted` plus the afterglow, so the one-shot retry below does not go dead
  // in the same tick a dialog closes.
  const [held, setHeld] = useState(wanted)
  useEffect(() => {
    if (wanted) {
      setHeld(true)
      return
    }
    const t = window.setTimeout(() => setHeld(false), FULLSCREEN_AFTERGLOW_MS)
    return () => window.clearTimeout(t)
  }, [wanted])

  const heldRef = useRef(held)
  heldRef.current = held
  const hadFullscreen = useRef(isFullscreen())

  // A dialog that opens *because* of a tap can be where fullscreen is lost, and that tap
  // may still lend us its activation: try while it lasts rather than waiting for the next
  // one. Runs only when the overlay appears, not on every render of it.
  useEffect(() => {
    if (!held || !hadFullscreen.current || isFullscreen()) return
    void enterFullscreen()
  }, [held])

  useEffect(() => {
    let retryArmed = false

    const disarm = () => {
      if (!retryArmed) return
      retryArmed = false
      window.removeEventListener('pointerdown', retry, true)
      window.removeEventListener('keydown', retry, true)
      window.removeEventListener('touchstart', retry, true)
    }

    const retry = () => {
      disarm()
      if (!heldRef.current || isFullscreen()) return
      void enterFullscreen()
    }

    const arm = () => {
      if (retryArmed) return
      retryArmed = true
      // Capture, so the request goes out with the gesture that starts the tap rather
      // than after the element's own handler has already run.
      window.addEventListener('pointerdown', retry, true)
      window.addEventListener('keydown', retry, true)
      window.addEventListener('touchstart', retry, true)
    }

    const onChange = () => {
      if (isFullscreen()) {
        hadFullscreen.current = true
        disarm()
        return
      }
      if (!hadFullscreen.current || !heldRef.current) return
      void enterFullscreen()
      arm()
    }

    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      disarm()
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])
}

interface FullscreenState {
  supported: boolean
  active: boolean
  toggle: () => void
}

/** Tracks the browser's own fullscreen state, including leaving it via Esc or a gesture. */
export function useFullscreen(): FullscreenState {
  const [active, setActive] = useState(isFullscreen)

  useEffect(() => {
    const onChange = () => setActive(isFullscreen())
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  return {
    supported: isFullscreenSupported(),
    active,
    toggle: () => {
      void (isFullscreen() ? exitFullscreen() : enterFullscreen())
    },
  }
}
