import type { Track } from '@/types/track'
import type { KeyRelation } from '@/lib/camelot'
import { keyRelation, camelotStep } from '@/lib/camelot'
import { closestBpm } from '@/lib/bpm'

/**
 * Mix finder — deterministic, explainable compatibility scoring.
 *
 * score = keyScore (0..40) + bpmScore (0..40) + genreScore (0..10) + labelScore (0..10)
 * Every point is attributable to a visible reason chip — no opaque ML.
 */

export interface MixOptions {
  /** BPM tolerance in absolute terms (±N BPM). */
  bpmTolerance: number
  sameKey: boolean
  adjacentKey: boolean
  relativeKey: boolean
  /** null = any genre */
  genre: string | null
  /** null = any label */
  label: string | null
}

export const DEFAULT_MIX_OPTIONS: MixOptions = {
  bpmTolerance: 4,
  sameKey: true,
  adjacentKey: true,
  relativeKey: true,
  genre: null,
  label: null,
}

export interface MixResult {
  track: Track
  /** target.bpm - source.bpm, or null if either is unknown */
  deltaBpm: number | null
  relation: KeyRelation
  score: number
  reasons: string[]
}

function keyScore(relation: KeyRelation): number {
  switch (relation) {
    case 'same': return 40
    case 'adjacent': return 32
    case 'relative': return 28
    default: return 0
  }
}

/** 40 points at delta 0, falling linearly to 0 at the tolerance edge. */
function bpmScore(delta: number | null, tolerance: number): number {
  if (delta === null) return 0
  const d = Math.abs(delta)
  if (d > tolerance) return 0
  return Math.round(40 * (1 - d / tolerance))
}

function relationReason(source: string, target: string, relation: KeyRelation): string | null {
  switch (relation) {
    case 'same': return 'Same key'
    case 'relative': return 'Relative major/minor'
    case 'adjacent': {
      const step = camelotStep(source, target)
      if (step === 1) return 'Camelot +1'
      if (step === -1) return 'Camelot -1'
      return 'Adjacent Camelot'
    }
    default: return null
  }
}

function relationAllowed(relation: KeyRelation, opts: MixOptions): boolean {
  switch (relation) {
    case 'same': return opts.sameKey
    case 'adjacent': return opts.adjacentKey
    case 'relative': return opts.relativeKey
    default: return false
  }
}

export function findMixes(
  source: Pick<Track, 'bpm' | 'key' | 'camelot' | 'genre' | 'label'> & { id?: string },
  tracks: Track[],
  opts: MixOptions = DEFAULT_MIX_OPTIONS,
): MixResult[] {
  const results: MixResult[] = []

  const sourceCamelot = source.camelot
  if (!sourceCamelot) return results

  for (const track of tracks) {
    if (source.id && track.id === source.id) continue
    if (!track.camelot) continue

    const relation = keyRelation(sourceCamelot, track.camelot)
    if (!relationAllowed(relation, opts)) continue

    if (opts.genre && (track.genre ?? '') !== opts.genre) continue
    if (opts.label && (track.label ?? '') !== opts.label) continue

    // Compare against whichever listed tempo is closest ("65/130" mixes with 128 at +2).
    const targetBpm = source.bpm !== null ? closestBpm(track, source.bpm) : null
    const deltaBpm = source.bpm !== null && targetBpm !== null
      ? Math.round((targetBpm - source.bpm) * 10) / 10
      : null

    // Hard filter: within tolerance when both BPMs are known.
    // Unknown source BPM → no BPM filter; unknown target BPM → excluded
    // only if we can't verify (handled by score, kept visible via reason).
    if (source.bpm !== null) {
      if (deltaBpm === null) continue
      if (Math.abs(deltaBpm) > opts.bpmTolerance) continue
    }

    const reasons: string[] = []
    const relReason = relationReason(sourceCamelot, track.camelot, relation)
    if (relReason) reasons.push(relReason)

    let score = keyScore(relation) + bpmScore(deltaBpm, opts.bpmTolerance)

    if (deltaBpm !== null) {
      reasons.push(deltaBpm === 0 ? 'Same BPM' : `${deltaBpm > 0 ? '+' : ''}${deltaBpm} BPM`)
      if (targetBpm !== track.bpm) reasons.push(`at ${targetBpm} (listed ${track.bpmRaw ?? track.bpm})`)
    }
    if (track.mode) reasons.push(`Modal: ${track.mode}`)

    if (source.genre && track.genre && source.genre === track.genre) {
      score += 10
      reasons.push('Same genre')
    }
    if (source.label && track.label && source.label === track.label) {
      score += 10
      reasons.push('Same label')
    }

    results.push({ track, deltaBpm, relation, score, reasons })
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const da = a.deltaBpm === null ? Infinity : Math.abs(a.deltaBpm)
    const db = b.deltaBpm === null ? Infinity : Math.abs(b.deltaBpm)
    if (da !== db) return da - db
    return a.track.artist.localeCompare(b.track.artist)
  })

  return results
}
