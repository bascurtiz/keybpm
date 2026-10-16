/**
 * Which realtime engine holds the key, as a user preference.
 *
 * Kept in localStorage rather than in the engine because the choice has to survive a reload
 * and has to be readable *before* the worklets finish loading — the Rubber Band voices do not
 * exist until the vinyl worklet is up, so the preference is applied once they appear.
 */
import type { KeyLockEngine } from './keylock-transform'

export const KEY_LOCK_ENGINE_KEY = 'keybpm:keylock-engine'

export function readKeyLockEngine(): KeyLockEngine {
  try {
    const v = localStorage.getItem(KEY_LOCK_ENGINE_KEY)
    if (v === 'rubberband' || v === 'soundtouch') return v
  } catch {
    /* private mode */
  }
  return 'soundtouch'
}

export function writeKeyLockEngine(engine: KeyLockEngine): void {
  try {
    localStorage.setItem(KEY_LOCK_ENGINE_KEY, engine)
  } catch {
    /* ignore */
  }
}

/** Copy for the settings panel, kept next to the values so the two cannot drift apart. */
export const KEY_LOCK_ENGINE_INFO: Record<
  KeyLockEngine,
  { label: string; tagline: string; detail: string }
> = {
  soundtouch: {
    label: 'SoundTouch',
    tagline: 'Default · smoother pitch changes',
    detail:
      'Its pitch is an AudioParam, so fader, nudge and sync changes ramp instead of restarting the stretch. ~1 cent off at a pitched fader. Buffers ~133 ms.',
  },
  rubberband: {
    label: 'Rubber Band',
    tagline: 'Exact pitch · heavier',
    detail:
      'Holds the key exactly (0 cents) and buffers less (~93 ms), but every ratio change restarts its kernel, so a deck keeps two of them and the key steps while a fader is moving.',
  },
}
