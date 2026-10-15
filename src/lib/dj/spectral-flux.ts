import { makeFft } from './dsp.ts'

/**
 * Shared onset detection front-end: log-spaced spectral flux.
 *
 * Every tempo/beat path in the analyzer used to carry its own copy of a
 * hand-tuned three-band onset detection function:
 *
 *     flux = 2.5 * low + 1.0 * mid + 0.6 * high
 *
 * Those weights were tuned on dance music, so a track whose rhythmic energy sits
 * somewhere else (live drums, acoustic, broken beat, sparse percussion) is
 * scored by a constant that nobody can justify from the signal. This module
 * replaces them with the log-band grouping used by MixCN's analyzer: the
 * spectrum is split into `bandCount` logarithmically spaced bands from 40 Hz to
 * Nyquist, each band's positive log-magnitude change is taken, and the bands are
 * summed with equal weight. Log spacing gives a roughly constant number of bands
 * per octave instead of throwing away everything above 8 kHz, and because the
 * flux is measured in log-magnitude, a quiet hi-hat band contributes on the same
 * footing as the kick.
 *
 * The low-frequency group (< 180 Hz) is still kept separately as `lowOdf`
 * because the kick is what a DJ grid is anchored to; it is derived by summing
 * the low bands instead of being a special case with its own multiplier.
 */

export const LOG_BAND_COUNT = 24
export const LOG_BAND_MIN_HZ = 40
/** Upper edge of the low (kick/bass) group, matching Mixxx's low band. */
export const LOW_GROUP_HZ = 180

export const ODF_WIN = 1024
/**
 * 128-sample hop (~5.8 ms at 22.05 kHz) rather than MixCN's 256 (~11.6 ms): the
 * beat phase anchor is fitted to this resolution, and a finer grid measures the
 * transient position more precisely.
 */
export const ODF_HOP = 128

export interface LogBandLayout {
  bandCount: number
  /** First FFT bin of each band (inclusive). */
  starts: Int32Array
  /** Last FFT bin of each band (inclusive). */
  ends: Int32Array
  /** Geometric centre frequency of each band, for reporting. */
  centres: Float64Array
  /** Number of bins per band, as drawn from the spectrum. */
  widths: Int32Array
  /** First band index whose centre is at or above `LOW_GROUP_HZ`. */
  lowGroupEnd: number
}

/**
 * Logarithmically spaced band edges from `minHz` to Nyquist. Everything below
 * `minHz` (DC and sub-40 Hz rumble) is folded into the first band, as MixCN does.
 */
export function buildLogBandLayout(
  sampleRate: number,
  fftSize = ODF_WIN,
  bandCount = LOG_BAND_COUNT,
  minHz = LOG_BAND_MIN_HZ
): LogBandLayout {
  const nyquist = sampleRate / 2
  const top = Math.max(minHz * 1.5, nyquist)
  const ratio = Math.pow(top / minHz, 1 / bandCount)
  const binHz = sampleRate / fftSize
  const lastBin = fftSize / 2 - 1

  const starts = new Int32Array(bandCount)
  const ends = new Int32Array(bandCount)
  const centres = new Float64Array(bandCount)
  const widths = new Int32Array(bandCount)

  let edgeHz = minHz
  for (let b = 0; b < bandCount; b++) {
    const nextHz = b === bandCount - 1 ? top : edgeHz * ratio
    // Band 0 also absorbs everything below minHz, so it always starts at bin 1.
    const startBin = b === 0 ? 1 : Math.max(1, Math.round(edgeHz / binHz))
    const endBin = b === bandCount - 1 ? lastBin : Math.max(startBin, Math.round(nextHz / binHz) - 1)
    starts[b] = Math.min(startBin, lastBin)
    ends[b] = Math.min(Math.max(endBin, starts[b]), lastBin)
    centres[b] = Math.sqrt(edgeHz * nextHz)
    widths[b] = ends[b] - starts[b] + 1
    edgeHz = nextHz
  }

  let lowGroupEnd = bandCount
  for (let b = 0; b < bandCount; b++) {
    if (centres[b] >= LOW_GROUP_HZ) {
      lowGroupEnd = b
      break
    }
  }
  if (lowGroupEnd < 1) lowGroupEnd = 1

  return { bandCount, starts, ends, centres, widths, lowGroupEnd }
}

export interface OnsetEnvelope {
  /** Sum of the positive log-magnitude change across every band. */
  odf: Float32Array
  /** Same, restricted to the low (< 180 Hz) group — the kick/bass pulse. */
  lowOdf: Float32Array
  /** Envelope frames per second. */
  envRate: number
  frames: number
  layout: LogBandLayout
}

export interface OnsetEnvelopeOptions {
  hop?: number
  win?: number
  bandCount?: number
  minHz?: number
  layout?: LogBandLayout
}

/**
 * Half-wave rectified spectral flux over log-spaced bands.
 *
 * `mono` is expected to be the decimated analysis signal (the caller decides the
 * rate); `envRate` is therefore `sampleRate / hop`.
 */
export function computeOnsetEnvelope(
  mono: Float32Array,
  sampleRate: number,
  options: OnsetEnvelopeOptions = {}
): OnsetEnvelope | null {
  const win = options.win ?? ODF_WIN
  const hop = options.hop ?? ODF_HOP
  const layout =
    options.layout ?? buildLogBandLayout(sampleRate, win, options.bandCount, options.minHz)

  const frames = Math.floor((mono.length - win) / hop)
  if (frames < 8) return null

  const fft = makeFft(win)
  const hann = new Float32Array(win)
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win)
  const re = new Float32Array(win)
  const im = new Float32Array(win)

  const odf = new Float32Array(frames)
  const lowOdf = new Float32Array(frames)
  const bandFlux = new Float32Array(layout.bandCount)
  const prevLogs = new Float32Array(layout.bandCount).fill(NaN)

  for (let f = 0; f < frames; f++) {
    const base = f * hop
    for (let i = 0; i < win; i++) re[i] = mono[base + i] * hann[i]
    im.fill(0)
    fft(re, im)

    let total = 0
    let low = 0
    for (let b = 0; b < layout.bandCount; b++) {
      let mag = 0
      const start = layout.starts[b]
      const end = layout.ends[b]
      for (let k = start; k <= end; k++) mag += Math.sqrt(re[k] * re[k] + im[k] * im[k])
      const logMag = Math.log1p(mag)
      const prev = prevLogs[b]
      const d = Number.isNaN(prev) ? 0 : Math.max(0, logMag - prev)
      prevLogs[b] = logMag
      bandFlux[b] = d
      total += d
      if (b < layout.lowGroupEnd) low += d
    }

    odf[f] = total
    lowOdf[f] = low
  }

  return { odf, lowOdf, envRate: sampleRate / hop, frames, layout }
}

/**
 * Adaptive background suppression: subtract a local moving mean so sustained
 * pads, basslines and drones fall to zero and only sharp attacks survive.
 * Mutates `x` in place, as every caller previously did.
 */
export function suppressBackground(x: Float32Array, half: number): void {
  const n = x.length
  if (n === 0) return
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i]
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n, i + half + 1)
    const mean = (prefix[b] - prefix[a]) / (b - a)
    x[i] = Math.max(0, x[i] - mean)
  }
}

/**
 * The analyzer's frame -> time convention, in one place.
 *
 * An envelope frame `f` is the flux computed over the window that starts at
 * sample `f * hop`, so the onset it measures sits at that window's centre. Every
 * caller used to re-derive this as `(frame * HOP + WIN / 2) / sampleRate`, which
 * is how a beat that lands 35 ms early gets into a stored grid if one caller
 * forgets the half window.
 */
export function frameToSeconds(
  frame: number,
  sampleRate: number,
  hop = ODF_HOP,
  win = ODF_WIN,
  offsetSeconds = 0
): number {
  return (frame * hop + win / 2) / sampleRate + offsetSeconds
}

/** Inverse of {@link frameToSeconds}. */
export function secondsToFrame(
  seconds: number,
  sampleRate: number,
  hop = ODF_HOP,
  win = ODF_WIN,
  offsetSeconds = 0
): number {
  return (seconds - offsetSeconds) * (sampleRate / hop) - win / (2 * hop)
}

/** Standard deviation of an array (population), used to normalise the ODF. */
export function standardDeviation(x: Float32Array, slice?: { from: number; to: number }): number {
  const from = slice ? Math.max(0, slice.from) : 0
  const to = slice ? Math.min(x.length, slice.to) : x.length
  const n = to - from
  if (n <= 1) return 0
  let sum = 0
  for (let i = from; i < to; i++) sum += x[i]
  const mean = sum / n
  let sq = 0
  for (let i = from; i < to; i++) {
    const d = x[i] - mean
    sq += d * d
  }
  return Math.sqrt(sq / (n - 1))
}
