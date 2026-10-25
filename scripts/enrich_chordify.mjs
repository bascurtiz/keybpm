/**
 * KeyDB Batch Chord Enrichment via Chordify (Headless Browser)
 *
 * Launches a headless Chrome browser to bypass Cloudflare Turnstile,
 * searches Chordify for tracks missing chord progressions, extracts
 * the beat-aligned chords from Chordify search result cards / hydration store,
 * and converts them to Roman numerals (I, ii, iii, IV, V, vi).
 *
 * Features:
 *   - Bypasses Cloudflare automatically via real headless Chrome
 *   - Automatic dismissal of GDPR cookie consent dialogs
 *   - Dual extraction: Instant extraction from search result cards + hydration fallback
 *   - Handles superscript unicode chord notations (Fᵐᵃʲ⁷, Cₘ, B♭, etc.)
 *   - Continuous checkpoints (saves every 5 tracks to data/chord-progressions.json)
 *   - Negative cache (data/chordify-checked-not-found.json)
 *   - Auto-resume where it left off
 *
 * Usage:
 *   node scripts/enrich_chordify.mjs --limit=20
 *   node scripts/enrich_chordify.mjs --all
 *   node scripts/enrich_chordify.mjs --delay=1000
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chordsToRoman, findCoreProgression } from './lib/roman.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TRACKS_PATH = join(ROOT, 'data', 'tracks.json')
const PROGRESSIONS_PATH = join(ROOT, 'data', 'chord-progressions.json')
const NOT_FOUND_PATH = join(ROOT, 'data', 'chordify-checked-not-found.json')

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

function cleanArtist(artist) {
  if (!artist) return ''
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

export function normalizeChordifyChord(raw) {
  if (!raw) return ''
  return raw
    .replace(/ᵐᵃʲ⁷/g, 'maj7')
    .replace(/ᵐᵃʲ/g, 'maj')
    .replace(/ᵐⁱⁿ⁷/g, 'm7')
    .replace(/ᵐⁱⁿ/g, 'm')
    .replace(/ₘ⁷/g, 'm7')
    .replace(/ₘ/g, 'm')
    .replace(/⁷/g, '7')
    .replace(/⁹/g, '9')
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/:maj$/, '')
    .replace(/:min$/, 'm')
    .replace(/:maj7$/, 'maj7')
    .replace(/:min7$/, 'm7')
    .replace(/:7$/, '7')
    .replace(/:/, '')
    .trim()
}

function parseCardTextForChords(text) {
  if (!text) return []
  const chordRegex = /([A-G][b♭#♯]?(?:maj7|min7|m7|maj|min|m|ₘ|ᵐᵃʲ|ᵐⁱⁿ|7|9)?)/g
  const matches = [...text.matchAll(chordRegex)].map(m => normalizeChordifyChord(m[1])).filter(Boolean)
  return matches
}

export async function lookupOnChordify(page, artist, title, key = null) {
  const cArtist = cleanArtist(artist)
  const cTitle = cleanTitle(title)
  if (!cArtist || !cTitle || cArtist.length < 2 || cTitle.length < 2) return null

  const query = encodeURIComponent(`${cArtist} ${cTitle}`)
  const searchUrl = `https://chordify.net/search/${query}`

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})

    // Dismiss cookie modal if present
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      for (const b of btns) {
        if (b.innerText.includes('Alles accepteren') || b.innerText.includes('Accept all') || b.innerText.includes('Toestemming')) {
          b.click()
          break
        }
      }
    }).catch(() => {})

    await page.waitForSelector('a[href*="/chords/"]', { timeout: 8000 }).catch(() => {})

    // Extract all candidate cards from search page
    const cards = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll('a[href*="/chords/"]')]
      const res = []
      for (const a of anchors) {
        const href = a.href
        if (href.includes('/chords/') && !href.includes('/chords/browse') && !href.includes('/setlists/')) {
          const rowTitle = a.querySelector('.music-row-title')?.innerText?.trim() || a.innerText.trim()
          const chordEls = [...a.querySelectorAll('.ct1wuqa, [class*="chord"]')].map(el => el.innerText.trim()).filter(Boolean)
          res.push({
            href,
            title: rowTitle,
            rawText: a.innerText,
            cardChords: chordEls,
          })
        }
      }
      return res
    })

    if (!cards || !cards.length) return null

    // Find the best card: prefer one that has chords and whose title matches
    const lowerTitle = cTitle.toLowerCase()
    let bestCard = null

    // 1. First priority: title matches and has cardChords
    for (const c of cards) {
      if (c.cardChords && c.cardChords.length > 0 && c.title.toLowerCase().includes(lowerTitle)) {
        bestCard = c
        break
      }
    }

    // 2. Second priority: any card that matches title
    if (!bestCard) {
      for (const c of cards) {
        if (c.title.toLowerCase().includes(lowerTitle)) {
          bestCard = c
          break
        }
      }
    }

    // 3. Fallback: first card
    if (!bestCard) {
      bestCard = cards[0]
    }

    // Check if bestCard has chords directly on the card
    let chordsList = []
    if (bestCard.cardChords && bestCard.cardChords.length > 0) {
      chordsList = bestCard.cardChords.map(normalizeChordifyChord).filter(Boolean)
    }

    // If card didn't have chords, check if rawText has trailing chord symbols (like B♭E♭A♭Cₘ)
    if (!chordsList.length && bestCard.rawText) {
      const lastLine = bestCard.rawText.split('\n').pop()?.trim() || ''
      const parsed = parseCardTextForChords(lastLine)
      if (parsed.length >= 2) {
        chordsList = parsed
      }
    }

    // If we have chords from search card, convert them now
    if (chordsList.length > 0) {
      const core = findCoreProgression(chordsList)
      const effectiveKey = key || 'C major'
      const roman = chordsToRoman(core, effectiveKey)

      if (roman.length > 0) {
        return {
          url: bestCard.href,
          derivedKey: effectiveKey,
          keyUsed: effectiveKey,
          chords: core.join(' – '),
          roman: roman.join(' – '),
        }
      }
    }

    // If search card didn't have chords, try navigating to the chord page as fallback
    try {
      const resp = await page.goto(bestCard.href, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null)
      if (resp && resp.status() === 200) {
        const chordData = await page.evaluate(() => {
          const hyd = window.__staticRouterHydrationData
          if (hyd?.loaderData) {
            for (const v of Object.values(hyd.loaderData)) {
              if (v?.chords?.value?.chords) {
                return {
                  derivedBpm: v.chords.value.derivedBpm,
                  derivedKey: v.chords.value.derivedKey,
                  chords: v.chords.value.chords,
                }
              }
            }
          }
          return null
        })

        if (chordData && chordData.chords) {
          const lines = chordData.chords.split('\n')
          const seq = []
          for (const line of lines) {
            const parts = line.split(';')
            if (parts.length >= 2) {
              const rawChord = parts[1].trim()
              if (!rawChord || rawChord === 'N') continue
              const c = normalizeChordifyChord(rawChord)
              if (!seq.length || seq[seq.length - 1] !== c) {
                seq.push(c)
              }
            }
          }
          if (seq.length) {
            const core = findCoreProgression(seq)
            const effectiveKey = key || chordData.derivedKey || 'C major'
            const roman = chordsToRoman(core, effectiveKey)
            return {
              url: bestCard.href,
              derivedKey: chordData.derivedKey,
              bpm: chordData.derivedBpm,
              keyUsed: effectiveKey,
              chords: core.join(' – '),
              roman: roman.join(' – '),
            }
          }
        }
      }
    } catch {
      // ignore navigation errors
    }

    return null
  } catch {
    return null
  }
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
  const delayMs = argMap.delay ? parseInt(argMap.delay, 10) : 1000

  console.log('Loading dataset...')
  const tracks = JSON.parse(readFileSync(TRACKS_PATH, 'utf8'))
  const progressions = existsSync(PROGRESSIONS_PATH)
    ? JSON.parse(readFileSync(PROGRESSIONS_PATH, 'utf8'))
    : {}
  const notFound = existsSync(NOT_FOUND_PATH)
    ? new Set(JSON.parse(readFileSync(NOT_FOUND_PATH, 'utf8')))
    : new Set()

  const existingIds = new Set(Object.keys(progressions))
  const missing = tracks.filter(t => !existingIds.has(t.id) && !notFound.has(t.id))

  console.log(`Total tracks in database:   ${tracks.length}`)
  console.log(`Already enriched:           ${existingIds.size}`)
  console.log(`Chordify skipped/not-found: ${notFound.size}`)
  console.log(`Remaining to process:       ${missing.length}`)
  console.log(`Batch limit target:         ${limit === Infinity ? 'ALL (' + missing.length + ')' : limit}`)
  console.log(`Delay per track:            ${delayMs}ms\n`)

  console.log('Launching headless Chrome...')
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  })

  const page = await browser.newPage()
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')

  const queue = missing.slice(0, limit)
  let processed = 0
  let newlyEnriched = 0
  let newlyNotFound = 0

  function saveCheckpoints() {
    writeFileSync(PROGRESSIONS_PATH, JSON.stringify(progressions, null, 2))
    writeFileSync(NOT_FOUND_PATH, JSON.stringify([...notFound], null, 2))

    // Keep tracks.json in sync
    let mergedCount = 0
    for (const t of tracks) {
      if (progressions[t.id]) {
        t.progressions = progressions[t.id].progressions
        mergedCount++
      }
    }
    writeFileSync(TRACKS_PATH, JSON.stringify(tracks, null, 2))
  }

  for (const track of queue) {
    processed++
    const trackLabel = `${track.artist} - ${track.title}`
    process.stdout.write(`[${processed}/${queue.length}] Checking Chordify: ${trackLabel.slice(0, 48).padEnd(50)} `)

    const res = await lookupOnChordify(page, track.artist, track.title, track.key)

    if (res && res.roman) {
      newlyEnriched++
      progressions[track.id] = {
        artist: track.artist,
        title: track.title,
        key: track.key,
        bpm: track.bpm || res.bpm,
        url: res.url,
        source: 'chordify',
        progressions: [
          {
            section: 'Core Progression',
            roman: res.roman,
            chords: res.chords,
            sourceKey: res.derivedKey,
          },
        ],
      }
      console.log(`✓ HIT (${res.roman.slice(0, 30)})`)
    } else {
      newlyNotFound++
      notFound.add(track.id)
      console.log(`· no chord tab`)
    }

    if (processed % 5 === 0) {
      saveCheckpoints()
    }

    await new Promise(r => setTimeout(r, delayMs))
  }

  saveCheckpoints()
  await browser.close()

  console.log(`\n========================================`)
  console.log(`Chordify Batch complete!`)
  console.log(`Processed:      ${processed}`)
  console.log(`Newly enriched: ${newlyEnriched}`)
  console.log(`No tab found:   ${newlyNotFound}`)
  console.log(`Total enriched: ${Object.keys(progressions).length} / ${tracks.length}`)
  console.log(`Saved to ${PROGRESSIONS_PATH}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(console.error)
}
