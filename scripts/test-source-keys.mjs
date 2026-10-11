/**
 * Regression tests for scripts/lib/source_listings.mjs — run with `npm test`.
 *
 * The bugs this guards, both live on the CamelotSound listing: 148 chips
 * deep-linked to `/source/camelotsound#<track-id>` for rows the export-only
 * selection never built, so the page opened with nothing highlighted, and 43
 * chips whose row did exist stated a different key than the chip's tooltip —
 * the export's `key_<source>` column is the first record the engine's fuzzy
 * cluster matched, which can be another song or another section of the same one.
 */
import assert from 'node:assert/strict'
import { anchorChips } from './lib/source_listings.mjs'

let suite = 0
function it(name, fn) {
  suite++
  try {
    fn()
    console.log(`ok ${suite} - ${name}`)
  } catch (err) {
    console.error(`not ok ${suite} - ${name}`)
    throw err
  }
}

/** Rows as the listing builder holds them: `[artist, title, camelot, trackId]`. */
/** Chips as the dataset holds them: keyed by track id, carrying what it states. */
const rows = (...list) => new Map(list.map(row => [row[3], row]))
const chips = (...list) =>
  new Map(list.map(([artist, title, camelot, id]) => [id, { artist, title, camelot }]))

it('a chip with no row gets one, so the click lands on the track it came from', () => {
  const byTrack = rows()
  const { added, reKeyed } = anchorChips(
    byTrack,
    chips(['Aretha Franklin', 'Respect', '6A', 'aretha-franklin-respect']),
  )
  assert.equal(added, 1)
  assert.equal(reKeyed, 0)
  assert.deepEqual(byTrack.get('aretha-franklin-respect'), [
    'Aretha Franklin',
    'Respect',
    '6A',
    'aretha-franklin-respect',
  ])
})

it('a row stating another key is re-keyed to the chip that opened the page', () => {
  const byTrack = rows(['Glee', 'Baby', '6B', 'glee-baby'])
  const { added, reKeyed } = anchorChips(byTrack, chips(['Glee', 'Baby', '3B', 'glee-baby']))
  assert.equal(added, 0)
  assert.equal(reKeyed, 1)
  assert.equal(byTrack.get('glee-baby')[2], '3B')
})

it('a row already agreeing is left alone, keeping the export’s spelling', () => {
  const byTrack = rows(['Beatles, The', 'In My Life', '8B', 'the-beatles-in-my-life'])
  const { added, reKeyed } = anchorChips(
    byTrack,
    chips(['The Beatles', 'In My Life (Remastered)', '8B', 'the-beatles-in-my-life']),
  )
  assert.equal(added, 0)
  assert.equal(reKeyed, 0)
  assert.deepEqual(byTrack.get('the-beatles-in-my-life'), [
    'Beatles, The',
    'In My Life',
    '8B',
    'the-beatles-in-my-life',
  ])
})

it('a chip never duplicates a track another source row already listed', () => {
  const byTrack = rows(['Harmonic Keys', 'Nights in White Satin', '10B', 'moody-blues-nights'])
  anchorChips(byTrack, chips(['The Moody Blues', 'Nights in White Satin (Single)', '10B', 'moody-blues-nights']))
  assert.equal(byTrack.size, 1)
})

console.log(`\n${suite} tests passed`)
