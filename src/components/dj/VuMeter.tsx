import { useEffect, useRef } from 'react'

interface VuMeterProps {
  analyser: AnalyserNode
  segments?: number
  height?: number | string
  className?: string
}

export function VuMeter({
  analyser,
  segments = 14,
  height = '100%',
  className = '',
}: VuMeterProps) {
  const barsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const data = new Float32Array(analyser.fftSize)
    let peak = 0

    const tick = () => {
      raf = requestAnimationFrame(tick)
      analyser.getFloatTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
      const rms = Math.sqrt(sum / data.length)
      peak = Math.max(rms, peak * 0.93)

    const litCount = Math.min(segments, Math.round(peak * segments * 2.2))
    const litCountR = Math.min(segments, Math.round(peak * segments * 2.05))
    const parent = barsRef.current
    if (!parent) return

    const col1 = parent.children[0] as HTMLElement | undefined
    const col2 = parent.children[1] as HTMLElement | undefined

    if (col1) {
      for (let i = 0; i < segments; i++) {
        const seg = col1.children[segments - 1 - i] as HTMLElement | undefined
        if (seg) seg.style.opacity = i < litCount ? '1' : '0.12'
      }
    }
    if (col2) {
      for (let i = 0; i < segments; i++) {
        const seg = col2.children[segments - 1 - i] as HTMLElement | undefined
        if (seg) seg.style.opacity = i < litCountR ? '1' : '0.12'
      }
    }
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}, [analyser, segments])

  const renderMeterBar = () => (
    <div className="flex flex-col gap-[2px] w-[3px] h-full justify-between py-0.5">
      {Array.from({ length: segments }, (_, i) => {
        const isRed = i < 2
        const isYellow = i >= 2 && i < 5
        const color = isRed ? '#ef4444' : isYellow ? '#eab308' : '#10b981'
        return (
          <div
            key={i}
            className="w-full flex-1 rounded-[1px] transition-opacity duration-75"
            style={{ backgroundColor: color, opacity: 0.12 }}
          />
        )
      })}
    </div>
  )

  return (
    <div
      ref={barsRef}
      className={`flex items-center gap-[2px] px-1 py-1 bg-[#161616] rounded-sm border border-[#282828] ${className}`}
      style={{ height }}
      aria-hidden
    >
      {renderMeterBar()}
      {renderMeterBar()}
    </div>
  )
}
