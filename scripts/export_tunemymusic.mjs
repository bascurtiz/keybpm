/**
 * Export every track that still has no YouTube link as a TuneMyMusic-importable
 * file (https://www.tunemymusic.com → transfer *from file*).
 *
 * Usage:
 *   npm run data:tunemymusic                 # 500-row parts (free-plan limit)
 *   node scripts/export_tunemymusic.mjs --part=1000
 *
 * Writes data/export-tunemymusic/:
 *   missing-youtube.csv        — all rows (header `Track name,Artist name`)
 *   missing-youtube.txt        — plain `Artist - Title` lines (paste/freetext)
 *   part-NN.csv                — ≤`--part` rows each, for the 500-track free plan
 *
 * Deliberately two columns only: TuneMyMusic matches on title + artist, and
 * omitting Album avoids a stale release name narrowing an otherwise valid hit.
 * Duplicate artist+title pairs (same song under several keys) collapse to one
 * row so a paid/free quota isn't spent on repeat lookups. Untitled tracks are
 * skipped. A track counts as "missing" when it has no `youtube` value at all.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'data', 'export-tunemymusic')

const ARGS = process.argv.slice(2)
const partArg = ARGS.find(a => a.startsWith('--part='))
const PART = Math.max(1, parseInt(partArg ? partArg.slice('--part='.length) : '500', 10) || 500)

const tracks = JSON.parse(readFileSync(join(ROOT, 'data', 'tracks.json'), 'utf8'))

const seen = new Set()
const rows = []
let missing = 0
let skippedNoTitle = 0

for (const t of tracks) {
  const artist = typeof t.artist === 'string' ? t.artist.trim() : ''
  const title = typeof t.title === 'string' ? t.title.trim() : ''
  if (t.youtube) continue
  missing++
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
const csvBody = (chunk) =>
  ['Track name,Artist name', ...chunk.map(r => `${esc(r.title)},${esc(r.artist)}`)].join('\n') + '\n'

mkdirSync(OUT, { recursive: true })
for (const name of readdirSync(OUT)) {
  if (/^(missing-youtube\.(txt|csv)|part-\d+\.csv)$/.test(name)) rmSync(join(OUT, name))
}

writeFileSync(join(OUT, 'missing-youtube.csv'), csvBody(rows))
writeFileSync(join(OUT, 'missing-youtube.txt'), rows.map(txtLine).join('\n') + '\n')

const parts = Math.ceil(rows.length / PART)
for (let i = 0; i < parts; i++) {
  const chunk = rows.slice(i * PART, (i + 1) * PART)
  const n = String(i + 1).padStart(2, '0')
  writeFileSync(join(OUT, `part-${n}.csv`), csvBody(chunk))
}

const kb = (name) => Math.round(readFileSync(join(OUT, name)).byteLength / 1024)
console.log(`Tracks with no YouTube link: ${missing}`)
console.log(`Wrote ${rows.length} unique artist – title rows -> data/export-tunemymusic/`)
console.log(`  missing-youtube.csv ${kb('missing-youtube.csv')} KB · missing-youtube.txt ${kb('missing-youtube.txt')} KB`)
console.log(`  ${parts} parts of ≤${PART} rows`)
console.log(`  skipped untitled: ${skippedNoTitle} · collapsed duplicates: ${missing - skippedNoTitle - rows.length}`)
