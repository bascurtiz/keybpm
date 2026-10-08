/**
 * Pull approved Discord submissions from the API Worker and merge into
 * data/tracks.json, then refresh CSV and mark them applied.
 *
 * Usage:
 *   KEYBPM_API_URL=https://… KEYBPM_APPLY_TOKEN=… npm run data:apply-queue
 *
 * Local (cookie session as mod is not available here — use APPLY_TOKEN):
 *   KEYBPM_API_URL=http://127.0.0.1:8787 KEYBPM_APPLY_TOKEN=dev npm run data:apply-queue
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TRACKS = join(ROOT, 'data', 'tracks.json')
const API = (process.env.KEYBPM_API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
const TOKEN = process.env.KEYBPM_APPLY_TOKEN || ''

if (!TOKEN) {
  console.error('Set KEYBPM_APPLY_TOKEN (same as Worker secret APPLY_TOKEN)')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

const exportRes = await fetch(`${API}/api/export/approved`, { headers })
if (!exportRes.ok) {
  console.error(`Export failed: ${exportRes.status} ${await exportRes.text()}`)
  process.exit(1)
}
const { submissions } = await exportRes.json()
if (!Array.isArray(submissions) || submissions.length === 0) {
  console.log('No approved submissions to apply.')
  process.exit(0)
}

const tracks = JSON.parse(readFileSync(TRACKS, 'utf8'))
const byId = new Map(tracks.map(t => [t.id, t]))
const appliedIds = []
let added = 0
let corrected = 0

for (const s of submissions) {
  const payload = s.payload && typeof s.payload === 'object' ? s.payload : null
  if (!payload) {
    console.warn(`Skip ${s.id}: bad payload`)
    continue
  }

  if (s.kind === 'correct' && s.track_id) {
    const existing = byId.get(s.track_id)
    if (!existing) {
      console.warn(`Skip ${s.id}: track ${s.track_id} not found`)
      continue
    }
    const next = {
      ...existing,
      ...payload,
      id: existing.id,
      source: payload.source || existing.source || 'Community',
    }
    // Don't let queue metadata wipe core fields incorrectly
    delete next.submittedBy
    delete next.submittedByDiscordId
    if (payload.submittedBy) next.submittedBy = payload.submittedBy
    if (payload.submittedByDiscordId) next.submittedByDiscordId = payload.submittedByDiscordId

    const idx = tracks.findIndex(t => t.id === existing.id)
    tracks[idx] = next
    byId.set(next.id, next)
    corrected++
    appliedIds.push(s.id)
  } else if (s.kind === 'add') {
    const id = typeof payload.id === 'string' && payload.id ? payload.id : null
    if (!id) {
      console.warn(`Skip ${s.id}: add missing id`)
      continue
    }
    if (byId.has(id)) {
      console.warn(`Skip ${s.id}: id ${id} already exists`)
      continue
    }
    const row = { ...payload, id, source: payload.source || 'Community' }
    tracks.unshift(row)
    byId.set(id, row)
    added++
    appliedIds.push(s.id)
  } else {
    console.warn(`Skip ${s.id}: unknown kind`)
  }
}

if (!appliedIds.length) {
  console.log('Nothing applied.')
  process.exit(0)
}

writeFileSync(TRACKS, '[\n' + tracks.map(t => JSON.stringify(t)).join(',\n') + '\n]\n')
spawnSync('node', [join(ROOT, 'scripts', 'export_csv.mjs')], { stdio: 'inherit' })

const markRes = await fetch(`${API}/api/export/mark-applied`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ ids: appliedIds }),
})
if (!markRes.ok) {
  console.error(`Mark applied failed: ${markRes.status} — tracks.json was updated; fix status manually`)
  process.exit(1)
}
const { applied } = await markRes.json()
console.log(`Merged ${added} adds + ${corrected} corrections → data/tracks.json`)
console.log(`Marked ${applied} submissions as applied`)
