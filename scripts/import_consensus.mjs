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
 * and link out to it.
 *
 * Those votes are read from the sources' own listings (`data/sources/*.csv`),
 * not from the export's `key_<source>` columns: an export column is the first
 * record the engine's fuzzy cluster matched for that source, which can be a
 * different song (`key_isolated_tracks = 6B` on a `Glee – Santa Baby` row is
 * Isolated Tracks' key for `Glee – Baby`) or another section of the same song.
 * Reading it as "what this source states for this track" produced provenance
 * that contradicted itself — sources shown as disagreeing when they had in fact
 * agreed. See scripts/lib/consensus_sources.mjs.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  consensusProvenance,
  mergeExportRows,
  normalizeTrack,
  readSourceIndex,
  splitList,
} from './lib/consensus_sources.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const INPUT = argv.find(a => !a.startsWith('--'))

if (!INPUT) {
  console.error('Usage: npm run data:consensus -- <path/to/keybpm_consensus_new_tracks.csv> [--dry]')
  process.exit(1)
}
const inputPath = isAbsolute(INPUT) ? INPUT : resolve(ROOT, INPUT)

// The per-source listings live next to the export in the engine's repo. They are
// read for the sources' real keys; when absent, the export's columns are used.
const sourcesFlag = argv.find(a => a.startsWith('--sources='))
const SOURCES_DIR = sourcesFlag
  ? resolve(sourcesFlag.slice('--sources='.length))
  : resolve(dirname(inputPath), '..', 'sources')
const index = existsSync(SOURCES_DIR) ? readSourceIndex(SOURCES_DIR) : { byTrack: new Map(), byUrl: new Map(), files: [], rows: 0 }
if (index.files.length) {
  console.log(`Source listings: ${index.files.length} files, ${index.rows.toLocaleString('en-US')} keyed rows from ${SOURCES_DIR}`)
} else {
  console.log(`! No source listings found in ${SOURCES_DIR} — falling back to the export's own key_<source> columns.`)
}

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
// One implementation, shared with the provenance repair script, so a row is
// matched against the dataset and against the source listings the same way.
const normalizeKey = normalizeTrack

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

// Duplicate export rows for one track (a spelling difference splits the sources
// that corroborate it) are merged, so neither tool drops half the evidence.
const exportRows = mergeExportRows(table.slice(1), row => ({
  artist: col(row, 'Artist'),
  title: col(row, 'Title'),
  camelot: col(row, 'Camelot').toUpperCase(),
  reporting: splitList(col(row, 'All_Reporting_Sources') || col(row, 'Consensus_Sources')),
  row,
}))

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
const stats = {
  duplicate: 0,
  duplicateInFile: 0,
  noArtist: 0,
  noKey: 0,
  bpmFilled: 0,
  bpmConflict: 0,
  provenanceFixed: 0,
  provenanceFixedIds: [],
}

/**
 * The row's provenance: per-source keys, the agreement sentence and confidence.
 * With no listings to read, the export's own columns are the only evidence —
 * they can name one key per source, so a source that agreed on another of its
 * keys looks like a dissenter. `scripts/rebuild_consensus_sources.mjs` exists to
 * rebuild records imported that way.
 */
function provenanceFor(norm, row, { artist, title, camelot }) {
  const entry = exportRows.get(norm)
  const reporting = entry?.reporting ?? splitList(col(row, 'All_Reporting_Sources') || col(row, 'Consensus_Sources'))
  if (index.byTrack.size > 0) {
    // `url_<source>` may sit on either of a track's duplicate export rows.
    const rows = entry?.rows ?? [row]
    const urlFor = id => {
      for (const r of rows) {
        const url = col(r, `url_${id}`)
        if (url) return url
      }
      return ''
    }
    return consensusProvenance(index, { artist, title, camelot, reporting, urlFor })
  }
  const sources = reporting.map(id => {
    const srcKeyRaw = col(row, `key_${id}`).toUpperCase()
    return { id, key: validCamelot(srcKeyRaw) ? srcKeyRaw : null, url: col(row, `url_${id}`) || null }
  })
  const agree = camelot ? sources.filter(s => s.key === camelot).length : 0
  const dissent = sources.filter(s => s.key && s.key !== camelot).length
  return {
    sources,
    agree,
    dissent,
    total: sources.length,
    notes: agree > 0
      ? `Key agreed by ${agree} of ${sources.length} reporting sources.`
        + (dissent > 0 ? ` ${dissent} disagree${dissent === 1 ? 's' : ''} with this key.` : '')
      : 'Consensus key not corroborated by the listed sources — each states another key.',
    confidence: sources.length > 0 && agree > 0 ? Math.round((agree / sources.length) * 100) / 100 : undefined,
  }
}

for (const row of rows) {
  const artist = col(row, 'Artist')
  const title = col(row, 'Title')
  if (!artist) { stats.noArtist++; continue }

  const dedupeKey = normalizeKey(artist, title)
  if (!dedupeKey) { stats.noArtist++; continue }
  if (seenInFile.has(dedupeKey)) { stats.duplicateInFile++; continue }

  const bpm = parseExportBpm(col(row, 'BPM'))
  const camelotRaw = col(row, 'Camelot').toUpperCase()
  const camelot = validCamelot(camelotRaw) ? camelotRaw : null
  const key = camelot ? CAMELOT_TO_KEY[camelot] ?? null : null
  if (!camelot) stats.noKey++

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
    // Its provenance is restated too: a row imported before the listings were
    // read carries the export's cluster-derived keys, which claimed sources
    // disagreed with keys they had stated.
    if (matched.source === SOURCE) {
      const provenance = provenanceFor(dedupeKey, row, { artist, title, camelot: matched.camelot ?? camelot })
      const next = JSON.stringify({ sources: provenance.sources, confidence: provenance.confidence ?? null, notes: provenance.notes })
      const current = JSON.stringify({
        sources: matched.sources ?? [],
        confidence: matched.confidence ?? null,
        notes: matched.notes ?? null,
      })
      if (next !== current) {
        if (provenance.sources.length) matched.sources = provenance.sources
        else delete matched.sources
        if (provenance.confidence === undefined) delete matched.confidence
        else matched.confidence = provenance.confidence
        matched.notes = provenance.notes
        stats.provenanceFixed++
        if (stats.provenanceFixedIds.length < 10) stats.provenanceFixedIds.push(matched.id)
      }
    }
    continue
  }
  seenInFile.add(dedupeKey)

  const provenance = provenanceFor(dedupeKey, row, { artist, title, camelot })

  let base = slug(`${artist} ${title}`) || `consensus-${hash(dedupeKey)}`
  if (base.length > 80) base = base.slice(0, 80).replace(/-+$/, '')
  let id = base
  let n = 2
  while (takenIds.has(id)) id = `${base}-${n++}`
  takenIds.add(id)

  const record = { id, artist, title, bpm, key, camelot, source: SOURCE }
  // Confidence = share of the sources listed for this track that state its key
  // — the honest reading of "how settled is this key" (§17).
  if (provenance.confidence !== undefined) record.confidence = provenance.confidence
  record.lastVerified = snapshotDate
  record.notes = provenance.notes
  const youtube = canonicalYoutube(col(row, 'YouTube'))
  if (youtube) record.youtube = youtube
  if (provenance.sources.length) record.sources = provenance.sources

  added.push(record)
}

const merged = [...existing, ...added]

console.log(`Read ${rows.length} rows from ${inputPath}`)
console.log(`  snapshot date:      ${snapshotDate}`)
console.log(`  already in dataset: ${stats.duplicate}`)
console.log(`  duplicate within file: ${stats.duplicateInFile}`)
console.log(`  skipped (no artist): ${stats.noArtist} · without a key: ${stats.noKey}`)
console.log(`  NEW tracks:         ${added.length}`)
console.log(`  provenance restated on existing rows: ${stats.provenanceFixed}`)
if (stats.provenanceFixed && stats.provenanceFixed <= 10) {
  console.log(`    ${stats.provenanceFixedIds.join(', ')}`)
}
console.log(`  BPM filled in:      ${stats.bpmFilled}`)
console.log(`  BPM left as-is (differs from export): ${stats.bpmConflict}`)
console.log(`  dataset:            ${existing.length} -> ${merged.length}`)

if (DRY) {
  console.log('--dry: nothing written.')
} else if (added.length === 0 && stats.bpmFilled === 0 && stats.provenanceFixed === 0) {
  console.log('Nothing to write — dataset already matches the export.')
} else {
  const out = '[\n' + merged.map(t => JSON.stringify(t)).join(',\n') + '\n]\n'
  writeFileSync(join(ROOT, 'data', 'tracks.json'), out)
  console.log('Wrote data/tracks.json — run `npm run data:csv` to refresh the CSV.')
}
