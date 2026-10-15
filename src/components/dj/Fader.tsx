import { useRef, useCallback, useEffect } from 'react'

interface FaderProps {
  value: number
  min: number
  max: number
  step?: number
  defaultValue?: number
  onValueChange: (value: number) => void
  /** Called on every drag move without triggering React re-renders — use for real-time audio updates. */
  onDragChange?: (value: number) => void
  orientation?: 'horizontal' | 'vertical'
  bipolar?: boolean
  snapCenter?: boolean
  ticks?: number
  label?: string
  format?: (value: number) => string
  disabled?: boolean
  className?: string
  accentColor?: string
  analyser?: AnalyserNode
  invert?: boolean
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function Fader({
  value,
  min,
  max,
  step,
  defaultValue,
  onValueChange,
  onDragChange,
  orientation = 'horizontal',
  bipolar = false,
  snapCenter = false,
  ticks = 0,
  label,
  format,
  disabled = false,
  className = '',
  accentColor,
  analyser,
  invert = false,
}: FaderProps) {
  const vertical = orientation === 'vertical'
  const range = max - min
  const rawNorm = clamp01((value - min) / range)
  const norm = invert ? 1 - rawNorm : rawNorm
  const trackRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const vuRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ fine: boolean; startNorm: number; startPos: number } | null>(null)
  /** Last norm committed during drag (used for smooth handle position update). */
  const liveNorm = useRef(norm)

  useEffect(() => {
    if (!analyser || !vertical) return
    let raf = 0
    const data = new Float32Array(analyser.fftSize)
    let peak = 0
    const segCount = 16

    const tick = () => {
      raf = requestAnimationFrame(tick)
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      peak = Math.max(rms, peak * 0.93)

      const litCount = Math.min(segCount, Math.round(peak * segCount * 2.2))
      const parent = vuRef.current
      if (!parent) return

      for (let i = 0; i < segCount; i++) {
        const seg = parent.children[segCount - 1 - i] as HTMLElement | undefined
        if (seg) seg.style.opacity = i < litCount ? '1' : '0.15'
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [analyser, vertical])

  /** Compute the audio value from a normalised [0,1] position. */
  const normToValue = useCallback(
    (n: number) => {
      const effectiveNorm = invert ? 1 - clamp01(n) : clamp01(n)
      let v = min + effectiveNorm * range
      if (step) v = Math.round(v / step) * step
      if (snapCenter) {
        const mid = (min + max) / 2
        if (Math.abs(v - mid) < range * 0.035) v = mid
      }
      return Math.min(max, Math.max(min, v))
    },
    [min, max, range, step, snapCenter, invert]
  )

  /** Move the fader handle directly in the DOM (no React re-render). */
  const moveHandleDom = useCallback(
    (n: number) => {
      const el = handleRef.current
      if (!el) return
      const pct = `${clamp01(n) * 100}%`
      if (vertical) {
        el.style.bottom = pct
      } else {
        el.style.left = pct
      }
    },
    [vertical]
  )

  const commit = useCallback(
    (n: number, isDrag = false) => {
      const v = normToValue(n)
      liveNorm.current = invert ? 1 - clamp01((v - min) / range) : clamp01((v - min) / range)
      moveHandleDom(liveNorm.current)
      if (isDrag && onDragChange) {
        // Smooth real-time audio update, no React setState
        onDragChange(v)
      } else {
        // Full commit: update React state (triggers re-render to sync value prop)
        onValueChange(v)
      }
    },
    [normToValue, moveHandleDom, min, range, invert, onDragChange, onValueChange]
  )

  const normFromEvent = (e: React.PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return norm
    return vertical
      ? 1 - (e.clientY - rect.top) / rect.height
      : (e.clientX - rect.left) / rect.width
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    drag.current = {
      fine: e.shiftKey,
      startNorm: norm,
      startPos: vertical ? e.clientY : e.clientX,
    }
    if (!e.shiftKey) commit(normFromEvent(e), false)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.fine) {
      const rect = trackRef.current?.getBoundingClientRect()
      const length = (vertical ? rect?.height : rect?.width) || 1
      const delta = vertical ? d.startPos - e.clientY : e.clientX - d.startPos
      commit(d.startNorm + (delta / length) * 0.25, true)
    } else {
      commit(normFromEvent(e), true)
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    // Final commit to sync React state after drag ends
    if (d) commit(liveNorm.current, false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    if (disabled) return
    const s = (step ?? range / 100) * (e.shiftKey ? 1 : 2)
    commit(norm + (e.deltaY < 0 ? s : -s) / range)
  }

  const reset = () => {
    if (disabled) return
    onValueChange(defaultValue ?? (bipolar ? (min + max) / 2 : min))
  }

  const fillStart = bipolar ? Math.min(norm, 0.5) : 0
  const fillSize = bipolar ? Math.abs(norm - 0.5) : norm

  const hasCustomH = /(?:^|\s)!?h-/.test(className)
  const hasCustomW = /(?:^|\s)!?w-/.test(className)
  const sizeClasses = vertical
    ? `${hasCustomH ? '' : 'h-full'} ${hasCustomW ? '' : 'w-9'}`
    : `${hasCustomH ? '' : 'h-8'} ${hasCustomW ? '' : 'w-full'}`

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value * 1000) / 1000}
      aria-valuetext={format?.(value)}
      aria-disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={reset}
      className={`group relative touch-none select-none outline-none ${sizeClasses.trim()} ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
      title={label ? `${label}: ${format ? format(value) : value.toFixed(2)}` : undefined}
    >
      {/* Ticks */}
      {ticks > 1 &&
        Array.from({ length: ticks }, (_, i) => {
          const pos = (i / (ticks - 1)) * 100
          const isCenter = bipolar && ticks % 2 === 1 && i === (ticks - 1) / 2
          const length = isCenter ? (vertical ? 18 : 14) : (vertical ? 12 : 8)
          return (
            <div
              key={i}
              aria-hidden
              className={`absolute ${isCenter ? 'bg-text-muted' : 'bg-line'}`}
              style={
                vertical
                  ? {
                      bottom: `${pos}%`,
                      height: 1,
                      width: length,
                      left: '50%',
                      transform: 'translate(-50%, 50%)',
                    }
                  : {
                      left: `${pos}%`,
                      width: 1,
                      height: length,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                    }
              }
            />
          )
        })}

      {/* Track Slot */}
      <div
        ref={trackRef}
        className={`absolute rounded-full bg-[#161616] border border-[#282828] overflow-hidden ${
          vertical
            ? analyser
              ? 'top-0 left-1/2 h-full w-[7px] -translate-x-1/2 py-1 flex flex-col justify-between items-center'
              : 'top-0 left-1/2 h-full w-1.5 -translate-x-1/2'
            : 'top-1/2 left-0 h-1.5 w-full -translate-y-1/2'
        }`}
      >
        {/* Integrated VU Meter LED Segments inside Track Slot */}
        {analyser && vertical ? (
          <div
            ref={vuRef}
            className="flex flex-col justify-between items-center w-full h-full pointer-events-none select-none py-0.5 gap-[1.5px]"
            aria-hidden
          >
            {Array.from({ length: 16 }, (_, i) => {
              const isRed = i < 2
              const isYellow = i >= 2 && i < 6
              const color = isRed ? '#ef4444' : isYellow ? '#f59e0b' : '#10b981'
              return (
                <div
                  key={i}
                  className="w-[3px] flex-1 rounded-[0.5px] transition-opacity duration-75"
                  style={{ backgroundColor: color, opacity: 0.15 }}
                />
              )
            })}
          </div>
        ) : (
          accentColor && (
            <div
              className="absolute rounded-full"
              style={{
                backgroundColor: accentColor,
                opacity: 0.7,
                ...(vertical
                  ? {
                      left: 0,
                      width: '100%',
                      bottom: `${fillStart * 100}%`,
                      height: `${fillSize * 100}%`,
                    }
                  : {
                      top: 0,
                      height: '100%',
                      left: `${fillStart * 100}%`,
                      width: `${fillSize * 100}%`,
                    }),
              }}
            />
          )
        )}
      </div>

      {/* Fader Handle / Cap (Neutral grayscale #505050 with white indicator) */}
      <div
        ref={handleRef}
        aria-hidden
        className={`absolute rounded-[2px] bg-[#505050] border border-[#383838] shadow-md flex items-center justify-center pointer-events-none z-20 ${
          vertical
            ? 'left-1/2 w-8 h-4 -translate-x-1/2 translate-y-1/2'
            : 'top-1/2 w-4 h-8 -translate-x-1/2 -translate-y-1/2'
        }`}
        style={
          vertical
            ? { bottom: `${norm * 100}%` }
            : { left: `${norm * 100}%` }
        }
      >
        {/* White indicator stripe */}
        <div
          className={`bg-white shadow-sm ${
            vertical
              ? 'w-full h-[1.5px]'
              : 'h-full w-[1.5px]'
          }`}
        />
      </div>
    </div>
  )
}
