import { useEffect, useRef, useState } from 'react'
import type { DeckEngine } from '@/lib/dj/deck-engine'
import { computePeaks } from '@/lib/dj/peaks'
import type { Track } from '@/lib/dj/types'

interface StackedWaveformsProps {
  deckA: DeckEngine
  deckB: DeckEngine
  className?: string
}

const zoomPeaksCache = new WeakMap<Track, Float32Array>()
const ZOOM_PPS = 140

function getZoomPeaks(track: Track): Float32Array {
  let peaks = zoomPeaksCache.get(track)
  if (!peaks) {
    peaks = computePeaks(track.buffer, Math.ceil(track.duration * ZOOM_PPS))
    zoomPeaksCache.set(track, peaks)
  }
  return peaks
}

export function StackedWaveforms({ deckA, deckB, className = '' }: StackedWaveformsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [windowSeconds, setWindowSeconds] = useState(8)

  const dragRef = useRef<{
    deck: DeckEngine
    startX: number
    startPos: number
    lastX: number
    lastTime: number
    velocity: number
    raf: number
  } | null>(null)

  const zoomIn = () => setWindowSeconds(s => Math.max(3, s - 2))
  const zoomOut = () => setWindowSeconds(s => Math.min(18, s + 2))

  const startDecayLoop = () => {
    const step = () => {
      const s = dragRef.current
      if (!s) return
      const now = performance.now()
      if (now - s.lastTime > 40 && s.velocity !== 0) {
        s.velocity *= 0.55
        if (Math.abs(s.velocity) < 0.02) s.velocity = 0
        s.deck.scratchMove(s.velocity)
      }
      s.raf = requestAnimationFrame(step)
    }
    if (dragRef.current) {
      dragRef.current.raf = requestAnimationFrame(step)
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0) return

    const y = e.clientY - rect.top
    const isDeckA = y < rect.height / 2
    const activeDeck = isDeckA ? deckA : deckB
    if (!activeDeck.track) return

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    canvas.style.cursor = 'grabbing'
    void activeDeck.scratchBegin()

    dragRef.current = {
      deck: activeDeck,
      startX: e.clientX,
      startPos: activeDeck.position,
      lastX: e.clientX,
      lastTime: performance.now(),
      velocity: 0,
      raf: 0,
    }
    startDecayLoop()
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const s = dragRef.current

    if (!s) {
      const rect = canvas.getBoundingClientRect()
      const isTopHalf = e.clientY - rect.top < rect.height / 2
      const deck = isTopHalf ? deckA : deckB
      canvas.style.cursor = deck.track ? 'grab' : 'default'
      return
    }

    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    if (w <= 0) return
    const secPerPx = windowSeconds / w

    const now = performance.now()
    const dt = Math.max(now - s.lastTime, 1)
    const dx = e.clientX - s.lastX
    s.lastX = e.clientX
    s.lastTime = now

    // Rate calculation: swiping left (dx < 0) corresponds to forward in time (positive rate)
    const instantRate = -(dx / dt) * secPerPx * 1000
    s.velocity = s.velocity * 0.4 + instantRate * 0.6
    const clampedRate = Math.max(-4, Math.min(4, s.velocity))
    s.deck.scratchMove(clampedRate)

    // Swiping left moves forward in time: targetPos = startPos - (e.clientX - startX) * secPerPx
    const targetPos = s.startPos - (e.clientX - s.startX) * secPerPx

    if (targetPos < 0) {
      s.startPos = 0
      s.startX = e.clientX
      s.deck.seek(0)
    } else if (targetPos > s.deck.duration) {
      s.startPos = s.deck.duration
      s.startX = e.clientX
      s.deck.seek(s.deck.duration)
    } else {
      s.deck.seek(targetPos)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = dragRef.current
    if (!s) return

    if (s.raf) cancelAnimationFrame(s.raf)
    s.deck.scratchEnd()
    dragRef.current = null

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      // ignore
    }

    const canvas = canvasRef.current
    if (canvas) {
      const rect = canvas.getBoundingClientRect()
      const isTopHalf = e.clientY - rect.top < rect.height / 2
      const deck = isTopHalf ? deckA : deckB
      canvas.style.cursor = deck.track ? 'grab' : 'default'
    }
  }

  const handlePointerLeave = () => {
    const canvas = canvasRef.current
    if (canvas && !dragRef.current) {
      canvas.style.cursor = 'default'
    }
  }

  useEffect(() => {
    return () => {
      if (dragRef.current) {
        if (dragRef.current.raf) cancelAnimationFrame(dragRef.current.raf)
        dragRef.current.deck.scratchEnd()
        dragRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0) return
      const dpr = window.devicePixelRatio || 1
      const w = rect.width
      const h = rect.height

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const halfH = h / 2
      const secPerPx = windowSeconds / w
      const centerPlayheadX = w / 2

      // Render Deck A (Top Half, Green)
      renderDeckLane({
        ctx,
        deck: deckA,
        topY: 0,
        laneH: halfH,
        windowSeconds,
        secPerPx,
        waveColor: '#34d399',
        beatColor: '#a1a1aa',
        downbeatColor: '#f4f4f5',
      })

      // Divider line
      ctx.strokeStyle = '#282828'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, halfH)
      ctx.lineTo(w, halfH)
      ctx.stroke()

      // Render Deck B (Bottom Half, Purple)
      renderDeckLane({
        ctx,
        deck: deckB,
        topY: halfH,
        laneH: halfH,
        windowSeconds,
        secPerPx,
        waveColor: '#a855f7',
        beatColor: '#a1a1aa',
        downbeatColor: '#f4f4f5',
      })

      // Traktor Red Center Playhead Needle
      ctx.shadowBlur = 0
      ctx.fillStyle = '#ef4444'
      const playheadX = Math.round(centerPlayheadX)
      ctx.fillRect(playheadX, 0, 1.5, h)
      // Minimal precision tick caps at top, center divider, and bottom
      ctx.fillRect(playheadX - 1, 0, 3.5, 2)
      ctx.fillRect(playheadX - 1, Math.round(halfH - 1), 3.5, 2)
      ctx.fillRect(playheadX - 1, h - 2, 3.5, 2)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [deckA, deckB, windowSeconds])

  return (
    <div className={`relative overflow-hidden rounded-[3px] border border-[#282828] bg-[#161616] ${className}`}>
      {/* Zoom controls embedded on top-left corner */}
      <div className="absolute top-1.5 left-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={zoomOut}
          disabled={windowSeconds >= 18}
          className="w-5 h-5 rounded bg-[#141414]/80 border border-[#282828] flex items-center justify-center text-[11px] font-bold text-[#888888] hover:text-[#d4d4d4] disabled:opacity-20 shadow-sm backdrop-blur-sm"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onPointerDown={e => e.stopPropagation()}
          onClick={zoomIn}
          disabled={windowSeconds <= 3}
          className="w-5 h-5 rounded bg-[#141414]/80 border border-[#282828] flex items-center justify-center text-[11px] font-bold text-[#888888] hover:text-[#d4d4d4] disabled:opacity-20 shadow-sm backdrop-blur-sm"
          title="Zoom in"
        >
          +
        </button>
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className="h-full w-full select-none touch-none"
      />
    </div>
  )
}

function renderDeckLane({
  ctx,
  deck,
  topY,
  laneH,
  windowSeconds,
  secPerPx,
  waveColor,
  beatColor,
  downbeatColor,
}: {
  ctx: CanvasRenderingContext2D
  deck: DeckEngine
  topY: number
  laneH: number
  windowSeconds: number
  secPerPx: number
  waveColor: string
  beatColor: string
  downbeatColor: string
}) {
  const track = deck.track
  const w = ctx.canvas.width / (window.devicePixelRatio || 1)
  const midY = topY + laneH / 2

  if (!track) {
    ctx.strokeStyle = '#282828'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(w, midY)
    ctx.stroke()
    return
  }

  const peaks = getZoomPeaks(track)
  const pos = deck.position
  const tStart = pos - windowSeconds / 2

  // 1. Beatgrid Ticks
  const grid = track.grid
  if (grid) {
    const beatLen = 60 / grid.bpm
    const firstVisibleBeat = Math.ceil((tStart - grid.firstBeat) / beatLen)
    for (let k = firstVisibleBeat; ; k++) {
      const t = grid.firstBeat + k * beatLen
      if (t > tStart + windowSeconds) break
      if (t < 0) continue
      const x = (t - tStart) / secPerPx

      const beatsFromBar = Math.round((t - grid.firstBar) / beatLen)
      const isDownbeat =
        ((beatsFromBar % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0

      ctx.fillStyle = isDownbeat ? downbeatColor : beatColor
      ctx.globalAlpha = isDownbeat ? 0.85 : 0.45
      ctx.fillRect(x - (isDownbeat ? 1 : 0.5), topY, isDownbeat ? 2 : 1, laneH)
    }
    ctx.globalAlpha = 1
  }

  // 2. Loop Region highlight (Traktor Emerald Green with center handle)
  if (deck.loop) {
    const x1 = (deck.loop.start - tStart) / secPerPx
    const x2 = (deck.loop.end - tStart) / secPerPx
    if (x2 > 0 && x1 < w) {
      const startX = Math.max(x1, 0)
      const endX = Math.min(x2, w)
      const loopWidth = endX - startX

      // Green translucent fill
      ctx.fillStyle = '#22c55e'
      ctx.globalAlpha = 0.22
      ctx.fillRect(startX, topY, loopWidth, laneH)

      // Green boundary edges
      ctx.globalAlpha = 0.95
      ctx.fillStyle = '#22c55e'
      if (x1 >= 0 && x1 <= w) ctx.fillRect(x1 - 1, topY, 2, laneH)
      if (x2 >= 0 && x2 <= w) ctx.fillRect(x2 - 1, topY, 2, laneH)

      // Center Loop Grab Handle [ ||| ] matching Traktor
      if (loopWidth > 32) {
        const midX = (startX + endX) / 2
        const handleW = 28
        const handleH = 14
        const handleY = topY + laneH - handleH - 3
        ctx.fillStyle = '#14532d'
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.roundRect(midX - handleW / 2, handleY, handleW, handleH, 4)
        ctx.fill()
        ctx.strokeStyle = '#22c55e'
        ctx.lineWidth = 1
        ctx.stroke()

        // Handle grip lines
        ctx.fillStyle = '#86efac'
        ctx.fillRect(midX - 5, handleY + 3.5, 1.5, 7)
        ctx.fillRect(midX - 0.75, handleY + 3.5, 1.5, 7)
        ctx.fillRect(midX + 3.5, handleY + 3.5, 1.5, 7)
      }
      ctx.globalAlpha = 1
    }
  }

  // 3. Multi-layer Waveform Envelope (Beatport DJ style outer body + solid core)
  for (let x = 0; x < w; x++) {
    const t = tStart + x * secPerPx
    if (t < 0 || t >= track.duration) continue
    const idx = Math.floor(t * ZOOM_PPS)
    const val = peaks[idx] ?? 0
    const ampOuter = Math.max(val * (laneH / 2 - 3), 0.5)
    const ampInner = Math.max(ampOuter * 0.52, 0.5)

    // Outer body
    ctx.fillStyle = waveColor
    ctx.globalAlpha = t <= pos ? 0.55 : 0.35
    ctx.fillRect(x, midY - ampOuter, 1, ampOuter * 2)

    // Inner bright core
    ctx.fillStyle = waveColor
    ctx.globalAlpha = t <= pos ? 1.0 : 0.75
    ctx.fillRect(x, midY - ampInner, 1, ampInner * 2)
  }
  ctx.globalAlpha = 1

  // 4. Hot Cues flags
  deck.hotCues.forEach((cue, i) => {
    if (cue === null) return
    const x = (cue - tStart) / secPerPx
    if (x < 0 || x > w) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x - 1, topY, 2, laneH)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 9px Inter, ui-sans-serif, sans-serif'
    ctx.fillText(`${i + 1}`, x + 3, topY + 12)
  })
}
