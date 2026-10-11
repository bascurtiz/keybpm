import type { Track } from '@/types/track'

/** Same columns as scripts/export_csv.mjs, so downloads match data/tracks.csv. */
const COLUMNS: (keyof Track)[] = [
  'id', 'artist', 'title', 'bpm', 'bpmRaw', 'key', 'camelot', 'mode', 'keyRaw', 'tuning',
  'tags', 'genre', 'label', 'release', 'year', 'duration', 'source', 'confidence',
  'lastVerified', 'notes', 'youtube', 'soundcloud', 'sources', 'submittedBy',
  'submittedByDiscordId', 'lastEditedBy', 'lastEditedByDiscordId', 'verifiedAt', 'verifiedBy',
]

const esc = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v)
    // `sources` is an array of objects — serialise each so the CSV round-trips.
    ? v.map(x => (x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x))).join('|')
    : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function tracksToCsv(rows: Track[]): string {
  const lines = [COLUMNS.join(',')]
  for (const t of rows) {
    lines.push(COLUMNS.map(c => esc(t[c])).join(','))
  }
  return lines.join('\n')
}

/** Triggers a browser download of the CSV for the given rows. */
export function downloadCsv(rows: Track[], filename = 'KeyBPM-tracks.csv'): void {
  download(new Blob(['\ufeff' + tracksToCsv(rows)], { type: 'text/csv;charset=utf-8' }), filename)
}

/** Same records in the canonical data/tracks.json shape. */
export function downloadJson(rows: Track[], filename = 'KeyBPM-tracks.json'): void {
  download(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }), filename)
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
