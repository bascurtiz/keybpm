import { useEffect } from 'react'

/** The parts of the Screen Wake Lock API this module uses. */
interface WakeLockSentinelLike {
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

interface WakeLockLike {
  request: (kind: 'screen') => Promise<WakeLockSentinelLike>
}

/**
 * Keeps the screen on while the console is playing.
 *
 * A media element gets this for free: Chrome holds the display awake for as long as an
 * `<audio>` or `<video>` is playing. The DJ console has no media element — its decks are an
 * `AudioWorklet` feeding a Web Audio graph — so on Android the display dims on the user's own
 * screen timeout in the middle of a set. That is annoying on its own, and on phones with strict
 * power management it is also the moment the device starts dropping clocks: the audio callback
 * keeps its deadline while the SoC decides the app is idle, and playback that was clean for two
 * minutes starts glitching.
 *
 * This is the standard web way to say "this is playback, do not idle". Call it with `false` and
 * the lock is released, so a paused console drains no more than any other page.
 *
 * Everything is best-effort: the API is missing on older browsers, refuses outside a user
 * gesture (a play press is one), and is released by the system whenever the document is hidden.
 * Playback is unaffected when any of that happens, which is why no failure is surfaced.
 */
export function useKeepScreenAwake(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined') return
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
    if (!wakeLock) return

    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    const acquire = () => {
      if (cancelled) return
      wakeLock
        .request('screen')
        .then(held => {
          // Released between the request and its answer: hand it straight back rather than
          // leaving a lock nobody will ever release.
          if (cancelled) {
            void held.release().catch(() => {})
            return
          }
          sentinel = held
          held.addEventListener('release', () => {
            sentinel = null
          })
        })
        .catch(() => {})
    }

    // The system drops the lock when the page is hidden (tab switch, screen off, a call), so it
    // has to be re-taken when the console is back in front rather than assumed to be held.
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinel) acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (sentinel) void sentinel.release().catch(() => {})
    }
  }, [active])
}
