import { useCallback, useRef } from 'react'

/**
 * Pixels of vertical drag for the knob's full −1 … +1 sweep.
 *
 * 150, not the 120 this knob used to take: 120 made the filter 25 % twitchier than the EQ
 * knobs around it, which cover their own sweep in 150 px (`Knob`'s `dy / 150`). Two knobs of
 * the same size, one row apart, dialing at different speeds is what made the filter read as
 * jumpy rather than just quick.
 */
const DRAG_RANGE_PX = 150

/** Shift multiplies the drag by this while held — the same 4× fine mode the EQ knobs have. */
const FINE_DRAG = 0.25

/**
 * Half-width of the bypass notch at 12 o'clock, in knob units.
 *
 * Matches `DeckEngine.setFilter`'s own allpass threshold (|norm| < 0.02): inside this the knob
 * parks on 0 exactly, so "filter off" is a place the detent holds rather than a value the hand
 * has to catch. It used to be 0.03, which at this knob's old speed was a 3.6 px wall in the
 * middle of the sweep — the knob visibly stuck when dialed slowly through centre.
 */
const CENTRE_DETENT = 0.02

interface FilterKnobProps {
  value: number // -1 (LPF) to +1 (HPF), 0 is bypass
  onChange: (val: number) => void
  accentColor?: string
  size?: number
  label?: string
  pointerColor?: string
}

export function FilterKnob({
  value,
  onChange,
  accentColor = '#10b981',
  size = 42,
  label = 'FLTR',
  pointerColor,
}: FilterKnobProps) {
  /**
   * The drag's origin, held in a ref rather than in state.
   *
   * A ref is read synchronously, so the first `pointermove` after `pointerdown` already has the
   * value to work from. This used to be an `isDragging` state flag, and a move that arrived
   * before that render landed was dropped — the knob's first pixel of travel went nowhere on
   * every grab, which reads as a sticky start.
   */
  const drag = useRef<{ startY: number; startVal: number } | null>(null)

  // Map value (-1 to +1) to angle (-135° to +135°)
  const angle = Math.max(-135, Math.min(135, value * 135))

  const clamp = useCallback((raw: number) => {
    const clamped = Math.max(-1, Math.min(1, raw))
    // Bypass notch: park on 0 rather than leaving 0.004 behind, which is still a filter on.
    return Math.abs(clamped) < CENTRE_DETENT ? 0 : clamped
  }, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    drag.current = { startY: e.clientY, startVal: value }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const deltaY = drag.current.startY - e.clientY // dragging up increases value (HPF)
    const fine = e.shiftKey ? FINE_DRAG : 1
    const next = clamp(drag.current.startVal + (deltaY / DRAG_RANGE_PX) * 2 * fine)
    if (next !== value) onChange(next)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    // Same two speeds as the EQ knobs' wheel: one notch of coarse, a quarter of that with Shift.
    const step = e.shiftKey ? 0.0125 : 0.05
    onChange(clamp(value + (e.deltaY < 0 ? step : -step)))
  }

  // Geometry: cx = 25, cy = 25, r = 19
  const cx = 25
  const cy = 25
  const r = 19

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

  const isEngaged = Math.abs(value) >= CENTRE_DETENT
  const tooltipText =
    !isEngaged
      ? 'Filter: FLAT (Double-click to reset)'
      : value < 0
        ? `Filter: LPF ${Math.round(-value * 100)}%`
        : `Filter: HPF ${Math.round(value * 100)}%`

  return (
    <div className="flex flex-col items-center select-none group">
      <div
        className="relative flex items-center justify-center cursor-ns-resize focus:outline-none touch-none"
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
        aria-valuenow={Math.round(value * 100) / 100}
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
            stroke="rgba(255, 255, 255, 0.12)"
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
            y1="1.5"
            x2="25"
            y2="5.5"
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.8"
          />

          {/* Inner Knob Body: Hardware gray #3e3e3e */}
          <circle
            cx="25"
            cy="25"
            r="14.5"
            fill="#3e3e3e"
            stroke="#383838"
            strokeWidth="1.2"
            className="transition-colors"
          />

          {/* Rotating Notch Pointer */}
          <g transform={`rotate(${angle} 25 25)`}>
            <line
              x1="25"
              y1="12"
              x2="25"
              y2="19.5"
              stroke={pointerColor || (isEngaged ? accentColor : '#ffffff')}
              strokeWidth="3.2"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </div>

      {/* Label: FLTR matching capital Inter font */}
      <span className="font-sans text-[8.5px] font-bold tracking-wider text-[#777777] uppercase select-none flex items-center justify-center leading-none mt-1">
        <span>{label}</span>
      </span>
    </div>
  )
}
