/**
 * Merges a Key Consensus Engine export into data/tracks.json + data/tracks.csv.
 *
 * Usage:
 *   npm run data:consensus -- "D:/project-consensus-keys/data/exports/keybpm_consensus_new_tracks.csv"
 *   npm run data:consensus -- --dry "path/to/export.csv"
 *
 * The export (keybpm_consensus_new_tracks.csv) is already filtered to tracks
 * that are *new* relative to the dataset it was built against — but that
 * snapshot can be stale, so this script re-checks every row against the
 * current data/tracks.json with the consensus engine's own normalisation
 * (accents, brackets and "feat." stripped, leading "The" dropped). A row whose
 * artist + title already exists is not added again; instead its missing `bpm`
 * is filled from the export, which is how tempo coverage grows as the engine's
 * BPM lookups improve. Running it twice is a no-op.
 *
 * Existing BPM values are never overwritten — a conflicting value is only
 * counted and reported, so a hand-checked tempo survives an import.
 *
 * Per-source votes are kept on each record as `sources` (see src/types/track.ts)
 * so the UI can show which key services reported the track, what each states,
 * and link out to it. The row's key is the consensus key; a source that
 * disagrees keeps its own value.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const INPUT = argv.find(a => !a.startsWith('--'))

if (!INPUT) {
  console.error('Usage: npm run data:consensus -- <path/to/keybpm_consensus_new_tracks.csv> [--dry]')
  process.exit(1)
}
const inputPath = isAbsolute(INPUT) ? INPUT : resolve(ROOT, INPUT)

/** Consensus key → canonical musical key (mirrors CAMELOT_TO_KEY in src/types/track.ts). */
const CAMELOT_TO_KEY = {
  '1A': 'G# minor', '1B': 'B major', '2A': 'D# minor', '2B': 'F# major',
  '3A': 'A# minor', '3B': 'C# major', '4A': 'F minor', '4B': 'Ab major',
  '5A': 'C minor', '5B': 'Eb major', '6A': 'G minor', '6B': 'Bb major',
  '7A': 'D minor', '7B': 'F major', '8A': 'A minor', '8B': 'C major',
  '9A': 'E minor', '9B': 'G major', '10A': 'B minor', '10B': 'D major',
  '11A': 'F# minor', '11B': 'A major', '12A': 'C# minor', '12B': 'E major',
}

const SOURCE = 'key consensus engine'

// ---- CSV parsing (RFC 4180: quoted fields, embedded commas/newlines) --------
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const s = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else { quoted = false }
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

// ---- Track normalisation (mirrors core/track_normalizer.py) -----------------
const stripAccents = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
const RE_FEAT = /\b(feat\.?|ft\.?|featuring)\b[\s\S]*/i
const RE_BRACKETS = /[([{][\s\S]*?[)\]}]/g
const RE_NON_ALPHANUM = /[^\p{L}\p{N}_\s]+/gu
const RE_WHITESPACE = /\s+/g
const RE_LEADING_THE = /^the\s+/i

const cleanArtist = artist => {
  let s = stripAccents(String(artist ?? '')).toLowerCase().trim()
  s = s.replace(RE_LEADING_THE, '')
  s = s.replace(RE_FEAT, '')
  s = s.replace(RE_NON_ALPHANUM, ' ')
  return s.replace(RE_WHITESPACE, ' ').trim()
}
const cleanTitle = title => {
  let s = stripAccents(String(title ?? '')).toLowerCase().trim()
  s = s.replace(RE_BRACKETS, ' ')
  s = s.replace(RE_FEAT, '')
  s = s.replace(RE_NON_ALPHANUM, ' ')
  return s.replace(RE_WHITESPACE, ' ').trim()
}
const normalizeKey = (artist, title) => {
  const a = cleanArtist(artist)
  const t = cleanTitle(title)
  return a && t ? `${a} ${t}` : a || t
}

// ---- ids / urls -------------------------------------------------------------
function slug(s) {
  return String(s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h.toString(36)
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/
function canonicalYoutube(input) {
  const s = String(input ?? '').trim()
  if (!s) return null
  if (YT_ID.test(s)) return `https://www.youtube.com/watch?v=${s}`
  try {
    const u = new URL(s)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      if (id && YT_ID.test(id)) return `https://www.youtube.com/watch?v=${id}`
    }
    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v && YT_ID.test(v)) return `https://www.youtube.com/watch?v=${v}`
      const [kind, id] = u.pathname.split('/').filter(Boolean)
      if (['embed', 'shorts', 'live', 'v'].includes(kind) && id && YT_ID.test(id)) {
        return `https://www.youtube.com/watch?v=${id}`
      }
    }
  } catch { /* not a URL */ }
  return null
}

const validCamelot = code => /^(1[0-2]|[1-9])[AB]$/.test(code)

/** Tempo from the export — blank in older exports, a decimal ("113.8") when found. */
function parseExportBpm(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = Number.parseFloat(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ---- Read & map -------------------------------------------------------------
const raw = readFileSync(inputPath, 'utf8')
const table = parseCsv(raw)
const header = table[0].map(h => h.trim())
const rows = table.slice(1).filter(r => r.some(c => c !== ''))
const col = (row, name) => {
  const i = header.indexOf(name)
  return i >= 0 ? (row[i] ?? '').trim() : ''
}

const snapshotDate = statSync(inputPath).mtime.toISOString().slice(0, 10)

const existing = JSON.parse(readFileSync(join(ROOT, 'data', 'tracks.json'), 'utf8'))
const takenIds = new Set(existing.map(t => t.id))
/** normalised "artist title" -> the record already in the dataset (for BPM backfill). */
const byKey = new Map()
for (const t of existing) {
  const k = normalizeKey(t.artist, t.title)
  if (k) byKey.set(k, t)
}

const added = []
const seenInFile = new Set()
const stats = { duplicate: 0, duplicateInFile: 0, noArtist: 0, noKey: 0, bpmFilled: 0, bpmConflict: 0 }

for (const row of rows) {
  const artist = col(row, 'Artist')
  const title = col(row, 'Title')
  if (!artist) { stats.noArtist++; continue }

  const dedupeKey = normalizeKey(artist, title)
  if (!dedupeKey) { stats.noArtist++; continue }
  if (seenInFile.has(dedupeKey)) { stats.duplicateInFile++; continue }

  const bpm = parseExportBpm(col(row, 'BPM'))
  const matched = byKey.get(dedupeKey)
  if (matched) {
    // Already in the dataset — keep the row, but take the tempo the engine now
    // states. An existing value always wins, so a reviewed BPM is never lost.
    stats.duplicate++
    if (bpm !== null) {
      if (matched.bpm === null || matched.bpm === undefined) {
        matched.bpm = bpm
        stats.bpmFilled++
      } else if (matched.bpm !== bpm) {
        stats.bpmConflict++
      }
    }
    continue
  }
  seenInFile.add(dedupeKey)

  const camelotRaw = col(row, 'Camelot').toUpperCase()
  const camelot = validCamelot(camelotRaw) ? camelotRaw : null
  const key = camelot ? CAMELOT_TO_KEY[camelot] ?? null : null
  if (!camelot) stats.noKey++

  // Per-source votes: the export names the reporting sources and gives each its
  // own camelot key + link. A source with no key is still listed (no stated key).
  const sourceIds = col(row, 'Consensus_Sources')
    .split(',').map(s => s.trim()).filter(Boolean)
  const seenSources = new Set()
  const sources = []
  for (const id of sourceIds) {
    if (seenSources.has(id)) continue
    seenSources.add(id)
    const srcKeyRaw = col(row, `key_${id}`).toUpperCase()
    const url = col(row, `url_${id}`)
    sources.push({
      id,
      key: validCamelot(srcKeyRaw) ? srcKeyRaw : null,
      url: url || null,
    })
  }

  // `Consensus_Sources` lists every source that stated a key (not only the ones
  // that agree with the winning key), so agreement has to be recounted here.
  const total = Number.parseInt(col(row, 'Total_Sources_Reporting'), 10) || sources.length
  const agree = camelot ? sources.filter(s => s.key === camelot).length : 0
  const dissent = sources.filter(s => s.key && s.key !== camelot).length

  let base = slug(`${artist} ${title}`) || `consensus-${hash(dedupeKey)}`
  if (base.length > 80) base = base.slice(0, 80).replace(/-+$/, '')
  let id = base
  let n = 2
  while (takenIds.has(id)) id = `${base}-${n++}`
  takenIds.add(id)

  const record = { id, artist, title, bpm, key, camelot, source: SOURCE }
  // Confidence = share of the sources that looked at the track and agree on the
  // key — the honest reading of "how settled is this key".
  if (total > 0 && agree > 0) record.confidence = Math.round((agree / total) * 100) / 100
  record.lastVerified = snapshotDate
  let notes
  if (agree > 0) {
    notes = `Key agreed by ${agree} of ${total} reporting sources.`
    if (dissent > 0) notes += ` ${dissent} disagree${dissent === 1 ? 's' : ''} with this key.`
  } else {
    // A handful of export rows list only sources that contradict the winning
    // key. Say so instead of claiming a confidence nobody reported.
    notes = `Consensus key not corroborated by the listed sources — each states another key.`
  }
  record.notes = notes
  const youtube = canonicalYoutube(col(row, 'YouTube'))
  if (youtube) record.youtube = youtube
  if (sources.length) record.sources = sources

  added.push(record)
}

const merged = [...existing, ...added]

console.log(`Read ${rows.length} rows from ${inputPath}`)
console.log(`  snapshot date:      ${snapshotDate}`)
console.log(`  already in dataset: ${stats.duplicate}`)
console.log(`  duplicate within file: ${stats.duplicateInFile}`)
console.log(`  skipped (no artist): ${stats.noArtist} · without a key: ${stats.noKey}`)
console.log(`  NEW tracks:         ${added.length}`)
console.log(`  BPM filled in:      ${stats.bpmFilled}`)
console.log(`  BPM left as-is (differs from export): ${stats.bpmConflict}`)
console.log(`  dataset:            ${existing.length} -> ${merged.length}`)

if (DRY) {
  console.log('--dry: nothing written.')
} else if (added.length === 0 && stats.bpmFilled === 0) {
  console.log('Nothing to write — dataset already matches the export.')
} else {
  const out = '[\n' + merged.map(t => JSON.stringify(t)).join(',\n') + '\n]\n'
  writeFileSync(join(ROOT, 'data', 'tracks.json'), out)
  console.log('Wrote data/tracks.json — run `npm run data:csv` to refresh the CSV.')
}
