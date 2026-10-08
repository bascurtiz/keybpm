import { camelotColor, camelotToOpenKey } from '@/lib/camelot'
import { modeAbbr, shortKey } from '@/lib/format'
import type { WheelMode } from '@/lib/wheelMode'

/** Compact BPM display — mono, right-aligned in tables. */
export function BpmBadge({ bpm, raw, className = '' }: { bpm: number | null; raw?: string; className?: string }) {
  if (bpm === null) {
    return <span className={`font-mono text-text-dim ${className}`} title={raw ?? 'BPM unknown'}>—</span>
  }
  return (
    <span className={`font-mono tabular-nums ${className}`} title={raw ? `Listed as ${raw}` : undefined}>
      {Number.isInteger(bpm) ? bpm : bpm.toFixed(1)}
      {raw && <span aria-hidden className="ml-0.5 text-text-dim">*</span>}
    </span>
  )
}

/**
 * Musical key. `short` renders "F#m" instead of "F# minor".
 * A mode beyond major/minor is appended ("Am dor") so modal tracks are never shown as plain minor.
 */
export function KeyBadge({
  keyName,
  mode,
  short = false,
  className = '',
}: {
  keyName: string | null
  mode?: string
  short?: boolean
  className?: string
}) {
  if (!keyName) {
    return <span className={`font-mono text-text-dim ${className}`} title="No single key">—</span>
  }
  return (
    <span className={`font-mono ${className}`} title={mode ? `${keyName} (${mode})` : keyName}>
      {short ? shortKey(keyName) : keyName}
      {mode && <span className="ml-1 text-[0.85em] text-text-dim">{short ? modeAbbr(mode) : mode}</span>}
    </span>
  )
}

export const CAMELOT_BLOCK =
  'inline-flex min-w-[3.25rem] items-center justify-center rounded-md px-2 py-0.5 font-mono text-xs font-semibold leading-5'

/** Inline style for a solid Camelot block: key-wheel color with dark ink. */
export function camelotBlockStyle(code: string): React.CSSProperties {
  return { backgroundColor: camelotColor(code), color: 'rgb(var(--on-cam))' }
}

/**
 * Camelot code as a solid block in its key-wheel color (A = pale minor hue,
 * B = vivid major hue) with dark ink — scannable down a long column.
 * Color is decorative only — the code text itself carries the meaning (§25).
 * `approximate` (modal tracks) only changes the tooltip.
 */
export function CamelotBadge({
  code,
  approximate = false,
  className = '',
  /** When `openkey`, label shows 1m/1d etc. Color still follows Camelot. */
  notation = 'camelot',
}: {
  code: string | null
  approximate?: boolean
  className?: string
  notation?: WheelMode
}) {
  if (!code) {
    return (
      <span className={`${CAMELOT_BLOCK} border border-line text-text-dim ${className}`} title="No Camelot position">
        —
      </span>
    )
  }
  const open = camelotToOpenKey(code)
  const label = notation === 'openkey' && open ? open : code
  const title =
    notation === 'openkey'
      ? approximate
        ? `Open Key ${label} · Camelot ${code} (closest — modal track)`
        : `Open Key ${label} · Camelot ${code}`
      : approximate
        ? `Camelot ${code} (closest position — modal track)`
        : `Camelot ${code}`
  return (
    <span
      className={`${CAMELOT_BLOCK} ${className}`}
      style={camelotBlockStyle(code)}
      title={title}
    >
      {label}
    </span>
  )
}
