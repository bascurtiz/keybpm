import { useCallback } from 'react'

/**
 * Dual-thumb range slider built from two overlaid <input type="range">.
 * Thumbs stay clickable via pointer-events rules in index.css.
 */
export function DualRange({
  label,
  min,
  max,
  step = 1,
  low,
  high,
  onChange,
  format = (v: number) => String(v),
}: {
  label: string
  min: number
  max: number
  step?: number
  low: number
  high: number
  onChange: (low: number, high: number) => void
  format?: (v: number) => string
}) {
  const pct = useCallback((v: number) => ((v - min) / (max - min)) * 100, [min, max])

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        <span className="font-mono text-xs tabular-nums text-text">
          {format(low)} – {format(high)}
        </span>
      </div>
      <div className="dual-range relative">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${pct(low)}%`, right: `${100 - pct(high)}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={low}
          aria-label={`${label} minimum`}
          onChange={e => onChange(Math.min(Number(e.target.value), high), high)}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={high}
          aria-label={`${label} maximum`}
          onChange={e => onChange(low, Math.max(Number(e.target.value), low))}
        />
      </div>
    </div>
  )
}
