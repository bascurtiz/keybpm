/**
 * Generates data/seed-tracks.json — a small fictional dataset for UI testing.
 * The real dataset (data/tracks.json) comes from `npm run data:import`.
 *
 * IMPORTANT: The current dataset is DEVELOPMENT SEED DATA.
 * All artists, titles, labels and releases below are FICTIONAL.
 * It exists to exercise the UI (filters, sorting, mix finder, provenance)
 * and must not be presented as factual production data.
 *
 * Camelot codes are derived from the musical key so the data can never
 * disagree with itself.
 *
 * Usage: npm run data:seed
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Musical key -> Camelot (canonical names, mirrors src/types/track.ts)
const KEY_TO_CAMELOT = {
  'G# minor': '1A', 'G# minor': '1A',
  'D# minor': '2A', 'D# minor': '2A',
  'A# minor': '3A', 'A# minor': '3A',
  'F minor': '4A',
  'C minor': '5A',
  'G minor': '6A',
  'D minor': '7A',
  'A minor': '8A',
  'E minor': '9A',
  'B minor': '10A',
  'F# minor': '11A',
  'C# minor': '12A', 'C# minor': '12A',
  'B major': '1B',
  'F# major': '2B', 'Gb major': '2B',
  'C# major': '3B', 'C# major': '3B',
  'Ab major': '4B', 'G# major': '4B',
  'Eb major': '5B', 'D# major': '5B',
  'Bb major': '6B', 'A# major': '6B',
  'F major': '7B',
  'C major': '8B',
  'G major': '9B',
  'D major': '10B',
  'A major': '11B',
  'E major': '12B',
}

const slug = (s) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' ').replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').toLowerCase()

// [artist, title, bpm, key, genre, label, release, year, duration, source, confidence, lastVerified, extras?]
// extras: { keySource?, bpmSource?, notes?, tuning?, bpmRaw? }
const ROWS = [
  // ---- 1A G# minor ----
  ['Nova Kestrel', 'Low Orbit', 124, 'G# minor', 'Deep House', 'Nordlys', 'Low Orbit EP', 2021, 342, 'Beatport', 0.98, '2026-09-12'],
  ['Nova Kestrel', 'Quiet Machines', 122.5, 'G# minor', 'Deep House', 'Nordlys', 'Low Orbit EP', 2023, 367, 'Beatport', 0.97, '2026-09-12'],
  ['Halcyon Bloc', 'Afterglow Static', 128, 'G# minor', 'Melodic Techno', 'Static Bloom', 'Afterglow', 2022, 391, 'MusicalKeyCNN', 0.91, '2026-08-30', { keySource: 'MusicalKeyCNN', bpmSource: 'Beatport' }],
  ['Marlowe Quinn', 'Tundra Pulse', 130, 'G# minor', 'Techno', 'Ferrite', 'Tundra Pulse', 2019, 404, 'community', 0.82, '2026-06-14'],
  // ---- 1B B major ----
  ['Velvet Atlas', 'Gilded Hour', 126, 'B major', 'House', 'Blonde Vinyl', 'Gilded Hour', 2020, 318, 'Discogs', 0.95, '2026-07-03'],
  ['Velvet Atlas', 'Paper Crowns', 124, 'B major', 'House', 'Blonde Vinyl', 'Gilded Hour', 2020, 331, 'Discogs', 0.94, '2026-07-03'],
  ['Dune Motorik', 'Autobahn Dreams', 132.6, 'B major', 'Progressive House', 'Gravity Wells', 'Exit 12', 2018, 436, 'manual', 0.9, '2026-05-21'],
  ['Juno Static', 'Signal Lost', null, 'B major', 'Electro', null, null, null, null, 'community', null, null],
  // ---- 2A Eb minor ----
  ['Circuit Bloom', 'Iron Garden', 129, 'D# minor', 'Techno', 'Ferrite', 'Iron Garden', 2021, 377, 'Beatport', 0.99, '2026-09-05'],
  ['Lena Voss', 'Nachtform', 133, 'D# minor', 'Techno', 'Ferrite', 'Nachtform', 2024, 365, 'MusicalKeyCNN', 0.88, '2026-10-01'],
  ['Pale Meridian', 'Sunken Bell', 121, 'D# minor', 'Deep House', 'Hollow Bay', 'Sunken Bell', 2017, 355, 'community', 0.76, null],
  ['Theo Grains', 'Millstone', 125, 'D# minor', 'Tech House', 'Cassette Republic', 'Millstone EP', 2022, 309, 'manual', 1, '2026-04-18'],
  // ---- 2B F# major ----
  ['Arcade Hearts', 'Neon Arcade', 128, 'F# major', 'Electro', 'Mono Lake', 'Joystick', 2019, 296, 'Discogs', 0.93, '2026-03-02'],
  ['Arcade Hearts', 'Continue?', 130, 'F# major', 'Electro', 'Mono Lake', 'Joystick', 2019, 311, 'Discogs', 0.92, '2026-03-02'],
  ['Kai Rourke', 'Silverline', 126, 'F# major', 'House', null, null, 2015, 324, 'community', 0.68, null],
  ['Ivory Signal', 'White Noise Choir', 138, 'F# major', 'Trance', 'Kite Records', 'Ascension', 2016, 448, 'Mixed In Key', 0.96, '2026-02-27'],
  // ---- 3A Bb minor ----
  ['Dust Republic', 'Bunker Funk', 127, 'A# minor', 'Tech House', 'Cassette Republic', 'Bunker Funk', 2023, 322, 'Beatport', 0.97, '2026-08-09'],
  ['Sable Runway', 'Nightshift', 131, 'A# minor', 'Techno', 'Ferrite', 'Nightshift', 2020, 386, 'manual', 0.95, '2026-06-30'],
  ['Analog Sunday', 'Slow Fade Gospel', 118, 'A# minor', 'Deep House', 'Hollow Bay', 'Slow Fade', 2014, 372, 'community', 0.71, null],
  ['Halcyon Bloc', 'Glass Rivers', 123.5, 'A# minor', 'Melodic Techno', 'Static Bloom', 'Glass Rivers', 2024, 398, 'MusicalKeyCNN', 0.86, '2026-09-19', { notes: 'Detected key contested with 12A by one source.' }],
  // ---- 3B Db major ----
  ['Juno Static', 'Tower Block Sky', 122, 'C# major', 'House', 'Blonde Vinyl', 'Tower Block', 2021, 327, 'Discogs', 0.94, '2026-07-22'],
  ['Lena Voss', 'Sunday Driver', 120, 'C# major', 'Disco', 'Mono Lake', 'Sunday Driver', 2019, 341, 'manual', 0.98, '2026-05-08'],
  ['Marlowe Quinn', 'Cold Chapel', 126, 'C# major', 'Progressive House', 'Prism Press', 'Cold Chapel', 2022, 419, 'Beatport', 0.9, '2026-08-24'],
  ['Mira Tan', 'Paper Boats', 119, 'C# major', 'Afro House', null, 'Paper Boats', 2023, 355, 'community', 0.85, '2026-06-11'],
  // ---- 4A F minor ----
  ['Circuit Bloom', 'Black Glass', 134, 'F minor', 'Techno', 'Ferrite', 'Black Glass', 2022, 402, 'Beatport', 0.98, '2026-09-27'],
  ['Velvet Atlas', 'Fever Dial', 125, 'F minor', 'House', 'Blonde Vinyl', 'Fever Dial', 2022, 314, 'Discogs', 0.96, '2026-07-16'],
  ['Theo Grains', 'Silo', 128, 'F minor', 'Tech House', 'Cassette Republic', 'Silo', 2020, 305, 'manual', 0.99, '2026-04-18'],
  ['Dune Motorik', 'Kern False', 136, 'F minor', 'Techno', 'Gravity Wells', 'Kern False', 2025, 374, 'MusicalKeyCNN', 0.9, '2026-10-02'],
  // ---- 4B Ab major ----
  ['Nova Kestrel', 'Open Water', 121, 'Ab major', 'Deep House', 'Nordlys', 'Open Water', 2024, 360, 'Beatport', 0.97, '2026-09-12'],
  ['Ivory Signal', 'Golden Ratio', 140, 'Ab major', 'Trance', 'Kite Records', 'Golden Ratio', 2018, 455, 'Mixed In Key', 0.95, '2026-02-27', { notes: 'Live drums: tempo drifts +/- 2 BPM.' }],
  ['Analog Sunday', 'Peach Static', 116, 'Ab major', 'Disco', 'Mono Lake', 'Peach Static', 2017, 336, 'community', 0.74, null],
  ['Kai Rourke', 'Soft Power', 123, 'Ab major', 'Afro House', 'Hollow Bay', 'Soft Power', 2021, 349, 'community', 0.83, '2026-01-30'],
  // ---- 5A C minor ----
  ['Pale Meridian', 'Undertow', 127, 'C minor', 'Deep House', 'Hollow Bay', 'Undertow', 2020, 368, 'Beatport', 0.94, '2026-07-09'],
  ['Sable Runway', 'Grid Lock', 135, 'C minor', 'Techno', 'Ferrite', 'Grid Lock', 2023, 390, 'MusicalKeyCNN', 0.89, '2026-10-01'],
  ['Arcade Hearts', 'Chrome Teeth', 130, 'C minor', 'Electro', 'Mono Lake', 'Chrome Teeth', 2022, 302, 'Discogs', 0.92, '2026-03-02'],
  ['Mira Tan', 'Market Day', 120, 'C minor', 'Afro House', null, null, 2022, 344, 'manual', 0.97, '2026-06-11'],
  // ---- 5B Eb major ----
  ['Juno Static', 'Uplink', 126, 'Eb major', 'House', 'Blonde Vinyl', 'Uplink', 2023, 321, 'Beatport', 0.96, '2026-07-22'],
  ['Marlowe Quinn', 'Far Meadow', 128, 'Eb major', 'Progressive House', 'Prism Press', 'Far Meadow', 2019, 428, 'manual', 0.93, '2026-05-21'],
  ['Dust Republic', 'Warehouse Pop', 124, 'Eb major', 'Tech House', 'Cassette Republic', 'Warehouse Pop', 2021, 316, 'community', 0.87, '2026-08-09'],
  ['Lena Voss', 'Long Way East', 122, 'Eb major', 'Disco', 'Mono Lake', 'Long Way East', 2024, 352, 'Discogs', 0.91, '2026-07-16'],
  // ---- 6A G minor ----
  ['Circuit Bloom', 'Redline', 138, 'G minor', 'Hardgroove', 'Ferrite', 'Redline', 2021, 399, 'Beatport', 0.95, '2026-09-05'],
  ['Theo Grains', 'Dockyard', 129, 'G minor', 'Tech House', 'Cassette Republic', 'Dockyard', 2022, 313, 'manual', 0.98, '2026-04-18'],
  ['Velvet Atlas', 'Green Room', 123, 'G minor', 'House', 'Blonde Vinyl', 'Green Room', 2018, 329, 'community', 0.81, '2026-02-14'],
  ['Kai Rourke', 'Low Sun', 119, 'G minor', 'Deep House', 'Nordlys', 'Low Sun', 2023, 364, 'Beatport', 0.94, '2026-08-31'],
  // ---- 6B Bb major ----
  ['Halcyon Bloc', 'Signal Hill', 125, 'Bb major', 'Melodic Techno', 'Static Bloom', 'Signal Hill', 2023, 385, 'MusicalKeyCNN', 0.9, '2026-08-30'],
  ['Ivory Signal', 'Morning Star', 138, 'Bb major', 'Trance', 'Kite Records', 'Morning Star', 2015, 462, 'Mixed In Key', 0.97, '2026-02-27'],
  ['Analog Sunday', 'Soda Fountain', 114, 'Bb major', 'Disco', 'Mono Lake', 'Soda Fountain', 2013, 325, 'community', 0.66, null],
  ['Sable Runway', 'Concrete Bloom', 132.5, 'Bb major', 'Techno', 'Ferrite', 'Concrete Bloom', 2024, 396, 'Beatport', 0.96, '2026-09-27'],
  // ---- 7A D minor ----
  ['Dust Republic', 'Bassline Council', 128, 'D minor', 'Tech House', 'Cassette Republic', 'Bassline Council', 2020, 310, 'community', 0.84, '2026-08-09'],
  ['Nova Kestrel', 'Deep Field', 122, 'D minor', 'Deep House', 'Nordlys', 'Deep Field', 2022, 371, 'Beatport', 0.98, '2026-09-12'],
  ['Mira Tan', 'Harmattan', 121, 'D minor', 'Afro House', 'Hollow Bay', 'Harmattan', 2024, 358, 'manual', 0.95, '2026-06-11'],
  ['Marlowe Quinn', 'Longitude', 130, 'D minor', 'Progressive House', 'Prism Press', 'Longitude', 2017, 441, 'Discogs', 0.92, '2026-05-21'],
  // ---- 7B F major ----
  ['Juno Static', 'Ribbon Cable', 174, 'F major', 'Drum & Bass', 'Mono Lake', 'Ribbon Cable', 2021, 298, 'Discogs', 0.9, '2026-03-02'],
  ['Velvet Atlas', 'Day Shift', 124, 'F major', 'House', 'Blonde Vinyl', 'Day Shift', 2021, 333, 'Beatport', 0.97, '2026-07-16'],
  ['Theo Grains', 'Sun Machine', 126.5, 'F major', 'Tech House', 'Cassette Republic', 'Sun Machine', 2024, 318, 'manual', 1, '2026-04-18'],
  ['Pale Meridian', 'Blue Hour Swim', 118, 'F major', null, 'Hollow Bay', 'Blue Hour Swim', 2016, 366, 'community', 0.72, null],
  // ---- 8A A minor ----
  ['Dune Motorik', 'Phase Walker', 134, 'A minor', 'Techno', 'Gravity Wells', 'Phase Walker', 2020, 392, 'MusicalKeyCNN', 0.93, '2026-10-02'],
  ['Circuit Bloom', 'Night Freight', 137, 'A minor', 'Hardgroove', 'Ferrite', 'Night Freight', 2024, 381, 'Beatport', 0.94, '2026-09-05'],
  ['Kai Rourke', 'Cut Glass', 125, 'A minor', 'House', 'Blonde Vinyl', 'Cut Glass', 2019, 326, 'community', 0.8, '2026-02-14'],
  ['Mira Tan', 'Red Earth', 120, 'A minor', 'Afro House', 'Hollow Bay', 'Red Earth', 2021, 350, 'community', 0.88, '2026-06-11'],
  // ---- 8B C major ----
  ['Ivory Signal', 'Daybreak Protocol', 136.3, 'C major', 'Trance', 'Kite Records', 'Daybreak Protocol', 2019, 450, 'Mixed In Key', 0.96, '2026-02-27'],
  ['Sable Runway', 'Open Circuit', 131, 'C major', 'Techno', 'Ferrite', 'Open Circuit', 2022, 388, 'manual', 0.99, '2026-09-27'],
  ['Lena Voss', 'Carousel Noise', 117, 'C major', 'Disco', 'Mono Lake', 'Carousel Noise', 2020, 340, 'Discogs', 0.89, '2026-07-16'],
  ['Dust Republic', 'Two Step Forum', 132, 'C major', 'UK Garage', 'Cassette Republic', 'Two Step Forum', 2023, 307, 'Beatport', 0.95, '2026-08-09'],
  // ---- 9A E minor ----
  ['Nova Kestrel', 'Cold Frame', 123.5, 'E minor', 'Deep House', 'Nordlys', 'Cold Frame', 2020, 359, 'Beatport', 0.97, '2026-09-12'],
  ['Marlowe Quinn', 'Northern Line', 129, 'E minor', 'Progressive House', 'Prism Press', 'Northern Line', 2023, 424, 'MusicalKeyCNN', 0.92, '2026-08-24'],
  ['Juno Static', 'Dial Tone Romance', 175, 'E minor', 'Drum & Bass', 'Mono Lake', 'Dial Tone Romance', 2017, 303, 'community', 0.79, null],
  ['Theo Grains', 'Basement Permit', 126, 'E minor', 'Tech House', 'Cassette Republic', null, 2021, 315, 'manual', 1, '2026-04-18'],
  // ---- 9B G major ----
  ['Analog Sunday', 'Citrus Grove', 115, 'G major', 'Disco', 'Mono Lake', 'Citrus Grove', 2018, 334, 'community', 0.75, null],
  ['Velvet Atlas', 'Easy Company', 122, 'G major', 'House', 'Blonde Vinyl', 'Easy Company', 2017, 330, 'Discogs', 0.91, '2026-07-16'],
  ['Halcyon Bloc', 'Solar Bloom', 124, 'G major', 'Melodic Techno', 'Static Bloom', 'Solar Bloom', 2025, 406, 'MusicalKeyCNN', 0.87, '2026-10-03'],
  ['Mira Tan', 'Palm Wine', 121, 'G major', 'Afro House', 'Hollow Bay', 'Palm Wine', 2023, 353, 'manual', 0.96, '2026-06-11'],
  // ---- 10A B minor ----
  ['Sable Runway', 'Black Ice Run', 136.5, 'B minor', 'Techno', 'Ferrite', 'Black Ice Run', 2021, 394, 'Beatport', 0.98, '2026-09-27'],
  ['Dune Motorik', 'Polar Sequence', 132, 'B minor', 'Progressive House', 'Gravity Wells', 'Polar Sequence', 2022, 433, 'manual', 0.93, '2026-05-21'],
  ['Dust Republic', 'Tunnel Vision', 172, 'B minor', 'Drum & Bass', 'Cassette Republic', 'Tunnel Vision', 2024, 301, 'community', 0.86, '2026-08-09'],
  ['Kai Rourke', 'Still Water', 120, 'B minor', 'Deep House', 'Nordlys', 'Still Water', 2018, 362, 'community', 0.78, '2026-08-31'],
  // ---- 10B D major ----
  ['Ivory Signal', 'Sky Ladder', 138, 'D major', 'Trance', 'Kite Records', 'Sky Ladder', 2020, 457, 'Mixed In Key', 0.97, '2026-02-27'],
  ['Juno Static', 'Bright Field', 126, 'D major', 'House', 'Blonde Vinyl', 'Bright Field', 2022, 324, 'Beatport', 0.95, '2026-07-22'],
  ['Circuit Bloom', 'Day Surgery', 133, 'D major', 'Techno', 'Ferrite', 'Day Surgery', 2019, 379, 'manual', 0.97, '2026-09-05'],
  ['Pale Meridian', 'Tide Table', 122, 'D major', 'Deep House', 'Hollow Bay', 'Tide Table', 2024, 369, 'MusicalKeyCNN', 0.9, '2026-07-09'],
  // ---- 11A F# minor ----
  ['Nova Kestrel', 'Magnetic North', 125, 'F# minor', 'Deep House', 'Nordlys', 'Magnetic North', 2023, 356, 'Beatport', 0.99, '2026-09-12'],
  ['Theo Grains', 'Overpass', 127, 'F# minor', 'Tech House', 'Cassette Republic', 'Overpass', 2023, 312, 'manual', 1, '2026-04-18'],
  ['Sable Runway', 'Red Shift', 139, 'F# minor', 'Techno', 'Ferrite', 'Red Shift', 2025, 387, 'MusicalKeyCNN', 0.91, '2026-10-01'],
  ['Lena Voss', 'Star Atlas', 128, 'F# minor', 'Melodic Techno', 'Static Bloom', 'Star Atlas', 2022, 397, 'MusicalKeyCNN', 0.89, '2026-08-30', { notes: 'BPM source (Beatport) lists 128.0; analysis agrees.' }],
  // ---- 11B A major ----
  ['Marlowe Quinn', 'Eastbound', 130, 'A major', 'Progressive House', 'Prism Press', 'Eastbound', 2021, 429, 'Beatport', 0.96, '2026-08-24'],
  ['Velvet Atlas', 'Radio Days', 123, 'A major', 'House', 'Blonde Vinyl', 'Radio Days', 2016, 332, 'Discogs', 0.92, '2026-07-16'],
  ['Mira Tan', 'Sunrise Market', 120, 'A major', 'Afro House', 'Hollow Bay', 'Sunrise Market', 2025, 347, 'manual', 0.98, '2026-06-11'],
  ['Dust Republic', 'Velocity', 135, 'A major', 'UK Garage', 'Cassette Republic', 'Velocity', 2022, 299, 'community', 0.84, '2026-08-09'],
  // ---- 12A C# minor ----
  ['Dune Motorik', 'Deep Chorus', 131, 'C# minor', 'Techno', 'Gravity Wells', 'Deep Chorus', 2023, 395, 'MusicalKeyCNN', 0.92, '2026-10-02'],
  ['Halcyon Bloc', 'Obsidian', 124, 'C# minor', 'Melodic Techno', 'Static Bloom', 'Obsidian', 2021, 403, 'Beatport', 0.94, '2026-08-30'],
  ['Arcade Hearts', 'Pixel Dust', 172.5, 'C# minor', 'Drum & Bass', 'Mono Lake', 'Pixel Dust', 2024, 300, 'community', 0.85, '2026-03-02'],
  ['Analog Sunday', 'Velvet Rope', 116.5, 'C# minor', 'Disco', 'Mono Lake', 'Velvet Rope', 2015, 338, 'community', 0.69, null],
  // ---- 12B E major ----
  ['Ivory Signal', 'Apex Rising', 140, 'E major', 'Trance', 'Kite Records', 'Apex Rising', 2022, 459, 'Mixed In Key', 0.98, '2026-02-27'],
  ['Pale Meridian', 'Harbor Light', 121, 'E major', 'Deep House', 'Hollow Bay', 'Harbor Light', 2019, 363, 'manual', 0.94, '2026-07-09'],
  ['Kai Rourke', 'First Pressing', 125, 'E major', 'House', 'Blonde Vinyl', 'First Pressing', 2020, 328, 'Discogs', 0.9, '2026-07-16'],
  ['Circuit Bloom', 'Torque', 137.5, 'E major', 'Hardgroove', 'Ferrite', 'Torque', 2023, 376, 'Beatport', 0.97, '2026-09-05'],
]

const tracks = ROWS.map((row, i) => {
  const [artist, title, bpm, keyName, genre, label, release, year, duration, source, confidence, lastVerified, extras = {}] = row
  const camelot = KEY_TO_CAMELOT[keyName]
  if (!camelot) throw new Error(`Unknown key: ${keyName} (row ${i + 1})`)
  return {
    id: `${slug(artist)}-${slug(title)}`,
    artist,
    title,
    bpm,
    key: keyName,
    camelot,
    genre,
    label,
    release,
    year,
    duration,
    source,
    confidence,
    lastVerified,
    ...(extras.bpmRaw ? { bpmRaw: extras.bpmRaw } : {}),
    ...(extras.keySource ? { keySource: extras.keySource } : {}),
    ...(extras.bpmSource ? { bpmSource: extras.bpmSource } : {}),
    ...(extras.tuning != null ? { tuning: extras.tuning } : {}),
    ...(extras.notes ? { notes: extras.notes } : {}),
  }
})

// Integrity checks
const ids = new Set()
for (const t of tracks) {
  if (ids.has(t.id)) throw new Error(`Duplicate id: ${t.id}`)
  ids.add(t.id)
  if (t.bpm !== null && (typeof t.bpm !== 'number' || t.bpm < 30 || t.bpm > 300)) {
    throw new Error(`Bad bpm for ${t.id}: ${t.bpm}`)
  }
}
const codes = new Set(tracks.map((t) => t.camelot))
if (codes.size !== 24) throw new Error(`Expected 24 camelot codes, got ${codes.size}`)

mkdirSync(join(ROOT, 'data'), { recursive: true })
writeFileSync(join(ROOT, 'data', 'seed-tracks.json'), JSON.stringify(tracks, null, 2) + '\n')
console.log(`Wrote ${tracks.length} tracks -> data/seed-tracks.json`)
console.log(`Artists: ${new Set(tracks.map((t) => t.artist)).size}, Labels: ${new Set(tracks.map((t) => t.label).filter(Boolean)).size}`)
