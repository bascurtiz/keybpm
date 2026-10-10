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

/**
 * Tempo notation a contributor may type into the Contribute form: `124`,
 * `127.5`, a comma decimal (`132,9`) and the "approximate" decorations the
 * duuzu sheet uses — leading `~`/`≈`/`about`/`ca.` or a trailing `*`/`?`/`~`.
 *
 * Anything else is rejected, which is the point: a lone `-` (the sheet's "not
 * known" placeholder) is *not* a tempo, and neither are `n/a`, `fast`, a range
 * (`128-130`) or a fast/slow pair (`80/160`). This field holds one number;
 * multi-tempo notations belong in Notes, so they can't silently become `null`.
 */
export const BPM_MIN = 20
export const BPM_MAX = 400

export type BpmParse =
  /* `approx` is true when the input was `~132`-style rather than a plain number. */
  | { ok: true; bpm: number; approx: boolean }
  | { ok: false; error: string }

const APPROX_PREFIX = /^(?:~|≈|~=|about|approx\.?|ca\.?|c\.?)\s*/i
const APPROX_SUFFIX = /\s*(?:\*+|~|≈|\?+)$/
/** A trailing unit is harmless: `128 bpm`. */
const UNIT_SUFFIX = /\s*bpm\.?$/i
const BPM_NUMBER = /^\d{1,3}(?:[.,]\d+)?$/

/** Parse + range-check a BPM typed by a human. Never throws. */
export function parseBpmInput(input: string): BpmParse {
  const raw = input.trim()
  if (!raw) return { ok: false, error: 'BPM is required' }
  const withoutUnit = raw.replace(UNIT_SUFFIX, '').trim()
  const approx = APPROX_PREFIX.test(withoutUnit) || APPROX_SUFFIX.test(withoutUnit)
  const body = withoutUnit.replace(APPROX_PREFIX, '').replace(APPROX_SUFFIX, '').trim()
  if (!BPM_NUMBER.test(body)) {
    return { ok: false, error: 'Enter one BPM number, e.g. 124, 127.5, 132,9 or ~128' }
  }
  const bpm = Number(body.replace(',', '.'))
  if (bpm < BPM_MIN || bpm > BPM_MAX) {
    return { ok: false, error: `BPM must be between ${BPM_MIN} and ${BPM_MAX}` }
  }
  return { ok: true, bpm, approx }
}

/** The track tempo closest to `target`, for mix deltas. */
export function closestBpm(track: Track, target: number): number | null {
  let best: number | null = null
  for (const b of bpmCandidates(track)) {
    if (best === null || Math.abs(b - target) < Math.abs(best - target)) best = b
  }
  return best
}
