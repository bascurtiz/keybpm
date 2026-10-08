import type { Track } from '@/types/track'
import { normalizeCamelot } from '@/lib/camelot'
import { bpmCandidates, bpmInRange } from '@/lib/bpm'

/**
 * Music-oriented search query parser.
 * Supports queries like:
 *   "fred again"          → text search (artist/title/genre/label/release)
 *   "128 11A"             → BPM + Camelot
 *   "F#m 125-130"         → Key + BPM range
 *   "house 128"           → genre + BPM
 *   "fred again 127"      → text + BPM
 *   "2021"                → year
 *   "label:nordlys"       → label prefix
 */

export interface ParsedQuery {
  text: string
  bpm: number | null
  bpmRange: { min: number; max: number } | null
  camelot: string | null
  key: string | null
  genre: string | null
  label: string | null
  year: number | null
}

// Common genre keywords for quick matching
const GENRE_KEYWORDS = [
  'house', 'techno', 'trance', 'dubstep', 'dnb', 'drum and bass',
  'ambient', 'breaks', 'breakbeat', 'garage', 'disco', 'funk',
  'hip hop', 'hiphop', 'rap', 'rock', 'pop', 'edm', 'idm',
  'electro', 'synthwave', 'retrowave', 'jungle', 'footwork',
  'hyperpop', 'indie', 'folk', 'metal', 'jazz', 'soul', 'rnb', 'r&b',
  'tech', 'deep', 'progressive', 'minimal', 'hardstyle', 'trap',
  'hardgroove', 'afro',
]

// Key name normalization: shorthand -> canonical key name
const KEY_PATTERNS: Record<string, string> = {
  // Minor keys
  'abm': 'Ab minor', 'g#m': 'Ab minor', 'g#min': 'Ab minor', 'abmin': 'Ab minor',
  'ebm': 'Eb minor', 'd#m': 'Eb minor', 'd#min': 'Eb minor', 'ebmin': 'Eb minor',
  'bbm': 'Bb minor', 'a#m': 'Bb minor', 'a#min': 'Bb minor', 'bbmin': 'Bb minor',
  'fm': 'F minor', 'fmin': 'F minor',
  'cm': 'C minor', 'cmin': 'C minor',
  'gm': 'G minor', 'gmin': 'G minor',
  'dm': 'D minor', 'dmin': 'D minor',
  'am': 'A minor', 'amin': 'A minor',
  'em': 'E minor', 'emin': 'E minor',
  'bm': 'B minor', 'bmin': 'B minor',
  'f#m': 'F# minor', 'f#min': 'F# minor',
  'dbm': 'Db minor', 'c#m': 'Db minor', 'c#min': 'Db minor', 'dbmin': 'Db minor',
  // Major keys
  'b': 'B major', 'bmaj': 'B major', 'bma': 'B major',
  'f#': 'F# major', 'f#maj': 'F# major', 'gb': 'F# major', 'gbmaj': 'F# major',
  'db': 'Db major', 'c#': 'Db major', 'dbmaj': 'Db major', 'c#maj': 'Db major',
  'ab': 'Ab major', 'g#': 'Ab major', 'abmaj': 'Ab major', 'g#maj': 'Ab major',
  'eb': 'Eb major', 'd#': 'Eb major', 'ebmaj': 'Eb major', 'd#maj': 'Eb major',
  'bb': 'Bb major', 'a#': 'Bb major', 'bbmaj': 'Bb major', 'a#maj': 'Bb major',
  'f': 'F major', 'fmaj': 'F major', 'fma': 'F major',
  'c': 'C major', 'cmaj': 'C major', 'cma': 'C major',
  'g': 'G major', 'gmaj': 'G major', 'gma': 'G major',
  'd': 'D major', 'dmaj': 'D major', 'dma': 'D major',
  'a': 'A major', 'amaj': 'A major', 'ama': 'A major',
  'e': 'E major', 'emaj': 'E major', 'ema': 'E major',
}

const SINGLE_NOTE_KEYS = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'])

export function parseQuery(rawQuery: string): ParsedQuery {
  const query = rawQuery.trim()
  const result: ParsedQuery = {
    text: '',
    bpm: null,
    bpmRange: null,
    camelot: null,
    key: null,
    genre: null,
    label: null,
    year: null,
  }

  if (!query) return result

  const tokens = query.split(/\s+/)
  const textParts: string[] = []
  let musicTokens = 0 // count of bpm/camelot/key tokens seen so far

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const lower = token.toLowerCase()

    // label:nordlys
    const labelMatch = lower.match(/^label:(.+)$/)
    if (labelMatch) {
      result.label = labelMatch[1]
      musicTokens++
      continue
    }

    // Camelot code (e.g. "11A", "8B")
    const camelotMatch = lower.match(/^(\d{1,2})([ab])$/)
    if (camelotMatch) {
      const code = normalizeCamelot(token)
      if (code) {
        result.camelot = code
        musicTokens++
        continue
      }
    }

    // BPM range (e.g. "125-130", "125–130")
    const rangeMatch = lower.match(/^(\d{2,3})[-–](\d{2,3})$/)
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10)
      const hi = parseInt(rangeMatch[2], 10)
      if (lo >= 30 && hi <= 400 && lo < hi) {
        result.bpmRange = { min: lo, max: hi }
        musicTokens++
        continue
      }
    }

    // Exact BPM (e.g. "128", "127.5", "~128")
    const bpmMatch = lower.match(/^~?(\d{2,3}(?:\.\d)?)$/)
    if (bpmMatch) {
      const val = parseFloat(bpmMatch[1])
      if (val >= 30 && val <= 400) {
        if (result.bpm === null && result.bpmRange === null) {
          result.bpm = val
          musicTokens++
          continue
        }
      }
    }

    // Year (e.g. "2021")
    const yearMatch = lower.match(/^(19|20)\d{2}$/)
    if (yearMatch) {
      if (result.year === null) {
        result.year = parseInt(lower, 10)
        musicTokens++
        continue
      }
    }

    // Key shorthand (e.g. "F#m", "Bbm", "C")
    // Single letters only count as keys when the query is short or contains
    // other music tokens — so "the a team" still searches text.
    const isSingleNote = SINGLE_NOTE_KEYS.has(lower)
    if (KEY_PATTERNS[lower] && (!isSingleNote || musicTokens > 0 || tokens.length === 1)) {
      result.key = KEY_PATTERNS[lower]
      musicTokens++
      continue
    }
    // Two-token key: "F# minor"
    const next = tokens[i + 1]
    if (next && /^(min|minor|maj|major)$/i.test(next)) {
      const combined = (lower + next.toLowerCase().slice(0, 3)).replace('minor', 'min').replace('major', 'maj')
      if (KEY_PATTERNS[combined]) {
        result.key = KEY_PATTERNS[combined]
        musicTokens++
        i++
        continue
      }
    }

    // Genre keyword (whole word) — still matched as text, so it also hits
    // titles/modes when a dataset has no genre column.
    if (GENRE_KEYWORDS.includes(lower)) {
      result.genre = lower
      musicTokens++
      continue
    }

    // Otherwise: free text
    textParts.push(token)
  }

  result.text = textParts.join(' ')
  return result
}

/** Lowercased searchable text per track, built once. */
const haystacks = new WeakMap<Track, string>()

function haystackOf(track: Track): string {
  let h = haystacks.get(track)
  if (h === undefined) {
    h = [
      track.artist, track.title, track.genre ?? '', track.label ?? '', track.release ?? '',
      track.mode ?? '', ...(track.tags ?? []),
    ].join(' ').toLowerCase()
    haystacks.set(track, h)
  }
  return h
}

export function matchesTrack(track: Track, parsed: ParsedQuery, words?: string[]): boolean {
  // Free text: every word must appear somewhere in artist/title/genre/label/release/mode/tags.
  const terms = words ?? (parsed.text ? parsed.text.toLowerCase().split(/\s+/) : [])
  if (terms.length) {
    const haystack = haystackOf(track)
    for (const w of terms) if (!haystack.includes(w)) return false
  }

  // BPM exact (±0.5) against every listed tempo — "160" also finds "80/160".
  if (parsed.bpm !== null) {
    const target = parsed.bpm
    if (!bpmCandidates(track).some(b => Math.abs(b - target) <= 0.5)) return false
  }

  // BPM range
  if (parsed.bpmRange && !bpmInRange(track, parsed.bpmRange.min, parsed.bpmRange.max)) return false

  // Camelot
  if (parsed.camelot && track.camelot !== parsed.camelot) return false

  // Musical key
  if (parsed.key && track.key?.toLowerCase() !== parsed.key.toLowerCase()) return false

  // Genre: genre column, or anywhere in the searchable text
  if (parsed.genre && !haystackOf(track).includes(parsed.genre)) return false

  // Label (substring)
  if (parsed.label) {
    if (!track.label || !track.label.toLowerCase().includes(parsed.label)) return false
  }

  // Year
  if (parsed.year !== null) {
    if (track.year !== parsed.year) return false
  }

  return true
}

export function searchTracks(tracks: Track[], query: string): Track[] {
  if (!query.trim()) return tracks
  const parsed = parseQuery(query)
  const words = parsed.text ? parsed.text.toLowerCase().split(/\s+/) : []
  return tracks.filter(t => matchesTrack(t, parsed, words))
}
