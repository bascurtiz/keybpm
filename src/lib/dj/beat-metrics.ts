/**
 * Annotation-scored beat-tracking metrics.
 *
 * Every accuracy claim about the analyzer used to be a synthetic one: a tone with
 * a known tempo, asserted against a number in a test. That proves the code still
 * computes what it computed yesterday, but it cannot say whether the grid is
 * *right* on music, and it cannot tell an improvement from a regression.
 *
 * These are the standard metrics the beat-tracking literature uses, so our
 * numbers can be compared with published ones instead of with ourselves:
 *
 *  - **F-measure** (mir_eval `beat.f_measure`): beats matching a reference within
 *    a tolerance window, as precision/recall/F. The 70 ms default is the tolerance
 *    the literature reports at.
 *  - **Continuity** (mir_eval `beat.continuity`): the longest span of the track
 *    tracked without a gap, relative to the track length. This is the metric that
 *    separates "found the tempo" from "held the grid", which is exactly the
 *    failure our old rigid lattice had (a grid that slid by the outro still scores
 *    well on F if the slides cancel out).
 *  - **Grid drift**: our own metric, and the one closest to what a DJ feels — how
 *    far the stored grid is from the annotation, and how fast that error grows
 *    over the track. A rigid lattice on wobbling material has a near-zero mean
 *    error and a large drift slope.
 *
 * Deviations from mir_eval are stated where they exist; see {@link continuity}.
 * Nothing here is calibrated against a dataset yet, which is exactly why the
 * benchmark prints per-track numbers rather than only an average.
 */

import { beatIndexAt, beatTimeAt, isVariableGrid } from './grid.ts'
import type { BeatGrid } from './types.ts'

/** Literature-standard match tolerance for beat evaluation, in seconds. */
export const BEAT_TOLERANCE_SECONDS = 0.07

export interface BeatMatch {
  /** Index into the reference beat list. */
  reference: number
  /** Index into the estimated beat list. */
  estimated: number
  /** Signed error in seconds (estimated - reference). */
  error: number
}

export interface MatchResult {
  matches: BeatMatch[]
  precision: number
  recall: number
  f: number
}

/**
 * Optimal one-to-one matching of two ascending beat lists within `tolerance`.
 *
 * Both inputs are sorted, so the non-crossing greedy is optimal: taking the
 * earliest still-available estimate for the earliest unmatched reference can
 * never cost a match later, because any estimate available to a later reference
 * is also available to this one (an exchange argument that holds for sorted
 * interval matchings). mir_eval solves the same problem as a full assignment;
 * on beat sequences the cardinality is the same, and this does not need an
 * assignment solver.
 */
export function matchBeats(
  reference: number[],
  estimated: number[],
  tolerance = BEAT_TOLERANCE_SECONDS
): BeatMatch[] {
  const matches: BeatMatch[] = []
  let j = 0
  for (let i = 0; i < reference.length; i++) {
    const target = reference[i]
    while (j < estimated.length && estimated[j] < target - tolerance) j++
    if (j >= estimated.length) break
    const error = estimated[j] - target
    if (Math.abs(error) <= tolerance) {
      matches.push({ reference: i, estimated: j, error })
      j++
    }
  }
  return matches
}

/** Precision/recall/F over a match set, on the beat counts of each list. */
export function beatFMeasure(
  reference: number[],
  estimated: number[],
  tolerance = BEAT_TOLERANCE_SECONDS
): MatchResult {
  const matches = matchBeats(reference, estimated, tolerance)
  const precision = estimated.length > 0 ? matches.length / estimated.length : 0
  const recall = reference.length > 0 ? matches.length / reference.length : 0
  const f = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  return { matches, precision, recall, f }
}

export interface ContinuityResult {
  /** Longest correctly-tracked span as a fraction of the reference beats. */
  cmlc: number
  /** Same, one gap allowed inside the span. */
  cmlt: number
  /** Same, at any metrical level (double or half tempo). */
  amlc: number
  /** Same, one gap allowed. */
  amlt: number
}

/**
 * Per-reference-beat alignment: the estimated beat it matches, or -1.
 *
 * Non-crossing for the same reason {@link matchBeats} is: the greedy assignment
 * over sorted lists maximises the number of alignments.
 */
function alignReferences(
  reference: number[],
  estimated: number[],
  tolerance: number
): number[] {
  const alignment = new Array<number>(reference.length).fill(-1)
  const matches = matchBeats(reference, estimated, tolerance)
  for (const match of matches) alignment[match.reference] = match.estimated
  return alignment
}

/**
 * Longest run of reference beats whose estimated indices advance by a constant
 * step, with at most `gaps` unmatched reference beats allowed inside the run.
 *
 * `steps` is the set of allowed advances between consecutive matched reference
 * beats: `[1]` is the correct metrical level (the estimated sequence must be
 * continuous), `[1, 2]` additionally allows double tempo and `[1, 2, 0]` half
 * tempo. This is a documented stand-in for mir_eval's continuity definition: it
 * measures the same property (an uninterrupted *chain* of correctly tracked
 * beats, not just a high match count) with an explicit, testable rule rather
 * than a reimplementation of mir_eval's internals that nobody here could verify.
 */
function longestChain(
  alignment: number[],
  steps: number[],
  gaps: number
): number {
  const n = alignment.length
  let best = 0
  for (let start = 0; start < n; start++) {
    if (alignment[start] < 0) continue
    let prev = alignment[start]
    let used = 0
    let length = 1
    let end = start
    for (let i = start + 1; i < n; i++) {
      const current = alignment[i]
      if (current < 0) {
        if (used >= gaps) break
        used++
        end = i
        continue
      }
      const advance = current - prev
      if (steps.includes(advance)) {
        prev = current
        length++
        end = i
        continue
      }
      break
    }
    // Score the span, including the one permitted gap so a chain interrupted by
    // a single missing beat is not scored as if that beat ended the tracking.
    const span = end - start + 1
    if (span > best) best = span
  }
  return best
}

/**
 * Continuity metrics, expressed as the length of the longest tracked chain over
 * the number of reference beats — the same normalisation mir_eval uses.
 *
 * The `-t` variants allow one gap inside the chain (a beat the tracker missed or
 * invented but then recovered from); the `am-` variants allow the chain to sit at
 * double or half the reference tempo, so a tracker that locks the right tempo one
 * octave up is not punished twice for it.
 */
export function continuity(
  reference: number[],
  estimated: number[],
  tolerance = BEAT_TOLERANCE_SECONDS
): ContinuityResult {
  const alignment = alignReferences(reference, estimated, tolerance)
  const span = (steps: number[], gaps: number) =>
    reference.length > 0 ? longestChain(alignment, steps, gaps) / reference.length : 0
  return {
    cmlc: span([1], 0),
    cmlt: span([1], 1),
    amlc: span([1, 2, 0], 0),
    amlt: span([1, 2, 0], 1),
  }
}

export interface DriftReport {
  /** Beats the grid offers inside the annotated span. */
  estimatedBeats: number
  /** Annotated beats. */
  referenceBeats: number
  /**
   * Fraction of annotated beats with a grid beat inside the strict (70 ms)
   * tolerance. Reported next to the nearest-beat error because the two answer
   * different questions: this one is "is the grid tight", the nearest-beat error
   * below is "where is the grid". A half-beat phase error scores 0 here while the
   * nearest-beat error names the mistake.
   */
  strictMatchRate: number
  /** Mean absolute error at the nearest grid beat, in seconds. */
  meanAbsSeconds: number
  /** 95th percentile absolute error, in seconds. */
  p95AbsSeconds: number
  /** Worst absolute error, in seconds. */
  maxAbsSeconds: number
  /** Mean signed error over the last 10 % of the track, in seconds. */
  lateMeanSignedSeconds: number
  /**
   * Linear drift of the signed error over the track, in seconds per minute.
   * A constant-tempo grid on a track that speeds up shows up here even when its
   * mean error is zero.
   */
  driftSecondsPerMinute: number
  /** Stored tempo against the annotated median tempo. */
  bpm: number
  referenceBpm: number
  /** Grid beat times evaluated in the annotated span. */
  variableGrid: boolean
}

/** Median tempo of an annotation. Assumes a roughly constant annotated tempo. */
export function referenceTempo(beats: number[]): number {
  if (beats.length < 2) return 0
  const intervals: number[] = []
  for (let i = 1; i < beats.length; i++) intervals.push(beats[i] - beats[i - 1])
  intervals.sort((a, b) => a - b)
  const median = intervals[Math.floor(intervals.length / 2)]
  return median > 0 ? 60 / median : 0
}

/**
 * The stored grid's beat times across the annotated span.
 *
 * Evaluates the grid the way the deck does (`beatIndexAt` / `beatTimeAt`), so a
 * constant grid is extrapolated from its anchors and a variable grid is read
 * from its beat map — the same numbers a DJ sees, not the tracker's internals.
 */
export function gridBeatsAcross(grid: BeatGrid, reference: number[]): number[] {
  if (reference.length === 0) return []
  const first = reference[0]
  const last = reference[reference.length - 1]
  const startIndex = Math.ceil(beatIndexAt(grid, first - 1e-3)) - 1
  const out: number[] = []
  for (let index = startIndex; ; index++) {
    const time = beatTimeAt(grid, index)
    if (time > last + 1e-3) break
    if (time >= first - 1e-3) out.push(time)
    if (index - startIndex > reference.length * 4 + 16) break
  }
  return out
}

/**
 * How far the stored grid sits from the annotation, and how fast that distance
 * grows. See the module comment for why drift matters more than the mean.
 *
 * The distances use a half-beat window rather than the 70 ms match tolerance: a
 * phase error of half a beat (the grid locked to the offbeat bass, say) is a
 * real, audible defect, and measuring it against a 70 ms window would report it
 * as "no beats found" instead of as a 200 ms error. The strict tolerance is still
 * reported, as `strictMatchRate`.
 */
export function gridDrift(
  grid: BeatGrid,
  reference: number[],
  tolerance = BEAT_TOLERANCE_SECONDS
): DriftReport {
  const estimated = gridBeatsAcross(grid, reference)
  const referenceBpm = referenceTempo(reference)
  const halfBeat = referenceBpm > 0 ? 30 / referenceBpm : 0.5
  const strictMatches = matchBeats(reference, estimated, tolerance)
  const matches = matchBeats(reference, estimated, halfBeat)
  const errors = matches.map(m => m.error)
  const abs = errors.map(Math.abs).sort((a, b) => a - b)
  const meanAbs = abs.length > 0 ? abs.reduce((a, b) => a + b, 0) / abs.length : 0
  const p95 = abs.length > 0 ? abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))] : 0
  const maxAbs = abs.length > 0 ? abs[abs.length - 1] : 0

  const tailFrom = Math.max(0, Math.floor(matches.length * 0.9))
  const tail = matches.slice(tailFrom)
  const lateMean = tail.length > 0 ? tail.reduce((a, m) => a + m.error, 0) / tail.length : 0

  // Least-squares slope of signed error against time, in seconds per minute.
  let slope = 0
  if (matches.length >= 8) {
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    for (const m of matches) {
      const x = reference[m.reference]
      sx += x
      sy += m.error
      sxx += x * x
      sxy += x * m.error
    }
    const n = matches.length
    const denom = n * sxx - sx * sx
    if (Math.abs(denom) > 1e-9) slope = ((n * sxy - sx * sy) / denom) * 60
  }

  return {
    estimatedBeats: estimated.length,
    referenceBeats: reference.length,
    strictMatchRate: reference.length > 0 ? strictMatches.length / reference.length : 0,
    meanAbsSeconds: meanAbs,
    p95AbsSeconds: p95,
    maxAbsSeconds: maxAbs,
    lateMeanSignedSeconds: lateMean,
    driftSecondsPerMinute: slope,
    bpm: grid.bpm,
    referenceBpm,
    variableGrid: isVariableGrid(grid),
  }
}

/** Compact one-line summary for a benchmark run. */
export function formatDrift(report: DriftReport): string {
  const ms = (seconds: number) => `${(seconds * 1000).toFixed(0)}ms`
  return [
    `match ${(report.strictMatchRate * 100).toFixed(0)}%`,
    `mean ${ms(report.meanAbsSeconds)}`,
    `p95 ${ms(report.p95AbsSeconds)}`,
    `late ${ms(report.lateMeanSignedSeconds)}`,
    `drift ${report.driftSecondsPerMinute.toFixed(1)}ms/min`,
  ].join(' ')
}
