/**
 * Rebuilds the per-source provenance of every `key consensus engine` record in
 * data/tracks.json from the engine's own source listings.
 *
 * Usage:
 *   node scripts/rebuild_consensus_sources.mjs          # report only
 *   node scripts/rebuild_consensus_sources.mjs --apply  # rewrite data/tracks.json
 *
 * The bug this fixes: `import_consensus.mjs` read the export's `key_<source>`
 * column as "the key this source states for this track" and recomputed
 * agreement from it. That column is the first record the engine's fuzzy cluster
 * matched for the source, so it can be a *different song* — Isolated Tracks'
 * `6B` on the `Glee – Santa Baby` row is its key for `Glee – Baby` — or, for a
 * multi-key source, a different section of the same song (HookTheory). Reports
 * written from it therefore claimed sources contradict a key they had in fact
 * agreed on: 1,028 rows showed a bogus "differs" line and 5 carried a "not
 * corroborated" note for tracks the engine accepted only because three sources
 * agreed.
 *
 * See scripts/lib/consensus_sources.mjs for why the CSVs are the authority.
 * Running twice is a no-op.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  consensusProvenance,
  mergeExportRows,
  normalizeTrack,
  readCsvTable,
  readSourceIndex,
  splitList,
} from './lib/consensus_sources.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')

const CONSENSUS_DIR = (() => {
  const flag = argv.find(a => a.startsWith('--dir='))
  if (flag) return flag.slice('--dir='.length)
  const env = process.env.CONSENSUS_DIR
  if (env) return env
  return 'D:/project-consensus-keys'
})()
const consensusPath = p => (isAbsolute(p) ? p : resolve(ROOT, p))
const SOURCES_DIR = consensusPath(join(CONSENSUS_DIR, 'data', 'sources'))
const EXPORT = consensusPath(join(CONSENSUS_DIR, 'data', 'exports', 'keybpm_consensus_new_tracks.csv'))

const SOURCE = 'key consensus engine'

console.log(`Indexing source listings from ${SOURCES_DIR}`)
const index = readSourceIndex(SOURCES_DIR)
console.log(`  ${index.files.length} listings · ${index.rows.toLocaleString('en-US')} keyed rows · ${index.byTrack.size.toLocaleString('en-US')} tracks\n`)

const table = readCsvTable(readFileSync(EXPORT, 'utf8'))
const header = table[0].map(h => h.trim())
const col = (row, name) => {
  const i = header.indexOf(name)
  return i >= 0 ? (row[i] ?? '').trim() : ''
}

// One entry per track, with the sources of any duplicate rows merged in.
const exportRows = mergeExportRows(table.slice(1), row => ({
  artist: col(row, 'Artist'),
  title: col(row, 'Title'),
  camelot: col(row, 'Camelot').toUpperCase(),
  reporting: splitList(col(row, 'All_Reporting_Sources') || col(row, 'Consensus_Sources')),
  row,
}))
const merged = [...exportRows.values()]
const duplicateTracks = merged.filter(e => e.rows.length > 1).length
const conflictingTracks = merged.filter(e => e.conflict).length

/** normalised "artist title" → the provenance we want that record to carry. */
const rebuilt = new Map()
const stats = {
  rows: 0,
  noKey: 0,
  verified: 0,
  sourcesKept: 0,
  sourcesAdded: 0,
  sourcesDropped: 0,
  rowsWithDissent: 0,
  rowsUnverifiable: 0,
  multiKeySources: 0,
  agreeCounts: {},
  emptySources: [],
  lowAgreement: [],
  duplicateTracks,
  conflictingTracks,
  mergedTracks: exportRows.size,
  exportRows: table.slice(1).filter(r => col(r, 'Artist')).length,
}

for (const entry of merged) {
  const { artist, title, camelot, norm, reporting } = entry
  stats.rows++
  if (!camelot) { stats.noKey++; continue }

  // `url_<source>` may sit on either of a track's duplicate rows.
  const urlFor = id => {
    for (const row of entry.rows) {
      const url = col(row, `url_${id}`)
      if (url) return url
    }
    return ''
  }

  const { sources, agree, dissent, total, notes, confidence } = consensusProvenance(index, {
    artist,
    title,
    camelot,
    reporting,
    urlFor,
  })
  stats.sourcesKept += sources.length
  stats.multiKeySources += sources.filter(s => s.keys).length
  stats.agreeCounts[agree] = (stats.agreeCounts[agree] ?? 0) + 1

  if (agree > 0) stats.verified++
  else stats.rowsUnverifiable++
  if (dissent > 0) stats.rowsWithDissent++
  if (agree < 3) {
    const engineSaid = entry.reporting.join('/')
    const states = sources.filter(s => s.key === camelot).map(s => s.id)
    const other = sources.filter(s => s.key !== camelot).map(s => `${s.id}:${s.key}`)
    stats.lowAgreement.push(
      `${artist} – ${title} (${camelot}) — engine counted ${col(entry.rows[0], 'Source_Count')} as ${engineSaid}; `
      + `lists state it: ${states.join('/') || 'none'}; other values: ${other.join(', ') || 'none'}`,
    )
  }
  if (sources.length === 0) stats.emptySources.push(`${artist} – ${title} (${camelot})`)

  rebuilt.set(norm, { sources, confidence, notes, artist, title, camelot })
}

console.log('From the export')
console.log(`  export rows:             ${stats.exportRows.toLocaleString('en-US')}`)
console.log(`  tracks:                  ${stats.rows.toLocaleString('en-US')} (${stats.noKey} without a key)`)
console.log(`  key verifiable in a listing: ${stats.verified.toLocaleString('en-US')}`)
console.log(`  NOT verifiable:          ${stats.rowsUnverifiable.toLocaleString('en-US')}`)
console.log(`  with a dissenting source: ${stats.rowsWithDissent.toLocaleString('en-US')}`)
console.log(`  source entries:          ${stats.sourcesKept.toLocaleString('en-US')} (${stats.multiKeySources.toLocaleString('en-US')} multi-key, gaining a keys[] list)`)
console.log(`  rows listing no source at all: ${stats.emptySources.length}`)
console.log(`  tracks carried by more than one export row: ${stats.duplicateTracks} (${stats.conflictingTracks} of them stating a different key)`)
console.log(`  tracks after merging:    ${stats.mergedTracks.toLocaleString('en-US')}`)
for (const r of stats.emptySources.slice(0, 10)) console.log(`    · ${r}`)
console.log('  agreement spread (sources stating the consensus key → rows):')
for (const n of Object.keys(stats.agreeCounts).map(Number).sort((a, b) => a - b)) {
  console.log(`    ${n} → ${stats.agreeCounts[n].toLocaleString('en-US')}`)
}
if (stats.lowAgreement.length) {
  console.log(`  below the engine's own 3-source rule (${stats.lowAgreement.length}):`)
  for (const r of stats.lowAgreement.slice(0, 20)) console.log(`    · ${r}`)
}
console.log('')

const tracks = JSON.parse(readFileSync(join(ROOT, 'data', 'tracks.json'), 'utf8'))
const changed = []
const untouched = []
let sourcesRemoved = 0
let sourcesNew = 0
const exampleChanges = []

for (const track of tracks) {
  if (track.source !== SOURCE) continue
  const want = rebuilt.get(normalizeTrack(track.artist, track.title))
  if (!want) {
    untouched.push(`${track.artist} – ${track.title}`)
    continue
  }
  const before = JSON.stringify({
    sources: track.sources ?? [],
    confidence: track.confidence ?? null,
    notes: track.notes ?? null,
    hasSources: Object.hasOwn(track, 'sources'),
  })
  const after = JSON.stringify({
    sources: want.sources,
    confidence: want.confidence ?? null,
    notes: want.notes,
    hasSources: want.sources.length > 0,
  })
  if (before === after) continue

  const beforeIds = new Set((track.sources ?? []).map(s => s.id))
  sourcesRemoved += (track.sources ?? []).filter(s => !want.sources.some(n => n.id === s.id)).length
  sourcesNew += want.sources.filter(s => !beforeIds.has(s.id)).length

  if (exampleChanges.length < 3) {
    exampleChanges.push({ track, want })
  }
  changed.push({ track, want })
}

console.log(`Records in data/tracks.json (source "${SOURCE}")`)
console.log(`  changed:                 ${changed.length.toLocaleString('en-US')}`)
console.log(`  already correct:         ${(rebuilt.size - changed.length).toLocaleString('en-US')}`)
console.log(`  source entries dropped:  ${sourcesRemoved}`)
console.log(`  source entries added:    ${sourcesNew}`)
if (changed.length && changed.length <= 10) {
  console.log(`  changed ids:             ${changed.map(c => c.track.id).join(', ')}`)
}
if (untouched.length) {
  console.log(`  no export row (left alone): ${untouched.length}`)
  for (const t of untouched.slice(0, 5)) console.log(`    · ${t}`)
}
console.log('')
for (const { track, want } of exampleChanges) {
  console.log(`Before: ${track.artist} – ${track.title}`)
  console.log(`  notes:   ${track.notes ?? '(none)'}`)
  console.log(`  sources: ${(track.sources ?? []).map(s => `${s.id}:${s.key}`).join(', ') || '(none)'}`)
  console.log(`After:`)
  console.log(`  notes:   ${want.notes}`)
  console.log(`  sources: ${want.sources.map(s => `${s.id}:${s.key}${s.keys ? ` (${s.keys.join('/')})` : ''}`).join(', ') || '(none)'}`)
  console.log('')
}

if (!APPLY) {
  console.log('--dry run: nothing written. Re-run with --apply to rewrite data/tracks.json.')
} else {
  for (const { track, want } of changed) {
    // Mirrors import_consensus.mjs exactly: an empty list is removed rather than
    // written as `[]`, so both tools write byte-identical records.
    if (want.sources.length) track.sources = want.sources
    else delete track.sources
    if (want.confidence === undefined) delete track.confidence
    else track.confidence = want.confidence
    track.notes = want.notes
  }
  const out = '[\n' + tracks.map(t => JSON.stringify(t)).join(',\n') + '\n]\n'
  writeFileSync(join(ROOT, 'data', 'tracks.json'), out)
  console.log(`Wrote data/tracks.json — ${changed.length.toLocaleString('en-US')} records updated.`)
  console.log('Run `npm run data:csv` to refresh data/tracks.csv.')
}
