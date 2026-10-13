export type DeckId = 'A' | 'B'

export const HOT_CUE_COUNT = 8

export interface BeatGrid {
  /** Beats per minute from the grid analysis. */
  bpm: number
  /** Time (seconds) of the first detected beat. */
  firstBeat: number
  /** Time (seconds) of the downbeat anchor (beat 1 of a bar). */
  firstBar: number
  /** Number of beats per bar (typically 4 for dance music). */
  beatsPerBar: number
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
