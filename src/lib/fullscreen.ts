import { useEffect, useState } from 'react'

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
