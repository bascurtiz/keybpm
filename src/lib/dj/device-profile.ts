import { isHandheldAudioDevice } from './audio-latency'

/**
 * How hard the mix console is allowed to push a given device.
 *
 * The console was built for a desktop and then squeezed onto phones, where the budget is a
 * fraction of the one it was tuned against: a phone renders the same graph on a few watts,
 * schedules the audio callback against a main thread that is also rasterising a 60 Hz canvas
 * console, and — on iOS — ignores `latencyHint` entirely, so there is no larger output buffer
 * to hide a missed deadline behind. When two decks are playing together the work doubles, and
 * that is exactly when a phone starts glitching: the playhead messages, the React updates they
 * drive, and the two full-canvas waveform redraws all land in the same budget as the audio
 * thread.
 *
 * So the hand-held profile spends frame rate rather than audio quality:
 *
 *  - **30 playhead reports per second** instead of 60. Each report crosses the worklet port,
 *    runs a callback on the main thread and re-renders the console; halving the rate halves
 *    that, and a playhead stepping at 30 Hz is not perceptibly worse on a phone.
 *  - **Waveform lanes redrawn every second frame.** The lanes are the most expensive surface in
 *    the console (two decks, a beat grid, peaks and a playhead, cleared and redrawn in full).
 *    At 30 Hz they still move smoothly and cost half the raster time.
 *
 *  - **Keylock scaled to mobile real-time budgets:** On mobile / handheld devices,
 *    each deck uses 1 Rubber Band voice (instead of 2) and fast mode (WSOLA)
 *    instead of the heavy phase vocoder, reducing concurrent WASM DSP load by ~85%.
 *
 * {@link HANDHELD_OVERRIDE_KEY} sets the profile by hand — `keybpm:handheld` = `1` or `0` — so
 * the phone path can be exercised on a desktop, or a tablet with a keyboard can get the desktop
 * budget back. Read once and cached, so changing it needs a page load.
 */
export const HANDHELD_OVERRIDE_KEY = 'keybpm:handheld'

export interface ConsoleProfile {
  /** True on a phone or tablet (or when the override says so). */
  handheld: boolean
  /** Playhead reports the vinyl worklet should send, per second. */
  positionReportHz: number
  /** Draw every Nth animation frame on the heavy waveform canvases. */
  canvasStride: number
}

const DESKTOP_PROFILE: ConsoleProfile = {
  handheld: false,
  positionReportHz: 60,
  canvasStride: 1,
}

const HANDHELD_PROFILE: ConsoleProfile = {
  handheld: true,
  positionReportHz: 30,
  canvasStride: 2,
}

function readHandheldOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(HANDHELD_OVERRIDE_KEY)
    if (raw === '1' || raw === 'true' || raw === 'on') return true
    if (raw === '0' || raw === 'false' || raw === 'off') return false
  } catch {
    /* private mode */
  }
  return null
}

let cached: ConsoleProfile | null = null

/** The console profile for this device. */
export function consoleProfile(): ConsoleProfile {
  if (cached) return cached
  const handheld = readHandheldOverride() ?? isHandheldAudioDevice()
  cached = handheld ? HANDHELD_PROFILE : DESKTOP_PROFILE
  return cached
}
