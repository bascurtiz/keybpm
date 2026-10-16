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

/** Bounds for a hand-written numeric override, in seconds. */
const MIN_OVERRIDE_SECONDS = 0.01
const MAX_OVERRIDE_SECONDS = 0.2

/**
 * The stored override: a level name, or a number of seconds for a size the levels do not cover.
 * Anything unparseable or out of range falls back to the default rather than to a broken context.
 */
export function readAudioLatencyHint(): number {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(AUDIO_LATENCY_KEY)
  } catch {
    /* private mode */
  }
  return parseAudioLatencyHint(raw)
}

/** {@link readAudioLatencyHint} without the storage read, so the parsing is testable. */
export function parseAudioLatencyHint(raw: string | null | undefined): number {
  const fallback = AUDIO_LATENCY_SECONDS[DEFAULT_AUDIO_LATENCY]
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
