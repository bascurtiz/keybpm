/**
 * Builds the per-source key listings the /source/:id pages read.
 *
 * Each Key Consensus Engine source has its own CSV of what it states
 * (artist, title, key, …) in `project-consensus-keys/data/sources/`. Those
 * files are far too large to ship whole (CamelotSound alone is 35k rows), so
 * this script writes one compact, portable JSON per published source:
 *
 *   data/source-keys/<source-id>.json
 *   { "source": "camelotsound", "url": "http://www.camelotsound.com/",
 *     "generated": "2026-10-11", "rows": [["Artist","Title","6B","track-id"], …] }
 *
 * Rows are `[artist, title, camelot, trackId]`, where `trackId` is the id of
 * the matching record in data/tracks.json. Only entries the database actually
 * holds are published — a row nobody can open in the app is a dead end, and
 * KeyFinder, Harmonic Keys and FMAK v2 reach far beyond the catalogue. That id
 * is also what makes a source chip deep-linkable: the chip points at
 * `/source/<id>#<trackId>` and the page highlights that row.
 *
 * The anchor set is the dataset's own chips (§4): every track whose `sources`
 * carry this source gets a row, stating the key that chip's tooltip states. The
 * export's `key_<source>` column is not the authority for either — it is the
 * first record the engine's fuzzy cluster matched, which can be another song or
 * another section of the same one (see rebuild_consensus_sources.mjs), and the
 * evidence layer records source reports the `Consensus_Sources` column does not.
 * CamelotSound is otherwise limited to the entries that also appear in the
 * consensus export (`keybpm_consensus_new_tracks.csv`) — its 35k-row CSV is far
 * too broad to publish — which is what keeps the page a sane size.
 *
 * Usage:
 *   npm run data:source-keys
 *   npm run data:source-keys -- --dry
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anchorChips } from './lib/source_listings.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')

/** Where the consensus engine keeps its own per-source CSVs. */
const SOURCE_DIR = process.env.CONSENSUS_DIR
  ? join(process.env.CONSENSUS_DIR, 'data', 'sources')
  : 'D:/project-consensus-keys/data/sources'
/** The export that decides what the dataset actually carries (CamelotSound only). */
const EXPORT = process.env.CONSENSUS_EXPORT
  ? process.env.CONSENSUS_EXPORT
  : 'D:/project-consensus-keys/data/exports/keybpm_consensus_new_tracks.csv'

/**
 * Published sources: id → csv + the canonical page the /source/:id header links
 * to. Add a line here after importing the matching CSV and the page, the chip
 * link and the search index pick it up.
 */
const SOURCES = [
  { id: 'camelotsound', csv: 'camelotsound.csv', url: 'http://www.camelotsound.com/', onlyInExport: true },
  { id: 'keyfinder_pdf', csv: 'keyfinder_pdf.csv', url: 'https://www.ibrahimshaath.co.uk/keyfinder/KeyFinderV2Dataset.pdf' },
  { id: 'harmonickeys', csv: 'harmonickeys.csv', url: 'https://ultramaroon.net/category/harmonic-keys/' },
  { id: 'fmak_v2', csv: 'fmak_v2.csv', url: 'https://zenodo.org/records/12759100' },
]

// ---- CSV parsing (RFC 4180: quoted fields, embedded commas/newlines) --------
// CamelotSound in particular quotes titles containing commas.
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
const RE_BRACKETS = /[([{][\s\S]*?[)\]}]]/g
const RE_NON_ALPHANUM = /[^\p{L}\p{N}_\s]+/gu
const RE_WHITESPACE = /\s+/g

const cleanArtist = artist => {
  let s = stripAccents(String(artist ?? '')).toLowerCase().trim()
  s = s.replace(/^the\s+/i, '').replace(RE_FEAT, '').replace(RE_NON_ALPHANUM, ' ')
  return s.replace(RE_WHITESPACE, ' ').trim()
}
const cleanTitle = title => {
  let s = stripAccents(String(title ?? '')).toLowerCase().trim()
  s = s.replace(RE_BRACKETS, ' ').replace(RE_FEAT, '').replace(RE_NON_ALPHANUM, ' ')
  return s.replace(RE_WHITESPACE, ' ').trim()
}
const normalizeKey = (artist, title) => {
  const a = cleanArtist(artist)
  const t = cleanTitle(title)
  return a && t ? `${a} ${t}` : a || t
}
const validCamelot = code => /^(1[0-2]|[1-9])[AB]$/.test(code)

/** Reads a source CSV into [artist, title, camelot] rows, keyed by normalisation. */
function readSourceCsv(path) {
  const table = parseCsv(readFileSync(path, 'utf8'))
  const header = table[0].map(h => h.trim())
  const at = (row, name) => {
    const i = header.indexOf(name)
    return i >= 0 ? (row[i] ?? '').trim() : ''
  }
  const rows = []
  const byNorm = new Map()
  let noKey = 0
  for (const raw of table.slice(1)) {
    const artist = at(raw, 'artist')
    const title = at(raw, 'title')
    const camelot = at(raw, 'key_camelot').toUpperCase()
    if (!artist || !title) continue
    if (!validCamelot(camelot)) { noKey++; continue }
    const row = { artist, title, camelot }
    rows.push(row)
    // The engine's own track_norm plus ours: either spelling should find the row.
    for (const key of [at(raw, 'track_norm'), normalizeKey(artist, title)]) {
      if (key && !byNorm.has(key)) byNorm.set(key, row)
    }
  }
  return { rows, byNorm, noKey }
}

/** track normalisation -> dataset id, for the deep links. */
function datasetIndex() {
  const tracks = JSON.parse(readFileSync(join(ROOT, 'data', 'tracks.json'), 'utf8'))
  const byNorm = new Map()
  for (const t of tracks) {
    const key = normalizeKey(t.artist, t.title)
    if (key && !byNorm.has(key)) byNorm.set(key, t.id)
  }
  return byNorm
}

/**
 * The chips the app renders for a published source: dataset id → the Camelot
 * the chip's tooltip states.
 *
 * It is the listing's anchor set, and the key each anchor must state. A chip
 * deep-links to `/source/<id>#<track-id>` whenever the source publishes a
 * listing, so a listing missing that row lands the click on nothing: 148
 * CamelotSound chips were anchored on rows its export-only selection never
 * built. Where the row existed, the export's key disagreed with the chip on 43
 * of them.
 */
function readDatasetChips() {
  const tracks = JSON.parse(readFileSync(join(ROOT, 'data', 'tracks.json'), 'utf8'))
  const bySource = new Map()
  for (const source of SOURCES) bySource.set(source.id, new Map())
  for (const track of tracks) {
    for (const report of track.sources ?? []) {
      const map = bySource.get(report.id)
      const camelot = String(report.key ?? '').toUpperCase()
      if (!map || !validCamelot(camelot) || map.has(track.id)) continue
      map.set(track.id, { artist: track.artist, title: track.title, camelot })
    }
  }
  return bySource
}

/**
 * What the export says, per source: for every track whose `Consensus_Sources`
 * lists the source (the same column the app builds its chips from), the
 * dataset id, the track's spelling as the dataset has it, and the key that
 * source stated.
 *
 * Anchors must come from here, not from the source CSV's own spelling: the CSV
 * may title a track differently ("Beatles, The" vs "The Beatles"), and the id
 * the app links with is the *dataset's* record.
 */
function readExport(dataset) {
  const table = parseCsv(readFileSync(EXPORT, 'utf8'))
  const header = table[0].map(h => h.trim())
  const col = (row, name) => {
    const i = header.indexOf(name)
    return i >= 0 ? (row[i] ?? '').trim() : ''
  }
  /** source id -> normalised track -> { id, artist, title, camelot } */
  const bySource = new Map()
  for (const source of SOURCES) bySource.set(source.id, new Map())

  for (const row of table.slice(1)) {
    const artist = col(row, 'Artist')
    const title = col(row, 'Title')
    const key = normalizeKey(artist, title)
    if (!key) continue
    const id = dataset.get(key) ?? null
    for (const sourceId of col(row, 'Consensus_Sources').split(',').map(s => s.trim()).filter(Boolean)) {
      const map = bySource.get(sourceId)
      if (!map || map.has(key)) continue
      const camelot = col(row, `key_${sourceId}`).toUpperCase()
      map.set(key, {
        id,
        artist,
        title,
        camelot: validCamelot(camelot) ? camelot : null,
      })
    }
  }
  return { bySource, rows: table.length - 1 }
}

// ---- Build ------------------------------------------------------------------
const dataset = datasetIndex()
const datasetChips = readDatasetChips()
const exported = readExport(dataset)
const outDir = join(ROOT, 'data', 'source-keys')
if (!DRY) mkdirSync(outDir, { recursive: true })

console.log(`Export: ${EXPORT}`)
console.log(`  rows: ${exported.rows}`)
for (const source of SOURCES) {
  const map = exported.bySource.get(source.id)
  const stated = [...map.values()].filter(v => v.camelot).length
  console.log(`  ${source.id.padEnd(14)} chips in the app: ${map.size} (${stated} with a stated key)`)
}
console.log(`Dataset: ${dataset.size} normalised tracks\n`)

for (const source of SOURCES) {
  const csvPath = join(SOURCE_DIR, source.csv)
  if (!statSync(csvPath, { throwIfNoEntry: false })) {
    console.error(`! ${source.csv} not found in ${SOURCE_DIR} — skipped`)
    continue
  }

  const { rows, byNorm, noKey } = readSourceCsv(csvPath)
  const exportMap = exported.bySource.get(source.id)

  // Dataset id per CSV row: the export's mapping wins (it is the spelling the
  // app links with), the CSV's own spelling is the fallback for rows the export
  // never mentions (most of a full listing).
  const idByRow = new Map()
  const fromExport = new Set()
  for (const [key, info] of exportMap) {
    const row = byNorm.get(key)
    if (row) {
      fromExport.add(row)
      if (info.id && !idByRow.has(row)) idByRow.set(row, info.id)
    }
  }

  // Rows the export names that the source's own CSV does not have (the engine
  // recorded a stated key anyway) — CamelotSound's page is *only* these
  // export-named tracks, because its 35k-row CSV is far too broad to publish.
  // The dataset's chips are added on top of them (see chipsAdded below).
  const extras = []
  for (const [key, info] of exportMap) {
    if (!info.camelot || byNorm.has(key)) continue
    extras.push({ artist: info.artist, title: info.title, camelot: info.camelot, id: info.id })
  }

  const selected = source.onlyInExport
    ? [...fromExport].sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
    : rows

  // Only entries whose track is in this database are published: a listing row
  // that cannot be opened in the app is a dead end, and the sources' own CSVs
  // (KeyFinder, Harmonic Keys, FMAK v2) reach well beyond our catalogue.
  //
  // One row per track, too: a source can list the same track twice under two
  // different keys (Harmonic Keys does), which would repeat it on the page and
  // leave the chip's anchor ambiguous. Where that happens the key the export
  // recorded for the source wins, so the page agrees with the chip's tooltip.
  const stated = new Map()
  for (const info of exportMap.values()) if (info.id && info.camelot) stated.set(info.id, info.camelot)

  const candidates = []
  for (const row of selected) {
    const id = idByRow.get(row) ?? dataset.get(normalizeKey(row.artist, row.title)) ?? null
    if (id) candidates.push([row.artist, row.title, row.camelot, id])
  }
  for (const row of extras) {
    if (row.id) candidates.push([row.artist, row.title, row.camelot, row.id])
  }

  const byTrack = new Map()
  let duplicates = 0
  for (const row of candidates) {
    const existing = byTrack.get(row[3])
    if (!existing) {
      byTrack.set(row[3], row)
      continue
    }
    duplicates++
    const wanted = stated.get(row[3])
    if (wanted && row[2] === wanted && existing[2] !== wanted) byTrack.set(row[3], row)
  }

  // Then the app's own chips, which are what the page has to answer for.
  const chips = datasetChips.get(source.id)
  const { added: chipsAdded, reKeyed: chipsReKeyed } = anchorChips(byTrack, chips)

  const payloadRows = [...byTrack.values()]
  payloadRows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))

  const chipIds = new Set(chips.keys())
  const anchored = new Set(payloadRows.map(r => r[3]))
  const anchorsMissing = [...chipIds].filter(id => !anchored.has(id)).length

  const payload = {
    source: source.id,
    url: source.url,
    generated: statSync(csvPath).mtime.toISOString().slice(0, 10),
    rows: payloadRows,
  }
  const json = JSON.stringify(payload)
  const bytes = Buffer.byteLength(json)

  const considered = selected.length + extras.length
  const dropped = considered - payloadRows.length + chipsAdded - duplicates
  console.log(`${source.id}  (${source.csv})`)
  console.log(`  rows in csv:        ${rows.length}${noKey ? ` (${noKey} without a Camelot key)` : ''}`)
  console.log(`  considered:         ${considered}${extras.length ? ` (${selected.length} from the csv + ${extras.length} from the export)` : ''}${source.onlyInExport ? ' (only what the export lists)' : ''}`)
  console.log(`  published:          ${payloadRows.length} (all in data/tracks.json)`)
  console.log(`  dropped:            ${dropped} — no matching track in the database`)
  if (duplicates) console.log(`  collapsed:          ${duplicates} repeat${duplicates === 1 ? '' : 's'} of a track this source lists twice`)
  if (chipsAdded) console.log(`  added for a chip:   ${chipsAdded} — the app renders this source but the export did not name it`)
  if (chipsReKeyed) console.log(`  re-keyed to the chip: ${chipsReKeyed} — the export stated another key`)
  console.log(`  chips not anchored: ${anchorsMissing} of ${chipIds.size}`)
  console.log(`  size:               ${(bytes / 1024).toFixed(0)} KB`)

  if (!DRY) {
    writeFileSync(join(outDir, `${source.id}.json`), json + '\n')
    console.log(`  wrote data/source-keys/${source.id}.json`)
  }
  console.log('')
}

if (DRY) console.log('--dry: nothing written.')
