import assert from 'node:assert/strict'
import {
  parseKey,
  parseChord,
  chordToRoman,
  chordsToRoman,
  progressionToRoman,
  normalizeHooktheoryProgression,
  romanToChord,
  romanToChords,
} from './lib/roman.mjs'

console.log('Testing Roman Numeral Music Theory Engine...')

// 1. Key parsing
assert.deepEqual(parseKey('C major'), { tonic: 'C', tonicSemitone: 0, isMinor: false, mode: 'major' })
assert.deepEqual(parseKey('A minor'), { tonic: 'A', tonicSemitone: 9, isMinor: true, mode: 'minor' })
assert.deepEqual(parseKey('F# minor'), { tonic: 'F#', tonicSemitone: 6, isMinor: true, mode: 'minor' })
assert.deepEqual(parseKey('Eb Major'), { tonic: 'Eb', tonicSemitone: 3, isMinor: false, mode: 'major' })
assert.deepEqual(parseKey('B dorian'), { tonic: 'B', tonicSemitone: 11, isMinor: true, mode: 'dorian' })

// 2. Diatonic Major (Key: C major)
assert.equal(chordToRoman('C', 'C major'), 'I')
assert.equal(chordToRoman('Dm', 'C major'), 'ii')
assert.equal(chordToRoman('Em', 'C major'), 'iii')
assert.equal(chordToRoman('F', 'C major'), 'IV')
assert.equal(chordToRoman('G', 'C major'), 'V')
assert.equal(chordToRoman('Am', 'C major'), 'vi')
assert.equal(chordToRoman('Bdim', 'C major'), 'vii°')

// 3. Diatonic Minor (Key: A minor)
assert.equal(chordToRoman('Am', 'A minor'), 'i')
assert.equal(chordToRoman('Bdim', 'A minor'), 'ii°')
assert.equal(chordToRoman('C', 'A minor'), 'III')
assert.equal(chordToRoman('Dm', 'A minor'), 'iv')
assert.equal(chordToRoman('Em', 'A minor'), 'v')
assert.equal(chordToRoman('E', 'A minor'), 'V') // Harmonic minor dominant
assert.equal(chordToRoman('F', 'A minor'), 'VI')
assert.equal(chordToRoman('G', 'A minor'), 'VII') // Natural minor subtonic

// 4. Avicii - Levels (C# minor: C#m - E - B - A)
const levelsProg = chordsToRoman(['C#m', 'E', 'B', 'A'], 'C# minor')
assert.deepEqual(levelsProg, ['i', 'III', 'VII', 'VI'])

// 5. Daft Punk - Get Lucky (B minor / Dorian: Bm7 - D - F#m7 - E)
const getLuckyProg = chordsToRoman(['Bm7', 'D', 'F#m7', 'E'], 'B minor')
assert.deepEqual(getLuckyProg, ['i7', 'III', 'v7', 'IV'])

// 6. Pop 4-chord string progression
assert.equal(progressionToRoman('C - G - Am - F', 'C major'), 'I – V – vi – IV')
assert.equal(progressionToRoman('Am - F - C - G', 'A minor'), 'i – VI – III – VII')

// 7. Extensions & 7th chords
assert.equal(chordToRoman('Dm7', 'C major'), 'ii7')
assert.equal(chordToRoman('G7', 'C major'), 'V7')
assert.equal(chordToRoman('Cmaj7', 'C major'), 'Imaj7')
assert.equal(chordToRoman('Asus4', 'D major'), 'Vsus4')

// 8. Hooktheory normalization
assert.equal(normalizeHooktheoryProgression('i+III+VII+VI'), 'i – III – VII – VI')
assert.equal(normalizeHooktheoryProgression('I+V+vi+IV'), 'I – V – vi – IV')

// 9. Reverse: Roman to Chord
assert.equal(romanToChord('I', 'C major'), 'C')
assert.equal(romanToChord('IV', 'C major'), 'F')
assert.equal(romanToChord('vi', 'C major'), 'Am')
assert.equal(romanToChord('III', 'C# minor'), 'E')
assert.equal(romanToChord('VII', 'C# minor'), 'B')
assert.deepEqual(romanToChords('i - III - VII - VI', 'C# minor'), ['C#m', 'E', 'B', 'A'])
assert.deepEqual(romanToChords(['I', 'V', 'vi', 'IV'], 'C major'), ['C', 'G', 'Am', 'F'])

console.log('✓ All Roman numeral engine tests passed!')
