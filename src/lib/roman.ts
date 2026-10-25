/**
 * Music Theory Roman Numeral Analysis Engine for KeyDB.
 *
 * Converts absolute chords (e.g. "C#m", "E", "B", "A", "G/B", "Fmaj7") in any
 * given key (e.g. "C# minor", "A major") into standardized Roman numeral
 * notation (e.g. "i - III - VII - VI", "I - V - vi - IV").
 *
 * Also supports reverse mapping (Roman numeral -> absolute chord in key) and
 * parsing Hooktheory chord paths.
 */

// Semitone offset from C (0-11)
const NOTE_SEMITONES: Record<string, number> = {
  C: 0, 'B#': 0,
  'C#': 1, Db: 1,
  D: 2,
  'D#': 3, Eb: 3,
  E: 4, Fb: 4,
  F: 5, 'E#': 5,
  'F#': 6, Gb: 6,
  G: 7,
  'G#': 8, Ab: 8,
  A: 9,
  'A#': 10, Bb: 10,
  B: 11, Cb: 11,
}

// Preferred enharmonic pitch names for spelling chords in a given key
export const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const FLAT_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

// Flat key tonics that typically prefer flat note spellings
const FLAT_KEY_TONICS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'D', 'G', 'C'])

export interface ParsedKey {
  tonic: string
  tonicSemitone: number
  isMinor: boolean
  mode?: string
}

export interface ParsedChord {
  raw: string
  root: string
  rootSemitone: number
  quality: 'major' | 'minor' | 'diminished' | 'augmented' | 'sus'
  extension: string
  bass?: string
  bassSemitone?: number
}

/**
 * Parse a key string (e.g. "C# minor", "A major", "Eb Major", "D dorian").
 */
export function parseKey(keyStr: string): ParsedKey | null {
  if (!keyStr || typeof keyStr !== 'string') return null
  const cleaned = keyStr.trim()
  const m = cleaned.match(/^([A-Ga-g][#b]?)\s*(minor|major|m|dorian|mixolydian|phrygian|lydian|aeolian|locrian)?$/i)
  if (!m) return null

  const rootRaw = m[1]
  const tonic = rootRaw.charAt(0).toUpperCase() + rootRaw.slice(1).toLowerCase()
  if (NOTE_SEMITONES[tonic] === undefined) return null

  const modeStr = (m[2] || '').toLowerCase()
  const isMinor = modeStr === 'minor' || modeStr === 'm' || modeStr === 'dorian' || modeStr === 'phrygian' || modeStr === 'aeolian'

  return {
    tonic,
    tonicSemitone: NOTE_SEMITONES[tonic],
    isMinor,
    mode: modeStr || (isMinor ? 'minor' : 'major'),
  }
}

/**
 * Parse an absolute chord string (e.g. "C#m7", "Fmaj7", "G/B", "Bb", "D#dim", "Asus4").
 */
export function parseChord(chordStr: string): ParsedChord | null {
  if (!chordStr || typeof chordStr !== 'string') return null
  const cleaned = chordStr.trim()
  if (!cleaned) return null

  // Match root, optional quality/extension, optional slash bass
  const match = cleaned.match(/^([A-Ga-g][#b]?)([^/]*)(?:\/([A-Ga-g][#b]?))?$/)
  if (!match) return null

  const rootRaw = match[1]
  const root = rootRaw.charAt(0).toUpperCase() + rootRaw.slice(1).toLowerCase()
  if (NOTE_SEMITONES[root] === undefined) return null

  const extRaw = (match[2] || '').trim()
  const bassRaw = match[3] ? match[3].charAt(0).toUpperCase() + match[3].slice(1).toLowerCase() : undefined

  let quality: 'major' | 'minor' | 'diminished' | 'augmented' | 'sus' = 'major'
  let extension = ''

  // Determine quality
  if (/^dim|°|o(?!\w)/i.test(extRaw)) {
    quality = 'diminished'
    extension = extRaw.replace(/^dim|°|o/i, '')
  } else if (/^aug|\+/i.test(extRaw)) {
    quality = 'augmented'
    extension = extRaw.replace(/^aug|\+/i, '')
  } else if (/^m(?!aj)/.test(extRaw) || /^min|-/i.test(extRaw)) {
    quality = 'minor'
    extension = extRaw.replace(/^m(?!aj)|^min|-/i, '')
  } else if (/^sus[24]?/i.test(extRaw)) {
    quality = 'sus'
    extension = extRaw
  } else {
    quality = 'major'
    extension = extRaw.replace(/^maj/i, 'maj')
  }

  return {
    raw: cleaned,
    root,
    rootSemitone: NOTE_SEMITONES[root],
    quality,
    extension,
    bass: bassRaw && NOTE_SEMITONES[bassRaw] !== undefined ? bassRaw : undefined,
    bassSemitone: bassRaw && NOTE_SEMITONES[bassRaw] !== undefined ? NOTE_SEMITONES[bassRaw] : undefined,
  }
}

/**
 * Map an interval and chord quality to a Roman numeral.
 */
export function intervalToRoman(
  semitones: number,
  quality: 'major' | 'minor' | 'diminished' | 'augmented' | 'sus',
  isMinorKey: boolean
): string {
  const norm = ((semitones % 12) + 12) % 12

  if (!isMinorKey) {
    // MAJOR KEY
    switch (norm) {
      case 0:  return quality === 'minor' ? 'i' : 'I'
      case 1:  return quality === 'minor' ? 'bii' : 'bII' // Neapolitan
      case 2:  return quality === 'major' ? 'II' : 'ii'   // Secondary dominant or diatonic ii
      case 3:  return quality === 'minor' ? 'biii' : 'bIII' // Borrowed from minor
      case 4:  return quality === 'major' ? 'III' : 'iii' // Secondary dominant or diatonic iii
      case 5:  return quality === 'minor' ? 'iv' : 'IV'   // Borrowed iv or diatonic IV
      case 6:  return quality === 'minor' ? '#iv' : '#iv°' // Tritone
      case 7:  return quality === 'minor' ? 'v' : 'V'     // Diatonic V or minor v
      case 8:  return quality === 'minor' ? 'bvi' : 'bVI' // Borrowed bVI
      case 9:  return quality === 'major' ? 'VI' : 'vi'   // Secondary dominant or diatonic vi
      case 10: return quality === 'minor' ? 'bvii' : 'bVII' // Mixolydian subtonic Major
      case 11: return quality === 'minor' ? 'vii' : 'vii°' // Diatonic vii°
      default: return '?'
    }
  } else {
    // MINOR KEY (Aeolian / Natural minor)
    switch (norm) {
      case 0:  return quality === 'major' ? 'I' : 'i'     // Diatonic i or Picardy third I
      case 1:  return quality === 'minor' ? 'bii' : 'bII' // Neapolitan
      case 2:  return quality === 'minor' ? 'ii' : 'ii°'  // Diatonic ii°
      case 3:  return quality === 'minor' ? 'iii' : 'III' // Relative Major III
      case 4:  return quality === 'minor' ? 'iv' : 'IV'   // Diatonic iv or Dorian IV
      case 5:  return quality === 'minor' ? 'iv' : 'IV'   // Subdominant
      case 6:  return quality === 'minor' ? 'bV' : 'bV'
      case 7:  return quality === 'major' ? 'V' : 'v'     // Harmonic minor V or natural v
      case 8:  return quality === 'minor' ? 'vi' : 'VI'   // Submediant VI
      case 9:  return quality === 'minor' ? '#vi' : '#VI'
      case 10: return quality === 'minor' ? 'vii' : 'VII' // Subtonic Major VII (e.g. G in Am)
      case 11: return quality === 'major' ? 'VII' : 'vii°' // Harmonic minor leading tone vii° (e.g. G#dim in Am)
      default: return '?'
    }
  }
}

/**
 * Convert a single chord into its Roman numeral representation given a key.
 *
 * Example:
 *   chordToRoman("Am", "C major") -> "vi"
 *   chordToRoman("Fmaj7", "C major") -> "IVmaj7"
 *   chordToRoman("E", "A minor") -> "V"
 *   chordToRoman("G", "A minor") -> "VII"
 *   chordToRoman("B", "C# minor") -> "VII"
 */
export function chordToRoman(chordStr: string, keyStr: string): string {
  const key = parseKey(keyStr)
  if (!key) return chordStr

  const chord = parseChord(chordStr)
  if (!chord) return chordStr

  const semitones = (chord.rootSemitone - key.tonicSemitone + 12) % 12
  let roman = intervalToRoman(semitones, chord.quality, key.isMinor)

  // Append extension
  if (chord.extension) {
    roman += chord.extension
  }

  // Handle slash chord bass inversion (e.g. G/B in C major -> V/vii or V6)
  if (chord.bassSemitone !== undefined) {
    const bassDiff = (chord.bassSemitone - key.tonicSemitone + 12) % 12
    const bassRoman = intervalToRoman(bassDiff, 'major', key.isMinor).toLowerCase()
    roman += `/${bassRoman}`
  }

  return roman
}

/**
 * Convert an array or delimiter-separated list of chords into Roman numerals.
 *
 * Example:
 *   chordsToRoman(["C#m", "E", "B", "A"], "C# minor") -> ["i", "III", "VII", "VI"]
 *   progressionToRoman("Am - F - C - G", "A minor") -> "i - VI - III - VII"
 */
export function chordsToRoman(chords: string[], keyStr: string): string[] {
  return chords.map(c => chordToRoman(c, keyStr))
}

export function progressionToRoman(progression: string | string[], keyStr: string): string {
  const chordList = Array.isArray(progression)
    ? progression
    : progression.split(/[\s,–—\->|]+/).map(s => s.trim()).filter(Boolean)

  return chordsToRoman(chordList, keyStr).join(' – ')
}

/**
 * Clean and normalize a Roman numeral progression string from Hooktheory
 * (e.g. "i+III+VII+VI" or "I+V+vi+IV" or "1+5+6+4").
 */
export function normalizeHooktheoryProgression(rawProg: string): string {
  if (!rawProg) return ''
  return decodeURIComponent(rawProg)
    .replace(/\+/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Roman degree to semitone offset table.
 */
const ROMAN_MAJOR_OFFSETS: Record<string, { semitones: number; quality: string }> = {
  i: { semitones: 0, quality: 'm' },
  I: { semitones: 0, quality: '' },
  bii: { semitones: 1, quality: 'm' },
  bII: { semitones: 1, quality: '' },
  ii: { semitones: 2, quality: 'm' },
  II: { semitones: 2, quality: '' },
  biii: { semitones: 3, quality: 'm' },
  bIII: { semitones: 3, quality: '' },
  iii: { semitones: 4, quality: 'm' },
  III: { semitones: 4, quality: '' },
  iv: { semitones: 5, quality: 'm' },
  IV: { semitones: 5, quality: '' },
  '#iv': { semitones: 6, quality: 'dim' },
  '#iv°': { semitones: 6, quality: 'dim' },
  bV: { semitones: 6, quality: '' },
  v: { semitones: 7, quality: 'm' },
  V: { semitones: 7, quality: '' },
  bvi: { semitones: 8, quality: 'm' },
  bVI: { semitones: 8, quality: '' },
  vi: { semitones: 9, quality: 'm' },
  VI: { semitones: 9, quality: '' },
  bvii: { semitones: 10, quality: 'm' },
  bVII: { semitones: 10, quality: '' },
  vii: { semitones: 11, quality: 'dim' },
  'vii°': { semitones: 11, quality: 'dim' },
  VII: { semitones: 11, quality: '' },
}

const ROMAN_MINOR_OFFSETS: Record<string, { semitones: number; quality: string }> = {
  i: { semitones: 0, quality: 'm' },
  I: { semitones: 0, quality: '' },
  bii: { semitones: 1, quality: 'm' },
  bII: { semitones: 1, quality: '' },
  ii: { semitones: 2, quality: 'm' },
  'ii°': { semitones: 2, quality: 'dim' },
  II: { semitones: 2, quality: '' },
  biii: { semitones: 3, quality: 'm' },
  III: { semitones: 3, quality: '' },
  iii: { semitones: 3, quality: 'm' },
  iv: { semitones: 5, quality: 'm' },
  IV: { semitones: 5, quality: '' },
  v: { semitones: 7, quality: 'm' },
  V: { semitones: 7, quality: '' },
  VI: { semitones: 8, quality: '' },
  vi: { semitones: 8, quality: 'm' },
  VII: { semitones: 10, quality: '' },
  vii: { semitones: 10, quality: 'm' },
  'vii°': { semitones: 11, quality: 'dim' },
}

/**
 * Convert a Roman numeral back into an absolute chord for a given key.
 *
 * Example:
 *   romanToChord("IV", "C major") -> "F"
 *   romanToChord("vi", "C major") -> "Am"
 *   romanToChord("III", "C# minor") -> "E"
 *   romanToChord("VII", "C# minor") -> "B"
 */
export function romanToChord(romanStr: string, keyStr: string): string {
  const key = parseKey(keyStr)
  if (!key) return romanStr

  const cleaned = romanStr.trim()
  const m = cleaned.match(/^([b#]?[ivIV]+[°]?)(.*)$/)
  if (!m) return romanStr

  const deg = m[1]
  const ext = m[2]

  const table = key.isMinor ? ROMAN_MINOR_OFFSETS : ROMAN_MAJOR_OFFSETS
  const mapping = table[deg] || (key.isMinor ? ROMAN_MAJOR_OFFSETS[deg] : ROMAN_MINOR_OFFSETS[deg])
  if (!mapping) return romanStr

  const rootSemitone = (key.tonicSemitone + mapping.semitones) % 12
  const useFlat = FLAT_KEY_TONICS.has(key.tonic) || key.tonic.includes('b')
  const rootName = useFlat ? FLAT_NOTES[rootSemitone] : SHARP_NOTES[rootSemitone]

  return `${rootName}${mapping.quality}${ext}`
}

export function romanToChords(romanProgression: string[] | string, keyStr: string): string[] {
  const romans = Array.isArray(romanProgression)
    ? romanProgression
    : romanProgression.split(/[\s,–—\->|]+/).map(s => s.trim()).filter(Boolean)

  return romans.map(r => romanToChord(r, keyStr))
}

/**
 * Transpose an absolute chord by a given number of semitones (e.g. for Capo adjustments).
 *
 * Example:
 *   transposeChord("Am", 2) -> "Bm"
 *   transposeChord("C", 2) -> "D"
 */
export function transposeChord(chordStr: string, semitones: number): string {
  const chord = parseChord(chordStr)
  if (!chord || semitones === 0) return chordStr

  const newRootSemitone = ((chord.rootSemitone + semitones) % 12 + 12) % 12
  const newRoot = SHARP_NOTES[newRootSemitone]
  const quality = chord.quality === 'minor' ? 'm' : chord.quality === 'diminished' ? 'dim' : chord.quality === 'augmented' ? 'aug' : ''
  let res = `${newRoot}${quality}${chord.extension}`
  if (chord.bassSemitone !== undefined) {
    const newBassSemitone = ((chord.bassSemitone + semitones) % 12 + 12) % 12
    res += `/${SHARP_NOTES[newBassSemitone]}`
  }
  return res
}

/**
 * Detect the core repeating chord progression loop from a sequence of chords.
 *
 * Example:
 *   findCoreProgression(["C#m", "E", "B", "A", "C#m", "E", "B", "A"]) -> ["C#m", "E", "B", "A"]
 */
export function findCoreProgression(chords: string[]): string[] {
  if (chords.length <= 4) return chords
  for (let k = 2; k <= Math.min(8, Math.floor(chords.length / 2)); k++) {
    const pattern = chords.slice(0, k)
    let matches = true
    for (let i = k; i < chords.length; i++) {
      if (chords[i] !== pattern[i % k]) {
        matches = false
        break
      }
    }
    if (matches) return pattern
  }
  return chords.slice(0, 8)
}


