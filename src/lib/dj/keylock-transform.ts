/**
 * What pitch ratio the keylock engine should apply, and whether that is a no-op.
 *
 * Kept apart from the deck so the routing decision can be exercised without an
 * AudioContext — the deck's audio graph is not needed to answer it, and this is the
 * decision that decides whether a deck plays straight or through a time-stretcher.
 */

/**
 * How close to unity the keylock transform has to be before the deck just plays dry.
 *
 * Both keylock engines are WSOLA-family time-stretchers, and their overlap-add stage
 * re-times each analysis window — by up to ~23 ms at 44.1 kHz — to find the best
 * alignment with the previous window. That search is the whole point of the algorithm
 * when the ratio is away from 1. At unity there is nothing to align and the re-timing
 * is pure damage.
 *
 * Measured on Catscan - Smeerpijp through the vendored worklet, at pitch 1.0 with
 * pitchSemitones 0 and playbackRate 1.0 — exactly what the deck sends at a centred
 * fader: the seek re-timed 8 windows over 20 s with jumps up to 17 ms, leaving 1.42 dB
 * of level modulation. A slow warble on a track that is meant to be playing straight.
 * Forcing the seek to a constant offset instead made the same pipe bit-transparent
 * (level ratio 1.0000, residual 0.00%), which is what pinned the seek as the cause.
 *
 * Note that a *constant* offset is harmless: consecutive windows still agree, so the
 * overlap crossfade joins a sample to itself. Only a *changing* offset tears the
 * timeline, and the 8 ms crossfade smears each tear into the warble. The seek cannot be
 * pinned from the main thread, so the fix is to not run the engine when it would be an
 * identity transform.
 *
 * One cent. The pitch faders step by 0.05% (0.87 cents), so this covers the centre
 * detent and the step either side of it — and at that size the correction being skipped
 * is inaudible anyway.
 */
export const KEYLOCK_UNITY_CENTS = 1

export interface KeyLockTransform {
  /** The ratio the keylock engine should apply, key shift included. 1 means nothing to do. */
  pitch: number
  /**
   * The rate compensation alone, with the key shift left out.
   *
   * SoundTouch takes the key shift through its own `pitchSemitones` parameter — the
   * worklet folds it in as `pitch * 2^(pitchSemitones / 12) / playbackRate` — so it
   * wants this rather than {@link pitch}, or the shift would be applied twice.
   */
  ratePitch: number
  /** True when {@link pitch} is unity, so the engine should be bypassed. */
  identity: boolean
}

/**
 * Resolves the ratio the keylock engine should apply.
 *
 * The engines are fed the vinyl worklet's output, which is already resampled to the
 * pitch-fader rate, so keylock here is a pitch shift of (1 / rate) plus the key shift —
 * the stream's length stays untouched.
 *
 * @param rate - Pitch-fader rate.
 * @param nudgeFactor - Pitch-bend factor, 1 at rest.
 * @param pllCorrection - Sync drift correction, 1 at rest.
 * @param keyLock - Whether keylock is engaged.
 * @param keyShiftSemitones - Dialled-in key shift, 0 for none.
 */
export function keyLockTransform(
  rate: number,
  nudgeFactor: number,
  pllCorrection: number,
  keyLock: boolean,
  keyShiftSemitones: number,
): KeyLockTransform {
  const effectiveRate = rate * nudgeFactor * pllCorrection
  const ratePitch = keyLock ? 1 / effectiveRate : 1
  const pitch = ratePitch * Math.pow(2, keyShiftSemitones / 12)
  return { pitch, ratePitch, identity: Math.abs(1200 * Math.log2(pitch)) < KEYLOCK_UNITY_CENTS }
}

/** Which realtime engine holds the key. See {@link DeckEngine.setKeyLockEngine}. */
export type KeyLockEngine = 'rubberband' | 'soundtouch'

/**
 * How far the audio is held back by the keylock path, in seconds.
 *
 * A deck reports its position from the vinyl worklet, which sits *before* the keylock
 * engine. The engine buffers before it can emit anything, so whenever the wet path is
 * live the sound you hear is this much behind the position the deck reports — and every
 * display driven by that position (the stacked lanes, the mini waveforms, the beat
 * counters) leads the sound by the same amount.
 *
 * Measured through the vendored processor, keylock at a centred fader with the WSOLA seek
 * pinned so the output is an exact copy and the delay has one unambiguous correlation
 * peak: 5864 samples at 44.1 kHz (133.0 ms) and 6369 at 48 kHz (132.7 ms). Flat in
 * seconds across sample rate, which is why this is expressed in seconds.
 *
 * It is close to flat across tempo too, at least for the rates a synced deck uses. The
 * WSOLA sequence length is `clamp(200 - 75 * tempo, 50, 125)` ms, so every tempo at or
 * below 1 pins it to the 125 ms maximum and the buffering does not change. Only decks
 * pitched *up* past their own tempo get a shorter pipeline, and this constant does not
 * model that — it is a fixed figure, deliberately, because the error there is a few tens
 * of ms on a display rather than a sync error.
 *
 * Sanity check against the case that prompted this: a grid downbeat measured 23.5 px
 * right of the playhead on a lane of 91 px per beat — 0.258 beats, which at 123.04 BPM is
 * 126 ms. Within the pixel error of the 133 ms measured here.
 */
export const ST_KEYLOCK_LATENCY_SECONDS = 0.133

/**
 * The same figure for Rubber Band's realtime kernel, which is buffered in *samples* rather
 * than in time.
 *
 * Measured through the realtime worklet (see the harness notes in the daily log): at a
 * centred fader with tempo 1 and highQuality, the output correlates 0.998 against the input
 * at a lag of exactly 4096 samples — at 44.1 kHz (92.9 ms) and at 48 kHz (85.3 ms) alike.
 * Constant in samples, not in seconds: the kernel holds a fixed 4096-sample buffer, where
 * SoundTouch's WSOLA sequence length is expressed in milliseconds. So this one needs the
 * sample rate, and is why {@link keyLockLatencySeconds} takes it.
 *
 * The figure used here before was 0.15 s, borrowed from `rubberband-offline.ts`. That is the
 * offline push/pull path with a flush at the end, and it overstates the realtime delay by
 * about 40%.
 */
export const RB_KEYLOCK_LATENCY_SAMPLES = 4096

/**
 * Seconds the active keylock path holds the audio back. 0 when the deck plays dry.
 *
 * The latency only exists while the wet path is live, so a deck with keylock off — or one
 * bypassed because the transform is unity — reports no delay and {@link audiblePosition}
 * collapses back onto the read head.
 *
 * @param sampleRate - The audio context's rate. Only Rubber Band needs it; SoundTouch's
 *   latency is already a time.
 */
export function keyLockLatencySeconds(
  engine: KeyLockEngine,
  active: boolean,
  sampleRate = 48000,
): number {
  if (!active) return 0
  if (engine === 'rubberband') return RB_KEYLOCK_LATENCY_SAMPLES / sampleRate
  return ST_KEYLOCK_LATENCY_SECONDS
}

/**
 * The source position being heard right now, as opposed to the one being read.
 *
 * The delay is a playback-time delay, so it costs `latency * rate` source seconds: in
 * `latency` of wall clock the read head advances that far into the track. Multiplying by
 * the rate is what keeps the correction right on a pitched deck rather than only at a
 * centred fader.
 *
 * @param posSeconds - The deck's read head, in source seconds.
 * @param rate - Pitch-fader rate the read head is advancing at.
 * @param latencySeconds - From {@link keyLockLatencySeconds}.
 */
export function audiblePosition(posSeconds: number, rate: number, latencySeconds: number): number {
  if (latencySeconds <= 0) return posSeconds
  return posSeconds - latencySeconds * rate
}
