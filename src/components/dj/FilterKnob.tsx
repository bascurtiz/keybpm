import { useCallback, useRef, useState } from 'react'

interface FilterKnobProps {
  value: number // -1 (LPF) to +1 (HPF), 0 is bypass
  onChange: (val: number) => void
  accentColor?: string
  size?: number
}

export function FilterKnob({
  value,
  onChange,
  accentColor = '#10b981',
  size = 42,
}: FilterKnobProps) {
  const [isDragging, setIsDragging] = useState(false)
  const startY = useRef(0)
  const startVal = useRef(value)

  // Map value (-1 to +1) to angle (-135° to +135°)
  const angle = Math.max(-135, Math.min(135, value * 135))

  const clamp = useCallback((raw: number) => {
    const clamped = Math.max(-1, Math.min(1, raw))
    // Snap to 0 if within +/-0.03
    return Math.abs(clamped) < 0.03 ? 0 : Math.round(clamped * 100) / 100
  }, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    setIsDragging(true)
    startY.current = e.clientY
    startVal.current = value
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const deltaY = startY.current - e.clientY // dragging up increases value (HPF)
    const pixelRange = 120
    const valDelta = (deltaY / pixelRange) * 2
    const next = clamp(startVal.current + valDelta)
    if (next !== value) onChange(next)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY < 0 ? 0.05 : -0.05
    onChange(clamp(value + delta))
  }

  // Geometry: cx = 25, cy = 25, r = 18.5
  const cx = 25
  const cy = 25
  const r = 18.5

  const toRad = (deg: number) => (deg * Math.PI) / 180
  const getPoint = (deg: number) => ({
    x: cx + r * Math.sin(toRad(deg)),
    y: cy - r * Math.cos(toRad(deg)),
  })

  const pMin = getPoint(-135)
  const pMax = getPoint(135)
  const pCurrent = getPoint(angle)

  // Background track arc from -135° to +135°
  const bgTrackPath = `M ${pMin.x.toFixed(2)} ${pMin.y.toFixed(2)} A ${r} ${r} 0 1 1 ${pMax.x.toFixed(2)} ${pMax.y.toFixed(2)}`

  // Active arc from 0° (12 o'clock) to current angle
  const activeArcPath =
    Math.abs(angle) > 1.5
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${angle > 0 ? 1 : 0} ${pCurrent.x.toFixed(2)} ${pCurrent.y.toFixed(2)}`
      : ''

  const isEngaged = Math.abs(value) >= 0.03
  const tooltipText =
    !isEngaged
      ? 'Filter: FLAT (Double-click to reset)'
      : value < 0
        ? `Filter: LPF ${Math.round(-value * 100)}%`
        : `Filter: HPF ${Math.round(value * 100)}%`

  return (
    <div className="flex flex-col items-center select-none group">
      <div
        className="relative flex items-center justify-center cursor-ns-resize focus:outline-none"
        style={{ width: size, height: size }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => onChange(0)}
        onWheel={handleWheel}
        tabIndex={0}
        role="slider"
        aria-label="Color Filter"
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={value}
        title={tooltipText}
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
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />

          {/* Active arc from center top */}
          {activeArcPath && (
            <path
              d={activeArcPath}
              fill="none"
              stroke={accentColor}
              strokeWidth="3.2"
              strokeLinecap="round"
            />
          )}

          {/* Top 12 o'clock zero tick mark */}
          <line
            x1="25"
            y1="2.2"
            x2="25"
            y2="6"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.75"
          />

          {/* Inner Knob Body: Beatport DJ slate gray #58585a */}
          <circle
            cx="25"
            cy="25"
            r="13.5"
            fill="#58585a"
            stroke="#3c3d42"
            strokeWidth="1.5"
            className="transition-colors"
          />

          {/* Rotating Notch Pointer */}
          <g transform={`rotate(${angle} 25 25)`}>
            <line
              x1="25"
              y1="13.5"
              x2="25"
              y2="19.5"
              stroke="#ffffff"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </div>

      {/* Label: ● FILTER matching capital Inter font */}
      <span className="font-sans text-[7.5px] font-bold tracking-wider text-zinc-400 uppercase select-none flex items-center justify-center gap-1 leading-none mt-0.5">
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            onChange(0)
          }}
          className="w-2.5 h-2.5 -m-0.5 flex items-center justify-center cursor-pointer group/dot focus:outline-none"
          title="Filter reset — Click dot to jump back to center (0)"
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 transition-all group-hover/dot:scale-125"
            style={{
              backgroundColor: isEngaged ? accentColor : '#373739',
            }}
          />
        </button>
        <span>FILTER</span>
      </span>
    </div>
  )
}
