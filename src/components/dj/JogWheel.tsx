import { useEffect, useRef } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { youtubeBridge } from '@/lib/dj/youtube-bridge'
import { youtubeThumbUrl } from '@/lib/youtube'

interface JogWheelProps {
  deck: DeckEngine
  deckId?: 'A' | 'B'
  size?: number | string
  className?: string
  accentColor?: string
}

const SECONDS_PER_REV = 1.8
const DEG_PER_MS_AT_1X = 360 / (SECONDS_PER_REV * 1000)

export function JogWheel({
  deck,
  deckId,
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
    wasPlayingBeforeTouch: boolean
  } | null>(null)

  const ytDeck = deckId ? youtubeBridge.state[deckId] : null
  const hasYt = Boolean(ytDeck && ytDeck.hasVideo)
  const track = deck.track

  // Rotate platter with playhead or manual scratch
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = discRef.current
      if (!el) return

      // If user is scratching/dragging, rotation is updated in pointer move
      if (scratch.current) return

      const pos = track
        ? deck.position
        : hasYt && ytDeck
        ? ytDeck.currentTime
        : 0
      const rotation = (pos / SECONDS_PER_REV) * 360
      el.style.transform = `rotate(${rotation}deg)`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deck, track, hasYt, ytDeck])

  const startDecayLoop = () => {
    const step = () => {
      const s = scratch.current
      if (!s) return
      if (performance.now() - s.lastTime > 50 && s.velocity !== 0) {
        s.velocity *= 0.55
        if (Math.abs(s.velocity) < 0.02) s.velocity = 0
        if (track) {
          deck.scratchMove(s.velocity)
        }
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
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}

    const wasPlaying = Boolean(track ? deck.playing : hasYt && ytDeck?.playing)

    if (track) {
      void deck.scratchBegin()
    } else if (hasYt && deckId) {
      if (ytDeck?.playing) {
        youtubeBridge.pause(deckId)
      }
    }

    scratch.current = {
      lastAngle: angleFromEvent(e),
      lastTime: performance.now(),
      velocity: 0,
      raf: 0,
      wasPlayingBeforeTouch: wasPlaying,
    }
    startDecayLoop()
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const s = scratch.current
    if (!s) return
    e.preventDefault()
    e.stopPropagation()

    const angle = angleFromEvent(e)
    let delta = angle - s.lastAngle
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    const now = performance.now()
    const dt = Math.max(now - s.lastTime, 1)
    s.lastAngle = angle
    s.lastTime = now

    // Update disc visual rotation directly during touch
    if (discRef.current) {
      const currentTransform = discRef.current.style.transform
      const match = currentTransform.match(/rotate\(([-0-9.]+)deg\)/)
      const prevAngle = match ? parseFloat(match[1]) : 0
      discRef.current.style.transform = `rotate(${prevAngle + delta}deg)`
    }

    const instant = delta / dt / DEG_PER_MS_AT_1X
    s.velocity = s.velocity * 0.5 + instant * 0.5

    if (track) {
      deck.scratchMove(s.velocity)
    } else if (hasYt && deckId && ytDeck) {
      const deltaSec = (delta / 360) * SECONDS_PER_REV
      const newTime = Math.max(0, ytDeck.currentTime + deltaSec)
      youtubeBridge.seekTo(deckId, newTime)
    }
  }

  const endScratch = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const s = scratch.current
    if (s) {
      cancelAnimationFrame(s.raf)
      const shouldResume = s.wasPlayingBeforeTouch
      scratch.current = null

      if (track) {
        deck.scratchEnd()
      } else if (hasYt && deckId && shouldResume) {
        youtubeBridge.play(deckId)
      }
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
  }

  // Cover image: either local track cover or YouTube thumbnail
  const coverUrl = track?.coverUrl || (hasYt && ytDeck?.videoId ? youtubeThumbUrl(ytDeck.videoId) : null)

  return (
    <div
      ref={rootRef}
      className={`relative shrink-0 touch-none select-none rounded-full border-2 border-[#282828] bg-[#161616] shadow-inner transition-all cursor-grab active:cursor-grabbing hover:border-zinc-500 ${className}`}
      style={{
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endScratch}
      onPointerCancel={endScratch}
      aria-label="Jog wheel platter"
      title="Jog wheel platter (drag to spin / scratch)"
    >
      {/* Rotating Platter Assembly (Rotates with track position) */}
      <div
        ref={discRef}
        className="absolute inset-0 rounded-full will-change-transform pointer-events-none"
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

        {/* Inner Disc / Center Area (where track cover art or video thumb is loaded) */}
        <div
          className="absolute inset-[18%] rounded-full overflow-hidden shadow-lg flex items-center justify-center border border-[#282828] bg-[#1C1C1C]"
        >
          {coverUrl ? (
            <div className="relative w-full h-full">
              <img
                src={coverUrl}
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
