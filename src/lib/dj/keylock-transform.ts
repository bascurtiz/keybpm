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
 * A time-stretcher's overlap-add stage re-times each analysis window — by up to ~23 ms at
 * 44.1 kHz — to find the best alignment with the previous window. That search is the whole
 * point of the algorithm when the ratio is away from 1. At unity there is nothing to align
 * and the re-timing is pure damage, so the engine is bypassed instead of asked for an
 * identity transform. (It is also the cheapest possible answer: a dry deck skips the
 * kernel, and with it {@link RB_KEYLOCK_LATENCY_SAMPLES} of delay.)
 *
 * The measurement below is from the WSOLA engine the realtime path used to offer
 * alongside Rubber Band, on Catscan - Smeerpijp through its vendored worklet, at pitch 1.0
 * with pitchSemitones 0 and playbackRate 1.0 — exactly what the deck sends at a centred
 * fader: the seek re-timed 8 windows over 20 s with jumps up to 17 ms, leaving 1.42 dB of
 * level modulation. A slow warble on a track that is meant to be playing straight. Forcing
 * the seek to a constant offset instead made the same pipe bit-transparent (level ratio
 * 1.0000, residual 0.00%), which is what pinned the seek as the cause. That was the
 * "wobble at original BPM" this rule exists to prevent, and it is kept because the rule is
 * right for *any* engine of this family, not because that engine is still here.
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
  /** True when {@link pitch} is unity, so the engine should be bypassed. */
  identity: boolean
}

/**
 * Resolves the ratio the keylock engine should apply.
 *
 * The engine is fed the vinyl worklet's output, which is already resampled to the
 * pitch-fader rate, so keylock here is a pitch shift of (1 / rate) plus the key shift —
 * the stream's length stays untouched. With keylock off the rate term drops out and only
 * the key shift is left, which is deliberate: the key dial is independent of the fader.
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
  const pitch = Math.pow(2, keyShiftSemitones / 12) * (keyLock ? 1 / effectiveRate : 1)
  return { pitch, identity: Math.abs(1200 * Math.log2(pitch)) < KEYLOCK_UNITY_CENTS }
}

/**
 * How far the audio is held back by the keylock path, in samples.
 *
 * A deck reports its position from the vinyl worklet, which sits *before* the keylock
 * engine. The engine buffers before it can emit anything, so whenever the wet path is
 * live the sound you hear is this much behind the position the deck reports — and every
 * display driven by that position (the stacked lanes, the mini waveforms, the beat
 * counters) leads the sound by the same amount.
 *
 * Measured through the realtime worklet: at a centred fader with tempo 1 and
 * highQuality, the output correlates 0.998 against the input at a lag of exactly 4096
 * samples — at 44.1 kHz (92.9 ms) and at 48 kHz (85.3 ms) alike. The kernel holds a
 * fixed 4096-sample buffer, so this is constant in samples and not in seconds, which is
 * why {@link keyLockLatencySeconds} needs the sample rate.
 *
 * Away from unity the correlation cannot be used: the peak collapses to ~0.05, so it would be
 * reading the noise floor. A step response can be used there instead, and it says this constant
 * is only right near a centred fader. Measured at 48 kHz, tempo 1, highQuality, delay read as
 * the 50%-of-steady crossing (the method reproduces 4101 samples at unity against the 4096
 * above, a +5-sample bias it is known to have):
 *
 *   rate 0.90 (pitch 1.111)  ~3970 samples   82.7 ms
 *   rate 0.95 (pitch 1.053)  ~4113 samples   85.7 ms
 *   rate 1.00 (pitch 1.000)   4096 samples   85.3 ms   <- the measurement above
 *   rate 1.05 (pitch 0.952)  ~4369 samples   91.0 ms
 *   rate 1.08 (pitch 0.926)  ~4371 samples   91.1 ms
 *   rate 1.25 (pitch 0.800)  ~4770 samples   99.4 ms
 *
 * So it is flat to within a few ms while a deck is at or below its own tempo — which is where a
 * synced deck usually lives, and why this constant is good enough in the common case — and
 * grows once a deck is pitched up, by up to 14 ms at 1.25x. The exact shape is not modelled
 * here on purpose: the readings do not fit a simple law (they are not proportional to the ratio
 * or its inverse), and a bad fit would be worse than the flat figure it replaced. What this
 * note is for is so the next person starts from the measurement rather than re-deriving it.
 *
 * That error is worth knowing about because of where it lands. `audiblePosition` subtracts this
 * latency from the deck whose wet path is live and nothing from a dry deck, so on a *mixed*
 * pair — one deck keylocked and pitched, the other playing straight — the error is not shared
 * and does not cancel: it appears directly as the keylocked deck sitting that many ms off.
 * Two keylocked decks or two dry decks both cancel it exactly. So if a keylocked deck sounds
 * slightly late against a dry one, and it is pitched up, this is the first place to look.
 *
 * The figure used here before was 0.15 s, borrowed from `rubberband-offline.ts`. That is
 * the offline push/pull path with a flush at the end, and it overstates the realtime
 * delay by about 40%.
 */
export const RB_KEYLOCK_LATENCY_SAMPLES = 4096

/**
 * Seconds the active keylock path holds the audio back. 0 when the deck plays dry.
 *
 * The latency only exists while the wet path is live, so a deck with keylock off — or one
 * bypassed because the transform is unity — reports no delay and {@link audiblePosition}
 * collapses back onto the read head.
 *
 * @param active - Whether the wet keylock path is currently in the graph.
 * @param sampleRate - The audio context's rate.
 */
export function keyLockLatencySeconds(active: boolean, sampleRate = 48000): number {
  if (!active) return 0
  return RB_KEYLOCK_LATENCY_SAMPLES / sampleRate
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
