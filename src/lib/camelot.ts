import { ALL_CAMELOT_CODES } from '@/types/track'

/**
 * Camelot key compatibility logic.
 * Standard DJ harmonic mixing rules:
 * - Same key
 * - Adjacent on the same ring (+1 / -1, wrapping)
 * - Relative major/minor (switch A<->B on same number)
 *
 * This module is the single source of truth for Camelot relationships.
 * UI components must not reimplement these rules.
 */

function normalizeCamelot(code: string): string | null {
  const normalized = code.toUpperCase().replace(/\s/g, '')
  if (!/^\d{1,2}[AB]$/.test(normalized)) return null
  const num = parseInt(normalized.slice(0, -1), 10)
  const letter = normalized.slice(-1)
  if (num < 1 || num > 12) return null
  return `${num}${letter}`
}

function wrapNumber(n: number): number {
  return ((n - 1 + 12) % 12) + 1
}

/**
 * Get all Camelot codes compatible with the given key.
 * Returns [-1, same, +1, relative] — for "11A": ["10A", "11A", "12A", "11B"].
 */
export function getCompatibleKeys(camelot: string): string[] {
  const code = normalizeCamelot(camelot)
  if (!code) return []

  const num = parseInt(code.slice(0, -1), 10)
  const letter = code.slice(-1)
  const otherLetter = letter === 'A' ? 'B' : 'A'

  return [
    `${wrapNumber(num - 1)}${letter}`, // -1 on same ring
    code,                              // same key
    `${wrapNumber(num + 1)}${letter}`, // +1 on same ring
    `${num}${otherLetter}`,            // relative major/minor
  ]
}

/** Compatible keys excluding the key itself. */
export function getCompatibleKeysExcludingSelf(camelot: string): string[] {
  return getCompatibleKeys(camelot).filter(k => k !== camelot.toUpperCase())
}

/** Check if two Camelot codes are compatible. */
export function areKeysCompatible(c1: string, c2: string): boolean {
  const compatible = getCompatibleKeys(c1)
  return compatible.includes((c2 || '').toUpperCase())
}

/** Relation of target to source: same | adjacent | relative | none. */
export type KeyRelation = 'same' | 'adjacent' | 'relative' | 'none'

export function keyRelation(source: string, target: string): KeyRelation {
  const a = normalizeCamelot(source)
  const b = normalizeCamelot(target)
  if (!a || !b) return 'none'
  if (a === b) return 'same'
  const na = parseInt(a.slice(0, -1), 10)
  const nb = parseInt(b.slice(0, -1), 10)
  const la = a.slice(-1)
  const lb = b.slice(-1)
  if (na === nb) return la === lb ? 'same' : 'relative'
  if (la === lb && (wrapNumber(na + 1) === nb || wrapNumber(na - 1) === nb)) return 'adjacent'
  return 'none'
}

/** Signed Camelot step from `from` to `to` on the same ring (+1 / -1), or null. */
export function camelotStep(from: string, to: string): number | null {
  const a = normalizeCamelot(from)
  const b = normalizeCamelot(to)
  if (!a || !b || a.slice(-1) !== b.slice(-1)) return null
  const na = parseInt(a.slice(0, -1), 10)
  const nb = parseInt(b.slice(0, -1), 10)
  if (na === nb) return 0
  if (wrapNumber(na + 1) === nb) return 1
  if (wrapNumber(na - 1) === nb) return -1
  return null
}

/**
 * Camelot family color index (1-12) for visual coding.
 */
export function getCamelotColorIndex(camelot: string): number {
  const code = normalizeCamelot(camelot)
  if (!code) return 1
  return parseInt(code.slice(0, -1), 10)
}

/*
 * Theme-aware Camelot colors from the key-tool-online wheel palette — one
 * color per full code (A = pale minor ring, B = vivid major ring), matching
 * D:/key-tool-online/src/circle-of-fifths.js. The `--cam-{n}{a|b}` tokens
 * live in src/index.css: exact key-tool values in :root, darkened same-hue
 * variants in the light blocks for AA text on white.
 */
export const CAMELOT_HEX: Record<string, string> = {
  '1A': '#6df4df', '1B': '#0aedca',
  '2A': '#8bf4b2', '2B': '#3fed80',
  '3A': '#b8f794', '3B': '#88f24e',
  '4A': '#ffdf90', '4B': '#ffcb46',
  '5A': '#fec6af', '5B': '#ffa07c',
  '6A': '#feb7be', '6B': '#ff8894',
  '7A': '#ffb3d2', '7B': '#ff80b4',
  '8A': '#f4b4e8', '8B': '#ee83da',
  '9A': '#e1baff', '9B': '#cc8fff',
  '10A': '#c5d3ff', '10B': '#9fb7ff',
  '11A': '#9ae8fb', '11B': '#57d9f9',
  '12A': '#6af3f2', '12B': '#0bebeb',
}

/** `8A` → `8a` — key for the `--cam-*` tokens; unparsable input → 1a. */
function camelotTokenKey(camelot: string): string {
  const code = normalizeCamelot(camelot)
  return code ? code.toLowerCase() : '1a'
}

/** Opaque CSS color for inline styles: `rgb(var(--cam-11a))`. */
export function camelotColor(camelot: string): string {
  return `rgb(var(--cam-${camelotTokenKey(camelot)}))`
}

/** Same color with an 0–1 alpha for tinted chips: `rgb(var(--cam-11a) / 0.4)`. */
export function camelotTint(camelot: string, alpha: number): string {
  return `rgb(var(--cam-${camelotTokenKey(camelot)}) / ${alpha})`
}

/** All keys on one ring (A = minor, B = major), wheel order. */
export function getRing(letter: 'A' | 'B'): string[] {
  return ALL_CAMELOT_CODES.filter(c => c.endsWith(letter))
}

/** Wheel position of a Camelot code (0-11, for circular layout). */
export function getWheelPosition(camelot: string): number {
  const code = normalizeCamelot(camelot)
  if (!code) return 0
  return parseInt(code.slice(0, -1), 10) - 1
}

/** True when the code is a major key (B ring). */
export function isMajorKey(camelot: string): boolean {
  const code = normalizeCamelot(camelot)
  if (!code) return false
  return code.endsWith('B')
}

/**
 * Open Key notation (Traktor / Beatport style), aligned with key-tool-online:
 * C = 1d, Am = 1m. Same circle order as musical keys; number is Camelot offset by −7.
 * `8B` → `1d`, `8A` → `1m`, `1A` → `6m`.
 */
export function camelotToOpenKey(camelot: string): string | null {
  const code = normalizeCamelot(camelot)
  if (!code) return null
  const num = parseInt(code.slice(0, -1), 10)
  const openNum = ((num - 8 + 12) % 12) + 1
  const letter = code.endsWith('B') ? 'd' : 'm'
  return `${openNum}${letter}`
}

/** Parse Open Key (`1d`, `12m`) back to Camelot (`8B`, `7A`). */
export function openKeyToCamelot(openKey: string): string | null {
  const m = openKey.trim().toLowerCase().match(/^(\d{1,2})([dm])$/)
  if (!m) return null
  const openNum = parseInt(m[1], 10)
  if (openNum < 1 || openNum > 12) return null
  const camelotNum = ((openNum - 1 + 7) % 12) + 1
  return `${camelotNum}${m[2] === 'd' ? 'B' : 'A'}`
}

/** All Open Key codes: 1m…12m, then 1d…12d. */
export const ALL_OPEN_KEYS: string[] = [
  ...Array.from({ length: 12 }, (_, i) => `${i + 1}m`),
  ...Array.from({ length: 12 }, (_, i) => `${i + 1}d`),
]

export { normalizeCamelot, wrapNumber }
