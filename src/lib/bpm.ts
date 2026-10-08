import type { Track } from '@/types/track'

/**
 * Every tempo a track can be counted at: the primary BPM plus any alternates
 * from its raw notation ("80/160", "~132, ~90"). Half/double time is only
 * included when the source lists it — never invented.
 */
const cache = new WeakMap<Track, number[]>()

export function bpmCandidates(track: Track): number[] {
  const hit = cache.get(track)
  if (hit) return hit
  const values = new Set<number>()
  if (track.bpm !== null) values.add(track.bpm)
  if (track.bpmRaw) {
    for (const m of track.bpmRaw.matchAll(/(\d{2,3}(?:\.\d+)?)/g)) {
      const n = Number(m[1])
      if (n >= 30 && n <= 400) values.add(n)
    }
  }
  const out = [...values]
  cache.set(track, out)
  return out
}

/** True when any of the track's tempos falls inside [min, max]. */
export function bpmInRange(track: Track, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true
  return bpmCandidates(track).some(b => (min === null || b >= min) && (max === null || b <= max))
}

/** The track tempo closest to `target`, for mix deltas. */
export function closestBpm(track: Track, target: number): number | null {
  let best: number | null = null
  for (const b of bpmCandidates(track)) {
    if (best === null || Math.abs(b - target) < Math.abs(best - target)) best = b
  }
  return best
}
