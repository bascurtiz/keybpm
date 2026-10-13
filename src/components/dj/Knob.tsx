import { useRef, useCallback } from 'react'

interface KnobProps {
  value: number
  min?: number
  max?: number
  defaultValue?: number
  onValueChange: (value: number) => void
  label?: string
  size?: number
  bipolar?: boolean
  format?: (value: number) => string
  className?: string
  disabled?: boolean
  accentColor?: string
  labelPlacement?: 'bottom' | 'left' | 'right'
  onDotClick?: () => void
  dotTitle?: string
  isDotActive?: boolean
  dotActiveColor?: string
  variant?: 'slate' | 'dark'
}

const START_ANGLE = -135
const END_ANGLE = 135

function valueToAngle(value: number, min: number, max: number, bipolar: boolean): number {
  if (bipolar && min < 0 && max > 0) {
    if (value <= 0) {
      const normNeg = (value - min) / (0 - min) // 0 at min, 1 at 0
      return START_ANGLE + normNeg * (0 - START_ANGLE)
    } else {
      const normPos = value / max // 0 at 0, 1 at max
      return normPos * END_ANGLE
    }
  }
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return START_ANGLE + norm * (END_ANGLE - START_ANGLE)
}

function angleToValue(angle: number, min: number, max: number, bipolar: boolean): number {
  const clamped = Math.max(START_ANGLE, Math.min(END_ANGLE, angle))
  if (bipolar && min < 0 && max > 0) {
    if (clamped <= 0) {
      const normNeg = clamped / START_ANGLE // 1 at START_ANGLE, 0 at 0
      return min * normNeg
    } else {
      const normPos = clamped / END_ANGLE // 0 at 0, 1 at END_ANGLE
      return max * normPos
    }
  }
  const norm = (clamped - START_ANGLE) / (END_ANGLE - START_ANGLE)
  return min + norm * (max - min)
}

function getArcPath(
  angle: number,
  bipolar: boolean,
  c: number,
  r: number
): string | null {
  if (Math.abs(angle) < 1.5) return null
  if (bipolar) {
    const startX = c
    const startY = c - r
    const endX = c + r * Math.sin((angle * Math.PI) / 180)
    const endY = c - r * Math.cos((angle * Math.PI) / 180)
    const sweep = angle > 0 ? 1 : 0
    return `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${r} ${r} 0 0 ${sweep} ${endX.toFixed(2)} ${endY.toFixed(2)}`
  } else {
    const sweepAngle = angle - START_ANGLE
    if (sweepAngle < 1.5) return null
    const startX = c + r * Math.sin((START_ANGLE * Math.PI) / 180)
    const startY = c - r * Math.cos((START_ANGLE * Math.PI) / 180)
    const endX = c + r * Math.sin((angle * Math.PI) / 180)
    const endY = c - r * Math.cos((angle * Math.PI) / 180)
    const largeArc = sweepAngle > 180 ? 1 : 0
    return `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`
  }
}

export function Knob({
  value,
  min = 0,
  max = 1,
  defaultValue,
  onValueChange,
  label,
  size = 22,
  bipolar = false,
  format,
  className = '',
  disabled = false,
  accentColor = '#10b981',
  labelPlacement = 'bottom',
  onDotClick,
  dotTitle,
  isDotActive = false,
  dotActiveColor,
  variant = 'slate',
}: KnobProps) {
  const angle = valueToAngle(value, min, max, bipolar)
  const dragState = useRef<{ startY: number; startAngle: number } | null>(null)

  const clamp = useCallback(
    (v: number) => Math.min(max, Math.max(min, v)),
    [min, max]
  )

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    dragState.current = { startY: e.clientY, startAngle: angle }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return
    const dy = dragState.current.startY - e.clientY
    const fine = e.shiftKey ? 0.25 : 1
    const dAngle = (dy / 150) * (END_ANGLE - START_ANGLE) * fine
    const nextVal = angleToValue(dragState.current.startAngle + dAngle, min, max, bipolar)
    onValueChange(clamp(nextVal))
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    dragState.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (disabled) return
    const dAngle = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 2 : 6)
    const nextVal = angleToValue(angle + dAngle, min, max, bipolar)
    onValueChange(clamp(nextVal))
  }

  const reset = () => {
    if (disabled) return
    onValueChange(defaultValue ?? (bipolar ? 0 : (min + max) / 2))
  }

  const c = 50
  const r = 37
  const arcPath = getArcPath(angle, bipolar, c, r)
  const isTurned = Math.abs(angle) > 2
  const isRow = labelPlacement === 'left' || labelPlacement === 'right'

  return (
    <div
      className={`flex items-center select-none ${
        isRow
          ? labelPlacement === 'left'
            ? 'flex-row-reverse justify-end gap-1'
            : 'flex-row justify-start gap-1'
          : 'flex-col justify-center'
      } ${className}`}
    >
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuetext={format?.(value)}
        aria-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={reset}
        title={label ? `${label}: ${format ? format(value) : value.toFixed(2)} (Double-click to reset)` : undefined}
        className={`relative shrink-0 touch-none select-none rounded-full outline-none transition-shadow ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-ns-resize'
        }`}
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          {/* Subtle background track ring matching FilterKnob 270-degree range */}
          <path
            d="M 23.84 76.16 A 37 37 0 1 1 76.16 76.16"
            fill="none"
            stroke={variant === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.08)'}
            strokeWidth={variant === 'dark' ? 4.5 : 4}
            strokeLinecap="round"
          />

          {/* Active colored arc matching deck color (Deck A green, Deck B purple) */}
          {arcPath && (
            <path
              d={arcPath}
              fill="none"
              stroke={accentColor}
              strokeWidth={variant === 'dark' ? 5.5 : 6}
              strokeLinecap="round"
            />
          )}

          {/* Top 12 o'clock zero tick mark */}
          <line
            x1={c}
            y1={2}
            x2={c}
            y2={9}
            stroke={variant === 'dark' ? (!isTurned ? accentColor : '#64748b') : '#ffffff'}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={variant === 'dark' ? 1 : 0.75}
          />

          {/* Knob body (r=27 matches FilterKnob r=13.5 in 50x50 viewBox) */}
          <circle
            cx={c}
            cy={c}
            r={27}
            fill={variant === 'dark' ? '#1e2025' : '#58585a'}
            stroke={variant === 'dark' ? (isTurned ? '#474a56' : '#363842') : '#3c3d42'}
            strokeWidth={1.8}
          />

          {/* Subtle inner bevel circle for dark variant */}
          {variant === 'dark' && (
            <circle
              cx={c}
              cy={c}
              r={21}
              fill="#282a32"
              opacity={0.55}
            />
          )}

          {/* White indicator pointer notch */}
          <line
            x1={c}
            y1={c - 10}
            x2={c}
            y2={c - 22}
            stroke="#ffffff"
            strokeWidth={variant === 'dark' ? 4.5 : 5}
            strokeLinecap="round"
            transform={`rotate(${angle} ${c} ${c})`}
          />
        </svg>
      </div>

      {label && (
        <span
          className={`font-sans text-[7.5px] font-bold tracking-wider text-zinc-400 uppercase select-none flex items-center justify-center gap-1 leading-none ${
            isRow ? '' : 'mt-0.5'
          }`}
        >
          {onDotClick ? (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation()
                onDotClick()
              }}
              className="w-2.5 h-2.5 -m-0.5 flex items-center justify-center cursor-pointer group/dot focus:outline-none"
              title={dotTitle || 'Click to reset'}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 transition-all group-hover/dot:scale-125"
                style={{
                  backgroundColor: isDotActive
                    ? (dotActiveColor || accentColor)
                    : (isTurned ? accentColor : '#373739'),
                }}
              />
            </button>
          ) : (
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
              style={{
                backgroundColor: isDotActive
                  ? (dotActiveColor || accentColor)
                  : (isTurned ? accentColor : '#373739'),
              }}
            />
          )}
          <span>{label}</span>
        </span>
      )}
    </div>
  )
}
