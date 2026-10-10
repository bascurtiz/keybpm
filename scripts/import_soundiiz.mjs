/**
 * Match Soundiiz YouTube exports back onto data/tracks.json.
 *
 * Usage:
 *   npm run data:youtube           # merge new matches (never overwrites)
 *   npm run data:youtube -- --reset  # clear all youtube fields, then rematch
 *   node scripts/import_soundiiz.mjs --dry
 *   node scripts/import_soundiiz.mjs --gathered --dir=data/export-soundiiz [--dry] [--debug] [--threshold=0.82]
 *
 * Reads every *.csv in data/soundiiz/export/. When a matching
 * data/soundiiz/part-NN.csv exists, matching is scoped to that part only
 * (no global fallback — leftover wrong YouTube hits must not infect other parts).
 *
 * Prefer same-row alignment (Soundiiz usually preserves order), then fuzzy
 * artist+title scoring. Remix/edit tokens must agree when present.
 *
 * --gathered handles a different workflow (Soundiiz or TuneMyMusic results):
 * the CSV rows are search results for tracks that had no YouTube link yet, so
 * there are no original part-NN rows to scope against. Each row is scored
 * against the whole catalogue — including titles that already have a link — so
 * "this lookup is for a track we already linked" reads as a duplicate instead
 * of being pushed onto a weaker sibling row. Only rows whose best match still
 * lacks a link are assigned, and existing link values are never overwritten.
 *
 * --link=soundcloud merges the same exports as SoundCloud URLs into the
 * `soundcloud` field (canonical `https://soundcloud.com/user/track`, share
 * params dropped). Useful when the lookup target is SoundCloud rather than
 * YouTube: TuneMyMusic writes the SoundCloud permalink into its `url` column
 * either way.
 *
 * --input=<files> narrows the candidates to the rows that were actually looked
 * up. The export scripts write `Artist - Title` lines, so a catalogue row is
 * "searched" when regenerating its line reproduces one in the list. Without it
 * a loose SoundCloud hit (user uploads, "slowed + reverb" edits, test files)
 * can land on any of ~19,000 rows; with it, only on the few thousand searched.
 *
 * --report=<file> writes every accepted match as TSV, lowest score first, so a
 * hand-collected batch can be eyeballed before it is trusted.
 *
 * Exact score ties are broken by how much of a row's own wording the export
 * repeats (rawOverlap), which is what keeps sibling titles apart: without it
 * "Plaza Speakers K" and "Plaza Speakers L" tokenize identically, as do
 * "New You (Headspace)" and "New You (Shella Fresh)", and the catalogue order
 * would decide which one gets someone else's video.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TRACKS = join(ROOT, 'data', 'tracks.json')
const SOUNDIZ = join(ROOT, 'data', 'soundiiz')
const ARGS = process.argv.slice(2)
const argValue = (name, fallback) => {
  const prefix = `--${name}=`
  const hit = ARGS.find(a => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : fallback
}
const EXPORT_DIR = resolve(ROOT, argValue('dir', join('data', 'soundiiz', 'export')))
const DRY = ARGS.includes('--dry')
const RESET = ARGS.includes('--reset')
const GATHERED = ARGS.includes('--gathered')
const DEBUG = ARGS.includes('--debug')
const THRESHOLD = parseFloat(argValue('threshold', '0.82'))
/** Catalogue field to fill: `youtube` (default) or `soundcloud`. */
const LINK = argValue('link', 'youtube')
const INPUT_FILES = argValue('input', '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(f => resolve(ROOT, f))
/** Optional TSV of accepted matches (lowest score first) for review. */
const REPORT = argValue('report', '')
if (LINK !== 'youtube' && LINK !== 'soundcloud') {
  console.error(`--link must be "youtube" or "soundcloud" (got "${LINK}")`)
  process.exit(1)
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'ft', 'feat', 'featuring', 'vs', 'x',
  'official', 'video', 'audio', 'lyric', 'lyrics', 'music', 'visualizer',
  'hd', 'hq', '4k', 'mv', 'version', 'full', 'stream', 'live', 'remastered',
  'remaster', 'explicit', 'radio', 'edit', 'perfect', 'english', 'eng',
  'soundtrack', 'ost',
])
const REMIX_RE = /\b(remix|bootleg|flip|vip|edit|cover|instrumental|acapella|inst|\bdub\b|club\s*mix|radio\s*mix|extended\s*mix)\b/i
// Uploads that are not the recording itself — a wrong hit even when the words line up.
const NON_SONG_RE = /\b(reaction(\s+video)?|nightcore|karaoke|type\s+beat|slowed\s*\+?\s*reverb|sped\s+up|1\s*hour\s+loop|10\s*hours?)\b/i

function parseCsv(text) {
  const rows = []
  let field = '', row = [], inQ = false
  const s = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = [] }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c !== ''))
}

function youtubeId(input) {
  if (!input) return null
  const s = String(input).trim()
  if (VIDEO_ID.test(s)) return s
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      return id && VIDEO_ID.test(id) ? id : null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = u.searchParams.get('v')
      if (v && VIDEO_ID.test(v)) return v
      const [kind, maybeId] = u.pathname.split('/').filter(Boolean)
      if ((kind === 'embed' || kind === 'shorts' || kind === 'live' || kind === 'v') && maybeId && VIDEO_ID.test(maybeId)) {
        return maybeId
      }
    }
  } catch { /* not a URL */ }
  return null
}

/** Canonical `https://soundcloud.com/user/track` (mirrors src/lib/soundcloud.ts). */
const SC_HOSTS = new Set(['soundcloud.com', 'm.soundcloud.com', 'api.soundcloud.com', 'on.soundcloud.com'])
function soundcloudUrl(input) {
  if (!input) return null
  const s = String(input).trim()
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    const host = u.hostname.replace(/^www\./, '')
    if (!SC_HOSTS.has(host)) return null
    // on.soundcloud.com/<code> is a share short-link; it is its own canonical form.
    if (host === 'on.soundcloud.com') {
      const code = u.pathname.split('/').filter(Boolean)[0]
      return code ? `https://on.soundcloud.com/${code}` : null
    }
    const segs = u.pathname.split('/').filter(Boolean)
    // Track permalinks are exactly /user/track-slug; sets/albums/profiles are not.
    if (segs.length !== 2 || segs[0] === 'sets' || segs[1] === 'sets') return null
    return `https://soundcloud.com/${segs[0]}/${segs[1]}`
  } catch {
    /* not a URL */
  }
  return null
}

/** Canonical link for one export row, for whichever platform is being merged. */
function exportLink(row, col) {
  const url = col(row, 'url')
  if (LINK === 'soundcloud') {
    // TuneMyMusic appends utm_* share params; soundcloudUrl() drops them.
    return soundcloudUrl(url)
  }
  const id = youtubeId(url) || youtubeId(col(row, 'trackid', 'track_id', 'id'))
  return id ? `https://www.youtube.com/watch?v=${id}` : null
}

function fold(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // Letters that NFKD leaves alone (no combining-mark decomposition).
    .replace(/[łŁ]/g, 'l')
    .replace(/[đĐðÐ]/g, 'd')
    .replace(/[øØ]/g, 'o')
    .replace(/[ß]/g, 'ss')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[œŒ]/g, 'oe')
    .replace(/[þÞ]/g, 'th')
    .replace(/[ıİ]/g, 'i')
    // A few catalogue rows use underscores as spaces (file-name style titles:
    // "She__Doesn_t__Mind__ (Fraxiom__Remix)"). Treat them as spaces so \b-anchored
    // checks (remix keywords, core-title brackets) see the real word boundaries.
    .replace(/_+/g, ' ')
    .replace(/[\u{1D7CE}-\u{1D7FF}]/gu, ch => {
      const code = ch.codePointAt(0)
      for (const b of [0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6]) {
        if (code >= b && code < b + 10) return String(code - b)
      }
      return ch
    })
    .replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xFF10))
    .toLowerCase()
}

function coreTitle(title) {
  // Underscores act as spaces here too, so the \b remix/mix/edit test below sees
  // "(Fraxiom__Remix)" as a remix bracket and keeps it instead of stripping it.
  return String(title).replace(/_+/g, ' ').replace(
    /\s*[\(\[](?![^)\]]*\b(?:remix|mix|edit|bootleg|flip|vip|version|cover|live|acoustic|instrumental|acapella|inst|remaster|dub)\b)[^)\]]*[\)\]]/gi,
    '',
  )
}

// Words that can make up a whole upload-noise tail (" - Official Video").
const TAIL_NOISE = new Set([
  'official', 'lyric', 'lyrics', 'audio', 'video', 'visualizer', 'visualiser',
  'music', 'clip', 'mv', 'hd', 'hq', '4k', '8k', 'full', 'original', 'explicit',
])

/** True when a " - …" tail is nothing but upload noise. */
function isNoiseTail(tail) {
  const words = tail.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  return words.length > 0 && words.length <= 6 && words.every(w => TAIL_NOISE.has(w))
}

function stripJunk(s) {
  return fold(s)
    .replace(/[\(\[][^)\]]*official[^)\]]*[\)\]]/g, ' ')
    .replace(/[\(\[][^)\]]*lyric[^)\]]*[\)\]]/g, ' ')
    .replace(/[\(\[]\s*(audio|video|visualizer|hq|hd|4k|mv|perfect|english)\s*[\)\]]/g, ' ')
    .replace(/\|\s*music history.*$/g, ' ')
    // Drop a trailing " - Official Video" / " - Audio" tail, but only when the
    // WHOLE tail is upload noise. Titles that merely start with one of those
    // words are real: "FKA twigs - Video Girl", "Tenacious D - Video Games",
    // "Justice - Audio, Video, Disco." must keep their title.
    .replace(/\s+[-–—]\s+([^-–—]*)$/, (m, tail) => (isNoiseTail(tail) ? ' ' : m))
}

/** Lower-cased words, keeping short ones (the tokenizer drops those). */
function verbatimWords(s) {
  return fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
}

function tokens(s) {
  return stripJunk(s)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w && (w.length > 1 || /\d/.test(w)))
}

function contentTokens(s) {
  return tokens(s).filter(w => !STOP.has(w))
}

function coverage(need, have) {
  if (!need.length) return 0
  const h = have instanceof Set ? have : new Set(have)
  let hit = 0
  for (const w of need) {
    if (h.has(w)) { hit++; continue }
    // Prefix fallback (plural/suffix variations) — but only for words long
    // enough to be meaningful. Otherwise "medcab" would "match" the token
    // "me", and generic fragments would inflate every score.
    for (const x of h) {
      if (w.length >= 3 && x.length >= 3 && (x.startsWith(w) || w.startsWith(x))) { hit++; break }
    }
  }
  return hit / need.length
}

function remixTags(s) {
  const f = fold(s)
  const tags = new Set()
  if (/\bremix\b/.test(f) || /\bdub\b/.test(f) || /\bclub\s*mix\b/.test(f)) tags.add('remix')
  if (/\bbootleg\b/.test(f)) tags.add('bootleg')
  if (/\b(vip|flip)\b/.test(f)) tags.add('flip')
  if (/\binstrumental\b|\binst\b/.test(f)) tags.add('instrumental')
  if (/\bacapella\b|\bacappella\b/.test(f)) tags.add('acapella')
  // Capture remixer/mixer name: "Alan Walker Remix", "Tom Novy Ibiza Dub"
  for (const m of f.matchAll(/([a-z0-9][a-z0-9 .&']{1,40}?)\s+(?:remix|dub|club\s*mix)\b/g)) {
    for (const w of contentTokens(m[1])) if (w.length > 2) tags.add(`r:${w}`)
  }
  return tags
}

/** Split YouTube's "Artist - Title (Official Video)" when artist column is empty. */
function splitHaystack(title, artist) {
  const a = (artist || '').trim()
  const t = (title || '').trim()
  if (a) return { artist: a, title: t, blob: `${a} ${t}` }
  const cut = t.search(/\s[-–—]\s/)
  if (cut > 0) {
    return {
      artist: t.slice(0, cut).trim(),
      title: t.slice(cut).replace(/^\s[-–—]\s/, '').trim(),
      blob: t,
    }
  }
  return { artist: '', title: t, blob: t }
}

// "Daft Punk ft. Pharrell, Nile Rodgers" → primary "Daft Punk". YouTube titles
// routinely drop the featured credits our rows carry, so the primary artist is
// what must line up; the full credit list is only a bonus signal.
const ARTIST_SEP = /\s+(?:ft\.?|feat\.?|featuring|with|vs\.?|x)\s+|\s*[,&]\s*/i

/** Token view of one artist/title interpretation. */
function trackView(artist, title) {
  const titleTokens = contentTokens(title)
  return {
    artist,
    title,
    origArtist: contentTokens(artist),
    primaryArtist: contentTokens(String(artist).split(ARTIST_SEP)[0]),
    origTitle: titleTokens,
    coreTokens: contentTokens(coreTitle(title)),
    remix: remixTags(title),
  }
}

// Dataset convention for game/film OSTs: the "artist" is the franchise and the
// title holds "Composer - Track" (e.g. "Cyberpunk 2077 – P.T. Adamczyk - The Heist").
// Soundiiz returns those as artist=P.T. Adamczyk, title=The Heist, so we also
// score a view built from the inner artist/title.
const INNER_TITLE = /^(.+?)\s[-–—]\s(.+)$/

/** Pre-computed token view of a catalogue entry (artist + title). */
function prepTrack(orig) {
  const views = [trackView(orig.artist, orig.title)]
  const m = String(orig.title).match(INNER_TITLE)
  if (m) views.push(trackView(m[1], m[2]))
  return {
    artist: orig.artist,
    title: orig.title,
    views,
    // Every word of the row as written, including the short ones the tokenizer
    // drops — see rawOverlap().
    verbatim: [...new Set([...verbatimWords(orig.artist), ...verbatimWords(orig.title)])],
  }
}

/**
 * How much of a row's own wording (artist + title, short tokens included)
 * appears verbatim in the export title. Only used to break exact score ties, so
 * it can never add or remove a match — it just picks the right sibling.
 *
 * Sibling titles usually tokenize to the same thing: "Plaza Speakers K" and
 * "Plaza Speakers L" both become {plaza, speakers}, and "New You (Headspace)"
 * vs "New You (Shella Fresh)" both core to {new, you}. Without this, whichever
 * sibling the catalogue lists first wins every one of those rows.
 */
function rawOverlap(prep, e) {
  if (!prep.verbatim.length) return 0
  let hit = 0
  for (const w of prep.verbatim) if (e.verbatim.has(w)) hit++
  // Jaccard, not hit/rowWords: a one-word row like "Splatoon – Plaza" would
  // otherwise score a perfect overlap against any export that says "Plaza".
  const union = new Set([...prep.verbatim, ...e.verbatim]).size
  return union ? hit / union : 0
}

/** Pre-computed token view of a Soundiiz export row. */
function prepExp(exp) {
  const hay = splitHaystack(exp.title, exp.artist)
  return {
    title: exp.title,
    artist: exp.artist,
    hayBlob: hay.blob,
    hayArtist: new Set(contentTokens(hay.artist)),
    hayTitle: new Set(contentTokens(hay.title)),
    hayBlobTokens: new Set(contentTokens(hay.blob)),
    verbatim: new Set(verbatimWords(hay.blob)),
    remix: remixTags(`${exp.title} ${exp.artist}`),
  }
}

/**
 * Pick the best catalogue row for one export row. Highest score wins; on an
 * exact tie the row whose own wording the export repeats wins (see rawOverlap).
 * `state` carries the incumbent's cached overlap across loop iterations.
 */
function pickBest(ep, candidates, state) {
  for (const [pair, prep] of candidates) {
    const s = scorePrepared(prep, ep)
    if (s < state.score) continue
    if (s > state.score) {
      state.score = s
      state.pair = pair
      state.prep = prep
      state.overlap = -1
      continue
    }
    if (!state.prep) { state.pair = pair; state.prep = prep; continue }
    if (state.overlap < 0) state.overlap = rawOverlap(state.prep, ep)
    const mine = rawOverlap(prep, ep)
    if (mine > state.overlap) { state.pair = pair; state.prep = prep; state.overlap = mine }
  }
  return state
}

function scorePair(orig, exp) {
  return scorePrepared(prepTrack(orig), prepExp(exp))
}

function scorePrepared(o, e) {
  let best = 0
  for (const v of o.views) {
    const s = viewScore(v, e)
    if (s > best) best = s
  }
  return best
}

/**
 * Score one candidate view. `meta` is optional: when passed it receives the
 * weighted score plus the guard that rejected the pair (null when it passed),
 * so a review report can say *why* a probable match was turned down instead of
 * leaving the reader with a bare zero.
 */
function viewScore(o, e, meta) {
  const origArtist = o.origArtist
  const primary = o.primaryArtist
  const titleNeed = o.coreTokens.length ? o.coreTokens : o.origTitle
  const hayArtist = e.hayArtist
  const hayTitle = e.hayTitle
  const hayBlob = e.hayBlobTokens

  const artistScore = Math.max(
    coverage(origArtist, hayArtist),
    coverage(origArtist, hayBlob) * 0.95,
    primary.length ? coverage(primary, hayArtist) : 0,
    primary.length ? coverage(primary, hayBlob) * 0.95 : 0,
  )
  const titleCov = Math.max(
    coverage(titleNeed, hayTitle),
    coverage(titleNeed, hayBlob),
  )
  const titleScore = titleCov
  const weighted = artistScore * 0.4 + titleScore * 0.6
  const record = (reject) => {
    if (meta) {
      meta.raw = weighted
      meta.reject = reject
    }
    return reject ? 0 : weighted
  }

  // Short artist names ("BICEP", "björk") still match via the full-title blob,
  // which only carries 0.95 weight — so allow that path rather than demanding
  // a perfect artist-only match. The title guards below keep this from drifting.
  if (origArtist.length <= 2 && artistScore < 0.9) return record('artist')
  if (artistScore < 0.7) return record('artist')
  if (titleNeed.length === 0) return record('title')
  if (titleNeed.length === 1 && titleCov < 0.99) return record('title')
  if (titleNeed.length >= 2 && titleCov < 0.7) return record('title')

  // Distinctive title words (≥4 chars) must appear in the export.
  const distinctive = titleNeed.filter(w => w.length >= 4)
  if (distinctive.length && coverage(distinctive, hayBlob) < 0.8) return record('title-words')

  // If our title names a remix, the export must look like that remix (not the original).
  const oRemix = o.remix
  const eRemix = e.remix
  if ([...oRemix].some(t => t.startsWith('r:')) && ![...oRemix].filter(t => t.startsWith('r:')).every(t => eRemix.has(t) || e.hayBlob.includes(t.slice(2)))) {
    // remixer token missing — reject unless overall title coverage is perfect
    if (titleCov < 0.95) return record('remixer')
  }
  if (oRemix.has('remix') && !eRemix.has('remix') && !REMIX_RE.test(e.title)) {
    if (titleCov < 0.95) return record('catalogue-remix')
  }
  // Export is a remix but original isn't → usually wrong
  if (eRemix.has('remix') && !oRemix.has('remix') && !REMIX_RE.test(o.title)) {
    return record('export-remix')
  }
  // A reaction/nightcore/karaoke upload is never the track we catalogue.
  if (NON_SONG_RE.test(e.title) && !NON_SONG_RE.test(o.title)) return record('non-song')

  return record(null)
}

/** Best scoped candidate for an export row by raw (guard-free) score. */
function looseBest(ep, pool) {
  let best = null
  for (const [pair, prep] of pool) {
    let raw = 0
    let reject = null
    for (const v of prep.views) {
      const meta = { raw: 0, reject: null }
      viewScore(v, ep, meta)
      if (meta.raw > raw) {
        raw = meta.raw
        reject = meta.reject
      }
    }
    if (!best || raw > best.raw) best = { pair, raw, reject }
  }
  return best
}

function csvMaps(rows) {
  const header = rows[0].map(h => h.trim().toLowerCase())
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  const col = (row, name, ...alts) => {
    for (const n of [name, ...alts]) if (idx[n] !== undefined) return row[idx[n]] ?? ''
    return ''
  }
  return { header, col }
}

function loadOriginalPart(file) {
  const path = join(SOUNDIZ, file)
  try {
    const rows = parseCsv(readFileSync(path, 'utf8'))
    const { col } = csvMaps(rows)
    return rows.slice(1).map(row => ({
      title: col(row, 'title', 'name', 'track', 'song').trim(),
      artist: col(row, 'artist', 'artists').trim(),
    })).filter(r => r.artist && r.title)
  } catch {
    return null
  }
}

function loadExports() {
  const files = readdirSync(EXPORT_DIR).filter(f => f.toLowerCase().endsWith('.csv')).sort()
  if (!files.length) {
    console.error(`No CSV files in ${EXPORT_DIR}`)
    process.exit(1)
  }
  const byFile = new Map()
  for (const file of files) {
    const rows = parseCsv(readFileSync(join(EXPORT_DIR, file), 'utf8'))
    const { col } = csvMaps(rows)
    const list = []
    for (const row of rows.slice(1)) {
      const link = exportLink(row, col)
      if (!link) continue
      list.push({
        file,
        title: col(row, 'title', 'name', 'track', 'song'),
        artist: col(row, 'artist', 'artists'),
        link,
      })
    }
    byFile.set(file, list)
  }
  return { files, byFile }
}

const tracks = JSON.parse(readFileSync(TRACKS, 'utf8'))
if (RESET) {
  for (const t of tracks) delete t[LINK]
  console.log(`Cleared existing ${LINK} fields (--reset)`)
}

const { files, byFile } = loadExports()

const pairIndex = new Map()
for (const t of tracks) {
  const artist = typeof t.artist === 'string' ? t.artist.trim() : ''
  const title = typeof t.title === 'string' ? t.title.trim() : ''
  if (!artist || !title) continue
  const key = `${artist}\0${title}`
  let pair = pairIndex.get(key)
  if (!pair) {
    pair = { key, artist, title, ids: [], hasLink: false, missing: 0 }
    pairIndex.set(key, pair)
  }
  pair.ids.push(t.id)
  if (t[LINK]) pair.hasLink = true
  else pair.missing++
}

// Optional scoping (--input): only rows that were actually searched may receive
// a link. The export scripts emit `Artist - Title` lines, so a catalogue row is
// "searched" when regenerating that line reproduces one in the file.
const scoped = new Set()
if (INPUT_FILES.length) {
  const listed = new Set()
  for (const file of INPUT_FILES) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (trimmed) listed.add(trimmed)
    }
  }
  for (const pair of pairIndex.values()) {
    if (listed.has(`${pair.artist} - ${pair.title}`)) scoped.add(pair.key)
  }
  console.log(`--input: ${scoped.size} of ${pairIndex.size} unique artist – title pairs were searched (${listed.size} lines listed)`)
  if (!scoped.size) {
    console.error(`No catalogue rows appear in ${INPUT_FILES.join(', ')}`)
    process.exit(1)
  }
}
const inScope = (pair) => !scoped.size || scoped.has(pair.key)

const assignments = []
const usedPair = new Set()
let unusedExp = 0
const unmatchedOrig = []
const gatheredExports = []

for (const file of files) {
  const exports = byFile.get(file)
  const origPart = loadOriginalPart(file)
  if (!origPart) {
    if (GATHERED) {
      gatheredExports.push(...exports)
      continue
    }
    console.warn(`No matching data/soundiiz/${file} — skipping ${file} (refusing global match)`)
    unusedExp += exports.length
    continue
  }

  // Resolve original rows to unique pairs still needing a URL.
  const partPairs = []
  const seen = new Set()
  for (const r of origPart) {
    const key = `${r.artist}\0${r.title}`
    if (seen.has(key)) continue
    seen.add(key)
    const pair = pairIndex.get(key)
    if (pair && inScope(pair)) partPairs.push(pair)
  }

  const usedExp = new Set()

  // 1) Prefer same-index alignment when the export score is strong enough.
  const n = Math.min(origPart.length, exports.length)
  for (let i = 0; i < n; i++) {
    const r = origPart[i]
    const pair = pairIndex.get(`${r.artist}\0${r.title}`)
    if (!pair || !inScope(pair) || pair.hasLink || usedPair.has(pair)) continue
    const exp = exports[i]
    const s = scorePair(pair, exp)
    if (s >= THRESHOLD) {
      usedPair.add(pair)
      usedExp.add(i)
      assignments.push({ pair, exp, score: s, how: 'index' })
    }
  }

  // 2) Fuzzy match remaining exports against remaining pairs in this part only.
  for (let i = 0; i < exports.length; i++) {
    if (usedExp.has(i)) continue
    const exp = exports[i]
    const state = { pair: null, prep: null, score: 0, overlap: -1 }
    pickBest(prepExp(exp), partPairs.filter(p => !p.hasLink && !usedPair.has(p)).map(p => [p, prepTrack(p)]), state)
    if (state.pair && state.score >= THRESHOLD) {
      usedPair.add(state.pair)
      usedExp.add(i)
      assignments.push({ pair: state.pair, exp, score: state.score, how: 'fuzzy' })
    }
  }

  unusedExp += exports.length - usedExp.size
  for (const pair of partPairs) {
    if (!pair.hasLink && !usedPair.has(pair)) unmatchedOrig.push(pair)
  }
}

// Gathered mode: no original rows, so fuzzy-match each export row against the
// whole catalogue. Every row is scored against ALL pairs — including ones that
// already have a link — so "this lookup is for a track we already linked" reads
// as a duplicate instead of being pushed onto a weaker sibling. Only pairs that
// still need a link are ever assigned.
if (GATHERED && gatheredExports.length) {
  const candidates = [...pairIndex.values()]
    .filter(p => !usedPair.has(p) && inScope(p))
    .map(p => [p, prepTrack(p)])

  const scored = []
  for (const exp of gatheredExports) {
    const state = pickBest(prepExp(exp), candidates, { pair: null, prep: null, score: 0, overlap: -1 })
    scored.push({ pair: state.pair, exp, score: state.score, how: 'gathered' })
  }

  if (DEBUG) {
    const buckets = [0, 0, 0, 0, 0]
    for (const s of scored) {
      const i = s.score >= 0.9 ? 4 : s.score >= 0.8 ? 3 : s.score >= 0.7 ? 2 : s.score >= 0.5 ? 1 : 0
      buckets[i]++
    }
    console.log(`  debug best-score spread: <0.5:${buckets[0]} 0.5-0.7:${buckets[1]} 0.7-0.8:${buckets[2]} 0.8-0.9:${buckets[3]} >=0.9:${buckets[4]}`)
    console.log('  near misses (0.6-0.82):')
    for (const s of scored.filter(x => x.score >= 0.6 && x.score < 0.82).sort((a, b) => b.score - a.score).slice(0, 20)) {
      console.log(`    ${s.score.toFixed(2)}  ${s.pair ? `${s.pair.artist} – ${s.pair.title}` : '(no candidate)'}  ←  ${s.exp.title}`)
    }
    console.log('  unmatched export samples (<0.5):')
    for (const s of scored.filter(x => x.score < 0.5).slice(0, 30)) console.log(`    ←  ${s.exp.title}${s.exp.artist ? `  [${s.exp.artist}]` : ''}`)
    const probe = argValue('probe')
    if (probe) {
      for (const s of scored.filter(x => x.exp.title.toLowerCase().includes(probe.toLowerCase()))) {
        const pp = s.pair ? prepTrack(s.pair) : null
        const ep = prepExp(s.exp)
        console.log(`  probe ${s.score.toFixed(2)}  ${s.pair ? `${s.pair.artist} – ${s.pair.title}` : '(none)'}  ←  ${s.exp.title}${s.exp.artist ? `  [${s.exp.artist}]` : ''}`)
        if (pp) for (const v of pp.views) console.log(`    track view: artist=${JSON.stringify(v.origArtist)} primary=${JSON.stringify(v.primaryArtist)} core=${JSON.stringify(v.coreTokens)} remix=${JSON.stringify([...v.remix])} rescore=${viewScore(v, ep).toFixed(2)}`)
        console.log(`    combined score=${scorePrepared(pp ?? { views: [] }, ep).toFixed(2)}`)
        console.log(`    export tokens: artist=${JSON.stringify([...ep.hayArtist])} title=${JSON.stringify([...ep.hayTitle])} blob=${JSON.stringify([...ep.hayBlobTokens])} remix=${JSON.stringify([...ep.remix])}`)
      }
    }
    console.log('  accepted but marginal (best-per-export):')
    for (const s of scored.filter(x => x.pair && x.score >= THRESHOLD && x.score < 0.92).sort((a, b) => a.score - b.score).slice(0, 40)) {
      console.log(`    ${s.score.toFixed(2)}  ${s.pair.artist} – ${s.pair.title}  ←  ${s.exp.title}${s.exp.artist ? `  [${s.exp.artist}]` : ''}`)
    }
  }

  // Only rows whose best match still needs a link are candidates; a row whose
  // best match is already linked is a duplicate lookup, not a sibling match.
  const bestPerExport = scored.filter(s => s.pair && s.score >= THRESHOLD && s.pair.missing > 0)

  // Greedy by descending confidence so the strongest matches win a title.
  bestPerExport.sort((a, b) => b.score - a.score)
  for (const a of bestPerExport) {
    if (usedPair.has(a.pair)) continue
    usedPair.add(a.pair)
    assignments.push(a)
  }
  unusedExp += gatheredExports.length - assignments.filter(a => a.how === 'gathered').length
}

const byId = new Map(tracks.map(t => [t.id, t]))
let updated = 0
for (const { pair, exp } of assignments) {
  for (const id of pair.ids) {
    const t = byId.get(id)
    if (!t || t[LINK]) continue
    t[LINK] = exp.link
    updated++
  }
}

if (!DRY) {
  writeFileSync(TRACKS, '[\n' + tracks.map(t => JSON.stringify(t)).join(',\n') + '\n]\n')
}

// Review file: accepted matches lowest score first, so the shakiest guesses are
// the first rows to check (the tail of a hand-collected SoundCloud batch is
// where uploads start misrepresenting themselves).
if (REPORT) {
  const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim()
  // The remix guards cover "remix"; a few version words slip past them (the
  // upload says "(cover)" or "bootleg" where the catalogue lists the original).
  // They stay matched — the audio is usually the same recording — but get a
  // flag so they can be reviewed before being trusted.
  const VERSION_WORD_RE = new RegExp(
    REMIX_RE.source + '|\\b(cover|live|mashup|slowed|sped\\s+up|remake)\\b',
    'i',
  )
  const isVersion = (a) => VERSION_WORD_RE.test(a.exp.title) && !VERSION_WORD_RE.test(a.pair.title)
  const head = 'score\thow\tflag\texport_artist\texport_title\turl\ttrack_title\ttrack_artist'
  const rows = [...assignments]
    .sort((a, b) => a.score - b.score)
    .map(a => [
      a.score.toFixed(3),
      a.how,
      isVersion(a) ? 'version' : '',
      clean(a.exp.artist),
      clean(a.exp.title),
      a.exp.link,
      clean(a.pair.title),
      clean(a.pair.artist),
    ].join('\t'))
  writeFileSync(resolve(ROOT, REPORT), '\ufeff' + [head, ...rows].join('\n') + '\n')
  const flagged = assignments.filter(isVersion).length
  console.log(`Wrote ${assignments.length} accepted matches (lowest score first) -> ${REPORT}${flagged ? ` (${flagged} flagged "version" — the upload is a remix/cover/live take of the track, review those first)` : ''}`)

  const base = REPORT.replace(/\.tsv$/, '')
  if (scoped.size) {
    const missed = [...pairIndex.values()].filter(p => scoped.has(p.key) && p.missing > 0 && !usedPair.has(p))
    const head2 = 'artist\ttitle\tyoutube\tsoundcloud'
    const rows2 = missed.map(p => {
      const t = byId.get(p.ids[0]) ?? {}
      return [clean(p.artist), clean(p.title), clean(t.youtube), clean(t.soundcloud)].join('\t')
    })
    writeFileSync(resolve(ROOT, base + '-unmatched.tsv'), '\ufeff' + [head2, ...rows2].join('\n') + '\n')
    console.log(`  searched rows with no ${LINK} match: ${missed.length} -> ${base}-unmatched.tsv`)
  }

  // Turned-down export rows are the ones a human has to judge: most are simply
  // a different recording, but the raw (guard-free) score says which of them
  // still point at a plausible catalogue row, and `rejected` names the guard
  // that stopped it ("export-remix" = the upload is a remix of the track the
  // export row claims to be, and so on).
  const accepted = new Set(assignments.map(a => a.exp))
  const rejected = gatheredExports.length ? gatheredExports.filter(exp => !accepted.has(exp)) : []
  if (rejected.length) {
    const pool = [...pairIndex.values()].filter(inScope).map(p => [p, prepTrack(p)])
    const head3 = 'raw\trejected\texport_artist\texport_title\turl\tbest_track_title\tbest_track_artist'
    const rows3 = rejected
      .map(exp => ({ exp, best: looseBest(prepExp(exp), pool) }))
      .sort((a, b) => (b.best?.raw ?? 0) - (a.best?.raw ?? 0))
      .map(({ exp, best }) => [
        (best?.raw ?? 0).toFixed(3),
        best?.reject ?? (best && usedPair.has(best.pair) ? 'track-claimed' : 'passed-tie'),
        clean(exp.artist),
        clean(exp.title),
        exp.link,
        clean(best?.pair.title),
        clean(best?.pair.artist),
      ].join('\t'))
    writeFileSync(resolve(ROOT, base + '-rejected.tsv'), '\ufeff' + [head3, ...rows3].join('\n') + '\n')
    console.log(`  export rows turned down: ${rejected.length} -> ${base}-rejected.tsv`)
  }
}

const totalLinked = tracks.filter(t => t[LINK]).length
const sample = (list, fmt, n = 8) => list.slice(0, n).map(fmt).join('\n  ')
const byHow = { index: 0, fuzzy: 0, gathered: 0 }
for (const a of assignments) byHow[a.how]++

console.log(`Export: ${files.join(', ')} (${[...byFile.values()].reduce((n, a) => n + a.length, 0)} ${LINK} rows)`)
if (GATHERED) console.log(`Gathered mode: ${gatheredExports.length} export rows matched against tracks still missing a link`)
console.log(`Matched ${assignments.length} unique titles → ${updated} track records${DRY ? ' (dry run)' : ''}`)
console.log(`  via index: ${byHow.index} · via fuzzy: ${byHow.fuzzy}${GATHERED ? ` · via gathered: ${byHow.gathered}` : ''} · total with ${LINK} now: ${totalLinked}`)
console.log(`Unmatched originals (in exported parts): ${unmatchedOrig.length} · unused export rows: ${unusedExp}`)
if (assignments.length) {
  const weak = assignments.filter(a => a.score < 0.9).slice(0, 8)
  console.log('Examples:')
  console.log('  ' + sample(assignments.filter(a => a.score >= 0.95), a =>
    `${a.pair.artist} – ${a.pair.title}  ←  ${a.exp.title}${a.exp.artist ? ` [${a.exp.artist}]` : ''}  (${a.score.toFixed(2)} ${a.how})`))
  if (weak.length) {
    console.log('Lowest accepted scores:')
    console.log('  ' + sample(assignments.slice().sort((a, b) => a.score - b.score), a =>
      `${a.pair.artist} – ${a.pair.title}  ←  ${a.exp.title}  (${a.score.toFixed(2)} ${a.how})`, 8))
  }
}
if (unmatchedOrig.length) {
  console.log('Unmatched originals (first 12):')
  console.log('  ' + sample(unmatchedOrig, p => `${p.artist} – ${p.title}`, 12))
}
if (!DRY) console.log(`Wrote ${LINK} URLs -> data/tracks.json`)
