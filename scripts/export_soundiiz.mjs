/**
 * Export unique artist/title rows for Soundiiz playlist import
 * (https://soundiiz.com → Playlists → Import Playlist).
 *
 * Usage: npm run data:soundiiz
 *
 * Writes data/soundiiz/:
 *   all.txt / all.csv     — full list (under Soundiiz's 2 MB file cap)
 *   part-NN.txt / .csv    — ~2000-row chunks if a single import times out
 *
 * TXT is Soundiiz "From Plain Text": one `Artist - Title` per line.
 * CSV is "From File": header row `title,artist` (safer when titles contain " - ").
 *
 * Untitled tracks are skipped. Duplicate artist+title pairs (same song listed
 * under more than one key) are exported once so Soundiiz looks up one video.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'data', 'soundiiz')
const PART = 2000

const tracks = JSON.parse(readFileSync(join(ROOT, 'data', 'tracks.json'), 'utf8'))

const seen = new Set()
const rows = []
let skippedNoTitle = 0

for (const t of tracks) {
  const artist = typeof t.artist === 'string' ? t.artist.trim() : ''
  const title = typeof t.title === 'string' ? t.title.trim() : ''
  if (!artist) continue
  if (!title) {
    skippedNoTitle++
    continue
  }
  const key = `${artist}\0${title}`
  if (seen.has(key)) continue
  seen.add(key)
  rows.push({ artist, title })
}

const esc = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const txtLine = ({ artist, title }) => `${artist} - ${title}`
const csvBody = (chunk) => ['title,artist', ...chunk.map(r => `${esc(r.title)},${esc(r.artist)}`)].join('\n') + '\n'

mkdirSync(OUT, { recursive: true })
for (const name of readdirSync(OUT)) {
  if (/^(all\.(txt|csv)|part-\d+\.(txt|csv))$/.test(name)) rmSync(join(OUT, name))
}

writeFileSync(join(OUT, 'all.txt'), rows.map(txtLine).join('\n') + '\n')
writeFileSync(join(OUT, 'all.csv'), csvBody(rows))

const parts = Math.ceil(rows.length / PART)
for (let i = 0; i < parts; i++) {
  const chunk = rows.slice(i * PART, (i + 1) * PART)
  const n = String(i + 1).padStart(2, '0')
  writeFileSync(join(OUT, `part-${n}.txt`), chunk.map(txtLine).join('\n') + '\n')
  writeFileSync(join(OUT, `part-${n}.csv`), csvBody(chunk))
}

const kb = (name) => Math.round(readFileSync(join(OUT, name)).byteLength / 1024)
console.log(`Wrote ${rows.length} unique artist – title rows -> data/soundiiz/`)
console.log(`  all.txt ${kb('all.txt')} KB · all.csv ${kb('all.csv')} KB · ${parts} parts of ≤${PART}`)
console.log(`  skipped untitled: ${skippedNoTitle} · collapsed duplicates: ${tracks.length - skippedNoTitle - rows.length}`)
