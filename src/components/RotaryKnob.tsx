import { useCallback, useRef, useState } from 'react'

interface RotaryKnobProps {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
  step?: number
  defaultValue?: number
  label?: string
  unit?: string
  size?: number
}

export function RotaryKnob({
  value,
  onChange,
  min = -100,
  max = 100,
  step = 1,
  defaultValue = 0,
  label = 'Detune',
  unit = 'cents',
  size = 46,
}: RotaryKnobProps) {
  const [isDragging, setIsDragging] = useState(false)
  const startY = useRef(0)
  const startVal = useRef(value)

  // Map value to angle: -135° at min, 0° at 0, +135° at max
  const range = max - min
  const fraction = range === 0 ? 0.5 : (value - min) / range
  const angle = -135 + fraction * 270

  const clampAndRound = useCallback(
    (raw: number) => {
      const clamped = Math.max(min, Math.min(max, raw))
      return Math.round(clamped / step) * step
    },
    [min, max, step],
  )

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    setIsDragging(true)
    startY.current = e.clientY
    startVal.current = value
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const deltaY = startY.current - e.clientY // dragging up increases value
    const pixelRange = 120 // 120px drag moves through full range
    const valDelta = (deltaY / pixelRange) * (max - min)
    const next = clampAndRound(startVal.current + valDelta)
    if (next !== value) onChange(next)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false)
      try {
        ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
      } catch {
        /* ignore */
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault()
      onChange(clampAndRound(value + step))
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault()
      onChange(clampAndRound(value - step))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange(min)
    } else if (e.key === 'End') {
      e.preventDefault()
      onChange(max)
    } else if (e.key === 'Enter' || e.key === 'Backspace' || e.key === ' ') {
      e.preventDefault()
      onChange(defaultValue)
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? step : -step
    onChange(clampAndRound(value + delta))
  }

  // Calculate active arc path for bipolar display
  const cx = 25
  const cy = 25
  const r = 20

  const toRad = (deg: number) => (deg * Math.PI) / 180
  const getPoint = (deg: number) => ({
    x: cx + r * Math.sin(toRad(deg)),
    y: cy - r * Math.cos(toRad(deg)),
  })

  // Center top is 0° (12 o'clock)
  const pTop = getPoint(0)
  const pCurrent = getPoint(angle)
  const pMin = getPoint(-135)
  const pMax = getPoint(135)

  // Background track arc from -135° to +135°
  const bgTrackPath = `M ${pMin.x} ${pMin.y} A ${r} ${r} 0 1 1 ${pMax.x} ${pMax.y}`

  // Active arc from 0° (12 o'clock) to current angle
  const activeArcPath =
    Math.abs(angle) > 1
      ? `M ${pTop.x} ${pTop.y} A ${r} ${r} 0 0 ${angle > 0 ? 1 : 0} ${pCurrent.x} ${pCurrent.y}`
      : ''

  return (
    <div className="flex flex-col items-center select-none group">
      {label && (
        <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted mb-1">
          {label}
        </span>
      )}

      <div
        className="relative flex items-center justify-center cursor-ns-resize focus:outline-none"
        style={{ width: size, height: size }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value > 0 ? `+${value}` : value} ${unit}`}
        title="Drag up/down or scroll to turn. Double-click to reset."
      >
        <svg
          viewBox="0 0 50 50"
          className="w-full h-full pointer-events-none drop-shadow-sm"
          aria-hidden
        >
          {/* Background track */}
          <path
            d={bgTrackPath}
            fill="none"
            stroke="rgb(var(--line))"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Active arc from center top */}
          {activeArcPath && (
            <path
              d={activeArcPath}
              fill="none"
              stroke="rgb(var(--accent))"
              strokeWidth="2.8"
              strokeLinecap="round"
            />
          )}

          {/* Center zero tick mark */}
          <line
            x1="25"
            y1="2.5"
            x2="25"
            y2="5.5"
            stroke={value === 0 ? 'rgb(var(--accent))' : 'rgb(var(--text-dim))'}
            strokeWidth="1.2"
          />

          {/* Inner Knob Body */}
          <circle
            cx="25"
            cy="25"
            r="15"
            fill="rgb(var(--bg))"
            stroke={isDragging ? 'rgb(var(--accent))' : 'rgb(var(--line))'}
            strokeWidth="1.2"
            className="transition-colors"
          />

          {/* Subtle inner bevel */}
          <circle
            cx="25"
            cy="25"
            r="12.5"
            fill="rgb(var(--bg-subtle))"
            opacity="0.6"
          />

          {/* Rotating Notch Indicator */}
          <g transform={`rotate(${angle} 25 25)`}>
            <line
              x1="25"
              y1="13"
              x2="25"
              y2="19"
              stroke={value !== 0 ? 'rgb(var(--accent))' : 'rgb(var(--text))'}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </div>

      <button
        type="button"
        onClick={() => onChange(defaultValue)}
        className="mt-1 font-mono text-[11px] font-semibold text-text tabular-nums hover:text-accent transition-colors"
        title="Click to reset to 0"
      >
        {value > 0 ? `+${value}` : value} <span className="text-[10px] font-normal text-text-muted">{unit}</span>
      </button>
    </div>
  )
}
