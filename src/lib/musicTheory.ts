/** Ported core of key-tool-online music-theory (scales + frequencies). */

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const
export const NOTES_DEFAULT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const

const ENHARMONICS: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
}

export type NoteNameMode = 'default' | 'sharp' | 'flat'

export function getNoteName(index: number, mode: NoteNameMode = 'default'): string {
  if (mode === 'flat') return NOTES_FLAT[index]
  if (mode === 'sharp') return NOTES[index]
  return NOTES_DEFAULT[index]
}

export const SCALES: Record<string, number[]> = {
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Ionian: [0, 2, 4, 5, 7, 9, 11],
  Aeolian: [0, 2, 3, 5, 7, 8, 10],
  'Pentatonic Major': [0, 2, 4, 7, 9],
  'Pentatonic Minor': [0, 3, 5, 7, 10],
  Blues: [0, 3, 5, 6, 7, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
}

/** Scales shown in the Scale Finder dropdown (canonical names). */
export const SCALE_TYPES = [
  'Major',
  'Minor',
  'Pentatonic Major',
  'Pentatonic Minor',
  'Blues',
  'Dorian',
  'Mixolydian',
  'Phrygian',
  'Lydian',
  'Locrian',
]

export function resolveScaleType(name: string): string {
  if (name === 'Ionian') return 'Major'
  if (name === 'Aeolian') return 'Minor'
  return name
}

export const NOTE_COLORS: Record<string, string> = {
  C: '#EE83DA',
  G: '#CC8FFF',
  D: '#9FB7FF',
  A: '#57D9F9',
  E: '#0BEBEB',
  B: '#0AEDCA',
  'F#': '#3FED80',
  Gb: '#3FED80',
  Db: '#88F24E',
  'C#': '#88F24E',
  Ab: '#FFCB46',
  'G#': '#FFCB46',
  Eb: '#FFA07C',
  'D#': '#FFA07C',
  Bb: '#FF8894',
  'A#': '#FF8894',
  F: '#FF80B4',
}

export interface ScaleChord {
  root: string
  notes: string[]
  name: string
  quality: string
  roman: string
}

export function getScaleChords(root: string, scaleType: string): ScaleChord[] {
  const notes = getScaleNotes(root, resolveScaleType(scaleType))
  if (!notes.length) return []
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']
  return notes.map((rootNote, i) => {
    const thirdNote = notes[(i + 2) % notes.length]
    const fifthNote = notes[(i + 4) % notes.length]
    const rootIndex = getNoteIndex(rootNote)
    const thirdIndex = getNoteIndex(thirdNote)
    const fifthIndex = getNoteIndex(fifthNote)
    const thirdInterval = (thirdIndex - rootIndex + 12) % 12
    const fifthInterval = (fifthIndex - rootIndex + 12) % 12
    let quality = ''
    if (thirdInterval === 4 && fifthInterval === 7) quality = 'Maj'
    else if (thirdInterval === 3 && fifthInterval === 7) quality = 'min'
    else if (thirdInterval === 3 && fifthInterval === 6) quality = 'dim'
    else if (thirdInterval === 4 && fifthInterval === 8) quality = 'aug'
    else if (thirdInterval === 2 && fifthInterval === 7) quality = 'sus2'
    else if (thirdInterval === 5 && fifthInterval === 7) quality = 'sus4'
    let roman = ROMAN[i % 7] || String(i + 1)
    if (quality === 'min' || quality === 'dim') roman = roman.toLowerCase()
    if (quality === 'dim') roman += '°'
    if (quality === 'aug') roman += '+'
    return {
      root: rootNote,
      notes: [rootNote, thirdNote, fifthNote],
      name: quality ? `${rootNote} ${quality}` : rootNote,
      quality,
      roman,
    }
  })
}

export function getNoteIndex(note: string): number {
  const normalized = ENHARMONICS[note] ?? note
  return NOTES.indexOf(normalized as (typeof NOTES)[number])
}

export function getScaleNotes(root: string, scaleType: string): string[] {
  const rootIndex = getNoteIndex(root)
  if (rootIndex === -1) return []
  const intervals = SCALES[resolveScaleType(scaleType)]
  if (!intervals) return []
  return intervals.map(interval => NOTES[(rootIndex + interval) % 12])
}

/** A4 = 440Hz */
export function getFrequency(note: string, octave = 4): number {
  const noteIndex = getNoteIndex(note)
  if (noteIndex === -1) return 440
  const semitonesFromC0 = noteIndex + octave * 12
  const semitonesFromA4 = semitonesFromC0 - 57
  return 440 * Math.pow(2, semitonesFromA4 / 12)
}

export function getTransposedRoot(root: string, semitones: number): string {
  const idx = getNoteIndex(root)
  if (idx === -1) return root
  return NOTES[(idx + semitones + 120) % 12]
}

/** Musical key string ("A minor") → scale root + Major/Minor. */
export function musicalKeyToScale(keyName: string): { root: string; scaleType: 'Major' | 'Minor' } | null {
  const m = keyName.match(/^([A-G][#b]?)\s+(minor|major)$/i)
  if (!m) return null
  return {
    root: m[1],
    scaleType: m[2].toLowerCase() === 'minor' ? 'Minor' : 'Major',
  }
}
