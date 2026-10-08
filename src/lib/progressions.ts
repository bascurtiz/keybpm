import { NOTES, getNoteIndex, getScaleNotes, getScaleChords, type ScaleChord } from './musicTheory'

export interface ProgressionDef {
  name: string
  pattern: string[]
  description: string
  example: string
  requires7th: boolean
}

export const MODE_PROGRESSIONS: Record<string, ProgressionDef[]> = {
  // AEOLIAN (Natural Minor) - mapped from 'Minor' scale
  'Aeolian': [
    {
      name: 'Emotional 😔',
      pattern: ['i', 'VII', 'VI', 'VII'],
      description: 'i–VII–VI–VII',
      example: 'Am – G – F – G',
      requires7th: false
    },
    {
      name: 'Big & Lifting 🚀',
      pattern: ['i', 'VI', 'III', 'VII'],
      description: 'i–VI–III–VII',
      example: 'Am – F – C – G',
      requires7th: false
    },
    {
      name: 'Reflective 🌙',
      pattern: ['i', 'v', 'VI', 'v'],
      description: 'i–v–VI–v',
      example: 'Am – Em – F – Em',
      requires7th: false
    },
    {
      name: 'Sad 🖤',
      pattern: ['i', 'iv', 'v', 'i'],
      description: 'i–iv–v–i',
      example: 'Am – Dm – Em – Am',
      requires7th: false
    },
    {
      name: 'Tense 🎭',
      pattern: ['i', 'VI', 'VII', 'i'],
      description: 'i–VI–VII–i',
      example: 'Am – F – G – Am',
      requires7th: false
    },
    {
      name: 'Dark 🌑',
      pattern: ['VI', 'VII', 'i', 'v'],
      description: 'VI–VII–i–v',
      example: 'F – G – Am – Em',
      requires7th: false
    }
  ],
  
  // DORIAN
  'Dorian': [
    {
      name: 'Groovy 💃',
      pattern: ['i', 'IV', 'VII', 'IV'],
      description: 'i–IV–VII–IV',
      example: 'Dm – G – C – G',
      requires7th: false
    },
    {
      name: 'Warm ☀️',
      pattern: ['i', 'IV', 'v', 'i'],
      description: 'i–IV–v–i',
      example: 'Dm – G – Am – Dm',
      requires7th: false
    },
    {
      name: 'Indie-like 🌿',
      pattern: ['i', 'VII', 'IV', 'i'],
      description: 'i–VII–IV–i',
      example: 'Dm – C – G – Dm',
      requires7th: false
    },
    {
      name: 'Colorful 🎨',
      pattern: ['i', 'IV', 'III', 'VII'],
      description: 'i–IV–III–VII',
      example: 'Dm – G – F – C',
      requires7th: false
    },
    {
      name: 'Relaxed 😌',
      pattern: ['i', 'v', 'IV', 'i'],
      description: 'i–v–IV–i',
      example: 'Dm – Am – G – Dm',
      requires7th: false
    },
    {
      name: 'Light 🌤️',
      pattern: ['i', 'IV', 'i', 'VII'],
      description: 'i–IV–i–VII',
      example: 'Dm – G – Dm – C',
      requires7th: false
    }
  ],
  
  // PHRYGIAN
  'Phrygian': [
    {
      name: 'Spicy 🐍',
      pattern: ['i', 'II', 'i', 'II'],
      description: 'i–II–i–II',
      example: 'Em – F – Em – F',
      requires7th: false
    },
    {
      name: 'Epic 🗡️',
      pattern: ['i', 'II', 'III', 'II'],
      description: 'i–II–III–II',
      example: 'Em – F – G – F',
      requires7th: false
    },
    {
      name: 'Heavy 🌫️',
      pattern: ['i', 'VII', 'VI', 'II'],
      description: 'i–VII–VI–II',
      example: 'Em – D – C – F',
      requires7th: false
    },
    {
      name: 'Powerful 🔥',
      pattern: ['i', 'II', 'VII', 'i'],
      description: 'i–II–VII–i',
      example: 'Em – F – D – Em',
      requires7th: false
    },
    {
      name: 'Creepy 👁️',
      pattern: ['i', 'v°', 'II', 'i'],
      description: 'i–v°–II–i',
      example: 'Em – B° – F – Em',
      requires7th: false
    },
    {
      name: 'Mysterious 🔮',
      pattern: ['i', 'II', 'iv', 'i'],
      description: 'i–II–iv–i',
      example: 'Em – F – Am – Em',
      requires7th: false
    }
  ],
  
  // LYDIAN
  'Lydian': [
    {
      name: 'Dreamy 💫',
      pattern: ['I', 'II', 'I', 'II'],
      description: 'I–II–I–II',
      example: 'F – G – F – G',
      requires7th: false
    },
    {
      name: 'Bright ✨',
      pattern: ['I', 'II', 'V', 'I'],
      description: 'I–II–V–I',
      example: 'F – G – C – F',
      requires7th: false
    },
    {
      name: 'Sparkly 🌈',
      pattern: ['I', 'VII', 'II', 'I'],
      description: 'I–VII–II–I',
      example: 'F – E – G – F',
      requires7th: false
    },
    {
      name: 'Soaring 🦅',
      pattern: ['I', 'II', 'vi', 'V'],
      description: 'I–II–vi–V',
      example: 'F – G – Dm – C',
      requires7th: false
    },
    {
      name: 'Majestic 👑',
      pattern: ['I', 'III', 'II', 'I'],
      description: 'I–III–II–I',
      example: 'F – A – G – F',
      requires7th: false
    },
    {
      name: 'Radiant ☀️',
      pattern: ['I', 'II', 'IV', 'V'],
      description: 'I–II–IV–V',
      example: 'F – G – Bb – C',
      requires7th: false
    }
  ],
  
  // MIXOLYDIAN
  'Mixolydian': [
    {
      name: 'Fun 🎉',
      pattern: ['I', 'VII', 'IV', 'I'],
      description: 'I–VII–IV–I',
      example: 'G – F – C – G',
      requires7th: false
    },
    {
      name: 'Edgy ⚡',
      pattern: ['I', 'v', 'VII', 'IV'],
      description: 'I–v–VII–IV',
      example: 'G – Dm – F – C',
      requires7th: false
    },
    {
      name: 'Breezy 🍃',
      pattern: ['I', 'VII', 'I', 'IV'],
      description: 'I–VII–I–IV',
      example: 'G – F – G – C',
      requires7th: false
    },
    {
      name: 'Catchy 🎶',
      pattern: ['I', 'IV', 'VII', 'IV'],
      description: 'I–IV–VII–IV',
      example: 'G – C – F – C',
      requires7th: false
    },
    {
      name: 'Smooth 🌊',
      pattern: ['I', 'v', 'IV', 'I'],
      description: 'I–v–IV–I',
      example: 'G – Dm – C – G',
      requires7th: false
    },
    {
      name: 'Energetic 🚀',
      pattern: ['I', 'VII', 'IV', 'V'],
      description: 'I–VII–IV–V',
      example: 'G – F – C – D',
      requires7th: false
    }
  ],
  
  // IONIAN (Major) - mapped from 'Major' scale
  'Ionian': [
    {
      name: 'Happy 🌟',
      pattern: ['I', 'V', 'vi', 'IV'],
      description: 'I–V–vi–IV',
      example: 'C – G – Am – F',
      requires7th: false
    },
    {
      name: 'Classic 🎵',
      pattern: ['I', 'IV', 'V', 'I'],
      description: 'I–IV–V–I',
      example: 'C – F – G – C',
      requires7th: false
    },
    {
      name: 'Hopeful 🌅',
      pattern: ['vi', 'IV', 'I', 'V'],
      description: 'vi–IV–I–V',
      example: 'Am – F – C – G',
      requires7th: false
    },
    {
      name: 'Uplifting 💪',
      pattern: ['I', 'vi', 'IV', 'V'],
      description: 'I–vi–IV–V',
      example: 'C – Am – F – G',
      requires7th: false
    },
    {
      name: 'Simple 🎸',
      pattern: ['I', 'IV', 'I', 'V'],
      description: 'I–IV–I–V',
      example: 'C – F – C – G',
      requires7th: false
    },
    {
      name: 'Strong 🎯',
      pattern: ['I', 'V', 'IV', 'I'],
      description: 'I–V–IV–I',
      example: 'C – G – F – C',
      requires7th: false
    }
  ],
  
  // LOCRIAN
  'Locrian': [
    {
      name: 'Unsteady ⚠️',
      pattern: ['i°', 'bII', 'bIII', 'bII'],
      description: 'i°–♭II–♭III–♭II',
      example: 'B° – C – D – C',
      requires7th: false
    },
    {
      name: 'Tense 🕷️',
      pattern: ['i°', 'bv', 'bII', 'i°'],
      description: 'i°–♭v–♭II–i°',
      example: 'B° – F – C – B°',
      requires7th: false
    },
    {
      name: 'Dark-Sci-Fi 🧪',
      pattern: ['i°', 'iv', 'bv', 'i°'],
      description: 'i°–iv–♭v–i°',
      example: 'B° – E – F – B°',
      requires7th: false
    },
    {
      name: 'Unstable 🌊',
      pattern: ['i°', 'bII', 'iv', 'i°'],
      description: 'i°–♭II–iv–i°',
      example: 'B° – C – E – B°',
      requires7th: false
    },
    {
      name: 'Chaotic 🔀',
      pattern: ['i°', 'bv', 'iv', 'i°'],
      description: 'i°–♭v–iv–i°',
      example: 'B° – F – E – B°',
      requires7th: false
    },
    {
      name: 'Twisted 🌀',
      pattern: ['i°', 'iv', 'bII', 'i°'],
      description: 'i°–iv–♭II–i°',
      example: 'B° – E – C – B°',
      requires7th: false
    }
  ],
  
  // PENTATONIC MAJOR
  'Pentatonic Major': [
    {
      name: 'Simple 🎸',
      pattern: ['I', 'IV', 'V', 'I'],
      description: 'I–IV–V–I',
      example: 'C – F – G – C',
      requires7th: false
    },
    {
      name: 'Classic 🎵',
      pattern: ['I', 'V', 'IV', 'I'],
      description: 'I–V–IV–I',
      example: 'C – G – F – C',
      requires7th: false
    },
    {
      name: 'Rooted 🎯',
      pattern: ['I', 'IV', 'I', 'V'],
      description: 'I–IV–I–V',
      example: 'C – F – C – G',
      requires7th: false
    },
    {
      name: 'Ascending 📈',
      pattern: ['I', 'II', 'IV', 'V'],
      description: 'I–II–IV–V',
      example: 'C – D – F – G',
      requires7th: false
    },
    {
      name: 'Folk 🪕',
      pattern: ['I', 'III', 'IV', 'V'],
      description: 'I–III–IV–V',
      example: 'C – E – F – G',
      requires7th: false
    },
    {
      name: 'Open 🌊',
      pattern: ['I', 'V', 'I', 'IV'],
      description: 'I–V–I–IV',
      example: 'C – G – C – F',
      requires7th: false
    }
  ],
  
  // PENTATONIC MINOR
  'Pentatonic Minor': [
    {
      name: 'Bluesy 🎷',
      pattern: ['i', 'iv', 'v', 'i'],
      description: 'i–iv–v–i',
      example: 'Am – Dm – Em – Am',
      requires7th: false
    },
    {
      name: 'Classic Rock 🤘',
      pattern: ['i', 'bVII', 'bVI', 'bVII'],
      description: 'i–♭VII–♭VI–♭VII',
      example: 'Am – G – F – G',
      requires7th: false
    },
    {
      name: 'Driving 🚗',
      pattern: ['i', 'v', 'iv', 'i'],
      description: 'i–v–iv–i',
      example: 'Am – Em – Dm – Am',
      requires7th: false
    },
    {
      name: 'Smooth 💫',
      pattern: ['i', 'bVII', 'i', 'iv'],
      description: 'i–♭VII–i–iv',
      example: 'Am – G – Am – Dm',
      requires7th: false
    },
    {
      name: 'Groovy 🎹',
      pattern: ['i', 'bVI', 'bVII', 'i'],
      description: 'i–♭VI–♭VII–i',
      example: 'Am – F – G – Am',
      requires7th: false
    },
    {
      name: 'Powerful ⚡',
      pattern: ['i', 'iv', 'bVII', 'i'],
      description: 'i–iv–♭VII–i',
      example: 'Am – Dm – G – Am',
      requires7th: false
    }
  ],
  
  // BLUES
  'Blues': [
    {
      name: 'Classic Blues 🎸',
      pattern: ['I', 'IV', 'V', 'I'],
      description: 'I–IV–V–I',
      example: 'C – F – G – C',
      requires7th: false
    },
    {
      name: 'Minor Blues 😢',
      pattern: ['i', 'iv', 'v', 'i'],
      description: 'i–iv–v–i',
      example: 'Am – Dm – Em – Am',
      requires7th: false
    },
    {
      name: 'Shuffle 🎹',
      pattern: ['I', 'IV', 'I', 'V'],
      description: 'I–IV–I–V',
      example: 'C – F – C – G',
      requires7th: false
    },
    {
      name: 'Laid Back 🪑',
      pattern: ['i', 'bVII', 'iv', 'i'],
      description: 'i–♭VII–iv–i',
      example: 'Am – G – Dm – Am',
      requires7th: false
    },
    {
      name: 'Swing 🎺',
      pattern: ['I', 'V', 'IV', 'I'],
      description: 'I–V–IV–I',
      example: 'C – G – F – C',
      requires7th: false
    },
    {
      name: 'Gritty 💎',
      pattern: ['i', 'iv', 'bVII', 'i'],
      description: 'i–iv–♭VII–i',
      example: 'Am – Dm – G – Am',
      requires7th: false
    }
  ]
};

export const SCALE_TO_MODE: Record<string, string> = {
  Minor: 'Aeolian',
  Aeolian: 'Aeolian',
  Major: 'Ionian',
  Ionian: 'Ionian',
  Dorian: 'Dorian',
  Phrygian: 'Phrygian',
  Lydian: 'Lydian',
  Mixolydian: 'Mixolydian',
  Locrian: 'Locrian',
  'Pentatonic Major': 'Pentatonic Major',
  'Pentatonic Minor': 'Pentatonic Minor',
  Blues: 'Blues',
}

function romanToNumber(roman: string): number {
  const map: Record<string, number> = {
    I: 1, i: 1, II: 2, ii: 2, III: 3, iii: 3,
    IV: 4, iv: 4, V: 5, v: 5, VI: 6, vi: 6, VII: 7, vii: 7,
  }
  const clean = roman.replace(/[b♭°]/g, '').trim()
  return map[clean] ?? map[clean.toUpperCase()] ?? 1
}

function buildChord(root: string, intervals: number[], quality = ''): ScaleChord | null {
  const rootIndex = getNoteIndex(root)
  if (rootIndex === -1) return null
  const notes = intervals.map(i => NOTES[(rootIndex + i) % 12])
  return {
    root,
    notes,
    name: quality ? `${root} ${quality}` : root,
    quality,
    roman: '',
  }
}

export function getChordFromDegree(
  root: string,
  scaleType: string,
  degree: string,
  _add7th = false,
): ScaleChord | null {
  const scaleNotes = getScaleNotes(root, scaleType)
  if (!scaleNotes.length) return null
  const isDiminished = degree.includes('°')
  const isFlat = degree.includes('b') || degree.includes('♭')
  const degreeNum = romanToNumber(degree)
  let chordRoot: string
  let quality = ''
  if (isFlat) {
    const parallel = getScaleNotes(root, 'Major')
    const naturalNote = parallel[(degreeNum - 1) % parallel.length]
    chordRoot = NOTES[(getNoteIndex(naturalNote) - 1 + 12) % 12]
    quality = 'Maj'
  } else {
    const scaleChords = getScaleChords(root, scaleType)
    const c = scaleChords[(degreeNum - 1) % scaleChords.length]
    if (!c) return null
    chordRoot = c.root
    quality = c.quality || 'Maj'
  }
  if (isDiminished) quality = 'dim'
  const intervals =
    quality === 'min' ? [0, 3, 7] :
    quality === 'dim' ? [0, 3, 6] :
    quality === 'aug' ? [0, 4, 8] :
    [0, 4, 7]
  return buildChord(chordRoot, intervals, quality)
}

export function getProgressionsForMode(scaleType: string): ProgressionDef[] {
  const mode = SCALE_TO_MODE[scaleType] || scaleType
  return MODE_PROGRESSIONS[mode] || []
}

export function getModeProgression(
  root: string,
  scaleType: string,
  progressionName: string,
): ScaleChord[] {
  const list = getProgressionsForMode(scaleType)
  const def = list.find(p => p.name === progressionName)
  if (!def) return []
  return def.pattern
    .map(d => getChordFromDegree(root, scaleType, d, def.requires7th))
    .filter((c): c is ScaleChord => !!c)
}
