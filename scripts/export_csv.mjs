/**
 * Exports data/tracks.json -> data/tracks.csv (RFC 4180 quoting).
 * Usage: npm run data:csv
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const tracks = JSON.parse(readFileSync(join(ROOT, 'data', 'tracks.json'), 'utf8'))

const COLUMNS = [
  'id', 'artist', 'title', 'bpm', 'bpmRaw', 'key', 'camelot', 'mode', 'keyRaw', 'tuning',
  'tags', 'genre', 'label', 'release', 'year', 'duration', 'source', 'confidence',
  'lastVerified', 'notes', 'youtube', 'submittedBy', 'submittedByDiscordId',
]

const esc = (v) => {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.join('|') : String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

const lines = [COLUMNS.join(',')]
for (const t of tracks) {
  lines.push(COLUMNS.map((c) => esc(t[c])).join(','))
}
// BOM so Excel opens the UTF-8 file with accents intact.
writeFileSync(join(ROOT, 'data', 'tracks.csv'), '\ufeff' + lines.join('\n') + '\n')
console.log(`Wrote ${tracks.length} rows -> data/tracks.csv`)
