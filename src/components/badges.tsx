import { Link } from 'react-router-dom'
import { camelotColor, camelotToOpenKey } from '@/lib/camelot'
import { modeAbbr, shortKey } from '@/lib/format'
import { sourceHref, sourceMeta, sourceTooltip } from '@/lib/sources'
import type { TrackSource } from '@/types/track'
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

/**
 * One source chip — the source's two-letter code in its brand colour, linking
 * to the page that states the key: the source's own site, or its in-app key
 * listing when the source publishes one (`/source/<id>#<track-id>`). Colour is
 * decorative; the code, the tooltip and the aria-label all carry the meaning
 * (§25). `stopPropagation` keeps a chip click from also opening the
 * surrounding (clickable) table row.
 */
export function SourceBadge({
  source,
  track,
  className = '',
}: {
  source: TrackSource
  track: { id?: string; artist: string; title: string; camelot?: string | null }
  className?: string
}) {
  const meta = sourceMeta(source.id)
  const label = sourceTooltip(source, track.camelot ?? null)
  const chip = (
    <span
      className="inline-flex h-5 min-w-[1.75rem] items-center justify-center rounded border px-1 font-mono text-[11px] font-bold leading-none text-text"
      style={{ backgroundColor: `${meta.color}26`, borderColor: meta.color }}
    >
      {meta.code}
    </span>
  )
  const href = sourceHref(source, track)
  if (!href) {
    return (
      <span className={className} title={label} aria-label={label}>
        {chip}
      </span>
    )
  }
  // A published listing stays in the app, so it is a client-side route, not a
  // new tab — and the source's own site is one click further on (its header).
  if (href.startsWith('/')) {
    const listed = `${label} — opens the ${meta.name} key listing`
    return (
      <Link
        to={href}
        title={listed}
        aria-label={listed}
        onClick={e => e.stopPropagation()}
        className={`inline-flex transition-transform hover:scale-110 hover:brightness-125 ${className}`}
      >
        {chip}
      </Link>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      onClick={e => e.stopPropagation()}
      className={`inline-flex transition-transform hover:scale-110 hover:brightness-125 ${className}`}
    >
      {chip}
    </a>
  )
}

/**
 * A track's source chips. `max` caps how many show ("+N" covers the rest) for
 * dense rows; 0 shows them all.
 */
export function SourceBadges({
  sources,
  track,
  max = 0,
  className = '',
}: {
  sources?: TrackSource[]
  track: { artist: string; title: string; camelot?: string | null }
  max?: number
  className?: string
}) {
  if (!sources || sources.length === 0) return null
  const shown = max > 0 ? sources.slice(0, max) : sources
  const extra = sources.length - shown.length
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      {shown.map(s => (
        <SourceBadge key={s.id} source={s} track={track} />
      ))}
      {extra > 0 && (
        <span
          className="font-mono text-[11px] text-text-dim"
          title={`${extra} more source${extra === 1 ? '' : 's'}`}
        >
          +{extra}
        </span>
      )}
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
