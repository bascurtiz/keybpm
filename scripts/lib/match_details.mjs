/**
 * Reads the Key Consensus Engine's match-detail export
 * (`scripts/export_match_details.py` → `data/exports/keybpm_consensus_match_details.csv`).
 *
 * One row per (consensus track, source, record) for every record that stated the
 * track's winning key — the engine's own evidence. That is the one artefact that
 * makes attribution exact:
 *
 * - The engine's `key_<source>` columns keep a single record per source (the
 *   first the cluster matched) and the source listings are joined by name, URL or
 *   title, so a source whose record is spelled unusually (`Gigi D'Agostino –
 *   lamour toujours` against `L'amour Toujours`) can look like it states nothing.
 * - Here the agreeing record is named outright, with its own URL, so a source is
 *   credited when the engine credited it — and only then.
 *
 * The file is semicolon-separated and is joined to a track by the record URL
 * (exact) or by the engine's normalised name.
 */
import { readFileSync } from 'node:fs'
import { normalizeTrack, parseCsvLine } from './consensus_sources.mjs'

const REQUIRED_COLUMNS = ['track_norm', 'camelot', 'source', 'record_key_camelot']

/**
 * @returns {{byUrl: Map<string, object>, byNorm: Map<string, object>, tracks: number, records: number}}
 */
export function readMatchDetails(path) {
  const byUrl = new Map()
  const byNorm = new Map()
  let tracks = 0
  let records = 0

  // The engine writes this one semicolon-separated (its data has commas in it).
  const DELIM = path.endsWith('.tsv') ? '\t' : ';'
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')
  const header = parseCsvLine(lines[0] ?? '', DELIM).map(h => h.trim())
  if (!REQUIRED_COLUMNS.every(c => header.includes(c))) {
    throw new Error(`${path} is not a match-detail export (columns: ${header.join(', ')})`)
  }
  const at = name => header.indexOf(name)
  const iNorm = at('track_norm')
  const iCamelot = at('camelot')
  const iSource = at('source')
  const iKey = at('record_key_camelot')
  const iRaw = at('record_raw')
  const iUrl = at('record_url')
  const iArtist = at('artist')
  const iTitle = at('title')
  const iRecArtist = at('record_artist')
  const iRecTitle = at('record_title')

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const cell = parseCsvLine(line, DELIM)
    const norm = (cell[iNorm] ?? '').trim()
    const source = (cell[iSource] ?? '').trim()
    const key = (cell[iKey] ?? '').trim().toUpperCase()
    const camelot = (cell[iCamelot] ?? '').trim().toUpperCase()
    if (!norm || !source || !key || !camelot) continue

    let entry = byNorm.get(norm)
    if (!entry) {
      tracks++
      entry = {
        norm,
        camelot,
        artist: (cell[iArtist] ?? '').trim(),
        title: (cell[iTitle] ?? '').trim(),
        sources: new Map(),
      }
      byNorm.set(norm, entry)
    }
    if (!entry.sources.has(source)) {
      records++
      entry.sources.set(source, {
        url: (cell[iUrl] ?? '').trim() || null,
        raw: (cell[iRaw] ?? '').trim() || null,
        artist: (cell[iRecArtist] ?? '').trim(),
        title: (cell[iRecTitle] ?? '').trim(),
      })
    }
    if (entry.sources.get(source).url && !byUrl.has(entry.sources.get(source).url)) {
      byUrl.set(entry.sources.get(source).url, entry)
    }
  }

  return { byUrl, byNorm, tracks, records }
}

/**
 * The engine's evidence entry for a track: by the record URL it matched for any
 * of the sources (exact), else by the engine's normalised name.
 *
 * A row can carry a URL for a source whose record the detail file does not list
 * (the cluster matched a sibling row), so a URL hit is checked against the track:
 * a detail entry from another song would otherwise be adopted wholesale.
 */
export function findMatchDetails(details, { artist, title, urls = [] }) {
  for (const url of urls) {
    if (!url) continue
    const entry = details.byUrl.get(url.trim())
    if (entry) return entry
  }
  const norm = normalizeTrack(artist, title)
  return details.byNorm.get(norm) ?? null
}
