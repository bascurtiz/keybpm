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

import { beatIndexAt, beatTimeAt, beatsPerBarOf, downbeatTimes, isVariableGrid, FALLBACK_BPM } from './grid.ts'
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

export interface DownbeatReport {
  /** Grid downbeats offered inside the annotated span. */
  estimatedBeats: number
  /** Annotated downbeats. */
  referenceBeats: number
  /** Fraction of annotated downbeats with a grid downbeat inside the tolerance. */
  matchRate: number
  /**
   * Whole beats between the grid's first bar and the nearest annotated downbeat,
   * wrapped into `[-beatsPerBar/2, beatsPerBar/2)`. This is the number a DJ means
   * by "the bar is out": `-1` is a grid whose bar lines land on beat 4.
   */
  offsetBeats: number
  /** Residual phase error after that whole-beat offset, in seconds. */
  offsetSeconds: number
  /** Stored rotation, relative to the grid's first audible beat. */
  rotation: number | null
  /** Whether the analyzer claimed the rotation or left it to the anchor. */
  decided: boolean
}

/**
 * Bar-level scoring: the same match test as the beats, applied to downbeats.
 *
 * Reported separately from the beat F-measure because the two failures are
 * independent: a grid can track every beat perfectly and still put its bar lines
 * one beat out, which scores 1.0 on beats and ruins a mix. The offset is what
 * names that failure; the match rate is what says whether the bar lines are
 * *tight*, since a bar line five milliseconds off is a bar line that lines up.
 */
export function downbeatReport(
  grid: BeatGrid,
  reference: number[],
  tolerance = BEAT_TOLERANCE_SECONDS
): DownbeatReport {
  const first = reference.length > 0 ? reference[0] : 0
  const last = reference.length > 0 ? reference[reference.length - 1] : 0
  // Ask for a tolerance of slack at both ends: the grid's first and last bar can
  // legitimately fall a few milliseconds either side of the annotated span, and a
  // bar line just outside the range is still a bar line a DJ can match. Without
  // it every track lost its first or last downbeat to a strict comparison.
  const estimated =
    reference.length > 0 ? downbeatTimes(grid, first - tolerance, last + tolerance) : []
  const matches = matchBeats(reference, estimated, tolerance)
  const bpb = beatsPerBarOf(grid)
  const beatLen = 60 / (grid.bpm > 0 ? grid.bpm : FALLBACK_BPM)

  let nearest = reference.length > 0 ? reference[0] : grid.firstBar
  for (const time of reference) {
    if (Math.abs(time - grid.firstBar) < Math.abs(nearest - grid.firstBar)) nearest = time
  }
  const rawBeats = reference.length > 0 ? (grid.firstBar - nearest) / beatLen : 0
  const wrapped = ((rawBeats + bpb / 2) % bpb + bpb) % bpb - bpb / 2
  const offsetBeats = Math.round(wrapped)
  return {
    estimatedBeats: estimated.length,
    referenceBeats: reference.length,
    matchRate: reference.length > 0 ? matches.length / reference.length : 0,
    offsetBeats,
    offsetSeconds: reference.length > 0 ? grid.firstBar - (nearest + offsetBeats * beatLen) : 0,
    rotation: grid.barStructure ? grid.barStructure.rotation : null,
    decided: grid.barStructure ? grid.barStructure.rotationDecided : false,
  }
}

export interface DropReport {
  detected: number
  matched: number
  missing: number
  extra: number
  /** Error of the closest detected drop to the first annotated one, or null. */
  firstErrorSeconds: number | null
  /** True when an annotated drop had no detected drop inside the tolerance. */
  firstMissing: boolean
  /** False when the corpus carries no drop annotation, so `extra` is not a claim. */
  annotated: boolean
}

/**
 * Drop markers against annotated section changes.
 *
 * Scored on both sides: a drop the analyzer missed is a marker a DJ cannot load
 * at, and a drop it invented is a marker that sends the mix somewhere the track
 * does not change. `annotated` says whether the corpus was in a position to make
 * that second judgement at all — a corpus with no drop annotation marks every
 * detected drop as "extra" otherwise, which would be the harness inventing a
 * failure out of its own missing ground truth.
 */
export function dropReport(
  grid: BeatGrid,
  reference: number[],
  tolerance = BEAT_TOLERANCE_SECONDS,
  annotated = true
): DropReport {
  const detected = grid.drops ?? []
  let matched = 0
  let missing = 0
  let firstErrorSeconds: number | null = null
  let firstMissing = false
  for (let i = 0; i < reference.length; i++) {
    let best: number | null = null
    for (const time of detected) {
      if (best === null || Math.abs(time - reference[i]) < Math.abs(best - reference[i])) best = time
    }
    if (best !== null && Math.abs(best - reference[i]) <= tolerance) matched++
    else {
      missing++
      if (i === 0) firstMissing = true
    }
    if (i === 0 && best !== null) firstErrorSeconds = best - reference[0]
  }
  const extra = annotated
    ? detected.filter(time => !reference.some(marker => Math.abs(marker - time) <= tolerance)).length
    : 0
  return { detected: detected.length, matched, missing, extra, firstErrorSeconds, firstMissing, annotated }
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
