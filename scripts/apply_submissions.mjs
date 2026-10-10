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
import { mergeQueue } from './lib/merge_queue.mjs'

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

const incoming = JSON.parse(readFileSync(TRACKS, 'utf8'))
const { tracks, added, corrected, appliedIds, skipped } = mergeQueue(incoming, submissions)

for (const s of skipped) console.warn(`Skip ${s.id}: ${s.reason}`)

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
