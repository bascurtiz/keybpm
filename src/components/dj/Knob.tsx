import { useRef, useCallback } from 'react'

interface KnobProps {
  value: number
  min?: number
  max?: number
  step?: number
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
  pointerColor?: string
  valueDisplay?: string
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
  step,
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
  pointerColor,
  valueDisplay,
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
    if (step) {
      const dir = e.deltaY < 0 ? 1 : -1
      onValueChange(clamp(value + dir * step))
      return
    }
    const dAngle = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 2 : 6)
    const nextVal = angleToValue(angle + dAngle, min, max, bipolar)
    onValueChange(clamp(nextVal))
  }

  const reset = () => {
    if (disabled) return
    onValueChange(defaultValue ?? (bipolar ? 0 : (min + max) / 2))
  }

  const c = 50
  const r = 38
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
          {/* Outer track ring */}
          <path
            d="M 23.14 76.86 A 38 38 0 1 1 76.86 76.86"
            fill="none"
            stroke={variant === 'dark' ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.12)'}
            strokeWidth={2.2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Active colored arc matching deck color (Deck A green, Deck B purple) */}
          {arcPath && (
            <path
              d={arcPath}
              fill="none"
              stroke={accentColor}
              strokeWidth={3}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Top 12 o'clock zero tick mark */}
          <line
            x1={c}
            y1={1}
            x2={c}
            y2={8}
            stroke={variant === 'dark' ? (!isTurned ? accentColor : '#64748b') : '#ffffff'}
            strokeWidth={1.8}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={variant === 'dark' ? 1 : 0.8}
          />

          {/* Knob body */}
          <circle
            cx={c}
            cy={c}
            r={29}
            fill={variant === 'dark' ? '#1e2025' : '#3e3e3e'}
            stroke={variant === 'dark' ? (isTurned ? '#474a56' : '#363842') : '#383838'}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />

          {/* Subtle inner bevel circle for dark variant */}
          {variant === 'dark' && (
            <circle
              cx={c}
              cy={c}
              r={23}
              fill="#282a32"
              opacity={0.55}
            />
          )}

          {/* Indicator pointer notch */}
          <line
            x1={c}
            y1={c - 10}
            x2={c}
            y2={c - 24}
            stroke={pointerColor || '#ffffff'}
            strokeWidth={3.2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            transform={`rotate(${angle} ${c} ${c})`}
          />
        </svg>
      </div>

      {label && (
        <span
          className={`font-sans text-[8.5px] font-bold tracking-wider text-[#777777] uppercase select-none flex items-center justify-center gap-1 leading-none ${
            isRow ? '' : 'mt-1'
          }`}
        >
          <span>{label}</span>
          {valueDisplay && (
            <span
              className="font-mono text-[8.5px] font-extrabold leading-none px-0.5"
              style={{ color: accentColor }}
            >
              {valueDisplay}
            </span>
          )}
          {onDotClick && (
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
                    : (isTurned ? accentColor : '#ffffff'),
                }}
              />
            </button>
          )}
        </span>
      )}
    </div>
  )
}
