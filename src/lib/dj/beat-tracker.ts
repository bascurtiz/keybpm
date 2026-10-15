import { standardDeviation } from './spectral-flux.ts'

/**
 * Ellis-style dynamic-programming beat tracker, plus the diagnostics that make
 * its output trustworthy.
 *
 * The tracker follows Ellis's "Beat Tracking by Dynamic Programming" as
 * implemented by librosa's `beat_track` and MixCN's analyzer:
 *
 *   1. The onset envelope is normalised by its own standard deviation.
 *   2. A local score smooths it with a Gaussian whose sigma is `period / 32`,
 *      via a `2 * period + 1` tap kernel (same-mode convolution, so the edges
 *      use only the samples that exist).
 *   3. A cumulative score is maximised over every frame, with the previous beat
 *      searched in `[i - 2 * period, i - period / 2]` and a transition penalty of
 *      `tightness * (ln((i - j) / period))^2` — `tightness = 100`, as in Ellis's
 *      `beat_simple.m` and librosa.
 *   4. The path is recovered by backtracking from the last local maximum of the
 *      cumulative score that clears half the median peak height.
 *
 * Why this is worth having over the previous approach: the analyzer used to pick
 * an autocorrelation peak and then scan a single global phase for a rigid
 * lattice. A rigid lattice cannot follow a track that wobbles — a real drummer,
 * a tape-saturated disco edit, a vinyl rip — so the grid slides by the outro.
 * The DP instead searches for the *most onset-supported path* whose intervals
 * merely *prefer* the target period, so it tolerates exactly that wobble, and it
 * hands back measurable evidence about how well it did:
 *
 *   - `residualLogRms`: RMS of `ln(interval / period)` over the tracked beats,
 *     following the log-period residual the beat-tracking literature describes.
 *   - `contrast`: MixCN's contrast score — the mean onset-envelope strength on
 *     the fitted grid, relative to the track's average onset strength, scaled by
 *     the fraction of tracked beats that survived outlier rejection and by the
 *     tempo prior.
 *   - `confidence`: a documented, bounded combination of the two.
 *
 * `confidence` is a *derived* score, not a calibrated probability. It measures
 * how periodic and how onset-supported the tracked beats are; it does not know
 * whether the tracked grid is musically the right one. Storing it is still
 * worthwhile: it is the honest per-track quality signal the grid previously had
 * none of, and it is comparable across tracks because it has no free scale.
 */

export interface BeatTrackOptions {
  /** Tempo to track beats for, in BPM. The tracker refines it but does not re-estimate it. */
  bpm: number
  /** DP transition weight. Ellis's `beat_simple.m` and librosa both use 100. */
  tightness?: number
  /** Assumed tempo range, used only for the reported tempo prior. */
  minBpm?: number
  maxBpm?: number
  /** Centre of the log-normal tempo prior, in BPM. */
  priorBpm?: number
  /** Width of the tempo prior, in octaves. */
  priorOctaves?: number
  /** One-pass outlier rejection threshold, in residual sigmas. */
  outlierSigma?: number
  /** Drop leading/trailing beats with no onset support (default true). */
  trim?: boolean
}

export interface BeatTrackResult {
  /** Tracked beat positions as ODF frame indices, ascending. */
  beatFrames: number[]
  /** Beat indices that survived residual-based outlier rejection. */
  keptFrames: number[]
  /** Frame period the DP ran with. */
  periodFrames: number
  /** Least-squares tempo of the tracked beats. */
  fitBpm: number
  /** RMS of `ln(interval / fittedPeriod)` over the kept beats. */
  residualLogRms: number
  /** Worst absolute deviation from the fitted grid, in seconds of envelope time. */
  maxResidualSeconds: number
  /** Mean onset strength on the fitted grid divided by the track's mean onset strength. */
  contrast: number
  /** Fraction of fitted grid positions that landed on a tracked beat. */
  retainedRatio: number
  /** Derived 0..1 quality score (see the module comment). */
  confidence: number
}

const DEFAULT_TIGHTNESS = 100
const DEFAULT_PRIOR_BPM = 120
const DEFAULT_PRIOR_OCTAVES = 1.0
const DEFAULT_OUTLIER_SIGMA = 2.5
/**
 * Local search radius for the grid contrast score, in seconds. A flux peak sits
 * a little ahead of the impulse that caused it (the analysis window is 1024
 * samples, so it starts filling before the transient itself arrives), and a grid
 * is only ever expected to be sample-accurate to a DJ, not to the millisecond.
 * Half a window plus a little slack is the honest tolerance.
 */
const CONTRAST_WINDOW_SECONDS = 0.05

function gaussianKernel(periodFrames: number): Float64Array {
  // sigma = period / 32, spanning -period .. +period (librosa's __beat_local_score).
  const taps = 2 * Math.floor(periodFrames) + 1
  const kernel = new Float64Array(taps)
  const centre = Math.floor(periodFrames)
  for (let i = 0; i < taps; i++) {
    const k = (i - centre) / periodFrames
    kernel[i] = Math.exp(-0.5 * Math.pow(32 * k, 2))
  }
  return kernel
}

/** Gaussian-smoothed onset strength (librosa's `__beat_local_score`). */
function localScore(odf: Float32Array, periodFrames: number): Float64Array {
  const n = odf.length
  const kernel = gaussianKernel(periodFrames)
  const centre = Math.floor(periodFrames)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    const from = Math.max(0, i - centre)
    const to = Math.min(n - 1, i + centre)
    for (let t = from; t <= to; t++) {
      sum += kernel[t - i + centre] * odf[t]
    }
    out[i] = sum
  }
  return out
}

interface DpPath {
  cumscore: Float64Array
  backlink: Int32Array
}

function beatDp(local: Float64Array, periodFrames: number, tightness: number): DpPath {
  const n = local.length
  const cumscore = new Float64Array(n)
  const backlink = new Int32Array(n).fill(-1)
  const from = -2 * periodFrames
  const to = -Math.round(periodFrames / 2)
  const logPeriod = Math.log(periodFrames)

  for (let i = 0; i < n; i++) {
    let best = -Infinity
    let bestJ = -1
    const jMin = Math.max(0, i + from)
    const jMax = i + to
    for (let j = jMin; j <= jMax; j++) {
      const d = i - j
      if (d <= 0) continue
      const penalty = (Math.log(d) - logPeriod) ** 2
      const score = cumscore[j] - tightness * penalty
      if (score > best) {
        best = score
        bestJ = j
      }
    }
    if (bestJ >= 0) {
      cumscore[i] = best + local[i]
      backlink[i] = bestJ
    } else {
      cumscore[i] = local[i]
    }
  }
  return { cumscore, backlink }
}

/**
 * Endpoint rule from librosa: the median height of the cumulative-score local
 * maxima, halved, and the latest peak clearing it.
 */
function pickEndpoint(cumscore: Float64Array): number {
  const peaks: number[] = []
  for (let i = 1; i + 1 < cumscore.length; i++) {
    if (cumscore[i] > cumscore[i - 1] && cumscore[i] >= cumscore[i + 1]) peaks.push(i)
  }
  if (peaks.length === 0) {
    let best = 0
    for (let i = 1; i < cumscore.length; i++) if (cumscore[i] > cumscore[best]) best = i
    return best
  }
  const heights = peaks.map(p => cumscore[p]).sort((a, b) => a - b)
  const median = heights[Math.floor(heights.length / 2)]
  const threshold = median / 2
  for (let i = peaks.length - 1; i >= 0; i--) {
    if (cumscore[peaks[i]] >= threshold) return peaks[i]
  }
  return peaks[peaks.length - 1]
}

/**
 * librosa's beat trimming: keep the span from the first to the last beat whose
 * smoothed local score clears half the RMS of the beat-synchronous score.
 *
 * Without this, backtracking walks all the way to the start of the signal and
 * emits beats in the silent lead-in, where the onset envelope is flat zero.
 * Measured on a synthetic 4/4 track, a single bogus beat at frame 0 raised the
 * log-period residual fivefold (0.008 -> 0.035) and put a 0.57 s outlier into the
 * worst-residual report, which would have made every clean track look doubtful.
 */
function trimBeats(local: Float64Array, beats: number[], trim: boolean): number[] {
  if (beats.length < 3) return beats
  const hann = [0, 0.5, 1, 0.5, 0]
  const n = beats.length
  const smooth = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let k = 0; k < hann.length; k++) {
      const idx = i + k - 2
      if (idx >= 0 && idx < n) sum += local[beats[idx]] * hann[k]
    }
    smooth[i] = sum
  }
  let threshold = 0
  if (trim) {
    let sq = 0
    for (let i = 0; i < n; i++) sq += smooth[i] * smooth[i]
    threshold = 0.5 * Math.sqrt(sq / n)
  }
  let first = -1
  let last = -1
  for (let i = 0; i < n; i++) {
    if (smooth[i] > threshold) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0 || last < first) return beats
  return beats.slice(first, last + 1)
}

function backtrack(backlink: Int32Array, end: number): number[] {
  const path: number[] = []
  let i = end
  let guard = 0
  while (i >= 0 && guard++ < backlink.length + 1) {
    path.push(i)
    const prev = backlink[i]
    if (prev < 0 || prev >= i) break
    i = prev
  }
  return path.reverse()
}

interface LineFit {
  slope: number
  intercept: number
  keptIndices: number[]
}

/**
 * Least-squares fit of beat index against frame, with MixCN's single-pass
 * outlier rejection at `outlierSigma` (only when at least eight beats remain).
 */
function fitBeats(frames: number[], outlierSigma: number): LineFit | null {
  if (frames.length < 2) return null
  const fit = (indices: number[]): { slope: number; intercept: number; sigma: number } => {
    const n = indices.length
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    for (let k = 0; k < n; k++) {
      const x = indices[k]
      const y = frames[k]
      sx += x
      sy += y
      sxx += x * x
      sxy += x * y
    }
    const denom = n * sxx - sx * sx
    const slope = Math.abs(denom) < 1e-12 ? 0 : (n * sxy - sx * sy) / denom
    const intercept = (sy - slope * sx) / n
    let sq = 0
    for (let k = 0; k < n; k++) {
      const r = frames[k] - (intercept + slope * indices[k])
      sq += r * r
    }
    return { slope, intercept, sigma: Math.sqrt(sq / n) }
  }

  const all = frames.map((_, k) => k)
  const first = fit(all)
  if (!(first.slope > 0)) return null

  const keptIndices: number[] = []
  const keptFrames: number[] = []
  if (first.sigma > 0) {
    for (let k = 0; k < frames.length; k++) {
      const r = frames[k] - (first.intercept + first.slope * k)
      if (Math.abs(r) <= outlierSigma * first.sigma) {
        keptIndices.push(k)
        keptFrames.push(frames[k])
      }
    }
  }
  if (keptFrames.length < 8 || keptFrames.length === frames.length) {
    return { slope: first.slope, intercept: first.intercept, keptIndices: all }
  }

  // Refit on the kept beats, re-numbering them from 0 so the line stays local.
  const reindexed = keptIndices.map((_, k) => k)
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let k = 0; k < keptFrames.length; k++) {
    sx += reindexed[k]
    sy += keptFrames[k]
    sxx += reindexed[k] * reindexed[k]
    sxy += reindexed[k] * keptFrames[k]
  }
  const n = keptFrames.length
  const denom = n * sxx - sx * sx
  const slope = Math.abs(denom) < 1e-12 ? first.slope : (n * sxy - sx * sy) / denom
  if (!(slope > 0)) return { slope: first.slope, intercept: first.intercept, keptIndices: all }
  const intercept = (sy - slope * sx) / n

  // Map the kept beats back onto the original beat numbering.
  const scale = first.slope > 0 ? slope / first.slope : 1
  const offset = intercept - first.intercept * scale
  return { slope: first.slope * scale, intercept: offset, keptIndices }
}

function tempoPrior(bpm: number, centreBpm: number, octaves: number): number {
  if (!(bpm > 0) || !(centreBpm > 0) || !(octaves > 0)) return 1
  return Math.exp(-0.5 * Math.pow(Math.log2(bpm / centreBpm) / octaves, 2))
}

/** Bounded, documented confidence from the two measured diagnostics. */
export function beatConfidenceFrom(residualLogRms: number, contrast: number, retainedRatio: number): number {
  // A residual is an RMS, so it can never be negative; clamp rather than let an
  // out-of-range caller report a sub-zero quality.
  const residual = Math.max(0, residualLogRms)
  const consistency = 1 / (1 + Math.pow(residual / 0.04, 2))
  const support = Math.max(0, Math.min(1, contrast / 2)) * Math.max(0, Math.min(1, retainedRatio))
  return Math.round(Math.max(0, Math.min(1, consistency * support)) * 1000) / 1000
}

/**
 * Track beats for a given tempo. Returns `null` when the envelope is too short
 * to say anything.
 */
export function trackBeats(
  odf: Float32Array,
  envRate: number,
  options: BeatTrackOptions
): BeatTrackResult | null {
  const { bpm } = options
  if (!(bpm > 0) || !(envRate > 0) || odf.length < 16) return null

  const tightness = options.tightness ?? DEFAULT_TIGHTNESS
  const periodFrames = Math.max(4, Math.round((envRate * 60) / bpm))
  if (odf.length < periodFrames * 3) return null

  // 1. Normalise by the envelope's own spread so `tightness` means the same
  //    thing regardless of how loud the track is. A flat envelope has nothing to
  //    track: without this guard the DP still returns a perfectly regular
  //    lattice of 81-frame intervals on pure silence, because a constant zero
  //    cumulative score has a peak at its last frame.
  const sd = standardDeviation(odf)
  if (!(sd > 1e-9)) return null
  const scale = 1 / sd
  const normalised = new Float32Array(odf.length)
  for (let i = 0; i < odf.length; i++) normalised[i] = odf[i] * scale

  // 2-3. Local score and dynamic program.
  const local = localScore(normalised, periodFrames)
  const { cumscore, backlink } = beatDp(local, periodFrames, tightness)

  // 4. Endpoint, path, and trimming of unsupported leading/trailing beats.
  const rawPath = backtrack(backlink, pickEndpoint(cumscore))
  const beatFrames = trimBeats(local, rawPath, options.trim !== false)
  if (beatFrames.length < 4) return null

  // 5. Fit a line through the beat index -> frame relation. The slope is the
  //    measured beat period, which is the tempo this performance actually has.
  const fit = fitBeats(beatFrames, options.outlierSigma ?? DEFAULT_OUTLIER_SIGMA)
  if (!fit || !(fit.slope > 0)) return null

  const fittedPeriod = fit.slope
  const fitBpm = (60 * envRate) / fittedPeriod

  // 6. Log-period residual over the kept beats, per the beat-tracking literature.
  let sq = 0
  let count = 0
  let maxAbs = 0
  for (let k = 1; k < beatFrames.length; k++) {
    const interval = beatFrames[k] - beatFrames[k - 1]
    if (interval <= 0) continue
    const e = Math.log(interval / fittedPeriod)
    sq += e * e
    count++
    maxAbs = Math.max(maxAbs, Math.abs(beatFrames[k] - (fit.intercept + fit.slope * k)))
  }
  const residualLogRms = count > 0 ? Math.sqrt(sq / count) : 0

  // 7. MixCN's contrast score: how much onset support the fitted grid has,
  //    relative to the track's average onset strength.
  const windowFrames = Math.max(1, Math.round(CONTRAST_WINDOW_SECONDS * envRate))
  let meanOdf = 0
  for (let i = 0; i < odf.length; i++) meanOdf += odf[i]
  meanOdf /= odf.length

  const firstFrame = beatFrames[0]
  const lastFrame = beatFrames[beatFrames.length - 1]
  const gridPositions = Math.max(1, Math.round((lastFrame - firstFrame) / fittedPeriod) + 1)
  let gridSupport = 0
  for (let g = 0; g < gridPositions; g++) {
    const centre = Math.round(firstFrame + g * fittedPeriod)
    let peak = 0
    for (let w = -windowFrames; w <= windowFrames; w++) {
      const idx = centre + w
      if (idx >= 0 && idx < odf.length && normalised[idx] > peak) peak = normalised[idx]
    }
    gridSupport += peak
  }
  gridSupport /= gridPositions
  const meanNormalised = meanOdf * scale
  const contrast = meanNormalised > 1e-9 ? gridSupport / meanNormalised : 0

  // A path with no onset support anywhere on its grid is not a beat train. This
  // is the guard that keeps a quiet or non-rhythmic stretch of a track from
  // being reported as confidently tracked.
  if (!(gridSupport > 0) || !(contrast > 0)) return null

  // Retained ratio: tracked beats that survived outlier rejection, expressed
  // against the number of beats the fitted grid expects.
  const retainedRatio = Math.max(0, Math.min(1, fit.keptIndices.length / gridPositions))
  const prior = tempoPrior(fitBpm, options.priorBpm ?? DEFAULT_PRIOR_BPM, options.priorOctaves ?? DEFAULT_PRIOR_OCTAVES)
  const confidence = beatConfidenceFrom(residualLogRms, contrast * prior, retainedRatio)

  return {
    beatFrames,
    keptFrames: fit.keptIndices.map(k => beatFrames[k]),
    periodFrames,
    fitBpm: Math.round(fitBpm * 100) / 100,
    residualLogRms: Math.round(residualLogRms * 10000) / 10000,
    maxResidualSeconds: Math.round((maxAbs / envRate) * 1000) / 1000,
    contrast: Math.round(contrast * 1000) / 1000,
    retainedRatio: Math.round(retainedRatio * 1000) / 1000,
    confidence,
  }
}

/**
 * Explain how a stored BPM relates to the tempo that was measured.
 *
 * The analyzer is a chain of cross-checks (Queen Mary, the onset
 * autocorrelation, deliberate half/double resolution), so "the raw measurement"
 * is ambiguous: the honest statement is the ratio between what the primary
 * engine measured and what ended up stored. That ratio is the `bpmMultiplier`,
 * and it keeps `rawBpm = bpm / bpmMultiplier` true however far down the chain the
 * octave decision was taken.
 */
export function deriveBpmInterpretation(
  measuredBpm: number,
  storedBpm: number,
  tolerance = 0.02
): { multiplier: number; rawBpm: number } {
  if (!(measuredBpm > 0) || !(storedBpm > 0) || !Number.isFinite(measuredBpm) || !Number.isFinite(storedBpm)) {
    return { multiplier: 1, rawBpm: measuredBpm }
  }
  const ratio = storedBpm / measuredBpm
  for (const candidate of [2, 0.5] as const) {
    if (Math.abs(ratio - candidate) <= candidate * tolerance) {
      return { multiplier: candidate, rawBpm: Math.round(measuredBpm * 100) / 100 }
    }
  }
  return { multiplier: 1, rawBpm: Math.round(measuredBpm * 100) / 100 }
}

/**
 * DJ BPM normalisation, made explicit and reversible.
 *
 * The analyzer used to double or halve a detected tempo inline, silently
 * overwriting the measurement — so a track detected at 87.5 BPM came back as
 * 175 with no record that the interpretation had been applied, and no way back.
 * Following Velyos, both numbers are kept: `bpm` is the DJ-normalised value and
 * `rawBpm` is exactly what the detectors measured. The multiplier is stored
 * alongside them, so `rawBpm = bpm / bpmMultiplier` always holds and the
 * half/double reading is reversible instead of destructive.
 */
export interface DjBpmNormalization {
  bpm: number
  rawBpm: number
  multiplier: number
}

export interface DjBpmOptions {
  minBpm?: number
  maxBpm?: number
  /** Below this, doubling is considered (DJ practice reads 85 as 170). */
  lowThreshold?: number
  /** Above this, halving is considered. */
  highThreshold?: number
}

export function normalizeDjBpm(rawBpm: number, options: DjBpmOptions = {}): DjBpmNormalization {
  const minBpm = options.minBpm ?? 65
  const maxBpm = options.maxBpm ?? 195
  const lowThreshold = options.lowThreshold ?? 85
  const highThreshold = options.highThreshold ?? 185

  if (!(rawBpm > 0) || !Number.isFinite(rawBpm)) {
    return { bpm: rawBpm, rawBpm, multiplier: 1 }
  }

  let bpm = rawBpm
  let multiplier = 1
  if (bpm < lowThreshold && bpm * 2 <= maxBpm) {
    bpm *= 2
    multiplier = 2
  } else if (bpm > highThreshold && bpm / 2 >= minBpm) {
    bpm /= 2
    multiplier = 0.5
  }

  return {
    bpm: Math.round(bpm * 100) / 100,
    rawBpm: Math.round(rawBpm * 100) / 100,
    multiplier,
  }
}

