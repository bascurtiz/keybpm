import type { BeatGrid, DropRecord, PhraseRecord } from './types.ts'

/**
 * Beat-grid timing utilities.
 *
 * A grid is one of two kinds:
 *
 *  - **Constant tempo** — described by `bpm` plus the `firstBeat`/`firstBar`
 *    phase anchors. Beat `k` is simply `firstBeat + k * (60 / bpm)`. This is the
 *    right model for machine-timed electronic music and is the fast path.
 *
 *  - **Variable tempo** — `beats[]` holds the absolute time of every detected
 *    beat, because the track drifts (live drums, disco, funk, vinyl rips, tape
 *    speed variation). `bpm` is then the median local tempo, kept for display
 *    and sorting.
 *
 * Everything that needs a beat time, a bar phase, a local tempo or a snap point
 * goes through this module instead of doing `60 / grid.bpm` arithmetic, so both
 * kinds behave identically for callers.
 */

export const DEFAULT_BEATS_PER_BAR = 4

/** Tempo used when a grid is missing entirely. */
export const FALLBACK_BPM = 120

const MIN_GAP = 1e-4

export function beatLengthForBpm(bpm: number): number {
  return bpm > 0 ? 60 / bpm : 60 / FALLBACK_BPM
}

export function isVariableGrid(grid: BeatGrid | null | undefined): boolean {
  return !!grid && Array.isArray(grid.beats) && grid.beats.length >= 2
}

export function beatsPerBarOf(grid: BeatGrid | null | undefined): number {
  return grid?.beatsPerBar && grid.beatsPerBar > 0 ? grid.beatsPerBar : DEFAULT_BEATS_PER_BAR
}

function positiveMod(v: number, m: number): number {
  return ((v % m) + m) % m
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Largest index `i` with `beats[i] <= t` (clamped to the array bounds). */
function lastIndexAtOrBefore(beats: number[], t: number): number {
  let lo = 0
  let hi = beats.length - 1
  if (t <= beats[0]) return 0
  if (t >= beats[hi]) return hi
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (beats[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

// ---------------------------------------------------------------------------
// Lookup: beat index <-> time
// ---------------------------------------------------------------------------

/**
 * Fractional beat index at `time`. Continuous and extrapolating outside the
 * measured range, so a playhead before the first beat or past the last one still
 * produces a sane value.
 */
export function beatIndexAt(grid: BeatGrid | null | undefined, time: number): number {
  if (!grid) return time / beatLengthForBpm(FALLBACK_BPM)
  if (!isVariableGrid(grid)) return (time - grid.firstBeat) / beatLengthForBpm(grid.bpm)

  const beats = grid.beats as number[]
  const n = beats.length
  const first = beats[0]
  const last = beats[n - 1]

  if (time <= first) {
    return (time - first) / Math.max(MIN_GAP, beats[1] - beats[0])
  }
  if (time >= last) {
    return n - 1 + (time - last) / Math.max(MIN_GAP, last - beats[n - 2])
  }
  const k = lastIndexAtOrBefore(beats, time)
  const span = beats[k + 1] - beats[k]
  return k + (span > 0 ? (time - beats[k]) / span : 0)
}

/** Time of fractional beat index `index`, interpolated inside and extrapolated outside. */
export function beatTimeAt(grid: BeatGrid | null | undefined, index: number): number {
  if (!grid) return index * beatLengthForBpm(FALLBACK_BPM)
  if (!isVariableGrid(grid)) return grid.firstBeat + index * beatLengthForBpm(grid.bpm)

  const beats = grid.beats as number[]
  const n = beats.length
  if (index <= 0) {
    return beats[0] + index * Math.max(MIN_GAP, beats[1] - beats[0])
  }
  if (index >= n - 1) {
    return beats[n - 1] + (index - (n - 1)) * Math.max(MIN_GAP, beats[n - 1] - beats[n - 2])
  }
  const k = Math.floor(index)
  const f = index - k
  return beats[k] + f * (beats[k + 1] - beats[k])
}

/**
 * Beats averaged to report a local tempo on a variable grid. A single measured
 * interval is only as precise as the detector's tick resolution (roughly +/-3 BPM
 * at dance tempo), which would make a BPM readout flicker and a sync rate wobble;
 * averaging a short window keeps the reading both local and stable.
 */
const LOCAL_TEMPO_WINDOW_BEATS = 8

/**
 * Local beat length in seconds around `time`. On a variable grid this is a short
 * windowed average rather than one interval, so it tracks the tempo without
 * inheriting tick-level noise.
 */
export function beatLengthAt(grid: BeatGrid | null | undefined, time = 0): number {
  if (!grid) return beatLengthForBpm(FALLBACK_BPM)
  if (!isVariableGrid(grid)) return beatLengthForBpm(grid.bpm)

  const beats = grid.beats as number[]
  const n = beats.length
  const centre = clampInt(Math.round(beatIndexAt(grid, time)), 0, n - 1)
  const half = Math.floor(LOCAL_TEMPO_WINDOW_BEATS / 2)
  const lo = clampInt(centre - half, 0, n - 2)
  const hi = clampInt(centre + half, lo, n - 2)
  return Math.max(MIN_GAP, (beats[hi + 1] - beats[lo]) / (hi + 1 - lo))
}

/** Local tempo in BPM at `time`. */
export function bpmAt(grid: BeatGrid | null | undefined, time = 0): number {
  return 60 / beatLengthAt(grid, time)
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

/**
 * Integer beat index of the bar-1 downbeat. The analyzer snaps `firstBar` onto a
 * detected beat for variable grids, so rounding is exact there; for constant
 * grids `firstBar - firstBeat` is already an exact multiple of the beat length.
 */
export function downbeatIndex(grid: BeatGrid | null | undefined): number {
  if (!grid) return 0
  return Math.round(beatIndexAt(grid, grid.firstBar))
}

/** Fractional position inside the bar, 0 at the downbeat and 1 at the next bar. */
export function barPhaseAt(grid: BeatGrid | null | undefined, time: number): number {
  const bpb = beatsPerBarOf(grid)
  return positiveMod(beatIndexAt(grid, time) - downbeatIndex(grid), bpb) / bpb
}

/** Signed bar index at `time`; 0 is the bar starting at `firstBar`. */
export function barIndexAt(grid: BeatGrid | null | undefined, time: number): number {
  const bpb = beatsPerBarOf(grid)
  return Math.floor((beatIndexAt(grid, time) - downbeatIndex(grid)) / bpb)
}

/** Time at the start of bar `barIndex`. */
export function barTimeAt(grid: BeatGrid | null | undefined, barIndex: number): number {
  return beatTimeAt(grid, downbeatIndex(grid) + barIndex * beatsPerBarOf(grid))
}

/** Local bar length in seconds. */
export function barLengthAt(grid: BeatGrid | null | undefined, time = 0): number {
  return beatLengthAt(grid, time) * beatsPerBarOf(grid)
}

// ---------------------------------------------------------------------------
// Snapping and stepping
// ---------------------------------------------------------------------------

export function snapToBeat(grid: BeatGrid | null | undefined, time: number): number {
  if (!grid) return time
  return beatTimeAt(grid, Math.round(beatIndexAt(grid, time)))
}

/**
 * 0-based index of the beat currently sounding inside its bar. `lookAheadSeconds`
 * lets a display light its beat a moment early to compensate for render latency.
 */
export function beatInBarAt(
  grid: BeatGrid | null | undefined,
  time: number,
  lookAheadSeconds = 0
): number {
  if (!grid) return 0
  const bpb = beatsPerBarOf(grid)
  return positiveMod(Math.floor(barPhaseAt(grid, time + lookAheadSeconds) * bpb), bpb)
}

/** Next (`dir >= 0`) or previous strictly-future/past beat boundary. */
export function nextBeatTime(grid: BeatGrid | null | undefined, time: number, dir = 1): number {
  if (!grid) return time
  const idx = beatIndexAt(grid, time)
  if (dir < 0) return beatTimeAt(grid, Math.ceil(idx - 1e-9) - 1)
  return beatTimeAt(grid, Math.floor(idx + 1e-9) + 1)
}

export function nextBarTime(grid: BeatGrid | null | undefined, time: number, dir = 1): number {
  if (!grid) return time
  const bar = barIndexAt(grid, time)
  return barTimeAt(grid, dir < 0 ? bar - 1 : bar + 1)
}

/**
 * Shift `time` by `bars` bars while keeping its offset inside the current bar,
 * so a beat jump on a drifting grid stays musically aligned.
 */
export function shiftBars(grid: BeatGrid | null | undefined, time: number, bars: number): number {
  if (!grid) return time
  const bpb = beatsPerBarOf(grid)
  const beatIdx = beatIndexAt(grid, time)
  const from = downbeatIndex(grid)
  const barStart = Math.floor((beatIdx - from) / bpb)
  const offset = beatIdx - (from + barStart * bpb)
  return beatTimeAt(grid, from + (barStart + bars) * bpb + offset)
}

// ---------------------------------------------------------------------------
// Variable-grid construction
// ---------------------------------------------------------------------------

export interface BeatMapOptions {
  /**
   * A single tempo that fits every measured beat within this tolerance means the
   * track holds tempo, so a variable grid would be modelling noise. This is the
   * only threshold; it also keeps a slightly-wrong global BPM estimate from
   * being mistaken for drift.
   */
  constantToleranceSeconds?: number
  minBeats?: number
  minSpanSeconds?: number
  /**
   * Step-test slack, as a fraction of a beat. A gap further from a whole number
   * of beats than this is read as a tempo change rather than a missed beat.
   */
  maxStepErrorRatio?: number
}

export interface BeatMapResult {
  beats: number[]
  /** Median local tempo, used as the grid's headline BPM. */
  bpm: number
  bpmMin: number
  bpmMax: number
  /** Largest deviation from the best single-tempo fit, in seconds. */
  maxDrift: number
  beatCount: number
}

export interface BeatMapOutcome {
  /** Present only when no single tempo fits the measured beats. */
  map: BeatMapResult | null
  /** Best single tempo for the measured beats, refining the caller's estimate. */
  refinedBpm: number
  maxDrift: number
}

/**
 * Residuals of measured beats against a constant-tempo model, using each beat's
 * assigned index rather than its nearest lattice point. Fitting against the
 * index keeps the measurement from wrapping once drift exceeds half a beat,
 * which is exactly the case this exists to detect. Residuals are centred, so a
 * constant phase offset does not inflate the result.
 */
function residualStats(
  times: number[],
  indices: number[],
  bpm: number,
  phase: number
): { max: number; avg: number } {
  const beatLen = beatLengthForBpm(bpm)
  const n = times.length
  if (n === 0) return { max: 0, avg: 0 }

  const raw = times.map((t, i) => t - (phase + indices[i] * beatLen))
  const mean = raw.reduce((s, r) => s + r, 0) / n
  let max = 0
  let sum = 0
  for (const r of raw) {
    const centred = Math.abs(r - mean)
    sum += centred
    if (centred > max) max = centred
  }
  return { max, avg: sum / n }
}

/**
 * Smoothed local-tempo spread across a grid, sampled along its beats. Reports how
 * far a drifting track wanders from its headline BPM without the tick-quantisation
 * noise a raw per-interval extreme would show.
 */
export function localTempoRange(
  grid: BeatGrid | null | undefined
): { min: number; max: number } | null {
  if (!grid) return null
  if (!isVariableGrid(grid)) return { min: grid.bpm, max: grid.bpm }

  const beats = grid.beats as number[]
  let min = Infinity
  let max = -Infinity
  for (const t of beats) {
    const bpm = 60 / beatLengthAt(grid, t)
    if (bpm < min) min = bpm
    if (bpm > max) max = bpm
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

/** Raw per-interval tempo statistics, including tick quantisation. */
export function localBpmStats(beats: number[]): { min: number; max: number; median: number } | null {
  const bpms: number[] = []
  for (let i = 0; i + 1 < beats.length; i++) {
    const iv = beats[i + 1] - beats[i]
    if (iv > 0.05) bpms.push(60 / iv)
  }
  if (bpms.length === 0) return null
  const sorted = [...bpms].sort((a, b) => a - b)
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
  }
}

/**
 * Build a variable-tempo beat map from tracker beat times.
 *
 * Returns `null` when there are too few usable ticks. Otherwise the outcome
 * always reports `refinedBpm` — the single tempo that best explains the measured
 * beats — and only carries a `map` when that single tempo cannot fit them within
 * `constantToleranceSeconds`. Turning that around is what keeps the feature
 * honest: a constant track whose detected BPM was slightly off yields a better
 * constant BPM, not a needlessly wobbly grid.
 */
export function buildBeatMapFromTicks(
  rawTicks: number[],
  bpm: number,
  phase: number,
  duration: number,
  options: BeatMapOptions = {}
): BeatMapOutcome | null {
  const constantToleranceSeconds = options.constantToleranceSeconds ?? 0.05
  const minBeats = options.minBeats ?? 16
  const minSpanSeconds = options.minSpanSeconds ?? 20
  const maxStepErrorRatio = options.maxStepErrorRatio ?? 0.3

  if (!(bpm > 0) || !(duration > 0)) return null
  const beatLen = 60 / bpm

  // 1. Clean the tick list.
  const cleaned: number[] = []
  for (const t of [...rawTicks].sort((a, b) => a - b)) {
    if (!Number.isFinite(t) || t < -0.05 || t > duration + 0.5) continue
    if (cleaned.length > 0 && t - cleaned[cleaned.length - 1] < 0.02) continue
    cleaned.push(t)
  }
  if (cleaned.length < minBeats) return null

  // 2. Walk the ticks in time order, numbering each from the step since the
  //    previous tick while tracking a running local beat length. Numbering
  //    incrementally is what makes this work on drifting material: the tempo
  //    estimate is only ever extrapolated across one beat, so accumulated drift
  //    cannot push a tick out of the acceptance window the way a fixed lattice
  //    would. A gap that is nowhere near a whole number of beats is read as a
  //    tempo change and re-bases the running length; a short gap is a double
  //    detection and is dropped.
  const tickTimes: number[] = [cleaned[0]]
  const tickIndices: number[] = [0]
  let runningBeatLen = beatLen
  let index = 0

  for (let i = 1; i < cleaned.length; i++) {
    const gap = cleaned[i] - cleaned[i - 1]
    const ratio = gap / runningBeatLen
    if (ratio < 0.7) continue
    let step = Math.max(1, Math.round(ratio))
    if (Math.abs(ratio - step) > maxStepErrorRatio) {
      step = 1
      runningBeatLen = gap
    } else {
      runningBeatLen = runningBeatLen * 0.85 + (gap / step) * 0.15
    }
    index += step
    tickTimes.push(cleaned[i])
    tickIndices.push(index)
  }
  if (tickTimes.length < minBeats) return null
  if (tickIndices[tickIndices.length - 1] - tickIndices[0] < minBeats - 1) return null

  // 3. A 3-point median over the assigned times kills single-beat spikes.
  const smoothed: number[] = []
  for (let i = 0; i < tickTimes.length; i++) {
    const window = [
      tickTimes[Math.max(0, i - 1)],
      tickTimes[i],
      tickTimes[Math.min(tickTimes.length - 1, i + 1)],
    ].sort((a, b) => a - b)
    smoothed.push(window[1])
  }

  // 4. Interpolate the beats the tracker missed, keeping local tempo continuous
  //    across the gap.
  const knownTimes: number[] = []
  const knownIndices: number[] = []
  for (let i = 0; i + 1 < tickIndices.length; i++) {
    const k0 = tickIndices[i]
    const k1 = tickIndices[i + 1]
    const t0 = smoothed[i]
    const t1 = smoothed[i + 1]
    const gap = k1 - k0
    for (let k = k0; k < k1; k++) {
      knownIndices.push(k)
      knownTimes.push(t0 + ((t1 - t0) * (k - k0)) / gap)
    }
  }
  knownIndices.push(tickIndices[tickIndices.length - 1])
  knownTimes.push(smoothed[smoothed.length - 1])
  if (knownTimes.length < minBeats) return null

  // 5. Extend to both ends of the track at the boundary tempo, so a playhead
  //    anywhere on the timeline stays on the grid.
  const leadInterval = Math.max(MIN_GAP, knownTimes[1] - knownTimes[0])
  const tailInterval = Math.max(
    MIN_GAP,
    knownTimes[knownTimes.length - 1] - knownTimes[knownTimes.length - 2]
  )
  const allTimes: number[] = []
  const allIndices: number[] = []

  const leadCount = Math.min(4096, Math.floor(knownTimes[0] / leadInterval))
  for (let i = leadCount; i > 0; i--) {
    allTimes.push(knownTimes[0] - i * leadInterval)
    allIndices.push(knownIndices[0] - i)
  }
  for (let i = 0; i < knownTimes.length; i++) {
    allTimes.push(knownTimes[i])
    allIndices.push(knownIndices[i])
  }
  const lastKnown = knownTimes[knownTimes.length - 1]
  const tailCount = Math.min(4096, Math.floor((duration - lastKnown) / tailInterval))
  for (let i = 1; i <= tailCount; i++) {
    allTimes.push(lastKnown + i * tailInterval)
    allIndices.push(knownIndices[knownIndices.length - 1] + i)
  }

  // 6. Trim to the audible timeline and re-apply monotonicity.
  const beats: number[] = []
  const indices: number[] = []
  for (let i = 0; i < allTimes.length; i++) {
    const t = allTimes[i]
    if (t < 0 || t > duration + 0.05) continue
    if (beats.length > 0 && t - beats[beats.length - 1] <= MIN_GAP) continue
    beats.push(t)
    indices.push(allIndices[i])
  }
  if (beats.length < minBeats) return null

  const span = beats[beats.length - 1] - beats[0]
  if (span < minSpanSeconds) return null
  const spanBeats = indices[indices.length - 1] - indices[0]
  if (spanBeats <= 0) return null

  // 7. Best single tempo for these beats. If it fits within tracker tolerance
  //    the track holds tempo, so report the refinement and no map.
  const refinedBpm = (60 * spanBeats) / span
  const refined = residualStats(beats, indices, refinedBpm, phase)
  if (refined.max <= constantToleranceSeconds) {
    return { map: null, refinedBpm, maxDrift: refined.max }
  }

  const stats = localBpmStats(beats)
  if (!stats) return null

  return {
    map: {
      beats,
      bpm: Math.round(stats.median * 100) / 100,
      bpmMin: Math.round(stats.min * 100) / 100,
      bpmMax: Math.round(stats.max * 100) / 100,
      maxDrift: Math.round(refined.max * 1000) / 1000,
      beatCount: beats.length,
    },
    refinedBpm,
    maxDrift: refined.max,
  }
}

// ---------------------------------------------------------------------------
// Grid transforms
// ---------------------------------------------------------------------------

/**
 * Bar-aligned downbeat times covering `[from, to]`.
 *
 * Derived from the grid model rather than read out of `grid.downbeats`: the
 * stored array only covers the span the analyzer actually scored (120 s of a
 * six-minute track), and it is rebuilt on every transform, whereas this answers
 * "where are the bar lines here" for any point on the timeline, on both grid
 * kinds.
 */
export function downbeatTimes(grid: BeatGrid | null | undefined, from: number, to: number): number[] {
  if (!grid || !(to > from)) return []
  const first = barIndexAt(grid, from) - 1
  const last = barIndexAt(grid, to) + 1
  const out: number[] = []
  for (let bar = first; bar <= last && out.length < 8192; bar++) {
    const time = barTimeAt(grid, bar)
    if (time >= from - 1e-6 && time <= to + 1e-6) out.push(time)
  }
  return out
}

/** Drop markers recorded by the analyzer, with their evidence. */
export function dropMarkers(grid: BeatGrid | null | undefined): DropRecord[] {
  return grid?.barStructure?.drops ?? []
}

/** Sections the analyzer grouped, when it found any. */
export function phrasesOf(grid: BeatGrid | null | undefined): PhraseRecord[] {
  return grid?.barStructure?.phrases ?? []
}

/** Inferred phrase length in bars, or null when the drops did not imply one. */
export function phraseLengthBars(grid: BeatGrid | null | undefined): number | null {
  const bars = grid?.barStructure?.phraseBars
  return bars && bars > 0 ? bars : null
}

/**
 * Phrase boundaries covering `[from, to]`, counted from bar 1.
 *
 * Only available once a phrase length has been measured or assumed: a DJ mixing
 * on phrase boundaries needs the boundary before the drop as well as the drop
 * itself, which a bare list of detected drops cannot give.
 */
export function phraseBoundaries(grid: BeatGrid | null | undefined, from: number, to: number): number[] {
  const bars = phraseLengthBars(grid)
  if (!grid || !bars) return []
  const barLen = barLengthAt(grid, Math.max(0, from)) * bars
  if (!(barLen > 0)) return []
  const first = Math.floor((from - barTimeAt(grid, 0)) / barLen) - 1
  const last = Math.ceil((to - barTimeAt(grid, 0)) / barLen) + 1
  const out: number[] = []
  for (let n = first; n <= last && out.length < 8192; n++) {
    const time = barTimeAt(grid, n * bars)
    if (time >= from - 1e-6 && time <= to + 1e-6) out.push(time)
  }
  return out
}

/**
 * Which beat of the bar the analyzer scored as the downbeat, relative to the
 * first audible beat — or `null` when it never scored one.
 */
export function barRotation(grid: BeatGrid | null | undefined): number | null {
  return grid?.barStructure ? grid.barStructure.rotation : null
}

/**
 * Rebuild the derived bar data after a transform.
 *
 * `downbeats`, the drop bars and the phrase times are all functions of the grid
 * geometry (`firstBar`, `bpm`, `beats[]`), so a manual BPM change, beat jump or
 * bar shift would quietly leave them describing the previous grid — bar markers
 * drawn a beat away from the bars, in the one place a DJ looks at them. Every
 * transform therefore funnels through here, and the analyser's *decisions*
 * (`rotation`, its scores, its reason) are deliberately left alone: they are
 * provenance, not geometry, and a manual bar edit must win over them.
 */
export function refreshBarData(grid: BeatGrid): BeatGrid {
  const structure = grid.barStructure
  const hasDownbeats = Array.isArray(grid.downbeats)
  if (!structure && !hasDownbeats && !Array.isArray(grid.drops)) return grid

  const barLen = beatLengthForBpm(grid.bpm) * beatsPerBarOf(grid)
  const end = structure?.span?.[1] ?? (hasDownbeats ? (grid.downbeats as number[]).slice(-1)[0] + barLen : grid.firstBar)
  const start = structure?.span?.[0] ?? grid.firstBar
  const downbeats = hasDownbeats ? downbeatTimes(grid, Math.max(0, start), end) : undefined

  const drops = structure
    ? structure.drops.map(drop => ({ ...drop, bar: barIndexAt(grid, drop.time) }))
    : undefined
  const phrases = structure
    ? structure.phrases.map(phrase => ({
        ...phrase,
        start: barTimeAt(grid, phrase.startBar),
        end: barTimeAt(grid, phrase.startBar + phrase.bars),
        drop: drops ? drops.some(drop => drop.bar === phrase.startBar) : phrase.drop,
      }))
    : undefined

  return {
    ...grid,
    ...(hasDownbeats ? { downbeats } : {}),
    ...(drops ? { drops: drops.map(drop => drop.time) } : {}),
    ...(structure
      ? { barStructure: { ...structure, drops: drops as DropRecord[], phrases: phrases as PhraseRecord[] } }
      : {}),
  }
}

/** Re-establish the `firstBeat === firstBar (mod 60 / bpm)` invariant. */
export function normalizeGrid(grid: BeatGrid): BeatGrid {
  const beatLen = beatLengthForBpm(grid.bpm)
  return refreshBarData({ ...grid, firstBeat: positiveMod(grid.firstBar, beatLen) })
}

/**
 * Drop to a constant-tempo grid. A manual tempo edit asserts that the track
 * holds one tempo, so the measured beat positions are discarded here.
 */
export function collapseGridToConstant(grid: BeatGrid, bpm: number, anchorTime: number): BeatGrid {
  const { beats: _beats, ...rest } = grid
  return normalizeGrid({ ...rest, bpm, firstBar: Math.max(0, anchorTime) })
}

/** Shift every beat (and the bar anchor) by `deltaSeconds`. */
export function shiftGridBeats(grid: BeatGrid, deltaSeconds: number): BeatGrid {
  if (!isVariableGrid(grid)) {
    return normalizeGrid({ ...grid, firstBar: Math.max(0, grid.firstBar + deltaSeconds) })
  }
  const beats = grid.beats as number[]
  const delta = Math.max(deltaSeconds, -beats[0])
  const shifted: number[] = []
  for (const t of beats) {
    const v = t + delta
    if (shifted.length === 0 || v - shifted[shifted.length - 1] > MIN_GAP) shifted.push(v)
  }
  if (shifted.length < 2) return collapseGridToConstant(grid, grid.bpm, grid.firstBar)
  return normalizeGrid({ ...grid, beats: shifted, firstBar: Math.max(0, grid.firstBar + delta) })
}

/**
 * Double or halve the grid resolution. Doubling interleaves the midpoint of
 * every interval (each beat becomes a half-beat); halving drops every other beat.
 */
export function scaleGridBeats(grid: BeatGrid, multiplier: 0.5 | 2): BeatGrid {
  const bpm = Math.max(20, Math.min(300, Math.round(grid.bpm * multiplier * 10) / 10))
  if (!isVariableGrid(grid)) return normalizeGrid({ ...grid, bpm })

  const beats = grid.beats as number[]
  let next: number[] = []
  if (multiplier === 2) {
    const lead = Math.max(MIN_GAP, beats[1] - beats[0])
    const tail = Math.max(MIN_GAP, beats[beats.length - 1] - beats[beats.length - 2])
    next.push(beats[0] - lead)
    for (let i = 0; i + 1 < beats.length; i++) {
      next.push(beats[i])
      next.push((beats[i] + beats[i + 1]) / 2)
    }
    next.push(beats[beats.length - 1])
    next.push(beats[beats.length - 1] + tail)
  } else {
    for (let i = 0; i < beats.length; i += 2) next.push(beats[i])
  }
  next = next.filter(t => t >= 0)
  if (next.length < 2) return collapseGridToConstant(grid, bpm, grid.firstBar)

  // Re-anchor the downbeat onto the nearest surviving beat.
  const anchor = next.reduce(
    (best, t) => (Math.abs(t - grid.firstBar) < Math.abs(best - grid.firstBar) ? t : best),
    next[0]
  )
  return normalizeGrid({ ...grid, bpm, beats: next, firstBar: anchor })
}

/** Snap the bar anchor onto a real beat (used after variable-grid edits). */
export function reanchorBar(grid: BeatGrid): BeatGrid {
  if (!isVariableGrid(grid)) return normalizeGrid(grid)
  return normalizeGrid({ ...grid, firstBar: snapToBeat(grid, grid.firstBar) })
}

/**
 * Adopt a measured beat map into an existing grid: the map's beat times become
 * the grid's beat positions and its median tempo becomes the headline BPM. The
 * bar anchor is moved onto the nearest measured beat so bar phase stays exact.
 */
export function beatGridFromMap(base: BeatGrid, map: BeatMapResult): BeatGrid {
  const beats = [...map.beats]
  const anchor = beats.reduce(
    (best, t) => (Math.abs(t - base.firstBar) < Math.abs(best - base.firstBar) ? t : best),
    beats[0]
  )
  return normalizeGrid({ ...base, bpm: map.bpm, firstBar: anchor, beats })
}
