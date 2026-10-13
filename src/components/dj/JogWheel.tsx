import { useEffect, useRef } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'

interface JogWheelProps {
  deck: DeckEngine
  size?: number | string
  className?: string
  accentColor?: string
}

const SECONDS_PER_REV = 1.8
const DEG_PER_MS_AT_1X = 360 / (SECONDS_PER_REV * 1000)

export function JogWheel({
  deck,
  size = 170,
  className = '',
  accentColor = '#10b981',
}: JogWheelProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const discRef = useRef<HTMLDivElement>(null)
  const scratch = useRef<{
    lastAngle: number
    lastTime: number
    velocity: number
    raf: number
  } | null>(null)

  // Rotate platter with playhead
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = discRef.current
      if (!el) return
      const rotation = (deck.position / SECONDS_PER_REV) * 360
      el.style.transform = `rotate(${rotation}deg)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deck])

  const startDecayLoop = () => {
    const step = () => {
      const s = scratch.current
      if (!s) return
      if (performance.now() - s.lastTime > 50 && s.velocity !== 0) {
        s.velocity *= 0.55
        if (Math.abs(s.velocity) < 0.02) s.velocity = 0
        deck.scratchMove(s.velocity)
      }
      s.raf = requestAnimationFrame(step)
    }
    if (scratch.current) scratch.current.raf = requestAnimationFrame(step)
  }

  const angleFromEvent = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!deck.track) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    void deck.scratchBegin()
    scratch.current = {
      lastAngle: angleFromEvent(e),
      lastTime: performance.now(),
      velocity: 0,
      raf: 0,
    }
    startDecayLoop()
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = scratch.current
    if (!s || !deck.track) return
    const angle = angleFromEvent(e)
    let delta = angle - s.lastAngle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    const now = performance.now()
    const dt = Math.max(now - s.lastTime, 1)
    s.lastAngle = angle
    s.lastTime = now

    const instant = delta / dt / DEG_PER_MS_AT_1X
    s.velocity = s.velocity * 0.5 + instant * 0.5
    deck.scratchMove(s.velocity)
  }

  const endScratch = (e: React.PointerEvent) => {
    const s = scratch.current
    if (s) {
      cancelAnimationFrame(s.raf)
      scratch.current = null
      deck.scratchEnd()
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const track = deck.track

  return (
    <div
      ref={rootRef}
      className={`relative shrink-0 touch-none select-none rounded-full border-2 border-[#282828] bg-[#161616] shadow-inner transition-all ${
        track ? 'cursor-grab active:cursor-grabbing hover:border-zinc-500' : 'opacity-70 cursor-default'
      } ${className}`}
      style={{
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endScratch}
      onPointerCancel={endScratch}
      aria-label="Jog wheel platter"
      title={track ? 'Jog wheel (drag to scratch / pitch bend)' : 'Load a track to use jog wheel'}
    >
      {/* Rotating Platter Assembly (Rotates with track position) */}
      <div
        ref={discRef}
        className="absolute inset-0 rounded-full will-change-transform"
      >
        {/* Outer Ring Vinyl Grooves */}
        <div className="absolute inset-1 rounded-full border border-white/5 pointer-events-none" />
        <div className="absolute inset-2.5 rounded-full border border-white/5 pointer-events-none" />
        <div className="absolute inset-4 rounded-full border border-white/5 pointer-events-none" />

        {/* Vibrant colored radial needle matching Traktor DJ */}
        <div
          className="absolute top-1 left-1/2 -translate-x-1/2 w-[3px] h-[22px] rounded-full pointer-events-none z-10 shadow-md"
          style={{
            backgroundColor: accentColor,
            boxShadow: `0 0 8px ${accentColor}`,
          }}
        />

        {/* Inner Disc / Center Area (where track cover art is loaded) */}
        <div
          className="absolute inset-[18%] rounded-full overflow-hidden shadow-lg flex items-center justify-center border border-[#282828] bg-[#1C1C1C]"
        >
          {track?.coverUrl ? (
            <div className="relative w-full h-full">
              <img
                src={track.coverUrl}
                alt=""
                className="w-full h-full object-cover pointer-events-none select-none"
              />
              {/* Center vinyl spindle dot */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="h-6 w-6 rounded-full border border-white/20 bg-[#161616]/80 flex items-center justify-center backdrop-blur-[1px]">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: accentColor }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full h-full bg-[#1C1C1C] flex items-center justify-center">
              {/* Center vinyl label spindle */}
              <div className="h-8 w-8 rounded-full border border-zinc-600 flex items-center justify-center bg-[#161616]">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: accentColor }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
