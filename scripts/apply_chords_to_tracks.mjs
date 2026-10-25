import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TRACKS_PATH = join(ROOT, 'data', 'tracks.json')
const PROGRESSIONS_PATH = join(ROOT, 'data', 'chord-progressions.json')

const tracks = JSON.parse(fs.readFileSync(TRACKS_PATH, 'utf8'))
const progressions = JSON.parse(fs.readFileSync(PROGRESSIONS_PATH, 'utf8'))

let applied = 0
for (const t of tracks) {
  if (progressions[t.id]?.progressions) {
    t.progressions = progressions[t.id].progressions
    applied++
  }
}

fs.writeFileSync(TRACKS_PATH, JSON.stringify(tracks, null, 2))
console.log(`Successfully merged chord progressions into ${applied} tracks in ${TRACKS_PATH}!`)
