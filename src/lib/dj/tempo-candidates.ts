/**
 * Tempo estimation by committee.
 *
 * The analyzer used to decide half/double from one number and a threshold: under
 * 85 BPM, double it; over 185, halve it. That is a guess dressed as a rule, and
 * the benchmark showed what it costs — a 174 BPM drum-and-bass track came back as
 * **86.9 BPM**, which is inside the "fine" band, so nothing doubled it, and a DJ
 * got a grid on every other beat with a perfect phase. (Half the beats landing is
 * why the F-measure only dropped to 0.65 instead of collapsing: an octave error is
 * quiet.)
 *
 * So instead of one estimator and a threshold, several estimators vote, and the
 * octave is decided by *measured* evidence with the tempo prior as a tie-breaker:
 *
 *  - `onset-acf`       autocorrelation of the full onset envelope with a comb
 *                      filter over harmonics. Precise about the period, ambiguous
 *                      about the octave by construction.
 *  - `low-band-acf`    the same on the kick/bass group only. Kick patterns are
 *                      usually written in half-time, so this disagrees with the
 *                      full-band estimate exactly when the answer is interesting.
 *  - `ioi-histogram`   inter-onset intervals between detected onset peaks: the
 *                      fundamental pulse. This is the estimator that *commits* on
 *                      the octave, because the smallest interval that recurs is
 *                      the beat period, not twice it.
 *  - `comb`            comb-filter score over the lag range: how much of the
 *                      envelope's energy is explained by a pulse at this period.
 *  - `tracker-fit`     the tempo the Ellis DP tracker's beat line actually fitted
 *                      (`fitBpm`), which is what a performance *does* rather than
 *                      what its envelope suggests.
 *  - `essentia`        RhythmExtractor2013, when the browser kernel is available.
 *                      A high-confidence vote about the *period*, deliberately
 *                      not a committed vote about the octave: measured on the
 *                      benchmark corpus, marking it committed cost the one track
 *                      where the engines agree on the half-time tactus and the
 *                      beat is twice that (see the primary path in beatgrid.ts).
 *  - `mixxx-acf`       Mixxx's multi-band kick autocorrelation, the precise
 *                      reading the DJ BPM detector uses. Kick patterns are
 *                      usually written in half-time, so this one is
 *                      octave-ambiguous and says so.
 *  - `mixxx-regions`   Mixxx `BeatUtils` constant-region fit over Essentia's own
 *                      tick list: what the tick list implies once the regions
 *                      that hold tempo have been found. Included because it is
 *                      evidence produced by a different method than the
 *                      envelope estimators above, not because it is trusted.
 *
 * The decision is written down, not implied: {@link resolveTempo} returns the
 * winning BPM, the candidates it beat with their confidences, the octave
 * multiplier, and a human-readable reason — all of which belong on the track as
 * provenance rather than in a log line.
 */

import type { OnsetEnvelope } from './spectral-flux.ts'
import { normalizeDjBpm } from './beat-tracker.ts'

export type TempoSource =
  | 'onset-acf'
  | 'low-band-acf'
  | 'ioi-histogram'
  | 'comb'
  | 'tracker-fit'
  | 'essentia'
  | 'mixxx-acf'
  | 'mixxx-regions'

export interface TempoCandidate {
  bpm: number
  source: TempoSource
  /** 0..1, comparable only within a source. See the module comment. */
  confidence: number
  /**
   * True when the estimator commits on the octave (IOI fundamental, tracker fit)
   * rather than being octave-ambiguous (the ACF family, and every external engine
   * so far). Octave-committing evidence outvotes ambiguous evidence when they
   * disagree by exactly 2x, which is why the flag is reserved for estimators whose
   * commitment has been measured to hold — see the module comment.
   */
  octaveCommitted: boolean
}

export interface TempoSearchOptions {
  minBpm: number
  maxBpm: number
  /** Centre of the log-normal DJ tempo prior, in BPM. */
  priorBpm?: number
  /** Width of the prior in octaves. */
  priorOctaves?: number
  /** Extra candidates from outside this module (e.g. the Essentia kernel). */
  extra?: TempoCandidate[]
}

export interface TempoResolution {
  /** Tempo to store, after the octave decision. */
  bpm: number
  /** The winning measurement before the octave decision was applied. */
  measuredBpm: number
  /** 2, 1 or 0.5: what was applied to `measuredBpm` to reach `bpm`. */
  multiplier: number
  candidates: TempoCandidate[]
  /** Human-readable account of the decision, for the track's provenance. */
  reason: string
}

const DEFAULT_PRIOR_BPM = 125
const DEFAULT_PRIOR_OCTAVES = 0.4
/** Candidates within this fraction of each other describe the same tempo. */
const CLUSTER_TOLERANCE = 0.02

function prior(bpm: number, centreBpm: number, octaves: number): number {
  if (!(bpm > 0) || !(centreBpm > 0) || !(octaves > 0)) return 1
  return Math.exp(-0.5 * Math.pow(Math.log2(bpm / centreBpm) / octaves, 2))
}

/** Local maxima of an envelope, thinned so one broad onset yields one peak. */
export function onsetPeaks(
  envelope: Float32Array,
  minSeparationFrames: number,
  threshold = 0
): number[] {
  const peaks: number[] = []
  for (let i = 1; i + 1 < envelope.length; i++) {
    if (envelope[i] > envelope[i - 1] && envelope[i] >= envelope[i + 1] && envelope[i] > threshold) {
      const last = peaks[peaks.length - 1]
      if (last !== undefined && i - last < minSeparationFrames) {
        if (envelope[i] > envelope[last]) peaks[peaks.length - 1] = i
      } else {
        peaks.push(i)
      }
    }
  }
  return peaks
}

/**
 * Fundamental pulse from inter-onset intervals.
 *
 * Builds a histogram of intervals between onset peaks (over the lag range, not
 * just consecutive peaks, so a missed onset does not hide the period), then picks
 * the **shortest** lag that reaches a fraction of the strongest lag. Picking the
 * shortest is the whole point: a pulse at twice the true period gets support from
 * every other onset, so the strongest histogram bin is not necessarily the beat.
 */
export function ioiTempo(
  peaks: number[],
  envRate: number,
  minBpm: number,
  maxBpm: number
): TempoCandidate | null {
  if (peaks.length < 6) return null
  const minLag = Math.max(1, Math.floor((envRate * 60) / maxBpm))
  const maxLag = Math.ceil((envRate * 60) / minBpm)
  const histogram = new Float64Array(maxLag + 1)
  let total = 0
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length && j < i + 6; j++) {
      const lag = peaks[j] - peaks[i]
      if (lag < minLag || lag > maxLag) continue
      // Weight near-interval hits more than distant ones: consecutive onsets are
      // the ones a listener hears as the pulse.
      const weight = 1 / (j - i)
      histogram[lag] += weight
      total += weight
    }
  }
  if (total <= 0) return null

  let strongest = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    const smoothed = histogram[lag] + 0.5 * (histogram[lag - 1] ?? 0) + 0.5 * (histogram[lag + 1] ?? 0)
    histogram[lag] = smoothed
    if (smoothed > strongest) strongest = smoothed
  }
  // 18 % of the strongest bin: low enough to find the fundamental under a
  // half-time kick pattern, high enough not to lock onto a stray interval.
  const acceptance = strongest * 0.18
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (histogram[lag] >= acceptance) {
      const bpm = (60 * envRate) / lag
      if (bpm < minBpm || bpm > maxBpm) continue
      return { bpm, source: 'ioi-histogram', confidence: Math.min(1, histogram[lag] / Math.max(strongest, 1e-9)), octaveCommitted: true }
    }
  }
  return null
}

/** Comb-filter score: how much envelope energy a pulse at `lag` explains. */
export function combTempo(
  envelope: Float32Array,
  envRate: number,
  minBpm: number,
  maxBpm: number
): TempoCandidate | null {
  const minLag = Math.max(1, Math.floor((envRate * 60) / maxBpm))
  const maxLag = Math.ceil((envRate * 60) / minBpm)
  let best = { lag: 0, score: 0 }
  let total = 0
  for (let i = 0; i < envelope.length; i++) total += envelope[i]
  if (total <= 0) return null
  const mean = total / envelope.length
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0
    let hits = 0
    for (let at = 0; at < envelope.length; at += lag) {
      const index = Math.round(at)
      if (index >= envelope.length) break
      score += envelope[index]
      hits++
    }
    if (hits < 4) continue
    const average = score / hits / mean
    if (average > best.score) best = { lag, score: average }
  }
  if (best.lag === 0) return null
  const bpm = (60 * envRate) / best.lag
  // Average support at the lattice, in multiples of the envelope mean: 1.0 means
  // the pulse is no stronger than picking frames at random.
  return {
    bpm,
    source: 'comb',
    confidence: Math.max(0, Math.min(1, (best.score - 1) / 2)),
    octaveCommitted: false,
  }
}

/**
 * Autocorrelation of an envelope over the lag range, read as a tempo.
 *
 * Shared by the full-band and low-band estimators; they differ only in which
 * envelope they are given. The comb harmonics (2x, 3x, half) are what make this
 * estimator octave-ambiguous, which is why it does not get to decide the octave.
 */
export function acfTempo(
  envelope: Float32Array,
  envRate: number,
  minBpm: number,
  maxBpm: number,
  source: TempoSource,
  priorBpm = DEFAULT_PRIOR_BPM,
  priorOctaves = DEFAULT_PRIOR_OCTAVES
): TempoCandidate | null {
  const minLag = Math.max(1, Math.floor((envRate * 60) / maxBpm))
  const maxLag = Math.ceil((envRate * 60) / minBpm)
  const maxAcfLag = maxLag * 3 + 4
  const acf = new Float32Array(maxAcfLag)
  for (let lag = minLag; lag < maxAcfLag && lag < envelope.length; lag++) {
    const n = envelope.length - lag
    if (n < 64) break
    let sum = 0
    for (let i = 0; i < n; i++) sum += envelope[i] * envelope[i + lag]
    acf[lag] = sum / n
  }
  const acfAt = (lag: number) => {
    const index = Math.round(lag)
    return index >= 0 && index < acf.length ? acf[index] : 0
  }
  const scoreAt = (lag: number) => {
    const bpm = (60 * envRate) / lag
    const comb = acfAt(lag) + 0.6 * acfAt(lag * 2) + 0.3 * acfAt(lag * 3) + 0.35 * acfAt(lag / 2)
    return comb * (0.35 + 0.65 * prior(bpm, priorBpm, priorOctaves))
  }

  let bestLag = 0
  let bestScore = 0
  for (let lag = minLag + 1; lag < maxLag - 1; lag++) {
    const score = scoreAt(lag)
    if (score > scoreAt(lag - 1) && score >= scoreAt(lag + 1) && score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  if (bestLag === 0 || bestScore <= 0) return null

  // Parabolic interpolation for a fractional lag: decimal BPM out of an integer
  // lag grid is the difference between 127.8 and 128.0.
  const y0 = scoreAt(bestLag - 1)
  const y1 = scoreAt(bestLag)
  const y2 = scoreAt(bestLag + 1)
  const denom = 2 * (y0 - 2 * y1 + y2)
  let delta = 0
  if (denom < -1e-6) delta = Math.max(-0.5, Math.min(0.5, (y0 - y2) / denom))
  const lag = bestLag + delta
  const bpm = (60 * envRate) / lag

  let meanAcf = 0
  let count = 0
  for (let i = minLag; i < maxLag; i++) {
    meanAcf += acf[i]
    count++
  }
  meanAcf = count > 0 ? meanAcf / count : 0
  const prominence = meanAcf > 1e-12 ? Math.min(1, acf[bestLag] / (meanAcf * 2)) : 0
  return { bpm, source, confidence: prominence, octaveCommitted: false }
}

/** All in-process estimators, run over one shared onset envelope. */
export function estimateTempoCandidates(
  env: OnsetEnvelope,
  options: TempoSearchOptions
): TempoCandidate[] {
  const { minBpm, maxBpm } = options
  const priorBpm = options.priorBpm ?? DEFAULT_PRIOR_BPM
  const priorOctaves = options.priorOctaves ?? DEFAULT_PRIOR_OCTAVES
  const candidates: TempoCandidate[] = []

  const full = acfTempo(env.odf, env.envRate, minBpm, maxBpm, 'onset-acf', priorBpm, priorOctaves)
  if (full) candidates.push(full)

  // The low group is the kick; when a track has no low content at all this
  // collapses onto the full band and simply agrees with it.
  let lowPeak = 0
  for (let i = 0; i < env.frames; i++) if (env.lowOdf[i] > lowPeak) lowPeak = env.lowOdf[i]
  const lowEnvelope = lowPeak > 0 ? env.lowOdf : env.odf
  if (lowEnvelope !== env.odf) {
    const low = acfTempo(lowEnvelope, env.envRate, minBpm, maxBpm, 'low-band-acf', priorBpm, priorOctaves)
    if (low) candidates.push(low)
  }

  // Onset peaks are found on the sharper of the two envelopes at a 60 ms
  // separation, which is below the fastest beat the DJ range allows (195 BPM =
  // 308 ms) but above a single transient's rise time.
  const separation = Math.max(1, Math.round(env.envRate * 0.06))
  const sharpest = lowEnvelope === env.odf ? env.odf : lowEnvelope
  const peaks = onsetPeaks(sharpest, separation)
  const ioi = ioiTempo(peaks, env.envRate, minBpm, maxBpm)
  if (ioi) candidates.push(ioi)

  const comb = combTempo(env.odf, env.envRate, minBpm, maxBpm)
  if (comb) candidates.push(comb)

  for (const extra of options.extra ?? []) {
    if (extra.bpm > 0) candidates.push(extra)
  }
  return candidates
}

interface Cluster {
  bpm: number
  members: TempoCandidate[]
  /** Sum of member confidences, with octave-committing members weighted up. */
  weight: number
}

function clusterCandidates(candidates: TempoCandidate[]): Cluster[] {
  const clusters: Cluster[] = []
  for (const candidate of candidates) {
    const existing = clusters.find(
      cluster => Math.abs(cluster.bpm - candidate.bpm) / cluster.bpm <= CLUSTER_TOLERANCE
    )
    if (existing) {
      // Confidence-weighted mean, so a precise confident estimator is not dragged
      // by a vague one.
      const total = existing.weight + candidate.confidence
      existing.bpm =
        total > 0
          ? (existing.bpm * existing.weight + candidate.bpm * candidate.confidence) / total
          : existing.bpm
      existing.members.push(candidate)
      existing.weight = total
    } else {
      clusters.push({ bpm: candidate.bpm, members: [candidate], weight: candidate.confidence })
    }
  }
  return clusters
}

/**
 * Lattice coverage: the fraction of the envelope's onset energy that a pulse at
 * `bpm` explains, at the best phase.
 *
 * This is what separates two octave hypotheses whose onsets are *equally*
 * periodic, and the earlier mean-onset-at-the-lattice version could not do it:
 * averaging over lattice positions rewards whichever period is longer, because a
 * sparse lattice only ever lands on the biggest peaks (at half tempo it hits
 * every second onset, and by construction that subset has the higher average).
 * Coverage asks the question that matters instead — is anything happening *off*
 * the beat? — so a half-tempo lattice that leaves half the onsets unexplained
 * scores around 0.5 while the correct one approaches 1.0.
 */
export function latticeCoverage(
  envelope: Float32Array,
  envRate: number,
  bpm: number,
  windowFrames = 4
): { coverage: number; phaseFrames: number } {
  if (!(bpm > 0) || envelope.length < 8) return { coverage: 0, phaseFrames: -1 }
  const beatFrames = (envRate * 60) / bpm
  const steps = Math.max(1, Math.round(beatFrames))
  let total = 0
  for (let i = 0; i < envelope.length; i++) total += envelope[i]
  if (!(total > 1e-12)) return { coverage: 0, phaseFrames: -1 }

  let best = 0
  let bestPhase = -1
  for (let phase = 0; phase < steps; phase++) {
    let covered = 0
    let hits = 0
    for (let at = phase; at < envelope.length; at += beatFrames) {
      const centre = Math.round(at)
      if (centre >= envelope.length) break
      let peak = 0
      for (let w = -windowFrames; w <= windowFrames; w++) {
        const index = centre + w
        if (index >= 0 && index < envelope.length && envelope[index] > peak) peak = envelope[index]
      }
      covered += peak
      hits++
    }
    if (hits < 4) continue
    const coverage = Math.min(1, covered / total)
    if (coverage > best) {
      best = coverage
      bestPhase = phase
    }
  }
  return { coverage: best, phaseFrames: bestPhase }
}

/**
 * Decides the octave from the candidates' evidence and returns the tempo to store.
 *
 * Rule, in order:
 *
 *  1. Cluster the candidates (95 % overlap) and rank the clusters by weight.
 *  2. For the best cluster, take its octave relatives (x2, ÷2) as hypotheses and
 *     measure lattice support for each on the full onset envelope.
 *  3. Among the survivors, prefer the octave an *octave-committing* estimator
 *     agrees with: an ACF peak is not evidence about which octave is the beat, so
 *     it must not overrule the inter-onset interval or the tracker's fitted line.
 *  4. Otherwise take the hypothesis the DJ tempo prior prefers — that is the case
 *     where the onset structure genuinely supports both readings.
 *  5. If nothing has coverage, fall back to the old threshold rule, and say so.
 */
export function resolveTempo(
  candidates: TempoCandidate[],
  env: OnsetEnvelope,
  options: TempoSearchOptions
): TempoResolution | null {
  const usable = candidates.filter(candidate => candidate.bpm > 0 && Number.isFinite(candidate.bpm))
  if (usable.length === 0) return null
  const priorBpm = options.priorBpm ?? DEFAULT_PRIOR_BPM
  const priorOctaves = options.priorOctaves ?? DEFAULT_PRIOR_OCTAVES

  const clusters = clusterCandidates(usable).sort((a, b) => b.weight - a.weight)
  const best = clusters[0]
  const measuredBpm = best.bpm

  // Hypotheses: the cluster itself and its octave relatives inside the DJ range,
  // each annotated with the support it can claim.
  const hypotheses = [best.bpm, best.bpm * 2, best.bpm / 2]
    .filter(bpm => bpm >= options.minBpm * 0.9 && bpm <= options.maxBpm * 1.1)
    .map(bpm => {
      const committed = usable.filter(
        candidate => candidate.octaveCommitted && Math.abs(candidate.bpm - bpm) / bpm <= 0.06
      )
      return {
        bpm,
        coverage: latticeCoverage(env.odf, env.envRate, bpm).coverage,
        commitment: committed.reduce((a, candidate) => a + candidate.confidence, 0),
        prior: prior(bpm, priorBpm, priorOctaves),
      }
    })

  if (hypotheses.length === 0) {
    const normalised = normalizeDjBpm(measuredBpm, { minBpm: options.minBpm, maxBpm: options.maxBpm })
    return {
      bpm: normalised.bpm,
      measuredBpm,
      multiplier: normalised.multiplier,
      candidates: usable,
      reason: `no octave hypothesis inside ${options.minBpm}-${options.maxBpm} BPM; threshold rule applied`,
    }
  }

  // Stage 1 — evidence. Keep every hypothesis whose lattice explains essentially
  // as much onset energy as the best one. A lattice that leaves a tenth of the
  // onsets unexplained is answering a different question, which is what an octave
  // error looks like from here: half the beats unexplained, coverage near 0.5.
  hypotheses.sort((a, b) => b.coverage - a.coverage)
  const bestCoverage = hypotheses[0].coverage
  const survivors = hypotheses.filter(
    hypothesis => hypothesis.coverage >= Math.max(0.9 * bestCoverage, bestCoverage - 0.1)
  )
  let decidedBy = 'onset coverage'
  let chosen = survivors[0]

  if (survivors.length > 1) {
    // Stage 2 — commitment. An estimator that commits on the octave (the
    // inter-onset interval's fundamental pulse, the tracker's fitted line, the
    // Essentia reading) outranks the octave-blind autocorrelation family.
    const committedSurvivors = survivors.filter(hypothesis => hypothesis.commitment > 0)
    if (committedSurvivors.length > 0) {
      committedSurvivors.sort((a, b) => b.commitment - a.commitment)
      chosen = committedSurvivors[0]
      decidedBy = 'octave-committing estimator'
    } else {
      // Stage 3 — the DJ tempo prior, for the cases where the onset structure
      // genuinely supports both readings (a half-time feel with offbeat hats
      // supports 70 and 140 about equally, and DJ practice says 140).
      survivors.sort((a, b) => b.prior - a.prior)
      chosen = survivors[0]
      decidedBy = 'tempo prior'
    }
  }

  const multiplier = Math.abs(chosen.bpm / measuredBpm - 2) < 0.06 ? 2 : Math.abs(chosen.bpm / measuredBpm - 0.5) < 0.06 ? 0.5 : 1
  const bpm = Math.round(chosen.bpm * 100) / 100
  const reasonParts: string[] = []
  const committedNames = usable
    .filter(candidate => candidate.octaveCommitted && Math.abs(candidate.bpm - chosen.bpm) / chosen.bpm <= 0.06)
    .map(candidate => candidate.source)
  if (committedNames.length > 0) reasonParts.push(`octave from ${[...new Set(committedNames)].join('+')}`)
  reasonParts.push(`onset coverage ${chosen.coverage.toFixed(2)} of ${bestCoverage.toFixed(2)} best`)
  reasonParts.push(decidedBy)
  reasonParts.push(`prior ${chosen.prior.toFixed(2)}`)
  reasonParts.push(
    multiplier === 1 ? `kept ${measuredBpm.toFixed(2)}` : `x${multiplier} from ${measuredBpm.toFixed(2)}`
  )
  const loser = hypotheses.find(hypothesis => hypothesis !== chosen)
  if (loser) {
    reasonParts.push(`runner-up ${loser.bpm.toFixed(2)} (coverage ${loser.coverage.toFixed(2)})`)
  }
  return {
    bpm,
    measuredBpm,
    multiplier,
    candidates: usable,
    reason: reasonParts.join(', '),
  }
}

/**
 * The octave decision on its own, for callers that already have a measurement and
 * only need to know whether to double it (the BPM detector path).
 */
export function decideOctave(
  measuredBpm: number,
  env: OnsetEnvelope,
  options: TempoSearchOptions & { extra?: TempoCandidate[] }
): TempoResolution {
  const candidates = estimateTempoCandidates(env, options)
  const withMeasurement: TempoCandidate[] = [
    ...candidates,
    { bpm: measuredBpm, source: 'onset-acf', confidence: 0.5, octaveCommitted: false },
  ]
  const resolved = resolveTempo(withMeasurement, env, options)
  if (resolved) return resolved
  const normalised = normalizeDjBpm(measuredBpm, { minBpm: options.minBpm, maxBpm: options.maxBpm })
  return {
    bpm: normalised.bpm,
    measuredBpm,
    multiplier: normalised.multiplier,
    candidates: withMeasurement,
    reason: 'no candidates; threshold rule applied',
  }
}

export { prior as tempoPrior }
