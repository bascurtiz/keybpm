export interface Track {
  id: string
  artist: string
  title: string
  bpm: number | null
  /** Canonical major/minor key ("F# minor"); null when the track has no single key. */
  key: string | null
  camelot: string | null
  genre: string | null
  label: string | null
  release: string | null
  year: number | null
  duration: number | null
  source: string
  confidence: number | null
  lastVerified: string | null
  /** Raw/alternate BPM notation (e.g. "80/160", "~122"). Optional. */
  bpmRaw?: string
  /** Mode beyond plain major/minor ("dorian", "phrygian", "blues"…); Camelot is then approximate. */
  mode?: string
  /** Key annotation exactly as the source wrote it, e.g. "Aphr+30". */
  keyRaw?: string
  /** Optional split provenance — see AGENTS.md §4. */
  keySource?: string
  bpmSource?: string
  /** Cents sharp/flat, if known. */
  tuning?: number
  /** "instrumental" | "acapella" | "percussive" */
  tags?: string[]
  notes?: string
  /** YouTube watch URL (`https://www.youtube.com/watch?v=…`). Thumbnail is derived from the id. */
  youtube?: string
  /** SoundCloud track URL (`https://soundcloud.com/user/track`). Artwork thumbnail resolved via oEmbed. */
  soundcloud?: string
  /** Discord display name when submitted via the queue. */
  submittedBy?: string
  /** Discord snowflake of the submitter. */
  submittedByDiscordId?: string
}

// Camelot wheel mapping: number -> [minor key (A), major key (B)].
// Canonical spellings follow duuzu's sheet: the minor ring is all-sharp
// (A#m, C#m, D#m, G#m), the major ring keeps flats for Ab/Eb/Bb and
// sharps for C#/F#. KEY_TO_CAMELOT below still accepts the other spellings.
export const CAMELOT_WHEEL: Record<string, { minor: string; major: string }> = {
  '1': { minor: 'G# minor', major: 'B major' },
  '2': { minor: 'D# minor', major: 'F# major' },
  '3': { minor: 'A# minor', major: 'C# major' },
  '4': { minor: 'F minor', major: 'Ab major' },
  '5': { minor: 'C minor', major: 'Eb major' },
  '6': { minor: 'G minor', major: 'Bb major' },
  '7': { minor: 'D minor', major: 'F major' },
  '8': { minor: 'A minor', major: 'C major' },
  '9': { minor: 'E minor', major: 'G major' },
  '10': { minor: 'B minor', major: 'D major' },
  '11': { minor: 'F# minor', major: 'A major' },
  '12': { minor: 'C# minor', major: 'E major' },
}

// Musical key -> Camelot code
export const KEY_TO_CAMELOT: Record<string, string> = {
  'Ab minor': '1A', 'G# minor': '1A', 'B major': '1B',
  'Eb minor': '2A', 'D# minor': '2A', 'F# major': '2B', 'Gb major': '2B',
  'Bb minor': '3A', 'A# minor': '3A', 'Db major': '3B', 'C# major': '3B',
  'F minor': '4A', 'Ab major': '4B', 'G# major': '4B',
  'C minor': '5A', 'Eb major': '5B', 'D# major': '5B',
  'G minor': '6A', 'Bb major': '6B', 'A# major': '6B',
  'D minor': '7A', 'F major': '7B',
  'A minor': '8A', 'C major': '8B',
  'E minor': '9A', 'G major': '9B',
  'B minor': '10A', 'D major': '10B',
  'F# minor': '11A', 'A major': '11B',
  'Db minor': '12A', 'C# minor': '12A', 'E major': '12B',
}

// Camelot code -> musical key (canonical display spelling — see CAMELOT_WHEEL)
export const CAMELOT_TO_KEY: Record<string, string> = {
  '1A': 'G# minor', '1B': 'B major',
  '2A': 'D# minor', '2B': 'F# major',
  '3A': 'A# minor', '3B': 'C# major',
  '4A': 'F minor', '4B': 'Ab major',
  '5A': 'C minor', '5B': 'Eb major',
  '6A': 'G minor', '6B': 'Bb major',
  '7A': 'D minor', '7B': 'F major',
  '8A': 'A minor', '8B': 'C major',
  '9A': 'E minor', '9B': 'G major',
  '10A': 'B minor', '10B': 'D major',
  '11A': 'F# minor', '11B': 'A major',
  '12A': 'C# minor', '12B': 'E major',
}

export const ALL_CAMELOT_CODES: string[] = [
  '1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
  '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B',
]
