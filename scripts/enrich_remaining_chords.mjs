/**
 * KeyDB Batch Chord Enrichment for Remaining Tracks (via Ultimate Guitar)
 *
 * Iterates through tracks in data/tracks.json that do not yet have a chord progression
 * in data/chord-progressions.json, looks them up on Ultimate Guitar, and appends matches.
 *
 * Features:
 *   - Automatic resume / checkpointing (saves every 10 matches)
 *   - Negative cache (data/chord-checked-not-found.json) so failed lookups are not repeated
 *   - Polite rate-limiting with exponential backoff on HTTP 429
 *   - Smart title and artist cleaning (stripping remixes, feats, parentheticals)
 *
 * Usage:
 *   node scripts/enrich_remaining_chords.mjs --limit=50
 *   node scripts/enrich_remaining_chords.mjs --delay=800
 *   node scripts/enrich_remaining_chords.mjs --all
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchUGProgressions } from './lookup_chord_progressions.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TRACKS_PATH = join(ROOT, 'data', 'tracks.json')
const PROGRESSIONS_PATH = join(ROOT, 'data', 'chord-progressions.json')
const NOT_FOUND_PATH = join(ROOT, 'data', 'chord-checked-not-found.json')

function cleanArtist(artist) {
  if (!artist) return ''
  // If artist has non-ascii with latin in parentheses e.g. "⣎⡇ꉺ... (Four Tet)", extract inside parentheses
  const parenLatin = artist.match(/\(([a-zA-Z0-9\s\-]+)\)/)
  if (parenLatin) return parenLatin[1].trim()

  return artist
    .replace(/\s+(?:ft\.?|feat\.?|featuring|vs\.?|x|&)\s+.+$/i, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim()
}

function cleanTitle(title) {
  if (!title) return ''
  return title
    .replace(/\s*\(.*?(?:remix|mix|edit|version|feat|ft|bootleg|dub|vip).*?\)\s*/gi, '')
    .replace(/\s*\[.*?(?:remix|mix|edit|version|feat|ft|bootleg|dub|vip).*?\]\s*/gi, '')
    .replace(/\s*-\s*(?:remix|original mix|extended mix|radio edit|club mix).*$/i, '')
    .trim()
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

  const limit = argMap.limit ? parseInt(argMap.limit, 10) : (argMap.all ? Infinity : 50)
  const delayMs = argMap.delay ? parseInt(argMap.delay, 10) : 750

  console.log(`Loading dataset...`)
  const tracks = JSON.parse(readFileSync(TRACKS_PATH, 'utf8'))
  const progressions = existsSync(PROGRESSIONS_PATH)
    ? JSON.parse(readFileSync(PROGRESSIONS_PATH, 'utf8'))
    : {}
  const notFound = existsSync(NOT_FOUND_PATH)
    ? new Set(JSON.parse(readFileSync(NOT_FOUND_PATH, 'utf8')))
    : new Set()

  const existingIds = new Set(Object.keys(progressions))

  // Filter missing tracks that have not failed recently
  const missing = tracks.filter(t => !existingIds.has(t.id) && !notFound.has(t.id))

  console.log(`Total tracks in database:   ${tracks.length}`)
  console.log(`Already enriched:           ${existingIds.size}`)
  console.log(`Previously checked/skipped: ${notFound.size}`)
  console.log(`Eligible for enrichment:    ${missing.length}`)
  console.log(`Processing target limit:    ${limit === Infinity ? 'ALL (' + missing.length + ')' : limit}`)
  console.log(`Rate limit delay:           ${delayMs}ms\n`)

  const queue = missing.slice(0, limit)
  let processed = 0
  let newlyEnriched = 0
  let newlyNotFound = 0

  function saveCheckpoints() {
    writeFileSync(PROGRESSIONS_PATH, JSON.stringify(progressions, null, 2))
    writeFileSync(NOT_FOUND_PATH, JSON.stringify([...notFound], null, 2))
  }

  for (const track of queue) {
    processed++
    const artist = cleanArtist(track.artist)
    const title = cleanTitle(track.title)

    // Skip tracks with empty or garbage names
    if (!artist || !title || artist.length < 2 || title.length < 2) {
      notFound.add(track.id)
      continue
    }

    const progressStr = `[${processed}/${queue.length}]`
    const trackLabel = `${track.artist} - ${track.title}`
    process.stdout.write(`${progressStr} Checking: ${trackLabel.slice(0, 50).padEnd(52)} `)

    try {
      const ugRes = await fetchUGProgressions(artist, title, track.key)

      if (ugRes.found && ugRes.sections && ugRes.sections.length > 0) {
        newlyEnriched++
        const mainSec = ugRes.sections[0]
        progressions[track.id] = {
          artist: track.artist,
          title: track.title,
          key: track.key,
          bpm: track.bpm,
          url: ugRes.url,
          source: 'ultimate-guitar',
          progressions: ugRes.sections.map(s => ({
            section: s.section,
            roman: s.roman,
            chords: s.chords,
            sourceKey: ugRes.tonality,
          })),
        }
        console.log(`✓ HIT (${mainSec.roman.slice(0, 30)})`)
      } else {
        newlyNotFound++
        notFound.add(track.id)
        console.log(`· no tab`)
      }
    } catch (e) {
      console.log(`! error: ${e.message}`)
      if (e.message && e.message.includes('429')) {
        console.log(`Rate limited! Pausing for 5 seconds...`)
        await new Promise(r => setTimeout(r, 5000))
      }
    }

    // Save checkpoint every 10 processed or on hits
    if (processed % 10 === 0) {
      saveCheckpoints()
    }

    // Polite delay
    await new Promise(r => setTimeout(r, delayMs))
  }

  saveCheckpoints()

  console.log(`\n========================================`)
  console.log(`Batch complete!`)
  console.log(`Processed:      ${processed}`)
  console.log(`Newly enriched: ${newlyEnriched}`)
  console.log(`No tab found:   ${newlyNotFound}`)
  console.log(`Total enriched: ${Object.keys(progressions).length} / ${tracks.length}`)
  console.log(`Saved to ${PROGRESSIONS_PATH}`)
}

main().catch(console.error)
