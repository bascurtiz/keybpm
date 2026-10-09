import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyWheel, WheelModeSwitch } from '@/components/KeyWheel'
import { RotaryKnob } from '@/components/RotaryKnob'
import { AudioEngine } from '@/lib/audioEngine'
import type { WaveType } from '@/lib/audioEngine'
import {
  NOTES,
  NOTE_COLORS,
  getFrequency,
  getNoteIndex,
  getScaleChords,
  getScaleNotes,
  getTransposedRoot,
  musicalKeyToScale,
  resolveScaleType,
  SCALE_TYPES,
  type ScaleChord,
} from '@/lib/musicTheory'
import { getModeProgression, getProgressionsForMode } from '@/lib/progressions'
import { camelotToOpenKey } from '@/lib/camelot'
import { CAMELOT_TO_KEY, KEY_TO_CAMELOT } from '@/types/track'
import { shortKey } from '@/lib/format'
import { readWheelMode, writeWheelMode, type WheelMode } from '@/lib/wheelMode'
import { camelotColor } from '@/lib/camelot'

const WAVES: { id: WaveType; label: string; icon: string }[] = [
  { id: 'triangle', label: 'Triangle', icon: `${import.meta.env.BASE_URL}key-tool-assets/triangle.svg` },
  { id: 'sine', label: 'Sine', icon: `${import.meta.env.BASE_URL}key-tool-assets/sine.svg` },
  { id: 'sawtooth', label: 'Saw', icon: `${import.meta.env.BASE_URL}key-tool-assets/sawtooth.svg` },
  { id: 'piano', label: 'Piano', icon: `${import.meta.env.BASE_URL}key-tool-assets/piano.svg` },
  { id: 'guitar', label: 'Guitar', icon: `${import.meta.env.BASE_URL}key-tool-assets/guitar.svg` },
]

const VIDEO_SRC = 'https://www.youtube.com/embed/6nPSKxuURyg?autoplay=1'

const MODES_DATA = {
  Major: [
    { name: 'Ionian', desc: 'Happy / friendly', icon: '☀️' },
    { name: 'Lydian', desc: 'Magical / dreamy', icon: '🌤️' },
    { name: 'Mixolydian', desc: 'Open / relaxed', icon: '😎' },
  ],
  Minor: [
    { name: 'Aeolian', desc: 'Sad / somber', icon: '🌙' },
    { name: 'Dorian', desc: 'Jazzy / curious', icon: '🎷' },
    { name: 'Phrygian', desc: 'Dark / exotic', icon: '🔥' },
    { name: 'Locrian', desc: 'Unsettled', icon: '🌀' },
  ],
} as const

const SHORTCUTS = [
  { desc: 'Tap Tempo', keys: ['Space'] },
  { desc: 'Adjust BPM', keys: ['+', '−'] },
  { desc: 'Start/Stop Scale Playback', keys: ['Enter'] },
  { desc: 'Toggle Notes/Chords', keys: ['Tab'] },
  { desc: 'Play Notes/Chords', keys: ['1–8'] },
  { desc: 'Octave Down/Up', keys: [',', '.'] },
  { desc: 'Reset to C4', keys: ['/'] },
]

const FLAT_MAP: Record<string, string> = {
  'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb',
}

function rootToCamelot(root: string, vibe: 'Major' | 'Minor'): string | null {
  const quality = vibe === 'Minor' ? 'minor' : 'major'
  const candidates = [
    `${root} ${quality}`,
    FLAT_MAP[root] ? `${FLAT_MAP[root]} ${quality}` : null,
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    if (KEY_TO_CAMELOT[c]) return KEY_TO_CAMELOT[c]
  }
  return null
}

function rootToMusicalKey(root: string, vibe: 'Major' | 'Minor'): string | null {
  const quality = vibe === 'Minor' ? 'minor' : 'major'
  const candidates = [
    `${root} ${quality}`,
    FLAT_MAP[root] ? `${FLAT_MAP[root]} ${quality}` : null,
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    if (KEY_TO_CAMELOT[c]) return c
  }
  return null
}

/** Transpose button label + color for the active wheel notation. */
function transposeDisplay(
  root: string,
  vibe: 'Major' | 'Minor',
  mode: WheelMode,
): { label: string; color: string } {
  const camelot = rootToCamelot(root, vibe)
  const musical = rootToMusicalKey(root, vibe)
  const noteColor = NOTE_COLORS[root] || NOTE_COLORS[FLAT_MAP[root] ?? ''] || '#34d399'
  if (mode === 'camelot' && camelot) {
    return { label: camelot, color: camelotColor(camelot) }
  }
  if (mode === 'openkey' && camelot) {
    return { label: camelotToOpenKey(camelot) ?? camelot, color: camelotColor(camelot) }
  }
  // Musical (default)
  const label = musical
    ? shortKey(musical)
    : vibe === 'Minor'
      ? `${root}m`
      : root
  return { label, color: noteColor }
}

/**
 * Scale run for playback. Ascending by default: do–re–mi–fa–so–la–ti–do.
 * With `descend` the run walks back down to the root as well: …–do–ti–la–…–do.
 */
function buildScalePattern(notes: string[], octaveOffset: number, descend = false) {
  if (!notes.length) return []
  const pattern: { freq: number; noteName: string }[] = []
  const baseOctave = 4 + octaveOffset
  let lastIdx = -1
  let oct = baseOctave
  const ascending = [...notes, notes[0]]
  for (let i = 0; i < ascending.length; i++) {
    const n = ascending[i]
    const idx = getNoteIndex(n)
    if (i > 0 && idx <= lastIdx) oct++
    pattern.push({ freq: getFrequency(n, oct), noteName: n })
    lastIdx = idx
  }
  // Walk back down by replaying the ascending steps in reverse (their octaves
  // are already resolved). The last step — the top note — is skipped so it is
  // not heard twice, leaving the run to end on the root again.
  if (descend) {
    for (let i = pattern.length - 2; i >= 0; i--) pattern.push({ ...pattern[i] })
  }
  return pattern
}

function chordFreqs(chord: ScaleChord, octaveOffset: number): number[] {
  const base = 4 + octaveOffset
  let last = -1
  let oct = base
  return chord.notes.map((n, i) => {
    const idx = getNoteIndex(n)
    if (i > 0 && idx < last) oct++
    last = idx
    return getFrequency(n, oct)
  })
}

/**
 * Interactive key-finding tool (ported from key-tool-online):
 * metronome, guided mode, scale finder, piano, chords, shortcuts.
 */
export function KeyTool() {
  const engineRef = useRef<AudioEngine | null>(null)
  const tapTimes = useRef<number[]>([])

  const [bpm, setBpm] = useState(120)
  const [playing, setPlaying] = useState(false)
  const [beat, setBeat] = useState(0)
  const [volume, setVolume] = useState(0.5)
  const [detune, setDetune] = useState(0)
  const [wave, setWave] = useState<WaveType>(() => {
    try {
      return (localStorage.getItem('preferredSoundType') as WaveType) || 'triangle'
    } catch {
      return 'triangle'
    }
  })
  const [wheelMode, setWheelMode] = useState<WheelMode>(readWheelMode)
  const [selected, setSelected] = useState<string | null>('8A')
  const [scaleType, setScaleType] = useState('Minor')
  const [activeNote, setActiveNote] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'notes' | 'chords'>(() => {
    try {
      return (localStorage.getItem('preferredViewMode') as 'notes' | 'chords') || 'notes'
    } catch {
      return 'notes'
    }
  })
  const [octaveOffset, setOctaveOffset] = useState(0)
  const [octaveToast, setOctaveToast] = useState<string | null>(null)
  const [showMoreTranspose, setShowMoreTranspose] = useState(false)
  const [progressionName, setProgressionName] = useState('')
  const [showVideo, setShowVideo] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [guided, setGuided] = useState(true)
  const [guidedStep, setGuidedStep] = useState(1)
  const [easyRoot, setEasyRoot] = useState<string | null>(null)
  const [easyVibe, setEasyVibe] = useState<'Major' | 'Minor' | null>(null)
  const [easyScale, setEasyScale] = useState<string | null>(null)
  const [pianoOctaves, setPianoOctaves] = useState(3)
  const [playingKeys, setPlayingKeys] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    document.title = 'Key Tool — KeyBPM'
    const engine = new AudioEngine(info => {
      setActiveNote(info.noteName ?? null)
      if (info.noteName) {
        setPlayingKeys(prev => {
          const next = new Set(prev)
          next.add(info.noteName!)
          return next
        })
        setTimeout(() => {
          setPlayingKeys(prev => {
            const next = new Set(prev)
            next.delete(info.noteName!)
            return next
          })
        }, 400)
      }
    })
    engine.onBeat = b => setBeat(b)
    engineRef.current = engine
    return () => {
      engine.stop()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    /* Two octaves match original Key Tool and keep the bar short enough for 1080p. */
    const onResize = () => setPianoOctaves(window.innerWidth < 500 ? 1 : 2)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => { engineRef.current?.setBpm(bpm) }, [bpm])
  useEffect(() => { engineRef.current?.setVolume(volume) }, [volume])
  useEffect(() => { engineRef.current?.setDetune(detune) }, [detune])
  useEffect(() => {
    engineRef.current?.setWaveType(wave)
    try { localStorage.setItem('preferredSoundType', wave) } catch { /* */ }
  }, [wave])
  useEffect(() => {
    try { localStorage.setItem('preferredViewMode', viewMode) } catch { /* */ }
  }, [viewMode])

  const keyName = selected ? CAMELOT_TO_KEY[selected] : null
  const scaleRoot = keyName ? musicalKeyToScale(keyName) : null

  useEffect(() => {
    if (!scaleRoot) return
    if (scaleType === 'Major' || scaleType === 'Minor') {
      setScaleType(scaleRoot.scaleType)
    }
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  const scaleNotes = useMemo(() => {
    if (!scaleRoot) return []
    return getScaleNotes(scaleRoot.root, scaleType)
  }, [scaleRoot, scaleType])

  const scaleChords = useMemo(() => {
    if (!scaleRoot) return []
    return getScaleChords(scaleRoot.root, scaleType)
  }, [scaleRoot, scaleType])

  const progressions = useMemo(
    () => (scaleRoot ? getProgressionsForMode(scaleType) : []),
    [scaleRoot, scaleType],
  )

  const progressionChords = useMemo(() => {
    if (!scaleRoot || !progressionName) return []
    return getModeProgression(scaleRoot.root, scaleType, progressionName)
  }, [scaleRoot, scaleType, progressionName])

  const displayCode =
    selected && wheelMode === 'openkey'
      ? camelotToOpenKey(selected)
      : selected && wheelMode === 'musical'
        ? shortKey(keyName ?? '')
        : selected

  const transposeRange = showMoreTranspose
    ? [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]
    : [-2, -1, 0, 1, 2]

  function showOctaveNotification(kind: 'up' | 'down' | 'reset') {
    const msg = kind === 'up' ? 'Octave +1' : kind === 'down' ? 'Octave −1' : 'Octave reset'
    setOctaveToast(msg)
    setTimeout(() => setOctaveToast(null), 900)
  }

  async function toggleMetronome() {
    const engine = engineRef.current
    if (!engine) return
    await engine.resume()
    if (engine.playing) {
      engine.stop()
      setPlaying(false)
      setBeat(0)
    } else {
      engine.setBpm(bpm)
      engine.start()
      setPlaying(true)
    }
  }

  function onTap() {
    const now = performance.now()
    tapTimes.current.push(now)
    if (tapTimes.current.length > 8) tapTimes.current.shift()
    if (tapTimes.current.length < 2) return
    const intervals: number[] = []
    for (let i = 1; i < tapTimes.current.length; i++) {
      intervals.push(tapTimes.current[i] - tapTimes.current[i - 1])
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const next = Math.round(60000 / avg)
    if (next >= 40 && next <= 255) setBpm(next)
  }

  async function playScale(sync = true) {
    const engine = engineRef.current
    if (!engine || !scaleNotes.length) return
    await engine.resume()
    if (engine.playingScale) {
      engine.stopScale()
      return
    }
    engine.playScale(buildScalePattern(scaleNotes, octaveOffset), sync && engine.playing)
    if (!engine.playing) setPlaying(true)
  }

  function transpose(semitones: number) {
    if (!scaleRoot) return
    const newRoot = getTransposedRoot(scaleRoot.root, semitones)
    const quality = scaleRoot.scaleType === 'Minor' ? 'minor' : 'major'
    const candidates = [
      `${newRoot} ${quality}`,
      FLAT_MAP[newRoot] ? `${FLAT_MAP[newRoot]} ${quality}` : null,
    ].filter(Boolean) as string[]
    for (const c of candidates) {
      const code = KEY_TO_CAMELOT[c]
      if (code) {
        setSelected(code)
        return
      }
    }
  }

  function onModeChange(mode: WheelMode) {
    writeWheelMode(mode)
    setWheelMode(mode)
  }

  function playNoteClick(note: string) {
    const engine = engineRef.current
    if (!engine) return
    void engine.resume()
    engine.playNow(getFrequency(note, 4 + octaveOffset))
    setActiveNote(note)
  }

  function playChordClick(chord: ScaleChord) {
    const engine = engineRef.current
    if (!engine) return
    void engine.resume()
    engine.playNow(chordFreqs(chord, octaveOffset))
    setActiveNote(chord.root)
  }

  function playPianoKey(note: string, octave: number) {
    const engine = engineRef.current
    if (!engine) return
    void engine.resume()
    engine.playNow(getFrequency(note, octave), 0.6)
    const id = `${note}${octave}`
    setPlayingKeys(prev => new Set(prev).add(id))
    setTimeout(() => {
      setPlayingKeys(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 200)
  }

  /* ── Guided Mode ── */
  function startGuided() {
    setGuided(true)
    setGuidedStep(1)
    setEasyRoot(null)
    setEasyVibe(null)
    setEasyScale(null)
    engineRef.current?.stopDrone()
    engineRef.current?.stopScale()
  }

  function exitGuided(keepEngine = false) {
    setGuided(false)
    setGuidedStep(1)
    setEasyRoot(null)
    setEasyVibe(null)
    setEasyScale(null)
    const engine = engineRef.current
    if (!engine) return
    engine.stopScale()
    engine.stopDrone()
    if (!keepEngine && engine.playing) {
      engine.stop()
      setPlaying(false)
      setBeat(0)
    }
  }

  function selectEasyRoot(note: string) {
    const engine = engineRef.current
    if (!engine) return
    void engine.resume()
    if (easyRoot === note) {
      setEasyRoot(null)
      engine.stopDrone()
      setGuidedStep(1)
      setEasyVibe(null)
      setEasyScale(null)
      return
    }
    setEasyRoot(note)
    setEasyVibe(null)
    setEasyScale(null)
    if (guidedStep > 1) setGuidedStep(1)
    engine.playDrone(getFrequency(note, 3))
  }

  function selectVibe(type: 'Major' | 'Minor') {
    if (!easyRoot) return
    const engine = engineRef.current
    if (!engine) return
    setEasyVibe(type)
    setEasyScale(null)
    engine.stopDrone()
    const scaleName = type === 'Major' ? 'Pentatonic Major' : 'Pentatonic Minor'
    const notes = getScaleNotes(easyRoot, scaleName)
    // Step 2 plays the run up and back down, so both directions are audible
    // when judging whether the song sits major or minor.
    engine.playPattern(buildScalePattern(notes, octaveOffset, true), bpm, engine.playing)
    if (!engine.playing) setPlaying(true)
  }

  function selectModeCard(modeName: string) {
    if (!easyRoot) return
    const engine = engineRef.current
    if (!engine) return
    setEasyScale(modeName)
    const playAs = resolveScaleType(modeName)
    const notes = getScaleNotes(easyRoot, playAs)
    engine.playScale(buildScalePattern(notes, octaveOffset), engine.playing)
    if (!engine.playing) setPlaying(true)
  }

  function lockGuided() {
    if (!easyRoot || !easyScale || !easyVibe) return
    const resolved = resolveScaleType(easyScale)
    setScaleType(resolved)
    const camelot = rootToCamelot(easyRoot, easyVibe)
    if (camelot) setSelected(camelot)
    const keep = !!engineRef.current?.playing
    exitGuided(keep)
    setTimeout(() => {
      void playScale(true)
    }, 400)
  }

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable
      if (showVideo || showShortcuts) {
        if (e.key === 'Escape') {
          setShowVideo(false)
          setShowShortcuts(false)
        }
        return
      }

      if (e.code === 'Space' && !typing) {
        e.preventDefault()
        onTap()
        return
      }

      if (e.key === 'Enter' && !typing) {
        e.preventDefault()
        void playScale(true)
        return
      }

      if (e.key === 'Tab' && !typing) {
        e.preventDefault()
        if (scaleNotes.length) {
          setViewMode(v => (v === 'notes' ? 'chords' : 'notes'))
        }
        return
      }

      if (['+', '=', 'NumpadAdd'].includes(e.key) && !typing) {
        setBpm(v => Math.min(255, Math.round((v + 0.1) * 10) / 10))
        return
      }
      if (['-', '_', 'NumpadSubtract'].includes(e.key) && !typing) {
        setBpm(v => Math.max(40, Math.round((v - 0.1) * 10) / 10))
        return
      }

      if (!e.repeat && !typing) {
        const num = parseInt(e.key, 10)
        if (num >= 1 && num <= 8) {
          const idx = num - 1
          if (viewMode === 'chords' && scaleChords[idx]) playChordClick(scaleChords[idx])
          else if (scaleNotes[idx]) playNoteClick(scaleNotes[idx])
        }
      }

      if (e.key === '.' && !typing) {
        e.preventDefault()
        setOctaveOffset(o => {
          if (o >= 2) return o
          showOctaveNotification('up')
          return o + 1
        })
      }
      if (e.key === ',' && !typing) {
        e.preventDefault()
        setOctaveOffset(o => {
          if (o <= -2) return o
          showOctaveNotification('down')
          return o - 1
        })
      }
      if (e.key === '/' && !typing) {
        e.preventDefault()
        setOctaveOffset(0)
        showOctaveNotification('reset')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const pianoStart = 3
  const pianoKeys: { note: string; octave: number; black: boolean }[] = []
  for (let o = 0; o < pianoOctaves; o++) {
    for (const note of NOTES) {
      pianoKeys.push({ note, octave: pianoStart + o, black: note.includes('#') })
    }
  }
  pianoKeys.push({ note: 'C', octave: pianoStart + pianoOctaves, black: false })

  function renderKeys(
    keys: { note: string; octave?: number; black: boolean }[],
    opts: {
      drone?: boolean
      scaleHighlight?: string[]
      activeNote?: string | null
      onKey: (note: string, octave: number) => void
    },
  ) {
    return (
      <div className={`kt-piano ${opts.drone ? 'kt-drone' : ''}`}>
        <div className="kt-piano-inner">
          {keys.map(k => {
            const octave = k.octave ?? 4
            const id = `${k.note}${octave}`
            const inScale = opts.scaleHighlight?.includes(k.note) ?? false
            const lit =
              playingKeys.has(id) ||
              playingKeys.has(k.note) ||
              opts.activeNote === k.note
            const color = NOTE_COLORS[k.note] || '#34d399'
            return (
              <button
                key={id + (opts.drone ? '-d' : '')}
                type="button"
                className={`kt-key ${k.black ? 'black' : ''} ${inScale ? 'in-scale' : ''} ${lit ? 'playing' : ''}`}
                style={{ ['--note-color' as string]: color }}
                onMouseDown={() => opts.onKey(k.note, octave)}
              >
                {k.note === 'C' && !opts.drone ? `${k.note}${octave}` : k.note}
                {inScale && <span className="kt-key-dot" />}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="kt-page relative">
      {octaveToast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-line bg-bg-card px-4 py-2 text-sm shadow-lg">
          {octaveToast}
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">Key Tool</h1>
        <p className="text-xs text-text-muted">
          Metronome, scales and a playable keyboard — match the notes until you find the key.
        </p>
      </div>

      <div className="kt-tools">
        {/* 1. Instructions */}
        <section className="surface kt-card kt-card-side p-4 lg:pt-3">
          <h2 className="kt-header-row mb-3.5 text-sm font-semibold">Instructions</h2>
          <ol className="list-decimal space-y-3 pl-4 text-xs text-text-muted">
            <li>Play a track from any source</li>
            <li>Play metronome and set BPM based on track</li>
            <li>
              Select a key and Play it. Switch scale type if needed
              <span className="mt-1.5 block font-medium text-text">
                When all notes sound right, you have found the key!
              </span>
            </li>
          </ol>
          <div className="my-4 border-t border-line" />
          <div className="flex flex-col gap-3">
            <button type="button" className="inline-flex items-center gap-2 text-xs text-accent hover:underline" onClick={() => setShowVideo(true)}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
              </svg>
              Video demo
            </button>
            <button type="button" className="inline-flex items-center gap-2 text-xs text-accent hover:underline" onClick={() => setShowShortcuts(true)}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
              </svg>
              Keyboard shortcuts
            </button>
            <label className="mt-1 flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Guided Mode</span>
              <button
                type="button"
                role="switch"
                aria-checked={guided}
                className={`relative h-5 w-9 rounded-full transition-colors ${guided ? 'bg-accent-solid' : 'bg-line'}`}
                onClick={() => (guided ? exitGuided() : startGuided())}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-text transition-transform ${
                    guided ? 'translate-x-4' : ''
                  }`}
                />
              </button>
            </label>
          </div>
        </section>

        {/* 2. Metronome */}
        <section className="surface kt-card kt-card-side p-4 lg:pt-3">
          <h2 className="kt-header-row mb-3.5 text-sm font-semibold">Metronome</h2>
          <div className="flex items-baseline gap-2">
            <input
              type="number"
              min={40}
              max={255}
              step={0.1}
              value={bpm}
              onChange={e => setBpm(Math.min(255, Math.max(40, Number(e.target.value) || 120)))}
              className="input w-[4.5rem] font-mono text-lg tabular-nums"
            />
            <span className="text-xs text-text-muted">BPM</span>
          </div>
          <input
            type="range"
            min={40}
            max={255}
            value={Math.round(bpm)}
            onChange={e => setBpm(Number(e.target.value))}
            className="mt-3.5 w-full accent-[rgb(var(--accent))]"
            aria-label="BPM slider"
          />
          <div className="mt-4 flex justify-center gap-2">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition-colors ${
                  playing && beat === i ? 'bg-accent' : 'bg-line'
                }`}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-bg-hover text-text hover:border-accent"
              aria-label={playing ? 'Stop metronome' : 'Start metronome'}
              onClick={() => void toggleMetronome()}
            >
              {playing ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              )}
            </button>
            <button type="button" className="btn-ghost h-9 px-3 text-[11px] font-semibold uppercase" onClick={onTap}>
              Tap tempo
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-text-dim">Spacebar = tap tempo</p>
          <div className="my-4 border-t border-line" />
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-text-muted" aria-hidden>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={e => setVolume(Number(e.target.value))} className="w-full accent-[rgb(var(--accent))]" aria-label="Volume" />
          </div>
          <div className="mt-4 flex justify-center">
            <RotaryKnob
              value={detune}
              onChange={setDetune}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              label="Detune"
              unit="cents"
              size={50}
            />
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {WAVES.map(w => (
              <button
                key={w.id}
                type="button"
                title={w.label}
                aria-label={w.label}
                aria-pressed={wave === w.id}
                className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
                  wave === w.id
                    ? 'border-accent bg-accent/15'
                    : 'border-line hover:border-line-hover'
                }`}
                onClick={() => setWave(w.id)}
              >
                <span
                  className="block h-5 w-5"
                  style={{
                    backgroundColor: wave === w.id
                      ? 'rgb(var(--accent))'
                      : 'rgb(var(--text-muted))',
                    WebkitMaskImage: `url(${w.icon})`,
                    maskImage: `url(${w.icon})`,
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    maskPosition: 'center',
                    WebkitMaskSize: 'contain',
                    maskSize: 'contain',
                  }}
                />
              </button>
            ))}
          </div>
        </section>

        {guided ? (
          /* 3. Guided Mode (replaces Scale Finder + Transpose) */
          <section className="surface kt-card kt-card-guided space-y-4 overflow-auto p-3">
            <h2 className="kt-header-row text-sm font-semibold">Guided Mode</h2>
            <div>
              <h3 className="mb-1 text-sm font-medium">Step 1: Find the tonic</h3>
              <p className="mb-3 text-xs text-text-muted">Tap a note. Does it feel like the song comes to rest here?</p>
              {renderKeys(
                NOTES.map(note => ({ note, black: note.includes('#'), octave: 3 })),
                { drone: true, activeNote: easyRoot, onKey: note => selectEasyRoot(note) },
              )}
              <div className="mt-3 flex justify-end">
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={!easyRoot} onClick={() => setGuidedStep(2)}>
                  Next: Check vibe →
                </button>
              </div>
            </div>
            {guidedStep >= 2 && easyRoot && (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-medium">Step 2: Check the vibe</h3>
                <p className="mb-3 text-xs text-text-muted">Happy (Major) or sad (Minor)?</p>
                <div className="flex flex-wrap gap-2">
                  {(['Major', 'Minor'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      className={`px-4 py-2 text-sm ${easyVibe === type ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => selectVibe(type)}
                    >
                      {type === 'Major' ? '☀️ Happy / Bright' : '🌙 Sad / Serious'}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={!easyVibe} onClick={() => setGuidedStep(3)}>
                    Next: Play mode →
                  </button>
                </div>
              </div>
            )}
            {guidedStep >= 3 && easyVibe && (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-medium">Step 3: Play the mode</h3>
                <p className="mb-3 text-xs text-text-muted">Tap a mode to play it. Which one matches?</p>
                <div className={`grid grid-cols-2 gap-2 ${easyVibe === 'Minor' ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
                  {MODES_DATA[easyVibe].map(mode => (
                    <button
                      key={mode.name}
                      type="button"
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        easyScale === mode.name
                          ? 'border-accent bg-accent/10'
                          : 'border-line bg-bg hover:border-line-hover'
                      }`}
                      onClick={() => selectModeCard(mode.name)}
                    >
                      <div className="text-lg">{mode.icon}</div>
                      <div className="text-sm font-semibold">{mode.name}</div>
                      <div className="text-xs text-text-muted">{mode.desc}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={!easyScale} onClick={lockGuided}>
                    Found it! →
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : (
          <>
            {/* 3. Scale Finder */}
            <section className="surface kt-card kt-card-scale p-3 pb-5">
              {/* On phones the card is narrower than the title + notation switch
                  together, so the title is dropped below sm and only the switch
                  stays centered. */}
              <div className="relative mb-3 flex min-h-[2.5rem] items-center justify-center">
                <h2 className="absolute left-0 hidden text-sm font-semibold sm:block">Scale Finder</h2>
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <WheelModeSwitch mode={wheelMode} onChange={onModeChange} compact />
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-auto">
                <KeyWheel
                  selected={selected}
                  onSelect={setSelected}
                  mode={wheelMode}
                  onModeChange={onModeChange}
                  compact
                  hideModeSwitch
                  className="pt-1.5"
                />

                <div className="my-3 flex flex-wrap items-center justify-center gap-2">
                  <select
                    className="input min-w-[9rem] py-1.5 text-sm"
                    value={scaleType}
                    onChange={e => {
                      setScaleType(e.target.value)
                      setProgressionName('')
                    }}
                    aria-label="Scale type"
                  >
                    {SCALE_TYPES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-bg-hover disabled:opacity-40"
                    disabled={!scaleNotes.length}
                    aria-label="Play scale"
                    onClick={() => void playScale(true)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>
                </div>

                {scaleNotes.length > 0 && (
                  <>
                    <div className="flex rounded-xl bg-bg p-0.5 text-xs">
                      <button
                        type="button"
                        className={`rounded-lg px-3 py-1 font-semibold ${viewMode === 'notes' ? 'bg-accent-solid' : 'text-text-muted'}`}
                        onClick={() => setViewMode('notes')}
                      >
                        Notes
                      </button>
                      <button
                        type="button"
                        className={`rounded-lg px-3 py-1 font-semibold ${viewMode === 'chords' ? 'bg-accent-solid' : 'text-text-muted'}`}
                        onClick={() => setViewMode('chords')}
                      >
                        Chords
                      </button>
                    </div>

                    {viewMode === 'notes' ? (
                      <ul className="flex flex-wrap justify-center gap-1.5">
                        {scaleNotes.map((n, i) => (
                          <li key={`${n}-${i}`}>
                            <button
                              type="button"
                              className={`rounded-md border px-2.5 py-1 font-mono text-sm ${
                                activeNote === n
                                  ? 'border-accent bg-accent/20'
                                  : 'border-line bg-bg text-text-muted hover:border-line-hover'
                              }`}
                              style={activeNote === n ? { borderColor: NOTE_COLORS[n], color: NOTE_COLORS[n] } : undefined}
                              onClick={() => playNoteClick(n)}
                            >
                              {n}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="w-full max-w-[340px] space-y-2">
                        {progressions.length > 0 && (
                          <select
                            className="input w-full py-1.5 text-sm"
                            value={progressionName}
                            onChange={e => setProgressionName(e.target.value)}
                            aria-label="Progression"
                          >
                            <option value="">Select a progression</option>
                            {progressions.map(p => (
                              <option key={p.name} value={p.name}>{p.name} · {p.description}</option>
                            ))}
                          </select>
                        )}
                        <div className="grid grid-cols-4 gap-1.5">
                          {(progressionChords.length ? progressionChords : scaleChords).slice(0, 8).map((c, i) => (
                            <button
                              key={`${c.name}-${i}`}
                              type="button"
                              className="relative rounded-lg border border-line bg-bg px-1 py-1.5 text-center hover:border-line-hover"
                              onClick={() => playChordClick(c)}
                            >
                              <span className="absolute right-1 top-0 font-mono text-[9px] text-text-dim">{c.roman}</span>
                              <div className="truncate text-[11px] font-semibold">{c.root}</div>
                              <div className="text-[9px] uppercase text-text-muted">{c.quality || 'maj'}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

            </section>

            {/* 4. Key Transpose + links — links sit below, not in Scale Finder */}
            <div className="kt-transpose-col">
            <section className="surface kt-card kt-card-transpose p-3">
              <div className="kt-header-row mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Transpose</h2>
                <label className="flex items-center gap-1.5 text-[10px] text-text-dim">
                  <input
                    type="checkbox"
                    checked={showMoreTranspose}
                    onChange={e => setShowMoreTranspose(e.target.checked)}
                  />
                  More
                </label>
              </div>
              {scaleRoot ? (
                <div className="flex flex-col gap-1">
                  {transposeRange.map(n => {
                    const newRoot = getTransposedRoot(scaleRoot.root, n)
                    const { label, color } = transposeDisplay(
                      newRoot,
                      scaleRoot.scaleType,
                      wheelMode,
                    )
                    return (
                      <button
                        key={n}
                        type="button"
                        className={`flex items-center justify-between rounded-md border px-2 py-1.5 font-mono text-xs ${
                          n === 0
                            ? 'border-accent bg-accent/10'
                            : 'border-line bg-bg hover:border-line-hover'
                        }`}
                        onClick={() => n !== 0 && transpose(n)}
                        disabled={n === 0}
                      >
                        <span className="text-text-dim">{n > 0 ? `+${n}` : n}</span>
                        <span style={{ color }}>{label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-text-muted">Select a key to transpose.</p>
              )}
            </section>

            {selected && (
              <div className="flex flex-wrap justify-center gap-2 text-[11px]">
                <Link to={`/browse?camelot=${selected}`} className="text-accent hover:underline">
                  Browse {displayCode}
                </Link>
                <span className="text-text-dim">·</span>
                <Link to={`/mix/${selected}/${Math.round(bpm)}`} className="text-accent hover:underline">
                  Mix Finder
                </Link>
              </div>
            )}
            </div>
          </>
        )}
      </div>

      {/* Piano — full-width section below tools (no horizontal scroll) */}
      {!guided && scaleNotes.length > 0 && (
        <section className="surface kt-piano-full mt-2">
          {renderKeys(pianoKeys, {
            scaleHighlight: scaleNotes,
            onKey: (note, octave) => playPianoKey(note, octave),
          })}
        </section>
      )}

      {showVideo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={() => setShowVideo(false)} role="dialog" aria-modal="true" aria-label="Video demo">
          <div className="relative w-full max-w-3xl overflow-hidden rounded-lg border border-line bg-bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <button type="button" className="absolute right-2 top-2 z-10 rounded-md bg-bg/80 px-2 py-1 text-lg leading-none text-text-muted hover:text-text" onClick={() => setShowVideo(false)} aria-label="Close">×</button>
            <div className="aspect-video w-full">
              <iframe className="h-full w-full" src={VIDEO_SRC} title="Key Tool video demo" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onClick={() => setShowShortcuts(false)} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
          <div className="relative w-full max-w-md rounded-lg border border-line bg-bg-card p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <button type="button" className="absolute right-3 top-3 text-lg leading-none text-text-muted hover:text-text" onClick={() => setShowShortcuts(false)} aria-label="Close">×</button>
            <h2 className="mb-4 text-base font-semibold">Keyboard Shortcuts</h2>
            <ul className="space-y-3">
              {SHORTCUTS.map(s => (
                <li key={s.desc} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-text-muted">{s.desc}</span>
                  <span className="flex items-center gap-1">
                    {s.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="mx-1 text-text-dim">/</span>}
                        <kbd className="rounded border border-line bg-bg px-2 py-0.5 font-mono text-xs">{k}</kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
