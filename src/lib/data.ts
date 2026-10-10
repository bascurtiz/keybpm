import { useSyncExternalStore } from 'react'
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
  const lastEditedBy = str(r.lastEditedBy)
  if (lastEditedBy) track.lastEditedBy = lastEditedBy
  const lastEditedByDiscordId = str(r.lastEditedByDiscordId)
  if (lastEditedByDiscordId) track.lastEditedByDiscordId = lastEditedByDiscordId
  const verifiedAt = str(r.verifiedAt)
  if (verifiedAt) track.verifiedAt = verifiedAt
  const verifiedBy = str(r.verifiedBy)
  if (verifiedBy) track.verifiedBy = verifiedBy
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

/**
 * Fired after `refresh()` repopulates the module exports, so components
 * re-render. Distinct from DATA_CHANGED (a *request* to refresh, from
 * contributions.ts); dispatching this is what makes an async overlay landing
 * visible to a page that already rendered — without it, approving a
 * correction leaves the track detail showing pre-overlay data.
 */
export const CATALOG_CHANGED = 'keydb:catalog-changed'

/**
 * Bumped on every refresh. Components subscribe via `useCatalog()` and
 * re-render when it changes — the arrays themselves are mutated in place
 * (stable identity), so a plain `useEffect` dependency on them would never
 * fire.
 */
let version = 0

/**
 * Fold the approved queue over the base dataset.
 *
 * Order is load-bearing, and it is *not* the order the API returns (newest
 * first):
 *
 *  1. `add` rows first, oldest → newest, so a track that exists only in the
 *     queue is in the map before anything corrects it. Processing corrections
 *     in wire order silently dropped them (`by.get(track_id)` was empty) and
 *     then let the original `add` — with its empty BPM — win.
 *  2. `correct` rows after, oldest → newest, so the latest correction is the
 *     final word and can never be overwritten by the add it corrects.
 *
 * A correction is a patch: a null in its payload must not blank a field the
 * target already has (the form only knows about the fields it shows).
 *
 * Attribution is not patchable at all: `submittedBy` is the member who
 * contributed the track and survives every later correction — the editor is
 * recorded in `lastEditedBy` instead, so a moderator fixing someone else's row
 * never takes their name off it.
 */
const NOT_PATCHABLE = new Set([
  'id',
  // Provenance belongs to the record, not to whoever edited it: a correction
  // cannot re-attribute the contribution, relabel where the data came from, or
  // claim a review. Those are set from the queue row (or not at all).
  'source',
  'submittedBy',
  'submittedByDiscordId',
  'lastEditedBy',
  'lastEditedByDiscordId',
  'verifiedAt',
  'verifiedBy',
])

/** `reviewed_at` ("2026-10-10 11:53:32") -> "2026-10-10"; undefined if absent. */
function reviewDate(s: Submission): string | undefined {
  const raw = s.reviewed_at
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : undefined
}

/**
 * Approval is verification: the reviewer who let the row through stands behind
 * the values, so the date and their name travel with the track. Rows nobody has
 * reviewed keep no stamp at all rather than a meaningless date.
 */
function stampVerification(track: Track, s: Submission): Track {
  const at = reviewDate(s)
  if (!at) return track
  const next: Track = { ...track, verifiedAt: at }
  if (s.reviewer_username) next.verifiedBy = s.reviewer_username
  return next
}
function chronological(a: Submission, b: Submission): number {
  return a.created_at.localeCompare(b.created_at)
}

function applyQueueOverlay(base: Track[]): Track[] {
  if (!queueOverlay.length) return base
  const by = new Map(base.map(t => [t.id, t]))
  const ordered = [...queueOverlay].sort(chronological)
  const added: Track[] = []

  for (const s of ordered) {
    if (s.kind === 'correct') continue
    const normalized = normalizeTrack(s.payload)
    if (!normalized || by.has(normalized.id)) continue
    const stamped = stampVerification(normalized, s)
    by.set(stamped.id, stamped)
    added.push(stamped)
  }

  for (const s of ordered) {
    if (s.kind !== 'correct' || !s.track_id) continue
    const existing = by.get(s.track_id)
    if (!existing) continue
    // `id` is only needed to satisfy normalizeTrack; the patch target is track_id.
    const patch = normalizeTrack({ id: s.track_id, ...s.payload })
    if (!patch) continue
    const next = { ...existing } as unknown as Record<string, unknown>
    for (const [k, v] of Object.entries(patch)) {
      if (NOT_PATCHABLE.has(k) || v === null || v === undefined) continue
      next[k] = v
    }
    // The stamp on a correction payload is its author, not a new contributor.
    const editor = patch.submittedBy
    if (editor && editor !== existing.submittedBy) {
      next.lastEditedBy = editor
      if (patch.submittedByDiscordId) next.lastEditedByDiscordId = patch.submittedByDiscordId
    }
    // A correction was reviewed too — the reviewer verified the new values.
    const reviewed = reviewDate(s)
    if (reviewed) {
      next.verifiedAt = reviewed
      if (s.reviewer_username) next.verifiedBy = s.reviewer_username
    }
    by.set(existing.id, next as unknown as Track)
  }

  // Resolve every row through the map *after* both passes — a queue-added
  // track must be picked up in its corrected form, not the object that was
  // inserted before the correction ran.
  const out: Track[] = []
  const seen = new Set<string>()
  for (const t of [...added, ...base]) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    out.push(by.get(t.id) ?? t)
  }
  return out
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
  version++
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CATALOG_CHANGED))
}

/**
 * Subscribe to the catalog. Returns the current version so the component
 * re-renders whenever the dataset changes (local contribution saved, or the
 * approved-queue overlay landing after the async fetch).
 *
 * Read the data through the module exports afterwards — `tracks`, `stats`,
 * `getTrack`, the `all*` lists — they always hold the latest values.
 */
export function useCatalog(): number {
  return useSyncExternalStore(
    onChange => {
      window.addEventListener(DATA_CHANGED, onChange)
      window.addEventListener(CATALOG_CHANGED, onChange)
      return () => {
        window.removeEventListener(DATA_CHANGED, onChange)
        window.removeEventListener(CATALOG_CHANGED, onChange)
      }
    },
    () => version,
    () => version,
  )
}

refresh()

/**
 * Pull approved queue into the live catalog (Approve → searchable without apply-queue).
 *
 * Runs on load, so a page rendered before it resolves will be one render
 * behind without `useCatalog()` — that hook subscribes to CATALOG_CHANGED.
 */
export async function reloadQueueOverlay(): Promise<void> {
  queueOverlay = await apiOverlay()
  refresh()
}

if (typeof window !== 'undefined') {
  // Refresh on contribution changes; `refresh()` itself broadcasts
  // CATALOG_CHANGED, so `useCatalog()` subscribers update either way.
  window.addEventListener(DATA_CHANGED, refresh)
  void reloadQueueOverlay()
}

export function getTrack(id: string | undefined): Track | undefined {
  if (!id) return undefined
  return byId.get(id)
}
