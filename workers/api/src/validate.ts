/**
 * Server-side mirror of `src/lib/bpm.ts#parseBpmInput`.
 *
 * The Worker is a separate bundle from the SPA (no shared path aliases), so the
 * rules are duplicated on purpose — both must accept `124`, `127.5`, `132,9`
 * and the approximate `~128` / `128*` notation, and both must refuse a lone `-`
 * (the sheet's "unknown" placeholder) instead of storing `bpm: null`.
 */

export const BPM_MIN = 20
export const BPM_MAX = 400

const APPROX_PREFIX = /^(?:~|≈|~=|about|approx\.?|ca\.?|c\.?)\s*/i
const APPROX_SUFFIX = /\s*(?:\*+|~|≈|\?+)$/
/** A trailing unit is harmless: `128 bpm`. */
const UNIT_SUFFIX = /\s*bpm\.?$/i
const BPM_NUMBER = /^\d{1,3}(?:[.,]\d+)?$/

/** The tempo as a number (already normalised), or null when the value isn't a usable BPM. */
export function parseBpmValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= BPM_MIN && value <= BPM_MAX ? value : null
  }
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  const body = raw
    .replace(UNIT_SUFFIX, '')
    .replace(APPROX_PREFIX, '')
    .replace(APPROX_SUFFIX, '')
    .trim()
  if (!BPM_NUMBER.test(body)) return null
  const bpm = Number(body.replace(',', '.'))
  return bpm >= BPM_MIN && bpm <= BPM_MAX ? bpm : null
}
