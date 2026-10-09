import type { Track } from '@/types/track'
import { CAMELOT_TO_KEY, KEY_TO_CAMELOT } from '@/types/track'
import rawTracks from '../../data/tracks.json'
import { DATA_CHANGED, mergeContributions } from '@/lib/contributions'
import { canonicalYoutube } from '@/lib/youtube'
import { canonicalSoundcloud } from '@/lib/soundcloud'
import { apiOverlay, type Submission } from '@/lib/api'

/**
 * Single entry point to the static dataset.
 * data/tracks.json is the canonical, portable artifact (also consumed by
 * Python tools and CSV export) — the app imports it at build time, validates
 * every record, then overlays any local contributions from this browser.
 *
 * All exports keep a stable identity and are refreshed *in place* whenever a
 * contribution changes (`keydb:data-changed`), so components/pages that read
 * them after navigation see the new track without a hard reload.
 */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Coerce one raw record into a Track; null if it lacks an id or artist. Never throws. */
function normalizeTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id)
  const artist = typeof r.artist === 'string' ? r.artist : null
  if (!id || artist === null) return null

  const bpm = num(r.bpm)
  const rawKey = str(r.key)
  const key = rawKey && KEY_TO_CAMELOT[rawKey] ? CAMELOT_TO_KEY[KEY_TO_CAMELOT[rawKey]] : null
  const rawCam = str(r.camelot)?.toUpperCase() ?? null
  const camelot = rawCam && CAMELOT_TO_KEY[rawCam] ? rawCam : key ? KEY_TO_CAMELOT[key] : null
  const year = num(r.year)
  const confidence = num(r.confidence)

  const track: Track = {
    id,
    artist,
    title: typeof r.title === 'string' ? r.title : '',
    bpm: bpm !== null && bpm > 0 && bpm < 1000 ? bpm : null,
    key: key ?? (camelot ? CAMELOT_TO_KEY[camelot] : null),
    camelot,
    genre: str(r.genre),
    label: str(r.label),
    release: str(r.release),
    year: year !== null && year > 1800 && year < 2200 ? Math.round(year) : null,
    duration: num(r.duration),
    source: str(r.source) ?? 'Unknown',
    confidence: confidence !== null && confidence >= 0 && confidence <= 1 ? confidence : null,
    lastVerified: str(r.lastVerified),
  }
  const bpmRaw = str(r.bpmRaw)
  if (bpmRaw) track.bpmRaw = bpmRaw
  const mode = str(r.mode)
  if (mode) track.mode = mode
  const keyRaw = str(r.keyRaw)
  if (keyRaw) track.keyRaw = keyRaw
  const keySource = str(r.keySource)
  if (keySource) track.keySource = keySource
  const bpmSource = str(r.bpmSource)
  if (bpmSource) track.bpmSource = bpmSource
  const tuning = num(r.tuning)
  if (tuning !== null) track.tuning = tuning
  if (Array.isArray(r.tags)) {
    const tags = r.tags.filter((t): t is string => typeof t === 'string' && t !== '')
    if (tags.length) track.tags = tags
  }
  const notes = str(r.notes)
  if (notes) track.notes = notes
  const youtube = canonicalYoutube(str(r.youtube) ?? str(r.sourceUrl))
  if (youtube) track.youtube = youtube
  const soundcloud = canonicalSoundcloud(str(r.soundcloud) ?? str(r.sourceUrl))
  if (soundcloud) track.soundcloud = soundcloud
  const submittedBy = str(r.submittedBy)
  if (submittedBy) track.submittedBy = submittedBy
  const submittedByDiscordId = str(r.submittedByDiscordId)
  if (submittedByDiscordId) track.submittedByDiscordId = submittedByDiscordId
  return track
}

const BASE: Track[] = (Array.isArray(rawTracks) ? (rawTracks as unknown[]) : [])
  .map(normalizeTrack)
  .filter((t): t is Track => t !== null)

export const tracks: Track[] = []
const byId = new Map<string, Track>()

export const stats = { tracks: 0, artists: 0, labels: 0, withBpm: 0 }
export const allGenres: string[] = []
export const allLabels: string[] = []
export const allYears: number[] = []
export const allKeys: string[] = []
export const allCamelots: string[] = []
export const allModes: string[] = []
export const bpmBounds = { min: 0, max: 0 }
export const yearBounds = { min: 0, max: 0 }

/** Replace array contents while keeping the exported identity stable. */
function fill<T>(target: T[], next: T[]): void {
  target.length = 0
  for (const v of next) target.push(v)
}

const uniqueSorted = (values: (string | number | null | undefined)[]): (string | number)[] =>
  [...new Set(values.filter((v): v is string | number => v !== null && v !== undefined))]
    .sort((a, b) => typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b)))

/** Approved Discord queue rows not yet written into data/tracks.json. */
let queueOverlay: Submission[] = []

function applyQueueOverlay(base: Track[]): Track[] {
  if (!queueOverlay.length) return base
  const by = new Map(base.map(t => [t.id, t]))
  const added: Track[] = []
  for (const s of queueOverlay) {
    const raw = s.payload
    const normalized = normalizeTrack(raw)
    if (!normalized) continue
    if (s.kind === 'correct' && s.track_id) {
      const existing = by.get(s.track_id)
      if (!existing) continue
      const next = { ...existing, ...normalized, id: existing.id }
      by.set(existing.id, next)
    } else {
      if (by.has(normalized.id)) continue
      by.set(normalized.id, normalized)
      added.push(normalized)
    }
  }
  const corrected = base.map(t => by.get(t.id) ?? t)
  const baseIds = new Set(corrected.map(t => t.id))
  return [...added.filter(t => !baseIds.has(t.id)), ...corrected]
}

function refresh(): void {
  const merged = applyQueueOverlay(mergeContributions(BASE))
  fill(tracks, merged)
  byId.clear()
  for (const t of merged) byId.set(t.id, t)

  stats.tracks = merged.length
  stats.artists = new Set(merged.map(t => t.artist)).size
  stats.labels = new Set(merged.map(t => t.label).filter(Boolean)).size
  stats.withBpm = merged.filter(t => t.bpm !== null).length

  fill(allGenres, uniqueSorted(merged.map(t => t.genre)) as string[])
  fill(allLabels, uniqueSorted(merged.map(t => t.label)) as string[])
  fill(allYears, uniqueSorted(merged.map(t => t.year)) as number[])
  fill(allKeys, uniqueSorted(merged.map(t => t.key)) as string[])
  fill(allModes, uniqueSorted(merged.map(t => t.mode)) as string[])

  // Camelot codes in wheel order: 1A…12A, then 1B…12B (numeric, not lexicographic).
  const codes = [...new Set(merged.map(t => t.camelot).filter((c): c is string => c !== null))]
  fill(allCamelots, codes.sort((a, b) => {
    const numA = parseInt(a, 10)
    const numB = parseInt(b, 10)
    if (numA !== numB) return numA - numB
    return a.endsWith('A') ? -1 : 1
  }))

  let bMin = Infinity
  let bMax = -Infinity
  for (const t of merged) {
    if (t.bpm === null) continue
    if (t.bpm < bMin) bMin = t.bpm
    if (t.bpm > bMax) bMax = t.bpm
  }
  bpmBounds.min = Number.isFinite(bMin) ? Math.floor(bMin) : 60
  bpmBounds.max = Number.isFinite(bMax) ? Math.ceil(bMax) : 200
  yearBounds.min = allYears.length ? allYears[0] : 0
  yearBounds.max = allYears.length ? allYears[allYears.length - 1] : 0
}

refresh()

/** Pull approved queue into the live catalog (Approve → searchable without apply-queue). */
export async function reloadQueueOverlay(): Promise<void> {
  queueOverlay = await apiOverlay()
  refresh()
}

if (typeof window !== 'undefined') {
  window.addEventListener(DATA_CHANGED, refresh)
  void reloadQueueOverlay()
}

export function getTrack(id: string | undefined): Track | undefined {
  if (!id) return undefined
  return byId.get(id)
}
