/**
 * How much output buffer the DJ engine asks Chrome for.
 *
 * This is the one knob that decides whether playback survives a hiccup. Chrome renders Web Audio
 * in fixed blocks, and the block size comes from the `latencyHint` the context is built with, so
 * the buffer *is* the deck's tolerance for a late callback: everything the machine throws at the
 * audio thread — a Windows DPC, a GPU driver interrupt, a background app spiking a core, the
 * renderer doing a heavy layout — has to fit inside it or the output glitches.
 *
 * Measured on a 16-core Windows box through the real WASAPI device (48 kHz), BaseAudioContext
 * reports:
 *
 *   interactive   10 ms base / 40 ms output   480 frames   <- the deck used to ask for this
 *   balanced      10 ms base / 40 ms output   480 frames
 *   playback      20 ms base / 48 ms output   960 frames
 *   numeric 0.03  30 ms base / 64 ms output  1440 frames
 *   numeric 0.06  60 ms base / 88 ms output  2880 frames
 *
 * `interactive` and `balanced` are the same undersized block, which is why the deck ran on 480
 * frames: 10 ms of slack, against a desktop audio stack that routinely hiccups for longer than
 * that. The keylock voices and the vinyl worklet are not the problem — measured offline, four
 * high-quality Rubber Band kernels render ~100x realtime, i.e. well under 1 % of a core each — so
 * the buffer is where the headroom has to come from.
 *
 * Larger costs monitor latency and it is not free: a cue press is heard `base + output` later, so
 * moving off `interactive` makes the deck feel a few ms softer. That is the trade this module
 * encodes — {@link DEFAULT_AUDIO_LATENCY} keeps it modest rather than maximal — and
 * {@link AUDIO_LATENCY_KEY} lets it be overridden without a rebuild.
 *
 * Phones and tablets get the larger buffer by default ({@link HANDHELD_AUDIO_LATENCY}). The
 * desktop measurement above is not what they are fighting: a phone renders the same graph on a
 * few watts, throttles its clocks over the first minutes of sustained playback, and schedules the
 * audio callback against a main thread that is simultaneously rasterising a 60 Hz canvas console.
 * That is a slower *and* a shrinking deadline, which is exactly the case a bigger buffer exists
 * for. The latency it costs is also less perceptible there: the Android output path already adds
 * tens of milliseconds, and a cue press on glass carries none of the headphone-monitor expectation
 * of a CDJ button.
 */
export const AUDIO_LATENCY_KEY = 'keybpm:audio-latency'

/** Named buffer sizes, smallest first. */
export const AUDIO_LATENCY_SECONDS = {
  /** 480 frames — the buffering the deck shipped with: tightest feel, least slack. */
  tight: 0.01,
  /** 1440 frames — the default: 3x the slack, still a playable monitor latency. */
  balanced: 0.03,
  /** 2880 frames — for a machine that glitches anyway; the deck feels noticeably softer. */
  safe: 0.06,
} as const

export type AudioLatencyLevel = keyof typeof AUDIO_LATENCY_SECONDS

export const DEFAULT_AUDIO_LATENCY: AudioLatencyLevel = 'balanced'

/**
 * The default on a hand-held device: the largest named buffer, because that is where the
 * deadline is hardest to hit.
 *
 * A default, not a policy — {@link AUDIO_LATENCY_KEY} still wins on any device, so a phone can be
 * put back on `balanced` (or a numeric size) without a rebuild.
 */
export const HANDHELD_AUDIO_LATENCY: AudioLatencyLevel = 'safe'

/** Bounds for a hand-written numeric override, in seconds. */
const MIN_OVERRIDE_SECONDS = 0.01
const MAX_OVERRIDE_SECONDS = 0.2

/**
 * True on a phone or tablet.
 *
 * Two signals, because neither is reliable alone: a mobile user agent (which an iPad does not
 * always have — it can present itself as a Mac), and a touch-first pointer with no hover, which
 * is what a real mouse-capable laptop with a touchscreen does *not* match.
 */
export function isHandheldAudioDevice(): boolean {
  if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
    return true
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const hover = window.matchMedia('(hover: hover)').matches
    if (coarse && !hover) return true
  }
  return false
}

/** Which named size this device gets when the user has not chosen one. */
export function defaultAudioLatencyLevel(): AudioLatencyLevel {
  return isHandheldAudioDevice() ? HANDHELD_AUDIO_LATENCY : DEFAULT_AUDIO_LATENCY
}

export function readAudioLatencyHint(): number {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(AUDIO_LATENCY_KEY)
  } catch {
    /* private mode */
  }
  return parseAudioLatencyHint(raw, AUDIO_LATENCY_SECONDS[defaultAudioLatencyLevel()])
}

/**
 * The stored override: a level name, or a number of seconds for a size the levels do not cover.
 * Anything unparseable or out of range falls back to `fallback` rather than to a broken context.
 *
 * {@link readAudioLatencyHint} without the storage or device read, so the parsing is testable.
 */
export function parseAudioLatencyHint(
  raw: string | null | undefined,
  fallback: number = AUDIO_LATENCY_SECONDS[DEFAULT_AUDIO_LATENCY]
): number {
  if (!raw) return fallback

  const trimmed = raw.trim()
  if (Object.prototype.hasOwnProperty.call(AUDIO_LATENCY_SECONDS, trimmed)) {
    return AUDIO_LATENCY_SECONDS[trimmed as AudioLatencyLevel]
  }

  const seconds = Number(trimmed)
  if (!Number.isFinite(seconds)) return fallback
  return Math.min(MAX_OVERRIDE_SECONDS, Math.max(MIN_OVERRIDE_SECONDS, seconds))
}

export function writeAudioLatencyHint(level: AudioLatencyLevel): void {
  try {
    localStorage.setItem(AUDIO_LATENCY_KEY, level)
  } catch {
    /* ignore */
  }
}
