import { useEffect, useState } from 'react'
import { apiActivity, type ActivityItem } from '@/lib/api'
import { useCatalog } from '@/lib/data'

/**
 * The community activity feed: the newest reviewed queue rows, newest first.
 *
 * The imported dataset (19k rows from duuzu's sheet) carries no timestamps, so
 * "what was added or fixed lately" can only come from the submission queue —
 * the API's `/api/activity`, which keeps `applied` rows too, so an entry stays
 * in the history after `data:apply-queue` writes it into tracks.json.
 *
 * Successful responses are cached per catalog version: the feed only changes
 * when a row is reviewed, which is exactly what bumps the version (the review
 * flow calls `reloadQueueOverlay()`). Navigating Home → track → Home therefore
 * reuses the cached list instead of re-querying D1. Failures are *not* cached,
 * so a Worker that was down on load is picked up on the next navigate.
 */

let cachedVersion = -1
let cached: ActivityItem[] | null = null
let inflight: Promise<ActivityItem[] | null> | null = null

function load(version: number): Promise<ActivityItem[] | null> {
  if (cached && cachedVersion === version) return Promise.resolve(cached)
  if (inflight) return inflight
  inflight = apiActivity(40)
    .then(items => {
      if (items) {
        cachedVersion = version
        cached = items
      }
      return items
    })
    .catch(() => null)
    .finally(() => {
      inflight = null
    })
  return inflight
}

export type ActivityState =
  | { status: 'loading'; items: ActivityItem[] }
  | { status: 'ready'; items: ActivityItem[] }
  /** The `/api/activity` route did not answer — say so instead of showing an empty feed. */
  | { status: 'unavailable'; items: ActivityItem[] }

/** Recent reviewed contributions. Loading → ready (possibly empty) → unavailable. */
export function useActivity(): ActivityState {
  const version = useCatalog()
  const [state, setState] = useState<ActivityState>(() =>
    cached ? { status: 'ready', items: cached } : { status: 'loading', items: [] },
  )

  useEffect(() => {
    let alive = true
    void load(version).then(items => {
      if (!alive) return
      setState(items ? { status: 'ready', items } : { status: 'unavailable', items: [] })
    })
    return () => {
      alive = false
    }
  }, [version])

  return state
}

/**
 * One merged, newest-first activity list: additions, edits and the reviews that
 * cleared them, in a single "Community activity" feed.
 *
 * One row per track — a track that was added and then corrected twice is one
 * thing that appeared, not three — and the **add wins** over any later edit:
 * the row credits whoever put the track in the database ("added … by"), which
 * is the contribution worth surfacing. A track that only ever existed in the
 * dataset lists its newest correction instead.
 *
 * Ordered by the kept row's submission time rather than its review time,
 * because the row shows "added/edited … ago" — ordering by review time would
 * print timestamps that run backwards down the list.
 */
export function recentActivity(items: ActivityItem[], limit = 6): ActivityItem[] {
  // Track id, falling back to the queue row's own id — always unique, so an
  // entry with no track reference is never merged with another.
  const byTrack = new Map<string, ActivityItem>()
  for (const item of items) {
    const key = item.trackId ?? item.id
    const kept = byTrack.get(key)
    if (!kept || (item.kind === 'add' && kept.kind !== 'add')) byTrack.set(key, item)
  }
  return [...byTrack.values()]
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, limit)
}
