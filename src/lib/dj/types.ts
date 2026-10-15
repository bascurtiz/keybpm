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

/**
 * One detected section change — where the track's energy steps up, on the bar
 * grid. A drop is the moment a DJ loads to: the end of an intro or breakdown,
 * where the drums and bass come back.
 */
export interface DropRecord {
  /** Time (seconds) of the drop, bar-aligned. */
  time: number
  /** Bar index it landed on, relative to `firstBar` (0 = bar 1). */
  bar: number
  /** `intro` is the first rhythmic bar after a non-rhythmic or quiet opening. */
  kind: 'intro' | 'lift'
  /** Post-drop energy as a multiple of the bars before it. */
  strength: number
  /** The evidence, in words: `energy x3.4 over bars 8-9`. */
  reason: string
}

/** A section of bars, delimited by detected drops or by the inferred phrase length. */
export interface PhraseRecord {
  /** Bar index (0 = the bar at `firstBar`) the phrase starts on. */
  startBar: number
  /** Phrase length in bars. */
  bars: number
  /** Absolute start time in seconds. */
  start: number
  /** Absolute end time in seconds. */
  end: number
  /** True when a detected drop sits on this phrase's first bar. */
  drop: boolean
}

/**
 * The bar-level structure of a grid: which beat of the bar is the downbeat, and
 * where the track's sections change.
 *
 * This exists separately from `BeatGridAnalysis` because it answers a different
 * question. `BeatGridAnalysis` is about the *tempo and phase* of the lattice —
 * is this 128 BPM, and does a beat land here. This is about the *bar*: a grid can
 * have every beat in exactly the right place and still have its bar lines one
 * beat out, which is the difference between a mix that lines up and a mix whose
 * bass drop lands on the wrong beat. Mixxx has no downbeat field at all; the
 * analyzer here scores all `beatsPerBar` rotations explicitly and keeps the
 * evidence for the one it picked.
 *
 * `rotation` is measured **relative to the grid's first audible beat**, so
 * `firstBar = anchor + rotation * beat`. `rotation === 0` means the track's first
 * audible beat is the downbeat — a 4-bar-loop-intro track — while `rotation === 2`
 * means it starts on the third beat, i.e. the intro is a pickup.
 */
export interface BarStructureAnalysis {
  /** Beats to add to the first audible beat to reach bar 1 (0 .. beatsPerBar-1). */
  rotation: number
  /**
   * The profile the rotation was decided from, one value per rotation, normalised
   * to 1 at the strongest candidate. Which profile it is is named in
   * `rotationDecision`. Empty when there were too few beats to score.
   */
  rotationScores: number[]
  /** Why this rotation won — or why none did. */
  rotationDecision: string
  /** False when the audio held no decisive downbeat evidence and the anchor was kept. */
  rotationDecided: boolean
  /** Rotations the evidence did not rule out, relative to the first audible beat. */
  rotationCandidates: number[]
  /** Phrase length in bars, when the drops imply one. `null` when they do not. */
  phraseBars: number | null
  /** Where `phraseBars` came from: measured from drops, or the 8-bar dance prior. */
  phraseSource: 'drops' | 'default'
  /** Bars the structure was scored over. */
  bars: number
  /** The analysed span the evidence covered, in seconds: `[start, end]`. */
  span: [number, number]
  /** Detected drops inside the span, in time order. */
  drops: DropRecord[]
  /** Sections of bars. */
  phrases: PhraseRecord[]
  /** Derived 0..1 structure confidence. Not calibrated against annotations. */
  confidence: number
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
  /**
   * Absolute times (seconds) of the bar downbeats the analyzer scored, covering
   * `barStructure.span` — not the whole track, because outside that span nothing
   * was measured. Consumers that need bar lines over the full timeline derive
   * them from the lattice instead (see `downbeatTimes` in ./grid). Rebuilt by
   * every grid transform, so a manual BPM or anchor edit cannot leave stale bars.
   */
  downbeats?: number[]
  /** Absolute times (seconds) of the detected drops; mirrors `barStructure.drops`. */
  drops?: number[]
  /** Which beat is the downbeat, and where the track's sections change. */
  barStructure?: BarStructureAnalysis
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
