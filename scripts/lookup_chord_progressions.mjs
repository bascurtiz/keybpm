/**
 * KeyDB Chord Progression Lookup & Cross-Reference Tool
 *
 * Looks up chord progressions for KeyDB tracks from Hooktheory,
 * and converts raw chord charts (e.g. from Chordify) to Roman numerals (I, ii, iii, IV, V, vi).
 *
 * Usage:
 *   # 1. Lookup a specific song on Hooktheory:
 *   node scripts/lookup_chord_progressions.mjs --artist "Avicii" --title "Levels"
 *   node scripts/lookup_chord_progressions.mjs --query "Daft Punk Get Lucky"
 *
 *   # 2. Convert raw chords (e.g. copied from Chordify) to Roman numerals:
 *   node scripts/lookup_chord_progressions.mjs --convert "C#m, E, B, A" --key "C# minor"
 *   node scripts/lookup_chord_progressions.mjs --convert "C, G, Am, F" --key "C major"
 *
 *   # 3. Batch lookup tracks in KeyDB that already have Hooktheory source links:
 *   node scripts/lookup_chord_progressions.mjs --batch=10
 *
 *   # 4. Fetch the latest online dataset from keybpm.info first:
 *   node scripts/lookup_chord_progressions.mjs --sync-online
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseKey,
  chordToRoman,
  chordsToRoman,
  progressionToRoman,
  normalizeHooktheoryProgression,
  romanToChords,
  transposeChord,
  findCoreProgression,
} from './lib/roman.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TRACKS_PATH = join(ROOT, 'data', 'tracks.json')
const PROGRESSIONS_CACHE = join(ROOT, 'data', 'chord-progressions.json')

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Fetch Hooktheory Theorytab page and extract sections & Roman numeral chord progressions.
 */
export async function fetchHooktheoryProgressions(artist, title, explicitUrl = null) {
  let url = explicitUrl
  if (!url) {
    const artistSlug = slugify(artist)
    const titleSlug = slugify(title)
    url = `https://www.hooktheory.com/theorytab/view/${artistSlug}/${titleSlug}`
  } else {
    // Strip section anchor (e.g. #Chorus)
    url = url.split('#')[0]
  }

  async function tryFetch(targetUrl) {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (KeyDB-Metadata-Lookup/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    return res
  }

  let res = await tryFetch(url)

  // Fallback 1: Try stripping "feat", "ft", "featuring" from artist
  if (res.status === 404 && !explicitUrl) {
    const cleanArtist = artist.replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.+$/i, '').trim()
    if (cleanArtist !== artist) {
      const fallbackUrl = `https://www.hooktheory.com/theorytab/view/${slugify(cleanArtist)}/${slugify(title)}`
      const fallbackRes = await tryFetch(fallbackUrl)
      if (fallbackRes.ok) {
        res = fallbackRes
        url = fallbackUrl
      }
    }
  }

  // Fallback 2: Try stripping parenthetical version/mix info from title (e.g. "(Radio Edit)")
  if (res.status === 404 && !explicitUrl) {
    const cleanTitle = title.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').trim()
    if (cleanTitle !== title) {
      const cleanArtist = artist.replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.+$/i, '').trim()
      const fallbackUrl = `https://www.hooktheory.com/theorytab/view/${slugify(cleanArtist)}/${slugify(cleanTitle)}`
      const fallbackRes = await tryFetch(fallbackUrl)
      if (fallbackRes.ok) {
        res = fallbackRes
        url = fallbackUrl
      }
    }
  }

  if (res.status === 404) {
    return { found: false, url, error: 'Song not found in TheoryTab database' }
  }
  if (!res.ok) {
    return { found: false, url, error: `HTTP ${res.status}` }
  }

  const html = await res.text()
  const nextPushes = [...html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)]
  if (!nextPushes.length) {
    return { found: false, url, error: 'Could not extract Next.js RSC data' }
  }

  const rsc = nextPushes.map(p => p[1]).join('')

  // Hooktheory RSC encodes progressions:
  // e.g.: \"section\":\"Chorus\",\"fullChords\":[\"1\",\"6\",\"4\",\"b7\",\"1\"],\"searchHref\":\"...chordString=I+vi+IV+bVII+I...\",\"tonic\":\"A\",\"scale\":\"major\"
  const sections = []
  const sectionRegex = /\\"section\\":\\"([^\\"]+)\\"[\s\S]*?chordString=([^\\&"]+)/g
  let match

  while ((match = sectionRegex.exec(rsc)) !== null) {
    const sectionName = match[1]
    const rawChordString = match[2]
    const romanStr = normalizeHooktheoryProgression(rawChordString)
    const romanChords = romanStr.split(' – ')

    // Only add unique section progressions
    if (!sections.some(s => s.section === sectionName && s.roman === romanStr)) {
      sections.push({
        section: sectionName,
        roman: romanStr,
        romanList: romanChords,
      })
    }
  }

  // Also extract song key from RSC if present
  let detectedKey = null
  const tonicMatch = rsc.match(/\\"keyTonic\\":\\"([^\\"]+)\\",\\"keyScale\\":\\"([^\\"]+)\\"/)
  if (tonicMatch) {
    detectedKey = `${tonicMatch[1]} ${tonicMatch[2]}`
  }

  return {
    found: sections.length > 0,
    url,
    detectedKey,
    sections,
  }
}

/**
 * Fetch chords from Ultimate Guitar and convert to Roman numerals.
 */
export async function fetchUGProgressions(artist, title, songKey = null) {
  const cleanTitle = title.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').trim()
  const cleanArtist = artist.replace(/\s+(?:ft\.?|feat\.?|featuring)\s+.+$/i, '').trim()
  const query = encodeURIComponent(`${cleanArtist} ${cleanTitle}`)
  const searchUrl = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${query}`

  try {
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { found: false, error: `Search HTTP ${res.status}` }

    const html = await res.text()
    const match = html.match(/class="js-store"[^>]*data-content="([^"]*)"/)
    if (!match) return { found: false, error: 'No js-store data' }

    const decoded = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    const json = JSON.parse(decoded)
    const results = json?.store?.page?.data?.results || []
    const chordsTabs = results.filter(r => r.type === 'Chords')
    if (!chordsTabs.length) return { found: false, error: 'No chord tabs found on Ultimate Guitar' }

    const targetArtistSlug = slugify(cleanArtist)
    const artistMatches = chordsTabs.filter(t => {
      const aSlug = slugify(t.artist_name)
      return aSlug === targetArtistSlug || aSlug.includes(targetArtistSlug) || targetArtistSlug.includes(aSlug)
    })

    const candidates = artistMatches.length > 0 ? artistMatches : chordsTabs
    candidates.sort((a, b) => (b.votes || 0) - (a.votes || 0))
    const best = candidates[0]

    const tabRes = await fetch(best.tab_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!tabRes.ok) return { found: false, error: `Tab HTTP ${tabRes.status}` }

    const tabHtml = await tabRes.text()
    const tabMatch = tabHtml.match(/class="js-store"[^>]*data-content="([^"]*)"/)
    if (!tabMatch) return { found: false, error: 'No tab store data' }

    const tabDecoded = tabMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    const tabJson = JSON.parse(tabDecoded)
    const tabView = tabJson?.store?.page?.data?.tab_view
    const content = tabView?.wiki_tab?.content
    if (!content) return { found: false, error: 'Empty tab content' }

    const capo = parseInt(tabView?.meta?.capo || '0', 10)
    const tonality = tabView?.meta?.tonality
    const keyToUse = songKey || tonality || 'C major'

    const chordMatches = [...content.matchAll(/\[ch\]([^\[]+)\[\/ch\]/g)].map(m => m[1].trim())
    const concertChords = chordMatches.map(c => transposeChord(c, capo))
    const dedup = []
    for (const c of concertChords) {
      if (!dedup.length || dedup[dedup.length - 1] !== c) dedup.push(c)
    }

    const coreChords = findCoreProgression(dedup)
    const coreRoman = chordsToRoman(coreChords, keyToUse).join(' – ')

    return {
      found: true,
      artist: best.artist_name,
      song: best.song_name,
      url: best.tab_url,
      tonality,
      capo,
      keyUsed: keyToUse,
      sections: [
        {
          section: 'Core Progression',
          chords: coreChords.join(' – '),
          roman: coreRoman,
        },
      ],
    }
  } catch (e) {
    return { found: false, error: e.message }
  }
}

/**
 * Fetch fresh online tracks bundle from keybpm.info/browse.
 */
async function syncOnlineTracks() {
  console.log('Fetching live index from https://keybpm.info/browse...')
  const htmlRes = await fetch('https://keybpm.info/browse')
  const html = await htmlRes.text()
  const match = html.match(/\/assets\/(tracks-[A-Za-z0-9_-]+\.js)/)
  if (!match) {
    throw new Error('Could not find tracks bundle in keybpm.info/browse HTML')
  }

  const bundleUrl = `https://keybpm.info/assets/${match[1]}`
  console.log(`Downloading online tracks bundle: ${bundleUrl}`)
  const res = await fetch(bundleUrl)
  const js = await res.text()

  const tempFile = join(ROOT, 'scripts', 'temp-online.mjs')
  writeFileSync(tempFile, js)
  const mod = await import('./temp-online.mjs')
  const onlineTracks = mod.r || mod.default || Object.values(mod)[0]
  const { unlinkSync } = await import('node:fs')
  unlinkSync(tempFile)

  console.log(`Successfully fetched ${onlineTracks.length} tracks from keybpm.info.`)
  writeFileSync(TRACKS_PATH, JSON.stringify(onlineTracks, null, 2))
  console.log(`Updated ${TRACKS_PATH}`)
  return onlineTracks
}

async function main() {
  const args = process.argv.slice(2)
  const argMap = {}
  for (const a of args) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      argMap[k] = v === undefined ? true : v
    }
  }

  if (argMap['sync-online']) {
    await syncOnlineTracks()
    return
  }

  // Mode: Convert raw chord string to Roman numerals
  if (argMap.convert) {
    const rawChords = argMap.convert
    const key = argMap.key || 'C major'
    console.log(`\n=== Converting Chord Progression ===`)
    console.log(`Input chords: ${rawChords}`)
    console.log(`Key:          ${key}`)
    const roman = progressionToRoman(rawChords, key)
    console.log(`Roman:        ${roman}\n`)
    return
  }

  // Load tracks
  let tracks = []
  if (existsSync(TRACKS_PATH)) {
    tracks = JSON.parse(readFileSync(TRACKS_PATH, 'utf8'))
  }

  // Mode: Single Song Lookup
  if (argMap.artist || argMap.title || argMap.query) {
    let artist = argMap.artist
    let title = argMap.title

    if (argMap.query) {
      const q = argMap.query.toLowerCase()
      const qTokens = q.split(/[\s\-_,]+/).filter(Boolean)

      // Find best matching track by token overlap
      let bestMatch = null
      let bestScore = 0

      for (const t of tracks) {
        const full = `${t.artist} ${t.title}`.toLowerCase()
        if (full.includes(q)) {
          bestMatch = t
          bestScore = 999
          break
        }
        let score = 0
        for (const tok of qTokens) {
          if (full.includes(tok)) score++
        }
        if (score > bestScore && score >= Math.min(2, qTokens.length)) {
          bestScore = score
          bestMatch = t
        }
      }

      if (bestMatch) {
        artist = bestMatch.artist
        title = bestMatch.title
        console.log(`Matched KeyDB track: "${bestMatch.artist} - ${bestMatch.title}" (Key: ${bestMatch.key}, BPM: ${bestMatch.bpm})`)
      } else {
        const parts = argMap.query.split(' ')
        artist = parts.slice(0, Math.floor(parts.length / 2)).join(' ')
        title = parts.slice(Math.floor(parts.length / 2)).join(' ')
      }
    }

    // Check if this track has a known hooktheory URL in sources
    let explicitUrl = null
    const track = tracks.find(
      t => t.artist?.toLowerCase() === artist?.toLowerCase() && t.title?.toLowerCase() === title?.toLowerCase()
    )
    if (track && track.sources) {
      const ht = track.sources.find(s => s.id === 'hooktheory')
      if (ht?.url) explicitUrl = ht.url
    }

    const songKey = track?.key || 'C major'
    const preferUg = argMap.source === 'ug'

    if (preferUg) {
      console.log(`Looking up Ultimate Guitar for "${artist} - ${title}"...`)
      const ugRes = await fetchUGProgressions(artist, title, songKey)
      if (ugRes.found) {
        console.log(`\nFound Ultimate Guitar Tab: ${ugRes.url}`)
        if (ugRes.tonality) console.log(`Tonality: ${ugRes.tonality}, Capo: ${ugRes.capo}`)
        console.log(`Key used: ${ugRes.keyUsed}`)
        console.log('\n--- Chord Progressions ---')
        for (const sec of ugRes.sections) {
          console.log(`\n[${sec.section}]`)
          console.log(`  Roman:    ${sec.roman}`)
          console.log(`  Chords:   ${sec.chords}`)
        }
        console.log()
        return
      } else {
        console.log(`Ultimate Guitar: Not found (${ugRes.error})`)
        return
      }
    }

    console.log(`Looking up Hooktheory for "${artist} - ${title}"...`)
    let result = await fetchHooktheoryProgressions(artist, title, explicitUrl)

    if (!result.found) {
      console.log(`Hooktheory: Not found (${result.error})`)
      console.log(`Checking Ultimate Guitar fallback for "${artist} - ${title}"...`)
      const ugRes = await fetchUGProgressions(artist, title, songKey)
      if (ugRes.found) {
        console.log(`\n✓ Found Ultimate Guitar Tab: ${ugRes.url}`)
        if (ugRes.tonality) console.log(`Tonality: ${ugRes.tonality}, Capo: ${ugRes.capo}`)
        console.log(`Key used: ${ugRes.keyUsed}`)
        console.log('\n--- Chord Progressions (via Ultimate Guitar) ---')
        for (const sec of ugRes.sections) {
          console.log(`\n[${sec.section}]`)
          console.log(`  Roman:    ${sec.roman}`)
          console.log(`  Chords:   ${sec.chords}`)
        }
        console.log()
        return
      } else {
        console.log(`Ultimate Guitar: Not found (${ugRes.error})`)
        return
      }
    }

    console.log(`\nFound TheoryTab: ${result.url}`)
    if (result.detectedKey) console.log(`Key: ${result.detectedKey}`)
    const effectiveKey = track?.key || result.detectedKey || 'C major'

    console.log('\n--- Chord Progressions by Section (via Hooktheory) ---')
    for (const sec of result.sections) {
      const chords = romanToChords(sec.romanList, effectiveKey)
      console.log(`\n[${sec.section}]`)
      console.log(`  Roman:    ${sec.roman}`)
      console.log(`  Chords:   ${chords.join(' – ')} (in ${effectiveKey})`)
    }
    console.log()
    return
  }

  // Mode: Batch Lookup
  const batchSize = parseInt(argMap.batch || '5', 10)
  console.log(`\n=== Batch Hooktheory Lookup (sample of ${batchSize}) ===`)
  const htTracks = tracks.filter(t => t.sources && t.sources.some(s => s.id === 'hooktheory')).slice(0, batchSize)

  const results = []
  for (const t of htTracks) {
    const htSource = t.sources.find(s => s.id === 'hooktheory')
    console.log(`\nLooking up: ${t.artist} - ${t.title} (Key: ${t.key})`)
    const res = await fetchHooktheoryProgressions(t.artist, t.title, htSource.url)
    if (res.found) {
      console.log(`✓ TheoryTab Found: ${res.url}`)
      for (const s of res.sections) {
        const chords = romanToChords(s.romanList, t.key || 'C major')
        console.log(`  ${s.section.padEnd(16)}: ${s.roman.padEnd(24)} -> ${chords.join(' – ')}`)
      }
      results.push({
        id: t.id,
        artist: t.artist,
        title: t.title,
        key: t.key,
        sections: res.sections,
      })
    } else {
      console.log(`✗ Not found: ${res.error}`)
    }
    // Respect rate limits with a small pause
    await new Promise(r => setTimeout(r, 600))
  }

  console.log(`\nFinished lookup for ${results.length}/${htTracks.length} tracks.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(console.error)
}
