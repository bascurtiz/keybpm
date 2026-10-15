export type DeckId = 'A' | 'B'

export const HOT_CUE_COUNT = 8

/**
 * Provenance and quality metadata for an analyzed grid.
 *
 * The analyzer measures a tempo, then *interprets* it (doubling a half-tempo
 * reading, for instance) and tracks beats for it. Those are separate claims, and
 * keeping them separate is what lets the UI show where a number came from and
 * undo an interpretation that turned out to be wrong.
 */
export interface TempoCandidateRecord {
  /** The tempo this estimator proposed. */
  bpm: number
  /** Which estimator proposed it (`onset-acf`, `ioi-histogram`, `essentia`, …). */
  source: string
  /** That estimator's own 0..1 confidence; comparable within a source. */
  confidence: number
}

export interface BeatGridAnalysis {
  /** Tempo as measured by the detectors, before DJ octave normalisation. */
  rawBpm?: number
  /**
   * Every tempo hypothesis the estimators produced, with confidences, whether or
   * not it won. Kept because a lost octave guess is the single most common way a
   * grid is wrong, and a user who disagrees with ours needs to see what the
   * alternatives were rather than a single opaque number.
   */
  tempoCandidates?: TempoCandidateRecord[]
  /** How the octave decision was reached: the evidence, not the threshold. */
  octaveDecision?: string
  /** Multiplier applied to `rawBpm` to reach the stored `bpm` (0.5, 1 or 2). */
  bpmMultiplier?: number
  /** Tempo engines that agreed on `rawBpm`, e.g. `essentia-rhythm2013+onset-acf`. */
  bpmSource?: string
  /** Beat engines behind `beats[]`, e.g. `ellis-dp` or `essentia-degara`. */
  beatSource?: string
  /**
   * RMS of `ln(interval / period)` over the tracked beats: how periodic the
   * performance is. Small on machine-timed dance music, larger on live drums.
   */
  fitResidual?: number
  /** MixCN-style contrast of the fitted grid (onset support vs the track average). */
  contrast?: number
  /** Fraction of the fitted grid that landed on a tracked beat. */
  retainedRatio?: number
  /** Derived 0..1 beat-tracking quality. Not calibrated against annotations. */
  confidence?: number
  /** True when the analyzer replaced the constant grid with a measured beat map. */
  variable?: boolean
}

export interface BeatGrid {
  /** Beats per minute from the grid analysis. */
  bpm: number
  /**
   * Beat phase anchor in seconds. Invariant for both grid kinds:
   * `firstBeat === firstBar (mod 60 / bpm)`, so it is the lattice phase, not an
   * absolute first-beat time. Variable-tempo lookups ignore it (see `grid.ts`).
   */
  firstBeat: number
  /** Time (seconds) of the downbeat anchor (beat 1 of a bar). */
  firstBar: number
  /** Number of beats per bar (typically 4 for dance music). */
  beatsPerBar: number
  /**
   * Absolute beat times in seconds, strictly increasing, when the track does not
   * hold a single tempo (live drums, disco, funk, vinyl rips). `beats[i]` is beat
   * index `i`. Absent for constant-tempo tracks, which stay on the `firstBeat`
   * lattice. `bpm` then carries the median local tempo for display and sorting.
   */
  beats?: number[]
  /** How this grid was measured, and how well the measurement fitted. */
  analysis?: BeatGridAnalysis
}

export interface TrackKeyInfo {
  name: string
  camelot: string
  confidence?: number
}

export interface Track {
  id: string
  title: string
  artist: string
  genre?: string
  label?: string
  duration: number
  bpm: number | null
  grid: BeatGrid | null
  key: TrackKeyInfo | null
  gain: number
  buffer: AudioBuffer
  coverUrl?: string
  peaks: Float32Array
}

export interface LoopRegion {
  start: number
  end: number
  bars?: number
}

export type FxType = 'off' | 'echo' | 'reverb' | 'flanger'
