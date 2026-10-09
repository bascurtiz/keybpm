/**
 * Imports duuzu's song key & bpm 'database' (Google Docs → Markdown export)
 * into data/tracks.json + data/tracks.csv.
 *
 * Usage: npm run data:import [-- path/to/export.md]
 *
 * Source format, one entry per line under a "### [Amin]" style key heading:
 *   • Artist - Title (Aphr+30) (inst) (~75/150) (bridge is 3/4)
 * Trailing brackets are peeled from the end: notes after the BPM, the BPM
 * group, then key/mode/tuning/flag/note groups. The first bracket group that
 * isn't recognisable stays part of the title, e.g. "(umru remix)".
 * Markdown `[text](youtube-url)` links and bare YouTube URLs become `youtube`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INPUT = process.argv[2] ?? join(ROOT, "duuzu's song key & bpm 'database' v10.md")
const SOURCE = "duuzu's key & bpm database v10"
const VERIFIED = '2025-06-15'

/** Section heading → canonical key name (same spelling as src/types/track.ts:
 * duuzu's all-sharp minor ring, flats kept on Ab/Eb/Bb/C# majors). */
const SECTION_KEYS = {
  Amin: 'A minor', Cmaj: 'C major', 'A#min': 'A# minor', 'C#maj': 'C# major',
  Bmin: 'B minor', Dmaj: 'D major', Cmin: 'C minor', Ebmaj: 'Eb major',
  'C#min': 'C# minor', Emaj: 'E major', Dmin: 'D minor', Fmaj: 'F major',
  'D#min': 'D# minor', 'F#maj': 'F# major', Emin: 'E minor', Gmaj: 'G major',
  Fmin: 'F minor', Abmaj: 'Ab major', 'F#min': 'F# minor', Amaj: 'A major',
  Gmin: 'G minor', Bbmaj: 'Bb major', 'G#min': 'G# minor', Bmaj: 'B major',
  other: null,
}

const KEY_TO_CAMELOT = {
  'G# minor': '1A', 'B major': '1B', 'D# minor': '2A', 'F# major': '2B',
  'A# minor': '3A', 'C# major': '3B', 'F minor': '4A', 'Ab major': '4B',
  'C minor': '5A', 'Eb major': '5B', 'G minor': '6A', 'Bb major': '6B',
  'D minor': '7A', 'F major': '7B', 'A minor': '8A', 'C major': '8B',
  'E minor': '9A', 'G major': '9B', 'B minor': '10A', 'D major': '10B',
  'F# minor': '11A', 'A major': '11B', 'C# minor': '12A', 'E major': '12B',
}

/** The sheet's mode abbreviations. maj/min are the plain key and aren't stored as a mode. */
const MODES = {
  dr: 'dorian', phr: 'phrygian', phrdom: 'phrygian dominant', lyd: 'lydian',
  mx: 'mixolydian', harm: 'harmonic minor', mpic: 'picardy third',
  loc: 'locrian', blues: 'blues', maj: null, min: null,
}
const MODE_ALT = 'phrdom|phr|dr|lyd|mx|harm|mpic|loc|blues|maj|min'

const FLAGS = { inst: 'instrumental', aca: 'acapella', perc: 'percussive' }

const KEY_GROUP = new RegExp(`^(?:([A-G][#b]?)(${MODE_ALT})|(${MODE_ALT}))?([+-]\\d{1,3})?$`)
const KEY_MENTION = new RegExp(`\\b[A-G][#b]?(?:${MODE_ALT})\\d*\\b`)
const NOTE_WORDS = /\b(key|keys|chords?|cycles?|triplets?|time|tempo|bpm|bass|melody|intro|outro|verse|chorus|pre-chorus|bridge|drop|start|end|middle|some|half|swing|tuning|cents|modulat\w*|changes?|changing|in [A-G][#b]?)\b|\d\/\d\b/i
const BPM_START = /^~?\d{2,3}(?:\.\d+)?(?![\d/]*\s*(?:cents|¢))/

const unescapeMd = s => s.replace(/\\([\\`*_{}[\]()#+\-.!~|<>=&"'$%^:;,?@/])/g, '$1')

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const YT_URL = /https?:\/\/(?:www\.)?(?:youtu\.be\/[^\s)]+|youtube\.com\/[^\s)]+)/i
const YT_MD = /\[([^\]]+)\]\((https?:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/)[^)\s]+)\)/i

function youtubeId(input) {
  if (!input) return null
  const s = String(input).trim()
  if (YT_ID.test(s)) return s
  try {
    const u = new URL(s)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      return id && YT_ID.test(id) ? id : null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = u.searchParams.get('v')
      if (v && YT_ID.test(v)) return v
      const [kind, maybeId] = u.pathname.split('/').filter(Boolean)
      if ((kind === 'embed' || kind === 'shorts' || kind === 'live' || kind === 'v') && maybeId && YT_ID.test(maybeId)) {
        return maybeId
      }
    }
  } catch { /* not a URL */ }
  return null
}

/** Pull a YouTube URL out of markdown links or a bare URL; return [cleaned text, watch url]. */
function peelYoutube(text) {
  let youtube = null
  let s = text
  s = s.replace(new RegExp(YT_MD.source, 'gi'), (_, label, url) => {
    if (!youtube && youtubeId(url)) youtube = `https://www.youtube.com/watch?v=${youtubeId(url)}`
    return label
  })
  s = s.replace(new RegExp(YT_URL.source, 'gi'), url => {
    if (!youtube && youtubeId(url)) youtube = `https://www.youtube.com/watch?v=${youtubeId(url)}`
    return ''
  })
  return [s.replace(/\s+/g, ' ').trim(), youtube]
}

/** Split trailing "(...)" groups off the end, respecting nesting. Returns [head, groups]. */
function splitTrailingGroups(text) {
  const groups = []
  let s = text.trimEnd()
  while (s.endsWith(')')) {
    let depth = 0
    let i = s.length - 1
    for (; i >= 0; i--) {
      if (s[i] === ')') depth++
      else if (s[i] === '(') {
        depth--
        if (depth === 0) break
      }
    }
    if (i < 0) break // unbalanced — leave the rest as text
    groups.unshift(s.slice(i + 1, -1).trim())
    s = s.slice(0, i).trimEnd()
  }
  return [s, groups]
}

function parseBpm(group) {
  const nums = [...group.matchAll(/~?(\d{2,3}(?:\.\d+)?)/g)].map(m => Number(m[1]))
  const valid = nums.filter(n => n >= 30 && n <= 400)
  return valid.length ? valid[0] : null
}

function slug(s) {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h.toString(36)
}

function parseEntry(raw, sectionKey) {
  const stripped = unescapeMd(raw)
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/^\s*•\s*/, '')
    .replace(/\s+[\u2013\u2014]\s+/, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
  const [line, youtube] = peelYoutube(stripped)
  const [head, groups] = splitTrailingGroups(line)

  const notes = []
  const tags = []
  let bpm = null
  let bpmRaw
  let mode
  let keyRaw
  let tuning

  // 1. BPM group: the last group that starts with a tempo; anything after it is a note.
  let bpmIdx = -1
  for (let i = groups.length - 1; i >= 0; i--) {
    if (BPM_START.test(groups[i])) { bpmIdx = i; break }
  }
  if (bpmIdx >= 0) {
    const g = groups[bpmIdx]
    bpm = parseBpm(g)
    if (bpm === null || g !== String(bpm)) bpmRaw = g
    notes.push(...groups.slice(bpmIdx + 1))
    groups.length = bpmIdx
  }

  // 2. Annotation groups, peeled from the end until one looks like part of the title.
  const annotations = []
  while (groups.length) {
    const g = groups[groups.length - 1]
    const k = g.match(KEY_GROUP)
    if (g && k && (k[2] || k[3] || k[4])) {
      const m = MODES[k[2] ?? k[3]]
      if (m) mode = m
      if (k[4]) tuning = Number(k[4])
      keyRaw = g
    } else if (FLAGS[g.toLowerCase()]) {
      tags.unshift(FLAGS[g.toLowerCase()])
    } else if (KEY_MENTION.test(g) || NOTE_WORDS.test(g) || /^[+-]\d{1,3}\b/.test(g)) {
      annotations.unshift(g)
      const t = g.match(/^([+-]\d{1,3})\b/)
      if (t && tuning === undefined) tuning = Number(t[1])
    } else {
      break
    }
    groups.pop()
  }
  notes.unshift(...annotations)

  const rest = [head, ...groups.map(g => `(${g})`)].join(' ').trim()
  const sep = rest.indexOf(' - ')
  const artist = (sep > 0 ? rest.slice(0, sep) : rest).trim()
  const title = (sep > 0 ? rest.slice(sep + 3) : '').trim()

  const key = SECTION_KEYS[sectionKey] ?? null
  const track = {
    id: '',
    artist,
    title,
    bpm,
    key,
    camelot: key ? KEY_TO_CAMELOT[key] : null,
    source: SOURCE,
    lastVerified: VERIFIED,
  }
  if (bpmRaw !== undefined) track.bpmRaw = bpmRaw
  if (mode) track.mode = mode
  if (keyRaw) track.keyRaw = keyRaw
  if (tuning !== undefined && tuning !== 0) track.tuning = tuning
  if (tags.length) track.tags = tags
  if (notes.length) track.notes = notes.join('; ')
  if (youtube) track.youtube = youtube
  return track
}

// ---- Read & group lines into entries ----------------------------------------
const lines = readFileSync(INPUT, 'utf8').replace(/\r/g, '').split('\n')
const entries = [] // { text, section }
let section = null

const parenDepth = s => [...s].reduce((d, c) => d + (c === '(' ? 1 : c === ')' ? -1 : 0), 0)

for (const rawLine of lines) {
  const line = rawLine.trimEnd()
  const heading = line.match(/^###\s*\\?\[(.+?)\\?\]\s*$/)
  if (heading) {
    const name = unescapeMd(heading[1])
    section = name in SECTION_KEYS ? name : null
    if (section === null) console.warn(`Unknown section heading: ${name}`)
    continue
  }
  if (!section || !line.trim()) continue
  if (/^[▐▌█\s]+$/.test(line) || line.startsWith('[image')) continue

  const prev = entries[entries.length - 1]
  const isBullet = /^\s*•/.test(line)
  // Continuation of an entry whose brackets are still open.
  if (!isBullet && prev && prev.section === section && parenDepth(unescapeMd(prev.text)) > 0) {
    prev.text += ' ' + line.trim()
    continue
  }
  if (isBullet || line.includes(' \\- ') || line.includes(' - ')) {
    entries.push({ text: line, section })
  } else if (prev && prev.section === section) {
    prev.text += ' ' + line.trim()
  }
}

// ---- Parse, assign stable unique ids -----------------------------------------
const tracks = []
const seen = new Map()
const stats = { noTitle: 0, noBpm: 0, modal: 0, tuned: 0, dualBpm: 0 }

for (const e of entries) {
  const t = parseEntry(e.text, e.section)
  if (!t.artist) continue
  if (!t.title) stats.noTitle++
  if (t.bpm === null) stats.noBpm++
  if (t.mode) stats.modal++
  if (t.tuning) stats.tuned++
  if (t.bpmRaw) stats.dualBpm++

  let base = slug(`${t.artist} ${t.title}`) || `track-${hash(t.artist + t.title)}`
  if (base.length > 80) base = base.slice(0, 80).replace(/-+$/, '')
  const n = (seen.get(base) ?? 0) + 1
  seen.set(base, n)
  // Same track listed under another key keeps a readable suffix.
  t.id = n === 1 ? base : `${base}-${t.camelot ? t.camelot.toLowerCase() : 'other'}${n > 2 ? `-${n}` : ''}`
  tracks.push(t)
}

// One record per line: compact, but still diffable in Git.
writeFileSync(
  join(ROOT, 'data', 'tracks.json'),
  '[\n' + tracks.map(t => JSON.stringify(t)).join(',\n') + '\n]\n',
)

console.log(`Parsed ${entries.length} entries -> ${tracks.length} tracks -> data/tracks.json`)
console.log(
  `  without title: ${stats.noTitle} · without BPM: ${stats.noBpm} · modal: ${stats.modal}` +
  ` · detuned: ${stats.tuned} · alternate BPM notation: ${stats.dualBpm}`,
)
