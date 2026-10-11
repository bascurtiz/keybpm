/**
 * Reads the Key Consensus Engine's per-source key CSVs (`data/sources/*.csv` in
 * the `project-consensus-keys` pipeline) into one lookup: for a normalised
 * track, which sources state which keys.
 *
 * Why this exists: an export row's `key_<source>` column is *not* the key that
 * source states for the track. It is the first record the engine's fuzzy cluster
 * matched for that source, and a cluster holds several near-miss songs — the
 * `Glee – Santa Baby` row carried `key_isolated_tracks = 6B` (that is Isolated
 * Tracks' key for `Glee – Baby`) while the source in fact states `3B` for Santa
 * Baby, which is why the engine counted it as agreeing. A source can also state
 * more than one key for one track — HookTheory keys each analysed section, so its
 * `Santa Baby` rows carry one key per section.
 *
 * The CSVs are the source's own listing, so they are the authority for "what
 * does this source say about this track". Everything here is read-only.
 *
 * The CSVs and data/tracks.json share one normalisation (`track_norm`, mirrored
 * from `core/track_normalizer.py`): accents, brackets and `feat.` stripped,
 * leading `The` dropped, punctuation flattened to spaces.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const splitList = value => String(value ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

/** RFC 4180 table parse (quoted fields, embedded commas and newlines). */
export function readCsvTable(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const s = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false
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

/** Columns this module needs; a CSV without them is not a source listing. */
const REQUIRED_COLUMNS = ['artist', 'title', 'key_camelot', 'source', 'track_norm']

const stripAccents = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
const RE_FEAT = /\b(feat\.?|ft\.?|featuring)\b[\s\S]*/i
const RE_BRACKETS = /[([{][\s\S]*?[)\]}]/g
const RE_NON_ALPHANUM = /[^\p{L}\p{N}_\s]+/gu
const RE_WHITESPACE = /\s+/g
const RE_LEADING_THE = /^the\s+/i

/** Mirrors `cleanArtist` in core/track_normalizer.py. */
export function cleanArtist(artist) {
  let s = stripAccents(String(artist ?? '')).toLowerCase().trim()
  s = s.replace(RE_LEADING_THE, '')
  s = s.replace(RE_FEAT, '')
  s = s.replace(RE_NON_ALPHANUM, ' ')
  return s.replace(RE_WHITESPACE, ' ').trim()
}

/** Mirrors `cleanTitle` in core/track_normalizer.py. */
export function cleanTitle(title) {
  let s = stripAccents(String(title ?? '')).toLowerCase().trim()
  s = s.replace(RE_BRACKETS, ' ')
  s = s.replace(RE_FEAT, '')
  s = s.replace(RE_NON_ALPHANUM, ' ')
  return s.replace(RE_WHITESPACE, ' ').trim()
}

/** `"Glee", "Santa Baby"` → `"glee santa baby"` — the engine's `track_norm`. */
export function normalizeTrack(artist, title) {
  const a = cleanArtist(artist)
  const t = cleanTitle(title)
  return a && t ? `${a} ${t}` : a || t
}

/**
 * One delimited line → fields, honouring quoted delimiters and doubled quotes.
 * The engine writes some exports with `;` (its data contains commas —
 * `10,000 Maniacs` — so a comma delimiter would need the field quoted).
 */
export function parseCsvLine(line, delimiter = ',') {
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === delimiter) {
      out.push(field)
      field = ''
    } else {
      field += c
    }
  }
  out.push(field)
  return out
}

/**
 * A source's statement about one track.
 *
 * `keys` keeps every key the source lists for it, in file order; `urls` is the
 * link that goes with each key, which for a section-keyed source is the anchor
 * of the section that states it. `raw` is the source's own spelling ("Db", "B♭").
 */
export function collectSourceStatement(entry) {
  return {
    keys: [...entry.keys],
    urls: { ...entry.urls },
    raws: { ...entry.raws },
  }
}

/**
 * Index every source listing in `dir`.
 *
 * `byTrack` answers "what does this source state for this track" by the engine's
 * own normalisation. `byUrl` is the exact join: the export carries the URL the
 * engine matched (`url_<source>`), and a listing row's URL identifies that one
 * row — which is what rescues the rows whose representative spelling in the
 * export differs from the listing (e.g. `the bomb these sound fall into my
 * mind` vs `the bomb these sounds fall into my mind`).
 *
 * Streaming line by line keeps memory proportional to the index rather than to
 * the ~60 MB of CSVs (musicnotes.csv alone is 23 MB). Rows without a key or a
 * track_norm are skipped — they cannot answer "what key does this source state".
 */
export function readSourceIndex(dir) {
  const byTrack = new Map()
  const byUrl = new Map()
  const byTitle = new Map()
  const files = []
  let rows = 0

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.csv')) continue
    const lines = readFileSync(join(dir, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n')
    const header = parseCsvLine(lines[0] ?? '').map(h => h.trim())
    if (!REQUIRED_COLUMNS.every(c => header.includes(c))) continue
    const at = name => header.indexOf(name)
    const iArtist = at('artist')
    const iTitle = at('title')
    const iKey = at('key_camelot')
    const iRaw = at('key_raw')
    const iUrl = at('url')
    const iSource = at('source')
    const iNorm = at('track_norm')

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line) continue
      const cell = parseCsvLine(line)
      const source = (cell[iSource] ?? '').trim()
      const norm = (cell[iNorm] ?? '').trim() || normalizeTrack(cell[iArtist], cell[iTitle])
      const key = (cell[iKey] ?? '').trim().toUpperCase()
      if (!source || !norm || !key) continue
      rows++

      let track = byTrack.get(norm)
      if (!track) {
        track = new Map()
        byTrack.set(norm, track)
      }
      let entry = track.get(source)
      if (!entry) {
        entry = { keys: [], urls: {}, raws: {} }
        track.set(source, entry)
      }
      if (!entry.keys.includes(key)) entry.keys.push(key)
      const url = (cell[iUrl] ?? '').trim() || null
      const raw = (cell[iRaw] ?? '').trim() || null
      if (!(key in entry.urls)) {
        entry.urls[key] = url
        entry.raws[key] = raw
      }
      if (url && !byUrl.has(url)) byUrl.set(url, { source, key, norm, raw })

      const titleNorm = cleanTitle(cell[iTitle] ?? '')
      if (titleNorm) {
        let bySource = byTitle.get(titleNorm)
        if (!bySource) {
          bySource = new Map()
          byTitle.set(titleNorm, bySource)
        }
        let candidates = bySource.get(source)
        if (!candidates) {
          candidates = []
          bySource.set(source, candidates)
        }
        let candidate = candidates.find(c => c.norm === norm)
        if (!candidate) {
          candidate = { norm, artistNorm: cleanArtist(cell[iArtist] ?? ''), keys: [], urls: {}, raws: {} }
          candidates.push(candidate)
        }
        if (!candidate.keys.includes(key)) candidate.keys.push(key)
        if (!(key in candidate.urls)) {
          candidate.urls[key] = url
          candidate.raws[key] = raw
        }
      }
    }
    files.push(file)
  }

  return { byTrack, byUrl, byTitle, files, rows }
}

/**
 * Words that carry no identity for a track title, dropped before comparing two
 * names: the artist connectors a listing may spell "feat."/"ft."/"f/"/"with"
 * for the same act, plus bare numbers (tempo and year annotations that land in
 * the title once brackets are stripped) and articles.
 */
const JOIN_STOPWORDS = new Set(['f', 'ft', 'feat', 'featuring', 'with', 'and', 'x', 'vs', 'the', 'a', 'an', 'of'])

function joinTokens(norm) {
  return norm.split(' ').filter(t => t && !JOIN_STOPWORDS.has(t) && !/^\d+$/.test(t))
}

/** Jaccard similarity of two normalised names, connectors and numbers ignored. */
function nameMatch(a, b) {
  const A = new Set(joinTokens(a))
  const B = new Set(joinTokens(b))
  if (!A.size || !B.size) return 0
  let shared = 0
  for (const t of A) if (B.has(t)) shared++
  return shared / (A.size + B.size - shared)
}

/**
 * How alike the names must be for the URL join to be trusted. High enough to
 * separate a spelling variant (`ed sheeran beyonce perfect duet` against
 * `ed sheeran f beyonce perfect duet clean 104 7`, which share every meaningful
 * token) from a merely similar song (`glee santa baby` against `glee baby`).
 */
const URL_JOIN_MIN_MATCH = 0.75

/** How alike the artists must be for the title join to be trusted. */
const TITLE_JOIN_MIN_ARTIST_MATCH = 0.5

/**
 * Whether a listing's artist is the same act as the export's.
 *
 * The export's representative artist is a majority vote across the cluster, so
 * it can name fewer performers than the listing does — `Rihanna` against
 * `Rihanna & Kanye West & Paul McCartney` — and a listing may spell the same act
 * with a longer name (`Glee` vs `Glee Cast`). Either way every name the export
 * has must appear in the listing's, or the artists have to overlap heavily.
 */
function artistMatches(exportArtistNorm, listingArtistNorm) {
  const mine = new Set(joinTokens(exportArtistNorm))
  const theirs = new Set(joinTokens(listingArtistNorm))
  if (!mine.size || !theirs.size) return false
  let shared = 0
  for (const t of mine) if (theirs.has(t)) shared++
  if (shared === mine.size) return true
  return shared / (mine.size + theirs.size - shared) >= TITLE_JOIN_MIN_ARTIST_MATCH
}

/**
 * What one source states about one track — or null when its listing has no row
 * for it, by name or by the URL the engine matched.
 *
 * The name join is exact on the engine's normalisation. The URL join rescues the
 * rows whose representative spelling in the export differs from the listing's
 * (`Ed Sheeran & Beyonce` vs `Ed Sheeran f/Beyonce`), but only when the two names
 * still look like the same track: the engine's fuzzy cluster also matched songs
 * that are merely similar, so a URL can point at a different track entirely
 * (`Glee – Baby One More Time`'s row on a `Glee – Santa Baby` export row would
 * otherwise become "SongGalaxy states 4A" for a track it never mentions).
 *
 * Both joins are merged, because they can disagree: for a multi-key source
 * (HookTheory's sections, MusicNotes' arrangements) the two rows can state
 * different keys, and every key either join produces is kept.
 */
export function statementForTrack(index, { artist, title, sourceId, url }) {
  const statement = { keys: [], urls: {}, raws: {} }
  const add = (key, raw, href) => {
    if (!key || statement.keys.includes(key)) return
    statement.keys.push(key)
    statement.urls[key] = href ?? null
    statement.raws[key] = raw ?? null
  }
  const merge = entry => {
    for (const key of entry.keys) add(key, entry.raws[key], entry.urls[key])
  }

  const norm = normalizeTrack(artist, title)
  const byName = index.byTrack.get(norm)?.get(sourceId)
  if (byName) merge(byName)

  const byUrl = url ? index.byUrl.get(url.trim()) : null
  if (byUrl && byUrl.source === sourceId && nameMatch(norm, byUrl.norm) >= URL_JOIN_MIN_MATCH) {
    add(byUrl.key, byUrl.raw, url)
  }

  // Last resort: the same title under a differently-spelled artist, which is how
  // MusicNotes reads (`Glee Cast – Santa Baby` for `Glee – Santa Baby`) — and its
  // rows carry no URL, so neither join above can find them. The artist has to be
  // recognisably the same act, or the source would be credited with a namesake's
  // row.
  if (statement.keys.length === 0) {
    const artistNorm = cleanArtist(artist)
    const candidates = index.byTitle?.get(cleanTitle(title))?.get(sourceId) ?? []
    let best = null
    let bestMatch = 0
    for (const candidate of candidates) {
      if (!artistMatches(artistNorm, candidate.artistNorm)) continue
      const score = nameMatch(artistNorm, candidate.artistNorm)
      if (score >= bestMatch) { bestMatch = score; best = candidate }
    }
    if (best) merge(best)
  }

  return statement.keys.length ? statement : null
}

/**
 * Collapses the export's rows by normalised track.
 *
 * An export can carry the same track twice, split by spelling — `Meghan Trainor
 * feat. John Legend – Like I'm Gonna Lose You` and `Meghan Trainor – Like I’m
 * Gonna Lose You` — with the sources that corroborate it divided between the two
 * rows, the same for `Dionne Warwick – That's What Friends Are For`. Taking the
 * last row (or the first) drops half the evidence; merging keeps every source
 * that states the key. Rows that do not state the same key are not merged — the
 * first wins, and `rows.length` + `conflict` tell the caller what happened.
 *
 * `pick` reads one export row into `{ artist, title, camelot, reporting, row }`.
 * The merged entry keeps the raw rows in `rows`, so a caller can still find the
 * per-row `url_<source>` values when a source only appears on the second row.
 */
export function mergeExportRows(rows, pick) {
  const byTrack = new Map()
  for (const raw of rows) {
    const { artist, title, camelot, reporting, row } = pick(raw)
    const norm = normalizeTrack(artist, title)
    if (!norm) continue
    const entry = byTrack.get(norm)
    if (!entry) {
      byTrack.set(norm, {
        norm,
        artist,
        title,
        camelot: camelot ?? null,
        reporting: [...reporting],
        rows: row === undefined ? [] : [row],
        conflict: false,
      })
      continue
    }
    if (row !== undefined) entry.rows.push(row)
    if (camelot && camelot === entry.camelot) {
      for (const id of reporting) if (!entry.reporting.includes(id)) entry.reporting.push(id)
    } else if (camelot && entry.camelot) {
      entry.conflict = true
    } else if (camelot) {
      entry.camelot = camelot
      for (const id of reporting) if (!entry.reporting.includes(id)) entry.reporting.push(id)
    }
  }
  return byTrack
}

/**
 * Whether a consensus row may enter the dataset at all: at least one source
 * listing or evidence record has to account for the key it claims.
 *
 * The engine accepts a key when three of its clusters' sources state it; if not
 * one of them can be named for the track — its listings do not have the track
 * under any spelling, and its evidence cannot be joined — then the row's key
 * cannot be traced to any source database, and a key with no traceable source is
 * not what this database is for. Such rows are not imported (`2Pac & Snoop Dogg
 * – 2 Of Americaz Most Wanted (Lp)`, the only one, used to sit in the dataset
 * saying so in a note; a note is not provenance).
 */
export function isAttributable(provenance) {
  return provenance.sources.length > 0
}

/**
 * The provenance block for one consensus row — the single definition of what a
 * `key consensus engine` record says about where its key came from, used both
 * when importing a row and when repairing one already in the dataset.
 *
 * A source that lists this track is credited with the key it agreed on, so a
 * source can never be shown as contradicting a key it stated. A source that
 * lists it under another key keeps that value, and a source whose listing has no
 * row for the track is left out entirely — it has said nothing about it.
 */
export function consensusProvenance(index, { artist, title, camelot, reporting, urlFor, match }) {
  // The engine's own evidence for this track, when it could be joined. A detail
  // entry states another key for the same URL/name → it is another track, and
  // the listings fall back to doing the attribution.
  const evidence = match && match.camelot === camelot ? match : null

  const sources = []
  for (const id of reporting) {
    if (sources.some(s => s.id === id)) continue
    const stated = evidence?.sources.get(id) ?? null
    const statement = statementForTrack(index, { artist, title, sourceId: id, url: urlFor?.(id) })
    if (!stated && !statement) continue
    // Evidence first: the engine counted this source, so it stated the key even
    // if the listing row it used is spelled differently than this track.
    const agrees = !!stated || (!!camelot && !!statement && statement.keys.includes(camelot))
    const key = agrees ? camelot : statement.keys[0]
    const source = { id, key, url: stated?.url ?? statement?.urls[key] ?? null }
    // A source that keys several sections/arrangements keeps every one of them.
    if (statement && statement.keys.length > 1) source.keys = statement.keys
    sources.push(source)
  }

  // A source the engine counted that the export never listed (the two runs can
  // disagree about a cluster) is still evidence, so it is added rather than lost.
  for (const [id, stated] of evidence?.sources ?? []) {
    if (sources.some(s => s.id === id)) continue
    sources.push({ id, key: camelot, url: stated.url })
  }

  const total = sources.length
  const agree = camelot ? sources.filter(s => s.key === camelot).length : 0
  const dissent = sources.filter(s => s.key && s.key !== camelot).length
  const notes = agree > 0
    ? `Key agreed by ${agree} of ${total} reporting sources.`
      + (dissent > 0 ? ` ${dissent} disagree${dissent === 1 ? 's' : ''} with this key.` : '')
    : total === 0
      // Nothing to point at: the key comes from the engine's cluster, which no
      // listing we can read accounts for. Said plainly rather than as a conflict.
      ? 'No source listing accounts for this key — taken from the consensus export.'
      : 'Consensus key not corroborated by the listed sources — each states another key.'

  return {
    sources,
    agree,
    dissent,
    total,
    notes,
    confidence: total > 0 && agree > 0 ? Math.round((agree / total) * 100) / 100 : undefined,
  }
}
