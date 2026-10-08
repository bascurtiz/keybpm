/**
 * Match Soundiiz YouTube exports back onto data/tracks.json.
 *
 * Usage:
 *   npm run data:youtube           # merge new matches (never overwrites)
 *   npm run data:youtube -- --reset  # clear all youtube fields, then rematch
 *   node scripts/import_soundiiz.mjs --dry
 *
 * Reads every *.csv in data/soundiiz/export/. When a matching
 * data/soundiiz/part-NN.csv exists, matching is scoped to that part only
 * (no global fallback — leftover wrong YouTube hits must not infect other parts).
 *
 * Prefer same-row alignment (Soundiiz usually preserves order), then fuzzy
 * artist+title scoring. Remix/edit tokens must agree when present.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TRACKS = join(ROOT, 'data', 'tracks.json')
const SOUNDIZ = join(ROOT, 'data', 'soundiiz')
const EXPORT_DIR = join(SOUNDIZ, 'export')
const DRY = process.argv.includes('--dry')
const RESET = process.argv.includes('--reset')
const THRESHOLD = 0.82

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

function fold(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
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
  return String(title).replace(
    /\s*[\(\[](?![^)\]]*\b(?:remix|mix|edit|bootleg|flip|vip|version|cover|live|acoustic|instrumental|acapella|inst|remaster|dub)\b)[^)\]]*[\)\]]/gi,
    '',
  )
}

function stripJunk(s) {
  return fold(s)
    .replace(/[\(\[][^)\]]*official[^)\]]*[\)\]]/g, ' ')
    .replace(/[\(\[][^)\]]*lyric[^)\]]*[\)\]]/g, ' ')
    .replace(/[\(\[]\s*(audio|video|visualizer|hq|hd|4k|mv|perfect|english)\s*[\)\]]/g, ' ')
    .replace(/\|\s*music history.*$/g, ' ')
    .replace(/\s+[-–—]\s+(official|lyric|audio|video).*$/g, ' ')
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
  const h = new Set(have)
  let hit = 0
  for (const w of need) {
    if (h.has(w)) { hit++; continue }
    if ([...h].some(x => x.startsWith(w) || w.startsWith(x))) hit++
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

function scorePair(orig, exp) {
  const hay = splitHaystack(exp.title, exp.artist)
  const origArtist = contentTokens(orig.artist)
  const origTitle = contentTokens(orig.title)
  const origCore = contentTokens(coreTitle(orig.title))
  const titleNeed = origCore.length ? origCore : origTitle
  const hayArtist = contentTokens(hay.artist)
  const hayTitle = contentTokens(hay.title)
  const hayBlob = contentTokens(hay.blob)

  const artistScore = Math.max(
    coverage(origArtist, hayArtist),
    coverage(origArtist, hayBlob) * 0.95,
  )
  const titleCov = Math.max(
    coverage(titleNeed, hayTitle),
    coverage(titleNeed, hayBlob),
  )
  const titleScore = Math.max(titleCov, titleNeed.length ? 0 : 0)

  if (origArtist.length <= 2 && artistScore < 0.99) return 0
  if (artistScore < 0.7) return 0
  if (titleNeed.length === 0) return 0
  if (titleNeed.length === 1 && titleCov < 0.99) return 0
  if (titleNeed.length >= 2 && titleCov < 0.7) return 0

  // Distinctive title words (≥4 chars) must appear in the export.
  const distinctive = titleNeed.filter(w => w.length >= 4)
  if (distinctive.length && coverage(distinctive, hayBlob) < 0.8) return 0

  // If our title names a remix, the export must look like that remix (not the original).
  const oRemix = remixTags(orig.title)
  const eRemix = remixTags(`${exp.title} ${exp.artist}`)
  if ([...oRemix].some(t => t.startsWith('r:')) && ![...oRemix].filter(t => t.startsWith('r:')).every(t => eRemix.has(t) || hayBlob.includes(t.slice(2)))) {
    // remixer token missing — reject unless overall title coverage is perfect
    if (titleCov < 0.95) return 0
  }
  if (oRemix.has('remix') && !eRemix.has('remix') && !REMIX_RE.test(exp.title)) {
    if (titleCov < 0.95) return 0
  }
  // Export is a remix but original isn't → usually wrong
  if (eRemix.has('remix') && !oRemix.has('remix') && !REMIX_RE.test(orig.title)) {
    return 0
  }

  return artistScore * 0.4 + titleScore * 0.6
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
      const id = youtubeId(col(row, 'url')) || youtubeId(col(row, 'trackid', 'track_id', 'id'))
      if (!id) continue
      list.push({
        file,
        title: col(row, 'title', 'name', 'track', 'song'),
        artist: col(row, 'artist', 'artists'),
        youtube: `https://www.youtube.com/watch?v=${id}`,
        id,
      })
    }
    byFile.set(file, list)
  }
  return { files, byFile }
}

const tracks = JSON.parse(readFileSync(TRACKS, 'utf8'))
if (RESET) {
  for (const t of tracks) delete t.youtube
  console.log('Cleared existing youtube fields (--reset)')
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
    pair = { artist, title, ids: [], hasYoutube: false }
    pairIndex.set(key, pair)
  }
  pair.ids.push(t.id)
  if (t.youtube) pair.hasYoutube = true
}

const assignments = []
const usedPair = new Set()
let unusedExp = 0
const unmatchedOrig = []

for (const file of files) {
  const exports = byFile.get(file)
  const origPart = loadOriginalPart(file)
  if (!origPart) {
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
    if (pair) partPairs.push(pair)
  }

  const usedExp = new Set()

  // 1) Prefer same-index alignment when the export score is strong enough.
  const n = Math.min(origPart.length, exports.length)
  for (let i = 0; i < n; i++) {
    const r = origPart[i]
    const pair = pairIndex.get(`${r.artist}\0${r.title}`)
    if (!pair || pair.hasYoutube || usedPair.has(pair)) continue
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
    let best = null
    let bestScore = 0
    for (const pair of partPairs) {
      if (pair.hasYoutube || usedPair.has(pair)) continue
      const s = scorePair(pair, exp)
      if (s > bestScore) { bestScore = s; best = pair }
    }
    if (best && bestScore >= THRESHOLD) {
      usedPair.add(best)
      usedExp.add(i)
      assignments.push({ pair: best, exp, score: bestScore, how: 'fuzzy' })
    }
  }

  unusedExp += exports.length - usedExp.size
  for (const pair of partPairs) {
    if (!pair.hasYoutube && !usedPair.has(pair)) unmatchedOrig.push(pair)
  }
}

const byId = new Map(tracks.map(t => [t.id, t]))
let updated = 0
for (const { pair, exp } of assignments) {
  for (const id of pair.ids) {
    const t = byId.get(id)
    if (!t || t.youtube) continue
    t.youtube = exp.youtube
    updated++
  }
}

if (!DRY) {
  writeFileSync(TRACKS, '[\n' + tracks.map(t => JSON.stringify(t)).join(',\n') + '\n]\n')
}

const totalYt = tracks.filter(t => t.youtube).length
const sample = (list, fmt, n = 8) => list.slice(0, n).map(fmt).join('\n  ')
const byHow = { index: 0, fuzzy: 0 }
for (const a of assignments) byHow[a.how]++

console.log(`Soundiiz export: ${files.join(', ')} (${[...byFile.values()].reduce((n, a) => n + a.length, 0)} YouTube rows)`)
console.log(`Matched ${assignments.length} unique titles → ${updated} track records${DRY ? ' (dry run)' : ''}`)
console.log(`  via index: ${byHow.index} · via fuzzy: ${byHow.fuzzy} · total with youtube now: ${totalYt}`)
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
if (!DRY) console.log(`Wrote youtube URLs -> data/tracks.json`)
